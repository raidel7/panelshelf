"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");
const { comicId, jsonError, naturalCompare } = require("./util");
const { compareRanks, parseOrderPrefix } = require("./structure");

const ORDER_EXPORT_FORMAT = "panelshelf.reading-order";
const ORDER_EXPORT_VERSION = 1;
const ORDER_SCHEMA_VERSION = 1;
const COMIC_ID_PATTERN = /^[a-f0-9]{24}$/;
const MANUAL_ID_PATTERN = /^manual_[a-f0-9]{24}$/;

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

function uniqueIds(values, pattern = COMIC_ID_PATTERN) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value) => pattern.test(String(value))))];
}

function orderName(value, fallback = "Untitled reading order") {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return fallback;
  return normalized.slice(0, 120);
}

function orderDescription(value) {
  return typeof value === "string" ? value.trim().slice(0, 2000) : "";
}

function normalizeStoredOrder(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  if (!MANUAL_ID_PATTERN.test(String(candidate.id || ""))) return null;
  const now = new Date().toISOString();
  return {
    id: candidate.id,
    kind: "manual",
    name: orderName(candidate.name),
    description: orderDescription(candidate.description),
    comicIds: uniqueIds(candidate.comicIds),
    unplacedComicIds: uniqueIds(candidate.unplacedComicIds),
    sourceIds: uniqueIds(candidate.sourceIds, /^src_[a-f0-9]{24}$/),
    seenComicIds: uniqueIds(candidate.seenComicIds),
    createdAt:
      typeof candidate.createdAt === "string" ? candidate.createdAt : now,
    updatedAt:
      typeof candidate.updatedAt === "string" ? candidate.updatedAt : now
  };
}

function comparePathSegments(leftPath, rightPath) {
  const left = leftPath.split(/[\\/]/);
  const right = rightPath.split(/[\\/]/);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] === undefined) return -1;
    if (right[index] === undefined) return 1;
    const leftName =
      index === left.length - 1
        ? path.basename(left[index], path.extname(left[index]))
        : left[index];
    const rightName =
      index === right.length - 1
        ? path.basename(right[index], path.extname(right[index]))
        : right[index];
    const leftRank = parseOrderPrefix(leftName);
    const rightRank = parseOrderPrefix(rightName);
    if (leftRank && rightRank) {
      const rankComparison = compareRanks(leftRank, rightRank);
      if (rankComparison !== 0) return rankComparison;
      const labelComparison = naturalCompare(leftRank.label, rightRank.label);
      if (labelComparison !== 0) return labelComparison;
      continue;
    }
    if (leftRank && !rightRank) return -1;
    if (!leftRank && rightRank) return 1;
    const segmentComparison = naturalCompare(leftName, rightName);
    if (segmentComparison !== 0) return segmentComparison;
  }
  return 0;
}

function compareEmbeddedIssueNumbers(left, right) {
  if (path.dirname(left.relativePath) !== path.dirname(right.relativePath)) {
    return 0;
  }
  const leftNumber = parseOrderPrefix(String(left.metadata?.number || ""));
  const rightNumber = parseOrderPrefix(String(right.metadata?.number || ""));
  if (!leftNumber || !rightNumber) return 0;
  return compareRanks(leftNumber, rightNumber);
}

