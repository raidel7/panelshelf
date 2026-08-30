"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fsp = require("node:fs/promises");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ONE_PIXEL_PNG, zipBuffer } = require("./helpers");

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

async function waitFor(url, predicate, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      const body = await response.json();
      if (response.ok && predicate(body)) return body;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

/// Spawns a real server over a temporary data directory and tears it down with
/// the test. Returns its base URL plus a live view of its logs, which every
/// assertion below passes to `assert` so a failure prints what the server said.
async function startServer(t, options = {}) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-http-"));
  const comicsDirectory = path.join(directory, "Comics");
  const dataDirectory = path.join(directory, "Data");
  await fsp.mkdir(comicsDirectory, { recursive: true });

  const port = await freePort();
  const child = spawn(process.execPath, [path.resolve(__dirname, "../src/server.js")], {
    env: {
      ...process.env,
      PANELSHELF_ALLOW_ANY_PATH: "1",
      PANELSHELF_DATA: dataDirectory,
      PANELSHELF_HOST: "127.0.0.1",
      PANELSHELF_PORT: String(port),
      ...(options.env || {})
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const state = { logs: "" };
  child.stdout.on("data", (chunk) => {
    state.logs += chunk;
  });
  child.stderr.on("data", (chunk) => {
    state.logs += chunk;
  });
  t.after(async () => {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    await fsp.rm(directory, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${port}`;
  await waitFor(`${base}/api/health`, (body) => body.status === "ok");
  return { base, comicsDirectory, dataDirectory, directory, port, state };
}

test("the comics list sorts by arrival and honours a limit", async (t) => {
  const { base, comicsDirectory, state } = await startServer(t);

  // The source is configured first, then scanned once per comic, because
  // arrival is recorded when a scan finds a comic — everything discovered by
  // one scan arrived at the same moment. Written in alphabetical order so that
  // newest-first is the reverse of the default order: a route that ignored
  // `sort` would return them the wrong way round rather than accidentally the
  // right one.
  let response = await fetch(`${base}/api/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ libraryPaths: [comicsDirectory] })
  });
  assert.equal(response.status, 200, state.logs);

  for (const [index, name] of ["Alpha", "Bravo", "Charlie"].entries()) {
    await fsp.writeFile(
      path.join(comicsDirectory, `${name}.cbz`),
      zipBuffer([{ name: "page.png", data: ONE_PIXEL_PNG }])
    );
    await fetch(`${base}/api/scan`, { method: "POST" });
    await waitFor(`${base}/api/comics`, (body) => body.length === index + 1);
  }

  response = await fetch(`${base}/api/comics?view=compact&sort=added&limit=2`);
  assert.equal(response.status, 200, state.logs);
  const recent = await response.json();
  assert.deepEqual(
    recent.map((comic) => comic.title),
    ["Charlie", "Bravo"],
    "newest first, and only as many as were asked for"
  );
  assert.deepEqual(
    Object.keys(recent[0]).sort(),
    ["available", "format", "id", "pageCount", "publisher", "series", "title"],
    "the row is projected like any other compact list"
  );

  // A limit with no sort truncates the default order; an unusable one is
  // ignored rather than emptying the shelf.
  assert.equal((await (await fetch(`${base}/api/comics?limit=2`)).json()).length, 2);
  assert.equal((await (await fetch(`${base}/api/comics?limit=0`)).json()).length, 3);
  assert.equal(
    (await (await fetch(`${base}/api/comics?limit=notanumber`)).json()).length,
    3
  );

  // An unknown sort is the full list in its usual order — not an error, and not
  // an empty shelf.
  response = await fetch(`${base}/api/comics?sort=nonsense`);
  assert.equal(response.status, 200, state.logs);
  assert.equal((await response.json()).length, 3);
});

test("HTTP API configures, scans, lists, and opens a CBZ comic", async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-http-"));
  const comicsDirectory = path.join(directory, "Comics");
  const dataDirectory = path.join(directory, "Data");
  await fsp.mkdir(comicsDirectory, { recursive: true });
  await fsp.writeFile(
    path.join(comicsDirectory, "Demo.cbz"),
    zipBuffer([{ name: "page.png", data: ONE_PIXEL_PNG }])
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
    stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  child.stdout.on("data", (chunk) => {
    logs += chunk;
  });
  child.stderr.on("data", (chunk) => {
    logs += chunk;
  });
  t.after(async () => {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    await fsp.rm(directory, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${port}`;
  await waitFor(`${base}/api/health`, (body) => body.status === "ok");

  // Discovery has to be diagnosable over HTTP: the NAS refuses SSH, so this
  // endpoint is the only way to tell "never bound" from "bound but never
  // asked". It answers with the responder's state whatever happened, including
  // when the advertisement failed outright -- a 404 would be one more silent
  // failure mode.
  const discoveryResponse = await fetch(`${base}/api/discovery`);
  assert.equal(discoveryResponse.status, 200, logs);
  const discovery = await discoveryResponse.json();
  assert.equal(typeof discovery.active, "boolean");
  assert.equal(discovery.serviceType, "_panelshelf._tcp.local");
  assert.equal(discovery.instance, "PanelShelf");
  assert.equal(discovery.port, port);
  assert.equal(typeof discovery.bound, "boolean");
  assert.equal(typeof discovery.membership, "boolean");
  assert.equal(typeof discovery.counters.datagrams, "number");
  assert.equal(typeof discovery.counters.queries, "number");
  assert.equal(typeof discovery.counters.responses, "number");
  // Announcing is what actually makes the server discoverable now, so an
  // operator with no shell on the NAS has to be able to read it here:
  // "announced 5 times, no errors" must be distinguishable from "never
  // announced", which is why the count and the timestamp are both exposed.
  assert.equal(typeof discovery.counters.announcements, "number");
  assert.equal(typeof discovery.counters.goodbyes, "number");
  assert.equal(typeof discovery.announceIntervalMs, "number");
  assert.ok(
    discovery.lastAnnouncedAt === null ||
      !Number.isNaN(Date.parse(discovery.lastAnnouncedAt)),
    `lastAnnouncedAt is null or a timestamp, got ${discovery.lastAnnouncedAt}`
  );
  assert.deepEqual(Object.keys(discovery.lastError).sort(), [
    "bind",
    "membership",
    "multicastInterface",
    "send",
    "socket"
  ]);
  // An inactive responder must say why; an active one has nothing to explain.
  if (discovery.active) {
    assert.equal(discovery.reason, null);
  } else {
    assert.equal(typeof discovery.reason, "string", logs);
  }

  let bulkResponse = await fetch(`${base}/api/metadata/bulk`);
  assert.equal(bulkResponse.status, 200, logs);
  const bulkState = await bulkResponse.json();
  assert.equal(bulkState.status, "idle");
  assert.equal(bulkState.remaining, 0);

  let response = await fetch(`${base}/api/metadata/settings`);
  assert.equal(response.status, 200, logs);
  let metadataSettings = await response.json();
  assert.equal(metadataSettings.provider.configured, false);
  assert.equal(metadataSettings.provider.authentication, "API token");
  assert.equal(metadataSettings.provider.token, undefined);

  response = await fetch(`${base}/api/metadata/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      enabled: false,
      permissionConfirmed: true,
      token: "server-test-secret"
    })
  });
  assert.equal(response.status, 200, logs);
  metadataSettings = await response.json();
  assert.equal(metadataSettings.provider.configured, true);
  assert.equal(metadataSettings.provider.tokenHint, "••••cret");
  assert.doesNotMatch(JSON.stringify(metadataSettings), /server-test-secret/);

  response = await fetch(`${base}/api/metadata/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      enabled: false,
      permissionConfirmed: false,
      clearToken: true
    })
  });
  assert.equal(response.status, 200, logs);
  assert.equal((await response.json()).provider.configured, false);

  response = await fetch(`${base}/api/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ libraryPaths: [comicsDirectory] })
  });
  assert.equal(response.status, 200, logs);
  const config = await response.json();
  assert.equal(config.schemaVersion, 2);
  assert.equal(config.sources.length, 1);

  response = await fetch(`${base}/api/sources/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: comicsDirectory, profile: "detect" })
  });
  assert.equal(response.status, 200, logs);
  const preview = await response.json();
  assert.equal(preview.profile, "loose-comics");
  assert.equal(preview.summary.comics, 1);

  response = await fetch(`${base}/api/scan`, { method: "POST" });
  assert.equal(response.status, 202, logs);
  await waitFor(`${base}/api/scan`, (body) => body.running === false && body.finishedAt);

  response = await fetch(`${base}/api/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "source",
      sourceId: config.sources[0].id
    })
  });
  assert.equal(response.status, 202, logs);
  const sourceScan = await waitFor(
    `${base}/api/scan`,
    (body) =>
      body.running === false &&
      body.finishedAt &&
      body.action === "source"
  );
  assert.equal(sourceScan.sourceId, config.sources[0].id);
  assert.equal(sourceScan.reusedFiles, 1);

  response = await fetch(`${base}/api/comics`);
  assert.equal(response.status, 200, logs);
  const comics = await response.json();
  assert.equal(comics.length, 1);
  assert.equal(comics[0].title, "Demo");

  response = await fetch(`${base}/api/comics/${comics[0].id}/metadata/override`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Corrected Demo",
      series: "Corrected Series",
      year: 2026,
      creators: { writers: ["Test Writer"] }
    })
  });
  assert.equal(response.status, 200, logs);
  let correctedComic = await response.json();
  assert.equal(correctedComic.title, "Corrected Demo");
  assert.equal(correctedComic.metadata.year, 2026);
  assert.equal(correctedComic.manualOverride.metadata.source, "manual");

  // The compact list is the iPad's shelf: exactly the fields a grid draws, and
  // an exact key check rather than a spot check, because a projection that
  // quietly forwarded the whole record would satisfy any assertion about the
  // fields it does contain.
  response = await fetch(`${base}/api/comics?view=compact`);
  assert.equal(response.status, 200, logs);
  const compact = await response.json();
  assert.equal(compact.length, 1);
  assert.deepEqual(
    Object.keys(compact[0]).sort(),
    ["available", "format", "id", "pageCount", "publisher", "series", "title"]
  );
  // The display title comes through the same merge the full record uses, so
  // the shelf and the detail screen never disagree about a corrected comic.
  assert.equal(compact[0].title, "Corrected Demo");
  assert.equal(compact[0].series, "Corrected Series");
  assert.equal(compact[0].id, comics[0].id);
  assert.equal(compact[0].pageCount, 1);
  assert.equal(compact[0].available, true);
  assert.equal(compact[0].format, "cbz");
  if (compact[0].publisher !== null) {
    assert.deepEqual(Object.keys(compact[0].publisher), ["name"]);
  }

  // `q` still filters, and still filters on the full record's searchable text
  // rather than on the seven fields that survive the projection.
  response = await fetch(`${base}/api/comics?view=compact&q=Corrected`);
  assert.equal(response.status, 200, logs);
  assert.equal((await response.json()).length, 1);
  response = await fetch(`${base}/api/comics?view=compact&q=nothingmatchesthis`);
  assert.equal((await response.json()).length, 0);

  // Anything other than the exact opt-in keeps the full record: an old client
  // must not be shortened by a typo.
  response = await fetch(`${base}/api/comics?view=full`);
  assert.ok((await response.json())[0].orderPath, logs);

  // One comic, in full, without opening the archive.
  response = await fetch(`${base}/api/comics/${comics[0].id}`);
  assert.equal(response.status, 200, logs);
  const oneComic = await response.json();
  assert.equal(oneComic.id, comics[0].id);
  assert.equal(oneComic.title, "Corrected Demo");
  assert.deepEqual(oneComic, correctedComic);

  response = await fetch(`${base}/api/comics/${"0".repeat(24)}`);
  assert.equal(response.status, 404, logs);
  assert.equal((await response.json()).error.code, "NOT_FOUND");

  response = await fetch(`${base}/opds`);
  assert.equal(response.status, 200, logs);
  assert.match(
    response.headers.get("content-type"),
    /profile=opds-catalog;kind=navigation/
  );
  const opdsRoot = await response.text();
  assert.match(opdsRoot, /<title>PanelShelf<\/title>/);
  assert.match(opdsRoot, /\/opds\/all/);
  assert.match(opdsRoot, /\/opds\/publishers/);
  assert.match(opdsRoot, /\/opds\/sources/);
  assert.match(opdsRoot, /\/opds\/orders/);
  assert.match(opdsRoot, /q=\{searchTerms\}/);

  response = await fetch(`${base}/opds/all`);
  assert.equal(response.status, 200, logs);
  const allFeed = await response.text();
  assert.match(allFeed, /<title>Corrected Demo<\/title>/);
  assert.match(
    allFeed,
    new RegExp(`/opds/comics/${comics[0].id}/file`)
  );
  assert.match(allFeed, new RegExp(`/api/comics/${comics[0].id}/cover`));

  response = await fetch(`${base}/opds/search?q=Demo`);
  assert.equal(response.status, 200, logs);
  assert.match(await response.text(), /<title>Corrected Demo<\/title>/);

  response = await fetch(`${base}/opds/comics/${comics[0].id}/file`);
  assert.equal(response.status, 200, logs);
  assert.equal(
    response.headers.get("content-type"),
    "application/vnd.comicbook+zip"
  );
  const comicArchive = Buffer.from(await response.arrayBuffer());
  assert.ok(comicArchive.length > ONE_PIXEL_PNG.length);

  response = await fetch(`${base}/opds/comics/${comics[0].id}/file`, {
    headers: { Range: "bytes=0-3" }
  });
  assert.equal(response.status, 206, logs);
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal((await response.arrayBuffer()).byteLength, 4);

  response = await fetch(`${base}/api/reading-orders`);
  assert.equal(response.status, 200, logs);
  let orders = await response.json();
  assert.equal(orders.automatic.length, 1);

  response = await fetch(`${base}/api/reading-orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Test chronology", comicIds: [comics[0].id] })
  });
  assert.equal(response.status, 201, logs);
  const manualOrder = await response.json();
  assert.equal(manualOrder.comicIds[0], comics[0].id);

  const comicId = comics[0].id;
  const progressBase = `${base}/api/progress`;

  const emptyProgress = await (await fetch(progressBase)).json();
  assert.deepEqual(emptyProgress, {});

  const written = await fetch(`${progressBase}/${comicId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pageIndex: 2, pageCount: 5 })
  });
  assert.equal(written.status, 200);
  const writtenRecord = await written.json();
  assert.equal(writtenRecord.pageIndex, 2);
  assert.ok(Date.parse(writtenRecord.lastReadAt) > 0);

  const listed = await (await fetch(progressBase)).json();
  assert.equal(listed[comicId].pageCount, 5);

  const single = await (await fetch(`${progressBase}/${comicId}`)).json();
  assert.equal(single.pageIndex, 2);

  const missing = await fetch(`${progressBase}/${"f".repeat(24)}`);
  assert.equal(missing.status, 404);

  const merged = await fetch(`${progressBase}/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      records: {
        [comicId]: { pageIndex: 4, pageCount: 5, lastReadAt: "2099-01-01T00:00:00.000Z" }
      }
    })
  });
  assert.equal(merged.status, 200);
  assert.equal((await merged.json())[comicId].pageIndex, 4);

  // The stored record now carries a far-future stamp, which merge would prefer
  // over any real client's. A batch is a deliberate write: it wins regardless.
  const batched = await fetch(`${progressBase}/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      records: {
        [comicId]: {
          pageIndex: 1,
          pageCount: 5,
          completed: true,
          lastReadAt: "2000-01-01T00:00:00.000Z"
        }
      },
      deleted: ["f".repeat(24)]
    })
  });
  assert.equal(batched.status, 200);
  const batchedRecords = await batched.json();
  assert.equal(batchedRecords[comicId].pageIndex, 1);
  assert.equal(batchedRecords[comicId].completed, true);
  assert.ok(
    Date.parse(batchedRecords[comicId].lastReadAt) < Date.parse("2099-01-01T00:00:00.000Z"),
    "the server restamps a batched record with its own clock"
  );

  const badBatch = await fetch(`${progressBase}/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deleted: "nope" })
  });
  assert.equal(badBatch.status, 400);

  const removed = await fetch(`${progressBase}/${comicId}`, { method: "DELETE" });
  assert.equal(removed.status, 200);
  assert.deepEqual(await removed.json(), { deleted: true, id: comicId });
  assert.deepEqual(await (await fetch(progressBase)).json(), {});

  // Leave one record in place: the backup assertions later in this test count
  // progress records, and after Task 6 that count comes from the store.
  await fetch(`${progressBase}/${comicId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pageIndex: 0, pageCount: 1, completed: true })
  });

  response = await fetch(`${base}/api/metadata/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      enabled: false,
      permissionConfirmed: true,
      token: "backup-must-not-contain-this-token"
    })
  });
  assert.equal(response.status, 200, logs);

  // Skipped branches are server-owned now, like progress: the export reads them
  // from the store and ignores whatever the caller sends. Record one first, and
  // send a different one below to prove the caller's copy is not what is kept.
  response = await fetch(`${base}/api/skips`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ add: ["chronology/source:demo/folder:kept"] })
  });
  assert.equal(response.status, 200, logs);
  assert.deepEqual((await response.json()).nodeIds, [
    "chronology/source:demo/folder:kept"
  ]);

  response = await fetch(`${base}/api/backup/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      browser: {
        progress: {
          [comics[0].id]: {
            pageIndex: 0,
            pageCount: 1,
            completed: true,
            lastReadAt: "2026-07-31T12:00:00.000Z"
          }
        },
        libraryView: "chronological",
        chronologyPreferences: {
          skippedNodeIds: ["root/source/folder:demo"],
          hideSkipped: true,
          layout: "timeline"
        },
        reader: { fit: "height", mode: "continuous" }
      }
    })
  });
  assert.equal(response.status, 200, logs);
  const backup = await response.json();
  assert.equal(backup.format, "panelshelf-backup");
  assert.equal(backup.schemaVersion, 1);
  assert.equal(backup.data.config.sources.length, 1);
  assert.equal(backup.data.readingOrders.orders.length, 1);
  assert.equal(Object.keys(backup.data.metadataOverrides).length, 1);
  assert.equal(backup.data.browser.libraryView, "chronological");
  assert.equal(backup.data.browser.chronologyPreferences.layout, "timeline");
  assert.deepEqual(
    backup.data.browser.chronologyPreferences.skippedNodeIds,
    ["chronology/source:demo/folder:kept"],
    "the store's set is exported, not the caller's"
  );
  assert.doesNotMatch(
    JSON.stringify(backup),
    /server-test-secret|backup-must-not-contain-this-token/
  );

  response = await fetch(`${base}/api/backup/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(backup)
  });
  assert.equal(response.status, 200, logs);
  const backupPreview = await response.json();
  assert.equal(backupPreview.sourceCount, 1);
  assert.equal(backupPreview.sourceStatuses.length, 1);
  assert.equal(backupPreview.readingOrders, 1);
  assert.equal(backupPreview.progressRecords, 1);
  assert.equal(backupPreview.skippedFolders, 1);
  assert.equal(backupPreview.metadataOverrides, 1);

  response = await fetch(`${base}/api/backup/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(backup)
  });
  assert.equal(response.status, 200, logs);
  const restoredBackup = await response.json();
  assert.equal(restoredBackup.restored, true);
  assert.equal(restoredBackup.browser.reader.mode, "continuous");
  assert.equal(
    restoredBackup.browser.chronologyPreferences.layout,
    "timeline"
  );
  // A restore puts the backup's skipped branches back into the store, so a
  // backup taken before they moved off the browser is not silently dropped.
  assert.deepEqual((await (await fetch(`${base}/api/skips`)).json()).nodeIds, [
    "chronology/source:demo/folder:kept"
  ]);

  // And a restore replaces the set rather than merging into it.
  await fetch(`${base}/api/skips`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ add: ["chronology/source:demo/folder:added-later"] })
  });
  response = await fetch(`${base}/api/backup/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(backup)
  });
  assert.equal(response.status, 200, logs);
  assert.deepEqual((await (await fetch(`${base}/api/skips`)).json()).nodeIds, [
    "chronology/source:demo/folder:kept"
  ]);

  response = await fetch(`${base}/api/comics/${comics[0].id}/metadata/override`, {
    method: "DELETE"
  });
  assert.equal(response.status, 200, logs);
  correctedComic = await response.json();
  assert.equal(correctedComic.title, "Demo");
  assert.equal(correctedComic.manualOverride, null);

  response = await fetch(
    `${base}/opds/order?id=${encodeURIComponent(manualOrder.id)}`
  );
  assert.equal(response.status, 200, logs);
  assert.match(await response.text(), /<title>Demo<\/title>/);

  response = await fetch(`${base}/api/reading-orders/${manualOrder.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Renamed chronology",
      comicIds: manualOrder.comicIds
    })
  });
  assert.equal(response.status, 200, logs);
  assert.equal((await response.json()).name, "Renamed chronology");

  response = await fetch(
    `${base}/api/reading-orders/${manualOrder.id}/duplicate`,
    { method: "POST" }
  );
  assert.equal(response.status, 201, logs);
  const duplicate = await response.json();

  response = await fetch(`${base}/api/reading-orders/${duplicate.id}`, {
    method: "DELETE"
  });
  assert.equal(response.status, 200, logs);
  orders = await (await fetch(`${base}/api/reading-orders`)).json();
  assert.equal(orders.manual.length, 1);

  response = await fetch(`${base}/api/comics/${comics[0].id}/pages/0`);
  assert.equal(response.status, 200, logs);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), ONE_PIXEL_PNG);

  response = await fetch(`${base}/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Your comics/);
});

test("the chronology is browsable one node at a time", async (t) => {
  const { base, comicsDirectory, state } = await startServer(t);

  // A hierarchical timeline: two numbered eras whose order is not their
  // alphabetical order, plus a staging folder that must stay out of it.
  const page = () => zipBuffer([{ name: "page.png", data: ONE_PIXEL_PNG }]);
  for (const [folder, name] of [
    ["0010 Alpha Era", "Later.cbz"],
    ["0002 Zulu Era", "Earlier.cbz"],
    ["_staging", "Unfiled.cbz"]
  ]) {
    await fsp.mkdir(path.join(comicsDirectory, folder), { recursive: true });
    await fsp.writeFile(path.join(comicsDirectory, folder, name), page());
  }

  let response = await fetch(`${base}/api/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sources: [
        { path: comicsDirectory, name: "Comics", profile: "hierarchical-timeline" }
      ]
    })
  });
  assert.equal(response.status, 200, state.logs);
  await fetch(`${base}/api/scan`, { method: "POST" });
  await waitFor(`${base}/api/comics`, (body) => body.length === 3);

  const root = await (await fetch(`${base}/api/chronology`)).json();
  assert.equal(root.node.id, "chronology");
  assert.equal(root.children.length, 1, "one source");
  const source = root.children[0];
  assert.equal(source.role, "source");

  const level = await (
    await fetch(`${base}/api/chronology?node=${encodeURIComponent(source.id)}`)
  ).json();
  assert.deepEqual(
    level.children.map((node) => node.displayName),
    ["Zulu Era", "Alpha Era", "Unfiled"],
    "era 2 before era 10 though it is called Zulu, and staging last"
  );
  assert.deepEqual(
    level.children.map((node) => node.orderNumber),
    [1, 2, null],
    "position chips count the numbered siblings"
  );
  assert.deepEqual(level.breadcrumbs.map((crumb) => crumb.id), ["chronology", source.id]);

  // The comics inside a branch are projected like any other compact list.
  const era = await (
    await fetch(`${base}/api/chronology?node=${encodeURIComponent(level.children[0].id)}`)
  ).json();
  assert.deepEqual(era.comics.map((comic) => comic.title), ["Earlier"]);
  assert.deepEqual(
    Object.keys(era.comics[0]).sort(),
    ["available", "format", "id", "pageCount", "publisher", "series", "title"]
  );

  // An id that is not in the tree is a 404, not an empty screen.
  response = await fetch(`${base}/api/chronology?node=chronology/source:nope`);
  assert.equal(response.status, 404, state.logs);
  assert.equal((await response.json()).error.code, "NOT_FOUND");
});

