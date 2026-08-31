"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  applyDeletions,
  normalizeRecord,
  normalizeRecords
} = require("../src/progress");

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
const { DEFAULT_READER_ID: READER } = require("../src/reader-profiles");

async function temporaryStore() {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-progress-"));
  const store = new ProgressStore(directory);
  await store.initialize();
  return { directory, store };
}

test("save stamps lastReadAt and round-trips through disk", async () => {
  const { directory, store } = await temporaryStore();

  const saved = await store.save(READER, COMIC_A, { pageIndex: 13, pageCount: 32 });
  assert.equal(saved.pageIndex, 13);
  assert.ok(Date.parse(saved.lastReadAt) > 0);

  const reopened = new ProgressStore(directory);
  await reopened.initialize();
  assert.equal(reopened.get(READER, COMIC_A).pageIndex, 13);
});

test("save rejects an invalid comic id", async () => {
  const { store } = await temporaryStore();
  await assert.rejects(() => store.save(READER, "nope", { pageIndex: 1 }), {
    code: "NOT_FOUND"
  });
});

test("remove deletes a record", async () => {
  const { store } = await temporaryStore();
  await store.save(READER, COMIC_A, { pageIndex: 3 });
  await store.remove(READER, COMIC_A);
  assert.equal(store.get(READER, COMIC_A), null);
});

test("merge applies newest-wins and persists", async () => {
  const { directory, store } = await temporaryStore();
  await store.save(READER, COMIC_A, { pageIndex: 3 });

  await store.merge(READER, {
    [COMIC_A]: { pageIndex: 30, lastReadAt: "2000-01-01T00:00:00.000Z" },
    [COMIC_B]: { pageIndex: 7, lastReadAt: "2026-08-12T00:00:00.000Z" }
  });

  const reopened = new ProgressStore(directory);
  await reopened.initialize();
  assert.equal(reopened.get(READER, COMIC_A).pageIndex, 3, "older incoming record loses");
  assert.equal(reopened.get(READER, COMIC_B).pageIndex, 7);
});

test("initialize tolerates a missing file", async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-progress-"));
  const store = new ProgressStore(directory);
  await store.initialize();
  assert.deepEqual(store.exportData(READER), {});
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

  assert.deepEqual(store.exportData(READER), {});

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
    store.save(READER, COMIC_A, { pageIndex: 1 }),
    store.merge(READER, { [COMIC_B]: { pageIndex: 2, lastReadAt: "2026-08-12T00:00:00.000Z" } }),
    store.save(READER, COMIC_A, { pageIndex: 3 }),
    store.merge(READER, { [COMIC_B]: { pageIndex: 4, lastReadAt: "2026-08-12T00:00:01.000Z" } })
  ]);

  const raw = await fsp.readFile(path.join(directory, "progress.json"), "utf8");
  const parsed = JSON.parse(raw);
  assert.equal(typeof parsed, "object");

  const reopened = new ProgressStore(directory);
  await reopened.initialize();
  assert.ok(reopened.get(READER, COMIC_A), "comic A record should have persisted");
  assert.ok(reopened.get(READER, COMIC_B), "comic B record should have persisted");
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
      await store.save(READER, COMIC_A, { pageIndex: 1 });
      assert.fail("expected the write to fail while the directory is read-only");
    } catch (error) {
      firstError = error;
    } finally {
      await fsp.chmod(directory, 0o700);
    }
    assert.ok(firstError, "the failing save should reject with its own error");

    const saved = await store.save(READER, COMIC_B, { pageIndex: 2 });
    assert.equal(saved.pageIndex, 2);

    const reopened = new ProgressStore(directory);
    await reopened.initialize();
    assert.equal(reopened.get(READER, COMIC_B).pageIndex, 2, "the later write should have reached disk");
  }
);

