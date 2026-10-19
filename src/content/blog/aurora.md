---
title: The status broadcast that pinned Aurora at 100% CPU
kind: note
status: published
date: 2026-09-17
order: 3
lede: A status broadcast made about a thousand database calls, each scanning 7 million rows, and pinned Aurora at 100% CPU. The fix was a dropped join, not an index.
tags: [aurora, mysql, performance]
cover: /img/blog/aurora.svg
coverAlt: One broadcast box fanning about a thousand calls into an Aurora database cylinder whose CPU bar is full at 100%.
---

## Aurora at 100% CPU, and everything queued behind it

Aurora MySQL sat at 100% CPU and stayed there. Requests that had been fine started queuing, and the whole product felt it, not just the feature behind the load.

One endpoint was behind it: a status broadcast that pushed state out to a lot of clients. Each time it ran, it called the database about a thousand times, and `EXPLAIN` estimated that each call would examine about 7 million rows.

The fix was two changes and no new hardware. Getting there meant refusing three fixes that looked faster.

## A broadcast that looked harmless

The broadcast read the current state and fanned it out. Nothing about that sounds expensive. A read, a fan-out, a payload per client.

The cost was in the multiplication, and multiplication is hard to see in application code. A query that reads a bit more than it needs looks fine in review. A caller that issues one query per unit of work looks fine in review. Put them together and run them on every broadcast, and the database pays the product of the two.

![One status broadcast issued about a thousand database calls, and the EXPLAIN estimate for each call was about 7 million rows examined. The product of the two is what pinned Aurora MySQL at 100% CPU and queued everything else behind it.](diagram:aurora-fan-out)

At that point all I had was a database pinned at full CPU and one caller running about a thousand queries a broadcast. I did not yet know why it mattered.

## Three fixes that were all guesses

The instinct was to tune: add an index, raise the instance size, cache harder. All three were guesses, because I had not yet looked at what the query asked the database to do.

An index does nothing if the query is not using one, and without the plan you do not know which index, on which column, would change anything.

A bigger instance buys time by hiding the cause. Performance Insights draws a Max vCPU line from the instance's vCPU count, and the docs put the mechanism plainly: one process runs on a vCPU at a time, and when there are more processes than vCPUs, they queue. That, I think, is the queue the rest of the product was standing in. A larger instance class raises the line. It does nothing to the broadcast, whose load grows with how often it runs and how many calls it makes, so it grows back into whatever ceiling you buy it. The same AWS page lists three remedies when load sits above the line and the main wait is CPU: throttle connections, tune the high-CPU SQL, or move to a larger instance class. I would take them in that order, and the third only after the first two.

A cache is a real design for status fan-out, not a bad idea in itself. At a previous job I served hot order state from Redis with MySQL behind it, to keep status fan-out off the transactional path. Bolted on mid-incident, though, a cache would have hidden a query I had not read yet, and handed me a second copy of the status to keep fresh.

I also could not take the broadcast down. Clients needed fresh status. The goal was to keep the system up for everyone, not to protect the database by breaking a feature.

## Fast queries never reach the slow log

Finding the query that burns the CPU is its own trap, because the usual tool is tuned for a different shape of problem.

The MySQL slow query log records statements that take longer than `long_query_time` seconds and examine at least `min_examined_row_limit` rows. The default `long_query_time` is 10 seconds. A statement can take a fraction of that, run about a thousand times per broadcast, and never appear in the log while it keeps the CPU pinned. Turning on `log_queries_not_using_indexes` closes part of the gap, since the server then logs statements that used no index for row lookups even when they finish under `long_query_time`.

Two places see frequency as well as cost. Performance Insights slices database load by top SQL, which shows which statements contribute most of the load even when no single execution is slow. Each per-second sample also records the host and the database user behind the session, and that is how you get from "this SQL" to "this service".

Inside the engine, the Performance Schema keeps a per-digest summary: every statement normalized to a shape, with a call count and running totals that are counted, not estimated. This is the query that finds the shape this post is about:

```sql
SELECT DIGEST_TEXT,
       COUNT_STAR                                AS calls,
       ROUND(SUM_ROWS_EXAMINED / COUNT_STAR)     AS rows_examined_per_call,
       ROUND(SUM_ROWS_SENT / COUNT_STAR)         AS rows_sent_per_call,
       SUM_NO_INDEX_USED                         AS calls_without_index,
       ROUND(SUM_TIMER_WAIT / 1000000000000, 1)  AS total_seconds,
       QUERY_SAMPLE_TEXT
FROM performance_schema.events_statements_summary_by_digest
WHERE DIGEST IS NOT NULL
ORDER BY SUM_ROWS_EXAMINED DESC
LIMIT 10;
```

