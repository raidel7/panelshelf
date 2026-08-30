"use strict";

const PROGRESS_STORAGE_KEY = "panelshelf.progress.v1";
const PROGRESS_MIGRATED_KEY = "panelshelf.progress.migrated.v1";
const SKIPS_MIGRATED_KEY = "panelshelf.skips.migrated.v1";
const READER_STORAGE_KEY = "panelshelf.reader.v1";
const LIBRARY_VIEW_STORAGE_KEY = "panelshelf.libraryView.v1";
const CHRONOLOGY_PREFERENCES_STORAGE_KEY =
  "panelshelf.chronologyPreferences.v1";
const LIBRARY_VIEWS = new Set(["all", "publisher", "chronological"]);

function readLocalJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

function readLibraryView() {
  try {
    const value = localStorage.getItem(LIBRARY_VIEW_STORAGE_KEY);
    return LIBRARY_VIEWS.has(value) ? value : "all";
  } catch {
    return "all";
  }
}

function readChronologyPreferences() {
  const stored = readLocalJson(CHRONOLOGY_PREFERENCES_STORAGE_KEY, {});
  return {
    skippedNodeIds: Array.isArray(stored.skippedNodeIds)
      ? stored.skippedNodeIds.filter((id) => typeof id === "string")
      : [],
    hideSkipped: Boolean(stored.hideSkipped),
    layout: stored.layout === "timeline" ? "timeline" : "grid"
  };
}

const chronologyPreferences = readChronologyPreferences();

const state = {
  comics: [],
  libraries: [],
  automaticOrders: [],
  manualOrders: [],
  progress: readLocalJson(PROGRESS_STORAGE_KEY, {}),
  libraryView: readLibraryView(),
  statusFilter: "all",
  selectedPublisherKey: null,
  chronologyNodeId: null,
  chronologyUnfiledScope: null,
  chronologyTimelineFocusId: null,
  chronologyLayout: chronologyPreferences.layout,
  skippedChronologyNodeIds: new Set(chronologyPreferences.skippedNodeIds),
  hideSkippedChronology: chronologyPreferences.hideSkipped,
  scanIssues: [],
  scanState: null,
  bulkMetadata: null,
  bulkMetadataPollTimer: null,
  coverCachePollTimer: null,
  bulkMetadataRefreshJobId: null,
  metadataSettings: null,
  metadata: {
    comic: null,
    candidate: null,
    results: [],
    searchInfo: null,
    request: 0,
    pendingComic: null
  },
  metadataEditor: { comic: null, baseline: null },
  permissionIssue: null,
  editingLibraries: [],
  editingSourceIndex: null,
  structurePreview: null,
  structureRequest: 0,
  activeOrderId: null,
  editingOrder: null,
  editorSelection: new Set(),
  pickerSelection: new Set(),
  draggedOrderIndex: null,
  browserPath: "/",
  browserParent: null,
  reader: {
    comic: null,
    pages: [],
    index: 0,
    fit: readLocalJson(READER_STORAGE_KEY, {}).fit || "width",
    mode: readLocalJson(READER_STORAGE_KEY, {}).mode || "single",
    orderId: null,
    renderToken: 0
  }
};

const elements = {
  comicGrid: document.querySelector("#comicGrid"),
  browseView: document.querySelector("#browseView"),
  browseBreadcrumb: document.querySelector("#browseBreadcrumb"),
  browseEyebrow: document.querySelector("#browseEyebrow"),
  browseTitle: document.querySelector("#browseTitle"),
  browseDescription: document.querySelector("#browseDescription"),
  unfiledShelfButton: document.querySelector("#unfiledShelfButton"),
  unfiledShelfCount: document.querySelector("#unfiledShelfCount"),
  skippedFilterButton: document.querySelector("#skippedFilterButton"),
  skippedFilterLabel: document.querySelector("#skippedFilterLabel"),
  skippedFilterCount: document.querySelector("#skippedFilterCount"),
  chronologyLayoutToggle: document.querySelector("#chronologyLayoutToggle"),
  chronologyTimeline: document.querySelector("#chronologyTimeline"),
  browseNotice: document.querySelector("#browseNotice"),
  collectionGrid: document.querySelector("#collectionGrid"),
  browseComicGrid: document.querySelector("#browseComicGrid"),
  collectionPreview: document.querySelector("#collectionPreview"),
  collectionPreviewFallback: document.querySelector(
    "#collectionPreviewFallback"
  ),
  collectionPreviewImage: document.querySelector("#collectionPreviewImage"),
  collectionPreviewEyebrow: document.querySelector(
    "#collectionPreviewEyebrow"
  ),
  collectionPreviewOrder: document.querySelector("#collectionPreviewOrder"),
  collectionPreviewState: document.querySelector("#collectionPreviewState"),
  collectionPreviewTitle: document.querySelector("#collectionPreviewTitle"),
  collectionPreviewDescription: document.querySelector(
    "#collectionPreviewDescription"
  ),
  collectionPreviewDetail: document.querySelector("#collectionPreviewDetail"),
  emptyState: document.querySelector("#emptyState"),
  noResults: document.querySelector("#noResults"),
  librarySummary: document.querySelector("#librarySummary"),
  scanStatus: document.querySelector("#scanStatus"),
  libraryControls: document.querySelector("#libraryControls"),
  libraryViews: document.querySelector("#libraryViews"),
  libraryFilters: document.querySelector("#libraryFilters"),
  continueSection: document.querySelector("#continueSection"),
  continueRow: document.querySelector("#continueRow"),
  searchInput: document.querySelector("#searchInput"),
  ordersButton: document.querySelector("#ordersButton"),
  scanControl: document.querySelector("#scanControl"),
  scanButton: document.querySelector("#scanButton"),
  scanMenuButton: document.querySelector("#scanMenuButton"),
  scanMenu: document.querySelector("#scanMenu"),
  scanSourceActions: document.querySelector("#scanSourceActions"),
  retryScanAction: document.querySelector("#retryScanAction"),
  retryScanCount: document.querySelector("#retryScanCount"),
  fullScanAction: document.querySelector("#fullScanAction"),
  bulkMetadataAction: document.querySelector("#bulkMetadataAction"),
  bulkMetadataMenuState: document.querySelector("#bulkMetadataMenuState"),
  issuesButton: document.querySelector("#issuesButton"),
  issueCount: document.querySelector("#issueCount"),
  settingsButton: document.querySelector("#settingsButton"),
  emptyAddButton: document.querySelector("#emptyAddButton"),
  settingsDialog: document.querySelector("#settingsDialog"),
  sourceList: document.querySelector("#sourceList"),
  browseButton: document.querySelector("#browseButton"),
  manualPath: document.querySelector("#manualPath"),
  addPathButton: document.querySelector("#addPathButton"),
  exportBackupButton: document.querySelector("#exportBackupButton"),
  coverCacheSummary: document.querySelector("#coverCacheSummary"),
  openLibraryReviewButton: document.querySelector("#openLibraryReviewButton"),
  libraryReviewDialog: document.querySelector("#libraryReviewDialog"),
  libraryReviewSummary: document.querySelector("#libraryReviewSummary"),
  duplicateSummary: document.querySelector("#duplicateSummary"),
  duplicateList: document.querySelector("#duplicateList"),
  reviewQueueSummary: document.querySelector("#reviewQueueSummary"),
  reviewQueueList: document.querySelector("#reviewQueueList"),
  devicePairingSummary: document.querySelector("#devicePairingSummary"),
  devicePairingCode: document.querySelector("#devicePairingCode"),
  devicePairingList: document.querySelector("#devicePairingList"),
  enablePairingButton: document.querySelector("#enablePairingButton"),
  pairDeviceButton: document.querySelector("#pairDeviceButton"),
  disablePairingButton: document.querySelector("#disablePairingButton"),
  warmCoverCacheButton: document.querySelector("#warmCoverCacheButton"),
  cancelCoverCacheButton: document.querySelector("#cancelCoverCacheButton"),
  importBackupButton: document.querySelector("#importBackupButton"),
  backupFileInput: document.querySelector("#backupFileInput"),
  saveSettingsButton: document.querySelector("#saveSettingsButton"),
  settingsError: document.querySelector("#settingsError"),
  metadataSettingsStatus: document.querySelector("#metadataSettingsStatus"),
  openMetadataSettingsButton: document.querySelector(
    "#openMetadataSettingsButton"
  ),
  metadataSettingsDialog: document.querySelector("#metadataSettingsDialog"),
  metadataGcdState: document.querySelector("#metadataGcdState"),
  metadataGcdEnabled: document.querySelector("#metadataGcdEnabled"),
  metadataProviderState: document.querySelector("#metadataProviderState"),
  metadataProviderEnabled: document.querySelector("#metadataProviderEnabled"),
  metadataToken: document.querySelector("#metadataToken"),
  metadataTokenHint: document.querySelector("#metadataTokenHint"),
  metadataPermissionConfirmed: document.querySelector(
    "#metadataPermissionConfirmed"
  ),
  clearMetadataTokenButton: document.querySelector(
    "#clearMetadataTokenButton"
  ),
  metadataOpenLibraryState: document.querySelector(
    "#metadataOpenLibraryState"
  ),
  metadataOpenLibraryEnabled: document.querySelector(
    "#metadataOpenLibraryEnabled"
  ),
  metadataRateLimit: document.querySelector("#metadataRateLimit"),
  metadataSettingsError: document.querySelector("#metadataSettingsError"),
  saveMetadataSettingsButton: document.querySelector(
    "#saveMetadataSettingsButton"
  ),
  bulkMetadataDialog: document.querySelector("#bulkMetadataDialog"),
  bulkMetadataProgress: document.querySelector("#bulkMetadataProgress"),
  bulkMetadataStatus: document.querySelector("#bulkMetadataStatus"),
  bulkMetadataCurrent: document.querySelector("#bulkMetadataCurrent"),
  bulkMetadataPercent: document.querySelector("#bulkMetadataPercent"),
  bulkMetadataProgressBar: document.querySelector("#bulkMetadataProgressBar"),
  bulkMetadataProcessed: document.querySelector("#bulkMetadataProcessed"),
  bulkMetadataApproved: document.querySelector("#bulkMetadataApproved"),
  bulkMetadataReview: document.querySelector("#bulkMetadataReview"),
  bulkMetadataUnmatched: document.querySelector("#bulkMetadataUnmatched"),
  bulkMetadataErrors: document.querySelector("#bulkMetadataErrors"),
  bulkMetadataRecent: document.querySelector("#bulkMetadataRecent"),
  bulkMetadataResults: document.querySelector("#bulkMetadataResults"),
  bulkMetadataError: document.querySelector("#bulkMetadataError"),
  cancelBulkMetadataButton: document.querySelector("#cancelBulkMetadataButton"),
  pauseBulkMetadataButton: document.querySelector("#pauseBulkMetadataButton"),
  startBulkMetadataButton: document.querySelector("#startBulkMetadataButton"),
  metadataDialog: document.querySelector("#metadataDialog"),
  metadataComicTitle: document.querySelector("#metadataComicTitle"),
  currentMetadataMatch: document.querySelector("#currentMetadataMatch"),
  currentMetadataMatchName: document.querySelector(
    "#currentMetadataMatchName"
  ),
  currentMetadataMatchDetail: document.querySelector(
    "#currentMetadataMatchDetail"
  ),
  currentMetadataMatchProvider: document.querySelector(
    "#currentMetadataMatchProvider"
  ),
  metadataLocalCoverFallback: document.querySelector(
    "#metadataLocalCoverFallback"
  ),
  metadataLocalCover: document.querySelector("#metadataLocalCover"),
  metadataLocalTitle: document.querySelector("#metadataLocalTitle"),
  metadataLocalDetail: document.querySelector("#metadataLocalDetail"),
  metadataLocalPath: document.querySelector("#metadataLocalPath"),
  metadataSearchProvider: document.querySelector("#metadataSearchProvider"),
  metadataSeries: document.querySelector("#metadataSeries"),
  metadataTitle: document.querySelector("#metadataTitle"),
  metadataNumber: document.querySelector("#metadataNumber"),
  metadataEdition: document.querySelector("#metadataEdition"),
  metadataYear: document.querySelector("#metadataYear"),
  metadataPublisher: document.querySelector("#metadataPublisher"),
  searchMetadataButton: document.querySelector("#searchMetadataButton"),
  metadataSearchNote: document.querySelector("#metadataSearchNote"),
  metadataError: document.querySelector("#metadataError"),
  metadataSearchResults: document.querySelector("#metadataSearchResults"),
  metadataReview: document.querySelector("#metadataReview"),
  metadataCandidateName: document.querySelector("#metadataCandidateName"),
  metadataCandidateDetail: document.querySelector("#metadataCandidateDetail"),
  metadataCandidateCoverFallback: document.querySelector(
    "#metadataCandidateCoverFallback"
  ),
  metadataCandidateCover: document.querySelector("#metadataCandidateCover"),
  metadataComparison: document.querySelector("#metadataComparison"),
  metadataAttribution: document.querySelector("#metadataAttribution"),
  metadataAttributionLink: document.querySelector(
    "#metadataAttributionLink"
  ),
  removeMetadataMatchButton: document.querySelector(
    "#removeMetadataMatchButton"
  ),
  confirmMetadataMatchButton: document.querySelector(
    "#confirmMetadataMatchButton"
  ),
  metadataEditorDialog: document.querySelector("#metadataEditorDialog"),
  metadataEditorComicTitle: document.querySelector("#metadataEditorComicTitle"),
  metadataEditTitle: document.querySelector("#metadataEditTitle"),
  metadataEditCoverPreview: document.querySelector("#metadataEditCoverPreview"),
  metadataEditCoverFallback: document.querySelector("#metadataEditCoverFallback"),
  chooseComicCoverButton: document.querySelector("#chooseComicCoverButton"),
  clearComicCoverButton: document.querySelector("#clearComicCoverButton"),
  comicCoverInput: document.querySelector("#comicCoverInput"),
  metadataEditSeries: document.querySelector("#metadataEditSeries"),
  metadataEditNumber: document.querySelector("#metadataEditNumber"),
  metadataEditVolume: document.querySelector("#metadataEditVolume"),
  metadataEditPublisher: document.querySelector("#metadataEditPublisher"),
  metadataEditYear: document.querySelector("#metadataEditYear"),
  metadataEditFormat: document.querySelector("#metadataEditFormat"),
  metadataEditStoryArc: document.querySelector("#metadataEditStoryArc"),
  metadataEditWriters: document.querySelector("#metadataEditWriters"),
  metadataEditArtists: document.querySelector("#metadataEditArtists"),
  metadataEditGenres: document.querySelector("#metadataEditGenres"),
  metadataEditTags: document.querySelector("#metadataEditTags"),
  metadataEditSummary: document.querySelector("#metadataEditSummary"),
  metadataEditorError: document.querySelector("#metadataEditorError"),
  resetMetadataOverrideButton: document.querySelector("#resetMetadataOverrideButton"),
  saveMetadataOverrideButton: document.querySelector("#saveMetadataOverrideButton"),
  folderDialog: document.querySelector("#folderDialog"),
  folderPath: document.querySelector("#folderPath"),
  folderList: document.querySelector("#folderList"),
  folderUpButton: document.querySelector("#folderUpButton"),
  selectFolderButton: document.querySelector("#selectFolderButton"),
  folderError: document.querySelector("#folderError"),
  structureDialog: document.querySelector("#structureDialog"),
  structurePath: document.querySelector("#structurePath"),
  structureProfile: document.querySelector("#structureProfile"),
  analyzeStructureButton: document.querySelector("#analyzeStructureButton"),
  profileHelp: document.querySelector("#profileHelp"),
  structureResult: document.querySelector("#structureResult"),
  structureLoading: document.querySelector("#structureLoading"),
  structureError: document.querySelector("#structureError"),
  detectedProfile: document.querySelector("#detectedProfile"),
  detectionReason: document.querySelector("#detectionReason"),
  detectionConfidence: document.querySelector("#detectionConfidence"),
  publisherResult: document.querySelector("#publisherResult"),
  detectedPublisher: document.querySelector("#detectedPublisher"),
  previewComicCount: document.querySelector("#previewComicCount"),
  previewFolderCount: document.querySelector("#previewFolderCount"),
  previewOrderedCount: document.querySelector("#previewOrderedCount"),
  previewStagingCount: document.querySelector("#previewStagingCount"),
  structureIssueSection: document.querySelector("#structureIssueSection"),
  structureIssues: document.querySelector("#structureIssues"),
  structureTree: document.querySelector("#structureTree"),
  treeLimitNote: document.querySelector("#treeLimitNote"),
  stagingPolicy: document.querySelector("#stagingPolicy"),
  hideOrderPrefixes: document.querySelector("#hideOrderPrefixes"),
  useStructureButton: document.querySelector("#useStructureButton"),
  issuesDialog: document.querySelector("#issuesDialog"),
  issuesSummary: document.querySelector("#issuesSummary"),
  issueList: document.querySelector("#issueList"),
  issuesSettingsButton: document.querySelector("#issuesSettingsButton"),
  clearIssuesButton: document.querySelector("#clearIssuesButton"),
  permissionDialog: document.querySelector("#permissionDialog"),
  permissionShare: document.querySelector("#permissionShare"),
  permissionShareStep: document.querySelector("#permissionShareStep"),
  permissionAccount: document.querySelector("#permissionAccount"),
  permissionPath: document.querySelector("#permissionPath"),
  openDsmPermissionsButton: document.querySelector("#openDsmPermissionsButton"),
  copyAccountButton: document.querySelector("#copyAccountButton"),
  permissionRescanButton: document.querySelector("#permissionRescanButton"),
  ordersDialog: document.querySelector("#ordersDialog"),
  manualOrderList: document.querySelector("#manualOrderList"),
  automaticOrderList: document.querySelector("#automaticOrderList"),
  createOrderButton: document.querySelector("#createOrderButton"),
  orderDetailDialog: document.querySelector("#orderDetailDialog"),
  orderDetailKind: document.querySelector("#orderDetailKind"),
  orderDetailName: document.querySelector("#orderDetailName"),
  orderDetailDescription: document.querySelector("#orderDetailDescription"),
  orderDetailCover: document.querySelector("#orderDetailCover"),
  orderCoverFallback: document.querySelector("#orderCoverFallback"),
  orderDetailCount: document.querySelector("#orderDetailCount"),
  orderDetailFinished: document.querySelector("#orderDetailFinished"),
  orderDetailUnplaced: document.querySelector("#orderDetailUnplaced"),
  orderDetailActions: document.querySelector("#orderDetailActions"),
  setOrderCoverButton: document.querySelector("#setOrderCoverButton"),
  orderCoverInput: document.querySelector("#orderCoverInput"),
  exportOrderButton: document.querySelector("#exportOrderButton"),
  repairOrderButton: document.querySelector("#repairOrderButton"),
  importOrderButton: document.querySelector("#importOrderButton"),
  importOrderInput: document.querySelector("#importOrderInput"),
  orderDetailNotice: document.querySelector("#orderDetailNotice"),
  orderDetailItems: document.querySelector("#orderDetailItems"),
  editOrderButton: document.querySelector("#editOrderButton"),
  duplicateOrderButton: document.querySelector("#duplicateOrderButton"),
  deleteOrderButton: document.querySelector("#deleteOrderButton"),
  startOrderButton: document.querySelector("#startOrderButton"),
  orderEditorDialog: document.querySelector("#orderEditorDialog"),
  orderEditorTitle: document.querySelector("#orderEditorTitle"),
  orderName: document.querySelector("#orderName"),
  orderDescription: document.querySelector("#orderDescription"),
  addOrderComicsButton: document.querySelector("#addOrderComicsButton"),
  moveSelectedUpButton: document.querySelector("#moveSelectedUpButton"),
  moveSelectedDownButton: document.querySelector("#moveSelectedDownButton"),
  removeSelectedButton: document.querySelector("#removeSelectedButton"),
  orderEditorItems: document.querySelector("#orderEditorItems"),
  unplacedSection: document.querySelector("#unplacedSection"),
  unplacedItems: document.querySelector("#unplacedItems"),
  placeAllButton: document.querySelector("#placeAllButton"),
  orderEditorError: document.querySelector("#orderEditorError"),
  saveOrderButton: document.querySelector("#saveOrderButton"),
  comicPickerDialog: document.querySelector("#comicPickerDialog"),
  comicPickerSearch: document.querySelector("#comicPickerSearch"),
  comicPickerList: document.querySelector("#comicPickerList"),
  pickerSelectionCount: document.querySelector("#pickerSelectionCount"),
  confirmComicPickerButton: document.querySelector("#confirmComicPickerButton"),
  readerDialog: document.querySelector("#readerDialog"),
  readerClose: document.querySelector("#readerClose"),
  readerTitle: document.querySelector("#readerTitle"),
  readerCounter: document.querySelector("#readerCounter"),
  readerOrder: document.querySelector("#readerOrder"),
  readerStage: document.querySelector("#readerStage"),
  readerPages: document.querySelector("#readerPages"),
  readerLoading: document.querySelector("#readerLoading"),
  previousPage: document.querySelector("#previousPage"),
  nextPage: document.querySelector("#nextPage"),
  readerMode: document.querySelector("#readerMode"),
  fitButton: document.querySelector("#fitButton"),
  readerEnd: document.querySelector("#readerEnd"),
  readerEndTitle: document.querySelector("#readerEndTitle"),
  readerEndMessage: document.querySelector("#readerEndMessage"),
  readerNextComicButton: document.querySelector("#readerNextComicButton"),
  toast: document.querySelector("#toast"),
  toastMessage: document.querySelector("#toastMessage"),
  toastAction: document.querySelector("#toastAction")
};

const PROFILE_LABELS = {
  "loose-comics": "Loose comics",
  "folders-as-series": "Folders as series",
  "hierarchical-timeline": "Hierarchical timeline",
  "exact-reading-order": "Exact reading order",
  unordered: "Unordered library",
  detect: "Detect a supported layout"
};

const PROFILE_HELP = {
  detect:
    "PanelShelf checks the documented conventions and asks you to confirm the closest match.",
  "loose-comics":
    "All CBZ and CBR files are direct children of this source. Nested comic folders are rejected.",
  "folders-as-series":
    "Each top-level folder is a series, with one optional volume or arc folder beneath it.",
  "hierarchical-timeline":
    "Numeric folder prefixes order siblings within each branch. Unnumbered folders remain groups, not invented chronology.",
  "exact-reading-order":
    "Every comic or participating branch needs a unique numeric position. Validation errors block this profile.",
  unordered:
    "Index everything recursively and preserve folder context without claiming a series or chronology."
};

const ROLE_LABELS = {
  publisher: "Publisher",
  "ordered-section": "Ordered section",
  group: "Group",
  series: "Series",
  staging: "Unfiled",
  ignored: "Ignored",
  unranked: "Unranked"
};

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const contentType = response.headers.get("content-type") || "";
  const result = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    const error = new Error(
      result && result.error && result.error.message
        ? result.error.message
        : `Request failed (${response.status}).`
    );
    error.details = result && result.error ? result.error.details : undefined;
    throw error;
  }
  return result;
}

function showToast(message, action = null) {
  elements.toastMessage.textContent = message;
  elements.toastAction.hidden = !action;
  elements.toastAction.textContent = action ? action.label : "";
  showToast.action = action ? action.handler : null;
  elements.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    elements.toast.hidden = true;
    showToast.action = null;
  }, action ? 7200 : 4200);
}

function showFormError(element, error) {
  element.textContent = error.message || String(error);
  element.hidden = false;
}

function clearFormError(element) {
  element.hidden = true;
  element.textContent = "";
}

function metadataProvider(id) {
  return (state.metadataSettings?.providers || []).find(
    (provider) => provider.id === id
  );
}

function metadataProviderReady(id = null) {
  if (!id || id === "smart") {
    return Boolean(state.metadataSettings?.readyProviderIds?.length);
  }
  return Boolean(metadataProvider(id)?.ready);
}

function formatRateWindow(label, window) {
  if (
    !window ||
    !Number.isFinite(Number(window.remaining)) ||
    !Number.isFinite(Number(window.limit))
  ) {
    return "";
  }
  return `${label}: ${window.remaining.toLocaleString()} of ${window.limit.toLocaleString()} remaining`;
}

function renderMetadataSettingsStatus() {
  const providers = state.metadataSettings?.providers || [];
  const readyProviders = providers.filter((provider) => provider.ready);
  const ready = readyProviders.length > 0;
  const label = ready
    ? `${readyProviders.length} ready`
    : "No providers ready";
  elements.metadataSettingsStatus.textContent = label;
  elements.metadataSettingsStatus.className = `provider-state${ready ? " ready" : ""}`;

  const stateTargets = [
    ["gcd", elements.metadataGcdState],
    ["metron", elements.metadataProviderState],
    ["openlibrary", elements.metadataOpenLibraryState]
  ];
  for (const [id, target] of stateTargets) {
    const provider = metadataProvider(id);
    const providerLabel = provider?.ready
      ? "Ready"
      : provider?.enabled
        ? "Needs attention"
        : provider?.configured
          ? "Off"
          : "Not configured";
    target.textContent = providerLabel;
    target.className = `provider-state${provider?.ready ? " ready" : ""}`;
  }

  const rateLimit = state.metadataSettings?.rateLimit || {};
  const windows = [
    formatRateWindow("Minute", rateLimit.burst),
    formatRateWindow("Daily", rateLimit.sustained)
  ].filter(Boolean);
  elements.metadataRateLimit.hidden = windows.length === 0;
  elements.metadataRateLimit.textContent = windows.join(" · ");

  for (const option of elements.metadataSearchProvider.options) {
    option.disabled =
      option.value !== "smart" && !metadataProviderReady(option.value);
  }
}

function bulkMetadataStatusLabel(status) {
  return {
    idle: "Not started",
    running: "Matching library…",
    paused: "Paused",
    completed: "Finished",
    cancelled: "Cancelled"
  }[status] || "Not started";
}

const bulkMetadataResultNodes = new Map();

function setTextIfChanged(element, value) {
  const next = String(value ?? "");
  if (element.textContent !== next) element.textContent = next;
}

function setHiddenIfChanged(element, hidden) {
  const next = Boolean(hidden);
  if (element.hidden !== next) element.hidden = next;
}

function bulkMetadataResultKey(result) {
  return [
    result.comicId || "unknown",
    result.checkedAt || "",
    result.status || "unknown"
  ].join("|");
}

function updateBulkMetadataResultRow(row, result) {
  const signature = JSON.stringify([
    result.title,
    result.status,
    result.displayName,
    result.score,
    result.reason
  ]);
  if (row.dataset.signature === signature) return;
  row.dataset.signature = signature;
  row.className = `bulk-result ${result.status || "unmatched"}`;
  const mark = row.firstElementChild;
  const copy = row.lastElementChild;
  setTextIfChanged(
    mark,
    result.status === "auto-approved" ? "✓" : result.status === "review" ? "?" : "—"
  );
  setTextIfChanged(copy.firstElementChild, result.title || "Unknown comic");
  setTextIfChanged(
    copy.lastElementChild,
    result.status === "auto-approved"
      ? `${result.displayName || "Match approved"} · ${result.score}%`
      : result.status === "review"
        ? `Best result ${result.score || 0}% · review manually`
        : result.reason || "No confident match"
  );
}

function createBulkMetadataResultRow(result) {
  const row = document.createElement("div");
  const mark = document.createElement("span");
  const copy = document.createElement("span");
  const title = document.createElement("strong");
  const detail = document.createElement("small");
  copy.append(title, detail);
  row.append(mark, copy);
  updateBulkMetadataResultRow(row, result);
  return row;
}

function reconcileBulkMetadataResults(results) {
  const retained = new Set();
  results.forEach((result, index) => {
    const key = bulkMetadataResultKey(result);
    retained.add(key);
    let row = bulkMetadataResultNodes.get(key);
    if (!row) {
      row = createBulkMetadataResultRow(result);
      bulkMetadataResultNodes.set(key, row);
    } else {
      updateBulkMetadataResultRow(row, result);
    }
    const expected = elements.bulkMetadataResults.children[index] || null;
    if (expected !== row) {
      elements.bulkMetadataResults.insertBefore(row, expected);
    }
  });
  for (const [key, row] of bulkMetadataResultNodes) {
    if (retained.has(key)) continue;
    row.remove();
    bulkMetadataResultNodes.delete(key);
  }
}

function renderBulkMetadataState(job = state.bulkMetadata) {
  const value = job || { status: "idle", processed: 0, total: 0 };
  state.bulkMetadata = value;
  const total = Number(value.total || 0);
  const processed = Number(value.processed || 0);
  const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const active = value.status === "running" || value.status === "paused";
  setTextIfChanged(elements.bulkMetadataMenuState,
    value.status === "running"
      ? `${percent}%`
      : value.status === "paused"
        ? "Paused"
        : value.status === "completed" && value.finishedAt
          ? `${value.autoApproved || 0} matched`
          : "");
  setHiddenIfChanged(elements.bulkMetadataProgress, value.status === "idle");
  setTextIfChanged(elements.bulkMetadataStatus, bulkMetadataStatusLabel(value.status));
  setTextIfChanged(
    elements.bulkMetadataCurrent,
    value.currentTitle ||
      (value.status === "completed" ? `${processed} unmatched comics checked` : "")
  );
  setTextIfChanged(elements.bulkMetadataPercent, `${percent}%`);
  if (Number(elements.bulkMetadataProgressBar.dataset.value || 0) !== percent) {
    elements.bulkMetadataProgressBar.dataset.value = String(percent);
    elements.bulkMetadataProgressBar.style.width = `${percent}%`;
    elements.bulkMetadataProgressBar.parentElement.setAttribute(
      "aria-valuenow",
      String(percent)
    );
  }
  setTextIfChanged(elements.bulkMetadataProcessed, processed);
  setTextIfChanged(elements.bulkMetadataApproved, value.autoApproved || 0);
  setTextIfChanged(elements.bulkMetadataReview, value.reviewRequired || 0);
  setTextIfChanged(elements.bulkMetadataUnmatched, value.unmatched || 0);
  setTextIfChanged(elements.bulkMetadataErrors, value.errors || 0);
  setHiddenIfChanged(elements.pauseBulkMetadataButton, value.status !== "running");
  setHiddenIfChanged(elements.cancelBulkMetadataButton, !active);
  setHiddenIfChanged(elements.startBulkMetadataButton, value.status === "running");
  const startDisabled = !metadataProviderReady();
  if (elements.startBulkMetadataButton.disabled !== startDisabled) {
    elements.startBulkMetadataButton.disabled = startDisabled;
  }
  setTextIfChanged(elements.startBulkMetadataButton,
    value.status === "paused"
      ? "Resume"
      : value.status === "completed" || value.status === "cancelled"
        ? "Run again"
        : "Enrich unmatched comics");

  const results = Array.isArray(value.recentResults) ? value.recentResults : [];
  setHiddenIfChanged(elements.bulkMetadataRecent, results.length === 0);
  reconcileBulkMetadataResults(results);
}

