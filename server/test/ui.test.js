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
  assert.match(document, /id="coverCacheSummary"/);
  assert.match(document, /id="warmCoverCacheButton"/);
  assert.match(document, /id="cancelCoverCacheButton"/);
  // These callouts share the backup callout's rules rather than restating them,
  // so a rename there must take them with it. Matched without the brace: they
  // sit in a selector list, and which one ends it changes as callouts are
  // added — which is exactly what broke this assertion once already.
  assert.match(styles, /\.cover-cache-callout\b/);
  assert.match(styles, /\.cover-cache-actions\b/);
  assert.match(styles, /\.device-pairing-callout\b/);
  assert.match(styles, /\.device-pairing-actions\b/);
  for (const id of [
    "setOrderCoverButton",
    "orderCoverInput",
    "exportOrderButton",
    "repairOrderButton",
    "importOrderButton",
    "importOrderInput"
  ]) {
    assert.match(document, new RegExp(`id="${id}"`), `${id} is in the markup`);
  }
  assert.match(styles, /\.order-heading-actions\b/);
  assert.match(styles, /\.custom-cover\b/);
  for (const id of [
    "metadataEditCoverPreview",
    "chooseComicCoverButton",
    "clearComicCoverButton",
    "comicCoverInput"
  ]) {
    assert.match(document, new RegExp(`id="${id}"`), `${id} is in the markup`);
  }
  assert.match(styles, /\.metadata-editor-cover\b/);
  for (const id of [
    "openLibraryReviewButton",
    "libraryReviewDialog",
    "duplicateList",
    "reviewQueueList"
  ]) {
    assert.match(document, new RegExp(`id="${id}"`), `${id} is in the markup`);
  }
  assert.match(styles, /\.library-review-callout\b/);
  assert.match(styles, /\.review-confidence\b/);
  for (const id of [
    "bulkBar",
    "bulkEditButton",
    "bulkAssignButton",
    "bulkEditDialog",
    "bulkAssignDialog",
    "applyBulkEditButton",
    "applyBulkAssignButton"
  ]) {
    assert.match(document, new RegExp(`id="${id}"`), `${id} is in the markup`);
  }
  assert.match(styles, /\.bulk-bar\b/);
  assert.match(document, /id="devicePairingSummary"/);
  assert.match(document, /id="devicePairingCode"/);
  assert.match(document, /id="devicePairingList"/);
  assert.match(document, /id="enablePairingButton"/);
  assert.match(document, /id="pairDeviceButton"/);
  assert.match(document, /id="disablePairingButton"/);
  assert.match(styles, /\.device-pairing-code \{/);
  assert.match(styles, /\.device-pairing-list \{/);
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

// The shelf reconciler is sliced out the same way the progress block is. The
// bug it guards against is invisible to text matching and to a glance at the
// page: a card whose comic record changed used to be replaced without its old
// node being taken out, so the shelf quietly grew duplicates.
const gridSource = (async () => {
  const source = await fsp.readFile(path.join(publicDirectory, "app.js"), "utf8");
  const start = source.indexOf("\nconst COMIC_WINDOW_STEP = ");
  const end = source.indexOf("\nfunction libraryShelfScope()");
  assert.ok(
    start > 0 && end > start,
    "app.js must keep the comic grid reconciler between its usual anchors"
  );
  return source.slice(start, end);
})();

// Enough of a DOM for a grid that holds cards: the reconciler only moves
// children around, and node identity is the whole point of the test.
const DOM_STUB = `
  let nextNodeId = 0;
  function createNode(label) {
    return {
      label,
      nodeId: nextNodeId++,
      parentNode: null,
      children: [],
      get lastElementChild() {
        return this.children[this.children.length - 1] || null;
      },
      insertBefore(node, reference) {
        node.remove();
        node.parentNode = this;
        const at = reference ? this.children.indexOf(reference) : -1;
        if (at === -1) this.children.push(node);
        else this.children.splice(at, 0, node);
        return node;
      },
      remove() {
        if (!this.parentNode) return;
        const at = this.parentNode.children.indexOf(this);
        if (at !== -1) this.parentNode.children.splice(at, 1);
        this.parentNode = null;
      }
    };
  }
  let builds = 0;
  function comicCard(comic, options = {}) {
    builds += 1;
    const node = createNode(comic.id);
    node.comicId = comic.id;
    node.title = comic.title;
    node.compact = Boolean(options.compact);
    node.orderId = options.orderId || null;
    return node;
  }
  let statusUpdates = 0;
  function updateComicCardStatus() {
    statusUpdates += 1;
  }
  function comicsFrom(count, offset = 0) {
    return Array.from({ length: count }, (unused, index) => ({
      id: "c" + (index + offset),
      title: "Comic " + (index + offset)
    }));
  }
  function idsIn(grid) {
    return grid.children.map((node) => node.comicId);
  }
`;

function gridSandbox() {
  const observed = [];
  const context = {
    IntersectionObserver: class {
      observe(node) {
        observed.push(node);
      }
      unobserve() {}
    },
    JSON
  };
  vm.createContext(context);
  return {
    observed,
    ready: gridSource.then((source) =>
      vm.runInContext(`${DOM_STUB}\n${source}`, context)
    ),
    run: (expression) => vm.runInContext(expression, context)
  };
}

test("the shelf draws a window of the library and grows it", async () => {
  const sandbox = gridSandbox();
  await sandbox.ready;

  sandbox.run("var grid = createNode('grid'); var comics = comicsFrom(300);");
  const first = sandbox.run("renderComicGrid(grid, comics, { scope: 'all' })");
  assert.equal(first, 96, "a fresh shelf draws one window, not the library");
  assert.equal(sandbox.run("grid.children.length"), 96);
  assert.equal(sandbox.run("idsIn(grid)[0]"), "c0");
  assert.equal(sandbox.run("idsIn(grid)[95]"), "c95");
  assert.equal(sandbox.run("builds"), 96, "one card is built per drawn comic");

  // Scrolling to the end of the window extends it without disturbing what the
  // reader has already scrolled past.
  sandbox.run("var kept = grid.children.slice();");
  sandbox.run(
    "comicGridViews.get(grid).windowSize = 192; renderComicGrid(grid, comics, { scope: 'all' });"
  );
  assert.equal(sandbox.run("grid.children.length"), 192);
  assert.equal(
    sandbox.run("kept.every((node, index) => grid.children[index] === node)"),
    true,
    "the cards already on screen are the same nodes"
  );
  assert.equal(sandbox.run("builds"), 192, "only the new cards were built");
});

test("re-rendering an unchanged shelf builds nothing", async () => {
  const sandbox = gridSandbox();
  await sandbox.ready;

  sandbox.run("var grid = createNode('grid'); var comics = comicsFrom(10);");
  sandbox.run("renderComicGrid(grid, comics, { scope: 'all' })");
  sandbox.run("var kept = grid.children.slice();");

  // The same records in a new array: a filter that happens to match the same
  // comics, or a status change that re-runs the render.
  sandbox.run("renderComicGrid(grid, comics.slice(), { scope: 'all' })");
  assert.equal(sandbox.run("builds"), 10, "no card was rebuilt");
  assert.equal(
    sandbox.run("kept.every((node, index) => grid.children[index] === node)"),
    true
  );

  // Records replaced by a refresh that changed nothing: recognised by value.
  sandbox.run(
    "renderComicGrid(grid, JSON.parse(JSON.stringify(comics)), { scope: 'all' })"
  );
  assert.equal(sandbox.run("builds"), 10, "equal records keep their cards");
  assert.equal(
    sandbox.run("kept.every((node, index) => grid.children[index] === node)"),
    true
  );
});

test("a comic whose record changed is replaced, not duplicated", async () => {
  const sandbox = gridSandbox();
  await sandbox.ready;

  sandbox.run("var grid = createNode('grid'); var comics = comicsFrom(5);");
  sandbox.run("renderComicGrid(grid, comics, { scope: 'all' })");
  sandbox.run(
    "var edited = comics.map((comic) => comic.id === 'c2' ? { id: 'c2', title: 'Renamed' } : comic);"
  );
  sandbox.run("renderComicGrid(grid, edited, { scope: 'all' })");

  assert.equal(sandbox.run("grid.children.length"), 5, "no leftover card");
  assert.deepEqual(sandbox.run("JSON.stringify(idsIn(grid))"), JSON.stringify(["c0", "c1", "c2", "c3", "c4"]));
  assert.equal(sandbox.run("grid.children[2].title"), "Renamed");
  assert.equal(sandbox.run("builds"), 6, "only the changed comic was rebuilt");
});

test("a shorter list drops the cards it no longer has", async () => {
  const sandbox = gridSandbox();
  await sandbox.ready;

  sandbox.run("var grid = createNode('grid'); var comics = comicsFrom(20);");
  sandbox.run("renderComicGrid(grid, comics, { scope: 'all' })");
  sandbox.run(
    "renderComicGrid(grid, comics.filter((comic) => comic.id !== 'c7'), { scope: 'all' })"
  );

  assert.equal(sandbox.run("grid.children.length"), 19);
  assert.equal(sandbox.run("idsIn(grid).includes('c7')"), false);
  assert.equal(sandbox.run("comicGridViews.get(grid).cards.size"), 19);

  sandbox.run("renderComicGrid(grid, [], { scope: 'all' })");
  assert.equal(sandbox.run("grid.children.length"), 0);
  assert.equal(sandbox.run("comicGridViews.get(grid).cards.size"), 0);
});

test("a different filter starts the window over", async () => {
  const sandbox = gridSandbox();
  await sandbox.ready;

  sandbox.run("var grid = createNode('grid'); var comics = comicsFrom(400);");
  sandbox.run("renderComicGrid(grid, comics, { scope: 'all|' })");
  sandbox.run(
    "comicGridViews.get(grid).windowSize = 288; renderComicGrid(grid, comics, { scope: 'all|' });"
  );
  assert.equal(sandbox.run("grid.children.length"), 288);

  sandbox.run("renderComicGrid(grid, comics, { scope: 'completed|' })");
  assert.equal(
    sandbox.run("grid.children.length"),
    96,
    "a new filter is a new list, drawn from the top"
  );
  assert.equal(sandbox.run("comicGridViews.get(grid).cards.size"), 96);
});

test("Continue Reading is drawn whole and follows its reading order", async () => {
  const sandbox = gridSandbox();
  await sandbox.ready;

  sandbox.run("var row = createNode('row'); var comics = comicsFrom(120);");
  sandbox.run(
    "renderComicGrid(row, comics, { scope: 'continue', windowed: false, cardFor: () => ({ compact: true, orderId: 'order-1' }) })"
  );
  assert.equal(sandbox.run("row.children.length"), 120, "the row is never windowed");
  assert.equal(sandbox.run("row.children[0].compact"), true);

  // The same comic under a different reading order is a different card.
  sandbox.run("var kept = row.children[0];");
  sandbox.run(
    "renderComicGrid(row, comics, { scope: 'continue', windowed: false, cardFor: () => ({ compact: true, orderId: 'order-2' }) })"
  );
  assert.equal(sandbox.run("row.children.length"), 120, "still one card per comic");
  assert.equal(sandbox.run("row.children[0] === kept"), false);
  assert.equal(sandbox.run("row.children[0].orderId"), "order-2");
});

// The status sweep is sliced out the same way. What it asks the document for
// is the whole bug: it was named for visible cards but selected every card in
// the page, and the shelf holds every card it has ever drawn. Reading a comic
// in continuous mode runs it on every page turn, so a reader who had browsed a
// while paid for the whole shelf on every page.
const statusSource = (async () => {
  const source = await fsp.readFile(path.join(publicDirectory, "app.js"), "utf8");
  const start = source.indexOf("\nfunction updateComicCardStatus(");
  const end = source.indexOf("\n// Drawing one card per comic");
  assert.ok(
    start > 0 && end > start,
    "app.js must keep the card status updaters between their usual anchors"
  );
  return source.slice(start, end);
})();

function statusSandbox(cardCount) {
  const touched = [];
  const selectors = [];
  const nodes = Array.from({ length: cardCount }, (unused, index) => ({
    dataset: { comicId: `c${index}f` }
  }));
  const context = {
    CSS: { escape: (value) => String(value) },
    comicById: (comicId) => ({ id: comicId }),
    document: {
      querySelectorAll(selector) {
        selectors.push(selector);
        if (selector === "[data-comic-id]") return nodes;
        const wanted = new Set(
          [...selector.matchAll(/\[data-comic-id="([^"]+)"\]/g)].map(
            (match) => match[1]
          )
        );
        return nodes.filter((node) => wanted.has(node.dataset.comicId));
      }
    }
  };
  vm.createContext(context);
  return {
    touched,
    selectors,
    ready: statusSource.then((source) => {
      vm.runInContext(source, context);
      // What each card is repainted with is the shelf tests' business; this one
      // is about which cards are handed over at all.
      context.updateComicCardStatus = (node) => touched.push(node.dataset.comicId);
    }),
    run: (expression) => vm.runInContext(expression, context)
  };
}

test("a page turn repaints the comic being read, not the whole shelf", async () => {
  const sandbox = statusSandbox(5000);
  await sandbox.ready;

  sandbox.run('updateVisibleComicStatuses("c4200f")');
  assert.deepEqual(sandbox.touched, ["c4200f"], "one card, not five thousand");
  assert.deepEqual(sandbox.selectors, ['[data-comic-id="c4200f"]']);
});

test("a change across several comics repaints exactly those", async () => {
  const sandbox = statusSandbox(5000);
  await sandbox.ready;

  sandbox.run('updateVisibleComicStatuses(["c7f", "c4200f"])');
  assert.deepEqual(sandbox.touched.sort(), ["c4200f", "c7f"]);
});

test("a sweep with nothing named still covers the shelf", async () => {
  const sandbox = statusSandbox(120);
  await sandbox.ready;

  // Closing the reader after a run through a reading order, and marking a whole
  // collection, both change an unknown set of comics and still need this.
  sandbox.run("updateVisibleComicStatuses()");
  assert.equal(sandbox.touched.length, 120);
  assert.deepEqual(sandbox.selectors, ["[data-comic-id]"]);
});

test("naming no comics at all asks the document for nothing", async () => {
  const sandbox = statusSandbox(5000);
  await sandbox.ready;

  sandbox.run("updateVisibleComicStatuses([])");
  assert.deepEqual(sandbox.selectors, [], "an empty list is not a whole-shelf sweep");
  assert.deepEqual(sandbox.touched, []);
});

test("the reading and shelf-status paths name the comic they changed", async () => {
  const application = await fsp.readFile(
    path.join(publicDirectory, "app.js"),
    "utf8"
  );
  // Pinned at the call sites: the scoped sweep above stays green while these
  // quietly go back to sweeping everything, and the stall comes back with them.
  assert.match(
    application,
    /persistProgress\(comic\.id\);\s*updateVisibleComicStatuses\(comic\.id\);/,
    "setComicProgress must repaint only the comic it just moved"
  );
  assert.match(
    application,
    /state\.statusFilter === "all"\) updateVisibleComicStatuses\(comic\.id\)/,
    "setComicShelfStatus must repaint only the comic it just marked"
  );
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

// Behavioural tests drive loadProgressFromServer directly, so deleting its one
// call site leaves them all green while the browser silently reverts to
// localStorage-only. Pinned exactly, the same way the flush listeners are.
test("the library refresh loads progress from the server before rendering", async () => {
  const source = await fsp.readFile(path.join(publicDirectory, "app.js"), "utf8");
  const refresh = source.match(/^async function refresh\(\) \{\n[\s\S]*?^\}$/m);
  assert.ok(refresh, "app.js must define refresh()");
  assert.match(
    refresh[0],
    /^  await loadProgressFromServer\(\);$/m,
    "refresh() must load progress from the server"
  );
  const load = refresh[0].indexOf("await loadProgressFromServer();");
  const firstRender = refresh[0].search(/^  render[A-Za-z]+\(\);$/m);
  assert.ok(firstRender > 0, "refresh() must render");
  assert.ok(
    load < firstRender,
    "progress must load before the first render, or the first paint shows stale positions"
  );
});

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

test("a read keeps local progress the server has an older record for", async () => {
  const sandbox = progressSandbox({
    migrated: true,
    // The server was asleep while the reader worked through the issue, so each
    // debounced push failed and was dropped. Nothing is pending or in flight by
    // the time the server comes back and a read runs.
    progress: {
      [COMIC_A]: { pageIndex: 30, lastReadAt: "2026-08-12T10:00:00.000Z" },
      [COMIC_B]: { pageIndex: 2, lastReadAt: "2026-08-12T08:00:00.000Z" }
    },
    remote: {
      [COMIC_A]: { pageIndex: 5, lastReadAt: "2026-08-12T09:00:00.000Z" },
      [COMIC_B]: { pageIndex: 4, lastReadAt: "2026-08-12T09:30:00.000Z" }
    }
  });
  await sandbox.ready;

  await sandbox.run("loadProgressFromServer()");

  assert.deepEqual(
    sandbox.progress(),
    {
      [COMIC_A]: { pageIndex: 30, lastReadAt: "2026-08-12T10:00:00.000Z" },
      // Older locally than on the server: the server's record wins as usual.
      [COMIC_B]: { pageIndex: 4, lastReadAt: "2026-08-12T09:30:00.000Z" }
    },
    "the newer local record survives the read"
  );

  // Keeping it is only half the fix; the server has to converge too.
  sandbox.fireTimers();
  const pushes = sandbox.calls.filter((call) => call.method !== "GET");
  assert.deepEqual(pushes, [
    {
      url: `/api/progress/${COMIC_A}`,
      method: "PUT",
      body: { pageIndex: 30, lastReadAt: "2026-08-12T10:00:00.000Z" },
      keepalive: false
    }
  ]);
});

test("a read still drops a local record the server does not have", async () => {
  const sandbox = progressSandbox({
    migrated: true,
    // COMIC_B was deleted on another device, so the server's list omits it. Its
    // local copy is newer than anything the server holds, and must still lose:
    // keeping it would resurrect the deletion this browser already migrated.
    progress: {
      [COMIC_A]: { pageIndex: 30, lastReadAt: "2026-08-12T10:00:00.000Z" },
      [COMIC_B]: { pageIndex: 7, lastReadAt: "2026-08-12T11:00:00.000Z" }
    },
    remote: { [COMIC_A]: { pageIndex: 5, lastReadAt: "2026-08-12T09:00:00.000Z" } }
  });
  await sandbox.ready;

  await sandbox.run("loadProgressFromServer()");

  assert.deepEqual(sandbox.progress(), {
    [COMIC_A]: { pageIndex: 30, lastReadAt: "2026-08-12T10:00:00.000Z" }
  });
  sandbox.fireTimers();
  assert.equal(
    sandbox.calls.filter((call) => call.url === `/api/progress/${COMIC_B}`).length,
    0,
    "the dropped record must not be pushed back at the server"
  );
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

// The settings dialog writes its editing list as the *complete* set of sources,
// so a dialog that opens without the server's sources in it deletes every one of
// them the moment Save is pressed. That is not hypothetical: it emptied a
// 24,839-comic library on 2026-08-30, because the in-memory copy it trusted had
// never been filled.
const settingsSource = (async () => {
  const source = await fsp.readFile(path.join(publicDirectory, "app.js"), "utf8");
  const start = source.indexOf("\nasync function loadSourcesForEditing()");
  const end = source.indexOf("\nfunction browserBackupState()");
  assert.ok(
    start > 0 && end > start,
    "app.js must keep the settings loader between its usual anchors"
  );
  return source.slice(start, end);
})();

function settingsSandbox({ config, fail = false }) {
  const calls = [];
  const context = {
    JSON,
    calls,
    state: { libraries: [], editingLibraries: [] },
    api: async (path) => {
      calls.push(path);
      if (fail) throw new Error("The server could not be reached.");
      return config;
    },
    renderSources: () => calls.push("renderSources"),
    pollCoverCache: () => calls.push("pollCoverCache"),
    loadDevicePairing: () => calls.push("loadDevicePairing"),
    clearFormError: () => {},
    showFormError: () => calls.push("showFormError"),
    elements: {
      settingsError: {},
      devicePairingCode: {},
      settingsDialog: { open: false, showModal() { this.open = true; calls.push("showModal"); } }
    }
  };
  vm.createContext(context);
  return {
    context,
    calls,
    ready: settingsSource.then((source) => vm.runInContext(source, context)),
    run: (expression) => vm.runInContext(expression, context)
  };
}

test("the settings editor takes its sources from the server, not from memory", async () => {
  // The in-memory copy is deliberately left empty here, which is the state that
  // caused the loss: the boot refresh had failed and nothing refilled it.
  const sandbox = settingsSandbox({
    config: { sources: [{ id: "src_dc", name: "DC", path: "/volumeUSB2/usbshare2-2/DC" }] }
  });
  await sandbox.ready;

  await sandbox.run("loadSourcesForEditing()");

  assert.deepEqual(
    sandbox.context.state.editingLibraries.map((source) => source.name),
    ["DC"],
    "the dialog edits what the server actually has"
  );
  assert.ok(sandbox.calls.includes("/api/config"), "it asked the server");
});

test("the editing list is a copy, so cancelling changes nothing", async () => {
  const sandbox = settingsSandbox({
    config: { sources: [{ id: "src_dc", name: "DC", path: "/dc" }] }
  });
  await sandbox.ready;
  await sandbox.run("loadSourcesForEditing()");

  sandbox.context.state.editingLibraries[0].name = "edited";

  assert.equal(sandbox.context.state.libraries[0].name, "DC");
});

test("a settings dialog whose sources will not load does not open", async () => {
  // Opening it anyway is what turns an unreachable server into a deleted
  // library: the dialog would show nothing, and Save would persist nothing.
  const sandbox = settingsSandbox({ config: null, fail: true });
  await sandbox.ready;

  await sandbox.run("openSettingsSources()");

  assert.equal(
    sandbox.context.elements.settingsDialog.open,
    false,
    "the dialog stays shut rather than offering to save an empty list"
  );
  assert.ok(sandbox.calls.includes("showFormError"), "and says why");
});

test("a settings dialog whose sources load does open", async () => {
  const sandbox = settingsSandbox({
    config: { sources: [{ id: "src_dc", name: "DC", path: "/dc" }] }
  });
  await sandbox.ready;

  await sandbox.run("openSettingsSources()");

  assert.equal(sandbox.context.elements.settingsDialog.open, true);
  assert.ok(sandbox.calls.includes("renderSources"));
});
