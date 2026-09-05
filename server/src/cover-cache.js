"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { jsonError } = require("./util");

// What each cached cover on disk actually is, and what it was built from.
//
// The cover images live in `covers/`; this is the record of them, and it earns
// its place by answering two questions the files alone cannot.
//
// A cached cover keeps the extension of the page it was taken from, and that
// extension is knowable only by opening the archive. Without a record, finding
// the file meant one `stat` per allowed extension — paid on exactly the request
// that was trying not to touch the archive at all.
//
// And validity used to be decided by comparing mtimes, which a file copy
// preserves: an archive replaced in place could keep serving the cover of the
// comic it replaced. The scan already computes a content fingerprint per comic
// for move detection, so recording which fingerprint a cover was built from
// turns the check into a string comparison against a value already in memory.
//
// Keyed on comic id. An entry for a comic that no longer exists is harmless and
// is dropped when the comic is forgotten.
//
// The record is also what makes a ceiling possible. Cached covers are pure
// derived data — every one of them can be rebuilt from its archive — so the
// only honest question is how much disk they are allowed to occupy while they
// wait to be useful. Without a bound, a hundred thousand comics is tens of
// gigabytes of first pages nobody asked to store.

async function atomicWriteJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600
  });
  await fsp.rename(temporary, filePath);
}

function image(value) {
  if (!value || typeof value !== "object") return null;
  const file = typeof value.file === "string" ? value.file : null;
  if (!file) return null;
  const number = (candidate) =>
    Number.isFinite(candidate) && candidate >= 0 ? Number(candidate) : 0;
  return {
    file,
    mime: typeof value.mime === "string" ? value.mime : "application/octet-stream",
    width: number(value.width),
    height: number(value.height),
    bytes: number(value.bytes)
  };
}

function entryFrom(value) {
  if (!value || typeof value !== "object") return null;
  const fingerprint =
    typeof value.fingerprint === "string" && value.fingerprint ? value.fingerprint : null;
  if (!fingerprint) return null;
  // When this was last worth having. Eviction needs an order, and the order
  // that matters is what the reader keeps coming back to. An entry written
  // before this field existed is treated as used now rather than never, so an
  // upgrade does not present the whole existing cache as the coldest thing in
  // it and throw it away on the first write.
  const usedAt =
    Number.isFinite(value.usedAt) && value.usedAt > 0 ? Number(value.usedAt) : Date.now();
  const cover = image(value.cover);
  const thumbnail = image(value.thumbnail);
  const thumbnailUnsupported = value.thumbnailUnsupported === true;
  // An entry that records nothing is not worth keeping: it would claim the
  // comic is cached while every lookup fell through anyway.
  if (!cover && !thumbnail && !thumbnailUnsupported) return null;
  const entry = { fingerprint, usedAt };
  if (cover) entry.cover = cover;
  if (thumbnail) entry.thumbnail = thumbnail;
  if (thumbnailUnsupported) entry.thumbnailUnsupported = true;
  return entry;
}

function entryBytes(entry) {
  let bytes = 0;
  if (entry.cover) bytes += entry.cover.bytes;
  if (entry.thumbnail) bytes += entry.thumbnail.bytes;
  return bytes;
}

// Megabytes, because that is the unit somebody setting this in a text file
// thinks in. Zero means no ceiling, which is the behaviour every build before
// this one had and is a defensible choice on a machine with a spare terabyte.
const DEFAULT_BUDGET_MB = 4096;

function budgetFromEnv(env = process.env) {
  const raw = env.PANELSHELF_COVER_CACHE_MB;
  if (raw === undefined || raw === "") return DEFAULT_BUDGET_MB * 1024 * 1024;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    console.warn(
      `PANELSHELF_COVER_CACHE_MB is not a number of megabytes (${raw}); ` +
        `using the default of ${DEFAULT_BUDGET_MB} MB.`
    );
    return DEFAULT_BUDGET_MB * 1024 * 1024;
  }
  return Math.floor(parsed) * 1024 * 1024;
}

// Evicting to exactly the ceiling means the very next cover written goes over
// it again, and the cache spends the rest of its life sweeping. Going a little
// under buys room to work.
const EVICTION_TARGET = 0.9;

class CoverCacheStore {
  constructor(dataDirectory, options = {}) {
    this.filePath = path.join(dataDirectory, "covers.json");
    this.evicting = false;
    this.entries = new Map();
    this.budgetBytes =
      options.budgetBytes === undefined ? budgetFromEnv() : Number(options.budgetBytes) || 0;
    // Kept as running totals rather than summed on demand. `stats` is polled
    // once a second while the settings panel is open and the ceiling is checked
    // on every cover written, and neither wants a walk of a hundred thousand
    // entries.
    this.bytes = 0;
    this.coverCount = 0;
    this.thumbnailCount = 0;
    this.evicted = 0;
    // Serialized like the skip and progress stores', and never left rejected:
    // one transient write failure must not disable every write after it.
    this.writeQueue = Promise.resolve();
  }

