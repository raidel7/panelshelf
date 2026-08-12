"use strict";

const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const publicDirectory = path.resolve(__dirname, "../public");

test("browser application parses and ships reading orders and reader modes", async () => {
  const [application, document, styles] = await Promise.all([
    fsp.readFile(path.join(publicDirectory, "app.js"), "utf8"),
    fsp.readFile(path.join(publicDirectory, "index.html"), "utf8"),
    fsp.readFile(path.join(publicDirectory, "styles.css"), "utf8")
  ]);

  assert.doesNotThrow(() => new vm.Script(application, { filename: "app.js" }));
  assert.match(document, /id="structureDialog"/);
  assert.match(document, /value="hierarchical-timeline"/);
  assert.match(document, /value="exact-reading-order"/);
  assert.match(document, /id="ordersDialog"/);
  assert.match(document, /id="orderEditorDialog"/);
  assert.match(document, /id="continueSection"/);
  assert.match(document, /id="libraryViews"/);
  assert.match(document, /data-view="publisher"/);
  assert.match(document, /data-view="chronological"/);
  assert.match(document, /id="browseView"/);
  assert.match(document, /id="unfiledShelfButton"/);
  assert.match(document, /id="skippedFilterButton"/);
  assert.match(document, /id="chronologyLayoutToggle"/);
  assert.match(document, /data-chronology-layout="timeline"/);
  assert.match(document, /id="chronologyTimeline"/);
  assert.match(document, /id="scanMenu"/);
  assert.match(document, /data-scan-action="quick"/);
  assert.match(document, /data-scan-action="retry"/);
  assert.match(document, /data-scan-action="full"/);
  assert.match(document, /data-status="skipped"/);
  assert.match(document, /id="collectionPreview"/);
  assert.match(document, /id="collectionPreviewImage"/);
  assert.match(document, /id="metadataSettingsDialog"/);
  assert.match(document, /id="metadataDialog"/);
  assert.match(document, /id="metadataEditorDialog"/);
  assert.match(document, /id="bulkMetadataDialog"/);
  assert.match(document, /id="bulkMetadataAction"/);
  assert.match(document, /class="bulk-progress-track"/);
  assert.doesNotMatch(document, /<progress\b/);
  assert.match(document, /id="readerClose"[^>]*aria-label="Back to library"/);
  assert.match(document, /id="metadataEditSummary"/);
  assert.match(document, /id="exportBackupButton"/);
  assert.match(document, /id="importBackupButton"/);
  assert.match(document, /id="backupFileInput"/);
  assert.match(document, /id="metadataPermissionConfirmed"/);
  assert.match(document, /id="metadataEdition"/);
  assert.match(document, /value="trade-paperback"/);
  assert.match(document, /id="metadataSearchResults"/);
  assert.match(document, /Review before attaching/);
  assert.match(document, /Embedded ComicInfo\.xml values stay authoritative/);
  assert.match(document, /value="continuous"/);
  assert.match(document, /id="metadataSearchProvider"/);
  assert.match(document, /value="gcd"/);
  assert.match(document, /value="openlibrary"/);
  assert.doesNotMatch(document, /comicvine/i);
  assert.match(document, /styles\.css\?v=0\.4\.3-1024/);
  assert.match(document, /app\.js\?v=0\.4\.3-1024/);
  assert.match(application, /nextComicInReaderOrder/);
  assert.match(application, /PROGRESS_STORAGE_KEY/);
  assert.match(application, /LIBRARY_VIEW_STORAGE_KEY/);
  assert.match(application, /CHRONOLOGY_PREFERENCES_STORAGE_KEY/);
  assert.match(application, /chronologyOrderNumber/);
  assert.match(application, /orderedSiblings\.indexOf\(node\)/);
  assert.match(application, /browserBackupState/);
  assert.match(application, /restoreBackupFile/);
  assert.match(application, /toggleChronologyNodeSkipped/);
  assert.match(application, /hideSkippedChronology/);
  assert.match(application, /collectionTitleSizeClass/);
  assert.match(application, /showCollectionPreview/);
  assert.match(application, /positionCollectionPreview/);
  assert.match(application, /setComicShelfStatus/);
  assert.match(application, /comicStatusControl/);
  assert.match(application, /collectionStatusControl/);
  assert.match(application, /loadedImageUrls/);
  assert.match(application, /focusChronologyTimeline/);
  assert.match(application, /pollBulkMetadata/);
  assert.match(application, /reconcileBulkMetadataResults/);
  assert.doesNotMatch(application, /bulkMetadataResults\.replaceChildren/);
  assert.match(application, /renderUnfiledView/);
  assert.match(application, /stagingBySource/);
  assert.match(application, /readingStatus\(comic\) !== "skipped"/);
  assert.match(application, /comicMetadataLine/);
  assert.match(application, /renderScanSourceActions/);
  assert.match(application, /action: "source"/);
  assert.match(application, /openMetadataSettings/);
  assert.match(styles, /\.collection-order-number[\s\S]*font-size: 16px/);
  assert.match(styles, /\.data-backup-callout/);
  assert.match(application, /searchMetadata/);
  assert.match(application, /inferMetadataSearchDefaults/);
  assert.match(application, /confirmMetadataMatch/);
  assert.match(application, /removeMetadataMatch/);
  assert.match(application, /Find online metadata/);
  assert.match(application, /Edit metadata/);
  assert.match(application, /saveMetadataOverride/);
  assert.match(application, /renderPublisherView/);
  assert.match(application, /renderChronologicalView/);
  assert.match(application, /renderFocusedTimeline/);
  assert.match(application, /Current publication year/);
  assert.match(application, /comic\.inferredMetadata\?\.year/);
  assert.match(styles, /\.collection-order-number/);
  assert.match(styles, /\.collection-card\.skipped/);
  assert.match(styles, /\.skip-filter-chip/);
  assert.match(styles, /\.collection-title-xlong/);
  assert.match(styles, /\.collection-hover-preview\.visible/);
  assert.match(styles, /\.focused-timeline/);
  assert.match(styles, /\.timeline-rail/);
  assert.match(styles, /\.timeline-cover-item\.active/);
  assert.match(styles, /\.comic-more-button/);
  assert.match(styles, /\.comic-status-menu/);
  assert.match(styles, /\.unfiled-collection/);
  assert.match(styles, /\.reading-badge\.skipped/);
  assert.match(styles, /\.metadata-badge/);
  assert.match(styles, /\.online-metadata-badge/);
  assert.match(styles, /\.metadata-comparison/);
  assert.match(styles, /\.metadata-editor-fields/);
  assert.match(styles, /\.manual-metadata-badge/);
  assert.match(styles, /\.provider-card/);
  assert.match(styles, /\.scan-menu/);
  assert.match(styles, /\.scan-action/);
  assert.match(styles, /\.bulk-metadata-dialog/);
  assert.match(styles, /\.bulk-metadata-dialog::backdrop[\s\S]*backdrop-filter: none/);
  assert.match(styles, /\.reader-back-button/);
  assert.match(styles, /\.collection-status-control/);
});

