---
title: Splitting a PHP monolith without a feature freeze
kind: case-study
status: published
date: 2026-09-24
order: 0
lede: Fulfillment came out of a PHP monolith piece by piece, over SQS, so six people never froze features. The price was a contract both sides had to keep.
tags: [architecture, sqs, redis]
cover: /img/blog/event-driven.svg
coverAlt: A monolith block with one empty dashed slot, and the fulfillment piece standing on its own across an SQS FIFO queue.
---

## Situation

Every order state change in the delivery product shipped in the same deploy as everything else. Fulfillment was one more component inside a PHP/Laravel monolith, so changing how an order moved meant releasing the whole application.

The product had 100K daily users, and every order moved through kitchen, driver and delivery in real time. I had already built the real-time order service that pushed that status to mobile and web clients, on Node.js and Socket.IO. It consumed order state changes pushed from the monolith over SQS and fanned them out to subscribed clients. So one part of the system already lived outside the monolith and listened to it through a queue.

Fulfillment was still inside.

### Six people, no freeze

The team was six people. The tidy answer was a full event-driven rewrite of fulfillment, and it is easy to draw: a clean service, clean events, the old code deleted at the end. Shipping it was the problem. It meant months of running two partially consistent systems, the old one still taking orders and the new one learning to, with feature work frozen until they converged. A team of six could not stop shipping for months.

Martin Fowler puts it in one line in his article on the strangler fig pattern: "Replacing a serious IT system takes a long time, and the users can't wait for new features." That was the whole constraint.

## Decision

I took fulfillment out piece by piece instead. It became a standalone Node.js/Express service, decomposed out of the monolith into an event-driven architecture, with state changes passing over an AWS SQS FIFO queue behind a REST API contract. Hot order state was served from Redis in a write-behind cache with MySQL behind it, which kept status fan-out off the transactional path.

That is the decision in two sentences, and on its own it says very little. "Put a queue between them" is the easy part of any extraction. What decides whether it works is what the two sides promise each other about a message that arrives twice, arrives late, or arrives out of order. The rest of this section is my reasoning about those promises, from the SQS documentation and from what an extraction like this has to get right. Where I describe a mechanism, read it as the shape I would check first, not as a record of the code we ran.

### Use the seam you already have

A companion article on Fowler's site names the move underneath every strangler fig: event interception. The definition is short, "Intercept any updates to system state and route some of them to a new component", and the advice that comes with it is to use existing integration points as seams instead of cutting new ones into the legacy code. The article goes further: "If you are using the Strangler Fig pattern then you will also be using some form of Event Interception."

I think the boring half of that advice is the useful half. When the monolith already writes its state changes to a queue for one consumer, a second consumer costs the legacy code far less than a new integration does. Legacy code you do not have to touch is legacy code you cannot break.

![The extraction shape. The monolith already published order state changes to an SQS FIFO queue for the real-time order service, so the new fulfillment service joined as a second consumer of the same queue while the fulfillment code inside the monolith was removed piece by piece.](diagram:fulfillment-strangler)

The harder question the pattern raises is ownership. In the same article, redirecting writes "made the new domain service the System of Record for this data, as the legacy data store was no longer updated." Every piece of state in an extraction has that moment. Before it, the new service is a reader that may lag. After it, the monolith is the reader. The bugs I would look for first live in fields where nobody wrote down which side of that moment they are on.

### What a FIFO queue buys

The queue was FIFO. A standard queue is the default, and the SQS guide is frank about what it gives up: "more than one copy of a message might be delivered, and messages may occasionally arrive out of order." For order state, both of those are bugs waiting for a busy evening. FIFO removes most of each.

The first thing it buys is deduplication on the way in. Every message carries a message deduplication ID, set by the producer or, with content-based deduplication, generated as a SHA-256 hash of the body (not the attributes). A second message with the same ID sent within the 5-minute deduplication interval is treated as a duplicate and only one copy is delivered, and SQS "continues tracking the deduplication ID even after the message has been received and deleted." A monolith that times out on `SendMessage` and retries does not put the event on the queue twice.

The second is order. Messages that share a message group ID "are always processed one at a time, in strict order". While one of them is in flight, nothing more from that group is handed out until it is deleted or its visibility timeout expires. Messages in different groups have no order relative to each other, and that is where the parallelism comes from.

