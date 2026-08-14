"use strict";

const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { SkipStore, normalizeNodeIds } = require("../src/skips");

const NODE_A = "chronology/source:src_1/folder:0030%20Secret%20Wars";
const NODE_B = "chronology/source:src_1/folder:Anita%20Blake";

async function makeStore(t) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-skips-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const store = new SkipStore(directory);
  await store.initialize();
  return { store, directory };
}

test("skips are added, removed, and survive a restart", async (t) => {
  const { store, directory } = await makeStore(t);

  assert.deepEqual(store.list(), { nodeIds: [] });
  await store.apply({ add: [NODE_A, NODE_B] });
  assert.deepEqual(store.list().nodeIds.sort(), [NODE_B, NODE_A].sort());

  // Adding the same branch twice is the same as adding it once: there is no
  // ordering to reconcile, which is the whole reason this needs no timestamps.
  await store.apply({ add: [NODE_A] });
  assert.equal(store.list().nodeIds.length, 2);

  await store.apply({ remove: [NODE_A] });
  assert.deepEqual(store.list().nodeIds, [NODE_B]);

  const restarted = new SkipStore(directory);
  await restarted.initialize();
  assert.deepEqual(restarted.list().nodeIds, [NODE_B]);
});

test("a request that both adds and removes a branch leaves it skipped", async (t) => {
  const { store } = await makeStore(t);
  await store.apply({ add: [NODE_A], remove: [NODE_A] });
  assert.deepEqual(store.list().nodeIds, [NODE_A]);
});

test("malformed skip requests are refused rather than half-applied", async (t) => {
  const { store } = await makeStore(t);
  await store.apply({ add: [NODE_A] });

  for (const bad of [null, "nope", [], 7]) {
    await assert.rejects(() => store.apply(bad), /object/i);
  }
  await assert.rejects(() => store.apply({ add: "not-a-list" }), /list of node ids/i);
  await assert.rejects(() => store.apply({ remove: {} }), /list of node ids/i);

  assert.deepEqual(store.list().nodeIds, [NODE_A], "nothing changed");
});

test("an oversized set is refused and leaves the store untouched", async (t) => {
  const { store } = await makeStore(t);
  await store.apply({ add: [NODE_A] });

  const flood = Array.from({ length: 20_001 }, (unused, index) => `node-${index}`);
  await assert.rejects(() => store.apply({ add: flood }), /Too many/i);

  // Memory and disk must still agree: a refused request that had already
  // mutated the set would leave the two apart until the next write.
  assert.deepEqual(store.list().nodeIds, [NODE_A]);
});

test("unusable ids are dropped without failing the request", () => {
  assert.deepEqual(normalizeNodeIds([NODE_A, "", "   ", null, 7, NODE_A]), [NODE_A]);
  assert.deepEqual(normalizeNodeIds("not a list"), []);
  // A node id longer than any real branch is a client bug, not a folder.
  assert.deepEqual(normalizeNodeIds(["x".repeat(513)]), []);
  assert.deepEqual(normalizeNodeIds(["x".repeat(512)]).length, 1);
});

test("a corrupt skip file is preserved and the store starts empty", async (t) => {
  const { store, directory } = await makeStore(t);
  await store.apply({ add: [NODE_A] });
  await fsp.writeFile(store.filePath, "{ this is not json", "utf8");

  const restarted = new SkipStore(directory);
  await restarted.initialize();
  assert.deepEqual(restarted.list().nodeIds, []);

  const preserved = (await fsp.readdir(directory)).filter((name) =>
    name.includes("corrupt")
  );
  assert.equal(preserved.length, 1, "the unreadable file is kept for inspection");
});

test("both the wrapped and bare forms are read back", async (t) => {
  const { store, directory } = await makeStore(t);
  // What this store writes.
  await fsp.writeFile(store.filePath, JSON.stringify({ nodeIds: [NODE_A] }), "utf8");
  let restarted = new SkipStore(directory);
  await restarted.initialize();
  assert.deepEqual(restarted.list().nodeIds, [NODE_A]);

  // And a bare array, which is what a hand-edited file or an older shape looks
  // like — worth accepting rather than silently discarding someone's skips.
  await fsp.writeFile(store.filePath, JSON.stringify([NODE_B]), "utf8");
  restarted = new SkipStore(directory);
  await restarted.initialize();
  assert.deepEqual(restarted.list().nodeIds, [NODE_B]);
});
