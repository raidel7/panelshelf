"use strict";

const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");

// What has changed in the library, so a client can ask "what since here?"
// instead of downloading the catalogue again to find out one comic moved.
//
// A client can work out additions and edits for itself by comparing what it
// received against what it holds. It cannot work out removals: nothing in a
// list of what remains says what left. That asymmetry is the reason this exists
// — the log remembers departures that the library itself has forgotten.
//
// Bounded on purpose. A client that has been away long enough that its cursor
// has fallen off the end is told to resync rather than handed a partial history
// that would leave it quietly wrong, which is the failure nobody notices.

const DEFAULT_LIMIT = 5000;

async function atomicWriteJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600
  });
  await fsp.rename(temporary, filePath);
}

// What makes one version of a comic different from another. The scan already
// fingerprints contents to detect moves; size and mtime stand in for an index
// written before that existed.
function signature(comic) {
  if (comic.fingerprint) return String(comic.fingerprint);
  return `${Number(comic.size) || 0}:${Math.round(Number(comic.mtimeMs) || 0)}`;
}

class LibraryChangeLog {
  constructor(dataDirectory, options = {}) {
    this.filePath = path.join(dataDirectory, "changes.json");
    this.limit = Number.isFinite(options.limit) && options.limit > 0
      ? Math.floor(options.limit)
      : DEFAULT_LIMIT;
    this.entries = [];
    this.seq = 0;
    this.writeQueue = Promise.resolve();
  }

  get sequence() {
    return this.seq;
  }

  async initialize() {
    let raw;
    try {
      raw = await fsp.readFile(this.filePath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
      this.entries = entries
        .filter(
          (entry) =>
            entry &&
            Number.isInteger(entry.seq) &&
            typeof entry.id === "string" &&
            ["added", "updated", "removed"].includes(entry.kind)
        )
        .map((entry) => ({ seq: entry.seq, id: entry.id, kind: entry.kind }));
      this.seq = Number.isInteger(parsed?.sequence)
        ? parsed.sequence
        : this.entries.length
          ? this.entries[this.entries.length - 1].seq
          : 0;
    } catch {
      // Resetting drops the sequence back to zero, which makes every cursor a
      // client still holds a future one — and a future cursor already means
      // resync. So a damaged log degrades into "everybody refetch once" rather
      // than into clients believing a history that is gone.
      const corruptPath = `${this.filePath}.corrupt-${Date.now()}`;
      try {
        await fsp.rename(this.filePath, corruptPath);
        console.warn(
          `Library change log ${this.filePath} is corrupt and was reset. ` +
            `The original was preserved at ${corruptPath}.`
        );
      } catch {
        console.warn(`Library change log ${this.filePath} is corrupt and was reset.`);
      }
      this.entries = [];
      this.seq = 0;
    }
  }

  async record(previousComics, nextComics) {
    const before = new Map((previousComics || []).map((comic) => [comic.id, comic]));
    const after = new Map((nextComics || []).map((comic) => [comic.id, comic]));
    const changes = [];

    for (const [id, comic] of after) {
      const prior = before.get(id);
      if (!prior) changes.push({ id, kind: "added" });
      else if (signature(prior) !== signature(comic)) changes.push({ id, kind: "updated" });
    }
    for (const id of before.keys()) {
      if (!after.has(id)) changes.push({ id, kind: "removed" });
    }
    // Scans run on a timer, and most of them find nothing. A client polling
    // after one of those must not be handed work it does not have.
    if (changes.length === 0) return 0;

    for (const change of changes) {
      this.seq += 1;
      this.entries.push({ seq: this.seq, id: change.id, kind: change.kind });
    }
    if (this.entries.length > this.limit) {
      this.entries = this.entries.slice(this.entries.length - this.limit);
    }
    await this.persist();
    return changes.length;
  }

  since(cursor) {
    const behind = { sequence: this.seq, changes: [], reset: true };
    // Absent, not zero. `Number(null)` is 0 and a missing query parameter
    // arrives as null, so a client that has never synced would otherwise be
    // told it was up to date with a library it has never seen — and would stay
    // told that forever, because nothing later would change its mind.
    if (cursor === null || cursor === undefined || cursor === "") return behind;
    const from = Number(cursor);
    // A cursor this log never issued — no cursor at all, or one from a data
    // directory that has since been rebuilt or restored. Trusting it would send
    // nothing, forever.
    if (!Number.isInteger(from) || from < 0 || from > this.seq) return behind;
    if (from === this.seq) return { sequence: this.seq, changes: [], reset: false };
    // The oldest change still held answers for everything from just before it.
    const oldest = this.entries.length ? this.entries[0].seq : this.seq + 1;
    if (from < oldest - 1) return behind;
    return {
      sequence: this.seq,
      changes: this.entries
        .filter((entry) => entry.seq > from)
        .map((entry) => ({ id: entry.id, kind: entry.kind })),
      reset: false
    };
  }

  settled() {
    return this.writeQueue;
  }

  persist() {
    const snapshot = { sequence: this.seq, entries: [...this.entries] };
    const next = this.writeQueue
      .catch(() => {})
      .then(() => atomicWriteJson(this.filePath, snapshot));
    this.writeQueue = next.catch(() => {});
    return next;
  }
}

module.exports = { LibraryChangeLog };
