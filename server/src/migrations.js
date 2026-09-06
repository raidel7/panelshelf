"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");

// What a version change is allowed to cost.
//
// The index has been reshaped twice already and both times the upgrade was a
// one-way door: the server read the old file, wrote the new one over it, and
// there was nothing to go back to. That was survivable because the index is
// derived — a rescan rebuilds it — but the same startup also rewrites
// `config.json`, and beside it sit the files that are not derived from
// anything: reading positions, skipped branches, manual metadata, reading
// orders, paired devices. A migration that goes wrong takes those with it.
//
// So before any migration writes, the durable state is copied aside. That is
// the whole idea: not a way to undo a migration automatically, which would
// need to know what the migration meant, but a copy of what was there, kept
// where somebody can find it and told about plainly.

// 1 is every index written before versions existed. The number goes up when
// the shape of a comic record changes in a way an older build would mangle.
const INDEX_SCHEMA_VERSION = 2;

// Everything in the data directory that is not rebuildable by scanning, plus
// the index itself. Covers and thumbnails are deliberately absent: they are the
// largest thing here and the cheapest to make again.
const DURABLE_FILES = [
  "config.json",
  "library.json",
  "progress.json",
  "skips.json",
  "readers.json",
  "reading-orders.json",
  "metadata-overrides.json",
  "artwork.json",
  "online-metadata.json",
  "devices.json",
  "changes.json"
];

const CHECKPOINT_DIRECTORY = "checkpoints";
const KEEP_CHECKPOINTS = 3;

function indexVersion(saved) {
  const declared = Number(saved?.schemaVersion);
  if (Number.isFinite(declared) && declared >= 1) return Math.floor(declared);
  // No stamp means it was written before stamps existed.
  return 1;
}

// Returns the index as this build understands it. Migrations are listed one per
// step so a jump across several versions is the same code path as a jump across
// one.
function migrateIndex(saved) {
  const from = indexVersion(saved);
  const comics = Array.isArray(saved?.comics) ? saved.comics : [];
  if (from >= INDEX_SCHEMA_VERSION) {
    return { from, to: from, migrated: false, data: { ...saved, comics } };
  }

  // 1 → 2: the stamp itself. Records written before this are read unchanged;
  // what changed is that the file now says which build wrote it, so a package
  // installed over a newer one can tell rather than guess.
  return {
    from,
    to: INDEX_SCHEMA_VERSION,
    migrated: true,
    data: {
      ...saved,
      schemaVersion: INDEX_SCHEMA_VERSION,
      comics
    }
  };
}

// An index from a build newer than this one. Reading it and writing it back
// would quietly drop whatever the newer build added, which is the one outcome
// worth refusing outright: a downgrade that looks like it worked and loses
// something a scan cannot rebuild.
class FutureIndexError extends Error {
  constructor(found, understood, checkpointPath) {
    super(
      `This library index was written by a newer version of PanelShelf ` +
        `(index version ${found}; this build understands ${understood}). ` +
        `Starting would rewrite it and lose whatever that version added. ` +
        `Install the newer package again, or move ${checkpointPath} aside to ` +
        `start fresh and rescan.`
    );
    this.code = "INDEX_FROM_FUTURE";
    this.found = found;
    this.understood = understood;
  }
}

class CheckpointStore {
  constructor(dataDirectory) {
    this.dataDirectory = dataDirectory;
    this.directory = path.join(dataDirectory, CHECKPOINT_DIRECTORY);
  }

  // Copies the durable files aside under a name that says when and why.
  // Reports what it managed to copy rather than failing on the first file that
  // was not there — most of them are absent on a young install.
  async create(reason) {
    const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${reason}`;
    const target = path.join(this.directory, id);
    await fsp.mkdir(target, { recursive: true });

    const copied = [];
    for (const name of DURABLE_FILES) {
      const from = path.join(this.dataDirectory, name);
      try {
        await fsp.copyFile(from, path.join(target, name));
        await fsp.chmod(path.join(target, name), 0o600).catch(() => {});
        copied.push(name);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }

    const manifest = {
      id,
      reason,
      createdAt: new Date().toISOString(),
      files: copied
    };
    await fsp.writeFile(
      path.join(target, "checkpoint.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { mode: 0o600 }
    );
    return { ...manifest, path: target };
  }

  async list() {
    let names;
    try {
      names = await fsp.readdir(this.directory);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const found = [];
    for (const name of names.sort()) {
      const manifestPath = path.join(this.directory, name, "checkpoint.json");
      try {
        const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
        found.push({ ...manifest, path: path.join(this.directory, name) });
      } catch {
        // A half-written checkpoint is worse than useless if it is offered as
        // one, so it is simply not listed.
      }
    }
    return found.reverse();
  }

  // Oldest first out. Keeping every checkpoint would make an upgrade path its
  // own storage problem, and the useful one is nearly always the last.
  async prune(keep = KEEP_CHECKPOINTS) {
    const existing = await this.list();
    const doomed = existing.slice(keep);
    for (const checkpoint of doomed) {
      await fsp.rm(checkpoint.path, { recursive: true, force: true });
    }
    return doomed.map((checkpoint) => checkpoint.id);
  }
}

module.exports = {
  INDEX_SCHEMA_VERSION,
  DURABLE_FILES,
  CheckpointStore,
  FutureIndexError,
  indexVersion,
  migrateIndex,
  KEEP_CHECKPOINTS
};
