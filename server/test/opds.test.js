"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { URL } = require("node:url");
const { createOpdsCatalog } = require("../src/opds");

const PSE_NS = "http://vaemendis.net/opds-pse/ns";
const PSE_REL = "http://vaemendis.net/opds-pse/stream";

function comic(id, extra = {}) {
  return {
    id,
    title: extra.title || `Issue ${id}`,
    series: "A Series",
    relativePath: extra.relativePath || `${id}.cbz`,
    sourceId: "src_1",
    sourceName: "DC",
    modifiedAt: "2026-08-30T12:00:00.000Z",
    format: extra.format || "cbz",
    available: true,
    metadata: {},
    pageCount: extra.pageCount === undefined ? 24 : extra.pageCount
  };
}

// The catalogue is handed a reader profile rather than working one out: which
// shelf an OPDS request is looking at is decided at the request, from the Basic
// username or the paired device. This stand-in asserts it arrives.
function library(comics, progress = {}) {
  return {
    listComics: () => comics,
    publicComic: (item) => item,
    getProgress: (readerProfileId, id) => {
      assert.equal(readerProfileId, READER, "the catalogue names a reader");
      return progress[id] || null;
    }
  };
}

function feed(comics, progress = {}, path = "/opds/all") {
  const base = "http://nas:8251";
  const result = createOpdsCatalog(
    library(comics, progress),
    new URL(`${base}${path}`),
    base,
    READER
  );
  return result.body;
}

const READER = "default";
const ID = "a".repeat(24);

test("the catalogue declares the page streaming namespace", () => {
  // Without the declaration the pse: attributes are not namespaced, and a
  // reader is entitled to ignore them.
  assert.match(feed([comic(ID)]), new RegExp(`xmlns:pse="${PSE_NS}"`));
});

test("an entry says how many pages it has", () => {
  assert.match(feed([comic(ID, { pageCount: 24 })]), /pse:count="24"/);
});

test("the stream link is a template the reader fills in", () => {
  // `{pageNumber}` is left in the href on purpose: the client substitutes it.
  // Escaping or resolving it here would hand out a link to one fixed page.
  const body = feed([comic(ID)]);
  assert.match(body, new RegExp(`rel="${PSE_REL}"`));
  assert.match(body, /href="[^"]*\/opds\/comics\/a{24}\/pages\/\{pageNumber\}"/);
});

test("a comic nobody has opened advertises no position", () => {
  const body = feed([comic(ID)]);
  assert.equal(/pse:lastRead=/.test(body), false);
});

test("a comic with a reading position says where to resume", () => {
  // PanelShelf keeps reading position on the server and shares it, so a reader
  // that understands the extension opens where the browser left off. Positions
  // are stored zero-based and the extension counts from one.
  const body = feed([comic(ID)], {
    [ID]: { pageIndex: 8, pageCount: 24, lastReadAt: "2026-08-30T10:00:00.000Z" }
  });

  assert.match(body, /pse:lastRead="9"/);
  assert.match(body, /pse:lastReadDate="2026-08-30T10:00:00.000Z"/);
});

test("a comic whose page count is unknown advertises no stream link", () => {
  // A reader told to stream a comic of unknown length has nothing to page
  // through. The download link is still there, which is the honest fallback.
  const body = feed([comic(ID, { pageCount: null })]);

  assert.equal(new RegExp(`rel="${PSE_REL}"`).test(body), false);
  assert.match(body, /acquisition\/open-access/);
});

test("the download link survives alongside the stream link", () => {
  // Not every reader understands the extension, and the ones that do not must
  // still be able to fetch the archive.
  const body = feed([comic(ID)]);
  assert.match(body, /acquisition\/open-access/);
  assert.match(body, new RegExp(`rel="${PSE_REL}"`));
});
