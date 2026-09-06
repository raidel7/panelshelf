"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");
const { jsonError } = require("./util");

// Unattended work, at an hour nobody is reading.
//
// A scan is the one job here with a real cost — it opens archives, it works the
// disk, and on a library of any size it is minutes of a NAS being busy. Doing
// it while somebody is reading is exactly what this exists to avoid, so the
// schedule is a time of day rather than an interval: "every six hours" lands in
// the middle of an evening sooner or later, and 03:00 never does.
//
// Checked once a minute rather than slept until. A single long timer is wrong
// on a machine that hibernates, that has its clock corrected, or that is simply
// asleep at the appointed minute; a poll that asks "has today's time passed and
// have we not run since" is right through all three, and catches up within the
// same day without ever piling up across days.

const CHECK_INTERVAL_MS = 60 * 1000;
const SCAN_ACTIONS = new Set(["quick", "full"]);

function defaultSchedule() {
  return {
    enabled: false,
    // Local time on the NAS, which is the clock the owner thinks in.
    time: "03:00",
    action: "quick",
    // Covers are generated on demand, so a library scanned overnight otherwise
    // pays for them a card at a time on the first browse of the morning.
    warmCovers: false,
    // Off by default and deliberately so: it calls third-party providers, and
    // starting that on a timer spends somebody's rate limit while they sleep.
    matchMetadata: false
  };
}

function parseTime(value) {
  // A single-digit hour is accepted and written back padded. This is set in a
  // text field and sometimes in a file by hand, and refusing "3:00" to insist
  // on "03:00" is pedantry with an error message attached.
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? "").trim());
  const hours = match ? Number(match[1]) : NaN;
  const minutes = match ? Number(match[2]) : NaN;
  if (!match || hours > 23 || minutes > 59) {
    throw jsonError("Give a time of day as HH:MM, from 00:00 to 23:59.", "INVALID_SCHEDULE");
  }
  return { hours, minutes };
}

function normalize(input, existing = defaultSchedule()) {
  const merged = { ...existing, ...(input && typeof input === "object" ? input : {}) };
  const { hours, minutes } = parseTime(merged.time);
  if (!SCAN_ACTIONS.has(merged.action)) {
    throw jsonError("A scheduled scan is either quick or full.", "INVALID_SCHEDULE");
  }
  return {
    enabled: merged.enabled === true,
    time: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
    action: merged.action,
    warmCovers: merged.warmCovers === true,
    matchMetadata: merged.matchMetadata === true
  };
}

// Today's appointment, in local time.
function dueAt(schedule, now) {
  const { hours, minutes } = parseTime(schedule.time);
  const due = new Date(now);
  due.setHours(hours, minutes, 0, 0);
  return due;
}

// The next one, which is today's if it has not passed and tomorrow's if it has.
function nextRunAt(schedule, now, lastRunAt) {
  const today = dueAt(schedule, now);
  if (now < today && (!lastRunAt || lastRunAt < today)) return today;
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow;
}

class ScanSchedule {
  constructor(dataDirectory, options = {}) {
    this.filePath = path.join(dataDirectory, "schedule.json");
    this.schedule = defaultSchedule();
    this.lastRunAt = null;
    this.lastResult = null;
    this.runs = 0;
    this.running = false;
    this.timer = null;
    // Injected so the runner is the library's business and the clock is the
    // test's.
    this.run = options.run || (async () => ({}));
    this.busy = options.busy || (() => false);
    this.now = options.now || (() => new Date());
  }

  async initialize() {
    try {
      const saved = JSON.parse(await fsp.readFile(this.filePath, "utf8"));
      this.schedule = normalize(saved?.schedule);
      this.lastRunAt = saved?.lastRunAt ? new Date(saved.lastRunAt) : null;
      if (Number.isNaN(this.lastRunAt?.getTime())) this.lastRunAt = null;
      this.runs = Number(saved?.runs) || 0;
      this.lastResult = saved?.lastResult || null;
    } catch (error) {
      if (error.code !== "ENOENT") {
        // A schedule nobody can read is a schedule that is off, which is the
        // safe way round: the alternative is a scan starting at an hour the
        // owner did not choose.
        console.warn(`Scheduled scanning reset: ${this.filePath} could not be read.`);
      }
      this.schedule = defaultSchedule();
    }
  }

  state() {
    const now = this.now();
    return {
      ...this.schedule,
      running: this.running,
      runs: this.runs,
      lastRunAt: this.lastRunAt ? this.lastRunAt.toISOString() : null,
      lastResult: this.lastResult,
      nextRunAt: this.schedule.enabled
        ? nextRunAt(this.schedule, now, this.lastRunAt).toISOString()
        : null
    };
  }

  async set(input) {
    this.schedule = normalize(input, this.schedule);
    await this.persist();
    return this.state();
  }

  async persist() {
    const snapshot = {
      schedule: this.schedule,
      lastRunAt: this.lastRunAt ? this.lastRunAt.toISOString() : null,
      lastResult: this.lastResult,
      runs: this.runs
    };
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await fsp.writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
    await fsp.rename(temporary, this.filePath);
  }

  // Whether this minute is the one. Separated from doing it so the decision can
  // be tested against a clock that does not have to be waited for.
  due(now = this.now()) {
    if (!this.schedule.enabled || this.running) return false;
    const today = dueAt(this.schedule, now);
    if (now < today) return false;
    // Ran already since today's appointment. This is what stops a scan every
    // minute for the rest of the day.
    if (this.lastRunAt && this.lastRunAt >= today) return false;
    return true;
  }

  async tick() {
    if (!this.due()) return null;
    // A scan somebody started by hand owns the machine. The appointment is not
    // moved for it — the next tick will find it still due and take it then.
    if (this.busy()) return null;

    this.running = true;
    const startedAt = this.now();
    try {
      const result = await this.run(this.schedule);
      this.lastResult = { at: startedAt.toISOString(), ok: true, ...result };
    } catch (error) {
      this.lastResult = {
        at: startedAt.toISOString(),
        ok: false,
        error: error.message
      };
      console.error(
        JSON.stringify({
          time: new Date().toISOString(),
          message: "Scheduled scan failed",
          error: error.stack || error.message
        })
      );
    } finally {
      // Stamped whether it worked or not. A job that fails every night must not
      // retry every minute all night.
      this.lastRunAt = startedAt;
      this.runs += 1;
      this.running = false;
      await this.persist().catch(() => {});
    }
    return this.lastResult;
  }

  start(intervalMs = CHECK_INTERVAL_MS) {
    if (this.timer) return this;
    this.timer = setInterval(() => {
      this.tick();
    }, intervalMs);
    this.timer.unref();
    return this;
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { ScanSchedule, defaultSchedule, normalize, nextRunAt, CHECK_INTERVAL_MS };
