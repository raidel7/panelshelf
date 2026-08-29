"use strict";

const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { CoverCacheStore } = require("../src/cover-cache");

async function store(t) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-covers-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const created = new CoverCacheStore(directory);
  await created.initialize();
  return { created, directory };
}

const ENTRY = {
  cover: { file: "abc.jpg", mime: "image/jpeg", width: 1988, height: 3056, bytes: 774_000 }
};

test("a comic with nothing cached has no entry", async (t) => {
  const { created } = await store(t);
  assert.equal(created.get("abc", "fp1_aaa"), null);
});

test("a recorded entry comes back for the fingerprint it was built from", async (t) => {
  const { created } = await store(t);
  await created.record("abc", "fp1_aaa", ENTRY);

  const found = created.get("abc", "fp1_aaa");
  assert.equal(found.cover.file, "abc.jpg");
  assert.equal(found.cover.mime, "image/jpeg");
  assert.equal(found.cover.width, 1988);
  assert.equal(found.cover.height, 3056);
});

test("an entry built from a different fingerprint is not served", async (t) => {
  // The whole point of recording the fingerprint. An archive that was replaced
  // in place — same path, same name, possibly the same mtime after a copy —
  // must not keep showing the cover of the comic it replaced.
  const { created } = await store(t);
  await created.record("abc", "fp1_aaa", ENTRY);

  assert.equal(created.get("abc", "fp1_bbb"), null);
});

test("entries survive a restart", async (t) => {
  // Item 5 of the milestone: the cache is worthless if a service restart makes
  // the NAS redecode every cover it already has on disk.
  const { created, directory } = await store(t);
  await created.record("abc", "fp1_aaa", ENTRY);

  const reopened = new CoverCacheStore(directory);
  await reopened.initialize();
  assert.equal(reopened.get("abc", "fp1_aaa").cover.file, "abc.jpg");
});

test("a corrupt cache file resets rather than refusing to start", async (t) => {
  const { created, directory } = await store(t);
  await created.record("abc", "fp1_aaa", ENTRY);
  await fsp.writeFile(path.join(directory, "covers.json"), "{ not json");

  const reopened = new CoverCacheStore(directory);
  await reopened.initialize();
  assert.equal(reopened.get("abc", "fp1_aaa"), null, "starts empty rather than throwing");

  const preserved = (await fsp.readdir(directory)).filter((name) =>
    name.startsWith("covers.json.corrupt-")
  );
  assert.equal(preserved.length, 1, "the bad file is kept for inspection");
});

test("stats report what the cache is costing", async (t) => {
  // What Library settings shows: how many covers are cached and roughly what
  // they occupy, so the cache is not an unexplained lump of disk.
  const { created } = await store(t);
  await created.record("abc", "fp1_aaa", ENTRY);
  await created.record("def", "fp1_bbb", {
    cover: { file: "def.jpg", mime: "image/jpeg", width: 10, height: 10, bytes: 1_000 },
    thumbnail: { file: "def.thumb.jpg", mime: "image/jpeg", width: 5, height: 5, bytes: 500 }
  });

  assert.deepEqual(created.stats(), { comics: 2, covers: 2, thumbnails: 1, bytes: 775_500 });
});

test("a comic that cannot be thumbnailed is remembered across a restart", async (t) => {
  // Today this lives in an in-memory Set, so every restart re-attempts a decode
  // that is already known to fail, for every such comic, on NAS CPU.
  const { created, directory } = await store(t);
  await created.record("abc", "fp1_aaa", { ...ENTRY, thumbnailUnsupported: true });

  const reopened = new CoverCacheStore(directory);
  await reopened.initialize();
  assert.equal(reopened.get("abc", "fp1_aaa").thumbnailUnsupported, true);
});

test("forgetting a comic drops its entry", async (t) => {
  const { created } = await store(t);
  await created.record("abc", "fp1_aaa", ENTRY);
  await created.forget("abc");

  assert.equal(created.get("abc", "fp1_aaa"), null);
});

const { CoverWarmup } = require("../src/cover-cache");

function comics(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `comic-${index}`,
    title: `Issue ${index}`
  }));
}

function warmup(options = {}) {
  const warmed = [];
  const job = new CoverWarmup({
    listComics: options.listComics || (() => comics(3)),
    warm:
      options.warm ||
      (async (comic) => {
        warmed.push(comic.id);
        return true;
      })
  });
  return { job, warmed };
}

test("a warm-up that has never run reports idle", () => {
  const { job } = warmup();
  const state = job.state();
  assert.equal(state.status, "idle");
  assert.equal(state.total, 0);
  assert.equal(state.processed, 0);
});

test("a warm-up generates every cover and reports what it did", async () => {
  const { job, warmed } = warmup();

  job.start();
  await job.settled();

  assert.deepEqual(warmed, ["comic-0", "comic-1", "comic-2"]);
  const state = job.state();
  assert.equal(state.status, "complete");
  assert.equal(state.total, 3);
  assert.equal(state.processed, 3);
  assert.equal(state.generated, 3);
  assert.equal(state.failed, 0);
});

test("covers already cached are counted apart from ones generated", async () => {
  // The distinction the settings panel needs: a second run over a warm library
  // should report that it found nothing to do, not that it did the work again.
  const { job } = warmup({ warm: async () => false });

  job.start();
  await job.settled();

  const state = job.state();
  assert.equal(state.generated, 0);
  assert.equal(state.alreadyCached, 3);
  assert.equal(state.processed, 3);
});

test("a comic that cannot be read does not stop the run", async () => {
  // One unreadable archive in a library of thousands must not abandon the rest.
  const { job } = warmup({
    warm: async (comic) => {
      if (comic.id === "comic-1") throw new Error("archive is unreadable");
      return true;
    }
  });

  job.start();
  await job.settled();

  const state = job.state();
  assert.equal(state.status, "complete");
  assert.equal(state.processed, 3);
  assert.equal(state.generated, 2);
  assert.equal(state.failed, 1);
});

test("starting a warm-up that is already running is refused", async () => {
  const { job } = warmup({
    listComics: () => comics(50),
    warm: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return true;
    }
  });

  job.start();
  assert.throws(() => job.start(), /already running/i);
  job.cancel();
  await job.settled();
});

test("cancelling stops a warm-up partway through", async () => {
  let seen = 0;
  const { job } = warmup({
    listComics: () => comics(500),
    warm: async () => {
      seen += 1;
      if (seen === 5) job.cancel();
      return true;
    }
  });

  job.start();
  await job.settled();

  const state = job.state();
  assert.equal(state.status, "cancelled");
  assert.ok(state.processed < 500, `stopped early, processed ${state.processed}`);
  assert.ok(state.processed >= 5, "did the work it had already started");
});
