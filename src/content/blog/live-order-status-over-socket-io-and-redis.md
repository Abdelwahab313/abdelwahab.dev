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

I built the real-time order service behind a delivery product with 100K daily users, on Node.js and Socket.IO. It pushed kitchen preparation, driver pickup and delivery status to React Native apps for the kitchen, the driver and admin, and to a Next.js web app. I built the mobile apps and maintained the web one, so I sat on both ends of every event the service sent. Order state came out of a Laravel monolith over SQS, and taking fulfillment out of that monolith is [a separate story](/blog/extracting-fulfillment-from-a-php-monolith-over-sqs).

Two things had to hold. Whatever a driver saw had to match what the kitchen and the customer saw. And telling everyone about a change could not slow down the write that made it.

Socket.IO delivers at most once by default. A driver's phone that lost signal two streets ago misses the push, and the server never sends it again. So I treated every push as a hint and the snapshot a client reads from Redis on reconnect as the truth. Most of the design exists to make that read correct and cheap.

## Decision

### A room per order, typed on both ends

Socket.IO groups sockets into namespaces and rooms. A room is a server-side channel a socket joins and leaves. I kept namespaces for audiences whose access rules differ and gave each order a room, which maps straight onto the problem. The kitchen app, the driver's phone and the customer's browser each join `order:<id>`, and a status change is one emit to that room.

![One state change fans out from one place. The service consumes the change from the queue, writes the new state to Redis, and emits once to the order's room, which reaches the kitchen app, the driver app and the customer web client. Redis is the read source for snapshots; MySQL is updated behind it asynchronously.](diagram:mobile-fanout)

The code is a sketch, written the way I would write it today. It starts with the file both sides import:

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
}
```

The server joins the socket to the order's room and answers with a snapshot through `ack`, the callback the client sends with the event:

```ts
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents, OrderState } from "../shared/order-events";
import { canWatch, readOrderState } from "./orders"; // access check, Redis read

const io = new Server<ClientToServerEvents, ServerToClientEvents>(3000);

io.on("connection", (socket) => {
  socket.on("order:watch", async (orderId, ack) => {
    if (!(await canWatch(socket, orderId))) return ack(null);
    await socket.join(`order:${orderId}`); // join first, then read
    ack(await readOrderState(orderId));
  });
});

// called once for every state change consumed from the queue
export function publish(state: OrderState) {
  io.to(`order:${state.orderId}`).emit("order:status", state);
}
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

I moved this service from JavaScript to TypeScript so payload mismatches failed at compile time. Socket.IO's typed events put event names and payloads in two interfaces, and the server and every client import them from one file. A change to `OrderState` then breaks the build of whichever side has not caught up.

The docs add a caution I agree with: "These type hints do not replace proper validation/sanitization of the input." The compiler never sees what a client or the Laravel monolith actually sent, so runtime validation still belongs at both edges. Between the shared types file and a suite of socket integration tests, I would keep the types file. It catches the mistake as it is typed, on both sides.

### Join the room before reading the snapshot

The order of two lines in the `order:watch` handler matters most. `join` comes before the read. Read first and join second, and a change published between the two is lost for good: the snapshot is already old and the socket was not in the room to hear the update. Join first and the change arrives as a live event, inside the snapshot, or both.

![Why join comes before read. Reading the snapshot first leaves a gap in which a published change reaches nobody, and the screen stays stale. Joining first means the change arrives as a live event, and the version check discards a snapshot that turns out to be older.](diagram:mobile-join-before-read)

The `version` check makes "both" harmless, because a copy at the same version is ignored. It also covers a reorder. Socket.IO keeps messages in order on a connection, but that is the order they were sent in. If a change is published after the server read the snapshot and before it sent the ack, the newer live event arrives first and the older snapshot second. Without a version, the screen moves backwards.

The watch is re-sent on every `connect`. The client docs say that event also fires on reconnection, with a new `socket.id`, so a reconnected phone is a new socket in no rooms. Unless it asks again, it hears nothing.

