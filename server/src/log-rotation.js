"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");

// A ceiling on the log, which is the last file here that grows without one.
//
// The shape of this is decided by who owns the file. The package's start script
// runs the server as `node server.js >> panelshelf.log 2>&1`, so the shell holds
// the descriptor and the server only ever writes to its own stdout. That is
// worth keeping: it means a V8 fatal error, a stack trace from a crash, and
// anything a child process prints all land in the same file as the ordinary
// log lines. A logger that owned its own file would lose exactly the output
// that matters most when something has gone wrong.
//
// So the file is not renamed — renaming would leave the shell's descriptor
// pointing at the renamed inode and the live log would vanish while the server
// carried on writing to a file nobody can find. It is copied aside and then
// truncated in place. The descriptor is opened append-only, so the next write
// lands at the new beginning. This is what logrotate calls copytruncate, and it
// has the same known cost: a line written between the copy and the truncate is
// lost. One line, once per rotation, against a log that otherwise fills the
// volume.

const DEFAULT_MAX_MB = 8;
const CHECK_INTERVAL_MS = 60 * 1000;

function maxBytesFromEnv(env = process.env) {
  const raw = env.PANELSHELF_LOG_MAX_MB;
  if (raw === undefined || raw === "") return DEFAULT_MAX_MB * 1024 * 1024;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    console.warn(
      `PANELSHELF_LOG_MAX_MB is not a number of megabytes (${raw}); ` +
        `using the default of ${DEFAULT_MAX_MB} MB.`
    );
    return DEFAULT_MAX_MB * 1024 * 1024;
  }
  // Zero turns the ceiling off, for somebody who would rather keep everything
  // and watch the disk themselves.
  return Math.floor(parsed) * 1024 * 1024;
}

class LogRotator {
  constructor(logPath, options = {}) {
    this.logPath = logPath;
    this.previousPath = `${logPath}.1`;
    this.maxBytes =
      options.maxBytes === undefined ? maxBytesFromEnv() : Number(options.maxBytes) || 0;
    this.rotations = 0;
    this.lastRotatedAt = null;
    this.timer = null;
    this.running = false;
  }

  state() {
    return {
      path: this.logPath,
      maxBytes: this.maxBytes,
      keptPath: this.maxBytes > 0 ? this.previousPath : null,
      rotations: this.rotations,
      lastRotatedAt: this.lastRotatedAt
    };
  }

  // Returns the size that was rotated away, or null when nothing was done.
  // Never throws: a log that cannot be rotated is not a reason to stop serving
  // comics, and the one place it would be reported is the log itself.
  async rotate() {
    if (!this.maxBytes || this.running) return null;
    this.running = true;
    try {
      let size;
      try {
        size = (await fsp.stat(this.logPath)).size;
      } catch (error) {
        // No log file at all is the ordinary case for a development run, where
        // output goes to a terminal.
        if (error.code !== "ENOENT") throw error;
        return null;
      }
      if (size <= this.maxBytes) return null;

      // Copied rather than moved, and the copy replaces whatever generation was
      // there before. One previous log is enough to cover a restart loop, which
      // is what anybody reading this is usually looking at.
      await fsp.copyFile(this.logPath, this.previousPath);
      await fsp.chmod(this.previousPath, 0o600).catch(() => {});
      await fsp.truncate(this.logPath, 0);

      this.rotations += 1;
      this.lastRotatedAt = new Date().toISOString();
      console.log(
        JSON.stringify({
          time: this.lastRotatedAt,
          message: "Log rotated",
          bytes: size,
          kept: this.previousPath
        })
      );
      return size;
    } catch (error) {
      console.error(
        JSON.stringify({
          time: new Date().toISOString(),
          message: "Log rotation failed",
          error: error.stack || error.message
        })
      );
      return null;
    } finally {
      this.running = false;
    }
  }

  // Only the timer. The check on the way up is the caller's, because it has to
  // happen before the server logs anything — see where this is started.
  start(intervalMs = CHECK_INTERVAL_MS) {
    if (this.timer || !this.maxBytes) return this;
    this.timer = setInterval(() => this.rotate(), intervalMs);
    // Never the reason the process stays alive.
    this.timer.unref();
    return this;
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}

function defaultLogPath(dataDirectory, env = process.env) {
  return env.PANELSHELF_LOG || path.join(dataDirectory, "panelshelf.log");
}

module.exports = { LogRotator, maxBytesFromEnv, defaultLogPath, DEFAULT_MAX_MB };