async function refreshComicsAfterBulk(job) {
  if (!job?.jobId || state.bulkMetadataRefreshJobId === job.jobId) return;
  state.bulkMetadataRefreshJobId = job.jobId;
  setLibraryComics(await api("/api/comics"));
  renderContinueReading();
  renderComics();
  renderOrders();
}

// This browser authenticates by cookie, not by a header, because the shelf and
// the reader load images with `image.src` and a browser attaches nothing of its
// own to those. So nothing here carries a token: the cookie rides along on
// same-origin requests by itself, and the only job left is saying what is
// paired.
function renderDevicePairing(status) {
  const enabled = status.enabled === true;
  const devices = status.devices || [];

  elements.enablePairingButton.hidden = enabled;
  elements.pairDeviceButton.hidden = !enabled;
  elements.disablePairingButton.hidden = !enabled;
  elements.devicePairingList.hidden = !enabled || devices.length === 0;
  if (!enabled) elements.devicePairingCode.hidden = true;

  elements.devicePairingSummary.textContent = enabled
    ? `Only paired devices can reach this library. ${devices.length} paired.`
    : "Anything that can reach this server can read your library and change its settings. Pairing asks every client to be approved once.";

  elements.devicePairingList.replaceChildren(
    ...devices.map((device) => {
      const item = document.createElement("li");
      const name = document.createElement("strong");
      name.textContent = device.name;
      const seen = document.createElement("span");
      seen.textContent = device.lastUsedAt
        ? `last seen ${new Date(device.lastUsedAt).toLocaleDateString()}`
        : "not used yet";
      const revoke = document.createElement("button");
      revoke.type = "button";
      revoke.className = "button button-secondary";
      revoke.textContent = "Revoke";
      revoke.addEventListener("click", () => revokeDevice(device));
      item.append(name, seen, revoke);
      return item;
    })
  );
}

async function loadDevicePairing() {
  if (!elements.settingsDialog.open) return;
  try {
    renderDevicePairing(await api("/api/devices"));
  } catch (error) {
    showFormError(elements.settingsError, error);
  }
}

async function revokeDevice(device) {
  if (
    !window.confirm(
      `Revoke “${device.name}”? It loses access on its next request and has to be paired again.`
    )
  ) {
    return;
  }
  try {
    renderDevicePairing(await api(`/api/devices/${device.id}`, { method: "DELETE" }));
  } catch (error) {
    showFormError(elements.settingsError, error);
  }
}

function reviewEmpty(message) {
  const empty = document.createElement("div");
  empty.className = "review-empty";
  empty.textContent = message;
  return empty;
}

function duplicateRow(group) {
  const row = document.createElement("div");
  row.className = "review-row";

  const header = document.createElement("header");
  const name = document.createElement("strong");
  const [first] = group.comics;
  name.textContent = first ? first.title || first.relativePath : "Duplicate";
  const badge = document.createElement("span");
  badge.className = `review-confidence ${group.confidence}`;
  badge.textContent = group.confidence;
  header.append(name, badge);

  const why = document.createElement("p");
  why.textContent =
    group.reason === "identical-contents"
      ? `${group.comics.length} files with identical contents · about ${formatSize(group.reclaimableBytes)} could be reclaimed`
      : `${group.comics.length} files that look like the same issue · about ${formatSize(group.reclaimableBytes)} could be reclaimed`;

  // Every copy's path, size and source: what someone needs in order to decide
  // which one is the keeper. PanelShelf will not decide it for them.
  const list = document.createElement("ul");
  for (const comic of group.comics) {
    const item = document.createElement("li");
    item.textContent = `${comic.relativePath} — ${formatSize(comic.size)}${comic.sourceName ? ` · ${comic.sourceName}` : ""}`;
    list.append(item);
  }

  row.append(header, why, list);
  return row;
}

function reviewRow(entry) {
  const row = document.createElement("div");
  row.className = "review-row";

  const header = document.createElement("header");
  const name = document.createElement("strong");
  name.textContent = entry.title || entry.comicId;
  const score = document.createElement("small");
  score.textContent =
    entry.score === null
      ? ""
      : `${entry.score}%${entry.runnerUpScore === null ? "" : ` · runner-up ${entry.runnerUpScore}%`}`;
  header.append(name, score);

  const proposal = document.createElement("p");
  proposal.textContent = entry.displayName
    ? `Proposed: ${entry.displayName}${entry.provider ? ` (${entry.provider})` : ""}`
    : "No candidate was proposed.";

  const reason = document.createElement("small");
  reason.textContent = entry.reason || "";

  row.append(header, proposal, reason);
  return row;
}

async function loadLibraryReview() {
  try {
    const [duplicates, review] = await Promise.all([
      api("/api/duplicates"),
      api("/api/metadata/review")
    ]);

    elements.duplicateSummary.textContent = duplicates.groups.length
      ? `${duplicates.groups.length} ${duplicates.groups.length === 1 ? "group" : "groups"} · about ${formatSize(duplicates.reclaimableBytes)} could be reclaimed. Nothing is removed for you.`
      : "No copies of the same comic were found.";
    elements.duplicateList.replaceChildren(
      ...(duplicates.groups.length
        ? duplicates.groups.slice(0, 200).map(duplicateRow)
        : [reviewEmpty("Nothing looks duplicated.")])
    );

    elements.reviewQueueSummary.textContent = review.pending
      ? `${review.pending} ${review.pending === 1 ? "match needs" : "matches need"} a decision.`
      : "No matches are waiting.";
    elements.reviewQueueList.replaceChildren(
      ...(review.entries.length
        ? review.entries.slice(0, 200).map(reviewRow)
        : [reviewEmpty("Nothing is waiting on you.")])
    );

    const parts = [];
    if (duplicates.groups.length) {
      parts.push(
        `${duplicates.groups.length} possible ${duplicates.groups.length === 1 ? "duplicate" : "duplicates"}`
      );
    }
    if (review.pending) {
      parts.push(`${review.pending} ${review.pending === 1 ? "match" : "matches"} to review`);
    }
    elements.libraryReviewSummary.textContent = parts.length
      ? `${parts.join(" and ")}. Nothing here changes anything on its own.`
      : "Nothing needs looking at. Copies of the same comic and close-call matches appear here.";
  } catch (error) {
    showToast(error.message);
  }
}

// The settings panel is the only place the cover cache is visible, so polling
// runs while that dialog is open and a warm-up is going, and stops otherwise.
function renderCoverCache(status) {
  const cache = status.cache || {};
  const warmup = status.warmup || {};
  const running = warmup.status === "running";

  elements.warmCoverCacheButton.hidden = running;
  elements.cancelCoverCacheButton.hidden = !running;

  if (running) {
    const of = warmup.total ? ` of ${warmup.total}` : "";
    const title = warmup.currentTitle ? ` — ${warmup.currentTitle}` : "";
    elements.coverCacheSummary.textContent =
      `Caching covers: ${warmup.processed}${of}${title}`;
    return;
  }

  const held = cache.covers
    ? `${cache.covers} covers and ${cache.thumbnails} thumbnails cached, about ${formatSize(cache.bytes)}.`
    : "No covers cached yet.";
  const failed = warmup.failed
    ? ` ${warmup.failed} could not be read.`
    : "";
  const finished =
    warmup.status === "complete"
      ? ` Last pass built ${warmup.generated} and skipped ${warmup.alreadyCached}.${failed}`
      : warmup.status === "cancelled"
        ? " Last pass was stopped."
        : "";
  elements.coverCacheSummary.textContent = `${held}${finished}`;
}

async function pollCoverCache() {
  clearTimeout(state.coverCachePollTimer);
  state.coverCachePollTimer = null;
  if (!elements.settingsDialog.open) return;
  try {
    const status = await api("/api/covers/cache");
    renderCoverCache(status);
    if (status.warmup?.status === "running") {
      state.coverCachePollTimer = setTimeout(pollCoverCache, 1000);
    }
  } catch (error) {
    if (elements.settingsDialog.open) showFormError(elements.settingsError, error);
  }
}

async function pollBulkMetadata() {
  clearTimeout(state.bulkMetadataPollTimer);
  state.bulkMetadataPollTimer = null;
  try {
    const previousStatus = state.bulkMetadata?.status;
    const job = await api("/api/metadata/bulk");
    renderBulkMetadataState(job);
    if (job.status === "running") {
      state.bulkMetadataPollTimer = setTimeout(pollBulkMetadata, 1000);
    } else if (previousStatus === "running" && job.status === "completed") {
      await refreshComicsAfterBulk(job);
      showToast(`Metadata enrichment finished: ${job.autoApproved || 0} matches approved.`);
    }
  } catch (error) {
    if (elements.bulkMetadataDialog.open) showFormError(elements.bulkMetadataError, error);
  }
}

async function openBulkMetadata() {
  closeScanMenu();
  clearFormError(elements.bulkMetadataError);
  try {
    renderBulkMetadataState(await api("/api/metadata/bulk"));
    if (!metadataProviderReady()) {
      showFormError(
        elements.bulkMetadataError,
        new Error("Enable at least one online metadata provider before starting.")
      );
    }
    if (!elements.bulkMetadataDialog.open) elements.bulkMetadataDialog.showModal();
    if (state.bulkMetadata?.status === "running") pollBulkMetadata();
  } catch (error) {
    showToast(error.message);
  }
}

async function startOrResumeBulkMetadata() {
  clearFormError(elements.bulkMetadataError);
  elements.startBulkMetadataButton.disabled = true;
  try {
    const path = state.bulkMetadata?.status === "paused"
      ? "/api/metadata/bulk/resume"
      : "/api/metadata/bulk";
    const job = await api(path, {
      method: "POST",
      body: path === "/api/metadata/bulk"
        ? JSON.stringify({ threshold: 90, margin: 10 })
        : undefined
    });
    renderBulkMetadataState(job);
    pollBulkMetadata();
  } catch (error) {
    showFormError(elements.bulkMetadataError, error);
    elements.startBulkMetadataButton.disabled = false;
  }
}

async function controlBulkMetadata(action) {
  clearFormError(elements.bulkMetadataError);
  try {
    const job = await api(`/api/metadata/bulk/${action}`, { method: "POST" });
    renderBulkMetadataState(job);
    if (job.status === "running") pollBulkMetadata();
  } catch (error) {
    showFormError(elements.bulkMetadataError, error);
  }
}

function openMetadataSettings(pendingComic = null) {
  state.metadata.pendingComic = pendingComic;
  const gcd = metadataProvider("gcd") || {};
  const metron = metadataProvider("metron") || {};
  const openLibrary = metadataProvider("openlibrary") || {};
  elements.metadataGcdEnabled.checked = Boolean(gcd.enabled);
  elements.metadataProviderEnabled.checked = Boolean(metron.enabled);
  elements.metadataPermissionConfirmed.checked = Boolean(
    metron.permissionConfirmed
  );
  elements.metadataToken.value = "";
  elements.metadataToken.placeholder = metron.configured
    ? `Saved token ${metron.tokenHint || ""} · paste only to replace`
    : "Paste a Metron API token";
  elements.metadataTokenHint.textContent = metron.configured
    ? `A token is saved (${metron.tokenHint}). Its full value is never sent back to this browser.`
    : "Sign in to Metron, open your profile, and generate a revocable API token.";
  elements.clearMetadataTokenButton.hidden = !metron.configured;
  elements.metadataOpenLibraryEnabled.checked = Boolean(openLibrary.enabled);
  clearFormError(elements.metadataSettingsError);
  renderMetadataSettingsStatus();
  elements.metadataSettingsDialog.showModal();
}

async function saveMetadataSettings(options = {}) {
  clearFormError(elements.metadataSettingsError);
  elements.saveMetadataSettingsButton.disabled = true;
  elements.saveMetadataSettingsButton.textContent = "Saving…";
  try {
    state.metadataSettings = await api("/api/metadata/settings", {
      method: "PUT",
      body: JSON.stringify({
        providers: {
          gcd: {
            enabled: elements.metadataGcdEnabled.checked
          },
          metron: {
            enabled: options.clearMetron
              ? false
              : elements.metadataProviderEnabled.checked,
            permissionConfirmed: options.clearMetron
              ? false
              : elements.metadataPermissionConfirmed.checked,
            token: options.clearMetron
              ? ""
              : elements.metadataToken.value.trim(),
            clearToken: Boolean(options.clearMetron)
          },
          openlibrary: {
            enabled: elements.metadataOpenLibraryEnabled.checked
          }
        }
      })
    });
    const pending = state.metadata.pendingComic;
    state.metadata.pendingComic = null;
    renderMetadataSettingsStatus();
    elements.metadataSettingsDialog.close();
    showToast(
      options.clearMetron
        ? "Saved Metron token removed."
        : "Online metadata settings saved."
    );
    if (
      !options.clearMetron &&
      pending &&
      metadataProviderReady()
    ) {
      openMetadataDialog(pending);
    }
  } catch (error) {
    showFormError(elements.metadataSettingsError, error);
  } finally {
    elements.saveMetadataSettingsButton.disabled = false;
    elements.saveMetadataSettingsButton.textContent = "Save";
  }
}

function metadataPublisherLabel(comic) {
  return (
    comic.embeddedMetadata?.publisher ||
    comic.publisher?.parent ||
    comic.publisher?.name ||
    ""
  );
}

function metadataProviderLabel(providerId) {
  return (
    metadataProvider(providerId)?.shortName ||
    metadataProvider(providerId)?.name ||
    {
      gcd: "GCD",
      metron: "Metron",
      openlibrary: "Open Library"
    }[providerId] ||
    "Online provider"
  );
}

function renderMetadataAttribution(candidate = null) {
  const attribution =
    candidate?.attribution || metadataProvider(candidate?.provider)?.attribution;
  elements.metadataAttribution.hidden = !attribution?.url;
  if (!attribution?.url) return;
  elements.metadataAttributionLink.href = attribution.url;
  elements.metadataAttributionLink.textContent =
    attribution.name || metadataProviderLabel(candidate.provider);
  elements.metadataAttributionLink.title = attribution.license
    ? `${attribution.notice || "Metadata"} · ${attribution.license}`
    : attribution.notice || "";
}

function metadataEditionForFormat(value) {
  const format = String(value || "").trim().toLocaleLowerCase();
  if (!format) return "auto";
  if (format.includes("trade paperback") || format === "tpb") {
    return "trade-paperback";
  }
  if (
    format.includes("hardcover") ||
    format === "hc" ||
    format.includes("deluxe edition")
  ) {
    return "hardcover";
  }
  if (format.includes("omnibus")) return "omnibus";
  if (format.includes("graphic novel")) return "graphic-novel";
  if (
    format.includes("single issue") ||
    format.includes("limited series") ||
    format.includes("one-shot") ||
    format.includes("annual")
  ) {
    return "single-issue";
  }
  return "auto";
}

function inferMetadataSearchDefaults(comic, local = {}, current = {}) {
  const rawTitle = String(comic.localTitle || comic.title || "")
    .replace(/\.(?:cbr|cbz)$/i, "")
    .replace(/^\d+(?:\.\d+)?\s+/, "")
    .trim();
  const volumeMatch = rawTitle.match(
    /\b(?:v|vol(?:ume)?\.?)\s*0*(\d{1,4})\b/i
  );
  const namedVolumeMatch = rawTitle.match(
    /\b(?:tpb|hc|omnibus)\s*#?\s*0*(\d{1,4})\b/i
  );
  const formatEdition = metadataEditionForFormat(
    local.format || current.format
  );
  let edition = formatEdition;
  if (edition === "auto") {
    if (/\bomnibus\b/i.test(rawTitle)) {
      edition = "omnibus";
    } else if (/\b(?:hc|hardcover|deluxe edition)\b/i.test(rawTitle)) {
      edition = "hardcover";
    } else if (/\bgraphic novel\b/i.test(rawTitle)) {
      edition = "graphic-novel";
    } else if (
      /\b(?:tpb|trade paperback|complete collection|epic collection|masterworks)\b/i.test(
        rawTitle
      ) ||
      volumeMatch
    ) {
      edition = "trade-paperback";
    }
  }

  let series =
    local.series || comic.localSeries || current.series || comic.series || "";
  if (!local.series && volumeMatch?.index > 0) {
    const filenameSeries = rawTitle
      .slice(0, volumeMatch.index)
      .replace(/[\s:–—-]+$/, "")
      .trim();
    if (filenameSeries.length >= 2) series = filenameSeries;
  } else if (!local.series && edition !== "auto") {
    const filenameSeries = rawTitle
      .replace(
        /\s+(?:tpb|trade paperback|hc|hardcover|omnibus|gn|graphic novel)(?:\s*#?\s*\d+)?\s*$/i,
        ""
      )
      .trim();
    if (filenameSeries.length >= 2) series = filenameSeries;
  }

  const inferredNumber = volumeMatch?.[1] || namedVolumeMatch?.[1] || "";
  const number = String(local.number || current.number || inferredNumber)
    .replace(/^0+(?=\d)/, "")
    .trim();
  const volumeToken = volumeMatch || namedVolumeMatch;
  const inferredTitle = volumeToken
    ? rawTitle
        .slice((volumeToken.index || 0) + volumeToken[0].length)
        .replace(/^[\s:–—-]+/, "")
        .replace(/\s+\((?:18|19|20|21)\d{2}\).*$/, "")
        .replace(/\s+\((?:digital|f|webrip|scan|empire|zone)[^)]*\).*$/i, "")
        .trim()
    : "";
  const title = String(
    local.title || current.title || inferredTitle
  ).trim();
  const filenameYear = rawTitle.match(/\(((?:18|19|20|21)\d{2})\)/)?.[1];
  const year =
    Number(local.year || current.year || comic.inferredMetadata?.year || filenameYear) || null;
  const note =
    edition !== "auto" && volumeToken
      ? `Detected ${edition === "trade-paperback" ? "collected volume" : edition.replaceAll("-", " ")} ${
          volumeMatch?.[0] || namedVolumeMatch?.[0]
        }. Smart fallback will compare the series, subtitle, volume, and year.`
      : "";
  return { series, title, number, edition, year, note };
}

function metadataCandidateLine(candidate) {
  return [
    candidate.series,
    candidate.number ? `#${candidate.number}` : "",
    candidate.editionType || candidate.metadata?.format || "",
    candidate.year || candidate.seriesYearBegan || "",
    candidate.publisher || ""
  ]
    .filter(Boolean)
    .join(" · ");
}

function metadataDisplayValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  if (value && typeof value === "object") {
    return Object.values(value).flat().filter(Boolean).join(", ");
  }
  return value === null || value === undefined || value === ""
    ? "Not available"
    : String(value);
}

function renderCurrentMetadataMatch() {
  const comic = state.metadata.comic;
  const match = comic?.onlineMatch;
  elements.currentMetadataMatch.hidden = !match;
  elements.removeMetadataMatchButton.hidden = !match;
  if (!match) return;
  elements.currentMetadataMatchProvider.textContent =
    metadataProviderLabel(match.provider);
  elements.currentMetadataMatchName.textContent =
    match.record?.displayName ||
    `${metadataProviderLabel(match.provider)} record ${match.recordId}`;
  elements.currentMetadataMatchDetail.textContent = [
    metadataCandidateLine(match.record || {}),
    match.confirmedAt
      ? `confirmed ${new Date(match.confirmedAt).toLocaleDateString()}`
      : ""
  ]
    .filter(Boolean)
    .join(" · ");
}

function comparisonRows(comic, candidate) {
  const embedded = comic.embeddedMetadata || {};
  const online = candidate.metadata || {};
  const localPublisher =
    embedded.publisher || comic.publisher?.parent || comic.publisher?.name || "";
  const localCreators = embedded.creators || {};
  const onlineCreators = online.creators || {};
  return [
    {
      label: "Title",
      local: embedded.title || comic.localTitle || comic.title,
      online: online.title,
      authoritative: Boolean(embedded.title)
    },
    {
      label: "Series",
      local: embedded.series || comic.localSeries || comic.series,
      online: online.series,
      authoritative: Boolean(embedded.series)
    },
    {
      label: "Issue",
      local: embedded.number,
      online: online.number,
      authoritative: Boolean(embedded.number)
    },
    {
      label: "Volume",
      local: embedded.volume,
      online: online.volume,
      authoritative: embedded.volume !== undefined
    },
    {
      label: "Format",
      local: embedded.format,
      online: online.format,
      authoritative: Boolean(embedded.format)
    },
    {
      label: "Year",
      local: embedded.year,
      online: online.year,
      authoritative: embedded.year !== undefined
    },
    {
      label: "Publisher",
      local: localPublisher,
      online: online.publisher,
      authoritative: Boolean(embedded.publisher || embedded.imprint)
    },
    {
      label: "Writer",
      local: localCreators.writers,
      online: onlineCreators.writers,
      authoritative: Boolean(localCreators.writers?.length)
    },
    {
      label: "Artist",
      local: localCreators.pencillers,
      online: onlineCreators.pencillers,
      authoritative: Boolean(localCreators.pencillers?.length)
    },
    {
      label: "Summary",
      local: embedded.summary,
      online: online.summary,
      authoritative: Boolean(embedded.summary)
    },
    {
      label: "Story arc",
      local: embedded.storyArc,
      online: online.storyArc,
      authoritative: Boolean(embedded.storyArc)
    },
    {
      label: "Characters",
      local: embedded.characters,
      online: online.characters,
      authoritative: Boolean(embedded.characters?.length)
    }
  ];
}

function renderMetadataCandidate(candidate) {
  const comic = state.metadata.comic;
  if (!comic || !candidate) {
    elements.metadataReview.hidden = true;
    elements.confirmMetadataMatchButton.hidden = true;
    return;
  }
  state.metadata.candidate = candidate;
  elements.metadataReview.hidden = false;
  elements.metadataCandidateName.textContent = candidate.displayName;
  elements.metadataCandidateDetail.textContent =
    metadataCandidateLine(candidate) ||
    `${metadataProviderLabel(candidate.provider)} record ${candidate.recordId}`;
  elements.metadataCandidateCover.hidden = !candidate.coverPath;
  elements.metadataCandidateCoverFallback.hidden = Boolean(candidate.coverPath);
  if (candidate.coverPath) {
    elements.metadataCandidateCover.src = candidate.coverPath;
    elements.metadataCandidateCover.alt = `Online cover for ${candidate.displayName}`;
    elements.metadataCandidateCover.onload = () => {
      elements.metadataCandidateCoverFallback.hidden = true;
    };
    elements.metadataCandidateCover.onerror = () => {
      elements.metadataCandidateCover.hidden = true;
      elements.metadataCandidateCover.removeAttribute("src");
      elements.metadataCandidateCoverFallback.hidden = false;
    };
  } else {
    elements.metadataCandidateCover.removeAttribute("src");
  }

  elements.metadataComparison.replaceChildren(
    ...comparisonRows(comic, candidate).map((row) => {
      const item = document.createElement("div");
      const label = document.createElement("dt");
      label.textContent = row.label;
      const local = document.createElement("dd");
      local.className = "metadata-local-value";
      const localLabel = document.createElement("span");
      localLabel.textContent = "Local";
      const localValue = document.createElement("strong");
      localValue.textContent = metadataDisplayValue(row.local);
      local.append(localLabel, localValue);
      const online = document.createElement("dd");
      online.className = "metadata-online-value";
      const onlineLabel = document.createElement("span");
      onlineLabel.textContent = metadataProviderLabel(candidate.provider);
      const onlineValue = document.createElement("strong");
      onlineValue.textContent = metadataDisplayValue(row.online);
      online.append(onlineLabel, onlineValue);
      const result = document.createElement("dd");
      result.className = "metadata-resolution";
      const hasOnline =
        row.online !== null &&
        row.online !== undefined &&
        row.online !== "" &&
        (!Array.isArray(row.online) || row.online.length > 0);
      result.textContent = row.authoritative
        ? "Keep local XML"
        : hasOnline
          ? "Add after confirm"
          : "No change";
      item.append(label, local, online, result);
      return item;
    })
  );
  elements.confirmMetadataMatchButton.hidden = false;
  elements.confirmMetadataMatchButton.textContent =
    comic.onlineMatch?.provider === candidate.provider &&
    comic.onlineMatch?.recordId === candidate.recordId
      ? "Refresh confirmed match"
      : "Confirm match";
  renderMetadataAttribution(candidate);
}

function renderMetadataResults(results, searchInfo = state.metadata.searchInfo) {
  if (results.length === 0) {
    const empty = document.createElement("div");
    empty.className = "metadata-results-empty";
    const heading = document.createElement("strong");
    const detail = document.createElement("span");
    if (searchInfo?.mode === "smart-fallback") {
      const attempts = (searchInfo.attempts || [])
        .map((attempt) => {
          if (attempt.status === "error") {
            return `${attempt.providerLabel} unavailable`;
          }
          return `${attempt.providerLabel}: ${attempt.matches}`;
        })
        .join(" · ");
      heading.textContent = "No confident matches found";
      detail.textContent = attempts
        ? `${attempts}. Adjust the series, subtitle, volume, year, or provider and search again.`
        : "Adjust the series, subtitle, volume, year, or provider and search again.";
    } else if (searchInfo?.mode === "collected-series") {
      const edition = searchInfo.editionLabel || "collected edition";
      if (Number(searchInfo.seriesMatches) === 0) {
        heading.textContent = `No matching ${edition.toLocaleLowerCase()} series`;
        detail.textContent =
          "This provider may contain the individual issues but not this collected edition. Try the exact trade subtitle; do not attach issue #1 as a substitute for the book.";
      } else {
        heading.textContent = "No matching collected volume";
        detail.textContent = elements.metadataNumber.value.trim()
          ? `The provider found ${searchInfo.seriesMatches} ${edition.toLocaleLowerCase()} series, but none contains volume #${elements.metadataNumber.value.trim()}. Clear Issue / volume to inspect every candidate.`
          : `The provider found ${searchInfo.seriesMatches} matching ${edition.toLocaleLowerCase()} series, but it returned no issue records.`;
      }
    } else {
      heading.textContent = "No matches found";
      detail.textContent =
        "Adjust the series, issue, year, publisher, or edition and search again.";
    }
    empty.append(heading, detail);
    elements.metadataSearchResults.replaceChildren(empty);
    return;
  }
  elements.metadataSearchResults.replaceChildren(
    ...results.map((candidate) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "metadata-result";
      button.dataset.recordId = candidate.recordId;
      const cover = document.createElement("span");
      cover.className = "metadata-result-cover";
      const fallback = document.createElement("span");
      fallback.textContent = metadataProviderLabel(candidate.provider)
        .slice(0, 2)
        .toLocaleUpperCase();
      cover.append(fallback);
      if (candidate.coverPath) {
        const image = document.createElement("img");
        image.src = candidate.coverPath;
        image.alt = "";
        image.loading = "lazy";
        image.addEventListener("load", () => fallback.remove());
        image.addEventListener("error", () => image.remove());
        cover.append(image);
      }
      const copy = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = candidate.displayName;
      const detail = document.createElement("small");
      const confidence = candidate.matchScore
        ? `${candidate.confidence || "candidate"} ${candidate.matchScore}%`
        : "";
      detail.textContent = [
        metadataProviderLabel(candidate.provider),
        metadataCandidateLine(candidate),
        confidence
      ]
        .filter(Boolean)
        .join(" · ");
      copy.append(name, detail);
      const action = document.createElement("span");
      action.className = "metadata-result-action";
      action.textContent = "Review";
      button.append(cover, copy, action);
      button.addEventListener("click", () => reviewMetadataCandidate(candidate));
      return button;
    })
  );
}

async function reviewMetadataCandidate(candidate) {
  const comic = state.metadata.comic;
  if (!comic) return;
  const requestId = ++state.metadata.request;
  clearFormError(elements.metadataError);
  elements.metadataSearchNote.textContent = "Loading full issue details…";
  elements.confirmMetadataMatchButton.hidden = true;
  try {
    const result = await api(
      `/api/comics/${comic.id}/metadata/candidates/${encodeURIComponent(candidate.provider)}/${encodeURIComponent(candidate.recordId)}`
    );
    if (requestId !== state.metadata.request) return;
    renderMetadataCandidate(result.candidate);
    elements.metadataSearchNote.textContent = result.stale
      ? `Using cached details. ${result.warning || "The provider is unavailable."}`
      : result.cached
        ? "Full details loaded from PanelShelf's cache."
        : `Full details loaded from ${metadataProviderLabel(candidate.provider)}.`;
  } catch (error) {
    if (requestId === state.metadata.request) {
      showFormError(elements.metadataError, error);
      elements.metadataSearchNote.textContent = "";
    }
  }
}

