"use strict";

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");

const {
  ThumbnailPool,
  defaultPoolSize
} = require("../src/thumbnail-pool");
const {
  UnsupportedImageError,
  createThumbnail
} = require("../src/thumbnail");
const { ONE_PIXEL_PNG, pngBuffer } = require("./helpers");

// Big enough that one thumbnail is unmistakably expensive. The whole point of
// the pool is that this cost stops landing on the event loop, and a cheap
// image could not tell the difference.
const COVER = pngBuffer(1600, 2400);

// How many turns the event loop got while something else was happening.
//
// Counting the turns rather than timing them is deliberate. The obvious
// version of this — record how late each tick ran, assert the worst is small —
// cannot see the bug at all: when the loop is held for the whole run the timer
// never fires even once, and a maximum over no samples is zero. A test that
// measures lateness passes most convincingly exactly when the server is most
// completely stuck.
function watchEventLoop() {
  let turns = 0;
  const timer = setInterval(() => {
    turns += 1;
  }, 20);
  timer.unref();
  return {
    stop() {
      clearInterval(timer);
      return turns;
    }
  };
}

test("a pooled thumbnail is the same thumbnail", async (t) => {
  const pool = new ThumbnailPool();
  t.after(() => pool.close());

  const expected = createThumbnail(COVER);
  const actual = await pool.createThumbnail(COVER);

  assert.equal(actual.mime, expected.mime);
  assert.equal(actual.width, expected.width);
  assert.equal(actual.height, expected.height);
  assert.ok(Buffer.isBuffer(actual.buffer), "a Buffer, not a raw ArrayBuffer");
  assert.deepEqual(actual.buffer, expected.buffer, "byte for byte");
});

test("generating covers does not block the server", async (t) => {
  const pool = new ThumbnailPool({ size: 2 });
  t.after(() => pool.close());

  // Warm the workers first: spawning one is a cost of its own and is not what
  // this test is about.
  await pool.createThumbnail(ONE_PIXEL_PNG);

  const watch = watchEventLoop();
  const started = Date.now();
  await Promise.all([
    pool.createThumbnail(COVER),
    pool.createThumbnail(COVER),
    pool.createThumbnail(COVER),
    pool.createThumbnail(COVER)
  ]);
  const elapsed = Date.now() - started;
  const turns = watch.stop();

  // The work has to have been real, or the assertion below proves nothing.
  assert.ok(elapsed > 100, `four covers should take real time, took ${elapsed}ms`);
  // Built on this thread the four run end to end without yielding once and
  // this count is zero — which is what the NAS showed as an /api/health request
  // taking 8.7 seconds. A quarter of the ticks that fit is a wide margin
  // around "the server was still answering".
  assert.ok(
    turns > elapsed / 80,
    `the loop got ${turns} turns while ${elapsed}ms of covers were made`
  );
});

test("the work is spread across workers rather than serialized", async (t) => {
  const pool = new ThumbnailPool({ size: 3 });
  t.after(() => pool.close());

  // Asserted on the pool's own state rather than with a stopwatch: how much
  // faster three threads are than one depends on the cores of whatever machine
  // is running the tests, and a build box with one core would fail a timing
  // comparison while behaving perfectly correctly.
  const working = Promise.all([
    pool.createThumbnail(COVER),
    pool.createThumbnail(COVER),
    pool.createThumbnail(COVER)
  ]);
  const during = pool.stats();
  assert.equal(during.workers, 3, "three covers at once means three threads");
  assert.equal(during.busy, 3, "and all three are carrying one");

  const thumbnails = await working;
  assert.equal(thumbnails.length, 3);
  assert.ok(thumbnails.every((thumbnail) => thumbnail.buffer.length > 0));
  assert.equal(pool.stats().busy, 0, "and none of them afterwards");
});

test("a cover already small enough comes back as nothing to do", async (t) => {
  const pool = new ThumbnailPool();
  t.after(() => pool.close());
  assert.equal(await pool.createThumbnail(pngBuffer(200, 300)), null);
  assert.equal(await pool.createThumbnail(ONE_PIXEL_PNG), null);
});

test("a format the decoder cannot read still says so", async (t) => {
  const pool = new ThumbnailPool();
  t.after(() => pool.close());
  // RIFF/WEBP: a real header the pure-JavaScript decoder does not handle.
  const webp = Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.alloc(4),
    Buffer.from("WEBPVP8 "),
    Buffer.alloc(16)
  ]);
  await assert.rejects(() => pool.createThumbnail(webp), UnsupportedImageError);
  // And the pool survives it: the worker is not left poisoned.
  assert.ok(await pool.createThumbnail(COVER));
});

