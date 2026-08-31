"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  TrustedProxies,
  canonical,
  clientAddress,
  isSecureRequest
} = require("../src/forwarded");

function request(remoteAddress, headers = {}) {
  return { socket: { remoteAddress }, headers };
}

test("nothing is trusted until the owner names it", () => {
  const none = new TrustedProxies("");
  assert.equal(none.configured, false);

  // The header is present, well formed, and says something plausible. It is
  // still ignored, because the request did not come from a proxy this server
  // has been told about — and a caller that can reach this port directly can
  // write whatever it likes there.
  assert.equal(
    clientAddress(request("192.168.1.9", { "x-forwarded-for": "203.0.113.7" }), none),
    "192.168.1.9"
  );
  assert.equal(
    isSecureRequest(request("192.168.1.9", { "x-forwarded-proto": "https" }), none),
    false
  );
});

test("a named proxy is believed", () => {
  const trusted = new TrustedProxies("10.0.0.2");
  assert.equal(trusted.configured, true);

  const forwarded = request("10.0.0.2", {
    "x-forwarded-for": "203.0.113.7",
    "x-forwarded-proto": "https"
  });
  assert.equal(clientAddress(forwarded, trusted), "203.0.113.7");
  assert.equal(isSecureRequest(forwarded, trusted), true);
});

test("loopback names a proxy running on the NAS itself", () => {
  const trusted = new TrustedProxies("loopback");
  for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    assert.equal(
      clientAddress(request(address, { "x-forwarded-for": "192.168.1.44" }), trusted),
      "192.168.1.44",
      address
    );
  }
  // A LAN neighbour is not loopback, whatever it puts in the header.
  assert.equal(
    clientAddress(request("192.168.1.9", { "x-forwarded-for": "192.168.1.44" }), trusted),
    "192.168.1.9"
  );
});

test("a forged prefix cannot move the caller", () => {
  const trusted = new TrustedProxies("10.0.0.2");
  // The caller wrote the first entry itself and the proxy appended the second.
  // Read right to left, the first untrusted hop is the caller's real address,
  // so inventing entries only buries the forgery further left where nothing
  // looks — the alternative, taking the leftmost, would let anybody choose
  // which bucket their pairing attempts are counted in.
  const spoofed = request("10.0.0.2", {
    "x-forwarded-for": "198.51.100.1, 203.0.113.7"
  });
  assert.equal(clientAddress(spoofed, trusted), "203.0.113.7");
});

test("a chain of trusted proxies is walked past", () => {
  const trusted = new TrustedProxies("10.0.0.2, 10.0.0.3");
  const chained = request("10.0.0.3", {
    "x-forwarded-for": "203.0.113.7, 10.0.0.2"
  });
  assert.equal(clientAddress(chained, trusted), "203.0.113.7");

  // And when every hop is one of ours, there is no caller to find in there.
  const internal = request("10.0.0.3", { "x-forwarded-for": "10.0.0.2" });
  assert.equal(clientAddress(internal, trusted), "10.0.0.3");
});

test("junk in the header is skipped rather than believed", () => {
  const trusted = new TrustedProxies("10.0.0.2");
  const junk = request("10.0.0.2", {
    "x-forwarded-for": "203.0.113.7, not-an-address"
  });
  assert.equal(clientAddress(junk, trusted), "203.0.113.7");

  const useless = request("10.0.0.2", { "x-forwarded-for": "  ,  " });
  assert.equal(clientAddress(useless, trusted), "10.0.0.2");
});

test("only https counts as secure, and only from a proxy we named", () => {
  const trusted = new TrustedProxies("10.0.0.2");
  const cases = [
    ["https", true],
    ["HTTPS", true],
    // The first hop is the one the browser actually spoke.
    ["https, http", true],
    ["http", false],
    ["", false]
  ];
  for (const [proto, expected] of cases) {
    assert.equal(
      isSecureRequest(request("10.0.0.2", { "x-forwarded-proto": proto }), trusted),
      expected,
      `x-forwarded-proto: ${proto}`
    );
  }
  // A direct TLS socket needs no header to be believed.
  assert.equal(isSecureRequest({ socket: { encrypted: true }, headers: {} }, trusted), true);
});

test("an address is the same address however it is written", () => {
  assert.equal(canonical("::ffff:192.168.1.5"), "192.168.1.5");
  assert.equal(canonical("[2001:db8::1]"), "2001:db8::1");
  assert.equal(canonical("fe80::1%en0"), "fe80::1");
  assert.equal(canonical("  10.0.0.2  "), "10.0.0.2");
  assert.equal(canonical(undefined), "");

  // Which matters because the owner writes one form in the variable and Node
  // reports another on the socket.
  const trusted = new TrustedProxies("192.168.1.5");
  assert.equal(trusted.has("::ffff:192.168.1.5"), true);
});

test("an unparseable entry in the variable is dropped, not trusted", () => {
  const trusted = new TrustedProxies("10.0.0.2, nonsense, , 10.0.0.4");
  assert.equal(trusted.has("10.0.0.2"), true);
  assert.equal(trusted.has("10.0.0.4"), true);
  assert.equal(trusted.has("nonsense"), false);
  assert.equal(new TrustedProxies("nonsense").configured, false);
});