![Two message groups on one FIFO queue, keyed by order id. Inside a group messages are handed out one at a time in strict order; across groups there is no ordering, so orders are processed in parallel. A retried send with the same deduplication ID inside five minutes is dropped.](diagram:fulfillment-fifo-groups)

### Where exactly-once stops

AWS calls this exactly-once processing, and I think the name promises more than the mechanism. Deduplication guards the send side. The receive side still runs on a lease. When a consumer receives a message, SQS hides it for the visibility timeout, 30 seconds by default, and if the consumer has not deleted it by then it becomes visible again. The visibility timeout page says this of FIFO queues as much as standard ones: "there's no absolute guarantee that a message won't be delivered more than once during the visibility timeout period."

That leaves gaps no queue setting closes. A consumer commits its database change and dies before `DeleteMessage`; the message comes back and, in the guide's words, "can then be retrieved by the same or a different consumer for another processing attempt." A consumer that is merely slow outlives its timeout, and the next receive hands the same message to someone else. A producer that retries after the 5-minute interval sends a message SQS has already forgotten. And everything the consumer does outside SQS, a MySQL row, a Redis key, a status pushed to a driver's phone, is outside the exactly-once promise entirely.

So the consumer on the far side of the extraction still has to be idempotent. FIFO is a reason to see fewer duplicates. It is not a reason to handle none.

### An idempotent consumer, as a sketch

What follows is a sketch of the approach, not the service's code. It starts at the producer, because the cheapest idempotency key is one the producer already has. In the monolith, with the AWS SDK for PHP:

```php
$sqs->sendMessage([
    'QueueUrl'               => $queueUrl,
    'MessageBody'            => json_encode([
        'eventId' => $eventId,
        'orderId' => $order->id,
        'status'  => $order->status,
        'version' => $order->version,
    ]),
    'MessageGroupId'         => (string) $order->id,
    'MessageDeduplicationId' => $eventId,
]);
```

`$eventId` is generated once, when the state change is written, and reused if the send is retried. The group ID is the order id. I think that is the natural choice for order state: one order is the unit that needs strict sequence, and two different orders have nothing to say to each other. The deduplication ID is the same `eventId` the consumer keys its own table on, so SQS and the database agree on what "the same event" means.

On the consumer side, two tables carry it. One records which events have been applied. The other holds each order's fulfillment state with a version number, so a stale event cannot overwrite a newer one.

```sql
CREATE TABLE processed_events (
  event_id   CHAR(36)    NOT NULL,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (event_id)
);

CREATE TABLE fulfillment_orders (
  order_id BIGINT UNSIGNED NOT NULL,
  status   VARCHAR(32)     NOT NULL,
  version  INT UNSIGNED    NOT NULL DEFAULT 0,
  PRIMARY KEY (order_id)
);
```

Two choices in that schema matter more than they look. The key is the `event_id` the producer writes into the message body, not the SQS `MessageId`. A send retried after the deduplication interval is a second message, with its own `MessageId` and the same meaning, so keying on `MessageId` would wave it through. And each event carries the order's whole new status and a version, not an instruction like "advance one step". A state you can compare is safer than a command you have to replay in order.

The consumer, in TypeScript with the AWS SDK v3 and `mysql2`:

```ts
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from "@aws-sdk/client-sqs";
import mysql from "mysql2/promise";

type FulfillmentEvent = {
  eventId: string; // set by the producer, stable across its retries
  orderId: number;
  status: "preparing" | "ready" | "picked_up" | "delivered";
  version: number; // grows with every state change of this order
};

const sqs = new SQSClient({});
const queueUrl = process.env.FULFILLMENT_QUEUE_URL!;
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

async function apply(event: FulfillmentEvent): Promise<void> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    try {
      await conn.execute(
        "INSERT INTO processed_events (event_id) VALUES (?)",
        [event.eventId],
      );
    } catch (err) {
      if ((err as { code?: string }).code === "ER_DUP_ENTRY") {
        await conn.rollback();
        return; // applied before: a redelivery or a producer retry
      }
      throw err;
    }
    await conn.execute(
      `UPDATE fulfillment_orders
          SET status = ?, version = ?
        WHERE order_id = ? AND version < ?`,
      [event.status, event.version, event.orderId, event.version],
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function poll(): Promise<void> {
  for (;;) {
    const { Messages = [] } = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 20,
        MessageSystemAttributeNames: ["MessageGroupId"],
      }),
    );
    const failedGroups = new Set<string>();
    for (const message of Messages) {
      const group = message.Attributes?.MessageGroupId ?? "";
      if (failedGroups.has(group)) continue; // stay behind the failed event
      try {
        await apply(JSON.parse(message.Body!) as FulfillmentEvent);
        await sqs.send(
          new DeleteMessageCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: message.ReceiptHandle!,
          }),
        );
      } catch (err) {
        // not deleted: visible again after the visibility timeout,
        // moved to the dead-letter queue after maxReceiveCount receives
        failedGroups.add(group);
        console.error("fulfillment event failed", message.MessageId, err);
      }
    }
  }
}

void poll();
```

