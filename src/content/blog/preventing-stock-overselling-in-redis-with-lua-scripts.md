---
title: "Preventing stock overselling in Redis with Lua scripts"
kind: note
status: published
date: 2026-10-07
lede: Every Redis command is atomic. The check-then-write your app wraps around them is not, and that gap is how 100 units become 121 orders.
tags: [redis, lua, concurrency]
cover: /img/blog/redis.svg
coverAlt: Two clients A and B send to one Redis box. Four interleaved dashed command slots end at minus one; two solid script blocks, one after the other, end at zero.
---

## 100 units, 121 orders

A Black Friday flash sale. One phone model, 100 units at the sale price, at most two per order. The stock counter lives in Redis under `sale:phone:stock`, and a fleet of app servers behind a load balancer decrements it.

The sale closes. You had 100 phones. The system accepted 121 reservations. Twenty-one people paid for a phone that does not exist, and finance finds out three days later.

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

## Every command was atomic, the decision was not

Redis executes commands on its main thread, driven by an event loop, so any single command is atomic with respect to every other command. `GET` is atomic. `DECR` is atomic. The I/O threads added in Redis 6 only offload reading and writing sockets, and command execution still funnels through the main thread.

No promise covers two commands your application issues back to back. Between your `GET` and your `DECR`, another client's command can be scheduled. Two servers hitting the last unit at the same instant interleave like this:

```
1. Server A  GET  sale:phone:stock   -> 1
2. Server B  GET  sale:phone:stock   -> 1     both see 1
3. Server A  DECR sale:phone:stock   -> 0     A wins
4. Server B  DECR sale:phone:stock   -> -1    B takes a unit that is not there
```

Both requests passed `if (stock > 0)`, because both read `1` before either decremented. Redis executed all four commands correctly and in order. The counter ending at `-1` is the smoking gun: the check and the update were never one operation.

Redis kept every individual promise you asked for, and another request slipped into the gap between two of them. On a single machine you would guard that gap with a mutex. A fleet of app servers has no cheap shared mutex. Redis can be one, if you move the whole critical section inside it.

![The race as a sequence. Server A and server B each GET the stock and both receive 1. Each passes its own stock greater than zero check in application code. A's DECR brings the counter to 0, then B's DECR brings it to minus one, a unit that was never there.](diagram:redis-interleaved)

## Move the decision inside Redis

The fix is to stop sending two commands and send one thing that reads the stock and decrements it if there is enough.

Redis ships a Lua 5.1 interpreter compiled into the server. It runs a script, sent with the `EVAL` command, to completion before the event loop picks up the next client. This sale allows two per order, so the script takes the quantity as an argument:

```lua
local stock = tonumber(redis.call('GET', KEYS[1]) or '0')
local qty   = tonumber(ARGV[1])

if stock >= qty then
    redis.call('DECRBY', KEYS[1], qty)
    return 1          -- reserved
end

return 0              -- sold out
```

From Java, with `RESERVE` holding that script as a string:

```java
Long reserved = redisTemplate.execute(
    new DefaultRedisScript<>(RESERVE, Long.class),
    List.of("sale:phone:stock"),      // KEYS
    String.valueOf(quantity)          // ARGV, 1 or 2 in this sale
);
```

The key name is passed in as `KEYS[1]` because Redis Cluster routes a script by the keys it declares. The `or '0'` covers a missing key: `GET` returns Lua `false`, `tonumber(false)` is `nil`, and `nil >= qty` throws, so the default makes "key absent" mean "no stock". And the check is `stock >= qty` because a buyer asking for two when one is left must be refused, which `stock > 0` would let through.

Redis does not wrap scripts in a mutex or a transaction log. The atomicity falls out of the execution path. `EVAL` comes in through the normal dispatch, `processCommand` then `call`, on the main thread. `evalGenericCommand()` in `src/eval.c` hands the script to `luaCallFunction()`, which does a `lua_pcall` into the interpreter, and while that runs the event loop dispatches nothing else. There is no yield point. A `redis.call('GET', ...)` inside the script goes through `luaRedisGenericCommand()` and `scriptCall()` and executes inline on the same thread.

![The call stack for one EVAL. The event loop dispatches to processCommand, call, evalCommand, evalGenericCommand and luaCallFunction, which runs the script body under lua_pcall. Inside it, redis.call goes through luaRedisGenericCommand and scriptCall and the GET and DECRBY execute inline on the same thread. From lua_pcall down there is no yield point, and other clients wait in the queue at the top.](diagram:redis-call-path)

A script's effects have either not happened yet or have already happened. There is no observable state in between.

![The same two clicks with the script. Client A and client B reach their servers, and both servers send the script to Redis with quantity 1. Redis runs A's script to the end: GET returns 1, 1 is at least 1, DECRBY takes the counter to 0, return 1 and A is reserved. Only then does B's script run: GET returns 0, 0 is not at least 1, return 0 and B is sold out.](diagram:redis-atomic)

