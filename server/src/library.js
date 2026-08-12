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
  cleanTitle,
  comicId,
  fileFingerprint,
  jsonError,
  mimeForName,
  naturalCompare
} = require("./util");
const { ReadingOrderStore } = require("./reading-orders");
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
    this.scanState = emptyScanState();
    this.readingOrders = new ReadingOrderStore(dataDirectory);
    this.enrichment = new MetadataEnrichmentStore(dataDirectory, {
      fetchImpl: options.fetchImpl
    });
    this.metadataOverrides = new MetadataOverrideStore(dataDirectory);
    this.progress = new ProgressStore(dataDirectory);
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
    await this.progress.initialize();
    const storedConfig = await readJson(this.configPath, defaultConfig());
    const migratedConfig = migrateConfig(storedConfig);
    this.config = migratedConfig.config;
    if (migratedConfig.migrated) {
      await atomicWriteJson(this.configPath, this.config);
    }
    const saved = await readJson(this.indexPath, { comics: [] });
    this.setComics(Array.isArray(saved.comics) ? saved.comics : []);
    await this.readingOrders.initialize(this.comics);
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
    return this.getConfig();
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
        browser: normalizeBrowserState(browserState)
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
      metadataOverrides: this.metadataOverrides.exportData()
    };
    try {
      this.config = backup.data.config;
      await atomicWriteJson(this.configPath, this.config);
      await this.readingOrders.restoreData(backup.data.readingOrders);
      await this.enrichment.restoreMatches(backup.data.metadataMatches);
      await this.metadataOverrides.restoreData(backup.data.metadataOverrides);
    } catch (error) {
      this.config = previous.config;
      await atomicWriteJson(this.configPath, this.config).catch(() => {});
      await this.readingOrders.restoreData(previous.readingOrders).catch(() => {});
      await this.enrichment.restoreMatches(previous.metadataMatches).catch(() => {});
      await this.metadataOverrides.restoreData(previous.metadataOverrides).catch(() => {});
      throw error;
    }
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
    return this.readingOrders.list(this.comics, this.config.sources);
  }

  async createReadingOrder(input) {
    return this.readingOrders.create(input, this.comics);
  }

  async updateReadingOrder(id, input) {
    return this.readingOrders.update(id, input, this.comics);
  }

  async duplicateReadingOrder(id) {
    return this.readingOrders.duplicate(id, this.comics);
  }

  async deleteReadingOrder(id) {
    return this.readingOrders.delete(id);
  }

  listProgress() {
    const known = new Set(this.comics.map((comic) => comic.id));
    const records = this.progress.exportData();
    for (const comicId of Object.keys(records)) {
      if (!known.has(comicId)) delete records[comicId];
    }
    return records;
  }

  getProgress(comicId) {
    return this.progress.get(comicId);
  }

  async saveProgress(comicId, input) {
    return this.progress.save(comicId, input);
  }

  async removeProgress(comicId) {
    await this.progress.remove(comicId);
  }

  async mergeProgress(input) {
    return this.progress.merge(input);
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

    const comicBelongsToSource = (comic, source) =>
      comic.sourceId === source.id ||
      (!comic.sourceId && comic.libraryRoot === source.path);

    if (action === "retry") {
      for (const comic of this.comics) discovered.set(comic.id, comic);
    } else {
      for (const comic of this.comics) {
        const selected = this.config.sources.some(
          (source) =>
            selectedSourceIds.has(source.id) &&
            comicBelongsToSource(comic, source)
        );
        if (!selected) discovered.set(comic.id, comic);
      }
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
            if (inspection.extensionMismatch) {
              addWarning(filePath, {
                code: "ARCHIVE_EXTENSION_MISMATCH",
                message:
                  `The file extension indicates ${archiveType(filePath).toUpperCase()}, ` +
                  `but its contents are ${detectedFormat.toUpperCase()}. ` +
                  "PanelShelf opened it using the detected format."
              });
            }
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
      this.setComics([...discovered.values()]);
      this.scanState.foundComics = this.comics.length;
      await this.readingOrders.reconcile(this.comics);
      await this.enrichment.reconcile(this.comics);
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

  async cover(id) {
    const comic = this.getComic(id);
    const pages = await this.pagesForComic(comic);
    if (pages.length === 0) {
      throw jsonError("No image pages were found in this comic.", "NO_PAGES");
    }
    const extension = path.extname(pages[0].name).toLowerCase() || ".jpg";
    const cachePath = path.join(this.coverDirectory, `${comic.id}${extension}`);
    try {
      const cached = await fsp.stat(cachePath);
      if (cached.mtimeMs >= comic.mtimeMs) {
        return {
          buffer: await fsp.readFile(cachePath),
          mime: mimeForName(cachePath)
        };
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const page = await this.page(id, 0);
    await fsp.writeFile(cachePath, page.buffer, { mode: 0o600 });
    const now = new Date();
    await fsp.utimes(cachePath, now, now);
    return { buffer: page.buffer, mime: page.mime };
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
  normalizeLibraryPath
};