The `processed_events` row commits in the same transaction as the state change, and that is the property the whole sketch exists for. If the process dies after `COMMIT` and before `DeleteMessage`, the redelivered copy hits the primary key (MySQL error 1062, `ER_DUP_ENTRY`), rolls back, and gets deleted on the next pass. If it dies before `COMMIT`, neither row exists and the retry applies the change once. `WaitTimeSeconds: 20` is long polling at its maximum, which cuts the empty responses a tight receive loop would otherwise pay for.

![The redelivery the sketch is built for. The consumer commits the state change and the event id in one transaction, then crashes before deleting the message; after the visibility timeout the same message is received again, the insert hits the primary key, and the second attempt rolls back and deletes it.](diagram:fulfillment-redelivery)

`failedGroups` exists because of one line in the FIFO delivery docs: a single receive can return up to 10 messages from the same message group, in order. If the first of them fails and the loop carries on, the second is applied and deleted ahead of it, and the consumer has broken the order SQS just handed it. Skipping the rest of that group leaves those messages undeleted, so they come back after the visibility timeout, still behind the one that failed.

A message that keeps failing is never deleted, so it keeps coming back. A redrive policy moves it to a dead-letter queue after `maxReceiveCount` receives. The guide warns against setting that too low: at 1, "one failure to receive a message would cause the message to move to the dead-letter queue."

The sketch has two holes I would want closed before trusting it. It assumes the order's row exists before its first event arrives; if that is not guaranteed, the `UPDATE` becomes an upsert with a harder version rule. And `processed_events` grows forever. Rows older than the queue's message retention period, 14 days at most, can go, because no copy of those messages can still be delivered.

### Strict order is not the order you meant

Within one group FIFO keeps strict order, so it is fair to ask why the sketch still carries a version column. Because SQS can only preserve the order it is given. The FIFO docs say that when "multiple producers or threads send messages with the same message group ID, Amazon SQS ensures they are stored and processed in the order they arrive." Arrival order is not commit order. Two PHP requests that change the same order can commit in one sequence and reach `SendMessage` in the other, and SQS will faithfully preserve the wrong one.

The dead-letter queue is the second way out of order. The guide says not to use one with a FIFO queue "if you don't want to break the exact order of messages or operations." Once a poisoned event is moved aside, the next event for that order goes through without it, and a redrive later delivers the old one after the new.

The version guard covers both. If `delivered` lands before `picked_up`, the late `picked_up` matches no row and changes nothing. Whether that is fine depends on whether anything downstream needed to see the pickup happen.

Strict order also has a price in throughput. Without high throughput mode, a FIFO queue partition handles 300 transactions per second per API action, or 3,000 messages per second when each call carries a batch of 10. High throughput mode raises that ceiling, and there the message group ID is what SQS hashes to pick a partition, which is why AWS recommends group IDs "that can have a large number of distinct values." Order ids fit that well. They also bound the cost of a stuck message: it holds back one order, not the queue.

For an order state machine I would keep the version column even on FIFO. It is the one guard in this list that lives in your own database, where you can read it at two in the morning when an order looks wrong.

## Trade-off

The rewrite was cleaner on paper. It also meant months of two partially consistent systems with features frozen, which a team of six could not absorb. Incremental extraction bought continuous shipping and paid for it with a living seam: the monolith and the service had to keep agreeing on the contract, on both sides, every week.

That seam is real code with a short life. Fowler names the cost without softening it: "people often balk at the necessity of building transitional architecture to allow the new and legacy system to coexist, code that will go away once the modernization is complete." His answer is that "the reduced risk and earlier value from the gradual approach outweigh its costs." I agree, and I would add one thing. Transitional code is the code nobody wants to own, so decide who owns it before it exists.

