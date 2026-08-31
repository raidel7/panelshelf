"use strict";

const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

// What to send someone who is trying to help.
//
// The problems that need a bundle are the ones a screenshot cannot carry: a
// source that scans on one NAS and not another, an index that disagrees with
// the folder, a reader that shows the wrong shelf. Those are answered by
// versions, source arrangement, counts, and the log — so those are what this
// collects, and nothing else.
//
// Two rules decide every judgement call below. Nothing that could be replayed
// as a credential goes in: no device token or its hash, no provider key, not
// even the four-character hint the settings page shows. And nothing from inside
// a comic goes in: no page, no cover, no archive listing.
//
// Folder paths do go in, whole. They are the subject of most of what goes
// wrong, and a bundle that omits them cannot answer the questions it exists
// for. A path can carry a person's name, so the bundle says at the top what it
// contains, in words, before anyone has to scroll — the owner is the one who
// decides whether to send it, and they can only decide that if they know.

const MAX_LOG_BYTES = 256 * 1024;
const MAX_SCAN_ISSUES = 200;
const MAX_SOURCES = 100;

const DATA_FILES = [
  "artwork.json",
  "bulk-metadata.json",
  "changes.json",
  "config.json",
  "covers.json",
  "devices.json",
  "library.json",
  "metadata-overrides.json",
  "online-metadata.json",
  "progress.json",
  "readers.json",
  "reading-orders.json",
  "scan-report.json",
  "skips.json"
];

// Which of the server's own settings are worth reporting. Every one of them is
// a name, an address or a path — there is nothing here a bundle should hide,
// and a proxy misconfiguration is exactly the sort of thing someone reading
// this would want to see first.
const REPORTED_ENV = [
  "PANELSHELF_HOST",
  "PANELSHELF_PORT",
  "PANELSHELF_DATA",
  "PANELSHELF_ALLOWED_HOSTS",
  "PANELSHELF_TRUSTED_PROXY",
  "NODE_ENV"
];

// The log is the one part of this that nobody wrote deliberately, so it is the
// one part that could contain anything. A device token is recognisable by its
// prefix, and a Basic credential by the header that carries it; both are
// replaced rather than trimmed, so the shape of the line survives and whoever
// reads it can still tell what happened.
function redact(text) {
  return String(text)
    .replace(/pst_[A-Za-z0-9_-]{8,}/g, "pst_«redacted»")
    .replace(/(authorization\s*:\s*)(\S+\s+)?\S+/gi, "$1«redacted»")
    .replace(/((?:token|password|secret|api[-_]?key)"?\s*[:=]\s*"?)[^\s",}]+/gi, "$1«redacted»");
}

async function fileReport(filePath) {
  try {
    const stats = await fsp.stat(filePath);
    return {
      bytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      mode: `0${(stats.mode & 0o777).toString(8)}`
    };
  } catch (error) {
    return { present: false, code: error.code || "UNKNOWN" };
  }
}

// The tail, not the whole thing: a log that has been running for months is
// megabytes of successful scans, and the interesting part is always the end.
async function logTail(logPath) {
  let handle;
  try {
    handle = await fsp.open(logPath, "r");
  } catch (error) {
    return { path: logPath, present: false, code: error.code || "UNKNOWN" };
  }
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, MAX_LOG_BYTES);
    const buffer = Buffer.alloc(length);
    if (length > 0) await handle.read(buffer, 0, length, size - length);
    let text = buffer.toString("utf8");
    // A tail can start mid-line, and half a line reads as a mystery rather
    // than as a truncation. Drop it and say so.
    const truncated = size > length;
    if (truncated) text = text.slice(text.indexOf("\n") + 1);
    return {
      path: logPath,
      present: true,
      bytes: size,
      truncated,
      text: redact(text)
    };
  } finally {
    await handle.close();
  }
}

function sourceReport(source) {
  return {
    id: source.id,
    path: source.path,
    profile: source.profile,
    stagingPolicy: source.stagingPolicy,
    // A disconnected USB drive is the single most common thing behind "my
    // comics disappeared", and it is invisible in the stored record.
    available: source.available === true,
    code: source.code || null,
    message: source.message || null
  };
}

// Providers, reduced to whether each one could authenticate rather than how.
// `settings()` masks the Metron token to its last four characters for the
// settings page, which is right there and wrong here: a bundle travels.
function providerReport(settings) {
  const providers = Array.isArray(settings?.providers) ? settings.providers : [];
  return providers.map((provider) => ({
    id: provider.id,
    enabled: Boolean(provider.enabled),
    configured: Boolean(provider.configured),
    permissionConfirmed: Boolean(provider.permissionConfirmed),
    authentication: provider.authentication
  }));
}

