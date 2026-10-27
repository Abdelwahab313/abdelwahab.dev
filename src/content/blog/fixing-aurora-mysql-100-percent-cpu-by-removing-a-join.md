---
title: "Fixing 100% CPU on Aurora MySQL by removing a join"
kind: note
status: published
date: 2026-09-17
order: 3
lede: A status broadcast made about a thousand queries, each estimated at 7 million rows, and pinned Aurora at 100% CPU. The fix was a dropped join, not an index.
tags: [aurora, mysql, performance]
cover: /img/blog/aurora.svg
coverAlt: One broadcast box fanning about a thousand calls into an Aurora database cylinder whose CPU bar is full at 100%.
---

## Aurora at 100% CPU, and everything queued behind it

Aurora MySQL sat at 100% CPU and stayed there. Requests that had been fine started queuing, and the whole product felt it.

One endpoint was behind it: a status broadcast that pushed state out to a lot of clients. Each time it ran, it called the database about a thousand times, and `EXPLAIN` estimated that each call would examine about 7 million rows.

The fix was two changes and no new hardware. Getting there meant refusing three fixes that looked faster.

The broadcast's cost was in the multiplication, and multiplication is hard to see in application code. A query that reads a bit more than it needs looks fine in review. A caller that issues one query per unit of work looks fine in review. Put them together and run them on every broadcast, and the database pays the product of the two.

![One status broadcast issued about a thousand database calls, and the EXPLAIN estimate for each call was about 7 million rows examined. The product of the two is what pinned Aurora MySQL at 100% CPU and queued everything else behind it.](diagram:aurora-fan-out)

## Three fixes that were all guesses

The instinct was to tune: add an index, raise the instance size, cache harder. All three were guesses, because I had not yet looked at what the query asked the database to do.

An index does nothing if the query is not using one, and without the plan you do not know which index would change anything.

A bigger instance buys time by hiding the cause. Performance Insights draws a Max vCPU line from the instance's vCPU count, and when there are more processes than vCPUs, they queue. That, I think, is the queue the rest of the product was standing in. A larger instance raises the line, and a broadcast whose load scales with its call count grows back into it. When load sits above the line and the main wait is CPU, AWS lists three remedies: throttle connections, tune the high-CPU SQL, or move to a larger instance class. I would take them in that order, and the third only after the first two.

A cache is a real design for status fan-out. At a previous job I served hot order state from Redis with MySQL behind it, to keep that fan-out off the transactional path. Bolted on mid-incident, though, a cache would have hidden a query I had not read yet, and handed me a second copy of the status to keep fresh.

I also could not take the broadcast down. Clients needed fresh status, so the database had to recover with the feature still running.

## Fast, frequent queries never reach the slow log

The MySQL slow query log records statements that run longer than `long_query_time`, and the default is 10 seconds. A statement can take a fraction of that, run about a thousand times per broadcast, and never appear in the log while it keeps the CPU pinned.

The Performance Schema sees frequency as well as cost. Its per-digest summary reduces every statement to a shape and keeps a call count and running totals for each one:

```sql
SELECT DIGEST_TEXT,
       COUNT_STAR                             AS calls,
       ROUND(SUM_ROWS_EXAMINED / COUNT_STAR)  AS rows_examined_per_call,
       ROUND(SUM_ROWS_SENT / COUNT_STAR)      AS rows_sent_per_call,
       QUERY_SAMPLE_TEXT
FROM performance_schema.events_statements_summary_by_digest
WHERE DIGEST IS NOT NULL
ORDER BY SUM_ROWS_EXAMINED DESC
LIMIT 10;
```

Dividing by `COUNT_STAR` separates a statement that is expensive from one that is merely frequent; the broadcast query was both. Rows sent per call sits next to rows examined per call on purpose, because the gap between them is what the decision later in this post turns on. `QUERY_SAMPLE_TEXT` gives a real statement from that digest to run `EXPLAIN` on.

## An estimated 7 million rows to send one back

I cannot show the real query, so here is a reconstruction with made-up names: a status row read by primary key, joined on an indexed column to a much larger history table to derive one value for the payload.

```sql
EXPLAIN
SELECT b.id, b.status, b.updated_at,
       MAX(e.created_at) AS last_event_at
FROM batches AS b
JOIN batch_events AS e ON e.account_id = b.account_id
WHERE b.id = 42
GROUP BY b.id\G
```

```text
*************************** 1. row ***************************
           id: 1
  select_type: SIMPLE
        table: b
   partitions: NULL
         type: const
possible_keys: PRIMARY
          key: PRIMARY
      key_len: 8
          ref: const
         rows: 1
     filtered: 100.00
        Extra: NULL
*************************** 2. row ***************************
           id: 1
  select_type: SIMPLE
        table: e
   partitions: NULL
         type: ALL
possible_keys: idx_account
          key: NULL
      key_len: NULL
          ref: NULL
         rows: 7330000
     filtered: 50.00
        Extra: Using where
```

