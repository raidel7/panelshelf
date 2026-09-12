"use strict";

// Tooltips for the controls that cannot afford a visible label. A tooltip is a
// patch for a missing label, not a substitute for one: anything with room for a
// word gets the word instead, and only genuinely cramped controls carry
// data-tip. Otherwise learning the UI means hovering everything.
(function setUpTooltips() {
  // Delegated from the document rather than bound per element, because most of
  // the controls that need a tip are drawn by app.js after this file has run.
  const SHOW_DELAY_MS = 120;
  const EDGE_MARGIN = 8;
  const GAP = 8;

  const canHover = window.matchMedia("(hover: hover)").matches;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let bubble = null;
  let showTimer = 0;
  let current = null;

  function ensureBubble() {
    if (bubble) return bubble;
    bubble = document.createElement("div");
    bubble.className = "tooltip-bubble";
    // The tip duplicates an aria-label the control already carries, so a screen
    // reader must not read it a second time.
    bubble.setAttribute("aria-hidden", "true");
    if (reduceMotion) bubble.dataset.still = "true";
    document.body.append(bubble);
    return bubble;
  }

  function place(target) {
    const tip = ensureBubble();
    const anchor = target.getBoundingClientRect();
    const size = tip.getBoundingClientRect();

    // Above by default; below when there is not room, which is what happens to
    // anything in the first row of a dialog header.
    const above = anchor.top - size.height - GAP;
    const below = anchor.bottom + GAP;
    const top = above >= EDGE_MARGIN ? above : below;
    tip.dataset.side = above >= EDGE_MARGIN ? "above" : "below";

    const centred = anchor.left + anchor.width / 2 - size.width / 2;
    const maxLeft = window.innerWidth - size.width - EDGE_MARGIN;
    const left = Math.min(Math.max(centred, EDGE_MARGIN), Math.max(EDGE_MARGIN, maxLeft));

    tip.style.top = `${Math.round(top)}px`;
    tip.style.left = `${Math.round(left)}px`;
  }

  function show(target, immediate) {
    const text = target.getAttribute("data-tip");
    if (!text) return;
    current = target;
    const tip = ensureBubble();
    tip.textContent = text;

    const reveal = () => {
      if (current !== target) return;
      tip.dataset.visible = "true";
      place(target);
    };

    window.clearTimeout(showTimer);
    if (immediate) reveal();
    else showTimer = window.setTimeout(reveal, SHOW_DELAY_MS);
  }

  function hide() {
    window.clearTimeout(showTimer);
    current = null;
    if (bubble) delete bubble.dataset.visible;
  }

  function tipTarget(node) {
    return node instanceof Element ? node.closest("[data-tip]") : null;
  }

  if (canHover) {
    document.addEventListener("pointerover", (event) => {
      // Pointer rather than mouse so a stylus behaves, and skipped for touch
      // entirely: a tap has nowhere to hover from.
      if (event.pointerType === "touch") return;
      const target = tipTarget(event.target);
      if (target && target !== current) show(target, false);
    });

    document.addEventListener("pointerout", (event) => {
      const target = tipTarget(event.target);
      if (target && target === current) hide();
    });
  }

  // Keyboard users get the tip without the delay, but only on focus-visible —
  // a click leaves focus behind on the button, and a tip that lingers after a
  // click reads as a stuck overlay.
  document.addEventListener("focusin", (event) => {
    const target = tipTarget(event.target);
    if (target && target.matches(":focus-visible")) show(target, true);
  });

  document.addEventListener("focusout", hide);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hide();
  });

  // A tip is positioned against the viewport, so anything that moves the anchor
  // invalidates it. Cheaper to drop it than to track the anchor.
  window.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
})();
