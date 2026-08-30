"use strict";

// Which comics look like copies of each other, and nothing more than that.
//
// The release gate says duplicate suggestions must never delete or merge source
// files automatically, and this module is where that promise is kept: it reads
// the index and returns groups. It has no way to delete anything, which is the
// strongest form the promise can take - a later change cannot accidentally make
// it destructive, because there is nothing here to make destructive.
//
// Two signals, and the difference between them matters.
//
// Identical contents is certain. The scan already fingerprints every file, and
// two files with the same fingerprint are the same comic filed twice - the
// commonest kind by far, usually a download kept and then filed again.
//
// The same issue in different formats is only probable. A CBZ and a CBR of one
// issue have different bytes and are still the same comic, but so are a raw
// scan and a restored version of it, and only the owner knows which they meant
// to keep. Calling that certain would be a lie someone might act on.

function issueKey(comic) {
  const metadata = comic.metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const series =
    typeof metadata.series === "string" && metadata.series.trim()
      ? metadata.series.trim().toLowerCase()
      : null;
  // Without a number this would group a whole run together and call every issue
  // a duplicate of every other. Half a library has no ComicInfo, so this is the
  // common case rather than the edge.
  const number =
    metadata.number === undefined || metadata.number === null
      ? null
      : String(metadata.number).trim().toLowerCase();
  if (!series || !number) return null;
  return `${series} ${number}`;
}

function entryFor(comic) {
  return {
    id: comic.id,
    title: comic.title || "",
    series: comic.series || "",
    relativePath: comic.relativePath || "",
    size: Number(comic.size) || 0,
    sourceName: comic.sourceName || ""
  };
}

// Everything but the largest copy could be reclaimed, which is the number worth
// sorting on: it is what acting on this group would actually save.
function reclaimable(comics) {
  const sizes = comics.map((comic) => Number(comic.size) || 0);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  return total - Math.max(...sizes);
}

function groupsFrom(comics, keyOf, reason, confidence, alreadyGrouped) {
  const byKey = new Map();
  for (const comic of comics) {
    if (alreadyGrouped.has(comic.id)) continue;
    const key = keyOf(comic);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(comic);
  }
  const groups = [];
  for (const [key, members] of byKey) {
    if (members.length < 2) continue;
    for (const comic of members) alreadyGrouped.add(comic.id);
    groups.push({
      key,
      reason,
      confidence,
      reclaimableBytes: reclaimable(members),
      comics: members.map(entryFor)
    });
  }
  return groups;
}

function findDuplicates(comics) {
  // A comic whose source is unplugged is not a reason to suggest removing the
  // copy that is still there - the shelf is short, not duplicated.
  const present = (comics || []).filter((comic) => comic && comic.available !== false);

  const grouped = new Set();
  const certain = groupsFrom(
    present,
    (comic) => comic.fingerprint || null,
    "identical-contents",
    "certain",
    grouped
  );
  // Second, skipping anything already grouped, so a pair that is both
  // byte-identical and the same issue is reported once under the stronger
  // reason rather than twice.
  const probable = groupsFrom(present, issueKey, "same-issue", "probable", grouped);

  return [...certain, ...probable].sort(
    (left, right) => right.reclaimableBytes - left.reclaimableBytes
  );
}

module.exports = { findDuplicates };
