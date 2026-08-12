"use strict";

const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  MetadataEnrichmentStore,
  mergeMetadata,
  normalizeMetronIssue,
  normalizedQuery
} = require("../src/enrichment");

function jsonResponse(value, options = {}) {
  return new Response(JSON.stringify(value), {
    status: options.status || 200,
    headers: {
      "content-type": "application/json",
      "x-ratelimit-burst-limit": "20",
      "x-ratelimit-burst-remaining": "18",
      "x-ratelimit-sustained-limit": "5000",
      "x-ratelimit-sustained-remaining": "4998",
      ...options.headers
    }
  });
}

test("Metron records normalize into PanelShelf metadata", () => {
  const record = normalizeMetronIssue({
    id: 42,
    issue: "Bellatrix (2023) #3",
    series: {
      name: "Bellatrix",
      volume: 1,
      year_began: 2023,
      series_type: { id: 3, name: "Trade Paperback" },
      publisher: { name: "Dargaud" }
    },
    number: "3",
    title: "The Frozen Moon",
    cover_date: "2025-03-01",
    image: "https://static.metron.cloud/media/issue/bellatrix.jpg",
    desc: "<p>A dangerous &amp; frozen moon.</p>",
    credits: [
      { creator: "LEO", roles: ["Writer"] },
      { creator: { name: "Louis Alloing" }, role: "Penciller" }
    ],
    arcs: [{ name: "Bellatrix Cycle" }]
  });

  assert.equal(record.recordId, "42");
  assert.equal(record.metadata.title, "The Frozen Moon");
  assert.equal(record.metadata.series, "Bellatrix");
  assert.equal(record.metadata.number, "3");
  assert.equal(record.metadata.year, 2025);
  assert.equal(record.metadata.publisher, "Dargaud");
  assert.equal(record.metadata.format, "Trade Paperback");
  assert.equal(record.editionType, "Trade Paperback");
  assert.equal(record.metadata.summary, "A dangerous & frozen moon.");
  assert.deepEqual(record.metadata.creators.writers, ["LEO"]);
  assert.deepEqual(record.metadata.creators.pencillers, ["Louis Alloing"]);
  assert.equal(record.metadata.storyArc, "Bellatrix Cycle");
});

test("Metron searches are private, cached, rate-aware, and explicitly confirmed", async (t) => {
  const dataDirectory = await fsp.mkdtemp(
    path.join(os.tmpdir(), "panelshelf-enrichment-")
  );
  t.after(() => fsp.rm(dataDirectory, { recursive: true, force: true }));

  const calls = [];
  const issue = {
    id: 42,
    issue: "Bellatrix (2023) #3",
    series: {
      name: "Bellatrix",
      volume: 1,
      year_began: 2023,
      publisher: { name: "Dargaud" }
    },
    number: "3",
    title: "The Frozen Moon",
    cover_date: "2025-03-01",
    image: "https://static.metron.cloud/media/issue/bellatrix.jpg",
    desc: "A dangerous frozen moon.",
    credits: [{ creator: "LEO", roles: ["Writer"] }]
  };
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    calls.push({
      url: parsed,
      authorization: options.headers?.Authorization || ""
    });
    if (parsed.hostname === "static.metron.cloud") {
      return new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
        status: 200,
        headers: { "content-type": "image/jpeg", "content-length": "4" }
      });
    }
    if (parsed.pathname === "/api/issue/") {
      return jsonResponse({ count: 1, next: null, results: [issue] });
    }
    if (parsed.pathname === "/api/issue/42/") {
      return jsonResponse(issue);
    }
    return jsonResponse({}, { status: 404 });
  };

  const store = new MetadataEnrichmentStore(dataDirectory, { fetchImpl });
  await store.initialize();
  const settings = await store.saveSettings({
    enabled: true,
    permissionConfirmed: true,
    token: "metron-secret-token"
  });
  assert.equal(settings.provider.configured, true);
  assert.equal(settings.provider.tokenHint, "••••oken");
  assert.doesNotMatch(JSON.stringify(settings), /metron-secret-token/);

  const first = await store.search({
    provider: "metron",
    series: "Bellatrix",
    number: "3",
    year: 2025,
    publisher: "Dargaud"
  });
  assert.equal(first.cached, false);
  assert.equal(first.candidates.length, 1);
  assert.equal(first.candidates[0].recordId, "42");
  assert.equal(first.candidates[0].hasCover, true);
  assert.equal(first.candidates[0].coverUrl, undefined);
  assert.equal(calls[0].authorization, "Bearer metron-secret-token");
  assert.equal(calls[0].url.searchParams.get("series_name"), "Bellatrix");
  assert.equal(calls[0].url.searchParams.get("number"), "3");
  assert.equal(calls[0].url.searchParams.get("series_year_began"), "2025");
  assert.equal(calls[0].url.searchParams.get("publisher_name"), "Dargaud");

  const second = await store.search({
    provider: "metron",
    series: "Bellatrix",
    number: "3",
    year: 2025,
    publisher: "Dargaud"
  });
  assert.equal(second.cached, true);
  assert.equal(calls.length, 1);
  assert.equal(store.settings().rateLimit.burst.remaining, 18);

  const review = await store.review("42");
  assert.equal(review.record.metadata.summary, "A dangerous frozen moon.");
  assert.equal(calls.length, 2);

  const match = await store.confirm("comic-1", "42");
  assert.equal(match.recordId, "42");
  assert.equal(calls.length, 2);
  assert.equal(store.publicMatch("comic-1").record.coverUrl, undefined);

  const merged = mergeMetadata(match.record.metadata, {
    source: "comicinfo",
    title: "Local title",
    creators: { writers: ["Local Writer"] }
  });
  assert.equal(merged.title, "Local title");
  assert.equal(merged.series, "Bellatrix");
  assert.deepEqual(merged.creators.writers, ["Local Writer"]);

  const cover = await store.cover("42");
  assert.equal(cover.mime, "image/jpeg");
  assert.equal(cover.buffer.length, 4);
  assert.equal(calls.length, 3);

  const reloaded = new MetadataEnrichmentStore(dataDirectory, { fetchImpl });
  await reloaded.initialize();
  assert.equal(reloaded.settings().provider.configured, true);
  assert.equal(reloaded.publicMatch("comic-1").recordId, "42");
});