Sort by rows examined, not by latency. Dividing by `COUNT_STAR` separates a statement that is expensive from one that is merely frequent; the broadcast query was both. Rows sent per call sits next to rows examined per call on purpose, because the gap between them is what the decision later in this post turns on. Performance Schema reports timer columns in picoseconds, hence the division by 10^12. `QUERY_SAMPLE_TEXT` holds a real statement the server saw for that digest, and the manual suggests exactly this use for it: take the sample and run `EXPLAIN` on it.

Two details make the table more useful than it first looks. `TRUNCATE TABLE performance_schema.events_statements_summary_by_digest` empties it, which turns running totals into a measurement window: truncate, let a known number of broadcasts run, read the counts. And when the table fills up, new statements land in a catch-all row with `DIGEST` = `NULL`; the `WHERE` clause keeps that bucket out of the ranking, but if it holds a large share of `COUNT_STAR` the ranking is not telling you the whole story. For a shortcut, the `sys` schema ships `sys.statements_with_full_table_scans`, the same digests filtered to statements that did full scans, with `exec_count` and `rows_examined_avg` already worked out.

## An estimated 7 million rows per call

I ran `EXPLAIN` on the broadcast query instead of guessing. It estimated 7 million rows examined per call. That is the optimizer's estimate, not a count, and it was enough to act on; why is further down.

I cannot show the real query or schema here. Below is a reconstruction of the shape, with made-up names: a status row read by primary key, joined to a much larger history table to derive one value for the payload. The `rows` value is set to the about 7 million the real `EXPLAIN` estimated; putting all of it on one table is this example's choice, not a claim about the real plan. I also gave the history table an index on the join column, to make a point about it further down.

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

Four columns carry the story. `type: ALL` is a full table scan. The manual rates it "normally not good" on the first table that is not `const`, which is where it sits here, and "usually very bad" anywhere else. `possible_keys` names an index the optimizer could have used, and `key: NULL` says it chose not to. `rows` is how many rows MySQL believes it must examine for that table, and the manual's rule of thumb is that the product of the `rows` column across the plan approximates how many rows the whole query examines. The rule follows from how MySQL runs a join, as nested loops: each row read from one table is passed into a loop over the next. Here the outer side is one row, so the product is the scan: an estimated 1 times about 7 million, on every call.

![The plan before and after. Before, one batches row read by primary key drives a full scan of batch_events, an estimated 7 million rows, to send one row back. After the join is dropped the same row is read once and the history table is not touched.](diagram:aurora-join-shape)

`rows` is an estimate. The manual says so for InnoDB and calls the values an educated guess from the join optimizer. I still treated it as decision-grade, for two reasons. The columns that carried the decision were not estimates: `type: ALL` and `key: NULL` are the plan the optimizer chose, and a full scan is a full scan whatever the row count turns out to be. And the number only had to be right to an order of magnitude. Set an estimate in the millions against a query that returns a single row, as the reconstruction does, and an estimate that is off by a factor of ten still points at the same fix. Precision would have changed the size of the problem, not its kind.

That number changed the problem. This was not a missing index. The query scanned and joined a large set every time it ran, about a thousand times per broadcast.

On an instance that is already pinned, how you get the plan matters. Plain `EXPLAIN` does not run the statement, so it costs almost nothing. If the statement is running right now you do not even need its text: `EXPLAIN FOR CONNECTION` returns the plan a connection is currently executing, given the `Id` from the process list. Looking at other sessions needs the `PROCESS` privilege, and it does not work for prepared statements.

```sql
SHOW PROCESSLIST;
EXPLAIN FOR CONNECTION 373;   -- 373 stands for an Id from the process list
```

`EXPLAIN ANALYZE` is the measured version. In MySQL 8.0.18 and later it reports actual time, actual rows and loop counts per iterator next to the estimates, and it gets them by running the statement. On a writer pinned by that statement, measuring means paying for one more execution. If you want counted rows, take them from a reader. AWS documents instance endpoints for diagnosis and tuning on one specific instance, so connect to a reader's instance endpoint rather than the cluster endpoint, and either run `EXPLAIN ANALYZE` there or count handler reads around a single execution:

```sql
FLUSH STATUS;
SELECT b.id, b.status, b.updated_at,
       MAX(e.created_at) AS last_event_at
FROM batches AS b
JOIN batch_events AS e ON e.account_id = b.account_id
WHERE b.id = 42
GROUP BY b.id;
SHOW SESSION STATUS LIKE 'Handler_read%';
```

