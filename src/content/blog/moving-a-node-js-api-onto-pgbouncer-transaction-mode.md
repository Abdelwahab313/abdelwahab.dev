---
title: "Moving a Node.js API onto PgBouncer transaction mode"
kind: note
status: published
date: 2026-11-02
lede: Pooled connections remember their last SET. Under PgBouncer transaction mode the transaction is the only thing you own, so scope the tenant to it.
tags: [postgres, pgbouncer, node]
cover: /img/blog/moving-a-node-js-api-onto-pgbouncer-transaction-mode.svg
coverAlt: "Six client lines converge on a PgBouncer box, which fans out as two accent arrows to two highlighted backend boxes labelled two backends, one transaction each. Labels: 50 clients, PgBouncer, 2 backends."
---

## Three quarters of the request is the handshake

The app opens a connection per request. The handler runs `new Client()`, `connect()`, one query, `end()`. It reads tidy and nothing is ever left open. I timed that loop on my laptop against Docker, 300 runs of `select 1`:

```js
const t0 = performance.now();
const c = new Client(direct); await c.connect();
const t1 = performance.now();
await c.query('select 1'); await c.end();
```

The whole request took about 2 ms at the median, and the connect was about three quarters of it. Postgres forks a backend process for every new connection, the client authenticates, and only then does the query go. The same query through a `pg.Pool` with the default `max` of 10 came back in under a tenth of a millisecond, and the checkout from the pool was too small for `performance.now()` to register.

![Median time for one select 1 on my laptop. A fresh connection per request: about 2 ms, most of it the connect. A connection checked out of pg.Pool: under a tenth of a millisecond.](diagram:pgbouncer-connect-cost)

## The pool keeps the connection, and the connection keeps its state

`pg.Pool` holds up to `max` clients open and lends them out. `idleTimeoutMillis` closes one after ten seconds idle by default. Two things come with that.

Connections now scale with processes. Every Node process holds its own pool, so each replica you add is another `max` backends on the database when busy. Fifty idle clients connected straight to Postgres were fifty backends in `pg_stat_activity`, one each.

And a connection remembers. `SET`, `set_config` with `is_local` false, a temporary table, a named prepared statement: all of it lives on the server session, and the session lives as long as the connection. With a pool, the connection that ran one request runs the next, and whatever the first left behind is still there. A multi-tenant app that scopes rows with `set_config('app.tenant_id', ...)` behind a row-level-security policy leans on exactly that.

## PgBouncer hands a backend out per transaction

PgBouncer sits between the processes and Postgres and holds a small pool of real connections. In `pool_mode = session` a backend is "released back to pool after client disconnects", which saves nothing per process. In `pool_mode = transaction` it is "released back to pool after transaction finishes". A client idle between transactions holds no backend at all.

| Fifty clients | Backends in `pg_stat_activity` |
|---|---|
| Straight to Postgres, idle | 50 |
| Through PgBouncer with `default_pool_size = 2`, idle | 1 |
| Through PgBouncer, all fifty running `pg_sleep(0.05)` at once | 2 |

The price is on the same docs page. "When transaction pooling is used, the `server_reset_query` is not used", and `SET` changes "leak to other clients sharing the server connection, unless `server_reset_query_always` is used". Everything the connection remembers is now shared between whichever clients land on it, and nothing wipes it between them.

## A pool of two finds the leak in twenty rounds

To watch it happen I ran PgBouncer with a pool small enough that sharing is certain, and connected as a plain role. The Postgres docs say "superusers and roles with the BYPASSRLS attribute always bypass the row security system", so a test as `postgres` would have shown nothing.

```ini
[pgbouncer]
pool_mode = transaction
default_pool_size = 2
max_client_conn = 500
max_prepared_statements = 0
```

`items` has 5000 rows for tenant `acme` and 5000 for `globex`, under a policy `tenant_id = current_setting('app.tenant_id', true)`. Client A sets the tenant and counts items. Client B never sets anything and runs `select current_setting('app.tenant_id', true), (select count(*) from items)`. Twenty rounds, fresh clients each round.

With `set_config('app.tenant_id', 'acme', false)`, session scope, B saw tenant `acme` and 5000 rows in 20 of 20 rounds. B is a request for some other tenant, or for none, reading acme's data because a backend that served acme was handed to it.

With `BEGIN`, `set_config(..., true)`, the count, `COMMIT`, B saw `acme` in 0 of 20 rounds and read 0 rows.

![Request A sets app.tenant_id to acme on backend 1 and its transaction ends. Request B lands on backend 1 and reads 5000 rows it was never scoped to, in 20 of 20 rounds with session-scoped set_config. Then the same two requests with set_config(..., true): the label on backend 1 clears at COMMIT, B lands on it and reads 0 rows, in 0 of 20 rounds.](video:pgbouncer-connections-remember)

My first run was wrong in a useful way. I ran the session-scope rounds before the transaction-scope rounds on the same PgBouncer, and the transaction-scope rounds leaked too, 20 of 20. Both backends still carried `acme` from the earlier rounds, no reset query ever ran, and nothing short of restarting PgBouncer cleaned them. That is the whole post in one sentence: a session setting stays on a backend for the life of that backend, whoever holds it now.

## Every transaction starts with its tenant