test("applyBatch stamps server time and applies over a newer stored record", async () => {
  const { directory, store } = await temporaryStore();
  await store.save(READER, COMIC_A, { pageIndex: 3, pageCount: 30 });
  await store.save(READER, COMIC_B, { pageIndex: 4, pageCount: 30 });

  // A client whose clock runs slow: the incoming stamp is older than the one
  // already stored, which merge would reject. A deliberate write must not care.
  const applied = await store.applyBatch(READER, {
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
  assert.equal(reopened.get(READER, COMIC_A).pageIndex, 29);
  assert.equal(reopened.get(READER, COMIC_B), null);
});

test("applyBatch tolerates missing halves and an empty batch", async () => {
  const { store } = await temporaryStore();
  await store.save(READER, COMIC_A, { pageIndex: 3 });

  assert.deepEqual(await store.applyBatch(READER, {}), store.exportData(READER));
  await store.applyBatch(READER, { deleted: [COMIC_A] });
  assert.equal(store.get(READER, COMIC_A), null);
  await store.applyBatch(READER, { records: { [COMIC_B]: { pageIndex: 1 } } });
  assert.equal(store.get(READER, COMIC_B).pageIndex, 1);
});

test("applyBatch rejects a bad batch without applying any of it", async () => {
  const { store } = await temporaryStore();
  await store.save(READER, COMIC_A, { pageIndex: 3 });

  // A syntactically invalid id is a bad request, not a missing comic, and
  // unlike save()'s guard this one is reachable over HTTP: the batch route has
  // no id regex to pre-filter it.
  await assert.rejects(
    () => store.applyBatch(READER, { records: { nope: { pageIndex: 1 } }, deleted: [COMIC_A] }),
    { code: "INVALID_PROGRESS" }
  );
  await assert.rejects(() => store.applyBatch(READER, { deleted: [COMIC_A, "nope"] }), {
    code: "INVALID_PROGRESS"
  });
  await assert.rejects(() => store.applyBatch(READER, { deleted: [COMIC_A, 7] }), {
    code: "INVALID_PROGRESS"
  });
  await assert.rejects(() => store.applyBatch(READER, { records: [] }), {
    code: "INVALID_PROGRESS"
  });
  await assert.rejects(() => store.applyBatch(READER, { deleted: {} }), {
    code: "INVALID_PROGRESS"
  });
  await assert.rejects(() => store.applyBatch(READER, "nope"), { code: "INVALID_PROGRESS" });

  assert.equal(store.get(READER, COMIC_A).pageIndex, 3, "a rejected batch changes nothing");
});

test("applyBatch stages the whole batch before applying any of it", async () => {
  const { directory, store } = await temporaryStore();
  await store.save(READER, COMIC_A, { pageIndex: 3 });
  await store.save(READER, COMIC_B, { pageIndex: 4 });

  // The valid record comes first, so a store that assigned as it walked the
  // batch would already have applied it by the time the bad key threw.
  await assert.rejects(
    () =>
      store.applyBatch(READER, {
        records: { [COMIC_A]: { pageIndex: 20 }, nope: { pageIndex: 1 } }
      }),
    { code: "INVALID_PROGRESS" }
  );
  assert.equal(store.get(READER, COMIC_A).pageIndex, 3, "the earlier record is untouched");

  // Same again, but the throw comes from normalizeRecord partway through a
  // batch whose ids are all well formed.
  await assert.rejects(
    () =>
      store.applyBatch(READER, {
        records: { [COMIC_A]: { pageIndex: 20 }, [COMIC_B]: "not an object" }
      }),
    { code: "INVALID_PROGRESS" }
  );
  assert.equal(store.get(READER, COMIC_A).pageIndex, 3, "the earlier record is untouched");
  assert.equal(store.get(READER, COMIC_B).pageIndex, 4);

  const reopened = new ProgressStore(directory);
  await reopened.initialize();
  assert.equal(reopened.get(READER, COMIC_A).pageIndex, 3, "and nothing reached disk");
});

test("a queued deletion loses to a position read after it", async () => {
  // The iPad marked it unread offline at noon; a browser read to page 40 at
  // one. Applying the deletion when the iPad reconnects would throw away the
  // newer position and answer 200, which is the failure /merge exists to avoid.
  const records = {
    [COMIC_A]: {
      pageIndex: 40,
      pageCount: 100,
      completed: false,
      skipped: false,
      lastReadAt: "2026-08-13T13:00:00.000Z",
      orderId: null
    }
  };

  assert.deepEqual(
    applyDeletions(records, { [COMIC_A]: "2026-08-13T12:00:00.000Z" }),
    records,
    "the older deletion is discarded"
  );

  assert.deepEqual(
    applyDeletions(records, { [COMIC_A]: "2026-08-13T14:00:00.000Z" }),
    {},
    "a deletion newer than the record applies"
  );
});

test("a deletion with no usable timestamp cannot remove a dated record", () => {
  const records = {
    [COMIC_A]: {
      pageIndex: 3,
      pageCount: 10,
      completed: false,
      skipped: false,
      lastReadAt: "2026-08-13T13:00:00.000Z",
      orderId: null
    }
  };
  for (const bad of [null, "", "not a date", 17, undefined]) {
    assert.deepEqual(
      applyDeletions(records, { [COMIC_A]: bad }),
      records,
      `a ${JSON.stringify(bad)} deletion must not delete anything`
    );
  }

  // A record the server never dated is the other way round: there is nothing
  // to weigh the deletion against, so the user's action stands.
  const undated = { [COMIC_A]: { ...records[COMIC_A], lastReadAt: null } };
  assert.deepEqual(applyDeletions(undated, { [COMIC_A]: "2026-08-13T12:00:00.000Z" }), {});
});

test("deletions ignore unknown comics and malformed ids", () => {
  const records = {
    [COMIC_A]: {
      pageIndex: 1,
      pageCount: 10,
      completed: false,
      skipped: false,
      lastReadAt: "2026-08-13T13:00:00.000Z",
      orderId: null
    }
  };
  assert.deepEqual(
    applyDeletions(records, {
      [COMIC_B]: "2026-08-13T14:00:00.000Z",
      "not-a-comic-id": "2026-08-13T14:00:00.000Z"
    }),
    records
  );
  // A merge that carries no deletions at all is unchanged.
  for (const empty of [null, undefined, [], "nope"]) {
    assert.deepEqual(applyDeletions(records, empty), records);
  }
});

test("merge accepts a bare record map, records with deletions, or either alone", async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-merge-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const store = new ProgressStore(directory);
  await store.initialize();

  const dated = (lastReadAt, pageIndex = 5) => ({
    pageIndex,
    pageCount: 100,
    completed: false,
    skipped: false,
    lastReadAt,
    orderId: null
  });

  // The web viewer's shape: a bare map, no envelope. It must keep working.
  await store.merge(READER, { [COMIC_A]: dated("2026-08-13T10:00:00.000Z") });
  assert.equal(store.get(READER, COMIC_A).pageIndex, 5);

  // The app's shape, carrying both at once.
  await store.merge(READER, {
    records: { [COMIC_B]: dated("2026-08-13T11:00:00.000Z", 9) },
    deleted: { [COMIC_A]: "2026-08-13T11:00:00.000Z" }
  });
  assert.equal(store.get(READER, COMIC_A), null, "the deletion applied");
  assert.equal(store.get(READER, COMIC_B).pageIndex, 9, "the record applied");

  // Deletions alone, with no records key at all.
  await store.merge(READER, { deleted: { [COMIC_B]: "2026-08-13T12:00:00.000Z" } });
  assert.equal(store.get(READER, COMIC_B), null);

  // And an envelope that deletes something already gone is not an error.
  await store.merge(READER, { records: {}, deleted: { [COMIC_B]: "2026-08-13T13:00:00.000Z" } });
  assert.equal(store.get(READER, COMIC_B), null);
});