test("the archive is downloadable over a first-party path, with ranges", async (t) => {
  const { base, comicsDirectory, state } = await startServer(t);
  const archive = zipBuffer([
    { name: "001.png", data: ONE_PIXEL_PNG },
    { name: "002.png", data: ONE_PIXEL_PNG }
  ]);
  await fsp.writeFile(path.join(comicsDirectory, "Downloadable.cbz"), archive);

  let response = await fetch(`${base}/api/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ libraryPaths: [comicsDirectory] })
  });
  assert.equal(response.status, 200, state.logs);
  await fetch(`${base}/api/scan`, { method: "POST" });
  const comics = await waitFor(`${base}/api/comics`, (body) => body.length === 1);
  const id = comics[0].id;

  // The whole file, byte for byte — this is what gets read offline, so a
  // truncated or re-encoded copy would be a comic that opens to nothing.
  response = await fetch(`${base}/api/comics/${id}/file`);
  assert.equal(response.status, 200, state.logs);
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  const downloaded = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(downloaded, archive, "the archive arrives unchanged");

  // A HEAD tells a client how big the download is before it starts.
  response = await fetch(`${base}/api/comics/${id}/file`, { method: "HEAD" });
  assert.equal(response.status, 200, state.logs);
  assert.equal(Number(response.headers.get("content-length")), archive.length);

  // Ranges, so an interrupted download of a 4 GB comic can resume rather than
  // start again.
  response = await fetch(`${base}/api/comics/${id}/file`, {
    headers: { Range: `bytes=10-19` }
  });
  assert.equal(response.status, 206, state.logs);
  assert.equal(
    response.headers.get("content-range"),
    `bytes 10-19/${archive.length}`
  );
  assert.deepEqual(
    Buffer.from(await response.arrayBuffer()),
    archive.subarray(10, 20)
  );

  // An open-ended range is what a resume actually sends.
  response = await fetch(`${base}/api/comics/${id}/file`, {
    headers: { Range: `bytes=${archive.length - 5}-` }
  });
  assert.equal(response.status, 206, state.logs);
  assert.deepEqual(
    Buffer.from(await response.arrayBuffer()),
    archive.subarray(archive.length - 5)
  );

  // A nonsense range is refused rather than answered with the whole file.
  response = await fetch(`${base}/api/comics/${id}/file`, {
    headers: { Range: "bytes=99999999-" }
  });
  assert.equal(response.status, 416, state.logs);

  // And an id that is not a comic is a 404, not a path traversal.
  response = await fetch(`${base}/api/comics/${"f".repeat(24)}/file`);
  assert.equal(response.status, 404, state.logs);
});

test("asking for a comic file that does not exist answers rather than dying", async (t) => {
  // This took the whole server down. `serveComicArchive` throws NOT_FOUND for
  // an unknown id, and the route returned its promise from inside a try —
  // which does not route a rejection to the catch. Nothing answered the
  // request, Node saw an unhandled rejection, and the process exited: one
  // request for an id that is not in the index stopped PanelShelf for
  // everybody. The OPDS route has had the same hole since 0.3.9.
  const { base, state } = await startServer(t);
  const missing = "f".repeat(24);

  for (const path of [`/api/comics/${missing}/file`, `/opds/comics/${missing}/file`]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 404, `${path}: ${state.logs}`);
    assert.equal((await response.json()).error.code, "NOT_FOUND");
  }

  // Still serving afterwards, which is the whole point.
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200, state.logs);
  assert.equal((await health.json()).status, "ok");
});

/// A raw request, because `fetch` derives `Host` from the URL and refuses to
/// let a caller forge it. DNS rebinding turns on exactly that header, so a
/// test for it has to be able to lie.
function rawRequest(port, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path: options.path,
        method: options.method || "GET",
        headers: options.headers || {}
      },
      (response) => {
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () =>
          resolve({ status: response.statusCode, body })
        );
      }
    );
    request.on("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

test("a request announcing a foreign origin is refused", async (t) => {
  // PanelShelf has no accounts, so it trusts whoever can reach it. On a LAN
  // that includes every page the household's browsers visit: a page on the
  // public internet can post to 192.168.x.x and the browser will deliver it,
  // from inside the network, unprompted. Nothing is stolen along the way —
  // there is no session to steal — the attacker just borrows a browser that
  // is already indoors. The origin is the only thing that separates the
  // shelf's own page from a hostile one, so a foreign one loses here, before
  // any route runs.
  const { base, port, state } = await startServer(t);

  const response = await rawRequest(port, {
    method: "PUT",
    path: "/api/config",
    headers: {
      Origin: "http://evil.example",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ libraryPaths: [] })
  });

  assert.equal(response.status, 403, state.logs);
  assert.equal(JSON.parse(response.body).error.code, "FORBIDDEN_ORIGIN");

  // Still answering afterwards: the guard refuses a request, not the server.
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200, state.logs);
});

test("a request carrying no origin is allowed, so native clients still work", async (t) => {
  // The iPad app and every OPDS reader are not browsers and send no Origin at
  // all. Refusing on a missing origin would lock out precisely the clients
  // that were never the threat.
  const { comicsDirectory, port, state } = await startServer(t);

  const response = await rawRequest(port, {
    method: "PUT",
    path: "/api/config",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ libraryPaths: [comicsDirectory] })
  });

  assert.equal(response.status, 200, state.logs);
});

test("the shelf's own page is still allowed to drive the API", async (t) => {
  // The guard is worthless if it also blocks the browser reader PanelShelf
  // serves itself.
  const { comicsDirectory, port, state } = await startServer(t);

  const response = await rawRequest(port, {
    method: "PUT",
    path: "/api/config",
    headers: {
      Origin: `http://127.0.0.1:${port}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ libraryPaths: [comicsDirectory] })
  });

  assert.equal(response.status, 200, state.logs);
});

