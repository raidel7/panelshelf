"use strict";

// The chronology tree, built here rather than only in the browser.
//
// The web viewer builds this from the full library it already holds. A client
// that cannot afford that — the iPad asks for `?view=compact`, 4.9 MB against
// 71 MB, and the fields this needs are exactly the ones compact drops — has no
// way to build it, so the server builds it and serves one node at a time.
//
// The ids, the ordering and the staging rule are the browser's, deliberately
// and not incidentally: they are what the user already sees, and a node id is
// the handle anything later keyed to a branch will use. `buildChronologyTree`
// in `server/public/app.js` is the other implementation; the tests here pin the
// rules both must obey.

// Only profiles that claim an order participate. A loose or unordered source
// has folders, but PanelShelf must not present them as a timeline.
const CHRONOLOGY_PROFILES = new Set([
  "hierarchical-timeline",
  "exact-reading-order"
]);

// "029.1" against "30": whole part first, by length then lexically so that
// numeric order survives zero padding, then the fraction padded to equal width
// so "0.9" sorts before "0.10".
function compareRankValues(left, right) {
  const [leftWhole = "0", leftFraction = ""] = String(left).split(".");
  const [rightWhole = "0", rightFraction = ""] = String(right).split(".");
  const normalizedLeft = leftWhole.replace(/^0+(?=\d)/, "") || "0";
  const normalizedRight = rightWhole.replace(/^0+(?=\d)/, "") || "0";
  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length - normalizedRight.length;
  }
  const wholeComparison = normalizedLeft.localeCompare(normalizedRight);
  if (wholeComparison !== 0) return wholeComparison;
  const width = Math.max(leftFraction.length, rightFraction.length);
  return leftFraction
    .padEnd(width, "0")
    .localeCompare(rightFraction.padEnd(width, "0"));
}

function naturalTextCompare(left, right) {
  return String(left || "").localeCompare(String(right || ""), undefined, {
    numeric: true,
    sensitivity: "base"
  });
}

// Ranked siblings first and in rank order; then by what the folder is, so a
// publisher heads its section and an unranked grouping folder trails it; then
// naturally by name.
const ROLE_WEIGHT = {
  publisher: 0,
  "ordered-section": 1,
  series: 2,
  group: 3,
  unranked: 4,
  source: 5,
  staging: 6
};

function compareChronologyNodes(left, right) {
  if (left.rank && right.rank) {
    const rankComparison = compareRankValues(left.rank, right.rank);
    if (rankComparison !== 0) return rankComparison;
  } else if (left.rank) {
    return -1;
  } else if (right.rank) {
    return 1;
  }
  const roleComparison =
    (ROLE_WEIGHT[left.role] ?? 9) - (ROLE_WEIGHT[right.role] ?? 9);
  if (roleComparison !== 0) return roleComparison;
  return naturalTextCompare(left.displayName, right.displayName);
}

function compareComicsByOrderPath(left, right) {
  const leftPath = Array.isArray(left.orderPath) ? left.orderPath : [];
  const rightPath = Array.isArray(right.orderPath) ? right.orderPath : [];
  const length = Math.max(leftPath.length, rightPath.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftPath[index];
    const rightPart = rightPath[index];
    // A shallower path is the parent's own comic and comes first.
    if (!leftPart) return -1;
    if (!rightPart) return 1;
    if (leftPart.rank && rightPart.rank) {
      const rankComparison = compareRankValues(leftPart.rank, rightPart.rank);
      if (rankComparison !== 0) return rankComparison;
    } else if (leftPart.rank) {
      return -1;
    } else if (rightPart.rank) {
      return 1;
    }
    const labelComparison = naturalTextCompare(
      leftPart.label || leftPart.name,
      rightPart.label || rightPart.name
    );
    if (labelComparison !== 0) return labelComparison;
  }
  return naturalTextCompare(left.title, right.title);
}

function makeNode(options) {
  return {
    id: options.id,
    parent: options.parent || null,
    name: options.name,
    displayName: options.displayName || options.name,
    role: options.role || "group",
    rank: options.rank || null,
    sourceProfile: options.sourceProfile || null,
    directComics: [],
    comics: [],
    childMap: new Map(),
    children: []
  };
}

const ROOT_ID = "chronology";