The fix in Node is one helper. Tenant-scoped reads go through it, and bare `pool.query` is kept for queries that need no tenant, because node-postgres sends each `pool.query` on whichever client is free and "transactions within PostgreSQL are scoped to a single client".

```js
export async function withTenant(pool, tenant, fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenant]);
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
```

The third argument to `set_config` is `is_local`: "If is_local is true, the new value will only apply during the current transaction." PgBouncer releases the backend when the transaction finishes, which is the moment the setting dies, so the next client inherits nothing.

The same mechanism has a trap. In the leak test, A's own next statement after its `COMMIT` saw 0 rows. No error, a count of zero. A handler that sets the tenant in one transaction and then runs a plain query afterwards gets every row filtered, because `current_setting` now returns null and the policy fails closed. That is the safety net and the silent failure mode at once: wrong rows never leave, and an empty page looks like a frontend bug for an afternoon.

## Named prepared statements land on someone else's backend

node-postgres caches a plan when you pass `name`: "the query execution plan will be cached on the PostgreSQL server on a per connection basis". Per connection is the problem, because through PgBouncer the connection the client holds is not the backend that runs the statement.

```js
await pool.query({
  name: 'items-by-tenant',
  text: 'select count(*) from items where tenant_id = $1',
  values: ['acme'],
});
```

Eighty calls in waves of eight through a `pg.Pool` of eight, with `max_prepared_statements = 0`: 53 of 80 failed with `prepared statement "items-by-tenant" already exists`. One client prepares the name on backend 1. A second client, which has never sent that name, is routed to backend 1, sends its own Parse, and Postgres refuses the duplicate. With `max_prepared_statements = 200` all 80 succeeded, because PgBouncer then tracks named statements per client and per backend.

That support is recent. PgBouncer 1.21.0 (October 2023) added "support for protocol-level named prepared statements", off by default. 1.24.0 (January 2025) turned it on with a default of 200. An older pooler, or an image that pins the setting to 0, breaks every `name` in the codebase on the day it goes in. The node-postgres docs say "most of your queries will likely not benefit much, if at all, from using prepared statements", and I agree. Drop `name` unless you have measured the gain, or confirm the pooler is 1.24 or later before the first deploy.

## Spending the headroom on parallel reads

A dashboard request needs the tenant's plan first, a 5 ms gate, then recent items, totals and label counts. I stood the queries in with `pg_sleep` at 5, 40 and 15 ms, each in its own `withTenant`, 30 runs against a pool of ten.

```js
const plan = await withTenant(pool, tenant, planFor);
const [recent, totals, labels] = await Promise.all([
  withTenant(pool, tenant, recentItems),
  withTenant(pool, tenant, totalsFor),
  withTenant(pool, tenant, labelCounts),
]);
```

One after another the median was about 110 ms. Gate first, then `Promise.all` for the other three, about 60 ms. The sleeps add up to 65 ms, and the rest is `BEGIN`, `set_config` and `COMMIT` round trips, about 11 ms per transaction on this Docker loopback. Through PgBouncer with a pool of two the medians were the same, I think because the two short queries fit inside the 40 ms one on the other backend.

![Waterfall of the four queries. Sequential lane: plan, recent, totals, labels one after the other, median about 110 ms. Parallel lane: plan, then recent, totals and labels overlapping, median about 60 ms.](video:pgbouncer-sequential-vs-parallel)

The cost is connections. Three parallel queries hold three pooled connections for the length of the longest, so `max` has to cover concurrency per request times requests in flight, and through PgBouncer they queue behind `default_pool_size`. `Promise.all` also rejects on the first failure while the siblings keep running. Node has no `asyncio.TaskGroup`, and `pg` cannot cancel a query already on the wire from an `AbortSignal`, so the surviving transactions hold their connections until they finish. On a 40 ms query that is nothing. On a 20 s report it is a connection the request has already given up on.

## Put the rule where every handler already goes

The leak needed every handler to remember to set a tenant inside a transaction, and a rule that lives in every handler is one new handler away from broken. Moving it into `withTenant`, the function every tenant-scoped read already calls, is what I would defend in a review: correctness that depends on someone remembering belongs in the code path, not in a convention.

The other thing I would keep is the ini file above. PgBouncer with a pool of two in the test lane showed the leak in twenty rounds on a laptop. Production runs a pool of twenty, and the same bug arrives as one tenant's row in another tenant's export, months later, with no round counter to point at.

## Sources

- PgBouncer config docs, `pool_mode`, `default_pool_size`, `server_reset_query`, `max_prepared_statements`: https://www.pgbouncer.org/config.html
- PgBouncer changelog, 1.21.0 and 1.24.0 on prepared statements: https://www.pgbouncer.org/changelog.html
- node-postgres docs, Pool: https://node-postgres.com/apis/pool
- node-postgres docs, Queries, the `name` option: https://node-postgres.com/features/queries
- Postgres docs, `set_config` and `is_local`: https://www.postgresql.org/docs/current/functions-admin.html
- Postgres docs, row security policies: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- Harsis Yadav, "Connections Have Memory", the walk-through that prompted this post, in Python: https://harsis.dev/blog/posts/pooling-and-parallel-reads-from-traces
- Measurements: my scripts on Node 22 against Postgres 17 and PgBouncer 1.26 in Docker on macOS, shown in part above.