async function searchMetadata() {
  const comic = state.metadata.comic;
  if (!comic) return;
  const requestId = ++state.metadata.request;
  clearFormError(elements.metadataError);
  state.metadata.candidate = null;
  elements.metadataReview.hidden = true;
  elements.confirmMetadataMatchButton.hidden = true;
  elements.searchMetadataButton.disabled = true;
  elements.searchMetadataButton.textContent = "Searching…";
  const editionValue = elements.metadataEdition.value;
  const typedCollectedEdition =
    editionValue === "auto" &&
    /\s+(?:tpb|trade paperback|hc|hardcover|omnibus|gn|graphic novel)\s*$/i.test(
      elements.metadataSeries.value.trim()
    );
  elements.metadataSearchNote.textContent =
    elements.metadataSearchProvider.value === "smart"
      ? "Trying enabled providers in order until a strong match is found…"
      : !typedCollectedEdition &&
          (editionValue === "auto" || editionValue === "single-issue")
        ? `Searching ${metadataProviderLabel(elements.metadataSearchProvider.value)}…`
        : `Searching ${metadataProviderLabel(elements.metadataSearchProvider.value)} for this collected edition…`;
  try {
    const result = await api(`/api/comics/${comic.id}/metadata/search`, {
      method: "POST",
      body: JSON.stringify({
        provider: elements.metadataSearchProvider.value,
        series: elements.metadataSeries.value.trim(),
        title: elements.metadataTitle.value.trim(),
        number: elements.metadataNumber.value.trim(),
        edition: elements.metadataEdition.value,
        year: elements.metadataYear.value
          ? Number(elements.metadataYear.value)
          : null,
        publisher: elements.metadataPublisher.value.trim()
      })
    });
    if (requestId !== state.metadata.request) return;
    state.metadata.results = result.candidates || [];
    state.metadata.searchInfo = result.searchInfo || null;
    renderMetadataResults(state.metadata.results, state.metadata.searchInfo);
    const smartAttempts =
      state.metadata.searchInfo?.mode === "smart-fallback"
        ? ` ${state.metadata.searchInfo.attempts
            .map((attempt) => `${attempt.providerLabel}: ${attempt.matches}`)
            .join(" · ")}.`
        : "";
    const collected =
      state.metadata.searchInfo?.mode === "collected-series"
        ? ` across ${state.metadata.searchInfo.seriesMatches || 0} matching ${
            state.metadata.searchInfo.editionLabel?.toLocaleLowerCase() ||
            "collected-edition"
          } series`
        : "";
    const omitted = state.metadata.searchInfo?.omittedSeries
      ? ` ${state.metadata.searchInfo.omittedSeries} additional series were not queried; add a subtitle or year to narrow the search.`
      : "";
    elements.metadataSearchNote.textContent = result.stale
      ? `Showing cached matches. ${result.warning || "A provider is unavailable."}`
      : `${state.metadata.results.length} ${
          state.metadata.results.length === 1 ? "match" : "matches"
        }${collected}${result.cached ? " from cache" : ""}. ${
          state.metadata.results.length ? "Select one to review." : ""
        }${smartAttempts}${omitted}`.trim();
    state.metadataSettings = {
      ...state.metadataSettings,
      rateLimit: result.rateLimit || state.metadataSettings?.rateLimit || {}
    };
    renderMetadataSettingsStatus();
  } catch (error) {
    if (requestId === state.metadata.request) {
      showFormError(elements.metadataError, error);
      elements.metadataSearchNote.textContent = "";
    }
  } finally {
    if (requestId === state.metadata.request) {
      elements.searchMetadataButton.disabled = false;
      elements.searchMetadataButton.textContent = "Search providers";
    }
  }
}

function openMetadataDialog(comic) {
  if (!comic) return;
  if (!comic.onlineMatch && !metadataProviderReady()) {
    closeComicStatusMenu();
    showToast("Enable a metadata provider before searching online.");
    openMetadataSettings(comic);
    return;
  }
  closeComicStatusMenu();
  state.metadata.comic = comic;
  state.metadata.candidate = null;
  state.metadata.results = [];
  state.metadata.searchInfo = null;
  state.metadata.request += 1;
  elements.metadataComicTitle.textContent = `Metadata for ${comic.title}`;
  elements.metadataLocalTitle.textContent = comic.localTitle || comic.title;
  elements.metadataLocalDetail.textContent = [
    comic.localSeries || comic.series,
    comic.embeddedMetadata?.number
      ? `#${comic.embeddedMetadata.number}`
      : "",
    comic.embeddedMetadata?.year || comic.inferredMetadata?.year || "",
    comic.metadataEntry
      ? `embedded ${comic.metadataEntry}`
      : comic.inferredMetadata?.year
        ? "year inferred from filename"
        : "filename and folders"
  ]
    .filter(Boolean)
    .join(" · ");
  elements.metadataLocalPath.textContent = comic.relativePath;
  elements.metadataLocalPath.title = comic.relativePath;
  elements.metadataLocalCoverFallback.hidden = false;
  elements.metadataLocalCover.src = `/api/comics/${comic.id}/cover`;
  elements.metadataLocalCover.alt = `Local cover for ${comic.title}`;
  elements.metadataLocalCover.onload = () => {
    elements.metadataLocalCoverFallback.hidden = true;
  };
  elements.metadataLocalCover.onerror = () => {
    elements.metadataLocalCover.removeAttribute("src");
    elements.metadataLocalCoverFallback.hidden = false;
  };

  const local = comic.embeddedMetadata || {};
  const current = comic.onlineMatch?.record?.metadata || {};
  const defaults = inferMetadataSearchDefaults(comic, local, current);
  elements.metadataSearchProvider.value = "smart";
  elements.metadataSeries.value = defaults.series;
  elements.metadataTitle.value = defaults.title;
  elements.metadataNumber.value = defaults.number;
  elements.metadataEdition.value = defaults.edition;
  elements.metadataYear.value =
    local.year ||
    current.year ||
    defaults.year ||
    comic.onlineMatch?.record?.seriesYearBegan ||
    "";
  elements.metadataPublisher.value =
    local.publisher || metadataPublisherLabel(comic) || current.publisher || "";
  elements.metadataSearchResults.replaceChildren();
  const providerReady = metadataProviderReady();
  elements.searchMetadataButton.disabled = !providerReady;
  elements.metadataSearchNote.textContent = providerReady
    ? defaults.note
    : "Enable a provider in Settings to search. The confirmed match remains available.";
  elements.metadataReview.hidden = true;
  elements.confirmMetadataMatchButton.hidden = true;
  clearFormError(elements.metadataError);
  renderMetadataAttribution(null);
  renderCurrentMetadataMatch();
  if (comic.onlineMatch?.record) {
    renderMetadataCandidate(comic.onlineMatch.record);
    elements.confirmMetadataMatchButton.hidden = true;
  }
  elements.metadataDialog.showModal();
}

function updateComicFromMetadata(updated) {
  setLibraryComics(
    state.comics.map((comic) => (comic.id === updated.id ? updated : comic))
  );
  if (state.reader.comic?.id === updated.id) state.reader.comic = updated;
  state.metadata.comic = updated;
  renderCurrentMetadataMatch();
  renderContinueReading();
  renderComics();
  renderOrders();
}

async function confirmMetadataMatch() {
  const comic = state.metadata.comic;
  const candidate = state.metadata.candidate;
  if (!comic || !candidate) return;
  clearFormError(elements.metadataError);
  elements.confirmMetadataMatchButton.disabled = true;
  elements.confirmMetadataMatchButton.textContent = "Confirming…";
  try {
    const updated = await api(`/api/comics/${comic.id}/metadata/match`, {
      method: "POST",
      body: JSON.stringify({
        provider: candidate.provider,
        recordId: candidate.recordId
      })
    });
    updateComicFromMetadata(updated);
    state.metadata.candidate = updated.onlineMatch?.record || candidate;
    renderMetadataCandidate(state.metadata.candidate);
    elements.confirmMetadataMatchButton.hidden = true;
    showToast(
      `${updated.title} matched to ${metadataProviderLabel(candidate.provider)}.`
    );
  } catch (error) {
    showFormError(elements.metadataError, error);
  } finally {
    elements.confirmMetadataMatchButton.disabled = false;
    elements.confirmMetadataMatchButton.textContent = "Confirm match";
  }
}

async function removeMetadataMatch() {
  const comic = state.metadata.comic;
  if (!comic?.onlineMatch) return;
  if (
    !window.confirm(
      `Remove the ${metadataProviderLabel(comic.onlineMatch.provider)} match from "${comic.title}"?`
    )
  ) {
    return;
  }
  clearFormError(elements.metadataError);
  elements.removeMetadataMatchButton.disabled = true;
  try {
    const updated = await api(`/api/comics/${comic.id}/metadata/match`, {
      method: "DELETE"
    });
    updateComicFromMetadata(updated);
    state.metadata.candidate = null;
    elements.metadataReview.hidden = true;
    elements.confirmMetadataMatchButton.hidden = true;
    showToast("Online metadata match removed. Local metadata was not changed.");
  } catch (error) {
    showFormError(elements.metadataError, error);
  } finally {
    elements.removeMetadataMatchButton.disabled = false;
  }
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function comicIssueLabel(comic) {
  const number = comic?.metadata?.number;
  if (number === null || number === undefined || String(number).trim() === "") {
    return "";
  }
  return ` #${String(number).trim()}`;
}

function comicWriters(comic) {
  const writers = comic?.metadata?.creators?.writers;
  return Array.isArray(writers) ? writers.filter(Boolean) : [];
}

function comicMetadataLine(comic, options = {}) {
  const metadata = comic?.metadata;
  const series = `${comic.series || "Unknown series"}${comicIssueLabel(comic)}`;
  if (!metadata) {
    return options.reader
      ? series
      : `${series} · ${comic.pageCount} pages · ${formatSize(comic.size)}`;
  }
  const parts = [series];
  if (metadata.volume) parts.push(`Vol. ${metadata.volume}`);
  if (metadata.year) parts.push(String(metadata.year));
  const writers = comicWriters(comic);
  if (writers.length > 0) parts.push(writers.slice(0, 2).join(" & "));
  if (!options.reader) parts.push(`${comic.pageCount} pages`);
  return parts.join(" · ");
}

function collectionComicDetail(comic) {
  if (!comic) return "No cover is available for this collection yet.";
  const details = [];
  const writers = comicWriters(comic);
  if (writers.length > 0) details.push(writers.slice(0, 2).join(" & "));
  if (comic.metadata?.year) details.push(String(comic.metadata.year));
  const publisher = comic.publisher?.parent || comic.publisher?.name;
  if (publisher) details.push(publisher);
  return details.length > 0
    ? `${comic.title} · ${details.join(" · ")}`
    : `Cover from ${comic.title}`;
}

function allOrders() {
  return [...state.manualOrders, ...state.automaticOrders];
}

// Everything that draws the library looks comics up by id, and it does it a
// lot: once per rendered card when a reading status changes, once per entry in
// every automatic reading order. A linear scan of 26,625 comics turned each of
// those passes into seconds of frozen UI, so the list is indexed whenever it
// is replaced.
let comicIndex = new Map();
// Bumped with the index. Cards that cache a comic object hold it only for as
// long as the list it came from is the current one.
let libraryGeneration = 0;

function setLibraryComics(comics) {
  state.comics = Array.isArray(comics) ? comics : [];
  comicIndex = new Map(state.comics.map((comic) => [comic.id, comic]));
  libraryGeneration += 1;
}

function comicById(id) {
  return comicIndex.get(id) || null;
}

function orderById(id) {
  return allOrders().find((order) => order.id === id) || null;
}

function progressFor(comicIdValue) {
  const progress = state.progress[comicIdValue];
  return progress && typeof progress === "object" ? progress : null;
}

function readingStatus(comic) {
  const progress = progressFor(comic.id);
  if (!progress) return "unread";
  if (progress.skipped) return "skipped";
  if (progress.completed) return "completed";
  return "in-progress";
}

function progressPercent(comic) {
  const progress = progressFor(comic.id);
  if (!progress) return 0;
  if (progress.completed) return 100;
  const pageCount = Math.max(1, Number(progress.pageCount || comic.pageCount || 1));
  return Math.min(99, Math.max(1, Math.round(((Number(progress.pageIndex) + 1) / pageCount) * 100)));
}

const progressPushTimers = new Map();

// A batch is dispatched immediately rather than debounced, so it leaves no
// timer behind for loadProgressFromServer's reconciliation to notice. Without
// the guard below, a batch racing a read would be overwritten by the server's
// older records and the user's change would silently revert until the next
// refresh.
//
// Comic id -> number of unsettled batches carrying it. Its one job is to seed
// a starting read's guard. The count matters because overlapping batches can
// carry the same comic, and the id must stay listed until the last of them
// settles or the seed would miss it.
const inFlightBatchComics = new Map();
// One set per read in progress. A read's guard is seeded with whatever is in
// flight when it starts and collects every id batched while it runs, so an id
// stays guarded for the whole read however its request settles: two
// independent requests have no ordering guarantee, and a batch that settles
// mid-read may still be applied after the server built that read's response.
const progressReadGuards = new Set();

function trackBatchedComics(comicIds) {
  for (const comicId of comicIds) {
    inFlightBatchComics.set(comicId, (inFlightBatchComics.get(comicId) || 0) + 1);
    for (const guard of progressReadGuards) guard.add(comicId);
  }
}

function releaseBatchedComics(comicIds) {
  for (const comicId of comicIds) {
    const remaining = (inFlightBatchComics.get(comicId) || 0) - 1;
    if (remaining > 0) inFlightBatchComics.set(comicId, remaining);
    else inFlightBatchComics.delete(comicId);
  }
}

function readProgressMigrated() {
  try {
    return localStorage.getItem(PROGRESS_MIGRATED_KEY) === "1";
  } catch {
    return false;
  }
}

// Tracked in memory as well as in storage: a browser that cannot write to
// localStorage must still migrate only once per session, or it would keep
// merging server records back to the server and resurrect other devices'
// deletions.
let progressMigrated = readProgressMigrated();

function cacheProgressLocally() {
  try {
    localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(state.progress));
  } catch {
    // Private browsing or a full browser quota should not block reading.
  }
}

function markProgressMigrated() {
  progressMigrated = true;
  try {
    localStorage.setItem(PROGRESS_MIGRATED_KEY, "1");
  } catch {
    // The in-memory flag still holds for the rest of this session.
  }
}

// changedComicIds is a single comic id or an array of them; the local cache is
// always written, and every changed comic is pushed to the server.
function persistProgress(changedComicIds) {
  cacheProgressLocally();
  const ids = [changedComicIds].flat().filter(Boolean);
  if (ids.length > 1) pushProgressBatch(ids);
  else for (const comicId of ids) pushProgress(comicId);
}

