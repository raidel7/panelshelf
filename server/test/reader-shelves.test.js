"use strict";

const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ComicLibrary } = require("../src/library");
const { ProgressStore } = require("../src/progress");
const { SkipStore } = require("../src/skips");
const { DEFAULT_READER_ID } = require("../src/reader-profiles");

const COMIC_A = "a".repeat(24);
const COMIC_B = "b".repeat(24);
const NODE_A = "chronology/source:src_1/folder:0030%20Secret%20Wars";
const NODE_B = "chronology/source:src_1/folder:Anita%20Blake";

async function directory(t, label) {
  const made = await fsp.mkdtemp(path.join(os.tmpdir(), `panelshelf-${label}-`));
  t.after(async () => {
    await fsp.rm(made, { recursive: true, force: true });
  });
  return made;
}

async function libraryIn(t, label) {
  const root = await directory(t, label);
  const library = new ComicLibrary(path.join(root, "data"));
  await library.initialize();
  t.after(async () => {
    // The stores stamp and write outside the request that triggered them, so a
    // pending write must land before the directory goes.
    await library.progress.settled().catch(() => {});
    await library.skips.settled().catch(() => {});
    await library.readerProfiles.settled().catch(() => {});
  });
  return library;
}

test("a 0.4.18 progress file becomes the default reader's shelf", async (t) => {
  const data = await directory(t, "progress-migration");
  // Exactly what 0.4.18 wrote: a flat map of comic id to record, no namespace.
  await fsp.writeFile(
    path.join(data, "progress.json"),
    JSON.stringify({
      [COMIC_A]: {
        pageIndex: 12,
        pageCount: 30,
        completed: false,
        skipped: false,
        lastReadAt: "2026-08-12T00:00:00.000Z",
        orderId: null
      }
    }),
    "utf8"
  );

  const store = new ProgressStore(data);
  await store.initialize();
  assert.equal(store.get(DEFAULT_READER_ID, COMIC_A).pageIndex, 12);

  // And the upgrade is silent in both directions: a client that names nobody
  // still reads and writes exactly what it did before.
  await store.save(DEFAULT_READER_ID, COMIC_B, { pageIndex: 1, pageCount: 10 });
  const reopened = new ProgressStore(data);
  await reopened.initialize();
  assert.equal(reopened.get(DEFAULT_READER_ID, COMIC_A).pageIndex, 12);
  assert.equal(reopened.get(DEFAULT_READER_ID, COMIC_B).pageIndex, 1);
});

test("a 0.4.18 skip file becomes the default reader's hidden branches", async (t) => {
  for (const stored of [{ nodeIds: [NODE_A] }, [NODE_A]]) {
    const data = await directory(t, "skips-migration");
    await fsp.writeFile(path.join(data, "skips.json"), JSON.stringify(stored), "utf8");

    const store = new SkipStore(data);
    await store.initialize();
    assert.deepEqual(store.list(DEFAULT_READER_ID).nodeIds, [NODE_A]);
  }
});

test("two readers do not see each other's shelves", async (t) => {
  const data = await directory(t, "two-readers");
  const progress = new ProgressStore(data);
  await progress.initialize();

  await progress.save(DEFAULT_READER_ID, COMIC_A, { pageIndex: 40, pageCount: 60 });
  await progress.save("ana", COMIC_A, { pageIndex: 3, pageCount: 60 });

  assert.equal(progress.get(DEFAULT_READER_ID, COMIC_A).pageIndex, 40);
  assert.equal(progress.get("ana", COMIC_A).pageIndex, 3);
  assert.equal(progress.get("ana", COMIC_B), null);

  // Including the reconciling write, which is the one that would otherwise
  // quietly overwrite: "page 3" from Ana must not be newer than "page 40" from
  // somebody else, because they are not about the same shelf at all.
  await progress.merge("ana", {
    [COMIC_A]: { pageIndex: 9, lastReadAt: "2099-01-01T00:00:00.000Z" }
  });
  assert.equal(progress.get(DEFAULT_READER_ID, COMIC_A).pageIndex, 40);
  assert.equal(progress.get("ana", COMIC_A).pageIndex, 9);

  const reopened = new ProgressStore(data);
  await reopened.initialize();
  assert.equal(reopened.get(DEFAULT_READER_ID, COMIC_A).pageIndex, 40);
  assert.equal(reopened.get("ana", COMIC_A).pageIndex, 9);
});

test("two readers do not see each other's hidden branches", async (t) => {
  const data = await directory(t, "two-readers-skips");
  const skips = new SkipStore(data);
  await skips.initialize();

  await skips.apply(DEFAULT_READER_ID, { add: [NODE_A] });
  await skips.apply("ana", { add: [NODE_B] });
  assert.deepEqual(skips.list(DEFAULT_READER_ID).nodeIds, [NODE_A]);
  assert.deepEqual(skips.list("ana").nodeIds, [NODE_B]);

  // A branch one person un-hides stays hidden for the other.
  await skips.apply("ana", { add: [NODE_A] });
  await skips.apply("ana", { remove: [NODE_A] });
  assert.deepEqual(skips.list(DEFAULT_READER_ID).nodeIds, [NODE_A]);

  const reopened = new SkipStore(data);
  await reopened.initialize();
  assert.deepEqual(reopened.list(DEFAULT_READER_ID).nodeIds, [NODE_A]);
  assert.deepEqual(reopened.list("ana").nodeIds, [NODE_B]);
});