function automaticReadingOrders(comics, sources) {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const grouped = new Map();

  function add(groupKey, descriptor, comic) {
    const existing = grouped.get(groupKey) || {
      ...descriptor,
      comics: []
    };
    existing.comics.push(comic);
    grouped.set(groupKey, existing);
  }

  for (const comic of comics) {
    const source = sourceById.get(comic.sourceId) || {
      id: comic.sourceId,
      name: comic.sourceName || "Comics",
      profile: comic.sourceProfile || "unordered"
    };
    const profile = comic.sourceProfile || source.profile || "unordered";
    const directory =
      path.dirname(comic.relativePath) === "."
        ? ""
        : path.dirname(comic.relativePath);
    let branchKey = "";
    let name = source.name;
    let description =
      "Natural filename order within this source. PanelShelf will not cross into another source.";

    if (profile === "exact-reading-order") {
      branchKey = "__exact__";
      name = `${source.name} · Exact order`;
      description =
        "Explicit numeric positions define one continuous sequence, including transitions between folders.";
    } else if (profile === "folders-as-series") {
      branchKey = comic.folderSegments?.[0] || "__root__";
      name =
        comic.hierarchy?.[0]?.displayName ||
        comic.folderSegments?.[0] ||
        `${source.name} · Loose comics`;
      description =
        "Natural issue order inside this series, including its volume or arc folders.";
    } else if (profile === "hierarchical-timeline") {
      branchKey = directory || "__root__";
      name =
        comic.hierarchy?.at(-1)?.displayName ||
        (directory ? path.basename(directory) : `${source.name} · Loose comics`);
      description =
        "Safe branch-local order. PanelShelf stops before jumping to an unrelated timeline branch.";
    } else if (profile === "loose-comics") {
      branchKey = "__root__";
      name = source.name;
      description = "Natural filename order among the loose comics in this source.";
    } else {
      branchKey = directory || "__root__";
      name = directory ? path.basename(directory) : source.name;
      description =
        "Natural filename order in this folder. No broader chronology is inferred.";
    }

    const groupKey = `${source.id}:${profile}:${branchKey}`;
    add(
      groupKey,
      {
        id: `auto_${comicId(`order:${groupKey}`)}`,
        kind: "automatic",
        editable: false,
        profile,
        name,
        description,
        sourceIds: source.id ? [source.id] : []
      },
      comic
    );
  }

  return [...grouped.values()]
    .map(({ comics: groupedComics, ...order }) => {
      groupedComics.sort((left, right) =>
        compareEmbeddedIssueNumbers(left, right) ||
        comparePathSegments(left.relativePath, right.relativePath)
      );
      const comicIds = groupedComics.map((comic) => comic.id);
      return {
        ...order,
        comicIds,
        unplacedComicIds: [],
        missingComicIds: [],
        coverComicId: comicIds[0] || null,
        itemCount: comicIds.length,
        updatedAt: null
      };
    })
    .sort(
      (left, right) =>
        naturalCompare(left.name, right.name) ||
        naturalCompare(left.id, right.id)
    );
}

class ReadingOrderStore {
  constructor(dataDirectory) {
    this.filePath = path.join(dataDirectory, "reading-orders.json");
    this.orders = [];
  }

  async initialize(comics = []) {
    const stored = await readJson(this.filePath, {
      schemaVersion: ORDER_SCHEMA_VERSION,
      orders: []
    });
    this.orders = Array.isArray(stored.orders)
      ? stored.orders.map(normalizeStoredOrder).filter(Boolean)
      : [];
    await this.reconcile(comics);
  }

  async persist() {
    await atomicWriteJson(this.filePath, {
      schemaVersion: ORDER_SCHEMA_VERSION,
      orders: this.orders
    });
  }

  exportData() {
    return {
      schemaVersion: ORDER_SCHEMA_VERSION,
      orders: structuredClone(this.orders)
    };
  }

  async restoreData(value) {
    if (!value || typeof value !== "object" || !Array.isArray(value.orders)) {
      throw jsonError("Backup reading orders are invalid.", "INVALID_BACKUP");
    }
    if (value.orders.length > 10_000) {
      throw jsonError("Backup contains too many reading orders.", "INVALID_BACKUP");
    }
    const restored = value.orders.map(normalizeStoredOrder);
    if (restored.some((order) => !order)) {
      throw jsonError("Backup contains an invalid reading order.", "INVALID_BACKUP");
    }
    this.orders = restored;
    await this.persist();
  }

  publicOrder(order, comics) {
    const currentIds = new Set(comics.map((comic) => comic.id));
    const missingComicIds = order.comicIds.filter((id) => !currentIds.has(id));
    const coverComicId =
      order.comicIds.find((id) => currentIds.has(id)) ||
      order.unplacedComicIds.find((id) => currentIds.has(id)) ||
      null;
    return {
      id: order.id,
      kind: "manual",
      editable: true,
      profile: "manual",
      name: order.name,
      description: order.description,
      comicIds: [...order.comicIds],
      unplacedComicIds: [...order.unplacedComicIds],
      missingComicIds,
      sourceIds: [...order.sourceIds],
      coverComicId,
      itemCount: order.comicIds.length,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt
    };
  }

  list(comics, sources) {
    return {
      schemaVersion: ORDER_SCHEMA_VERSION,
      automatic: automaticReadingOrders(comics, sources),
      manual: this.orders.map((order) => this.publicOrder(order, comics))
    };
  }

  get(id) {
    const order = this.orders.find((candidate) => candidate.id === id);
    if (!order) throw jsonError("Reading order not found.", "NOT_FOUND");
    return order;
  }

  async create(input, comics) {
    const comicById = new Map(comics.map((comic) => [comic.id, comic]));
    const comicIds = uniqueIds(input?.comicIds).filter((id) => comicById.has(id));
    const sourceIds = [
      ...new Set(
        comicIds
          .map((id) => comicById.get(id)?.sourceId)
          .filter((id) => /^src_[a-f0-9]{24}$/.test(String(id)))
      )
    ];
    const now = new Date().toISOString();
    const id = `manual_${comicId(`${now}:${Math.random()}:${input?.name || ""}`)}`;
    const seenComicIds = comics
      .filter((comic) => sourceIds.includes(comic.sourceId))
      .map((comic) => comic.id);
    const order = {
      id,
      kind: "manual",
      name: orderName(input?.name, "New reading order"),
      description: orderDescription(input?.description),
      comicIds,
      unplacedComicIds: [],
      sourceIds,
      seenComicIds,
      createdAt: now,
      updatedAt: now
    };
    this.orders.push(order);
    await this.persist();
    return this.publicOrder(order, comics);
  }

