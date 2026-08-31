"use strict";

const net = require("node:net");

// What to believe about a request that did not arrive directly.
//
// Behind a reverse proxy every request comes from the proxy, so the socket
// address is the proxy's and the scheme is whatever the proxy used to reach
// this server — plain HTTP, usually, even when the browser is on HTTPS. The
// `X-Forwarded-*` headers carry the truth, and they are also trivially forged
// by any caller that can reach this port directly.
//
// So they are believed only from an address the owner has named, and by default
// the owner has named none. Getting this wrong in the trusting direction is
// worse than getting it wrong in the other: an unset variable means a proxied
// deployment counts pairing attempts against the proxy rather than the caller,
// while a variable set too widely means anyone can pick their own identity out
// of a header and have the count follow it.

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

// Node reports an IPv4 peer on a dual-stack listener as ::ffff:192.168.1.5,
// while the owner writes 192.168.1.5 in the variable and the proxy writes it
// in the header. All three are the same machine.
function canonical(address) {
  if (typeof address !== "string") return "";
  const trimmed = address.trim().replace(/^\[|\]$/g, "");
  if (!trimmed) return "";
  const mapped = trimmed.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  const bare = mapped ? mapped[1] : trimmed.split("%")[0];
  return bare.toLowerCase();
}

class TrustedProxies {
  // `loopback` covers the common case by name: a reverse proxy running on the
  // NAS itself, which is what DSM's own Application Portal does. Anything else
  // is written out as an address, because a proxy has a fixed one by
  // definition — you had to point it at this server to configure it.
  constructor(value) {
    this.addresses = new Set();
    this.loopback = false;
    for (const entry of String(value || "").split(",")) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      if (trimmed.toLowerCase() === "loopback") {
        this.loopback = true;
        continue;
      }
      const address = canonical(trimmed);
      if (address && net.isIP(address) !== 0) this.addresses.add(address);
    }
  }

  get configured() {
    return this.loopback || this.addresses.size > 0;
  }

  has(address) {
    const canonicalized = canonical(address);
    if (!canonicalized) return false;
    if (this.loopback && LOOPBACK.has(canonicalized)) return true;
    return this.addresses.has(canonicalized);
  }
}

// The caller's own address, as far as this server can honestly tell.
//
// Read right to left, skipping hops that are themselves trusted, because the
// right-hand end is the part each proxy appended and the left-hand end is
// whatever the original caller chose to send. A client that invents a header
// only moves itself further left, where nothing here looks.
function clientAddress(request, trusted) {
  const socketAddress = canonical(request?.socket?.remoteAddress);
  if (!trusted || !trusted.has(socketAddress)) return socketAddress;
  const forwarded = request?.headers?.["x-forwarded-for"];
  if (typeof forwarded !== "string") return socketAddress;
  const hops = forwarded.split(",").map(canonical).filter(Boolean);
  for (let index = hops.length - 1; index >= 0; index -= 1) {
    if (!trusted.has(hops[index]) && net.isIP(hops[index]) !== 0) return hops[index];
  }
  // Every hop was a proxy we trust, so the caller is one of them and the
  // socket address is as good an answer as any.
  return socketAddress;
}

// Whether the browser reached the proxy over HTTPS, which is what decides
// whether the device cookie can be marked Secure. Unproxied, or proxied by
// something the owner has not named, the answer is no — and a cookie that is
// wrongly Secure is never sent at all, so guessing yes would log everyone out.
function isSecureRequest(request, trusted) {
  if (request?.socket?.encrypted) return true;
  if (!trusted || !trusted.has(canonical(request?.socket?.remoteAddress))) return false;
  const proto = request?.headers?.["x-forwarded-proto"];
  if (typeof proto !== "string") return false;
  return proto.split(",")[0].trim().toLowerCase() === "https";
}

module.exports = { TrustedProxies, canonical, clientAddress, isSecureRequest };
