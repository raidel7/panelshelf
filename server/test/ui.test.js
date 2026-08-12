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

test("the web viewer syncs progress with the server", async () => {
  const source = await fsp.readFile(
    path.join(publicDirectory, "app.js"),
    "utf8"
  );

  assert.doesNotThrow(() => new vm.Script(source, { filename: "app.js" }));

  assert.match(source, /PROGRESS_MIGRATED_KEY\s*=\s*"panelshelf\.progress\.migrated\.v1"/);
  assert.match(source, /fetch\("\/api\/progress"\)/);
  assert.match(source, /\/api\/progress\/merge/);
  assert.match(source, /function pushProgress\(/);
  assert.doesNotMatch(source, /function persistProgress\(\)/);

  // The migration flag is set on the plain read path too, not only inside the
  // merge branch, so a browser that started empty never re-merges its cache.
  assert.match(
    source,
    /state\.progress = await response\.json\(\);[\s\S]{0,400}?PROGRESS_MIGRATED_KEY,\s*"1"\s*\)/
  );
  // Pending debounced writes are flushed before the read replaces state.
  assert.match(
    source,
    /async function loadProgressFromServer\(\)\s*\{[\s\S]{0,300}?await flushPendingProgress\(\);/
  );
});