test("collected editions search Metron by series type before volume", async (t) => {
  const dataDirectory = await fsp.mkdtemp(
    path.join(os.tmpdir(), "panelshelf-collected-enrichment-")
  );
  t.after(() => fsp.rm(dataDirectory, { recursive: true, force: true }));

  const calls = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    calls.push(parsed);
    if (parsed.pathname === "/api/series/") {
      return jsonResponse({
        count: 1,
        next: null,
        results: [
          {
            id: 77,
            series: "Avengers Arena TPB (2013)",
            year_began: 2013,
            volume: 1,
            issue_count: 3
          }
        ]
      });
    }
    if (parsed.pathname === "/api/issue/") {
      return jsonResponse({
        count: 1,
        next: null,
        results: [
          {
            id: 701,
            issue: "Avengers Arena TPB (2013) #1",
            series: {
              id: 77,
              name: "Avengers Arena",
              volume: 1,
              year_began: 2013,
              series_type: { id: 8, name: "Trade Paperback" },
              publisher: { name: "Marvel" }
            },
            number: "1",
            title: "Kill or Die",
            cover_date: "2013-07-01"
          }
        ]
      });
    }
    return jsonResponse({}, { status: 404 });
  };

  const store = new MetadataEnrichmentStore(dataDirectory, { fetchImpl });
  await store.initialize();
  await store.saveSettings({
    enabled: true,
    permissionConfirmed: true,
    token: "collected-test-token"
  });

  const result = await store.search({
    provider: "metron",
    series: "Avengers Arena TPB",
    number: "1",
    edition: "auto"
  });
  assert.equal(result.cached, false);
  assert.equal(result.query.series, "Avengers Arena");
  assert.equal(result.query.edition, "trade-paperback");
  assert.equal(result.searchInfo.mode, "collected-series");
  assert.equal(result.searchInfo.seriesMatches, 1);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].recordId, "701");
  assert.equal(result.candidates[0].metadata.format, "Trade Paperback");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].pathname, "/api/series/");
  assert.equal(calls[0].searchParams.get("name"), "Avengers Arena");
  assert.equal(
    calls[0].searchParams.get("series_type"),
    "Trade Paperback"
  );
  assert.equal(calls[1].pathname, "/api/issue/");
  assert.equal(calls[1].searchParams.get("series_id"), "77");
  assert.equal(calls[1].searchParams.get("number"), "1");

  const cached = await store.search({
    provider: "metron",
    series: "Avengers Arena",
    number: "1",
    edition: "trade-paperback"
  });
  assert.equal(cached.cached, true);
  assert.equal(calls.length, 2);
});

test("metadata search rejects unsupported edition types", () => {
  assert.throws(
    () => normalizedQuery({ series: "Avengers Arena", edition: "random" }),
    (error) => error.code === "INVALID_METADATA_QUERY"
  );
});

