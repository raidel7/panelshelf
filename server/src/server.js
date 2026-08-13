"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");
const { ComicLibrary, browseFolders, recentlyAdded } = require("./library");
const { startAdvertisement } = require("./mdns");
const { comicMime, createOpdsCatalog } = require("./opds");
const { jsonError } = require("./util");

const VERSION = "0.4.11";
const HOST = process.env.PANELSHELF_HOST || "0.0.0.0";
const PORT = Number(process.env.PANELSHELF_PORT || 8251);
const DATA_DIRECTORY =
  process.env.PANELSHELF_DATA || path.resolve(process.cwd(), "data");
const PUBLIC_DIRECTORY = path.resolve(__dirname, "..", "public");
const MAX_JSON_BODY = 256 * 1024;
const MAX_BACKUP_BODY = 20 * 1024 * 1024;

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "SAMEORIGIN");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self';"
  );
}

function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function sendError(response, error) {
  const statusByCode = {
    NOT_FOUND: 404,
    PROVIDER_RECORD_NOT_FOUND: 404,
    SCAN_RUNNING: 409,
    METADATA_JOB_RUNNING: 409,
    PROVIDER_AUTH_FAILED: 401,
    PROVIDER_PERMISSION_REQUIRED: 403,
    PROVIDER_RATE_LIMITED: 429,
    PROVIDER_UNAVAILABLE: 502,
    FOLDER_UNAVAILABLE: 400,
    INVALID_CONFIG: 400,
    INVALID_PROFILE: 400,
    INVALID_SCAN_ACTION: 400,
    INVALID_PATH: 400,
    NOT_A_DIRECTORY: 400,
    SOURCE_OVERLAP: 400,
    INVALID_METADATA_QUERY: 400,
    INVALID_METADATA_OVERRIDE: 400,
    INVALID_PROVIDER: 400,
    INVALID_PROVIDER_RECORD: 400,
    INVALID_PROGRESS: 400,
    INVALID_BACKUP: 400,
    METADATA_NOT_CONFIGURED: 400,
    PROVIDER_INVALID_REQUEST: 400,
    PROVIDER_INVALID_RESPONSE: 502
  };
  const status = statusByCode[error.code] || 500;
  sendJson(response, status, {
    error: {
      code: error.code || "INTERNAL_ERROR",
      message: status === 500 && !error.code ? "Unexpected server error." : error.message,
      details: error.details
    }
  });
}

