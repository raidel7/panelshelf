"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

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
  const cover = image(value.cover);
  const thumbnail = image(value.thumbnail);
  const thumbnailUnsupported = value.thumbnailUnsupported === true;
  // An entry that records nothing is not worth keeping: it would claim the
  // comic is cached while every lookup fell through anyway.
  if (!cover && !thumbnail && !thumbnailUnsupported) return null;
  const entry = { fingerprint };
  if (cover) entry.cover = cover;
  if (thumbnail) entry.thumbnail = thumbnail;
  if (thumbnailUnsupported) entry.thumbnailUnsupported = true;
  return entry;
}

class CoverCacheStore {
  constructor(dataDirectory) {
    this.filePath = path.join(dataDirectory, "covers.json");
    this.entries = new Map();
    // Serialized like the skip and progress stores', and never left rejected:
    // one transient write failure must not disable every write after it.
    this.writeQueue = Promise.resolve();
  }

  async initialize() {
    let raw;
    try {
      raw = await fsp.readFile(this.filePath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.entries = new Map();
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
  }

  // Returns the entry only when it was built from the fingerprint being asked
  // about. Callers cannot accidentally serve a stale cover, because a stale one
  // is indistinguishable from a missing one from here.
  get(comicId, fingerprint) {
    if (!fingerprint) return null;
    const entry = this.entries.get(comicId);
    if (!entry || entry.fingerprint !== fingerprint) return null;
    return entry;
  }

  async record(comicId, fingerprint, value) {
    const entry = entryFrom({ ...value, fingerprint });
    if (!entry) return null;
    this.entries.set(comicId, entry);
    await this.persist();
    return entry;
  }

  async forget(comicId) {
    if (!this.entries.delete(comicId)) return;
    await this.persist();
  }

  // What Library settings reports, so the cache is not an unexplained lump of
  // disk. Sizes are what was written, not a fresh stat of every file.
  stats() {
    let covers = 0;
    let thumbnails = 0;
    let bytes = 0;
    for (const entry of this.entries.values()) {
      if (entry.cover) {
        covers += 1;
        bytes += entry.cover.bytes;
      }
      if (entry.thumbnail) {
        thumbnails += 1;
        bytes += entry.thumbnail.bytes;
      }
    }
    return { comics: this.entries.size, covers, thumbnails, bytes };
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

module.exports = { CoverCacheStore };
