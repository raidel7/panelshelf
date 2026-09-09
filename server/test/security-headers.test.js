"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { BASE_POLICY, frameAncestors, securityHeaders } = require("../src/security-headers");

function quietly(raw) {
  const warnings = [];
  const headers = securityHeaders(raw, (message) => warnings.push(message));
  return { headers, warnings };
}

test("with nothing configured the headers are the ones every release has sent", () => {
  const { headers, warnings } = quietly(undefined);
  assert.deepEqual(headers, {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy":
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; " +
      "script-src 'self'; connect-src 'self';"
  });
  assert.deepEqual(warnings, [], "and nothing is said about it");
  // The default is the whole safety argument for the feature: a server with no
  // accounts, framed by a page of somebody else's choosing, is a click waiting
  // to be taken. Turning framing on has to be something an owner did.
  assert.ok(!headers["Content-Security-Policy"].includes("frame-ancestors"));
});

test("naming DSM's ports lets DSM draw the page, and only DSM", () => {
  const { headers, warnings } = quietly("http://*:5000 https://*:5001");
  assert.equal(
    headers["Content-Security-Policy"],
    `${BASE_POLICY} frame-ancestors 'self' http://*:5000 https://*:5001;`
  );
  assert.deepEqual(warnings, []);
  // Both headers together would contradict each other: SAMEORIGIN cannot name
  // a second origin, so anything honouring it would block the very frame the
  // policy beside it just allowed.
  assert.ok(
    !("X-Frame-Options" in headers),
    "X-Frame-Options is dropped rather than left to argue with the policy"
  );
});

test("a value that is not a list of hosts is refused rather than passed through", () => {
  // Every one of these is a way of writing a header the owner did not ask for,
  // or a policy wider than the one they typed. The header takes what it is
  // given, so the checking has to happen here.
  for (const attack of [
    "http://nas:5000\r\nX-Frame-Options: ALLOWALL",
    "http://nas:5000; script-src 'unsafe-inline'",
    "javascript:alert(1)",
    "http://nas:5000 data:",
    "'unsafe-inline'"
  ]) {
    const { headers, warnings } = quietly(attack);
    assert.equal(
      headers["X-Frame-Options"],
      "SAMEORIGIN",
      `${JSON.stringify(attack)} falls back to refusing frames`
    );
    assert.ok(
      !headers["Content-Security-Policy"].includes("frame-ancestors"),
      `${JSON.stringify(attack)} contributes nothing to the policy`
    );
    assert.equal(warnings.length, 1, `${JSON.stringify(attack)} says why`);
    assert.match(warnings[0], /PANELSHELF_FRAME_ANCESTORS/);
  }
});

test("one bad host spoils the list rather than half of it", () => {
  // All or nothing on purpose. A typo that silently dropped one entry would
  // leave a setting that looks applied and is not, and the entry most likely
  // to be mistyped is the one somebody added on purpose.
  const { headers, warnings } = quietly("http://*:5000 ftp://nas:21");
  assert.equal(headers["X-Frame-Options"], "SAMEORIGIN");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /ftp:\/\/nas:21/, "and names the one it could not read");
  assert.ok(
    !headers["Content-Security-Policy"].includes("http://*:5000"),
    "the good half is dropped with the bad"
  );
});

test("a bare word is a hostname, because to a browser it is one", () => {
  // `localhost` has no dots either. Refusing an undotted name would refuse the
  // most common thing anybody types here.
  assert.deepEqual(frameAncestors("localhost:5000"), ["'self'", "localhost:5000"]);
});

test("the shapes a host can take, and what 'none' does to the rest", () => {
  assert.deepEqual(frameAncestors("http://nas.local:5000"), [
    "'self'",
    "http://nas.local:5000"
  ]);
  assert.deepEqual(frameAncestors("https://*.example.com"), ["'self'", "https://*.example.com"]);
  assert.deepEqual(frameAncestors("192.168.1.10:5000"), ["'self'", "192.168.1.10:5000"]);
  // 'self' is already there; asking for it twice should not write it twice.
  assert.deepEqual(frameAncestors("'self'"), ["'self'"]);
  // 'none' means no origin at all, so it cannot sit in a list beside one.
  assert.deepEqual(frameAncestors("'none' http://*:5000"), ["'none'"]);
  assert.deepEqual(frameAncestors("   "), []);
});
