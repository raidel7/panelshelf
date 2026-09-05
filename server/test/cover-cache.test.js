"use strict";

const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { CoverCacheStore, budgetFromEnv } = require("../src/cover-cache");

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

  assert.deepEqual(created.stats(), {
    comics: 2,
    covers: 2,
    thumbnails: 1,
    bytes: 775_500,
    budgetBytes: 4096 * 1024 * 1024,
    evicted: 0
  });
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

test("reconciling drops entries for comics that have left the library", async (t) => {
  // Without this the record grows forever: a comic deleted from disk keeps its
  // entry and its files, and the storage figure in settings counts covers for
  // comics that are gone.
  const { created } = await store(t);
  await created.record("abc", "fp1_aaa", ENTRY);
  await created.record("def", "fp1_bbb", {
    cover: { file: "def.jpg", mime: "image/jpeg", width: 10, height: 10, bytes: 10 },
    thumbnail: { file: "def.thumb.jpg", mime: "image/jpeg", width: 5, height: 5, bytes: 5 }
  });

  const orphaned = await created.reconcile([{ id: "abc" }]);

  assert.deepEqual(
    orphaned.sort(),
    ["def.jpg", "def.thumb.jpg"],
    "reports every file the caller should now delete"
  );
  assert.equal(created.get("def", "fp1_bbb"), null, "the departed comic is forgotten");
  assert.ok(created.get("abc", "fp1_aaa"), "the surviving comic is untouched");
  assert.equal(created.stats().comics, 1);
});