  recount() {
    this.bytes = 0;
    this.coverCount = 0;
    this.thumbnailCount = 0;
    for (const entry of this.entries.values()) {
      if (entry.cover) this.coverCount += 1;
      if (entry.thumbnail) this.thumbnailCount += 1;
      this.bytes += entryBytes(entry);
    }
  }

  async initialize() {
    let raw;
    try {
      raw = await fsp.readFile(this.filePath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.entries = new Map();
      this.recount();
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      const source = parsed?.entries;
      this.entries = new Map();
      if (source && typeof source === "object") {
        for (const [comicId, value] of Object.entries(source)) {
          const entry = entryFrom(value);
          if (entry) this.entries.set(comicId, entry);
        }
      }
    } catch {
      // Rebuildable data: every cover here can be regenerated from its archive,
      // so keep the bad file for inspection rather than refusing to start.
      const corruptPath = `${this.filePath}.corrupt-${Date.now()}`;
      try {
        await fsp.rename(this.filePath, corruptPath);
        console.warn(
          `Cover cache file ${this.filePath} is corrupt and was reset. ` +
            `The original was preserved at ${corruptPath}.`
        );
      } catch {
        console.warn(`Cover cache file ${this.filePath} is corrupt and was reset.`);
      }
      this.entries = new Map();
    }
    this.recount();
  }

  // Returns the entry only when it was built from the fingerprint being asked
  // about. Callers cannot accidentally serve a stale cover, because a stale one
  // is indistinguishable from a missing one from here.
  get(comicId, fingerprint) {
    if (!fingerprint) return null;
    const entry = this.entries.get(comicId);
    if (!entry || entry.fingerprint !== fingerprint) return null;
    // A hit is a use, and eviction sorts on this. Touched in memory only: a
    // write per cover request would cost more than the ceiling saves, and the
    // value rides out with the next write of any kind. What that risks is a
    // restart losing recent touches, which costs nothing worse than evicting a
    // slightly wrong cover — the file it drops is rebuildable either way.
    entry.usedAt = Date.now();
    return entry;
  }

  // Writing a cover counts as using it — it was generated because something
  // asked for it — so the stamp is taken here rather than carried over from
  // whatever the caller merged in.
  async record(comicId, fingerprint, value) {
    const entry = entryFrom({ ...value, fingerprint, usedAt: Date.now() });
    if (!entry) return null;
    this.uncount(this.entries.get(comicId));
    this.entries.set(comicId, entry);
    this.count(entry);
    await this.persist();
    return entry;
  }

  async forget(comicId) {
    const entry = this.entries.get(comicId);
    if (!this.entries.delete(comicId)) return;
    this.uncount(entry);
    await this.persist();
  }

  count(entry) {
    if (!entry) return;
    if (entry.cover) this.coverCount += 1;
    if (entry.thumbnail) this.thumbnailCount += 1;
    this.bytes += entryBytes(entry);
  }

  uncount(entry) {
    if (!entry) return;
    if (entry.cover) this.coverCount -= 1;
    if (entry.thumbnail) this.thumbnailCount -= 1;
    this.bytes -= entryBytes(entry);
  }

  // Drops what belongs to comics the library no longer has, and reports the
  // files that leaves behind so the caller can delete them. Called wherever the
  // enrichment store is reconciled, for the same reason: derived state that
  // outlives its comic is a slow leak, and here it is one the settings panel
  // would report as occupied disk.
  async reconcile(comics) {
    const live = new Set(comics.map((comic) => comic.id));
    const orphaned = [];
    for (const [comicId, entry] of this.entries) {
      if (live.has(comicId)) continue;
      if (entry.cover) orphaned.push(entry.cover.file);
      if (entry.thumbnail) orphaned.push(entry.thumbnail.file);
      this.entries.delete(comicId);
    }
    if (orphaned.length > 0) {
      this.recount();
      await this.persist();
    }
    return orphaned;
  }

  // Which cached files to give up to get back under the ceiling, and the order
  // to give them up in. Returns the filenames; deleting them is the caller's,
  // because only the caller knows where `covers/` is.
  //
  // Full covers go before thumbnails, which is not what a plain
  // least-recently-used cache would do. A thumbnail is the shelf: fifteen times
  // smaller, and wanted every time a card is drawn. A full cover is one detail
  // view. Trading fifteen detail views for one card that draws instantly is the
  // right way round on a machine where rebuilding either means opening an
  // archive.
  //
  // A comic that could not be thumbnailed keeps its entry even when both its
  // files go. That flag is what stops the server paying for a decode already
  // known to fail, it occupies no disk, and it is the one thing here that
  // cannot be rebuilt cheaply.
  async evict() {
    if (!this.budgetBytes || this.bytes <= this.budgetBytes) return [];
    // Covers are generated two at a time, so two of them can finish close
    // enough together that both sweep. Each would size its plan against the
    // same starting total and shed the whole overage, so together they take
    // twice what was needed — which looks from outside like a cache that keeps
    // emptying itself under load. One at a time; the other call's write has
    // already been counted, and whoever is sweeping will account for it.
    if (this.evicting) return [];
    this.evicting = true;
    try {
      return await this.sweepToBudget();
    } finally {
      this.evicting = false;
    }
  }

  async sweepToBudget() {
    const target = Math.floor(this.budgetBytes * EVICTION_TARGET);
    let projected = this.bytes;
    const plan = [];

    const sweep = (kind) => {
      if (projected <= target) return;
      const candidates = [];
      for (const [comicId, entry] of this.entries) {
        if (entry[kind]) candidates.push({ comicId, entry });
      }
      candidates.sort((a, b) => a.entry.usedAt - b.entry.usedAt);
      for (const { comicId, entry } of candidates) {
        if (projected <= target) break;
        plan.push({ comicId, kind, file: entry[kind].file });
        projected -= entry[kind].bytes;
      }
    };

    sweep("cover");
    sweep("thumbnail");
    if (plan.length === 0) return [];

    const files = [];
    for (const { comicId, kind, file } of plan) {
      const entry = this.entries.get(comicId);
      if (!entry || !entry[kind]) continue;
      delete entry[kind];
      files.push(file);
      if (!entry.cover && !entry.thumbnail && !entry.thumbnailUnsupported) {
        this.entries.delete(comicId);
      }
    }
    this.evicted += files.length;
    this.recount();
    await this.persist();
    return files;
  }

  // What Library settings reports, so the cache is not an unexplained lump of
  // disk. Sizes are what was written, not a fresh stat of every file.
  stats() {
    return {
      comics: this.entries.size,
      covers: this.coverCount,
      thumbnails: this.thumbnailCount,
      bytes: this.bytes,
      budgetBytes: this.budgetBytes,
      evicted: this.evicted
    };
  }

  persist() {
    const snapshot = { entries: Object.fromEntries(this.entries) };
    const next = this.writeQueue
      .catch(() => {})
      .then(() => atomicWriteJson(this.filePath, snapshot));
    this.writeQueue = next.catch(() => {});
    return next;
  }
}

// Generating thumbnails on first request spreads their cost over the cards a
// reader actually scrolls past, which is the right default and stays the
// default. It is the wrong shape for a library that has just been scanned,
// where the first browse pays a decode per card on NAS CPU. This walks the
// library once, deliberately, and can be stopped.
//
// Nothing here is persisted. A warm-up interrupted by a restart costs only the
// covers it had not reached yet, because a second run skips everything already
// cached — so resuming is the same operation as starting.
class CoverWarmup {
  constructor({ listComics, warm }) {
    this.listComics = listComics;
    this.warm = warm;
    this.runner = null;
    this.reset();
  }

