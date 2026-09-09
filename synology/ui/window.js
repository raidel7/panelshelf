"use strict";

// The page DSM draws inside the PanelShelf window on its desktop.
//
// DSM serves this file itself, from /webman/3rdparty/PanelShelf/, so it is
// always same-origin with the DSM desktop and always loads. The library it is
// standing in front of is not: that is this NAS on port 8251, a different
// origin, and whether a browser will draw it in here depends on something this
// page cannot control and must therefore check.
//
// Two things can stop it:
//
//   - DSM opened over HTTPS. A page served over https cannot frame one served
//     over http; browsers block that outright and offer no way past it.
//     PanelShelf speaks plain http, so this is not a maybe — it is decidable
//     up front, from the scheme in the address bar, and worth deciding up
//     front rather than showing an empty rectangle.
//
//   - The server refusing to be framed. It does by default; the package turns
//     that off for DSM's own ports. Someone running the server by hand, or
//     upgrading a package whose settings say otherwise, gets a refusal, and a
//     refused frame is opaque from out here: nothing is readable across the
//     origin and `onload` fires for the browser's own error page too. So the
//     library says when it has arrived, and silence is taken as a no.
//
// Either way the fallback is the same, and it is what this window did before
// it was a window: a button that opens the library in its own tab.

var PANELSHELF_PORT = 8251;

// Long enough for a NAS that has just woken its disks and is starting the
// server, short enough that nobody sits looking at a blank window wondering.
var READY_TIMEOUT_MS = 8000;

/// Where the library lives, as seen from whatever name DSM was reached by.
/// Taken from the address bar rather than written down, because the same NAS
/// is a hostname to one person, an IP to another and a .local name to a third,
/// and the one they used is the one that will resolve for them.
function panelshelfTarget(location, port) {
  return "http://" + location.hostname + ":" + (port || PANELSHELF_PORT) + "/";
}

/// What this window can do, given where it was loaded from.
function panelshelfPlan(location, port) {
  var target = panelshelfTarget(location, port);
  if (location.protocol === "https:") {
    return {
      action: "open",
      target: target,
      reason:
        "DSM is open over HTTPS and PanelShelf serves plain HTTP. A browser " +
        "will not draw an http page inside an https one, so the library opens " +
        "in a tab of its own."
    };
  }
  return { action: "embed", target: target, reason: "" };
}

/// True for the library announcing itself, and only for that. The origin is
/// checked because `postMessage` is delivered to whoever is listening: without
/// it, any page that got itself framed in here could claim to be the library.
function isReadyMessage(event, target) {
  if (!event || !event.data || event.data.panelshelf !== "ready") return false;
  try {
    return event.origin === new URL(target).origin;
  } catch (error) {
    return false;
  }
}

/// Wires the plan to the page. Split from the decision above so the decision
/// can be tested without a DOM, which is the only part with rules worth
/// getting wrong.
function startPanelShelfWindow(doc, win) {
  var frame = doc.getElementById("frame");
  var fallback = doc.getElementById("fallback");
  var reason = doc.getElementById("reason");
  var open = doc.getElementById("open");
  var plan = panelshelfPlan(win.location, PANELSHELF_PORT);

  open.href = plan.target;
  open.textContent = "Open PanelShelf";

  function showFallback(text) {
    reason.textContent = text;
    frame.hidden = true;
    fallback.hidden = false;
  }

  if (plan.action === "open") {
    showFallback(plan.reason);
    return plan;
  }

  var timer = win.setTimeout(function () {
    showFallback(
      "PanelShelf is not answering on " +
        plan.target +
        ", or is set to refuse being shown inside another page. It still " +
        "opens on its own."
    );
  }, READY_TIMEOUT_MS);

  // Listener before src, not after. The library announces itself the moment it
  // loads, and on a warm cache that can be the same turn the frame is given
  // its address -- a listener added afterwards would miss the one message it
  // exists to hear and time out in front of a working library.
  win.addEventListener("message", function (event) {
    if (!isReadyMessage(event, plan.target)) return;
    win.clearTimeout(timer);
    fallback.hidden = true;
    frame.hidden = false;
  });

  // Shown while it loads rather than held back until it answers. The frame is
  // the expected outcome, and hiding it until proven would mean staring at
  // nothing for a second on every open of a window that works perfectly well.
  frame.hidden = false;
  frame.src = plan.target;
  return plan;
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  startPanelShelfWindow(document, window);
}
