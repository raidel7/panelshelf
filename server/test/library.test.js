"use strict";

const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ComicLibrary, inferFilenameMetadata } = require("../src/library");
const { ONE_PIXEL_PNG, zipBuffer } = require("./helpers");

test("filename metadata infers a parenthetical publication year", () => {
  assert.deepEqual(
    inferFilenameMetadata("Avengers Arena v01 (2006 MinuteMan).cbz"),
    { source: "filename", year: 2006 }
  );
  assert.deepEqual(
    inferFilenameMetadata("Humanity Bomb (2014) (16-20) (Empire).cbr"),
    { source: "filename", year: 2014 }
  );
  assert.deepEqual(
    inferFilenameMetadata("Historic title (1985-2012) (2020 ScanGroup).cbz"),
    { source: "filename", year: 2020 }
  );
  assert.equal(inferFilenameMetadata("Historic title (1985-2012).cbz"), null);
  assert.equal(inferFilenameMetadata("2006 Avengers 001.cbz"), null);
});

test("filename year is indexed as fallback and embedded metadata remains authoritative", async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-year-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const comicsDirectory = path.join(directory, "Comics");
  await fsp.mkdir(comicsDirectory, { recursive: true });
  await fsp.writeFile(
    path.join(comicsDirectory, "Fallback title (2006 MinuteMan).cbz"),
    zipBuffer([{ name: "001.png", data: ONE_PIXEL_PNG }])
  );
  await fsp.writeFile(
    path.join(comicsDirectory, "Embedded title (2006 MinuteMan).cbz"),
    zipBuffer([
      { name: "ComicInfo.xml", data: "<ComicInfo><Year>2014</Year></ComicInfo>" },
      { name: "001.png", data: ONE_PIXEL_PNG }
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
  await library.saveConfig([comicsDirectory]);
  await library.scan();
  const comics = library.listComics().map((comic) => library.publicComic(comic));
  const fallback = comics.find((comic) => comic.localTitle.startsWith("Fallback"));
  const embedded = comics.find((comic) => comic.localTitle.startsWith("Embedded"));
  assert.equal(fallback.metadata.year, 2006);
  assert.equal(fallback.inferredMetadata.year, 2006);
  assert.deepEqual(fallback.metadataSources, ["filename"]);
  assert.equal(embedded.metadata.year, 2014);
  assert.equal(embedded.inferredMetadata.year, 2006);
  assert.deepEqual(embedded.metadataSources, ["filename", "comicinfo"]);
});

test("library saves a source, scans recursively, and serves cover/page data", async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-library-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const dataDirectory = path.join(directory, "data");
  const comicDirectory = path.join(directory, "USB Comics", "Series A");
  await fsp.mkdir(comicDirectory, { recursive: true });
  await fsp.writeFile(
    path.join(comicDirectory, "Issue 01.cbz"),
    zipBuffer([
      { name: "001.png", data: ONE_PIXEL_PNG },
      { name: "002.png", data: ONE_PIXEL_PNG }
    ])
  );

  const previous = process.env.PANELSHELF_ALLOW_ANY_PATH;
  process.env.PANELSHELF_ALLOW_ANY_PATH = "1";
  t.after(() => {
    if (previous === undefined) delete process.env.PANELSHELF_ALLOW_ANY_PATH;
    else process.env.PANELSHELF_ALLOW_ANY_PATH = previous;
  });

  const library = new ComicLibrary(dataDirectory);
  await library.initialize();
  await library.saveConfig([path.join(directory, "USB Comics")]);
  const scan = await library.scan();
  assert.equal(scan.foundComics, 1);
  assert.equal(scan.errors.length, 0);

  const [comic] = library.listComics();
  assert.equal(comic.title, "Issue 01");
  assert.equal(comic.series, "Series A");
  assert.equal(comic.pageCount, 2);
  assert.deepEqual((await library.cover(comic.id)).buffer, ONE_PIXEL_PNG);
  assert.deepEqual((await library.page(comic.id, 1)).buffer, ONE_PIXEL_PNG);
});

test("manual metadata overrides survive rebuilds, restarts, and reset cleanly", async (t) => {
  const directory = await fsp.mkdtemp(
    path.join(os.tmpdir(), "panelshelf-manual-metadata-")
  );
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const dataDirectory = path.join(directory, "data");
  const comicsDirectory = path.join(directory, "Comics");
  await fsp.mkdir(comicsDirectory, { recursive: true });
  await fsp.writeFile(
    path.join(comicsDirectory, "Original.cbz"),
    zipBuffer([{
      name: "ComicInfo.xml",
      data: "<ComicInfo><Title>Embedded title</Title><Series>Embedded series</Series><Publisher>Marvel</Publisher></ComicInfo>"
    }, { name: "001.png", data: ONE_PIXEL_PNG }])
  );

  const previous = process.env.PANELSHELF_ALLOW_ANY_PATH;
  process.env.PANELSHELF_ALLOW_ANY_PATH = "1";
  t.after(() => {
    if (previous === undefined) delete process.env.PANELSHELF_ALLOW_ANY_PATH;
    else process.env.PANELSHELF_ALLOW_ANY_PATH = previous;
  });

  const library = new ComicLibrary(dataDirectory);
  await library.initialize();
  await library.saveConfig([comicsDirectory]);
  await library.scan({ action: "full" });
  const comic = library.listComics()[0];
  let displayed = await library.saveMetadataOverride(comic.id, {
    title: "My corrected title",
    series: "My corrected series",
    publisher: "Custom Press",
    year: 2014,
    volume: 4,
    summary: "A manually corrected summary.",
    genres: ["Superhero", "Adventure"],
    creators: { writers: ["Writer One"], pencillers: ["Artist One"] }
  });
  assert.equal(displayed.title, "My corrected title");
  assert.equal(displayed.series, "My corrected series");
  assert.equal(displayed.publisher.name, "Custom Press");
  assert.equal(displayed.metadata.source, "manual");
  assert.deepEqual(displayed.metadata.creators.writers, ["Writer One"]);

  await library.scan({ action: "full" });
  displayed = library.publicComic(library.getComic(comic.id));
  assert.equal(displayed.title, "My corrected title");

  const reloaded = new ComicLibrary(dataDirectory);
  await reloaded.initialize();
  displayed = reloaded.publicComic(reloaded.getComic(comic.id));
  assert.equal(displayed.title, "My corrected title");
  assert.ok(displayed.metadataSources.includes("manual"));

  await reloaded.removeMetadataOverride(comic.id);
  displayed = reloaded.publicComic(reloaded.getComic(comic.id));
  assert.equal(displayed.title, "Embedded title");
  assert.equal(displayed.series, "Embedded series");
  assert.equal(displayed.manualOverride, null);
});

test("confirmed online metadata fills local gaps without changing XML or order", async (t) => {
  const directory = await fsp.mkdtemp(
    path.join(os.tmpdir(), "panelshelf-online-metadata-")
  );
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const comicsDirectory = path.join(directory, "Comics");
  await fsp.mkdir(comicsDirectory, { recursive: true });
  await fsp.writeFile(
    path.join(comicsDirectory, "001 Bellatrix.cbz"),
    zipBuffer([
      {
        name: "ComicInfo.xml",
        data: `<ComicInfo>
          <Title>Local Bellatrix title</Title>
          <Series>Bellatrix</Series>
          <Number>3</Number>
          <Publisher>Dargaud</Publisher>
        </ComicInfo>`
      },
      { name: "001.png", data: ONE_PIXEL_PNG }
    ])
  );

  const previous = process.env.PANELSHELF_ALLOW_ANY_PATH;
  process.env.PANELSHELF_ALLOW_ANY_PATH = "1";
  t.after(() => {
    if (previous === undefined) delete process.env.PANELSHELF_ALLOW_ANY_PATH;
    else process.env.PANELSHELF_ALLOW_ANY_PATH = previous;
  });

  const remoteIssue = {
    id: 42,
    issue: "Bellatrix (2023) #3",
    series: {
      name: "Bellatrix",
      year_began: 2023,
      publisher: { name: "Wrong Online Publisher" }
    },
    number: "3",
    title: "Online title must not replace XML",
    cover_date: "2025-03-01",
    desc: "Online summary fills the missing local field.",
    arcs: [{ name: "Online arc does not become chronology" }]
  };
  const library = new ComicLibrary(path.join(directory, "data"), {
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/api/issue/42/") {
        return new Response(JSON.stringify(remoteIssue), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      throw new Error(`Unexpected request: ${parsed}`);
    }
  });
  await library.initialize();
  await library.saveConfig({
    sources: [
      {
        path: comicsDirectory,
        profile: "exact-reading-order",
        needsProfileConfirmation: false
      }
    ]
  });
  await library.scan();
  const [comic] = library.listComics();
  const originalOrderPath = [...comic.orderPath];
  const originalAutomaticOrder = library.getReadingOrders().automatic[0].comicIds;

  await library.saveMetadataSettings({
    enabled: true,
    permissionConfirmed: true,
    token: "test-token"
  });
  await library.reviewMetadata(comic.id, "metron", "42");
  const matched = await library.confirmMetadata(comic.id, "metron", "42");
  assert.equal(matched.title, "Local Bellatrix title");
  assert.equal(matched.metadata.publisher, "Dargaud");
  assert.equal(
    matched.metadata.summary,
    "Online summary fills the missing local field."
  );
  assert.equal(matched.onlineMatch.recordId, "42");
  assert.deepEqual(matched.orderPath, originalOrderPath);
  assert.deepEqual(
    library.getReadingOrders().automatic[0].comicIds,
    originalAutomaticOrder
  );

  const removed = await library.removeMetadata(comic.id);
  assert.equal(removed.onlineMatch, null);
  assert.equal(removed.metadata.summary, undefined);
});

test("embedded metadata and all four scan actions preserve unrelated sources", async (t) => {
  const directory = await fsp.mkdtemp(
    path.join(os.tmpdir(), "panelshelf-scan-actions-")
  );
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const firstSource = path.join(directory, "First Source");
  const secondSource = path.join(directory, "Second Source");
  await Promise.all([
    fsp.mkdir(firstSource, { recursive: true }),
    fsp.mkdir(secondSource, { recursive: true })
  ]);
  await Promise.all([
    fsp.writeFile(
      path.join(firstSource, "Filename 01.cbz"),
      zipBuffer([
        {
          name: "ComicInfo.xml",
          data: `<ComicInfo>
            <Title>Embedded title</Title>
            <Series>Metadata Series</Series>
            <Number>1</Number>
            <Year>2026</Year>
            <Publisher>Dargaud</Publisher>
            <Writer>Writer One</Writer>
          </ComicInfo>`
        },
        { name: "001.png", data: ONE_PIXEL_PNG }
      ])
    ),
    fsp.writeFile(
      path.join(secondSource, "Other.cbz"),
      zipBuffer([{ name: "001.png", data: ONE_PIXEL_PNG }])
    )
  ]);

  const previous = process.env.PANELSHELF_ALLOW_ANY_PATH;
  process.env.PANELSHELF_ALLOW_ANY_PATH = "1";
  t.after(() => {
    if (previous === undefined) delete process.env.PANELSHELF_ALLOW_ANY_PATH;
    else process.env.PANELSHELF_ALLOW_ANY_PATH = previous;
  });

  const library = new ComicLibrary(path.join(directory, "data"));
  await library.initialize();
  const config = await library.saveConfig({
    sources: [
      {
        name: "First",
        path: firstSource,
        profile: "loose-comics",
        needsProfileConfirmation: false
      },
      {
        name: "Second",
        path: secondSource,
        profile: "loose-comics",
        needsProfileConfirmation: false
      }
    ]
  });
  const firstId = config.sources.find((source) => source.name === "First").id;

  let scan = await library.scan({ action: "quick" });
  assert.equal(scan.action, "quick");
  assert.equal(scan.openedArchives, 2);
  assert.equal(scan.metadataFiles, 1);
  let embedded = library.listComics().find((comic) => comic.sourceId === firstId);
  assert.equal(embedded.title, "Embedded title");
  assert.equal(embedded.series, "Metadata Series");
  assert.equal(embedded.metadata.number, "1");
  assert.deepEqual(embedded.metadata.creators.writers, ["Writer One"]);
  assert.equal(library.publicComic(embedded).publisher.name, "Dargaud");

  scan = await library.scan({ action: "quick" });
  assert.equal(scan.reusedFiles, 2);
  assert.equal(scan.openedArchives, 0);

  const brokenPath = path.join(firstSource, "Broken.cbz");
  await fsp.writeFile(brokenPath, "not an archive");
  scan = await library.scan({ action: "source", sourceId: firstId });
  assert.equal(scan.action, "source");
  assert.equal(scan.errors.length, 1);
  assert.equal(library.listComics().length, 3);
  assert.equal(
    library.listComics().filter((comic) => comic.sourceName === "Second").length,
    1
  );

  await fsp.writeFile(
    brokenPath,
    zipBuffer([
      {
        name: "ComicInfo.xml",
        data: "<ComicInfo><Title>Recovered</Title><Series>Metadata Series</Series><Number>2</Number></ComicInfo>"
      },
      { name: "001.png", data: ONE_PIXEL_PNG }
    ])
  );
  scan = await library.scan({ action: "retry" });
  assert.equal(scan.action, "retry");
  assert.equal(scan.scannedFiles, 1);
  assert.equal(scan.errors.length, 0);
  assert.equal(
    library.listComics().find((comic) => comic.path === brokenPath).title,
    "Recovered"
  );

  scan = await library.scan({ action: "full" });
  assert.equal(scan.action, "full");
  assert.equal(scan.openedArchives, 3);
  assert.equal(scan.metadataFiles, 2);
});

test("malformed ComicInfo is a durable warning and does not drop the comic", async (t) => {
  const directory = await fsp.mkdtemp(
    path.join(os.tmpdir(), "panelshelf-metadata-warning-")
  );
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, "Comics");
  const dataDirectory = path.join(directory, "data");
  await fsp.mkdir(source, { recursive: true });
  await fsp.writeFile(
    path.join(source, "Readable.cbz"),
    zipBuffer([
      { name: "ComicInfo.xml", data: "<metadata><Title>Wrong</Title></metadata>" },
      { name: "001.png", data: ONE_PIXEL_PNG }
    ])
  );

  const previous = process.env.PANELSHELF_ALLOW_ANY_PATH;
  process.env.PANELSHELF_ALLOW_ANY_PATH = "1";
  t.after(() => {
    if (previous === undefined) delete process.env.PANELSHELF_ALLOW_ANY_PATH;
    else process.env.PANELSHELF_ALLOW_ANY_PATH = previous;
  });

  const library = new ComicLibrary(dataDirectory);
  await library.initialize();
  await library.saveConfig({
    sources: [
      {
        path: source,
        profile: "loose-comics",
        needsProfileConfirmation: false
      }
    ]
  });
  const scan = await library.scan({ action: "full" });
  assert.equal(scan.errors.length, 0);
  assert.equal(scan.warnings.length, 1);
  assert.equal(scan.warnings[0].code, "COMICINFO_INVALID");
  assert.equal(library.listComics().length, 1);
  assert.equal(library.listComics()[0].pageCount, 1);

  const reloaded = new ComicLibrary(dataDirectory);
  await reloaded.initialize();
  assert.equal(reloaded.getScanState().warnings.length, 1);
});