test("a POST that dodges preflight with a safelisted content type is refused", async (t) => {
  // POST is the one mutating method a browser will send cross-origin without
  // asking permission first, and only while its content type is one of the
  // three CORS-safelisted ones. `fetch(url, {method:"POST", mode:"no-cors",
  // body:"{}"})` defaults to text/plain, sends no preflight, and the body is
  // still valid JSON on arrival — which is the whole trick. Requiring the
  // JSON content type takes that door away: anything else has to preflight,
  // and preflight is answered by nobody.
  const { port, state } = await startServer(t);

  const response = await rawRequest(port, {
    method: "POST",
    path: "/api/skips",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ add: [] })
  });

  assert.equal(response.status, 415, state.logs);
  assert.equal(JSON.parse(response.body).error.code, "UNSUPPORTED_MEDIA_TYPE");
});

test("a forged host header is refused, which is what rebinding rests on", async (t) => {
  // DNS rebinding: a page on evil.example, whose record has just been pointed
  // at the NAS, is same-origin with the NAS as far as the browser is
  // concerned — so the attacker can read replies, not merely fire writes. The
  // request still has to arrive claiming to be for evil.example, so checking
  // the host it claims is what closes it.
  const { port, state } = await startServer(t);

  const response = await rawRequest(port, {
    method: "GET",
    path: "/api/config",
    headers: { Host: "evil.example" }
  });

  assert.equal(response.status, 403, state.logs);
  assert.equal(JSON.parse(response.body).error.code, "FORBIDDEN_HOST");
});

