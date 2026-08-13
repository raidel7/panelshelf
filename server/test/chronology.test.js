"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildChronology,
  chronologyView,
  compareChronologyNodes,
  compareRankValues,
  orderNumber
} = require("../src/chronology");

// A Marvel-shaped library: numbered eras with a dotted insertion, an unnumbered
// grouping branch, and a staging folder — the layout the roadmap's hierarchical
// timeline contract describes.
function comic(options) {
  const segments = options.segments || [];
  return {
    id: options.id,
    title: options.title,
    series: options.series || "Series",
    pageCount: 20,
    available: true,
    format: "cbz",
    publisher: null,
    sourceId: options.sourceId || "src_1",
    sourceName: options.sourceName || "Comics",
    sourceProfile: options.profile || "hierarchical-timeline",
    hierarchy: segments.map((segment) => ({
      name: segment.name,
      displayName: segment.displayName || segment.label || segment.name,
      role: segment.role || "ordered-section",
      rank: segment.rank || null
    })),
    orderPath: [
      ...segments.map((segment) => ({
        name: segment.name,
        rank: segment.rank || null,
        label: segment.label || segment.name
      })),
      { name: options.title, rank: options.rank || null, label: options.title }
    ]
  };
}

const era = (rank, name) => ({ name, rank, label: name, role: "ordered-section" });

function library() {
  return [
    comic({
      id: "c3",
      title: "Secret Wars II",
      segments: [era("0030", "0030 Secret Wars II")]
    }),
    comic({
      id: "c2",
      title: "Love's Labors Lost",
      segments: [era("0029.1", "0029.1 Daredevil")]
    }),
    comic({
      id: "c1",
      title: "Rocky Grimm",
      segments: [era("0001", "0001 Rocky Grimm")]
    }),
    comic({
      id: "c4",
      title: "Anita Blake 1",
      segments: [{ name: "Anita Blake Universe", role: "group" }]
    }),
    comic({
      id: "c5",
      title: "Loose issue",
      segments: [
        era("0030", "0030 Secret Wars II"),
        { name: "_Loose issues", role: "staging" }
      ]
    })
  ];
}

const view = (comics, nodeId) =>
  chronologyView(buildChronology(comics), nodeId, (c) => ({ id: c.id, title: c.title }));

test("ranked branches sort by rank, and unranked ones fall in behind them", () => {
  const root = view(library(), null);
  const source = root.children[0];
  assert.equal(source.role, "source");

  const eras = view(library(), source.id).children;
  assert.deepEqual(
    eras.map((node) => node.displayName),
    [
      "0001 Rocky Grimm",
      "0029.1 Daredevil",
      "0030 Secret Wars II",
      "Anita Blake Universe",
      "Unfiled"
    ],
    "0029.1 lands between 1 and 30, and the unnumbered group trails the numbers"
  );
});

test("the position chip counts ranked siblings rather than repeating the prefix", () => {
  // 0029.1 is the second era, not the twenty-ninth-and-a-half of anything. The
  // browser draws "2" here and so must this.
  const source = view(library(), null).children[0];
  const eras = view(library(), source.id).children;
  assert.deepEqual(
    eras.map((node) => node.orderNumber),
    [1, 2, 3, null, null],
    "unranked branches have no position at all"
  );
});

test("comics filed at a level are separate from the branch's total", () => {
  const source = view(library(), null).children[0];
  const eras = view(library(), source.id).children;
  const secretWars = eras.find((node) => node.displayName.includes("Secret Wars"));

  // One comic sits in the era itself; the other is in its staging folder, which
  // is filed under the source rather than inside the era.
  assert.equal(secretWars.comicCount, 1);
  const inside = view(library(), secretWars.id);
  assert.deepEqual(inside.comics.map((c) => c.title), ["Secret Wars II"]);
  assert.deepEqual(inside.children, []);
});