test("scan opens a ZIP mislabeled as CBR and reports a warning", async (t) => {
  const directory = await fsp.mkdtemp(
    path.join(os.tmpdir(), "panelshelf-extension-mismatch-")
  );
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, "Comics");
  await fsp.mkdir(source, { recursive: true });
  await fsp.writeFile(
    path.join(source, "Mislabeled.cbr"),
    zipBuffer([{ name: "001.png", data: ONE_PIXEL_PNG }])
  );
  const previous = process.env.PANELSHELF_ALLOW_ANY_PATH;
  process.env.PANELSHELF_ALLOW_ANY_PATH = "1";
  t.after(() => {
    if (previous === undefined) delete process.env.PANELSHELF_ALLOW_ANY_PATH;
    else process.env.PANELSHELF_ALLOW_ANY_PATH = previous;
  });
  const library = new ComicLibrary(path.join(directory, "data"));
  await library.initialize();
  await library.saveConfig([source]);
  const scan = await library.scan({ action: "full" });
  assert.equal(scan.errors.length, 0);
  assert.equal(scan.warnings[0].code, "ARCHIVE_EXTENSION_MISMATCH");
  assert.equal(library.listComics()[0].format, "cbz");
  assert.equal(library.listComics()[0].pageCount, 1);
});

test("a previously configured disconnected source remains saved", async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-offline-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, "Removable");
  await fsp.mkdir(source);
  const previous = process.env.PANELSHELF_ALLOW_ANY_PATH;
  process.env.PANELSHELF_ALLOW_ANY_PATH = "1";
  t.after(() => {
    if (previous === undefined) delete process.env.PANELSHELF_ALLOW_ANY_PATH;
    else process.env.PANELSHELF_ALLOW_ANY_PATH = previous;
  });

  const library = new ComicLibrary(path.join(directory, "data"));
  await library.initialize();
  await library.saveConfig([source]);
  await fsp.rm(source, { recursive: true });
  const config = await library.saveConfig([source]);
  assert.equal(config.libraryPaths[0].available, false);
});

