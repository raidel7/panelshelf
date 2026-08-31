"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { URL } = require("node:url");
const { ComicLibrary, browseFolders, recentlyAdded } = require("./library");
const { MAX_ARTWORK_BYTES } = require("./custom-artwork");
const { startAdvertisement } = require("./mdns");
const { comicMime, createOpdsCatalog } = require("./opds");
const {
  TrustedProxies,
  clientAddress,
  isSecureRequest
} = require("./forwarded");
const { AttemptLimiter, clientKey } = require("./rate-limit");
const { createSupportBundle } = require("./support-bundle");
const { DEFAULT_READER_ID } = require("./reader-profiles");
const { jsonError } = require("./util");

const VERSION = "0.4.18";
// The JSON API's own version, which moves independently of the package's.
// A client asks for `/api/v1/...`; `/api/...` is the same surface under its
// original name and stays that way, because the iPad client is released from
// its own repository on its own schedule and a server that moved its paths
// would break every copy already installed.
const API_VERSION = 1;
const API_PREFIX = `/api/v${API_VERSION}/`;
const HOST = process.env.PANELSHELF_HOST || "0.0.0.0";
const PORT = Number(process.env.PANELSHELF_PORT || 8251);
const DATA_DIRECTORY =
  process.env.PANELSHELF_DATA || path.resolve(process.cwd(), "data");
const PUBLIC_DIRECTORY = path.resolve(__dirname, "..", "public");
const MAX_JSON_BODY = 256 * 1024;
const MAX_BACKUP_BODY = 20 * 1024 * 1024;
// A deployment behind a reverse proxy legitimately arrives under a name
// this server has no other way to learn. Comma separated, host[:port].
const ALLOWED_HOSTS = (process.env.PANELSHELF_ALLOWED_HOSTS || "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
// Whose `X-Forwarded-*` headers are worth reading. Empty by default, which
// means none: a header anyone can send is only evidence when it arrives from a
// machine the owner has named. `loopback` covers a proxy on the NAS itself.
const TRUSTED_PROXIES = new TrustedProxies(process.env.PANELSHELF_TRUSTED_PROXY);

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "SAMEORIGIN");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self';"
  );
}

/// True for a host that a rebinding attack has no way to forge its way into.
/// Rebinding needs a name the attacker controls in DNS: a bare address has no
/// record to re-point, and `.local` is answered by mDNS on the LAN rather than
/// by a resolver anybody outside it can influence.
function isTrustedHost(host) {
  if (!host) return false;
  const lowered = String(host).toLowerCase();
  if (ALLOWED_HOSTS.includes(lowered)) return true;
  const name = lowered.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  if (ALLOWED_HOSTS.includes(name)) return true;
  if (name === "localhost" || name.endsWith(".local")) return true;
  return net.isIP(name) !== 0;
}

/// PanelShelf has no accounts, so whatever can reach the port is trusted. On a
/// home LAN that trust reaches further than it looks: every browser on the
/// network is a usable proxy for whichever page it happens to be showing, so
/// "only on the LAN" is not by itself a boundary. These three checks are what
/// make it one, and they run before any route does.
function guardRequest(request, pathname) {
  if (!isTrustedHost(request.headers.host)) {
    throw jsonError(
      "This server does not answer to that host name.",
      "FORBIDDEN_HOST"
    );
  }

  // Browsers attach Origin to exactly the requests that matter here. Native
  // clients — the iPad app, any OPDS reader — attach none, and were never the
  // threat, so a missing origin is not one either.
  const origin = request.headers.origin;
  if (origin && origin !== "null") {
    let originHost = null;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      originHost = null;
    }
    const host = String(request.headers.host || "").toLowerCase();
    if (originHost !== host && !ALLOWED_HOSTS.includes(originHost)) {
      throw jsonError(
        "Requests from another origin are not accepted.",
        "FORBIDDEN_ORIGIN"
      );
    }
  }

  // POST is the one mutating method a browser sends cross-origin without
  // asking permission first, and only while its content type is one of the
  // three CORS-safelisted ones. Requiring JSON forces a preflight that nothing
  // here answers. Checked only when a body is actually present, so a bodyless
  // DELETE is left alone.
  const hasBody =
    Number(request.headers["content-length"] || 0) > 0 ||
    Boolean(request.headers["transfer-encoding"]);
  if (hasBody) {
    const type = String(request.headers["content-type"] || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    // Artwork is uploaded as the image itself, so those routes accept an image
    // type as well. This does not reopen what the rule closed: the CORS
    // safelist is text/plain, multipart/form-data and
    // application/x-www-form-urlencoded, and an image type is on none of them —
    // so an image upload still preflights, and the origin check still answers
    // first.
    const allowed = pathname.startsWith("/api/artwork/")
      ? ["application/json", "image/png", "image/jpeg"]
      : ["application/json"];
    if (!allowed.includes(type)) {
      throw jsonError(
        "Request bodies must be sent as application/json.",
        "UNSUPPORTED_MEDIA_TYPE"
      );
    }
  }
}

