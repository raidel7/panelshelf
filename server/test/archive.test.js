"use strict";

const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  detectArchiveType,
  inspectComicArchive,
  listPages,
  listRarEntries,
  readPage
} = require("../src/archive");
const { ONE_PIXEL_PNG, zipBuffer } = require("./helpers");

test("CBZ pages are naturally sorted and both stored and deflated entries open", async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-archive-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const comicPath = path.join(directory, "Issue.cbz");
  await fsp.writeFile(
    comicPath,
    zipBuffer([
      { name: "notes.txt", data: "not a page" },
      { name: "pages/10.png", data: ONE_PIXEL_PNG, store: true },
      { name: "pages/2.png", data: ONE_PIXEL_PNG },
      { name: "pages/1.png", data: ONE_PIXEL_PNG }
    ])
  );

  const pages = await listPages(comicPath);
  assert.deepEqual(
    pages.map((page) => page.name),
    ["pages/1.png", "pages/2.png", "pages/10.png"]
  );
  assert.deepEqual(await readPage(comicPath, pages[0], directory), ONE_PIXEL_PNG);
  assert.deepEqual(await readPage(comicPath, pages[2], directory), ONE_PIXEL_PNG);
});

test("a ZIP archive mislabeled as CBR is detected and opens normally", async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-mismatch-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const comicPath = path.join(directory, "Mislabeled.cbr");
  await fsp.writeFile(comicPath, zipBuffer([
    { name: "002.png", data: ONE_PIXEL_PNG },
    { name: "001.png", data: ONE_PIXEL_PNG }
  ]));
  assert.equal(await detectArchiveType(comicPath), "cbz");
  const inspection = await inspectComicArchive(comicPath, directory);
  assert.equal(inspection.format, "cbz");
  assert.equal(inspection.extensionMismatch, true);
  assert.deepEqual(inspection.pages.map((page) => page.name), ["001.png", "002.png"]);
  assert.deepEqual(await readPage(comicPath, inspection.pages[0], directory), ONE_PIXEL_PNG);
});

test("CBZ inspection reads ComicInfo.xml separately from image pages", async (t) => {
  const directory = await fsp.mkdtemp(
    path.join(os.tmpdir(), "panelshelf-comicinfo-")
  );
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const comicPath = path.join(directory, "Issue.cbz");
  await fsp.writeFile(
    comicPath,
    zipBuffer([
      {
        name: "ComicInfo.xml",
        data: "<ComicInfo><Series>Demo</Series><Number>2</Number></ComicInfo>"
      },
      { name: "001.png", data: ONE_PIXEL_PNG }
    ])
  );

  const inspection = await inspectComicArchive(comicPath, directory);
  assert.equal(inspection.pages.length, 1);
  assert.equal(inspection.comicInfoName, "ComicInfo.xml");
  assert.match(inspection.comicInfo, /<Series>Demo<\/Series>/);
});

test("unsupported files are rejected", async () => {
  await assert.rejects(() => listPages("/tmp/not-a-comic.pdf"), {
    code: "UNSUPPORTED_ARCHIVE"
  });
});

test("CBR entries are listed and extracted through the bundled RAR engine", async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-rar-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const comicPath = path.join(directory, "Demo.cbr");
  // Small fixture from node-unrar-js's MIT-licensed test suite. The first entry
  // is unencrypted; the later entries exercise encrypted-header listing.
  const fixture = Buffer.from(
    "UmFyIRoHAM+QcwAADQAAAAAAAABM+HQgkC4ABQAAAAUAAAACGSCKVxahg0odMAkAIAAAADFGaWxlLnR4dADwkOgEMUZpbGXcMHQkljwAIAAAAA8AAAACWwPYnCmhg0odMw8AIAAAADI/Py50eHQAThsyLYdlAiaSyWh4aKAhAPAmEhjfoJzHB5cWF7CjVyDJLLQscUep4830hwRH/3ogjuHVEcKUdCSUNQAQAAAABQAAAAJKlGwtVZ+DSh0zCAAgAAAAM1NlYy50eHT5pxtn2Ow6MACwWMggPeh+dGs0RwexfVSgel2k3cQ9ewBABwA=",
    "base64"
  );
  await fsp.writeFile(comicPath, fixture);

  const entries = await listRarEntries(comicPath);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].name, "1File.txt");
  assert.equal(entries[0].encrypted, false);
  assert.equal(entries[1].encrypted, true);
  assert.equal(
    (await readPage(comicPath, entries[0], directory)).toString("utf8"),
    "1File"
  );
});