function comicStatistics(comics) {
  const byExtension = {};
  const bySource = {};
  let withMetadata = 0;
  let withPageCount = 0;
  for (const comic of comics) {
    const extension = path.extname(comic.path || "").toLowerCase() || "(none)";
    byExtension[extension] = (byExtension[extension] || 0) + 1;
    const sourceId = comic.sourceId || "(none)";
    bySource[sourceId] = (bySource[sourceId] || 0) + 1;
    if (comic.metadata) withMetadata += 1;
    if (Number.isFinite(comic.pageCount) && comic.pageCount > 0) withPageCount += 1;
  }
  return { total: comics.length, byExtension, bySource, withMetadata, withPageCount };
}

async function createSupportBundle(options = {}) {
  const { library, version, apiVersion } = options;
  const dataDirectory = library.dataDirectory;
  const logPath = options.logPath || path.join(dataDirectory, "panelshelf.log");
  const environment = options.env || process.env;

  // Through getConfig rather than off library.config: whether a source is
  // reachable right now is the first thing anyone reading this wants to know,
  // and it is not stored — it is answered by looking at the folder, which is
  // what getConfig does. Reading the raw record instead gave a bundle that
  // named every source and said nothing about any of them.
  const config = await library.getConfig();
  const scan = library.getScanState();
  const metadata = library.getMetadataSettings();
  const readerProfiles = library.listReaderProfiles();

  const files = {};
  for (const name of DATA_FILES) {
    files[name] = await fileReport(path.join(dataDirectory, name));
  }

  return {
    format: "panelshelf-support-bundle",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),

    // Read this before sending it anywhere.
    contains: {
      included: [
        "PanelShelf and Node versions, and how this server is configured",
        "The full path of every source folder, and whether it is reachable",
        "Counts: comics, sources, reader profiles, saved reading positions",
        "The names and dates of paired devices",
        "The last part of the server log"
      ],
      excluded: [
        "Device tokens, and the hashes they are stored as",
        "Metadata provider keys, including the masked hint shown in settings",
        "Comic pages, covers, and the contents of any archive",
        "Which comics anybody has read"
      ],
      notice:
        "Source paths can contain a person's name. Read this file before " +
        "attaching it to anything public."
    },

    panelshelf: {
      version,
      apiVersion,
      uptimeSeconds: Math.round(process.uptime()),
      dataDirectory
    },

    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      totalMemoryBytes: os.totalmem(),
      freeMemoryBytes: os.freemem(),
      cpuCount: os.cpus().length,
      // Resident set is the number that answers "is it being killed for
      // memory", which on a small NAS is a real question.
      memoryUsage: process.memoryUsage(),
      environment: Object.fromEntries(
        REPORTED_ENV.filter((name) => environment[name] !== undefined).map((name) => [
          name,
          environment[name]
        ])
      )
    },

    configuration: {
      schemaVersion: config.schemaVersion,
      sourceCount: config.sources.length,
      sources: config.sources.slice(0, MAX_SOURCES).map(sourceReport)
    },

    library: comicStatistics(library.comics || []),

    scan: {
      running: scan.running,
      action: scan.action,
      sourceId: scan.sourceId,
      startedAt: scan.startedAt,
      finishedAt: scan.finishedAt,
      scannedFiles: scan.scannedFiles,
      reusedFiles: scan.reusedFiles,
      openedArchives: scan.openedArchives,
      metadataFiles: scan.metadataFiles,
      foundComics: scan.foundComics,
      retainedComics: scan.retainedComics,
      // Counted before the cap, so a bundle that carries two hundred issues
      // still says how many there really were.
      errorCount: scan.errors.length,
      warningCount: scan.warnings.length,
      errors: scan.errors.slice(-MAX_SCAN_ISSUES),
      warnings: scan.warnings.slice(-MAX_SCAN_ISSUES)
    },

    metadata: {
      providers: providerReport(metadata),
      matchCount: Object.keys(library.enrichment?.exportMatches() || {}).length
    },

    readers: {
      // Names, not the shelves: how many positions each profile holds says
      // whether a "my progress vanished" report is about the wrong profile,
      // and which comics they are does not.
      profiles: readerProfiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        progressRecords: Object.keys(library.progress.exportData(profile.id) || {}).length,
        skippedFolders: library.skips.exportData(profile.id).length
      }))
    },

    devices: {
      pairingEnabled: library.deviceTokens.enabled,
      // publicDevice never returns the hash. Even so the binding is reduced to
      // a boolean here rather than repeated: it is already above.
      paired: library.deviceTokens.list().map((device) => ({
        id: device.id,
        name: device.name,
        createdAt: device.createdAt,
        lastUsedAt: device.lastUsedAt,
        expiresAt: device.expiresAt,
        boundToReaderProfile: Boolean(device.readerProfileId)
      }))
    },

    storage: {
      files,
      coverCache: library.coverCacheStatus()
    },

    log: await logTail(logPath)
  };
}

module.exports = { createSupportBundle, redact, MAX_LOG_BYTES };
