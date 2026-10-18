---
title: Atomic commands, racy decisions
kind: note
status: published
date: 2026-10-15
lede: Every Redis command is atomic. The check-then-write your app wraps around them is not, and that gap is how 100 units become 107 orders.
tags: [redis, lua, concurrency]
---

## 100 units, 107 orders

A Black Friday flash sale. One phone model, 100 units at the sale price, at most two per order. The stock counter lives in Redis under `sale:phone:stock`, and a fleet of app servers behind a load balancer decrements it.

The sale closes. You had 100 phones. The system accepted 107 reservations. Seven people paid for a phone that does not exist, and finance finds out three days later.

Here is the code that did it:

```java
int stock = Integer.parseInt(
    redisTemplate.opsForValue().get("sale:phone:stock")
);

if (stock > 0) {
    redisTemplate.opsForValue().decrement("sale:phone:stock");
    // reserve: charge the card, write the order row, send the email
}
```

It reads as correct. Read the stock, and if there is stock, take one. The bug is invisible at the level of a single request because it does not live inside either line. It lives between them.

## Redis kept every promise it made

"Redis is single-threaded, so it is safe" is where most explanations wave their hands. The distinction below is the whole article, so I want to be exact about it.

Redis executes commands on its main thread, driven by an event loop: `aeMain` and `aeProcessEvents` in `src/ae.c`, with each ready command handed to `processCommand` in `src/server.c`. Because that happens on one thread, any single command is atomic with respect to every other command. `GET` is atomic. `DECR` is atomic. The I/O threads added in Redis 6 only offload reading and writing sockets; command execution still funnels through the main thread.

So this holds: no two commands ever execute at the same time.

This does not hold: two commands your application issues back to back will run consecutively with nothing in between.

Between your `GET` and your `DECR`, another client's command can be scheduled. Two servers hitting the last unit at the same instant interleave like this:

```
1. Server A  GET  sale:phone:stock   -> 1
2. Server B  GET  sale:phone:stock   -> 1     both see 1
3. Server A  DECR sale:phone:stock   -> 0     A wins
4. Server B  DECR sale:phone:stock   -> -1    B takes a unit that is not there
```

Both requests passed `if (stock > 0)`, because both read `1` before either decremented. Redis executed all four commands correctly and in order. The counter ending at `-1` is the smoking gun: the check and the update were never one operation.

Redis did not break a promise. It kept every individual promise you asked for, and another request slipped into the gap between two of them. On a single machine you would guard that gap with a mutex. A fleet of app servers has no cheap shared mutex. Redis can be one, if you move the whole critical section inside it.

## Move the decision inside Redis

The fix is to stop sending two commands and send one thing that contains both steps: read the stock, decrement it if there is enough, and let nothing run in between.

Redis ships a Lua 5.1 interpreter compiled into the server. A script runs inside Redis, on the same main thread that processes commands. You send the logic once, Redis runs it to completion, and only then does the event loop pick up the next client. No command from anyone else lands in the middle.

The naive version decrements by one, which quietly assumes one phone per order. This sale allows two, so the script takes the quantity as an argument and checks before it decrements:

```lua
local stock = tonumber(redis.call('GET', KEYS[1]) or '0')
local qty   = tonumber(ARGV[1])

if stock >= qty then
    redis.call('DECRBY', KEYS[1], qty)
    return 1          -- reserved
end

return 0              -- sold out
```

From Java:

```java
private static final String RESERVE = """
    local stock = tonumber(redis.call('GET', KEYS[1]) or '0')
    local qty   = tonumber(ARGV[1])

    if stock >= qty then
        redis.call('DECRBY', KEYS[1], qty)
        return 1
    end
    return 0
    """;

Long reserved = redisTemplate.execute(
    new DefaultRedisScript<>(RESERVE, Long.class),
    List.of("sale:phone:stock"),      // KEYS
    String.valueOf(quantity)          // ARGV, 1 or 2 in this sale
);

if (reserved == 1L) {
    // the units are ours; do the slow work outside Redis
}
```

Three details in that script matter more than they look. `KEYS[1]` rather than a key string pasted into the script: declared keys are what Cluster uses to route the script, which comes back below. `or '0'`: a missing key returns Lua `false`, `tonumber(false)` is `nil`, and `nil >= qty` throws, so the default makes "key absent" mean "no stock". And `>=`, not `> 0`: the script has to be able to serve the whole request, not just confirm something is left.