Consistency windows are the other cost, and this design stacked two of them. The first is the queue. Between the monolith writing a state change and the service applying it, the two disagree. The second is the cache. In a write-behind cache the application reads and writes the cache, and, as the Redis documentation puts it, "the cache syncs any changed data to the backing database asynchronously." Redis holds the newest order state before MySQL does. That is why fan-out could stay off the transactional path, and it is also why anything reading MySQL directly can be looking at the past. The case I would test first is a crash between the cache write and the sync.

Neither window is a bug by itself. A window becomes a bug when the reader on the far side does not know it is behind.

Incremental extraction is the wrong call when there is no seam. If the component shares tables and transactions with everything around it, a queue just turns one transaction into two with a gap between them, and the project spends its life on the gap. It is also wrong when the team can genuinely afford the freeze. That is rarer than people admit, and it was not our case. My bias is that a team of six starts from the incremental path and needs a strong argument to leave it, not the other way round.

## Outcome

Fulfillment ran as a standalone service while the rest of the product kept shipping. Nobody froze feature work to get there, which was the point.

The contract also got stricter on the consuming side. I migrated the real-time order service from JavaScript to TypeScript, so event and message payload mismatches failed at compile time instead of in front of customers. A sketch of what that buys, with events as a discriminated union:

```ts
type OrderEvent =
  | { type: "order.ready"; orderId: number; version: number }
  | { type: "order.picked_up"; orderId: number; version: number; driverId: number }
  | { type: "order.delivered"; orderId: number; version: number };

function label(event: OrderEvent): string {
  switch (event.type) {
    case "order.ready":
      return "ready for pickup";
    case "order.picked_up":
      return `picked up by driver ${event.driverId}`;
    case "order.delivered":
      return "delivered";
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}
```

Add a fourth event to the union and every `switch` that forgot it stops compiling. Read `driverId` on an `order.ready` event and the compiler refuses. What it cannot see is the PHP side. Types end at the edge of the TypeScript code, and a message body from the monolith is a string until something checks it at runtime. I would put that check where the consumer parses `Body`, and treat a message that fails it as a contract break to alert on, not a retry.

In the same role I instrumented order, driver and kitchen flows with Datadog and OpenTelemetry, and Mean Time To Resolve fell by 30%. I would not credit the extraction with that number. I would say that once an order's life crosses a queue, the logs on either side each tell half the story, and tracing is how you get the whole one back.

On the next extraction, the first thing I would write is not a queue definition. It is a list: every piece of state the new service touches, which side is the system of record for it this week, and what a reader on the other side does when it is behind. The queue type, the idempotency table and the version column all follow from that list. Without it they are guesses that happen to compile.

## Sources

- Martin Fowler, Strangler Fig Application: https://martinfowler.com/bliki/StranglerFigApplication.html
- Ian Cartwright, Rob Horn and James Lewis, Event Interception: https://martinfowler.com/articles/patterns-legacy-displacement/event-interception.html
- Amazon SQS developer guide, standard queues: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues.html
- Amazon SQS developer guide, FIFO key terms (deduplication ID, message group ID): https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-key-terms.html
- Amazon SQS developer guide, exactly-once processing in FIFO queues: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-exactly-once-processing.html
- Amazon SQS developer guide, FIFO delivery logic: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-understanding-logic.html
- Amazon SQS developer guide, high throughput for FIFO queues: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/high-throughput-fifo.html
- Amazon SQS developer guide, message quotas (FIFO throughput, retention): https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-messages.html
- Amazon SQS developer guide, visibility timeout: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html
- Amazon SQS developer guide, dead-letter queues: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html
- Amazon SQS developer guide, short and long polling: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-short-and-long-polling.html
- AWS SDK for PHP v3, SQS `sendMessage`: https://docs.aws.amazon.com/aws-sdk-php/v3/api/api-sqs-2012-11-05.html
- AWS SDK for JavaScript v3, `ReceiveMessageCommand`: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/sqs/command/ReceiveMessageCommand
- Redis docs, write-behind caching: https://redis.io/docs/latest/operate/oss_and_stack/stack-with-enterprise/deprecated-features/gears-v1/python/recipes/write-behind/
- MySQL 8.0 server error reference, error 1062 `ER_DUP_ENTRY`: https://dev.mysql.com/doc/mysql-errors/8.0/en/server-error-reference.html
