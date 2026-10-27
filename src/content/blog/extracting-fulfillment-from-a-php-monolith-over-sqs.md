---
title: "Extracting fulfillment from a PHP monolith over SQS"
kind: case-study
status: published
date: 2026-09-24
order: 0
lede: Fulfillment came out of a PHP monolith piece by piece, over the SQS queue it already had. FIFO only dedupes sends, so the consumer still has to be idempotent.
tags: [architecture, sqs, redis]
cover: /img/blog/event-driven.svg
coverAlt: A monolith block with one empty dashed slot, and the fulfillment piece standing on its own across an SQS FIFO queue.
---

## Situation

Every order state change in the delivery product shipped in the same deploy as everything else. Fulfillment was one more component inside a PHP/Laravel monolith, so changing how an order moved meant releasing the whole application.

The product had 100K daily users, and every order moved through kitchen, driver and delivery in real time. I had already built the real-time order service, on Node.js and Socket.IO, which consumed order state changes from the monolith over SQS and pushed them to mobile and web clients. So one part of the system already lived outside the monolith. Fulfillment was still inside.

The team was six people. The tidy answer was a full event-driven rewrite of fulfillment. Shipping it meant months of running two partially consistent systems with feature work frozen until they converged, and a team of six could not stop shipping that long.

Martin Fowler's article on the strangler fig pattern puts it in one line: "Replacing a serious IT system takes a long time, and the users can't wait for new features."

The answer I would defend has two halves. Extract incrementally over the queue the monolith already has, and make the consumer idempotent and version-guarded, because a FIFO queue's exactly-once promise stops at the receive side.

## Decision

I took fulfillment out piece by piece instead. It became a standalone Node.js/Express service, decomposed out of the monolith into an event-driven architecture, with state changes passing over an AWS SQS FIFO queue behind a REST API contract. Hot order state was served from Redis in a write-behind cache with MySQL behind it, which kept status fan-out off the transactional path.

### The monolith already had a queue

A companion article on Fowler's site names the move underneath every strangler fig, event interception, and advises reusing existing integration points as seams. It is the boring part of the pattern, and I think the useful one. A second consumer on a queue the monolith already writes to costs the legacy code far less than a new integration. Legacy code you do not have to touch is legacy code you cannot break.