// Single-comic writes only; the close path and whole-collection changes go
// through pushProgressBatch, so this never needs keepalive.
function sendProgress(comicId) {
  const record = state.progress[comicId];
  const request = record
    ? fetch(`/api/progress/${comicId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record)
      })
    : fetch(`/api/progress/${comicId}`, { method: "DELETE" });
  return request.catch(() => {
    // The local copy is authoritative until the server is reachable again.
  });
}

function pushProgress(comicId) {
  clearTimeout(progressPushTimers.get(comicId));
  progressPushTimers.set(
    comicId,
    setTimeout(() => {
      progressPushTimers.delete(comicId);
      sendProgress(comicId);
    }, 1000)
  );
}

// A whole-collection change would otherwise schedule one request per comic; on
// a tab close those all fire at once and browsers cap the total size of
// in-flight keepalive bodies at 64KB, silently dropping the overflow. One
// batch spends that budget once instead of once per comic, which is not a
// guarantee: a single batch body over 64KB (roughly 430 records) is still
// dropped whole.
// It posts to /api/progress/batch rather than /api/progress/merge because this
// is a deliberate user action: the server stamps and applies it
// unconditionally, where merge would compare this browser's clock against the
// stored record and could silently discard the change.
function pushProgressBatch(comicIds, keepalive = false) {
  const records = {};
  const deleted = [];
  const batched = [];
  for (const comicId of comicIds) {
    clearTimeout(progressPushTimers.get(comicId));
    progressPushTimers.delete(comicId);
    batched.push(comicId);
    const record = state.progress[comicId];
    if (record) records[comicId] = record;
    else deleted.push(comicId);
  }
  if (Object.keys(records).length === 0 && deleted.length === 0) {
    return Promise.resolve();
  }
  trackBatchedComics(batched);
  return fetch("/api/progress/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ records, deleted }),
    keepalive
  })
    .catch(() => {
      // The local copy is authoritative until the server is reachable again.
    })
    .finally(() => releaseBatchedComics(batched));
}

// A tab closed inside the debounce window would otherwise drop its last write,
// and a read that overtook a pending write would push the stale value back.
function flushPendingProgress() {
  return pushProgressBatch([...progressPushTimers.keys()], true);
}

// Strictly newer wins, matching the server's own tie-break: a record with no
// usable timestamp always loses to one that has it, and the server wins ties,
// so a read is never able to flip a record back and forth.
function localRecordIsNewer(localRecord, remoteRecord) {
  const localAt = Date.parse(localRecord?.lastReadAt || "");
  if (!Number.isFinite(localAt)) return false;
  const remoteAt = Date.parse(remoteRecord?.lastReadAt || "");
  if (!Number.isFinite(remoteAt)) return true;
  return localAt > remoteAt;
}

function readSkipsMigrated() {
  try {
    return localStorage.getItem(SKIPS_MIGRATED_KEY) === "1";
  } catch {
    return false;
  }
}

// In memory as well as in storage, for the same reason the progress flag is: a
// browser that cannot write localStorage must still migrate once per session.
let skipsMigrated = readSkipsMigrated();

function markSkipsMigrated() {
  skipsMigrated = true;
  try {
    localStorage.setItem(SKIPS_MIGRATED_KEY, "1");
  } catch {
    // Private browsing. The in-memory flag still holds for this session.
  }
}

// Skipped branches moved to the server so the iPad sees the same ones. The
// browser's stored set is handed over once and the server is the owner after
// that.
async function loadSkipsFromServer() {
  try {
    const local = [...state.skippedChronologyNodeIds];
    if (!skipsMigrated && local.length > 0) {
      const response = await fetch("/api/skips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ add: local })
      });
      if (!response.ok) throw new Error("Skip migration failed.");
    }
    const response = await fetch("/api/skips");
    if (!response.ok) throw new Error("Skipped collections are unavailable.");
    const remote = await response.json();
    state.skippedChronologyNodeIds = new Set(
      Array.isArray(remote.nodeIds) ? remote.nodeIds : []
    );
    // Marked after a successful read, not inside the branch above: a browser
    // whose stored set is empty would otherwise never be marked, and would
    // re-migrate whatever it had cached on some later load.
    markSkipsMigrated();
    persistChronologyPreferences();
  } catch (error) {
    // The chronology still browses; skipped branches simply do not hide.
    console.warn(error);
  }
}

async function loadProgressFromServer() {
  // Seeded and registered before the first await: a batch already in flight,
  // or one sent while the flush or the migration below is still running, raced
  // this read too, and the server may answer the read before it applies that
  // batch.
  const guard = new Set(inFlightBatchComics.keys());
  progressReadGuards.add(guard);
  try {
    // Pending writes must land before the read, or this would overwrite them
    // in state.progress and then push the server's own value back over the
    // change.
    await flushPendingProgress();
    const local = state.progress;
    if (!progressMigrated && Object.keys(local).length > 0) {
      const response = await fetch("/api/progress/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: local })
      });
      if (!response.ok) throw new Error("Progress migration failed.");
      markProgressMigrated();
    }
    const response = await fetch("/api/progress");
    if (!response.ok) throw new Error("Progress is unavailable.");
    const remote = await response.json();
    // A page turn or a collection change during the in-flight request has not
    // reached this response. Replacing it with the server's older record would
    // lose the change, and a pending push would then send that older record
    // back with a fresh stamp.
    // An id is guarded for this read if a debounce timer is still pending for
    // it, or if a batch carrying it was in flight at any point between this
    // read's start and now.
    for (const comicId of [...progressPushTimers.keys(), ...guard]) {
      if (local[comicId]) remote[comicId] = local[comicId];
      else delete remote[comicId];
    }
    // A push that failed is deliberately dropped rather than retried, but the
    // local record is still the newer one. Without this, the next read would
    // replace it with the server's older record and cache that over the local
    // copy, turning a dropped push into permanent data loss.
    // Only where both sides hold a record: keeping one the server lacks would
    // resurrect a record another device deleted, which is exactly what the
    // migration flag exists to prevent.
    const behindOnServer = [];
    for (const [comicId, record] of Object.entries(local)) {
      if (!remote[comicId] || remote[comicId] === record) continue;
      if (!localRecordIsNewer(record, remote[comicId])) continue;
      remote[comicId] = record;
      behindOnServer.push(comicId);
    }
    state.progress = remote;
    cacheProgressLocally();
    // Re-pushed so the server converges instead of disagreeing until the next
    // page turn.
    if (behindOnServer.length > 0) persistProgress(behindOnServer);
    // Marked unconditionally: without this a browser that started with no local
    // progress would cache the server's records and merge them back forever,
    // resurrecting comics another device had deleted.
    markProgressMigrated();
  } catch {
    // Keep the cached copy; the next successful write reconciles it.
  } finally {
    progressReadGuards.delete(guard);
  }
}

function persistReaderPreferences() {
  try {
    localStorage.setItem(
      READER_STORAGE_KEY,
      JSON.stringify({ mode: state.reader.mode, fit: state.reader.fit })
    );
  } catch {
    // Reader preferences are optional.
  }
}

function setComicProgress(comic, pageIndex, pageCount, options = {}) {
  if (!comic) return;
  const previousStatus = readingStatus(comic);
  const previous = progressFor(comic.id) || {};
  state.progress[comic.id] = {
    pageIndex: Math.max(0, Number(pageIndex) || 0),
    pageCount: Math.max(0, Number(pageCount) || 0),
    completed:
      typeof options.completed === "boolean"
        ? options.completed
        : Boolean(previous.completed),
    lastReadAt: new Date().toISOString(),
    orderId: options.orderId || state.reader.orderId || previous.orderId || null
  };
  persistProgress(comic.id);
  updateVisibleComicStatuses(comic.id);
  if (previousStatus !== readingStatus(comic)) renderContinueReading();
}

function markComicCompleted(comic, completed = true) {
  if (!comic) return;
  const previous = progressFor(comic.id) || {};
  state.progress[comic.id] = {
    pageIndex: completed
      ? Math.max(0, Number(comic.pageCount || previous.pageCount || 1) - 1)
      : 0,
    pageCount: Number(comic.pageCount || previous.pageCount || 0),
    completed,
    lastReadAt: new Date().toISOString(),
    orderId: state.reader.orderId || previous.orderId || null
  };
  persistProgress(comic.id);
  renderContinueReading();
}

function setComicShelfStatus(comic, status) {
  if (!comic || !["unread", "in-progress", "completed", "skipped"].includes(status)) {
    return;
  }
  const previous = progressFor(comic.id) || {};
  const pageCount = Math.max(
    0,
    Number(comic.pageCount || previous.pageCount || 0)
  );
  const previousPage = Math.max(0, Number(previous.pageIndex) || 0);

  if (status === "unread") {
    delete state.progress[comic.id];
  } else if (status === "completed") {
    state.progress[comic.id] = {
      pageIndex: Math.max(0, pageCount - 1),
      pageCount,
      completed: true,
      skipped: false,
      lastReadAt: new Date().toISOString(),
      orderId: previous.orderId || null
    };
  } else if (status === "skipped") {
    state.progress[comic.id] = {
      pageIndex: Math.min(previousPage, Math.max(0, pageCount - 1)),
      pageCount,
      completed: false,
      skipped: true,
      lastReadAt: previous.lastReadAt || null,
      orderId: previous.orderId || null
    };
  } else {
    const lastReadablePage = Math.max(0, pageCount - 2);
    state.progress[comic.id] = {
      pageIndex: previous.completed
        ? 0
        : Math.min(previousPage, lastReadablePage),
      pageCount,
      completed: false,
      skipped: false,
      lastReadAt: new Date().toISOString(),
      orderId: previous.orderId || null
    };
  }

  persistProgress(comic.id);
  closeComicStatusMenu();
  renderContinueReading();
  if (state.statusFilter === "all") updateVisibleComicStatuses(comic.id);
  else renderComics();
  renderOrders();
  showToast(`${comic.title} marked ${statusLabel(status).toLocaleLowerCase()}.`);
}

function statusLabel(status) {
  if (status === "in-progress") return "In progress";
  if (status === "completed") return "Completed";
  if (status === "skipped") return "Skipped";
  return "Unread";
}

let openComicStatusMenu = null;
const loadedImageUrls = new Set();
let chronologyTimelineContext = null;

// Every cover the viewer draws at card size asks for the server's fixed-size
// thumbnail. Only the reader and the metadata comparison — where the point is
// to judge the artwork itself — pull the full-size cover.
function thumbnailUrl(comicId) {
  return `/api/comics/${comicId}/cover?size=thumb`;
}

function coverImage(url, fallback = null) {
  const image = document.createElement("img");
  image.src = url;
  image.alt = "";
  image.loading = "lazy";
  if (loadedImageUrls.has(url) && fallback) fallback.hidden = true;
  image.addEventListener("load", () => {
    loadedImageUrls.add(url);
    if (fallback) fallback.hidden = true;
  });
  image.addEventListener("error", () => {
    loadedImageUrls.delete(url);
    image.remove();
    if (fallback) fallback.hidden = false;
  });
  return image;
}

function closeComicStatusMenu() {
  if (!openComicStatusMenu) return;
  openComicStatusMenu.menu.hidden = true;
  openComicStatusMenu.toggle.setAttribute("aria-expanded", "false");
  openComicStatusMenu.card.classList.remove("menu-open");
  openComicStatusMenu = null;
}

const METADATA_EDITOR_FIELDS = {
  title: "metadataEditTitle",
  series: "metadataEditSeries",
  number: "metadataEditNumber",
  volume: "metadataEditVolume",
  publisher: "metadataEditPublisher",
  year: "metadataEditYear",
  format: "metadataEditFormat",
  storyArc: "metadataEditStoryArc",
  summary: "metadataEditSummary",
  genres: "metadataEditGenres",
  tags: "metadataEditTags"
};

function metadataEditorValues(comic) {
  const metadata = comic.metadata || {};
  return {
    title: comic.title || "",
    series: comic.series || "",
    number: metadata.number ?? "",
    volume: metadata.volume ?? "",
    publisher:
      metadata.publisher || comic.publisher?.parent || comic.publisher?.name || "",
    year: metadata.year ?? "",
    format: metadata.format || "",
    storyArc: metadata.storyArc || "",
    summary: metadata.summary || "",
    genres: (metadata.genres || []).join(", "),
    tags: (metadata.tags || []).join(", "),
    writers: (metadata.creators?.writers || []).join(", "),
    artists: (
      metadata.creators?.pencillers || metadata.creators?.artists || []
    ).join(", ")
  };
}

function openMetadataEditor(comic) {
  closeComicStatusMenu();
  const baseline = metadataEditorValues(comic);
  state.metadataEditor = { comic, baseline };
  elements.metadataEditorComicTitle.textContent = `Edit ${comic.title}`;
  for (const [field, elementName] of Object.entries(METADATA_EDITOR_FIELDS)) {
    elements[elementName].value = baseline[field];
  }
  elements.metadataEditWriters.value = baseline.writers;
  elements.metadataEditArtists.value = baseline.artists;
  elements.resetMetadataOverrideButton.hidden = !comic.manualOverride;
  renderComicCoverChoice(comic);
  clearFormError(elements.metadataEditorError);
  if (!elements.metadataEditorDialog.open) {
    elements.metadataEditorDialog.showModal();
  }
}

// The preview always shows what the shelf will show, which is the chosen
// picture when there is one and the first page otherwise. `modifiedAt` busts
// the cache: choosing a new picture writes a new file, and without it the
// preview would go on showing the last one.
function renderComicCoverChoice(comic) {
  const chosen = Boolean(comic.hasCustomCover);
  elements.clearComicCoverButton.hidden = !chosen;
  elements.metadataEditCoverPreview.src = chosen
    ? `/api/artwork/cover/comic/${comic.id}?v=${encodeURIComponent(comic.modifiedAt || "")}`
    : thumbnailUrl(comic.id);
  elements.metadataEditCoverPreview.alt = `${comic.title} cover`;
  elements.metadataEditCoverFallback.hidden = true;
}

async function reloadEditedComic(comicId) {
  await refresh();
  const updated = comicById(comicId);
  if (!updated) return;
  state.metadataEditor = { ...state.metadataEditor, comic: updated };
  renderComicCoverChoice(updated);
}

function commaValues(value) {
  return [...new Set(
    String(value || "").split(",").map((item) => item.trim()).filter(Boolean)
  )];
}

function setMetadataOverrideValue(payload, field, current, baseline, transform = null) {
  if (String(current).trim() === String(baseline).trim()) return;
  const cleaned = String(current).trim();
  if (!cleaned) delete payload[field];
  else payload[field] = transform ? transform(cleaned) : cleaned;
}

async function saveMetadataOverride() {
  const { comic, baseline } = state.metadataEditor;
  if (!comic || !baseline) return;
  clearFormError(elements.metadataEditorError);
  const payload = structuredClone(comic.manualOverride?.metadata || {});
  delete payload.source;
  for (const [field, elementName] of Object.entries(METADATA_EDITOR_FIELDS)) {
    const transform = ["year", "volume"].includes(field) ? Number :
      ["genres", "tags"].includes(field) ? commaValues : null;
    setMetadataOverrideValue(
      payload,
      field,
      elements[elementName].value,
      baseline[field],
      transform
    );
  }
  const creators = { ...(payload.creators || {}) };
  const creatorChanges = [
    ["writers", elements.metadataEditWriters.value, baseline.writers],
    ["pencillers", elements.metadataEditArtists.value, baseline.artists]
  ];
  for (const [field, current, original] of creatorChanges) {
    if (String(current).trim() === String(original).trim()) continue;
    const list = commaValues(current);
    if (list.length > 0) creators[field] = list;
    else delete creators[field];
  }
  if (Object.keys(creators).length > 0) payload.creators = creators;
  else delete payload.creators;

  elements.saveMetadataOverrideButton.disabled = true;
  elements.saveMetadataOverrideButton.textContent = "Saving…";
  try {
    await api(`/api/comics/${comic.id}/metadata/override`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    elements.metadataEditorDialog.close();
    await refresh();
    showToast("Manual metadata saved.");
  } catch (error) {
    showFormError(elements.metadataEditorError, error);
  } finally {
    elements.saveMetadataOverrideButton.disabled = false;
    elements.saveMetadataOverrideButton.textContent = "Save edits";
  }
}

async function resetMetadataOverride() {
  const comic = state.metadataEditor.comic;
  if (!comic?.manualOverride) return;
  if (!window.confirm("Reset all manual metadata for this comic? Filename, ComicInfo.xml, and confirmed online metadata will become visible again.")) {
    return;
  }
  elements.resetMetadataOverrideButton.disabled = true;
  try {
    await api(`/api/comics/${comic.id}/metadata/override`, { method: "DELETE" });
    elements.metadataEditorDialog.close();
    await refresh();
    showToast("Manual metadata reset.");
  } catch (error) {
    showFormError(elements.metadataEditorError, error);
  } finally {
    elements.resetMetadataOverrideButton.disabled = false;
  }
}

function comicStatusControl(comic, status) {
  const wrapper = document.createElement("div");
  wrapper.className = "comic-status-control";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "comic-more-button";
  toggle.textContent = "•••";
  toggle.setAttribute("aria-label", `Change shelf status for ${comic.title}`);
  toggle.setAttribute("aria-haspopup", "menu");
  toggle.setAttribute("aria-expanded", "false");

  const menu = document.createElement("div");
  menu.className = "comic-status-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", `Shelf status for ${comic.title}`);
  menu.hidden = true;

  const choices = [
    ["unread", "Unread", "Reset saved reading progress"],
    ["in-progress", "In progress", "Keep this in Continue Reading"],
    ["completed", "Completed", "Mark the comic as finished"],
    ["skipped", "Skipped", "Skip it in reading-order navigation"]
  ];
  for (const [value, label, description] of choices) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `comic-status-option${status === value ? " active" : ""}`;
    item.dataset.statusValue = value;
    item.setAttribute("role", "menuitemradio");
    item.setAttribute("aria-checked", status === value ? "true" : "false");
    const check = document.createElement("span");
    check.className = "comic-status-check";
    check.textContent = status === value ? "✓" : "";
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = label;
    const detail = document.createElement("small");
    detail.textContent = description;
    copy.append(name, detail);
    item.append(check, copy);
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      setComicShelfStatus(comic, value);
    });
    menu.append(item);
  }

  const divider = document.createElement("span");
  divider.className = "comic-status-divider";
  divider.setAttribute("aria-hidden", "true");

  const editMetadataItem = document.createElement("button");
  editMetadataItem.type = "button";
  editMetadataItem.className = "comic-metadata-option";
  editMetadataItem.setAttribute("role", "menuitem");
  const editMetadataMark = document.createElement("span");
  editMetadataMark.className = "comic-metadata-mark manual";
  editMetadataMark.textContent = "✎";
  const editMetadataCopy = document.createElement("span");
  const editMetadataName = document.createElement("strong");
  editMetadataName.textContent = comic.manualOverride
    ? "Edit manual metadata"
    : "Edit metadata";
  const editMetadataDetail = document.createElement("small");
  editMetadataDetail.textContent = comic.manualOverride
    ? "Manual edits currently override other sources"
    : "Correct title, series, credits, and details";
  editMetadataCopy.append(editMetadataName, editMetadataDetail);
  editMetadataItem.append(editMetadataMark, editMetadataCopy);
  editMetadataItem.addEventListener("click", (event) => {
    event.stopPropagation();
    openMetadataEditor(comic);
  });

  const metadataItem = document.createElement("button");
  metadataItem.type = "button";
  metadataItem.className = "comic-metadata-option";
  metadataItem.setAttribute("role", "menuitem");
  const metadataMark = document.createElement("span");
  metadataMark.className = "comic-metadata-mark";
  metadataMark.textContent = "M";
  const metadataCopy = document.createElement("span");
  const metadataName = document.createElement("strong");
  metadataName.textContent = comic.onlineMatch
    ? "Review online metadata"
    : "Find online metadata";
  const metadataDetail = document.createElement("small");
  metadataDetail.textContent = comic.onlineMatch
    ? `Matched to ${metadataProviderLabel(comic.onlineMatch.provider)}`
    : "Search, compare, then confirm";
  metadataCopy.append(metadataName, metadataDetail);
  metadataItem.append(metadataMark, metadataCopy);
  metadataItem.addEventListener("click", (event) => {
    event.stopPropagation();
    openMetadataDialog(comic);
  });
  menu.append(divider, editMetadataItem, metadataItem);

  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    const card = wrapper.closest(".comic-card");
    const alreadyOpen = openComicStatusMenu?.menu === menu;
    closeComicStatusMenu();
    if (alreadyOpen || !card) return;
    menu.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    card.classList.add("menu-open");
    openComicStatusMenu = { card, toggle, menu };
  });
  wrapper.append(toggle, menu);
  return wrapper;
}

function comicStatusSignature(comic, status) {
  return `${status}|${status === "in-progress" ? progressPercent(comic) : 0}`;
}

function comicCard(comic, options = {}) {
  const article = document.createElement("article");
  const status = readingStatus(comic);
  article.dataset.comicId = comic.id;
  article.dataset.statusSignature = comicStatusSignature(comic, status);
  article.className = `comic-card status-${status}${
    comic.available === false ? " unavailable" : ""
  }${options.compact ? " compact-card" : ""}`;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "cover-button";
  button.disabled = comic.available === false;
  button.setAttribute(
    "aria-label",
    comic.available === false
      ? `${comic.title} is unavailable until its source reconnects`
      : `Read ${comic.title}`
  );
  if (comic.available !== false) {
    button.addEventListener("click", () =>
      openReader(comic, options.orderId || null)
    );
  }

  const fallback = document.createElement("span");
  fallback.className = "cover-fallback";
  fallback.textContent = comic.title;
  button.append(fallback);

  if (comic.available !== false) {
    button.append(coverImage(thumbnailUrl(comic.id), fallback));
  }

  const format = document.createElement("span");
  format.className = "format-badge";
  format.textContent = comic.available === false ? "Offline" : comic.format;
  button.append(format);

  if (comic.metadataSources?.includes("comicinfo")) {
    const metadataBadge = document.createElement("span");
    metadataBadge.className = "metadata-badge";
    metadataBadge.textContent = "XML";
    metadataBadge.title = `Metadata from ${comic.metadataEntry || "ComicInfo.xml"}`;
    button.append(metadataBadge);
  }

  if (comic.onlineMatch) {
    const onlineBadge = document.createElement("span");
    onlineBadge.className = `online-metadata-badge${
      comic.metadataSources?.includes("comicinfo") ? " with-xml" : ""
    }`;
    onlineBadge.textContent = metadataProviderLabel(comic.onlineMatch.provider)
      .slice(0, 2)
      .toLocaleUpperCase();
    onlineBadge.title = `Confirmed metadata match from ${
      metadataProviderLabel(comic.onlineMatch.provider)
    }`;
    button.append(onlineBadge);
  }

  if (comic.manualOverride) {
    const manualBadge = document.createElement("span");
    manualBadge.className = "manual-metadata-badge";
    manualBadge.textContent = "EDIT";
    manualBadge.title = "Manual PanelShelf metadata overrides are active";
    button.append(manualBadge);
  }

  const readingBadge = document.createElement("span");
  readingBadge.className = `reading-badge ${status}`;
  readingBadge.textContent = statusLabel(status);
  button.append(readingBadge);

  if (status === "in-progress") {
    const progressTrack = document.createElement("span");
    progressTrack.className = "cover-progress";
    const progressValue = document.createElement("span");
    progressValue.style.width = `${progressPercent(comic)}%`;
    progressTrack.append(progressValue);
    button.append(progressTrack);
  }

  const meta = document.createElement("div");
  meta.className = "comic-meta";
  const title = document.createElement("p");
  title.className = "comic-title";
  title.textContent = comic.title;
  title.title = comic.title;
  const series = document.createElement("p");
  series.className = "comic-series";
  series.textContent = comic.available === false
    ? `${comic.sourceName || comic.series} · reconnect source to read`
    : comicMetadataLine(comic);
  series.title = [
    comicMetadataLine(comic),
    comic.metadata?.summary || "",
    comic.relativePath
  ]
    .filter(Boolean)
    .join("\n");
  meta.append(title, series);
  article.append(button, comicStatusControl(comic, status), meta);
  return article;
}

// Marking one comic read redrew the badge, the progress bar and all four menu
// rows on every card on the shelf, which is tens of thousands of writes for one
// changed comic and a visible flash. Each node remembers the status it is
// already showing, so a pass over the shelf now touches only what moved.
function updateComicCardStatus(node, comic) {
  const status = readingStatus(comic);
  const signature = comicStatusSignature(comic, status);
  if (node.dataset.statusSignature === signature) return;
  node.dataset.statusSignature = signature;
  for (const value of ["unread", "in-progress", "completed", "skipped"]) {
    node.classList.toggle(`status-${value}`, value === status);
  }
  const badge = node.querySelector(".reading-badge");
  if (badge) {
    badge.className = `reading-badge ${status}`;
    badge.textContent = statusLabel(status);
  }
  const button = node.querySelector(".cover-button");
  let track = button?.querySelector(".cover-progress") || null;
  if (button && status === "in-progress") {
    if (!track) {
      track = document.createElement("span");
      track.className = "cover-progress";
      track.append(document.createElement("span"));
      button.append(track);
    }
    track.firstElementChild.style.width = `${progressPercent(comic)}%`;
  } else {
    track?.remove();
  }
  node.querySelectorAll("[data-status-value]").forEach((item) => {
    const active = item.dataset.statusValue === status;
    item.classList.toggle("active", active);
    item.setAttribute("aria-checked", active ? "true" : "false");
    const check = item.querySelector(".comic-status-check");
    if (check) check.textContent = active ? "✓" : "";
  });
}

// "Visible" was never true: the shelf keeps every card it has drawn, so this
// swept tens of thousands of them. Reading a comic in continuous mode calls it
// on every page turn — measured on a 26,625-comic library with 12,096 cards
// drawn, scrolling one comic did 312,026 card updates per direction, blocked
// the main thread for 379 ms across 26 stalls and dropped 35 frames. That is
// the stutter you get scrolling a comic after browsing the library for a while,
// and it gets worse the further you had scrolled.
//
// The comics that changed are known at every call site that matters, and a
// selector for them touches those cards and nothing else. Called with nothing
// it still sweeps everything, which is what the paths that change an unknown
// number of comics need: closing the reader after a run through a reading
// order, or marking a whole collection.
function updateVisibleComicStatuses(changedComicIds = null) {
  const ids =
    changedComicIds == null ? null : [changedComicIds].flat().filter(Boolean);
  if (ids && ids.length === 0) return;
  const selector = ids
    ? ids.map((comicId) => `[data-comic-id="${CSS.escape(comicId)}"]`).join(",")
    : "[data-comic-id]";
  document.querySelectorAll(selector).forEach((node) => {
    const comic = comicById(node.dataset.comicId);
    if (comic) updateComicCardStatus(node, comic);
  });
}

// Drawing one card per comic is what made the shelf flash. A library of 26,625
// comics built 26,625 cards — a million elements, each with its own <img> — and
// threw them all away and rebuilt them whenever anything changed: a reading
// status, a filter, a finished scan. The rebuild is what the eye saw.
//
// A grid now holds a window of the list and grows it as the last card comes
// into view, and re-rendering reconciles what is already there the way
// reconcileBulkMetadataResults reuses its rows. A card is rebuilt only when
// that comic's own record changed; reading status is applied on top by
// updateComicCardStatus, so marking a comic read touches exactly one card.
const COMIC_WINDOW_STEP = 96;
const comicGridViews = new Map();
const comicGridObserver =
  typeof IntersectionObserver === "function"
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const grid = entry.target.parentElement;
            const view = grid ? comicGridViews.get(grid) : null;
            if (!view || view.rendered >= view.comics.length) continue;
            view.windowSize = view.rendered + COMIC_WINDOW_STEP;
            renderComicGrid(grid, view.comics, view.options);
          }
        },
        // Far enough ahead that the next rows exist before they are scrolled to.
        { rootMargin: "1400px 0px" }
      )
    : null;

function comicGridView(grid) {
  let view = comicGridViews.get(grid);
  if (!view) {
    view = {
      scope: null,
      windowSize: COMIC_WINDOW_STEP,
      rendered: 0,
      cards: new Map(),
      comics: [],
      options: {},
      tail: null
    };
    comicGridViews.set(grid, view);
  }
  return view;
}

// Object identity answers "is this card still right?" for every local change,
// because nothing but a reload replaces a comic record. After a scan or a
// metadata edit the records are new objects, so the ones that did not actually
// change are recognised by value and keep their card — otherwise every visible
// cover would be torn out and re-requested for a scan that changed one file.
function comicGridCardNode(view, comic, cardOptions) {
  const variant = `${cardOptions.compact ? "compact" : "full"}|${
    cardOptions.orderId || ""
  }`;
  const existing = view.cards.get(comic.id);
  if (existing && existing.variant === variant) {
    if (existing.comic === comic) return existing.node;
    const signature = JSON.stringify(comic);
    if (existing.signature === signature) {
      existing.comic = comic;
      return existing.node;
    }
  }
  // The card being replaced is still in the grid, and the sweep below only
  // knows about the nodes this map still points at: it has to go now or it
  // stays on the shelf as a duplicate.
  if (existing) existing.node.remove();
  const entry = {
    node: comicCard(comic, cardOptions),
    comic,
    signature: JSON.stringify(comic),
    variant
  };
  view.cards.set(comic.id, entry);
  return entry.node;
}

function renderComicGrid(grid, comics, options = {}) {
  const view = comicGridView(grid);
  const scope = options.scope || "";
  // A different search, filter or branch is a different list, so the window
  // starts over. The same list rendered again — a status change, a refresh
  // after a scan — keeps everything the reader has already scrolled past.
  const sameScope = view.scope === scope;
  if (!sameScope) {
    view.scope = scope;
    view.windowSize = COMIC_WINDOW_STEP;
  }
  // Growing the window as the reader scrolls only has to place the cards it is
  // adding: the ones already there came from this same list under this same
  // scope, so nothing ahead of the old edge moved or went away. Without this a
  // reader deep into a long shelf pays for the whole window on every step. A
  // grid whose cards take options from outside the record — Continue Reading
  // reads each comic's reading order — is never short-cut this way, because
  // those options can change while the list does not.
  const appendOnly =
    sameScope && !options.cardFor && view.comics === comics && view.rendered > 0;
  view.comics = comics;
  view.options = options;
  // Nothing grows the window without an observer to notice the end of it, so a
  // browser without one draws the whole list rather than a shelf that stops.
  const limit = options.windowed === false || !comicGridObserver
    ? comics.length
    : Math.min(comics.length, Math.max(COMIC_WINDOW_STEP, view.windowSize));
  const from = appendOnly && limit >= view.rendered ? view.rendered : 0;

  const staticCard = options.card || {};
  const retained = from === 0 ? new Set() : null;
  for (let index = from; index < limit; index += 1) {
    const comic = comics[index];
    if (retained) retained.add(comic.id);
    const node = comicGridCardNode(
      view,
      comic,
      options.cardFor ? options.cardFor(comic) : staticCard
    );
    const expected = grid.children[index] || null;
    if (expected !== node) grid.insertBefore(node, expected);
    updateComicCardStatus(node, comic);
  }
  if (retained) {
    for (const [comicId, entry] of view.cards) {
      if (retained.has(comicId)) continue;
      entry.node.remove();
      view.cards.delete(comicId);
    }
  }
  // The window holds exactly this many cards; anything past the end is left
  // over from a longer list.
  while (grid.children.length > limit) grid.lastElementChild.remove();

  view.rendered = limit;
  if (comicGridObserver) {
    if (view.tail) comicGridObserver.unobserve(view.tail);
    view.tail = limit > 0 && limit < comics.length ? grid.children[limit - 1] : null;
    if (view.tail) comicGridObserver.observe(view.tail);
  }
  return limit;
}

// What the reader is looking at, as a string. Two renders that share it are
// the same list and keep their window; anything else scrolls back to the top
// of a freshly windowed shelf.
function libraryShelfScope() {
  return `${state.statusFilter}|${elements.searchInput.value.trim()}`;
}

function browseGridScope() {
  return [
    libraryShelfScope(),
    state.libraryView,
    state.selectedPublisherKey || "",
    state.chronologyNodeId || "",
    state.chronologyUnfiledScope || ""
  ].join("|");
}

function naturalTextCompare(left, right) {
  return String(left || "").localeCompare(String(right || ""), undefined, {
    numeric: true,
    sensitivity: "base"
  });
}

// Building and lower-casing this for every comic on every keystroke is most of
// what a search costs, and none of it changes between keystrokes. Keyed by the
// record, so a refresh that replaces the list drops the old text with it.
const comicSearchText = new WeakMap();

function comicSearchHaystack(comic) {
  let text = comicSearchText.get(comic);
  if (text !== undefined) return text;
  text = `${comic.title} ${comic.series} ${comic.relativePath} ${
    comic.publisher?.name || ""
  } ${comic.publisher?.parent || ""} ${
    (comic.hierarchy || []).map((node) => node.displayName || node.name).join(" ")
  } ${comic.metadata?.summary || ""} ${
    comic.metadata?.storyArc || ""
  } ${Object.values(comic.metadata?.creators || {})
    .flat()
    .join(" ")} ${(comic.metadata?.genres || []).join(" ")} ${
    (comic.metadata?.tags || []).join(" ")
  }`.toLocaleLowerCase();
  comicSearchText.set(comic, text);
  return text;
}

function filteredLibraryComics() {
  const query = elements.searchInput.value.trim().toLocaleLowerCase();
  const searched = query
    ? state.comics.filter((comic) => comicSearchHaystack(comic).includes(query))
    : state.comics;
  return state.statusFilter === "all"
    ? searched
    : searched.filter((comic) => readingStatus(comic) === state.statusFilter);
}

function persistLibraryView() {
  try {
    localStorage.setItem(LIBRARY_VIEW_STORAGE_KEY, state.libraryView);
  } catch {
    // A preferred library view is convenient but never required.
  }
}

function persistChronologyPreferences() {
  try {
    localStorage.setItem(
      CHRONOLOGY_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        skippedNodeIds: [...state.skippedChronologyNodeIds],
        hideSkipped: state.hideSkippedChronology,
        layout: state.chronologyLayout
      })
    );
  } catch {
    // Skip tracking follows the same browser-local preview model as progress.
  }
}

function publisherDescriptor(comic) {
  const publisher = comic.publisher;
  if (publisher && publisher.name) {
    const label = publisher.parent || publisher.name;
    return {
      key: `publisher:${label.toLocaleLowerCase()}`,
      label,
      recognized: true,
      imprint:
        publisher.parent && publisher.name !== publisher.parent
          ? publisher.name
          : null
    };
  }
  const sourceLabel = comic.sourceName || "Unclassified";
  return {
    key: `source:${comic.sourceId || comic.libraryRoot || sourceLabel}`,
    label: sourceLabel,
    recognized: false,
    imprint: null
  };
}

function publisherGroups(comics) {
  const groups = new Map();
  for (const comic of comics) {
    const descriptor = publisherDescriptor(comic);
    let group = groups.get(descriptor.key);
    if (!group) {
      group = {
        ...descriptor,
        comics: [],
        imprints: new Set()
      };
      groups.set(descriptor.key, group);
    }
    group.comics.push(comic);
    if (descriptor.imprint) group.imprints.add(descriptor.imprint);
  }
  return [...groups.values()].sort((left, right) =>
    naturalTextCompare(left.label, right.label)
  );
}

let collectionPreviewShowTimer = null;
let collectionPreviewHideTimer = null;
let collectionPreviewAnchor = null;

function collectionInitials(title) {
  return String(title || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase();
}

function collectionTitleSizeClass(title) {
  const length = Array.from(String(title || "")).length;
  if (length > 82) return "collection-title-xlong";
  if (length > 58) return "collection-title-long";
  if (length > 36) return "collection-title-medium";
  return "collection-title-short";
}

function supportsCollectionHoverPreview() {
  return (
    typeof window.matchMedia !== "function" ||
    window.matchMedia("(hover: hover) and (pointer: fine)").matches
  );
}

function positionCollectionPreview(anchor) {
  const preview = elements.collectionPreview;
  if (!preview || !anchor || preview.hidden) return;
  const margin = 12;
  const gap = 14;
  const anchorRect = anchor.getBoundingClientRect();
  const previewRect = preview.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  let left;

  if (anchorRect.right + gap + previewRect.width <= viewportWidth - margin) {
    left = anchorRect.right + gap;
    preview.dataset.side = "right";
  } else if (anchorRect.left - gap - previewRect.width >= margin) {
    left = anchorRect.left - gap - previewRect.width;
    preview.dataset.side = "left";
  } else {
    left = Math.min(
      viewportWidth - previewRect.width - margin,
      Math.max(margin, anchorRect.left + anchorRect.width / 2 - previewRect.width / 2)
    );
    preview.dataset.side = "center";
  }

  const top = Math.min(
    viewportHeight - previewRect.height - margin,
    Math.max(margin, anchorRect.top - 18)
  );
  preview.style.left = `${Math.round(left)}px`;
  preview.style.top = `${Math.round(Math.max(margin, top))}px`;
}

function hideCollectionPreview(immediate = false) {
  clearTimeout(collectionPreviewShowTimer);
  clearTimeout(collectionPreviewHideTimer);
  collectionPreviewShowTimer = null;
  if (!elements.collectionPreview) return;
  collectionPreviewAnchor = null;
  elements.collectionPreview.classList.remove("visible");
  const finish = () => {
    if (collectionPreviewAnchor) return;
    elements.collectionPreview.hidden = true;
    elements.collectionPreview.setAttribute("aria-hidden", "true");
  };
  if (immediate) finish();
  else collectionPreviewHideTimer = setTimeout(finish, 120);
}

// Moving from one collection to the next used to clear the preview's src and
// unhide the initials before asking for the replacement, so every hover blanked
// to two letters and back — the flash is the whole width of the fetch. The
// cover already on screen now stays until its replacement has decoded off to
// one side, and only a stall long enough to look broken falls back to the
// initials. A preview that is not on screen has nothing worth keeping, so it
// still opens on the initials and fills in behind them.
const COLLECTION_PREVIEW_STALE_COVER_MS = 260;
let collectionPreviewCoverRequest = 0;
let collectionPreviewStaleTimer = null;

function swapCollectionPreviewCover(url, initials) {
  const image = elements.collectionPreviewImage;
  const fallback = elements.collectionPreviewFallback;
  collectionPreviewCoverRequest += 1;
  const request = collectionPreviewCoverRequest;
  clearTimeout(collectionPreviewStaleTimer);
  collectionPreviewStaleTimer = null;
  fallback.textContent = initials;

  const showInitials = () => {
    image.hidden = true;
    image.removeAttribute("src");
    fallback.hidden = false;
  };
  const showCover = () => {
    image.src = url;
    image.hidden = false;
    fallback.hidden = true;
  };

  if (!url) {
    showInitials();
    return;
  }
  if (image.getAttribute("src") === url && !image.hidden) return;
  if (loadedImageUrls.has(url)) {
    showCover();
    return;
  }
  const keepCurrentCover =
    !elements.collectionPreview.hidden && !image.hidden && image.getAttribute("src");
  if (!keepCurrentCover) showInitials();
  else {
    collectionPreviewStaleTimer = setTimeout(() => {
      if (collectionPreviewCoverRequest === request) showInitials();
    }, COLLECTION_PREVIEW_STALE_COVER_MS);
  }

  const loader = new Image();
  loader.addEventListener("load", () => {
    loadedImageUrls.add(url);
    if (collectionPreviewCoverRequest !== request) return;
    clearTimeout(collectionPreviewStaleTimer);
    showCover();
  });
  loader.addEventListener("error", () => {
    loadedImageUrls.delete(url);
    if (collectionPreviewCoverRequest !== request) return;
    clearTimeout(collectionPreviewStaleTimer);
    showInitials();
  });
  loader.src = url;
}

function showCollectionPreview(anchor, options) {
  if (!supportsCollectionHoverPreview() || !elements.collectionPreview) return;
  clearTimeout(collectionPreviewHideTimer);
  collectionPreviewHideTimer = null;
  collectionPreviewAnchor = anchor;

  const firstComic = (options.comics || []).find(
    (comic) => comic.available !== false
  );
  elements.collectionPreview.classList.toggle(
    "skipped",
    Boolean(options.skipped)
  );
  swapCollectionPreviewCover(
    firstComic ? thumbnailUrl(firstComic.id) : null,
    collectionInitials(options.title)
  );

  elements.collectionPreviewEyebrow.textContent =
    options.eyebrow || "Collection";
  elements.collectionPreviewOrder.hidden = !options.orderNumber;
  elements.collectionPreviewOrder.textContent = options.orderNumber
    ? `Order ${options.orderNumber}`
    : "";
  elements.collectionPreviewState.hidden = !options.skipped;
  elements.collectionPreviewState.textContent = options.skipInherited
    ? "Parent skipped"
    : "Skipped";
  elements.collectionPreviewTitle.textContent = options.title;
  elements.collectionPreviewDescription.textContent = options.description;
  elements.collectionPreviewDetail.textContent =
    collectionComicDetail(firstComic);

  elements.collectionPreview.hidden = false;
  elements.collectionPreview.setAttribute("aria-hidden", "false");
  elements.collectionPreview.classList.remove("visible");
  elements.collectionPreview.style.visibility = "hidden";
  positionCollectionPreview(anchor);
  elements.collectionPreview.style.visibility = "";
  requestAnimationFrame(() => {
    if (collectionPreviewAnchor === anchor) {
      elements.collectionPreview.classList.add("visible");
    }
  });
}

function queueCollectionPreview(anchor, options, immediate = false) {
  if (!supportsCollectionHoverPreview()) return;
  clearTimeout(collectionPreviewShowTimer);
  clearTimeout(collectionPreviewHideTimer);
  collectionPreviewShowTimer = setTimeout(
    () => showCollectionPreview(anchor, options),
    immediate ? 0 : 170
  );
}

function setCollectionShelfStatus(comics, status, title) {
  const available = (comics || []).filter((comic) => comic.available !== false);
  for (const comic of available) {
    const previous = progressFor(comic.id) || {};
    const pageCount = Math.max(0, Number(comic.pageCount || previous.pageCount || 0));
    if (status === "unread") {
      delete state.progress[comic.id];
    } else {
      state.progress[comic.id] = {
        pageIndex: Math.max(0, pageCount - 1),
        pageCount,
        completed: true,
        skipped: false,
        lastReadAt: new Date().toISOString(),
        orderId: previous.orderId || null
      };
    }
  }
  persistProgress(available.map((comic) => comic.id));
  closeComicStatusMenu();
  renderContinueReading();
  // The shelf may be showing this branch's comics under an unchanged filter,
  // which renders as the same list: their badges are updated here rather than
  // being rebuilt with the grid.
  updateVisibleComicStatuses();
  renderComics();
  renderOrders();
  showToast(`${title} marked ${status === "unread" ? "unread" : "completed"}.`);
}

function collectionStatusControl(options, inline = false) {
  const comics = (options.statusComics || options.comics || []).filter(
    (comic) => comic.available !== false
  );
  const wrapper = document.createElement("div");
  wrapper.className = `collection-status-control${inline ? " inline" : ""}`;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "comic-more-button";
  toggle.textContent = "•••";
  toggle.setAttribute("aria-label", `Actions for ${options.title}`);
  toggle.setAttribute("aria-haspopup", "menu");
  toggle.setAttribute("aria-expanded", "false");
  const menu = document.createElement("div");
  menu.className = "comic-status-menu collection-status-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;

  const action = (label, detail, handler, disabled = false) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "comic-status-option";
    item.disabled = disabled;
    item.setAttribute("role", "menuitem");
    const mark = document.createElement("span");
    mark.className = "comic-status-check";
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = label;
    const description = document.createElement("small");
    description.textContent = detail;
    copy.append(name, description);
    item.append(mark, copy);
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      closeComicStatusMenu();
      handler();
    });
    menu.append(item);
  };

  const continuing = comics.find((comic) => readingStatus(comic) === "in-progress");
  const nextUnread = comics.find((comic) => readingStatus(comic) === "unread");
  const first = continuing || nextUnread || comics[0];
  action(
    continuing ? "Continue first active comic" : "Start first unread comic",
    first ? first.title : "No readable comics in this branch",
    () => first && openReader(first),
    !first
  );
  action("Mark all unread", "Reset progress for every comic in this branch", () =>
    setCollectionShelfStatus(comics, "unread", options.title)
  );
  action("Mark all completed", "Finish every comic in this branch", () =>
    setCollectionShelfStatus(comics, "completed", options.title)
  );
  if (options.onToggleSkipped) {
    action(
      options.skipped ? "Restore branch" : "Skip branch",
      options.skipped
        ? "Return this folder to the chronology"
        : "Keep the folder indexed but skip it in chronology",
      options.onToggleSkipped,
      Boolean(options.skipInherited)
    );
  }

  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    hideCollectionPreview(true);
    const card = wrapper.closest(".collection-card, .timeline-inside");
    const alreadyOpen = openComicStatusMenu?.menu === menu;
    closeComicStatusMenu();
    if (alreadyOpen || !card) return;
    menu.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    card.classList.add("menu-open");
    openComicStatusMenu = { card, toggle, menu };
  });
  wrapper.append(toggle, menu);
  return wrapper;
}

function collectionCard(options) {
  const article = document.createElement("article");
  article.className = `collection-card${
    options.className ? ` ${options.className}` : ""
  }${options.skipped ? " skipped" : ""}${
    options.onToggleSkipped ? " has-skip-control" : ""
  }${options.orderNumber ? " has-order-number" : ""}`;

  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "collection-card-open";
  openButton.setAttribute("aria-label", `Open ${options.title}`);
  openButton.addEventListener("click", (event) => {
    hideCollectionPreview(true);
    options.onClick(event);
  });

  const artwork = document.createElement("span");
  artwork.className = "collection-artwork";
  const fallback = document.createElement("span");
  fallback.className = "collection-fallback";
  fallback.textContent = collectionInitials(options.title);
  artwork.append(fallback);

  const covers = (options.comics || [])
    .filter((comic) => comic.available !== false)
    .slice(0, 1);
  covers.forEach((comic) => {
    artwork.append(coverImage(thumbnailUrl(comic.id), fallback));
  });
  artwork.dataset.coverCount = String(covers.length);

  const copy = document.createElement("span");
  copy.className = "collection-copy";
  const title = document.createElement("strong");
  title.className = `collection-title ${collectionTitleSizeClass(
    options.title
  )}`;
  title.textContent = options.title;
  title.title = options.title;
  const description = document.createElement("small");
  description.textContent = options.description;
  copy.append(title, description);
  openButton.append(artwork, copy);
  article.append(openButton);

  if (options.orderNumber) {
    const orderNumber = document.createElement("span");
    orderNumber.className = `collection-order-number${
      String(options.orderNumber).length > 4 ? " long-order-number" : ""
    }`;
    orderNumber.textContent = options.orderNumber;
    orderNumber.setAttribute("aria-label", `Order ${options.orderNumber}`);
    article.append(orderNumber);
  }

  if (options.onToggleSkipped) {
    const skipButton = document.createElement("button");
    skipButton.type = "button";
    skipButton.className = `collection-skip-button${
      options.skipped ? " active" : ""
    }${options.skipInherited ? " inherited" : ""}`;
    skipButton.textContent = options.skipInherited
      ? "Parent skipped"
      : options.skipped
        ? "Skipped"
        : "Skip";
    skipButton.disabled = Boolean(options.skipInherited);
    skipButton.setAttribute(
      "aria-label",
      options.skipInherited
        ? `${options.title} is skipped with its parent folder`
        : options.skipped
          ? `Include ${options.title} again`
          : `Mark ${options.title} as skipped`
    );
    skipButton.setAttribute(
      "aria-pressed",
      options.skipped && !options.skipInherited ? "true" : "false"
    );
    skipButton.addEventListener("click", options.onToggleSkipped);
    article.append(skipButton);
  }

  if (options.statusMenu) {
    article.append(collectionStatusControl(options));
  }

  article.addEventListener("mouseenter", () =>
    queueCollectionPreview(article, options)
  );
  article.addEventListener("mouseleave", () => hideCollectionPreview());
  openButton.addEventListener("focus", () =>
    queueCollectionPreview(article, options, true)
  );
  openButton.addEventListener("blur", () => hideCollectionPreview());
  return article;
}

// Collection cards carry covers too, so replacing the browse grid wholesale
// blanked every shelf in it on any re-render. Everything a card draws goes into
// this signature — plus the library generation, so a reused card never holds a
// comic record from a list that has since been replaced — and a card whose
// signature is unchanged is the same card.
function collectionCardSignature(options) {
  const comics = options.comics || [];
  const statusComics = options.statusComics || comics;
  const cover = comics.find((comic) => comic.available !== false);
  // Which comic the card's menu would open, found the way collectionStatusControl
  // finds it but without copying a publisher's worth of comics to do it.
  const readable = (comic) => comic.available !== false;
  const opener =
    statusComics.find(
      (comic) => readable(comic) && readingStatus(comic) === "in-progress"
    ) ||
    statusComics.find(
      (comic) => readable(comic) && readingStatus(comic) === "unread"
    ) ||
    statusComics.find(readable);
  return [
    libraryGeneration,
    options.className || "",
    options.eyebrow || "",
    options.title || "",
    options.description || "",
    options.orderNumber || "",
    options.skipped ? 1 : 0,
    options.skipInherited ? 1 : 0,
    options.statusMenu ? 1 : 0,
    options.onToggleSkipped ? 1 : 0,
    cover ? cover.id : "",
    comics.length,
    statusComics.length,
    opener ? opener.id : ""
  ].join("|");
}

const collectionCardNodes = new Map();

function renderCollectionGrid(grid, entries) {
  const retained = new Set();
  entries.forEach((entry, index) => {
    const signature = collectionCardSignature(entry.options);
    retained.add(entry.key);
    let cached = collectionCardNodes.get(entry.key);
    if (!cached || cached.signature !== signature) {
      // The card it replaces is still in the grid, and the sweep below only
      // knows about the nodes this map still points at.
      if (cached) cached.node.remove();
      cached = { node: collectionCard(entry.options), signature };
      collectionCardNodes.set(entry.key, cached);
    }
    const expected = grid.children[index] || null;
    if (expected !== cached.node) grid.insertBefore(cached.node, expected);
  });
  for (const [key, cached] of collectionCardNodes) {
    if (retained.has(key)) continue;
    cached.node.remove();
    collectionCardNodes.delete(key);
  }
  while (grid.children.length > entries.length) grid.lastElementChild.remove();
}

function setBrowseHeader(eyebrow, title, description) {
  elements.browseEyebrow.textContent = eyebrow;
  elements.browseTitle.textContent = title;
  elements.browseDescription.textContent = description;
}

function setBrowseNotice(messages) {
  const content = messages.filter(Boolean).join(" ");
  elements.browseNotice.textContent = content;
  elements.browseNotice.hidden = content === "";
}

function renderBreadcrumb(items) {
  const nodes = [];
  items.forEach((item, index) => {
    if (index > 0) {
      const separator = document.createElement("span");
      separator.className = "breadcrumb-separator";
      separator.textContent = "/";
      separator.setAttribute("aria-hidden", "true");
      nodes.push(separator);
    }
    if (item.current) {
      const current = document.createElement("span");
      current.className = "breadcrumb-current";
      current.textContent = item.label;
      current.setAttribute("aria-current", "page");
      nodes.push(current);
    } else {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item.label;
      button.addEventListener("click", item.onClick);
      nodes.push(button);
    }
  });
  elements.browseBreadcrumb.replaceChildren(...nodes);
}

// The two grids are left to the reconcilers: every path through a browse view
// renders both, with an empty list where it has nothing to show, so neither is
// emptied and rebuilt on the way through.
function prepareBrowseView() {
  hideCollectionPreview(true);
  chronologyTimelineContext = null;
  elements.collectionGrid.hidden = false;
  elements.chronologyTimeline.replaceChildren();
  elements.chronologyTimeline.hidden = true;
  elements.chronologyLayoutToggle.hidden = true;
  elements.browseView.classList.remove("showing-skipped-branch");
  elements.unfiledShelfButton.hidden = true;
  elements.skippedFilterButton.hidden = true;
  setBrowseNotice([]);
}

function renderPublisherView(filtered) {
  prepareBrowseView();
  const allGroups = publisherGroups(state.comics);
  const matchingGroups = publisherGroups(filtered);

  if (state.selectedPublisherKey) {
    const group =
      allGroups.find((candidate) => candidate.key === state.selectedPublisherKey) ||
      matchingGroups.find((candidate) => candidate.key === state.selectedPublisherKey);
    const matching =
      matchingGroups.find(
        (candidate) => candidate.key === state.selectedPublisherKey
      )?.comics || [];
    if (!group) state.selectedPublisherKey = null;
    else {
      renderBreadcrumb([
        {
          label: "Publishers",
          onClick: () => {
            state.selectedPublisherKey = null;
            renderComics();
          }
        },
        { label: group.label, current: true }
      ]);
      setBrowseHeader(
        group.recognized ? "Publisher" : "Unclassified source",
        group.label,
        `${group.comics.length} ${
          group.comics.length === 1 ? "comic" : "comics"
        } in this library.`
      );
      renderCollectionGrid(elements.collectionGrid, []);
      renderComicGrid(elements.browseComicGrid, matching, {
        scope: browseGridScope()
      });
      if (matching.length === 0) {
        setBrowseNotice([
          "No comics in this publisher match the current search and reading-status filter."
        ]);
      }
      return;
    }
  }

  renderBreadcrumb([{ label: "Publishers", current: true }]);
  setBrowseHeader(
    "Library view",
    "Publishers",
    "Browse recognized publishers without changing the folders or metadata in your archives."
  );
  renderComicGrid(elements.browseComicGrid, [], { scope: browseGridScope() });
  renderCollectionGrid(
    elements.collectionGrid,
    matchingGroups.map((group) => {
      const imprintText =
        group.imprints.size > 0
          ? ` · ${[...group.imprints].sort(naturalTextCompare).join(", ")}`
          : "";
      return {
        key: `publisher:${group.key}`,
        options: {
          eyebrow: group.recognized ? "Publisher" : "Unclassified source",
          title: group.label,
          description: `${group.comics.length} ${
            group.comics.length === 1 ? "comic" : "comics"
          }${imprintText}`,
          comics: group.comics,
          onClick: () => {
            state.selectedPublisherKey = group.key;
            renderComics();
          }
        }
      };
    })
  );
}

function compareRankValues(left, right) {
  const [leftWhole = "0", leftFraction = ""] = String(left).split(".");
  const [rightWhole = "0", rightFraction = ""] = String(right).split(".");
  const normalizedLeft = leftWhole.replace(/^0+(?=\d)/, "") || "0";
  const normalizedRight = rightWhole.replace(/^0+(?=\d)/, "") || "0";
  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length - normalizedRight.length;
  }
  const wholeComparison = normalizedLeft.localeCompare(normalizedRight);
  if (wholeComparison !== 0) return wholeComparison;
  const width = Math.max(leftFraction.length, rightFraction.length);
  return leftFraction
    .padEnd(width, "0")
    .localeCompare(rightFraction.padEnd(width, "0"));
}

function compareChronologyNodes(left, right) {
  if (left.rank && right.rank) {
    const rankComparison = compareRankValues(left.rank, right.rank);
    if (rankComparison !== 0) return rankComparison;
  } else if (left.rank) {
    return -1;
  } else if (right.rank) {
    return 1;
  }
  const roleWeight = {
    publisher: 0,
    "ordered-section": 1,
    series: 2,
    group: 3,
    unranked: 4,
    source: 5
  };
  const roleComparison =
    (roleWeight[left.role] ?? 9) - (roleWeight[right.role] ?? 9);
  if (roleComparison !== 0) return roleComparison;
  return naturalTextCompare(left.displayName, right.displayName);
}

function compareComicsByOrderPath(left, right) {
  const leftPath = Array.isArray(left.orderPath) ? left.orderPath : [];
  const rightPath = Array.isArray(right.orderPath) ? right.orderPath : [];
  const length = Math.max(leftPath.length, rightPath.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftPath[index];
    const rightPart = rightPath[index];
    if (!leftPart) return -1;
    if (!rightPart) return 1;
    if (leftPart.rank && rightPart.rank) {
      const rankComparison = compareRankValues(leftPart.rank, rightPart.rank);
      if (rankComparison !== 0) return rankComparison;
    } else if (leftPart.rank) {
      return -1;
    } else if (rightPart.rank) {
      return 1;
    }
    const labelComparison = naturalTextCompare(
      leftPart.label || leftPart.name,
      rightPart.label || rightPart.name
    );
    if (labelComparison !== 0) return labelComparison;
  }
  return naturalTextCompare(left.title, right.title);
}

function chronologyNode(options) {
  return {
    id: options.id,
    parent: options.parent || null,
    name: options.name,
    displayName: options.displayName || options.name,
    role: options.role || "group",
    rank: options.rank || null,
    sourceProfile: options.sourceProfile || null,
    sourceKey: options.sourceKey || null,
    directComics: [],
    comics: [],
    childMap: new Map(),
    children: []
  };
}

function chronologyOrderNumber(node) {
  if (!node.rank) return null;
  const orderedSiblings = (node.parent?.children || []).filter(
    (sibling) => sibling.rank
  );
  const index = orderedSiblings.indexOf(node);
  return index >= 0 ? String(index + 1) : null;
}

function canSkipChronologyNode(node) {
  return Boolean(
    node &&
      node.comics.length > 0 &&
      !["root", "source", "publisher"].includes(node.role)
  );
}

function isChronologyNodeExplicitlySkipped(node) {
  return Boolean(node && state.skippedChronologyNodeIds.has(node.id));
}

function skippedChronologyAncestor(node) {
  let ancestor = node?.parent || null;
  while (ancestor) {
    if (isChronologyNodeExplicitlySkipped(ancestor)) return ancestor;
    ancestor = ancestor.parent;
  }
  return null;
}

function isChronologyNodeSkipped(node) {
  return (
    isChronologyNodeExplicitlySkipped(node) ||
    Boolean(skippedChronologyAncestor(node))
  );
}

function toggleChronologyNodeSkipped(node) {
  if (!canSkipChronologyNode(node) || skippedChronologyAncestor(node)) return;
  const skipping = !isChronologyNodeExplicitlySkipped(node);
  if (skipping) {
    state.skippedChronologyNodeIds.add(node.id);
  } else {
    state.skippedChronologyNodeIds.delete(node.id);
  }
  persistChronologyPreferences();
  renderComics();
  // The shelf redraws first and the write follows: skipping a branch is a
  // local decision that must not wait for the NAS.
  fetch("/api/skips", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      skipping ? { add: [node.id] } : { remove: [node.id] }
    )
  })
    .then((response) => {
      if (response.ok) return;
      throw new Error("The server did not record that.");
    })
    .catch(() => {
      // Put it back rather than leave the two sides disagreeing silently.
      if (skipping) state.skippedChronologyNodeIds.delete(node.id);
      else state.skippedChronologyNodeIds.add(node.id);
      persistChronologyPreferences();
      renderComics();
      showToast("That collection could not be updated on the server.");
    });
}

function renderChronologySkipFilter(tree) {
  const validSkippedCount = [...state.skippedChronologyNodeIds].filter((id) => {
    const node = tree.byId.get(id);
    return canSkipChronologyNode(node);
  }).length;
  const activelyHiding =
    state.hideSkippedChronology && validSkippedCount > 0;
  elements.skippedFilterButton.hidden = false;
  elements.skippedFilterButton.disabled = validSkippedCount === 0;
  elements.skippedFilterButton.classList.toggle("active", activelyHiding);
  elements.skippedFilterButton.setAttribute(
    "aria-pressed",
    activelyHiding ? "true" : "false"
  );
  elements.skippedFilterLabel.textContent = activelyHiding
    ? "Show skipped"
    : "Hide skipped";
  elements.skippedFilterCount.textContent = String(validSkippedCount);
  elements.skippedFilterCount.hidden = validSkippedCount === 0;
}

function buildChronologyTree() {
  const allowedProfiles = new Set([
    "hierarchical-timeline",
    "exact-reading-order"
  ]);
  const root = chronologyNode({
    id: "chronology",
    name: "Chronological",
    role: "root"
  });
  const byId = new Map([[root.id, root]]);
  const sourceNodes = new Map();
  const stagingBySource = new Map();
  const stagingComics = [];
  let excludedStaging = 0;

  for (const comic of state.comics) {
    if (!allowedProfiles.has(comic.sourceProfile)) continue;
    const sourceKey = encodeURIComponent(
      comic.sourceId || comic.libraryRoot || comic.sourceName || "source"
    );
    if ((comic.hierarchy || []).some((node) => node.role === "staging")) {
      excludedStaging += 1;
      stagingComics.push(comic);
      let stagingGroup = stagingBySource.get(sourceKey);
      if (!stagingGroup) {
        stagingGroup = {
          sourceKey,
          sourceName: comic.sourceName || "Comics",
          comics: []
        };
        stagingBySource.set(sourceKey, stagingGroup);
      }
      stagingGroup.comics.push(comic);
      continue;
    }
    const sourceId = `${root.id}/source:${sourceKey}`;
    let sourceNode = root.childMap.get(sourceId);
    if (!sourceNode) {
      sourceNode = chronologyNode({
        id: sourceId,
        parent: root,
        name: comic.sourceName || "Comics",
        displayName: comic.sourceName || "Comics",
        role: "source",
        sourceProfile: comic.sourceProfile,
        sourceKey
      });
      root.childMap.set(sourceId, sourceNode);
      byId.set(sourceId, sourceNode);
      sourceNodes.set(sourceKey, sourceNode);
    }

    let parent = sourceNode;
    for (const segment of comic.hierarchy || []) {
      if (segment.role === "staging") break;
      const childId = `${parent.id}/folder:${encodeURIComponent(segment.name)}`;
      let child = parent.childMap.get(childId);
      if (!child) {
        child = chronologyNode({
          id: childId,
          parent,
          name: segment.name,
          displayName: segment.displayName || segment.name,
          role: segment.role,
          rank: segment.rank,
          sourceProfile: comic.sourceProfile
        });
        parent.childMap.set(childId, child);
        byId.set(childId, child);
      }
      parent = child;
    }
    parent.directComics.push(comic);
  }

  function finalize(node) {
    node.children = [...node.childMap.values()].sort(compareChronologyNodes);
    node.directComics.sort(compareComicsByOrderPath);
    for (const child of node.children) finalize(child);
    node.comics = [
      ...node.directComics,
      ...node.children.flatMap((child) => child.comics)
    ];
  }
  finalize(root);
  stagingComics.sort(compareComicsByOrderPath);
  for (const group of stagingBySource.values()) {
    group.comics.sort(compareComicsByOrderPath);
  }
  return {
    root,
    byId,
    sourceNodes,
    stagingBySource,
    stagingComics,
    excludedStaging
  };
}

function defaultChronologyNode(tree) {
  const selected = state.chronologyNodeId
    ? tree.byId.get(state.chronologyNodeId)
    : null;
  if (selected) return selected;
  let current = tree.root;
  if (current.children.length === 1) current = current.children[0];
  if (
    current.children.length === 1 &&
    current.directComics.length === 0 &&
    current.children[0].role === "publisher"
  ) {
    current = current.children[0];
  }
  return current;
}

function chronologyRoleLabel(node) {
  if (node.role === "publisher") return "Publisher";
  if (node.role === "source") {
    return node.sourceProfile === "exact-reading-order"
      ? "Exact reading order"
      : "Timeline source";
  }
  if (node.role === "ordered-section") {
    return node.rank ? `Chronology section · ${node.rank}` : "Chronology section";
  }
  if (node.role === "series") return "Series";
  return "Folder · not globally ordered";
}

function renderChronologyBreadcrumb(current) {
  const ancestry = [];
  let node = current;
  while (node && node.role !== "root") {
    ancestry.unshift(node);
    node = node.parent;
  }
  const items = [
    {
      label: "Chronological",
      current: ancestry.length === 0,
      onClick: () => {
        state.chronologyUnfiledScope = null;
        state.chronologyNodeId = null;
        renderComics();
      }
    }
  ];
  ancestry.forEach((ancestor, index) => {
    const currentItem = index === ancestry.length - 1;
    items.push({
      label: ancestor.displayName,
      current: currentItem,
      onClick: () => {
        state.chronologyUnfiledScope = null;
        state.chronologyNodeId = ancestor.id;
        renderComics();
      }
    });
  });
  renderBreadcrumb(items);
}

function chronologySourceAncestor(node) {
  let current = node;
  while (current && current.role !== "source") current = current.parent;
  return current || null;
}

function unfiledGroupForNode(tree, node) {
  if (tree.stagingComics.length === 0) return null;
  if (node.role === "root") {
    return {
      scope: "all",
      sourceNode: null,
      comics: tree.stagingComics
    };
  }
  if (!["source", "publisher"].includes(node.role)) return null;
  const sourceNode = chronologySourceAncestor(node);
  const group = sourceNode
    ? tree.stagingBySource.get(sourceNode.sourceKey)
    : null;
  if (!sourceNode || !group || group.comics.length === 0) return null;
  return {
    scope: `source:${sourceNode.sourceKey}`,
    sourceNode,
    comics: group.comics
  };
}

function renderUnfiledShelfButton(tree, node = null) {
  const sourceNode = chronologySourceAncestor(node);
  const sourceGroup = sourceNode
    ? tree.stagingBySource.get(sourceNode.sourceKey)
    : null;
  const comics = sourceGroup?.comics || tree.stagingComics;
  const scope = sourceGroup ? `source:${sourceNode.sourceKey}` : "all";
  elements.unfiledShelfButton.hidden = comics.length === 0;
  elements.unfiledShelfButton.dataset.scope = scope;
  elements.unfiledShelfButton.classList.toggle(
    "active",
    state.chronologyUnfiledScope === scope
  );
  elements.unfiledShelfButton.setAttribute(
    "aria-pressed",
    state.chronologyUnfiledScope === scope ? "true" : "false"
  );
  elements.unfiledShelfCount.textContent = String(comics.length);
}

function renderUnfiledView(filtered, tree) {
  const scope = state.chronologyUnfiledScope;
  let sourceNode = null;
  let comics = tree.stagingComics;
  if (scope && scope.startsWith("source:")) {
    const sourceKey = scope.slice("source:".length);
    sourceNode = tree.sourceNodes.get(sourceKey) || null;
    comics = tree.stagingBySource.get(sourceKey)?.comics || [];
  }
  if (!scope || comics.length === 0) return false;

  renderUnfiledShelfButton(tree, sourceNode);
  const matchingIds = new Set(filtered.map((comic) => comic.id));
  const matching = comics.filter((comic) => matchingIds.has(comic.id));
  const breadcrumb = [
    {
      label: "Chronological",
      onClick: () => {
        state.chronologyUnfiledScope = null;
        state.chronologyNodeId = null;
        renderComics();
      }
    }
  ];
  if (sourceNode) {
    breadcrumb.push({
      label: sourceNode.displayName,
      onClick: () => {
        state.chronologyUnfiledScope = null;
        state.chronologyNodeId = sourceNode.id;
        renderComics();
      }
    });
  }
  breadcrumb.push({ label: "Unfiled", current: true });
  renderBreadcrumb(breadcrumb);
  setBrowseHeader(
    "Staging shelf",
    "Unfiled",
    `${comics.length} ${
      comics.length === 1 ? "comic is" : "comics are"
    } indexed from folders beginning with “_”, without assigning a chronology position.`
  );
  renderCollectionGrid(elements.collectionGrid, []);
  renderComicGrid(elements.browseComicGrid, matching, {
    scope: browseGridScope()
  });
  setBrowseNotice(
    matching.length === 0
      ? ["No Unfiled comics match the current search and reading-status filter."]
      : []
  );
  return true;
}

function comicPublicationYear(comic) {
  const year = Number(comic?.metadata?.year);
  return Number.isInteger(year) && year >= 1800 && year <= 2199
    ? year
    : null;
}

function chronologyYearSummary(comics) {
  const years = [...new Set((comics || []).map(comicPublicationYear).filter(Boolean))]
    .sort((left, right) => left - right);
  if (years.length === 0) return { label: "Year unknown", years: [] };
  return {
    label:
      years.length === 1
        ? String(years[0])
        : `${years[0]}–${years.at(-1)}`,
    years
  };
}

function chronologyYearSource(comics, years) {
  if (years.length === 0) {
    return "No publication year found in metadata or the filename yet";
  }
  const matching = (comics || []).filter((comic) =>
    years.includes(comicPublicationYear(comic))
  );
  const sources = new Set();
  for (const comic of matching) {
    if (comic.manualOverride?.metadata?.year) sources.add("manual edits");
    else if (comic.embeddedMetadata?.year) sources.add("ComicInfo.xml");
    else if (comic.onlineMatch?.record?.metadata?.year) sources.add("online metadata");
    else if (comic.inferredMetadata?.year) sources.add("filename");
  }
  return sources.size === 1
    ? `Publication year from ${[...sources][0]}`
    : "Publication years from local and enriched metadata";
}

function renderChronologyLayoutToggle() {
  elements.chronologyLayoutToggle.hidden = false;
  elements.chronologyLayoutToggle
    .querySelectorAll("[data-chronology-layout]")
    .forEach((button) => {
      const active = button.dataset.chronologyLayout === state.chronologyLayout;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
}

function timelineCover(node, active, distance, matchingIds) {
  const matchingComics = node.comics.filter((comic) => matchingIds.has(comic.id));
  const firstComic = matchingComics.find((comic) => comic.available !== false);
  const item = document.createElement("button");
  item.type = "button";
  item.className = `timeline-cover-item${active ? " active" : ""}${
    isChronologyNodeSkipped(node) ? " skipped" : ""
  } distance-${Math.min(2, Math.abs(distance))}`;
  item.setAttribute("aria-label", `${active ? "Current: " : "Focus "}${node.displayName}`);
  item.dataset.nodeId = node.id;

  const art = document.createElement("span");
  art.className = "timeline-cover-art";
  const fallback = document.createElement("span");
  fallback.className = "timeline-cover-fallback";
  fallback.textContent = collectionInitials(node.displayName);
  art.append(fallback);
  if (firstComic) {
    art.append(coverImage(thumbnailUrl(firstComic.id), fallback));
  }
  const number = document.createElement("span");
  number.className = "timeline-cover-number";
  number.textContent = chronologyOrderNumber(node) || "•";
  art.append(number);

  const copy = document.createElement("span");
  copy.className = "timeline-cover-copy";
  const title = document.createElement("strong");
  title.textContent = node.displayName;
  const year = document.createElement("small");
  year.textContent = chronologyYearSummary(node.comics).label;
  copy.append(title, year);
  item.append(art, copy);
  item.addEventListener("click", () => {
    focusChronologyTimeline(node.id);
  });
  return item;
}

function timelineIssueStrip(node, matchingIds) {
  const matching = node.comics.filter((comic) => matchingIds.has(comic.id));
  if (matching.length === 0) return null;
  const section = document.createElement("section");
  section.className = "timeline-inside";
  const heading = document.createElement("div");
  heading.className = "timeline-inside-heading";
  const copy = document.createElement("span");
  const label = document.createElement("strong");
  label.textContent = "Inside this position";
  const detail = document.createElement("small");
  detail.textContent = `${matching.length} ${matching.length === 1 ? "comic" : "comics"} in reading order`;
  copy.append(label, detail);
  const open = document.createElement("button");
  open.type = "button";
  open.className = "timeline-open-button";
  open.textContent = node.children.length > 0 ? "Open branch" : "Open collection";
  open.addEventListener("click", () => {
    state.chronologyNodeId = node.id;
    state.chronologyTimelineFocusId = null;
    renderComics();
  });
  const actions = document.createElement("div");
  actions.className = "timeline-inside-actions";
  if (canSkipChronologyNode(node)) {
    const inherited = Boolean(skippedChronologyAncestor(node));
    const skipped = isChronologyNodeSkipped(node);
    const skip = document.createElement("button");
    skip.type = "button";
    skip.className = `timeline-skip-button${skipped ? " active" : ""}`;
    skip.textContent = inherited ? "Parent skipped" : skipped ? "Include again" : "Skip";
    skip.disabled = inherited;
    skip.addEventListener("click", () => toggleChronologyNodeSkipped(node));
    actions.append(skip);
  }
  actions.append(
    collectionStatusControl(
      {
        title: node.displayName,
        comics: matching,
        statusComics: node.comics,
        skipped: isChronologyNodeSkipped(node),
        skipInherited: Boolean(skippedChronologyAncestor(node)),
        onToggleSkipped: canSkipChronologyNode(node)
          ? () => toggleChronologyNodeSkipped(node)
          : null
      },
      true
    )
  );
  actions.append(open);
  heading.append(copy, actions);

  const row = document.createElement("div");
  row.className = "timeline-issue-row";
  matching.slice(0, 16).forEach((comic, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `timeline-issue status-${readingStatus(comic)}`;
    button.disabled = comic.available === false;
    button.setAttribute("aria-label", `Read ${comic.title}`);
    const art = document.createElement("span");
    art.className = "timeline-issue-art";
    const image = coverImage(thumbnailUrl(comic.id));
    const sequence = document.createElement("span");
    sequence.textContent = String(index + 1);
    art.append(image, sequence);
    const title = document.createElement("strong");
    title.textContent = comic.title;
    button.append(art, title);
    button.dataset.comicId = comic.id;
    if (comic.available !== false) {
      button.addEventListener("click", () => openReader(comic));
    }
    row.append(button);
  });
  if (matching.length > 16) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "timeline-more-comics";
    more.textContent = `+${matching.length - 16}`;
    more.addEventListener("click", () => {
      state.chronologyNodeId = node.id;
      state.chronologyTimelineFocusId = null;
      renderComics();
    });
    row.append(more);
  }
  section.append(heading, row);
  return section;
}

function renderFocusedTimeline(children, matchingIds) {
  if (state.chronologyLayout !== "timeline" || children.length === 0) {
    chronologyTimelineContext = null;
    elements.chronologyTimeline.hidden = true;
    return;
  }
  chronologyTimelineContext = { children, matchingIds };
  const focusIndex = Math.max(
    0,
    children.findIndex((child) => child.id === state.chronologyTimelineFocusId)
  );
  const activeNode = children[focusIndex] || children[0];
  state.chronologyTimelineFocusId = activeNode.id;
  const activeComics = activeNode.comics;
  const yearSummary = chronologyYearSummary(activeComics);

  const timeline = document.createElement("div");
  timeline.className = "focused-timeline";
  timeline.tabIndex = 0;
  timeline.setAttribute("aria-label", "Chronology timeline carousel");

  const yearHeader = document.createElement("header");
  yearHeader.className = "timeline-year-header";
  const yearCopy = document.createElement("span");
  const eyebrow = document.createElement("small");
  eyebrow.textContent = "Current publication year";
  const year = document.createElement("strong");
  year.textContent = yearSummary.label;
  const source = document.createElement("em");
  source.textContent = chronologyYearSource(activeComics, yearSummary.years);
  yearCopy.append(eyebrow, year, source);
  const position = document.createElement("span");
  position.className = "timeline-position-summary";
  position.textContent = `Position ${focusIndex + 1} of ${children.length}`;
  yearHeader.append(yearCopy, position);

  const rail = document.createElement("div");
  rail.className = "timeline-rail";
  children.forEach((child, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `${index === focusIndex ? "active " : ""}${
      isChronologyNodeSkipped(child) ? "skipped" : ""
    }`;
    button.dataset.year = chronologyYearSummary(child.comics).label;
    const dot = document.createElement("span");
    dot.textContent = chronologyOrderNumber(child) || "•";
    const label = document.createElement("small");
    label.textContent = button.dataset.year;
    button.append(dot, label);
    button.setAttribute("aria-label", `${child.displayName}, ${button.dataset.year}`);
    button.addEventListener("click", () => {
      focusChronologyTimeline(child.id);
    });
    rail.append(button);
    if (index === focusIndex) {
      requestAnimationFrame(() => button.scrollIntoView({ block: "nearest", inline: "center" }));
    }
  });

  const carousel = document.createElement("div");
  carousel.className = "timeline-carousel";
  const previous = document.createElement("button");
  previous.type = "button";
  previous.className = "timeline-arrow previous";
  previous.textContent = "‹";
  previous.disabled = focusIndex === 0;
  previous.setAttribute("aria-label", "Previous chronology position");
  const next = document.createElement("button");
  next.type = "button";
  next.className = "timeline-arrow next";
  next.textContent = "›";
  next.disabled = focusIndex === children.length - 1;
  next.setAttribute("aria-label", "Next chronology position");
  const moveFocus = (offset) => {
    const target = children[Math.max(0, Math.min(children.length - 1, focusIndex + offset))];
    if (!target || target === activeNode) return;
    focusChronologyTimeline(target.id);
  };
  previous.addEventListener("click", () => moveFocus(-1));
  next.addEventListener("click", () => moveFocus(1));

  const covers = document.createElement("div");
  covers.className = "timeline-covers";
  children.forEach((child, index) => {
    const distance = index - focusIndex;
    if (Math.abs(distance) <= 2) {
      covers.append(timelineCover(child, distance === 0, distance, matchingIds));
    }
  });
  carousel.append(previous, covers, next);

  const inside = timelineIssueStrip(activeNode, matchingIds);
  timeline.append(yearHeader, rail, carousel);
  if (inside) timeline.append(inside);
  timeline.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") { event.preventDefault(); moveFocus(-1); }
    if (event.key === "ArrowRight") { event.preventDefault(); moveFocus(1); }
    if (event.key === "Home") {
      event.preventDefault();
      focusChronologyTimeline(children[0].id);
    }
    if (event.key === "End") {
      event.preventDefault();
      focusChronologyTimeline(children.at(-1).id);
    }
  });
  elements.chronologyTimeline.replaceChildren(timeline);
  elements.chronologyTimeline.hidden = false;
}

function focusChronologyTimeline(nodeId) {
  if (!chronologyTimelineContext) return;
  state.chronologyTimelineFocusId = nodeId;
  renderFocusedTimeline(
    chronologyTimelineContext.children,
    chronologyTimelineContext.matchingIds
  );
}

function renderChronologicalView(filtered) {
  prepareBrowseView();
  const tree = buildChronologyTree();
  if (renderUnfiledView(filtered, tree)) return;
  state.chronologyUnfiledScope = null;
  renderChronologyLayoutToggle();
  let current = defaultChronologyNode(tree);
  if (state.hideSkippedChronology && isChronologyNodeSkipped(current)) {
    while (current.parent && isChronologyNodeSkipped(current)) {
      current = current.parent;
    }
    state.chronologyNodeId =
      current.role === "root" ? null : current.id;
  }
  renderUnfiledShelfButton(tree, current);
  renderChronologySkipFilter(tree);
  const matchingIds = new Set(filtered.map((comic) => comic.id));
  const allMatchingChildren = current.children.filter((child) =>
    child.comics.some((comic) => matchingIds.has(comic.id))
  );
  const hiddenSkippedChildren = state.hideSkippedChronology
    ? allMatchingChildren.filter((child) => isChronologyNodeSkipped(child))
    : [];
  const matchingChildren = state.hideSkippedChronology
    ? allMatchingChildren.filter((child) => !isChronologyNodeSkipped(child))
    : allMatchingChildren;
  const matchingDirect = current.directComics.filter((comic) =>
    matchingIds.has(comic.id)
  );
  const currentSkipped = isChronologyNodeSkipped(current);
  elements.browseView.classList.toggle(
    "showing-skipped-branch",
    currentSkipped
  );

  renderChronologyBreadcrumb(current);
  if (current.role === "root") {
    setBrowseHeader(
      "Library view",
      "Chronological",
      "Choose an ordered source. PanelShelf keeps each numbered folder branch separate."
    );
  } else {
    const descriptions = {
      source:
        current.sourceProfile === "exact-reading-order"
          ? "Files follow their explicit numeric positions."
          : "Browse the numbered hierarchy stored in this source.",
      publisher:
        "Numbered child folders are ordered within this publisher branch.",
      "ordered-section":
        "This position is relative to its parent folder; child branches keep their own order.",
      group:
        "This folder remains a separate branch and is not merged into a global chronology.",
      unranked:
        "This unnumbered branch is browsable but has no inferred global position."
    };
    setBrowseHeader(
      chronologyRoleLabel(current),
      current.displayName,
      descriptions[current.role] ||
        "Browse the comics and child folders stored in this branch."
    );
  }

  const collectionCards = [];
  const unfiledGroup = unfiledGroupForNode(tree, current);
  if (unfiledGroup) {
    const matchingUnfiled = unfiledGroup.comics.filter((comic) =>
      matchingIds.has(comic.id)
    );
    collectionCards.push({
      key: `chronology-unfiled:${unfiledGroup.scope}`,
      options: {
        className: "unfiled-collection",
        eyebrow: "Staging shelf",
        title: "Unfiled",
        description:
          matchingUnfiled.length === unfiledGroup.comics.length
            ? `${unfiledGroup.comics.length} ${
                unfiledGroup.comics.length === 1 ? "comic" : "comics"
              }`
            : `${unfiledGroup.comics.length} comics · ${matchingUnfiled.length} match filters`,
        comics:
          matchingUnfiled.length > 0 ? matchingUnfiled : unfiledGroup.comics,
        statusComics: unfiledGroup.comics,
        statusMenu: true,
        onClick: () => {
          state.chronologyUnfiledScope = unfiledGroup.scope;
          renderComics();
        }
      }
    });
  }
  collectionCards.push(
    ...matchingChildren.map((child) => {
      const matchingComics = child.comics.filter((comic) =>
        matchingIds.has(comic.id)
      );
      const inheritedSkip = Boolean(skippedChronologyAncestor(child));
      const skipped = isChronologyNodeSkipped(child);
      return {
        key: `chronology:${child.id}`,
        options: {
          eyebrow: chronologyRoleLabel(child),
          title: child.displayName,
          description: `${matchingComics.length} ${
            matchingComics.length === 1
              ? "comic"
              : "comics"
          }`,
          comics: matchingComics,
          statusComics: child.comics,
          statusMenu: true,
          orderNumber: chronologyOrderNumber(child),
          skipped,
          skipInherited: inheritedSkip,
          onToggleSkipped: canSkipChronologyNode(child)
            ? () => toggleChronologyNodeSkipped(child)
            : null,
          onClick: () => {
            state.chronologyUnfiledScope = null;
            state.chronologyNodeId = child.id;
            state.chronologyTimelineFocusId = null;
            renderComics();
          }
        }
      };
    })
  );
  renderCollectionGrid(elements.collectionGrid, collectionCards);
  renderFocusedTimeline(matchingChildren, matchingIds);
  elements.collectionGrid.hidden =
    state.chronologyLayout === "timeline" && matchingChildren.length > 0;
  renderComicGrid(elements.browseComicGrid, matchingDirect, {
    scope: browseGridScope()
  });

  const allowedProfiles = new Set([
    "hierarchical-timeline",
    "exact-reading-order"
  ]);
  const unsupported = state.libraries.filter(
    (source) => !allowedProfiles.has(source.profile)
  );
  const messages = [];
  if (currentSkipped) {
    messages.push(
      "This folder is marked Skipped. Its comics remain indexed and unchanged."
    );
  }
  if (hiddenSkippedChildren.length > 0) {
    messages.push(
      `${hiddenSkippedChildren.length} skipped ${
        hiddenSkippedChildren.length === 1 ? "branch is" : "branches are"
      } hidden.`
    );
  }
  if (matchingChildren.some((child) => !child.rank && child.role !== "publisher")) {
    messages.push(
      "Unnumbered sibling folders are shown as separate branches; PanelShelf does not merge them into an invented chronology."
    );
  }
  if (tree.excludedStaging > 0) {
    messages.push(
      `${tree.excludedStaging} staging ${
        tree.excludedStaging === 1 ? "comic is" : "comics are"
      } available in the Unfiled shelf and not assigned a chronology position.`
    );
  }
  if (unsupported.length > 0 && current === tree.root) {
    messages.push(
      `${unsupported.length} ${
        unsupported.length === 1 ? "source is" : "sources are"
      } omitted because only Hierarchical Timeline and Exact Reading Order sources can establish chronology.`
    );
  }
  if (matchingChildren.length === 0 && matchingDirect.length === 0) {
    messages.push(
      tree.root.comics.length === 0
        ? "No source currently has a chronology profile. Set a source to Hierarchical Timeline or Exact Reading Order in Library settings."
        : hiddenSkippedChildren.length > 0
          ? "Every matching child branch here is hidden as skipped. Use Show skipped to review or restore one."
        : "No comics in this branch match the current search and reading-status filter."
    );
  }
  setBrowseNotice(messages);
}

function renderComics() {
  closeComicStatusMenu();
  const filtered = filteredLibraryComics();
  const hasLibraries = state.libraries.length > 0;
  elements.emptyState.hidden = hasLibraries || state.comics.length > 0;
  elements.noResults.hidden = filtered.length > 0 || state.comics.length === 0;
  elements.comicGrid.hidden = true;
  elements.browseView.hidden = true;
  if (filtered.length > 0 && state.libraryView === "publisher") {
    elements.browseView.hidden = false;
    renderPublisherView(filtered);
  } else if (filtered.length > 0 && state.libraryView === "chronological") {
    elements.browseView.hidden = false;
    renderChronologicalView(filtered);
  } else {
    // The shelf keeps its cards while a browse view is on screen, so coming
    // back to it costs nothing; an empty list is what clears them.
    renderComicGrid(elements.comicGrid, filtered, { scope: libraryShelfScope() });
    elements.comicGrid.hidden = filtered.length === 0;
  }
  const unavailable = state.libraries.filter((item) => !item.available).length;
  elements.librarySummary.textContent = hasLibraries
    ? `${state.comics.length} ${state.comics.length === 1 ? "comic" : "comics"} across ${state.libraries.length} ${state.libraries.length === 1 ? "source" : "sources"}${unavailable ? ` · ${unavailable} unavailable` : ""}`
    : "Add a source folder to begin.";
  elements.libraryControls.hidden = state.comics.length === 0;
  document.querySelectorAll(".view-chip").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.libraryView);
  });
}

function renderContinueReading() {
  const continuing = state.comics
    .filter(
      (comic) =>
        comic.available !== false && readingStatus(comic) === "in-progress"
    )
    .sort((left, right) => {
      const leftTime = Date.parse(progressFor(left.id)?.lastReadAt || 0);
      const rightTime = Date.parse(progressFor(right.id)?.lastReadAt || 0);
      return rightTime - leftTime;
    })
    .slice(0, 12);
  elements.continueSection.hidden = continuing.length === 0;
  renderComicGrid(elements.continueRow, continuing, {
    scope: "continue",
    windowed: false,
    cardFor: (comic) => ({
      compact: true,
      orderId: progressFor(comic.id)?.orderId || null
    })
  });
}

function orderProgress(order) {
  const comics = order.comicIds.map(comicById).filter(Boolean);
  return {
    available: comics.filter((comic) => comic.available !== false),
    finished: comics.filter((comic) => readingStatus(comic) === "completed")
      .length,
    inProgress: comics.filter(
      (comic) => readingStatus(comic) === "in-progress"
    ).length
  };
}

function orderCard(order) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "order-card";
  const cover = document.createElement("span");
  cover.className = "order-card-cover";
  if (order.coverComicId && comicById(order.coverComicId)?.available !== false) {
    const image = document.createElement("img");
    image.src = thumbnailUrl(order.coverComicId);
    image.alt = "";
    image.loading = "lazy";
    cover.append(image);
  }
  const copy = document.createElement("span");
  copy.className = "order-card-copy";
  const kind = document.createElement("small");
  kind.textContent =
    order.kind === "manual"
      ? "Manual chronology"
      : profileLabel(order.profile);
  const name = document.createElement("strong");
  name.textContent = order.name;
  const stats = orderProgress(order);
  const meta = document.createElement("span");
  meta.textContent = `${order.itemCount} ${order.itemCount === 1 ? "comic" : "comics"} · ${stats.finished} finished${
    order.unplacedComicIds.length
      ? ` · ${order.unplacedComicIds.length} unplaced`
      : ""
  }`;
  copy.append(kind, name, meta);
  card.append(cover, copy);
  card.addEventListener("click", () => openOrderDetail(order.id));
  return card;
}

function renderOrders() {
  if (!elements.manualOrderList || !elements.automaticOrderList) return;
  // These cards live inside the orders dialog and nowhere else, and drawing one
  // walks every comic in the order to count what is finished. Redrawing them
  // behind a closed dialog on every shelf status change was seconds of work
  // nobody could see; opening the dialog draws them.
  if (elements.ordersDialog && !elements.ordersDialog.open) return;
  if (state.manualOrders.length === 0) {
    const empty = document.createElement("div");
    empty.className = "source-empty";
    empty.textContent =
      "No manual chronologies yet. Create one when folders alone cannot express the order.";
    elements.manualOrderList.replaceChildren(empty);
  } else {
    elements.manualOrderList.replaceChildren(
      ...state.manualOrders.map(orderCard)
    );
  }
  if (state.automaticOrders.length === 0) {
    const empty = document.createElement("div");
    empty.className = "source-empty";
    empty.textContent = "Scan a configured source to create automatic reading contexts.";
    elements.automaticOrderList.replaceChildren(empty);
  } else {
    elements.automaticOrderList.replaceChildren(
      ...state.automaticOrders.slice(0, 300).map(orderCard)
    );
  }
}

function openOrders() {
  if (!elements.ordersDialog.open) elements.ordersDialog.showModal();
  renderOrders();
}

function detailItem(comicIdValue, order, position) {
  const comic = comicById(comicIdValue);
  const row = document.createElement(comic ? "button" : "div");
  if (comic) row.type = "button";
  row.className = `order-item${comic ? "" : " missing"}`;
  const number = document.createElement("span");
  number.className = "order-position";
  number.textContent = String(position + 1).padStart(2, "0");
  const cover = document.createElement("span");
  cover.className = "order-item-cover";
  if (comic && comic.available !== false) {
    const image = document.createElement("img");
    image.src = thumbnailUrl(comic.id);
    image.alt = "";
    image.loading = "lazy";
    cover.append(image);
  }
  const copy = document.createElement("span");
  copy.className = "order-item-copy";
  const title = document.createElement("strong");
  title.textContent = comic ? comic.title : "Comic is no longer in the library";
  const meta = document.createElement("small");
  meta.textContent = comic
    ? `${comic.series} · ${statusLabel(readingStatus(comic))}${
        comic.available === false ? " · source offline" : ""
      }`
    : comicIdValue;
  copy.append(title, meta);
  row.append(number, cover, copy);
  if (comic) {
    row.disabled = comic.available === false;
    row.addEventListener("click", () => openReader(comic, order.id));
  }
  return row;
}

function firstReadableComic(order) {
  const comics = order.comicIds
    .map(comicById)
    .filter(
      (comic) =>
        comic &&
        comic.available !== false &&
        readingStatus(comic) !== "skipped"
    );
  return (
    comics.find((comic) => readingStatus(comic) === "in-progress") ||
    comics.find((comic) => readingStatus(comic) === "unread") ||
    comics[0] ||
    null
  );
}

// Asked after the dialog is drawn rather than before: the order's own contents
// are already on screen, and a report that has not arrived should not hold them
// up. Only manual orders can be repaired — an automatic one is derived from
// folders and is whatever they say it is.
async function loadOrderRepairState(orderId) {
  try {
    const report = await api(`/api/reading-orders/${orderId}/repair`);
    if (state.activeOrderId !== orderId) return;
    elements.repairOrderButton.hidden = report.healthy;
    if (report.healthy) return;
    const parts = [];
    if (report.missing.length > 0) {
      parts.push(
        `${report.missing.length} ${report.missing.length === 1 ? "entry is" : "entries are"} no longer in the library.`
      );
    }
    if (report.duplicated.length > 0) {
      parts.push(
        `${report.duplicated.length} ${report.duplicated.length === 1 ? "comic is" : "comics are"} listed more than once.`
      );
    }
    elements.orderDetailNotice.textContent =
      `${elements.orderDetailNotice.textContent} ${parts.join(" ")}`.trim();
    elements.orderDetailNotice.hidden = false;
  } catch {
    // A report that cannot be fetched is not worth a banner: the order itself
    // is on screen and readable, which is what the reader came for.
  }
}

function openOrderDetail(orderId) {
  const order = orderById(orderId);
  if (!order) {
    showToast("That reading order is no longer available.");
    return;
  }
  state.activeOrderId = order.id;
  const progress = orderProgress(order);
  elements.orderDetailKind.textContent =
    order.kind === "manual" ? "Manual chronology" : profileLabel(order.profile);
  elements.orderDetailName.textContent = order.name;
  elements.orderDetailDescription.textContent =
    order.description || "No description yet.";
  elements.orderDetailCount.textContent = String(order.itemCount);
  elements.orderDetailFinished.textContent = String(progress.finished);
  elements.orderDetailUnplaced.textContent = String(
    order.unplacedComicIds.length
  );
  elements.orderDetailActions.hidden = order.kind !== "manual";

  elements.orderDetailCover.hidden = true;
  elements.orderCoverFallback.hidden = false;
  elements.orderDetailCover.classList.remove("custom-cover");
  if (order.hasCustomCover) {
    // Cache-busted on the order's own updatedAt: replacing a cover writes a new
    // file, and the browser would otherwise keep showing the old one.
    elements.orderDetailCover.src = `/api/artwork/cover/order/${order.id}?v=${encodeURIComponent(order.updatedAt || "")}`;
    elements.orderDetailCover.alt = `${order.name} cover`;
    elements.orderDetailCover.classList.add("custom-cover");
    elements.orderDetailCover.hidden = false;
    elements.orderCoverFallback.hidden = true;
  } else if (order.coverComicId && comicById(order.coverComicId)?.available !== false) {
    elements.orderDetailCover.src = thumbnailUrl(order.coverComicId);
    elements.orderDetailCover.alt = `${order.name} cover`;
    elements.orderDetailCover.hidden = false;
    elements.orderCoverFallback.hidden = true;
  }

  const rows = order.comicIds
    .slice(0, 500)
    .map((id, index) => detailItem(id, order, index));
  elements.orderDetailItems.replaceChildren(...rows);
  const notices = [];
  if (order.unplacedComicIds.length > 0) {
    notices.push(
      `${order.unplacedComicIds.length} newly scanned ${
        order.unplacedComicIds.length === 1 ? "comic is" : "comics are"
      } waiting in Unplaced. Edit this order to position them.`
    );
  }
  if (order.missingComicIds.length > 0) {
    notices.push(
      `${order.missingComicIds.length} ${
        order.missingComicIds.length === 1 ? "item is" : "items are"
      } currently missing.`
    );
  }
  elements.orderDetailNotice.hidden = notices.length === 0;
  elements.orderDetailNotice.textContent = notices.join(" ");

  elements.repairOrderButton.hidden = true;
  if (order.kind === "manual") loadOrderRepairState(order.id);

  const first = firstReadableComic(order);
  elements.startOrderButton.disabled = !first;
  elements.startOrderButton.textContent =
    first && readingStatus(first) === "in-progress"
      ? "Continue reading"
      : "Start reading";
  if (!elements.orderDetailDialog.open) {
    elements.orderDetailDialog.showModal();
  }
}

function editorComicRow(comicIdValue, index) {
  const comic = comicById(comicIdValue);
  const row = document.createElement("div");
  row.className = `editor-comic-row${comic ? "" : " missing"}`;
  row.draggable = Boolean(comic);
  row.dataset.index = String(index);
  const drag = document.createElement("span");
  drag.className = "drag-handle";
  drag.textContent = "⋮⋮";
  drag.title = "Drag to reorder";
  const select = document.createElement("input");
  select.type = "checkbox";
  select.checked = state.editorSelection.has(comicIdValue);
  select.setAttribute(
    "aria-label",
    `Select ${comic ? comic.title : "missing comic"}`
  );
  select.addEventListener("change", () => {
    if (select.checked) state.editorSelection.add(comicIdValue);
    else state.editorSelection.delete(comicIdValue);
  });
  const position = document.createElement("span");
  position.className = "editor-position";
  position.textContent = String(index + 1);
  const copy = document.createElement("span");
  copy.className = "editor-comic-copy";
  const title = document.createElement("strong");
  title.textContent = comic ? comic.title : "Missing comic";
  const meta = document.createElement("small");
  meta.textContent = comic ? comic.relativePath : comicIdValue;
  copy.append(title, meta);
  row.append(drag, select, position, copy);
  row.addEventListener("dragstart", () => {
    state.draggedOrderIndex = index;
    row.classList.add("dragging");
  });
  row.addEventListener("dragend", () => {
    state.draggedOrderIndex = null;
    row.classList.remove("dragging");
  });
  row.addEventListener("dragover", (event) => event.preventDefault());
  row.addEventListener("drop", (event) => {
    event.preventDefault();
    const from = state.draggedOrderIndex;
    if (
      from === null ||
      from === index ||
      !state.editingOrder?.comicIds[from]
    ) {
      return;
    }
    const [moved] = state.editingOrder.comicIds.splice(from, 1);
    const destination = Math.min(index, state.editingOrder.comicIds.length);
    state.editingOrder.comicIds.splice(destination, 0, moved);
    renderOrderEditorItems();
  });
  return row;
}

function unplacedComicRow(comicIdValue) {
  const comic = comicById(comicIdValue);
  if (!comic) return null;
  const row = document.createElement("div");
  row.className = "editor-comic-row";
  const marker = document.createElement("span");
  marker.className = "unplaced-marker";
  marker.textContent = "+";
  const copy = document.createElement("span");
  copy.className = "editor-comic-copy";
  const title = document.createElement("strong");
  title.textContent = comic.title;
  const meta = document.createElement("small");
  meta.textContent = comic.relativePath;
  copy.append(title, meta);
  const place = document.createElement("button");
  place.type = "button";
  place.className = "small-action";
  place.textContent = "Place at end";
  place.addEventListener("click", () => {
    state.editingOrder.comicIds.push(comicIdValue);
    state.editingOrder.unplacedComicIds =
      state.editingOrder.unplacedComicIds.filter((id) => id !== comicIdValue);
    renderOrderEditorItems();
  });
  row.append(marker, copy, place);
  return row;
}

function renderOrderEditorItems() {
  if (!state.editingOrder) return;
  const ids = state.editingOrder.comicIds;
  if (ids.length === 0) {
    const empty = document.createElement("div");
    empty.className = "source-empty";
    empty.textContent = "Add comics to begin this reading order.";
    elements.orderEditorItems.replaceChildren(empty);
  } else {
    elements.orderEditorItems.replaceChildren(
      ...ids.map(editorComicRow)
    );
  }
  const unplacedRows = state.editingOrder.unplacedComicIds
    .map(unplacedComicRow)
    .filter(Boolean);
  elements.unplacedSection.hidden = unplacedRows.length === 0;
  elements.unplacedItems.replaceChildren(...unplacedRows);
}

function openOrderEditor(order = null) {
  const source = order || {
    id: null,
    name: "New reading order",
    description: "",
    comicIds: [],
    unplacedComicIds: []
  };
  state.editingOrder = {
    id: source.id,
    name: source.name,
    description: source.description || "",
    comicIds: [...source.comicIds],
    unplacedComicIds: [...source.unplacedComicIds]
  };
  state.editorSelection = new Set();
  elements.orderEditorTitle.textContent = source.id
    ? "Edit reading order"
    : "New reading order";
  elements.orderName.value = source.name;
  elements.orderDescription.value = source.description || "";
  clearFormError(elements.orderEditorError);
  renderOrderEditorItems();
  if (!elements.orderEditorDialog.open) {
    elements.orderEditorDialog.showModal();
  }
}

function moveEditorSelection(direction) {
  if (!state.editingOrder || state.editorSelection.size === 0) return;
  const ids = state.editingOrder.comicIds;
  if (direction < 0) {
    for (let index = 1; index < ids.length; index += 1) {
      if (
        state.editorSelection.has(ids[index]) &&
        !state.editorSelection.has(ids[index - 1])
      ) {
        [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
      }
    }
  } else {
    for (let index = ids.length - 2; index >= 0; index -= 1) {
      if (
        state.editorSelection.has(ids[index]) &&
        !state.editorSelection.has(ids[index + 1])
      ) {
        [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
      }
    }
  }
  renderOrderEditorItems();
}

function renderComicPicker() {
  const query = elements.comicPickerSearch.value.trim().toLocaleLowerCase();
  const existing = new Set(state.editingOrder?.comicIds || []);
  const available = state.comics.filter(
    (comic) =>
      !existing.has(comic.id) &&
      (!query ||
        `${comic.title} ${comic.series} ${comic.relativePath}`
          .toLocaleLowerCase()
          .includes(query))
  );
  const rows = available.slice(0, 500).map((comic) => {
    const label = document.createElement("label");
    label.className = "picker-comic-row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.pickerSelection.has(comic.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.pickerSelection.add(comic.id);
      else state.pickerSelection.delete(comic.id);
      elements.pickerSelectionCount.textContent =
        `${state.pickerSelection.size} selected`;
    });
    const copy = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = comic.title;
    const meta = document.createElement("small");
    meta.textContent = `${comic.series} · ${comic.relativePath}`;
    copy.append(title, meta);
    label.append(checkbox, copy);
    return label;
  });
  if (rows.length === 0) {
    const empty = document.createElement("div");
    empty.className = "source-empty";
    empty.textContent = "No matching comics are available to add.";
    rows.push(empty);
  }
  elements.comicPickerList.replaceChildren(...rows);
  elements.pickerSelectionCount.textContent =
    `${state.pickerSelection.size} selected`;
}

function openComicPicker() {
  if (!state.editingOrder) return;
  state.pickerSelection = new Set();
  elements.comicPickerSearch.value = "";
  renderComicPicker();
  if (!elements.comicPickerDialog.open) {
    elements.comicPickerDialog.showModal();
  }
}

async function saveOrder() {
  if (!state.editingOrder) return;
  clearFormError(elements.orderEditorError);
  const name = elements.orderName.value.trim();
  if (!name) {
    showFormError(
      elements.orderEditorError,
      new Error("Give this reading order a name.")
    );
    return;
  }
  elements.saveOrderButton.disabled = true;
  elements.saveOrderButton.textContent = "Saving…";
  try {
    const body = {
      name,
      description: elements.orderDescription.value,
      comicIds: state.editingOrder.comicIds,
      unplacedComicIds: state.editingOrder.unplacedComicIds
    };
    const saved = state.editingOrder.id
      ? await api(`/api/reading-orders/${state.editingOrder.id}`, {
          method: "PUT",
          body: JSON.stringify(body)
        })
      : await api("/api/reading-orders", {
          method: "POST",
          body: JSON.stringify(body)
        });
    elements.orderEditorDialog.close();
    await refresh();
    openOrderDetail(saved.id);
  } catch (error) {
    showFormError(elements.orderEditorError, error);
  } finally {
    elements.saveOrderButton.disabled = false;
    elements.saveOrderButton.textContent = "Save order";
  }
}

async function duplicateActiveOrder() {
  const order = orderById(state.activeOrderId);
  if (!order || order.kind !== "manual") return;
  try {
    const duplicate = await api(
      `/api/reading-orders/${order.id}/duplicate`,
      { method: "POST" }
    );
    await refresh();
    openOrderDetail(duplicate.id);
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteActiveOrder() {
  const order = orderById(state.activeOrderId);
  if (!order || order.kind !== "manual") return;
  if (!window.confirm(`Delete “${order.name}”? Your comic files will not be changed.`)) {
    return;
  }
  try {
    await api(`/api/reading-orders/${order.id}`, { method: "DELETE" });
    elements.orderDetailDialog.close();
    state.activeOrderId = null;
    await refresh();
    openOrders();
  } catch (error) {
    showToast(error.message);
  }
}

function renderScanIssues() {
  const count = state.scanIssues.length;
  elements.issuesButton.hidden = count === 0;
  elements.issueCount.textContent = String(count);
  elements.issuesButton.setAttribute(
    "aria-label",
    `Show ${count} scan ${count === 1 ? "issue" : "issues"}`
  );
  elements.retryScanAction.disabled = count === 0;
  elements.retryScanCount.hidden = count === 0;
  elements.retryScanCount.textContent = String(count);
}

function isPermissionIssue(issue) {
  return (
    issue &&
    (issue.code === "EACCES" ||
      /(?:EACCES|permission denied|does not have permission)/i.test(issue.message || ""))
  );
}

function sharedFolderForPath(candidate) {
  const match = /^\/volume(?:USB)?\d+\/([^/]+)/.exec(candidate || "");
  return match ? match[1] : "containing shared folder";
}

function dsmPermissionsUrl() {
  const url = new URL(window.location.href);
  url.protocol = "https:";
  url.port = "5001";
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  url.searchParams.set("launchApp", "SYNO.SDS.AdminCenter.Application");
  url.searchParams.set(
    "launchParam",
    JSON.stringify({ fn: "SYNO.SDS.AdminCenter.FileService.Main" })
  );
  return url.toString();
}

function openPermissionHelp(issue) {
  state.permissionIssue = issue;
  const share = sharedFolderForPath(issue.path);
  elements.permissionShare.textContent = share;
  elements.permissionShareStep.textContent = share;
  elements.permissionPath.textContent = issue.path || "Unknown path";
  if (elements.issuesDialog.open) elements.issuesDialog.close();
  elements.permissionDialog.showModal();
}

async function copyAccountName() {
  const account = elements.permissionAccount.textContent;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(account);
    } else {
      const temporary = document.createElement("textarea");
      temporary.value = account;
      temporary.setAttribute("readonly", "");
      temporary.style.position = "fixed";
      temporary.style.opacity = "0";
      document.body.append(temporary);
      temporary.select();
      const copied = document.execCommand("copy");
      temporary.remove();
      if (!copied) throw new Error("Copy was not available.");
    }
    showToast("Copied PanelShelf account name.");
  } catch {
    showToast("Copy failed. The account name is PanelShelf.");
  }
}

function openIssues() {
  const count = state.scanIssues.length;
  if (count === 0) {
    showToast("The latest scan has no reported issues.");
    return;
  }
  const warningCount = state.scanIssues.filter(
    (issue) => issue.severity === "warning"
  ).length;
  const errorCount = count - warningCount;
  elements.issuesSummary.textContent = [
    errorCount
      ? `${errorCount} ${errorCount === 1 ? "error" : "errors"}`
      : "",
    warningCount
      ? `${warningCount} ${warningCount === 1 ? "warning" : "warnings"}`
      : ""
  ]
    .filter(Boolean)
    .join(" and ")
    .concat(" reported during the latest scan.");
  elements.issueList.replaceChildren(
    ...state.scanIssues.map((issue) => {
      const row = document.createElement("article");
      row.className = `issue-row${
        issue.severity === "warning" ? " warning" : ""
      }`;
      const icon = document.createElement("span");
      icon.className = "issue-icon";
      icon.textContent = issue.severity === "warning" ? "i" : "!";
      icon.setAttribute("aria-hidden", "true");
      const copy = document.createElement("div");
      copy.className = "issue-copy";
      const path = document.createElement("code");
      path.textContent = issue.path || "Unknown path";
      const message = document.createElement("p");
      message.textContent = issue.message || "The item could not be scanned.";
      copy.append(path, message);
      if (isPermissionIssue(issue)) {
        const actions = document.createElement("div");
        actions.className = "issue-actions";
        const fix = document.createElement("button");
        fix.type = "button";
        fix.className = "button issue-fix-button";
        fix.textContent = "Fix access";
        fix.addEventListener("click", () => openPermissionHelp(issue));
        actions.append(fix);
        copy.append(actions);
      }
      row.append(icon, copy);
      return row;
    })
  );
  elements.issuesDialog.showModal();
}

async function refresh() {
  const [config, comics, scanState, orders, metadataSettings, bulkMetadata] = await Promise.all([
    api("/api/config"),
    api("/api/comics"),
    api("/api/scan"),
    api("/api/reading-orders"),
    api("/api/metadata/settings"),
    api("/api/metadata/bulk")
  ]);
  state.libraries = config.sources || config.libraryPaths || [];
  setLibraryComics(comics);
  state.automaticOrders = orders.automatic || [];
  state.manualOrders = orders.manual || [];
  state.scanState = scanState;
  state.metadataSettings = metadataSettings;
  state.bulkMetadata = bulkMetadata;
  await loadProgressFromServer();
  await loadSkipsFromServer();
  state.scanIssues = [
    ...(scanState.errors || []),
    ...(scanState.warnings || [])
  ];
  renderScanIssues();
  renderScanSourceActions();
  renderMetadataSettingsStatus();
  renderBulkMetadataState();
  if (bulkMetadata.status === "running") pollBulkMetadata();
  renderContinueReading();
  renderComics();
  renderOrders();
}

function profileLabel(profile) {
  return PROFILE_LABELS[profile] || "Structure not set";
}

function renderSources() {
  if (state.editingLibraries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "source-empty";
    empty.textContent = "No folders selected yet.";
    elements.sourceList.replaceChildren(empty);
    return;
  }
  elements.sourceList.replaceChildren(
    ...state.editingLibraries.map((source, index) => {
      const row = document.createElement("div");
      row.className = "source-row";
      const indicator = document.createElement("span");
      indicator.className = `source-indicator${
        source.available === false
          ? " unavailable"
          : source.needsProfileConfirmation || source.profile === "detect"
            ? " pending"
            : ""
      }`;
      const copy = document.createElement("div");
      copy.className = "source-copy";
      const code = document.createElement("code");
      code.textContent = source.path;
      code.title = source.path;
      const status = document.createElement("small");
      const availability =
        source.available === false ? source.message || "Unavailable" : "Readable";
      const structure =
        source.needsProfileConfirmation || source.profile === "detect"
          ? "structure review required"
          : profileLabel(source.profile);
      status.textContent = `${availability} · ${structure}`;
      copy.append(code, status);

      const actions = document.createElement("div");
      actions.className = "source-actions";
      const review = document.createElement("button");
      review.type = "button";
      review.className = "source-review";
      review.textContent =
        source.needsProfileConfirmation || source.profile === "detect"
          ? "Review"
          : "Preview";
      review.addEventListener("click", () => openStructurePreview(index));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove-source";
      remove.setAttribute("aria-label", `Remove ${source.path}`);
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        state.editingLibraries.splice(index, 1);
        renderSources();
      });
      actions.append(review, remove);
      row.append(indicator, copy, actions);
      return row;
    })
  );
}

function stopCoverCachePolling() {
  clearTimeout(state.coverCachePollTimer);
  state.coverCachePollTimer = null;
}

// Saving writes the editing list as the *complete* set of sources, so a dialog
// that opens without the server's sources in it deletes every one of them the
// moment Save is pressed. It used to read `state.libraries`, which is filled
// once at boot by a refresh that can fail — and when that refresh failed
// against a restarting server, the dialog opened empty over a configured
// library and the next Save emptied it. Twenty-four thousand comics, in one
// click, with no warning and nothing on screen that looked wrong.
//
// So the editor loads what it is editing, every time it opens.
async function loadSourcesForEditing() {
  const config = await api("/api/config");
  state.libraries = config.sources || config.libraryPaths || [];
  // A copy: cancelling has to leave the loaded set alone.
  state.editingLibraries = state.libraries.map((source) => ({ ...source }));
}

async function openSettingsSources() {
  try {
    await loadSourcesForEditing();
  } catch (error) {
    // Not opening is the safe failure. An open dialog offers a Save button, and
    // a Save from an editor that never loaded is indistinguishable, on the
    // wire, from "remove every source I have".
    showFormError(elements.settingsError, error);
    return;
  }
  renderSources();
  elements.settingsDialog.showModal();
}

function openSettings() {
  clearFormError(elements.settingsError);
  elements.devicePairingCode.hidden = true;
  openSettingsSources().then(() => {
    // After `showModal`, not before. Both of these bail when the dialog is shut,
    // which is what stops them polling a panel nobody is looking at — and which
    // silently made them no-ops when they ran a line too early.
    if (!elements.settingsDialog.open) return;
    pollCoverCache();
    loadDevicePairing();
    // Fills the callout's counts, so what needs looking at is visible without
    // opening anything.
    loadLibraryReview();
  });
}

function browserBackupState() {
  return {
    // Progress is not sent: the server exports it from its own store.
    libraryView: state.libraryView,
    chronologyPreferences: {
      skippedNodeIds: [...state.skippedChronologyNodeIds],
      hideSkipped: state.hideSkippedChronology,
      layout: state.chronologyLayout
    },
    reader: {
      fit: state.reader.fit,
      mode: state.reader.mode
    }
  };
}

function applyRestoredBrowserState(browser) {
  const restored = browser && typeof browser === "object" ? browser : {};
  // The restore response carries the backup's progress, which the server has
  // already written into its own store, so this stays in step with it.
  state.progress = restored.progress || {};
  state.libraryView = LIBRARY_VIEWS.has(restored.libraryView)
    ? restored.libraryView
    : "all";
  const chronology = restored.chronologyPreferences || {};
  state.skippedChronologyNodeIds = new Set(chronology.skippedNodeIds || []);
  state.hideSkippedChronology = Boolean(chronology.hideSkipped);
  state.chronologyLayout = chronology.layout === "timeline" ? "timeline" : "grid";
  state.reader.fit = restored.reader?.fit || "width";
  state.reader.mode = restored.reader?.mode || "single";
  localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(state.progress));
  localStorage.setItem(LIBRARY_VIEW_STORAGE_KEY, state.libraryView);
  localStorage.setItem(
    CHRONOLOGY_PREFERENCES_STORAGE_KEY,
    JSON.stringify({
      skippedNodeIds: [...state.skippedChronologyNodeIds],
      hideSkipped: state.hideSkippedChronology,
      layout: state.chronologyLayout
    })
  );
  localStorage.setItem(
    READER_STORAGE_KEY,
    JSON.stringify({ fit: state.reader.fit, mode: state.reader.mode })
  );
}

async function exportBackup() {
  clearFormError(elements.settingsError);
  elements.exportBackupButton.disabled = true;
  elements.exportBackupButton.textContent = "Exporting…";
  try {
    const backup = await api("/api/backup/export", {
      method: "POST",
      body: JSON.stringify({ browser: browserBackupState() })
    });
    const blob = new Blob([`${JSON.stringify(backup, null, 2)}\n`], {
      type: "application/json"
    });
    const link = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    link.href = URL.createObjectURL(blob);
    link.download = `PanelShelf-backup-${date}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
    showToast("PanelShelf backup downloaded.");
  } catch (error) {
    showFormError(elements.settingsError, error);
  } finally {
    elements.exportBackupButton.disabled = false;
    elements.exportBackupButton.textContent = "Export backup";
  }
}

