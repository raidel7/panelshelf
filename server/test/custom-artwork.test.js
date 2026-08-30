"use strict";

const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { CustomArtworkStore, MAX_ARTWORK_BYTES } = require("../src/custom-artwork");
const { ONE_PIXEL_PNG, pngBuffer } = require("./helpers");

async function store(t) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-art-"));
  const created = new CustomArtworkStore(directory);
  await created.initialize();
  t.after(async () => {
    await created.settled();
    await fsp.rm(directory, { recursive: true, force: true });
  });
  return { created, directory };
}

test("a subject with no artwork has none", async (t) => {
  const { created } = await store(t);
  assert.equal(created.get("order:abc", "cover"), null);
});

test("a saved cover reads back with its type and its size", async (t) => {
  // Dimensions are recorded so a client can reserve the space before the image
  // arrives, the same reason the cover cache records them.
  const { created } = await store(t);
  const image = pngBuffer(120, 180);

  const entry = await created.save("order:abc", "cover", image, "image/png");

  assert.equal(entry.mime, "image/png");
  assert.equal(entry.width, 120);
  assert.equal(entry.height, 180);
  assert.equal(entry.bytes, image.length);
  assert.equal(created.get("order:abc", "cover").file, entry.file);
});

test("cover and banner are separate artwork for the same subject", async (t) => {
  const { created } = await store(t);
  await created.save("order:abc", "cover", pngBuffer(100, 150), "image/png");
  await created.save("order:abc", "banner", pngBuffer(400, 100), "image/png");

  assert.equal(created.get("order:abc", "cover").width, 100);
  assert.equal(created.get("order:abc", "banner").width, 400);
});

test("replacing artwork leaves one file behind, not two", async (t) => {
  // Otherwise every re-upload is another copy of a cover nobody will look at,
  // accumulating on the NAS with nothing pointing at it.
  const { created, directory } = await store(t);
  await created.save("comic:1", "cover", pngBuffer(100, 150), "image/png");
  const first = created.get("comic:1", "cover").file;

  await created.save("comic:1", "cover", pngBuffer(200, 300), "image/png");

  const second = created.get("comic:1", "cover").file;
  assert.notEqual(first, second, "a new file, so a cached URL does not stick");
  const files = await fsp.readdir(path.join(directory, "artwork"));
  assert.deepEqual(files, [second], "and the old one is gone");
});

test("something that is not an image is refused", async (t) => {
  const { created } = await store(t);
  await assert.rejects(
    () => created.save("comic:1", "cover", Buffer.from("<html>nope</html>"), "image/png"),
    /image/i
  );
  assert.equal(created.get("comic:1", "cover"), null);
});

test("an image too large to be a cover is refused", async (t) => {
  // The upload path is authenticated but not trusted: a cap is what stops one
  // request filling the package's data volume.
  const { created } = await store(t);
  const huge = Buffer.alloc(MAX_ARTWORK_BYTES + 1, 0);
  await assert.rejects(() => created.save("comic:1", "cover", huge, "image/png"), /too large/i);
});

test("artwork survives a restart", async (t) => {
  const { created, directory } = await store(t);
  await created.save("order:abc", "cover", ONE_PIXEL_PNG, "image/png");
  await created.settled();

  const reopened = new CustomArtworkStore(directory);
  await reopened.initialize();
  assert.ok(reopened.get("order:abc", "cover"), "a rebuild must not erase custom artwork");
});

test("reconciling drops artwork whose subject is gone and names its files", async (t) => {
  const { created } = await store(t);
  await created.save("comic:keep", "cover", pngBuffer(10, 10), "image/png");
  await created.save("comic:gone", "cover", pngBuffer(10, 10), "image/png");
  const orphaned = created.get("comic:gone", "cover").file;

  const removed = await created.reconcile(["comic:keep"]);

  assert.deepEqual(removed, [orphaned]);
  assert.equal(created.get("comic:gone", "cover"), null);
  assert.ok(created.get("comic:keep", "cover"), "the surviving subject is untouched");
});

test("reconciling a library that lost nothing removes nothing", async (t) => {
  const { created } = await store(t);
  await created.save("comic:keep", "cover", pngBuffer(10, 10), "image/png");

  assert.deepEqual(await created.reconcile(["comic:keep"]), []);
});

test("a corrupt store resets rather than refusing to start", async (t) => {
  const { created, directory } = await store(t);
  await created.save("comic:1", "cover", ONE_PIXEL_PNG, "image/png");
  await created.settled();
  await fsp.writeFile(path.join(directory, "artwork.json"), "{ not json");

  const reopened = new CustomArtworkStore(directory);
  await reopened.initialize();
  assert.equal(reopened.get("comic:1", "cover"), null);
});