// app.js has no module system, so the progress block is sliced out of the
// source and run in a sandbox with stubs for the handful of globals it uses.
// Text matching cannot tell whether these requests are actually made, and the
// bugs this guards against were all behavioural.
const COMIC_A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const COMIC_B = "bbbbbbbbbbbbbbbbbbbbbbbb";

const progressSource = (async () => {
  const source = await fsp.readFile(
    path.join(publicDirectory, "app.js"),
    "utf8"
  );
  const constants = source.match(
    /^const PROGRESS_STORAGE_KEY = "[^"]+";\nconst PROGRESS_MIGRATED_KEY = "panelshelf\.progress\.migrated\.v1";$/m
  );
  assert.ok(constants, "app.js must declare both progress storage keys");
  const start = source.indexOf("\nconst progressPushTimers = new Map();");
  const end = source.indexOf("\nfunction persistReaderPreferences()");
  assert.ok(
    start > 0 && end > start,
    "app.js must keep the progress block between its usual anchors"
  );
  return `${constants[0]}\n${source.slice(start, end)}`;
})();

function progressSandbox(options = {}) {
  const calls = [];
  const timers = new Map();
  const storage = new Map();
  let nextTimer = 1;
  if (options.migrated) storage.set("panelshelf.progress.migrated.v1", "1");

  const context = {
    state: { progress: { ...(options.progress || {}) } },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => {
        if (options.storageFails) throw new Error("QuotaExceededError");
        storage.set(key, value);
      }
    },
    setTimeout: (fn) => {
      const id = nextTimer++;
      timers.set(id, fn);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    fetch: (url, init = {}) => {
      calls.push({
        url,
        method: init.method || "GET",
        body: init.body ? JSON.parse(init.body) : null
      });
      if (options.fetchFails) return Promise.reject(new Error("offline"));
      if (url === "/api/progress") {
        return Promise.resolve({
          ok: true,
          json: async () => {
            if (options.duringRead) options.duringRead(context);
            return { ...(options.remote || {}) };
          }
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }
  };

  vm.createContext(context);
  return {
    context,
    calls,
    storage,
    ready: progressSource.then((source) => vm.runInContext(source, context)),
    run: (expression) => vm.runInContext(expression, context),
    // Objects built inside the sandbox have that realm's prototypes, which
    // deepStrictEqual rejects, so compare progress through JSON.
    progress: () => JSON.parse(vm.runInContext("JSON.stringify(state.progress)", context)),
    fireTimers: () => {
      const pending = [...timers.values()];
      timers.clear();
      for (const fn of pending) fn();
    },
    pendingTimers: () => timers.size
  };
}

test("repeated writes to one comic coalesce into a single PUT", async () => {
  const sandbox = progressSandbox({ migrated: true });
  await sandbox.ready;

  sandbox.context.state.progress[COMIC_A] = { pageIndex: 1, pageCount: 9 };
  sandbox.run(`persistProgress("${COMIC_A}")`);
  sandbox.context.state.progress[COMIC_A] = { pageIndex: 2, pageCount: 9 };
  sandbox.run(`persistProgress("${COMIC_A}")`);
  assert.equal(sandbox.calls.length, 0, "the push is debounced, not immediate");

  sandbox.fireTimers();
  assert.equal(sandbox.calls.length, 1);
  assert.deepEqual(sandbox.calls[0], {
    url: `/api/progress/${COMIC_A}`,
    method: "PUT",
    body: { pageIndex: 2, pageCount: 9 }
  });
  assert.equal(
    JSON.parse(sandbox.storage.get("panelshelf.progress.v1"))[COMIC_A].pageIndex,
    2,
    "the local cache is written even before the push"
  );
});

test("clearing a comic's progress sends a DELETE", async () => {
  const sandbox = progressSandbox({
    migrated: true,
    progress: { [COMIC_A]: { pageIndex: 4 } }
  });
  await sandbox.ready;

  sandbox.run(`delete state.progress["${COMIC_A}"]; persistProgress("${COMIC_A}")`);
  sandbox.fireTimers();

  assert.deepEqual(sandbox.calls, [
    { url: `/api/progress/${COMIC_A}`, method: "DELETE", body: null }
  ]);
});

test("a whole-collection change sends one merge plus deletes, not one request per comic", async () => {
  const sandbox = progressSandbox({
    migrated: true,
    progress: {
      [COMIC_A]: { pageIndex: 8, completed: true },
      [COMIC_B]: { pageIndex: 3 }
    }
  });
  await sandbox.ready;

  sandbox.run(
    `delete state.progress["${COMIC_B}"]; persistProgress(["${COMIC_A}", "${COMIC_B}"])`
  );

  assert.equal(sandbox.pendingTimers(), 0, "a batch is sent without debouncing");
  assert.equal(sandbox.calls.length, 2);
  assert.deepEqual(sandbox.calls[0], {
    url: "/api/progress/merge",
    method: "POST",
    body: { records: { [COMIC_A]: { pageIndex: 8, completed: true } } }
  });
  assert.deepEqual(sandbox.calls[1], {
    url: `/api/progress/${COMIC_B}`,
    method: "DELETE",
    body: null
  });
});

test("local progress migrates once, in order, and marks the browser migrated", async () => {
  const sandbox = progressSandbox({
    progress: { [COMIC_A]: { pageIndex: 5 } },
    remote: { [COMIC_A]: { pageIndex: 5 }, [COMIC_B]: { pageIndex: 1 } }
  });
  await sandbox.ready;

  await sandbox.run("loadProgressFromServer()");

  assert.deepEqual(
    sandbox.calls.map((call) => `${call.method} ${call.url}`),
    ["POST /api/progress/merge", "GET /api/progress"]
  );
  assert.deepEqual(sandbox.calls[0].body, {
    records: { [COMIC_A]: { pageIndex: 5 } }
  });
  assert.equal(sandbox.storage.get("panelshelf.progress.migrated.v1"), "1");
  assert.deepEqual(sandbox.progress(), {
    [COMIC_A]: { pageIndex: 5 },
    [COMIC_B]: { pageIndex: 1 }
  });

  // A second load must not push the server's own records back at it.
  await sandbox.run("loadProgressFromServer()");
  assert.deepEqual(
    sandbox.calls.map((call) => `${call.method} ${call.url}`),
    ["POST /api/progress/merge", "GET /api/progress", "GET /api/progress"]
  );
});

test("a browser with no local progress is marked migrated without merging", async () => {
  const sandbox = progressSandbox({ remote: { [COMIC_A]: { pageIndex: 2 } } });
  await sandbox.ready;

  await sandbox.run("loadProgressFromServer()");

  assert.deepEqual(
    sandbox.calls.map((call) => `${call.method} ${call.url}`),
    ["GET /api/progress"]
  );
  assert.equal(sandbox.storage.get("panelshelf.progress.migrated.v1"), "1");
});

test("an unwritable cache still stops the migration from repeating", async () => {
  const sandbox = progressSandbox({
    storageFails: true,
    progress: { [COMIC_A]: { pageIndex: 5 } },
    remote: { [COMIC_A]: { pageIndex: 5 } }
  });
  await sandbox.ready;

  await sandbox.run("loadProgressFromServer()");
  await sandbox.run("loadProgressFromServer()");

  assert.equal(
    sandbox.calls.filter((call) => call.url === "/api/progress/merge").length,
    1,
    "the second load must not re-upload records the server already has"
  );
});

test("a page turn during the read survives instead of being overwritten", async () => {
  const sandbox = progressSandbox({
    migrated: true,
    progress: { [COMIC_A]: { pageIndex: 3 }, [COMIC_B]: { pageIndex: 7 } },
    remote: { [COMIC_A]: { pageIndex: 3 }, [COMIC_B]: { pageIndex: 7 } },
    duringRead: (context) => {
      // The reader turns a page in A and is marked unread in B while the GET
      // is still in flight; both changes are queued, not yet sent.
      vm.runInContext(
        `state.progress["${COMIC_A}"] = { pageIndex: 4 };` +
          `persistProgress("${COMIC_A}");` +
          `delete state.progress["${COMIC_B}"];` +
          `persistProgress("${COMIC_B}");`,
        context
      );
    }
  });
  await sandbox.ready;

  await sandbox.run("loadProgressFromServer()");

  assert.deepEqual(sandbox.progress(), { [COMIC_A]: { pageIndex: 4 } });

  // The queued pushes must carry the reader's values, not the server's.
  sandbox.fireTimers();
  const pushes = sandbox.calls.filter((call) => call.method !== "GET");
  assert.deepEqual(pushes, [
    {
      url: `/api/progress/${COMIC_A}`,
      method: "PUT",
      body: { pageIndex: 4 }
    },
    { url: `/api/progress/${COMIC_B}`, method: "DELETE", body: null }
  ]);
});

test("an unreachable server leaves the cached progress alone", async () => {
  const sandbox = progressSandbox({
    migrated: true,
    fetchFails: true,
    progress: { [COMIC_A]: { pageIndex: 6 } }
  });
  await sandbox.ready;

  await sandbox.run("loadProgressFromServer()");

  assert.deepEqual(sandbox.progress(), { [COMIC_A]: { pageIndex: 6 } });

  // A write while offline still updates the cache and never throws.
  sandbox.run(`state.progress["${COMIC_A}"] = { pageIndex: 7 }; persistProgress("${COMIC_A}")`);
  sandbox.fireTimers();
  assert.equal(
    JSON.parse(sandbox.storage.get("panelshelf.progress.v1"))[COMIC_A].pageIndex,
    7
  );
});
