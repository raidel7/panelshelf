"use strict";

const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ScanSchedule, defaultSchedule, normalize, nextRunAt } = require("../src/schedule");

// A clock the test moves by hand. Nothing here waits for a real minute.
function clockAt(iso) {
  const held = { now: new Date(iso) };
  return {
    read: () => held.now,
    set: (next) => {
      held.now = new Date(next);
    }
  };
}

async function schedule(t, options = {}) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-schedule-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const created = new ScanSchedule(directory, options);
  await created.initialize();
  return { created, directory };
}

test("scheduled scanning is off until it is turned on", async (t) => {
  // It works the disk for minutes. Nobody's NAS should start doing that because
  // they upgraded.
  const { created } = await schedule(t);
  assert.equal(created.schedule.enabled, false);
  assert.equal(created.state().nextRunAt, null);
});

test("a time of day is the unit, and it has to be one", () => {
  // Written back padded, because it is typed by hand as often as it is picked.
  assert.equal(normalize({ time: "3:00" }).time, "03:00");
  assert.equal(normalize({ time: "23:59" }).time, "23:59");
  assert.equal(normalize({ time: " 07:15 " }).time, "07:15");
  for (const bad of ["24:00", "12:60", "noon", "", "1200", null, "3:5"]) {
    assert.throws(() => normalize({ time: bad }), /HH:MM/, `${bad} is not a time`);
  }
});

test("a scheduled scan is either quick or full", () => {
  assert.equal(normalize({ action: "full" }).action, "full");
  assert.throws(() => normalize({ action: "retry" }), /quick or full/);
  assert.throws(() => normalize({ action: "source" }), /quick or full/);
});

test("metadata matching is off unless it is asked for", () => {
  // It calls third-party providers. Starting that on a timer spends somebody's
  // rate limit while they are asleep.
  assert.equal(defaultSchedule().matchMetadata, false);
  assert.equal(normalize({}).matchMetadata, false);
  assert.equal(normalize({ matchMetadata: true }).matchMetadata, true);
});

test("the next run is today's appointment until it passes, then tomorrow's", () => {
  const plan = normalize({ enabled: true, time: "03:00" });
  const morning = new Date("2026-09-06T01:00:00");
  const afternoon = new Date("2026-09-06T14:00:00");

  assert.equal(nextRunAt(plan, morning, null).getDate(), 6);
  assert.equal(nextRunAt(plan, morning, null).getHours(), 3);
  assert.equal(nextRunAt(plan, afternoon, null).getDate(), 7, "tomorrow, once it has gone");
});

test("the hour comes round and the work is done once", async (t) => {
  const clock = clockAt("2026-09-06T02:59:00");
  let runs = 0;
  const { created } = await schedule(t, {
    now: clock.read,
    run: async () => {
      runs += 1;
      return { foundComics: 12 };
    }
  });
  await created.set({ enabled: true, time: "03:00" });

  assert.equal(await created.tick(), null, "not yet");
  assert.equal(runs, 0);

  clock.set("2026-09-06T03:00:30");
  const result = await created.tick();
  assert.equal(result.ok, true);
  assert.equal(result.foundComics, 12);
  assert.equal(runs, 1);

  // And not again for the rest of the day, which is the whole point of asking
  // "have we run since today's time" rather than "is it 03:00 now".
  for (const minute of ["03:01:00", "07:00:00", "23:59:00"]) {
    clock.set(`2026-09-06T${minute}`);
    assert.equal(await created.tick(), null, minute);
  }
  assert.equal(runs, 1);

  clock.set("2026-09-07T03:00:10");
  await created.tick();
  assert.equal(runs, 2, "and again the next day");
});

test("a missed hour is caught up within the same day, never across days", async (t) => {
  // A NAS that was asleep at three should still scan when it wakes at seven.
  // One that was off for a week should not do seven scans on the way back.
  const clock = clockAt("2026-09-06T07:00:00");
  let runs = 0;
  const { created } = await schedule(t, { now: clock.read, run: async () => (runs += 1) });
  await created.set({ enabled: true, time: "03:00" });

  await created.tick();
  assert.equal(runs, 1, "caught up");

  clock.set("2026-09-10T07:00:00");
  await created.tick();
  assert.equal(runs, 2, "and only once for the days it missed");
});

test("a scan somebody started by hand keeps the machine", async (t) => {
  const clock = clockAt("2026-09-06T03:00:10");
  let runs = 0;
  let busy = true;
  const { created } = await schedule(t, {
    now: clock.read,
    busy: () => busy,
    run: async () => (runs += 1)
  });
  await created.set({ enabled: true, time: "03:00" });

  assert.equal(await created.tick(), null);
  assert.equal(runs, 0, "it waited");

  // The appointment was not moved for it: the next tick still finds it due.
  busy = false;
  clock.set("2026-09-06T03:04:00");
  await created.tick();
  assert.equal(runs, 1);
});

test("a job that fails is recorded and not retried every minute all night", async (t) => {
  const clock = clockAt("2026-09-06T03:00:10");
  let runs = 0;
  const errors = [];
  const error = console.error;
  console.error = (line) => errors.push(line);
  t.after(() => {
    console.error = error;
  });

  const { created } = await schedule(t, {
    now: clock.read,
    run: async () => {
      runs += 1;
      throw new Error("the disk went away");
    }
  });
  await created.set({ enabled: true, time: "03:00" });

  const result = await created.tick();
  assert.equal(result.ok, false);
  assert.match(result.error, /disk went away/);
  assert.ok(errors.some((line) => String(line).includes("Scheduled scan failed")));

  clock.set("2026-09-06T03:01:00");
  await created.tick();
  assert.equal(runs, 1, "tomorrow, not in sixty seconds");
});

test("the schedule and what it has done survive a restart", async (t) => {
  const clock = clockAt("2026-09-06T04:30:10");
  const { created, directory } = await schedule(t, { now: clock.read, run: async () => ({ foundComics: 3 }) });
  await created.set({ enabled: true, time: "04:30", action: "full", warmCovers: true });
  await created.tick();

  const reopened = new ScanSchedule(directory, { now: clock.read });
  await reopened.initialize();
  const state = reopened.state();

  assert.equal(state.enabled, true);
  assert.equal(state.time, "04:30");
  assert.equal(state.action, "full");
  assert.equal(state.warmCovers, true);
  assert.equal(state.runs, 1);
  assert.ok(state.lastRunAt, "and what it last did");
  assert.equal(state.lastResult.foundComics, 3);
});

test("a schedule file nobody can read resets to off, not to some other hour", async (t) => {
  // The alternative is a scan starting at an hour the owner did not choose.
  const { created, directory } = await schedule(t);
  await created.set({ enabled: true, time: "03:00" });
  await fsp.writeFile(path.join(directory, "schedule.json"), "{ not json");

  const warn = console.warn;
  console.warn = () => {};
  try {
    const reopened = new ScanSchedule(directory);
    await reopened.initialize();
    assert.equal(reopened.schedule.enabled, false);
    assert.equal(reopened.schedule.time, "03:00", "the default, which is also the default");
  } finally {
    console.warn = warn;
  }
});

test("the timer never holds the process open", async (t) => {
  const { created } = await schedule(t);
  created.start(50);
  t.after(() => created.stop());
  assert.equal(created.timer.hasRef(), false);
});