async function restoreBackupFile(file) {
  clearFormError(elements.settingsError);
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) {
    showFormError(elements.settingsError, new Error("Backup files must be 20 MB or smaller."));
    return;
  }
  elements.importBackupButton.disabled = true;
  elements.importBackupButton.textContent = "Checking…";
  try {
    let backup;
    try {
      backup = JSON.parse(await file.text());
    } catch {
      throw new Error("Choose a valid PanelShelf backup JSON file.");
    }
    const preview = await api("/api/backup/preview", {
      method: "POST",
      body: JSON.stringify(backup)
    });
    const warning = preview.unavailableSources
      ? `\n\n${preview.unavailableSources} source folder(s) are currently unavailable but will still be restored.`
      : "";
    const confirmed = window.confirm(
      `Restore this PanelShelf backup?\n\n` +
        `${preview.sourceCount} sources\n` +
        `${preview.readingOrders} manual reading orders\n` +
        `${preview.metadataMatches} metadata matches\n` +
        `${preview.metadataOverrides || 0} manual metadata edits\n` +
        `${preview.progressRecords} reading progress records\n` +
        `${preview.skippedFolders} skipped chronology folders` +
        `${warning}\n\nCurrent PanelShelf settings and saved progress will be replaced.`
    );
    if (!confirmed) return;
    elements.importBackupButton.textContent = "Restoring…";
    const result = await api("/api/backup/restore", {
      method: "POST",
      body: JSON.stringify(backup)
    });
    applyRestoredBrowserState(result.browser);
    state.editingLibraries = [];
    elements.settingsDialog.close();
    await refresh();
    showToast("Backup restored. Scanning restored sources…");
    await runScan({ action: "quick" });
  } catch (error) {
    showFormError(elements.settingsError, error);
  } finally {
    elements.backupFileInput.value = "";
    elements.importBackupButton.disabled = false;
    elements.importBackupButton.textContent = "Restore backup";
  }
}

