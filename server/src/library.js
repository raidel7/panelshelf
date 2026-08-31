"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const {
  archiveType,
  inspectComicArchive,
  isReadableFile,
  listPages,
  readPage
} = require("./archive");
const {
  MetadataEnrichmentStore,
  mergeMetadata
} = require("./enrichment");
const { BulkMetadataMatcher } = require("./bulk-metadata");
const { parseComicInfo } = require("./metadata");
const { MetadataOverrideStore } = require("./metadata-overrides");
const { ProgressStore } = require("./progress");
const {
  ReaderProfileStore,
  DEFAULT_READER_ID
} = require("./reader-profiles");
const {
  cleanTitle,
  comicId,
  fileFingerprint,
  jsonError,
  mimeForName,
  naturalCompare
} = require("./util");

const { ReadingOrderStore } = require("./reading-orders");
const {
  THUMBNAIL_EXTENSION,
  UnsupportedImageError,
  createThumbnail,
  imageSize
} = require("./thumbnail");
const { CoverCacheStore, CoverWarmup } = require("./cover-cache");
const { DeviceTokenStore } = require("./device-tokens");
const { LibraryChangeLog } = require("./library-changes");
const { CustomArtworkStore } = require("./custom-artwork");
const { findDuplicates } = require("./duplicates");
const {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  backupSummary,
  normalizeBrowserState,
  validateBackup
} = require("./backup");
const {
  ORGANIZATION_PROFILES,
  analyzeSource,
  parseOrderPrefix,
  publisherMatch,
  roleForFolder
} = require("./structure");
const { buildChronology, chronologyView } = require("./chronology");
const { SkipStore } = require("./skips");

const COMIC_EXTENSIONS = new Set([".cbr", ".cbz"]);
const CONFIG_SCHEMA_VERSION = 2;
const STAGING_POLICIES = new Set(["show-unfiled", "exclude"]);
const SCAN_ACTIONS = new Set(["quick", "source", "retry", "full"]);

function inferFilenameMetadata(filePath) {
  const filename = path.basename(
    String(filePath || ""),
    path.extname(String(filePath || ""))
  );
  const parentheticalGroups = [...filename.matchAll(/\(([^)]*)\)/g)];
  const plausibleYears = parentheticalGroups
    .map((match) => {
      const years = [...match[1].matchAll(/(?:^|\D)((?:18|19|20|21)\d{2})(?!\d)/g)];
      return years.length === 1 ? years[0][1] : null;
    })
    .filter(Boolean)
    .map(Number)
    .filter((year) => year >= 1800 && year <= 2199);
  if (plausibleYears.length === 0) return null;
  return {
    source: "filename",
    year: plausibleYears.at(-1)
  };
}

function defaultConfig() {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    sources: []
  };
}

function emptyScanState() {
  return {
    running: false,
    action: "quick",
    sourceId: null,
    sourceName: null,
    startedAt: null,
    finishedAt: null,
    scannedFiles: 0,
    reusedFiles: 0,
    openedArchives: 0,
    metadataFiles: 0,
    foundComics: 0,
    retainedComics: 0,
    errors: [],
    warnings: []
  };
}

async function atomicWriteJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600
  });
  await fsp.rename(temporary, filePath);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function normalizeLibraryPath(candidate) {
  if (typeof candidate !== "string" || candidate.trim() === "") {
    throw jsonError("Choose a comics folder.", "INVALID_PATH");
  }
  const normalized = path.resolve(candidate.trim());
  if (!path.isAbsolute(normalized)) {
    throw jsonError("The comics folder must be an absolute path.", "INVALID_PATH");
  }
  if (
    process.env.PANELSHELF_ALLOW_ANY_PATH !== "1" &&
    !/^\/volume(?:USB)?\d+(?:\/|$)/.test(normalized)
  ) {
    throw jsonError(
      "Choose a folder under an internal volume or mounted USB volume.",
      "INVALID_PATH"
    );
  }
  return normalized;
}

// When a comic arrived, for the shelf's "Recently added" row.
//
// `addedAt` is stamped the first time a comic enters the index and carried
// forward by every rescan. A library indexed before that field existed has
// none, and falls back to the archive's own modification time — otherwise the
// row would stay empty until the user scanned 26,000 comics, and would then
// show all of them as having arrived at the same instant.
function addedTime(comic) {
  const stamp = Date.parse(comic?.addedAt || comic?.modifiedAt || "");
  return Number.isFinite(stamp) ? stamp : 0;
}

