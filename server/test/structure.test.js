"use strict";

const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  analyzeSource,
  compareRanks,
  parseOrderPrefix,
  publisherMatch
} = require("../src/structure");

async function comic(filePath) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, "");
}

function findNode(nodes, relativePath) {
  for (const node of nodes) {
    if (node.relativePath === relativePath) return node;
    const match = findNode(node.children, relativePath);
    if (match) return match;
  }
  return null;
}

test("numeric prefixes support mixed widths and dotted insertion ranks", () => {
  assert.deepEqual(parseOrderPrefix("010 Marvel NOW!"), {
    raw: "010",
    normalized: "10",
    whole: "10",
    fraction: "",
    label: "Marvel NOW!"
  });
  assert.equal(parseOrderPrefix("0.224 Wolverine - Origin").normalized, "0.224");
  assert.equal(parseOrderPrefix("029.1 Daredevil").normalized, "29.1");
  assert.equal(parseOrderPrefix("36.001 Doctor Strange").normalized, "36.001");
  assert.equal(parseOrderPrefix("_unsorted"), null);
  assert.ok(
    compareRanks(
      parseOrderPrefix("29.1 item"),
      parseOrderPrefix("30 item")
    ) < 0
  );
  assert.ok(
    compareRanks(
      parseOrderPrefix("36.001 item"),
      parseOrderPrefix("36.01 item")
    ) < 0
  );
});

test("publisher aliases distinguish publisher and imprint", () => {
  assert.equal(publisherMatch("Marvel").name, "Marvel Comics");
  assert.equal(publisherMatch("Dargaud").kind, "publisher");
  assert.equal(publisherMatch("Vertigo").parent, "DC Comics");
  assert.equal(publisherMatch("Ordinary Folder"), null);
});

test("top-level publisher containers and empty folders receive explicit roles", async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-publishers-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  await Promise.all([
    comic(path.join(root, "Marvel", "01 Golden Age", "Book.cbz")),
    fsp.mkdir(path.join(root, "Reference"), { recursive: true })
  ]);

  const preview = await analyzeSource(root);
  assert.equal(findNode(preview.tree, "Marvel").role, "publisher");
  assert.equal(findNode(preview.tree, "Reference").role, "ignored");
  assert.equal(preview.summary.publishers, 1);
  assert.equal(preview.summary.ignoredFolders, 1);
});

test("Marvel layout becomes a hierarchical timeline", async (t) => {
  const parent = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-marvel-"));
  t.after(() => fsp.rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, "Marvel");

  await Promise.all([
    comic(path.join(root, "_unsorted", "Later.cbz")),
    comic(path.join(root, "00 Alternate Timelines - Future Stories", "Alt.cbz")),
    comic(path.join(root, "00 Ultimate Marvel Universe", "Ultimate.cbz")),
    comic(path.join(root, "09 Modern Age (1985 - 2012)", "_Loose issues", "Loose.cbr")),
    comic(path.join(root, "09 Modern Age (1985 - 2012)", "0001 Rocky Grimm", "Book.cbz")),
    comic(path.join(root, "09 Modern Age (1985 - 2012)", "0029.1 Daredevil", "Book.cbz")),
    comic(path.join(root, "09 Modern Age (1985 - 2012)", "0030 Secret Wars II", "Book.cbz")),
    comic(path.join(root, "09 Modern Age (1985 - 2012)", "0030.1 Unnamed", "Book.cbz")),
    comic(path.join(root, "09 Modern Age (1985 - 2012)", "36.001 Doctor Strange", "Book.cbz")),
    comic(path.join(root, "09 Modern Age (1985 - 2012)", "0037 Firestar", "Book.cbz")),
    comic(path.join(root, "Anita Blake Universe", "Anita.cbz"))
  ]);

  const preview = await analyzeSource(root);
  assert.equal(preview.profile, "hierarchical-timeline");
  assert.equal(preview.publisher.name, "Marvel Comics");
  assert.equal(preview.summary.comics, 11);
  assert.equal(
    findNode(preview.tree, "_unsorted").role,
    "staging"
  );
  assert.equal(
    findNode(preview.tree, "09 Modern Age (1985 - 2012)").rank,
    "9"
  );
  assert.equal(
    findNode(
      preview.tree,
      path.join("09 Modern Age (1985 - 2012)", "0029.1 Daredevil")
    ).rank,
    "29.1"
  );
  assert.equal(
    findNode(preview.tree, "Anita Blake Universe").role,
    "group"
  );
  assert.ok(
    preview.issues.some((item) => item.code === "DUPLICATE_BRANCH_RANK")
  );
  assert.ok(
    !preview.issues.some(
      (item) => item.severity === "error" && item.code.includes("SEQUENCE")
    )
  );

  const modern = findNode(preview.tree, "09 Modern Age (1985 - 2012)");
  const orderedRanks = modern.children
    .filter((node) => node.role === "ordered-section")
    .map((node) => node.rank);
  assert.deepEqual(orderedRanks, ["1", "29.1", "30", "30.1", "36.001", "37"]);
});

test("DC grouped events remain branch-relative rather than one global order", async (t) => {
  const parent = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-dc-"));
  t.after(() => fsp.rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, "DC");
  const era = "04 New 52 Chronology (2011-2016)";

  await Promise.all([
    comic(path.join(root, era, "Americatown 001.cbz")),
    comic(path.join(root, era, "Batman Family", "Batman 001.cbz")),
    comic(path.join(root, era, "Major Events", "001 Night of the Owls", "Event.cbz")),
    comic(path.join(root, era, "Major Events", "002 The Culling", "Event.cbz")),
    comic(path.join(root, era, "Major Events", "Convergence", "Event.cbz"))
  ]);

  const preview = await analyzeSource(root);
  assert.equal(preview.profile, "hierarchical-timeline");
  assert.equal(findNode(preview.tree, era).role, "ordered-section");
  assert.equal(findNode(preview.tree, path.join(era, "Major Events")).role, "group");
  assert.equal(
    findNode(preview.tree, path.join(era, "Major Events", "001 Night of the Owls"))
      .rank,
    "1"
  );
  assert.equal(
    findNode(preview.tree, path.join(era, "Major Events", "Convergence")).role,
    "group"
  );
  assert.equal(findNode(preview.tree, era).directComicCount, 1);
});

test("exact reading order blocks unranked and duplicate sequence items", async (t) => {
  const parent = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-exact-"));
  t.after(() => fsp.rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, "Exact Order");

  await Promise.all([
    comic(path.join(root, "0001 - First.cbz")),
    comic(path.join(root, "0001 - Duplicate.cbz")),
    comic(path.join(root, "Missing number.cbz")),
    comic(path.join(root, "Unranked branch", "Comic.cbz"))
  ]);

  const preview = await analyzeSource(root, { profile: "exact-reading-order" });
  assert.ok(
    preview.issues.some(
      (item) =>
        item.severity === "error" && item.code === "MISSING_SEQUENCE_POSITION"
    )
  );
  assert.ok(
    preview.issues.some(
      (item) =>
        item.severity === "error" && item.code === "UNRANKED_SEQUENCE_BRANCH"
    )
  );
  assert.deepEqual(preview.rootComics, [
    "0001 - Duplicate.cbz",
    "0001 - First.cbz",
    "Missing number.cbz"
  ]);
});