test("staging folders are indexed but kept out of the timeline", () => {
  const source = view(library(), null).children[0];
  const children = view(library(), source.id).children;
  const unfiled = children.find((node) => node.role === "staging");

  assert.ok(unfiled, "the staging comic is reachable");
  assert.equal(unfiled.comicCount, 1);
  // And it is not counted as part of any era: the eras total three comics, the
  // fourth is the unranked group, the fifth is unfiled.
  const ranked = children.filter((node) => node.orderNumber);
  assert.deepEqual(ranked.map((node) => node.comicCount), [1, 1, 1]);
});

test("only sources that claim an order appear at all", () => {
  const loose = [
    comic({ id: "l1", title: "Loose", profile: "loose", segments: [] }),
    comic({ id: "u1", title: "Unordered", profile: "unordered", segments: [] })
  ];
  assert.deepEqual(view(loose, null).children, []);

  // An exact reading order is a chronology; a folders-as-series library is not.
  const exact = [comic({ id: "e1", title: "Year One", profile: "exact-reading-order" })];
  assert.equal(view(exact, null).children.length, 1);
});

test("breadcrumbs name the way back, root first", () => {
  const source = view(library(), null).children[0];
  const era = view(library(), source.id).children[0];
  const trail = view(library(), era.id).breadcrumbs;

  assert.deepEqual(
    trail.map((step) => step.displayName),
    ["Chronological", "Comics", "0001 Rocky Grimm"]
  );
  assert.equal(trail[0].id, "chronology");
  assert.equal(trail.at(-1).id, era.id);
});

test("a node id that is not in the tree is absent rather than empty", () => {
  assert.equal(view(library(), "chronology/source:nope"), null);
  // The root is what an unnamed node means, so a client can open the screen
  // without knowing anything.
  assert.equal(view(library(), null).node.id, "chronology");
  assert.equal(view(library(), "").node.id, "chronology");
});

test("a collection carries the cover of the comic a reader reaches first", () => {
  const source = view(library(), null).children[0];
  assert.equal(source.coverComicId, "c1", "the first comic in reading order");
});

test("rank comparison survives zero padding and dotted insertions", () => {
  assert.ok(compareRankValues("2", "10") < 0, "2 before 10");
  assert.ok(compareRankValues("0002", "10") < 0, "padding does not change that");
  assert.ok(compareRankValues("0029.1", "0030") < 0);
  assert.ok(compareRankValues("0029.1", "0029") > 0, "an insertion follows its whole");
  assert.ok(compareRankValues("0.9", "0.10") > 0, "fractions compare digit by digit");
  assert.equal(compareRankValues("007", "7"), 0);
});

test("equal ranks fall back to role and then to natural name order", () => {
  const node = (options) => ({ rank: null, role: "group", displayName: "", ...options });
  // Two `00` folders are an equal-rank bucket, which the roadmap allows.
  assert.ok(
    compareChronologyNodes(
      node({ rank: "00", displayName: "Alternate" }),
      node({ rank: "00", displayName: "Beta" })
    ) < 0
  );
  assert.ok(
    compareChronologyNodes(
      node({ role: "publisher", displayName: "Zeta" }),
      node({ role: "group", displayName: "Alpha" })
    ) < 0,
    "a publisher heads its section whatever it is called"
  );
  assert.ok(
    compareChronologyNodes(
      node({ displayName: "Volume 2" }),
      node({ displayName: "Volume 10" })
    ) < 0,
    "names compare numerically"
  );
});

test("orderNumber is null for a node with no parent", () => {
  assert.equal(orderNumber({ rank: "1", parent: null }), null);
});

test("a folder's number outranks its name", () => {
  // The discriminating case, and the one the layout contract is about: with
  // prefixes hidden, era 2 is called "Zulu" and era 10 is called "Alpha".
  // Sorting by name would put Alpha first and silently reorder the timeline.
  const named = (rank, displayName) => ({
    name: `${rank} ${displayName}`,
    displayName,
    rank,
    label: displayName,
    role: "ordered-section"
  });
  const comics = [
    comic({ id: "z1", title: "Later", segments: [named("0010", "Alpha")] }),
    comic({ id: "a1", title: "Earlier", segments: [named("0002", "Zulu")] })
  ];

  const source = view(comics, null).children[0];
  assert.deepEqual(
    view(comics, source.id).children.map((node) => node.displayName),
    ["Zulu", "Alpha"]
  );
});
