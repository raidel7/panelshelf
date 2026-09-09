"use strict";

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fsp = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");
const vm = require("node:vm");

const projectDirectory = path.resolve(__dirname, "../..");
const synologyDirectory = path.join(projectDirectory, "synology");

/// The window script, loaded with no DOM in scope so its bootstrap stays put
/// and the decisions inside it can be called directly.
async function loadWindowScript() {
  const source = await fsp.readFile(path.join(synologyDirectory, "ui/window.js"), "utf8");
  // `URL` is Node's, not V8's, so a fresh context does not have one and
  // `isReadyMessage` needs it to compare origins.
  const context = vm.createContext({ URL });
  new vm.Script(source, { filename: "window.js" }).runInContext(context);
  return context;
}

/// Enough of a browser for the wiring: the four elements the page has, a
/// clock that only moves when a test moves it, and a message channel a test
/// can post to. Nothing here is asynchronous, so nothing here can flake.
function fakeBrowser({ protocol, hostname }) {
  const element = () => ({ hidden: true, textContent: "", href: "", src: "" });
  const nodes = {
    frame: element(),
    fallback: element(),
    reason: element(),
    open: element()
  };
  const listeners = [];
  let timer = null;

  return {
    nodes,
    doc: { getElementById: (id) => nodes[id] },
    win: {
      location: { protocol, hostname },
      setTimeout(callback) {
        timer = callback;
        return 1;
      },
      clearTimeout() {
        timer = null;
      },
      addEventListener(type, callback) {
        if (type === "message") listeners.push(callback);
      }
    },
    post: (event) => listeners.forEach((callback) => callback(event)),
    stillWaiting: () => timer !== null,
    giveUp: () => {
      const callback = timer;
      timer = null;
      callback();
    }
  };
}

test("over plain HTTP the library is drawn in the DSM window", async () => {
  const { startPanelShelfWindow } = await loadWindowScript();
  const browser = fakeBrowser({ protocol: "http:", hostname: "nas.local" });

  const plan = startPanelShelfWindow(browser.doc, browser.win);

  assert.equal(plan.action, "embed");
  // The address comes from whatever name DSM was reached by. The same NAS is
  // `nas.local` to one person and an IP to another, and only the one they
  // used is guaranteed to resolve for them.
  assert.equal(browser.nodes.frame.src, "http://nas.local:8251/");
  assert.equal(browser.nodes.frame.hidden, false, "shown while it loads");
  assert.equal(browser.nodes.fallback.hidden, true);
  assert.ok(browser.stillWaiting(), "and watched, in case it never arrives");
});

test("the library announcing itself stops the window giving up on it", async () => {
  const { startPanelShelfWindow } = await loadWindowScript();
  const browser = fakeBrowser({ protocol: "http:", hostname: "nas.local" });
  startPanelShelfWindow(browser.doc, browser.win);

  browser.post({ origin: "http://nas.local:8251", data: { panelshelf: "ready" } });

  assert.ok(!browser.stillWaiting(), "the timeout is called off");
  assert.equal(browser.nodes.frame.hidden, false);
  assert.equal(browser.nodes.fallback.hidden, true);
});

test("only the library gets to say it is the library", async () => {
  const { startPanelShelfWindow } = await loadWindowScript();
  const browser = fakeBrowser({ protocol: "http:", hostname: "nas.local" });
  startPanelShelfWindow(browser.doc, browser.win);

  // postMessage is delivered to whoever is listening. Without the origin
  // check, anything that got itself into this frame could claim to have
  // loaded and keep the fallback from ever appearing.
  browser.post({ origin: "http://elsewhere.example", data: { panelshelf: "ready" } });
  browser.post({ origin: "http://nas.local:8251", data: { panelshelf: "no" } });
  browser.post({ origin: "http://nas.local:8251" });

  assert.ok(browser.stillWaiting(), "none of those counted");
});