  reset() {
    this.status = "idle";
    this.total = 0;
    this.processed = 0;
    this.generated = 0;
    this.alreadyCached = 0;
    this.failed = 0;
    this.currentTitle = "";
    this.startedAt = null;
    this.finishedAt = null;
    this.cancelled = false;
  }

  state() {
    return {
      status: this.status,
      total: this.total,
      processed: this.processed,
      generated: this.generated,
      alreadyCached: this.alreadyCached,
      failed: this.failed,
      currentTitle: this.currentTitle,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt
    };
  }

  start() {
    if (this.status === "running") {
      throw jsonError(
        "A cover warm-up is already running.",
        "COVER_WARMUP_RUNNING"
      );
    }
    // The queue is taken once, so a scan finishing mid-run cannot grow the work
    // under the progress the caller is already watching.
    const queue = this.listComics();
    this.reset();
    this.status = "running";
    this.total = queue.length;
    this.startedAt = new Date().toISOString();
    this.runner = this.run(queue);
    return this.state();
  }

  cancel() {
    if (this.status === "running") this.cancelled = true;
    return this.state();
  }

  // The current run, for a caller that needs to wait for it — a shutdown, or a
  // test. Resolved when nothing is running.
  settled() {
    return this.runner || Promise.resolve();
  }

  async run(queue) {
    for (const comic of queue) {
      // Checked between comics rather than within one: a half-written cover is
      // worse than a few hundred extra milliseconds before stopping.
      if (this.cancelled) break;
      this.currentTitle = comic.title || "";
      try {
        const generated = await this.warm(comic);
        if (generated) this.generated += 1;
        else this.alreadyCached += 1;
      } catch {
        // One unreadable archive in a library of thousands must not abandon the
        // rest. The count is the report; the shelf shows which covers are
        // missing far better than a list here would.
        this.failed += 1;
      }
      this.processed += 1;
    }
    this.status = this.cancelled ? "cancelled" : "complete";
    this.currentTitle = "";
    this.finishedAt = new Date().toISOString();
  }
}

module.exports = { CoverCacheStore, CoverWarmup, budgetFromEnv, DEFAULT_BUDGET_MB };
