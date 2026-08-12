"use strict";

const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { decodeXmlEntities } = require("./metadata");
const {
  ATTRIBUTIONS: EXTRA_ATTRIBUTIONS,
  GCD_ID,
  GcdProvider,
  OPEN_LIBRARY_ID,
  OpenLibraryProvider,
  isCollectedEdition
} = require("./providers");
const { jsonError } = require("./util");

const ENRICHMENT_SCHEMA_VERSION = 3;
const METRON_ID = "metron";
const METRON_BASE_URL = "https://metron.cloud";
const SMART_PROVIDER_ID = "smart";
const SEARCH_STRATEGY_VERSION = 3;
const SEARCH_CACHE_MS = 24 * 60 * 60 * 1000;
const DETAIL_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_JSON_BYTES = 5 * 1024 * 1024;
const MAX_COVER_BYTES = 12 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 250;
const REQUEST_TIMEOUT_MS = 15_000;
const ATTRIBUTION = Object.freeze({
  provider: METRON_ID,
  name: "Metron Comic Book Database",
  url: "https://metron.cloud/",
  notice: "Metadata provided by Metron"
});
const EDITION_TYPES = Object.freeze({
  auto: {
    label: "Auto",
    metronType: null
  },
  "single-issue": {
    label: "Single issue",
    metronType: null
  },
  "trade-paperback": {
    label: "Trade paperback",
    metronType: "Trade Paperback"
  },
  hardcover: {
    label: "Hardcover",
    metronType: "Hardcover"
  },
  omnibus: {
    label: "Omnibus",
    metronType: "Omnibus"
  },
  "graphic-novel": {
    label: "Graphic novel",
    metronType: "Graphic Novel"
  }
});
const EDITION_SUFFIXES = Object.freeze([
  ["trade-paperback", /\s+(?:tpb|trade\s+paperback)\s*$/i],
  ["hardcover", /\s+(?:hc|hardcover)\s*$/i],
  ["omnibus", /\s+omnibus\s*$/i],
  ["graphic-novel", /\s+(?:gn|graphic\s+novel)\s*$/i]
]);

function defaultData() {
  return {
    schemaVersion: ENRICHMENT_SCHEMA_VERSION,
    settings: {
      gcd: {
        enabled: true
      },
      metron: {
        enabled: false,
        permissionConfirmed: false,
        token: ""
      },
      openlibrary: {
        enabled: true
      }
    },
    providerState: {
      gcd: {
        lastRequestAt: null
      },
      metron: {
        lastRequestAt: null,
        rateLimit: {}
      },
      openlibrary: {
        lastRequestAt: null
      }
    },
    cache: {},
    matches: {}
  };
}