`FLUSH STATUS` adds the session's counters to the global totals and resets the session values to zero; it needs the `FLUSH_STATUS` or `RELOAD` privilege. After the query, a large `Handler_read_rnd_next`, the manual's counter for reading the next row in the data file, means a table scan. A large `Handler_read_next` means an index range or index scan. The about 7 million in this post is the `EXPLAIN` estimate, not one of these counts.

## An index makes the scan cheaper, not smaller

This is the part that makes "just add an index" a guess rather than a fix.

The manual is precise about when an index lookup on a join pays off. A `ref` join reads all rows with matching index values, and it is "a good join type" if the key matches only a few rows. When the join genuinely needs a large share of the table, an index turns one scan into a very large number of index lookups, and the optimizer may decide the scan is cheaper. The manual lists that among the causes of full scans: when the matching values cover too large a part of the table, MySQL calculates that a table scan is faster. That is the situation the reconstruction shows, with `idx_account` sitting in `possible_keys` and going unused.

A covering index goes one step further. When every column the query needs is in one index, `EXPLAIN` shows `Using index` and MySQL reads the index tree without a second seek into the row. That makes each row cheaper to touch. It still touches every one of them. Once a query genuinely needs a set of rows, an index changes how they are read, not how many.

Read together, the digest numbers from earlier make this decision for you. When rows examined per call is far above rows sent per call and the `WHERE` clause is selective, the query reads rows it then throws away, and an index is the fix, a covering one if the select list is small. When rows examined is far above rows sent but the query genuinely needs the set, as an aggregate over a large history does, no index will shrink it, so the fix is to stop asking for those rows: drop the join, or move the value it computes somewhere cheaper to read. When rows examined per call is close to rows sent but `calls` is enormous, the query is fine and the caller is the problem. I read the broadcast as the second and the third at once, which is why it took two changes.

So the useful question was not how to read an estimated 7 million rows faster. It was whether the broadcast needed them at all. It did not. The data behind that join was not worth a full scan, a thousand times over.

## Dropping the join

Two changes, in order of impact. First, I dropped the join that forced the scan and let the broadcast read only the rows it needed.

In the reconstruction, that leaves a primary key lookup:

```sql
EXPLAIN
SELECT id, status, updated_at
FROM batches
WHERE id = 42\G
```

```text
*************************** 1. row ***************************
           id: 1
  select_type: SIMPLE
        table: batches
   partitions: NULL
         type: const
possible_keys: PRIMARY
          key: PRIMARY
      key_len: 8
          ref: const
         rows: 1
     filtered: 100.00
        Extra: NULL
```

`const` is what MySQL uses when every part of a primary or unique key is compared to a constant: at most one matching row, read once. There is nothing left to tune in that plan.

What the payload gives up is whatever the join existed to compute; in the reconstruction, `last_event_at`. Whether a value like that can go is a product question as much as a database one. Asked with the plan in hand, it is a much shorter conversation.

## Throttling the caller, at the price of freshness

The second change was the caller. I throttled it so it could not fan out a thousand times in a burst. Calls dropped from roughly a thousand to about a hundred per broadcast.

![Database calls per broadcast, before and after throttling the caller: roughly a thousand down to about a hundred.](diagram:aurora-calls-per-broadcast)

Throttling had a visible cost: some clients got a slightly staler broadcast. That was the trade. Freshness for a subset, in exchange for a database that stayed reachable for everyone.

My view is that a broadcast's database work should follow how often the state changes, not how often someone gets told about it. When those two rates are coupled, every new client is a new load on the database, and the system's capacity is set by its most talkative feature. Decoupling them is the fix that keeps working as the client count grows. Dropping the join took the scan out of each call; throttling made the number of calls stop tracking the fan-out.

## Before and after

| | Before | After |
|---|---|---|
| Aurora MySQL CPU | 100%, sustained | back to baseline |
| Database calls per broadcast | about 1,000 | about 100 |
| Rows examined per call, `EXPLAIN` estimate | about 7 million | join that forced the scan dropped |
| Broadcast freshness | fresh for every client | slightly staler for some clients |

The feature stayed up. No instance resize, no new cache layer, no guessing.

If you make a change like this, check it from two layers, because each one can fool you on its own. The database layer is the digest table: truncate it, let a known number of broadcasts run, and read `calls` and `rows_examined_per_call` for the statement you changed. The new `EXPLAIN` should show the plan you meant, `const` and one row in the reconstruction. The infrastructure layer is CPU on the writer over a window that spans the change, aggregated by role so a failover does not leave you graphing the wrong instance:

```sh
# example cluster name and window; choose a window that spans the change
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name CPUUtilization \
  --dimensions Name=DBClusterIdentifier,Value=my-cluster Name=Role,Value=WRITER \
  --start-time 2026-09-01T00:00:00Z \
  --end-time 2026-09-03T00:00:00Z \
  --period 300 \
  --statistics Maximum Average
```