![The fulfillment service joins the monolith's existing SQS FIFO queue as a second consumer, beside the real-time order service.](diagram:fulfillment-strangler)

The harder question is ownership. The same article says redirecting writes made the new service the system of record, because the legacy store was no longer updated. Every piece of state in an extraction has that moment. Before it, the new service is a reader that may lag. After it, the monolith is the reader. The bugs I would look for first live in fields where nobody wrote down which side of that moment they are on.

### FIFO dedupes sends, not processing

Each FIFO message carries a deduplication ID, set by the producer or derived from a SHA-256 hash of the body, and copies sent with the same ID within the 5-minute deduplication interval are delivered once. A monolith that times out on `SendMessage` and retries does not put the event on the queue twice.

Messages that share a message group ID are handed out one at a time in strict order, and different groups have no order between them, which is where the parallelism comes from.

![Two order-id message groups on one FIFO queue: strict order inside each, none across them, and a retried send inside five minutes dropped.](diagram:fulfillment-fifo-groups)

AWS calls this exactly-once processing, and I think the name promises more than the mechanism. Deduplication guards the send side, but the receive side still runs on a lease: a received message is hidden for the visibility timeout and comes back if nobody deletes it. The visibility timeout page says so for FIFO queues too: "there's no absolute guarantee that a message won't be delivered more than once during the visibility timeout period."

That leaves a gap no queue setting closes. A consumer can commit its database change and die before `DeleteMessage`, and the message comes back for another attempt. So the consumer still has to be idempotent. FIFO is a reason to see fewer duplicates, not a reason to handle none.

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

The key is the `event_id` from the message body, not the SQS `MessageId`. A send retried after the deduplication interval is a second message, with its own `MessageId` and the same meaning, so keying on `MessageId` would wave it through. And each event carries the order's whole new status and a version. A state you can compare is safer than a command like "advance one step" that you have to replay in order.

The consumer, in TypeScript with `mysql2`:

```ts
import mysql from "mysql2/promise";

type FulfillmentEvent = {
  eventId: string;
  orderId: number;
  status: "preparing" | "ready" | "picked_up" | "delivered";
  version: number;
};

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

export async function apply(event: FulfillmentEvent): Promise<void> {
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
```

The `processed_events` row commits in the same transaction as the state change. If the process dies after `COMMIT` and before `DeleteMessage`, the redelivered copy hits the primary key, rolls back and is deleted. If it dies before `COMMIT`, neither row exists and the retry applies the change once.

![Commit, crash before delete, redelivery after the visibility timeout, and the second attempt stopped by the primary key.](diagram:fulfillment-redelivery)

The receive loop deletes a message only after `apply()` succeeds, and a `failedGroups` set skips the rest of a group once one event fails, because a single receive can return up to 10 messages from one group. `processed_events` grows forever unless rows older than the queue's retention period, 14 days at most, are pruned.

### Strict order is not commit order

SQS can only preserve the order it is given, and with several producers on one group the docs say it keeps arrival order. Two PHP requests that change the same order can commit in one sequence and reach `SendMessage` in the other, and SQS will faithfully preserve the wrong one.

A dead-letter queue breaks order too: a redrive delivers a poisoned event after the newer ones that went through without it. The version guard covers both cases, because a late `picked_up` after `delivered` matches no row and changes nothing.

For an order state machine I would keep the version column even on FIFO. It is the one guard here that lives in your own database, where you can read it at two in the morning when an order looks wrong.

## Trade-off

Incremental extraction bought continuous shipping and paid for it with a living seam: the monolith and the service had to keep agreeing on the contract, on both sides, every week. Fowler says people often balk at building that transitional code, and argues the gradual approach's lower risk and earlier value outweigh it. I agree. Transitional code is the code nobody wants to own, so decide who owns it before it exists.

Consistency windows were the other cost, and this design stacked two. One is the queue, where the monolith and the service disagree until the event is applied. The other is the cache. The Redis docs describe a write-behind cache as syncing changed data to the backing database asynchronously, so Redis holds the newest order state before MySQL does, and anything reading MySQL directly can be looking at the past. The case I would test first is a crash between the cache write and the sync.

Incremental extraction is the wrong call when there is no seam. If the component shares tables and transactions with everything around it, a queue just turns one transaction into two with a gap between them, and the project spends its life on the gap. It is also wrong when the team can genuinely afford the freeze, which is rarer than people admit and was not our case. My bias is that a team of six starts from the incremental path and needs a strong argument to leave it.

## Outcome

Fulfillment ran as a standalone service while the rest of the product kept shipping. Nobody froze feature work to get there, which was the point. I also moved the real-time order service to TypeScript, so payload mismatches failed at compile time, though the types still end at the PHP edge.

The queue type, the idempotency table and the version column all follow from one list: every piece of state the new service touches, which side is the system of record for it this week, and what a reader on the other side does when it is behind. Without that list they are guesses that happen to compile.

## Sources

- Martin Fowler, Strangler Fig Application: https://martinfowler.com/bliki/StranglerFigApplication.html
- Ian Cartwright, Rob Horn and James Lewis, Event Interception: https://martinfowler.com/articles/patterns-legacy-displacement/event-interception.html
- Amazon SQS developer guide, exactly-once processing in FIFO queues: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-exactly-once-processing.html
- Amazon SQS developer guide, FIFO delivery logic: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-understanding-logic.html
- Amazon SQS developer guide, visibility timeout: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html
- Redis docs, write-behind caching: https://redis.io/docs/latest/operate/oss_and_stack/stack-with-enterprise/deprecated-features/gears-v1/python/recipes/write-behind/