test("reconciling a library that lost nothing rewrites nothing", async (t) => {
  const { created } = await store(t);
  await created.record("abc", "fp1_aaa", ENTRY);

  assert.deepEqual(await created.reconcile([{ id: "abc" }]), []);
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

// --- The ceiling -----------------------------------------------------------
//
// Cached covers are pure derived data, so the only question a ceiling has to
// answer is which ones to give up. These fix that order, because getting it
// wrong is invisible until a shelf is slow.

async function bounded(t, budgetBytes) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-covers-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const created = new CoverCacheStore(directory, { budgetBytes });
  await created.initialize();
  return { created, directory };
}

// A cover is roughly fifteen times its thumbnail, which is the ratio the
// eviction order turns on. These keep that shape and drop three zeroes.
function pair(id) {
  return {
    cover: { file: `${id}.jpg`, mime: "image/jpeg", width: 1988, height: 3056, bytes: 1000 },
    thumbnail: {
      file: `${id}.thumb.jpg`,
      mime: "image/jpeg",
      width: 312, height: 480, bytes: 100
    }
  };
}

async function fill(created, ids) {
  for (const id of ids) await created.record(id, `fp_${id}`, pair(id));
}

// Recording stamps the current millisecond, and several records inside one
// millisecond tie. Eviction order is the thing under test, so it is set here
// rather than raced for.
function age(created, order) {
  order.forEach((id, index) => {
    created.entries.get(id).usedAt = 1_000 + index;
  });
}

test("a cache inside its ceiling gives up nothing", async (t) => {
  const { created } = await bounded(t, 10_000);
  await fill(created, ["a", "b", "c"]);

  assert.deepEqual(await created.evict(), []);
  assert.equal(created.stats().covers, 3);
});

test("a cache with no ceiling never evicts", async (t) => {
  // What every build before this one did, and still a defensible choice on a
  // machine with a spare terabyte.
  const { created } = await bounded(t, 0);
  await fill(created, ["a", "b", "c"]);

  assert.deepEqual(await created.evict(), []);
  assert.equal(created.stats().budgetBytes, 0);
});

test("the least recently used cover is the first to go", async (t) => {
  const { created } = await bounded(t, 2500);
  await fill(created, ["a", "b", "c"]);
  age(created, ["b", "c", "a"]);

  const dropped = await created.evict();

  assert.deepEqual(dropped, ["b.jpg", "c.jpg"], "coldest first, warmest kept");
  assert.equal(created.get("a", "fp_a").cover.file, "a.jpg", "the warmest cover stayed");
  assert.equal(created.get("b", "fp_b").cover, undefined);
});

test("full covers are given up before thumbnails", async (t) => {
  // Not what a plain least-recently-used cache would do. A thumbnail is the
  // shelf and a full cover is one detail view, so fifteen detail views is the
  // right price for a card that still draws instantly.
  const { created } = await bounded(t, 2500);
  await fill(created, ["a", "b", "c"]);
  age(created, ["a", "b", "c"]);

  const dropped = await created.evict();

  assert.equal(dropped.every((file) => !file.includes("thumb")), true, dropped.join(", "));
  assert.equal(created.stats().thumbnails, 3, "every thumbnail survived");
});

test("thumbnails go only once giving up every cover was not enough", async (t) => {
  const { created } = await bounded(t, 250);
  await fill(created, ["a", "b", "c"]);
  age(created, ["a", "b", "c"]);

  const dropped = await created.evict();

  assert.equal(created.stats().covers, 0, "every cover went first");
  assert.equal(dropped.includes("a.thumb.jpg"), true, "then the coldest thumbnail");
  assert.equal(created.stats().thumbnails, 2, "and no more than needed");
});

test("eviction lands under the ceiling rather than exactly on it", async (t) => {
  // Stopping at the ceiling means the next cover written goes over it again,
  // and the cache spends the rest of its life sweeping.
  const { created } = await bounded(t, 2500);
  await fill(created, ["a", "b", "c"]);

  await created.evict();

  assert.ok(created.stats().bytes < 2500, `saw ${created.stats().bytes}`);
  assert.deepEqual(await created.evict(), [], "and settles there");
});

test("reading a cover saves it from the next eviction", async (t) => {
  // The whole point of tracking use. `get` touches in memory, and that touch
  // is what decides this.
  const { created } = await bounded(t, 2500);
  await fill(created, ["a", "b", "c"]);
  age(created, ["a", "b", "c"]);

  created.get("a", "fp_a");

  const dropped = await created.evict();
  assert.equal(dropped.includes("a.jpg"), false, "the one just read was spared");
  assert.deepEqual(dropped, ["b.jpg", "c.jpg"]);
});

test("a comic that cannot be thumbnailed keeps its entry when its files go", async (t) => {
  // That flag is what stops the server paying again for a decode already known
  // to fail. It occupies no disk and is the one thing here that is not cheap to
  // rebuild.
  const { created } = await bounded(t, 100);
  await created.record("a", "fp_a", { ...pair("a"), thumbnailUnsupported: true });
  await fill(created, ["b"]);

  await created.evict();

  const entry = created.get("a", "fp_a");
  assert.ok(entry, "the entry outlived both of its files");
  assert.equal(entry.thumbnailUnsupported, true);
  assert.equal(entry.cover, undefined);
});

test("what the cache reports adds up after an eviction", async (t) => {
  const { created } = await bounded(t, 2500);
  await fill(created, ["a", "b", "c"]);
  age(created, ["a", "b", "c"]);

  const dropped = await created.evict();
  const stats = created.stats();

  assert.equal(stats.evicted, dropped.length);
  assert.equal(stats.covers, 1);
  assert.equal(stats.thumbnails, 3);
  assert.equal(stats.bytes, 1000 + 3 * 100, "the totals were rebuilt, not drifted");
});

test("when a cover was last used survives a restart", async (t) => {
  // Otherwise the first eviction after every restart picks at random.
  const { created, directory } = await bounded(t, 10_000);
  await fill(created, ["a", "b"]);
  age(created, ["a", "b"]);
  await created.record("c", "fp_c", pair("c"));

  const reopened = new CoverCacheStore(directory, { budgetBytes: 2500 });
  await reopened.initialize();
  const dropped = await reopened.evict();

  assert.deepEqual(dropped, ["a.jpg", "b.jpg"], "the order came back with it");
});

test("an entry written before use was tracked is not treated as the coldest", async (t) => {
  // An upgrade must not present the entire existing cache as never-used and
  // throw it away on the first cover written after it.
  const { created, directory } = await bounded(t, 10_000);
  await fill(created, ["a"]);
  const raw = JSON.parse(await fsp.readFile(path.join(directory, "covers.json"), "utf8"));
  delete raw.entries.a.usedAt;
  await fsp.writeFile(path.join(directory, "covers.json"), JSON.stringify(raw));

  const reopened = new CoverCacheStore(directory, { budgetBytes: 10_000 });
  await reopened.initialize();

  assert.ok(reopened.get("a", "fp_a").usedAt > 0, "treated as used now, not never");
});

test("the ceiling is read from the environment in megabytes", async () => {
  assert.equal(budgetFromEnv({ PANELSHELF_COVER_CACHE_MB: "512" }), 512 * 1024 * 1024);
  assert.equal(budgetFromEnv({ PANELSHELF_COVER_CACHE_MB: "0" }), 0, "zero means no ceiling");
  assert.equal(budgetFromEnv({}), 4096 * 1024 * 1024, "a default that bounds without pinching");
});

test("a ceiling that is not a number falls back rather than disabling itself", async () => {
  // Reading rubbish as zero would silently turn the ceiling off, which is the
  // one outcome somebody setting it did not want.
  const warnings = [];
  const warn = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    assert.equal(
      budgetFromEnv({ PANELSHELF_COVER_CACHE_MB: "lots" }),
      4096 * 1024 * 1024
    );
    assert.equal(budgetFromEnv({ PANELSHELF_COVER_CACHE_MB: "-5" }), 4096 * 1024 * 1024);
  } finally {
    console.warn = warn;
  }
  assert.equal(warnings.length, 2, "and says so");
});

test("two sweeps at once do not take twice what was needed", async (t) => {
  // Covers are generated two at a time, so two can finish close enough together
  // that both sweep. Sized against the same starting total, they would each
  // shed the whole overage — which from outside looks like a cache that empties
  // itself whenever the server is busy.
  const { created } = await bounded(t, 2500);
  await fill(created, ["a", "b", "c"]);
  age(created, ["a", "b", "c"]);

  const [first, second] = await Promise.all([created.evict(), created.evict()]);

  assert.deepEqual(first, ["a.jpg", "b.jpg"], "one sweep did the work");
  assert.deepEqual(second, [], "the other stood aside");
  assert.equal(created.stats().covers, 1, "one cover was kept, not none");
  assert.ok(created.stats().bytes <= 2500);
});
