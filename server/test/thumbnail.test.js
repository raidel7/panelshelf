"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fsp = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { ComicLibrary } = require("../src/library");
const {
  THUMBNAIL_MAX_EDGE,
  UnsupportedImageError,
  createThumbnail,
  decodeJpeg,
  imageSize
} = require("../src/thumbnail");
const { ONE_PIXEL_PNG, pngBuffer, zipBuffer } = require("./helpers");

const COVER_WIDTH = 640;
const COVER_HEIGHT = 960;

async function libraryWithCover(t, cover) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-thumb-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const comicDirectory = path.join(directory, "Comics");
  await fsp.mkdir(comicDirectory, { recursive: true });
  await fsp.writeFile(
    path.join(comicDirectory, "Issue 01.cbz"),
    zipBuffer([
      { name: "001.png", data: cover },
      { name: "002.png", data: ONE_PIXEL_PNG }
    ])
  );

  const previous = process.env.PANELSHELF_ALLOW_ANY_PATH;
  process.env.PANELSHELF_ALLOW_ANY_PATH = "1";
  t.after(() => {
    if (previous === undefined) delete process.env.PANELSHELF_ALLOW_ANY_PATH;
    else process.env.PANELSHELF_ALLOW_ANY_PATH = previous;
  });

  const library = new ComicLibrary(path.join(directory, "data"));
  await library.initialize();
  await library.saveConfig([comicDirectory]);
  await library.scan();
  const [comic] = library.listComics();
  return { library, comic, dataDirectory: path.join(directory, "data") };
}

test("a thumbnail is smaller than the cover it came from", () => {
  const cover = pngBuffer(COVER_WIDTH, COVER_HEIGHT);
  const thumbnail = createThumbnail(cover);

  assert.equal(thumbnail.mime, "image/jpeg");
  assert.equal(thumbnail.height, THUMBNAIL_MAX_EDGE);
  assert.equal(
    thumbnail.width,
    Math.round((COVER_WIDTH * THUMBNAIL_MAX_EDGE) / COVER_HEIGHT)
  );
  assert.ok(
    thumbnail.buffer.length < cover.length / 4,
    `thumbnail is ${thumbnail.buffer.length} bytes against a ${cover.length} byte cover`
  );
  // The bytes are a real JPEG that reads back at the size we claimed.
  assert.deepEqual(imageSize(thumbnail.buffer), {
    width: thumbnail.width,
    height: thumbnail.height
  });
  const decoded = decodeJpeg(thumbnail.buffer, thumbnail.width, thumbnail.height);
  assert.equal(decoded.width, thumbnail.width);
  assert.equal(decoded.height, thumbnail.height);
});

test("the longest edge is capped whichever way the cover is turned", () => {
  const landscape = createThumbnail(pngBuffer(COVER_HEIGHT, COVER_WIDTH));
  assert.equal(landscape.width, THUMBNAIL_MAX_EDGE);
  assert.ok(landscape.height < THUMBNAIL_MAX_EDGE);
});

test("a cover already smaller than a card is left alone", () => {
  assert.equal(createThumbnail(pngBuffer(200, 300)), null);
  assert.equal(createThumbnail(ONE_PIXEL_PNG), null);
});

test("a format the pure-JavaScript decoder cannot read is refused, not mangled", () => {
  const webp = Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.alloc(4),
    Buffer.from("WEBPVP8 "),
    Buffer.alloc(64)
  ]);
  assert.throws(() => createThumbnail(webp), UnsupportedImageError);
});

test("the cover route's thumbnail is smaller and its full size is untouched", async (t) => {
  const cover = pngBuffer(COVER_WIDTH, COVER_HEIGHT);
  const { library, comic } = await libraryWithCover(t, cover);

  const full = await library.cover(comic.id);
  assert.deepEqual(full.buffer, cover, "the default is still the original bytes");
  assert.equal(full.mime, "image/png");

  const thumbnail = await library.cover(comic.id, { thumbnail: true });
  assert.equal(thumbnail.mime, "image/jpeg");
  assert.ok(
    thumbnail.buffer.length < full.buffer.length / 4,
    `thumbnail is ${thumbnail.buffer.length} bytes against ${full.buffer.length}`
  );
  assert.deepEqual(imageSize(thumbnail.buffer).height, THUMBNAIL_MAX_EDGE);

  // Asking for the full size after a thumbnail exists still yields the
  // original, not the shrunken one.
  const fullAgain = await library.cover(comic.id);
  assert.deepEqual(fullAgain.buffer, cover);
});

