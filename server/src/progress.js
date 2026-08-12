"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");
const { jsonError } = require("./util");

const COMIC_ID = /^[a-f0-9]{24}$/;
const MAX_TIMESTAMP = 40;
const MAX_ORDER_ID = 80;

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function wholeNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.floor(number);
}

function text(value, maximum) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maximum);
}

function normalizeRecord(value) {
  if (!plainObject(value)) {
    throw jsonError("Progress must be an object.", "INVALID_PROGRESS");
  }
  return {
    pageIndex: wholeNumber(value.pageIndex),
    pageCount: wholeNumber(value.pageCount),
    completed: Boolean(value.completed),
    skipped: Boolean(value.skipped),
    lastReadAt: text(value.lastReadAt, MAX_TIMESTAMP),
    orderId: text(value.orderId, MAX_ORDER_ID)
  };
}

function normalizeRecords(value) {
  if (!plainObject(value)) return {};
  const records = {};
  for (const [comicId, candidate] of Object.entries(value)) {
    if (!COMIC_ID.test(comicId)) continue;
    try {
      records[comicId] = normalizeRecord(candidate);
    } catch {
      // Skip an unusable record rather than failing a whole restore.
    }
  }
  return records;
}

module.exports = { COMIC_ID, normalizeRecord, normalizeRecords, plainObject };