The property that fixes the bug: the check and the update can no longer be separated.

## Where the atomicity comes from

Redis does not wrap scripts in a mutex or a transaction log. The atomicity is a consequence of the execution path, and knowing the path is what lets you reason about the edge cases later instead of memorizing them.

`EVAL` routes to `evalCommand`, then `evalGenericCommand()` in `src/eval.c` (the file was `scripting.c` before the Redis 7 refactor). That function compiles or fetches the cached script, prepares the run with `scriptPrepareForRun()`, and calls `luaCallFunction()`, which does a `lua_pcall` into the interpreter. The part that matters is where this happens: `evalGenericCommand` is invoked from the normal dispatch path, `processCommand` then `call`, on the main thread. While `lua_pcall` runs, the event loop is not dispatching anything else. There is no yield point. When the script calls `redis.call('GET', ...)`, that goes through `luaRedisGenericCommand()` in `src/script_lua.c`, which builds a synthetic argv and calls `scriptCall()` in `src/script.c`. The nested command executes on the same thread, inline, with no opportunity for another client's command to appear.

So the guarantee reads: a script's effects have either not happened yet or have already happened. There is no observable state in between.

One boundary, stated plainly because it bites later: this is isolation, not a transaction. Redis serializes scripts. It does not roll them back. If a script writes key A and then errors on key B, A stays written and the caller gets an error. Design multi-key scripts so that a failure halfway through leaves a state you can reconstruct.

Two more things fall out of the source. Scripts run against an internal client (`lctx.lua_client`, flagged `CLIENT_SCRIPT` and `CLIENT_DENY_BLOCKING`), so blocking commands like `BLPOP` are rejected inside a script; a script must never block the one thread everyone shares. And nested commands go through the same checks a normal client would: arity, ACLs, read-only state, OOM state (`scriptVerifyCommandArity`, `scriptVerifyACL`, `scriptVerifyWriteCommandAllow`, `scriptVerifyOOM` in `src/script.c`). `redis.call` raises on error; `redis.pcall` hands you the error as a value.

## The same two clicks, replayed

```
   client A                 client B
      |                        |
   Server A                 Server B
      |                        |
      +-----------+------------+
                  |
                Redis
                  |
   -- script for A --
      GET    stock   -> 1
      1 >= 1         -> yes
      DECRBY stock   -> 0
      return 1          (A: reserved)
                  |
   -- script for B --
      GET    stock   -> 0
      0 >= 1         -> no
      return 0          (B: sold out)
```

Redis finishes A's whole script before it starts B's. B reads `0`, fails the check, never decrements. The counter cannot go negative through this path. That is one interleaving; a real sale produces thousands of them, which is how 100 units became 107 orders in the first place.

## One phone, many phones, a whole cart

"Selling phones" is three different problems, and getting the distinction right is most of the design work.

Several units of the same model is already handled: `stock >= qty` plus `DECRBY`. A buyer taking two when one remains is rejected in one indivisible step.

Many models on sale at once is the same problem copied per SKU. The race is per key, so one script per SKU is enough. Twenty hot SKUs are twenty instances of the same thing, not a bigger script. The one temptation to resist here is sharding a single hot counter across nodes to spread load. The moment the check becomes "sum of N buckets", the atomic check is gone and you have a race again, a harder one to see.

A cart that reserves phone plus case plus charger atomically is where the simple story ends, because now you need atomicity across keys. In Cluster mode a script may only touch keys that hash to the same slot, or it fails with `CROSSSLOT`. You can force co-location with a shared hash tag: `sale:{inv}:phone:stock`, `sale:{inv}:case:stock`, `sale:{inv}:charger:stock` all hash on `{inv}` and land on one node, where one script can reserve all or nothing. The tag has to be shared across every SKU the script touches; a per-order tag does not work because stock is global, not per order. The cost is that all of those keys now live on one node. Tagging by warehouse (`{wh:1}`) instead of one global tag spreads the load while keeping each reservation atomic.

If the inventory is large and hot, or the keys genuinely cannot share a slot, I think the honest answer is to stop forcing one script. Reserve each SKU on its own and treat the cart as a saga: reserve, then release or compensate each reservation if a later step fails. Atomicity across arbitrary keys in a distributed store is exactly what Redis cannot give you cheaply. Pretending otherwise is how you trade this bug for a different one.

So: one key, one script. A few co-locatable keys, one script with a shared tag and an eye on the hotspot. Anything larger, a saga.

