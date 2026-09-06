"use strict";

const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { LogRotator, maxBytesFromEnv, defaultLogPath } = require("../src/log-rotation");

async function logFile(t, bytes) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-log-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const logPath = path.join(directory, "panelshelf.log");
  if (bytes > 0) await fsp.writeFile(logPath, "l".repeat(bytes));
  return { logPath, directory };
}

// Rotation announces itself in the log it just rotated, which is correct and
// noisy in a test run.
function quiet(t) {
  const log = console.log;
  const error = console.error;
  const lines = [];
  console.log = (message) => lines.push(message);
  console.error = (message) => lines.push(message);
  t.after(() => {
    console.log = log;
    console.error = error;
  });
  return lines;
}

test("a log inside its ceiling is left alone", async (t) => {
  const { logPath } = await logFile(t, 500);
  quiet(t);
  const rotator = new LogRotator(logPath, { maxBytes: 1000 });

  assert.equal(await rotator.rotate(), null);
  assert.equal((await fsp.stat(logPath)).size, 500, "untouched");
});

test("a log over its ceiling is kept aside and emptied in place", async (t) => {
  // Not renamed. The package's start script owns the descriptor — the server
  // only writes to its own stdout — and a rename would leave that descriptor
  // pointing at the renamed file while the live log stayed empty for good.
  const { logPath } = await logFile(t, 4000);
  quiet(t);
  const rotator = new LogRotator(logPath, { maxBytes: 1000 });

  assert.equal(await rotator.rotate(), 4000);
  assert.equal((await fsp.stat(logPath)).size, 0, "the same file, emptied");
  assert.equal((await fsp.stat(`${logPath}.1`)).size, 4000, "and the old one kept");
});

test("only one previous log is kept, so two ceilings is the whole cost", async (t) => {
  const { logPath } = await logFile(t, 4000);
  quiet(t);
  const rotator = new LogRotator(logPath, { maxBytes: 1000 });

  await rotator.rotate();
  await fsp.writeFile(logPath, "n".repeat(4000));
  await rotator.rotate();

  const kept = await fsp.readFile(`${logPath}.1`, "utf8");
  assert.equal(kept.startsWith("n"), true, "the newer generation replaced the older");
  const directory = path.dirname(logPath);
  const files = (await fsp.readdir(directory)).filter((name) => name.includes("panelshelf.log"));
  assert.deepEqual(files.sort(), ["panelshelf.log", "panelshelf.log.1"]);
});

test("the kept log is no more readable than the live one", async (t) => {
  // It is the same content, and the live log is the server's own stdout.
  const { logPath } = await logFile(t, 4000);
  quiet(t);
  await new LogRotator(logPath, { maxBytes: 1000 }).rotate();

  const mode = (await fsp.stat(`${logPath}.1`)).mode & 0o777;
  assert.equal(mode, 0o600, `saw ${mode.toString(8)}`);
});

test("no log file at all is the ordinary case, not a failure", async (t) => {
  // Running from a terminal, where output never goes to a file.
  const { logPath } = await logFile(t, 0);
  quiet(t);
  assert.equal(await new LogRotator(logPath, { maxBytes: 1000 }).rotate(), null);
});

test("a ceiling of zero keeps everything", async (t) => {
  const { logPath } = await logFile(t, 4000);
  quiet(t);
  const rotator = new LogRotator(logPath, { maxBytes: 0 });

  assert.equal(await rotator.rotate(), null);
  assert.equal((await fsp.stat(logPath)).size, 4000);
  assert.equal(rotator.state().keptPath, null, "and says so");
});

test("a rotation that cannot happen does not take the server with it", async (t) => {
  // The one place this would be reported is the log, which is the thing that
  // is not working. Serving comics matters more.
  const { logPath, directory } = await logFile(t, 4000);
  const lines = quiet(t);
  const rotator = new LogRotator(logPath, { maxBytes: 1000 });
  // A directory where the kept copy wants to be: copyFile cannot overwrite it.
  await fsp.mkdir(`${logPath}.1`);

  assert.equal(await rotator.rotate(), null, "reported as nothing done");
  assert.equal((await fsp.stat(logPath)).size, 4000, "and the live log is untouched");
  assert.ok(
    lines.some((line) => String(line).includes("Log rotation failed")),
    "but it is not silent"
  );
  await fsp.rm(directory, { recursive: true, force: true });
});