// Reachable before a client holds a credential, because each of them is how a
// client gets one or decides whether it needs one. `/api/health` in particular
// is what the iPad's connection screen uses to tell a wrong address from an
// unpaired server, and those need different words on screen.
const OPEN_PATHS = new Set(["/api/health", "/api/discovery", "/api/devices/pair"]);

const DEVICE_COOKIE = "panelshelf_device";

// The shelf draws covers and the reader draws pages with `image.src`. Those are
// browser-issued requests and carry no Authorization header, so a token that
// lives only in a header would empty every shelf the moment pairing was on.
// A cookie is the one credential the browser attaches to an <img> by itself.
//
// HttpOnly so script cannot read the token back out. SameSite=Strict so no
// other site can spend it — which, with the origin and host checks already in
// `guardRequest`, is what makes carrying it on a plain GET safe. No Secure:
// PanelShelf serves plain HTTP on a LAN, and a Secure cookie would simply never
// be sent.
//
// Secure is added only when this request demonstrably arrived over HTTPS —
// directly, or through a proxy the owner has named. It cannot be unconditional:
// a Secure cookie is simply never sent over plain HTTP, so setting it on a LAN
// deployment would empty every shelf the browser draws. And it cannot be
// omitted once HTTPS is in front, or the token the owner went to the trouble of
// encrypting would still leak the first time somebody typed the bare address.
function deviceCookieHeader(token, secure = false) {
  const shared = `Path=/; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
  if (!token) return `${DEVICE_COOKIE}=; ${shared}; Max-Age=0`;
  // 400 days is the longest most browsers will honour.
  return `${DEVICE_COOKIE}=${token}; ${shared}; Max-Age=${400 * 24 * 60 * 60}`;
}

function cookieToken(request) {
  for (const part of String(request.headers.cookie || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== DEVICE_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

// A device token can arrive three ways. Bearer is what PanelShelf's own clients
// send. Basic is what a third-party OPDS reader sends, because Basic is all it
// has — so the token goes in the password field and the username is ignored.
// Without that, switching pairing on would silently break every OPDS reader.
function presentedToken(request) {
  const header = String(request.headers.authorization || "");
  const bearer = header.match(/^Bearer\s+(.+)$/i);
  if (bearer) return bearer[1].trim();
  const basic = header.match(/^Basic\s+(.+)$/i);
  if (basic) {
    try {
      const decoded = Buffer.from(basic[1].trim(), "base64").toString("utf8");
      const separator = decoded.indexOf(":");
      if (separator !== -1) return decoded.slice(separator + 1);
    } catch {
      // Falls through to the cookie.
    }
  }
  return cookieToken(request);
}

// Which reader profile a request is for.
//
// Naming one is not authenticating: a profile is a namespace, it carries no
// password, and this runs whether or not pairing is on. What decides who may
// talk to this server is `authorize` below, and only that.
//
// First-party clients send the name outright. A third-party OPDS reader cannot
// send a header PanelShelf invented, but it does not need to: it already puts a
// username box on screen next to the password box, and `presentedToken` decodes
// that username and throws it away. So the reader profile rides in a field the
// client already shows, with the device token staying where it was.
//
// Anything unrecognised — a typo, a blank, a name from a profile since deleted
// — resolves to the default rather than creating a profile. Being wrong about
// your own name should show you the wrong shelf, not lose you the right one.
const READER_HEADER = "x-panelshelf-reader";

function basicUsername(request) {
  const basic = String(request.headers.authorization || "").match(/^Basic\s+(.+)$/i);
  if (!basic) return null;
  try {
    const decoded = Buffer.from(basic[1].trim(), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    return separator === -1 ? decoded : decoded.slice(0, separator);
  } catch {
    return null;
  }
}

// Header values are bytes, and Node hands them over decoded as latin1. A client
// that writes "Ana María" into a header sends UTF-8, which arrives here as
// "Ana MarÃ­a" and matches nothing. Reinterpreting those bytes as UTF-8 gets the
// name back; pure ASCII is unchanged by the round trip, so the raw value is
// tried first and this is only the fallback. The Basic username needs none of
// this — it is base64 of the same bytes, and is already decoded as UTF-8.
function headerNames(value) {
  if (typeof value !== "string" || !value) return [];
  const reinterpreted = Buffer.from(value, "latin1").toString("utf8");
  return reinterpreted === value ? [value] : [value, reinterpreted];
}

function resolveReaderProfile(request, library, device, pathName) {
  const named = headerNames(request.headers[READER_HEADER]);
  return (
    // The address of the catalogue itself, for a reader with no username box.
    library.matchReaderProfile(pathName) ||
    library.matchReaderProfile(named[0]) ||
    library.matchReaderProfile(named[1]) ||
    library.matchReaderProfile(basicUsername(request)) ||
    // Whatever the paired device is set to, when the request itself says
    // nothing. A name nobody has counts as saying nothing, so a typo falls
    // through to here rather than past it.
    library.matchReaderProfile(device && device.readerProfileId) ||
    DEFAULT_READER_ID
  );
}

// Returns the paired device when there is one, so that the reader profile it is
// bound to can be read without hashing the token a second time. Null means
// pairing is off or the path was never guarded, not that the caller is anybody.
function authorize(request, pathname, devices) {
  if (!devices.enabled) return null;
  if (OPEN_PATHS.has(pathname)) return null;
  // The app shell and its assets stay open: the page has to load before anyone
  // can type a pairing code into it. Everything it then asks for is guarded.
  const guarded = pathname.startsWith("/api/") || pathname === "/opds" ||
    pathname.startsWith("/opds/");
  if (!guarded) return null;
  const device = devices.verify(presentedToken(request));
  if (device) return device;
  throw jsonError(
    "This server only answers paired devices.",
    "UNAUTHORIZED"
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
    UNAUTHORIZED: 401,
    INVALID_PAIRING_CODE: 400,
    TOO_MANY_PAIRING_ATTEMPTS: 429,
    INVALID_READER_PROFILE: 400,
    TOO_MANY_READER_PROFILES: 400,
    INVALID_ARTWORK: 400,
    INVALID_ORDER_DOCUMENT: 400,
    COVER_WARMUP_RUNNING: 409,
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
    INVALID_SKIPS: 400,
    TOO_MANY_SKIPS: 400,
    INVALID_BACKUP: 400,
    METADATA_NOT_CONFIGURED: 400,
    PROVIDER_INVALID_REQUEST: 400,
    PROVIDER_INVALID_RESPONSE: 502,
    FORBIDDEN_ORIGIN: 403,
    FORBIDDEN_HOST: 403,
    UNSUPPORTED_MEDIA_TYPE: 415
  };
  const status = statusByCode[error.code] || 500;
  // Set before sendJson writes the head, which merges what is already there.
  // A 429 with no Retry-After tells a client to back off without telling it
  // how far, and the honest answer is one this server already knows.
  if (status === 429 && Number.isFinite(error.retryAfterSeconds)) {
    response.setHeader("Retry-After", String(error.retryAfterSeconds));
  }
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

async function readBinaryBody(request, maximum) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maximum) {
      throw jsonError("That image is too large.", "INVALID_ARTWORK");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
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

  // Per server rather than per module: a process running two of these — the
  // tests do, dozens of times — must not have one of them spend the other's
  // budget and fail a run for reasons that have nothing to do with the case.
  const pairingAttempts = new AttemptLimiter();

  const server = http.createServer(async (request, response) => {
    setSecurityHeaders(response);
    const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    let pathname = decodeURIComponent(requestUrl.pathname);
    // Normalised before anything reads it, so a versioned path meets exactly
    // the same origin, content-type and pairing checks as its unversioned twin
    // rather than a parallel set someone has to remember to keep in step. A
    // version this server does not speak is left alone and falls through to the
    // 404 it deserves, rather than being quietly served as v1.
    if (pathname.startsWith(API_PREFIX)) {
      pathname = `/api/${pathname.slice(API_PREFIX.length)}`;
    }

    // A catalogue address per reader, for a client that offers neither a
    // username box nor pairing: `/opds/r/ana/all` is `/opds/all` read as Ana.
    // The name is the one field every OPDS client has, since it is the address
    // you type in. Stripped here so that every guard and every route below sees
    // the ordinary path, and put back on the feed's own links further down —
    // otherwise page two of a shelf would quietly be somebody else's.
    const readerPath = pathname.match(/^\/opds\/r\/([^/]{1,60})(\/.*)?$/);
    const readerPathName = readerPath ? readerPath[1] : null;
    if (readerPath) {
      pathname = `/opds${readerPath[2] || ""}`;
      requestUrl.pathname = pathname;
    }

    try {
      guardRequest(request, pathname);
      const pairedDevice = authorize(request, pathname, library.deviceTokens);
      // Whose shelf this request is about. Resolved once, so that every route
      // below gets the same answer and none of them has to work it out again.
      const readerProfileId = resolveReaderProfile(
        request,
        library,
        pairedDevice,
        readerPathName
      );

      if (request.method === "GET" && pathname === "/api/health") {
        return sendJson(response, 200, {
          status: "ok",
          version: VERSION,
          apiVersion: API_VERSION,
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

      if (request.method === "GET" && pathname === "/api/support-bundle") {
        const bundle = await createSupportBundle({
          library,
          version: VERSION,
          apiVersion: API_VERSION
        });
        // Offered as a file rather than a page. Whoever asked for this is
        // about to attach it to something, and a browser that renders it
        // instead turns that into a copy-and-paste job over a screen of JSON.
        const stamp = bundle.generatedAt.slice(0, 10);
        response.setHeader(
          "Content-Disposition",
          `attachment; filename="panelshelf-support-${stamp}.json"`
        );
        return sendJson(response, 200, bundle);
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

      if (request.method === "POST" && pathname === "/api/reading-orders/import") {
        const body = await readJsonBody(request);
        return sendJson(response, 201, await library.importReadingOrder(body));
      }

      const exportOrderMatch = pathname.match(
        /^\/api\/reading-orders\/(manual_[a-f0-9]{24})\/export$/
      );
      if (request.method === "GET" && exportOrderMatch) {
        return sendJson(response, 200, library.exportReadingOrder(exportOrderMatch[1]));
      }

      const repairOrderMatch = pathname.match(
        /^\/api\/reading-orders\/(manual_[a-f0-9]{24})\/repair$/
      );
      if (repairOrderMatch) {
        // GET says what is wrong and changes nothing; POST fixes it. Reporting
        // and repairing are separate because an order is someone's judgement,
        // and quietly rewriting one is not a favour.
        if (request.method === "GET") {
          return sendJson(response, 200, library.readingOrderRepairReport(repairOrderMatch[1]));
        }
        if (request.method === "POST") {
          return sendJson(response, 200, await library.repairReadingOrder(repairOrderMatch[1]));
        }
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

      if (request.method === "DELETE" && pathname === "/api/scan/issues") {
        return sendJson(response, 200, await library.clearScanIssues());
      }

      // `comic:<id>` and `order:<id>`: one store serves both, because a
      // storyline's cover and a comic's are the same kind of thing.
      const artworkMatch = pathname.match(
        /^\/api\/artwork\/(cover|banner)\/(comic|order)\/([A-Za-z0-9_-]{1,64})$/
      );
      if (artworkMatch) {
        const [, kind, subjectType, subjectId] = artworkMatch;
        const subject = `${subjectType}:${subjectId}`;
        if (request.method === "PUT") {
          const body = await readBinaryBody(request, MAX_ARTWORK_BYTES);
          return sendJson(
            response,
            200,
            await library.artwork.save(subject, kind, body)
          );
        }
        if (request.method === "DELETE") {
          await library.artwork.remove(subject, kind);
          return sendJson(response, 200, { removed: true });
        }
        if (request.method === "GET") {
          const entry = library.artwork.get(subject, kind);
          if (!entry) throw jsonError("No artwork is set.", "NOT_FOUND");
          const buffer = await fsp.readFile(library.artwork.pathFor(entry));
          response.writeHead(200, {
            "Content-Type": entry.mime,
            "Content-Length": buffer.length,
            "Cache-Control": "no-store"
          });
          return response.end(buffer);
        }
      }

      if (
        request.method === "POST" &&
        pathname === "/api/metadata/overrides/bulk"
      ) {
        const body = await readJsonBody(request);
        return sendJson(response, 200, await library.applyBulkMetadata(body));
      }

      const orderComicsMatch = pathname.match(
        /^\/api\/reading-orders\/(manual_[a-f0-9]{24})\/comics$/
      );
      if (request.method === "POST" && orderComicsMatch) {
        const body = await readJsonBody(request);
        return sendJson(
          response,
          200,
          await library.addComicsToReadingOrder(orderComicsMatch[1], body?.comicIds)
        );
      }

      if (request.method === "GET" && pathname === "/api/metadata/review") {
        return sendJson(response, 200, library.metadataReviewQueue());
      }

      if (request.method === "GET" && pathname === "/api/duplicates") {
        return sendJson(response, 200, library.findDuplicateComics());
      }

      if (request.method === "GET" && pathname === "/api/changes") {
        return sendJson(
          response,
          200,
          library.libraryChangesSince(requestUrl.searchParams.get("since"))
        );
      }

      // Who is reading. The list answers with the profile this very request
      // resolved to, so a client can show which shelf it is looking at without
      // having to work out the resolution rules itself — particularly an OPDS
      // reader's owner wondering whether the username box took.
      if (request.method === "GET" && pathname === "/api/readers") {
        return sendJson(response, 200, {
          current: readerProfileId,
          profiles: library.listReaderProfiles()
        });
      }

      if (request.method === "POST" && pathname === "/api/readers") {
        const body = await readJsonBody(request);
        const profile = await library.createReaderProfile(body?.name);
        return sendJson(response, 201, {
          profile,
          profiles: library.listReaderProfiles()
        });
      }

      const readerMatch = pathname.match(/^\/api\/readers\/([a-z0-9][a-z0-9-]{0,39})$/);
      if (request.method === "PUT" && readerMatch) {
        const body = await readJsonBody(request);
        const profile = await library.renameReaderProfile(readerMatch[1], body?.name);
        return sendJson(response, 200, {
          profile,
          profiles: library.listReaderProfiles()
        });
      }

      if (request.method === "DELETE" && readerMatch) {
        // Not idempotent the way a progress delete is: deleting a reader
        // profile throws away a shelf, so a client that names one that is not
        // there has the wrong idea about this server and should hear so.
        const deleted = await library.deleteReaderProfile(readerMatch[1]);
        if (!deleted) {
          throw jsonError("That reader profile does not exist.", "NOT_FOUND");
        }
        return sendJson(response, 200, { profiles: library.listReaderProfiles() });
      }

      if (request.method === "GET" && pathname === "/api/devices") {
        return sendJson(response, 200, {
          enabled: library.deviceTokens.enabled,
          devices: library.deviceTokens.list()
        });
      }

      if (request.method === "POST" && pathname === "/api/devices/enable") {
        const body = await readJsonBody(request);
        const paired = await library.enableDevicePairing(body);
        response.setHeader(
          "Set-Cookie",
          deviceCookieHeader(paired.token, isSecureRequest(request, TRUSTED_PROXIES))
        );
        return sendJson(response, 200, paired);
      }

      if (request.method === "POST" && pathname === "/api/devices/disable") {
        await library.deviceTokens.setEnabled(false);
        // Emptied rather than left to expire: a cookie for a server that no
        // longer asks for one is just a token sitting in a browser.
        response.setHeader(
          "Set-Cookie",
          deviceCookieHeader(null, isSecureRequest(request, TRUSTED_PROXIES))
        );
        return sendJson(response, 200, { enabled: false, devices: library.deviceTokens.list() });
      }

      if (request.method === "POST" && pathname === "/api/devices/pairing-code") {
        // Asking for a fresh code is the gesture of someone who means to pair
        // right now, and it is a guarded route once pairing is on. Clearing
        // the attempt budget here is what keeps a stranger on the LAN from
        // spending it and leaving the household unable to add a tablet.
        pairingAttempts.reset();
        return sendJson(response, 200, await library.deviceTokens.createPairingCode());
      }

      if (request.method === "POST" && pathname === "/api/devices/pair") {
        // The one route that hands out a credential to a caller holding none,
        // so it is the one route worth counting wrong answers on.
        const attemptKey = clientKey(clientAddress(request, TRUSTED_PROXIES));
        pairingAttempts.check(attemptKey);
        const body = await readJsonBody(request);
        let paired;
        try {
          paired = await library.deviceTokens.redeemPairingCode(body.code, {
            name: body.name,
            // Named at pairing time, so a third-party OPDS reader lands on the
            // right shelf from its very first request. An unknown name binds
            // nothing rather than failing the pairing.
            readerProfileId: library.matchReaderProfile(body.readerProfileId)
          });
        } catch (error) {
          // Only a wrong code counts. A malformed body is a client bug and a
          // person retyping their tablet's name should not spend the budget
          // that protects the code itself.
          if (error.code === "INVALID_PAIRING_CODE") pairingAttempts.fail(attemptKey);
          throw error;
        }
        // Set for a browser redeeming a code; a native client ignores it and
        // keeps the token from the body instead.
        response.setHeader(
          "Set-Cookie",
          deviceCookieHeader(paired.token, isSecureRequest(request, TRUSTED_PROXIES))
        );
        return sendJson(response, 200, paired);
      }

      const deviceMatch = pathname.match(
        /^\/api\/devices\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/
      );
      // Which shelf this device reads when a request names none. `null` takes
      // the binding back off.
      if (request.method === "PUT" && deviceMatch) {
        const body = await readJsonBody(request);
        const device = await library.bindDeviceToReaderProfile(
          deviceMatch[1],
          body?.readerProfileId ?? null
        );
        return sendJson(response, 200, {
          device,
          devices: library.deviceTokens.list()
        });
      }

      if (request.method === "DELETE" && deviceMatch) {
        const revoked = await library.deviceTokens.revoke(deviceMatch[1]);
        if (!revoked) throw jsonError("That device is not paired.", "NOT_FOUND");
        return sendJson(response, 200, { devices: library.deviceTokens.list() });
      }

      if (request.method === "GET" && pathname === "/api/covers/cache") {
        return sendJson(response, 200, library.coverCacheStatus());
      }

      if (request.method === "POST" && pathname === "/api/covers/cache/warm") {
        return sendJson(response, 200, library.startCoverWarmup());
      }

      if (
        request.method === "POST" &&
        pathname === "/api/covers/cache/warm/cancel"
      ) {
        return sendJson(response, 200, library.cancelCoverWarmup());
      }

      if (request.method === "GET" && pathname === "/api/progress") {
        return sendJson(response, 200, library.listProgress(readerProfileId));
      }

      if (request.method === "POST" && pathname === "/api/progress/merge") {
        const body = await readJsonBody(request, MAX_BACKUP_BODY);
        // The whole body, so `deleted` reaches the store. A body that is just a
        // map of records — what the web viewer sends — still works: the store
        // recognises the bare form.
        await library.mergeProgress(readerProfileId, body);
        return sendJson(response, 200, library.listProgress(readerProfileId));
      }

      // Deliberate bulk write, as opposed to /merge's reconciliation: the
      // server stamps every record and applies it without consulting the
      // client's clock. Registered before the :comicId routes so "batch" is
      // never treated as a comic id.
      if (request.method === "POST" && pathname === "/api/progress/batch") {
        const body = await readJsonBody(request, MAX_BACKUP_BODY);
        await library.applyProgressBatch(readerProfileId, body);
        return sendJson(response, 200, library.listProgress(readerProfileId));
      }

      const progressMatch = pathname.match(/^\/api\/progress\/([a-f0-9]{24})$/);
      if (progressMatch) {
        const comicId = progressMatch[1];
        if (request.method === "GET") {
          const record = library.getProgress(readerProfileId, comicId);
          if (!record) {
            throw jsonError("Progress not found.", "NOT_FOUND");
          }
          return sendJson(response, 200, record);
        }
        if (request.method === "PUT") {
          const body = await readJsonBody(request);
          return sendJson(
            response,
            200,
            await library.saveProgress(readerProfileId, comicId, body)
          );
        }
        if (request.method === "DELETE") {
          // Idempotent: deleting an id with no record still returns 200, so an
          // offline client replaying a queued delete never gets an error.
          await library.removeProgress(readerProfileId, comicId);
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

      // Which chronology branches the reader has set aside. Server-owned like
      // reading progress: a branch hidden in the browser is hidden on the iPad.
      if (request.method === "GET" && pathname === "/api/skips") {
        return sendJson(response, 200, library.listSkips(readerProfileId));
      }

      // Deliberate, and with nothing to reconcile: the set is the whole state,
      // and adding a branch twice is the same as adding it once.
      if (request.method === "POST" && pathname === "/api/skips") {
        const body = await readJsonBody(request, MAX_BACKUP_BODY);
        return sendJson(
          response,
          200,
          await library.applySkips(readerProfileId, body)
        );
      }

      // One screen of the chronology: where you are, how you got there, the
      // collections below you and the comics filed at this level. The browser
      // builds this itself from the full library; a client on the compact
      // listing has none of the fields it needs, so the server walks it.
      if (request.method === "GET" && pathname === "/api/chronology") {
        const view = library.chronology(
          readerProfileId,
          requestUrl.searchParams.get("node")
        );
        if (!view) {
          throw jsonError("That collection is not in the chronology.", "NOT_FOUND");
        }
        return sendJson(response, 200, view);
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
        const catalog = createOpdsCatalog(
          library,
          requestUrl,
          baseUrl,
          readerProfileId
        );
        if (catalog) {
          // Every link the catalogue builds is absolute and rooted at `/opds`,
          // so restoring the prefix is an exact substitution on the href rather
          // than a guess. Titles and summaries are left alone.
          const body = Buffer.from(
            readerPathName
              ? catalog.body.replaceAll(
                  `href="${baseUrl}/opds`,
                  `href="${baseUrl}/opds/r/${encodeURIComponent(readerPathName)}`
                )
              : catalog.body
          );
          response.writeHead(200, {
            "Content-Type": `${catalog.type}; charset=utf-8`,
            "Content-Length": body.length,
            "Cache-Control": "private, no-cache"
          });
          return response.end(body);
        }
      }

      // The archive itself, for a client that downloads comics to read them
      // offline. Byte ranges and all, because a 4 GB comic on a phone network
      // has to be able to resume.
      //
      // The same file OPDS serves, under a first-party path: an app should not
      // have to reach into the catalogue namespace to fetch what it is already
      // authorized to read.
      const comicFileMatch = pathname.match(
        /^\/api\/comics\/([a-f0-9]{24})\/file$/
      );
      if (
        (request.method === "GET" || request.method === "HEAD") &&
        comicFileMatch
      ) {
        // `return await`, not `return`: returning a promise from inside a try
        // does not route its rejection to the catch below. Asking for a comic
        // that is not in the index throws NOT_FOUND, and without the await that
        // rejection escaped the handler entirely — no response was ever
        // written, and Node terminated the process on the unhandled rejection.
        // One request for an unknown id took the whole server down.
        return await serveComicArchive(
          request,
          response,
          library,
          comicFileMatch[1]
        );
      }

      const opdsComicMatch = pathname.match(
        /^\/opds\/comics\/([a-f0-9]{24})\/file$/
      );
      if (
        (request.method === "GET" || request.method === "HEAD") &&
        opdsComicMatch
      ) {
        // Awaited for the reason above: this route has had the same hole
        // since OPDS shipped in 0.3.9.
        return await serveComicArchive(
          request,
          response,
          library,
          opdsComicMatch[1]
        );
      }

      // One page at a time, for a reader that speaks the OPDS Page Streaming
      // Extension. Numbered from one, because the extension is, while
      // PanelShelf's own page route is numbered from zero. The translation
      // lives here rather than in either of them: the extension does not get to
      // renumber the internal API, and the internal API does not get to hand a
      // standard client an off-by-one.
      const opdsPageMatch = pathname.match(
        /^\/opds\/comics\/([a-f0-9]{24})\/pages\/(\d+)$/
      );
      if (request.method === "GET" && opdsPageMatch) {
        const pageNumber = Number(opdsPageMatch[2]);
        if (pageNumber < 1) {
          throw jsonError("Pages are numbered from one.", "NOT_FOUND");
        }
        const page = await library.page(opdsPageMatch[1], pageNumber - 1);
        response.writeHead(200, {
          "Content-Type": page.mime,
          "Content-Length": page.buffer.length,
          "Cache-Control": "private, max-age=3600",
          "X-Comic-Page-Count": String(page.pageCount)
        });
        return response.end(page.buffer);
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
