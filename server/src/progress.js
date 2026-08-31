"use strict";

const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { jsonError } = require("./util");
const {
  DEFAULT_READER_ID,
  normalizeReaderId
} = require("./reader-profiles");

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

// Records for every reader profile, as they sit on disk:
//
//   { "readers": { "default": { "<comicId>": {…} }, "ana": {…} } }
//
// Anything else is the flat map this file held before reader profiles existed,
// and belongs to the default profile. "readers" cannot collide with a real key
// because every other key here is a 24-character comic id.
function isNamespaced(value) {
  return plainObject(value) && plainObject(value.readers);
}

function normalizeByReader(value) {
  const byReader = new Map();
  if (!isNamespaced(value)) {
    // The 0.4.18 shape. Everyone who was reading before profiles existed keeps
    // reading exactly what they were, under the profile every unnamed request
    // resolves to.
    byReader.set(DEFAULT_READER_ID, normalizeRecords(value));
    return byReader;
  }
  for (const [candidate, records] of Object.entries(value.readers)) {
    const readerId = normalizeReaderId(candidate);
    if (!readerId) continue;
    byReader.set(readerId, normalizeRecords(records));
  }
  if (!byReader.has(DEFAULT_READER_ID)) {
    byReader.set(DEFAULT_READER_ID, {});
  }
  return byReader;
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

// Deletions reconcile the same way records do, and for the same reason: a
// client that marked a comic unread while offline is describing something that
// happened at a particular moment, and a position read on another device since
// then is newer than it. Applying the deletion unconditionally would throw that
// position away with a 200, which is exactly what /merge exists to avoid.
//
// `deleted` is a map of comic id to the moment the user marked it unread, so it
// carries the same information a record's `lastReadAt` does. /batch takes a
// plain array instead, because a deliberate write consults nobody's clock.
function applyDeletions(existing, deletedInput) {
  const records = { ...existing };
  if (!plainObject(deletedInput)) return records;
  for (const [comicId, deletedAt] of Object.entries(deletedInput)) {
    if (!COMIC_ID.test(comicId)) continue;
    const current = records[comicId];
    if (!current) continue;
    if (incomingWins(current, { lastReadAt: text(deletedAt, MAX_TIMESTAMP) })) {
      delete records[comicId];
    }
  }
  return records;
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
    // Reader profile id to that reader's records. One library, one index, one
    // set of sources — and a shelf each, because where somebody got to in a
    // comic is the one thing here that is about the reader rather than the
    // library.
    this.byReader = new Map([[DEFAULT_READER_ID, {}]]);
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
      this.byReader = new Map([[DEFAULT_READER_ID, {}]]);
      return;
    }
    try {
      this.byReader = normalizeByReader(JSON.parse(raw));
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
      this.byReader = new Map([[DEFAULT_READER_ID, {}]]);
    }
  }

  // Every method below takes the reader profile explicitly, and this refuses
  // anything that is not one. The id is decided once, at the HTTP boundary,
  // where an unknown name resolves to the default; by the time a request
  // reaches the store there is nothing left to guess, and guessing here would
  // mean quietly filing one person's position on another person's shelf.
  readerKey(readerProfileId) {
    const id = normalizeReaderId(readerProfileId);
    if (!id) {
      throw jsonError(
        "A reading position needs a reader profile.",
        "INVALID_READER_PROFILE"
      );
    }
    return id;
  }

  // Reading does not create a shelf; only writing does. Otherwise a client
  // asking after a profile that no longer exists would leave a bucket behind
  // on every request.
  recordsFor(readerProfileId) {
    return this.byReader.get(this.readerKey(readerProfileId)) || {};
  }

  writableRecordsFor(readerProfileId) {
    const id = this.readerKey(readerProfileId);
    let records = this.byReader.get(id);
    if (!records) {
      records = {};
      this.byReader.set(id, records);
    }
    return records;
  }

  get(readerProfileId, comicId) {
    const record = this.recordsFor(readerProfileId)[comicId];
    return record ? structuredClone(record) : null;
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
      .then(() => atomicWriteJson(this.filePath, this.snapshot()));
    this.writeQueue = next.catch(() => {});
    return next;
  }

  // A reader with nothing on their shelf is not written out: an empty map
  // carries no information, and the profile itself is recorded in readers.json
  // rather than here.
  snapshot() {
    const readers = {};
    for (const [readerProfileId, records] of this.byReader) {
      if (Object.keys(records).length) readers[readerProfileId] = records;
    }
    return { readers };
  }

  async save(readerProfileId, comicId, input) {
    if (!COMIC_ID.test(comicId)) {
      throw jsonError("Comic not found.", "NOT_FOUND");
    }
    const record = normalizeRecord(input);
    // The server clock is authoritative here; a client-supplied lastReadAt
    // is deliberately discarded and replaced with the save time.
    record.lastReadAt = new Date().toISOString();
    this.writableRecordsFor(readerProfileId)[comicId] = record;
    await this.persist();
    // The record we just built, not a re-read: a backup restore that replaced
    // this.byReader during the await would make the re-read return null, and the
    // route would answer a successful PUT with `200 null`, which a typed client
    // cannot decode.
    return structuredClone(record);
  }

  async remove(readerProfileId, comicId) {
    delete this.writableRecordsFor(readerProfileId)[comicId];
    await this.persist();
  }

  // A deliberate, user-initiated bulk write: unlike merge, every supplied
  // record is stamped with server time and applied unconditionally, so a
  // client with a skewed clock cannot have its own action discarded. The whole
  // batch is validated before anything is applied, and lands in one write.
  async applyBatch(readerProfileId, input) {
    this.readerKey(readerProfileId);
    if (!plainObject(input)) {
      throw jsonError("Batch must be an object.", "INVALID_PROGRESS");
    }
    const { records: incoming = {}, deleted = [] } = input;
    if (!plainObject(incoming)) {
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
    for (const [comicId, candidate] of Object.entries(incoming)) {
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
    const records = this.writableRecordsFor(readerProfileId);
    Object.assign(records, staged);
    for (const comicId of deleted) delete records[comicId];
    await this.persist();
    return this.exportData(readerProfileId);
  }

  // Reconciliation. Accepts either a bare map of records — what the web viewer
  // and every client before deletions existed sends — or `{records, deleted}`.
  // Records are merged first and deletions reconciled against the result, so a
  // client that somehow sent both for one comic gets a defined outcome rather
  // than one that depends on key order.
  async merge(readerProfileId, input) {
    const readerKey = this.readerKey(readerProfileId);
    const bare = plainObject(input) && !("records" in input) && !("deleted" in input);
    const records = bare ? input : input?.records;
    this.byReader.set(
      readerKey,
      applyDeletions(
        mergeRecords(this.recordsFor(readerKey), records),
        bare ? null : input?.deleted
      )
    );
    await this.persist();
    return this.exportData(readerKey);
  }

  // A profile nobody uses takes its shelf with it. Nothing else in the data
  // directory has to be told: the rest describes the library.
  async forget(readerProfileId) {
    const id = normalizeReaderId(readerProfileId);
    if (!id || id === DEFAULT_READER_ID) return false;
    if (!this.byReader.delete(id)) return false;
    await this.persist();
    return true;
  }

  exportData(readerProfileId) {
    return structuredClone(this.recordsFor(readerProfileId));
  }

  // Every reader's records, for a backup that has to be able to put the whole
  // household back.
  exportAll() {
    return structuredClone(this.snapshot());
  }

  async restoreData(value) {
    this.byReader = normalizeByReader(value);
    await this.persist();
  }

  settled() {
    return this.writeQueue;
  }
}

module.exports = {
  ProgressStore,
  applyDeletions,
  mergeRecords,
  normalizeRecord,
  normalizeRecords
};