## What the single thread costs you

The atomicity comes from a global serialization point, and that strength is also the risk. These are the things that separate "I copied the snippet" from "I understand the trade", roughly in the order they bite.

A slow script stalls the whole server. A script that takes 500 ms is 500 ms during which no other client on that instance is served. Redis guards against runaway scripts with a time limit, `lua-time-limit`, default 5000 ms, renamed `busy-reply-threshold` in Redis 7 with the old name kept as an alias (the field is `server.busy_reply_threshold`, and the same threshold governs module busy replies). A Lua debug hook calls `scriptInterrupt()`; once the threshold is crossed Redis starts answering other clients with `BUSY` and logs `Slow script detected: still in execution after N milliseconds`. From there `SCRIPT KILL` can stop the script, but only if it has not written yet. Once `SCRIPT_WRITE_DIRTY` is set, killing it would break atomicity, so the only exit is `SHUTDOWN NOSAVE` (`scriptKill()` in `src/script.c`). Treat any script that iterates a large collection as a latent outage. Keep scripts short, roughly O(1), and alert on the `Slow script detected` line; by the time it fires your other clients are already blocked.

Slow side effects do not belong inside. The script decides who owns the unit. It does not send the confirmation email or call the payment gateway. Do the atomic reservation in Redis, then the slow work in the application. A reservation is one in-memory round trip; an HTTP call inside the critical section is a self-inflicted outage.

Cluster has an opt-out you should not use for this. `allow-cross-slot-keys` (`SCRIPT_FLAG_ALLOW_CROSS_SLOT`, wired through `scriptPrepareForRun` in `src/script.c`) lets a script touch keys in different slots, non-atomically. It exists for cases where that is acceptable. If you reach for it to fix a race, you have defeated the point.

OOM and eviction can abort or erase a script's effect. Over `maxmemory`, the first memory-growing write aborts the script unless it declared `allow-oom` in its shebang (`#!lua flags=allow-oom,no-writes`, comma-separated, no space). Without flags a script is assumed to read and write, so it is blocked on read-only replicas and in OOM state by default; declare `no-writes` on read-only scripts so they can run during `CLIENT PAUSE WRITE` and on replicas. Eviction is the quieter one: under an `allkeys-*` policy Redis can evict the stock counter mid-sale. Keep stock keys non-evictable, with a `volatile-*` policy or a dedicated instance.

Replication copies the effects, not the script. Since Redis 3.2 (default from 5.0) the write commands a script performs are propagated to replicas and the AOF, wrapped in `MULTI`/`EXEC` when there is more than one. Redis 7 removed the old verbatim-script mode entirely; `redis.replicate_commands()` survives only as a deprecated no-op. This is why the old determinism rule is gone too: a script used to be forbidden from calling `TIME` or `SRANDMEMBER` before a write, so it would replay identically on every replica, and that restriction went with verbatim replication. What still holds is that the sandbox gives you no `os.time`, no filesystem, and a seeded `math.random`, and that replicas only agree on what the script actually wrote. Pass volatile values in as `ARGV`.

Replicas lag, and failover can lose recent decrements. Effects reach replicas asynchronously, so a read served from a replica can be stale. Never read stock from a replica. On failover, writes not yet acknowledged can be lost, which under-counts stock: safer than overselling, still a reconciliation problem. `WAIT`, `min-replicas-to-write` and AOF `appendfsync always` are the knobs if the counter has to survive a node loss.

## Crashes and retries are not Redis's problem

Two failure modes sit outside the script, and the script cannot save you from them.

A crash between reserve and order leaks inventory. If the process dies after `DECRBY` and before the order row is persisted, the units are gone and no order exists; they are reserved forever. Give reservations an expiry, a separate TTL key or a checkpoint a reconciler reads, and run a job that returns expired reservations to stock. Order the writes so that a crash under-sells rather than over-sells.

A retry can reserve twice. A client that times out may resend the same request, and nothing in the script above stops the second `DECRBY`. Pass a request id as `ARGV` and record it inside the same script, for example `SET order:{id}:reserved 1 NX` with an early return if it already exists. The check and the write stay atomic, so the retry becomes a no-op.

## EVAL or Functions

