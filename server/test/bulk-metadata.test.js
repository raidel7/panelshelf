"use strict";

const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  BulkMetadataMatcher,
  inferBulkMetadataQuery
} = require("../src/bulk-metadata");

async function waitForJob(matcher, status = "completed") {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const value = matcher.publicState();
    if (value.status === status) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for bulk metadata job to become ${status}`);
}

function comic(id, title) {
  return {
    id,
    title,
    localTitle: title,
    series: title,
    available: true,
    metadata: {},
    inferredMetadata: { year: 2013 },
    publisher: { name: "Marvel" }
  };
}

test("bulk metadata query infers a collected volume without release-group noise", () => {
  assert.deepEqual(
    inferBulkMetadataQuery(
      comic(
        "arena",
        "Avengers Arena v01 - Kill Or Die (2013) (Digital) (F) (Shadowcat-Empire)"
      )
    ),
    {
      provider: "smart",
      series: "Avengers Arena",
      title: "Kill Or Die",
      number: "1",
      edition: "trade-paperback",
      year: 2013,
      publisher: "Marvel"
    }
  );
});

test("bulk metadata auto-approves only a 90+ clear winner", async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-bulk-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const comics = new Map([
    ["clear", comic("clear", "Clear Winner v01 (2013)")],
    ["close", comic("close", "Close Race v01 (2013)")]
  ]);
  const confirmed = [];
  const matcher = new BulkMetadataMatcher(directory, {
    delayMs: 0,
    getComic: (id) => comics.get(id),
    publicComic: (value) => value,
    confirm: async (id, provider, recordId) => {
      confirmed.push({ id, provider, recordId });
    },
    search: async (query) => ({
      candidates: query.series.startsWith("Clear")
        ? [
            { provider: "gcd", recordId: "one", displayName: "Clear Winner", matchScore: 96 },
            { provider: "gcd", recordId: "two", displayName: "Other", matchScore: 72 }
          ]
        : [
            { provider: "gcd", recordId: "three", displayName: "Close Race", matchScore: 95 },
            { provider: "gcd", recordId: "four", displayName: "Close Runner", matchScore: 91 }
          ]
    })
  });
  await matcher.initialize();
  await matcher.start([...comics.values()], { threshold: 90, margin: 10 });
  const finished = await waitForJob(matcher);
  assert.equal(finished.processed, 2);
  assert.equal(finished.autoApproved, 1);
  assert.equal(finished.reviewRequired, 1);
  assert.deepEqual(confirmed, [{ id: "clear", provider: "gcd", recordId: "one" }]);
  assert.equal(finished.recentResults[0].status, "review");
  assert.equal(finished.recentResults[1].status, "auto-approved");
});

test("a running bulk metadata job becomes safely paused after restart", async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-bulk-restart-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  await fsp.writeFile(
    path.join(directory, "bulk-metadata.json"),
    JSON.stringify({
      status: "running",
      jobId: "saved-job",
      total: 2,
      processed: 1,
      queue: ["remaining"],
      results: []
    })
  );
  const matcher = new BulkMetadataMatcher(directory, {});
  await matcher.initialize();
  const restored = matcher.publicState();
  assert.equal(restored.status, "paused");
  assert.equal(restored.remaining, 1);
});
