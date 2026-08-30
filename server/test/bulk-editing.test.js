"use strict";

const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { MetadataOverrideStore } = require("../src/metadata-overrides");
const { ReadingOrderStore } = require("../src/reading-orders");

const ID = (label) => label.repeat(24).slice(0, 24);

async function overrides(t) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-bulk-"));
  const store = new MetadataOverrideStore(directory);
  await store.initialize();
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  return store;
}

async function orders(t) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-bulkord-"));
  const store = new ReadingOrderStore(directory);
  await store.initialize();
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  return store;
}

const comic = (label) => ({
  id: ID(label),
  sourceId: "src_1",
  sourceName: "DC",
  relativePath: `${label}.cbz`,
  folderSegments: [],
  hierarchy: [],
  title: label,
  series: "A Series"
});

test("a bulk edit applies the same fields to every comic named", async (t) => {
  const store = await overrides(t);

  const result = await store.applyMany([ID("a"), ID("b")], { publisher: "DC Comics" });

  assert.equal(result.updated, 2);
  assert.equal(store.get(ID("a")).metadata.publisher, "DC Comics");
  assert.equal(store.get(ID("b")).metadata.publisher, "DC Comics");
});

test("a bulk edit merges with what was already set by hand", async (t) => {
  // Someone fixing the publisher across a run must not lose the title they
  // corrected on one issue last week. A bulk edit is a patch, not a rewrite.
  const store = await overrides(t);
  await store.save(ID("a"), { title: "A title fixed by hand" });

  await store.applyMany([ID("a")], { publisher: "DC Comics" });

  const record = store.get(ID("a"));
  assert.equal(record.metadata.title, "A title fixed by hand");
  assert.equal(record.metadata.publisher, "DC Comics");
});

test("a bulk edit can clear a field across many comics", async (t) => {
  const store = await overrides(t);
  await store.applyMany([ID("a"), ID("b")], { publisher: "Wrong" });

  await store.applyMany([ID("a"), ID("b")], { publisher: null });

  assert.equal(store.get(ID("a"))?.metadata?.publisher, undefined);
});

test("a malformed id is reported rather than quietly skipped", async (t) => {
  const store = await overrides(t);

  const result = await store.applyMany([ID("a"), "not-an-id"], { publisher: "DC" });

  assert.equal(result.updated, 1);
  assert.deepEqual(result.rejected, ["not-an-id"]);
});

test("a bulk edit lands in one write, not one per comic", async (t) => {
  // Two hundred comics is a normal selection, and two hundred atomic writes of
  // the whole file is not a normal cost for one action.
  const store = await overrides(t);
  let writes = 0;
  const persist = store.persist.bind(store);
  store.persist = (...args) => {
    writes += 1;
    return persist(...args);
  };

  await store.applyMany([ID("a"), ID("b"), ID("c")], { publisher: "DC" });

  assert.equal(writes, 1);
});

test("comics can be added to an order in bulk without disturbing what is there", async (t) => {
  const store = await orders(t);
  const library = [comic("a"), comic("b"), comic("c")];
  const created = await store.create({ name: "Crisis", comicIds: [ID("a")] }, library);

  const updated = await store.addComics(created.id, [ID("b"), ID("c")], library);

  assert.deepEqual(updated.comicIds, [ID("a"), ID("b"), ID("c")], "appended, in order");
});

test("adding a comic already in the order does not duplicate it", async (t) => {
  const store = await orders(t);
  const library = [comic("a"), comic("b")];
  const created = await store.create({ name: "Crisis", comicIds: [ID("a")] }, library);

  const updated = await store.addComics(created.id, [ID("a"), ID("b")], library);

  assert.deepEqual(updated.comicIds, [ID("a"), ID("b")]);
});

test("adding a comic the library does not have is refused", async (t) => {
  const store = await orders(t);
  const library = [comic("a")];
  const created = await store.create({ name: "Crisis", comicIds: [ID("a")] }, library);

  const updated = await store.addComics(created.id, [ID("z")], library);

  assert.deepEqual(updated.comicIds, [ID("a")], "an id for no comic adds nothing");
});
