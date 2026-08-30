"use strict";

const path = require("node:path");

const PAGE_SIZE = 100;
const NAVIGATION_TYPE =
  "application/atom+xml;profile=opds-catalog;kind=navigation";
const ACQUISITION_TYPE =
  "application/atom+xml;profile=opds-catalog;kind=acquisition";
const CATALOG_TYPE = "application/atom+xml;profile=opds-catalog";

function xml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function absolute(baseUrl, pathname) {
  return new URL(pathname, baseUrl)
    .toString()
    .replaceAll("%7B", "{")
    .replaceAll("%7D", "}");
}

function latestUpdate(comics) {
  const timestamps = comics
    .map((comic) => Date.parse(comic.modifiedAt || ""))
    .filter(Number.isFinite);
  return new Date(timestamps.length ? Math.max(...timestamps) : 0).toISOString();
}

function feedDocument({ id, title, updated, self, start, search, entries }) {
  const links = [
    `<link rel="self" href="${xml(self)}" type="${CATALOG_TYPE}"/>`,
    `<link rel="start" href="${xml(start)}" type="${NAVIGATION_TYPE}"/>`,
    search
      ? `<link rel="search" href="${xml(search)}" type="${ACQUISITION_TYPE}"/>`
      : ""
  ].filter(Boolean);
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom"',
    ' xmlns:dc="http://purl.org/dc/terms/"',
    ' xmlns:opds="http://opds-spec.org/2010/catalog"',
    // The Page Streaming Extension. A reader that understands it fetches one
    // page at a time instead of pulling a whole archive down to read the first
    // page of it, which is the difference between usable and not on a phone
    // network with a 400 MB collection.
    ' xmlns:pse="http://vaemendis.net/opds-pse/ns">',
    `<id>${xml(id)}</id>`,
    `<title>${xml(title)}</title>`,
    `<updated>${xml(updated)}</updated>`,
    '<author><name>PanelShelf</name><uri>https://panelshelf.local/</uri></author>',
    ...links,
    ...entries,
    "</feed>"
  ].join("\n");
}

function navigationEntry({ id, title, summary, href, updated }) {
  return [
    "<entry>",
    `<id>${xml(id)}</id>`,
    `<title>${xml(title)}</title>`,
    `<updated>${xml(updated)}</updated>`,
    summary ? `<summary>${xml(summary)}</summary>` : "",
    `<link rel="subsection" href="${xml(href)}" type="${CATALOG_TYPE}"/>`,
    "</entry>"
  ]
    .filter(Boolean)
    .join("\n");
}

function comicMime(comic) {
  return String(comic.format || "").toLowerCase() === "cbr"
    ? "application/vnd.comicbook-rar"
    : "application/vnd.comicbook+zip";
}

