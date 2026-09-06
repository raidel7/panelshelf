"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { sourceHealth } = require("../src/source-health");

const SOURCE = {
  id: "src_a",
  name: "Comics",
  path: "/volume1/Comics",
  profile: "folders-as-series",
  available: true,
  code: null,
  message: "Folder is readable."
};

function comic(sourceId, available = true) {
  return { id: `c${Math.random()}`, sourceId, available };
}

function report(overrides = {}) {
  return sourceHealth({
    sources: overrides.sources || [SOURCE],
    comics: overrides.comics || [],
    scanState: overrides.scanState || { errors: [], warnings: [], sources: [] }
  });
}

test("a readable source with nothing wrong says so plainly", () => {
  const health = report({ comics: [comic("src_a"), comic("src_a")] });
  const [source] = health.sources;

  assert.equal(source.status, "ok");
  assert.equal(source.detail, "Readable.");
  assert.equal(source.comics, 2);
  assert.equal(source.unreachable, 0);
  assert.equal(health.summary.healthy, 1);
});

test("a source that is not mounted reads as disconnected, not as empty", () => {
  // The release gate, stated exactly. A source that went away keeps its shelf
  // on purpose, and the difference between "disconnected" and "no comics here"
  // is the difference between waiting and going looking for lost files.
  const health = report({
    sources: [{ ...SOURCE, available: false, code: "ENOENT", message: "Folder is not mounted or no longer exists." }],
    comics: [comic("src_a", false), comic("src_a", false)]
  });
  const [source] = health.sources;

  assert.equal(source.status, "disconnected");
  assert.match(source.detail, /not mounted/i);
  assert.equal(source.comics, 2, "its comics are still counted");
  assert.equal(source.unreachable, 2, "and every one of them is unreachable");
  assert.equal(health.summary.disconnected, 1);
});

test("a folder that is there but cannot be read is a different problem", () => {
  // Telling somebody their drive fell out when the answer is a permission bit
  // sends them to the wrong place entirely.
  const health = report({
    sources: [{ ...SOURCE, available: false, code: "EACCES", message: "PanelShelf does not have permission to read this folder." }]
  });

  assert.equal(health.sources[0].status, "unreadable");
  assert.match(health.sources[0].detail, /permission/i);
  assert.equal(health.summary.unreadable, 1);
  assert.equal(health.summary.disconnected, 0, "not counted as both");
});

test("archives that could not be read make a source damaged, and are counted by cause", () => {
  const health = report({
    comics: [comic("src_a")],
    scanState: {
      sources: [],
      errors: [
        { path: "/volume1/Comics/a.cbz", code: "ARCHIVE_UNREADABLE", sourceId: "src_a" },
        { path: "/volume1/Comics/b.cbr", code: "ARCHIVE_UNREADABLE", sourceId: "src_a" },
        { path: "/volume1/Comics/c.cbz", code: "EACCES", sourceId: "src_a" }
      ],
      warnings: []
    }
  });
  const [source] = health.sources;

  assert.equal(source.status, "damaged");
  assert.equal(source.issues.errors, 3);
  assert.deepEqual(source.issues.byCode, { ARCHIVE_UNREADABLE: 2, EACCES: 1 });
  assert.match(source.detail, /3 files could not be read/);
});

test("an issue belongs to the source it happened in, not to whoever matches the path", () => {
  // A source configured inside another makes a prefix match pick the wrong one,
  // which is why the scan records this as it goes.
  const inner = { ...SOURCE, id: "src_b", name: "Inner", path: "/volume1/Comics/Inner" };
  const health = report({
    sources: [SOURCE, inner],
    scanState: {
      sources: [],
      errors: [{ path: "/volume1/Comics/Inner/x.cbz", code: "ARCHIVE_UNREADABLE", sourceId: "src_b" }],
      warnings: []
    }
  });

  assert.equal(health.sources[0].issues.errors, 0, "the outer source is fine");
  assert.equal(health.sources[1].issues.errors, 1, "the inner one owns it");
});

test("a source read at walking pace is worth pointing at", () => {
  const health = report({
    scanState: {
      errors: [],
      warnings: [],
      sources: [{ id: "src_a", files: 400, durationMs: 60_000, startedAt: "x", finishedAt: "y" }]
    }
  });
  const [source] = health.sources;

  assert.equal(source.status, "slow");
  assert.equal(source.lastScan.filesPerSecond, 7);
  assert.match(source.detail, /slow enough to be worth a look/);
});

test("a handful of files read slowly is not evidence of anything", () => {
  // One enormous archive, or a source with four comics in it. Crying wolf here
  // costs the whole panel its credibility.
  const health = report({
    scanState: {
      errors: [],
      warnings: [],
      sources: [{ id: "src_a", files: 3, durationMs: 60_000, startedAt: "x", finishedAt: "y" }]
    }
  });

  assert.equal(health.sources[0].status, "ok");
  assert.equal(health.summary.slow, 0);
});

test("a fast source reports its rate without complaining about it", () => {
  const health = report({
    scanState: {
      errors: [],
      warnings: [],
      sources: [{ id: "src_a", files: 9000, durationMs: 3000, startedAt: "x", finishedAt: "y" }]
    }
  });

  assert.equal(health.sources[0].status, "ok");
  assert.equal(health.sources[0].lastScan.filesPerSecond, 3000);
});

test("being unreachable outranks being slow, and being gone outranks both", () => {
  // A summary says the worst thing that is true, because that is the thing to
  // act on.
  const health = report({
    sources: [{ ...SOURCE, available: false, code: "ENOENT", message: "gone" }],
    scanState: {
      errors: [{ path: "/x", code: "ARCHIVE_UNREADABLE", sourceId: "src_a" }],
      warnings: [],
      sources: [{ id: "src_a", files: 400, durationMs: 60_000 }]
    }
  });

  assert.equal(health.sources[0].status, "disconnected");
});

test("metadata worth reviewing is mentioned without calling the source unwell", () => {
  const health = report({
    scanState: {
      sources: [],
      errors: [],
      warnings: [{ path: "/x", code: "COMICINFO_INVALID", sourceId: "src_a" }]
    }
  });

  assert.equal(health.sources[0].status, "ok", "a bad ComicInfo is not a bad drive");
  assert.equal(health.sources[0].issues.warnings, 1);
  assert.match(health.sources[0].detail, /metadata worth reviewing/);
});

test("a comic belonging to no configured source is counted rather than hidden", () => {
  // It should not happen, because a scan drops them. If it does, saying so
  // beats a comic count that does not add up.
  const health = report({ comics: [comic("src_a"), comic("src_gone")] });

  assert.equal(health.summary.orphaned, 1);
  assert.equal(health.summary.comics, 2);
  assert.equal(health.sources[0].comics, 1);
});

test("no sources at all is a valid answer, not an error", () => {
  const health = sourceHealth({ sources: [], comics: [], scanState: null });
  assert.deepEqual(health.sources, []);
  assert.equal(health.summary.sources, 0);
  assert.equal(health.summary.comics, 0);
});

test("a source never scanned reports no timing rather than a wrong one", () => {
  const health = report({ comics: [comic("src_a")] });
  assert.equal(health.sources[0].lastScan, null);
  assert.equal(health.sources[0].status, "ok");
});