function addEditingPath(candidate) {
  const sourcePath = candidate.trim();
  if (!sourcePath) return null;
  const existingIndex = state.editingLibraries.findIndex(
    (source) => source.path === sourcePath
  );
  if (existingIndex >= 0) {
    showToast("That source is already in the library.");
    return existingIndex;
  }
  const index = state.editingLibraries.push({
    name: sourcePath.split("/").filter(Boolean).at(-1) || sourcePath,
    path: sourcePath,
    profile: "detect",
    stagingPolicy: "show-unfiled",
    hideOrderPrefixes: true,
    needsProfileConfirmation: true,
    available: true,
    message: "Pending validation"
  }) - 1;
  renderSources();
  return index;
}

function renderStructureIssues(issues) {
  const displayed = issues.slice(0, 30);
  const rows = displayed.map((item) => {
    const row = document.createElement("div");
    row.className = `structure-issue ${item.severity || "info"}`;
    const severity = document.createElement("span");
    severity.textContent =
      item.severity === "error" ? "!" : item.severity === "warning" ? "!" : "i";
    severity.setAttribute("aria-hidden", "true");
    const copy = document.createElement("div");
    const message = document.createElement("strong");
    message.textContent = item.message;
    copy.append(message);
    if (item.path) {
      const issuePath = document.createElement("code");
      issuePath.textContent = item.path;
      copy.append(issuePath);
    }
    row.append(severity, copy);
    return row;
  });
  if (issues.length > displayed.length) {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = `${issues.length - displayed.length} more validation messages are not shown.`;
    rows.push(note);
  }
  elements.structureIssues.replaceChildren(...rows);
  elements.structureIssueSection.hidden = issues.length === 0;
}