test("the cover cache reports what it holds and whether a warm-up is running", async (t) => {
  const { base, comicsDirectory, state } = await startServer(t);

  await fetch(`${base}/api/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ libraryPaths: [comicsDirectory] })
  });

  const response = await fetch(`${base}/api/covers/cache`);
  assert.equal(response.status, 200, state.logs);
  const body = await response.json();
  assert.deepEqual(
    body.cache,
    { comics: 0, covers: 0, thumbnails: 0, bytes: 0 },
    "an empty library has cached nothing"
  );
  assert.equal(body.warmup.status, "idle");
});

test("warming the cache fills it for every comic, once", async (t) => {
  // Thumbnails are generated on first request, which is right for browsing and
  // wrong for a library that was just scanned — the first browse pays a decode
  // per card on NAS CPU. This is the deliberate version of that work.
  const { base, comicsDirectory, state } = await startServer(t);

  await fetch(`${base}/api/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ libraryPaths: [comicsDirectory] })
  });
  for (const name of ["Alpha", "Bravo"]) {
    await fsp.writeFile(
      path.join(comicsDirectory, `${name}.cbz`),
      zipBuffer([{ name: "page.png", data: ONE_PIXEL_PNG }])
    );
  }
  await fetch(`${base}/api/scan`, { method: "POST" });
  await waitFor(`${base}/api/comics`, (body) => body.length === 2);

  const started = await fetch(`${base}/api/covers/cache/warm`, { method: "POST" });
  assert.equal(started.status, 200, state.logs);

  const done = await waitFor(
    `${base}/api/covers/cache`,
    (body) => body.warmup.status === "complete"
  );
  assert.equal(done.warmup.total, 2, state.logs);
  assert.equal(done.warmup.generated, 2);
  assert.equal(done.warmup.failed, 0);
  assert.equal(done.cache.comics, 2, "the cache now records both comics");

  // A second pass over a warm library finds nothing to do, rather than doing it
  // all again.
  await fetch(`${base}/api/covers/cache/warm`, { method: "POST" });
  const again = await waitFor(
    `${base}/api/covers/cache`,
    (body) => body.warmup.status === "complete" && body.warmup.startedAt !== done.warmup.startedAt
  );
  assert.equal(again.warmup.generated, 0, state.logs);
  assert.equal(again.warmup.alreadyCached, 2);
});