test("legacy libraryPaths migrate to schema v2 source records", async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-migrate-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, "Marvel");
  const dataDirectory = path.join(directory, "data");
  await fsp.mkdir(source, { recursive: true });
  await fsp.mkdir(dataDirectory, { recursive: true });
  await fsp.writeFile(
    path.join(dataDirectory, "config.json"),
    `${JSON.stringify({ libraryPaths: [source] })}\n`
  );

  const previous = process.env.PANELSHELF_ALLOW_ANY_PATH;
  process.env.PANELSHELF_ALLOW_ANY_PATH = "1";
  t.after(() => {
    if (previous === undefined) delete process.env.PANELSHELF_ALLOW_ANY_PATH;
    else process.env.PANELSHELF_ALLOW_ANY_PATH = previous;
  });

  const library = new ComicLibrary(dataDirectory);
  await library.initialize();
  const config = await library.getConfig();
  assert.equal(config.schemaVersion, 2);
  assert.equal(config.sources.length, 1);
  assert.equal(config.sources[0].name, "Marvel");
  assert.equal(config.sources[0].profile, "unordered");
  assert.equal(config.sources[0].needsProfileConfirmation, true);
  assert.match(config.sources[0].id, /^src_[a-f0-9]{24}$/);

  const saved = JSON.parse(
    await fsp.readFile(path.join(dataDirectory, "config.json"), "utf8")
  );
  assert.equal(saved.schemaVersion, 2);
  assert.equal(saved.sources[0].path, source);
  assert.equal("libraryPaths" in saved, false);
});

