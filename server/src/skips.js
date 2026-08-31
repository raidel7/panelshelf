"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { jsonError } = require("./util");
const {
  DEFAULT_READER_ID,
  normalizeReaderId
} = require("./reader-profiles");

// Which chronology branches a reader has set aside. Server-owned for the same
// reason reading progress is: it is per-reader state, not per-device, and a
// branch hidden in the browser has to be hidden on the iPad too.
//
// Keyed on the chronology node id — `chronology/source:<key>/folder:<name>/…` —
// which both clients already build the same way. Ids are stored as given: a
// node that no longer exists is harmless (nothing matches it) and may come back
// when a disconnected USB source is plugged in again, so nothing prunes them.

// Long enough for a deep branch under an encoded source key, short enough that
// a malformed client cannot fill the disk one request at a time. The ceiling is
// per reader profile, and the number of those is capped in turn, so the bound
// on the whole file is still a bound.
const MAX_NODE_ID = 512;
const MAX_NODE_IDS = 20_000;

function nodeId(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_NODE_ID) return null;
  return trimmed;
}

function normalizeNodeIds(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  for (const candidate of value) {
    const id = nodeId(candidate);
    if (id) seen.add(id);
    if (seen.size >= MAX_NODE_IDS) break;
  }
  return [...seen];
}

// Node ids for every reader profile, as they sit on disk:
//
//   { "readers": { "default": ["chronology/source:…"], "ana": [] } }
//
// Anything else — a `{nodeIds: […]}` wrapper, or a bare array — is what this
// file held before reader profiles existed, and belongs to the default profile.
function normalizeByReader(value) {
  const byReader = new Map();
  const readers =
    value && typeof value === "object" && !Array.isArray(value) && value.readers;
  if (readers && typeof readers === "object" && !Array.isArray(readers)) {
    for (const [candidate, nodeIds] of Object.entries(readers)) {
      const readerId = normalizeReaderId(candidate);
      if (!readerId) continue;
      byReader.set(readerId, new Set(normalizeNodeIds(nodeIds?.nodeIds ?? nodeIds)));
    }
  } else {
    byReader.set(DEFAULT_READER_ID, new Set(normalizeNodeIds(value?.nodeIds ?? value)));
  }
  if (!byReader.has(DEFAULT_READER_ID)) byReader.set(DEFAULT_READER_ID, new Set());
  return byReader;
}

async function atomicWriteJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600
  });
  await fsp.rename(temporary, filePath);
}

class SkipStore {
  constructor(dataDirectory) {
    this.filePath = path.join(dataDirectory, "skips.json");
    // Reader profile id to that reader's set aside branches. A branch one
    // person hides is hidden on every client they use and on none of anybody
    // else's, which is the whole reason this is server-owned and namespaced
    // rather than either local or shared.
    this.byReader = new Map([[DEFAULT_READER_ID, new Set()]]);
    // Serialized like the progress store's, and never left rejected: one
    // transient write failure must not disable every write after it.
    this.writeQueue = Promise.resolve();
  }

  async initialize() {
    let raw;
    try {
      raw = await fsp.readFile(this.filePath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.byReader = new Map([[DEFAULT_READER_ID, new Set()]]);
      return;
    }
    try {
      this.byReader = normalizeByReader(JSON.parse(raw));
    } catch {
      // Soft, re-syncable data: keep the bad file for inspection rather than
      // refusing to start.
      const corruptPath = `${this.filePath}.corrupt-${Date.now()}`;
      try {
        await fsp.rename(this.filePath, corruptPath);
        console.warn(
          `Skip file ${this.filePath} is corrupt and was reset. ` +
            `The original was preserved at ${corruptPath}.`
        );
      } catch {
        console.warn(`Skip file ${this.filePath} is corrupt and was reset.`);
      }
      this.byReader = new Map([[DEFAULT_READER_ID, new Set()]]);
    }
  }

  // Refuses anything that is not a reader profile id, for the reason the
  // progress store does: resolution happens once at the HTTP boundary, so a
  // missing id here is a bug rather than an anonymous request, and hiding a
  // branch on the wrong person's chronology is not a good way to report it.
  readerKey(readerProfileId) {
    const id = normalizeReaderId(readerProfileId);
    if (!id) {
      throw jsonError(
        "A skipped collection needs a reader profile.",
        "INVALID_READER_PROFILE"
      );
    }
    return id;
  }

  nodeIdsFor(readerProfileId) {
    return this.byReader.get(this.readerKey(readerProfileId)) || new Set();
  }

  persist() {
    const next = this.writeQueue
      .catch(() => {})
      .then(() => atomicWriteJson(this.filePath, this.snapshot()));
    this.writeQueue = next.catch(() => {});
    return next;
  }

  // A reader who has set nothing aside is not written out; the profile itself
  // lives in readers.json.
  snapshot() {
    const readers = {};
    for (const [readerProfileId, nodeIds] of this.byReader) {
      if (nodeIds.size) readers[readerProfileId] = [...nodeIds];
    }
    return { readers };
  }

  list(readerProfileId) {
    return { nodeIds: [...this.nodeIdsFor(readerProfileId)] };
  }

  // Skipping is a deliberate action on a named branch, and adding a branch
  // twice is the same as adding it once, so there is nothing here to
  // reconcile: additions and removals apply as sent. Both clients converge
  // because the set is the whole state — unlike a reading position, where
  // "page 40" from a stale device would undo "page 60" from a fresh one.
  async apply(readerProfileId, input) {
    const readerKey = this.readerKey(readerProfileId);
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw jsonError("Skip changes must be an object.", "INVALID_SKIPS");
    }
    for (const key of ["add", "remove"]) {
      if (input[key] !== undefined && !Array.isArray(input[key])) {
        throw jsonError(`Skip ${key} must be a list of node ids.`, "INVALID_SKIPS");
      }
    }
    const add = normalizeNodeIds(input.add);
    const remove = normalizeNodeIds(input.remove);
    // Staged, then committed: a request refused below must leave the store
    // exactly as it was, or memory and disk would disagree until the next
    // successful write.
    //
    // Removals apply first, so a request that both adds and removes the same
    // branch ends up skipping it — the add is the newer intent in every client
    // that sends both, which is the migration replaying a stored set.
    const next = new Set(this.nodeIdsFor(readerKey));
    for (const id of remove) next.delete(id);
    for (const id of add) next.add(id);
    if (next.size > MAX_NODE_IDS) {
      // Refused rather than silently trimmed. Nobody sets aside twenty thousand
      // branches by hand, so this is a client looping, and dropping ids quietly
      // would leave the two sides disagreeing forever.
      throw jsonError(
        "Too many skipped collections to store.",
        "TOO_MANY_SKIPS"
      );
    }
    this.byReader.set(readerKey, next);
    await this.persist();
    return this.list(readerKey);
  }

  // A profile nobody uses takes its hidden branches with it.
  async forget(readerProfileId) {
    const id = normalizeReaderId(readerProfileId);
    if (!id || id === DEFAULT_READER_ID) return false;
    if (!this.byReader.delete(id)) return false;
    await this.persist();
    return true;
  }

  exportData(readerProfileId) {
    return [...this.nodeIdsFor(readerProfileId)];
  }

  exportAll() {
    return this.snapshot();
  }

  async restoreData(value) {
    this.byReader = normalizeByReader(value);
    await this.persist();
  }

  settled() {
    return this.writeQueue;
  }
}

module.exports = { SkipStore, normalizeNodeIds };
