"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeRecord, normalizeRecords } = require("../src/progress");

const COMIC_A = "a".repeat(24);
const COMIC_B = "b".repeat(24);

test("normalizeRecord clamps numbers and coerces flags", () => {
  const record = normalizeRecord({
    pageIndex: -4,
    pageCount: "32",
    completed: 1,
    skipped: 0,
    lastReadAt: "2026-08-12T03:00:00.000Z",
    orderId: "marvel-1980s"
  });

  assert.deepEqual(record, {
    pageIndex: 0,
    pageCount: 32,
    completed: true,
    skipped: false,
    lastReadAt: "2026-08-12T03:00:00.000Z",
    orderId: "marvel-1980s"
  });
});

test("normalizeRecord truncates long strings and defaults missing fields", () => {
  const record = normalizeRecord({
    pageIndex: 3.7,
    lastReadAt: "x".repeat(60),
    orderId: "y".repeat(120)
  });

  assert.equal(record.pageIndex, 3);
  assert.equal(record.pageCount, 0);
  assert.equal(record.completed, false);
  assert.equal(record.skipped, false);
  assert.equal(record.lastReadAt.length, 40);
  assert.equal(record.orderId.length, 80);
});

test("normalizeRecord rejects a non-object", () => {
  assert.throws(() => normalizeRecord("nope"), { code: "INVALID_PROGRESS" });
});

test("normalizeRecords drops invalid ids and invalid records", () => {
  const records = normalizeRecords({
    [COMIC_A]: { pageIndex: 5, pageCount: 20 },
    "not-a-comic-id": { pageIndex: 1 },
    [COMIC_B]: "nonsense"
  });

  assert.deepEqual(Object.keys(records), [COMIC_A]);
  assert.equal(records[COMIC_A].pageIndex, 5);
});

test("normalizeRecord normalizes missing lastReadAt and orderId to null", () => {
  const record = normalizeRecord({ pageIndex: 1, pageCount: 10 });

  assert.equal(record.lastReadAt, null);
  assert.equal(record.orderId, null);
});

test("normalizeRecord normalizes garbage numeric input to 0", () => {
  const record = normalizeRecord({
    pageIndex: "abc",
    pageCount: NaN
  });

  assert.equal(record.pageIndex, 0);
  assert.equal(record.pageCount, 0);

  const infinityRecord = normalizeRecord({ pageIndex: Infinity, pageCount: Infinity });
  assert.equal(infinityRecord.pageIndex, 0);
  assert.equal(infinityRecord.pageCount, 0);
});

test("normalizeRecords returns {} for non-plain-object input instead of throwing", () => {
  assert.deepEqual(normalizeRecords([1, 2, 3]), {});
  assert.deepEqual(normalizeRecords("nonsense"), {});
  assert.deepEqual(normalizeRecords(null), {});
});

const { mergeRecords } = require("../src/progress");

test("mergeRecords keeps the newest record per comic", () => {
  const merged = mergeRecords(
    { [COMIC_A]: { pageIndex: 2, lastReadAt: "2026-08-10T00:00:00.000Z" } },
    { [COMIC_A]: { pageIndex: 9, lastReadAt: "2026-08-11T00:00:00.000Z" } }
  );

  assert.equal(merged[COMIC_A].pageIndex, 9);
});

test("mergeRecords keeps the existing record when the incoming one is older", () => {
  const merged = mergeRecords(
    { [COMIC_A]: { pageIndex: 9, lastReadAt: "2026-08-11T00:00:00.000Z" } },
    { [COMIC_A]: { pageIndex: 2, lastReadAt: "2026-08-10T00:00:00.000Z" } }
  );

  assert.equal(merged[COMIC_A].pageIndex, 9);
});

test("mergeRecords prefers a timestamped record over an untimestamped one", () => {
  const merged = mergeRecords(
    { [COMIC_A]: { pageIndex: 9, lastReadAt: "2026-08-11T00:00:00.000Z" } },
    { [COMIC_A]: { pageIndex: 2, lastReadAt: null } }
  );

  assert.equal(merged[COMIC_A].pageIndex, 9);
});

test("mergeRecords takes the incoming record when neither has a timestamp", () => {
  const merged = mergeRecords(
    { [COMIC_A]: { pageIndex: 9, lastReadAt: "not a date" } },
    { [COMIC_A]: { pageIndex: 2, lastReadAt: null } }
  );

  assert.equal(merged[COMIC_A].pageIndex, 2);
});