async function atomicWriteJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600
  });
  await fsp.rename(temporary, filePath);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function text(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function plainText(value) {
  const source = text(value);
  if (!source) return "";
  return decodeXmlEntities(
    source
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function objectName(value) {
  if (typeof value === "string") return text(value);
  if (!value || typeof value !== "object") return "";
  return text(value.name || value.value || value.label || value.role);
}

function editionFromSeries(series) {
  for (const [edition, pattern] of EDITION_SUFFIXES) {
    if (pattern.test(series)) return edition;
  }
  return null;
}

function stripEditionSuffix(series, edition) {
  const entry = EDITION_SUFFIXES.find(([candidate]) => candidate === edition);
  return entry ? series.replace(entry[1], "").trim() : series;
}

function editionLabel(edition) {
  return EDITION_TYPES[edition]?.label || EDITION_TYPES.auto.label;
}

function names(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return [
    ...new Set(
      values
        .map((item) => objectName(item))
        .filter(Boolean)
    )
  ];
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerValue(value) {
  const parsed = numberValue(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function dateParts(...candidates) {
  for (const candidate of candidates) {
    const value = text(candidate);
    const match = value.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
    if (!match) continue;
    return {
      year: Number(match[1]),
      ...(match[2] ? { month: Number(match[2]) } : {}),
      ...(match[3] ? { day: Number(match[3]) } : {})
    };
  }
  return {};
}

function roleNames(credit) {
  const raw =
    credit?.roles ||
    credit?.role ||
    credit?.credit ||
    credit?.type ||
    [];
  return (Array.isArray(raw) ? raw : [raw])
    .map((role) => objectName(role).toLocaleLowerCase())
    .filter(Boolean);
}

function normalizeCreators(rawCredits) {
  const creators = {};
  const roleMap = [
    ["writers", /writer|script|plot/],
    ["coverArtists", /cover/],
    ["pencillers", /pencill|pencil|artist/],
    ["inkers", /inker|\bink\b/],
    ["colorists", /colou?rist|colou?r/],
    ["letterers", /letter/],
    ["editors", /editor/]
  ];
  for (const credit of Array.isArray(rawCredits) ? rawCredits : []) {
    const creator = objectName(
      credit?.creator || credit?.person || credit?.name || credit
    );
    if (!creator) continue;
    for (const role of roleNames(credit)) {
      const target = roleMap.find(([, pattern]) => pattern.test(role));
      if (!target) continue;
      creators[target[0]] ||= [];
      if (!creators[target[0]].includes(creator)) {
        creators[target[0]].push(creator);
      }
    }
  }
  return creators;
}

function assign(target, key, value) {
  if (value === null || value === undefined || value === "") return;
  if (Array.isArray(value) && value.length === 0) return;
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  ) {
    return;
  }
  target[key] = value;
}

function normalizeMetronIssue(raw) {
  if (!raw || typeof raw !== "object") {
    throw jsonError("Metron returned an invalid issue record.", "PROVIDER_INVALID_RESPONSE");
  }
  const recordId = text(raw.id);
  if (!/^\d+$/.test(recordId)) {
    throw jsonError(
      "Metron returned an issue without a stable record ID.",
      "PROVIDER_INVALID_RESPONSE"
    );
  }

  const seriesObject =
    raw.series && typeof raw.series === "object" ? raw.series : {};
  const series = text(
    seriesObject.name || seriesObject.series || raw.series_name || raw.series
  );
  const number = text(raw.number || raw.issue_number);
  const displayName =
    text(raw.issue || raw.display_name) ||
    [series, number ? `#${number}` : ""].filter(Boolean).join(" ");
  const title = text(
    raw.title ||
      raw.collection_title ||
      (typeof raw.name === "string" ? raw.name : "")
  );
  const publisher = objectName(
    raw.publisher || seriesObject.publisher || raw.indicia_publisher
  );
  const imprint = objectName(raw.imprint);
  const editionType = objectName(
    seriesObject.series_type || raw.series_type || raw.format
  );
  const date = dateParts(raw.cover_date, raw.store_date, raw.date);
  const creators = normalizeCreators(raw.credits);
  const arcs = names(raw.arcs || raw.story_arcs);
  const metadata = { source: METRON_ID };

  assign(metadata, "title", title);
  assign(metadata, "series", series);
  assign(metadata, "number", number);
  assign(metadata, "volume", integerValue(seriesObject.volume || raw.volume));
  assign(metadata, "year", date.year);
  assign(metadata, "month", date.month);
  assign(metadata, "day", date.day);
  assign(metadata, "publisher", publisher);
  assign(metadata, "imprint", imprint);
  assign(metadata, "summary", plainText(raw.desc || raw.description));
  assign(metadata, "format", editionType);
  assign(metadata, "ageRating", objectName(raw.rating || raw.age_rating));
  assign(metadata, "pageCount", integerValue(raw.page_count || raw.pages));
  assign(metadata, "communityRating", numberValue(raw.community_rating));
  assign(metadata, "creators", creators);
  assign(metadata, "genres", names(raw.genres));
  assign(metadata, "characters", names(raw.characters));
  assign(metadata, "teams", names(raw.teams));
  assign(metadata, "storyArcs", arcs);
  assign(metadata, "storyArc", arcs[0] || "");

  return {
    provider: METRON_ID,
    recordId,
    displayName: displayName || `Metron issue ${recordId}`,
    series,
    number,
    title,
    year: date.year || null,
    volume: integerValue(seriesObject.volume || raw.volume),
    seriesYearBegan: integerValue(
      seriesObject.year_began || raw.series_year_began
    ),
    publisher,
    editionType,
    coverDate: text(raw.cover_date),
    storeDate: text(raw.store_date),
    coverUrl: text(raw.image || raw.cover || raw.cover_url),
    modifiedAt: text(raw.modified),
    metadata,
    attribution: { ...ATTRIBUTION }
  };
}

function mergeMetadata(onlineMetadata, localMetadata) {
  const online =
    onlineMetadata && typeof onlineMetadata === "object" ? onlineMetadata : {};
  const local =
    localMetadata && typeof localMetadata === "object" ? localMetadata : {};
  if (Object.keys(online).length === 0 && Object.keys(local).length === 0) {
    return null;
  }
  const merged = { ...online, ...local };
  const creators = {
    ...(online.creators && typeof online.creators === "object"
      ? online.creators
      : {}),
    ...(local.creators && typeof local.creators === "object"
      ? local.creators
      : {})
  };
  if (Object.keys(creators).length > 0) merged.creators = creators;
  return merged;
}

function publicRecord(record) {
  if (!record) return null;
  const {
    coverUrl: _privateCoverUrl,
    ...safe
  } = record;
  return {
    ...safe,
    hasCover: Boolean(record.coverUrl),
    coverPath: record.coverUrl
      ? `/api/metadata/providers/${record.provider}/issues/${record.recordId}/cover`
      : null
  };
}

function cacheKey(provider, kind, value) {
  const digest = crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 32);
  return `${provider}:${kind}:${digest}`;
}

function normalizedQuery(input = {}) {
  const suppliedSeries = text(input.series);
  const requestedEdition = text(input.edition) || "auto";
  if (!Object.hasOwn(EDITION_TYPES, requestedEdition)) {
    throw jsonError("Choose a supported edition type.", "INVALID_METADATA_QUERY");
  }
  const inferredEdition =
    requestedEdition === "auto" ? editionFromSeries(suppliedSeries) : null;
  const edition = inferredEdition || requestedEdition;
  const series =
    edition !== "auto" && edition !== "single-issue"
      ? stripEditionSuffix(suppliedSeries, edition)
      : suppliedSeries;
  if (series.length < 2 || series.length > 200) {
    throw jsonError(
      "Enter at least two characters of a series name.",
      "INVALID_METADATA_QUERY"
    );
  }
  const number = text(input.number);
  if (number.length > 40) {
    throw jsonError("Issue number is too long.", "INVALID_METADATA_QUERY");
  }
  const publisher = text(input.publisher);
  if (publisher.length > 160) {
    throw jsonError("Publisher is too long.", "INVALID_METADATA_QUERY");
  }
  const title = text(input.title);
  if (title.length > 200) {
    throw jsonError("Title or subtitle is too long.", "INVALID_METADATA_QUERY");
  }
  const year =
    input.year === null || input.year === undefined || text(input.year) === ""
      ? null
      : integerValue(input.year);
  if (year !== null && (year < 1800 || year > 2200)) {
    throw jsonError("Enter a four-digit publication year.", "INVALID_METADATA_QUERY");
  }
  return {
    series,
    edition,
    ...(number ? { number } : {}),
    ...(year ? { year } : {}),
    ...(publisher ? { publisher } : {}),
    ...(title ? { title } : {})
  };
}

function normalizeMetronSeriesSummary(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = text(raw.id);
  if (!/^\d+$/.test(id)) return null;
  const displayName = text(raw.series || raw.display_name || raw.name);
  return {
    id,
    displayName: displayName || `Metron series ${id}`,
    yearBegan: integerValue(raw.year_began),
    volume: integerValue(raw.volume),
    issueCount: integerValue(raw.issue_count)
  };
}

function comparableSeriesName(value) {
  return text(value)
    .replace(/\s+\(\d{4}\)\s*$/, "")
    .replace(/\s+(?:tpb|trade\s+paperback|hc|hardcover|omnibus|gn|graphic\s+novel)\s*$/i, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLocaleLowerCase();
}

function normalizedComparable(value) {
  return text(value)
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLocaleLowerCase();
}

function comparableNumber(value) {
  return text(value)
    .replace(/^0+(?=\d)/, "")
    .toLocaleLowerCase();
}

function tokenSimilarity(left, right) {
  const leftValue = normalizedComparable(left);
  const rightValue = normalizedComparable(right);
  if (!leftValue || !rightValue) return 0;
  if (leftValue === rightValue) return 1;
  const leftTokens = new Set(leftValue.split(" "));
  const rightTokens = new Set(rightValue.split(" "));
  const intersection = [...leftTokens].filter((token) =>
    rightTokens.has(token)
  ).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union ? intersection / union : 0;
}

function scoreRecord(record, query) {
  let score = 0;
  const seriesSimilarity = tokenSimilarity(record.series, query.series);
  score += Math.round(seriesSimilarity * 55);
  if (query.title) score += Math.round(tokenSimilarity(record.title, query.title) * 20);
  const recordNumber = comparableNumber(record.number || record.volume);
  const queryNumber = comparableNumber(query.number);
  if (queryNumber && recordNumber) {
    score += recordNumber === queryNumber ? 15 : -15;
  }
  if (query.year && record.year) {
    score += Number(record.year) === Number(query.year) ? 10 : -5;
  }
  if (
    query.publisher &&
    record.publisher &&
    tokenSimilarity(record.publisher, query.publisher) >= 0.5
  ) {
    score += 5;
  }
  if (isCollectedEdition(query)) {
    const format = normalizedComparable(record.editionType);
    if (/collect|trade paperback|hardcover|omnibus|graphic novel/.test(format)) {
      score += 5;
    }
  }
  return Math.max(0, Math.min(100, score));
}

function rankedRecords(records, query) {
  const priorities = {
    [GCD_ID]: 0,
    [METRON_ID]: 1,
    [OPEN_LIBRARY_ID]: 2
  };
  return records
    .map((record) => {
      const matchScore = scoreRecord(record, query);
      const highThreshold =
        !query.title && query.number && query.year ? 80 : 85;
      return {
        ...record,
        matchScore,
        confidence:
          matchScore >= highThreshold
            ? "high"
            : matchScore >= 65
              ? "medium"
              : "low"
      };
    })
    .sort(
      (left, right) =>
        right.matchScore - left.matchScore ||
        (priorities[left.provider] ?? 99) -
          (priorities[right.provider] ?? 99) ||
        left.displayName.localeCompare(right.displayName, undefined, {
          numeric: true,
          sensitivity: "base"
        })
    );
}

function rankSeriesSummaries(series, query) {
  const target = comparableSeriesName(query.series);
  return [...series].sort((left, right) => {
    const leftName = comparableSeriesName(left.displayName);
    const rightName = comparableSeriesName(right.displayName);
    const score = (candidate, candidateName) =>
      (candidateName === target ? 100 : 0) +
      (candidateName.startsWith(target) ? 30 : 0) +
      (query.year && candidate.yearBegan === query.year ? 20 : 0) +
      (candidate.issueCount > 0 ? 5 : 0);
    const scoreDifference =
      score(right, rightName) - score(left, leftName);
    if (scoreDifference !== 0) return scoreDifference;
    return left.displayName.localeCompare(right.displayName, undefined, {
      numeric: true,
      sensitivity: "base"
    });
  });
}

function parseRateWindow(headers, prefix) {
  const limit = integerValue(headers.get(`x-ratelimit-${prefix}-limit`));
  const remaining = integerValue(
    headers.get(`x-ratelimit-${prefix}-remaining`)
  );
  const resetAt = integerValue(headers.get(`x-ratelimit-${prefix}-reset`));
  if (limit === null && remaining === null && resetAt === null) return null;
  return {
    ...(limit !== null ? { limit } : {}),
    ...(remaining !== null ? { remaining } : {}),
    ...(resetAt !== null
      ? { resetAt: new Date(resetAt * 1000).toISOString() }
      : {})
  };
}

function rateLimitRetryAt(rateLimit = {}) {
  const now = Date.now();
  const blocked = [rateLimit.burst, rateLimit.sustained]
    .filter(
      (window) =>
        window &&
        Number(window.remaining) <= 0 &&
        Date.parse(window.resetAt || "") > now
    )
    .sort((left, right) => Date.parse(left.resetAt) - Date.parse(right.resetAt));
  return blocked[0]?.resetAt || null;
}

class MetronProvider {
  constructor(options) {
    this.fetchImpl = options.fetchImpl || global.fetch;
    this.getSettings = options.getSettings;
    this.getRateLimit = options.getRateLimit;
    this.updateProviderState = options.updateProviderState;
  }

  assertReady() {
    const settings = this.getSettings();
    if (!settings.enabled) {
      throw jsonError(
        "Enable online metadata in PanelShelf settings first.",
        "METADATA_NOT_CONFIGURED"
      );
    }
    if (!settings.permissionConfirmed) {
      throw jsonError(
        "Confirm that this Metron account may be used by this installation.",
        "PROVIDER_PERMISSION_REQUIRED"
      );
    }
    if (!text(settings.token)) {
      throw jsonError(
        "Add a Metron API token in PanelShelf settings.",
        "METADATA_NOT_CONFIGURED"
      );
    }
    const retryAt = rateLimitRetryAt(this.getRateLimit());
    if (retryAt) {
      throw jsonError(
        `Metron's request limit resets at ${retryAt}.`,
        "PROVIDER_RATE_LIMITED",
        { retryAt }
      );
    }
    return settings;
  }

  async requestJson(endpoint, query = null) {
    const settings = this.assertReady();
    const url = new URL(endpoint, METRON_BASE_URL);
    if (url.origin !== METRON_BASE_URL) {
      throw jsonError("Invalid provider endpoint.", "INVALID_PROVIDER");
    }
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== null && value !== undefined && value !== "") {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await this.fetchImpl(url, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${settings.token}`,
          "User-Agent": "PanelShelf/0.4.1"
        },
        redirect: "error",
        signal: controller.signal
      });
    } catch (error) {
      if (error.name === "AbortError") {
        throw jsonError(
          "Metron did not respond before the request timed out.",
          "PROVIDER_UNAVAILABLE"
        );
      }
      throw jsonError(
        "PanelShelf could not reach Metron. Your local library is still available.",
        "PROVIDER_UNAVAILABLE"
      );
    } finally {
      clearTimeout(timeout);
    }

    const rateLimit = {
      ...(parseRateWindow(response.headers, "burst")
        ? { burst: parseRateWindow(response.headers, "burst") }
        : {}),
      ...(parseRateWindow(response.headers, "sustained")
        ? { sustained: parseRateWindow(response.headers, "sustained") }
        : {})
    };
    await this.updateProviderState({
      lastRequestAt: new Date().toISOString(),
      ...(Object.keys(rateLimit).length > 0 ? { rateLimit } : {})
    });

    if (response.status === 401) {
      throw jsonError(
        "Metron rejected this API token. Generate a new token and update settings.",
        "PROVIDER_AUTH_FAILED"
      );
    }
    if (response.status === 403) {
      throw jsonError(
        "This Metron account cannot access that record.",
        "PROVIDER_PERMISSION_REQUIRED"
      );
    }
    if (response.status === 429) {
      const retryHeader = text(response.headers.get("retry-after"));
      const retrySeconds = integerValue(retryHeader);
      const retryDate = Date.parse(retryHeader);
      const retryAt =
        retrySeconds !== null
          ? new Date(Date.now() + retrySeconds * 1000).toISOString()
          : Number.isFinite(retryDate)
            ? new Date(retryDate).toISOString()
          : rateLimitRetryAt(rateLimit);
      throw jsonError(
        retryAt
          ? `Metron's request limit resets at ${retryAt}.`
          : "Metron's request limit has been reached. Try again later.",
        "PROVIDER_RATE_LIMITED",
        retryAt ? { retryAt } : undefined
      );
    }
    if (response.status === 404) {
      throw jsonError("Metron issue not found.", "PROVIDER_RECORD_NOT_FOUND");
    }
    if (!response.ok) {
      throw jsonError(
        response.status >= 500
          ? "Metron is temporarily unavailable. Your local library is unaffected."
          : "Metron could not process this metadata request.",
        response.status >= 500
          ? "PROVIDER_UNAVAILABLE"
          : "PROVIDER_INVALID_REQUEST"
      );
    }

    const contentLength = integerValue(response.headers.get("content-length"));
    if (contentLength !== null && contentLength > MAX_JSON_BYTES) {
      throw jsonError(
        "Metron returned an unexpectedly large response.",
        "PROVIDER_INVALID_RESPONSE"
      );
    }
    const body = await response.text();
    if (Buffer.byteLength(body) > MAX_JSON_BYTES) {
      throw jsonError(
        "Metron returned an unexpectedly large response.",
        "PROVIDER_INVALID_RESPONSE"
      );
    }
    try {
      return JSON.parse(body);
    } catch {
      throw jsonError(
        "Metron returned an invalid response.",
        "PROVIDER_INVALID_RESPONSE"
      );
    }
  }

  async searchCollectedEdition(query) {
    const edition = EDITION_TYPES[query.edition];
    const seriesPayload = await this.requestJson("/api/series/", {
      name: query.series,
      series_type: edition.metronType,
      ...(query.year ? { year_began: query.year } : {}),
      ...(query.publisher ? { publisher_name: query.publisher } : {})
    });
    const allSeries = (Array.isArray(seriesPayload?.results)
      ? seriesPayload.results
      : [])
      .map(normalizeMetronSeriesSummary)
      .filter(Boolean);
    const rankedSeries = rankSeriesSummaries(allSeries, query);
    const selectedSeries = rankedSeries.slice(0, 3);
    const records = [];
    const seen = new Set();

    for (const series of selectedSeries) {
      const issuePayload = await this.requestJson("/api/issue/", {
        series_id: series.id,
        ...(query.number ? { number: query.number } : {})
      });
      for (const raw of Array.isArray(issuePayload?.results)
        ? issuePayload.results
        : []) {
        const record = normalizeMetronIssue(raw);
        if (seen.has(record.recordId)) continue;
        seen.add(record.recordId);
        records.push(record);
        if (records.length >= 30) break;
      }
      if (records.length >= 30) break;
    }

    return {
      records,
      searchInfo: {
        mode: "collected-series",
        edition: query.edition,
        editionLabel: edition.label,
        seriesMatches: allSeries.length,
        searchedSeries: selectedSeries,
        omittedSeries: Math.max(0, allSeries.length - selectedSeries.length)
      }
    };
  }

  async search(query) {
    if (EDITION_TYPES[query.edition]?.metronType) {
      return this.searchCollectedEdition(query);
    }
    const payload = await this.requestJson("/api/issue/", {
      series_name: query.series,
      ...(query.number ? { number: query.number } : {}),
      ...(query.year ? { series_year_began: query.year } : {}),
      ...(query.publisher ? { publisher_name: query.publisher } : {})
    });
    const results = Array.isArray(payload?.results) ? payload.results : [];
    return {
      records: results.slice(0, 30).map(normalizeMetronIssue),
      searchInfo: {
        mode: "issue-list",
        edition: query.edition,
        editionLabel: editionLabel(query.edition),
        seriesMatches: null,
        searchedSeries: [],
        omittedSeries: 0
      }
    };
  }

  async issue(recordId) {
    if (!/^\d+$/.test(String(recordId || ""))) {
      throw jsonError("Invalid Metron issue ID.", "INVALID_PROVIDER_RECORD");
    }
    return normalizeMetronIssue(
      await this.requestJson(`/api/issue/${recordId}/`)
    );
  }
}

class MetadataEnrichmentStore {
  constructor(dataDirectory, options = {}) {
    this.dataDirectory = dataDirectory;
    this.filePath = path.join(dataDirectory, "online-metadata.json");
    this.fetchImpl = options.fetchImpl || global.fetch;
    this.data = defaultData();
    this.coverCache = new Map();
    this.persistQueue = Promise.resolve();
    const updateProviderState = (provider) => async (update) => {
      this.data.providerState[provider] = {
        ...(this.data.providerState[provider] || {}),
        ...update
      };
      await this.persist();
    };
    this.providers = {
      [GCD_ID]: new GcdProvider({
        fetchImpl: this.fetchImpl,
        getSettings: () => this.data.settings.gcd,
        updateProviderState: updateProviderState(GCD_ID)
      }),
      [METRON_ID]: new MetronProvider({
        fetchImpl: this.fetchImpl,
        getSettings: () => this.data.settings.metron,
        getRateLimit: () => this.data.providerState.metron.rateLimit || {},
        updateProviderState: updateProviderState(METRON_ID)
      }),
      [OPEN_LIBRARY_ID]: new OpenLibraryProvider({
        fetchImpl: this.fetchImpl,
        getSettings: () => this.data.settings.openlibrary,
        updateProviderState: updateProviderState(OPEN_LIBRARY_ID)
      })
    };
    this.metron = this.providers[METRON_ID];
  }

  async initialize() {
    const saved = await readJson(this.filePath, defaultData());
    const removedComicVineData = Boolean(
      saved?.settings?.comicvine ||
        saved?.providerState?.comicvine ||
        Object.values(saved?.matches || {}).some(
          (match) => match?.provider === "comicvine"
        )
    );
    const fallback = defaultData();
    const savedSettings =
      saved?.settings && typeof saved.settings === "object"
        ? saved.settings
        : {};
    const savedState =
      saved?.providerState && typeof saved.providerState === "object"
        ? saved.providerState
        : {};
    this.data = {
      ...fallback,
      ...(saved && typeof saved === "object" ? saved : {}),
      schemaVersion: ENRICHMENT_SCHEMA_VERSION,
      settings: Object.fromEntries(
        Object.keys(fallback.settings).map((provider) => [
          provider,
          {
            ...fallback.settings[provider],
            ...(savedSettings[provider] || {})
          }
        ])
      ),
      providerState: Object.fromEntries(
        Object.keys(fallback.providerState).map((provider) => [
          provider,
          {
            ...fallback.providerState[provider],
            ...(savedState[provider] || {}),
            ...(provider === METRON_ID
              ? {
                  rateLimit:
                    savedState.metron?.rateLimit &&
                    typeof savedState.metron.rateLimit === "object"
                      ? savedState.metron.rateLimit
                      : {}
                }
              : {})
          }
        ])
      ),
      cache:
        saved?.cache && typeof saved.cache === "object" ? saved.cache : {},
      matches:
        saved?.matches && typeof saved.matches === "object"
          ? Object.fromEntries(
              Object.entries(saved.matches).filter(
                ([, match]) => match?.provider !== "comicvine"
              )
            )
          : {}
    };
    this.data.cache = Object.fromEntries(
      Object.entries(this.data.cache).filter(
        ([key, value]) =>
          !key.includes(":comicvine:") &&
          value?.record?.provider !== "comicvine" &&
          !value?.records?.some((record) => record?.provider === "comicvine")
      )
    );
    if (removedComicVineData) await this.persist();
  }

  async persist() {
    const snapshot = structuredClone(this.data);
    this.persistQueue = this.persistQueue
      .catch(() => {})
      .then(() => atomicWriteJson(this.filePath, snapshot));
    await this.persistQueue;
  }

  exportMatches() {
    return structuredClone(this.data.matches);
  }

  async restoreMatches(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw jsonError("Backup metadata matches are invalid.", "INVALID_BACKUP");
    }
    const entries = Object.entries(value);
    if (entries.length > 100_000) {
      throw jsonError("Backup contains too many metadata matches.", "INVALID_BACKUP");
    }
    const restored = {};
    for (const [comicId, match] of entries) {
      if (
        !/^[a-f0-9]{24}$/.test(comicId) ||
        !match ||
        typeof match !== "object" ||
        !this.supportsProvider(match.provider) ||
        typeof match.recordId !== "string" ||
        !match.record ||
        typeof match.record !== "object"
      ) {
        throw jsonError("Backup contains an invalid metadata match.", "INVALID_BACKUP");
      }
      restored[comicId] = structuredClone(match);
    }
    this.data.matches = restored;
    await this.persist();
  }

  settings() {
    const metron = this.data.settings.metron;
    const token = text(metron.token);
    const providers = [
      {
        id: GCD_ID,
        name: "Grand Comics Database",
        shortName: "GCD",
        enabled: Boolean(this.data.settings.gcd.enabled),
        configured: true,
        permissionConfirmed: true,
        authentication: "No key required",
        attribution: { ...EXTRA_ATTRIBUTIONS.gcd }
      },
      {
        id: METRON_ID,
        name: "Metron",
        shortName: "Metron",
        enabled: Boolean(metron.enabled),
        configured: Boolean(token),
        permissionConfirmed: Boolean(metron.permissionConfirmed),
        tokenHint: token ? `••••${token.slice(-4)}` : "",
        authentication: "API token",
        attribution: { ...ATTRIBUTION }
      },
      {
        id: OPEN_LIBRARY_ID,
        name: "Open Library",
        shortName: "Open Library",
        enabled: Boolean(this.data.settings.openlibrary.enabled),
        configured: true,
        permissionConfirmed: true,
        authentication: "No key required",
        collectedOnly: true,
        attribution: { ...EXTRA_ATTRIBUTIONS.openlibrary }
      }
    ].map((provider) => ({
      ...provider,
      ready:
        provider.enabled &&
        provider.configured &&
        provider.permissionConfirmed,
      lastRequestAt:
        this.data.providerState[provider.id]?.lastRequestAt || null
    }));
    const legacyMetron = providers.find(
      (provider) => provider.id === METRON_ID
    );
    return {
      providers,
      provider: legacyMetron,
      readyProviderIds: providers
        .filter((provider) => provider.ready)
        .map((provider) => provider.id),
      strategy: {
        id: "smart-fallback",
        label: "Smart fallback",
        order: [GCD_ID, METRON_ID, OPEN_LIBRARY_ID],
        note:
          "PanelShelf stops after a strong match. Open Library is queried only for collected editions."
      },
      rateLimit: {
        ...(this.data.providerState.metron.rateLimit || {})
      },
      lastRequestAt: this.data.providerState.metron.lastRequestAt || null
    };
  }

  async saveSettings(input = {}) {
    const providerInput =
      input.providers && typeof input.providers === "object"
        ? input.providers
        : {};
    const legacyMetronInput =
      Object.hasOwn(input, "enabled") ||
      Object.hasOwn(input, "token") ||
      Object.hasOwn(input, "clearToken") ||
      Object.hasOwn(input, "permissionConfirmed")
        ? input
        : {};
    const metronInput = {
      ...(providerInput.metron || {}),
      ...legacyMetronInput
    };
    const previous = this.data.settings.metron;
    const requestedToken =
      typeof metronInput.token === "string" ? metronInput.token.trim() : null;
    const token = metronInput.clearToken
      ? ""
      : requestedToken
        ? requestedToken
        : previous.token;
    const enabled = Object.hasOwn(metronInput, "enabled")
      ? Boolean(metronInput.enabled)
      : Boolean(previous.enabled);
    const permissionConfirmed = Object.hasOwn(
      metronInput,
      "permissionConfirmed"
    )
      ? Boolean(metronInput.permissionConfirmed)
      : Boolean(previous.permissionConfirmed);
    if (token.length > 500) {
      throw jsonError("The Metron API token is too long.", "INVALID_CONFIG");
    }
    if (enabled && !token) {
      throw jsonError(
        "Add a Metron API token before enabling online metadata.",
        "METADATA_NOT_CONFIGURED"
      );
    }
    if (enabled && !permissionConfirmed) {
      throw jsonError(
        "Confirm that this Metron account may be used by this installation.",
        "PROVIDER_PERMISSION_REQUIRED"
      );
    }
    this.data.settings.metron = {
      enabled,
      permissionConfirmed,
      token
    };
    const gcdInput = providerInput.gcd || {};
    if (Object.hasOwn(gcdInput, "enabled")) {
      this.data.settings.gcd.enabled = Boolean(gcdInput.enabled);
    }
    const openLibraryInput = providerInput.openlibrary || {};
    if (Object.hasOwn(openLibraryInput, "enabled")) {
      this.data.settings.openlibrary.enabled = Boolean(
        openLibraryInput.enabled
      );
    }
    await this.persist();
    return this.settings();
  }

  supportsProvider(provider) {
    return Boolean(this.providers[provider]);
  }

  providerSettings(provider) {
    return this.settings().providers.find(
      (candidate) => candidate.id === provider
    );
  }

  providerReady(provider) {
    return Boolean(this.providerSettings(provider)?.ready);
  }

  trimCache() {
    const entries = Object.entries(this.data.cache);
    if (entries.length <= MAX_CACHE_ENTRIES) return;
    entries
      .sort(
        (left, right) =>
          Date.parse(left[1]?.storedAt || "") -
          Date.parse(right[1]?.storedAt || "")
      )
      .slice(0, entries.length - MAX_CACHE_ENTRIES)
      .forEach(([key]) => delete this.data.cache[key]);
  }

  async searchProvider(provider, query, options = {}) {
    if (!this.supportsProvider(provider)) {
      throw jsonError("Unsupported metadata provider.", "INVALID_PROVIDER");
    }
    const key = cacheKey(
      provider,
      `search-v${SEARCH_STRATEGY_VERSION}`,
      query
    );
    const cached = this.data.cache[key];
    const now = Date.now();
    const fresh =
      cached &&
      Array.isArray(cached.records) &&
      Date.parse(cached.expiresAt || "") > now;
    if (fresh && !options.refresh) {
      return {
        provider,
        query,
        candidates: cached.records.map(publicRecord),
        cached: true,
        stale: false,
        fetchedAt: cached.storedAt,
        searchInfo: cached.searchInfo || null,
        attribution: {
          ...(this.providerSettings(provider)?.attribution || {})
        },
        rateLimit: this.settings().rateLimit
      };
    }

    try {
      const { records, searchInfo } = await this.providers[provider].search(
        query
      );
      const ranked = rankedRecords(records, query);
      const storedAt = new Date().toISOString();
      this.data.cache[key] = {
        kind: "search",
        provider,
        storedAt,
        expiresAt: new Date(now + SEARCH_CACHE_MS).toISOString(),
        records: ranked,
        searchInfo
      };
      this.trimCache();
      await this.persist();
      return {
        provider,
        query,
        candidates: ranked.map(publicRecord),
        cached: false,
        stale: false,
        fetchedAt: storedAt,
        searchInfo,
        attribution: {
          ...(this.providerSettings(provider)?.attribution || {})
        },
        rateLimit: this.settings().rateLimit
      };
    } catch (error) {
      if (cached && Array.isArray(cached.records)) {
        return {
          provider,
          query,
          candidates: cached.records.map(publicRecord),
          cached: true,
          stale: true,
          fetchedAt: cached.storedAt,
          searchInfo: cached.searchInfo || null,
          warning: error.message,
          attribution: {
            ...(this.providerSettings(provider)?.attribution || {})
          },
          rateLimit: this.settings().rateLimit
        };
      }
      throw error;
    }
  }

  async search(input = {}) {
    const query = normalizedQuery(input);
    const selectedProvider = text(input.provider) || SMART_PROVIDER_ID;
    if (
      selectedProvider !== SMART_PROVIDER_ID &&
      !this.supportsProvider(selectedProvider)
    ) {
      throw jsonError("Choose a supported metadata provider.", "INVALID_PROVIDER");
    }
    if (selectedProvider !== SMART_PROVIDER_ID) {
      return this.searchProvider(selectedProvider, query, {
        refresh: Boolean(input.refresh)
      });
    }

    const plan = [
      GCD_ID,
      METRON_ID,
      ...(isCollectedEdition(query) ? [OPEN_LIBRARY_ID] : [])
    ].filter((provider) => this.providerReady(provider));
    if (plan.length === 0) {
      throw jsonError(
        "Enable at least one metadata provider in Settings.",
        "METADATA_NOT_CONFIGURED"
      );
    }

    const records = [];
    const attempts = [];
    const warnings = [];
    let stoppedAfter = null;
    let allCached = true;
    let anyStale = false;
    let fetchedAt = null;
    for (const provider of plan) {
      try {
        const result = await this.searchProvider(provider, query, {
          refresh: Boolean(input.refresh)
        });
        attempts.push({
          provider,
          providerLabel: this.providerSettings(provider)?.shortName || provider,
          status: result.stale ? "stale-cache" : "ok",
          matches: result.candidates.length,
          cached: result.cached,
          searchInfo: result.searchInfo || null
        });
        allCached = allCached && result.cached;
        anyStale ||= Boolean(result.stale);
        fetchedAt =
          !fetchedAt ||
          Date.parse(result.fetchedAt || "") > Date.parse(fetchedAt || "")
            ? result.fetchedAt
            : fetchedAt;
        records.push(...result.candidates);
        if (result.candidates[0]?.confidence === "high") {
          stoppedAfter = provider;
          break;
        }
      } catch (error) {
        attempts.push({
          provider,
          providerLabel: this.providerSettings(provider)?.shortName || provider,
          status: "error",
          matches: 0,
          code: error.code || "PROVIDER_ERROR",
          message: error.message
        });
        warnings.push(`${this.providerSettings(provider)?.shortName || provider}: ${error.message}`);
      }
    }
    const deduplicated = [
      ...new Map(
        records.map((record) => [
          `${record.provider}:${record.recordId}`,
          record
        ])
      ).values()
    ].sort(
      (left, right) =>
        (right.matchScore || 0) - (left.matchScore || 0)
    );
    return {
      provider: SMART_PROVIDER_ID,
      query,
      candidates: deduplicated,
      cached: allCached,
      stale: anyStale,
      fetchedAt,
      searchInfo: {
        mode: "smart-fallback",
        edition: query.edition,
        editionLabel: editionLabel(query.edition),
        attempts,
        stoppedAfter,
        plannedProviders: plan
      },
      ...(warnings.length ? { warning: warnings.join(" ") } : {}),
      attribution: null,
      rateLimit: this.settings().rateLimit
    };
  }

  findCachedRecord(provider, recordId) {
    const match = Object.values(this.data.matches).find(
      (candidate) =>
        candidate.provider === provider &&
        candidate.recordId === String(recordId)
    );
    if (match?.record) return match.record;
    for (const cached of Object.values(this.data.cache)) {
      if (
        cached?.record?.provider === provider &&
        cached.record.recordId === String(recordId)
      ) {
        return cached.record;
      }
      const candidate = cached?.records?.find(
        (record) =>
          record.provider === provider &&
          record.recordId === String(recordId)
      );
      if (candidate) return candidate;
    }
    return null;
  }

  async issue(provider, recordId, options = {}) {
    if (!this.supportsProvider(provider)) {
      throw jsonError("Unsupported metadata provider.", "INVALID_PROVIDER");
    }
    const id = String(recordId || "");
    if (!/^[A-Za-z0-9._:-]{1,100}$/.test(id)) {
      throw jsonError("Invalid provider record ID.", "INVALID_PROVIDER_RECORD");
    }
    const key = `${provider}:issue:${id}`;
    const cached = this.data.cache[key];
    if (
      cached?.record &&
      Date.parse(cached.expiresAt || "") > Date.now() &&
      !options.refresh
    ) {
      return { record: cached.record, cached: true, stale: false };
    }
    try {
      const seed = cached?.record || this.findCachedRecord(provider, id);
      const fetched = await this.providers[provider].issue(id, seed);
      const record = {
        ...fetched,
        ...(seed?.matchScore !== undefined
          ? {
              matchScore: seed.matchScore,
              confidence: seed.confidence
            }
          : {})
      };
      const storedAt = new Date().toISOString();
      this.data.cache[key] = {
        kind: "issue",
        provider,
        storedAt,
        expiresAt: new Date(Date.now() + DETAIL_CACHE_MS).toISOString(),
        record
      };
      this.trimCache();
      await this.persist();
      return { record, cached: false, stale: false };
    } catch (error) {
      const fallback =
        cached?.record || this.findCachedRecord(provider, id);
      if (fallback) {
        return {
          record: fallback,
          cached: true,
          stale: true,
          warning: error.message
        };
      }
      throw error;
    }
  }

  async review(provider, recordId, options = {}) {
    if (
      recordId &&
      typeof recordId === "object" &&
      !Array.isArray(recordId)
    ) {
      options = recordId;
      recordId = provider;
      provider = METRON_ID;
    } else if (recordId === undefined) {
      recordId = provider;
      provider = METRON_ID;
    }
    const result = await this.issue(provider, recordId, options);
    return {
      ...result,
      record: publicRecord(result.record),
      attribution: {
        ...(result.record.attribution ||
          this.providerSettings(provider)?.attribution ||
          {})
      },
      rateLimit: this.settings().rateLimit
    };
  }

  async confirm(comicId, provider, recordId) {
    if (recordId === undefined) {
      recordId = provider;
      provider = METRON_ID;
    }
    const result = await this.issue(provider, recordId);
    const now = new Date().toISOString();
    const attribution = {
      ...(result.record.attribution ||
        this.providerSettings(provider)?.attribution ||
        {})
    };
    this.data.matches[comicId] = {
      provider,
      recordId: result.record.recordId,
      confirmedAt: now,
      fetchedAt: now,
      attribution,
      record: result.record
    };
    await this.persist();
    return this.matchForComic(comicId);
  }

  async remove(comicId) {
    const existed = Boolean(this.data.matches[comicId]);
    delete this.data.matches[comicId];
    if (existed) await this.persist();
    return existed;
  }

  matchForComic(comicId) {
    const match = this.data.matches[comicId];
    if (!match) return null;
    return {
      provider: match.provider,
      providerLabel:
        match.record?.providerLabel ||
        this.providerSettings(match.provider)?.shortName ||
        match.provider,
      recordId: match.recordId,
      confirmedAt: match.confirmedAt,
      fetchedAt: match.fetchedAt,
      attribution: {
        ...(match.attribution ||
          this.providerSettings(match.provider)?.attribution ||
          ATTRIBUTION)
      },
      record: match.record
    };
  }

  publicMatch(comicId) {
    const match = this.matchForComic(comicId);
    if (!match) return null;
    return {
      provider: match.provider,
      providerLabel: match.providerLabel,
      recordId: match.recordId,
      confirmedAt: match.confirmedAt,
      fetchedAt: match.fetchedAt,
      attribution: match.attribution,
      record: publicRecord(match.record)
    };
  }

  async reconcile(comics) {
    const ids = new Set(comics.map((comic) => comic.id));
    let changed = false;
    for (const comicId of Object.keys(this.data.matches)) {
      if (ids.has(comicId)) continue;
      delete this.data.matches[comicId];
      changed = true;
    }
    if (changed) await this.persist();
  }

  async cover(provider, recordId) {
    if (recordId === undefined) {
      recordId = provider;
      provider = METRON_ID;
    }
    if (provider !== METRON_ID) {
      throw jsonError(
        "This provider does not supply a reusable cover through PanelShelf.",
        "NOT_FOUND"
      );
    }
    const id = String(recordId || "");
    if (!/^\d+$/.test(id)) {
      throw jsonError("Invalid Metron issue ID.", "INVALID_PROVIDER_RECORD");
    }
    const memoryKey = `${provider}:${id}`;
    const memory = this.coverCache.get(memoryKey);
    if (memory && memory.expiresAt > Date.now()) return memory.value;
    let record = this.findCachedRecord(provider, id);
    if (!record?.coverUrl) {
      record = (await this.issue(provider, id)).record;
    }
    if (!record.coverUrl) {
      throw jsonError("Metron has no cover for this issue.", "NOT_FOUND");
    }
    let coverUrl;
    try {
      coverUrl = new URL(record.coverUrl);
    } catch {
      throw jsonError("Metron returned an invalid cover URL.", "PROVIDER_INVALID_RESPONSE");
    }
    if (
      coverUrl.protocol !== "https:" ||
      !["static.metron.cloud", "metron.cloud"].includes(coverUrl.hostname) ||
      !coverUrl.pathname.startsWith("/media/")
    ) {
      throw jsonError("Metron returned an unsafe cover URL.", "PROVIDER_INVALID_RESPONSE");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await this.fetchImpl(coverUrl, {
        headers: { Accept: "image/*", "User-Agent": "PanelShelf/0.4.1" },
        redirect: "error",
        signal: controller.signal
      });
    } catch {
      throw jsonError("The Metron cover is unavailable.", "PROVIDER_UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw jsonError("The Metron cover is unavailable.", "PROVIDER_UNAVAILABLE");
    }
    const mime = text(response.headers.get("content-type")).split(";")[0];
    if (!mime.startsWith("image/")) {
      throw jsonError("Metron returned an invalid cover.", "PROVIDER_INVALID_RESPONSE");
    }
    const contentLength = integerValue(response.headers.get("content-length"));
    if (contentLength !== null && contentLength > MAX_COVER_BYTES) {
      throw jsonError("The Metron cover is too large.", "PROVIDER_INVALID_RESPONSE");
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_COVER_BYTES) {
      throw jsonError("The Metron cover is too large.", "PROVIDER_INVALID_RESPONSE");
    }
    const value = { buffer, mime };
    this.coverCache.set(memoryKey, {
      value,
      expiresAt: Date.now() + 30 * 60 * 1000
    });
    if (this.coverCache.size > 25) {
      this.coverCache.delete(this.coverCache.keys().next().value);
    }
    return value;
  }
}

module.exports = {
  ATTRIBUTION,
  EDITION_TYPES,
  ENRICHMENT_SCHEMA_VERSION,
  MetadataEnrichmentStore,
  mergeMetadata,
  normalizeMetronIssue,
  normalizeMetronSeriesSummary,
  normalizedQuery,
  publicRecord
};