test("a disconnected source retains its last-known comics after rescanning", async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-retain-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, "Removable");
  const comicPath = path.join(source, "Series", "Issue 01.cbz");
  await fsp.mkdir(path.dirname(comicPath), { recursive: true });
  await fsp.writeFile(
    comicPath,
    zipBuffer([{ name: "001.png", data: ONE_PIXEL_PNG }])
  );

  const previous = process.env.PANELSHELF_ALLOW_ANY_PATH;
  process.env.PANELSHELF_ALLOW_ANY_PATH = "1";
  t.after(() => {
    if (previous === undefined) delete process.env.PANELSHELF_ALLOW_ANY_PATH;
    else process.env.PANELSHELF_ALLOW_ANY_PATH = previous;
  });

  const library = new ComicLibrary(path.join(directory, "data"));
  await library.initialize();
  await library.saveConfig({
    sources: [
      {
        path: source,
        profile: "folders-as-series",
        needsProfileConfirmation: false
      }
    ]
  });
  await library.scan();
  assert.equal(library.listComics().length, 1);
  assert.equal(library.listComics()[0].available, true);

  await fsp.rm(source, { recursive: true });
  const scan = await library.scan();
  assert.equal(scan.retainedComics, 1);
  assert.equal(library.listComics().length, 1);
  assert.equal(library.listComics()[0].available, false);
});