function recentlyAdded(comics, limit) {
  const ordered = [...comics].sort((left, right) => {
    const difference = addedTime(right) - addedTime(left);
    if (difference !== 0) return difference;
    // A library copied in one operation shares a timestamp to the second, and
    // an unstable sort would reshuffle the row on every request.
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
  return Number.isFinite(limit) && limit > 0 ? ordered.slice(0, limit) : ordered;
}

function sourceIdentifier(sourcePath) {
  return `src_${comicId(`source:${sourcePath}`)}`;
}

function normalizeSource(candidate, previousByPath = new Map()) {
  if (!candidate || typeof candidate !== "object") {
    throw jsonError("Each source must be an object.", "INVALID_CONFIG");
  }
  const sourcePath = normalizeLibraryPath(candidate.path);
  const previous = previousByPath.get(sourcePath);
  const profile = candidate.profile || previous?.profile || "unordered";
  if (!ORGANIZATION_PROFILES.has(profile)) {
    throw jsonError(
      `"${profile}" is not a supported organization profile.`,
      "INVALID_PROFILE"
    );
  }
  const stagingPolicy =
    candidate.stagingPolicy || previous?.stagingPolicy || "show-unfiled";
  if (!STAGING_POLICIES.has(stagingPolicy)) {
    throw jsonError(
      "Choose whether staging folders should be shown or excluded.",
      "INVALID_CONFIG"
    );
  }
  const fallbackName = path.basename(sourcePath) || sourcePath;
  const requestedName =
    typeof candidate.name === "string" ? candidate.name.trim() : "";
  return {
    id:
      (typeof candidate.id === "string" && candidate.id.trim()) ||
      previous?.id ||
      sourceIdentifier(sourcePath),
    name: requestedName || previous?.name || fallbackName,
    path: sourcePath,
    profile,
    stagingPolicy,
    hideOrderPrefixes:
      typeof candidate.hideOrderPrefixes === "boolean"
        ? candidate.hideOrderPrefixes
        : previous?.hideOrderPrefixes ?? true,
    needsProfileConfirmation:
      typeof candidate.needsProfileConfirmation === "boolean"
        ? candidate.needsProfileConfirmation
        : previous?.needsProfileConfirmation ?? profile === "unordered"
  };
}

function migrateConfig(rawConfig) {
  if (
    rawConfig &&
    rawConfig.schemaVersion === CONFIG_SCHEMA_VERSION &&
    Array.isArray(rawConfig.sources)
  ) {
    const previousByPath = new Map();
    const sources = rawConfig.sources.map((source) =>
      normalizeSource(source, previousByPath)
    );
    return {
      config: { schemaVersion: CONFIG_SCHEMA_VERSION, sources },
      migrated: false
    };
  }
  const libraryPaths =
    rawConfig && Array.isArray(rawConfig.libraryPaths)
      ? rawConfig.libraryPaths
      : [];
  return {
    config: {
      schemaVersion: CONFIG_SCHEMA_VERSION,
      sources: [...new Set(libraryPaths.map(normalizeLibraryPath))].map(
        (sourcePath) =>
          normalizeSource({
            path: sourcePath,
            profile: "unordered",
            needsProfileConfirmation: true
          })
      )
    },
    migrated: true
  };
}

function validateNoOverlaps(sources) {
  for (let leftIndex = 0; leftIndex < sources.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < sources.length;
      rightIndex += 1
    ) {
      const left = sources[leftIndex];
      const right = sources[rightIndex];
      const leftContainsRight = right.path.startsWith(`${left.path}${path.sep}`);
      const rightContainsLeft = left.path.startsWith(`${right.path}${path.sep}`);
      if (!leftContainsRight && !rightContainsLeft) continue;
      throw jsonError(
        "Source folders cannot overlap because the same comic would be indexed twice.",
        "SOURCE_OVERLAP",
        [{ path: left.path }, { path: right.path }]
      );
    }
  }
}

function normalizedBackup(value) {
  const backup = validateBackup(value);
  const migrated = migrateConfig(backup.data.config);
  validateNoOverlaps(migrated.config.sources);
  backup.data.config = migrated.config;
  return backup;
}

function hierarchyForComic(source, relativePath) {
  const directory = path.dirname(relativePath);
  if (directory === ".") return [];
  return directory.split(path.sep).map((segment, index) => {
    const parsed = parseOrderPrefix(segment);
    const publisher = index === 0 ? publisherMatch(segment) : null;
    return {
      name: segment,
      displayName:
        source.hideOrderPrefixes && parsed
          ? parsed.label
          : segment.replace(/^_+/, ""),
      role: publisher
        ? "publisher"
        : roleForFolder(segment, source.profile, index + 1),
      rank: parsed ? parsed.normalized : null,
      publisher
    };
  });
}

function embeddedPublisher(metadata) {
  if (!metadata || typeof metadata !== "object") return null;
  const publisher =
    typeof metadata.publisher === "string" ? metadata.publisher.trim() : "";
  const imprint =
    typeof metadata.imprint === "string" ? metadata.imprint.trim() : "";
  if (imprint) {
    return (
      publisherMatch(imprint) || {
        name: imprint,
        kind: "imprint",
        ...(publisher ? { parent: publisher } : {}),
        alias: imprint,
        confidence: "embedded"
      }
    );
  }
  if (!publisher) return null;
  return (
    publisherMatch(publisher) || {
      name: publisher,
      kind: "publisher",
      alias: publisher,
      confidence: "embedded"
    }
  );
}

function publisherForComic(source, hierarchy = [], metadata = null) {
  const metadataPublisher = embeddedPublisher(metadata);
  if (metadataPublisher) return metadataPublisher;
  const folderPublisher = hierarchy.find(
    (node) => node && node.role === "publisher" && node.publisher
  );
  if (folderPublisher) return folderPublisher.publisher;
  return publisherMatch(path.basename(source.path));
}

function sourceForIssue(sources, issuePath) {
  return sources
    .filter(
      (source) =>
        issuePath === source.path ||
        String(issuePath || "").startsWith(`${source.path}${path.sep}`)
    )
    .sort((left, right) => right.path.length - left.path.length)[0] || null;
}

function comicBelongsToSource(comic, source) {
  return (
    comic.sourceId === source.id ||
    (!comic.sourceId && comic.libraryRoot === source.path)
  );
}

// A comic is only ours to keep while some configured source still claims it. A
// source the user deleted from Library folders claims nothing, so its comics
// are orphans; a source that is merely unplugged still claims its own, which is
// what lets the unavailable-source retention below keep them.
function comicIsConfigured(comic, sources) {
  return sources.some((source) => comicBelongsToSource(comic, source));
}

function orderPathForComic(relativePath) {
  return relativePath.split(path.sep).map((segment, index, segments) => {
    const sortableName =
      index === segments.length - 1
        ? path.basename(segment, path.extname(segment))
        : segment;
    const parsed = parseOrderPrefix(sortableName);
    return {
      name: sortableName,
      rank: parsed ? parsed.normalized : null,
      label: parsed ? parsed.label : sortableName
    };
  });
}

async function inspectLibraryPath(candidate) {
  const normalized = normalizeLibraryPath(candidate);
  try {
    await fsp.access(normalized, fs.constants.R_OK | fs.constants.X_OK);
    const stat = await fsp.stat(normalized);
    if (!stat.isDirectory()) {
      throw jsonError("The selected path is not a folder.", "NOT_A_DIRECTORY");
    }
    const handle = await fsp.opendir(normalized);
    await handle.close();
    return {
      path: normalized,
      available: true,
      code: null,
      message: "Folder is readable."
    };
  } catch (error) {
    if (error.code === "NOT_A_DIRECTORY") throw error;
    return {
      path: normalized,
      available: false,
      code: error.code || "FOLDER_UNAVAILABLE",
      message:
        error.code === "ENOENT"
          ? "Folder is not mounted or no longer exists."
          : "PanelShelf does not have permission to read this folder."
    };
  }
}

async function walkComics(root, onComic, options = {}) {
  const directories = [root];
  while (directories.length > 0) {
    const current = directories.pop();
    let handle;
    try {
      handle = await fsp.opendir(current);
      for await (const entry of handle) {
        const candidate = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (
            !entry.name.startsWith(".") &&
            entry.name !== "@eaDir" &&
            (!options.shouldEnterDirectory ||
              options.shouldEnterDirectory(candidate, entry.name))
          ) {
            directories.push(candidate);
          }
        } else if (
          entry.isFile() &&
          COMIC_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
        ) {
          await onComic(candidate);
        }
      }
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      throw error;
    }
  }
}

class ComicLibrary {
  constructor(dataDirectory, options = {}) {
    this.dataDirectory = dataDirectory;
    this.configPath = path.join(dataDirectory, "config.json");
    this.indexPath = path.join(dataDirectory, "library.json");
    this.scanReportPath = path.join(dataDirectory, "scan-report.json");
    this.coverDirectory = path.join(dataDirectory, "covers");
    this.tempDirectory = path.join(dataDirectory, "tmp");
    this.config = defaultConfig();
    this.comics = [];
    this.comicsById = new Map();
    this.pageCache = new Map();
    // What is cached in `covers/`, and what each entry was built from. Also
    // carries the comics whose cover cannot be shrunk, so a repeat request —
    // or a restart — does not decode one again only to give up.
    this.coverCache = new CoverCacheStore(dataDirectory);
    this.deviceTokens = new DeviceTokenStore(dataDirectory);
    this.changes = new LibraryChangeLog(dataDirectory);
    this.artwork = new CustomArtworkStore(dataDirectory);
    this.coverWarmup = new CoverWarmup({
      listComics: () => this.listComics(),
      warm: (comic) => this.warmCover(comic)
    });
    this.scanState = emptyScanState();
    this.readingOrders = new ReadingOrderStore(dataDirectory);
    this.enrichment = new MetadataEnrichmentStore(dataDirectory, {
      fetchImpl: options.fetchImpl
    });
    this.metadataOverrides = new MetadataOverrideStore(dataDirectory);
    this.readerProfiles = new ReaderProfileStore(dataDirectory);
    this.progress = new ProgressStore(dataDirectory);
    this.skips = new SkipStore(dataDirectory);
    this.bulkMetadata = new BulkMetadataMatcher(dataDirectory, {
      search: (input) => this.enrichment.search(input),
      confirm: (comicId, provider, recordId) =>
        this.enrichment.confirm(comicId, provider, recordId),
      getComic: (id) => this.getComic(id),
      publicComic: (comic) => this.publicComic(comic),
      delayMs: options.bulkMetadataDelayMs
    });
  }

