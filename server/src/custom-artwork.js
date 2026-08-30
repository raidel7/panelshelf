"use strict";

const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { jsonError } = require("./util");
const { imageSize } = require("./thumbnail");

// Artwork the owner chose, rather than artwork taken from a comic.
//
// A reading order borrows its cover from the first comic in it, which is a
// reasonable guess and often the wrong one: a crossover's cover is rarely the
// first issue of whichever series happens to sort first. A storyline is, by the
// roadmap's own definition, a named reading order with a cover — so this is what
// makes one.
//
// Lives in the package's own data directory and never beside the comics. The
// library is read-only to PanelShelf and stays that way; nothing here writes
// into a folder the owner filled.
//
// Kept as a sidecar rather than on the comic or order record, so a scan that
// rebuilds the index cannot take the artwork with it. The release gate says a
// full rebuild must not erase custom artwork, and the cheapest way to hold that
// is to keep artwork somewhere a rebuild does not touch.

const MAX_ARTWORK_BYTES = 8 * 1024 * 1024;
const KINDS = new Set(["cover", "banner"]);

async function atomicWriteJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600
  });
  await fsp.rename(temporary, filePath);
}

// The content decides what this is, not the caller's Content-Type. An upload
// that says PNG and is not one would otherwise be served back as one.
function detectImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return null;
  const size = imageSize(buffer);
  if (!size || !size.width || !size.height) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return { mime: "image/jpeg", extension: ".jpg", ...size };
  }
  if (buffer[0] === 0x89 && buffer[1] === 0x50) {
    return { mime: "image/png", extension: ".png", ...size };
  }
  return null;
}

function entryKey(subject, kind) {
  return `${subject}|${kind}`;
}

class CustomArtworkStore {
  constructor(dataDirectory) {
    this.filePath = path.join(dataDirectory, "artwork.json");
    this.directory = path.join(dataDirectory, "artwork");
    this.entries = new Map();
    this.writeQueue = Promise.resolve();
  }

  async initialize() {
    await fsp.mkdir(this.directory, { recursive: true });
    let raw;
    try {
      raw = await fsp.readFile(this.filePath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      const source = parsed?.entries;
      if (source && typeof source === "object") {
        for (const [key, value] of Object.entries(source)) {
          if (!value || typeof value.file !== "string") continue;
          this.entries.set(key, {
            file: value.file,
            mime: typeof value.mime === "string" ? value.mime : "image/png",
            width: Number(value.width) || 0,
            height: Number(value.height) || 0,
            bytes: Number(value.bytes) || 0
          });
        }
      }
    } catch {
      // The files are still on disk, but without the index nothing knows what
      // they belong to. Resetting loses the association, not the library — and
      // refusing to start would lose the whole server over a cover.
      const corruptPath = `${this.filePath}.corrupt-${Date.now()}`;
      try {
        await fsp.rename(this.filePath, corruptPath);
        console.warn(
          `Artwork index ${this.filePath} is corrupt and was reset. ` +
            `The original was preserved at ${corruptPath}.`
        );
      } catch {
        console.warn(`Artwork index ${this.filePath} is corrupt and was reset.`);
      }
      this.entries = new Map();
    }
  }

  get(subject, kind) {
    return this.entries.get(entryKey(subject, kind)) || null;
  }

  pathFor(entry) {
    return path.join(this.directory, entry.file);
  }

  async save(subject, kind, buffer, _declaredMime) {
    if (!KINDS.has(kind)) {
      throw jsonError("Artwork is either a cover or a banner.", "INVALID_ARTWORK");
    }
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw jsonError("That upload had no image in it.", "INVALID_ARTWORK");
    }
    if (buffer.length > MAX_ARTWORK_BYTES) {
      throw jsonError(
        `That image is too large. The limit is ${Math.round(MAX_ARTWORK_BYTES / 1024 / 1024)} MB.`,
        "INVALID_ARTWORK"
      );
    }
    const image = detectImage(buffer);
    if (!image) {
      throw jsonError("That file is not a PNG or JPEG image.", "INVALID_ARTWORK");
    }

    // A fresh filename every time, so a browser holding the old URL fetches the
    // new picture instead of the one it already has.
    const file = `${crypto.randomUUID()}${image.extension}`;
    await fsp.writeFile(path.join(this.directory, file), buffer, { mode: 0o600 });

    const previous = this.get(subject, kind);
    const entry = {
      file,
      mime: image.mime,
      width: image.width,
      height: image.height,
      bytes: buffer.length
    };
    this.entries.set(entryKey(subject, kind), entry);
    await this.persist();
    // Removed after the index no longer points at it: a crash between the two
    // leaves an unreferenced file, which is better than an entry with no file.
    if (previous) await this.removeFile(previous.file);
    return entry;
  }

  async remove(subject, kind) {
    const key = entryKey(subject, kind);
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    await this.persist();
    await this.removeFile(entry.file);
    return true;
  }

  async removeFile(file) {
    await fsp.rm(path.join(this.directory, file), { force: true });
  }

  // Drops artwork belonging to comics or orders that no longer exist, and
  // reports the files that leaves behind. Called where the other derived stores
  // are reconciled, for the same reason.
  async reconcile(subjects) {
    const live = new Set(subjects);
    const orphaned = [];
    for (const [key, entry] of this.entries) {
      if (live.has(key.slice(0, key.lastIndexOf("|")))) continue;
      orphaned.push(entry.file);
      this.entries.delete(key);
    }
    if (orphaned.length === 0) return [];
    await this.persist();
    for (const file of orphaned) await this.removeFile(file);
    return orphaned;
  }

  list() {
    return [...this.entries.entries()].map(([key, entry]) => {
      const separator = key.lastIndexOf("|");
      return {
        subject: key.slice(0, separator),
        kind: key.slice(separator + 1),
        ...entry
      };
    });
  }

  settled() {
    return this.writeQueue;
  }

  persist() {
    const snapshot = { entries: Object.fromEntries(this.entries) };
    const next = this.writeQueue
      .catch(() => {})
      .then(() => atomicWriteJson(this.filePath, snapshot));
    this.writeQueue = next.catch(() => {});
    return next;
  }
}

module.exports = { CustomArtworkStore, MAX_ARTWORK_BYTES };
