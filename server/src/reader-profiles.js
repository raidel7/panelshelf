"use strict";

const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { jsonError } = require("./util");

// Who is reading, as far as this server is concerned — and no further.
//
// A reader profile is a namespace, not an account. It carries no password, it
// grants nothing, and naming one is not a claim about who you are: pairing is
// the only thing standing between the library and a stranger, and that has not
// changed. What a profile does is keep two people's shelves apart, the way Plex
// keeps two people's watch state apart under one library.
//
// Everything else in the data directory stays shared on purpose. Sources,
// metadata, reading orders, storylines, artwork and the index describe the
// library, which is one library in whatever arrangement the drive already has.
// Only reading progress and skipped branches describe the reader.
//
// Note for anyone reading the rest of this project: an *organization profile*
// elsewhere in PanelShelf means how a source is arranged on disk. The two have
// nothing to do with each other, which is why nothing here is called just a
// "profile".

// A household, not a service. High enough that nobody bumps it, low enough that
// a looping client cannot turn this file into a directory of junk.
const MAX_PROFILES = 20;
const MAX_NAME = 60;
const MAX_ID = 40;

// Always present, never deleted, and the answer whenever a request names
// nothing. This is what keeps upgrading from 0.4.18 silent: every record that
// existed before reader profiles did belongs to it.
const DEFAULT_READER_ID = "default";
const DEFAULT_READER_NAME = "Default";

function readerName(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_NAME);
}

// The id is derived from the name so that a person typing "Ana" into an OPDS
// reader's username box lands somewhere predictable. A name that leaves nothing
// behind — punctuation, or a script this transliterates nothing of — still gets
// a profile; it just gets an opaque id, and resolves by its name instead.
function slugFrom(name) {
  const slug = String(name)
    // Accents fold rather than break: "Ana María" is "ana-maria", not
    // "ana-mar-a". NFD splits a letter from its mark so the mark alone can go.
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_ID)
    .replace(/-+$/g, "");
  return slug || `reader-${crypto.randomBytes(3).toString("hex")}`;
}

function readerId(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.length > MAX_ID) return null;
  return /^[a-z0-9][a-z0-9-]*$/.test(trimmed) ? trimmed : null;
}

function profileFrom(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = readerId(value.id);
  const name = readerName(value.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : null
  };
}

async function atomicWriteJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600
  });
  await fsp.rename(temporary, filePath);
}

class ReaderProfileStore {
  constructor(dataDirectory) {
    this.filePath = path.join(dataDirectory, "readers.json");
    // Insertion-ordered, and the default is inserted first by `reset` so it
    // stays at the top of every list a client draws.
    this.profiles = new Map();
    this.writeQueue = Promise.resolve();
    this.reset();
  }

  reset() {
    this.profiles = new Map([
      [
        DEFAULT_READER_ID,
        { id: DEFAULT_READER_ID, name: DEFAULT_READER_NAME, createdAt: null }
      ]
    ]);
  }