test("mergeRecords adds records that only exist on one side", () => {
  const merged = mergeRecords(
    { [COMIC_A]: { pageIndex: 1 } },
    { [COMIC_B]: { pageIndex: 4 } }
  );

  assert.deepEqual(Object.keys(merged).sort(), [COMIC_A, COMIC_B].sort());
});

test("mergeRecords takes the incoming record when the existing one has no usable timestamp", () => {
  const merged = mergeRecords(
    { [COMIC_A]: { pageIndex: 9, lastReadAt: null } },
    { [COMIC_A]: { pageIndex: 2, lastReadAt: "2026-08-11T00:00:00.000Z" } }
  );

  assert.equal(merged[COMIC_A].pageIndex, 2);
});

test("mergeRecords lets the incoming record win a timestamp tie", () => {
  const merged = mergeRecords(
    { [COMIC_A]: { pageIndex: 9, lastReadAt: "2026-08-11T00:00:00.000Z" } },
    { [COMIC_A]: { pageIndex: 2, lastReadAt: "2026-08-11T00:00:00.000Z" } }
  );

  assert.equal(merged[COMIC_A].pageIndex, 2);
});

const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { ProgressStore } = require("../src/progress");

async function temporaryStore() {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-progress-"));
  const store = new ProgressStore(directory);
  await store.initialize();
  return { directory, store };
}

test("save stamps lastReadAt and round-trips through disk", async () => {
  const { directory, store } = await temporaryStore();

  const saved = await store.save(COMIC_A, { pageIndex: 13, pageCount: 32 });
  assert.equal(saved.pageIndex, 13);
  assert.ok(Date.parse(saved.lastReadAt) > 0);

  const reopened = new ProgressStore(directory);
  await reopened.initialize();
  assert.equal(reopened.get(COMIC_A).pageIndex, 13);
});

test("save rejects an invalid comic id", async () => {
  const { store } = await temporaryStore();
  await assert.rejects(() => store.save("nope", { pageIndex: 1 }), {
    code: "NOT_FOUND"
  });
});

test("remove deletes a record", async () => {
  const { store } = await temporaryStore();
  await store.save(COMIC_A, { pageIndex: 3 });
  await store.remove(COMIC_A);
  assert.equal(store.get(COMIC_A), null);
});

test("merge applies newest-wins and persists", async () => {
  const { directory, store } = await temporaryStore();
  await store.save(COMIC_A, { pageIndex: 3 });

  await store.merge({
    [COMIC_A]: { pageIndex: 30, lastReadAt: "2000-01-01T00:00:00.000Z" },
    [COMIC_B]: { pageIndex: 7, lastReadAt: "2026-08-12T00:00:00.000Z" }
  });

  const reopened = new ProgressStore(directory);
  await reopened.initialize();
  assert.equal(reopened.get(COMIC_A).pageIndex, 3, "older incoming record loses");
  assert.equal(reopened.get(COMIC_B).pageIndex, 7);
});

test("initialize tolerates a missing file", async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-progress-"));
  const store = new ProgressStore(directory);
  await store.initialize();
  assert.deepEqual(store.exportData(), {});
});

test("initialize tolerates a corrupt file, preserving it and starting empty", async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-progress-"));
  const filePath = path.join(directory, "progress.json");
  await fsp.writeFile(filePath, "{ this is not valid json");

  const store = new ProgressStore(directory);
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await store.initialize();
  } finally {
    console.warn = originalWarn;
  }

  assert.deepEqual(store.exportData(), {});

  const entries = await fsp.readdir(directory);
  assert.equal(entries.includes("progress.json"), false);
  const corruptEntry = entries.find((name) => name.startsWith("progress.json.corrupt-"));
  assert.ok(corruptEntry, "corrupt file should be preserved under a new name");

  const preserved = await fsp.readFile(path.join(directory, corruptEntry), "utf8");
  assert.equal(preserved, "{ this is not valid json");
});

