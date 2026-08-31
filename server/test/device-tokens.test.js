"use strict";

const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DeviceTokenStore } = require("../src/device-tokens");

async function store(t) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-devices-"));
  const created = new DeviceTokenStore(directory);
  await created.initialize();
  t.after(async () => {
    // `verify` schedules a write it does not await, so the directory cannot go
    // until that has landed — otherwise the write recreates it mid-removal.
    await created.settled();
    await fsp.rm(directory, { recursive: true, force: true });
  });
  return { created, directory };
}

async function paired(created, name = "Raidel's iPad") {
  const { code } = await created.createPairingCode();
  return created.redeemPairingCode(code, { name });
}

test("device tokens are off until they are turned on", async (t) => {
  // Turning this on locks out every client that has not paired, so an upgrade
  // must not do it for the owner.
  const { created } = await store(t);
  assert.equal(created.enabled, false);
});

test("a redeemed pairing code returns a token that verifies", async (t) => {
  const { created } = await store(t);
  const { token, device } = await paired(created);

  assert.match(token, /^pst_/, "recognisable as a PanelShelf token");
  assert.ok(token.length > 32, "long enough not to be guessed");
  assert.equal(device.name, "Raidel's iPad");
  assert.equal(created.verify(token).id, device.id);
});

test("the token itself is never stored", async (t) => {
  // A readable devices.json must not be a set of working credentials.
  const { created, directory } = await store(t);
  const { token } = await paired(created);

  const raw = await fsp.readFile(path.join(directory, "devices.json"), "utf8");
  assert.equal(raw.includes(token), false, "only a hash of it is kept");
});

test("a pairing code cannot be redeemed twice", async (t) => {
  const { created } = await store(t);
  const { code } = await created.createPairingCode();
  await created.redeemPairingCode(code, { name: "First" });

  await assert.rejects(
    () => created.redeemPairingCode(code, { name: "Second" }),
    /pairing code/i
  );
});

test("an expired pairing code is refused", async (t) => {
  const { created } = await store(t);
  const { code } = await created.createPairingCode({ ttlMs: -1 });

  await assert.rejects(() => created.redeemPairingCode(code, { name: "Late" }), /pairing code/i);
});

test("an unknown token verifies as nobody", async (t) => {
  const { created } = await store(t);
  assert.equal(created.verify("pst_not-a-real-token"), null);
  assert.equal(created.verify(""), null);
  assert.equal(created.verify(undefined), null);
});

test("a revoked device loses access immediately", async (t) => {
  // The milestone's release gate, stated exactly.
  const { created } = await store(t);
  const { token, device } = await paired(created);
  assert.ok(created.verify(token));

  await created.revoke(device.id);

  assert.equal(created.verify(token), null);
});

test("an expired device token stops verifying", async (t) => {
  const { created } = await store(t);
  const { code } = await created.createPairingCode();
  const { token } = await created.redeemPairingCode(code, {
    name: "Borrowed iPad",
    expiresInMs: -1
  });

  assert.equal(created.verify(token), null);
});

test("verifying stamps when the device was last seen", async (t) => {
  // So the owner can tell which paired device is the one they have forgotten.
  const { created } = await store(t);
  const { token, device } = await paired(created);
  assert.equal(created.list().find((entry) => entry.id === device.id).lastUsedAt, null);

  created.verify(token);

  const seen = created.list().find((entry) => entry.id === device.id);
  assert.ok(seen.lastUsedAt, "a last-used time is recorded");
});

test("the device list never carries anything usable as a credential", async (t) => {
  const { created } = await store(t);
  await paired(created);

  const listed = created.list();
  assert.equal(listed.length, 1);
  for (const device of listed) {
    assert.equal("hash" in device, false);
    assert.equal("token" in device, false);
  }
});

test("devices and the enabled flag survive a restart", async (t) => {
  const { created, directory } = await store(t);
  await created.setEnabled(true);
  const { token } = await paired(created);

  const reopened = new DeviceTokenStore(directory);
  await reopened.initialize();
  assert.equal(reopened.enabled, true);
  assert.ok(reopened.verify(token), "a paired device stays paired across a restart");
  // This store is not the one the helper tears down, and `verify` above
  // scheduled a write. Left unawaited it lands inside the directory being
  // removed and recreates it.
  await reopened.settled();
});

test("a corrupt device file resets rather than refusing to start", async (t) => {
  const { created, directory } = await store(t);
  await paired(created);
  await fsp.writeFile(path.join(directory, "devices.json"), "{ not json");

  const reopened = new DeviceTokenStore(directory);
  await reopened.initialize();
  assert.equal(reopened.enabled, false, "resets closed, not open");
  assert.deepEqual(reopened.list(), []);
});

test("outstanding pairing codes stay bounded, newest kept", async (t) => {
  const { created } = await store(t);

  // Generating a code needs no credential while pairing is off, so a caller
  // looping on that route must not be able to grow this map without limit.
  const codes = [];
  for (let index = 0; index < 200; index += 1) {
    codes.push((await created.createPairingCode()).code);
  }
  assert.ok(created.pairings.size <= 20, `saw ${created.pairings.size} live codes`);

  // The newest survives, which is the one the owner is reading off the screen
  // right now. Anything else would let a flood push their code out from under
  // them between generating it and typing it in.
  const newest = codes[codes.length - 1];
  const redeemed = await created.redeemPairingCode(newest, { name: "iPad" });
  assert.match(redeemed.token, /^pst_/);

  // And an old one is gone rather than lingering as a second live credential.
  await assert.rejects(
    () => created.redeemPairingCode(codes[0], { name: "Chancer" }),
    (error) => error.code === "INVALID_PAIRING_CODE"
  );
});
