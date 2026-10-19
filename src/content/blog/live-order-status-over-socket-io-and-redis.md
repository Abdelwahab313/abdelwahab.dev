---
title: "Live order status over Socket.IO and Redis"
kind: case-study
status: published
date: 2026-09-28
order: 0
lede: Socket.IO delivers at most once by default, so live order status on a driver's phone is only as good as the Redis read it makes on reconnect.
tags: [react-native, node, realtime]
cover: /img/blog/mobile-apps.svg
coverAlt: One server box pushing to a laptop and a phone, with the phone's reconnect read going straight to Redis.
---

## Situation

An order in this product passed through three pairs of hands before anyone ate it. A kitchen prepared it, a driver picked it up, a customer waited for it, and each of them watched the same order on a different screen. When the status moved, every one of those screens had to move with it, including the phone in a driver's pocket that lost signal two streets ago.

That was the system I built: the real-time order service behind a delivery product with 100K daily users, on Node.js and Socket.IO, pushing kitchen preparation, driver pickup and delivery status to mobile and web clients. The clients were React Native apps for the kitchen, the driver and admin, plus a Next.js web app. I built the mobile apps and maintained the web one, so I sat on both ends of every event the service sent.

Order state did not start in my service. It came out of the Laravel monolith as state changes over SQS, and the service consumed them and fanned them out to subscribed clients. Taking fulfillment itself out of that monolith is [a separate story](/blog/extracting-fulfillment-from-a-php-monolith-over-sqs).

Two things had to hold. Whatever a driver saw had to match what the kitchen and the customer saw. And telling everyone about a change could not slow down the write that made it.

The second one is easy to lose. One status change becomes many screen updates, and every phone that reconnects wants to know where its orders stand right now. If those reads land on the same database that takes the order writes, the screens start competing with the orders.

## Decision

### A room per order, typed on both ends

Socket.IO gives you two ways to group sockets. A room is, in the docs' words, "an arbitrary channel that sockets can join and leave", and it is a server-only concept: the client never sees which rooms it is in. `io.to(room).emit(...)` reaches every socket in the room, and a socket in several targeted rooms still gets the event once. A namespace is coarser, a way to split logic over one shared connection, each with its own handlers, rooms and middleware. I think of namespaces as the place to separate audiences whose access rules differ, and rooms as the place to separate orders.

A room per order maps straight onto the problem. The kitchen app, the driver's phone and the customer's browser each join `order:<id>`, and a status change is one emit to that room.

