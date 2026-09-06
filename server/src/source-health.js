"use strict";

// One place to ask whether a source is well.
//
// The pieces of this answer already existed and were scattered: whether the
// folder is readable came from the config route, how many comics it holds from
// the library listing, what went wrong while reading it from the scan report,
// and how long that took from nowhere at all. An owner with a shelf that looks
// half empty had to visit three screens and infer the rest.
//
// Nothing here reads the disk. Availability is inspected by `getConfig`, which
// already does it for its own answer, and everything else is counted from state
// the server is holding. A dashboard that costs a filesystem walk is a
// dashboard nobody can leave open.

// Below this a source is worth pointing at. A healthy internal volume manages
// thousands of files a second and a NAS with spinning disks still manages
// hundreds; single digits mean a drive waking up, a network share, or a mount
// that is about to fail. Deliberately far below anything a working setup does,
// because the cost of crying wolf here is that the whole panel gets ignored.
const SLOW_FILES_PER_SECOND = 20;
// Under this a rate is noise — one archive that happened to be huge, or a
// source with four comics in it.
const SLOW_MINIMUM_FILES = 50;

// The worst thing true of a source, because that is what a summary should say.
function verdict({ available, code, errors, slow }) {
  if (!available) {
    return code === "ENOENT" || code === "FOLDER_UNAVAILABLE"
      ? "disconnected"
      : "unreadable";
  }
  if (errors > 0) return "damaged";
  if (slow) return "slow";
  return "ok";
}

function describe(status, { message, errors, warnings, filesPerSecond }) {
  switch (status) {
    case "disconnected":
      return message || "Folder is not mounted or no longer exists.";
    case "unreadable":
      return message || "PanelShelf does not have permission to read this folder.";
    case "damaged":
      return `${errors} ${errors === 1 ? "file" : "files"} could not be read on the last scan.`;
    case "slow":
      return `Reading about ${Math.round(filesPerSecond)} files a second, which is slow enough to be worth a look.`;
    default:
      return warnings > 0
        ? `Readable. ${warnings} ${warnings === 1 ? "file has" : "files have"} metadata worth reviewing.`
        : "Readable.";
  }
}

function countIssues(issues, sourceId) {
  const byCode = {};
  let total = 0;
  for (const issue of issues) {
    // An issue recorded before issues carried a source belongs to nobody
    // rather than to everybody.
    if (issue.sourceId !== sourceId) continue;
    total += 1;
    const code = issue.code || "UNKNOWN";
    byCode[code] = (byCode[code] || 0) + 1;
  }
  return { total, byCode };
}

// `sources` is what `getConfig()` returns: the configured source plus the
// availability it inspected.
function sourceHealth({ sources, comics, scanState }) {
  const state = scanState || {};
  const errors = Array.isArray(state.errors) ? state.errors : [];
  const warnings = Array.isArray(state.warnings) ? state.warnings : [];
  const scanned = Array.isArray(state.sources) ? state.sources : [];

  const held = new Map();
  for (const comic of comics) {
    const entry = held.get(comic.sourceId) || { comics: 0, unreachable: 0, unreadable: 0 };
    entry.comics += 1;
    if (comic.available === false) entry.unreachable += 1;
    // Counted from the records rather than from the last scan's report. The
    // report is emptied and rewritten by every scan; the record is what the
    // library actually holds, and it outlives a restart.
    if (comic.readError) entry.unreadable += 1;
    held.set(comic.sourceId, entry);
  }

  const reported = sources.map((source) => {
    const counts = held.get(source.id) || { comics: 0, unreachable: 0, unreadable: 0 };
    const sourceErrors = countIssues(errors, source.id);
    const sourceWarnings = countIssues(warnings, source.id);
    const lastScan = scanned.find((entry) => entry.id === source.id) || null;

    const filesPerSecond =
      lastScan && lastScan.durationMs > 0 && lastScan.files > 0
        ? (lastScan.files / lastScan.durationMs) * 1000
        : null;
    const slow =
      filesPerSecond !== null &&
      lastScan.files >= SLOW_MINIMUM_FILES &&
      filesPerSecond < SLOW_FILES_PER_SECOND;

    const status = verdict({
      available: source.available !== false,
      code: source.code,
      errors: Math.max(sourceErrors.total, counts.unreadable),
      slow
    });

    return {
      id: source.id,
      name: source.name,
      path: source.path,
      profile: source.profile,
      status,
      detail: describe(status, {
        message: source.message,
        errors: Math.max(sourceErrors.total, counts.unreadable),
        warnings: sourceWarnings.total,
        filesPerSecond
      }),
      available: source.available !== false,
      code: source.code || null,
      comics: counts.comics,
      // Files this source holds that would not open. Durable: it comes from the
      // library, not from whichever scan ran last.
      unreadableFiles: counts.unreadable,
      // Comics this source still has on the shelf that cannot be opened. Not
      // the same as its comic count being zero: a source that went away keeps
      // its shelf on purpose, and that is the difference between "disconnected"
      // and "empty" everywhere it is shown.
      unreachable: counts.unreachable,
      issues: {
        errors: sourceErrors.total,
        warnings: sourceWarnings.total,
        byCode: { ...sourceErrors.byCode, ...sourceWarnings.byCode }
      },
      lastScan: lastScan
        ? {
            startedAt: lastScan.startedAt,
            finishedAt: lastScan.finishedAt,
            durationMs: lastScan.durationMs,
            files: lastScan.files,
            filesPerSecond: filesPerSecond === null ? null : Math.round(filesPerSecond)
          }
        : null
    };
  });

  // A comic whose source is no longer configured is not any source's problem
  // and would otherwise be invisible. It should not happen — a scan drops them
  // — so if it does, saying so beats hiding it.
  const configured = new Set(sources.map((source) => source.id));
  const orphaned = comics.filter((comic) => !configured.has(comic.sourceId)).length;

  return {
    generatedAt: new Date().toISOString(),
    sources: reported,
    summary: {
      sources: reported.length,
      healthy: reported.filter((source) => source.status === "ok").length,
      disconnected: reported.filter((source) => source.status === "disconnected").length,
      unreadable: reported.filter((source) => source.status === "unreadable").length,
      damaged: reported.filter((source) => source.status === "damaged").length,
      slow: reported.filter((source) => source.status === "slow").length,
      comics: comics.length,
      unreachable: reported.reduce((total, source) => total + source.unreachable, 0),
      unreadableFiles: reported.reduce((total, source) => total + source.unreadableFiles, 0),
      orphaned
    }
  };
}

module.exports = { sourceHealth, SLOW_FILES_PER_SECOND, SLOW_MINIMUM_FILES };