test("the stores refuse a request that names no reader", async (t) => {
  const data = await directory(t, "unnamed-reader");
  const progress = new ProgressStore(data);
  await progress.initialize();
  const skips = new SkipStore(data);
  await skips.initialize();

  // Resolution happens once, at the request. A call that arrives here without
  // an id is a bug, and filing one person's position on another person's shelf
  // is not an acceptable way to report it.
  for (const bad of [undefined, null, "", "NOT AN ID", 7, "x".repeat(41)]) {
    assert.throws(() => progress.get(bad, COMIC_A), { code: "INVALID_READER_PROFILE" });
    assert.throws(() => skips.list(bad), { code: "INVALID_READER_PROFILE" });
    await assert.rejects(() => progress.save(bad, COMIC_A, { pageIndex: 1 }), {
      code: "INVALID_READER_PROFILE"
    });
    await assert.rejects(() => skips.apply(bad, { add: [NODE_A] }), {
      code: "INVALID_READER_PROFILE"
    });
  }
});

test("an empty shelf is not written out", async (t) => {
  const data = await directory(t, "empty-shelf");
  const progress = new ProgressStore(data);
  await progress.initialize();

  await progress.save("ana", COMIC_A, { pageIndex: 1 });
  await progress.remove("ana", COMIC_A);
  const written = JSON.parse(await fsp.readFile(path.join(data, "progress.json"), "utf8"));
  assert.deepEqual(written, { readers: {} }, "a shelf with nothing on it says nothing");
});

test("deleting a reader profile takes its shelf with it", async (t) => {
  const library = await libraryIn(t, "delete-reader");

  const ana = await library.createReaderProfile("Ana");
  await library.saveProgress(ana.id, COMIC_A, { pageIndex: 5, pageCount: 20 });
  await library.applySkips(ana.id, { add: [NODE_A] });
  await library.saveProgress(DEFAULT_READER_ID, COMIC_A, { pageIndex: 9, pageCount: 20 });

  assert.equal(await library.deleteReaderProfile(ana.id), true);
  assert.equal(library.getProgress(ana.id, COMIC_A), null);
  assert.deepEqual(library.listSkips(ana.id).nodeIds, []);
  // And nobody else's shelf moved.
  assert.equal(library.getProgress(DEFAULT_READER_ID, COMIC_A).pageIndex, 9);

  // A name nobody has resolves to the default, so a client still reading under
  // the deleted profile sees the default shelf rather than an error.
  assert.equal(library.resolveReaderProfile("Ana"), DEFAULT_READER_ID);
  assert.equal(await library.deleteReaderProfile(ana.id), false);
  await assert.rejects(() => library.deleteReaderProfile(DEFAULT_READER_ID), {
    code: "INVALID_READER_PROFILE"
  });
});

test("a backup carries every reader's shelf and restores it", async (t) => {
  const library = await libraryIn(t, "backup-readers");

  const ana = await library.createReaderProfile("Ana");
  await library.saveProgress(DEFAULT_READER_ID, COMIC_A, { pageIndex: 40, pageCount: 60 });
  await library.saveProgress(ana.id, COMIC_A, { pageIndex: 3, pageCount: 60 });
  await library.applySkips(ana.id, { add: [NODE_B] });

  const backup = library.createBackup({}, "test");
  assert.equal(backup.data.readers.progress.ana[COMIC_A].pageIndex, 3);
  assert.deepEqual(backup.data.readers.skips.ana, [NODE_B]);
  // The browser block still carries the default profile's shelf, so a 0.4.18
  // server restoring this file puts back a shelf rather than refusing the file.
  assert.equal(backup.data.browser.progress[COMIC_A].pageIndex, 40);
  assert.equal(backup.schemaVersion, 1);

  await library.deleteReaderProfile(ana.id);
  await library.saveProgress(DEFAULT_READER_ID, COMIC_A, { pageIndex: 1, pageCount: 60 });

  await library.restoreBackup(backup);
  assert.equal(library.getProgress(DEFAULT_READER_ID, COMIC_A).pageIndex, 40);
  assert.equal(library.getProgress("ana", COMIC_A).pageIndex, 3);
  assert.deepEqual(library.listSkips("ana").nodeIds, [NODE_B]);
  assert.equal(library.resolveReaderProfile("Ana"), "ana", "the name came back too");
});

test("a backup from before reader profiles restores into the default", async (t) => {
  const library = await libraryIn(t, "backup-v1");
  await library.saveProgress(DEFAULT_READER_ID, COMIC_A, { pageIndex: 7, pageCount: 20 });

  // A 0.4.18 backup: schema 1, a browser block, and no `readers` at all.
  const backup = library.createBackup({}, "0.4.18");
  delete backup.data.readers;
  backup.data.browser.chronologyPreferences.skippedNodeIds = [NODE_A];

  await library.createReaderProfile("Ana");
  await library.saveProgress("ana", COMIC_B, { pageIndex: 2, pageCount: 20 });

  await library.restoreBackup(backup);
  assert.equal(library.getProgress(DEFAULT_READER_ID, COMIC_A).pageIndex, 7);
  assert.deepEqual(library.listSkips(DEFAULT_READER_ID).nodeIds, [NODE_A]);
  // The backup described one shelf, so one shelf is what the server now has.
  assert.deepEqual(
    library.listReaderProfiles().map((profile) => profile.id),
    [DEFAULT_READER_ID]
  );
  assert.equal(library.getProgress(DEFAULT_READER_ID, COMIC_B), null);
});