test("what the support bundle is told about the ceiling", async (t) => {
  const { logPath } = await logFile(t, 4000);
  quiet(t);
  const rotator = new LogRotator(logPath, { maxBytes: 1000 });
  assert.equal(rotator.state().rotations, 0);
  assert.equal(rotator.state().lastRotatedAt, null);

  await rotator.rotate();

  const state = rotator.state();
  assert.equal(state.rotations, 1);
  assert.ok(state.lastRotatedAt, "when, so a tail starting mid-sentence is explained");
  assert.equal(state.maxBytes, 1000);
  assert.equal(state.keptPath, `${logPath}.1`);
});

test("the ceiling is read from the environment in megabytes", () => {
  assert.equal(maxBytesFromEnv({ PANELSHELF_LOG_MAX_MB: "32" }), 32 * 1024 * 1024);
  assert.equal(maxBytesFromEnv({ PANELSHELF_LOG_MAX_MB: "0" }), 0);
  assert.equal(maxBytesFromEnv({}), 8 * 1024 * 1024);

  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(maxBytesFromEnv({ PANELSHELF_LOG_MAX_MB: "big" }), 8 * 1024 * 1024);
  } finally {
    console.warn = warn;
  }
});

test("the log is looked for beside the data, which is where DSM puts it", () => {
  assert.equal(defaultLogPath("/var/packages/PanelShelf/var", {}),
    path.join("/var/packages/PanelShelf/var", "panelshelf.log"));
  assert.equal(defaultLogPath("/data", { PANELSHELF_LOG: "/tmp/other.log" }), "/tmp/other.log");
});

test("a check already running is not started twice", async (t) => {
  // The timer fires every minute and a copy of a large log can outlast that.
  const { logPath } = await logFile(t, 4000);
  quiet(t);
  const rotator = new LogRotator(logPath, { maxBytes: 1000 });

  const [first, second] = await Promise.all([rotator.rotate(), rotator.rotate()]);
  assert.equal(first, 4000);
  assert.equal(second, null, "the second stood aside");
  assert.equal(rotator.rotations, 1);
});

test("the timer never holds the process open", async (t) => {
  const { logPath } = await logFile(t, 100);
  quiet(t);
  const rotator = new LogRotator(logPath, { maxBytes: 1000 });
  rotator.start(50);
  t.after(() => rotator.stop());

  assert.ok(rotator.timer, "a timer is running");
  assert.equal(rotator.rotations, 0, "starting the timer does not itself rotate");
  assert.equal(rotator.timer.hasRef(), false, "and it is unref'd");
});

test("the package still starts the server with an appending redirect", async () => {
  // This is the coupling the whole design rests on, and it fails silently.
  //
  // Rotation empties the live file in place because the shell owns the
  // descriptor. That only works while the descriptor is append-only: every
  // write then lands at the new end of the file, which after a truncate is the
  // beginning. Opened with a single `>` instead, the descriptor keeps its own
  // offset, and writes after a truncate resume where they left off — leaving
  // the file the same size as before, its first several megabytes now zero
  // bytes. Rotation would appear to run and free nothing, and the log would
  // read as empty for as far as anyone scrolled.
  //
  // Measured, not assumed: `>` produced a 17,939-byte file of NULs where `>>`
  // produced 49 bytes of log.
  const script = await fsp.readFile(
    path.resolve(__dirname, "../../synology/scripts/start-stop-status"),
    "utf8"
  );
  const launch = script
    .split("\n")
    .find((line) => line.includes("SERVER_FILE") && line.includes("LOG_FILE"));

  assert.ok(launch, "the server is still launched with its output redirected to the log");
  assert.match(launch, />>\s*"\$\{LOG_FILE\}"/, launch.trim());
  assert.doesNotMatch(launch, /[^>]>\s*"\$\{LOG_FILE\}"/, "a single > breaks rotation silently");
});