  async initialize() {
    await fsp.mkdir(this.dataDirectory, { recursive: true });
    await fsp.mkdir(this.coverDirectory, { recursive: true });
    await fsp.mkdir(this.tempDirectory, { recursive: true });
    await this.enrichment.initialize();
    await this.metadataOverrides.initialize();
    await this.readerProfiles.initialize();
    await this.progress.initialize();
    await this.skips.initialize();
    await this.coverCache.initialize();
    await this.deviceTokens.initialize();
    await this.changes.initialize();
    await this.artwork.initialize();
    const storedConfig = await readJson(this.configPath, defaultConfig());
    const migratedConfig = migrateConfig(storedConfig);
    this.config = migratedConfig.config;
    if (migratedConfig.migrated) {
      await atomicWriteJson(this.configPath, this.config);
    }
    const saved = await readJson(this.indexPath, { comics: [] });
    const savedComics = Array.isArray(saved.comics) ? saved.comics : [];
    // An index written before removed sources were pruned still carries their
    // comics, so upgrading is enough to be rid of them — the user does not have
    // to re-save Library folders or scan first. This is config membership only,
    // never availability: a source that is merely unplugged still claims its
    // comics here and keeps every one of them.
    const retainedComics = savedComics.filter((comic) =>
      comicIsConfigured(comic, this.config.sources)
    );
    const droppedOrphans = retainedComics.length !== savedComics.length;
    const beforePrune = this.comics;
    this.setComics(retainedComics);
    await this.changes.record(beforePrune, this.comics);
    // Reconciles the orders against the pruned list on its own.
    await this.readingOrders.initialize(this.comics);
    if (droppedOrphans) {
      await this.enrichment.reconcile(this.comics);
      await this.pruneCoverCache();
      await this.pruneArtwork();
      await atomicWriteJson(this.indexPath, {
        scannedAt: saved.scannedAt || null,
        comics: this.comics
      });
    }
    const savedScanState = await readJson(this.scanReportPath, emptyScanState());
    const normalizedScanState =
      savedScanState && typeof savedScanState === "object" ? savedScanState : {};
    this.scanState = {
      ...emptyScanState(),
      ...normalizedScanState,
      running: false,
      errors: Array.isArray(normalizedScanState.errors)
        ? normalizedScanState.errors
        : [],
      warnings: Array.isArray(normalizedScanState.warnings)
        ? normalizedScanState.warnings
        : []
    };
    await this.bulkMetadata.initialize();
  }

  setComics(comics) {
    this.comics = comics.sort((left, right) =>
      naturalCompare(left.title, right.title)
    );
    this.comicsById = new Map(this.comics.map((comic) => [comic.id, comic]));
    // The chronology is derived from exactly this list, so it cannot outlive a
    // change to it. Rebuilt on the next request rather than here: a scan sets
    // the comics repeatedly and most of those trees would never be looked at.
    this.chronologyTree = null;
  }

  // Built once per version of the index and kept: walking tens of thousands of
  // comics into a tree costs real time on a NAS, and a client browsing the
  // chronology asks for one node after another.
  chronology(readerProfileId, nodeId) {
    if (!this.chronologyTree) {
      this.chronologyTree = buildChronology(this.comics);
    }
    return chronologyView(
      this.chronologyTree,
      nodeId,
      (comic) => this.compactComic(comic),
      this.skips.list(readerProfileId).nodeIds
    );
  }

  async getConfig() {
    const sources = await Promise.all(
      this.config.sources.map(async (source) => ({
        ...source,
        ...(await inspectLibraryPath(source.path))
      }))
    );
    return {
      schemaVersion: CONFIG_SCHEMA_VERSION,
      sources,
      libraryPaths: sources.map(({ path: sourcePath, available, code, message }) => ({
        path: sourcePath,
        available,
        code,
        message
      }))
    };
  }

  async saveConfig(input) {
    const previousByPath = new Map(
      this.config.sources.map((source) => [source.path, source])
    );
    let candidates;
    if (Array.isArray(input)) {
      candidates = input.map((sourcePath) => ({ path: sourcePath }));
    } else if (input && Array.isArray(input.sources)) {
      candidates = input.sources;
    } else if (input && Array.isArray(input.libraryPaths)) {
      candidates = input.libraryPaths.map((sourcePath) =>
        typeof sourcePath === "string" ? { path: sourcePath } : sourcePath
      );
    } else {
      throw jsonError("sources must be a list.", "INVALID_CONFIG");
    }

    const byPath = new Map();
    for (const candidate of candidates) {
      const source = normalizeSource(candidate, previousByPath);
      byPath.set(source.path, source);
    }
    const sources = [...byPath.values()];
    validateNoOverlaps(sources);

    const inspected = await Promise.all(
      sources.map((source) => inspectLibraryPath(source.path))
    );
    const previouslyConfigured = new Set(this.config.sources.map((source) => source.path));
    const unavailable = inspected.filter(
      (item) => !item.available && !previouslyConfigured.has(item.path)
    );
    if (unavailable.length > 0) {
      throw jsonError(
        unavailable[0].message,
        "FOLDER_UNAVAILABLE",
        unavailable
      );
    }
    this.config = {
      schemaVersion: CONFIG_SCHEMA_VERSION,
      sources
    };
    await atomicWriteJson(this.configPath, this.config);
    await this.dropUnconfiguredComics();
    return this.getConfig();
  }

  // Removing a source from Library folders takes effect immediately: the user
  // does not have to remember to scan before the comics they removed stop
  // showing up. Mirrors the tail of scan() so nothing is left pointing at
  // comics that no longer exist.
  async dropUnconfiguredComics() {
    const retained = this.comics.filter((comic) =>
      comicIsConfigured(comic, this.config.sources)
    );
    if (retained.length === this.comics.length) return false;
    const beforeRetain = this.comics;
    this.setComics(retained);
    await this.changes.record(beforeRetain, this.comics);
    await this.readingOrders.reconcile(this.comics);
    await this.enrichment.reconcile(this.comics);
    await this.pruneCoverCache();
    await this.pruneArtwork();
    this.pageCache.clear();
    await atomicWriteJson(this.indexPath, {
      scannedAt: new Date().toISOString(),
      comics: this.comics
    });
    return true;
  }

  createBackup(browserState, appVersion) {
    return {
      format: BACKUP_FORMAT,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      appVersion: String(appVersion || "unknown"),
      data: {
        config: structuredClone(this.config),
        readingOrders: this.readingOrders.exportData(),
        metadataMatches: this.enrichment.exportMatches(),
        metadataOverrides: this.metadataOverrides.exportData(),
        // Progress is deliberately sourced from the server-side store, not the
        // caller's browserState. Any progress the caller sends is ignored.
        //
        // The browser block carries the default reader profile's shelf, which
        // is what it carried before profiles existed; `readers` below carries
        // the household. Keeping both means a 0.5 backup still says something
        // true to a 0.4.18 server rather than being refused by it.
        browser: normalizeBrowserState({
          ...browserState,
          progress: this.progress.exportData(DEFAULT_READER_ID),
          // Skipped branches are server-owned too, so the caller's copy is
          // ignored the same way its progress is.
          chronologyPreferences: {
            ...(browserState?.chronologyPreferences || {}),
            skippedNodeIds: this.skips.exportData(DEFAULT_READER_ID)
          }
        }),
        readers: {
          profiles: this.readerProfiles.exportData(),
          progress: this.progress.exportAll().readers,
          skips: this.skips.exportAll().readers
        }
      }
    };
  }

  async previewBackup(value) {
    const backup = normalizedBackup(value);
    const sourceStatuses = await Promise.all(
      backup.data.config.sources.map(async (source) => ({
        id: source.id,
        name: source.name,
        path: source.path,
        ...(await inspectLibraryPath(source.path))
      }))
    );
    return {
      ...backupSummary(backup),
      sourceStatuses,
      unavailableSources: sourceStatuses.filter((source) => !source.available).length
    };
  }