function renderStructureTree(preview) {
  const rows = [];
  const limit = 240;
  let total = 0;

  function addRow(label, role, depth, details = "") {
    total += 1;
    if (rows.length >= limit) return;
    const row = document.createElement("div");
    row.className = `tree-row role-${role}`;
    row.style.paddingLeft = `${10 + Math.min(depth, 8) * 18}px`;
    const marker = document.createElement("span");
    marker.className = "tree-marker";
    marker.textContent = role === "comic" ? "▤" : role === "ignored" ? "×" : "▸";
    marker.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "tree-name";
    name.textContent = label;
    name.title = label;
    const badge = document.createElement("span");
    badge.className = "role-badge";
    badge.textContent = role === "comic" ? "Comic" : ROLE_LABELS[role] || role;
    row.append(marker, name);
    if (details) {
      const detail = document.createElement("span");
      detail.className = "tree-detail";
      detail.textContent = details;
      row.append(detail);
    }
    row.append(badge);
    rows.push(row);
  }

  function addComic(name, depth) {
    addRow(name, "comic", depth);
  }

  function visit(node, depth) {
    const details = [
      node.rank ? `position ${node.rank}` : "",
      node.totalComicCount
        ? `${node.totalComicCount} ${node.totalComicCount === 1 ? "comic" : "comics"}`
        : ""
    ].filter(Boolean).join(" · ");
    addRow(node.displayName || node.name, node.role || "group", depth, details);
    for (const comic of node.directComics || []) addComic(comic, depth + 1);
    for (const child of node.children || []) visit(child, depth + 1);
  }

  for (const comic of preview.rootComics || []) addComic(comic, 0);
  for (const node of preview.tree || []) visit(node, 0);

  if (total === 0) {
    const empty = document.createElement("div");
    empty.className = "source-empty";
    empty.textContent = "No comic archives or folders were found.";
    elements.structureTree.replaceChildren(empty);
  } else {
    elements.structureTree.replaceChildren(...rows);
  }
  elements.treeLimitNote.hidden = total <= limit;
  elements.treeLimitNote.textContent =
    total > limit ? `Showing first ${limit} of ${total} items` : "";
}

function renderStructurePreview(preview) {
  const selectedProfile = elements.structureProfile.value;
  elements.structureResult.hidden = false;
  elements.detectedProfile.textContent = profileLabel(preview.profile);
  elements.detectionReason.textContent =
    selectedProfile === "detect"
      ? preview.detection.reason
      : preview.profile === preview.detection.profile
        ? preview.detection.reason
        : `You selected this convention. Automatic detection suggested ${profileLabel(preview.detection.profile).toLocaleLowerCase()}.`;
  elements.detectionConfidence.textContent =
    selectedProfile === "detect"
      ? `${preview.detection.confidence} confidence`
      : "Selected";
  elements.detectionConfidence.className =
    `confidence-badge ${selectedProfile === "detect" ? preview.detection.confidence : "selected"}`;

  elements.publisherResult.hidden = !preview.publisher;
  elements.detectedPublisher.textContent = preview.publisher
    ? `${preview.publisher.name}${preview.publisher.kind === "imprint" && preview.publisher.parent ? ` · ${preview.publisher.parent}` : ""}`
    : "";

  elements.previewComicCount.textContent = String(preview.summary.comics);
  elements.previewFolderCount.textContent = String(preview.summary.folders);
  elements.previewOrderedCount.textContent = String(
    preview.summary.orderedSections
  );
  elements.previewStagingCount.textContent = String(
    preview.summary.stagingFolders
  );
  renderStructureIssues(preview.issues || []);
  renderStructureTree(preview);

  const blockingErrors = (preview.issues || []).filter(
    (item) => item.severity === "error"
  );
  elements.useStructureButton.disabled = blockingErrors.length > 0;
  elements.useStructureButton.textContent =
    blockingErrors.length > 0
      ? "Fix validation errors"
      : `Use ${profileLabel(preview.profile)}`;
}

async function analyzeStructure() {
  const index = state.editingSourceIndex;
  const source = state.editingLibraries[index];
  if (!source) return;
  const requestId = ++state.structureRequest;
  const requestedProfile = elements.structureProfile.value;
  clearFormError(elements.structureError);
  state.structurePreview = null;
  elements.structureResult.hidden = true;
  elements.structureLoading.hidden = false;
  elements.analyzeStructureButton.disabled = true;
  elements.useStructureButton.disabled = true;
  elements.useStructureButton.textContent = "Use this structure";
  try {
    const preview = await api("/api/sources/preview", {
      method: "POST",
      body: JSON.stringify({
        path: source.path,
        profile: requestedProfile
      })
    });
    if (
      requestId !== state.structureRequest ||
      index !== state.editingSourceIndex ||
      requestedProfile !== elements.structureProfile.value
    ) {
      return;
    }
    state.structurePreview = preview;
    renderStructurePreview(preview);
  } catch (error) {
    if (requestId === state.structureRequest) {
      showFormError(elements.structureError, error);
    }
  } finally {
    if (requestId === state.structureRequest) {
      elements.structureLoading.hidden = true;
      elements.analyzeStructureButton.disabled = false;
    }
  }
}

async function openStructurePreview(index) {
  const source = state.editingLibraries[index];
  if (!source) return;
  state.editingSourceIndex = index;
  state.structurePreview = null;
  elements.structurePath.textContent = source.path;
  elements.structurePath.title = source.path;
  elements.structureProfile.value =
    source.needsProfileConfirmation || source.profile === "detect"
      ? "detect"
      : source.profile || "detect";
  elements.stagingPolicy.value = source.stagingPolicy || "show-unfiled";
  elements.hideOrderPrefixes.checked = source.hideOrderPrefixes !== false;
  elements.profileHelp.textContent = PROFILE_HELP[elements.structureProfile.value];
  clearFormError(elements.structureError);
  elements.structureResult.hidden = true;
  if (!elements.structureDialog.open) elements.structureDialog.showModal();
  await analyzeStructure();
}

function useStructure() {
  const preview = state.structurePreview;
  const index = state.editingSourceIndex;
  const source = state.editingLibraries[index];
  if (!preview || !source) return;
  if ((preview.issues || []).some((item) => item.severity === "error")) return;
  state.editingLibraries[index] = {
    ...source,
    profile: preview.profile,
    stagingPolicy: elements.stagingPolicy.value,
    hideOrderPrefixes: elements.hideOrderPrefixes.checked,
    needsProfileConfirmation: false
  };
  state.structurePreview = null;
  state.editingSourceIndex = null;
  elements.structureDialog.close();
  clearFormError(elements.settingsError);
  renderSources();
}

function serializableSource(source) {
  return {
    ...(source.id ? { id: source.id } : {}),
    name: source.name,
    path: source.path,
    profile: source.profile,
    stagingPolicy: source.stagingPolicy || "show-unfiled",
    hideOrderPrefixes: source.hideOrderPrefixes !== false,
    needsProfileConfirmation: Boolean(source.needsProfileConfirmation)
  };
}

async function saveSettings() {
  clearFormError(elements.settingsError);
  const unresolvedIndex = state.editingLibraries.findIndex(
    (source) =>
      source.needsProfileConfirmation ||
      !source.profile ||
      source.profile === "detect"
  );
  if (unresolvedIndex >= 0) {
    showFormError(
      elements.settingsError,
      new Error("Review and confirm the organization profile for every source.")
    );
    await openStructurePreview(unresolvedIndex);
    return;
  }
  elements.saveSettingsButton.disabled = true;
  elements.saveSettingsButton.textContent = "Saving…";
  try {
    const config = await api("/api/config", {
      method: "PUT",
      body: JSON.stringify({
        schemaVersion: 2,
        sources: state.editingLibraries.map(serializableSource)
      })
    });
    state.libraries = config.sources || [];
    elements.settingsDialog.close();
    await runScan();
  } catch (error) {
    showFormError(elements.settingsError, error);
  } finally {
    elements.saveSettingsButton.disabled = false;
    elements.saveSettingsButton.textContent = "Save and scan";
  }
}

async function loadFolders(candidate) {
  clearFormError(elements.folderError);
  elements.folderList.replaceChildren();
  elements.folderPath.textContent = candidate;
  try {
    const result = await api(`/api/folders?path=${encodeURIComponent(candidate)}`);
    state.browserPath = result.path;
    state.browserParent = result.parent;
    elements.folderPath.textContent = result.path;
    elements.folderUpButton.disabled = result.parent === null;
    const rows = result.entries.map((entry) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "folder-row";
      row.disabled = !entry.readable;
      const icon = document.createElement("span");
      icon.className = "folder-icon";
      const label = document.createElement("span");
      label.textContent = entry.name;
      row.append(icon, label);
      row.addEventListener("click", () => loadFolders(entry.path));
      return row;
    });
    if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "source-empty";
      empty.textContent =
        result.path === "/" ? "No readable volumes were detected." : "No subfolders here.";
      elements.folderList.replaceChildren(empty);
    } else {
      elements.folderList.replaceChildren(...rows);
    }
  } catch (error) {
    showFormError(elements.folderError, error);
  }
}

async function openFolderBrowser() {
  elements.folderDialog.showModal();
  await loadFolders("/");
}

function closeScanMenu() {
  elements.scanMenu.hidden = true;
  elements.scanMenuButton.setAttribute("aria-expanded", "false");
}

function openScanMenu() {
  renderScanSourceActions();
  elements.scanMenu.hidden = false;
  elements.scanMenuButton.setAttribute("aria-expanded", "true");
}

function renderScanSourceActions() {
  if (!elements.scanSourceActions) return;
  if (state.libraries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "scan-source-empty";
    empty.textContent = "No sources configured";
    elements.scanSourceActions.replaceChildren(empty);
    return;
  }
  elements.scanSourceActions.replaceChildren(
    ...state.libraries.map((source) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "scan-action";
      button.setAttribute("role", "menuitem");
      const copy = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = source.name || source.path;
      const detail = document.createElement("small");
      detail.textContent =
        source.available === false
          ? "Source is currently unavailable"
          : source.path;
      copy.append(name, detail);
      const availability = document.createElement("b");
      availability.className = `scan-source-availability${
        source.available === false ? " offline" : ""
      }`;
      availability.setAttribute("aria-hidden", "true");
      button.append(copy, availability);
      button.addEventListener("click", () =>
        runScan({ action: "source", sourceId: source.id })
      );
      return button;
    })
  );
}

function scanActionLabel(action, sourceId = null) {
  if (action === "full") return "Full rebuild";
  if (action === "retry") return "Retry issues";
  if (action === "source") {
    const source = state.libraries.find((item) => item.id === sourceId);
    return source ? `Scan ${source.name}` : "Scan source";
  }
  return "Quick scan";
}

async function runScan(options = {}) {
  if (state.libraries.length === 0) {
    renderComics();
    return;
  }
  const action = options.action || "quick";
  const sourceId = options.sourceId || null;
  if (action === "retry" && state.scanIssues.length === 0) {
    closeScanMenu();
    showToast("There are no scan issues to retry.");
    return;
  }
  if (
    action === "full" &&
    !window.confirm(
      "Full rebuild will reopen every comic archive and reread embedded metadata. It does not modify your comic files. Continue?"
    )
  ) {
    closeScanMenu();
    return;
  }
  const label = scanActionLabel(action, sourceId);
  const previousIssues = [...state.scanIssues];
  closeScanMenu();
  elements.scanButton.disabled = true;
  elements.scanMenuButton.disabled = true;
  elements.scanMenu
    .querySelectorAll("button")
    .forEach((button) => (button.disabled = true));
  elements.scanButton.querySelector("span").textContent = "Scanning";
  elements.scanStatus.hidden = false;
  elements.scanStatus.textContent = `${label}…`;
  state.scanIssues = [];
  renderScanIssues();
  try {
    await api("/api/scan", {
      method: "POST",
      body: JSON.stringify({ action, sourceId })
    });
    let result;
    do {
      await new Promise((resolve) => setTimeout(resolve, 650));
      result = await api("/api/scan");
      state.scanIssues = [
        ...(result.errors || []),
        ...(result.warnings || [])
      ];
      renderScanIssues();
      elements.scanStatus.textContent =
        `${label}… ${result.scannedFiles || 0} checked · ${
          result.foundComics || 0
        } indexed`;
    } while (result.running);
    const issueCount = state.scanIssues.length;
    showToast(
      `${label} finished: ${result.foundComics} comics · ${
        result.openedArchives || 0
      } opened · ${result.reusedFiles || 0} unchanged${
        issueCount
          ? ` · ${issueCount} issue${issueCount === 1 ? "" : "s"}`
          : ""
      }.`,
      issueCount ? { label: "View issues", handler: openIssues } : null
    );
    await refresh();
  } catch (error) {
    state.scanIssues = previousIssues;
    renderScanIssues();
    showToast(error.message);
  } finally {
    elements.scanButton.disabled = false;
    elements.scanMenuButton.disabled = false;
    elements.scanButton.querySelector("span").textContent = "Quick scan";
    elements.scanMenu
      .querySelectorAll("button")
      .forEach((button) => (button.disabled = false));
    renderScanIssues();
    elements.scanStatus.hidden = true;
  }
}

function readerOrderFor(comic, requestedOrderId = null) {
  const requested = requestedOrderId ? orderById(requestedOrderId) : null;
  if (requested?.comicIds.includes(comic.id)) return requested;
  return (
    state.automaticOrders.find((order) => order.comicIds.includes(comic.id)) ||
    null
  );
}

function nextComicInReaderOrder(direction = 1) {
  const order = orderById(state.reader.orderId);
  const current = state.reader.comic;
  if (!order || !current) return null;
  const start = order.comicIds.indexOf(current.id);
  if (start < 0) return null;
  for (
    let index = start + direction;
    index >= 0 && index < order.comicIds.length;
    index += direction
  ) {
    const comic = comicById(order.comicIds[index]);
    if (
      comic &&
      comic.available !== false &&
      readingStatus(comic) !== "skipped"
    ) {
      return comic;
    }
  }
  return null;
}

function readerImage(pageIndex, loading = "eager") {
  const image = document.createElement("img");
  image.src = `/api/comics/${state.reader.comic.id}/pages/${pageIndex}`;
  image.alt = `${state.reader.comic.title}, page ${pageIndex + 1}`;
  image.loading = loading;
  image.dataset.pageIndex = String(pageIndex);
  image.addEventListener(
    "load",
    () => {
      elements.readerLoading.hidden = true;
    },
    { once: true }
  );
  image.addEventListener(
    "error",
    () => {
      elements.readerLoading.hidden = true;
      showToast(`Page ${pageIndex + 1} could not be opened.`);
    },
    { once: true }
  );
  return image;
}