test("a pool of no workers still makes thumbnails", async (t) => {
  // The fallback path, which is also what a machine that cannot start a
  // worker thread gets. It must produce the same answer, blocking or not.
  const pool = new ThumbnailPool({ size: 0 });
  t.after(() => pool.close());
  const thumbnail = await pool.createThumbnail(COVER);
  assert.deepEqual(thumbnail.buffer, createThumbnail(COVER).buffer);
  assert.equal(pool.stats().size, 0);
});

test("workers are started on demand and given back when idle", async (t) => {
  const pool = new ThumbnailPool({ size: 2, idleMs: 60 });
  t.after(() => pool.close());

  assert.equal(pool.stats().workers, 0, "an idle server holds no threads");
  await pool.createThumbnail(ONE_PIXEL_PNG);
  assert.ok(pool.stats().workers > 0, "the first cover starts one");

  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(pool.stats().workers, 0, "and a quiet minute gives it back");

  // Still usable afterwards: the next cover starts a worker again.
  assert.ok(await pool.createThumbnail(COVER));
});

test("closing a pool with work outstanding does not lose the answers", async (t) => {
  const pool = new ThumbnailPool({ size: 2 });
  const pending = Promise.all([
    pool.createThumbnail(COVER),
    pool.createThumbnail(COVER)
  ]);
  const thumbnails = await pending;
  await pool.close();
  assert.equal(thumbnails.length, 2);
  assert.ok(thumbnails.every((thumbnail) => thumbnail.buffer.length > 0));
  assert.equal(pool.stats().workers, 0);
  t.after(() => pool.close());
});

test("a thumbnail still arrives when nothing else is holding the loop open", async () => {
  // Has to run in a process of its own: the test runner's own handles keep the
  // loop alive, which is exactly what hides this.
  //
  // Worker threads are unref'd so an idle server does not hold the process
  // open. Left that way while one is working, an awaited thumbnail is simply
  // dropped — the loop drains, the process exits 0, and the promise never
  // settles. Under `node --test` that reads as tests "cancelled" rather than
  // failed, with nothing to say which assertion was to blame.
  const source = `
    const { ThumbnailPool } = require(${JSON.stringify(path.resolve(__dirname, "../src/thumbnail-pool.js"))});
    const { pngBuffer } = require(${JSON.stringify(path.resolve(__dirname, "helpers.js"))});
    const pool = new ThumbnailPool({ size: 2 });
    pool.createThumbnail(pngBuffer(1600, 2400)).then((thumbnail) => {
      console.log("ANSWERED " + thumbnail.buffer.length);
      return pool.close();
    });
  `;
  const { stdout } = await promisify(execFile)(process.execPath, ["-e", source]);
  assert.match(stdout, /ANSWERED \d+/, "the process exited before the answer came back");
});

test("the pool is sized for the machine it is on", () => {
  // A NAS with cores and memory to spare: leave the event loop a core, and
  // stop at four — past that the gain is small and each worker is another
  // full-size page held in memory.
  assert.equal(defaultPoolSize({}, { cpus: 8, memoryBytes: 8 * 1024 ** 3 }), 4);
  assert.equal(defaultPoolSize({}, { cpus: 4, memoryBytes: 8 * 1024 ** 3 }), 3);
  assert.equal(defaultPoolSize({}, { cpus: 2, memoryBytes: 8 * 1024 ** 3 }), 1);
  assert.equal(defaultPoolSize({}, { cpus: 1, memoryBytes: 8 * 1024 ** 3 }), 1);

  // A value ARM box: cores it may have, memory it does not, and a full-size
  // page per worker is the thing that would put it into swap.
  assert.equal(defaultPoolSize({}, { cpus: 4, memoryBytes: 512 * 1024 ** 2 }), 1);
  assert.equal(defaultPoolSize({}, { cpus: 8, memoryBytes: 2 * 1024 ** 3 }), 2);

  // And the owner can say otherwise, including saying none at all.
  const machine = { cpus: 8, memoryBytes: 8 * 1024 ** 3 };
  assert.equal(defaultPoolSize({ PANELSHELF_THUMBNAIL_WORKERS: "1" }, machine), 1);
  assert.equal(defaultPoolSize({ PANELSHELF_THUMBNAIL_WORKERS: "0" }, machine), 0);
  assert.equal(defaultPoolSize({ PANELSHELF_THUMBNAIL_WORKERS: "" }, machine), 4);
  assert.equal(
    defaultPoolSize({ PANELSHELF_THUMBNAIL_WORKERS: "nonsense" }, machine),
    4,
    "a setting nobody can parse is not a reason to stop making thumbnails"
  );
  assert.equal(defaultPoolSize({ PANELSHELF_THUMBNAIL_WORKERS: "-3" }, machine), 4);
});
