"use strict";

const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { jsonError } = require("./util");
const { normalizeReaderId } = require("./reader-profiles");

// Which devices are allowed to talk to this server, when the owner has decided
// that should be a question at all.
//
// Off by default, and a corrupt file resets to off. Turning it on locks out
// every client that has not paired, which is the owner's decision to make on a
// day they choose — not something an upgrade does to them, and not something a
// damaged file does either.
//
// Pairing is a short code with a short life, not a password: the owner reads
// eight characters off one screen and types them into another, and the token
// that comes back is the client's problem to keep. Only a hash of that token is
// stored, so a readable `devices.json` is a list of names and timestamps rather
// than a set of working credentials.

const TOKEN_PREFIX = "pst_";
const PAIRING_TTL_MS = 5 * 60 * 1000;
// No 0/O or 1/I/L: this gets read off a screen and typed into a tablet.
const PAIRING_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const PAIRING_LENGTH = 8;
// A household pairs one device at a time and a code lives five minutes, so
// twenty outstanding at once is already generous. The ceiling is here because
// generating a code needs no credential while pairing is off, and a caller
// looping on that route would otherwise grow this map for as long as it ran.
// Once pairing is on the route is guarded, which is why evicting the oldest is
// safe: nobody but the owner can push their own fresh code out of the map.
const MAX_LIVE_PAIRING_CODES = 20;
// Stamping a last-used time on every request would write the file on every
// request. The display is "roughly when", so a minute of drift costs nothing.
const LAST_USED_PERSIST_MS = 60 * 1000;

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function pairingCode() {
  const bytes = crypto.randomBytes(PAIRING_LENGTH);
  let code = "";
  for (let index = 0; index < PAIRING_LENGTH; index += 1) {
    code += PAIRING_ALPHABET[bytes[index] % PAIRING_ALPHABET.length];
  }
  return code;
}

async function atomicWriteJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600
  });
  await fsp.rename(temporary, filePath);
}

function deviceFrom(value) {
  if (!value || typeof value !== "object") return null;
  const id = typeof value.id === "string" && value.id ? value.id : null;
  const hash = typeof value.hash === "string" && value.hash ? value.hash : null;
  if (!id || !hash) return null;
  return {
    id,
    hash,
    name: typeof value.name === "string" && value.name ? value.name : "Unnamed device",
    createdAt: typeof value.createdAt === "string" ? value.createdAt : null,
    lastUsedAt: typeof value.lastUsedAt === "string" ? value.lastUsedAt : null,
    expiresAt: typeof value.expiresAt === "string" ? value.expiresAt : null,
    // Whose shelf this device reads when it does not say. A device token is a
    // poor key for a reader profile — one iPad, two people, one token — but a
    // good default for the client that cannot name one at all: a third-party
    // OPDS reader is one app on one person's device, whatever the household
    // does with the tablet it runs on.
    readerProfileId: normalizeReaderId(value.readerProfileId)
  };
}

class DeviceTokenStore {
  constructor(dataDirectory) {
    this.filePath = path.join(dataDirectory, "devices.json");
    this.devices = new Map();
    this.byHash = new Map();
    this.pairings = new Map();
    this.isEnabled = false;
    this.lastUsedPersistedAt = 0;
    this.writeQueue = Promise.resolve();
  }

  get enabled() {
    return this.isEnabled;
  }