test("a cached thumbnail is served rather than generated again", async (t) => {
  const { library, comic, dataDirectory } = await libraryWithCover(
    t,
    pngBuffer(COVER_WIDTH, COVER_HEIGHT)
  );

  const first = await library.cover(comic.id, { thumbnail: true });
  const cachePath = path.join(dataDirectory, "covers", `${comic.id}.thumb.jpg`);
  assert.deepEqual(await fsp.readFile(cachePath), first.buffer);

  // Replacing the cached file proves the second request reads the cache
  // instead of re-running the decoder, which would give back the real
  // thumbnail again.
  const sentinel = Buffer.from("cached thumbnail, not regenerated");
  await fsp.writeFile(cachePath, sentinel);
  const second = await library.cover(comic.id, { thumbnail: true });
  assert.deepEqual(second.buffer, sentinel);
  assert.equal(second.mime, "image/jpeg");
});

test("a cover that cannot be shrunk falls back to the full size once", async (t) => {
  const { library, comic, dataDirectory } = await libraryWithCover(
    t,
    ONE_PIXEL_PNG
  );

  const thumbnail = await library.cover(comic.id, { thumbnail: true });
  assert.deepEqual(thumbnail.buffer, ONE_PIXEL_PNG);
  assert.equal(thumbnail.mime, "image/png");
  await assert.rejects(
    fsp.stat(path.join(dataDirectory, "covers", `${comic.id}.thumb.jpg`)),
    /ENOENT/,
    "nothing is cached for a cover that was served whole"
  );
  // Remembered across a restart, not merely within one process. This was an
  // in-memory Set, so every restart re-attempted a decode already known to
  // fail, once per such comic, on NAS CPU.
  const reopened = new ComicLibrary(dataDirectory);
  await reopened.initialize();
  const [same] = reopened.listComics();
  assert.equal(
    reopened.coverCache.get(same.id, reopened.cacheKey(same)).thumbnailUnsupported,
    true,
    "the failed attempt survives a restart"
  );
});

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

