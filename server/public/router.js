"use strict";

// Hash routing rather than pushState. public/ is served as plain static files
// with no SPA fallback, so a pushState URL would 404 the moment anyone
// refreshed or bookmarked one. The hash also buys back the Back button and
// linkable sections, neither of which this app had at all.
//
// Ten things that used to be modal dialogs are panels behind these routes now.
// The eight that stayed modal did so because they interrupt a flow rather than
// being somewhere you navigate to.
const panelShelf = (function setUpRouter() {
  const DEFAULT_PATH = "library";

  let currentPath = DEFAULT_PATH;

  function panelFor(path) {
    return document.querySelector(`[data-panel="${CSS.escape(path)}"]`);
  }

  function parseHash(raw) {
    // "#/orders/detail" -> "orders/detail". A path with no panel in the
    // document falls back to the library rather than showing an empty shell,
    // which is what a stale bookmark or a typo deserves.
    const path = String(raw || "").replace(/^#\/?/, "").replace(/\/+$/, "");
    return path && panelFor(path) ? path : DEFAULT_PATH;
  }

  function apply(path, { moveFocus }) {
    const previous = currentPath;
    currentPath = path;

    // A panel leaving the screen fires "close", so the three listeners app.js
    // already had on the dialogs it replaced keep working untouched — the
    // cover-cache poller still stops when you navigate away from Settings.
    const leaving = [];
    for (const panel of document.querySelectorAll("[data-panel]")) {
      const on = panel.dataset.panel === path;
      if (!on && !panel.hidden) leaving.push(panel);
      panel.hidden = !on;
    }
    for (const panel of leaving) panel.dispatchEvent(new Event("close"));

    // The nav highlights on the first segment, so "orders/detail" keeps
    // Reading orders lit rather than dropping the highlight entirely.
    const section = path.split("/")[0];
    for (const link of document.querySelectorAll("[data-route-link]")) {
      const on = link.dataset.routeLink === section;
      link.classList.toggle("active", on);
      // aria-current is what tells a screen reader which destination it is in;
      // the class is only paint.
      if (on) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }

    if (moveFocus) {
      // Focus the heading rather than the panel, so a screen reader announces
      // where it landed instead of reading the entire section aloud.
      const heading = document.querySelector(`[data-panel="${CSS.escape(path)}"] [data-panel-heading]`);
      if (heading) heading.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "auto" });
    }

    document.dispatchEvent(new CustomEvent("panelshelf:route", {
      detail: { path, previous, section }
    }));
  }

  function navigate(path) {
    const next = `#/${path}`;
    if (window.location.hash === next) {
      const already = panelFor(path);
      // Already here and already showing: nothing to do. Re-applying would
      // fire the route event again, and a panel that loads its data on arrival
      // would then load it forever — openSettingsSources() ends in showModal().
      if (already && !already.hidden) return;
      // Same hash fires no hashchange, but a caller still expects the panel to
      // appear: clicking Reading orders from inside an order, for instance.
      apply(parseHash(next), { moveFocus: true });
      return;
    }
    window.location.hash = next;
  }

  // A panel wearing just enough of <dialog>'s interface for the code that used
  // to open it. app.js calls .showModal(), .close() and reads .open in 46
  // places across these ten views; adapting them here keeps that code correct
  // and puts the routing semantics in one reviewable place instead of 46.
  function panel(path) {
    const element = panelFor(path);
    if (!element || element.dataset.panelAdapted === "true") return element;

    // Where dismissing this panel lands you. A sub-view goes back to its
    // section — closing an order returns to the order list, not the library.
    const closesTo = element.dataset.panelCloses || DEFAULT_PATH;

    Object.defineProperty(element, "open", {
      get: () => currentPath === path,
      configurable: true
    });
    element.showModal = () => navigate(path);
    element.close = () => {
      if (currentPath === path) navigate(closesTo);
    };
    element.dataset.panelAdapted = "true";
    return element;
  }

  function start() {
    window.addEventListener("hashchange", () => {
      apply(parseHash(window.location.hash), { moveFocus: true });
    });

    document.addEventListener("click", (event) => {
      const link = event.target instanceof Element
        ? event.target.closest("[data-route-link]")
        : null;
      if (!link) return;
      event.preventDefault();
      navigate(link.dataset.routeLink);
    });

    // No focus move on first paint: the page has only just loaded, and pulling
    // focus to a heading before the reader has looked at anything is
    // disorienting.
    apply(parseHash(window.location.hash), { moveFocus: false });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  return {
    navigate,
    panel,
    get path() { return currentPath; }
  };
})();