  async restoreBackup(value) {
    if (this.scanState.running) {
      throw jsonError(
        "Wait for the current scan to finish before restoring a backup.",
        "SCAN_RUNNING"
      );
    }
    const backup = normalizedBackup(value);
    const previous = {
      config: structuredClone(this.config),
      readingOrders: this.readingOrders.exportData(),
      metadataMatches: this.enrichment.exportMatches(),
      metadataOverrides: this.metadataOverrides.exportData(),
      readerProfiles: this.readerProfiles.exportData(),
      progress: this.progress.exportAll(),
      skips: this.skips.exportAll()
    };
    try {
      this.config = backup.data.config;
      await atomicWriteJson(this.configPath, this.config);
      await this.readingOrders.restoreData(backup.data.readingOrders);
      await this.enrichment.restoreMatches(backup.data.metadataMatches);
      await this.metadataOverrides.restoreData(backup.data.metadataOverrides);
      // A backup with a `readers` block describes the whole household. One
      // without it is from before reader profiles existed, and everything it
      // holds belongs to the default profile — which is exactly what the store
      // does with the flat shapes the browser block carries.
      if (backup.data.readers) {
        await this.readerProfiles.restoreData(backup.data.readers.profiles);
        await this.progress.restoreData({ readers: backup.data.readers.progress });
        await this.skips.restoreData({ readers: backup.data.readers.skips });
      } else {
        await this.readerProfiles.restoreData([]);
        await this.progress.restoreData(backup.data.browser.progress);
        await this.skips.restoreData(
          backup.data.browser.chronologyPreferences.skippedNodeIds
        );
      }
    } catch (error) {
      this.config = previous.config;
      await atomicWriteJson(this.configPath, this.config).catch(() => {});
      await this.readingOrders.restoreData(previous.readingOrders).catch(() => {});
      await this.enrichment.restoreMatches(previous.metadataMatches).catch(() => {});
      await this.metadataOverrides.restoreData(previous.metadataOverrides).catch(() => {});
      await this.readerProfiles.restoreData(previous.readerProfiles).catch(() => {});
      await this.progress.restoreData(previous.progress).catch(() => {});
      await this.skips.restoreData(previous.skips).catch(() => {});
      throw error;
    }
    // The restored config may name a different set of sources than the index
    // was built from; anything it no longer covers goes now rather than
    // lingering until the next scan.
    await this.dropUnconfiguredComics();
    return {
      restored: true,
      summary: backupSummary(backup),
      browser: backup.data.browser
    };
  }

  async previewSource(candidate, profile = "detect") {
    const status = await inspectLibraryPath(candidate);
    if (!status.available) {
      throw jsonError(status.message, "FOLDER_UNAVAILABLE", [status]);
    }
    return analyzeSource(status.path, { profile });
  }

  listComics(query = "") {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return this.comics;
    return this.comics.filter((comic) => {
      const displayed = this.publicComic(comic);
      return `${displayed.title} ${displayed.series} ${comic.relativePath} ${
        displayed.metadata?.publisher || ""
      } ${displayed.metadata?.imprint || ""} ${
        displayed.metadata?.summary || ""
      } ${Object.values(displayed.metadata?.creators || {})
        .flat()
        .join(" ")} ${(displayed.metadata?.genres || []).join(" ")} ${(
        displayed.metadata?.characters || []
      ).join(" ")}`
        .toLocaleLowerCase()
        .includes(normalizedQuery);
    });
  }

  getComic(id) {
    const comic = this.comicsById.get(id);
    if (!comic) throw jsonError("Comic not found.", "NOT_FOUND");
    return comic;
  }

  // The fields a browsing list actually draws, and nothing else.
  //
  // `publicComic` is 2.8 KB per comic — 71 MB across this library's 26,625 —
  // and three quarters of that is metadata blocks that largely duplicate each
  // other, plus `orderPath` and `hierarchy`, which no client list renders. A
  // grid of covers needs the id (which addresses the cover and the progress
  // record), the display title and series, the page count, whether the file is
  // reachable, the format, and the publisher's name — the last only because
  // the iPad's search filters on it.
  //
  // Derived from `publicComic` rather than from the raw comic, so the title,
  // series and publisher a list shows are the same ones the detail screen
  // shows: those three are computed from merged metadata and an override, and
  // a second implementation of that merge would drift.
  compactComic(comic) {
    const full = this.publicComic(comic);
    return {
      id: full.id,
      title: full.title,
      series: full.series,
      pageCount: full.pageCount,
      available: full.available,
      format: full.format,
      // The name, plus the publisher it is an imprint of when that differs.
      // `kind`, `alias` and `confidence` cost 1.4 MB across the library and no
      // list draws them; `parent` costs 148 KB and is what keeps a Publishers
      // view from filing WildStorm away from DC. Absent when a publisher is its
      // own parent, which is most of them.
      publisher: full.publisher?.name
        ? {
            name: full.publisher.name,
            ...(full.publisher.parent && full.publisher.parent !== full.publisher.name
              ? { parent: full.publisher.parent }
              : {})
          }
        : null
    };
  }

  publicComic(comic) {
    const hierarchy = Array.isArray(comic.hierarchy) ? comic.hierarchy : [];
    const source =
      this.config.sources.find((candidate) => candidate.id === comic.sourceId) ||
      { path: comic.libraryRoot || "" };
    const onlineMatch = this.enrichment.publicMatch(comic.id);
    const onlineMetadata = onlineMatch?.record?.metadata || null;
    const inferredMetadata =
      comic.filenameMetadata && typeof comic.filenameMetadata === "object"
        ? comic.filenameMetadata
        : inferFilenameMetadata(comic.path || comic.relativePath);
    const enrichedMetadata = mergeMetadata(inferredMetadata, onlineMetadata);
    const sourceMetadata = mergeMetadata(enrichedMetadata, comic.metadata);
    const manualOverride = this.metadataOverrides.get(comic.id);
    const effectiveMetadata = mergeMetadata(
      sourceMetadata,
      manualOverride?.metadata
    );
    const title =
      (typeof effectiveMetadata?.title === "string" &&
        effectiveMetadata.title.trim()) ||
      comic.title;
    const series =
      (typeof effectiveMetadata?.series === "string" &&
        effectiveMetadata.series.trim()) ||
      comic.series;
    return {
      id: comic.id,
      title,
      series,
      localTitle: comic.title,
      localSeries: comic.series,
      format: comic.format,
      size: comic.size,
      modifiedAt: comic.modifiedAt,
      pageCount: comic.pageCount,
      relativePath: comic.relativePath,
      libraryRoot: comic.libraryRoot,
      sourceId: comic.sourceId,
      sourceName: comic.sourceName,
      sourceProfile: comic.sourceProfile,
      available: comic.available !== false,
      publisher: manualOverride?.metadata?.publisher
        ? publisherForComic(source, hierarchy, effectiveMetadata)
        : comic.publisher || publisherForComic(source, hierarchy, effectiveMetadata),
      metadata: effectiveMetadata,
      embeddedMetadata:
        comic.metadata && typeof comic.metadata === "object"
          ? comic.metadata
          : null,
      inferredMetadata,
      sourceMetadata,
      metadataEntry: comic.metadataEntry || null,
      onlineMatch,
      manualOverride,
      metadataSources: [
        ...(inferredMetadata ? ["filename"] : []),
        ...(comic.metadata ? ["comicinfo"] : []),
        ...(onlineMatch ? [onlineMatch.provider] : []),
        ...(manualOverride ? ["manual"] : [])
      ],
      hierarchy,
      // So the browser asks for a chosen cover only where there is one, rather
      // than taking a 404 on every card it draws.
      hasCustomCover: Boolean(this.artwork.get(`comic:${comic.id}`, "cover")),
      orderPath: Array.isArray(comic.orderPath) ? comic.orderPath : []
    };
  }

  getMetadataSettings() {
    return this.enrichment.settings();
  }

  async saveMetadataSettings(input) {
    return this.enrichment.saveSettings(input);
  }

  async searchMetadata(id, input) {
    this.getComic(id);
    return this.enrichment.search(input);
  }

  async reviewMetadata(id, provider, recordId, options = {}) {
    const comic = this.getComic(id);
    if (!this.enrichment.supportsProvider(provider)) {
      throw jsonError("Unsupported metadata provider.", "INVALID_PROVIDER");
    }
    const review = await this.enrichment.review(provider, recordId, options);
    return {
      comic: this.publicComic(comic),
      candidate: review.record,
      cached: review.cached,
      stale: review.stale,
      warning: review.warning || null,
      attribution: review.attribution,
      rateLimit: review.rateLimit,
      effectiveMetadata: mergeMetadata(
        review.record.metadata,
        comic.metadata
      )
    };
  }