test("online metadata cannot be enabled without a token and permission confirmation", async (t) => {
  const dataDirectory = await fsp.mkdtemp(
    path.join(os.tmpdir(), "panelshelf-enrichment-settings-")
  );
  t.after(() => fsp.rm(dataDirectory, { recursive: true, force: true }));
  const store = new MetadataEnrichmentStore(dataDirectory, {
    fetchImpl: async () => {
      throw new Error("network should not be used");
    }
  });
  await store.initialize();
  await assert.rejects(
    store.saveSettings({ enabled: true, permissionConfirmed: true }),
    (error) => error.code === "METADATA_NOT_CONFIGURED"
  );
  await assert.rejects(
    store.saveSettings({
      enabled: true,
      permissionConfirmed: false,
      token: "token"
    }),
    (error) => error.code === "PROVIDER_PERMISSION_REQUIRED"
  );
});

test("smart matching finds an exact GCD trade before using a fallback", async (t) => {
  const dataDirectory = await fsp.mkdtemp(
    path.join(os.tmpdir(), "panelshelf-gcd-trade-")
  );
  t.after(() => fsp.rm(dataDirectory, { recursive: true, force: true }));
  const calls = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    calls.push(parsed);
    if (parsed.pathname.startsWith("/api/series/name/")) {
      return jsonResponse({
        results: [
          {
            api_url: "https://www.comics.org/api/series/100/",
            name: "Avengers Arena",
            year_began: 2013,
            publishing_format: "ongoing series",
            binding: "saddle-stitched",
            active_issues: ["https://www.comics.org/api/issue/900/"],
            issue_descriptors: ["1"]
          },
          {
            api_url: "https://www.comics.org/api/series/123/",
            name: "Avengers Arena",
            year_began: 2013,
            publishing_format: "collected edition",
            binding: "trade paperback",
            active_issues: ["https://www.comics.org/api/issue/1111044/"],
            issue_descriptors: ["1 - Kill or Die"]
          }
        ]
      });
    }
    if (parsed.pathname === "/api/issue/1111044/") {
      return jsonResponse({
        id: 1111044,
        api_url: "https://www.comics.org/api/issue/1111044/",
        series: "https://www.comics.org/api/series/123/",
        series_name: "Avengers Arena (2013 series)",
        descriptor: "1 - Kill or Die",
        number: "1",
        volume: "1",
        title: "Kill or Die",
        key_date: "2013-07-01",
        indicia_publisher: "Marvel Worldwide, Inc.",
        isbn: "9780785162930",
        story_set: [
          {
            script: "Dennis Hopeless",
            pencils: "Kev Walker",
            synopsis: "Sixteen young heroes are forced into a deadly contest."
          }
        ]
      });
    }
    if (parsed.pathname === "/api/series/123/") {
      return jsonResponse({
        id: 123,
        api_url: "https://www.comics.org/api/series/123/",
        name: "Avengers Arena",
        year_began: 2013,
        publishing_format: "collected edition",
        binding: "trade paperback"
      });
    }
    throw new Error(`Unexpected request: ${parsed}`);
  };

  const store = new MetadataEnrichmentStore(dataDirectory, { fetchImpl });
  await store.initialize();
  const result = await store.search({
    provider: "smart",
    series: "Avengers Arena",
    title: "Kill or Die",
    number: "1",
    year: 2013,
    edition: "trade-paperback"
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].provider, "gcd");
  assert.equal(result.candidates[0].recordId, "1111044");
  assert.equal(result.candidates[0].confidence, "high");
  assert.equal(result.searchInfo.stoppedAfter, "gcd");
  assert.deepEqual(
    result.searchInfo.attempts.map((attempt) => attempt.provider),
    ["gcd"]
  );
  assert.equal(calls.length, 1);

  const review = await store.review("gcd", "1111044");
  assert.equal(review.record.metadata.title, "Kill or Die");
  assert.equal(review.record.metadata.publisher, "Marvel Worldwide, Inc.");
  assert.deepEqual(review.record.metadata.creators.writers, [
    "Dennis Hopeless"
  ]);
  assert.equal(review.record.hasCover, false);
  assert.equal(calls.length, 3);
});

