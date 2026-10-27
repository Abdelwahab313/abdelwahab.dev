---
title: "Handling backpressure in Node.js streams"
kind: note
status: published
date: 2026-10-19
lede: A Node.js stream says slow down with one boolean. Ignore it and a single stalled client parks 200 MiB in your process. Here is how the signal travels.
tags: [node, streams, performance]
cover: /img/blog/node-streams.svg
coverAlt: A producer box writes into a buffer whose third chunk crosses a dashed mark, with a slow sink beyond. An accent arrow labelled false loops back to the producer, and an arrow labelled drain returns underneath.
---

## The return value everyone drops

Most Node.js code that writes to a stream looks like this:

```js
for (const row of rows) {
  out.write(toCsvLine(row));
}
out.end();
```

It works on a laptop every time. It also discards the only thing `write()` tells you. `write()` returns a boolean, and that boolean is the whole flow-control protocol of Node streams. The docs say it returns `false` "if the stream wishes for the calling code to wait for the `'drain'` event to be emitted before continuing to write additional data".

A `false` is not a rejection: the chunk was accepted and queued. It is not an error either. Errors arrive through the `'error'` event. It means the stream's internal queue is at or over its limit, and if you keep writing, the queue keeps growing in your process's memory. That is backpressure: the consumer (a disk, a socket, a database) is slower than your loop, and the boolean is how it pushes back.

To see what ignoring it costs, I wrote a Writable that takes 1 ms to accept each chunk, a stand-in for a slow disk or network peer, and fed it 20,000 chunks of 1 KiB. `writableLength` is the number of bytes sitting in the stream's queue.

```js
const { Writable } = require('node:stream');
const { once } = require('node:events');

const slowSink = () => new Writable({
  write(chunk, encoding, callback) { setTimeout(callback, 1); },
});
const CHUNK = Buffer.alloc(1024);

async function respect() {
  const w = slowSink();
  let max = 0;
  for (let i = 0; i < 20000; i++) {
    if (!w.write(CHUNK)) await once(w, 'drain');
    max = Math.max(max, w.writableLength);
  }
  w.end();
  console.log('respected:', max);
}
```

`ignore()` is the same loop with a bare `w.write(CHUNK)`. On Node 22:

| Run | Peak bytes queued | `write()` returned `false` |
|---|---|---|
| Ignored | about 20 MB | almost twenty thousand times |
| Respected | about 63 KiB | not counted |

The ignoring loop finishes in a few milliseconds and the sink needs at least 20 seconds, so every byte it produced sat in the queue. The respecting loop never held more than one chunk short of the stream's limit. Same data, same sink, roughly the same total time.

## `highWaterMark` is where `false` starts

The `highWaterMark` is the queue level at which a stream starts saying `false`. Nothing stops you writing past it, as the table above shows. The docs describe the return value as `true` "if the internal buffer is less than the `highWaterMark` configured when the stream was created after admitting `chunk`". The chunk is queued first and compared second, so one 100 KiB write to a stream with a 64 KiB mark returns `false` on the first call.

Node 22.0.0 changed the defaults (pull request 52037, "bump default highWaterMark"), and a lot of articles still carry the old ones. They are now 64 KiB for byte streams on Linux and macOS, 16 KiB on Windows, and 16 objects in `objectMode`.

## Stop at `false`, resume on `'drain'`

![The feedback loop. A producer, either a loop or a Readable, calls write on a Writable whose internal buffer is filling past the highWaterMark mark, while a slow sink such as a disk or socket empties it. An arrow back to the producer says false means the buffer is at or past the mark and the producer should stop. A second arrow underneath says the drain event means the buffer emptied and the producer can resume.](diagram:node-streams-signal-loop)

Write until `write()` returns `false`, wait for the `'drain'` event, which the stream emits once its queue has emptied, then continue. `events.once()` turns the event into a promise:

```js
const { once } = require('node:events');

async function writeAll(out, rows) {
  for (const row of rows) {
    if (!out.write(toCsvLine(row))) {
      await once(out, 'drain');
    }
  }
  out.end();
  await once(out, 'finish');
}
```

`'drain'` only fires after a `false`. If you never got one, do not wait for it, or you will wait forever. `'finish'` means every queued chunk has reached the underlying resource.

The hole is errors. If the stream errors while you wait, `once` rejects, which is what you want. An error outside that window is emitted with nobody listening, and an unhandled `'error'` crashes the process. Hand-rolled writing means hand-rolled error handling too.

## `pipeline()` does the waiting and the cleanup

`readable.pipe(writable)` pauses the source on `false` and resumes it on `'drain'`. It does not clean up on failure. The docs say: "if the `Readable` stream emits an error during processing, the `Writable` destination is not closed automatically". I checked it with a source that fails on its first read, piped into a file stream:

```
pipe():     after source error, destination destroyed? false, file descriptor open? true
pipeline(): rejected with "boom", destination destroyed? true
```

Every failed `pipe()` like that leaks an open file descriptor. On a busy server you eventually hit the process's descriptor limit, and then even `accept()` on new connections fails with `EMFILE`.

`stream.pipeline()` does the same backpressure handling and, on error, calls `destroy(err)` on every stream in the chain that has not finished, then reports the error once:

```js
const { pipeline } = require('node:stream/promises');
const fs = require('node:fs');
const zlib = require('node:zlib');

await pipeline(
  fs.createReadStream('access.log'),
  zlib.createGzip(),
  fs.createWriteStream('access.log.gz'),
);
```

