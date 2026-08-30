"use strict";

const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ReadingOrderStore } = require("../src/reading-orders");

// Comic ids are 24 hex characters — a real one is a sha256 prefix — and the
// order store filters anything else out. A test using "a" as an id silently
// gets an empty order, which is exactly what happened here.
const ID = (label) => label.repeat(24).slice(0, 24);

function comic(label, relativePath, extra = {}) {
  const id = ID(label);
  return {
    id,
    sourceId: "src_1",
    sourceName: "Source",
    relativePath,
    folderSegments: [],
    hierarchy: [],
    title: extra.title || path.basename(relativePath, ".cbz"),
    series: extra.series || "A Series",
    fingerprint: extra.fingerprint || `fp1_${label}`
  };
}

async function store(t) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-orders-"));
  const created = new ReadingOrderStore(directory);
  await created.initialize();
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  return created;
}

const LIBRARY = [comic("a", "One.cbz"), comic("b", "Two.cbz"), comic("c", "Three.cbz")];

test("an exported order names its comics by more than an id", async (t) => {
  // Ids are a hash of the file's path on *this* server. An export that carried
  // only ids would import as an empty order anywhere else, which is the one
  // thing an export format has to not do.
  const orders = await store(t);
  const created = await orders.create(
    { name: "Crisis", description: "The big one", comicIds: [ID("a"), ID("b")] },
    LIBRARY
  );

  const document = orders.exportOrder(created.id, LIBRARY);

  assert.equal(document.format, "panelshelf.reading-order");
  assert.equal(document.formatVersion, 1);
  assert.equal(document.name, "Crisis");
  assert.equal(document.description, "The big one");
  assert.equal(document.entries.length, 2);
  const [first] = document.entries;
  assert.equal(first.position, 1);
  assert.equal(first.comicId, ID("a"));
  assert.equal(first.relativePath, "One.cbz");
  assert.equal(first.fingerprint, "fp1_a");
  assert.equal(first.title, "One");
});

test("an imported order matches comics by content before path", async (t) => {
  // The same comic filed under a different name is still the same comic, and
  // the fingerprint is what knows that.
  const orders = await store(t);
  const document = {
    format: "panelshelf.reading-order",
    formatVersion: 1,
    name: "Crisis",
    entries: [
      { position: 1, comicId: "elsewhere", fingerprint: "fp1_b", relativePath: "Nowhere.cbz", title: "Two" }
    ]
  };

  const { order, report } = await orders.importOrder(document, LIBRARY);

  assert.deepEqual(order.comicIds, [ID("b")], "matched on contents, not on the stale id");
  assert.equal(report.matched, 1);
  assert.equal(report.missing.length, 0);
  assert.deepEqual(report.matchedBy, { fingerprint: 1, relativePath: 0, title: 0 });
  // Same contents, different place: worth saying so, because it is the one
  // case where the import is right and the document is out of date.
  assert.deepEqual(
    report.moved.map((entry) => [entry.was, entry.now]),
    [["Nowhere.cbz", "Two.cbz"]]
  );
});

test("an imported order falls back to path, then to title", async (t) => {
  const orders = await store(t);
  const document = {
    format: "panelshelf.reading-order",
    formatVersion: 1,
    name: "Mixed",
    entries: [
      { position: 1, fingerprint: "fp1_unknown", relativePath: "Three.cbz", title: "Three" },
      { position: 2, fingerprint: "fp1_unknown", relativePath: "Gone.cbz", title: "One", series: "A Series" }
    ]
  };

  const { order, report } = await orders.importOrder(document, LIBRARY);

  assert.deepEqual(order.comicIds, [ID("c"), ID("a")]);
  assert.deepEqual(report.matchedBy, { fingerprint: 0, relativePath: 1, title: 1 });
});

test("entries with nothing to match are reported, not silently dropped", async (t) => {
  // An order that quietly comes back shorter than it left is worse than one
  // that says what it could not find.
  const orders = await store(t);
  const document = {
    format: "panelshelf.reading-order",
    formatVersion: 1,
    name: "Partial",
    entries: [
      { position: 1, fingerprint: "fp1_a", title: "One" },
      { position: 2, fingerprint: "fp1_missing", relativePath: "Absent.cbz", title: "Absent Issue" }
    ]
  };

  const { order, report } = await orders.importOrder(document, LIBRARY);

  assert.deepEqual(order.comicIds, [ID("a")]);
  assert.equal(report.matched, 1);
  assert.deepEqual(
    report.missing.map((entry) => entry.title),
    ["Absent Issue"]
  );
});

