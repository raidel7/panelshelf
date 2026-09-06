"use strict";

// Which files will not open, and — the part that matters — whether they cluster.
//
// The issue list this feeds was accurate and unreadable: one row per broken
// file, each with its full absolute path, in the order the walk happened to
// find them. On a real library that came out as twenty-eight rows, of which
// twelve were consecutive issues in a single Superman folder. Twelve rows and
// one row look alike in a flat list, and they are not alike at all: twelve
// consecutive issues in one folder is one bad download, while one file in a
// folder of forty is one bad file. The first is fixed by fetching that volume
// again, the second by replacing a file. Grouping is what tells them apart.
//
// Nothing here touches the disk. Everything is counted from records the server
// already holds, for the reason `source-health.js` gives: a screen that costs a
// filesystem walk is a screen nobody can leave open.

// Two ceilings, bounding different things. A library with four thousand broken
// files should still say "four thousand" — a count is one number and costs
// nothing — while four thousand paths help nobody and make a document no client
// wants to render. So: counts are always exact, lists are always bounded, and
// anything withheld says that it was.
const DEFAULT_FILE_LIMIT = 500;
const DEFAULT_FOLDER_LIMIT = 100;

// The folder a comic sits in, keyed per source. Two sources can each have a
// "Superman" folder and they are not the same shelf.
function folderKey(comic) {
  return `${comic.sourceId} ${(comic.folderSegments || []).join("/")}`;
}

function tally(into, code) {
  const key = code || "UNKNOWN";
  into[key] = (into[key] || 0) + 1;
}

function fileName(comic) {
  const relative = String(comic.relativePath || comic.path || "");
  const parts = relative.split(/[/\\]/);
  return parts[parts.length - 1] || relative;
}

// The folder as somewhere to go, not as an id. Whoever reads this is about to
// open a file manager, so the absolute path is the useful one.
function folderPath(root, segments) {
  const base = String(root || "").replace(/\/+$/, "");
  return segments.length ? `${base}/${segments.join("/")}` : base;
}

function scanIssues({ comics, scanState, limit, maxFolders } = {}) {
  const all = Array.isArray(comics) ? comics : [];
  const state = scanState || {};
  const reported = Array.isArray(state.errors) ? state.errors : [];
  const fileLimit = Number.isFinite(limit) && limit >= 0 ? limit : DEFAULT_FILE_LIMIT;
  const folderLimit =
    Number.isFinite(maxFolders) && maxFolders >= 0 ? maxFolders : DEFAULT_FOLDER_LIMIT;

  // One pass covers both halves: how many comics each folder holds, and which
  // of them would not open. The total is what turns "12 broken" into "12 of 12".
  const folders = new Map();
  const byCode = {};
  const sources = new Set();
  const brokenPaths = new Set();
  const knownPaths = new Set();
  let files = 0;

  for (const comic of all) {
    if (comic.path) knownPaths.add(comic.path);
    const key = folderKey(comic);
    let entry = folders.get(key);
    if (!entry) {
      entry = {
        sourceId: comic.sourceId,
        sourceName: comic.sourceName || null,
        segments: comic.folderSegments || [],
        root: comic.libraryRoot || "",
        comics: 0,
        files: 0,
        byCode: {},
        items: []
      };
      folders.set(key, entry);
    }
    entry.comics += 1;

    // A comic on a disconnected source has no pages either, and it is not the
    // same problem: the file is fine and the drive is absent. Source health
    // says so already, and repeating it here would bury the damaged ones.
    if (!comic.readError || comic.available === false) continue;

    entry.files += 1;
    files += 1;
    sources.add(comic.sourceId);
    tally(entry.byCode, comic.readError.code);
    tally(byCode, comic.readError.code);
    if (comic.path) brokenPaths.add(comic.path);
    entry.items.push({
      id: comic.id,
      name: fileName(comic),
      code: comic.readError.code || "UNKNOWN",
      message: comic.readError.message || "The file could not be read.",
      size: Number.isFinite(comic.size) ? comic.size : null,
      modifiedAt: comic.modifiedAt || null
    });
  }

  const damaged = [...folders.values()].filter((entry) => entry.files > 0);
  // Biggest cluster first: that is the triage order, and with the folder list
  // capped it also decides which folders survive the cap.
  damaged.sort(
    (a, b) => b.files - a.files || a.segments.join("/").localeCompare(b.segments.join("/"))
  );

  const foldersTruncated = damaged.length > folderLimit;
  const kept = damaged.slice(0, folderLimit);

  let budget = fileLimit;
  let truncated = false;
  const shown = kept.map((entry) => {
    // Named order within a folder, because a run of consecutive issues is the
    // shape of the problem and walk order hides it.
    entry.items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const items = entry.items.slice(0, Math.max(budget, 0));
    budget -= items.length;
    if (items.length < entry.items.length) truncated = true;
    return {
      sourceId: entry.sourceId,
      sourceName: entry.sourceName,
      folder: entry.segments.join("/"),
      path: folderPath(entry.root, entry.segments),
      files: entry.files,
      comics: entry.comics,
      // The difference between "this volume is ruined" and "this volume has a
      // bad file in it" — which is the difference between what you do next.
      wholeFolder: entry.files === entry.comics,
      byCode: entry.byCode,
      truncated: items.length < entry.items.length,
      items
    };
  });

  // Errors from the last scan that never became a comic: a folder that would
  // not open, a file that failed before it could be indexed. They have no
  // record to group by, and dropping them would make this screen quietly less
  // complete than the flat list it replaces.
  const unindexed = [];
  for (const issue of reported) {
    if (!issue || !issue.path) continue;
    if (brokenPaths.has(issue.path) || knownPaths.has(issue.path)) continue;
    unindexed.push({
      path: issue.path,
      code: issue.code || "UNKNOWN",
      message: issue.message || "The item could not be scanned.",
      sourceId: issue.sourceId || null
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    folders: shown,
    unindexed: unindexed.slice(0, fileLimit),
    summary: {
      files,
      folders: damaged.length,
      sources: sources.size,
      byCode,
      unindexed: unindexed.length,
      truncated,
      foldersTruncated
    }
  };
}

module.exports = { scanIssues, DEFAULT_FILE_LIMIT, DEFAULT_FOLDER_LIMIT };
