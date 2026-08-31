"use strict";

const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  ReaderProfileStore,
  DEFAULT_READER_ID,
  MAX_PROFILES,
  slugFrom
} = require("../src/reader-profiles");

async function makeStore(t) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-readers-"));
  t.after(async () => {
    await fsp.rm(directory, { recursive: true, force: true });
  });
  const store = new ReaderProfileStore(directory);
  await store.initialize();
  return { store, directory };
}

test("a server nobody has split still has a default reader profile", async (t) => {
  const { store, directory } = await makeStore(t);

  assert.deepEqual(
    store.list().map((profile) => profile.id),
    [DEFAULT_READER_ID]
  );
  assert.equal(store.list()[0].isDefault, true);
  // No file is written until something changes, so an untouched install adds
  // nothing to the data directory.
  assert.equal((await fsp.readdir(directory)).includes("readers.json"), false);
});

test("profiles are created, listed, and survive a restart", async (t) => {
  const { store, directory } = await makeStore(t);

  const ana = await store.create("Ana");
  assert.equal(ana.id, "ana");
  assert.equal(ana.isDefault, false);
  await store.create("Raidel");

  const restarted = new ReaderProfileStore(directory);
  await restarted.initialize();
  assert.deepEqual(
    restarted.list().map((profile) => profile.id),
    [DEFAULT_READER_ID, "ana", "raidel"],
    "the default leads the list a client draws"
  );
});

test("ids are derived from the name, and stay unique", async (t) => {
  const { store } = await makeStore(t);

  assert.equal((await store.create("Ana María")).id, "ana-maria");
  assert.equal((await store.create("  spaced   out  ")).id, "spaced-out");
  // A name that leaves no slug behind still gets a profile; it just gets an
  // opaque id and resolves by its name instead.
  const cjk = await store.create("小明");
  assert.match(cjk.id, /^reader-[a-f0-9]{6}$/);
  assert.equal(store.resolve("小明"), cjk.id);
});

test("two profiles cannot share a name", async (t) => {
  const { store } = await makeStore(t);
  await store.create("Ana");
  await assert.rejects(() => store.create("ana"), /already a reader profile/i);
  await assert.rejects(() => store.create("  ANA "), /already a reader profile/i);
  await assert.rejects(() => store.create(""), /needs a name/i);
  await assert.rejects(() => store.create(null), /needs a name/i);
});

test("an unknown name resolves to the default rather than creating one", async (t) => {
  const { store } = await makeStore(t);
  await store.create("Ana");

  assert.equal(store.resolve("ana"), "ana");
  assert.equal(store.resolve("Ana"), "ana", "the display name matches too");
  assert.equal(store.resolve("ANA"), "ana");

  // The whole point of the rule: a typo in an OPDS client's username box must
  // not strand somebody's shelf in a profile nothing can find.
  assert.equal(store.resolve("anna"), DEFAULT_READER_ID);
  assert.equal(store.resolve(""), DEFAULT_READER_ID);
  assert.equal(store.resolve("   "), DEFAULT_READER_ID);
  assert.equal(store.resolve(null), DEFAULT_READER_ID);
  assert.equal(store.resolve(undefined), DEFAULT_READER_ID);
  assert.equal(store.resolve(7), DEFAULT_READER_ID);
  assert.equal(store.resolve("../../etc/passwd"), DEFAULT_READER_ID);
  assert.equal(store.resolve("x".repeat(200)), DEFAULT_READER_ID);
  assert.equal(store.list().length, 2, "resolving created nothing");
});

