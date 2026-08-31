"use strict";

const { jsonError } = require("./util");

// How often one caller may guess a pairing code and be wrong.
//
// The code space already makes guessing hopeless: eight characters from a
// thirty-one letter alphabet is 852,891,037,441 codes, and each one lives five
// minutes. This is not what stands between the library and a stranger, and it
// is not pretending to be. What it is for is smaller and real — a client
// looping on a wrong code should not be allowed to spend the server's CPU on
// hashing forever, and a limit that can be stated in the documentation is
// worth more to a nervous reader than an arithmetic argument about 31^8.
//
// Two ceilings, because one is not enough. The per-caller ceiling is the one a
// person meets: ten wrong codes is far more than anyone mistypes. The global
// ceiling is the one an attacker meets, and it exists because a single IPv6
// host owns an entire /64 and can present a fresh address for every request —
// a per-address limit alone would be arithmetic that multiplies away.

const WINDOW_MS = 15 * 60 * 1000;
const PER_CLIENT_FAILURES = 10;
const GLOBAL_FAILURES = 100;
// An attacker who does have many prefixes should not also get an unbounded map
// out of it. Oldest key goes; being forgotten only ever grants a fresh budget
// to whoever was quietest, and the global ceiling still holds above it.
const MAX_TRACKED_CLIENTS = 1024;

// One household member is one key, however many addresses their machine holds.
//
// IPv6 hands a single host a whole /64 and modern stacks rotate through it by
// design, so keying on the full address would let one laptop look like billions
// of callers without meaning to deceive anyone. The first four groups are the
// prefix the network actually assigns, and that is the unit worth counting.
// IPv4 has no such slack, so it is counted whole.
function clientKey(request) {
  const address = request?.socket?.remoteAddress;
  if (typeof address !== "string" || !address) return "unknown";
  // Node reports an IPv4 peer on a dual-stack listener as ::ffff:192.168.1.5.
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return mapped[1];
  if (!address.includes(":")) return address;
  const groups = address.split("%")[0].split(":");
  return groups.slice(0, 4).join(":");
}

class AttemptLimiter {
  constructor(options = {}) {
    this.windowMs = Number.isFinite(options.windowMs) ? options.windowMs : WINDOW_MS;
    this.perClient = Number.isFinite(options.perClient)
      ? options.perClient
      : PER_CLIENT_FAILURES;
    this.globalLimit = Number.isFinite(options.global) ? options.global : GLOBAL_FAILURES;
    this.now = typeof options.now === "function" ? options.now : () => Date.now();
    this.byClient = new Map();
    this.all = [];
  }

  prune(stamps) {
    const cutoff = this.now() - this.windowMs;
    while (stamps.length && stamps[0] <= cutoff) stamps.shift();
    return stamps;
  }

  // Seconds until the oldest failure in the window falls out of it, which is
  // when the caller gets one attempt back. Rounded up, and never zero: a
  // Retry-After of 0 invites the immediate retry this is trying to prevent.
  retryAfter(stamps) {
    const oldest = stamps[0];
    if (!Number.isFinite(oldest)) return 1;
    return Math.max(1, Math.ceil((oldest + this.windowMs - this.now()) / 1000));
  }

  // Throws rather than returning false, because every caller of this is about
  // to do the expensive thing and the refusal has to interrupt it.
  check(key) {
    const mine = this.prune(this.byClient.get(key) || []);
    if (mine.length >= this.perClient) {
      throw this.refusal(this.retryAfter(mine));
    }
    this.prune(this.all);
    if (this.all.length >= this.globalLimit) {
      throw this.refusal(this.retryAfter(this.all));
    }
  }

  refusal(retryAfterSeconds) {
    const error = jsonError(
      "Too many pairing attempts. Generate a new pairing code and try again.",
      "TOO_MANY_PAIRING_ATTEMPTS"
    );
    error.retryAfterSeconds = retryAfterSeconds;
    return error;
  }

  // Only a genuinely wrong code lands here. A refused attempt is never
  // recorded: counting those would let a client that keeps hammering hold its
  // own window open forever, so the ban would outlive the burst that earned it
  // and a person who walked away for a minute would come back still blocked.
  fail(key) {
    const at = this.now();
    const mine = this.prune(this.byClient.get(key) || []);
    mine.push(at);
    this.byClient.set(key, mine);
    this.all.push(at);
    this.prune(this.all);
    if (this.byClient.size > MAX_TRACKED_CLIENTS) {
      const oldest = this.byClient.keys().next().value;
      if (oldest !== key) this.byClient.delete(oldest);
    }
  }

  // A fresh pairing code clears the slate.
  //
  // Once pairing is on, generating a code is itself a guarded route, so the
  // only person who can do this is one already holding a token — the owner,
  // standing at the browser, doing exactly what someone locked out would do.
  // Without it a stranger on the LAN could spend the global budget and leave
  // the household unable to pair a new tablet until the window drained.
  reset() {
    this.byClient.clear();
    this.all = [];
  }
}

module.exports = { AttemptLimiter, clientKey, WINDOW_MS, PER_CLIENT_FAILURES, GLOBAL_FAILURES };