test("overlapping sources are rejected", async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-overlap-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, "Comics");
  const nested = path.join(source, "Marvel");
  await fsp.mkdir(nested, { recursive: true });

  const previous = process.env.PANELSHELF_ALLOW_ANY_PATH;
  process.env.PANELSHELF_ALLOW_ANY_PATH = "1";
  t.after(() => {
    if (previous === undefined) delete process.env.PANELSHELF_ALLOW_ANY_PATH;
    else process.env.PANELSHELF_ALLOW_ANY_PATH = previous;
  });

  const library = new ComicLibrary(path.join(directory, "data"));
  await library.initialize();
  await assert.rejects(
    library.saveConfig({
      sources: [
        { path: source, profile: "unordered" },
        { path: nested, profile: "hierarchical-timeline" }
      ]
    }),
    (error) => error.code === "SOURCE_OVERLAP"
  );
});

test("scan persists publisher and branch roles while respecting staging policy", async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-roles-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, "Comics");
  await Promise.all([
    fsp.mkdir(path.join(source, "Marvel", "09 Modern Age"), { recursive: true }),
    fsp.mkdir(path.join(source, "_unsorted"), { recursive: true })
  ]);
  await Promise.all([
    fsp.writeFile(
      path.join(source, "Marvel", "09 Modern Age", "Book.cbz"),
      zipBuffer([{ name: "001.png", data: ONE_PIXEL_PNG }])
    ),
    fsp.writeFile(
      path.join(source, "_unsorted", "Later.cbz"),
      zipBuffer([{ name: "001.png", data: ONE_PIXEL_PNG }])
    )
  ]);

  const previous = process.env.PANELSHELF_ALLOW_ANY_PATH;
  process.env.PANELSHELF_ALLOW_ANY_PATH = "1";
  t.after(() => {
    if (previous === undefined) delete process.env.PANELSHELF_ALLOW_ANY_PATH;
    else process.env.PANELSHELF_ALLOW_ANY_PATH = previous;
  });

  const library = new ComicLibrary(path.join(directory, "data"));
  await library.initialize();
  await library.saveConfig({
    sources: [
      {
        path: source,
        profile: "hierarchical-timeline",
        stagingPolicy: "exclude",
        needsProfileConfirmation: false
      }
    ]
  });
  const scan = await library.scan();
  assert.equal(scan.foundComics, 1);
  const [book] = library.listComics();
  assert.equal(book.publisher.name, "Marvel Comics");
  assert.equal(book.hierarchy[0].role, "publisher");
  assert.equal(book.hierarchy[0].publisher.name, "Marvel Comics");
  assert.equal(book.hierarchy[1].role, "ordered-section");
  assert.equal(book.hierarchy[1].rank, "9");
  assert.equal(library.publicComic(book).publisher.name, "Marvel Comics");
});

