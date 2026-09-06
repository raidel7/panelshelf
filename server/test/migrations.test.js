"use strict";

const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  INDEX_SCHEMA_VERSION,
  CheckpointStore,
  DURABLE_FILES,
  indexVersion,
  migrateIndex
} = require("../src/migrations");

async function dataDirectory(t, files = {}) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-migrate-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  for (const [name, contents] of Object.entries(files)) {
    await fsp.writeFile(path.join(directory, name), contents);
  }
  return directory;
}

test("an index written before versions existed is version one", () => {
  assert.equal(indexVersion({ comics: [] }), 1);
  assert.equal(indexVersion({ schemaVersion: 0, comics: [] }), 1, "and so is nonsense");
  assert.equal(indexVersion(null), 1);
  assert.equal(indexVersion({ schemaVersion: 7 }), 7);
});

test("migrating stamps the index without touching what it holds", () => {
  const comics = [{ id: "a", title: "One" }, { id: "b", title: "Two" }];
  const result = migrateIndex({ scannedAt: "2026-01-01T00:00:00.000Z", comics });

  assert.equal(result.migrated, true);
  assert.equal(result.from, 1);
  assert.equal(result.to, INDEX_SCHEMA_VERSION);
  assert.deepEqual(result.data.comics, comics, "records are carried, not rewritten");
  assert.equal(result.data.scannedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(result.data.schemaVersion, INDEX_SCHEMA_VERSION);
});

test("an index already at this version is left alone", () => {
  const result = migrateIndex({ schemaVersion: INDEX_SCHEMA_VERSION, comics: [] });
  assert.equal(result.migrated, false);
  assert.equal(result.from, INDEX_SCHEMA_VERSION);
});

test("a checkpoint copies what a scan cannot rebuild", async (t) => {
  // Covers are the biggest thing in the directory and the cheapest to make
  // again, so they are deliberately not here. Reading positions are the
  // opposite on both counts.
  const directory = await dataDirectory(t, {
    "config.json": '{"schemaVersion":1}',
    "library.json": '{"comics":[]}',
    "progress.json": '{"default":{"a":{"pageIndex":4}}}',
    "skips.json": "{}",
    "covers.json": '{"entries":{}}'
  });
  const store = new CheckpointStore(directory);

  const checkpoint = await store.create("index-v1-to-v2");

  assert.match(checkpoint.id, /index-v1-to-v2$/);
  assert.deepEqual(
    checkpoint.files.sort(),
    ["config.json", "library.json", "progress.json", "skips.json"],
    "and only what was there"
  );
  assert.equal(checkpoint.files.includes("covers.json"), false, "covers rebuild");
  const kept = await fsp.readFile(path.join(checkpoint.path, "progress.json"), "utf8");
  assert.equal(JSON.parse(kept).default.a.pageIndex, 4, "byte for byte");
});

test("a young install with almost nothing in it still checkpoints cleanly", async (t) => {
  // Most of these files do not exist until something uses them. A missing one
  // is not a failed checkpoint.
  const directory = await dataDirectory(t, { "config.json": "{}" });
  const checkpoint = await new CheckpointStore(directory).create("config");

  assert.deepEqual(checkpoint.files, ["config.json"]);
  const manifest = JSON.parse(
    await fsp.readFile(path.join(checkpoint.path, "checkpoint.json"), "utf8")
  );
  assert.equal(manifest.reason, "config");
  assert.ok(manifest.createdAt);
});

test("a checkpoint is no more readable than what it copied", async (t) => {
  const directory = await dataDirectory(t, { "devices.json": '{"devices":[]}' });
  const checkpoint = await new CheckpointStore(directory).create("index-v1-to-v2");

  const mode = (await fsp.stat(path.join(checkpoint.path, "devices.json"))).mode & 0o777;
  assert.equal(mode, 0o600, `saw ${mode.toString(8)}`);
});

test("checkpoints are listed newest first", async (t) => {
  const directory = await dataDirectory(t, { "config.json": "{}" });
  const store = new CheckpointStore(directory);

  const first = await store.create("config");
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await store.create("index-v1-to-v2");

  const listed = await store.list();
  assert.equal(listed.length, 2);
  assert.equal(listed[0].id, second.id, "the one that matters is the last one");
  assert.equal(listed[1].id, first.id);
});

test("a half-written checkpoint is not offered as one", async (t) => {
  const directory = await dataDirectory(t, { "config.json": "{}" });
  const store = new CheckpointStore(directory);
  await store.create("config");
  await fsp.mkdir(path.join(directory, "checkpoints", "2020-01-01-broken"));

  const listed = await store.list();
  assert.equal(listed.length, 1, "no manifest, no offer");
});

test("only the last few checkpoints are kept", async (t) => {
  // Every upgrade making its own copy of the durable state would turn an
  // upgrade path into a storage problem of its own.
  const directory = await dataDirectory(t, { "config.json": "{}" });
  const store = new CheckpointStore(directory);
  const made = [];
  for (let index = 0; index < 5; index += 1) {
    made.push(await store.create(`step-${index}`));
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  const removed = await store.prune(3);
  const listed = await store.list();

  assert.equal(listed.length, 3);
  assert.equal(removed.length, 2);
  assert.deepEqual(
    listed.map((entry) => entry.reason),
    ["step-4", "step-3", "step-2"],
    "the oldest go"
  );
  for (const id of removed) {
    await assert.rejects(() => fsp.stat(path.join(directory, "checkpoints", id)));
  }
});

test("listing checkpoints before any exist is empty, not an error", async (t) => {
  const directory = await dataDirectory(t);
  assert.deepEqual(await new CheckpointStore(directory).list(), []);
});

test("the durable list holds nothing a scan could rebuild", () => {
  // A checkpoint of the cover cache would be most of the disk and none of the
  // value. The index is here because rebuilding it costs a full scan, not
  // because it cannot be rebuilt at all.
  assert.equal(DURABLE_FILES.includes("covers.json"), false);
  assert.equal(DURABLE_FILES.includes("scan-report.json"), false);
  assert.equal(DURABLE_FILES.includes("panelshelf.log"), false);
  for (const name of ["progress.json", "skips.json", "reading-orders.json",
    "metadata-overrides.json", "devices.json", "config.json", "library.json"]) {
    assert.ok(DURABLE_FILES.includes(name), `${name} is worth keeping`);
  }
});