  async update(id, input, comics) {
    const order = this.get(id);
    const comicById = new Map(comics.map((comic) => [comic.id, comic]));
    const allowedMissing = new Set(order.comicIds);
    const comicIds = uniqueIds(input?.comicIds).filter(
      (comicIdValue) =>
        comicById.has(comicIdValue) || allowedMissing.has(comicIdValue)
    );
    const requestedUnplaced = Array.isArray(input?.unplacedComicIds)
      ? uniqueIds(input.unplacedComicIds)
      : order.unplacedComicIds;
    const orderedIds = new Set(comicIds);
    const unplacedComicIds = requestedUnplaced.filter(
      (comicIdValue) =>
        comicById.has(comicIdValue) && !orderedIds.has(comicIdValue)
    );
    const sourceIds = [
      ...new Set(
        [...comicIds, ...unplacedComicIds]
          .map((comicIdValue) => comicById.get(comicIdValue)?.sourceId)
          .filter((sourceId) => /^src_[a-f0-9]{24}$/.test(String(sourceId)))
      )
    ];
    order.name = orderName(input?.name, order.name);
    order.description =
      input && "description" in input
        ? orderDescription(input.description)
        : order.description;
    order.comicIds = comicIds;
    order.unplacedComicIds = unplacedComicIds;
    order.sourceIds = sourceIds.length > 0 ? sourceIds : order.sourceIds;
    order.seenComicIds = [
      ...new Set([
        ...order.seenComicIds,
        ...comics
          .filter((comic) => order.sourceIds.includes(comic.sourceId))
          .map((comic) => comic.id)
      ])
    ];
    order.updatedAt = new Date().toISOString();
    await this.persist();
    return this.publicOrder(order, comics);
  }

  // A reading order is worth moving between servers — it is the part of a
  // library that took a person's judgement rather than a scan's. Ids cannot
  // carry it: an id is a hash of the file's path on *this* server, so an export
  // of ids alone would import as an empty order anywhere else. The document
  // therefore says what each comic *is*, and the import works out which local
  // file that turned out to be.
  exportOrder(id, comics) {
    const order = this.get(id);
    const comicById = new Map(comics.map((comic) => [comic.id, comic]));
    return {
      format: ORDER_EXPORT_FORMAT,
      formatVersion: ORDER_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      name: order.name,
      description: order.description,
      entries: order.comicIds.map((comicIdValue, index) => {
        const comic = comicById.get(comicIdValue);
        return {
          position: index + 1,
          comicId: comicIdValue,
          title: comic?.title || "",
          series: comic?.series || "",
          relativePath: comic?.relativePath || "",
          fingerprint: comic?.fingerprint || ""
        };
      })
    };
  }