  async confirmMetadata(id, provider, recordId) {
    const comic = this.getComic(id);
    if (!this.enrichment.supportsProvider(provider)) {
      throw jsonError("Unsupported metadata provider.", "INVALID_PROVIDER");
    }
    await this.enrichment.confirm(comic.id, provider, recordId);
    return this.publicComic(comic);
  }

  async removeMetadata(id) {
    const comic = this.getComic(id);
    await this.enrichment.remove(comic.id);
    return this.publicComic(comic);
  }

  getBulkMetadataState() {
    return this.bulkMetadata.publicState();
  }

  async startBulkMetadata(input = {}) {
    if (this.scanState.running) {
      throw jsonError(
        "Wait for the library scan to finish before enriching metadata.",
        "SCAN_RUNNING"
      );
    }
    const comics = this.comics.map((comic) => this.publicComic(comic));
    return this.bulkMetadata.start(comics, input);
  }

  async pauseBulkMetadata() {
    return this.bulkMetadata.pause();
  }

  async resumeBulkMetadata() {
    if (this.scanState.running) {
      throw jsonError(
        "Wait for the library scan to finish before resuming metadata enrichment.",
        "SCAN_RUNNING"
      );
    }
    return this.bulkMetadata.resume();
  }

  async cancelBulkMetadata() {
    return this.bulkMetadata.cancel();
  }

  async saveMetadataOverride(id, input) {
    const comic = this.getComic(id);
    await this.metadataOverrides.save(comic.id, input);
    return this.publicComic(comic);
  }

  async removeMetadataOverride(id) {
    const comic = this.getComic(id);
    await this.metadataOverrides.remove(comic.id);
    return this.publicComic(comic);
  }

  async metadataCover(provider, recordId) {
    if (!this.enrichment.supportsProvider(provider)) {
      throw jsonError("Unsupported metadata provider.", "INVALID_PROVIDER");
    }
    return this.enrichment.cover(provider, recordId);
  }

  getReadingOrders() {
    const listed = this.readingOrders.list(this.comics, this.config.sources);
    // So a client knows to ask for the chosen cover instead of guessing at the
    // artwork route and taking a 404 for every order that has none.
    return {
      ...listed,
      manual: listed.manual.map((order) => ({
        ...order,
        hasCustomCover: Boolean(this.artwork.get(`order:${order.id}`, "cover"))
      }))
    };
  }

  async createReadingOrder(input) {
    return this.readingOrders.create(input, this.comics);
  }

  async updateReadingOrder(id, input) {
    return this.readingOrders.update(id, input, this.comics);
  }

  // Reads the index and returns groups. It cannot delete anything, which is
  // how the release gate that duplicates are never resolved automatically is
  // kept: there is nothing here to make destructive later.
  // What the matcher left for a person, narrowed to what is still open. A comic
  // confirmed by hand since the job ran is settled even though the job's own
  // record still says review, and a comic that has left the library is not a
  // decision anybody can make.
  metadataReviewQueue() {
    const known = new Map(this.comics.map((comic) => [comic.id, comic]));
    const entries = this.bulkMetadata
      .reviewQueue()
      .filter((entry) => known.has(entry.comicId))
      .filter((entry) => !this.enrichment.publicMatch(entry.comicId))
      .map((entry) => ({ ...entry, series: known.get(entry.comicId).series || "" }));
    return { pending: entries.length, entries };
  }

  async applyBulkMetadata(input) {
    const result = await this.metadataOverrides.applyMany(
      input?.comicIds,
      input?.metadata || {}
    );
    // The shelf shows merged metadata, so a bulk edit changes what every
    // affected card reads. Clients learn about it the same way they learn
    // about a scan.
    await this.changes.record(this.comics, this.comics);
    return result;
  }

  async addComicsToReadingOrder(id, comicIds) {
    return this.readingOrders.addComics(id, comicIds, this.comics);
  }

  findDuplicateComics() {
    const groups = findDuplicates(this.comics);
    return {
      groups,
      reclaimableBytes: groups.reduce((sum, group) => sum + group.reclaimableBytes, 0)
    };
  }

  exportReadingOrder(id) {
    return this.readingOrders.exportOrder(id, this.comics);
  }

  async importReadingOrder(document) {
    return this.readingOrders.importOrder(document, this.comics);
  }

  readingOrderRepairReport(id) {
    return this.readingOrders.repairReport(id, this.comics);
  }

  async repairReadingOrder(id) {
    return this.readingOrders.repair(id, this.comics);
  }

  async duplicateReadingOrder(id) {
    return this.readingOrders.duplicate(id, this.comics);
  }

  async deleteReadingOrder(id) {
    return this.readingOrders.delete(id);
  }

  // Reading position and set-aside branches take the reader profile first,
  // because it is the one argument that decides whose shelf is being touched.
  // Nothing below defaults it: the id is resolved once, where the request comes
  // in, so a caller that has not thought about it gets an error rather than
  // somebody else's shelf.
  listProgress(readerProfileId) {
    const known = new Set(this.comics.map((comic) => comic.id));
    const records = this.progress.exportData(readerProfileId);
    // A comic that is temporarily missing (e.g. a disconnected USB source)
    // keeps its record in the store; it's just hidden from this list.
    for (const comicId of Object.keys(records)) {
      if (!known.has(comicId)) delete records[comicId];
    }
    return records;
  }

  getProgress(readerProfileId, comicId) {
    return this.progress.get(readerProfileId, comicId);
  }

  async saveProgress(readerProfileId, comicId, input) {
    return this.progress.save(readerProfileId, comicId, input);
  }

  async removeProgress(readerProfileId, comicId) {
    return this.progress.remove(readerProfileId, comicId);
  }

  async mergeProgress(readerProfileId, input) {
    return this.progress.merge(readerProfileId, input);
  }

  listSkips(readerProfileId) {
    return this.skips.list(readerProfileId);
  }

  async applySkips(readerProfileId, input) {
    return this.skips.apply(readerProfileId, input);
  }

  async applyProgressBatch(readerProfileId, input) {
    return this.progress.applyBatch(readerProfileId, input);
  }

  // Who is reading. A namespace and nothing more: creating one grants nothing,
  // and pairing is still the only thing between the library and a stranger.
  listReaderProfiles() {
    return this.readerProfiles.list();
  }

  resolveReaderProfile(candidate) {
    return this.readerProfiles.resolve(candidate);
  }

  async createReaderProfile(name) {
    return this.readerProfiles.create(name);
  }

  async renameReaderProfile(id, name) {
    return this.readerProfiles.rename(id, name);
  }

  // A profile nobody uses takes its shelf and its hidden branches with it.
  // Nothing else has to be told, because nothing else was ever per-reader.
  async deleteReaderProfile(id) {
    const deleted = await this.readerProfiles.delete(id);
    if (!deleted) return false;
    await this.progress.forget(id);
    await this.skips.forget(id);
    return true;
  }

