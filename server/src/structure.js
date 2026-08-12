"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");
const { jsonError, naturalCompare } = require("./util");

const COMIC_EXTENSIONS = new Set([".cbr", ".cbz"]);
const ORGANIZATION_PROFILES = new Set([
  "loose-comics",
  "folders-as-series",
  "hierarchical-timeline",
  "exact-reading-order",
  "unordered"
]);

const PUBLISHER_ALIASES = new Map([
  ["archie", { name: "Archie Comics", kind: "publisher" }],
  ["archie comics", { name: "Archie Comics", kind: "publisher" }],
  ["boom", { name: "BOOM! Studios", kind: "publisher" }],
  ["boom studios", { name: "BOOM! Studios", kind: "publisher" }],
  ["casterman", { name: "Casterman", kind: "publisher" }],
  ["dark horse", { name: "Dark Horse Comics", kind: "publisher" }],
  ["dark horse comics", { name: "Dark Horse Comics", kind: "publisher" }],
  ["dargaud", { name: "Dargaud", kind: "publisher" }],
  ["dc", { name: "DC Comics", kind: "publisher" }],
  ["dc comics", { name: "DC Comics", kind: "publisher" }],
  ["delcourt", { name: "Delcourt", kind: "publisher" }],
  ["dupuis", { name: "Dupuis", kind: "publisher" }],
  ["dynamite", { name: "Dynamite Entertainment", kind: "publisher" }],
  ["dynamite entertainment", { name: "Dynamite Entertainment", kind: "publisher" }],
  ["glenat", { name: "Glénat", kind: "publisher" }],
  ["idw", { name: "IDW Publishing", kind: "publisher" }],
  ["idw publishing", { name: "IDW Publishing", kind: "publisher" }],
  ["image", { name: "Image Comics", kind: "publisher", ambiguous: true }],
  ["image comics", { name: "Image Comics", kind: "publisher" }],
  ["kodansha", { name: "Kodansha", kind: "publisher" }],
  ["le lombard", { name: "Le Lombard", kind: "publisher" }],
  ["lombard", { name: "Le Lombard", kind: "publisher" }],
  ["marvel", { name: "Marvel Comics", kind: "publisher" }],
  ["marvel comics", { name: "Marvel Comics", kind: "publisher" }],
  ["panini", { name: "Panini Comics", kind: "publisher" }],
  ["panini comics", { name: "Panini Comics", kind: "publisher" }],
  ["shueisha", { name: "Shueisha", kind: "publisher" }],
  ["soleil", { name: "Soleil", kind: "publisher" }],
  ["valiant", { name: "Valiant Comics", kind: "publisher" }],
  ["valiant comics", { name: "Valiant Comics", kind: "publisher" }],
  ["vertigo", { name: "Vertigo", kind: "imprint", parent: "DC Comics" }],
  ["viz", { name: "VIZ Media", kind: "publisher" }],
  ["viz media", { name: "VIZ Media", kind: "publisher" }]
]);