function contentDisposition(name) {
  const fallback = String(name || "comic")
    .replace(/[^\x20-\x7e]+/g, "_")
    .replace(/["\\]/g, "_");
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(
    String(name || "comic")
  )}`;
}

async function serveComicArchive(request, response, library, id) {
  const comic = library.getComic(id);
  if (comic.available === false) {
    const error = new Error("Comic file is unavailable.");
    error.code = "NOT_FOUND";
    throw error;
  }
  const stat = await fsp.stat(comic.path);
  const name = path.basename(comic.path);
  const headers = {
    "Accept-Ranges": "bytes",
    "Content-Type": comicMime(comic),
    "Content-Disposition": contentDisposition(name),
    "Cache-Control": "private, no-store"
  };
  const range = request.headers.range;
  if (!range) {
    response.writeHead(200, { ...headers, "Content-Length": stat.size });
    if (request.method === "HEAD") return response.end();
    return fs.createReadStream(comic.path).pipe(response);
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    response.writeHead(416, {
      "Content-Range": `bytes */${stat.size}`,
      "Content-Length": 0
    });
    return response.end();
  }
  let start = match[1] ? Number(match[1]) : null;
  let end = match[2] ? Number(match[2]) : null;
  if (start === null) {
    const suffixLength = Math.min(end || 0, stat.size);
    start = stat.size - suffixLength;
    end = stat.size - 1;
  } else {
    end = end === null ? stat.size - 1 : Math.min(end, stat.size - 1);
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= stat.size
  ) {
    response.writeHead(416, {
      "Content-Range": `bytes */${stat.size}`,
      "Content-Length": 0
    });
    return response.end();
  }
  const length = end - start + 1;
  response.writeHead(206, {
    ...headers,
    "Content-Length": length,
    "Content-Range": `bytes ${start}-${end}/${stat.size}`
  });
  if (request.method === "HEAD") return response.end();
  return fs.createReadStream(comic.path, { start, end }).pipe(response);
}

async function readJsonBody(request, maximum = MAX_JSON_BODY) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maximum) {
      const error = new Error("Request body is too large.");
      error.code = "INVALID_CONFIG";
      throw error;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must contain valid JSON.");
    error.code = "INVALID_CONFIG";
    throw error;
  }
}

async function serveStatic(response, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const safePath = path.resolve(PUBLIC_DIRECTORY, relative);
  if (!safePath.startsWith(`${PUBLIC_DIRECTORY}${path.sep}`)) return false;
  try {
    const stat = await fsp.stat(safePath);
    if (!stat.isFile()) return false;
    const extension = path.extname(safePath).toLowerCase();
    const contentType =
      extension === ".html"
        ? "text/html; charset=utf-8"
        : extension === ".css"
          ? "text/css; charset=utf-8"
          : extension === ".js"
            ? "text/javascript; charset=utf-8"
            : extension === ".svg"
              ? "image/svg+xml"
              : "application/octet-stream";
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stat.size,
      "Cache-Control":
        extension === ".html" || extension === ".css" || extension === ".js"
          ? "no-cache, no-store, must-revalidate"
          : "public, max-age=3600"
    });
    fs.createReadStream(safePath).pipe(response);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function startServer() {
  const library = new ComicLibrary(DATA_DIRECTORY);
  await library.initialize();

  // Held so /api/discovery can report what the mDNS responder actually did.
  // Discovery runs on a NAS we cannot log into, so its own HTTP port is the
  // only channel that can tell us whether it bound, joined the group, or ever
  // saw a query. advertisementError records a startAdvertisement that threw,
  // which must still be answerable rather than a 404.
  let advertisement = null;
  let advertisementError = null;

  const server = http.createServer(async (request, response) => {
    setSecurityHeaders(response);
    const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    const pathname = decodeURIComponent(requestUrl.pathname);

    try {
      if (request.method === "GET" && pathname === "/api/health") {
        return sendJson(response, 200, {
          status: "ok",
          version: VERSION,
          uptimeSeconds: Math.round(process.uptime())
        });
      }

      if (request.method === "GET" && pathname === "/api/discovery") {
        if (advertisement) {
          return sendJson(response, 200, advertisement.state());
        }
        return sendJson(response, 200, {
          active: false,
          reason: advertisementError
            ? "the mDNS advertisement threw while starting"
            : "the mDNS advertisement has not started yet",
          error: advertisementError
        });
      }

      if (request.method === "GET" && pathname === "/api/config") {
        return sendJson(response, 200, await library.getConfig());
      }

      if (request.method === "PUT" && pathname === "/api/config") {
        const body = await readJsonBody(request);
        const config = await library.saveConfig(body);
        return sendJson(response, 200, config);
      }

      if (request.method === "POST" && pathname === "/api/backup/export") {
        const body = await readJsonBody(request, MAX_BACKUP_BODY);
        return sendJson(
          response,
          200,
          library.createBackup(body.browser || {}, VERSION)
        );
      }

      if (request.method === "POST" && pathname === "/api/backup/preview") {
        const body = await readJsonBody(request, MAX_BACKUP_BODY);
        return sendJson(response, 200, await library.previewBackup(body));
      }

      if (request.method === "POST" && pathname === "/api/backup/restore") {
        const body = await readJsonBody(request, MAX_BACKUP_BODY);
        return sendJson(response, 200, await library.restoreBackup(body));
      }

      if (request.method === "GET" && pathname === "/api/metadata/settings") {
        return sendJson(response, 200, library.getMetadataSettings());
      }

      if (request.method === "PUT" && pathname === "/api/metadata/settings") {
        const body = await readJsonBody(request);
        return sendJson(
          response,
          200,
          await library.saveMetadataSettings(body)
        );
      }

      if (request.method === "GET" && pathname === "/api/metadata/bulk") {
        return sendJson(response, 200, library.getBulkMetadataState());
      }

      if (request.method === "POST" && pathname === "/api/metadata/bulk") {
        const body = await readJsonBody(request);
        return sendJson(
          response,
          202,
          await library.startBulkMetadata(body)
        );
      }

      if (
        request.method === "POST" &&
        pathname === "/api/metadata/bulk/pause"
      ) {
        return sendJson(response, 200, await library.pauseBulkMetadata());
      }

      if (
        request.method === "POST" &&
        pathname === "/api/metadata/bulk/resume"
      ) {
        return sendJson(response, 200, await library.resumeBulkMetadata());
      }

      if (
        request.method === "POST" &&
        pathname === "/api/metadata/bulk/cancel"
      ) {
        return sendJson(response, 200, await library.cancelBulkMetadata());
      }

      if (request.method === "POST" && pathname === "/api/sources/preview") {
        const body = await readJsonBody(request);
        const preview = await library.previewSource(
          body.path,
          body.profile || "detect"
        );
        return sendJson(response, 200, preview);
      }

      if (request.method === "GET" && pathname === "/api/reading-orders") {
        return sendJson(response, 200, library.getReadingOrders());
      }

      if (request.method === "POST" && pathname === "/api/reading-orders") {
        const body = await readJsonBody(request);
        return sendJson(
          response,
          201,
          await library.createReadingOrder(body)
        );
      }

      const duplicateOrderMatch = pathname.match(
        /^\/api\/reading-orders\/(manual_[a-f0-9]{24})\/duplicate$/
      );
      if (request.method === "POST" && duplicateOrderMatch) {
        return sendJson(
          response,
          201,
          await library.duplicateReadingOrder(duplicateOrderMatch[1])
        );
      }

      const readingOrderMatch = pathname.match(
        /^\/api\/reading-orders\/(manual_[a-f0-9]{24})$/
      );
      if (request.method === "PUT" && readingOrderMatch) {
        const body = await readJsonBody(request);
        return sendJson(
          response,
          200,
          await library.updateReadingOrder(readingOrderMatch[1], body)
        );
      }
      if (request.method === "DELETE" && readingOrderMatch) {
        return sendJson(
          response,
          200,
          await library.deleteReadingOrder(readingOrderMatch[1])
        );
      }

      if (request.method === "GET" && pathname === "/api/folders") {
        return sendJson(
          response,
          200,
          await browseFolders(requestUrl.searchParams.get("path") || "/")
        );
      }

      if (request.method === "POST" && pathname === "/api/scan") {
        if (library.getScanState().running) {
          const error = new Error("A library scan is already running.");
          error.code = "SCAN_RUNNING";
          throw error;
        }
        const body = await readJsonBody(request);
        const scanPromise = library.scan({
          action: body.action || "quick",
          sourceId: body.sourceId || null
        });
        scanPromise.catch((error) => {
          console.error(
            JSON.stringify({
              time: new Date().toISOString(),
              message: "Background scan failed",
              error: error.stack || error.message
            })
          );
        });
        return sendJson(response, 202, library.getScanState());
      }

      if (request.method === "GET" && pathname === "/api/scan") {
        return sendJson(response, 200, library.getScanState());
      }

      if (request.method === "GET" && pathname === "/api/progress") {
        return sendJson(response, 200, library.listProgress());
      }

      if (request.method === "POST" && pathname === "/api/progress/merge") {
        const body = await readJsonBody(request, MAX_BACKUP_BODY);
        // The whole body, so `deleted` reaches the store. A body that is just a
        // map of records — what the web viewer sends — still works: the store
        // recognises the bare form.
        await library.mergeProgress(body);
        return sendJson(response, 200, library.listProgress());
      }

      // Deliberate bulk write, as opposed to /merge's reconciliation: the
      // server stamps every record and applies it without consulting the
      // client's clock. Registered before the :comicId routes so "batch" is
      // never treated as a comic id.
      if (request.method === "POST" && pathname === "/api/progress/batch") {
        const body = await readJsonBody(request, MAX_BACKUP_BODY);
        await library.applyProgressBatch(body);
        return sendJson(response, 200, library.listProgress());
      }

      const progressMatch = pathname.match(/^\/api\/progress\/([a-f0-9]{24})$/);
      if (progressMatch) {
        const comicId = progressMatch[1];
        if (request.method === "GET") {
          const record = library.getProgress(comicId);
          if (!record) {
            throw jsonError("Progress not found.", "NOT_FOUND");
          }
          return sendJson(response, 200, record);
        }
        if (request.method === "PUT") {
          const body = await readJsonBody(request);
          return sendJson(response, 200, await library.saveProgress(comicId, body));
        }
        if (request.method === "DELETE") {
          // Idempotent: deleting an id with no record still returns 200, so an
          // offline client replaying a queued delete never gets an error.
          await library.removeProgress(comicId);
          return sendJson(response, 200, { deleted: true, id: comicId });
        }
      }

      if (request.method === "GET" && pathname === "/api/comics") {
        // `?view=compact` trades every metadata block, ordering path and
        // hierarchy for the seven fields a browsing list draws. The default
        // stays the full record: the web viewer and OPDS read it, and a client
        // that does not ask for compact must not be handed a shorter comic.
        const compact = requestUrl.searchParams.get("view") === "compact";
        const project = compact
          ? (comic) => library.compactComic(comic)
          : (comic) => library.publicComic(comic);
        // `sort=added` and `limit` exist for the app's Home screen, which wants
        // a dozen comics rather than a library. Both are ignored when absent or
        // unusable: a client that fumbles a parameter should get the whole
        // shelf, never an empty one.
        const limit = Number.parseInt(requestUrl.searchParams.get("limit"), 10);
        const bounded = Number.isFinite(limit) && limit > 0;
        let comics = library.listComics(requestUrl.searchParams.get("q") || "");
        if (requestUrl.searchParams.get("sort") === "added") {
          comics = recentlyAdded(comics, limit);
        } else if (bounded) {
          comics = comics.slice(0, limit);
        }
        return sendJson(response, 200, comics.map(project));
      }

      // The full record for one comic, without opening its archive — which is
      // what asking `/pages` for it costs. The detail screen needs the metadata
      // a compact list omits and nothing more.
      const comicMatch = pathname.match(/^\/api\/comics\/([a-f0-9]{24})$/);
      if (request.method === "GET" && comicMatch) {
        return sendJson(
          response,
          200,
          library.publicComic(library.getComic(comicMatch[1]))
        );
      }

      if (
        request.method === "GET" &&
        (pathname === "/opds" || pathname.startsWith("/opds/"))
      ) {
        const baseUrl = `http://${request.headers.host || `localhost:${PORT}`}`;
        const catalog = createOpdsCatalog(library, requestUrl, baseUrl);
        if (catalog) {
          const body = Buffer.from(catalog.body);
          response.writeHead(200, {
            "Content-Type": `${catalog.type}; charset=utf-8`,
            "Content-Length": body.length,
            "Cache-Control": "private, no-cache"
          });
          return response.end(body);
        }
      }

      const opdsComicMatch = pathname.match(
        /^\/opds\/comics\/([a-f0-9]{24})\/file$/
      );
      if (
        (request.method === "GET" || request.method === "HEAD") &&
        opdsComicMatch
      ) {
        return serveComicArchive(
          request,
          response,
          library,
          opdsComicMatch[1]
        );
      }

      const metadataSearchMatch = pathname.match(
        /^\/api\/comics\/([a-f0-9]{24})\/metadata\/search$/
      );
      if (request.method === "POST" && metadataSearchMatch) {
        const body = await readJsonBody(request);
        return sendJson(
          response,
          200,
          await library.searchMetadata(metadataSearchMatch[1], body)
        );
      }

      const metadataCandidateMatch = pathname.match(
        /^\/api\/comics\/([a-f0-9]{24})\/metadata\/candidates\/([a-z0-9_-]+)\/([A-Za-z0-9._:-]{1,100})$/
      );
      if (request.method === "GET" && metadataCandidateMatch) {
        return sendJson(
          response,
          200,
          await library.reviewMetadata(
            metadataCandidateMatch[1],
            metadataCandidateMatch[2],
            metadataCandidateMatch[3],
            {
              refresh: requestUrl.searchParams.get("refresh") === "1"
            }
          )
        );
      }

      const metadataMatch = pathname.match(
        /^\/api\/comics\/([a-f0-9]{24})\/metadata\/match$/
      );
      if (request.method === "POST" && metadataMatch) {
        const body = await readJsonBody(request);
        return sendJson(
          response,
          200,
          await library.confirmMetadata(
            metadataMatch[1],
            body.provider,
            String(body.recordId || "")
          )
        );
      }

      const metadataOverrideMatch = pathname.match(
        /^\/api\/comics\/([a-f0-9]{24})\/metadata\/override$/
      );
      if (request.method === "PUT" && metadataOverrideMatch) {
        const body = await readJsonBody(request);
        return sendJson(
          response,
          200,
          await library.saveMetadataOverride(metadataOverrideMatch[1], body)
        );
      }
      if (request.method === "DELETE" && metadataOverrideMatch) {
        return sendJson(
          response,
          200,
          await library.removeMetadataOverride(metadataOverrideMatch[1])
        );
      }
      if (request.method === "DELETE" && metadataMatch) {
        return sendJson(
          response,
          200,
          await library.removeMetadata(metadataMatch[1])
        );
      }

      const metadataCoverMatch = pathname.match(
        /^\/api\/metadata\/providers\/([a-z0-9_-]+)\/issues\/([A-Za-z0-9._:-]{1,100})\/cover$/
      );
      if (request.method === "GET" && metadataCoverMatch) {
        const cover = await library.metadataCover(
          metadataCoverMatch[1],
          metadataCoverMatch[2]
        );
        response.writeHead(200, {
          "Content-Type": cover.mime,
          "Content-Length": cover.buffer.length,
          "Cache-Control": "private, max-age=1800"
        });
        return response.end(cover.buffer);
      }

      const pagesMatch = pathname.match(/^\/api\/comics\/([a-f0-9]{24})\/pages$/);
      if (request.method === "GET" && pagesMatch) {
        const comic = library.getComic(pagesMatch[1]);
        const pages = await library.pagesForComic(comic);
        return sendJson(response, 200, {
          comic: library.publicComic(comic),
          pages: pages.map((entry, index) => ({ index, name: entry.name }))
        });
      }

      const coverMatch = pathname.match(/^\/api\/comics\/([a-f0-9]{24})\/cover$/);
      if (request.method === "GET" && coverMatch) {
        // ?size=thumb is the only alternative to the full-size default. The
        // size is fixed rather than caller-supplied so the on-disk cache stays
        // one file per comic and nobody can walk a NAS CPU through a thousand
        // widths.
        const requested = requestUrl.searchParams.get("size");
        if (requested !== null && requested !== "thumb" && requested !== "full") {
          return sendJson(response, 400, {
            error: {
              code: "INVALID_SIZE",
              message: "size must be thumb or full."
            }
          });
        }
        const cover = await library.cover(coverMatch[1], {
          thumbnail: requested === "thumb"
        });
        response.writeHead(200, {
          "Content-Type": cover.mime,
          "Content-Length": cover.buffer.length,
          "Cache-Control": "private, max-age=86400"
        });
        return response.end(cover.buffer);
      }

      const pageMatch = pathname.match(
        /^\/api\/comics\/([a-f0-9]{24})\/pages\/(\d+)$/
      );
      if (request.method === "GET" && pageMatch) {
        const page = await library.page(pageMatch[1], Number(pageMatch[2]));
        response.writeHead(200, {
          "Content-Type": page.mime,
          "Content-Length": page.buffer.length,
          "Cache-Control": "private, max-age=3600",
          "X-Comic-Page-Count": String(page.pageCount)
        });
        return response.end(page.buffer);
      }

      if (request.method === "GET" && (await serveStatic(response, pathname))) {
        return;
      }

      return sendJson(response, 404, {
        error: { code: "NOT_FOUND", message: "Not found." }
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          time: new Date().toISOString(),
          method: request.method,
          path: pathname,
          error: error.stack || error.message
        })
      );
      if (!response.headersSent) sendError(response, error);
      else response.destroy();
    }
  });

  server.requestTimeout = 120_000;
  server.headersTimeout = 30_000;
  server.listen(PORT, HOST, () => {
    console.log(
      JSON.stringify({
        time: new Date().toISOString(),
        message: "PanelShelf started",
        version: VERSION,
        host: HOST,
        port: PORT,
        dataDirectory: DATA_DIRECTORY
      })
    );
    try {
      advertisement = startAdvertisement({ port: PORT, version: VERSION });
    } catch (error) {
      // Discovery is optional; the server still serves over HTTP.
      advertisementError = error.message || String(error);
    }
    // Logged once so the DSM package log carries the same picture as
    // /api/discovery, for the case where the endpoint itself is unreachable.
    // Deferred by a beat because the bind and the multicast join complete
    // asynchronously: logging inline would always report "binding" and tell us
    // nothing. Unref'd so it never holds the process open.
    setTimeout(() => {
      console.log(
        JSON.stringify({
          time: new Date().toISOString(),
          message: "PanelShelf discovery",
          discovery: advertisement
            ? advertisement.state()
            : { active: false, error: advertisementError }
        })
      );
    }, 1_000).unref();
  });

  const shutdown = (signal) => {
    console.log(JSON.stringify({ time: new Date().toISOString(), signal }));
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startServer().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
