"use strict";

const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  ReadingOrderStore,
  automaticReadingOrders,
  comparePathSegments
} = require("../src/reading-orders");

function comic(id, sourceId, relativePath, profile) {
  return {
    id,
    sourceId,
    sourceName: "Source",
    sourceProfile: profile,
    relativePath,
    folderSegments:
      path.dirname(relativePath) === "."
        ? []
        : path.dirname(relativePath).split(path.sep),
    hierarchy: []
  };
}

test("path ordering respects numeric folders and dotted insertions", () => {
  assert.ok(
    comparePathSegments(
      "09 Modern/0029.1 Daredevil/001.cbz",
      "09 Modern/0030 Secret Wars/001.cbz"
    ) < 0
  );
  assert.ok(comparePathSegments("2.cbz", "10.cbz") < 0);
});

test("automatic orders cross folders only for an exact source", () => {
  const exactSource = "src_111111111111111111111111";
  const timelineSource = "src_222222222222222222222222";
  const comics = [
    comic(
      "aaaaaaaaaaaaaaaaaaaaaaaa",
      exactSource,
      "001 Early/001 First.cbz",
      "exact-reading-order"
    ),
    comic(
      "bbbbbbbbbbbbbbbbbbbbbbbb",
      exactSource,
      "002 Later/001 Second.cbz",
      "exact-reading-order"
    ),
    comic(
      "cccccccccccccccccccccccc",
      timelineSource,
      "04 New 52/Batman Family/Batman 001.cbz",
      "hierarchical-timeline"
    ),
    comic(
      "dddddddddddddddddddddddd",
      timelineSource,
      "04 New 52/Superman Family/Superman 001.cbz",
      "hierarchical-timeline"
    )
  ];
  const orders = automaticReadingOrders(comics, [
    { id: exactSource, name: "Exact", profile: "exact-reading-order" },
    {
      id: timelineSource,
      name: "DC",
      profile: "hierarchical-timeline"
    }
  ]);
  const exact = orders.find((order) => order.profile === "exact-reading-order");
  const timeline = orders.filter(
    (order) => order.profile === "hierarchical-timeline"
  );
  assert.deepEqual(exact.comicIds, [
    "aaaaaaaaaaaaaaaaaaaaaaaa",
    "bbbbbbbbbbbbbbbbbbbbbbbb"
  ]);
  assert.equal(timeline.length, 2);
  assert.ok(timeline.every((order) => order.comicIds.length === 1));
});

test("manual orders persist and place newly scanned comics in Unplaced", async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-orders-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const sourceId = "src_333333333333333333333333";
  const first = comic(
    "111111111111111111111111",
    sourceId,
    "First.cbz",
    "loose-comics"
  );
  const second = comic(
    "222222222222222222222222",
    sourceId,
    "Second.cbz",
    "loose-comics"
  );
  const store = new ReadingOrderStore(directory);
  await store.initialize([first]);
  const created = await store.create(
    { name: "My order", comicIds: [first.id] },
    [first]
  );
  assert.equal(created.name, "My order");

  await store.reconcile([first, second]);
  const [reconciled] = store.list([first, second], []).manual;
  assert.deepEqual(reconciled.unplacedComicIds, [second.id]);

  const updated = await store.update(
    created.id,
    {
      name: "Renamed order",
      comicIds: [first.id, second.id],
      unplacedComicIds: []
    },
    [first, second]
  );
  assert.equal(updated.name, "Renamed order");
  assert.deepEqual(updated.comicIds, [first.id, second.id]);
  assert.deepEqual(updated.unplacedComicIds, []);

  const duplicate = await store.duplicate(created.id, [first, second]);
  assert.match(duplicate.name, /copy$/);
  await store.delete(duplicate.id);
  assert.equal(store.list([first, second], []).manual.length, 1);

  const reloaded = new ReadingOrderStore(directory);
  await reloaded.initialize([first, second]);
  assert.equal(reloaded.list([first, second], []).manual[0].name, "Renamed order");
});