test("a publisher selected as the source root is exposed on its comics", async (t) => {
  const directory = await fsp.mkdtemp(
    path.join(os.tmpdir(), "panelshelf-root-publisher-")
  );
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, "Marvel");
  const comicPath = path.join(source, "09 Modern Age", "Book.cbz");
  await fsp.mkdir(path.dirname(comicPath), { recursive: true });
  await fsp.writeFile(
    comicPath,
    zipBuffer([{ name: "001.png", data: ONE_PIXEL_PNG }])
  );

  const previous = process.env.PANELSHELF_ALLOW_ANY_PATH;
  process.env.PANELSHELF_ALLOW_ANY_PATH = "1";
  t.after(() => {
    if (previous === undefined) delete process.env.PANELSHELF_ALLOW_ANY_PATH;
    else process.env.PANELSHELF_ALLOW_ANY_PATH = previous;
  });

  const library = new ComicLibrary(path.join(directory, "data"));
  await library.initialize();
  await library.saveConfig({
    sources: [
      {
        path: source,
        profile: "hierarchical-timeline",
        needsProfileConfirmation: false
      }
    ]
  });
  await library.scan();
  const [book] = library.listComics();
  assert.equal(book.hierarchy[0].role, "ordered-section");
  assert.equal(book.publisher.name, "Marvel Comics");
  assert.equal(library.publicComic(book).publisher.name, "Marvel Comics");
});

