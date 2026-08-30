"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { findDuplicates } = require("../src/duplicates");

function comic(id, relativePath, extra = {}) {
  return {
    id,
    title: extra.title || relativePath.replace(/\.cb[zr]$/, ""),
    series: extra.series || "Action Comics",
    relativePath,
    size: extra.size ?? 1000,
    fingerprint: extra.fingerprint || `fp1_${id}`,
    sourceName: extra.sourceName || "DC",
    metadata: extra.metadata || null,
    available: extra.available !== false
  };
}

test("a library with nothing repeated reports nothing", () => {
  const groups = findDuplicates([
    comic("1", "One.cbz"),
    comic("2", "Two.cbz")
  ]);
  assert.deepEqual(groups, []);
});

test("files with identical contents are reported as the same comic twice", () => {
  // The same issue filed under two names is the commonest kind, and the
  // fingerprint settles it without opening either archive.
  const groups = findDuplicates([
    comic("1", "Action Comics 001.cbz", { fingerprint: "fp1_same" }),
    comic("2", "Superman/Action 001 (dupe).cbz", { fingerprint: "fp1_same" }),
    comic("3", "Other.cbz")
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].reason, "identical-contents");
  assert.equal(groups[0].confidence, "certain");
  assert.deepEqual(
    groups[0].comics.map((entry) => entry.id).sort(),
    ["1", "2"]
  );
});

test("the same issue in different formats is reported as probable, not certain", () => {
  // A CBZ and a CBR of one issue have different bytes and are still the same
  // comic. Calling that "certain" would be a lie the owner might act on.
  const groups = findDuplicates([
    comic("1", "Action Comics 001.cbz", {
      metadata: { series: "Action Comics", number: "1", year: 1938 }
    }),
    comic("2", "Action Comics 001.cbr", {
      metadata: { series: "Action Comics", number: "1", year: 1938 }
    })
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].reason, "same-issue");
  assert.equal(groups[0].confidence, "probable");
});

test("the same issue number in different series is not a duplicate", () => {
  const groups = findDuplicates([
    comic("1", "Action 001.cbz", { metadata: { series: "Action Comics", number: "1" } }),
    comic("2", "Detective 001.cbz", { metadata: { series: "Detective Comics", number: "1" } })
  ]);
  assert.deepEqual(groups, []);
});

test("an issue with no number is never guessed at", () => {
  // Half a library has no ComicInfo. Grouping those by series alone would
  // report every issue of a run as a duplicate of every other.
  const groups = findDuplicates([
    comic("1", "One.cbz", { metadata: { series: "Action Comics" } }),
    comic("2", "Two.cbz", { metadata: { series: "Action Comics" } })
  ]);
  assert.deepEqual(groups, []);
});

test("identical contents win over same-issue, so nothing is reported twice", () => {
  const groups = findDuplicates([
    comic("1", "A.cbz", { fingerprint: "fp1_same", metadata: { series: "Action Comics", number: "1" } }),
    comic("2", "B.cbz", { fingerprint: "fp1_same", metadata: { series: "Action Comics", number: "1" } })
  ]);

  assert.equal(groups.length, 1, "one group, not one of each kind");
  assert.equal(groups[0].reason, "identical-contents");
});

test("a group carries what someone needs to choose between the copies", () => {
  // The whole point is a decision the owner makes. Deciding needs the path, the
  // size and which source it came from — the reasons one copy is the keeper.
  const groups = findDuplicates([
    comic("1", "Good.cbz", { fingerprint: "fp1_same", size: 40_000_000 }),
    comic("2", "Bad.cbz", { fingerprint: "fp1_same", size: 40_000_000, sourceName: "Old USB" })
  ]);

  const [entry] = groups[0].comics;
  assert.ok(entry.relativePath);
  assert.ok(entry.title);
  assert.equal(typeof entry.size, "number");
  assert.ok(entry.sourceName);
});

test("an unavailable comic is not offered as a duplicate to resolve", () => {
  // A sleeping USB disk is not a reason to suggest deleting the copy that is
  // still there.
  const groups = findDuplicates([
    comic("1", "One.cbz", { fingerprint: "fp1_same" }),
    comic("2", "Two.cbz", { fingerprint: "fp1_same", available: false })
  ]);
  assert.deepEqual(groups, []);
});

test("groups are ordered with the most wasteful first", () => {
  const groups = findDuplicates([
    comic("1", "Small A.cbz", { fingerprint: "fp1_small", size: 1_000 }),
    comic("2", "Small B.cbz", { fingerprint: "fp1_small", size: 1_000 }),
    comic("3", "Big A.cbz", { fingerprint: "fp1_big", size: 50_000_000 }),
    comic("4", "Big B.cbz", { fingerprint: "fp1_big", size: 50_000_000 })
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].reclaimableBytes, 50_000_000, "the one worth acting on first");
  assert.ok(groups[0].reclaimableBytes > groups[1].reclaimableBytes);
});