function sourceKeyFor(comic) {
  return encodeURIComponent(
    comic.sourceId || comic.libraryRoot || comic.sourceName || "source"
  );
}

function buildChronology(comics) {
  const root = makeNode({ id: ROOT_ID, name: "Chronological", role: "root" });
  const byId = new Map([[root.id, root]]);
  const stagingBySource = new Map();

  const attach = (parent, options) => {
    let child = parent.childMap.get(options.id);
    if (!child) {
      child = makeNode({ ...options, parent });
      parent.childMap.set(options.id, child);
      byId.set(options.id, child);
    }
    return child;
  };

  for (const comic of comics) {
    if (!CHRONOLOGY_PROFILES.has(comic.sourceProfile)) continue;
    const sourceKey = sourceKeyFor(comic);
    const sourceNode = attach(root, {
      id: `${root.id}/source:${sourceKey}`,
      name: comic.sourceName || "Comics",
      role: "source",
      sourceProfile: comic.sourceProfile
    });

    const hierarchy = Array.isArray(comic.hierarchy) ? comic.hierarchy : [];
    // A `_` folder is staging: indexed, but never given a place in the
    // timeline. The browser shows these on a separate Unfiled shelf; here they
    // become one child of the source so a client can browse them the same way
    // it browses everything else. Real folders keep the ids they always had.
    if (hierarchy.some((segment) => segment.role === "staging")) {
      const stagingNode = attach(sourceNode, {
        id: `${sourceNode.id}/staging`,
        name: "Unfiled",
        role: "staging",
        sourceProfile: comic.sourceProfile
      });
      stagingNode.directComics.push(comic);
      stagingBySource.set(sourceKey, stagingNode);
      continue;
    }

    let parent = sourceNode;
    for (const segment of hierarchy) {
      parent = attach(parent, {
        id: `${parent.id}/folder:${encodeURIComponent(segment.name)}`,
        name: segment.name,
        displayName: segment.displayName || segment.name,
        role: segment.role,
        rank: segment.rank,
        sourceProfile: comic.sourceProfile
      });
    }
    parent.directComics.push(comic);
  }

  const finalize = (node) => {
    node.children = [...node.childMap.values()].sort(compareChronologyNodes);
    node.directComics.sort(compareComicsByOrderPath);
    for (const child of node.children) finalize(child);
    node.comics = [
      ...node.directComics,
      ...node.children.flatMap((child) => child.comics)
    ];
  };
  finalize(root);

  return { root, byId, stagingBySource };
}

// The chip the browser draws on a collection: a folder's position among its
// *ranked* siblings, counted from one. Deliberately not the folder's own
// numeric prefix — a branch numbered 0029.1 is the third era, and "3" is what
// a reader can hold in their head. Unranked grouping folders have no position.
function orderNumber(node) {
  if (!node.rank || !node.parent) return null;
  const ranked = node.parent.children.filter((sibling) => sibling.rank);
  const index = ranked.indexOf(node);
  return index >= 0 ? index + 1 : null;
}

function summarize(node) {
  return {
    id: node.id,
    name: node.name,
    displayName: node.displayName,
    role: node.role,
    rank: node.rank,
    orderNumber: orderNumber(node),
    comicCount: node.comics.length,
    childCount: node.children.length,
    // Whatever a reader would reach first inside this branch, so a collection
    // card has a cover without the client fetching the branch to find one.
    coverComicId: node.comics[0]?.id || null
  };
}

function breadcrumbs(node) {
  const trail = [];
  for (let current = node; current; current = current.parent) {
    trail.unshift({ id: current.id, displayName: current.displayName });
  }
  return trail;
}

/// One screen of the chronology: where you are, how you got there, what is
/// below you, and the comics filed at this level rather than deeper.
function chronologyView(tree, nodeId, projectComic) {
  const node = tree.byId.get(nodeId || ROOT_ID);
  if (!node) return null;
  return {
    node: summarize(node),
    breadcrumbs: breadcrumbs(node),
    children: node.children.map(summarize),
    comics: node.directComics.map(projectComic)
  };
}

module.exports = {
  CHRONOLOGY_PROFILES,
  ROOT_ID,
  buildChronology,
  chronologyView,
  compareChronologyNodes,
  compareComicsByOrderPath,
  compareRankValues,
  orderNumber
};
