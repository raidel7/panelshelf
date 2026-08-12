"use strict";

const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { jsonError } = require("./util");

const COMIC_ID = /^[a-f0-9]{24}$/;
const MAX_TIMESTAMP = 40;
const MAX_ORDER_ID = 80;

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function wholeNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.floor(number);
}

function text(value, maximum) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maximum);
}

function normalizeRecord(value) {
  if (!plainObject(value)) {
    throw jsonError("Progress must be an object.", "INVALID_PROGRESS");
  }
  return {
    pageIndex: wholeNumber(value.pageIndex),
    pageCount: wholeNumber(value.pageCount),
    completed: Boolean(value.completed),
    skipped: Boolean(value.skipped),
    lastReadAt: text(value.lastReadAt, MAX_TIMESTAMP),
    orderId: text(value.orderId, MAX_ORDER_ID)
  };
}

function normalizeRecords(value) {
  if (!plainObject(value)) return {};
  const records = {};
  for (const [comicId, candidate] of Object.entries(value)) {
    if (!COMIC_ID.test(comicId)) continue;
    try {
      records[comicId] = normalizeRecord(candidate);
    } catch {
      // Skip an unusable record rather than failing a whole restore.
    }
  }
  return records;
}

function timestampValue(record) {
  const parsed = Date.parse(record.lastReadAt || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function incomingWins(current, incoming) {
  const currentAt = timestampValue(current);
  const incomingAt = timestampValue(incoming);
  if (currentAt === null) return true; // current has no usable timestamp
  if (incomingAt === null) return false; // incoming has no usable timestamp
  return incomingAt >= currentAt; // newer (or equal) incoming wins
}

// Tie-break rule: per comic id, the record with the newer lastReadAt wins;
// a record with no usable timestamp always loses to one that has it, and an
// incoming record wins ties (including when neither side has a timestamp).
function mergeRecords(existingInput, incomingInput) {
  const existing = normalizeRecords(existingInput);
  const incoming = normalizeRecords(incomingInput);
  const merged = { ...existing };
  for (const [comicId, record] of Object.entries(incoming)) {
    const current = merged[comicId];
    if (!current || incomingWins(current, record)) {
      merged[comicId] = record;
    }
  }
  return merged;
}

async function atomicWriteJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600
  });
  await fsp.rename(temporary, filePath);
}

class ProgressStore {
  constructor(dataDirectory) {
    this.filePath = path.join(dataDirectory, "progress.json");
    this.records = {};
    // Serializes writes on this instance so overlapping save/remove/merge
    // calls (e.g. an iPad auto-saving while a browser is also open) never
    // race on the same file.
    this.writeQueue = Promise.resolve();
  }

  async initialize() {
    let raw;
    try {
      raw = await fsp.readFile(this.filePath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.records = {};
      return;
    }
    try {
      this.records = normalizeRecords(JSON.parse(raw));
    } catch {
      // Invalid JSON should not brick the whole server over soft,
      // re-syncable data: preserve the bad file for inspection and start
      // empty rather than rethrowing.
      const corruptPath = `${this.filePath}.corrupt-${Date.now()}`;
      let preserved = true;
      try {
        await fsp.rename(this.filePath, corruptPath);
      } catch {
        // Best effort; fall through to starting empty regardless.
        preserved = false;
      }
      console.warn(
        preserved
          ? `Progress file ${this.filePath} is corrupt and was reset. ` +
              `The original was preserved at ${corruptPath}.`
          : `Progress file ${this.filePath} is corrupt and was reset. ` +
              `The original could not be preserved.`
      );
      this.records = {};
    }
  }

  get(comicId) {
    return this.records[comicId] ? structuredClone(this.records[comicId]) : null;
  }

  persist() {
    // Chain onto the queue without ever letting the queue itself become a
    // rejected promise — otherwise one transient write failure (ENOSPC,
    // a permission blip) would permanently disable all future writes on
    // this instance, since `rejectedPromise.then(cb)` propagates the
    // rejection without calling `cb`. Each caller still observes the
    // outcome of its own write via `next`.
    const next = this.writeQueue
      .catch(() => {})
      .then(() => atomicWriteJson(this.filePath, this.records));
    this.writeQueue = next.catch(() => {});
    return next;
  }

  async save(comicId, input) {
    if (!COMIC_ID.test(comicId)) {
      throw jsonError("Comic not found.", "NOT_FOUND");
    }
    const record = normalizeRecord(input);
    // The server clock is authoritative here; a client-supplied lastReadAt
    // is deliberately discarded and replaced with the save time.
    record.lastReadAt = new Date().toISOString();
    this.records[comicId] = record;
    await this.persist();
    return this.get(comicId);
  }

  async remove(comicId) {
    delete this.records[comicId];
    await this.persist();
  }

  // A deliberate, user-initiated bulk write: unlike merge, every supplied
  // record is stamped with server time and applied unconditionally, so a
  // client with a skewed clock cannot have its own action discarded. The whole
  // batch is validated before anything is applied, and lands in one write.
  async applyBatch(input) {
    if (!plainObject(input)) {
      throw jsonError("Batch must be an object.", "INVALID_PROGRESS");
    }
    const { records = {}, deleted = [] } = input;
    if (!plainObject(records)) {
      throw jsonError("Batch records must be an object.", "INVALID_PROGRESS");
    }
    if (!Array.isArray(deleted)) {
      throw jsonError("Batch deletions must be an array.", "INVALID_PROGRESS");
    }
    const lastReadAt = new Date().toISOString();
    const staged = {};
    // A malformed id is a bad request rather than a missing comic: unlike
    // save()'s guard, this one is reachable over HTTP, since the batch route
    // carries its ids in the body where no path regex pre-filters them.
    for (const [comicId, candidate] of Object.entries(records)) {
      if (!COMIC_ID.test(comicId)) {
        throw jsonError("Progress ids must be comic ids.", "INVALID_PROGRESS");
      }
      staged[comicId] = { ...normalizeRecord(candidate), lastReadAt };
    }
    for (const comicId of deleted) {
      if (typeof comicId !== "string" || !COMIC_ID.test(comicId)) {
        throw jsonError("Progress ids must be comic ids.", "INVALID_PROGRESS");
      }
    }
    Object.assign(this.records, staged);
    for (const comicId of deleted) delete this.records[comicId];
    await this.persist();
    return this.exportData();
  }

  async merge(input) {
    this.records = mergeRecords(this.records, input);
    await this.persist();
    return this.exportData();
  }

  exportData() {
    return structuredClone(this.records);
  }

  async restoreData(value) {
    this.records = normalizeRecords(value);
    await this.persist();
  }
}

module.exports = {
  COMIC_ID,
  ProgressStore,
  mergeRecords,
  normalizeRecord,
  normalizeRecords,
  plainObject
};
