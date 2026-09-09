"use strict";

// The headers every response carries, and the one setting that changes them:
// who, if anyone, is allowed to put this page inside a frame.
//
// The default is nobody but ourselves, and that is not caution for its own
// sake. PanelShelf has no accounts — whatever can reach the port can read the
// library — so a page that can frame it can also lay itself over the top and
// take a click from somebody who already has it open. `X-Frame-Options:
// SAMEORIGIN` has been the answer since the first release and stays the
// answer when nothing is configured.
//
// The exception worth having is DSM. Installed as a package, PanelShelf gets
// an icon on the DSM desktop, and DSM draws a third-party app in an iframe
// served from its own origin — port 5000, or 5001 over TLS — which is not
// this server's. Naming that origin is what makes the DSM window work, and
// naming it explicitly is the difference between allowing one framer and
// allowing all of them.

const BASE_POLICY =
  "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; " +
  "script-src 'self'; connect-src 'self';";

// A CSP source expression and nothing wider: 'self', 'none', or an optional
// scheme followed by a host — possibly `*`, possibly `*.example` — and an
// optional port.
//
// Refusing anything else matters more than it looks. This value is written
// straight into a response header, and a header takes what it is given: a
// newline in the setting would be a way to append headers of somebody else's
// choosing to every response the server makes.
const SOURCE =
  /^(?:'self'|'none'|(?:https?:\/\/)?(?:\*|\*\.[A-Za-z0-9.-]+|[A-Za-z0-9.-]+)(?::(?:\d{1,5}|\*))?)$/;

/// The frame-ancestors sources in `raw`, or none at all if any of them is not
/// a source expression. All or nothing on purpose: a setting with a typo in it
/// should visibly not work, rather than half-work in a way nobody notices
/// until the frame it was meant to allow is the one that got dropped.
function frameAncestors(raw, warn = console.warn) {
  const tokens = String(raw || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return [];

  const rejected = tokens.filter((token) => !SOURCE.test(token));
  if (rejected.length > 0) {
    warn(
      `PANELSHELF_FRAME_ANCESTORS ignored: ${rejected.join(", ")} ` +
        `${rejected.length === 1 ? "is not" : "are not"} a host a page can be ` +
        `framed by. Expected something like "http://*:5000 https://*:5001". ` +
        `PanelShelf will refuse to be framed, as it does by default.`
    );
    return [];
  }

  // 'none' cannot share a list — the whole point of it is that it names no
  // origin — so it wins outright rather than being appended to 'self'.
  if (tokens.includes("'none'")) return ["'none'"];
  return ["'self'", ...tokens.filter((token) => token !== "'self'")];
}

/// The full header set for a given PANELSHELF_FRAME_ANCESTORS value.
function securityHeaders(raw, warn = console.warn) {
  const ancestors = frameAncestors(raw, warn);
  const headers = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": BASE_POLICY
  };

  if (ancestors.length === 0) {
    headers["X-Frame-Options"] = "SAMEORIGIN";
    return headers;
  }

  // And no X-Frame-Options beside it, deliberately. The two headers cannot be
  // made to say the same thing: SAMEORIGIN has no way to name a second origin,
  // so sending both would leave anything that honours the older header
  // blocking precisely the frame the newer one was added to allow.
  headers["Content-Security-Policy"] =
    `${BASE_POLICY} frame-ancestors ${ancestors.join(" ")};`;
  return headers;
}

module.exports = { BASE_POLICY, frameAncestors, securityHeaders };