test("a frame that never fills in becomes the button it used to be", async () => {
  const { startPanelShelfWindow } = await loadWindowScript();
  const browser = fakeBrowser({ protocol: "http:", hostname: "192.168.1.20" });
  startPanelShelfWindow(browser.doc, browser.win);

  browser.giveUp();

  assert.equal(browser.nodes.frame.hidden, true);
  assert.equal(browser.nodes.fallback.hidden, false);
  assert.match(browser.nodes.reason.textContent, /192\.168\.1\.20:8251/);
  // Which is exactly what the icon did before it opened a window at all, so
  // the worst this change can do is cost a click.
  assert.equal(browser.nodes.open.href, "http://192.168.1.20:8251/");
});

test("over HTTPS the window does not pretend it can frame plain HTTP", async () => {
  const { startPanelShelfWindow } = await loadWindowScript();
  const browser = fakeBrowser({ protocol: "https:", hostname: "nas.local" });

  const plan = startPanelShelfWindow(browser.doc, browser.win);

  // Decidable from the scheme alone, so it is decided rather than attempted:
  // a browser blocks an http frame inside an https page outright, and trying
  // it would spend the timeout showing an empty rectangle first.
  assert.equal(plan.action, "open");
  assert.equal(browser.nodes.frame.src, "", "never pointed at something that cannot load");
  assert.equal(browser.nodes.fallback.hidden, false);
  assert.equal(browser.nodes.open.href, "http://nas.local:8251/");
  assert.match(browser.nodes.reason.textContent, /HTTPS/);
  assert.ok(!browser.stillWaiting(), "nothing to wait for");
});

test("DSM is told to open a window rather than throw the browser into a tab", async () => {
  const [config, page, info] = await Promise.all([
    fsp.readFile(path.join(synologyDirectory, "ui/config"), "utf8"),
    fsp.readFile(path.join(synologyDirectory, "ui/index.html"), "utf8"),
    fsp.readFile(path.join(synologyDirectory, "INFO.template"), "utf8")
  ]);

  const app = JSON.parse(config)[".url"]["com.panelshelf.App"];
  assert.equal(app.type, "legacy", "Synology's word for a window rather than a pop-up");
  // Package Center links dsmuidir to /webman/3rdparty/[package name], so this
  // path is the package name and renaming the package moves the page out from
  // under the window without any other sign.
  const packageName = /^package="?([^"\n]+)"?$/m.exec(info)[1];
  assert.equal(app.url, `/webman/3rdparty/${packageName}/index.html`);
  assert.match(page, /src="window\.js"/);
  assert.match(page, /id="frame"/);
  assert.match(page, /id="fallback"/);
});

test("the package asks to be framed by DSM, and by nothing else", async () => {
  const script = await fsp.readFile(
    path.join(synologyDirectory, "scripts/start-stop-status"),
    "utf8"
  );
  const line = /export PANELSHELF_FRAME_ANCESTORS="([^"]*)"/.exec(script);
  assert.ok(line, "the start script names DSM's origins");
  assert.equal(line[1], "http://*:5000 https://*:5001");
  // Before the env file is read, not after: a DSM on a custom port has to be
  // able to say so, and so does somebody who would rather not be framed.
  assert.ok(
    script.indexOf("export PANELSHELF_FRAME_ANCESTORS") < script.indexOf("load_env_file\n"),
    "so a line in panelshelf.env still wins"
  );
});

test("the browser application tells a parent frame when it has loaded", async () => {
  const application = await fsp.readFile(
    path.join(projectDirectory, "server/public/app.js"),
    "utf8"
  );
  // The DSM window cannot see into this page and cannot tell a refused frame
  // from a slow one. This is the whole signal it has.
  assert.match(application, /window\.parent !== window/);
  assert.match(application, /postMessage\(\{ panelshelf: "ready" \}/);
});

test("the packaging validator agrees with all of it", async () => {
  // The same checks the build runs. Here too because the build only runs them
  // when it builds a package, and a change to any of the files above should
  // fail on the test that took two seconds rather than the one that took ten
  // minutes to produce three SPKs first.
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [path.join(projectDirectory, "scripts/validate-spk.mjs")],
    { cwd: projectDirectory }
  );
  assert.match(stdout, /SPK validation passed/);
});
