"use strict";

const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { LibraryChangeLog } = require("../src/library-changes");

async function log(t, options) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-changes-"));
  const created = new LibraryChangeLog(directory, options);
  await created.initialize();
  t.after(async () => {
    await created.settled();
    await fsp.rm(directory, { recursive: true, force: true });
  });
  return { created, directory };
}

const comic = (id, fingerprint = "fp1_a") => ({ id, fingerprint });

test("a client that has never synced is told to take the whole library", async (t) => {
  // No cursor means no shared history, and inventing one would leave the client
  // believing it was up to date with a library it has never seen.
  const { created } = await log(t);
  await created.record([], [comic("a")]);

  // Each of the ways "no cursor" actually arrives. `null` is the one that
  // matters: a missing query parameter arrives as null, and `Number(null)` is
  // 0 — an entirely plausible cursor.
  for (const absent of [undefined, null, ""]) {
    assert.equal(created.since(absent).reset, true, `cursor ${JSON.stringify(absent)}`);
  }
  assert.equal(created.since(0).reset, false, "an explicit zero is a real cursor");
});

test("a scan that adds a comic reports it added", async (t) => {
  const { created } = await log(t);
  await created.record([], [comic("a")]);

  const update = created.since(0);
  assert.equal(update.reset, false);
  assert.deepEqual(update.changes, [{ id: "a", kind: "added" }]);
  assert.equal(update.sequence, 1);
});

test("a scan that removes a comic reports it removed", async (t) => {
  // The reason this store exists at all: a client can see for itself what was
  // added, but nothing in a list of what remains says what left.
  const { created } = await log(t);
  await created.record([], [comic("a"), comic("b")]);
  // Two comics arriving is two changes, so a client that saw them both is at
  // sequence 2. Asking from 1 would rightly replay b's arrival as well.
  assert.equal(created.sequence, 2);
  await created.record([comic("a"), comic("b")], [comic("a")]);

  assert.deepEqual(created.since(2).changes, [{ id: "b", kind: "removed" }]);
});

test("a comic whose contents changed is reported updated", async (t) => {
  const { created } = await log(t);
  await created.record([], [comic("a", "fp1_old")]);
  await created.record([comic("a", "fp1_old")], [comic("a", "fp1_new")]);

  assert.deepEqual(created.since(1).changes, [{ id: "a", kind: "updated" }]);
});

test("a scan that changed nothing appends nothing", async (t) => {
  // Scans run on a timer. A client polling after one must not be handed work.
  const { created } = await log(t);
  await created.record([], [comic("a")]);
  await created.record([comic("a")], [comic("a")]);

  assert.equal(created.sequence, 1, "still where it was");
  assert.deepEqual(created.since(1).changes, []);
});

test("a client already up to date is told so without a payload", async (t) => {
  const { created } = await log(t);
  await created.record([], [comic("a")]);

  const update = created.since(1);
  assert.equal(update.reset, false);
  assert.deepEqual(update.changes, []);
  assert.equal(update.sequence, 1);
});

test("a cursor older than the log asks for a full resync", async (t) => {
  // The log is bounded, so a client that was off for long enough cannot be
  // caught up from it. Saying so is the only honest answer.
  const { created } = await log(t, { limit: 3 });
  for (const id of ["a", "b", "c", "d", "e"]) {
    await created.record([], [comic(id)]);
  }

  assert.equal(created.since(1).reset, true, "its cursor fell off the end");
  assert.equal(created.since(created.sequence - 1).reset, false, "a recent one still works");
});

test("a cursor from the future asks for a full resync", async (t) => {
  // A rebuilt or restored data directory can leave a client holding a cursor
  // this log has never issued. Trusting it would send nothing, forever.
  const { created } = await log(t);
  await created.record([], [comic("a")]);

  assert.equal(created.since(99).reset, true);
});

test("a comic that comes back after being removed is reported added again", async (t) => {
  const { created } = await log(t);
  await created.record([], [comic("a")]);
  await created.record([comic("a")], []);
  await created.record([], [comic("a")]);

  assert.deepEqual(created.since(2).changes, [{ id: "a", kind: "added" }]);
});

test("the log survives a restart", async (t) => {
  const { created, directory } = await log(t);
  await created.record([], [comic("a")]);
  await created.settled();

  const reopened = new LibraryChangeLog(directory);
  await reopened.initialize();
  assert.equal(reopened.sequence, 1);
  assert.deepEqual(reopened.since(0).changes, [{ id: "a", kind: "added" }]);
});

test("a corrupt log resets, and every client is asked to resync", async (t) => {
  // Resetting to an empty log would leave clients holding cursors it never
  // issued, which the future-cursor rule catches and turns into a resync.
  const { created, directory } = await log(t);
  await created.record([], [comic("a")]);
  await created.settled();
  await fsp.writeFile(path.join(directory, "changes.json"), "{ not json");

  const reopened = new LibraryChangeLog(directory);
  await reopened.initialize();
  assert.equal(reopened.since(1).reset, true);
});