test("smart matching uses GCD for a numbered single issue", async (t) => {
  const dataDirectory = await fsp.mkdtemp(
    path.join(os.tmpdir(), "panelshelf-gcd-single-")
  );
  t.after(() => fsp.rm(dataDirectory, { recursive: true, force: true }));
  const store = new MetadataEnrichmentStore(dataDirectory, {
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname.startsWith("/api/series/name/")) {
        return jsonResponse({
          results: [
            {
              api_url: "https://www.comics.org/api/series/500/",
              name: "Avengers Arena",
              year_began: 2013,
              publishing_format: "ongoing series",
              binding: "saddle-stitched",
              active_issues: [
                "https://www.comics.org/api/issue/501/",
                "https://www.comics.org/api/issue/502/"
              ],
              issue_descriptors: ["1", "2"]
            }
          ]
        });
      }
      throw new Error(`Unexpected request: ${parsed}`);
    }
  });
  await store.initialize();
  const result = await store.search({
    series: "Avengers Arena",
    number: "2",
    year: 2013,
    edition: "single-issue"
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].recordId, "502");
  assert.equal(result.candidates[0].metadata.number, "2");
});

test("smart matching falls back to Open Library for a collected edition", async (t) => {
  const dataDirectory = await fsp.mkdtemp(
    path.join(os.tmpdir(), "panelshelf-open-library-")
  );
  t.after(() => fsp.rm(dataDirectory, { recursive: true, force: true }));
  const hosts = [];
  const store = new MetadataEnrichmentStore(dataDirectory, {
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      hosts.push(parsed.hostname);
      if (parsed.hostname === "www.comics.org") {
        return jsonResponse({ results: [] });
      }
      if (parsed.hostname === "openlibrary.org") {
        return jsonResponse({
          numFound: 1,
          docs: [
            {
              key: "/works/OL19964679W",
              title: "Avengers Arena",
              subtitle: "Kill or Die",
              author_name: ["Dennis Hopeless", "Kev Walker"],
              first_publish_year: 2013,
              publisher: ["Marvel Worldwide"],
              isbn: ["9780785162930"],
              editions: {
                docs: [
                  {
                    key: "/books/OL27144898M",
                    title: "Avengers Arena",
                    subtitle: "Kill or Die",
                    publish_date: ["2013"],
                    publisher: ["Marvel Worldwide"],
                    isbn: ["9780785162930"]
                  }
                ]
              }
            }
          ]
        });
      }
      throw new Error(`Unexpected request: ${parsed}`);
    }
  });
  await store.initialize();
  const result = await store.search({
    series: "Avengers Arena",
    title: "Kill or Die",
    number: "1",
    year: 2013,
    edition: "trade-paperback"
  });
  assert.equal(result.candidates[0].provider, "openlibrary");
  assert.equal(result.candidates[0].recordId, "OL27144898M");
  assert.deepEqual(hosts, [
    "www.comics.org",
    "www.comics.org",
    "openlibrary.org"
  ]);
  assert.deepEqual(
    result.searchInfo.attempts.map((attempt) => attempt.provider),
    ["gcd", "openlibrary"]
  );
});

test("schema v1 Metron settings migrate without losing the saved token", async (t) => {
  const dataDirectory = await fsp.mkdtemp(
    path.join(os.tmpdir(), "panelshelf-enrichment-migration-")
  );
  t.after(() => fsp.rm(dataDirectory, { recursive: true, force: true }));
  await fsp.writeFile(
    path.join(dataDirectory, "online-metadata.json"),
    JSON.stringify({
      schemaVersion: 1,
      settings: {
        metron: {
          enabled: true,
          permissionConfirmed: true,
          token: "legacy-token"
        },
        comicvine: {
          enabled: true,
          permissionConfirmed: true,
          apiKey: "removed-provider-secret"
        }
      },
      providerState: {
        metron: { rateLimit: {} },
        comicvine: { lastRequestAt: "2026-01-01T00:00:00.000Z" }
      },
      cache: {
        "search:comicvine:old": {
          records: [{ provider: "comicvine", recordId: "1" }]
        }
      },
      matches: {
        "comic-1": { provider: "comicvine", recordId: "1" }
      }
    })
  );
  const store = new MetadataEnrichmentStore(dataDirectory, {
    fetchImpl: async () => {
      throw new Error("network should not be used");
    }
  });
  await store.initialize();
  assert.equal(store.data.schemaVersion, 3);
  assert.equal(store.data.settings.metron.token, "legacy-token");
  assert.equal(metadataProviderFrom(store, "metron").ready, true);
  assert.equal(metadataProviderFrom(store, "gcd").ready, true);
  assert.equal(metadataProviderFrom(store, "openlibrary").ready, true);
  assert.equal(metadataProviderFrom(store, "comicvine"), undefined);
  assert.doesNotMatch(JSON.stringify(store.settings()), /legacy-token/);
  assert.doesNotMatch(
    await fsp.readFile(path.join(dataDirectory, "online-metadata.json"), "utf8"),
    /removed-provider-secret|comicvine/
  );
});

function metadataProviderFrom(store, id) {
  return store.settings().providers.find((provider) => provider.id === id);
}
