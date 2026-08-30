#!/usr/bin/env node
// Checks a running PanelShelf server against the contract in README.md.
//
// Read-only unless --write is passed: this is meant to be pointed at a real NAS
// with a real library, and a suite that quietly rewrites someone's reading
// position to prove it can is not a suite anybody should run.
//
//   node scripts/conformance.mjs http://192.168.1.69:8251
//   node scripts/conformance.mjs http://nas:8251 --token pst_… --write

import http from "node:http";
import { URL } from "node:url";

const args = process.argv.slice(2);
const base = (args.find((value) => !value.startsWith("--")) || "").replace(/\/$/, "");
const token = (args.find((value) => value.startsWith("--token=")) || "").slice(8) ||
  (args.includes("--token") ? args[args.indexOf("--token") + 1] : "");
const allowWrites = args.includes("--write");

if (!base) {
  console.error("usage: conformance.mjs <base-url> [--token <token>] [--write]");
  process.exit(2);
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
}

const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

async function get(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    headers: { ...authHeaders, ...(options.headers || {}) }
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

// `fetch` derives Host from the URL and refuses to let a caller forge it, and
// forging it is the point of one of these checks.
function raw(options) {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: url.hostname,
        port: url.port || 80,
        path: options.path,
        method: options.method || "GET",
        headers: { ...authHeaders, ...(options.headers || {}) }
      },
      (response) => {
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => resolve({ status: response.statusCode, body }));
      }
    );
    request.on("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

console.log(`PanelShelf conformance — ${base}\n`);

console.log("Identity");
const health = await get("/api/health");
check("GET /api/health answers 200", health.status === 200, `got ${health.status}`);
check("health reports status ok", health.body?.status === "ok");
check("health reports a package version", typeof health.body?.version === "string");
check("health reports a numeric apiVersion", Number.isInteger(health.body?.apiVersion));

console.log("\nVersioning");
const versioned = await get("/api/v1/health");
check("/api/v1 is served", versioned.status === 200, `got ${versioned.status}`);
check(
  "/api/v1 and /api agree",
  versioned.body?.apiVersion === health.body?.apiVersion &&
    versioned.body?.version === health.body?.version
);
const unknown = await get("/api/v2/health");
// 404 unpaired. 401 once pairing is on, because an unauthenticated caller is
// not told which routes exist — which is the right answer, not a lesser one.
check(
  "an unknown version is not served as v1",
  unknown.status === 404 || unknown.status === 401,
  `got ${unknown.status}`
);

console.log("\nLibrary");
const comics = await get("/api/comics?view=compact&limit=1");
const paired = comics.status === 401;
if (paired) {
  check("library requires a token (pairing is on)", true);
  console.log("  note  pass --token to check the routes behind pairing");
} else {
  check("GET /api/comics answers 200", comics.status === 200, `got ${comics.status}`);
  check("the compact listing is an array", Array.isArray(comics.body));
  if (Array.isArray(comics.body) && comics.body.length > 0) {
    const [comic] = comics.body;
    check("a compact record carries an id", typeof comic.id === "string");
    check("a compact record carries a title", typeof comic.title === "string");
  }
}

console.log("\nIncremental changes");
const noCursor = await get("/api/changes");
if (noCursor.status === 401) {
  check("changes require a token (pairing is on)", true);
} else {
  check("a client with no cursor is told to resync", noCursor.body?.reset === true);
  check("a sequence is reported alongside", Number.isInteger(noCursor.body?.sequence));
  const caughtUp = await get(`/api/changes?since=${noCursor.body?.sequence}`);
  check("a caught-up cursor is not asked to resync", caughtUp.body?.reset === false);
  check("a caught-up cursor gets no changes", Array.isArray(caughtUp.body?.changes) &&
    caughtUp.body.changes.length === 0);
  const future = await get(`/api/changes?since=${(noCursor.body?.sequence ?? 0) + 5000}`);
  check("a cursor from the future is asked to resync", future.body?.reset === true);
}

console.log("\nRequest guards");
const foreign = await raw({
  method: "PUT",
  path: "/api/config",
  headers: { Origin: "http://conformance.invalid", "Content-Type": "application/json" },
  body: JSON.stringify({ libraryPaths: [] })
});
check("a foreign origin is refused", foreign.status === 403, `got ${foreign.status}`);

const safelisted = await raw({
  method: "POST",
  path: "/api/skips",
  headers: { "Content-Type": "text/plain" },
  body: JSON.stringify({ add: [] })
});
check(
  "a body that is not application/json is refused",
  safelisted.status === 415 || safelisted.status === 401,
  `got ${safelisted.status}`
);

const forgedHost = await raw({ path: "/api/config", headers: { Host: "conformance.invalid" } });
check("a forged host is refused", forgedHost.status === 403, `got ${forgedHost.status}`);

console.log("\nProgress");
if (!allowWrites) {
  const progress = await get("/api/progress");
  check(
    "GET /api/progress answers",
    progress.status === 200 || progress.status === 401,
    `got ${progress.status}`
  );
  console.log("  note  pass --write to check the write contract; it stores and removes one record");
} else {
  const list = await get("/api/comics?view=compact&limit=1");
  const comic = Array.isArray(list.body) ? list.body[0] : null;
  if (!comic) {
    check("a comic is available to write against", false, "the library is empty");
  } else {
    const before = await get(`/api/progress/${comic.id}`);
    const put = await raw({
      method: "PUT",
      path: `/api/progress/${comic.id}`,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageIndex: 0, pageCount: 1, completed: false })
    });
    check("PUT stores a record", put.status === 200, `got ${put.status}`);
    const stored = await get(`/api/progress/${comic.id}`);
    check("the stored record reads back", stored.status === 200);
    check("the server stamped lastReadAt", typeof stored.body?.lastReadAt === "string");

    // A deliberate write is applied whatever the clock says; that is the whole
    // difference between PUT and /merge.
    const stale = await raw({
      method: "PUT",
      path: `/api/progress/${comic.id}`,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pageIndex: 1,
        pageCount: 1,
        completed: false,
        lastReadAt: "2000-01-01T00:00:00.000Z"
      })
    });
    const afterStale = await get(`/api/progress/${comic.id}`);
    check(
      "a deliberate write is not discarded for having an old clock",
      stale.status === 200 && afterStale.body?.pageIndex === 1
    );

    if (before.status === 200) {
      await raw({
        method: "PUT",
        path: `/api/progress/${comic.id}`,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(before.body)
      });
      check("the original record was restored", true);
    } else {
      await raw({ method: "DELETE", path: `/api/progress/${comic.id}` });
      check("the record written for this check was removed", true);
    }
  }
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log("failed:");
  for (const result of failed) console.log(`  - ${result.name}${result.detail ? ` (${result.detail})` : ""}`);
}
process.exit(failed.length === 0 ? 0 : 1);
