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

I was working through the [stream module in the Node.js docs](https://beta.docs.nodejs.org/stream), and the API reference kept raising one question it does not answer: where does this show up in production? Readable, Writable, `highWaterMark` and `'drain'` read like abstractions until you attach them to a job a real server does. So I listed the jobs. I have run into some of them myself, and the rest are the same pattern in a different place. These are the production cases this post works through, each with code that I ran:

- [Exporting a large table to CSV](#exporting-a-table-to-csv), where the disk sets the pace of the database queries.
- [Serving a file download to a slow client](#a-download-to-a-slow-phone), where one stalled connection can hold hundreds of megabytes.
- [Accepting an upload and compressing it to disk](#an-upload-to-disk), where a slow disk ends up pausing the client's network sends.
- [Processing a log file too big to load](#transforms-pass-the-signal-through), line by line, through a Transform.
- [Importing records into a database in batches](#batching-inserts-into-a-database), with a custom Writable that waits for each insert.
- [Feeding a child process and writing to stdout](#child-processes-and-stdout), which covers tools such as `gzip` and `ffmpeg` and logging under a pipe.

All six depend on one boolean, so that is where to start.

Most Node.js code that writes to a stream looks like this:

```js
for (const row of rows) {
  out.write(toCsvLine(row));
}
out.end();
```

It works on a laptop, with a small file, every time. It also discards the only thing `write()` tells you. `write()` returns a boolean, and that boolean is the whole flow-control protocol of Node streams. The Node docs put it plainly: it returns `false` "if the stream wishes for the calling code to wait for the `'drain'` event to be emitted before continuing to write additional data".

Two things the `false` does not mean, because both are common readings:

- It does not mean the chunk was rejected. The chunk you just passed is accepted and queued. Nothing is lost.
- It does not mean an error happened. Errors arrive through the `'error'` event and the write callback, not through this boolean.

It means one thing: the stream's internal queue is now at or over its limit, and if you keep writing, the queue keeps growing in your process's memory. That is called backpressure. The consumer (a disk, a socket, a database) is slower than the producer (your loop), and the boolean is how the consumer pushes back.

To see what ignoring it costs, I wrote a Writable that takes 1 ms to accept each chunk, a stand-in for a slow disk or a slow network peer, and fed it 20,000 chunks of 1 KiB two ways. Once ignoring the return value, once waiting for `'drain'` whenever it said `false`. `writableLength` is the number of bytes currently sitting in the stream's queue.

```js
const { Writable } = require('node:stream');
const { once } = require('node:events');

const slowSink = () => new Writable({
  write(chunk, encoding, callback) { setTimeout(callback, 1); },
});
const CHUNK = Buffer.alloc(1024);

async function ignore() {
  const w = slowSink();
  let max = 0;
  for (let i = 0; i < 20000; i++) {
    w.write(CHUNK);
    max = Math.max(max, w.writableLength);
  }
  w.end();
  console.log('ignored:', max);
}

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

On Node 22:

| Run | Peak bytes queued | `write()` calls that returned `false` |
|---|---|---|
| Ignored | 20,480,000 | 19,937 |
| Respected | 64,512 | not counted |

The ignoring loop queued every single byte it produced, all 20 MB, because the loop finishes in a few milliseconds and the sink needs at least 20 seconds to accept it all. The stream said `false` almost twenty thousand times. The respecting loop never held more than about 63 KiB, one chunk short of the stream's limit. Same data, same sink, roughly the same total time. The only difference is whether the memory lives in the queue or nowhere.

Twenty megabytes is harmless. Make it a 4 GB export, or a thousand concurrent connections each with its own queue, and it is the process getting killed by the out-of-memory killer at 3 a.m.

## Four kinds of stream and one threshold

Before the real cases, the vocabulary, because every case below is these pieces wired differently.

A Readable is a source you pull data from: a file being read, an incoming HTTP request, the stdout of a child process. A Writable is a sink you push data into: a file being written, an HTTP response, a socket, the stdin of a child process. A Duplex is both at once with independent sides, like a TCP socket, where what you write and what you read are unrelated. A Transform is a Duplex where the output is computed from the input, like gzip: bytes go in one side, compressed bytes come out the other.

Every Readable and every Writable has an internal buffer, a queue of chunks waiting to move on. A Writable's queue holds chunks you wrote that the underlying resource has not accepted yet. A Readable's queue holds chunks the resource produced that nobody has consumed yet. A Transform has both.

The `highWaterMark` is the threshold on that queue. It is not a hard limit; nothing stops you from writing past it, as the table above shows. It is the level at which the stream starts saying `false`. The docs describe the return value as `true` "if the internal buffer is less than the `highWaterMark` configured when the stream was created after admitting `chunk`". Note "after admitting chunk": the chunk is queued first, then the comparison happens. That is why a single write of a chunk larger than the mark returns `false` on the very first call:

```js
const w = slowSink();
w.write(Buffer.alloc(100 * 1024)); // false: 100 KiB is past a 64 KiB mark
w.writableNeedDrain;               // true: 'drain' is coming
```

The unit of the mark depends on the mode. A normal stream counts bytes. A stream created with `objectMode: true` carries arbitrary JavaScript values (rows, events, parsed JSON) and counts objects instead, because "how many bytes is this object" has no cheap answer.

The defaults changed recently, and a lot of articles still carry the old ones. Since Node 22.0.0 (pull request 52037, "bump default highWaterMark"), `stream.getDefaultHighWaterMark()` returns:

| Stream | Default `highWaterMark` |
|---|---|
| Byte stream, Linux and macOS | 65,536 bytes (64 KiB) |
| Byte stream, Windows | 16,384 bytes (16 KiB) |
| `objectMode` stream | 16 objects |

Before 22 the byte default was 16 KiB everywhere except file read streams, which have used 64 KiB for a long time. If you need a different process-wide default, `stream.setDefaultHighWaterMark()` exists. Per stream, pass `highWaterMark` to the constructor.

Three properties let you inspect the state at any moment, and they are the ones to log when you suspect a backpressure problem: `writable.writableLength` (bytes or objects queued now), `writable.writableHighWaterMark` (the mark), and `writable.writableNeedDrain` (true when the stream has said `false` and a `'drain'` is pending).

## Respecting the signal by hand

![The feedback loop. A producer, either a loop or a Readable, calls write on a Writable whose internal buffer is filling past the highWaterMark mark, while a slow sink such as a disk or socket empties it. An arrow back to the producer says false means the buffer is at or past the mark and the producer should stop. A second arrow underneath says the drain event means the buffer emptied and the producer can resume.](diagram:node-streams-signal-loop)

The protocol is small. Write until `write()` returns `false`. Then stop and wait for the `'drain'` event, which the stream emits once its queue has emptied. Then continue. `'drain'` only fires after a `false`; if you never got one, do not wait for it, or you will wait forever.

With `async`/`await`, `events.once()` turns the event into a promise and the loop reads naturally:

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

`'finish'` fires after `end()` has been called and every queued chunk has been handed to the underlying resource, so awaiting it means "the file is actually written", not just "I stopped calling write".

The callback style is what you will meet in older code and in the Node docs. It is the same idea with the loop turned inside out, because you cannot `await` inside a plain loop:

```js
function writeAll(out, rows, done) {
  let i = 0;
  function pump() {
    let ok = true;
    while (i < rows.length && ok) {
      ok = out.write(toCsvLine(rows[i++]));
    }
    if (i < rows.length) {
      out.once('drain', pump);
    } else {
      out.end(done);
    }
  }
  pump();
}
```

One caveat about the `await once(out, 'drain')` version: if the stream errors while you are waiting, `once` rejects with that error, which is what you want. But a stream that errors outside that window emits `'error'` with nobody listening, and an unhandled `'error'` crashes the process. Hand-rolled writing means hand-rolled error handling too. That is the strongest argument for the next section.

## Let pipeline do it

Most of the time you do not write in a loop at all. You have a source and a sink, and you connect them. Node has two ways, and the difference matters more than any other detail in this post.

`readable.pipe(writable)` is the old one. It does the backpressure dance for you: when the destination's `write()` returns `false`, `pipe` pauses the source, and on `'drain'` it resumes it. What it does not do is clean up on failure. The docs say it directly: "if the `Readable` stream emits an error during processing, the `Writable` destination is not closed automatically". I checked it with a source that fails on its first read, piped into a file stream:

```
pipe():     after source error, destination destroyed? false, file descriptor open? true
pipeline(): rejected with "boom", destination destroyed? true
```

Every failed `pipe()` like that leaks an open file descriptor. Do it on a busy server and you eventually hit the process's descriptor limit, and then even `accept()` on new connections starts failing with `EMFILE`.

`stream.pipeline()` does the same backpressure handling and, on error, calls `destroy(err)` on every stream in the chain that has not already finished, then reports the error once. The promise version from `node:stream/promises` fits `async` code:

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

Three streams, two buffers between them, and one `await` that either resolves when the last byte is on disk or rejects with the first error, after everything is closed. I would not use `pipe()` in new code. The only thing it does better is chaining syntax, and that is not worth a descriptor leak.

`pipeline` also accepts things that are not streams. An async iterable, including an async generator function, can be the source. An async generator function that takes the previous stage as its argument can be a middle stage. Both come up in the cases below.

## Exporting a table to CSV

The case: a "download all orders" feature. The table has millions of rows. Loading them into an array first is the obvious version and the wrong one, because the array is the whole table in memory.

Write the source as an async generator that reads in pages and yields one line at a time:

```js
const { pipeline } = require('node:stream/promises');
const fs = require('node:fs');

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

The backpressure here is invisible and complete. `pipeline` pulls one value from the generator, writes it, and if the write returns `false`, it waits for `'drain'` before pulling the next. While it waits, the generator is suspended at its `yield`. A suspended generator is not running the `while` loop, so it is not issuing the next `SELECT`. The disk's speed sets the pace of the database queries, without a single line of flow-control code.

The query uses `WHERE id > $1 ORDER BY id`, called keyset pagination, rather than `OFFSET`. With `OFFSET 900000` the database has to walk past 900,000 rows to return the next thousand, so each page gets slower than the last. `WHERE id > last_seen` jumps straight there through the primary key index. It is unrelated to streams, but a streaming export with `OFFSET` pages degrades badly on a big table.

If your database driver offers a cursor or a native stream, such as a server-side cursor in PostgreSQL, the shape is the same: it is a Readable, and you put it first in the `pipeline`.

## A download to a slow phone

An HTTP response is a Writable. `res.write()` follows the same contract, and the HTTP docs spell out what `false` means at that layer: it returns `true` "if the entire data was flushed successfully to the kernel buffer" and `false` "if all or part of the data was queued in user memory".

"Queued in user memory" is your heap. The operating system keeps a send buffer per TCP connection. When the client is slow, on a weak mobile link for instance, that kernel buffer fills, and from then on everything you write piles up in Node's queue for that one response.

I measured it. An HTTP server sends 200 MiB in 64 KiB chunks to a client that connects, sends its request, and then stops reading. Once with a `for` loop that ignores `res.write()`'s return value, once with `pipeline` from a Readable:

| Server code | Peak `res.writableLength` | Process memory after 1.5 s |
|---|---|---|
| Loop ignoring `write()` | 200.0 MiB | 255 MiB |
| `pipeline(source, res)` | 0.1 MiB | 43 MiB |

One stalled client cost 200 MiB with the loop. A hundred of them is 20 GB. With `pipeline`, the response queue stayed near zero, the source stopped producing, and the server held almost nothing for that client. The arithmetic checks out from the other direction too: 3,200 chunks of 64 KiB is exactly 200 MiB, so the loop queued every chunk it made.

The handler I would ship:

```js
const http = require('node:http');
const fs = require('node:fs');
const { pipeline } = require('node:stream/promises');

http.createServer(async (req, res) => {
  const path = '/data/report.pdf';
  let size;
  try {
    ({ size } = await fs.promises.stat(path));
  } catch {
    res.writeHead(404).end();
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Length': size,
  });

  try {
    await pipeline(fs.createReadStream(path), res);
  } catch (err) {
    console.error('download aborted:', err.code);
  }
}).listen(3000);
```

The `stat` before the `pipeline` is there because of a sharp edge the docs call out. When `pipeline` fails, it destroys every stream in the chain, including `res`, which closes the socket. If the file did not exist, you find out inside the `pipeline` error handler, and by then you can no longer send a 404: the connection is gone. Checking the file first moves the predictable failure to a point where you can still answer properly. The `catch` around `pipeline` then only handles the unpredictable ones, mostly clients that closed the tab halfway through, and there is nobody left to answer.

That last case is the other half of why `pipeline` matters here. When the client disconnects, `res` is destroyed, `pipeline` destroys the file stream, and its descriptor is released. With a bare `pipe()`, a disconnecting client leaves the file stream open.

## An upload to disk

The reverse direction. The incoming request `req` is a Readable. The version that loads the whole body is common:

```js
const chunks = [];
req.on('data', (c) => chunks.push(c));
req.on('end', () => fs.writeFileSync(dest, Buffer.concat(chunks)));
```

A 2 GB upload is 2 GB of heap, plus a second copy during `Buffer.concat`. The streaming version, compressing on the way:

```js
const zlib = require('node:zlib');
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

The `rm` in the `catch` matters: a failed upload otherwise leaves a truncated `.gz` on disk that looks valid by name.

![Backpressure on an upload. Bytes flow right through six stages: the client, the server kernel's receive buffer, req as a Readable, gzip as a Transform, the file stream as a Writable, and a slow disk. Pressure travels left: the disk completes writes late, the file stream's write returns false, gzip's write returns false, the socket is paused, and the TCP window advertised to the client drops to zero, which stops the client sending.](diagram:node-streams-upload-chain)

This case shows how far the signal goes. Suppose the disk is the slow part. The file stream's queue fills, so its `write()` returns `false` to gzip. Gzip's output side fills, so gzip stops accepting input and its own `write()` returns `false` to `req`. `pipeline` responds by pausing `req`, which stops Node reading from the socket. Now the bytes the client keeps sending accumulate in the kernel's receive buffer for that connection. TCP has flow control built in: each acknowledgement the server's kernel sends advertises a receive window, the amount of space left in that buffer. As the buffer fills, the window shrinks, and at zero the client's kernel must stop sending. The client application's `send()` calls then block or return "would block".

So a slow disk on the server ends up pausing a program on another machine, and at no point did anything buffer without bound. That is what backpressure is for: every queue in the chain is bounded, and the slowest stage sets the pace for the whole path.

## Transforms pass the signal through

When you need to process data on the way through, you write a Transform. The case: count error lines in a log file too big to load. A file stream emits chunks of up to 64 KiB, and chunk boundaries fall wherever they fall, often in the middle of a line. So the first stage reassembles lines:

```js
const { Transform } = require('node:stream');

class Lines extends Transform {
  constructor() {
    super({ readableObjectMode: true });
    this.rest = '';
  }

  _transform(chunk, encoding, callback) {
    const parts = (this.rest + chunk).split('\n');
    this.rest = parts.pop();
    for (const line of parts) this.push(line);
    callback();
  }

  _flush(callback) {
    if (this.rest) this.push(this.rest);
    callback();
  }
}
```

The parts of that class, one at a time:

- `readableObjectMode: true` makes the output side carry strings as separate objects, one per line, while the input side stays a byte stream. Without it, the lines would be concatenated back into one byte stream and the work would be undone.
- `_transform` is called once per input chunk. `this.rest` holds the partial line left at the end of the previous chunk, so it is prepended before splitting. `parts.pop()` removes the last piece, which may be an incomplete line, and keeps it for next time.
- `this.push(line)` puts a value on the output side.
- `callback()` tells the stream "I am done with this chunk, send me the next one". It is the backpressure hook on the input side. Call it late, after an `await`, and the stream will not hand you the next chunk until you do.
- `_flush` runs once after the input ends, to emit the last line if the file did not end with a newline.

Then the pipeline, with the counting stage as an inline async generator:

```js
let errors = 0;
await pipeline(
  fs.createReadStream('app.log'),
  new Lines(),
  async function* (lines) {
    for await (const line of lines) {
      if (line.includes(' ERROR ')) errors++;
    }
    yield `errors=${errors}\n`;
  },
  process.stdout,
);
```

A question worth asking about `Lines`: it calls `callback()` straight away and ignores what `this.push()` returns. Does that break backpressure if the consumer is slow? In Node's own implementation it does not. `Transform.prototype._write` in `lib/internal/streams/transform.js` checks, after your `_transform` has called back, whether the output side's queue is still below its `highWaterMark`. If it is not, Node holds on to the input callback and only releases it when the consumer reads more. So a full output side holds the input side, the input queue fills, and the upstream `write()` returns `false`. The signal passes through your Transform without you writing any code for it.

For lines specifically, Node also ships `readline`, which does the splitting for you and works with `for await`:

```js
const readline = require('node:readline');

const rl = readline.createInterface({
  input: fs.createReadStream('app.log'),
  crlfDelay: Infinity,
});
for await (const line of rl) {
  // one line at a time
}
```

I wrote `Lines` by hand because the pattern of carrying the remainder between chunks applies to every framed format: newline-delimited JSON, CSV rows, length-prefixed binary messages. `readline` covers only the first.

## Batching inserts into a database

The case: an import job reads events from a newline-delimited JSON file and inserts them into a database. One `INSERT` per row is slow, so you batch. A custom Writable is a good place for it, because the write callback gives you the exact backpressure point you need:

```js
const { Writable } = require('node:stream');

class BatchInserter extends Writable {
  constructor(db, size = 500) {
    super({ objectMode: true, highWaterMark: size });
    this.db = db;
    this.size = size;
    this.batch = [];
  }

  _write(row, encoding, callback) {
    this.batch.push(row);
    if (this.batch.length < this.size) return callback();
    const rows = this.batch;
    this.batch = [];
    this.db.insertMany(rows).then(() => callback(), callback);
  }

  _final(callback) {
    if (this.batch.length === 0) return callback();
    this.db.insertMany(this.batch).then(() => callback(), callback);
  }
}
```

`_write` is called once per row. For the first 499 rows of a batch it calls `callback()` immediately, which tells the stream "ready for the next one". On the 500th it starts the insert and calls `callback()` only when the database confirms. Until then, the stream does not call `_write` again. Rows that arrive in the meantime queue up to the `highWaterMark`, here 500 objects, and past that, the upstream `write()` returns `false` and the file reader pauses. The database's insert speed now sets the pace of the file read.

`.then(() => callback(), callback)` covers both outcomes: success calls `callback()` with nothing, failure calls `callback(err)`, which makes the stream emit `'error'` and `pipeline` tear everything down and reject.

`_final` is called once after the input ends and before `'finish'`, which is the place to insert the last partial batch. Without it, the tail of the file is silently dropped: 1,234 rows would insert 1,000. With it, against a fake database that records batch sizes, the run gives `[500, 500, 234]`.

The wiring, with a parse stage between the lines and the inserter:

```js
await pipeline(
  fs.createReadStream('events.ndjson'),
  new Lines(),
  async function* (lines) {
    for await (const line of lines) {
      if (line) yield JSON.parse(line);
    }
  },
  new BatchInserter(db, 500),
);
```

Do not make `_write` an `async` function and also call the callback. The stream ignores the promise `_write` returns, so a rejection there becomes an unhandled rejection rather than a stream error, which is how import jobs end up "succeeding" with missing rows.

## Child processes and stdout

A child process's stdin is a Writable, and its stdout is a Readable. Feeding a large input to a tool such as `ffmpeg`, `gzip` or `psql` with `child.stdin.write()` in a loop has the same problem as every loop above: the tool reads at its own speed and the remainder queues in your process. `pipeline` handles it:

```js
const { spawn } = require('node:child_process');

const gz = spawn('gzip', ['-c']);
const done = pipeline(gz.stdout, fs.createWriteStream('dump.sql.gz'));
await pipeline(fs.createReadStream('dump.sql'), gz.stdin);
await done;
```

Two pipelines, because the data crosses a process boundary: one feeds the child, the other drains it. Start the draining one first. If nothing reads the child's stdout, the child blocks when its output pipe fills, stops reading its stdin, and the first pipeline waits forever.

`process.stdout` has its own twist. The docs list when writes to it are synchronous: to files, synchronous everywhere; to terminals, synchronous on Linux and macOS; to pipes and sockets, synchronous on Windows but asynchronous on Linux and macOS. "Asynchronous" means writes can queue in memory and `process.stdout.write()` can return `false`. A program that logs heavily in a hot loop behaves fine in your terminal, where writes are synchronous and the loop simply slows down, and accumulates memory when its stdout is a pipe: `node app.js | gzip > out.gz`, a log shipper reading your output, or, I believe, most container runtimes, which attach a pipe when there is no TTY. That last one I have not checked across runtimes, but any setup where stdout is a pipe behaves this way per the docs. If you write large output to stdout, treat it like any other Writable: check the return value or put it at the end of a `pipeline`, as the log-counting example does.

## Choosing the mark, and an opinion

A higher `highWaterMark` means larger reads and writes and fewer system calls, which helps throughput up to a point; the Node 22 bump was a throughput change. The cost is that the mark is per stream. A server holding ten thousand idle WebSocket or SSE connections pays the mark ten thousand times in the worst case. Raise it for a few big streams, such as a bulk file copy. Leave it alone for many small ones.

Raising the mark never fixes a slow consumer. It only makes the queue in front of it longer before the `false` arrives, so you find out later and with more memory in use.

My opinion, stated as strongly as I hold it: if your code calls `write()` in a loop, you have usually written a Readable by hand, without its flow control. Turn the loop into an async generator and give it to `pipeline`, and the backpressure, the error propagation and the cleanup all come with it. Manual `write()` with `'drain'` is for the few places that genuinely cannot be shaped that way, such as a single connection pushing server events from several sources at once.

The thing to do tomorrow is a search. Find every `.write(` in your codebase whose return value goes nowhere, and for each one, ask what happens to memory if whatever is on the other end stops reading for a minute.

## Sources

- Node.js docs (beta site), Stream: https://beta.docs.nodejs.org/stream
- Node.js docs, Stream: `writable.write()`, `'drain'`, `writableLength`, `writableNeedDrain`, `readable.pipe()` error caveat, `stream.pipeline()` destroy behaviour and the `IncomingMessage` example, `stream.getDefaultHighWaterMark()`: https://nodejs.org/api/stream.html
- Node.js pull request 52037, "bump default highWaterMark" (v22.0.0): https://github.com/nodejs/node/pull/52037
- Node.js docs, HTTP, `response.write()` return value: https://nodejs.org/api/http.html
- Node.js docs, Process, "A note on process I/O": https://nodejs.org/api/process.html#a-note-on-process-io
- Node.js docs, File system, `fs.createReadStream()` `highWaterMark` default: https://nodejs.org/api/fs.html
- Node.js source, `lib/internal/streams/transform.js`, `Transform.prototype._write` and `_read` (v22.x branch)
- RFC 9293, Transmission Control Protocol, section 3.8.6 on window management: https://www.rfc-editor.org/rfc/rfc9293
- Measurements in the tables: scripts run on Node 22.22.3 on macOS, reproduced in full or in part in the code blocks above.