function normalizeAlias(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[._-]+/g, " ")
    .replace(/[^\p{Letter}\p{Number}! ]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function publisherMatch(value) {
  const normalized = normalizeAlias(value);
  const match = PUBLISHER_ALIASES.get(normalized);
  if (!match) return null;
  return {
    ...match,
    alias: value,
    confidence: match.ambiguous ? "low" : "high"
  };
}

function normalizeRank(raw) {
  const [wholeRaw, fractionRaw] = raw.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
  if (fractionRaw === undefined) return whole;
  const fraction = fractionRaw.replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function parseOrderPrefix(value) {
  const source = String(value || "").trim();
  const pureNumber = source.match(/^(\d+(?:\.\d+)?)$/);
  if (pureNumber) {
    const raw = pureNumber[1];
    const [wholeRaw, fractionRaw = ""] = raw.split(".");
    return {
      raw,
      normalized: normalizeRank(raw),
      whole: wholeRaw.replace(/^0+(?=\d)/, "") || "0",
      fraction: fractionRaw.replace(/0+$/, ""),
      label: source
    };
  }
  const match = source.match(
    /^(\d+(?:\.\d+)?)(?:\s*[-–—]\s*|\s+)(.+)$/
  );
  if (!match) return null;
  const raw = match[1];
  const label = match[2].trim();
  if (!label) return null;
  const [wholeRaw, fractionRaw = ""] = raw.split(".");
  return {
    raw,
    normalized: normalizeRank(raw),
    whole: wholeRaw.replace(/^0+(?=\d)/, "") || "0",
    fraction: fractionRaw.replace(/0+$/, ""),
    label
  };
}

function compareUnsignedInteger(left, right) {
  const normalizedLeft = left.replace(/^0+(?=\d)/, "") || "0";
  const normalizedRight = right.replace(/^0+(?=\d)/, "") || "0";
  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length - normalizedRight.length;
  }
  return normalizedLeft.localeCompare(normalizedRight);
}

function compareRanks(left, right) {
  const wholeComparison = compareUnsignedInteger(left.whole, right.whole);
  if (wholeComparison !== 0) return wholeComparison;
  const width = Math.max(left.fraction.length, right.fraction.length);
  const leftFraction = left.fraction.padEnd(width, "0");
  const rightFraction = right.fraction.padEnd(width, "0");
  return leftFraction.localeCompare(rightFraction);
}

function isComic(name) {
  return COMIC_EXTENSIONS.has(path.extname(name).toLocaleLowerCase());
}

function roleForFolder(name, profile, depth) {
  if (name.startsWith("_")) return "staging";
  const rank = parseOrderPrefix(name);

  if (profile === "folders-as-series") {
    if (depth === 1) return "series";
    return "group";
  }
  if (profile === "hierarchical-timeline") {
    return rank ? "ordered-section" : "group";
  }
  if (profile === "exact-reading-order") {
    return rank ? "ordered-section" : "unranked";
  }
  return "group";
}

function issue(severity, code, message, relativePath = "") {
  return { severity, code, message, path: relativePath };
}

function containsComics(node) {
  return node.totalComicCount > 0;
}

function flattenNodes(nodes) {
  const flattened = [];
  for (const node of nodes) {
    flattened.push(node, ...flattenNodes(node.children));
  }
  return flattened;
}

function detectProfile(rootNode) {
  const comicFolders = rootNode.children.filter(containsComics);
  const directComics = rootNode.directComics;
  const allDirectRanked =
    directComics.length > 0 &&
    directComics.every((name) => parseOrderPrefix(path.basename(name, path.extname(name))));
  const hasRankedFolders = flattenNodes(rootNode.children).some((node) =>
    Boolean(parseOrderPrefix(node.name))
  );

  if (directComics.length > 1 && comicFolders.length === 0 && allDirectRanked) {
    return {
      profile: "exact-reading-order",
      confidence: "high",
      reason: "Every comic at the source root has an explicit numeric position."
    };
  }
  if (hasRankedFolders) {
    return {
      profile: "hierarchical-timeline",
      confidence: "high",
      reason: "Numbered folders encode branch-relative timeline positions."
    };
  }
  if (directComics.length > 0 && comicFolders.length === 0) {
    return {
      profile: "loose-comics",
      confidence: "high",
      reason: "Comic archives are stored directly in the selected folder."
    };
  }
  if (directComics.length === 0 && comicFolders.length > 0) {
    return {
      profile: "folders-as-series",
      confidence: "medium",
      reason: "Comic archives are grouped beneath top-level folders."
    };
  }
  return {
    profile: "unordered",
    confidence: "low",
    reason: "The folder mixes layouts or does not match a supported convention."
  };
}

function classifyTree(rootNode, profile, issues) {
  function classify(node) {
    const publisher = node.depth === 1 ? publisherMatch(node.name) : null;
    node.role = node.name.startsWith("_")
      ? "staging"
      : publisher
        ? "publisher"
        : node.totalComicCount === 0
          ? "ignored"
          : roleForFolder(node.name, profile, node.depth);
    const parsed = parseOrderPrefix(node.name);
    node.rank = parsed ? parsed.normalized : null;
    node.rawRank = parsed ? parsed.raw : null;
    node.displayName = parsed ? parsed.label : node.name.replace(/^_+/, "");
    node.publisher = publisher;

    if (node.role === "staging") {
      issues.push(
        issue(
          "info",
          "STAGING_FOLDER",
          "Staging content will appear under Unsorted and outside the timeline.",
          node.relativePath
        )
      );
    }
    for (const child of node.children) classify(child);
  }

  for (const child of rootNode.children) classify(child);
}

function validateLoose(rootNode, issues) {
  for (const node of flattenNodes(rootNode.children)) {
    if (containsComics(node)) {
      issues.push(
        issue(
          "error",
          "LOOSE_NESTED_FOLDER",
          "Loose comics must be stored directly in the selected source folder.",
          node.relativePath
        )
      );
    }
  }
}

function validateSeries(rootNode, issues) {
  if (rootNode.directComics.length > 0) {
    issues.push(
      issue(
        "error",
        "SERIES_ROOT_COMICS",
        "Folders-as-series cannot mix comic files into the source root."
      )
    );
  }
  for (const node of flattenNodes(rootNode.children)) {
    if (node.depth > 2 && containsComics(node)) {
      issues.push(
        issue(
          "error",
          "SERIES_TOO_DEEP",
          "Folders-as-series supports one series level and one optional volume or arc level.",
          node.relativePath
        )
      );
    }
  }
}

function validateSiblingRanks(parent, profile, issues) {
  const byRank = new Map();
  for (const child of parent.children) {
    if (child.role === "staging" || !child.rank) continue;
    const matches = byRank.get(child.rank) || [];
    matches.push(child);
    byRank.set(child.rank, matches);
  }
  for (const [rank, matches] of byRank) {
    if (matches.length < 2) continue;
    issues.push(
      issue(
        profile === "exact-reading-order" ? "error" : "warning",
        profile === "exact-reading-order"
          ? "DUPLICATE_SEQUENCE_POSITION"
          : "DUPLICATE_BRANCH_RANK",
        `${matches.length} items share position ${rank}.`,
        parent.relativePath
      )
    );
  }
  for (const child of parent.children) validateSiblingRanks(child, profile, issues);
}

function validateExact(rootNode, issues) {
  function validateParent(parent) {
    const comicRanks = new Map();
    for (const comic of parent.directComics) {
      const title = path.basename(comic, path.extname(comic));
      const parsed = parseOrderPrefix(title);
      if (!parsed) {
        issues.push(
          issue(
            "error",
            "MISSING_SEQUENCE_POSITION",
            "Every comic in an exact reading order needs a numeric position.",
            path.join(parent.relativePath, comic)
          )
        );
      } else {
        const matches = comicRanks.get(parsed.normalized) || [];
        matches.push(comic);
        comicRanks.set(parsed.normalized, matches);
      }
    }
    for (const [rank, matches] of comicRanks) {
      if (matches.length < 2) continue;
      issues.push(
        issue(
          "error",
          "DUPLICATE_SEQUENCE_POSITION",
          `${matches.length} comics share position ${rank}.`,
          parent.relativePath
        )
      );
    }
    for (const child of parent.children) {
      if (
        child.role !== "staging" &&
        containsComics(child) &&
        child.role !== "ordered-section"
      ) {
        issues.push(
          issue(
            "error",
            "UNRANKED_SEQUENCE_BRANCH",
            "This branch contains comics but has no numeric sequence position.",
            child.relativePath
          )
        );
      }
      validateParent(child);
    }
  }
  validateParent(rootNode);
}

function sortTree(nodes) {
  const roleWeight = {
    publisher: 0,
    staging: 1,
    "ordered-section": 2,
    series: 3,
    group: 3,
    unranked: 4,
    ignored: 5
  };
  nodes.sort((left, right) => {
    const roleComparison =
      (roleWeight[left.role] ?? 9) - (roleWeight[right.role] ?? 9);
    if (roleComparison !== 0) return roleComparison;
    if (left.rank && right.rank) {
      const rankComparison = compareRanks(
        parseOrderPrefix(`${left.rank} x`),
        parseOrderPrefix(`${right.rank} x`)
      );
      if (rankComparison !== 0) return rankComparison;
    }
    return naturalCompare(left.displayName, right.displayName);
  });
  for (const node of nodes) sortTree(node.children);
}

async function analyzeSource(candidate, options = {}) {
  const rootPath = path.resolve(candidate);
  const requestedProfile = options.profile || "detect";
  if (
    requestedProfile !== "detect" &&
    !ORGANIZATION_PROFILES.has(requestedProfile)
  ) {
    throw jsonError("Choose a supported organization profile.", "INVALID_PROFILE");
  }

  const maxEntries = Number(options.maxEntries || 5000);
  const maxDepth = Number(options.maxDepth || 10);
  const issues = [];
  let visitedEntries = 0;
  let truncated = false;

  async function readDirectory(directoryPath, relativePath, depth) {
    const node = {
      name: depth === 0 ? path.basename(directoryPath) : path.basename(relativePath),
      relativePath,
      depth,
      role: depth === 0 ? "source" : null,
      rank: null,
      rawRank: null,
      displayName: depth === 0 ? path.basename(directoryPath) : null,
      directComics: [],
      directComicCount: 0,
      totalComicCount: 0,
      children: []
    };
    if (depth > maxDepth) {
      truncated = true;
      issues.push(
        issue(
          "warning",
          "PREVIEW_DEPTH_LIMIT",
          `Preview stopped after ${maxDepth} folder levels.`,
          relativePath
        )
      );
      return node;
    }

    let handle;
    try {
      handle = await fsp.opendir(directoryPath);
      for await (const entry of handle) {
        if (visitedEntries >= maxEntries) {
          truncated = true;
          break;
        }
        visitedEntries += 1;
        if (entry.name.startsWith(".") || entry.name === "@eaDir") continue;
        const entryPath = path.join(directoryPath, entry.name);
        const entryRelativePath = path.join(relativePath, entry.name);
        if (entry.isDirectory()) {
          node.children.push(
            await readDirectory(entryPath, entryRelativePath, depth + 1)
          );
        } else if (entry.isFile() && isComic(entry.name)) {
          node.directComics.push(entry.name);
        }
      }
    } catch (error) {
      issues.push(
        issue(
          "error",
          "DIRECTORY_UNREADABLE",
          error.code === "EACCES"
            ? "PanelShelf does not have permission to read this folder."
            : error.message,
          relativePath
        )
      );
    } finally {
      if (handle) await handle.close().catch(() => {});
    }
    node.directComics.sort(naturalCompare);
    node.directComicCount = node.directComics.length;
    node.totalComicCount =
      node.directComicCount +
      node.children.reduce((sum, child) => sum + child.totalComicCount, 0);
    return node;
  }

  const rootNode = await readDirectory(rootPath, "", 0);
  if (truncated) {
    issues.push(
      issue(
        "warning",
        "PREVIEW_TRUNCATED",
        `Preview stopped after ${maxEntries} filesystem entries.`
      )
    );
  }

  const detection = detectProfile(rootNode);
  const profile =
    requestedProfile === "detect" ? detection.profile : requestedProfile;
  classifyTree(rootNode, profile, issues);

  if (profile === "loose-comics") validateLoose(rootNode, issues);
  if (profile === "folders-as-series") validateSeries(rootNode, issues);
  if (profile === "exact-reading-order") validateExact(rootNode, issues);
  if (
    profile === "hierarchical-timeline" ||
    profile === "exact-reading-order"
  ) {
    validateSiblingRanks(rootNode, profile, issues);
  }

  sortTree(rootNode.children);

  const rootPublisher = publisherMatch(path.basename(rootPath));
  const childPublishers = rootNode.children
    .map((node) => ({ node, match: publisherMatch(node.name) }))
    .filter((candidate) => candidate.match);
  const publisher = rootPublisher
    ? { ...rootPublisher, path: "" }
    : childPublishers.length === 1
      ? {
          ...childPublishers[0].match,
          confidence:
            childPublishers[0].match.confidence === "low" ? "low" : "medium",
          path: childPublishers[0].node.relativePath
        }
      : null;

  if (publisher && publisher.ambiguous) {
    issues.push(
      issue(
        "warning",
        "AMBIGUOUS_PUBLISHER",
        `"${publisher.alias}" may be a publisher or an ordinary folder name.`,
        publisher.path
      )
    );
  }
  if (!publisher && childPublishers.length > 1) {
    issues.push(
      issue(
        "warning",
        "MULTIPLE_PUBLISHERS",
        "Several publisher folders were detected; each will remain a separate branch."
      )
    );
  }

  const nodes = flattenNodes(rootNode.children);
  return {
    path: rootPath,
    requestedProfile,
    profile,
    detection,
    publisher,
    publisherCandidates: childPublishers.map(({ node, match }) => ({
      ...match,
      path: node.relativePath
    })),
    summary: {
      folders: nodes.length,
      comics: rootNode.totalComicCount,
      orderedSections: nodes.filter((node) => node.role === "ordered-section")
        .length,
      publishers: nodes.filter((node) => node.role === "publisher").length,
      groups: nodes.filter(
        (node) => node.role === "group" || node.role === "series"
      ).length,
      stagingFolders: nodes.filter((node) => node.role === "staging").length,
      ignoredFolders: nodes.filter((node) => node.role === "ignored").length,
      truncated
    },
    issues,
    rootComics: rootNode.directComics,
    tree: rootNode.children
  };
}

module.exports = {
  ORGANIZATION_PROFILES,
  PUBLISHER_ALIASES,
  analyzeSource,
  compareRanks,
  normalizeAlias,
  parseOrderPrefix,
  publisherMatch,
  roleForFolder
};
