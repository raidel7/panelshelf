"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { jsonError } = require("./util");

// Which chronology branches a reader has set aside. Server-owned for the same
// reason reading progress is: it is per-reader state, not per-device, and a
// branch hidden in the browser has to be hidden on the iPad too.
//
// Keyed on the chronology node id — `chronology/source:<key>/folder:<name>/…` —
// which both clients already build the same way. Ids are stored as given: a
// node that no longer exists is harmless (nothing matches it) and may come back
// when a disconnected USB source is plugged in again, so nothing prunes them.

// Long enough for a deep branch under an encoded source key, short enough that
// a malformed client cannot fill the disk one request at a time.
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
    this.nodeIds = new Set();
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
      this.nodeIds = new Set();
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      this.nodeIds = new Set(normalizeNodeIds(parsed?.nodeIds ?? parsed));
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
      this.nodeIds = new Set();
    }
  }

  persist() {
    const next = this.writeQueue
      .catch(() => {})
      .then(() => atomicWriteJson(this.filePath, { nodeIds: [...this.nodeIds] }));
    this.writeQueue = next.catch(() => {});
    return next;
  }

  list() {
    return { nodeIds: [...this.nodeIds] };
  }

  /// Skipping is a deliberate action on a named branch, and adding a branch
  /// twice is the same as adding it once, so there is nothing here to
  /// reconcile: additions and removals apply as sent. Both clients converge
  /// because the set is the whole state — unlike a reading position, where
  /// "page 40" from a stale device would undo "page 60" from a fresh one.
  async apply(input) {
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
    const next = new Set(this.nodeIds);
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
    this.nodeIds = next;
    await this.persist();
    return this.list();
  }

  exportData() {
    return [...this.nodeIds];
  }

  async restoreData(value) {
    this.nodeIds = new Set(normalizeNodeIds(value?.nodeIds ?? value));
    await this.persist();
  }
}

module.exports = { SkipStore, normalizeNodeIds };