test("a document that is not a PanelShelf order is refused", async (t) => {
  const orders = await store(t);
  await assert.rejects(
    () => orders.importOrder({ name: "nope", entries: [] }, LIBRARY),
    /reading order/i
  );
});

test("a repair report names missing, duplicated and moved entries", async (t) => {
  const orders = await store(t);
  const created = await orders.create(
    { name: "Bent", comicIds: [ID("a"), ID("b"), ID("c")] },
    LIBRARY
  );
  // A duplicate cannot be made through the API — create and update both dedupe
  // — so this models the way one actually arrives: a restored backup or a
  // hand-edited file. `b` has meanwhile left the library.
  orders.get(created.id).comicIds = [ID("a"), ID("b"), ID("c"), ID("c")];

  const report = orders.repairReport(created.id, [LIBRARY[0], LIBRARY[2]]);

  assert.deepEqual(report.missing, [ID("b")], "in the order, not in the library");
  assert.deepEqual(report.duplicated, [ID("c")]);
  assert.equal(report.healthy, false);
});

test("repairing drops what is missing and keeps the first of each duplicate", async (t) => {
  const orders = await store(t);
  const created = await orders.create({ name: "Bent", comicIds: [ID("a"), ID("b"), ID("c")] }, LIBRARY);
  orders.get(created.id).comicIds = [ID("a"), ID("b"), ID("c"), ID("c")];

  const repaired = await orders.repair(created.id, [LIBRARY[0], LIBRARY[2]]);

  assert.deepEqual(repaired.comicIds, [ID("a"), ID("c")], "order preserved, first copy kept");
  assert.equal(orders.repairReport(created.id, [LIBRARY[0], LIBRARY[2]]).healthy, true);
});

test("repairing an order that is already sound changes nothing", async (t) => {
  const orders = await store(t);
  const created = await orders.create({ name: "Fine", comicIds: [ID("a"), ID("b")] }, LIBRARY);

  const report = orders.repairReport(created.id, LIBRARY);
  assert.equal(report.healthy, true);

  const repaired = await orders.repair(created.id, LIBRARY);
  assert.deepEqual(repaired.comicIds, [ID("a"), ID("b")]);
});

test("two entries cannot both claim the same comic", async (t) => {
  // Two files with identical bytes have identical fingerprints, and a comic
  // library is full of those — the same issue filed twice under different
  // names. Without claiming, both entries match the same local comic and the
  // order silently comes back one entry shorter, having reported two matches.
  const orders = await store(t);
  const single = [comic("a", "One.cbz")];
  const document = {
    format: "panelshelf.reading-order",
    formatVersion: 1,
    name: "Twins",
    entries: [
      { position: 1, fingerprint: "fp1_a", relativePath: "One.cbz", title: "One" },
      { position: 2, fingerprint: "fp1_a", relativePath: "Copy.cbz", title: "Copy" }
    ]
  };

  const { order, report } = await orders.importOrder(document, single);

  assert.deepEqual(order.comicIds, [ID("a")], "the comic is used once");
  assert.equal(report.matched, 1, "and the count says so, rather than claiming two");
  assert.deepEqual(
    report.missing.map((entry) => entry.title),
    ["Copy"],
    "the entry that found nothing left of its own is reported"
  );
});

test("duplicate copies in the library can each answer for one entry", async (t) => {
  const orders = await store(t);
  const library = [comic("a", "One.cbz"), comic("b", "Two.cbz", { fingerprint: "fp1_a" })];
  const document = {
    format: "panelshelf.reading-order",
    formatVersion: 1,
    name: "Twins",
    entries: [
      { position: 1, fingerprint: "fp1_a", relativePath: "One.cbz", title: "One" },
      { position: 2, fingerprint: "fp1_a", relativePath: "Two.cbz", title: "Two" }
    ]
  };

  const { order, report } = await orders.importOrder(document, library);

  // Both are matched on contents, because both genuinely are that content —
  // the second entry gets the second copy rather than being called missing.
  assert.deepEqual(order.comicIds, [ID("a"), ID("b")]);
  assert.deepEqual(report.matchedBy, { fingerprint: 2, relativePath: 0, title: 0 });
});
