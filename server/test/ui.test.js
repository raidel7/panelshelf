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
  // The flush wiring lives with the other listeners at the bottom of the file,
  // so it is spliced in separately rather than being restated here. The two
  // listeners are matched exactly and independently: a span between loose
  // anchors would quietly swallow unrelated code into the sandbox and fail as
  // an evaluation error rather than as a missing-listener assertion.
  const onHide = source.match(
    /^document\.addEventListener\("visibilitychange", \(\) => \{\n  if \(document\.visibilityState === "hidden"\) flushPendingProgress\(\);\n\}\);$/m
  );
  const onUnload = source.match(
    /^window\.addEventListener\("pagehide", flushPendingProgress\);$/m
  );
  assert.ok(onHide, "app.js must flush pending progress when the tab is hidden");
  assert.ok(onUnload, "app.js must flush pending progress on unload");
  return `${constants[0]}\n${source.slice(start, end)}\n${onHide[0]}\n${onUnload[0]}`;
})();

function progressSandbox(options = {}) {
  const calls = [];
  const timers = new Map();
  const storage = new Map();
  const listeners = new Map();
  let nextTimer = 1;
  let batchCalls = 0;
  const deferredBatches = [];
  if (options.migrated) storage.set("panelshelf.progress.migrated.v1", "1");

  const context = {
    state: { progress: { ...(options.progress || {}) } },
    localStorage: {
      getItem: (key) => {
        if (options.storageUnreadable) throw new Error("SecurityError");
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem: (key, value) => {
        if (options.storageFails) throw new Error("QuotaExceededError");
        storage.set(key, value);
      }
    },
    document: {
      visibilityState: "visible",
      addEventListener: (type, handler) => listeners.set(type, handler)
    },
    window: {
      addEventListener: (type, handler) => listeners.set(type, handler)
    },
    setTimeout: (fn) => {
      const id = nextTimer++;
      timers.set(id, fn);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    fetch: (url, init = {}) => {
      const call = {
        url,
        method: init.method || "GET",
        body: init.body ? JSON.parse(init.body) : null,
        keepalive: Boolean(init.keepalive)
      };
      calls.push(call);
      if (options.onRequest) options.onRequest(context, call);
      if (options.fetchFails) return Promise.reject(new Error("offline"));
      // A batch the server has accepted but not yet applied, or one still on
      // the wire: its request has simply not settled.
      if (url === "/api/progress/batch") {
        batchCalls += 1;
        if (options.hangBatch === true || options.hangBatch === batchCalls) {
          return new Promise(() => {});
        }
        if (options.deferBatch) {
          return new Promise((resolve) => {
            deferredBatches.push(() => resolve({ ok: true, json: async () => ({}) }));
          });
        }
      }
      if (url === "/api/progress") {
        return Promise.resolve({
          ok: true,
          json: async () => {
            // Awaited so a hook can settle a request and let its continuations
            // run before this response is reconciled.
            if (options.duringRead) await options.duringRead(context);
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
    pendingTimers: () => timers.size,
    settleBatches: () => {
      for (const resolve of deferredBatches.splice(0)) resolve();
    },
    fire: (type) => {
      const handler = listeners.get(type);
      assert.ok(handler, `app.js must register a ${type} listener`);
      return handler();
    },
    hide: () => {
      context.document.visibilityState = "hidden";
      const handler = listeners.get("visibilitychange");
      assert.ok(handler, "app.js must register a visibilitychange listener");
      return handler();
    }
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
    body: { pageIndex: 2, pageCount: 9 },
    keepalive: false
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
    { url: `/api/progress/${COMIC_A}`, method: "DELETE", body: null, keepalive: false }
  ]);
});

test("a whole-collection change sends one batch, not one request per comic", async () => {
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
  assert.deepEqual(sandbox.calls, [
    {
      url: "/api/progress/batch",
      method: "POST",
      body: {
        records: { [COMIC_A]: { pageIndex: 8, completed: true } },
        deleted: [COMIC_B]
      },
      keepalive: false
    }
  ]);
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
      body: { pageIndex: 4 },
      keepalive: false
    },
    { url: `/api/progress/${COMIC_B}`, method: "DELETE", body: null, keepalive: false }
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

test("a collection change made during the read is not reverted by the server", async () => {
  const sandbox = progressSandbox({
    migrated: true,
    progress: {
      [COMIC_A]: { pageIndex: 3 },
      [COMIC_B]: { pageIndex: 7 }
    },
    remote: { [COMIC_A]: { pageIndex: 3 }, [COMIC_B]: { pageIndex: 7 } },
    duringRead: (context) => {
      // "Mark collection completed" fires a batch while the GET is in flight.
      vm.runInContext(
        `state.progress["${COMIC_A}"] = { pageIndex: 9, completed: true };` +
          `delete state.progress["${COMIC_B}"];` +
          `persistProgress(["${COMIC_A}", "${COMIC_B}"]);`,
        context
      );
    }
  });
  await sandbox.ready;

  await sandbox.run("loadProgressFromServer()");

  assert.deepEqual(sandbox.progress(), {
    [COMIC_A]: { pageIndex: 9, completed: true }
  });
});

test("flushing pending writes on hide sends one keepalive batch", async () => {
  const sandbox = progressSandbox({
    migrated: true,
    progress: { [COMIC_A]: { pageIndex: 2 }, [COMIC_B]: { pageIndex: 5 } }
  });
  await sandbox.ready;

  sandbox.run(`persistProgress("${COMIC_A}")`);
  sandbox.run(`delete state.progress["${COMIC_B}"]; persistProgress("${COMIC_B}")`);
  assert.equal(sandbox.pendingTimers(), 2, "both writes are still debounced");

  await sandbox.hide();

  assert.deepEqual(sandbox.calls, [
    {
      url: "/api/progress/batch",
      method: "POST",
      body: { records: { [COMIC_A]: { pageIndex: 2 } }, deleted: [COMIC_B] },
      keepalive: true
    }
  ]);
  assert.equal(sandbox.pendingTimers(), 0, "the debounce timers are cancelled");

  // Nothing pending: unloading must not fire an empty request.
  await sandbox.fire("pagehide");
  assert.equal(sandbox.calls.length, 1);
});

test("an unreadable storage still migrates local progress once", async () => {
  const sandbox = progressSandbox({
    migrated: true,
    storageUnreadable: true,
    progress: { [COMIC_A]: { pageIndex: 5 } },
    remote: { [COMIC_A]: { pageIndex: 5 } }
  });
  await sandbox.ready;

  await sandbox.run("loadProgressFromServer()");
  await sandbox.run("loadProgressFromServer()");

  assert.equal(
    sandbox.calls.filter((call) => call.url === "/api/progress/merge").length,
    1,
    "the migrated flag could not be read, so the first load migrates"
  );
});

test("a collection change made before the read's GET is not reverted", async () => {
  let acted = false;
  const sandbox = progressSandbox({
    migrated: true,
    progress: { [COMIC_A]: { pageIndex: 1 }, [COMIC_B]: { pageIndex: 7 } },
    remote: { [COMIC_A]: { pageIndex: 1 }, [COMIC_B]: { pageIndex: 7 } },
    onRequest: (context, call) => {
      // The read's opening flush is in flight and the GET has not been issued
      // yet. The user marks the collection completed right now; the server may
      // still answer the GET before it applies this batch.
      if (acted || call.url !== "/api/progress/batch") return;
      acted = true;
      vm.runInContext(
        `state.progress["${COMIC_A}"] = { pageIndex: 9, completed: true };` +
          `delete state.progress["${COMIC_B}"];` +
          `persistProgress(["${COMIC_A}", "${COMIC_B}"]);`,
        context
      );
    }
  });
  await sandbox.ready;

  // A queued write, so the read's flush actually issues a request to race.
  sandbox.run(`persistProgress("${COMIC_A}")`);
  await sandbox.run("loadProgressFromServer()");

  assert.ok(acted, "the flush must issue a batch for this test to mean anything");
  assert.deepEqual(sandbox.progress(), {
    [COMIC_A]: { pageIndex: 9, completed: true }
  });
});

test("a batch still in flight when a read starts is not reverted", async () => {
  const sandbox = progressSandbox({
    migrated: true,
    hangBatch: true,
    progress: { [COMIC_A]: { pageIndex: 3 }, [COMIC_B]: { pageIndex: 7 } },
    remote: { [COMIC_A]: { pageIndex: 3 }, [COMIC_B]: { pageIndex: 7 } }
  });
  await sandbox.ready;

  sandbox.run(
    `state.progress["${COMIC_A}"] = { pageIndex: 9, completed: true };` +
      `delete state.progress["${COMIC_B}"];` +
      `persistProgress(["${COMIC_A}", "${COMIC_B}"]);`
  );
  // The batch was sent before this read began and has not settled, so the
  // read cannot assume the server's records include it.
  await sandbox.run("loadProgressFromServer()");

  assert.deepEqual(sandbox.progress(), {
    [COMIC_A]: { pageIndex: 9, completed: true }
  });
});

test("one batch settling does not unguard a comic another batch still carries", async () => {
  const sandbox = progressSandbox({
    migrated: true,
    hangBatch: 1,
    progress: { [COMIC_A]: { pageIndex: 3 }, [COMIC_B]: { pageIndex: 7 } },
    remote: { [COMIC_A]: { pageIndex: 3 }, [COMIC_B]: { pageIndex: 7 } }
  });
  await sandbox.ready;

  // Two overlapping batches over the same comics; only the second settles.
  sandbox.run(
    `state.progress["${COMIC_A}"] = { pageIndex: 9 }; persistProgress(["${COMIC_A}", "${COMIC_B}"]);`
  );
  sandbox.run(
    `state.progress["${COMIC_A}"] = { pageIndex: 10 }; persistProgress(["${COMIC_A}", "${COMIC_B}"]);`
  );
  // Let the second batch's release run before the read seeds its guard, so
  // the seed is only accurate if the first batch still holds these comics.
  await Promise.resolve();
  await Promise.resolve();
  await sandbox.run("loadProgressFromServer()");

  assert.deepEqual(sandbox.progress(), {
    [COMIC_A]: { pageIndex: 10 },
    [COMIC_B]: { pageIndex: 7 }
  });
});

test("a batch in flight when the read starts survives settling mid-read", async () => {
  let settled = false;
  const sandbox = progressSandbox({
    migrated: true,
    deferBatch: true,
    progress: { [COMIC_A]: { pageIndex: 3 }, [COMIC_B]: { pageIndex: 7 } },
    remote: { [COMIC_A]: { pageIndex: 3 }, [COMIC_B]: { pageIndex: 7 } },
    duringRead: async () => {
      // The GET is out and this response was built before the batch was
      // applied; the batch's own request settles first all the same.
      settled = true;
      sandbox.settleBatches();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }
  });
  await sandbox.ready;

  sandbox.run(
    `state.progress["${COMIC_A}"] = { pageIndex: 9, completed: true };` +
      `delete state.progress["${COMIC_B}"];` +
      `persistProgress(["${COMIC_A}", "${COMIC_B}"]);`
  );
  await sandbox.run("loadProgressFromServer()");

  assert.ok(settled, "the batch must have settled during the read");
  assert.deepEqual(sandbox.progress(), {
    [COMIC_A]: { pageIndex: 9, completed: true }
  });
});