  async scan(input = {}) {
    if (this.scanState.running) {
      throw jsonError("A library scan is already running.", "SCAN_RUNNING");
    }
    if (this.bulkMetadata.publicState().status === "running") {
      throw jsonError(
        "Pause bulk metadata enrichment before scanning the library.",
        "METADATA_JOB_RUNNING"
      );
    }
    const request = input && typeof input === "object" ? input : {};
    const action = request.action || "quick";
    if (!SCAN_ACTIONS.has(action)) {
      throw jsonError(
        "Choose Quick scan, Scan this source, Retry issues, or Full rebuild.",
        "INVALID_SCAN_ACTION"
      );
    }
    const requestedSource =
      action === "source"
        ? this.config.sources.find((source) => source.id === request.sourceId)
        : null;
    if (action === "source" && !requestedSource) {
      throw jsonError(
        "Choose a configured source to scan.",
        "INVALID_SCAN_ACTION"
      );
    }

    const previousScanState = this.getScanState();
    const previousIssues = [
      ...(previousScanState.errors || []),
      ...(previousScanState.warnings || [])
    ];
    const retryPlans = new Map();
    if (action === "retry") {
      for (const issue of previousIssues) {
        const source = sourceForIssue(this.config.sources, issue.path);
        if (!source) continue;
        const plan = retryPlans.get(source.id) || {
          source,
          fullSource: false,
          paths: new Set()
        };
        if (
          issue.path === source.path ||
          !COMIC_EXTENSIONS.has(path.extname(issue.path || "").toLowerCase())
        ) {
          plan.fullSource = true;
        } else {
          plan.paths.add(issue.path);
        }
        retryPlans.set(source.id, plan);
      }
    }

    const selectedSources =
      action === "source"
        ? [requestedSource]
        : action === "retry"
          ? [...retryPlans.values()].map((plan) => plan.source)
          : [...this.config.sources];
    this.scanState = {
      running: true,
      action,
      sourceId: requestedSource?.id || null,
      sourceName: requestedSource?.name || null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      scannedFiles: 0,
      reusedFiles: 0,
      openedArchives: 0,
      metadataFiles: 0,
      foundComics: 0,
      retainedComics: 0,
      errors: [],
      warnings: []
    };
    const previous = new Map(this.comics.map((comic) => [comic.path, comic]));
    // Which sources this scan has seen before. A comic appearing in a source
    // that already had comics genuinely arrived now; a comic found by a
    // source's first scan is only as new as its file, and stamping the whole
    // library with the moment it was first indexed would make Recently added
    // an arbitrary slice of it on the launch where it matters most.
    const indexedSources = new Set(
      this.comics.map((comic) => comic.sourceId).filter(Boolean)
    );
    const previousByFingerprint = new Map();
    for (const comic of this.comics) {
      if (!comic.fingerprint) continue;
      const matches = previousByFingerprint.get(comic.fingerprint) || [];
      matches.push(comic);
      previousByFingerprint.set(comic.fingerprint, matches);
    }
    const claimedComicIds = new Set();
    const selectedSourceIds = new Set(selectedSources.map((source) => source.id));
    const discovered = new Map();

    for (const comic of this.comics) {
      // Orphans — comics whose source is gone from the config — are never
      // carried forward. Before this check they were re-seeded on every scan
      // and could never leave the index.
      if (!comicIsConfigured(comic, this.config.sources)) continue;
      if (action === "retry") {
        discovered.set(comic.id, comic);
        continue;
      }
      const selected = this.config.sources.some(
        (source) =>
          selectedSourceIds.has(source.id) && comicBelongsToSource(comic, source)
      );
      if (!selected) discovered.set(comic.id, comic);
    }

    const removeDiscoveredPath = (filePath, source) => {
      for (const [id, comic] of discovered) {
        if (comic.path === filePath && comicBelongsToSource(comic, source)) {
          discovered.delete(id);
        }
      }
    };

    const addError = (filePath, error) => {
      this.scanState.errors.push({
        path: filePath,
        code: error.code || "SCAN_ERROR",
        message: error.message,
        severity: "error"
      });
    };

    const addWarning = (filePath, error, metadataEntry = null) => {
      this.scanState.warnings.push({
        path: filePath,
        code: error.code || "COMICINFO_INVALID",
        message: metadataEntry
          ? `${metadataEntry}: ${error.message}`
          : error.message,
        severity: "warning"
      });
    };

    const processComic = async (filePath, source, options = {}) => {
      this.scanState.scannedFiles += 1;
      try {
        if (!(await isReadableFile(filePath))) return;
        const stat = await fsp.stat(filePath);
        const prior = previous.get(filePath);
        const unchanged =
          prior &&
          Number(prior.size) === Number(stat.size) &&
          Number(prior.mtimeMs) === Number(stat.mtimeMs);
        const fingerprint =
          unchanged && prior.fingerprint && !options.forceFingerprint
            ? prior.fingerprint
            : await fileFingerprint(filePath, stat.size);
        const moveMatches = (previousByFingerprint.get(fingerprint) || [])
          .filter(
            (candidate) =>
              comicBelongsToSource(candidate, source) &&
              !fs.existsSync(candidate.path) &&
              !claimedComicIds.has(candidate.id)
          );
        const movedPrior =
          !prior && moveMatches.length === 1 ? moveMatches[0] : null;
        const identity = prior || movedPrior;
        const stableId = identity?.id || comicId(filePath);
        claimedComicIds.add(stableId);

        const mayReuseArchive =
          !options.forceArchive && ((unchanged && prior) || movedPrior);
        let pageCount = mayReuseArchive ? identity.pageCount : null;
        let metadata = mayReuseArchive ? identity.metadata || null : null;
        let metadataEntry = mayReuseArchive
          ? identity.metadataEntry || null
          : null;
        let detectedFormat = mayReuseArchive
          ? identity.format || archiveType(filePath)
          : archiveType(filePath);

        if (mayReuseArchive) {
          this.scanState.reusedFiles += 1;
        } else {
          this.scanState.openedArchives += 1;
          try {
            const inspection = await inspectComicArchive(
              filePath,
              this.tempDirectory
            );
            pageCount = inspection.pages.length;
            detectedFormat = inspection.format || detectedFormat;
            metadataEntry = inspection.comicInfoName || null;
            // A misnamed extension is not a problem to report. Archives are
            // opened by their contents, not their name, so a CBZ called .cbr
            // reads exactly as well as one called .cbz — and comics are misnamed
            // constantly: one real library had 120 of them in 24,839 files.
            // Listing them buried the handful of files that genuinely would not
            // open. `inspection.extensionMismatch` still reports the mismatch
            // for anything that wants to offer a rename.
            if (inspection.comicInfoError) {
              addWarning(
                filePath,
                inspection.comicInfoError,
                metadataEntry
              );
            } else if (inspection.comicInfo) {
              try {
                metadata = parseComicInfo(inspection.comicInfo);
                this.scanState.metadataFiles += 1;
              } catch (error) {
                addWarning(filePath, error, metadataEntry);
              }
            }
          } catch (error) {
            pageCount = 0;
            addError(filePath, error);
          }
        }

        const relativePath = path.relative(source.path, filePath);
        const folderSegments =
          path.dirname(relativePath) === "."
            ? []
            : path.dirname(relativePath).split(path.sep);
        const cleanedTitle = cleanTitle(filePath);
        const titlePrefix =
          source.profile === "exact-reading-order"
            ? parseOrderPrefix(cleanedTitle)
            : null;
        const inferredTitle =
          source.hideOrderPrefixes && titlePrefix
            ? titlePrefix.label
            : cleanedTitle;
        const hierarchy = hierarchyForComic(source, relativePath);
        const filenameMetadata = inferFilenameMetadata(filePath);
        const inferredSeries =
          source.profile === "folders-as-series" &&
          folderSegments.length > 0
            ? folderSegments[0]
            : path.basename(path.dirname(filePath));
        const title =
          typeof metadata?.title === "string" && metadata.title.trim()
            ? metadata.title.trim()
            : inferredTitle;
        const series =
          typeof metadata?.series === "string" && metadata.series.trim()
            ? metadata.series.trim()
            : inferredSeries;

        discovered.set(stableId, {
          id: stableId,
          path: filePath,
          fingerprint,
          title,
          series,
          relativePath,
          folderSegments,
          publisher: publisherForComic(source, hierarchy, metadata),
          filenameMetadata,
          metadata,
          metadataEntry,
          hierarchy,
          orderPath: orderPathForComic(relativePath),
          libraryRoot: source.path,
          sourceId: source.id,
          sourceName: source.name,
          sourceProfile: source.profile,
          available: true,
          format: detectedFormat,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          modifiedAt: stat.mtime.toISOString(),
          // Stamped once, then carried by every later scan — including across a
          // move, since `identity` is the same comic under a new path. A record
          // from before this field existed inherits its own modification time
          // rather than today's date, which would drop the whole library onto
          // the Recently added row at once; so does a comic found by the first
          // scan of its source, for the same reason.
          addedAt:
            identity?.addedAt ||
            identity?.modifiedAt ||
            (indexedSources.has(source.id)
              ? new Date().toISOString()
              : stat.mtime.toISOString()),
          pageCount: Number.isFinite(pageCount) ? pageCount : 0
        });
        this.scanState.foundComics = discovered.size;
      } catch (error) {
        addError(filePath, error);
      }
    };

    try {
      for (const source of selectedSources) {
        const root = source.path;
        const status = await inspectLibraryPath(root);
        if (!status.available) {
          addError(root, {
            code: status.code || "FOLDER_UNAVAILABLE",
            message: status.message
          });
          const retained = this.comics
            .filter((comic) => comicBelongsToSource(comic, source))
            .map((comic) => ({
              ...comic,
              sourceId: source.id,
              sourceName: source.name,
              sourceProfile: source.profile,
              available: false
            }));
          for (const comic of retained) discovered.set(comic.id, comic);
          this.scanState.retainedComics += retained.length;
          this.scanState.foundComics = discovered.size;
          continue;
        }

        const retryPlan = retryPlans.get(source.id);
        if (action === "retry" && retryPlan && !retryPlan.fullSource) {
          for (const filePath of retryPlan.paths) {
            if (!fs.existsSync(filePath)) {
              removeDiscoveredPath(filePath, source);
              continue;
            }
            await processComic(filePath, source, {
              forceArchive: true,
              forceFingerprint: false
            });
          }
          continue;
        }

        if (action === "retry" && retryPlan?.fullSource) {
          for (const [id, comic] of discovered) {
            if (comicBelongsToSource(comic, source)) discovered.delete(id);
          }
        }
        const processedPaths = new Set();
        try {
          await walkComics(
            root,
            async (filePath) => {
              processedPaths.add(filePath);
              await processComic(filePath, source, {
                forceArchive: action === "full" || action === "retry",
                forceFingerprint: action === "full"
              });
            },
            {
              shouldEnterDirectory: (_directoryPath, name) =>
                source.stagingPolicy !== "exclude" || !name.startsWith("_")
            }
          );
        } catch (error) {
          addError(root, error);
          const retained = this.comics.filter(
            (comic) =>
              comicBelongsToSource(comic, source) &&
              !processedPaths.has(comic.path) &&
              !discovered.has(comic.id)
          );
          for (const comic of retained) discovered.set(comic.id, comic);
          this.scanState.retainedComics += retained.length;
        }
      }
      // Re-checked against the config as it stands now: a source removed while
      // the scan was running must not be written back into the index.
      const beforeScan = this.comics;
      this.setComics(
        [...discovered.values()].filter((comic) =>
          comicIsConfigured(comic, this.config.sources)
        )
      );
      await this.changes.record(beforeScan, this.comics);
      this.scanState.foundComics = this.comics.length;
      await this.readingOrders.reconcile(this.comics);
      await this.enrichment.reconcile(this.comics);
      await this.pruneCoverCache();
      await this.pruneArtwork();
      this.pageCache.clear();
      await atomicWriteJson(this.indexPath, {
        scannedAt: new Date().toISOString(),
        comics: this.comics
      });
    } finally {
      this.scanState.running = false;
      this.scanState.finishedAt = new Date().toISOString();
      await atomicWriteJson(this.scanReportPath, this.scanState);
    }
    return this.getScanState();
  }

