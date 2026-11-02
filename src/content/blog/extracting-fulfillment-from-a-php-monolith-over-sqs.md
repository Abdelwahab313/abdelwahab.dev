---
title: "Extracting fulfillment from a PHP monolith over SQS"
kind: case-study
status: published
date: 2026-09-24
order: 0
lede: Fulfilment moved into the order service over the SQS FIFO queue it already consumed. FIFO dedupes sends, so the consumer still has to be idempotent.
tags: [architecture, sqs, redis]
cover: /img/blog/event-driven.svg
coverAlt: The monolith with one empty dashed slot, and fulfilment sitting inside the order service across an SQS FIFO queue.
---

## Situation

Every change to how an order moved through kitchen, driver and delivery shipped in the same deploy as everything else. Fulfilment lived inside the monolith, so changing one state transition meant releasing the whole application.

The product had around 100K daily active users and about 500K orders a month. I had already built the order service, on Node.js and Socket.IO, which consumed order state changes from the monolith over SQS and pushed them to the mobile and web clients. It ran as a single instance, with hot order state in Redis written behind to PostgreSQL. One part of the order flow already lived outside the monolith. Fulfilment did not.

The team was six people. The tidy answer was a full event-driven rewrite. I rejected it, because it would have frozen feature work for months and left the monolith and the new system inconsistent for a long time. Six people could not stop shipping that long.

Martin Fowler's article on the strangler fig pattern puts it in one line: "Replacing a serious IT system takes a long time, and the users can't wait for new features."

## Decision

I moved fulfilment into the order service piece by piece. Order events kept arriving over the SQS FIFO queue the service already consumed. Same-day orders came over REST, by a call from the monolith on confirmation, and the service processed each one and routed it to the route's driver before the route started. Most orders were scheduled in advance, so that call carried only the orders that could not wait. The monolith stayed the system of record for orders. The order service kept hot order state and a snapshot of the operating day in Redis, written behind to PostgreSQL, which kept status fan-out off the monolith's transactional path. The hard part was on the receive side, because a FIFO queue's exactly-once promise stops there.

### The monolith already had a queue

A companion article on Fowler's site names "event interception" as the move underneath every strangler fig, and advises reusing existing integration points as seams. The seam here was the queue the order service already consumed. Fulfilment joined that consumer, so the monolith's event path did not change and could not regress. The only new integration was the REST call for same-day orders.

![The monolith sends order events over an SQS FIFO queue to the order service, one box holding live order status, which consumes the queue, and fulfilment, which moves in. A dashed REST arrow carries same-day orders on confirmation.](diagram:fulfillment-strangler)

The harder question is ownership. The same article says redirecting writes made the new service the system of record, because the legacy store was no longer updated. Before that moment the new service is a reader that may lag, and after it the monolith is. Fulfilment state crossed that line into the order service and order state did not. The bugs I look for first live in fields where nobody wrote down which side they are on.

### FIFO dedupes sends, not processing

Each FIFO message carries a deduplication ID, set by the producer or derived from a SHA-256 hash of the body, and copies sent with the same ID within the 5-minute deduplication interval are delivered once. A monolith that times out on `SendMessage` and retries does not put the event on the queue twice.

Messages that share a message group ID are delivered in strict order, and different groups have no order between them, which is where the parallelism comes from.

![Two order-id message groups on one FIFO queue, strict order inside each, none across them, and a retried send inside five minutes dropped.](diagram:fulfillment-fifo-groups)

AWS calls this exactly-once processing, and I think the name promises more than the mechanism. Deduplication guards the send side, but the receive side still runs on a lease. A received message is hidden for the visibility timeout and comes back if nobody deletes it. The visibility timeout page says so for FIFO queues too: "there's no absolute guarantee that a message won't be delivered more than once during the visibility timeout period."

That leaves a gap no queue setting closes. A consumer can commit its database change and die before `DeleteMessage`, and the message comes back for another attempt. So the consumer still has to be idempotent.

### One transaction for the event and the state

The cheapest idempotency key is one the producer already has. Here is the send from the monolith, with the AWS SDK for PHP, as a sketch rather than the service's code:

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

`$eventId` is generated once, when the state change is written, and reused if the send is retried. The group ID is the order id, because one order is the unit that needs strict sequence. The deduplication ID is the same `eventId` the consumer keys its own table on, so SQS and the database agree on what "the same event" means.

On the consumer side, two tables carry it:

```sql
CREATE TABLE processed_events (
  event_id   UUID        NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id)
);

CREATE TABLE fulfillment_orders (
  order_id BIGINT      NOT NULL,
  status   VARCHAR(32) NOT NULL,
  version  INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (order_id)
);
```

