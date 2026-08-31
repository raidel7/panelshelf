"use strict";

const { jsonError } = require("./util");
const { normalizeReaderId } = require("./reader-profiles");

const BACKUP_FORMAT = "panelshelf-backup";
const BACKUP_SCHEMA_VERSION = 1;
const MAX_BROWSER_PROGRESS = 100_000;
const MAX_SKIPPED_NODES = 100_000;
const MAX_READER_PROFILES = 20;
const LIBRARY_VIEWS = new Set(["all", "publisher", "chronological"]);
const READER_FITS = new Set(["width", "height"]);
const READER_MODES = new Set(["single", "double", "manga", "continuous"]);

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function backupError(message) {
  return jsonError(message, "INVALID_BACKUP");
}

function normalizeProgress(value) {
  if (!plainObject(value)) return {};
  const entries = Object.entries(value);
  if (entries.length > MAX_BROWSER_PROGRESS) {
    throw backupError("This backup contains too many reading-progress records.");
  }
  return Object.fromEntries(
    entries
      .filter(([id, progress]) =>
        /^[a-f0-9]{24}$/.test(id) && plainObject(progress)
      )
      .map(([id, progress]) => [
        id,
        {
          pageIndex: Math.max(0, Number(progress.pageIndex) || 0),
          pageCount: Math.max(0, Number(progress.pageCount) || 0),
          completed: Boolean(progress.completed),
          skipped: Boolean(progress.skipped),
          lastReadAt:
            typeof progress.lastReadAt === "string"
              ? progress.lastReadAt.slice(0, 40)
              : null,
          orderId:
            typeof progress.orderId === "string"
              ? progress.orderId.slice(0, 80)
              : null
        }
      ])
  );
}

// Every reader profile's shelf, added in 0.5 without moving the schema past 1.
//
// A version number says what a reader must understand to make sense of the
// file, and this block asks nothing of one that does not: `browser.progress`
// and `browser.chronologyPreferences.skippedNodeIds` still carry the default
// profile's state, exactly as they did before profiles existed. So a 0.4.18
// backup restores here unchanged, and a 0.5 backup restored on 0.4.18 puts back
// the default reader's shelf rather than refusing the file outright.
//
// Absent means absent, not empty: `null` tells the restore to take the browser
// block as the whole story, which is what an older backup is.
function normalizeReaders(value) {
  if (!plainObject(value)) return null;
  const profiles = Array.isArray(value.profiles) ? value.profiles : [];
  if (profiles.length > MAX_READER_PROFILES) {
    throw backupError("This backup contains too many reader profiles.");
  }
  const readers = {
    profiles: profiles
      .filter(
        (profile) =>
          plainObject(profile) &&
          normalizeReaderId(profile.id) &&
          typeof profile.name === "string"
      )
      .map((profile) => ({
        id: normalizeReaderId(profile.id),
        name: profile.name.slice(0, 60),
        createdAt:
          typeof profile.createdAt === "string" ? profile.createdAt : null
      })),
    progress: {},
    skips: {}
  };
  for (const [candidate, records] of Object.entries(
    plainObject(value.progress) ? value.progress : {}
  )) {
    const readerProfileId = normalizeReaderId(candidate);
    if (readerProfileId) readers.progress[readerProfileId] = normalizeProgress(records);
  }
  for (const [candidate, nodeIds] of Object.entries(
    plainObject(value.skips) ? value.skips : {}
  )) {
    const readerProfileId = normalizeReaderId(candidate);
    if (!readerProfileId || !Array.isArray(nodeIds)) continue;
    const unique = [
      ...new Set(
        nodeIds.filter((id) => typeof id === "string").map((id) => id.slice(0, 1000))
      )
    ];
    if (unique.length > MAX_SKIPPED_NODES) {
      throw backupError("This backup contains too many skipped chronology folders.");
    }
    readers.skips[readerProfileId] = unique;
  }
  return readers;
}

function normalizeBrowserState(value = {}) {
  const browser = plainObject(value) ? value : {};
  const chronology = plainObject(browser.chronologyPreferences)
    ? browser.chronologyPreferences
    : {};
  const skippedNodeIds = Array.isArray(chronology.skippedNodeIds)
    ? [...new Set(
        chronology.skippedNodeIds
          .filter((id) => typeof id === "string")
          .map((id) => id.slice(0, 1000))
      )]
    : [];
  if (skippedNodeIds.length > MAX_SKIPPED_NODES) {
    throw backupError("This backup contains too many skipped chronology folders.");
  }
  const reader = plainObject(browser.reader) ? browser.reader : {};
  return {
    progress: normalizeProgress(browser.progress),
    libraryView: LIBRARY_VIEWS.has(browser.libraryView)
      ? browser.libraryView
      : "all",
    chronologyPreferences: {
      skippedNodeIds,
      hideSkipped: Boolean(chronology.hideSkipped),
      layout: chronology.layout === "timeline" ? "timeline" : "grid"
    },
    reader: {
      fit: READER_FITS.has(reader.fit) ? reader.fit : "width",
      mode: READER_MODES.has(reader.mode) ? reader.mode : "single"
    }
  };
}

function validateBackup(value) {
  if (!plainObject(value) || value.format !== BACKUP_FORMAT) {
    throw backupError("Choose a PanelShelf backup JSON file.");
  }
  if (value.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw backupError(
      `Backup schema ${value.schemaVersion ?? "unknown"} is not supported by this version of PanelShelf.`
    );
  }
  if (!plainObject(value.data)) {
    throw backupError("This PanelShelf backup is incomplete.");
  }
  if (!plainObject(value.data.config) || !Array.isArray(value.data.config.sources)) {
    throw backupError("This backup does not contain valid source settings.");
  }
  if (!plainObject(value.data.readingOrders)) {
    throw backupError("This backup does not contain valid reading orders.");
  }
  if (!plainObject(value.data.metadataMatches)) {
    throw backupError("This backup does not contain valid metadata matches.");
  }
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt:
      typeof value.createdAt === "string" ? value.createdAt : null,
    appVersion:
      typeof value.appVersion === "string" ? value.appVersion : null,
    data: {
      config: structuredClone(value.data.config),
      readingOrders: structuredClone(value.data.readingOrders),
      metadataMatches: structuredClone(value.data.metadataMatches),
      metadataOverrides: plainObject(value.data.metadataOverrides)
        ? structuredClone(value.data.metadataOverrides)
        : {},
      browser: normalizeBrowserState(value.data.browser),
      readers: normalizeReaders(value.data.readers)
    }
  };
}

function backupSummary(backup) {
  const data = backup.data;
  return {
    createdAt: backup.createdAt,
    appVersion: backup.appVersion,
    sourceCount: data.config.sources.length,
    readingOrders: Array.isArray(data.readingOrders.orders)
      ? data.readingOrders.orders.length
      : 0,
    metadataMatches: Object.keys(data.metadataMatches).length,
    metadataOverrides: Object.keys(data.metadataOverrides || {}).length,
    // Counted from the default profile, so this number means the same thing it
    // did before reader profiles existed. `readerProfiles` is what tells you
    // there is more in the file than one shelf.
    progressRecords: Object.keys(data.browser.progress).length,
    skippedFolders: data.browser.chronologyPreferences.skippedNodeIds.length,
    readerProfiles: data.readers ? data.readers.profiles.length : 1
  };
}

module.exports = {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  backupSummary,
  normalizeBrowserState,
  normalizeReaders,
  validateBackup
};
