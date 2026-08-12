"use strict";

const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");

const IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".webp"
]);

function comicId(filePath) {
  return crypto.createHash("sha256").update(filePath).digest("hex").slice(0, 24);
}

async function fileFingerprint(filePath, knownSize) {
  const size =
    Number.isFinite(knownSize) && knownSize >= 0
      ? knownSize
      : (await fsp.stat(filePath)).size;
  const sampleSize = 64 * 1024;
  const firstLength = Math.min(size, sampleSize);
  const lastLength = size > sampleSize ? Math.min(size - firstLength, sampleSize) : 0;
  const handle = await fsp.open(filePath, "r");
  try {
    const first = Buffer.alloc(firstLength);
    if (firstLength > 0) await handle.read(first, 0, firstLength, 0);
    const last = Buffer.alloc(lastLength);
    if (lastLength > 0) {
      await handle.read(last, 0, lastLength, Math.max(0, size - lastLength));
    }
    return `fp1_${crypto
      .createHash("sha256")
      .update("PanelShelf archive fingerprint v1\0")
      .update(String(size))
      .update("\0")
      .update(first)
      .update(last)
      .digest("hex")}`;
  } finally {
    await handle.close();
  }
}

function isImage(name) {
  return IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function naturalCompare(left, right) {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base"
  });
}

function cleanTitle(filePath) {
  return path.basename(filePath, path.extname(filePath))
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mimeForName(name) {
  switch (path.extname(name).toLowerCase()) {
    case ".avif":
      return "image/avif";
    case ".bmp":
      return "image/bmp";
    case ".gif":
      return "image/gif";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".jpeg":
    case ".jpg":
    default:
      return "image/jpeg";
  }
}

function jsonError(message, code = "ERROR", details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

module.exports = {
  IMAGE_EXTENSIONS,
  cleanTitle,
  comicId,
  fileFingerprint,
  isImage,
  jsonError,
  mimeForName,
  naturalCompare
};
