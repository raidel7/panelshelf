"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");
const { jsonError } = require("./util");

const COMIC_ID = /^[a-f0-9]{24}$/;
const TEXT_LIMITS = {
  title: 300,
  series: 300,
  number: 60,
  publisher: 200,
  format: 100,
  storyArc: 300,
  summary: 10_000
};
const LIST_FIELDS = ["genres", "tags"];
const CREATOR_FIELDS = ["writers", "pencillers"];

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

async function atomicWriteJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600
  });
  await fsp.rename(temporary, filePath);
}

function cleanText(value, maximum) {
  if (value === null || value === undefined) return null;
  const result = String(value).trim();
  if (!result) return null;
  if (result.length > maximum) {
    throw jsonError("A metadata value is too long.", "INVALID_METADATA_OVERRIDE");
  }
  return result;
}

function cleanList(value) {
  const input = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(
    input.map((item) => String(item).trim()).filter(Boolean).map((item) => {
      if (item.length > 200) {
        throw jsonError("A metadata list value is too long.", "INVALID_METADATA_OVERRIDE");
      }
      return item;
    })
  )].slice(0, 100);
}

function normalizeMetadata(value) {
  if (!plainObject(value)) {
    throw jsonError("Metadata overrides must be an object.", "INVALID_METADATA_OVERRIDE");
  }
  const metadata = { source: "manual" };
  for (const [field, maximum] of Object.entries(TEXT_LIMITS)) {
    const cleaned = cleanText(value[field], maximum);
    if (cleaned !== null) metadata[field] = cleaned;
  }
  for (const field of ["year", "volume"]) {
    if (value[field] === "" || value[field] === null || value[field] === undefined) continue;
    const number = Number(value[field]);
    const valid = Number.isSafeInteger(number) && number >= 0 &&
      (field !== "year" || (number >= 1800 && number <= 2200));
    if (!valid) {
      throw jsonError(`Choose a valid ${field}.`, "INVALID_METADATA_OVERRIDE");
    }
    metadata[field] = number;
  }
  for (const field of LIST_FIELDS) {
    const list = cleanList(value[field]);
    if (list.length > 0) metadata[field] = list;
  }
  const creatorsInput = plainObject(value.creators) ? value.creators : {};
  const creators = {};
  for (const field of CREATOR_FIELDS) {
    const list = cleanList(creatorsInput[field]);
    if (list.length > 0) creators[field] = list;
  }
  if (Object.keys(creators).length > 0) metadata.creators = creators;
  if (Object.keys(metadata).length === 1) return null;
  return metadata;
}

function normalizeRecords(value) {
  if (!plainObject(value)) return {};
  const records = {};
  for (const [comicId, candidate] of Object.entries(value)) {
    if (!COMIC_ID.test(comicId) || !plainObject(candidate)) continue;
    try {
      const metadata = normalizeMetadata(candidate.metadata || candidate);
      if (!metadata) continue;
      records[comicId] = {
        metadata,
        updatedAt:
          typeof candidate.updatedAt === "string"
            ? candidate.updatedAt.slice(0, 40)
            : null
      };
    } catch {
      // Ignore an invalid record while restoring; valid records remain usable.
    }
  }
  return records;
}

class MetadataOverrideStore {
  constructor(dataDirectory) {
    this.filePath = path.join(dataDirectory, "metadata-overrides.json");
    this.records = {};
  }

  async initialize() {
    try {
      this.records = normalizeRecords(
        JSON.parse(await fsp.readFile(this.filePath, "utf8"))
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.records = {};
    }
  }

  get(comicId) {
    return this.records[comicId] ? structuredClone(this.records[comicId]) : null;
  }

  async save(comicId, input) {
    if (!COMIC_ID.test(comicId)) {
      throw jsonError("Comic not found.", "NOT_FOUND");
    }
    const metadata = normalizeMetadata(input);
    if (!metadata) delete this.records[comicId];
    else {
      this.records[comicId] = {
        metadata,
        updatedAt: new Date().toISOString()
      };
    }
    await atomicWriteJson(this.filePath, this.records);
    return this.get(comicId);
  }

  async remove(comicId) {
    delete this.records[comicId];
    await atomicWriteJson(this.filePath, this.records);
  }

  exportData() {
    return structuredClone(this.records);
  }

  async restoreData(value) {
    this.records = normalizeRecords(value);
    await atomicWriteJson(this.filePath, this.records);
  }
}

module.exports = { MetadataOverrideStore, normalizeMetadata, normalizeRecords };