test("the cover endpoint serves a thumbnail only when it is asked for", async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-thumb-http-"));
  const comicsDirectory = path.join(directory, "Comics");
  const dataDirectory = path.join(directory, "Data");
  await fsp.mkdir(comicsDirectory, { recursive: true });
  const cover = pngBuffer(COVER_WIDTH, COVER_HEIGHT);
  await fsp.writeFile(
    path.join(comicsDirectory, "Demo.cbz"),
    zipBuffer([{ name: "page.png", data: cover }])
  );

  const port = await freePort();
  const child = spawn(process.execPath, [path.resolve(__dirname, "../src/server.js")], {
    env: {
      ...process.env,
      PANELSHELF_ALLOW_ANY_PATH: "1",
      PANELSHELF_DATA: dataDirectory,
      PANELSHELF_HOST: "127.0.0.1",
      PANELSHELF_PORT: String(port)
    },
    stdio: ["ignore", "ignore", "ignore"]
  });
  t.after(async () => {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    await fsp.rm(directory, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      const health = await fetch(`${base}/api/health`);
      if (health.ok) break;
    } catch {
      // The server is still coming up.
    }
    if (Date.now() > deadline) throw new Error("The server never came up.");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  await fetch(`${base}/api/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ libraryPaths: [comicsDirectory] })
  });
  await fetch(`${base}/api/scan`, { method: "POST" });
  for (;;) {
    const scan = await (await fetch(`${base}/api/scan`)).json();
    if (scan.running === false && scan.finishedAt) break;
    if (Date.now() > deadline) throw new Error("The scan never finished.");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const comics = await (await fetch(`${base}/api/comics`)).json();
  const comicId = comics[0].id;

  const full = await fetch(`${base}/api/comics/${comicId}/cover`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), cover);

  const thumb = await fetch(`${base}/api/comics/${comicId}/cover?size=thumb`);
  assert.equal(thumb.status, 200);
  assert.equal(thumb.headers.get("content-type"), "image/jpeg");
  const thumbBody = Buffer.from(await thumb.arrayBuffer());
  assert.equal(Number(thumb.headers.get("content-length")), thumbBody.length);
  assert.ok(
    thumbBody.length < cover.length / 4,
    `thumbnail is ${thumbBody.length} bytes against a ${cover.length} byte cover`
  );
  assert.equal(imageSize(thumbBody).height, THUMBNAIL_MAX_EDGE);

  const explicitFull = await fetch(`${base}/api/comics/${comicId}/cover?size=full`);
  assert.deepEqual(Buffer.from(await explicitFull.arrayBuffer()), cover);

  // A size nobody offers is a mistake worth naming, not a silent full-size
  // response and not an excuse to generate a new cache entry.
  const bogus = await fetch(`${base}/api/comics/${comicId}/cover?size=1200`);
  assert.equal(bogus.status, 400);
  assert.equal((await bogus.json()).error.code, "INVALID_SIZE");
});

// A source can go away while the library stays configured — a USB disk asleep
// or unplugged, a network share unmounted. The covers are already on the NAS's
// own disk at that point, so the shelf has no business going grey.
//
// `pageCache` is cleared rather than mocked because it is the only thing that
// would otherwise hide the bug: a process that has already served this comic
// has its page list in memory and never reaches the archive.

test("a cached thumbnail outlives the archive it came from", async (t) => {
  const { library, comic } = await libraryWithCover(
    t,
    pngBuffer(COVER_WIDTH, COVER_HEIGHT)
  );

  const cached = await library.cover(comic.id, { thumbnail: true });
  assert.equal(cached.thumbnail, true);

  await fsp.rm(comic.path);
  library.pageCache.clear();

  const served = await library.cover(comic.id, { thumbnail: true });
  assert.deepEqual(served.buffer, cached.buffer);
  assert.equal(served.thumbnail, true);
});

test("a cached full-size cover outlives the archive it came from", async (t) => {
  const { library, comic } = await libraryWithCover(
    t,
    pngBuffer(COVER_WIDTH, COVER_HEIGHT)
  );

  const cached = await library.cover(comic.id);

  await fsp.rm(comic.path);
  library.pageCache.clear();

  const served = await library.cover(comic.id);
  assert.deepEqual(served.buffer, cached.buffer);
  assert.equal(served.mime, cached.mime);
});

test("a thumbnail is still built from a cached cover once the archive is gone", async (t) => {
  const { library, comic, dataDirectory } = await libraryWithCover(
    t,
    pngBuffer(COVER_WIDTH, COVER_HEIGHT)
  );

  // Full size only: the thumbnail has never been asked for, so nothing is
  // cached under `.thumb.jpg` and the shrink has to run against the cover on
  // disk rather than against the archive.
  await library.cover(comic.id);
  await fsp.rm(comic.path);
  library.pageCache.clear();

  const served = await library.cover(comic.id, { thumbnail: true });
  assert.equal(served.thumbnail, true);
  assert.equal(served.mime, "image/jpeg");
  assert.deepEqual(
    await fsp.readFile(path.join(dataDirectory, "covers", `${comic.id}.thumb.jpg`)),
    served.buffer
  );
});

test("a cover with nothing cached still reports the missing archive", async (t) => {
  const { library, comic } = await libraryWithCover(
    t,
    pngBuffer(COVER_WIDTH, COVER_HEIGHT)
  );

  await fsp.rm(comic.path);
  library.pageCache.clear();

  // Serving a placeholder here would be worse than failing: the shelf would
  // look complete while the library was not.
  await assert.rejects(library.cover(comic.id, { thumbnail: true }));
  await assert.rejects(library.cover(comic.id));
});

test("a cover is not reused when the archive changed underneath it", async (t) => {
  // Validity used to be decided by comparing the cache file's mtime against the
  // comic's. A file copied into place carries its source's mtime, so an archive
  // replaced without advancing the clock could serve the cover of the comic it
  // replaced, indefinitely. The scan already fingerprints each file's contents
  // for move detection, so the cover records which fingerprint it was built
  // from and a mismatch regenerates it.
  const { library, comic } = await libraryWithCover(
    t,
    pngBuffer(COVER_WIDTH, COVER_HEIGHT)
  );

  const first = await library.cover(comic.id);

  const before = await fsp.stat(comic.path);
  await fsp.writeFile(
    comic.path,
    zipBuffer([{ name: "001.png", data: pngBuffer(600, 900) }])
  );
  // Put the timestamps back exactly as they were: mtime must not be what saves
  // this, or the test proves nothing about the fingerprint.
  await fsp.utimes(comic.path, before.atime, before.mtime);

  await library.scan();
  library.pageCache.clear();

  const [rescanned] = library.listComics();
  assert.equal(rescanned.id, comic.id, "still the same comic, replaced in place");

  const second = await library.cover(rescanned.id);
  assert.notDeepEqual(
    second.buffer,
    first.buffer,
    "serves the archive's current cover, not the one cached before it changed"
  );
});