test("manual reading order survives a comic move and receives new items as Unplaced", async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-move-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, "Comics");
  const firstPath = path.join(source, "First.cbz");
  const movedPath = path.join(source, "Filed", "First.cbz");
  await fsp.mkdir(source, { recursive: true });
  await fsp.writeFile(
    firstPath,
    zipBuffer([{ name: "001.png", data: ONE_PIXEL_PNG }])
  );

  const previous = process.env.PANELSHELF_ALLOW_ANY_PATH;
  process.env.PANELSHELF_ALLOW_ANY_PATH = "1";
  t.after(() => {
    if (previous === undefined) delete process.env.PANELSHELF_ALLOW_ANY_PATH;
    else process.env.PANELSHELF_ALLOW_ANY_PATH = previous;
  });

  const library = new ComicLibrary(path.join(directory, "data"));
  await library.initialize();
  await library.saveConfig({
    sources: [
      {
        path: source,
        profile: "unordered",
        needsProfileConfirmation: false
      }
    ]
  });
  await library.scan();
  const originalId = library.listComics()[0].id;
  const order = await library.createReadingOrder({
    name: "Stable chronology",
    comicIds: [originalId]
  });

  await fsp.mkdir(path.dirname(movedPath), { recursive: true });
  await fsp.rename(firstPath, movedPath);
  await library.scan();
  assert.equal(library.listComics()[0].id, originalId);
  assert.deepEqual(
    library.getReadingOrders().manual[0].comicIds,
    order.comicIds
  );

  await fsp.writeFile(
    path.join(source, "Second.cbz"),
    zipBuffer([{ name: "001.png", data: Buffer.concat([ONE_PIXEL_PNG, Buffer.from("2")]) }])
  );
  await library.scan();
  const orders = library.getReadingOrders();
  assert.equal(orders.manual[0].unplacedComicIds.length, 1);
  assert.notEqual(orders.manual[0].unplacedComicIds[0], originalId);
});

test("library exposes progress backed by the progress store", async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-library-progress-"));
  const library = new ComicLibrary(path.join(directory, "data"));
  await library.initialize();

  const comicId = "c".repeat(24);
  library.setComics([{ id: comicId, title: "Test Comic" }]);
  await library.saveProgress(comicId, { pageIndex: 4, pageCount: 20 });

  assert.equal(library.getProgress(comicId).pageIndex, 4);
  assert.equal(library.listProgress()[comicId].pageIndex, 4);

  await library.removeProgress(comicId);
  assert.equal(library.getProgress(comicId), null);
});

test("listProgress filters to known comics but the store retains records for a disconnected source", async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-library-progress-filter-"));
  const library = new ComicLibrary(path.join(directory, "data"));
  await library.initialize();

  const knownId = "d".repeat(24);
  const goneId = "e".repeat(24);
  library.setComics([{ id: knownId, title: "Known Comic" }]);
  await library.saveProgress(knownId, { pageIndex: 1, pageCount: 10 });
  await library.saveProgress(goneId, { pageIndex: 2, pageCount: 10 });

  const listed = library.listProgress();
  assert.deepEqual(Object.keys(listed).sort(), [knownId]);

  // The record for the disconnected comic is still in the underlying store,
  // even though listProgress() hid it because the comic isn't known right now.
  assert.equal(library.progress.exportData()[goneId].pageIndex, 2);
  assert.equal(library.getProgress(goneId).pageIndex, 2);
});