![One state change fans out from one place. The service consumes the change from the queue, writes the new state to Redis, and emits once to the order's room, which reaches the kitchen app, the driver app and the customer web client. Redis is the read source for snapshots; MySQL is updated behind it asynchronously.](diagram:mobile-fanout)

The code below is a sketch of the approach, written the way I would write it today, not the production code. It starts with the file both sides import:

```ts
// shared/order-events.ts: imported by the Node.js service and by every client
export type OrderStatus = "preparing" | "ready" | "picked_up" | "delivered";

export interface OrderState {
  orderId: string;
  status: OrderStatus;
  version: number; // increases on every change to this order
}

export interface ServerToClientEvents {
  "order:status": (state: OrderState) => void;
}

export interface ClientToServerEvents {
  "order:watch": (orderId: string, ack: (state: OrderState | null) => void) => void;
  "order:unwatch": (orderId: string) => void;
}
```

The server joins the socket to the order's room and answers with a snapshot:

```ts
import { createServer } from "node:http";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents, OrderState } from "../shared/order-events";
import { canWatch, readOrderState } from "./orders"; // access check, Redis read

const httpServer = createServer();
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);

io.on("connection", (socket) => {
  socket.on("order:watch", async (orderId, ack) => {
    if (!(await canWatch(socket, orderId))) return ack(null);
    await socket.join(`order:${orderId}`); // join first, then read
    ack(await readOrderState(orderId));
  });

  socket.on("order:unwatch", (orderId) => {
    socket.leave(`order:${orderId}`);
  });
});

// called once for every state change consumed from the queue
export function publish(state: OrderState) {
  io.to(`order:${state.orderId}`).emit("order:status", state);
}

httpServer.listen(3000);
```

And the React Native client, with `API_URL`, `orderId` and `render` coming from the app:

```ts
import { io, Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents, OrderState } from "../shared/order-events";

// the type parameters are reversed on the client
const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(API_URL, {
  transports: ["websocket"],
});

let current: OrderState | null = null;

function apply(next: OrderState | null) {
  if (next && (!current || next.version > current.version)) {
    current = next;
    render(current);
  }
}

// handlers are registered outside "connect", or each reconnect adds another copy
socket.on("order:status", apply);

// "connect" also fires on every reconnection: the old rooms are gone, so watch again
socket.on("connect", () => {
  socket.emit("order:watch", orderId, apply);
});
```

Most of the design sits in four lines of that.

`join` comes before the read. Read first and join second, and a change published between the two is lost for good: the snapshot is already old and the socket was not in the room to hear the update. Join first and the change arrives as a live event, inside the snapshot, or both.

![Why join comes before read. Reading the snapshot first leaves a gap in which a published change reaches nobody, and the screen stays stale. Joining first means the change arrives as a live event, and the version check discards a snapshot that turns out to be older.](diagram:mobile-join-before-read)

The `version` check is what makes "both" harmless. Socket.IO guarantees ordering on a connection, but the snapshot and the live event are produced at different moments. If a change is published after the server read the snapshot and before it sent the ack, the newer live event arrives first and the older snapshot second. Without a version, the screen moves backwards.

The watch is re-sent on every `connect`. The client docs say that event fires "upon connection and reconnection", that `socket.id` is regenerated after each reconnection, and the rooms page says a disconnecting socket leaves every room it was in. A reconnected phone is a new socket in no rooms. Unless it asks again, it hears nothing.

And handlers live outside `connect`, because the same docs warn that registering them inside adds a fresh copy on every reconnect. On a phone that drops signal many times in one shift, that is a slow leak of duplicate renders.

### Redis as the read source, MySQL behind it

Hot order state lived in Redis as the service's read source, in a write-behind cache with MySQL behind it. That kept status fan-out off the transactional path. The Redis docs describe write-behind plainly: the application uses the cache for reads and writes, and the cache syncs changed data to the backing database asynchronously.

The reason this mattered is in the reconnect path above. Every watch reads a snapshot, and reconnects arrive in bursts. The Socket.IO client reconnects by default with no attempt limit, starting at a 1000 ms delay and doubling to a 5000 ms ceiling, with a randomization factor of 0.5 "so that the clients do not reconnect at the exact same time". Jitter spreads a herd over a few seconds. It does not shrink it. When a server process restarts, every client it held comes back inside that window and asks for state. I would much rather that burst hit memory than the database taking order writes.

The version has to be enforced where the state is written too, not only on the screen. If an old or repeated change could overwrite a newer one in Redis, every snapshot after that is wrong. Reading the stored version and then writing is a check-then-act gap, the one [the Redis post](/blog/preventing-stock-overselling-in-redis-with-lua-scripts) is about, so the compare and the write need to be one atomic step.

### Moving the service to TypeScript

I migrated the real-time order service from JavaScript to TypeScript, so event and message payload mismatches failed at compile time instead of in front of customers.

With one backend serving phones and browsers, a renamed field in a JavaScript emit is a runtime surprise for every client at once. Socket.IO's typed events turn the event names and payloads into interfaces: the server passes `ClientToServerEvents` and `ServerToClientEvents` to `new Server<...>()`, and the client reuses the same two interfaces with the order reversed. Shared in one file, a change to `OrderState` breaks the build of whichever side has not caught up.

The docs add a caution I agree with: "These type hints do not replace proper validation/sanitization of the input." The compiler checks my code against my declaration. It does not check what a client actually sent over the wire, and it cannot check what the PHP monolith put on the queue. On the consumer side, the TypeScript type for an incoming message is a claim about the other side, not a proof. Runtime validation still belongs at both edges.

If I could keep only one, I would keep the shared types file over a suite of socket integration tests. The types catch the mistake at the moment it is typed, on both sides, for free.

### Five people on driver check-ins

I led a team of five building a background location check-in system for the driver app, which improved route efficiency. My part was planning, reviews and pairing across the driver app.

This was the same problem facing the other way: data leaving a phone that is often in the background and often offline. The distinction I think matters most in that kind of system is that a position sample is replaceable and a check-in is a fact. If samples travel over a socket, Socket.IO's default is to buffer every emit made while disconnected and send them all on reconnection, which the docs warn "could result in a huge spike of events". A volatile emit drops instead, and for a position only the newest one counts. A check-in wants the opposite: the client's `retries` and `ackTimeout` options resend an event until the server acknowledges it.

## Trade-off

### At most once is the default, and it is honest

The delivery guarantees page is blunt: by default Socket.IO provides an at most once guarantee, and "any event that was missed by a disconnected client will not be transmitted to that client upon reconnection". The server keeps no buffer for a client that is away. That is the whole reason the sketch treats a push as a hint and the snapshot as the truth.

![A driver's phone loses signal, misses a status push that is never resent, then reconnects. The connect handler sends order:watch, the server joins the room and reads Redis, and one snapshot brings the screen back to the current state in a single round trip.](diagram:mobile-reconnect)

Connection state recovery narrows the gap. It restores a client's state after a temporary disconnection, rooms and missed packets included, but it comes with two catches. It does not work with the Redis adapter, because persisting packets "is not compatible with the Redis PUB/SUB mechanism"; the in-memory, Redis Streams and MongoDB adapters support it. And the docs say recovery will not always succeed, so you still need a way to resynchronize. The snapshot path is the floor either way. Recovery is an optimization on top of it.

The docs also show how to get at-least-once from server to client: give every event a unique ID, persist events, have the client send the offset of the last one it saw. That is an event log with replay. For order status I think it is the wrong tool. The client does not need the history of an order, it needs the latest state, and a snapshot read is one round trip where a replay is many.

### The write-behind window

Write-behind buys a fast write path and pays for it with a window: Redis has the change, MySQL does not yet. Anything reading MySQL inside that window sees older state, so the read source has to be Redis for everything that cares about now.

If Redis loses data inside the window, the change is gone unless something upstream can replay it. Redis's own durability sets the size of that hole. With AOF on the default `appendfsync everysec`, the persistence docs say "you may lose 1 second of data if there is a disaster". With RDB snapshots alone, you should be prepared to lose the latest minutes.

When state arrives from a queue, the replay lives in the queue, and the order of operations decides whether it works. The queue carrying state changes out of the monolith was SQS FIFO. A received message stays in the queue until the consumer deletes it, and if it is not deleted before the visibility timeout expires (30 seconds by default), it becomes visible again. Delete only after the Redis write has landed, and a crash in between is covered. On a FIFO queue that has a price: no further messages from the same message group ID are returned until the first one is deleted or becomes visible again, so a consumer that dies mid-message holds its group back for up to the timeout.

FIFO also changes what the version check is for. Within a message group ID, messages are sent and received in strict order; messages in different groups may be processed out of order relative to one another. If every change to one order shares a group, the queue keeps that order's changes in sequence. The 5-minute deduplication interval covers the producer: a retried `SendMessage` inside it does not put a second copy in the queue. It does not cover the consumer. A message whose visibility timeout runs out mid-processing is delivered again, and the visibility timeout docs say that for FIFO queues too there is no absolute guarantee a message will not be delivered more than once. So the version check in the Redis write stays. On FIFO it guards against a replay rather than a reordering.

### Many processes, one room

Rooms are local to a process. Once the service runs as more than one, a phone joined to `order:42` on one process does not hear an emit from another. The Redis adapter fixes that with Redis Pub/Sub: a broadcast goes to matching clients on the current server and is published on a Redis channel for the others. It stores no keys in Redis, and if Redis is unavailable, packets reach only the clients on the current server. The docs recommend the sharded adapter, built on Redis 7.0 sharded Pub/Sub, for new work.

Load balancing has its own catch. HTTP long-polling sends many requests per session, so every request has to reach the process that owns the session, which means sticky sessions. A WebSocket-only client keeps one connection and removes that requirement, which is why the client sketch sets `transports: ["websocket"]`. The cost is no long-polling fallback for a network that blocks WebSockets.

### One codebase, one blast radius

React Native over two native apps meant one codebase and one hiring pool, at the cost of living inside the layer's constraints when a platform feature lands late. One backend for mobile and web meant they moved together, and a payload mistake hit both audiences at once. The types file narrows that blast radius. It does not remove it: a wrong value with the right shape still reaches every screen.

## Outcome

The driver app shipped with live orders, reading the same service as the web clients, and status fan-out reached every client from one place. The team of five delivered the check-in system, which improved route efficiency. The service ran on TypeScript, with payload mismatches caught at compile time. Separately, instrumenting the order, driver and kitchen flows with Datadog and OpenTelemetry cut Mean Time To Resolve by 30%.

What I would carry into any real-time system is the order of work. Write the reconnect path first: a client that has been gone for a minute has to get back to the truth in one round trip, from a store that can take the burst. Once that exists, a lost push costs a few seconds of staleness. Without it, no delivery setting on the live path will keep a driver's screen honest.

## Sources

- Socket.IO docs, Delivery guarantees (at most once by default, ordering, server-to-client offsets): https://socket.io/docs/v4/delivery-guarantees
- Socket.IO docs, Connection state recovery (`socket.recovered`, adapter compatibility): https://socket.io/docs/v4/connection-state-recovery
- Socket.IO docs, TypeScript (`ServerToClientEvents`, `ClientToServerEvents`, reversed client types): https://socket.io/docs/v4/typescript/
- Socket.IO docs, Rooms: https://socket.io/docs/v4/rooms/
- Socket.IO docs, Namespaces: https://socket.io/docs/v4/namespaces/
- Socket.IO docs, Emitting events (acknowledgements, timeouts, volatile events): https://socket.io/docs/v4/emitting-events/
- Socket.IO docs, Using multiple nodes (sticky sessions, WebSocket-only transport): https://socket.io/docs/v4/using-multiple-nodes/
- Socket.IO docs, Redis adapter (Pub/Sub, sharded adapter): https://socket.io/docs/v4/redis-adapter/
- Socket.IO docs, Client offline behavior (buffered events): https://socket.io/docs/v4/client-offline-behavior/
- Socket.IO docs, Client options (reconnection defaults, `retries`, `ackTimeout`): https://socket.io/docs/v4/client-options/
- Socket.IO docs, The Socket instance, client side (`connect` on reconnection, disconnect reasons): https://socket.io/docs/v4/client-socket-instance/
- Redis docs, Redis persistence (AOF fsync policies, RDB data loss): https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/
- Redis docs, Write-behind caching: https://github.com/redis/docs/blob/main/content/operate/oss_and_stack/stack-with-enterprise/deprecated-features/gears-v1/python/recipes/write-behind.md
- AWS docs, Amazon SQS FIFO queues: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-fifo-queues.html
- AWS docs, FIFO queue delivery logic (per message group ordering, in-flight messages): https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-understanding-logic.html
- AWS docs, Exactly-once processing (5-minute deduplication interval): https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-exactly-once-processing.html
- AWS docs, Amazon SQS visibility timeout: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html
