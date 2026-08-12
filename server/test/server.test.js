"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fsp = require("node:fs/promises");
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