The key is the `event_id` from the message body, not the SQS `MessageId`. A send retried after the deduplication interval is a second message, with its own `MessageId` and the same meaning, so keying on `MessageId` would wave it through. And each event carries the order's whole new status and a version. A state you can compare is safer than a command you have to replay in order.

The service's data layer was Prisma. The sketch below uses `pg`, the node-postgres client, so the transaction boundary stays visible:

```ts
import { Pool } from "pg";

type FulfillmentEvent = {
  eventId: string;
  orderId: number;
  status: "preparing" | "ready" | "picked_up" | "delivered";
  version: number;
};

const db = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

export async function apply(event: FulfillmentEvent): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    try {
      await client.query(
        "INSERT INTO processed_events (event_id) VALUES ($1)",
        [event.eventId],
      );
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        await client.query("ROLLBACK");
        return; // applied before: a redelivery or a producer retry
      }
      throw err;
    }
    await client.query(
      `UPDATE fulfillment_orders
          SET status = $1, version = $2
        WHERE order_id = $3 AND version < $2`,
      [event.status, event.version, event.orderId],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
```

The `processed_events` row commits in the same transaction as the state change. If the process dies after `COMMIT` and before `DeleteMessage`, the redelivered copy hits the primary key, rolls back and is deleted. If it dies before `COMMIT`, neither row exists and the retry applies the change once.

![Commit, crash before delete, redelivery after the visibility timeout, and the second attempt stopped by the primary key.](diagram:fulfillment-redelivery)

The receive loop, not shown here, deletes a message only after `apply()` succeeds. Once one event fails, it skips the rest of that group, because a single receive can return up to 10 messages from one group. `processed_events` grows forever unless rows older than the queue's retention period, 14 days at most, are pruned.

The SQS consumer was the edge. Inside the service, BullMQ on Redis carried the fulfilment flow with the same idempotent consumers, retries with backoff and a dead-letter queue for jobs that still failed. I put alarms on the payment queue, and a job in the dead-letter queue was investigated before it was re-applied.

### Strict order is not commit order

SQS can only preserve the order it is given, and with several producers on one group the docs say it keeps arrival order. Two requests in the monolith that change the same order can commit in one sequence and reach `SendMessage` in the other, and SQS will faithfully preserve the wrong one.

A dead-letter queue breaks order too, because a redrive delivers a failed event after the newer ones that went through without it. The `version < $2` check covers both cases, because a late `picked_up` after `delivered` carries a lower version and matches no row.

I keep the version column even on FIFO, because it is the one ordering guard that lives in your own database.

## Trade-off

Incremental extraction bought continuous shipping and paid for it with a living seam. The monolith and the order service had to keep agreeing on the message contract. Fowler says people often balk at building that transitional code, and argues the gradual approach's lower risk and earlier value outweigh it. I agree. The seam did bite, when the producer and the consumer drifted on a payload, and that is what pushed the service to TypeScript.

Consistency windows were the other cost, and this design stacked two. One is the queue, where the monolith and the service disagree until the event is applied. The other is the write-behind. The Redis docs describe a write-behind cache as syncing changed data to the backing database asynchronously, so Redis holds the newest order state before PostgreSQL does, and anything reading PostgreSQL directly can be looking at the past. The case I test first is a crash between the cache write and the sync.

Incremental extraction is the wrong call when there is no seam, because a queue then turns one transaction into two with a gap between them. It is also wrong when the team can afford the freeze, which was not our case.

## Outcome

Fulfilment ran inside the order service while the rest of the product kept shipping, and nobody froze feature work to get there. I also moved the service to TypeScript after the payload drift, so mismatches failed at compile time, though the types stopped at the monolith's edge and the version guard in the consumer stayed.

The queue type, the idempotency table and the version column all follow from which side is the system of record for each field and what a reader on the other side does when it is behind.

## Sources

- Martin Fowler, Strangler Fig Application: https://martinfowler.com/bliki/StranglerFigApplication.html
- Ian Cartwright, Rob Horn and James Lewis, Event Interception: https://martinfowler.com/articles/patterns-legacy-displacement/event-interception.html
- Amazon SQS developer guide, exactly-once processing in FIFO queues: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-exactly-once-processing.html
- Amazon SQS developer guide, FIFO delivery logic: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-understanding-logic.html
- Amazon SQS developer guide, visibility timeout: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html
- Redis docs, write-behind caching: https://redis.io/docs/latest/operate/oss_and_stack/stack-with-enterprise/deprecated-features/gears-v1/python/recipes/write-behind/
