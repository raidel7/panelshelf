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