  getScanState() {
    return {
      ...this.scanState,
      errors: this.scanState.errors.map((error) => ({ ...error })),
      warnings: this.scanState.warnings.map((warning) => ({ ...warning }))
    };
  }

  // A report that cannot be dismissed stops being read. Some issues are not
  // going to be fixed — a handful of damaged files in a library of thousands —
  // and leaving them on screen forever means the next real problem arrives in a
  // list nobody looks at any more. Clearing empties the report and nothing else:
  // the comics that failed to open stay indexed, and the next scan reports them
  // again if they are still broken.
  async clearScanIssues() {
    if (this.scanState.running) {
      throw jsonError(
        "A library scan is running. Wait for it to finish.",
        "SCAN_RUNNING"
      );
    }
    this.scanState.errors = [];
    this.scanState.warnings = [];
    await atomicWriteJson(this.scanReportPath, this.scanState);
    return this.getScanState();
  }

  async pagesForComic(comic) {
    const cached = this.pageCache.get(comic.id);
    if (
      cached &&
      cached.mtimeMs === comic.mtimeMs &&
      Array.isArray(cached.pages)
    ) {
      return cached.pages;
    }
    const pages = await listPages(comic.path);
    this.pageCache.set(comic.id, { mtimeMs: comic.mtimeMs, pages });
    return pages;
  }

  async page(id, pageNumber) {
    const comic = this.getComic(id);
    const pages = await this.pagesForComic(comic);
    if (!Number.isInteger(pageNumber) || pageNumber < 0 || pageNumber >= pages.length) {
      throw jsonError("Comic page not found.", "NOT_FOUND");
    }
    const entry = pages[pageNumber];
    return {
      buffer: await readPage(comic.path, entry, this.tempDirectory),
      mime: mimeForName(entry.name),
      name: entry.name,
      pageCount: pages.length
    };
  }

  async cover(id, options = {}) {
    const comic = this.getComic(id);

    // Every cache lookup happens before the archive is opened, and that
    // ordering is the whole point. `pagesForComic` opens the archive, so
    // reaching it first meant a source that had gone away — a USB disk asleep,
    // a share unmounted — emptied the shelf visually even though every cover
    // was sitting on the NAS's own disk. Nothing below needs the archive until
    // there is genuinely no cached copy to serve.
    if (options.thumbnail) {
      const cached = await this.cachedThumbnail(comic);
      if (cached) return cached;
    }
    let full = await this.cachedCover(comic);

    // A chosen picture stands in for the archive's first page, and then takes
    // the same path everything else does — including being shrunk for the
    // shelf. Serving it whole because someone picked it would put megabytes on
    // every card, which is the cost thumbnails exist to avoid.
    if (!full) {
      const chosen = this.artwork.get(`comic:${comic.id}`, "cover");
      if (chosen) {
        try {
          full = {
            buffer: await fsp.readFile(this.artwork.pathFor(chosen)),
            mime: chosen.mime
          };
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          // The record outlived the file; fall back to the comic's own cover.
        }
      }
    }

    if (!full) {
      const pages = await this.pagesForComic(comic);
      if (pages.length === 0) {
        throw jsonError("No image pages were found in this comic.", "NO_PAGES");
      }
      const extension = path.extname(pages[0].name).toLowerCase() || ".jpg";
      const file = `${comic.id}${extension}`;
      const cachePath = path.join(this.coverDirectory, file);
      const page = await this.page(id, 0);
      await fsp.writeFile(cachePath, page.buffer, { mode: 0o600 });
      const now = new Date();
      await fsp.utimes(cachePath, now, now);
      const size = imageSize(page.buffer);
      await this.recordCoverCache(comic, {
        cover: {
          file,
          mime: page.mime,
          width: size ? size.width : 0,
          height: size ? size.height : 0,
          bytes: page.buffer.length
        }
      });
      full = { buffer: page.buffer, mime: page.mime };
    }
    if (!options.thumbnail) return full;
    return (await this.writeThumbnail(comic, full)) || full;
  }

  // Which version of a comic a cached image belongs to. The scan already
  // fingerprints each file's contents to detect moves, so that is the honest
  // answer. An index written before fingerprinting falls back to size and
  // mtime — the signal the cache used to rely on entirely — and upgrades
  // itself the first time a scan fingerprints the comic.
  cacheKey(comic) {
    const contents = comic.fingerprint
      ? comic.fingerprint
      : Number.isFinite(comic.mtimeMs)
        ? `sm1_${Number(comic.size) || 0}_${Math.round(comic.mtimeMs)}`
        : null;
    if (!contents) return null;
    // Choosing a picture does not change the comic's contents, so without this
    // a cached thumbnail of the previous cover would outlive the choice to
    // replace it. The artwork filename is fresh on every upload, so including
    // it invalidates the cache exactly when the picture changes and never
    // otherwise.
    const chosen = this.artwork.get(`comic:${comic.id}`, "cover");
    return chosen ? `${contents}+art:${chosen.file}` : contents;
  }

