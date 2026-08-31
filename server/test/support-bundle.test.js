"use strict";

const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ComicLibrary } = require("../src/library");
const { createSupportBundle, redact } = require("../src/support-bundle");

async function library(t) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-support-"));
  const created = new ComicLibrary(directory);
  await created.initialize();
  t.after(async () => {
    await created.deviceTokens.settled();
    await fsp.rm(directory, { recursive: true, force: true });
  });
  return { library: created, directory };
}

function bundleFor(created, options = {}) {
  return createSupportBundle({
    library: created,
    version: "0.4.18",
    apiVersion: 1,
    ...options
  });
}

test("a bundle says what it holds before anyone has to read it", async (t) => {
  const { library: created } = await library(t);
  const bundle = await bundleFor(created);

  assert.equal(bundle.format, "panelshelf-support-bundle");
  assert.ok(bundle.contains.included.length > 0);
  assert.ok(bundle.contains.excluded.length > 0);
  // The path warning is the one an owner needs before attaching this to a
  // public issue, so it is not buried in a list of five other things.
  assert.match(bundle.contains.notice, /name/i);
});

test("a device token never reaches the bundle, in any of its forms", async (t) => {
  const { library: created } = await library(t);
  const paired = await created.enableDevicePairing({ name: "Raidel's iPad" });

  const bundle = await bundleFor(created);
  const serialized = JSON.stringify(bundle);

  assert.ok(!serialized.includes(paired.token), "the token itself");
  const stored = [...created.deviceTokens.devices.values()][0];
  assert.ok(!serialized.includes(stored.hash), "the hash it is stored as");

  // What does belong: enough to tell whether the right things are paired.
  assert.equal(bundle.devices.pairingEnabled, true);
  assert.equal(bundle.devices.paired.length, 1);
  assert.equal(bundle.devices.paired[0].name, "Raidel's iPad");
  assert.equal(bundle.devices.paired[0].boundToReaderProfile, false);
});

test("a provider key does not travel, not even the masked hint", async (t) => {
  const { library: created } = await library(t);
  await created.saveMetadataSettings({
    providers: { metron: { enabled: true, token: "metron-secret-key-1234", permissionConfirmed: true } }
  });

  const bundle = await bundleFor(created);
  const serialized = JSON.stringify(bundle);
  assert.ok(!serialized.includes("metron-secret-key-1234"), "the key");
  // The settings page shows ••••1234 because it is already on the owner's
  // screen. A bundle travels, so it says only that a key is set.
  assert.ok(!serialized.includes("1234"), "the last four characters");

  const metron = bundle.metadata.providers.find((provider) => provider.id === "metron");
  assert.equal(metron.configured, true);
  assert.equal(metron.enabled, true);
});

test("reading positions are counted, never listed", async (t) => {
  const { library: created } = await library(t);
  const comicId = "a".repeat(24);
  await created.saveProgress("default", comicId, { pageIndex: 12, pageCount: 30 });

  const bundle = await bundleFor(created);
  const serialized = JSON.stringify(bundle);
  assert.ok(!serialized.includes(comicId), "which comic was read");

  const profile = bundle.readers.profiles.find((entry) => entry.id === "default");
  assert.equal(profile.progressRecords, 1);
  assert.equal(profile.skippedFolders, 0);
});

test("every reader profile is counted separately", async (t) => {
  const { library: created } = await library(t);
  const ana = await created.createReaderProfile("Ana María");
  await created.saveProgress("default", "b".repeat(24), { pageIndex: 3, pageCount: 30 });
  await created.saveProgress(ana.id, "c".repeat(24), { pageIndex: 4, pageCount: 30 });
  await created.applySkips(ana.id, { add: ["chronology/source:src_1/folder:X"] });

  const bundle = await bundleFor(created);
  const byId = Object.fromEntries(
    bundle.readers.profiles.map((profile) => [profile.id, profile])
  );
  // A report of "my progress vanished" is usually a client reading the wrong
  // profile, and this is the line that shows it.
  assert.equal(byId.default.progressRecords, 1);
  assert.equal(byId["ana-maria"].progressRecords, 1);
  assert.equal(byId["ana-maria"].skippedFolders, 1);
});