  // Contents first, then where it sat, then what it was called. Each step is
  // weaker than the one before, which is why the report says which of them
  // answered — a title match is a guess worth telling someone about.
  async importOrder(document, comics) {
    if (
      !document ||
      typeof document !== "object" ||
      document.format !== ORDER_EXPORT_FORMAT ||
      !Array.isArray(document.entries)
    ) {
      throw jsonError(
        "That file is not a PanelShelf reading order.",
        "INVALID_ORDER_DOCUMENT"
      );
    }

    const byFingerprint = new Map();
    const byPath = new Map();
    const byTitle = new Map();
    // Lists, not single values: a library legitimately holds several comics with
    // the same contents or the same title, and a map would keep whichever
    // happened to be scanned last — matching the first entry to the wrong copy.
    const push = (map, key, comic) => {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(comic);
    };
    for (const comic of comics) {
      if (comic.fingerprint) push(byFingerprint, comic.fingerprint, comic);
      if (comic.relativePath) byPath.set(comic.relativePath, comic);
      push(byTitle, `${comic.series || ""}\u0000${comic.title || ""}`.toLowerCase(), comic);
    }

    const matchedBy = { fingerprint: 0, relativePath: 0, title: 0 };
    const missing = [];
    const moved = [];
    const comicIds = [];

    // Each local comic can answer for one entry only. Two files with identical
    // bytes share a fingerprint — a comic library is full of those, the same
    // issue filed twice — and without this both entries match the same comic,
    // the order comes back a entry shorter, and the report cheerfully claims
    // two matches. A taken comic makes the entry try its next-weakest signal.
    const claimed = new Set();
    const unclaimed = (comic) => (comic && !claimed.has(comic.id) ? comic : null);
    const firstFree = (list) => (list || []).find((comic) => !claimed.has(comic.id)) || null;

    for (const entry of document.entries) {
      if (!entry || typeof entry !== "object") continue;
      let comic = entry.fingerprint ? firstFree(byFingerprint.get(entry.fingerprint)) : null;
      let how = comic ? "fingerprint" : null;
      if (!comic && entry.relativePath) {
        comic = unclaimed(byPath.get(entry.relativePath));
        how = comic ? "relativePath" : null;
      }
      if (!comic && entry.title) {
        const key = `${entry.series || ""}\u0000${entry.title}`.toLowerCase();
        comic = firstFree(byTitle.get(key));
        how = comic ? "title" : null;
      }
      if (!comic) {
        missing.push({
          position: entry.position ?? null,
          title: entry.title || "",
          series: entry.series || "",
          relativePath: entry.relativePath || ""
        });
        continue;
      }
      if (
        how === "fingerprint" &&
        entry.relativePath &&
        comic.relativePath &&
        entry.relativePath !== comic.relativePath
      ) {
        moved.push({ was: entry.relativePath, now: comic.relativePath });
      }
      matchedBy[how] += 1;
      claimed.add(comic.id);
      comicIds.push(comic.id);
    }

    const order = await this.create(
      { name: document.name, description: document.description, comicIds },
      comics
    );
    return { order, report: { matched: comicIds.length, matchedBy, missing, moved } };
  }

  // What is wrong with an order, without changing it. Missing entries are
  // comics the order still lists that the library no longer has. Duplicates
  // cannot be made through create or update — both dedupe — so one here means a
  // restored backup or a hand-edited file, which is exactly when someone wants
  // to be told rather than to have it quietly corrected underneath them.
  repairReport(id, comics) {
    const order = this.get(id);
    const known = new Set(comics.map((comic) => comic.id));
    const seen = new Set();
    const missing = [];
    const duplicated = [];
    for (const comicIdValue of order.comicIds) {
      if (!known.has(comicIdValue)) {
        if (!missing.includes(comicIdValue)) missing.push(comicIdValue);
      }
      if (seen.has(comicIdValue)) {
        if (!duplicated.includes(comicIdValue)) duplicated.push(comicIdValue);
      }
      seen.add(comicIdValue);
    }
    return {
      id: order.id,
      name: order.name,
      missing,
      duplicated,
      healthy: missing.length === 0 && duplicated.length === 0
    };
  }

  async repair(id, comics) {
    const order = this.get(id);
    const known = new Set(comics.map((comic) => comic.id));
    const kept = [];
    const seen = new Set();
    for (const comicIdValue of order.comicIds) {
      if (!known.has(comicIdValue) || seen.has(comicIdValue)) continue;
      seen.add(comicIdValue);
      kept.push(comicIdValue);
    }
    order.comicIds = kept;
    order.updatedAt = new Date().toISOString();
    await this.persist();
    return this.publicOrder(order, comics);
  }

  async duplicate(id, comics) {
    const original = this.get(id);
    return this.create(
      {
        name: `${original.name} copy`,
        description: original.description,
        comicIds: original.comicIds
      },
      comics
    );
  }

  async delete(id) {
    this.get(id);
    this.orders = this.orders.filter((order) => order.id !== id);
    await this.persist();
    return { deleted: true, id };
  }

  async reconcile(comics) {
    const currentIds = new Set(comics.map((comic) => comic.id));
    let changed = false;
    for (const order of this.orders) {
      const ordered = new Set(order.comicIds);
      const seen = new Set(order.seenComicIds);
      const scopedIds = comics
        .filter((comic) => order.sourceIds.includes(comic.sourceId))
        .map((comic) => comic.id);
      const unplaced = new Set(
        order.unplacedComicIds.filter(
          (id) => currentIds.has(id) && !ordered.has(id)
        )
      );
      for (const id of scopedIds) {
        if (!seen.has(id) && !ordered.has(id)) unplaced.add(id);
        seen.add(id);
      }
      const nextUnplaced = [...unplaced];
      const nextSeen = [...seen];
      if (
        JSON.stringify(nextUnplaced) !== JSON.stringify(order.unplacedComicIds) ||
        JSON.stringify(nextSeen) !== JSON.stringify(order.seenComicIds)
      ) {
        order.unplacedComicIds = nextUnplaced;
        order.seenComicIds = nextSeen;
        order.updatedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) await this.persist();
  }
}

module.exports = {
  ORDER_SCHEMA_VERSION,
  ReadingOrderStore,
  automaticReadingOrders,
  comparePathSegments
};