  async initialize() {
    let raw;
    try {
      raw = await fsp.readFile(this.filePath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      this.isEnabled = parsed?.enabled === true;
      const source = Array.isArray(parsed?.devices) ? parsed.devices : [];
      for (const value of source) {
        const device = deviceFrom(value);
        if (device) this.index(device);
      }
    } catch {
      // Resets closed. A damaged file is not a reason to start refusing every
      // client, and it is not a reason to start accepting every one either —
      // but of those two, only one can be undone from the browser.
      const corruptPath = `${this.filePath}.corrupt-${Date.now()}`;
      try {
        await fsp.rename(this.filePath, corruptPath);
        console.warn(
          `Device file ${this.filePath} is corrupt and was reset. ` +
            `The original was preserved at ${corruptPath}.`
        );
      } catch {
        console.warn(`Device file ${this.filePath} is corrupt and was reset.`);
      }
      this.devices = new Map();
      this.byHash = new Map();
      this.isEnabled = false;
    }
  }

  index(device) {
    this.devices.set(device.id, device);
    this.byHash.set(device.hash, device);
  }

  async setEnabled(enabled) {
    this.isEnabled = enabled === true;
    await this.persist();
    return this.isEnabled;
  }

  async createPairingCode(options = {}) {
    const ttl = Number.isFinite(options.ttlMs) ? options.ttlMs : PAIRING_TTL_MS;
    const code = pairingCode();
    const expiresAt = Date.now() + ttl;
    this.pairings.set(code, expiresAt);
    // Codes are short-lived and few; sweeping the expired ones here keeps the
    // map from growing on a server nobody ever pairs with successfully.
    for (const [existing, expiry] of this.pairings) {
      if (expiry <= Date.now()) this.pairings.delete(existing);
    }
    // Insertion order, so the oldest still-live code is the first one out.
    while (this.pairings.size > MAX_LIVE_PAIRING_CODES) {
      const oldest = this.pairings.keys().next().value;
      if (oldest === undefined || oldest === code) break;
      this.pairings.delete(oldest);
    }
    this.pairings.set(code, expiresAt);
    return { code, expiresAt: new Date(expiresAt).toISOString() };
  }

  async redeemPairingCode(code, options = {}) {
    const expiry = this.pairings.get(String(code || "").toUpperCase());
    if (!expiry || expiry <= Date.now()) {
      this.pairings.delete(String(code || "").toUpperCase());
      throw jsonError(
        "That pairing code is not valid. Generate a new one.",
        "INVALID_PAIRING_CODE"
      );
    }
    // Single use, deleted before the token exists so a failure below cannot
    // leave a code that has already produced one.
    this.pairings.delete(String(code).toUpperCase());

    const token = `${TOKEN_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
    const expiresInMs = Number.isFinite(options.expiresInMs) ? options.expiresInMs : null;
    const device = {
      id: crypto.randomUUID(),
      hash: hashToken(token),
      name: String(options.name || "").trim() || "Unnamed device",
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      readerProfileId: normalizeReaderId(options.readerProfileId),
      expiresAt:
        expiresInMs === null ? null : new Date(Date.now() + expiresInMs).toISOString()
    };
    this.index(device);
    await this.persist();
    return { token, device: this.publicDevice(device) };
  }

  // Synchronous: it runs on every request once pairing is on, and the answer is
  // a map lookup on a hash. The token is hashed first, so nothing here compares
  // the secret itself.
  verify(token) {
    if (typeof token !== "string" || !token) return null;
    const device = this.byHash.get(hashToken(token));
    if (!device) return null;
    if (device.expiresAt && Date.parse(device.expiresAt) <= Date.now()) return null;
    device.lastUsedAt = new Date().toISOString();
    if (Date.now() - this.lastUsedPersistedAt > LAST_USED_PERSIST_MS) {
      this.lastUsedPersistedAt = Date.now();
      this.persist().catch(() => {});
    }
    return this.publicDevice(device);
  }

  publicDevice(device) {
    return {
      id: device.id,
      name: device.name,
      createdAt: device.createdAt,
      lastUsedAt: device.lastUsedAt,
      expiresAt: device.expiresAt,
      readerProfileId: device.readerProfileId || null
    };
  }

  // Binding is a setting on the device, not a claim about it: it says which
  // shelf to show when the request names none, and null takes that back.
  // Whether the profile exists is the library's question, not this store's.
  async bind(deviceId, readerProfileId) {
    const device = this.devices.get(deviceId);
    if (!device) return null;
    device.readerProfileId = normalizeReaderId(readerProfileId);
    await this.persist();
    return this.publicDevice(device);
  }

  // A profile nobody uses leaves no device pointing at it.
  async unbindAll(readerProfileId) {
    const id = normalizeReaderId(readerProfileId);
    if (!id) return 0;
    let unbound = 0;
    for (const device of this.devices.values()) {
      if (device.readerProfileId !== id) continue;
      device.readerProfileId = null;
      unbound += 1;
    }
    if (unbound) await this.persist();
    return unbound;
  }

  list() {
    return [...this.devices.values()].map((device) => this.publicDevice(device));
  }

  async revoke(deviceId) {
    const device = this.devices.get(deviceId);
    if (!device) return false;
    this.devices.delete(device.id);
    this.byHash.delete(device.hash);
    await this.persist();
    return true;
  }

  // `verify` stamps a last-used time on a request path that cannot wait for a
  // write, so it schedules one. This is how a caller that does need to wait —
  // a shutdown, a test tearing down its directory — finds out when it landed.
  // Without it that write can outlive the thing it was writing into.
  settled() {
    return this.writeQueue;
  }

  persist() {
    const snapshot = {
      enabled: this.isEnabled,
      devices: [...this.devices.values()]
    };
    const next = this.writeQueue
      .catch(() => {})
      .then(() => atomicWriteJson(this.filePath, snapshot));
    this.writeQueue = next.catch(() => {});
    return next;
  }
}

module.exports = { DeviceTokenStore, TOKEN_PREFIX };
