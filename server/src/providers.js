"use strict";

const { decodeXmlEntities } = require("./metadata");
const { jsonError } = require("./util");

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_JSON_BYTES = 5 * 1024 * 1024;

const GCD_ID = "gcd";
const OPEN_LIBRARY_ID = "openlibrary";

const ATTRIBUTIONS = Object.freeze({
  gcd: Object.freeze({
    provider: GCD_ID,
    name: "Grand Comics Database",
    url: "https://www.comics.org/",
    notice: "Metadata from the Grand Comics Database",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/"
  }),
  openlibrary: Object.freeze({
    provider: OPEN_LIBRARY_ID,
    name: "Open Library",
    url: "https://openlibrary.org/",
    notice: "Book metadata from Open Library"
  })
});

const COLLECTED_EDITIONS = new Set([
  "trade-paperback",
  "hardcover",
  "omnibus",
  "graphic-novel"
]);

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

function integerValue(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateParts(...candidates) {
  for (const candidate of candidates) {
    const value = text(candidate);
    const match = value.match(/(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
    if (!match) continue;
    return {
      year: Number(match[1]),
      ...(match[2] ? { month: Number(match[2]) } : {}),
      ...(match[3] ? { day: Number(match[3]) } : {})
    };
  }
  return {};
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

function unique(values) {
  return [
    ...new Set(
      values
        .map((value) => text(value))
        .filter((value) => value && value !== "?" && value !== "None")
    )
  ];
}

function objectName(value) {
  if (typeof value === "string") return text(value);
  if (!value || typeof value !== "object") return "";
  return text(value.name || value.value || value.label);
}

function isCollectedEdition(query) {
  return COLLECTED_EDITIONS.has(query.edition);
}

function editionLabel(edition) {
  return (
    {
      "trade-paperback": "Trade paperback",
      hardcover: "Hardcover",
      omnibus: "Omnibus",
      "graphic-novel": "Graphic novel",
      "single-issue": "Single issue"
    }[edition] || "Auto"
  );
}

function parseRetryAt(response) {
  const value = text(response.headers.get("retry-after"));
  if (!value) return null;
  const seconds = integerValue(value);
  if (seconds !== null) {
    return new Date(Date.now() + seconds * 1000).toISOString();
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

async function fetchJson(options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await options.fetchImpl(options.url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "PanelShelf/0.4.1",
        ...(options.headers || {})
      },
      redirect: "error",
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw jsonError(
        `${options.name} did not respond before the request timed out.`,
        "PROVIDER_UNAVAILABLE"
      );
    }
    throw jsonError(
      `PanelShelf could not reach ${options.name}. Your local library is still available.`,
      "PROVIDER_UNAVAILABLE"
    );
  } finally {
    clearTimeout(timeout);
  }

  if (options.onResponse) await options.onResponse(response);
  if (response.status === 401) {
    throw jsonError(
      `${options.name} rejected the saved credential.`,
      "PROVIDER_AUTH_FAILED"
    );
  }
  if (response.status === 403) {
    throw jsonError(
      `${options.name} denied this request.`,
      "PROVIDER_PERMISSION_REQUIRED"
    );
  }
  if (response.status === 429) {
    const retryAt = parseRetryAt(response);
    throw jsonError(
      retryAt
        ? `${options.name}'s request limit resets at ${retryAt}.`
        : `${options.name}'s request limit has been reached. Try again later.`,
      "PROVIDER_RATE_LIMITED",
      retryAt ? { retryAt } : undefined
    );
  }
  if (response.status === 404) {
    throw jsonError(
      `${options.name} record not found.`,
      "PROVIDER_RECORD_NOT_FOUND"
    );
  }
  if (!response.ok) {
    throw jsonError(
      response.status >= 500
        ? `${options.name} is temporarily unavailable.`
        : `${options.name} could not process this request.`,
      response.status >= 500
        ? "PROVIDER_UNAVAILABLE"
        : "PROVIDER_INVALID_REQUEST"
    );
  }

  const contentLength = integerValue(response.headers.get("content-length"));
  if (contentLength !== null && contentLength > MAX_JSON_BYTES) {
    throw jsonError(
      `${options.name} returned an unexpectedly large response.`,
      "PROVIDER_INVALID_RESPONSE"
    );
  }
  const body = await response.text();
  if (Buffer.byteLength(body) > MAX_JSON_BYTES) {
    throw jsonError(
      `${options.name} returned an unexpectedly large response.`,
      "PROVIDER_INVALID_RESPONSE"
    );
  }
  try {
    return JSON.parse(body);
  } catch {
    throw jsonError(
      `${options.name} returned invalid JSON.`,
      "PROVIDER_INVALID_RESPONSE"
    );
  }
}

function numericIdFromUrl(value) {
  const match = text(value).match(/\/(\d+)\/?$/);
  return match?.[1] || "";
}

function gcdSeriesIsCollected(series) {
  return /collected|trade paperback|hardcover|omnibus|graphic novel/i.test(
    `${text(series?.publishing_format)} ${text(series?.binding)}`
  );
}

function gcdDescriptorParts(descriptor) {
  const value = text(descriptor);
  const match = value.match(/^([^\s-]+)(?:\s+-\s+(.+))?$/);
  return {
    number: text(match?.[1] || value.split(/\s|\[/)[0]),
    title: text(match?.[2] || "")
  };
}

function gcdSearchRecord(series, issueUrl, descriptor, query) {
  const recordId = numericIdFromUrl(issueUrl);
  if (!recordId) return null;
  const parts = gcdDescriptorParts(descriptor);
  const collected = gcdSeriesIsCollected(series);
  const metadata = { source: GCD_ID };
  assign(metadata, "title", parts.title);
  assign(metadata, "series", text(series.name));
  if (collected) {
    assign(metadata, "volume", integerValue(parts.number));
  } else {
    assign(metadata, "number", parts.number);
  }
  assign(metadata, "year", integerValue(series.year_began));
  assign(metadata, "format", text(series.publishing_format || series.binding));

  return {
    provider: GCD_ID,
    providerLabel: "GCD",
    recordId,
    displayName: [text(series.name), text(descriptor)]
      .filter(Boolean)
      .join(" "),
    series: text(series.name),
    number: parts.number,
    title: parts.title,
    year: integerValue(series.year_began),
    volume: collected ? integerValue(parts.number) : null,
    seriesYearBegan: integerValue(series.year_began),
    publisher: "",
    editionType: text(series.publishing_format || series.binding),
    coverDate: "",
    storeDate: "",
    coverUrl: "",
    sourceUrl: `https://www.comics.org/issue/${recordId}/`,
    metadata,
    attribution: { ...ATTRIBUTIONS.gcd },
    searchContext: {
      seriesApiUrl: text(series.api_url),
      edition: query.edition
    }
  };
}

function creditNames(value) {
  const source = Array.isArray(value)
    ? value.map((entry) => objectName(entry)).join("; ")
    : typeof value === "object"
      ? objectName(value)
      : text(value);
  return unique(
    source
      .split(/\s*;\s*/)
      .map((name) =>
        name
          .replace(/\s+\((?:credited|uncredited)[^)]*\)/gi, "")
          .replace(/\s+\[as [^\]]+\]/gi, "")
          .trim()
      )
  );
}

function normalizeGcdCreators(stories) {
  const creators = {};
  const mappings = [
    ["writers", "script"],
    ["pencillers", "pencils"],
    ["inkers", "inks"],
    ["colorists", "colors"],
    ["letterers", "letters"],
    ["editors", "editing"]
  ];
  for (const [target, source] of mappings) {
    const values = unique(
      (Array.isArray(stories) ? stories : []).flatMap((story) =>
        creditNames(story?.[source])
      )
    );
    if (values.length > 0) creators[target] = values;
  }
  return creators;
}

function normalizeGcdIssue(raw, series = {}, cached = null) {
  if (!raw || typeof raw !== "object") {
    throw jsonError(
      "GCD returned an invalid issue record.",
      "PROVIDER_INVALID_RESPONSE"
    );
  }
  const recordId = numericIdFromUrl(raw.api_url) || text(raw.id);
  if (!/^\d+$/.test(recordId)) {
    throw jsonError(
      "GCD returned an issue without a stable record ID.",
      "PROVIDER_INVALID_RESPONSE"
    );
  }
  const stories = Array.isArray(raw.story_set) ? raw.story_set : [];
  const seriesName = text(raw.series_name)
    .replace(/\s+\(\d{4}\s+series\)\s*$/i, "")
    .trim();
  const collected =
    gcdSeriesIsCollected(series) ||
    isCollectedEdition({ edition: cached?.searchContext?.edition });
  const date = dateParts(raw.key_date, raw.on_sale_date, raw.publication_date);
  const creators = normalizeGcdCreators(stories);
  const synopsis = stories.map((story) => plainText(story.synopsis)).find(Boolean);
  const publisher = objectName(
    raw.indicia_publisher || raw.publisher || raw.brand
  );
  const metadata = { source: GCD_ID };
  assign(metadata, "title", text(raw.title));
  assign(metadata, "series", seriesName || text(series.name));
  if (collected) {
    assign(metadata, "volume", integerValue(raw.volume || raw.number));
  } else {
    assign(metadata, "number", text(raw.number));
    assign(metadata, "volume", integerValue(raw.volume));
  }
  assign(metadata, "year", date.year);
  assign(metadata, "month", date.month);
  assign(metadata, "day", date.day);
  assign(metadata, "publisher", publisher);
  assign(metadata, "summary", synopsis);
  assign(metadata, "format", text(series.publishing_format || series.binding));
  assign(metadata, "ageRating", text(raw.rating));
  assign(metadata, "pageCount", numberValue(raw.page_count));
  assign(metadata, "creators", creators);
  assign(
    metadata,
    "genres",
    unique(stories.map((story) => story.genre))
  );
  assign(
    metadata,
    "characters",
    unique(
      stories.flatMap((story) => text(story.characters).split(/\s*;\s*/))
    )
  );
  assign(metadata, "isbn", text(raw.isbn));
  assign(metadata, "barcode", text(raw.barcode));

  return {
    provider: GCD_ID,
    providerLabel: "GCD",
    recordId,
    displayName:
      [seriesName || text(series.name), text(raw.descriptor)]
        .filter(Boolean)
        .join(" ") || `GCD issue ${recordId}`,
    series: seriesName || text(series.name),
    number: text(raw.number),
    title: text(raw.title),
    year: date.year || null,
    volume: integerValue(raw.volume),
    seriesYearBegan: integerValue(series.year_began),
    publisher,
    editionType: text(series.publishing_format || series.binding),
    coverDate: text(raw.publication_date),
    storeDate: text(raw.on_sale_date),
    coverUrl: "",
    sourceUrl: `https://www.comics.org/issue/${recordId}/`,
    metadata,
    attribution: { ...ATTRIBUTIONS.gcd }
  };
}

class GcdProvider {
  constructor(options) {
    this.fetchImpl = options.fetchImpl || global.fetch;
    this.getSettings = options.getSettings;
    this.updateProviderState = options.updateProviderState;
  }

  assertReady() {
    if (!this.getSettings()?.enabled) {
      throw jsonError("GCD matching is disabled.", "METADATA_NOT_CONFIGURED");
    }
  }

  async requestJson(endpoint) {
    this.assertReady();
    const url = new URL(endpoint, "https://www.comics.org");
    if (url.origin !== "https://www.comics.org") {
      throw jsonError("Invalid GCD endpoint.", "INVALID_PROVIDER");
    }
    return fetchJson({
      fetchImpl: this.fetchImpl,
      url,
      name: "GCD",
      onResponse: async (response) => {
        await this.updateProviderState({
          lastRequestAt: new Date().toISOString(),
          ...(response.status === 429
            ? { retryAt: parseRetryAt(response) }
            : {})
        });
      }
    });
  }

  async seriesSearch(query, useYear) {
    const seriesName = encodeURIComponent(query.series);
    const year =
      useYear && query.year ? `/year/${encodeURIComponent(query.year)}` : "";
    return this.requestJson(`/api/series/name/${seriesName}${year}/`);
  }

  async search(query) {
    let payload = await this.seriesSearch(query, Boolean(query.year));
    if (
      query.year &&
      (!Array.isArray(payload?.results) || payload.results.length === 0)
    ) {
      payload = await this.seriesSearch(query, false);
    }
    const collected = isCollectedEdition(query);
    const records = [];
    for (const series of Array.isArray(payload?.results)
      ? payload.results
      : []) {
      if (collected !== gcdSeriesIsCollected(series)) continue;
      const urls = Array.isArray(series.active_issues)
        ? series.active_issues
        : [];
      const descriptors = Array.isArray(series.issue_descriptors)
        ? series.issue_descriptors
        : [];
      for (let index = 0; index < urls.length; index += 1) {
        const record = gcdSearchRecord(
          series,
          urls[index],
          descriptors[index],
          query
        );
        if (!record) continue;
        if (
          query.number &&
          text(record.number).replace(/^0+(?=\d)/, "") !==
            text(query.number).replace(/^0+(?=\d)/, "")
        ) {
          continue;
        }
        records.push(record);
        if (records.length >= 40) break;
      }
      if (records.length >= 40) break;
    }
    return {
      records,
      searchInfo: {
        mode: "gcd-series",
        edition: query.edition,
        editionLabel: editionLabel(query.edition),
        seriesMatches: Array.isArray(payload?.results)
          ? payload.results.length
          : 0
      }
    };
  }

  async issue(recordId, cached = null) {
    const id = text(recordId);
    if (!/^\d+$/.test(id)) {
      throw jsonError("Invalid GCD issue ID.", "INVALID_PROVIDER_RECORD");
    }
    const raw = await this.requestJson(`/api/issue/${id}/`);
  const seriesId =
    numericIdFromUrl(raw?.series) ||
    numericIdFromUrl(cached?.searchContext?.seriesApiUrl);
    const series = seriesId
      ? await this.requestJson(`/api/series/${seriesId}/`)
      : {};
    return normalizeGcdIssue(raw, series, cached);
  }
}

function openLibraryRecord(doc, edition, query) {
  const key = text(edition?.key || doc?.key);
  const recordId = key.split("/").filter(Boolean).at(-1) || "";
  if (!/^OL\d+[MW]$/i.test(recordId)) return null;
  const title = text(edition?.title || doc?.title);
  const subtitle = text(edition?.subtitle || doc?.subtitle);
  const year = dateParts(
    Array.isArray(edition?.publish_date)
      ? edition.publish_date[0]
      : edition?.publish_date,
    doc?.first_publish_year,
    Array.isArray(doc?.publish_year) ? doc.publish_year[0] : doc?.publish_year
  ).year;
  const publisher = text(
    (Array.isArray(edition?.publisher)
      ? edition.publisher[0]
      : edition?.publisher) ||
      (Array.isArray(doc?.publisher) ? doc.publisher[0] : doc?.publisher)
  );
  const authors = unique(Array.isArray(doc?.author_name) ? doc.author_name : []);
  const isbn = unique([
    ...(Array.isArray(edition?.isbn) ? edition.isbn : []),
    ...(Array.isArray(doc?.isbn) ? doc.isbn : [])
  ]);
  const metadata = { source: OPEN_LIBRARY_ID };
  assign(metadata, "title", subtitle || title);
  assign(metadata, "series", title || query.series);
  assign(metadata, "volume", integerValue(query.number));
  assign(metadata, "year", year);
  assign(metadata, "publisher", publisher);
  assign(metadata, "format", editionLabel(query.edition));
  assign(metadata, "pageCount", integerValue(doc?.number_of_pages_median));
  assign(metadata, "creators", authors.length ? { writers: authors } : {});
  assign(metadata, "genres", unique(Array.isArray(doc?.subject) ? doc.subject : []));
  assign(metadata, "isbn", isbn);

  return {
    provider: OPEN_LIBRARY_ID,
    providerLabel: "Open Library",
    recordId,
    displayName: [title, subtitle].filter(Boolean).join(": "),
    series: title || query.series,
    number: text(query.number),
    title: subtitle || title,
    year: year || null,
    volume: integerValue(query.number),
    seriesYearBegan: integerValue(doc?.first_publish_year),
    publisher,
    editionType: editionLabel(query.edition),
    coverDate: text(
      Array.isArray(edition?.publish_date)
        ? edition.publish_date[0]
        : edition?.publish_date
    ),
    storeDate: "",
    coverUrl: "",
    sourceUrl: `https://openlibrary.org${key.startsWith("/") ? key : `/${key}`}`,
    metadata,
    attribution: { ...ATTRIBUTIONS.openlibrary }
  };
}

class OpenLibraryProvider {
  constructor(options) {
    this.fetchImpl = options.fetchImpl || global.fetch;
    this.getSettings = options.getSettings;
    this.updateProviderState = options.updateProviderState;
  }

  assertReady() {
    if (!this.getSettings()?.enabled) {
      throw jsonError(
        "Open Library matching is disabled.",
        "METADATA_NOT_CONFIGURED"
      );
    }
  }

  async requestJson(endpoint, query = null) {
    this.assertReady();
    const url = new URL(endpoint, "https://openlibrary.org");
    if (url.origin !== "https://openlibrary.org") {
      throw jsonError("Invalid Open Library endpoint.", "INVALID_PROVIDER");
    }
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== null && value !== undefined && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
    return fetchJson({
      fetchImpl: this.fetchImpl,
      url,
      name: "Open Library",
      headers: {
        "User-Agent": "PanelShelf/0.4.1 (local Synology metadata lookup)"
      },
      onResponse: async () => {
        await this.updateProviderState({
          lastRequestAt: new Date().toISOString()
        });
      }
    });
  }

  async search(query) {
    if (!isCollectedEdition(query)) {
      return {
        records: [],
        searchInfo: {
          mode: "openlibrary-books",
          skipped: "Open Library is used only for collected editions."
        }
      };
    }
    const terms = [query.series, query.title].filter(Boolean).join(" ");
    const payload = await this.requestJson("/search.json", {
      q: terms,
      fields:
        "key,title,subtitle,author_name,first_publish_year,publish_year,publisher,isbn,number_of_pages_median,subject,editions,editions.key,editions.title,editions.subtitle,editions.publish_date,editions.publisher,editions.isbn",
      limit: 10
    });
    const records = [];
    for (const doc of Array.isArray(payload?.docs) ? payload.docs : []) {
      const editions = Array.isArray(doc?.editions?.docs)
        ? doc.editions.docs
        : [null];
      for (const edition of editions) {
        const record = openLibraryRecord(doc, edition, query);
        if (record) records.push(record);
      }
    }
    return {
      records: records.slice(0, 20),
      searchInfo: {
        mode: "openlibrary-books",
        edition: query.edition,
        editionLabel: editionLabel(query.edition),
        workMatches: integerValue(payload?.numFound ?? payload?.num_found) || 0
      }
    };
  }

  async issue(recordId, cached = null) {
    if (cached) return cached;
    const id = text(recordId);
    if (!/^OL\d+[MW]$/i.test(id)) {
      throw jsonError(
        "Invalid Open Library record ID.",
        "INVALID_PROVIDER_RECORD"
      );
    }
    const raw = await this.requestJson(
      id.toUpperCase().endsWith("M")
        ? `/books/${id}.json`
        : `/works/${id}.json`
    );
    const title = text(raw.title);
    const subtitle = text(raw.subtitle);
    const metadata = { source: OPEN_LIBRARY_ID };
    assign(metadata, "title", subtitle || title);
    assign(metadata, "series", title);
    assign(metadata, "publisher", text(raw.publishers?.[0]));
    assign(metadata, "year", dateParts(raw.publish_date).year);
    assign(metadata, "pageCount", integerValue(raw.number_of_pages));
    assign(metadata, "isbn", unique([...(raw.isbn_13 || []), ...(raw.isbn_10 || [])]));
    return {
      provider: OPEN_LIBRARY_ID,
      providerLabel: "Open Library",
      recordId: id,
      displayName: [title, subtitle].filter(Boolean).join(": "),
      series: title,
      number: "",
      title: subtitle || title,
      year: dateParts(raw.publish_date).year || null,
      volume: null,
      seriesYearBegan: null,
      publisher: text(raw.publishers?.[0]),
      editionType: "Collected edition",
      coverDate: text(raw.publish_date),
      storeDate: "",
      coverUrl: "",
      sourceUrl: `https://openlibrary.org/${id.endsWith("M") ? "books" : "works"}/${id}`,
      metadata,
      attribution: { ...ATTRIBUTIONS.openlibrary }
    };
  }
}

module.exports = {
  ATTRIBUTIONS,
  COLLECTED_EDITIONS,
  GCD_ID,
  GcdProvider,
  OPEN_LIBRARY_ID,
  OpenLibraryProvider,
  editionLabel,
  isCollectedEdition,
  normalizeGcdIssue,
  openLibraryRecord
};