  async initialize() {
    let raw;
    try {
      raw = await fsp.readFile(this.filePath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      // No file is the normal state for a server nobody has split yet, and it
      // is not the same as an empty one: the default profile exists either way.
      return;
    }
    try {
      this.load(JSON.parse(raw));
    } catch {
      // Soft data, like progress and skips: a damaged file must not stop the
      // server. What it costs is the names, not the reading — the records
      // themselves are keyed by id in their own files and are still there, so a
      // profile whose name is lost reappears the moment a client names it.
      const corruptPath = `${this.filePath}.corrupt-${Date.now()}`;
      try {
        await fsp.rename(this.filePath, corruptPath);
        console.warn(
          `Reader profile file ${this.filePath} is corrupt and was reset. ` +
            `The original was preserved at ${corruptPath}.`
        );
      } catch {
        console.warn(
          `Reader profile file ${this.filePath} is corrupt and was reset.`
        );
      }
      this.reset();
    }
  }

  load(parsed) {
    this.reset();
    const source = Array.isArray(parsed?.profiles) ? parsed.profiles : [];
    for (const value of source) {
      const profile = profileFrom(value);
      if (!profile) continue;
      // The default is already seeded, so a stored copy of it is a rename
      // rather than a duplicate.
      if (this.profiles.size >= MAX_PROFILES && !this.profiles.has(profile.id)) {
        continue;
      }
      this.profiles.set(profile.id, profile);
    }
  }

  persist() {
    const snapshot = { profiles: [...this.profiles.values()] };
    const next = this.writeQueue
      .catch(() => {})
      .then(() => atomicWriteJson(this.filePath, snapshot));
    this.writeQueue = next.catch(() => {});
    return next;
  }

  list() {
    return [...this.profiles.values()].map((profile) => ({
      ...profile,
      isDefault: profile.id === DEFAULT_READER_ID
    }));
  }

  ids() {
    return [...this.profiles.keys()];
  }

  get(id) {
    const profile = this.profiles.get(readerId(id) || "");
    return profile ? { ...profile, isDefault: profile.id === DEFAULT_READER_ID } : null;
  }

  has(id) {
    return this.profiles.has(readerId(id) || "");
  }

  // What a request's reader profile comes down to, and the reason nothing else
  // in the server has to think about it. Takes whatever a client offered — an
  // id, a display name, an OPDS username box, or nothing — and returns an id
  // that certainly exists.
  //
  // An unrecognised name resolves to the default rather than creating a
  // profile. Typing your name into a reader must not be able to strand your
  // shelf somewhere nothing can find it, and a name is not a credential, so
  // there is nothing here worth guessing at either.
  resolve(candidate) {
    if (typeof candidate !== "string") return DEFAULT_READER_ID;
    const trimmed = candidate.trim();
    if (!trimmed) return DEFAULT_READER_ID;
    const asId = readerId(trimmed);
    if (asId && this.profiles.has(asId)) return asId;
    const wanted = trimmed.toLocaleLowerCase();
    for (const profile of this.profiles.values()) {
      if (profile.name.toLocaleLowerCase() === wanted) return profile.id;
    }
    return DEFAULT_READER_ID;
  }

  async create(nameInput) {
    const name = readerName(nameInput);
    if (!name) {
      throw jsonError(
        "A reader profile needs a name.",
        "INVALID_READER_PROFILE"
      );
    }
    for (const profile of this.profiles.values()) {
      if (profile.name.toLocaleLowerCase() === name.toLocaleLowerCase()) {
        throw jsonError(
          `There is already a reader profile called ${profile.name}.`,
          "INVALID_READER_PROFILE"
        );
      }
    }
    if (this.profiles.size >= MAX_PROFILES) {
      throw jsonError(
        `A server holds at most ${MAX_PROFILES} reader profiles.`,
        "TOO_MANY_READER_PROFILES"
      );
    }
    const base = slugFrom(name);
    let id = base;
    for (let suffix = 2; this.profiles.has(id); suffix += 1) {
      id = `${base.slice(0, MAX_ID - 3)}-${suffix}`;
    }
    const profile = { id, name, createdAt: new Date().toISOString() };
    this.profiles.set(id, profile);
    await this.persist();
    return { ...profile, isDefault: false };
  }

  // Renaming leaves the id alone, including for the default. The id is what
  // every progress and skip record is filed under, so changing it would move
  // somebody's shelf; the name is only what a client draws and what an OPDS
  // username box can match.
  async rename(idInput, nameInput) {
    const id = readerId(idInput);
    const existing = id ? this.profiles.get(id) : null;
    if (!existing) {
      throw jsonError("That reader profile does not exist.", "NOT_FOUND");
    }
    const name = readerName(nameInput);
    if (!name) {
      throw jsonError(
        "A reader profile needs a name.",
        "INVALID_READER_PROFILE"
      );
    }
    for (const profile of this.profiles.values()) {
      if (
        profile.id !== existing.id &&
        profile.name.toLocaleLowerCase() === name.toLocaleLowerCase()
      ) {
        throw jsonError(
          `There is already a reader profile called ${profile.name}.`,
          "INVALID_READER_PROFILE"
        );
      }
    }
    existing.name = name;
    await this.persist();
    return { ...existing, isDefault: existing.id === DEFAULT_READER_ID };
  }

  // The default stays. Every record written before reader profiles existed is
  // filed under it, every request that names nothing resolves to it, and a
  // server with no reader profile at all has nowhere to put a reading position.
  async delete(idInput) {
    const id = readerId(idInput);
    if (id === DEFAULT_READER_ID) {
      throw jsonError(
        "The default reader profile cannot be deleted.",
        "INVALID_READER_PROFILE"
      );
    }
    if (!id || !this.profiles.delete(id)) return false;
    await this.persist();
    return true;
  }

  exportData() {
    return [...this.profiles.values()].map((profile) => ({ ...profile }));
  }

  async restoreData(value) {
    this.load({ profiles: Array.isArray(value) ? value : value?.profiles });
    await this.persist();
  }

  settled() {
    return this.writeQueue;
  }
}

module.exports = {
  ReaderProfileStore,
  DEFAULT_READER_ID,
  DEFAULT_READER_NAME,
  MAX_PROFILES,
  slugFrom
};
