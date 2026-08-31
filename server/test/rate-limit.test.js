"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { AttemptLimiter, clientKey } = require("../src/rate-limit");

// A clock the test drives, so nothing here waits fifteen real minutes to find
// out whether the window drains.
function fakeClock(start = 1_000_000) {
  const state = { at: start };
  return {
    now: () => state.at,
    advance(ms) {
      state.at += ms;
    }
  };
}

function limiter(options = {}) {
  const clock = fakeClock();
  return {
    clock,
    limiter: new AttemptLimiter({
      windowMs: 60_000,
      perClient: 3,
      global: 5,
      now: clock.now,
      ...options
    })
  };
}

test("a caller gets its budget of wrong codes and then a refusal", () => {
  const { limiter: attempts } = limiter();

  for (let index = 0; index < 3; index += 1) {
    attempts.check("10.0.0.5");
    attempts.fail("10.0.0.5");
  }
  assert.throws(
    () => attempts.check("10.0.0.5"),
    (error) => error.code === "TOO_MANY_PAIRING_ATTEMPTS"
  );
});

test("one caller's mistakes do not refuse another's first attempt", () => {
  const { limiter: attempts } = limiter();
  for (let index = 0; index < 3; index += 1) attempts.fail("10.0.0.5");

  // The household's other tablet has typed nothing wrong and must not be told
  // to wait because someone else in the house fumbled a code.
  assert.doesNotThrow(() => attempts.check("10.0.0.6"));
});

test("the window drains and hands the budget back", () => {
  const { clock, limiter: attempts } = limiter();
  for (let index = 0; index < 3; index += 1) attempts.fail("10.0.0.5");
  assert.throws(() => attempts.check("10.0.0.5"));

  clock.advance(59_000);
  assert.throws(() => attempts.check("10.0.0.5"), /pairing attempts/i);
  clock.advance(2_000);
  assert.doesNotThrow(() => attempts.check("10.0.0.5"));
});

test("a refused attempt does not extend its own ban", () => {
  const { clock, limiter: attempts } = limiter();
  for (let index = 0; index < 3; index += 1) attempts.fail("10.0.0.5");

  // A client looping on a wrong code keeps meeting the refusal. If those
  // refusals counted, the ban would renew itself for as long as the loop ran
  // and outlive the burst that earned it by however long the client kept going.
  clock.advance(30_000);
  for (let index = 0; index < 20; index += 1) {
    assert.throws(() => attempts.check("10.0.0.5"));
  }
  clock.advance(31_000);
  assert.doesNotThrow(() => attempts.check("10.0.0.5"));
});

test("the global ceiling holds when every attempt comes from a fresh address", () => {
  const { limiter: attempts } = limiter();
  // Nobody exceeds their own budget; the point is that spreading the guesses
  // across addresses is exactly what an IPv6 host can do for free.
  for (let index = 0; index < 5; index += 1) attempts.fail(`10.0.0.${index}`);

  assert.throws(
    () => attempts.check("10.0.0.99"),
    (error) => error.code === "TOO_MANY_PAIRING_ATTEMPTS"
  );
});

test("a refusal says how long to wait, and never says zero", () => {
  const { clock, limiter: attempts } = limiter();
  for (let index = 0; index < 3; index += 1) attempts.fail("10.0.0.5");

  try {
    attempts.check("10.0.0.5");
    assert.fail("expected a refusal");
  } catch (error) {
    assert.equal(error.retryAfterSeconds, 60);
  }

  clock.advance(59_999);
  try {
    attempts.check("10.0.0.5");
    assert.fail("expected a refusal");
  } catch (error) {
    assert.equal(error.retryAfterSeconds, 1, "a Retry-After of 0 invites a retry now");
  }
});

test("a fresh pairing code clears the slate", () => {
  const { limiter: attempts } = limiter();
  for (let index = 0; index < 5; index += 1) attempts.fail(`10.0.0.${index}`);
  assert.throws(() => attempts.check("10.0.0.99"));

  attempts.reset();
  assert.doesNotThrow(() => attempts.check("10.0.0.99"));
  assert.doesNotThrow(() => attempts.check("10.0.0.0"));
});

test("the tracked-client map stays bounded", () => {
  const { limiter: attempts } = limiter({ global: 1_000_000 });
  for (let index = 0; index < 2_000; index += 1) attempts.fail(`10.0.${index}.1`);
  assert.ok(
    attempts.byClient.size <= 1024,
    `expected the map to stay bounded, saw ${attempts.byClient.size}`
  );
});

test("an IPv4 caller is counted whole, however it reaches the socket", () => {
  assert.equal(clientKey({ socket: { remoteAddress: "192.168.1.5" } }), "192.168.1.5");
  // A dual-stack listener reports an IPv4 peer this way, and it is the same
  // caller as the line above rather than a second one with a fresh budget.
  assert.equal(clientKey({ socket: { remoteAddress: "::ffff:192.168.1.5" } }), "192.168.1.5");
});

test("an IPv6 caller is counted by prefix, not by address", () => {
  // One host, three addresses — which is not an attack, it is how IPv6 privacy
  // extensions work by default. Counting them apart would make the per-caller
  // ceiling meaningless on any network that has IPv6 at all.
  const prefix = "2001:db8:1:2";
  for (const suffix of ["a::1", "b::2", "cafe::3"]) {
    assert.equal(
      clientKey({ socket: { remoteAddress: `${prefix}:${suffix}` } }),
      prefix
    );
  }
  // A link-local address carries a zone that is not part of the prefix.
  assert.equal(
    clientKey({ socket: { remoteAddress: "fe80::1c2d:3e4f:5a6b:7c8d%en0" } }),
    "fe80::1c2d:3e4f"
  );
  assert.equal(clientKey({ socket: {} }), "unknown");
  assert.equal(clientKey(null), "unknown");
});