Look at `Maximum` as well as `Average`. A broadcast is bursty, and a five-minute average can look healthy while every burst still touches the ceiling. If the two layers disagree, say calls are down but CPU is not, the disagreement is the next thing to investigate, not a rounding error.

## When the index or the bigger box is right

Throttling is the wrong call when the status is the product. If a client acting on a stale broadcast does something it cannot undo, slightly staler is not a trade you get to make on the client's behalf; you fix the query and pay for the calls.

An index is the right call when the predicate is selective, and most of the time it is. This broadcast was one query. Separately, I kept a running backlog of Aurora MySQL's worst queries and cleared it query by query: rewrote plans, added covering indexes and restructured hot reads, until CPU pressure stopped turning into incidents. Covering indexes earned their place on that list many times. They did not here, because here the query was asking for rows it did not need.

A bigger instance is the right call when the load is real growth rather than waste, or as a few hours of cover while you read the plan. I would not object to resizing in the middle of an incident. I would object to closing the incident on it.

## Read the plan before you buy the instance

Before changing anything on a database that is out of CPU, get two numbers for the top caller: rows examined per call, where `EXPLAIN`'s estimate will do, and calls per unit of work. Multiply them. If that product surprises you, no instance class will make it stop surprising you, and no index will either if the rows are ones the caller never needed. Every fix that worked here came from those two numbers.

## Sources

- MySQL 8.0 Reference Manual, EXPLAIN Output Format (`type`, `possible_keys`, `key`, `rows`, `filtered`, `Using index`, the `rows` product rule): https://dev.mysql.com/doc/refman/8.0/en/explain-output.html
- MySQL 8.0 Reference Manual, EXPLAIN Statement (`EXPLAIN ANALYZE` from 8.0.18, `FORMAT=TREE`): https://dev.mysql.com/doc/refman/8.0/en/explain.html
- MySQL 8.0 Reference Manual, Obtaining Execution Plan Information for a Named Connection (`EXPLAIN FOR CONNECTION`): https://dev.mysql.com/doc/refman/8.0/en/explain-for-connection.html
- MySQL 8.0 Reference Manual, Avoiding Full Table Scans: https://dev.mysql.com/doc/refman/8.0/en/table-scan-avoidance.html
- MySQL 8.0 Reference Manual, Nested-Loop Join Algorithms: https://dev.mysql.com/doc/refman/8.0/en/nested-loop-joins.html
- MySQL 8.0 Reference Manual, The Slow Query Log (`long_query_time` default, `log_queries_not_using_indexes`): https://dev.mysql.com/doc/refman/8.0/en/slow-query-log.html
- MySQL 8.0 Reference Manual, Statement Summary Tables (`events_statements_summary_by_digest`, `QUERY_SAMPLE_TEXT`, `TRUNCATE TABLE`, the `DIGEST` = `NULL` row): https://dev.mysql.com/doc/refman/8.0/en/performance-schema-statement-summary-tables.html
- MySQL 8.0 Reference Manual, Performance Schema Event Timing (picoseconds): https://dev.mysql.com/doc/refman/8.0/en/performance-schema-timing.html
- MySQL 8.0 Reference Manual, The statements_with_full_table_scans and x$statements_with_full_table_scans Views: https://dev.mysql.com/doc/refman/8.0/en/sys-statements-with-full-table-scans.html
- MySQL 8.0 Reference Manual, FLUSH Statement (`FLUSH STATUS`): https://dev.mysql.com/doc/refman/8.0/en/flush.html
- MySQL 8.0 Reference Manual, Server Status Variables (`Handler_read_rnd_next`, `Handler_read_next`): https://dev.mysql.com/doc/refman/8.0/en/server-status-variables.html
- Amazon Aurora User Guide, Maximum CPU: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/USER_PerfInsights.Overview.MaxCPU.html
- Amazon Aurora User Guide, Database load and top SQL (per-sample host and user): https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/USER_PerfInsights.Overview.ActiveSessions.html
- Amazon Aurora User Guide, Amazon Aurora endpoint connections (reader and instance endpoints): https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Overview.Endpoints.html
- Amazon Aurora User Guide, CloudWatch metrics for Aurora (`CPUUtilization` in `AWS/RDS`): https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.AuroraMonitoring.Metrics.html
- Amazon Aurora User Guide, CloudWatch dimensions for Aurora (`DBClusterIdentifier`, `Role`): https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/dimensions.html
- AWS CLI reference, `aws cloudwatch get-metric-statistics`: https://docs.aws.amazon.com/cli/latest/reference/cloudwatch/get-metric-statistics.html