test("renaming keeps the id, including for the default", async (t) => {
  const { store, directory } = await makeStore(t);

  // The id is what every progress and skip record is filed under, so renaming
  // must not move somebody's shelf.
  const renamed = await store.rename(DEFAULT_READER_ID, "Raidel");
  assert.equal(renamed.id, DEFAULT_READER_ID);
  assert.equal(renamed.name, "Raidel");
  assert.equal(store.resolve("Raidel"), DEFAULT_READER_ID);

  const ana = await store.create("Ana");
  await store.rename(ana.id, "Ana María");
  assert.equal(store.get("ana").name, "Ana María");
  assert.equal(store.resolve("ana"), "ana", "the old id still resolves");

  await assert.rejects(() => store.rename("ana", "Raidel"), /already a reader/i);
  await assert.rejects(() => store.rename("nobody", "X"), /does not exist/i);
  await assert.rejects(() => store.rename("ana", "  "), /needs a name/i);

  const restarted = new ReaderProfileStore(directory);
  await restarted.initialize();
  assert.equal(restarted.get(DEFAULT_READER_ID).name, "Raidel");
});

test("the default reader profile cannot be deleted", async (t) => {
  const { store } = await makeStore(t);
  await assert.rejects(
    () => store.delete(DEFAULT_READER_ID),
    /cannot be deleted/i
  );

  await store.create("Ana");
  assert.equal(await store.delete("ana"), true);
  assert.equal(await store.delete("ana"), false, "deleting twice is not an error");
  assert.equal(store.has("ana"), false);
  assert.equal(store.resolve("ana"), DEFAULT_READER_ID);
});

test("a household's worth of profiles is the ceiling", async (t) => {
  const { store } = await makeStore(t);
  for (let index = store.list().length; index < MAX_PROFILES; index += 1) {
    await store.create(`Reader ${index}`);
  }
  assert.equal(store.list().length, MAX_PROFILES);
  await assert.rejects(() => store.create("One more"), /at most/i);
});

test("a corrupt file is preserved and the default profile survives it", async (t) => {
  const { store, directory } = await makeStore(t);
  await store.create("Ana");
  await fsp.writeFile(store.filePath, "{ not json", "utf8");

  const restarted = new ReaderProfileStore(directory);
  await restarted.initialize();
  assert.deepEqual(
    restarted.list().map((profile) => profile.id),
    [DEFAULT_READER_ID],
    "the names are lost, but there is always somewhere to read"
  );

  const preserved = (await fsp.readdir(directory)).filter((name) =>
    name.includes("corrupt")
  );
  assert.equal(preserved.length, 1);
});

test("unusable stored entries are dropped without losing the file", async (t) => {
  const { store, directory } = await makeStore(t);
  await fsp.writeFile(
    store.filePath,
    JSON.stringify({
      profiles: [
        { id: "ana", name: "Ana", createdAt: "2026-08-30T00:00:00.000Z" },
        { id: "NO SPACES", name: "Broken" },
        { id: "ok", name: "" },
        { name: "No id" },
        null,
        7
      ]
    }),
    "utf8"
  );

  const restarted = new ReaderProfileStore(directory);
  await restarted.initialize();
  assert.deepEqual(
    restarted.list().map((profile) => profile.id),
    [DEFAULT_READER_ID, "ana"]
  );
});

test("export and restore round-trip the profiles", async (t) => {
  const { store } = await makeStore(t);
  await store.rename(DEFAULT_READER_ID, "Raidel");
  await store.create("Ana");
  const exported = store.exportData();

  await store.restoreData([]);
  assert.deepEqual(store.list().map((profile) => profile.id), [DEFAULT_READER_ID]);
  assert.equal(store.get(DEFAULT_READER_ID).name, "Default");

  await store.restoreData(exported);
  assert.equal(store.get(DEFAULT_READER_ID).name, "Raidel");
  assert.equal(store.get("ana").name, "Ana");
});

test("slugs never escape their own alphabet", () => {
  assert.equal(slugFrom("Ana"), "ana");
  assert.equal(slugFrom("../../etc"), "etc");
  assert.equal(slugFrom("a/b\\c"), "a-b-c");
  assert.equal(slugFrom("-leading-and-trailing-"), "leading-and-trailing");
  assert.equal(slugFrom("x".repeat(80)).length, 40);
  assert.match(slugFrom("???"), /^reader-[a-f0-9]{6}$/);
});