test("the log is carried, tailed, and scrubbed", async (t) => {
  const { library: created, directory } = await library(t);
  const logPath = path.join(directory, "panelshelf.log");
  await fsp.writeFile(
    logPath,
    [
      "PanelShelf 0.4.18 listening on 0.0.0.0:8251",
      "GET /api/comics authorization: Bearer pst_AaBbCcDdEeFf0011223344556677",
      'metron token: "metron-secret-key-1234"',
      "Scan finished: 12 comics"
    ].join("\n"),
    "utf8"
  );

  const bundle = await bundleFor(created, { logPath });
  assert.equal(bundle.log.present, true);
  assert.ok(!bundle.log.text.includes("pst_AaBbCcDdEeFf0011223344556677"));
  assert.ok(!bundle.log.text.includes("metron-secret-key-1234"));
  // Scrubbed, not deleted: the line still says what happened.
  assert.match(bundle.log.text, /GET \/api\/comics/);
  assert.match(bundle.log.text, /Scan finished: 12 comics/);
});

test("a long log is tailed from the end, and says that it was", async (t) => {
  const { library: created, directory } = await library(t);
  const logPath = path.join(directory, "panelshelf.log");
  const filler = Array.from({ length: 40_000 }, (unused, index) => `line ${index}`);
  await fsp.writeFile(logPath, `${filler.join("\n")}\nthe last thing that happened`, "utf8");

  const bundle = await bundleFor(created, { logPath });
  assert.equal(bundle.log.truncated, true);
  assert.match(bundle.log.text, /the last thing that happened/);
  assert.ok(!bundle.log.text.includes("line 0\n"), "the beginning is gone");
  // A tail that starts mid-line reads as a mystery rather than a truncation.
  assert.match(bundle.log.text.split("\n")[0], /^line \d+$/);
});

test("a missing log is reported rather than failing the bundle", async (t) => {
  const { library: created, directory } = await library(t);
  const bundle = await bundleFor(created, {
    logPath: path.join(directory, "nothing-here.log")
  });
  assert.equal(bundle.log.present, false);
  assert.equal(bundle.log.code, "ENOENT");
  assert.equal(bundle.format, "panelshelf-support-bundle");
});

test("source folders are reported whole, because that is the question", async (t) => {
  const { library: created, directory } = await library(t);
  const comics = path.join(directory, "Comics");
  await fsp.mkdir(comics, { recursive: true });
  // Outside a Synology volume, which the library only accepts when told to.
  process.env.PANELSHELF_ALLOW_ANY_PATH = "1";
  t.after(() => {
    delete process.env.PANELSHELF_ALLOW_ANY_PATH;
  });
  await created.saveConfig({
    sources: [{ path: comics, name: "Comics", profile: "folders-as-series" }]
  });

  const bundle = await bundleFor(created);
  assert.equal(bundle.configuration.sourceCount, 1);
  assert.equal(bundle.configuration.sources[0].path, comics);
  assert.equal(bundle.configuration.sources[0].profile, "folders-as-series");
  // Whether the folder is reachable is not in the stored record — it is
  // answered by looking. A bundle that names a source and cannot say whether
  // it is plugged in leaves out the likeliest answer to "my comics vanished".
  assert.equal(bundle.configuration.sources[0].available, true);

  await fsp.rm(comics, { recursive: true, force: true });
  const gone = await bundleFor(created);
  assert.equal(gone.configuration.sources[0].available, false);
  assert.ok(gone.configuration.sources[0].code, "and says why");
});

test("only the server's own settings are reported from the environment", async (t) => {
  const { library: created } = await library(t);
  const bundle = await bundleFor(created, {
    env: {
      PANELSHELF_ALLOWED_HOSTS: "comics.example.com",
      PANELSHELF_TRUSTED_PROXY: "loopback",
      AWS_SECRET_ACCESS_KEY: "not-yours-to-send",
      HOME: "/Users/somebody"
    }
  });

  assert.equal(bundle.runtime.environment.PANELSHELF_ALLOWED_HOSTS, "comics.example.com");
  assert.equal(bundle.runtime.environment.PANELSHELF_TRUSTED_PROXY, "loopback");
  // An allowlist rather than a denylist: the next secret anybody puts in the
  // environment should not need this file to be edited to stay out.
  assert.ok(!("AWS_SECRET_ACCESS_KEY" in bundle.runtime.environment));
  assert.ok(!("HOME" in bundle.runtime.environment));
});

test("redaction keeps the shape of the line", () => {
  assert.equal(redact("token: pst_abcdefghij"), "token: «redacted»");
  assert.equal(
    redact("Authorization: Basic dXNlcjpwYXNz"),
    "Authorization: «redacted»"
  );
  assert.equal(
    redact('{"apiKey": "sk-live-1234", "count": 7}'),
    '{"apiKey": "«redacted»", "count": 7}'
  );
  // Ordinary text is left alone, or the log stops being readable.
  assert.equal(redact("Scan finished: 12 comics"), "Scan finished: 12 comics");
});