test("save serializes concurrent writes so the persisted file is never torn", async () => {
  const { directory, store } = await temporaryStore();

  await Promise.all([
    store.save(COMIC_A, { pageIndex: 1 }),
    store.merge({ [COMIC_B]: { pageIndex: 2, lastReadAt: "2026-08-12T00:00:00.000Z" } }),
    store.save(COMIC_A, { pageIndex: 3 }),
    store.merge({ [COMIC_B]: { pageIndex: 4, lastReadAt: "2026-08-12T00:00:01.000Z" } })
  ]);

  const raw = await fsp.readFile(path.join(directory, "progress.json"), "utf8");
  const parsed = JSON.parse(raw);
  assert.equal(typeof parsed, "object");

  const reopened = new ProgressStore(directory);
  await reopened.initialize();
  assert.ok(reopened.get(COMIC_A), "comic A record should have persisted");
  assert.ok(reopened.get(COMIC_B), "comic B record should have persisted");
});

const canRestrictOwnWrites = typeof process.getuid === "function" && process.getuid() !== 0;

test(
  "a failed write does not poison the queue for later writes",
  { skip: !canRestrictOwnWrites && "requires an unprivileged user for chmod to deny writes" },
  async () => {
    const { directory, store } = await temporaryStore();

    await fsp.chmod(directory, 0o500);
    let firstError = null;
    try {
      await store.save(COMIC_A, { pageIndex: 1 });
      assert.fail("expected the write to fail while the directory is read-only");
    } catch (error) {
      firstError = error;
    } finally {
      await fsp.chmod(directory, 0o700);
    }
    assert.ok(firstError, "the failing save should reject with its own error");

    const saved = await store.save(COMIC_B, { pageIndex: 2 });
    assert.equal(saved.pageIndex, 2);

    const reopened = new ProgressStore(directory);
    await reopened.initialize();
    assert.equal(reopened.get(COMIC_B).pageIndex, 2, "the later write should have reached disk");
  }
);

test("applyBatch stamps server time and applies over a newer stored record", async () => {
  const { directory, store } = await temporaryStore();
  await store.save(COMIC_A, { pageIndex: 3, pageCount: 30 });
  await store.save(COMIC_B, { pageIndex: 4, pageCount: 30 });

  // A client whose clock runs slow: the incoming stamp is older than the one
  // already stored, which merge would reject. A deliberate write must not care.
  const applied = await store.applyBatch({
    records: {
      [COMIC_A]: {
        pageIndex: 29,
        pageCount: 30,
        completed: true,
        lastReadAt: "2000-01-01T00:00:00.000Z"
      }
    },
    deleted: [COMIC_B]
  });

  assert.equal(applied[COMIC_A].pageIndex, 29);
  assert.equal(applied[COMIC_A].completed, true);
  assert.ok(
    Date.parse(applied[COMIC_A].lastReadAt) > Date.parse("2020-01-01T00:00:00.000Z"),
    "the client's stale timestamp is replaced with the server's"
  );
  assert.equal(applied[COMIC_B], undefined);

  const reopened = new ProgressStore(directory);
  await reopened.initialize();
  assert.equal(reopened.get(COMIC_A).pageIndex, 29);
  assert.equal(reopened.get(COMIC_B), null);
});

test("applyBatch tolerates missing halves and an empty batch", async () => {
  const { store } = await temporaryStore();
  await store.save(COMIC_A, { pageIndex: 3 });

  assert.deepEqual(await store.applyBatch({}), store.exportData());
  await store.applyBatch({ deleted: [COMIC_A] });
  assert.equal(store.get(COMIC_A), null);
  await store.applyBatch({ records: { [COMIC_B]: { pageIndex: 1 } } });
  assert.equal(store.get(COMIC_B).pageIndex, 1);
});

test("applyBatch rejects a bad batch without applying any of it", async () => {
  const { store } = await temporaryStore();
  await store.save(COMIC_A, { pageIndex: 3 });

  await assert.rejects(
    () => store.applyBatch({ records: { nope: { pageIndex: 1 } }, deleted: [COMIC_A] }),
    { code: "NOT_FOUND" }
  );
  await assert.rejects(() => store.applyBatch({ deleted: [COMIC_A, "nope"] }), {
    code: "NOT_FOUND"
  });
  await assert.rejects(() => store.applyBatch({ records: [] }), {
    code: "INVALID_PROGRESS"
  });
  await assert.rejects(() => store.applyBatch({ deleted: {} }), {
    code: "INVALID_PROGRESS"
  });
  await assert.rejects(() => store.applyBatch("nope"), { code: "INVALID_PROGRESS" });

  assert.equal(store.get(COMIC_A).pageIndex, 3, "a rejected batch changes nothing");
});