async function enablePairing(base) {
  const response = await fetch(`${base}/api/devices/enable`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "This browser" })
  });
  return { status: response.status, body: await response.json() };
}

test("with pairing off, nothing needs a token", async (t) => {
  // The default, and the upgrade path: an install that never opts in must not
  // notice that any of this exists.
  const { base, state } = await startServer(t);

  assert.equal((await fetch(`${base}/api/comics`)).status, 200, state.logs);
  const devices = await (await fetch(`${base}/api/devices`)).json();
  assert.equal(devices.enabled, false);
  assert.deepEqual(devices.devices, []);
});

test("enabling pairing hands a token to the browser that enabled it", async (t) => {
  // Otherwise turning it on locks the owner out of the page they turned it on
  // from, and the only way back is a text editor over SSH.
  const { base, state } = await startServer(t);

  const enabled = await enablePairing(base);
  assert.equal(enabled.status, 200, state.logs);
  assert.match(enabled.body.token, /^pst_/, "a usable token, returned once");
  assert.equal(enabled.body.enabled, true);

  const withToken = await fetch(`${base}/api/comics`, {
    headers: { Authorization: `Bearer ${enabled.body.token}` }
  });
  assert.equal(withToken.status, 200, state.logs);
});

test("with pairing on, a request carrying no token is refused", async (t) => {
  const { base, state } = await startServer(t);
  await enablePairing(base);

  const response = await fetch(`${base}/api/comics`);
  assert.equal(response.status, 401, state.logs);
  assert.equal((await response.json()).error.code, "UNAUTHORIZED");
});