function applyReaderAppearance() {
  elements.readerStage.classList.toggle(
    "fit-height",
    state.reader.fit === "height" && state.reader.mode !== "continuous"
  );
  elements.readerStage.classList.toggle(
    "manga-mode",
    state.reader.mode === "manga"
  );
  elements.fitButton.textContent =
    state.reader.fit === "height" ? "Fit width" : "Fit height";
  elements.readerMode.value = state.reader.mode;
}

function updateReaderCounter(firstIndex, lastIndex = firstIndex) {
  const count = state.reader.pages.length;
  elements.readerCounter.textContent =
    firstIndex === lastIndex
      ? `Page ${firstIndex + 1} of ${count}`
      : `Pages ${firstIndex + 1}–${lastIndex + 1} of ${count}`;
}

function updateReaderZones() {
  const continuous = state.reader.mode === "continuous";
  elements.previousPage.hidden = continuous;
  elements.nextPage.hidden = continuous;
  if (continuous) return;
  const manga = state.reader.mode === "manga";
  const atStart = state.reader.index === 0;
  if (manga) {
    elements.previousPage.disabled = false;
    elements.previousPage.setAttribute("aria-label", "Next page");
    elements.nextPage.disabled = atStart;
    elements.nextPage.setAttribute("aria-label", "Previous page");
  } else {
    elements.previousPage.disabled = atStart;
    elements.previousPage.setAttribute("aria-label", "Previous page");
    elements.nextPage.disabled = false;
    elements.nextPage.setAttribute("aria-label", "Next page");
  }
}

function renderReaderEnd(options = {}) {
  const nextComic = nextComicInReaderOrder(1);
  const order = orderById(state.reader.orderId);
  elements.readerEnd.classList.toggle("inline-end", Boolean(options.inline));
  elements.readerEnd.hidden = false;
  elements.readerEndTitle.textContent = nextComic
    ? `Finished ${state.reader.comic.title}`
    : order
      ? `End of ${order.name}`
      : "End of this folder";
  elements.readerEndMessage.textContent = nextComic
    ? `Next in ${order?.name || "this reading order"}: ${nextComic.title}`
    : order?.profile === "hierarchical-timeline"
      ? "This branch ends here. PanelShelf will not jump into an unrelated timeline branch."
      : "There is no later readable comic in this reading order.";
  elements.readerNextComicButton.hidden = !nextComic;
  elements.readerNextComicButton.textContent = nextComic
    ? `Continue to ${nextComic.title}`
    : "Continue to next comic";
  if (options.complete !== false) {
    markComicCompleted(state.reader.comic, true);
  }
  if (!options.inline) {
    elements.readerPages.replaceChildren();
    elements.readerLoading.hidden = true;
  }
}

function renderPagedReader() {
  const { pages, mode } = state.reader;
  const step = mode === "single" ? 1 : 2;
  state.reader.index = Math.max(
    0,
    Math.min(state.reader.index, pages.length - 1)
  );
  const indices = [state.reader.index];
  if (step === 2 && state.reader.index + 1 < pages.length) {
    indices.push(state.reader.index + 1);
  }
  const images = indices.map((pageIndex) => readerImage(pageIndex));
  elements.readerPages.className = `reader-pages ${mode}`;
  elements.readerPages.replaceChildren(...images);
  elements.readerEnd.hidden = true;
  elements.readerEnd.classList.remove("inline-end");
  elements.readerLoading.hidden = false;
  elements.readerStage.scrollTo({ top: 0, left: 0 });
  updateReaderCounter(indices[0], indices.at(-1));
  updateReaderZones();
  setComicProgress(state.reader.comic, indices.at(-1), pages.length, {
    completed: false,
    orderId: state.reader.orderId
  });

  const preloadIndex = state.reader.index + step;
  if (preloadIndex < pages.length) {
    const preload = new Image();
    preload.src = `/api/comics/${state.reader.comic.id}/pages/${preloadIndex}`;
  }
}

function renderContinuousReader() {
  const { pages } = state.reader;
  state.reader.index = Math.max(
    0,
    Math.min(state.reader.index, pages.length - 1)
  );
  const images = pages.map((_, pageIndex) =>
    readerImage(pageIndex, pageIndex < 2 ? "eager" : "lazy")
  );
  elements.readerPages.className = "reader-pages continuous";
  elements.readerPages.replaceChildren(...images);
  elements.readerLoading.hidden = false;
  updateReaderZones();
  updateReaderCounter(state.reader.index);
  renderReaderEnd({ inline: true, complete: false });
  setComicProgress(state.reader.comic, state.reader.index, pages.length, {
    completed: false,
    orderId: state.reader.orderId
  });

  const target = images[state.reader.index];
  const scrollToTarget = () => target.scrollIntoView({ block: "start" });
  if (target.complete) requestAnimationFrame(scrollToTarget);
  else target.addEventListener("load", scrollToTarget, { once: true });
}

function renderReader() {
  if (!state.reader.comic || state.reader.pages.length === 0) {
    elements.readerLoading.hidden = true;
    showToast("No readable image pages were found.");
    return;
  }
  applyReaderAppearance();
  if (state.reader.mode === "continuous") renderContinuousReader();
  else renderPagedReader();
}

async function openReader(comic, requestedOrderId = null, startIndex = null) {
  const token = ++state.reader.renderToken;
  try {
    if (elements.orderDetailDialog.open) elements.orderDetailDialog.close();
    if (elements.ordersDialog.open) elements.ordersDialog.close();
    elements.readerLoading.hidden = false;
    elements.readerPages.replaceChildren();
    elements.readerEnd.hidden = true;
    if (!elements.readerDialog.open) elements.readerDialog.showModal();

    const order = readerOrderFor(comic, requestedOrderId);
    const result = await api(`/api/comics/${comic.id}/pages`);
    if (token !== state.reader.renderToken) return;
    state.reader.comic = result.comic;
    state.reader.pages = result.pages;
    state.reader.orderId = order?.id || null;
    const saved = progressFor(comic.id);
    state.reader.index = Number.isInteger(startIndex)
      ? startIndex
      : saved && !saved.completed
        ? Number(saved.pageIndex) || 0
        : 0;
    elements.readerTitle.textContent = result.comic.title;
    elements.readerOrder.textContent = `${comicMetadataLine(result.comic, {
      reader: true
    })} · ${
      order
        ? `Reading order: ${order.name}`
        : "Folder-local reading context"
    }`;
    renderReader();
  } catch (error) {
    if (token === state.reader.renderToken && elements.readerDialog.open) {
      elements.readerDialog.close();
    }
    showToast(error.message);
  }
}

function movePage(direction) {
  if (!state.reader.comic || state.reader.pages.length === 0) return;
  if (state.reader.mode === "continuous") {
    elements.readerStage.scrollBy({
      top: direction * Math.max(320, elements.readerStage.clientHeight * 0.85),
      behavior: "smooth"
    });
    return;
  }
  const step = state.reader.mode === "single" ? 1 : 2;
  const next = state.reader.index + direction * step;
  if (next < 0) return;
  if (next >= state.reader.pages.length) {
    renderReaderEnd();
    return;
  }
  state.reader.index = next;
  renderPagedReader();
}

function moveFromReaderZone(zone) {
  const manga = state.reader.mode === "manga";
  if (zone === "left") movePage(manga ? 1 : -1);
  else movePage(manga ? -1 : 1);
}

function toggleFit() {
  state.reader.fit = state.reader.fit === "width" ? "height" : "width";
  persistReaderPreferences();
  applyReaderAppearance();
}

function updateContinuousProgress() {
  if (
    !elements.readerDialog.open ||
    state.reader.mode !== "continuous" ||
    !state.reader.comic
  ) {
    return;
  }
  const images = [...elements.readerPages.querySelectorAll("img")];
  if (images.length === 0) return;
  const stageRect = elements.readerStage.getBoundingClientRect();
  const focusLine = stageRect.top + stageRect.height * 0.45;
  let visibleIndex = 0;
  for (const image of images) {
    if (image.getBoundingClientRect().top <= focusLine) {
      visibleIndex = Number(image.dataset.pageIndex);
    } else {
      break;
    }
  }
  if (visibleIndex !== state.reader.index) {
    state.reader.index = visibleIndex;
    updateReaderCounter(visibleIndex);
    setComicProgress(
      state.reader.comic,
      visibleIndex,
      state.reader.pages.length,
      {
        completed: Boolean(progressFor(state.reader.comic.id)?.completed),
        orderId: state.reader.orderId
      }
    );
  }
  const lastImage = images.at(-1);
  if (
    lastImage &&
    lastImage.getBoundingClientRect().bottom <=
      stageRect.bottom + Math.max(80, stageRect.height * 0.15)
  ) {
    markComicCompleted(state.reader.comic, true);
  }
}

elements.searchInput.addEventListener("input", renderComics);
elements.unfiledShelfButton.addEventListener("click", () => {
  const scope = elements.unfiledShelfButton.dataset.scope || "all";
  state.chronologyUnfiledScope = scope;
  renderComics();
});
elements.skippedFilterButton.addEventListener("click", () => {
  state.hideSkippedChronology = !state.hideSkippedChronology;
  persistChronologyPreferences();
  renderComics();
});
elements.chronologyLayoutToggle
  .querySelectorAll("[data-chronology-layout]")
  .forEach((button) => {
    button.addEventListener("click", () => {
      const layout = button.dataset.chronologyLayout;
      if (!["grid", "timeline"].includes(layout)) return;
      state.chronologyLayout = layout;
      state.chronologyTimelineFocusId = null;
      persistChronologyPreferences();
      renderComics();
    });
  });
document.querySelectorAll(".view-chip").forEach((button) => {
  button.addEventListener("click", () => {
    const nextView = button.dataset.view || "all";
    if (!LIBRARY_VIEWS.has(nextView)) return;
    if (state.libraryView !== nextView) {
      state.selectedPublisherKey = null;
      state.chronologyNodeId = null;
      state.chronologyUnfiledScope = null;
    }
    state.libraryView = nextView;
    persistLibraryView();
    renderComics();
  });
});
document.querySelectorAll(".filter-chip").forEach((button) => {
  button.addEventListener("click", () => {
    state.statusFilter = button.dataset.status || "all";
    document.querySelectorAll(".filter-chip").forEach((candidate) => {
      candidate.classList.toggle(
        "active",
        candidate.dataset.status === state.statusFilter
      );
    });
    renderComics();
  });
});
elements.ordersButton.addEventListener("click", openOrders);
elements.scanButton.addEventListener("click", () =>
  runScan({ action: "quick" })
);
elements.scanMenuButton.addEventListener("click", (event) => {
  event.stopPropagation();
  if (elements.scanMenu.hidden) openScanMenu();
  else closeScanMenu();
});
elements.bulkMetadataAction.addEventListener("click", openBulkMetadata);
elements.startBulkMetadataButton.addEventListener("click", startOrResumeBulkMetadata);
elements.pauseBulkMetadataButton.addEventListener("click", () =>
  controlBulkMetadata("pause")
);
elements.cancelBulkMetadataButton.addEventListener("click", () => {
  if (window.confirm("Cancel this metadata job? Confirmed matches already saved will be kept.")) {
    controlBulkMetadata("cancel");
  }
});
document
  .querySelectorAll("[data-scan-action]")
  .forEach((button) =>
    button.addEventListener("click", () =>
      runScan({ action: button.dataset.scanAction || "quick" })
    )
  );
elements.issuesButton.addEventListener("click", openIssues);
elements.settingsButton.addEventListener("click", openSettings);
elements.emptyAddButton.addEventListener("click", openSettings);
elements.openMetadataSettingsButton.addEventListener("click", () =>
  openMetadataSettings()
);
elements.saveMetadataSettingsButton.addEventListener("click", () =>
  saveMetadataSettings()
);
elements.clearMetadataTokenButton.addEventListener("click", () => {
  if (
    window.confirm(
      "Remove the saved Metron token and disable online matching? Existing confirmed matches will stay attached."
    )
  ) {
    saveMetadataSettings({ clearMetron: true });
  }
});
elements.searchMetadataButton.addEventListener("click", searchMetadata);
elements.confirmMetadataMatchButton.addEventListener(
  "click",
  confirmMetadataMatch
);
elements.removeMetadataMatchButton.addEventListener(
  "click",
  removeMetadataMatch
);
elements.saveMetadataOverrideButton.addEventListener(
  "click",
  saveMetadataOverride
);
elements.resetMetadataOverrideButton.addEventListener(
  "click",
  resetMetadataOverride
);
[
  elements.metadataSeries,
  elements.metadataTitle,
  elements.metadataNumber,
  elements.metadataYear,
  elements.metadataPublisher
].forEach((input) => {
  input.addEventListener("keydown", (event) => {
    if (
      event.key === "Enter" &&
      metadataProviderReady(elements.metadataSearchProvider.value)
    ) {
      event.preventDefault();
      searchMetadata();
    }
  });
});
elements.metadataSearchProvider.addEventListener("change", () => {
  const ready = metadataProviderReady(elements.metadataSearchProvider.value);
  elements.searchMetadataButton.disabled = !ready;
  if (!ready) {
    elements.metadataSearchNote.textContent =
      "Enable and configure this provider in Settings first.";
  }
});
elements.browseButton.addEventListener("click", openFolderBrowser);
elements.addPathButton.addEventListener("click", async () => {
  const index = addEditingPath(elements.manualPath.value);
  elements.manualPath.value = "";
  if (index !== null) await openStructurePreview(index);
});
elements.manualPath.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    elements.addPathButton.click();
  }
});
elements.saveSettingsButton.addEventListener("click", saveSettings);
elements.openLibraryReviewButton.addEventListener("click", () => {
  elements.libraryReviewDialog.showModal();
  loadLibraryReview();
});

for (const button of document.querySelectorAll(".close-library-review")) {
  button.addEventListener("click", () => elements.libraryReviewDialog.close());
}

elements.chooseComicCoverButton.addEventListener("click", () =>
  elements.comicCoverInput.click()
);

elements.comicCoverInput.addEventListener("change", async () => {
  const [file] = elements.comicCoverInput.files || [];
  elements.comicCoverInput.value = "";
  const comic = state.metadataEditor?.comic;
  if (!file || !comic) return;
  try {
    await api(`/api/artwork/cover/comic/${comic.id}`, {
      method: "PUT",
      headers: { "Content-Type": file.type || "image/png" },
      body: await file.arrayBuffer()
    });
    await reloadEditedComic(comic.id);
    showToast("Cover set.");
  } catch (error) {
    showFormError(elements.metadataEditorError, error);
  }
});

elements.clearComicCoverButton.addEventListener("click", async () => {
  const comic = state.metadataEditor?.comic;
  if (!comic) return;
  try {
    await api(`/api/artwork/cover/comic/${comic.id}`, { method: "DELETE" });
    await reloadEditedComic(comic.id);
    showToast("Back to the comic's first page.");
  } catch (error) {
    showFormError(elements.metadataEditorError, error);
  }
});

elements.setOrderCoverButton.addEventListener("click", () =>
  elements.orderCoverInput.click()
);

elements.orderCoverInput.addEventListener("change", async () => {
  const [file] = elements.orderCoverInput.files || [];
  elements.orderCoverInput.value = "";
  if (!file || !state.activeOrderId) return;
  try {
    // Sent as the image itself. The server decides what it is from the bytes,
    // so a mislabelled file is refused there rather than trusted here.
    await api(`/api/artwork/cover/order/${state.activeOrderId}`, {
      method: "PUT",
      headers: { "Content-Type": file.type || "image/png" },
      body: await file.arrayBuffer()
    });
    await refresh();
    openOrderDetail(state.activeOrderId);
    showToast("Cover set.");
  } catch (error) {
    showToast(error.message);
  }
});

elements.exportOrderButton.addEventListener("click", async () => {
  if (!state.activeOrderId) return;
  try {
    const document_ = await api(`/api/reading-orders/${state.activeOrderId}/export`);
    const blob = new Blob([`${JSON.stringify(document_, null, 2)}\n`], {
      type: "application/json"
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${document_.name.replace(/[^\w -]+/g, "").trim() || "reading-order"}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  } catch (error) {
    showToast(error.message);
  }
});

elements.repairOrderButton.addEventListener("click", async () => {
  if (!state.activeOrderId) return;
  const report = await api(`/api/reading-orders/${state.activeOrderId}/repair`).catch(
    () => null
  );
  if (!report) return;
  const summary = [
    report.missing.length > 0 ? `remove ${report.missing.length} missing` : null,
    report.duplicated.length > 0 ? `de-duplicate ${report.duplicated.length}` : null
  ]
    .filter(Boolean)
    .join(" and ");
  if (!window.confirm(`Repair this order? This will ${summary}. Your comic files are not touched.`)) {
    return;
  }
  try {
    await api(`/api/reading-orders/${state.activeOrderId}/repair`, { method: "POST" });
    await refresh();
    openOrderDetail(state.activeOrderId);
    showToast("Reading order repaired.");
  } catch (error) {
    showToast(error.message);
  }
});

elements.importOrderButton.addEventListener("click", () =>
  elements.importOrderInput.click()
);

elements.importOrderInput.addEventListener("change", async () => {
  const [file] = elements.importOrderInput.files || [];
  elements.importOrderInput.value = "";
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const { report } = await api("/api/reading-orders/import", {
      method: "POST",
      body: JSON.stringify(parsed)
    });
    await refresh();
    renderOrders();
    // The missing count is the part worth saying out loud: an order that came
    // back shorter than it left is the thing someone needs to know about.
    showToast(
      report.missing.length === 0
        ? `Imported ${report.matched} comics.`
        : `Imported ${report.matched} comics. ${report.missing.length} could not be found in this library.`
    );
  } catch (error) {
    showToast(error.message || "That file is not a PanelShelf reading order.");
  }
});

elements.settingsDialog.addEventListener("close", stopCoverCachePolling);

elements.enablePairingButton.addEventListener("click", async () => {
  if (
    !window.confirm(
      "Turn on device pairing? Every client that is not paired — including OPDS readers — stops working until you pair it. This browser is paired automatically."
    )
  ) {
    return;
  }
  elements.enablePairingButton.disabled = true;
  try {
    // The response carries a token for a client that needs to hold one. This
    // browser does not: the same response sets its cookie.
    const paired = await api("/api/devices/enable", {
      method: "POST",
      body: JSON.stringify({ name: "This browser" })
    });
    renderDevicePairing({ enabled: paired.enabled, devices: [paired.device] });
    await loadDevicePairing();
    showToast("Device pairing is on. This browser is paired.");
  } catch (error) {
    showFormError(elements.settingsError, error);
  } finally {
    elements.enablePairingButton.disabled = false;
  }
});

elements.disablePairingButton.addEventListener("click", async () => {
  if (
    !window.confirm(
      "Turn off device pairing? Anything that can reach this server will be able to read your library again."
    )
  ) {
    return;
  }
  elements.disablePairingButton.disabled = true;
  try {
    renderDevicePairing(await api("/api/devices/disable", { method: "POST" }));
  } catch (error) {
    showFormError(elements.settingsError, error);
  } finally {
    elements.disablePairingButton.disabled = false;
  }
});

elements.pairDeviceButton.addEventListener("click", async () => {
  elements.pairDeviceButton.disabled = true;
  try {
    const pairing = await api("/api/devices/pairing-code", { method: "POST" });
    elements.devicePairingCode.textContent = pairing.code;
    elements.devicePairingCode.hidden = false;
    showToast("Type this code into the other device within five minutes.");
  } catch (error) {
    showFormError(elements.settingsError, error);
  } finally {
    elements.pairDeviceButton.disabled = false;
  }
});

elements.warmCoverCacheButton.addEventListener("click", async () => {
  elements.warmCoverCacheButton.disabled = true;
  try {
    renderCoverCache({ warmup: await api("/api/covers/cache/warm", { method: "POST" }) });
    pollCoverCache();
  } catch (error) {
    showFormError(elements.settingsError, error);
  } finally {
    elements.warmCoverCacheButton.disabled = false;
  }
});

elements.cancelCoverCacheButton.addEventListener("click", async () => {
  elements.cancelCoverCacheButton.disabled = true;
  try {
    await api("/api/covers/cache/warm/cancel", { method: "POST" });
    // The run stops between comics, so the state that matters is the one after
    // it has actually stopped rather than the one at the moment of asking.
    pollCoverCache();
  } catch (error) {
    showFormError(elements.settingsError, error);
  } finally {
    elements.cancelCoverCacheButton.disabled = false;
  }
});

elements.exportBackupButton.addEventListener("click", exportBackup);
elements.importBackupButton.addEventListener("click", () =>
  elements.backupFileInput.click()
);
elements.backupFileInput.addEventListener("change", () =>
  restoreBackupFile(elements.backupFileInput.files?.[0])
);
elements.folderUpButton.addEventListener("click", () => {
  if (state.browserParent !== null) loadFolders(state.browserParent);
});
elements.selectFolderButton.addEventListener("click", async () => {
  if (state.browserPath === "/") {
    showFormError(elements.folderError, new Error("Open a volume and choose a folder."));
    return;
  }
  const index = addEditingPath(state.browserPath);
  elements.folderDialog.close();
  if (index !== null) await openStructurePreview(index);
});
document.querySelectorAll(".close-dialog").forEach((button) => {
  button.addEventListener("click", () => elements.settingsDialog.close());
});
document.querySelectorAll(".close-metadata-settings").forEach((button) => {
  button.addEventListener("click", () => {
    state.metadata.pendingComic = null;
    elements.metadataSettingsDialog.close();
  });
});
document.querySelectorAll(".close-metadata").forEach((button) => {
  button.addEventListener("click", () => elements.metadataDialog.close());
});
document.querySelectorAll(".close-metadata-editor").forEach((button) => {
  button.addEventListener("click", () => elements.metadataEditorDialog.close());
});
document.querySelectorAll(".close-folder").forEach((button) => {
  button.addEventListener("click", () => elements.folderDialog.close());
});
document.querySelectorAll(".close-structure").forEach((button) => {
  button.addEventListener("click", () => elements.structureDialog.close());
});
document.querySelectorAll(".close-issues").forEach((button) => {
  button.addEventListener("click", () => elements.issuesDialog.close());
});
document.querySelectorAll(".close-permission").forEach((button) => {
  button.addEventListener("click", () => elements.permissionDialog.close());
});
document.querySelectorAll(".close-orders").forEach((button) => {
  button.addEventListener("click", () => elements.ordersDialog.close());
});
document.querySelectorAll(".close-order-detail").forEach((button) => {
  button.addEventListener("click", () => elements.orderDetailDialog.close());
});
document.querySelectorAll(".close-order-editor").forEach((button) => {
  button.addEventListener("click", () => elements.orderEditorDialog.close());
});
document.querySelectorAll(".close-comic-picker").forEach((button) => {
  button.addEventListener("click", () => elements.comicPickerDialog.close());
});
elements.createOrderButton.addEventListener("click", () => {
  elements.ordersDialog.close();
  openOrderEditor();
});
elements.editOrderButton.addEventListener("click", () => {
  const order = orderById(state.activeOrderId);
  if (!order || order.kind !== "manual") return;
  elements.orderDetailDialog.close();
  openOrderEditor(order);
});
elements.duplicateOrderButton.addEventListener("click", duplicateActiveOrder);
elements.deleteOrderButton.addEventListener("click", deleteActiveOrder);
elements.startOrderButton.addEventListener("click", () => {
  const order = orderById(state.activeOrderId);
  const comic = order ? firstReadableComic(order) : null;
  if (comic) openReader(comic, order.id);
});
elements.addOrderComicsButton.addEventListener("click", openComicPicker);
elements.moveSelectedUpButton.addEventListener("click", () =>
  moveEditorSelection(-1)
);
elements.moveSelectedDownButton.addEventListener("click", () =>
  moveEditorSelection(1)
);
elements.removeSelectedButton.addEventListener("click", () => {
  if (!state.editingOrder || state.editorSelection.size === 0) return;
  state.editingOrder.comicIds = state.editingOrder.comicIds.filter(
    (id) => !state.editorSelection.has(id)
  );
  state.editorSelection = new Set();
  renderOrderEditorItems();
});
elements.placeAllButton.addEventListener("click", () => {
  if (!state.editingOrder) return;
  const ordered = new Set(state.editingOrder.comicIds);
  for (const id of state.editingOrder.unplacedComicIds) {
    if (!ordered.has(id)) state.editingOrder.comicIds.push(id);
  }
  state.editingOrder.unplacedComicIds = [];
  renderOrderEditorItems();
});
elements.saveOrderButton.addEventListener("click", saveOrder);
elements.comicPickerSearch.addEventListener("input", renderComicPicker);
elements.confirmComicPickerButton.addEventListener("click", () => {
  if (!state.editingOrder) return;
  const ordered = new Set(state.editingOrder.comicIds);
  for (const id of state.pickerSelection) {
    if (!ordered.has(id)) state.editingOrder.comicIds.push(id);
  }
  state.editingOrder.unplacedComicIds =
    state.editingOrder.unplacedComicIds.filter(
      (id) => !state.pickerSelection.has(id)
    );
  state.pickerSelection = new Set();
  elements.comicPickerDialog.close();
  renderOrderEditorItems();
});
elements.issuesSettingsButton.addEventListener("click", () => {
  elements.issuesDialog.close();
  openSettings();
});
// The server owns the report, so clearing goes there rather than emptying the
// list locally: every browser and the iPad see the same scan, and a page reload
// would bring a locally hidden one straight back.
elements.clearIssuesButton.addEventListener("click", async () => {
  elements.clearIssuesButton.disabled = true;
  try {
    const scanState = await api("/api/scan/issues", { method: "DELETE" });
    state.scanIssues = [
      ...(scanState.errors || []),
      ...(scanState.warnings || [])
    ];
    renderScanIssues();
    elements.issuesDialog.close();
    showToast("Scan issues cleared.");
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.clearIssuesButton.disabled = false;
  }
});
elements.openDsmPermissionsButton.addEventListener("click", () => {
  window.open(dsmPermissionsUrl(), "_blank", "noopener");
});
elements.copyAccountButton.addEventListener("click", copyAccountName);
elements.permissionRescanButton.addEventListener("click", () => {
  state.permissionIssue = null;
  elements.permissionDialog.close();
  runScan({
    action: state.scanIssues.length > 0 ? "retry" : "quick"
  });
});
elements.structureProfile.addEventListener("change", () => {
  elements.profileHelp.textContent = PROFILE_HELP[elements.structureProfile.value];
  analyzeStructure();
});
elements.analyzeStructureButton.addEventListener("click", analyzeStructure);
elements.useStructureButton.addEventListener("click", useStructure);
elements.structureDialog.addEventListener("close", () => {
  state.structureRequest += 1;
  state.structurePreview = null;
  state.editingSourceIndex = null;
});
elements.metadataSettingsDialog.addEventListener("close", () => {
  clearFormError(elements.metadataSettingsError);
});
elements.metadataDialog.addEventListener("close", () => {
  state.metadata.request += 1;
  state.metadata.comic = null;
  state.metadata.candidate = null;
  state.metadata.results = [];
  clearFormError(elements.metadataError);
});
elements.metadataEditorDialog.addEventListener("close", () => {
  state.metadataEditor = { comic: null, baseline: null };
  clearFormError(elements.metadataEditorError);
});
elements.toastAction.addEventListener("click", () => {
  const action = showToast.action;
  elements.toast.hidden = true;
  showToast.action = null;
  if (action) action();
});
elements.readerClose.addEventListener("click", () => elements.readerDialog.close());
elements.readerDialog.addEventListener("close", () => {
  state.reader.renderToken += 1;
  updateVisibleComicStatuses();
  renderOrders();
});
elements.previousPage.addEventListener("click", () => moveFromReaderZone("left"));
elements.nextPage.addEventListener("click", () => moveFromReaderZone("right"));
elements.fitButton.addEventListener("click", toggleFit);
elements.readerMode.addEventListener("change", () => {
  state.reader.mode = elements.readerMode.value;
  persistReaderPreferences();
  if (state.reader.comic && state.reader.pages.length > 0) renderReader();
});
elements.readerNextComicButton.addEventListener("click", () => {
  const next = nextComicInReaderOrder(1);
  if (next) openReader(next, state.reader.orderId, 0);
});
elements.readerStage.addEventListener("scroll", () => {
  if (updateContinuousProgress.frame) return;
  updateContinuousProgress.frame = requestAnimationFrame(() => {
    updateContinuousProgress.frame = null;
    updateContinuousProgress();
  });
});
window.addEventListener("resize", () => hideCollectionPreview(true));
window.addEventListener(
  "scroll",
  () => hideCollectionPreview(true),
  { capture: true, passive: true }
);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.scanMenu.hidden) {
    closeScanMenu();
    return;
  }
  if (event.key === "Escape" && openComicStatusMenu) {
    closeComicStatusMenu();
    return;
  }
  if (!elements.readerDialog.open) return;
  if (["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName)) return;
  const manga = state.reader.mode === "manga";
  if (event.key === "ArrowLeft") movePage(manga ? 1 : -1);
  if (event.key === "ArrowRight") movePage(manga ? -1 : 1);
  if (event.key === "PageUp") movePage(-1);
  if (event.key === "PageDown" || event.key === " ") {
    event.preventDefault();
    movePage(1);
  }
});
document.addEventListener("click", (event) => {
  if (
    !elements.scanMenu.hidden &&
    !elements.scanControl.contains(event.target)
  ) {
    closeScanMenu();
  }
  if (
    openComicStatusMenu &&
    !openComicStatusMenu.menu.contains(event.target) &&
    !openComicStatusMenu.toggle.contains(event.target)
  ) {
    closeComicStatusMenu();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushPendingProgress();
});
window.addEventListener("pagehide", flushPendingProgress);

refresh().catch((error) => {
  elements.librarySummary.textContent = "PanelShelf could not load the library.";
  showToast(error.message);
});