Four columns carry the story. `type: ALL` is a full table scan. `possible_keys` names an index the optimizer could have used, and `key: NULL` says it chose not to. `rows` is MySQL's estimate of rows to examine, and the manual's rule of thumb is that its product across the plan approximates the rows the whole query examines. Here the outer side is one row, so the product is the scan: an estimated 1 times about 7 million, on every call.

![The plan before and after. Before, one batches row read by primary key drives a full scan of batch_events, an estimated 7 million rows, to send one row back. After the join is dropped the same row is read once and the history table is not touched.](diagram:aurora-join-shape)

`rows` is an estimate, but `type: ALL` and `key: NULL` are the plan the optimizer chose, and against a one-row result an estimate off by a factor of ten still points at the same fix. For real counts, `EXPLAIN ANALYZE` runs the statement, so on a pinned writer, run it against a reader's instance endpoint.

## An index makes the scan cheaper, not smaller

Using `idx_account`, the join would be `ref`, which reads all rows with matching index values, and the manual calls it "a good join type" if the key matches only a few rows. When the join needs a large share of the table, an index turns one scan into a very large number of lookups. The manual lists this among the causes of full scans: MySQL calculates that a table scan is faster. That is the reconstruction, with `idx_account` in `possible_keys` and unused. A covering index, shown as `Using index` in the plan, would make each row cheaper to read and would still read every one of them.

The digest numbers from earlier make this decision. When rows examined per call is far above rows sent and the `WHERE` clause is selective, the query reads rows it then throws away, and an index is the fix, a covering one if the select list is small. When rows examined is far above rows sent but the query genuinely needs the set, as an aggregate over a large history does, no index will shrink it, so stop asking for those rows: drop the join, or move the value it computes somewhere cheaper to read. When rows examined is close to rows sent but `calls` is enormous, the query is fine and the caller is the problem. I read the broadcast as the second case with the call count of the third, which is why it took two changes.

So the useful question was whether the broadcast needed those rows at all. It did not.

## Dropping the join and throttling the caller

First, I dropped the join that forced the scan and let the broadcast read only the rows it needed. In the reconstruction that leaves `SELECT id, status, updated_at FROM batches WHERE id = 42`, the same `const` lookup as the plan's first row: every part of the primary key compared to a constant, at most one row, read once.

What the payload gives up is whatever the join existed to compute; in the reconstruction, `last_event_at`. Whether a value like that can go is a product question as much as a database one. Asked with the plan in hand, it is a much shorter conversation.

The second change was the caller. I throttled it so it could not fan out a thousand times in a burst. Calls dropped from about a thousand to about a hundred per broadcast.

![Database calls per broadcast, before and after throttling the caller: roughly a thousand down to about a hundred.](diagram:aurora-calls-per-broadcast)

Throttling had a visible cost: some clients got a slightly staler broadcast. That was the trade, freshness for a subset in exchange for a database that stayed reachable for everyone.

My view is that a broadcast's database work should follow how often the state changes, not how often someone gets told about it. When those two rates are coupled, every new client is new load on the database, and the product's capacity is set by its most talkative feature.

| | Before | After |
|---|---|---|
| Aurora MySQL CPU | 100%, sustained | back to baseline |
| Database calls per broadcast | about 1,000 | about 100 |
| Rows examined per call, `EXPLAIN` estimate | about 7 million | join that forced the scan dropped |
| Broadcast freshness | fresh for every client | slightly staler for some clients |

The feature stayed up, with no instance resize and no new cache layer. To check the change, read `calls` and `rows_examined_per_call` in the digest table, and writer CPU with the `Maximum` statistic, because a five-minute average of a bursty broadcast can look healthy while every burst touches the ceiling.

## When the index or the bigger box is right

Throttling is the wrong call when the status is the product. If a client acting on a stale broadcast does something it cannot undo, slightly staler is not a trade you get to make on the client's behalf, so you fix the query and pay for the calls.

An index is the right call when the predicate is selective, and most of the time it is. A bigger instance is the right call when the load is real growth rather than waste, or as a few hours of cover while you read the plan. I would not object to resizing in the middle of an incident. I would object to closing the incident on it.

## Sources

- MySQL 8.0 Reference Manual, EXPLAIN Output Format: https://dev.mysql.com/doc/refman/8.0/en/explain-output.html
- MySQL 8.0 Reference Manual, EXPLAIN Statement: https://dev.mysql.com/doc/refman/8.0/en/explain.html
- MySQL 8.0 Reference Manual, Avoiding Full Table Scans: https://dev.mysql.com/doc/refman/8.0/en/table-scan-avoidance.html
- MySQL 8.0 Reference Manual, The Slow Query Log: https://dev.mysql.com/doc/refman/8.0/en/slow-query-log.html
- MySQL 8.0 Reference Manual, Statement Summary Tables: https://dev.mysql.com/doc/refman/8.0/en/performance-schema-statement-summary-tables.html
- Amazon Aurora User Guide, Maximum CPU: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/USER_PerfInsights.Overview.MaxCPU.html