  // Generates this comic's cover and thumbnail unless the record already says
  // there is nothing left to do. A comic whose cover cannot be shrunk counts as
  // warm: the record says so, and re-attempting that decode is precisely the
  // cost this job exists to avoid paying twice.
  async warmCover(comic) {
    const entry = this.coverCache.get(comic.id, this.cacheKey(comic));
    if (entry && (entry.thumbnail || entry.thumbnailUnsupported)) return false;
    await this.cover(comic.id, { thumbnail: true });
    return true;
  }

  // Cover files are named for their comic, so a comic that is gone leaves files
  // nothing will ever ask for again. `force` because a file already deleted by
  // hand is the outcome being aimed at, not an error.
  // Reading orders are pruned by their own reconcile, so only comics are
  // considered here; an order's artwork outlives a scan by design.
  async pruneArtwork() {
    const subjects = this.comics.map((comic) => `comic:${comic.id}`);
    for (const order of this.readingOrders.exportData()?.orders || []) {
      subjects.push(`order:${order.id}`);
    }
    return (await this.artwork.reconcile(subjects)).length;
  }

  async pruneCoverCache() {
    const orphaned = await this.coverCache.reconcile(this.comics);
    for (const file of orphaned) {
      await fsp.rm(path.join(this.coverDirectory, file), { force: true });
    }
    return orphaned.length;
  }

  // Enabling pairing from a browser that is then locked out of the server is a
  // trap with no way back except a text editor over SSH, so the act of enabling
  // issues that browser its own token. The request is already origin-guarded,
  // which is what makes handing one out here safe.
  async enableDevicePairing(input = {}) {
    const { code } = await this.deviceTokens.createPairingCode();
    const paired = await this.deviceTokens.redeemPairingCode(code, {
      name: String(input.name || "").trim() || "This browser"
    });
    await this.deviceTokens.setEnabled(true);
    return { enabled: true, token: paired.token, device: paired.device };
  }

  // What a client asks after a scan instead of downloading the catalogue again.
  // `reset` means its cursor cannot be caught up from here and it should take
  // the full list, then adopt the sequence reported alongside.
  libraryChangesSince(cursor) {
    return this.changes.since(cursor);
  }

  coverCacheStatus() {
    return { cache: this.coverCache.stats(), warmup: this.coverWarmup.state() };
  }

  startCoverWarmup() {
    return this.coverWarmup.start();
  }

  cancelCoverWarmup() {
    return this.coverWarmup.cancel();
  }

  // Merges into the entry for this comic's current contents. `get` returns
  // nothing once the contents have changed, so a stale entry is never extended
  // — the record starts again with the cover that replaced it.
  async recordCoverCache(comic, patch) {
    const key = this.cacheKey(comic);
    if (!key) return;
    const existing = this.coverCache.get(comic.id, key) || {};
    await this.coverCache.record(comic.id, key, { ...existing, ...patch });
  }

  // The cached cover keeps the extension of the page it was taken from, which
  // is knowable only from inside the archive — so this used to try every
  // extension a page is allowed to have, and decide validity by comparing
  // mtimes. Both are now answered by the record: the exact filename, and the
  // fingerprint the file was built from.
  async cachedCover(comic) {
    const entry = this.coverCache.get(comic.id, this.cacheKey(comic));
    if (!entry || !entry.cover) return null;
    try {
      return {
        buffer: await fsp.readFile(path.join(this.coverDirectory, entry.cover.file)),
        mime: entry.cover.mime
      };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      // The record outlived the file. Regenerating is correct, and the write
      // replaces the record on its way through.
      return null;
    }
  }

  // Thumbnails are generated on first request rather than during a scan. A
  // library this size (tens of thousands of comics) would add an image decode
  // and encode per comic to every scan, for covers most users never scroll
  // past; generating on demand spreads that cost over the cards actually drawn
  // and keeps it off the scan entirely.
  async cachedThumbnail(comic) {
    const entry = this.coverCache.get(comic.id, this.cacheKey(comic));
    if (!entry || !entry.thumbnail) return null;
    try {
      return {
        buffer: await fsp.readFile(path.join(this.coverDirectory, entry.thumbnail.file)),
        mime: entry.thumbnail.mime,
        thumbnail: true
      };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return null;
    }
  }

  // Returns null when this cover cannot usefully be shrunk — it is already
  // smaller than a card, or it is in a format the pure-JavaScript decoder does
  // not read. The caller then serves the full-size cover. The comic is
  // remembered so the next request does not pay for the attempt again.
  async writeThumbnail(comic, full) {
    const known = this.coverCache.get(comic.id, this.cacheKey(comic));
    if (known && known.thumbnailUnsupported) return null;
    let thumbnail = null;
    try {
      thumbnail = createThumbnail(full.buffer);
    } catch (error) {
      if (!(error instanceof UnsupportedImageError)) {
        console.warn(
          `PanelShelf could not thumbnail the cover for ${comic.id}: ${error.message}`
        );
      }
      thumbnail = null;
    }
    if (!thumbnail) {
      await this.recordCoverCache(comic, { thumbnailUnsupported: true });
      return null;
    }
    const file = `${comic.id}.thumb${THUMBNAIL_EXTENSION}`;
    const cachePath = path.join(this.coverDirectory, file);
    // Two requests for the same uncached cover would otherwise have one
    // reading the file while the other is still writing it, which serves a
    // truncated JPEG. Rename is atomic within the directory.
    const pending = `${cachePath}.${process.pid}.tmp`;
    await fsp.writeFile(pending, thumbnail.buffer, { mode: 0o600 });
    const now = new Date();
    await fsp.utimes(pending, now, now);
    await fsp.rename(pending, cachePath);
    const size = imageSize(thumbnail.buffer);
    await this.recordCoverCache(comic, {
      thumbnail: {
        file,
        mime: thumbnail.mime,
        width: size ? size.width : 0,
        height: size ? size.height : 0,
        bytes: thumbnail.buffer.length
      }
    });
    return {
      buffer: thumbnail.buffer,
      mime: thumbnail.mime,
      thumbnail: true
    };
  }
}

async function browseFolders(candidate = "/") {
  const requested = path.resolve(candidate || "/");
  const rootPattern = /^\/volume(?:USB)?\d+(?:\/|$)/;
  if (requested !== "/" && !rootPattern.test(requested)) {
    throw jsonError(
      "Folder browsing is limited to mounted Synology volumes.",
      "INVALID_PATH"
    );
  }
  let resolved = requested;
  if (requested !== "/") {
    try {
      resolved = await fsp.realpath(requested);
    } catch (error) {
      throw jsonError("That folder is unavailable.", "FOLDER_UNAVAILABLE");
    }
    if (!rootPattern.test(resolved)) {
      throw jsonError("That folder is outside a mounted volume.", "INVALID_PATH");
    }
  }
  const entries = [];
  const handle = await fsp.opendir(resolved);
  for await (const entry of handle) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    if (
      resolved === "/" &&
      !/^volume(?:USB)?\d+$/.test(entry.name)
    ) {
      continue;
    }
    const child = path.join(resolved, entry.name);
    try {
      await fsp.access(child, fs.constants.R_OK | fs.constants.X_OK);
      entries.push({ name: entry.name, path: child, readable: true });
    } catch {
      entries.push({ name: entry.name, path: child, readable: false });
    }
  }
  entries.sort((left, right) => naturalCompare(left.name, right.name));
  const parent =
    resolved === "/"
      ? null
      : path.dirname(resolved) === "/"
        ? "/"
        : path.dirname(resolved);
  return { path: resolved, parent, entries };
}

module.exports = {
  CONFIG_SCHEMA_VERSION,
  ComicLibrary,
  browseFolders,
  inspectLibraryPath,
  inferFilenameMetadata,
  migrateConfig,
  normalizeLibraryPath,
  recentlyAdded
};