Handlers live outside `connect`, because the same docs warn that registering them inside adds a fresh copy on every reconnect. On a phone that drops signal many times in one shift, that is a slow leak of duplicate handlers.

### Redis takes the reconnect burst

Hot order state lived in Redis as the service's read source, in a write-behind cache with MySQL behind it, so changes reached MySQL asynchronously. That kept status fan-out off the transactional path.

Every watch reads a snapshot, and reconnects arrive in bursts. The Socket.IO client reconnects by default with no attempt limit, waiting a second at first and backing off to a cap of five seconds, with jitter. Jitter spreads a herd over a few seconds. It does not shrink it. When a server process restarts, every client it held comes back inside that window and asks for state, and I would much rather that burst hit memory than the database taking order writes.

The version also has to be enforced where state is written. If an old or repeated change can overwrite a newer one in Redis, every snapshot after it is wrong. Reading the stored version and then writing is the check-then-act gap from [the Redis post](/blog/preventing-stock-overselling-in-redis-with-lua-scripts), so the compare and the write need to be one atomic step.

## Trade-off

### A missed push is never resent

The delivery guarantees page is blunt: by default Socket.IO provides an at most once guarantee, and "any event that was missed by a disconnected client will not be transmitted to that client upon reconnection". The server keeps no buffer for a client that is away.

![A driver's phone loses signal, misses a status push that is never resent, then reconnects. The connect handler sends order:watch, the server joins the room and reads Redis, and one snapshot brings the screen back to the current state in a single round trip.](diagram:mobile-reconnect)

Connection state recovery narrows the gap by restoring rooms and missed packets after a temporary disconnection. It does not work with the Redis adapter, which carries room broadcasts between server processes, and the docs say it will not always succeed. The snapshot path stays the floor.

### The write-behind window

Write-behind buys a fast write path and pays for it with a window: Redis has the change, MySQL does not yet. Anything reading MySQL inside that window sees older state, so the read source has to be Redis for everything that cares about now.

If Redis loses data inside that window, the change is gone unless something upstream can replay it. Changes came out of the monolith on SQS FIFO, which redelivers a message until it is deleted. A delete that waits for the Redis write covers a consumer crash between the two. The version check in that write stays, because the AWS docs give no absolute guarantee that a FIFO message will not be delivered more than once.

### One room across processes

Rooms are local to a process. Running more than one takes an adapter, and the Redis adapter carries broadcasts between processes over Pub/Sub, the same adapter that rules out connection state recovery. A WebSocket-only client like the one above also avoids the sticky sessions that long-polling needs, and gives up the long-polling fallback for a network that blocks WebSockets.

## Outcome

The driver app shipped with live orders, reading the same service as the web clients, and status fan-out reached every client from one place. The service ran on TypeScript, with payload mismatches caught at compile time.

What I would carry into any real-time system is the order of work. Write the reconnect path first: a client that has been gone for a minute has to get back to the truth in one round trip, from a store that can take the burst. Once that exists, a lost push costs a few seconds of staleness. Without it, no delivery setting on the live path will keep a driver's screen honest.

## Sources

- Socket.IO docs, Delivery guarantees (at most once by default): https://socket.io/docs/v4/delivery-guarantees
- Socket.IO docs, Connection state recovery (adapter compatibility): https://socket.io/docs/v4/connection-state-recovery
- Socket.IO docs, TypeScript (typed events, validation caution): https://socket.io/docs/v4/typescript/
- Socket.IO docs, The Socket instance, client side (`connect` on reconnection, handler registration): https://socket.io/docs/v4/client-socket-instance/
- Socket.IO docs, Client options (reconnection defaults): https://socket.io/docs/v4/client-options/
- Socket.IO docs, Using multiple nodes (sticky sessions, adapters): https://socket.io/docs/v4/using-multiple-nodes/
- AWS docs, Amazon SQS visibility timeout: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html