function comicEntry(comic, baseUrl, updated = null) {
  const metadata = comic.metadata || {};
  const issued = metadata.year
    ? `${metadata.year}${metadata.month ? `-${String(metadata.month).padStart(2, "0")}` : ""}`
    : "";
  const creators = Object.values(metadata.creators || {}).flat().filter(Boolean);
  const acquisition = absolute(baseUrl, `/opds/comics/${comic.id}/file`);
  const cover = absolute(baseUrl, `/api/comics/${comic.id}/cover`);
  const thumbnail = absolute(baseUrl, `/api/comics/${comic.id}/cover?size=thumb`);
  const summary = metadata.summary || comic.relativePath || "";

  // `{pageNumber}` stays in the href: the reader substitutes it. `absolute`
  // puts the braces back after URL encoding, the same as it does for the
  // search template.
  //
  // One-based, because the extension counts from one and PanelShelf's own page
  // route counts from zero. The translation lives in the OPDS route rather
  // than in either count, so neither has to bend to the other.
  const pageCount = Number(comic.pageCount) || 0;
  const stream = pageCount > 0
    ? absolute(baseUrl, `/opds/comics/${comic.id}/pages/{pageNumber}`)
    : null;
  const progress = comic.progress;
  const lastRead =
    progress && Number.isInteger(progress.pageIndex) && progress.pageIndex >= 0
      ? progress.pageIndex + 1
      : null;

  return [
    "<entry>",
    `<id>urn:panelshelf:comic:${xml(comic.id)}</id>`,
    `<title>${xml(comic.title)}</title>`,
    `<updated>${xml(updated || comic.modifiedAt || new Date(0).toISOString())}</updated>`,
    comic.series ? `<dc:series>${xml(comic.series)}</dc:series>` : "",
    issued ? `<dc:issued>${xml(issued)}</dc:issued>` : "",
    comic.publisher?.name
      ? `<dc:publisher>${xml(comic.publisher.name)}</dc:publisher>`
      : "",
    ...creators.map((creator) => `<dc:creator>${xml(creator)}</dc:creator>`),
    summary ? `<summary>${xml(summary)}</summary>` : "",
    `<link rel="http://opds-spec.org/image" href="${xml(cover)}"/>`,
    `<link rel="http://opds-spec.org/image/thumbnail" href="${xml(thumbnail)}"/>`,
    `<link rel="http://opds-spec.org/acquisition/open-access" href="${xml(
      acquisition
    )}" type="${comicMime(comic)}"/>`,
    // Advertised alongside the download rather than instead of it: a reader
    // that does not understand streaming must still be able to fetch the file.
    stream
      ? `<link rel="http://vaemendis.net/opds-pse/stream" href="${xml(stream)}" type="image/jpeg" pse:count="${pageCount}"${
          lastRead ? ` pse:lastRead="${lastRead}"` : ""
        }${
          lastRead && progress.lastReadAt
            ? ` pse:lastReadDate="${xml(progress.lastReadAt)}"`
            : ""
        }/>`
      : "",
    "</entry>"
  ]
    .filter(Boolean)
    .join("\n");
}