Redis finishes A's whole script before it starts B's, so B reads `0`, fails the check and never decrements. Across the thousands of interleavings a real sale produces, the counter cannot go negative through this path.

That guarantee is isolation, not a transaction. Redis serializes scripts and does not roll them back. If a script writes one key and then errors on the next, the first write stays and the caller gets an error. Design multi-key scripts so that a failure halfway through leaves a state you can reconstruct. Replicas receive the commands the script wrote, asynchronously, so never read stock from a replica.

For new code I would load the script once as a Redis 7.0 Function and call it with `FCALL`. Functions persist with the dataset, survive failover and run with the same atomicity.

## You might not need Lua

For this stock counter there is a cheaper fix, and I would rather you read it here than in a code review. `DECRBY` is atomic and returns the new value, so the decrement alone can carry the decision, quantity included:

```java
long remaining = redisTemplate.opsForValue()
        .decrement("sale:phone:stock", quantity);   // atomic, returns the new total
if (remaining < 0) {
    redisTemplate.opsForValue()
            .increment("sale:phone:stock", quantity); // compensate the overshoot
    // sold out
}
```

This is race-free for everything above. The compensating `INCRBY` costs a second round trip, and only on the rare overshoot.

`DECRBY` loses in two places. If the process dies between `DECRBY` and `INCRBY`, the units are silently gone, which shrinks inventory and never oversells. A script cannot stop the crash either. It can put the check, the decrement and a reservation record in one atomic step, so the state you crash into is always reconstructable. And a lone command cannot express a rule bigger than "is the counter above zero", such as a per-customer limit or an idempotency guard keyed on `order_id`.

My rule is blunt. Reach for the atomic command first. Use Lua when the decision is multi-step, conditional, and has to be indivisible. The same shape shows up in rate limiters, compare-and-delete lock release (the half of Redlock people forget), dedup markers, and state machines that move `pending` to `confirmed` only if it is still `pending`. Each one is read, decide, write, with a gap in the middle. Redis made each of your commands atomic. A script is how you make a decision atomic.

## A cart needs keys on one slot, or a saga

The race is per key, so twenty SKUs on sale run the same script against twenty keys. A cart that reserves phone, case and charger together needs atomicity across keys. In Cluster mode a script may only touch keys that hash to one slot, or it fails with `CROSSSLOT`. A shared hash tag forces co-location: `sale:{inv}:phone:stock`, `sale:{inv}:case:stock` and `sale:{inv}:charger:stock` all hash on `{inv}` and land on one node, where one script reserves all or nothing. The cost is a hotspot on that node. Tagging by warehouse (`{wh:1}`, `{wh:2}`) keeps each warehouse's keys on one slot, which spreads the load across nodes and keeps each reservation atomic.

If the inventory is large and hot, or the keys cannot share a slot, I think the honest answer is to stop forcing one script. Reserve each SKU on its own and treat the cart as a saga: reserve, then release each reservation if a later step fails. Atomicity across arbitrary keys in a distributed store is exactly what Redis cannot give you cheaply.

## Slow scripts, retries and crashes

The atomicity comes from one serialization point, and so does the risk. A script that takes 500 ms is 500 ms in which no other client on that instance is served. Past `busy-reply-threshold` (default 5000 ms, `lua-time-limit` before Redis 7), Redis answers other clients with `BUSY` and logs `Slow script detected`. `SCRIPT KILL` can stop the script only if it has not written yet. After a write, killing it would break atomicity, so the only exit is `SHUTDOWN NOSAVE`. Keep scripts short, roughly O(1), and treat any script that iterates a large collection as a latent outage.

That is also why the script only decides who owns the unit. The payment call, the order row and the email happen in the application afterwards, and that split leaves two failures to design for.

A retry can reserve twice. A client that times out may resend the same request, and nothing in the script above stops the second `DECRBY`. Pass the `order_id` with the call and have the script `SET` a marker for it with `NX`, returning early if the marker exists, so a retry becomes a no-op.

A crash between reserve and order leaks inventory. If the process dies after the script and before the order row is persisted, the units stay reserved with no order behind them. Give reservations an expiry, a TTL key or a checkpoint, and run a reconciler job that returns expired reservations to stock. Order the writes so that a crash can only under-sell.

## Sources

- Redis docs, Scripting with Lua: https://redis.io/docs/latest/develop/programmability/eval-intro/
- Redis docs, Redis functions: https://redis.io/docs/latest/develop/programmability/functions-intro/
- Redis `redis.conf` on the 7.2 branch: `busy-reply-threshold` default of 5 seconds, `lua-time-limit` alias, `io-threads`: https://github.com/redis/redis/blob/7.2/redis.conf
- Redis 6.0 release notes, threaded I/O: https://github.com/redis/redis/blob/6.0/00-RELEASENOTES
- Redis source, `src/eval.c`, `src/script_lua.c`, `src/script.c`: `evalGenericCommand`, `luaCallFunction`, `luaRedisGenericCommand`, `scriptCall`, `scriptInterrupt`, `scriptKill`