One `await` either resolves when the last byte is on disk or rejects with the first error, after everything is closed. I would not use `pipe()` in new code. The only thing it does better is chaining syntax, and that is not worth a descriptor leak.

## One stalled phone holds 200 MiB

An HTTP response is a Writable, and the HTTP docs say `res.write()` returns `false` "if all or part of the data was queued in user memory". User memory is your heap. On a weak mobile link the kernel's send buffer for that connection fills, and everything you write after that piles up in Node's queue.

I measured it. A server sends 200 MiB in 64 KiB chunks to a client that sends its request and then stops reading, once with a loop that ignores `res.write()` and once with `pipeline` from a Readable:

| Server code | Peak `res.writableLength` | Process memory after 1.5 s |
|---|---|---|
| Loop ignoring `write()` | 200 MiB | 255 MiB |
| `pipeline(source, res)` | 0.1 MiB | 43 MiB |

One stalled client cost 200 MiB with the loop. A hundred of them is 20 GB. With `pipeline` the source stopped producing. The handler, trimmed:

```js
http.createServer(async (req, res) => {
  const path = '/data/report.pdf';
  let size;
  try {
    ({ size } = await fs.promises.stat(path));
  } catch {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': size });
  try {
    await pipeline(fs.createReadStream(path), res);
  } catch (err) {
    console.error('download aborted:', err.code);
  }
}).listen(3000);
```

The `stat` comes first because a failed `pipeline` destroys every stream in the chain, including `res`, which closes the socket. A missing file found in the `catch` can no longer get a 404.

## A slow disk pauses the client

The incoming `req` is a Readable. Collect it with `req.on('data')` into an array and a 2 GB upload is 2 GB of heap, plus a second copy in `Buffer.concat`. The streaming version compresses on the way:

```js
const crypto = require('node:crypto');

http.createServer(async (req, res) => {
  const dest = `/uploads/${crypto.randomUUID()}.gz`;
  try {
    await pipeline(req, zlib.createGzip(), fs.createWriteStream(dest));
    res.writeHead(201, { Location: dest }).end();
  } catch {
    await fs.promises.rm(dest, { force: true });
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
}).listen(3000);
```

The `rm` matters because a failed upload otherwise leaves a truncated `.gz` that looks valid by name.

![Backpressure on an upload. Bytes flow right through six stages: the client, the server kernel's receive buffer, req as a Readable, gzip as a Transform, the file stream as a Writable, and a slow disk. Pressure travels left: the disk completes writes late, the file stream's write returns false, gzip's write returns false, the socket is paused, and the TCP window advertised to the client drops to zero, which stops the client sending.](diagram:node-streams-upload-chain)

Suppose the disk is the slow part. The file stream's queue fills and its `write()` returns `false` to gzip. Gzip's output fills, so gzip's own `write()` returns `false` to `req`, and `pipeline` pauses `req`, which stops Node reading from the socket. The client's bytes now pile up in the kernel's receive buffer. Every TCP acknowledgement the server sends advertises a receive window, the space left in that buffer, and at zero the client's kernel must stop sending.

So a slow disk on the server ends up pausing a program on another machine, and nothing on the way buffered without bound.

## Write the producer as a generator

An export of millions of orders should not sit in an array first. `pipeline` takes an async generator as its source:

```js
async function* orderLines(db) {
  yield 'id,total\n';
  let lastId = 0;
  while (true) {
    const page = await db.query(
      'SELECT id, total FROM orders WHERE id > $1 ORDER BY id LIMIT 1000',
      [lastId],
    );
    if (page.length === 0) return;
    for (const row of page) yield `${row.id},${row.total}\n`;
    lastId = page[page.length - 1].id;
  }
}

await pipeline(orderLines(db), fs.createWriteStream('orders.csv'));
```

`pipeline` pulls one line, writes it, and on `false` waits for `'drain'` before pulling the next. Meanwhile the generator is suspended at its `yield`, and a suspended generator is not issuing the next `SELECT`. The disk sets the pace of the database queries without a line of flow-control code.

A higher `highWaterMark` never fixes a slow consumer. It only makes the queue in front of it longer before the `false` arrives.

My opinion: if your code calls `write()` in a loop, you have usually written a Readable by hand, without its flow control. Turn the loop into an async generator and give it to `pipeline`, and the backpressure, the error propagation and the cleanup come with it. Manual `write()` with `'drain'` is for the few places that cannot be shaped that way, such as a single connection pushing server events from several sources at once.

The thing to do tomorrow is a search. Find every `.write(` in your codebase whose return value goes nowhere, and for each one, ask what happens to memory if whatever is on the other end stops reading for a minute.

## Sources

- Node.js docs, Stream: `write()`, `'drain'`, `pipe()` error caveat, `pipeline()`, default `highWaterMark`: https://nodejs.org/api/stream.html
- Node.js pull request 52037, "bump default highWaterMark" (v22.0.0): https://github.com/nodejs/node/pull/52037
- Node.js docs, HTTP, `response.write()` return value: https://nodejs.org/api/http.html
- RFC 9293, Transmission Control Protocol, section 3.8.6 on window management: https://www.rfc-editor.org/rfc/rfc9293
- Measurements in the tables: my scripts on Node 22.22.3 on macOS, shown in full or in part above.
