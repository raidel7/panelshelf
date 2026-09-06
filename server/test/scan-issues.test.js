"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { scanIssues } = require("../src/scan-issues");

let counter = 0;
function comic(overrides = {}) {
  const folder = overrides.folder === undefined ? "Superman" : overrides.folder;
  const name = overrides.name || `issue-${(counter += 1)}.cbz`;
  return {
    id: `c${counter}`,
    sourceId: "src_a",
    sourceName: "DC",
    libraryRoot: "/volume1/Comics",
    folderSegments: folder === "" ? [] : folder.split("/"),
    relativePath: folder === "" ? name : `${folder}/${name}`,
    path: folder === "" ? `/volume1/Comics/${name}` : `/volume1/Comics/${folder}/${name}`,
    size: 1024,
    modifiedAt: "2026-01-01T00:00:00.000Z",
    available: true,
    ...overrides
  };
}

function broken(overrides = {}) {
  return comic({
    readError: { code: "DAMAGED_ARCHIVE", message: "The CBZ central directory was not found." },
    ...overrides
  });
}

function report(overrides = {}) {
  return scanIssues({
    comics: overrides.comics || [],
    scanState: overrides.scanState || { errors: [] },
    ...overrides.options
  });
}

test("a library with nothing broken reports nothing", () => {
  const issues = report({ comics: [comic(), comic()] });
  assert.deepEqual(issues.folders, []);
  assert.equal(issues.summary.files, 0);
  assert.equal(issues.summary.folders, 0);
});

test("the biggest cluster is first, because that is the one that is one problem", () => {
  const issues = report({
    comics: [
      broken({ folder: "Loose Issues" }),
      broken({ folder: "Superman/Volume 2" }),
      broken({ folder: "Superman/Volume 2" }),
      broken({ folder: "Superman/Volume 2" }),
      comic({ folder: "Superman/Volume 2" })
    ]
  });

  assert.equal(issues.folders.length, 2);
  assert.equal(issues.folders[0].folder, "Superman/Volume 2");
  assert.equal(issues.folders[0].files, 3);
  assert.equal(issues.folders[1].folder, "Loose Issues");
  assert.equal(issues.summary.files, 4);
  assert.equal(issues.summary.folders, 2);
});

test("a folder says how much of it is broken, not just how many files are", () => {
  const issues = report({
    comics: [
      broken({ folder: "Ruined" }),
      broken({ folder: "Ruined" }),
      broken({ folder: "Partly" }),
      comic({ folder: "Partly" }),
      comic({ folder: "Partly" })
    ]
  });

  const ruined = issues.folders.find((entry) => entry.folder === "Ruined");
  const partly = issues.folders.find((entry) => entry.folder === "Partly");
  assert.equal(ruined.files, 2);
  assert.equal(ruined.comics, 2);
  assert.equal(ruined.wholeFolder, true);
  assert.equal(partly.files, 1);
  assert.equal(partly.comics, 3);
  assert.equal(partly.wholeFolder, false);
});

test("counts stay exact when the file lists are capped", () => {
  const comics = [];
  for (let index = 0; index < 40; index += 1) comics.push(broken({ folder: "Big" }));
  const issues = report({ comics, options: { limit: 10 } });

  assert.equal(issues.summary.files, 40, "the count is of what is broken");
  assert.equal(issues.folders[0].files, 40);
  assert.equal(issues.folders[0].items.length, 10, "the list is what is bounded");
  assert.equal(issues.folders[0].truncated, true);
  assert.equal(issues.summary.truncated, true);
});

test("the folder list is capped too, keeping the largest clusters", () => {
  const comics = [];
  for (let index = 0; index < 30; index += 1) comics.push(broken({ folder: `F${index}` }));
  // One folder that matters more than the thirty singletons.
  for (let index = 0; index < 5; index += 1) comics.push(broken({ folder: "Cluster" }));

  const issues = report({ comics, options: { maxFolders: 3 } });
  assert.equal(issues.folders.length, 3);
  assert.equal(issues.folders[0].folder, "Cluster");
  assert.equal(issues.summary.folders, 31, "still says how many there really are");
  assert.equal(issues.summary.foldersTruncated, true);
});

test("each folder tallies what went wrong, and so does the library", () => {
  const issues = report({
    comics: [
      broken({ folder: "A" }),
      broken({ folder: "A", readError: { code: "SCAN_ERROR", message: "File read error" } }),
      broken({ folder: "B", readError: { code: "SCAN_ERROR", message: "File read error" } })
    ]
  });

  const a = issues.folders.find((entry) => entry.folder === "A");
  assert.deepEqual(a.byCode, { DAMAGED_ARCHIVE: 1, SCAN_ERROR: 1 });
  assert.deepEqual(issues.summary.byCode, { DAMAGED_ARCHIVE: 1, SCAN_ERROR: 2 });
});

test("two sources with the same folder name are two folders", () => {
  const issues = report({
    comics: [
      broken({ folder: "Superman" }),
      broken({ folder: "Superman", sourceId: "src_b", sourceName: "Marvel", libraryRoot: "/volume1/Other" })
    ]
  });

  assert.equal(issues.folders.length, 2);
  assert.equal(issues.summary.sources, 2);
});

test("a comic on a disconnected source is missing, not damaged", () => {
  const issues = report({ comics: [comic({ available: false }), comic({ available: false })] });
  assert.equal(issues.summary.files, 0);
});

test("a file the scan could not even index is reported rather than lost", () => {
  const issues = report({
    // Named rather than counter-generated: this test turns on the path of that
    // comic matching the path of the first reported error.
    comics: [broken({ folder: "A", name: "issue-1.cbz" })],
    scanState: {
      errors: [
        // Matches a comic record: already covered by the folder grouping above.
        { path: "/volume1/Comics/A/issue-1.cbz", code: "DAMAGED_ARCHIVE", message: "x", sourceId: "src_a" },
        // Never became a comic at all.
        { path: "/volume1/Comics/Locked", code: "EACCES", message: "Permission denied", sourceId: "src_a" }
      ]
    }
  });

  assert.equal(issues.unindexed.length, 1);
  assert.equal(issues.unindexed[0].path, "/volume1/Comics/Locked");
  assert.equal(issues.summary.unindexed, 1);
});

test("a folder carries the absolute path, because that is what you go and fix", () => {
  const issues = report({
    comics: [broken({ folder: "Superman/Volume 2", name: "Superman V2 #077.cbr" })]
  });
  assert.equal(issues.folders[0].path, "/volume1/Comics/Superman/Volume 2");
  // The file is named, not re-pathed: the folder above already says where.
  assert.equal(issues.folders[0].items[0].name, "Superman V2 #077.cbr");
  assert.equal(issues.folders[0].items[0].code, "DAMAGED_ARCHIVE");
});

test("a broken file at the source root belongs to the source, not to nowhere", () => {
  const issues = report({ comics: [broken({ folder: "" })] });
  assert.equal(issues.folders[0].folder, "");
  assert.equal(issues.folders[0].path, "/volume1/Comics");
});