`EVAL` and `EVALSHA` are ephemeral scripts: the Lua lives as a string inside your Java, gets re-sent or re-loaded per deployment, and has no library structure or versioning. The script cache can be flushed (`SCRIPT FLUSH`) and, since Redis 7.4, evicted under memory pressure, forcing a re-`EVAL`. Scripts are cached by SHA-1; `SCRIPT LOAD` and `EVALSHA` let you send the 40-character digest instead of the body, and the digest-to-script map is kept so replication and the AOF can rewrite `EVALSHA` as `EVAL` when they need to (`luaCreateFunction` in `src/eval.c`).

Redis 7.0 added Functions to fix the ergonomics: a named, versioned library registered once with `FUNCTION LOAD`, called with `FCALL` or `FCALL_RO`, persisted with the dataset (`FUNCTION DUMP` / `FUNCTION RESTORE`) and replicated, so it survives restarts and failover. The same release split the monolithic `scripting.c` into `src/script.c` (how a script talks to Redis), `src/eval.c` (the legacy `EVAL` path), `src/script_lua.c` (running Lua) and `src/functions.c` plus `src/function_lua.c` (the Functions engine, which reuses `script_lua.c`). That split is why the threshold moved to `busy-reply-threshold`, and why `SCRIPT KILL` does not kill an `FCALL`; that is `FUNCTION KILL`.

For new code I would reach for Functions and keep `EVAL` for one-off, stateless logic where a string is fine. Both give you the same atomicity; the difference is operational.

## You might not need Lua

For the simple stock case there is a cheaper fix, and I would rather you read it here than in a code review. `DECRBY` is atomic and returns the new value, so the decrement alone can carry the decision, quantity included:

```java
long remaining = redisTemplate.opsForValue()
        .decrement("sale:phone:stock", quantity);   // atomic, returns the new total
if (remaining < 0) {
    redisTemplate.opsForValue()
            .increment("sale:phone:stock", quantity); // compensate the overshoot
    // sold out
}
```

This is correct and race-free for everything above. Lua is not required for a lone counter. The compensating `INCRBY` costs a second round trip, and only on the rare overshoot.

Where it loses is not concurrency, it is crash semantics and expressiveness. If the process dies between `DECRBY` and `INCRBY`, the units are silently gone: never an oversell, but inventory shrinks. Lua does not fix the crash either, but a script can fold the guard and the reservation record into one atomic step, so the state you crash into is always reconstructable. And the moment the rule is more than "is the counter above zero", a lone command cannot express it: a per-customer limit that must be checked and recorded with the decrement, a reservation from several per-warehouse counters in one shot, a token bucket that reads a refill time and writes tokens and timestamp together, an idempotency guard keyed on `order_id`.

My rule is blunt. Reach for the atomic command first. Use Lua when the decision is multi-step, conditional, and has to be indivisible. The same shape shows up everywhere once you see it: rate limiters, compare-and-delete lock release (the half of Redlock people forget), dedup markers, gapless sequence allocation, state machines that move `pending` to `confirmed` only if it is still `pending`. Each one is read, decide, write, with a gap in the middle. Redis made each of your commands atomic. A script is how you make a decision atomic.

## Sources

- Redis docs, Scripting with Lua: https://redis.io/docs/latest/develop/programmability/eval-intro/
- Redis docs, Lua API reference (script flags, `redis.call` / `redis.pcall`): https://redis.io/docs/latest/develop/programmability/lua-api/
- Redis docs, Redis functions (7.0, persistence and replication, `FCALL_RO`): https://redis.io/docs/latest/develop/programmability/functions-intro/
- Redis `redis.conf` on the 7.2 branch: `busy-reply-threshold` default of 5 seconds, `lua-time-limit` alias, `io-threads`: https://github.com/redis/redis/blob/7.2/redis.conf
- Redis 6.0 release notes, threaded I/O: https://github.com/redis/redis/blob/6.0/00-RELEASENOTES
- Redis 7.4 release notes, #13108 LRU eviction for `EVAL` scripts: https://github.com/redis/redis/blob/7.4/00-RELEASENOTES
- Redis source, `src/eval.c`: `evalGenericCommand`, `luaCreateFunction`
- Redis source, `src/script.c`: `scriptPrepareForRun`, `scriptCall`, `scriptInterrupt`, `scriptKill`
- Redis source, `src/script_lua.c`: `luaRedisGenericCommand`, `luaCallFunction`
- Redis source, `src/functions.c`, `src/function_lua.c`: Redis Functions engine
- Redis PR #9780, Redis Functions and the 7.0 scripting refactor: https://github.com/redis/redis/pull/9780