function paginate(comics, requestUrl, baseUrl) {
  const requested = Number(requestUrl.searchParams.get("page") || 1);
  const page = Number.isSafeInteger(requested) && requested > 0 ? requested : 1;
  const pageCount = Math.max(1, Math.ceil(comics.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const startIndex = (current - 1) * PAGE_SIZE;
  const links = [];
  for (const [rel, target] of [
    ["first", 1],
    ["previous", current > 1 ? current - 1 : null],
    ["next", current < pageCount ? current + 1 : null],
    ["last", pageCount]
  ]) {
    if (!target) continue;
    const url = new URL(requestUrl.pathname + requestUrl.search, baseUrl);
    url.searchParams.set("page", String(target));
    links.push(
      `<link rel="${rel}" href="${xml(url.toString())}" type="${ACQUISITION_TYPE}"/>`
    );
  }
  return {
    comics: comics.slice(startIndex, startIndex + PAGE_SIZE),
    links
  };
}

function acquisitionFeed({
  id,
  title,
  comics,
  requestUrl,
  baseUrl,
  preserveOrder = false
}) {
  const ordered = preserveOrder
    ? comics
    : [...comics].sort((left, right) =>
        left.title.localeCompare(right.title, undefined, {
          numeric: true,
          sensitivity: "base"
        })
      );
  const page = paginate(ordered, requestUrl, baseUrl);
  const document = feedDocument({
    id,
    title,
    updated: latestUpdate(ordered),
    self: new URL(requestUrl.pathname + requestUrl.search, baseUrl),
    start: absolute(baseUrl, "/opds"),
    search: absolute(baseUrl, "/opds/search?q={searchTerms}"),
    entries: page.comics.map((comic) => comicEntry(comic, baseUrl))
  });
  return document.replace("</feed>", `${page.links.join("\n")}\n</feed>`);
}

function publicComics(library) {
  return library
    .listComics()
    .filter((comic) => comic.available !== false)
    .map((comic) => {
      const record = library.publicComic(comic);
      // Reading position is server-side and shared, so the catalogue can say
      // where the reader got to and a streaming reader can open there. Attached
      // here rather than threaded through three feed builders.
      const progress = library.getProgress ? library.getProgress(comic.id) : null;
      return progress ? { ...record, progress } : record;
    });
}

function sourceFolders(comics, sourceId, prefix) {
  const normalizedPrefix = String(prefix || "").replace(/^\/+|\/+$/g, "");
  const children = new Map();
  const direct = [];
  for (const comic of comics.filter((item) => item.sourceId === sourceId)) {
    const directory =
      path.dirname(comic.relativePath) === "."
        ? ""
        : path.dirname(comic.relativePath).split(path.sep).join("/");
    if (normalizedPrefix) {
      if (directory !== normalizedPrefix && !directory.startsWith(`${normalizedPrefix}/`)) {
        continue;
      }
    }
    const remainder = normalizedPrefix
      ? directory.slice(normalizedPrefix.length).replace(/^\//, "")
      : directory;
    if (!remainder) {
      direct.push(comic);
      continue;
    }
    const name = remainder.split("/")[0];
    children.set(name, normalizedPrefix ? `${normalizedPrefix}/${name}` : name);
  }
  return { children, direct, prefix: normalizedPrefix };
}

function createOpdsCatalog(library, requestUrl, baseUrl) {
  const comics = publicComics(library);
  const updated = latestUpdate(comics);
  const root = absolute(baseUrl, "/opds");
  const pathname = requestUrl.pathname.replace(/\/+$/, "") || "/opds";

  if (pathname === "/opds") {
    const entries = [
      navigationEntry({
        id: "urn:panelshelf:all",
        title: "All comics",
        summary: `${comics.length} available comics`,
        href: absolute(baseUrl, "/opds/all"),
        updated
      }),
      navigationEntry({
        id: "urn:panelshelf:publishers",
        title: "Publishers",
        summary: "Browse comics by publisher or imprint",
        href: absolute(baseUrl, "/opds/publishers"),
        updated
      }),
      navigationEntry({
        id: "urn:panelshelf:sources",
        title: "Sources and folders",
        summary: "Browse the folder structure indexed by PanelShelf",
        href: absolute(baseUrl, "/opds/sources"),
        updated
      }),
      navigationEntry({
        id: "urn:panelshelf:orders",
        title: "Reading orders",
        summary: "Browse automatic chronologies and custom reading orders",
        href: absolute(baseUrl, "/opds/orders"),
        updated
      })
    ];
    return {
      type: NAVIGATION_TYPE,
      body: feedDocument({
        id: "urn:panelshelf:root",
        title: "PanelShelf",
        updated,
        self: root,
        start: root,
        search: absolute(baseUrl, "/opds/search?q={searchTerms}"),
        entries
      })
    };
  }

  if (pathname === "/opds/all" || pathname === "/opds/search") {
    const query = requestUrl.searchParams.get("q") || "";
    const matches = query
      ? library
          .listComics(query)
          .filter((comic) => comic.available !== false)
          .map((comic) => library.publicComic(comic))
      : comics;
    return {
      type: ACQUISITION_TYPE,
      body: acquisitionFeed({
        id: query ? `urn:panelshelf:search:${query}` : "urn:panelshelf:all",
        title: query ? `Search: ${query}` : "All comics",
        comics: matches,
        requestUrl,
        baseUrl
      })
    };
  }

  if (pathname === "/opds/publishers") {
    const publishers = new Map();
    for (const comic of comics) {
      const name = comic.publisher?.name || "Unknown publisher";
      const group = publishers.get(name) || [];
      group.push(comic);
      publishers.set(name, group);
    }
    const entries = [...publishers.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, items]) =>
        navigationEntry({
          id: `urn:panelshelf:publisher:${name}`,
          title: name,
          summary: `${items.length} comics`,
          href: absolute(
            baseUrl,
            `/opds/publisher?name=${encodeURIComponent(name)}`
          ),
          updated: latestUpdate(items)
        })
      );
    return {
      type: NAVIGATION_TYPE,
      body: feedDocument({
        id: "urn:panelshelf:publishers",
        title: "Publishers",
        updated,
        self: new URL(requestUrl.pathname + requestUrl.search, baseUrl),
        start: root,
        search: absolute(baseUrl, "/opds/search?q={searchTerms}"),
        entries
      })
    };
  }

  if (pathname === "/opds/publisher") {
    const name = requestUrl.searchParams.get("name") || "";
    const matches = comics.filter(
      (comic) => (comic.publisher?.name || "Unknown publisher") === name
    );
    return {
      type: ACQUISITION_TYPE,
      body: acquisitionFeed({
        id: `urn:panelshelf:publisher:${name}`,
        title: name || "Unknown publisher",
        comics: matches,
        requestUrl,
        baseUrl
      })
    };
  }

  if (pathname === "/opds/sources") {
    const sources = new Map();
    for (const comic of comics) {
      if (!sources.has(comic.sourceId)) {
        sources.set(comic.sourceId, comic.sourceName || "Comics");
      }
    }
    const entries = [...sources.entries()].map(([id, name]) =>
      navigationEntry({
        id: `urn:panelshelf:source:${id}`,
        title: name,
        summary: `${comics.filter((comic) => comic.sourceId === id).length} comics`,
        href: absolute(baseUrl, `/opds/source?id=${encodeURIComponent(id)}`),
        updated
      })
    );
    return {
      type: NAVIGATION_TYPE,
      body: feedDocument({
        id: "urn:panelshelf:sources",
        title: "Sources and folders",
        updated,
        self: new URL(requestUrl.pathname + requestUrl.search, baseUrl),
        start: root,
        search: absolute(baseUrl, "/opds/search?q={searchTerms}"),
        entries
      })
    };
  }

  if (pathname === "/opds/source") {
    const sourceId = requestUrl.searchParams.get("id") || "";
    const prefix = requestUrl.searchParams.get("path") || "";
    const folders = sourceFolders(comics, sourceId, prefix);
    const sourceComic = comics.find((comic) => comic.sourceId === sourceId);
    const title = folders.prefix
      ? path.basename(folders.prefix)
      : sourceComic?.sourceName || "Source";
    const entries = [
      ...[...folders.children.entries()].map(([name, childPath]) =>
        navigationEntry({
          id: `urn:panelshelf:source:${sourceId}:${childPath}`,
          title: name,
          summary: "Folder",
          href: absolute(
            baseUrl,
            `/opds/source?id=${encodeURIComponent(sourceId)}&path=${encodeURIComponent(
              childPath
            )}`
          ),
          updated
        })
      ),
      ...folders.direct.map((comic) => comicEntry(comic, baseUrl))
    ];
    return {
      type: CATALOG_TYPE,
      body: feedDocument({
        id: `urn:panelshelf:source:${sourceId}:${folders.prefix}`,
        title,
        updated,
        self: new URL(requestUrl.pathname + requestUrl.search, baseUrl),
        start: root,
        search: absolute(baseUrl, "/opds/search?q={searchTerms}"),
        entries
      })
    };
  }

  if (pathname === "/opds/orders") {
    const orders = library.getReadingOrders();
    const entries = [...orders.automatic, ...orders.manual].map((order) =>
      navigationEntry({
        id: `urn:panelshelf:order:${order.id}`,
        title: order.name,
        summary: `${order.itemCount} comics${order.description ? ` · ${order.description}` : ""}`,
        href: absolute(baseUrl, `/opds/order?id=${encodeURIComponent(order.id)}`),
        updated: order.updatedAt || updated
      })
    );
    return {
      type: NAVIGATION_TYPE,
      body: feedDocument({
        id: "urn:panelshelf:orders",
        title: "Reading orders",
        updated,
        self: new URL(requestUrl.pathname + requestUrl.search, baseUrl),
        start: root,
        search: absolute(baseUrl, "/opds/search?q={searchTerms}"),
        entries
      })
    };
  }

  if (pathname === "/opds/order") {
    const id = requestUrl.searchParams.get("id") || "";
    const orders = library.getReadingOrders();
    const order = [...orders.automatic, ...orders.manual].find(
      (candidate) => candidate.id === id
    );
    if (!order) return null;
    const byId = new Map(comics.map((comic) => [comic.id, comic]));
    const ordered = order.comicIds.map((comicId) => byId.get(comicId)).filter(Boolean);
    return {
      type: ACQUISITION_TYPE,
      body: acquisitionFeed({
        id: `urn:panelshelf:order:${id}`,
        title: order.name,
        comics: ordered,
        requestUrl,
        baseUrl,
        preserveOrder: true
      })
    };
  }

  return null;
}

module.exports = {
  ACQUISITION_TYPE,
  CATALOG_TYPE,
  NAVIGATION_TYPE,
  comicMime,
  createOpdsCatalog,
  xml
};