test("a revoked device is refused on its very next request", async (t) => {
  // The milestone's release gate. Revocation drops the hash, so there is
  // nothing left to match rather than a flag to check.
  const { base, state } = await startServer(t);
  const { body } = await enablePairing(base);
  const auth = { Authorization: `Bearer ${body.token}` };

  const listed = await (await fetch(`${base}/api/devices`, { headers: auth })).json();
  assert.equal(listed.devices.length, 1, state.logs);

  const revoked = await fetch(`${base}/api/devices/${listed.devices[0].id}`, {
    method: "DELETE",
    headers: auth
  });
  assert.equal(revoked.status, 200, state.logs);

  assert.equal((await fetch(`${base}/api/comics`, { headers: auth })).status, 401);
});

test("health and discovery stay open, so a client can still find the server", async (t) => {
  // A client that cannot reach /api/health cannot tell "wrong address" from
  // "not paired", and the iPad's connection screen is built on that difference.
  const { base, state } = await startServer(t);
  await enablePairing(base);

  assert.equal((await fetch(`${base}/api/health`)).status, 200, state.logs);
  assert.equal((await fetch(`${base}/api/discovery`)).status, 200, state.logs);
});

test("a pairing code turns into a token without needing a token", async (t) => {
  // The whole point: a new device has no credential yet, so the pairing route
  // cannot require one. The code is the credential, and it lasts minutes.
  const { base, state } = await startServer(t);
  const { body } = await enablePairing(base);
  const auth = { Authorization: `Bearer ${body.token}` };

  const code = await (
    await fetch(`${base}/api/devices/pairing-code`, { method: "POST", headers: auth })
  ).json();
  assert.match(code.code, /^[A-Z2-9]{8}$/, state.logs);

  const paired = await fetch(`${base}/api/devices/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: code.code, name: "Raidel's iPad" })
  });
  assert.equal(paired.status, 200, state.logs);
  const issued = await paired.json();
  assert.match(issued.token, /^pst_/);

  const used = await fetch(`${base}/api/comics`, {
    headers: { Authorization: `Bearer ${issued.token}` }
  });
  assert.equal(used.status, 200, state.logs);
});

test("a wrong pairing code is refused", async (t) => {
  const { base, state } = await startServer(t);
  await enablePairing(base);

  const response = await fetch(`${base}/api/devices/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "AAAAAAAA", name: "Chancer" })
  });
  assert.equal(response.status, 400, state.logs);
  assert.equal((await response.json()).error.code, "INVALID_PAIRING_CODE");
});

test("OPDS takes the token as Basic auth, which is all a reader can send", async (t) => {
  // Third-party OPDS readers speak HTTP Basic and nothing else. Leaving the
  // catalog open while claiming the server is paired would be a lie, and
  // requiring Bearer would lock every reader out.
  const { base, state } = await startServer(t);
  const { body } = await enablePairing(base);

  assert.equal((await fetch(`${base}/opds`)).status, 401, state.logs);

  const basic = Buffer.from(`panelshelf:${body.token}`).toString("base64");
  const authorized = await fetch(`${base}/opds`, {
    headers: { Authorization: `Basic ${basic}` }
  });
  assert.equal(authorized.status, 200, state.logs);
});
