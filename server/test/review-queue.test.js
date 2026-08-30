"use strict";

const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { BulkMetadataMatcher } = require("../src/bulk-metadata");

const ID = (label) => label.repeat(24).slice(0, 24);

async function matcher(t, results) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-review-"));
  const created = new BulkMetadataMatcher(directory, {});
  await created.initialize();
  created.state.results = results;
  t.after(async () => {
    await created.settled();
    await fsp.rm(directory, { recursive: true, force: true });
  });
  return created;
}

const reviewResult = (label, extra = {}) => ({
  comicId: ID(label),
  title: `Issue ${label}`,
  status: "review",
  checkedAt: "2026-08-30T12:00:00.000Z",
  provider: "metron",
  recordId: "12345",
  displayName: "Action Comics #1 (1938)",
  score: 84,
  runnerUpScore: 81,
  reason: "Confidence below 90%",
  ...extra
});

test("only the matches that need a decision are queued", async (t) => {
  // auto-approved and unmatched are both settled: one had an answer, the other
  // had none. Neither is waiting on a person.
  const job = await matcher(t, [
    reviewResult("a"),
    { comicId: ID("b"), title: "Issue b", status: "auto-approved" },
    { comicId: ID("c"), title: "Issue c", status: "unmatched" },
    reviewResult("d")
  ]);

  const queue = job.reviewQueue();

  assert.deepEqual(queue.map((entry) => entry.comicId), [ID("a"), ID("d")]);
});

test("a queued entry carries what is needed to decide", async (t) => {
  // A person choosing has to see what was proposed and why it was not taken:
  // a bare comic id is a question with no information in it.
  const job = await matcher(t, [reviewResult("a")]);

  const [entry] = job.reviewQueue();

  assert.equal(entry.title, "Issue a");
  assert.equal(entry.displayName, "Action Comics #1 (1938)");
  assert.equal(entry.provider, "metron");
  assert.equal(entry.score, 84);
  assert.equal(entry.runnerUpScore, 81);
  assert.equal(entry.reason, "Confidence below 90%");
});

test("the newest verdict for a comic is the one that counts", async (t) => {
  // A comic checked twice, reviewed then auto-approved on a later pass, is
  // settled. Listing it because an older result says review would send someone
  // to decide something already decided.
  const job = await matcher(t, [
    reviewResult("a", { checkedAt: "2026-08-01T00:00:00.000Z" }),
    {
      comicId: ID("a"),
      title: "Issue a",
      status: "auto-approved",
      checkedAt: "2026-08-30T00:00:00.000Z"
    }
  ]);

  assert.deepEqual(job.reviewQueue(), []);
});

test("a comic reviewed after being auto-approved is queued again", async (t) => {
  const job = await matcher(t, [
    {
      comicId: ID("a"),
      title: "Issue a",
      status: "auto-approved",
      checkedAt: "2026-08-01T00:00:00.000Z"
    },
    reviewResult("a", { checkedAt: "2026-08-30T00:00:00.000Z" })
  ]);

  assert.equal(job.reviewQueue().length, 1);
});

test("a job that has never run has an empty queue", async (t) => {
  const job = await matcher(t, []);
  assert.deepEqual(job.reviewQueue(), []);
});
