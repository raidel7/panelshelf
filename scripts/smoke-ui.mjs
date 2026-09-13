#!/usr/bin/env node
// Drives the browser client in a real browser: clicks, the Back button, hover,
// focus. server/test/ui.test.js reads the markup and runs slices of app.js in a
// vm, which is the right shape for the rendering and progress logic but cannot
// reach any of this — a route that never fires, a close button wired to the
// wrong panel and a tooltip that never appears all parse perfectly.
//
// Read-only, like conformance.mjs, and for the same reason: it is meant to be
// safe to point at a NAS with a real library on it. It opens the folder browser
// but never saves sources, never scans, and never writes reading progress.
//
//   npm run smoke:ui
//   node scripts/smoke-ui.mjs http://192.168.1.69:8251
//   CHROME="/path/to/chrome" node scripts/smoke-ui.mjs
//
// Exits non-zero on a failed check or on any console error raised during the
// run, so it can gate a release.

import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const base = (process.argv[2] || "http://127.0.0.1:8251").replace(/\/$/, "");
const DEBUG_PORT = 9222;

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
];

async function exists(candidate) {
  try {
    await fsp.access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function findChrome() {
  // An explicit CHROME is an instruction, not a hint: falling back to whatever
  // else is installed would run the checks against a browser nobody chose.
  if (process.env.CHROME) {
    if (await exists(process.env.CHROME)) return process.env.CHROME;
    console.error(`CHROME is set to ${process.env.CHROME}, which does not exist.`);
    process.exit(2);
  }
  for (const candidate of CHROME_CANDIDATES) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

async function waitFor(check, { attempts = 40, delayMs = 250, what }) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const value = await check();
      if (value) return value;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`timed out waiting for ${what}`);
}

// The page drives itself: one evaluation rather than a round trip per click,
// because the waits between a click and a repaint dominate otherwise.
const SCENARIO = `(async () => {
  const out = [];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shown = () => [...document.querySelectorAll("[data-panel]")]
    .filter((panel) => !panel.hidden).map((panel) => panel.dataset.panel);
  const navActive = () => [...document.querySelectorAll("[data-route-link].active")]
    .map((link) => link.dataset.routeLink);
  const check = (name, actual, expected) => out.push({
    name,
    actual: JSON.stringify(actual),
    expected: JSON.stringify(expected),
    ok: JSON.stringify(actual) === JSON.stringify(expected)
  });

  location.hash = "#/library";
  await wait(150);
  check("the library is where you land", shown(), ["library"]);

  document.querySelector('[data-route-link="orders"]').click();
  await wait(180);
  check("a nav link opens its destination", shown(), ["orders"]);
  check("and the nav marks it", navActive(), ["orders"]);
  check("with aria-current, not just a class",
    document.querySelector('[data-route-link="orders"]').getAttribute("aria-current"),
    "page");

  document.querySelector("#createOrderButton").click();
  await wait(180);
  check("New order opens the editor", shown(), ["orders/edit"]);
  check("a sub-panel keeps its section lit", navActive(), ["orders"]);

  document.querySelector(".close-order-editor").click();
  await wait(180);
  check("closing a sub-panel returns to its section, not the library",
    shown(), ["orders"]);

  history.back();
  await wait(250);
  check("Back reopens the editor", shown(), ["orders/edit"]);
  history.forward();
  await wait(250);
  check("Forward returns to the list", shown(), ["orders"]);

  document.querySelector(".close-orders").click();
  await wait(180);
  check("closing a section lands on the library", shown(), ["library"]);

  document.querySelector('[data-route-link="settings"]').click();
  await wait(300);
  check("Settings opens", shown(), ["settings"]);
  check("Settings holds five housekeeping cards, not the old ten concerns",
    document.querySelectorAll('[data-panel="settings"] .panel-content > section').length,
    5);

  // The cover-cache poller stops on this event. It was <dialog>'s close event;
  // the router fires it now, and app.js never noticed the difference.
  let closed = false;
  document.querySelector('[data-panel="settings"]')
    .addEventListener("close", () => { closed = true; }, { once: true });
  document.querySelector('[data-route-link="library"]').click();
  await wait(180);
  check("leaving a panel fires close, which is what stops the pollers",
    closed, true);

  document.querySelector('[data-route-link="sources"]').click();
  await wait(350);
  document.querySelector("#browseButton").click();
  await wait(450);
  const folder = document.querySelector("#folderDialog");
  check("a dialog that stayed modal is still a dialog", folder.tagName, "DIALOG");
  check("and still opens modally", folder.open, true);
  folder.close();
  await wait(150);
  check("dismissing it leaves the panel underneath alone", shown(), ["sources"]);

  const tipped = document.querySelector("[data-tip]");
  tipped.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
  await wait(350);
  const bubble = document.querySelector(".tooltip-bubble");
  check("hovering an icon-only control shows a tip", bubble?.dataset.visible, "true");
  check("the tip says what the control's label says",
    bubble?.textContent, tipped.getAttribute("aria-label"));
  check("and stays out of the accessibility tree, where the label already is",
    bubble?.getAttribute("aria-hidden"), "true");
  tipped.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse" }));
  await wait(150);
  check("it leaves on pointer out", bubble?.dataset.visible, undefined);

  location.hash = "#/nonsense/path";
  await wait(180);
  check("a stale bookmark falls back to the library rather than an empty shell",
    shown(), ["library"]);

  return out;
})()`;

const chrome = await findChrome();
if (!chrome) {
  console.error("No Chrome or Chromium found. Set CHROME=/path/to/chrome.");
  console.error("Tried:\n  " + CHROME_CANDIDATES.join("\n  "));
  process.exit(2);
}

try {
  await fetch(base, { signal: AbortSignal.timeout(3000) });
} catch {
  console.error(`No PanelShelf server answering at ${base}. Start one with: npm start`);
  process.exit(2);
}

const profile = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-smoke-"));
const browser = spawn(chrome, [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--no-first-run",
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`,
  base
], { stdio: "ignore" });

let exitCode = 0;
try {
  const target = await waitFor(async () => {
    const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    return list.find((entry) => entry.type === "page" && entry.url.startsWith(base));
  }, { what: "the page to open" });

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const consoleErrors = [];

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
      return;
    }
    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params.exceptionDetails;
      consoleErrors.push(details.exception?.description || details.text);
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      consoleErrors.push(
        message.params.args.map((arg) => arg.value ?? arg.description).join(" ")
      );
    }
  });

  const send = (method, params = {}) => {
    const id = nextId += 1;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
  };

  await send("Runtime.enable");
  const response = await send("Runtime.evaluate", {
    expression: SCENARIO,
    awaitPromise: true,
    returnByValue: true
  });

  const thrown = response.result?.exceptionDetails;
  if (thrown) throw new Error(thrown.exception?.description || thrown.text);

  const results = response.result.result.value;
  let failed = 0;
  console.log(`Driving ${base} in ${path.basename(chrome)}\n`);
  for (const result of results) {
    if (!result.ok) failed += 1;
    console.log(`  ${result.ok ? "PASS" : "FAIL"}  ${result.name}`);
    if (!result.ok) {
      console.log(`        expected ${result.expected}, got ${result.actual}`);
    }
  }
  console.log(`\n  ${results.length - failed}/${results.length} checks passed`);

  if (consoleErrors.length) {
    console.log("\n  Console errors raised during the run:");
    for (const error of consoleErrors) console.log(`    ${error}`);
  } else {
    console.log("  No console errors during the run");
  }

  socket.close();
  exitCode = failed || consoleErrors.length ? 1 : 0;
} catch (error) {
  console.error(`\n  smoke-ui failed: ${error.message}`);
  exitCode = 1;
} finally {
  browser.kill();
  await fsp.rm(profile, { recursive: true, force: true }).catch(() => {});
}

process.exit(exitCode);
