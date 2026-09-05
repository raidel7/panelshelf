"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { WorkQueue } = require("../src/work-queue");

// Deferred rather than timed, so these assert ordering rather than racing it.
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveIt, rejectIt) => {
    resolve = resolveIt;
    reject = rejectIt;
  });
  return { promise, resolve, reject };
}

test("no more than the limit runs at once", async () => {
  const queue = new WorkQueue({ concurrency: 2 });
  const gates = [deferred(), deferred(), deferred(), deferred()];
  let live = 0;
  let peak = 0;

  const runs = gates.map((gate, index) =>
    queue.run(`job-${index}`, async () => {
      live += 1;
      peak = Math.max(peak, live);
      await gate.promise;
      live -= 1;
    })
  );

  // Nothing has been let go yet, so the limit is the only thing holding.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(live, 2, "two running");
  assert.equal(queue.state().queued, 2, "two waiting");

  for (const gate of gates) gate.resolve();
  await Promise.all(runs);
  assert.equal(peak, 2);
  assert.equal(queue.state().active, 0);
});

test("the same key runs once and both callers get the answer", async () => {
  // Two cards for the same comic, or a warm-up meeting a reader on it. Opening
  // the archive twice is the cost this avoids.
  const queue = new WorkQueue({ concurrency: 4 });
  let runs = 0;
  const gate = deferred();
  const task = async () => {
    runs += 1;
    await gate.promise;
    return "cover";
  };

  const first = queue.run("comic:1", task);
  const second = queue.run("comic:1", task);
  gate.resolve();

  assert.deepEqual(await Promise.all([first, second]), ["cover", "cover"]);
  assert.equal(runs, 1, "the work happened once");
  assert.equal(queue.state().coalesced, 1);
});

test("a duplicate that arrives while the first is still queued joins it", async () => {
  // The in-flight record has to be held from the moment the call arrives, not
  // from the moment it starts, or a queue full of the same comic queues the
  // same decode several times over.
  const queue = new WorkQueue({ concurrency: 1 });
  const blocker = deferred();
  const held = queue.run("other", () => blocker.promise);

  let runs = 0;
  const task = async () => {
    runs += 1;
    return "shared";
  };
  const first = queue.run("comic:1", task);
  const second = queue.run("comic:1", task);
  assert.equal(queue.state().queued, 1, "one entry, not two");

  blocker.resolve();
  await held;
  assert.deepEqual(await Promise.all([first, second]), ["shared", "shared"]);
  assert.equal(runs, 1);
});

test("different keys do not share a result", async () => {
  const queue = new WorkQueue({ concurrency: 2 });
  const [a, b] = await Promise.all([
    queue.run("comic:1", async () => "one"),
    queue.run("comic:2", async () => "two")
  ]);
  assert.equal(a, "one");
  assert.equal(b, "two");
  assert.equal(queue.state().coalesced, 0);
});

test("an unkeyed task is never coalesced", async () => {
  const queue = new WorkQueue({ concurrency: 2 });
  let runs = 0;
  await Promise.all([
    queue.run(null, async () => (runs += 1)),
    queue.run(null, async () => (runs += 1))
  ]);
  assert.equal(runs, 2);
});

test("the key is released, so the same work can be asked for again later", async () => {
  const queue = new WorkQueue({ concurrency: 2 });
  let runs = 0;
  const task = async () => (runs += 1);

  await queue.run("comic:1", task);
  await queue.run("comic:1", task);

  assert.equal(runs, 2, "a finished job is not a cached one");
});

test("a failure reaches its caller and does not stall the queue", async () => {
  // One unreadable archive must not stop every cover behind it.
  const queue = new WorkQueue({ concurrency: 1 });
  const failing = queue.run("bad", async () => {
    throw new Error("unreadable archive");
  });

  await assert.rejects(() => failing, /unreadable archive/);
  assert.equal(await queue.run("good", async () => "fine"), "fine");
  assert.equal(queue.state().failed, 1);
  assert.equal(queue.state().completed, 1);
});

test("a task that throws before it awaits rejects rather than escaping", async () => {
  const queue = new WorkQueue({ concurrency: 1 });
  await assert.rejects(
    () =>
      queue.run("sync", () => {
        throw new Error("thrown straight away");
      }),
    /thrown straight away/
  );
  assert.equal(queue.state().active, 0, "the slot was given back");
});

test("a coalesced caller that ignores a failure does not sink the process", async () => {
  // The shared promise is handed to every coalesced caller, so an unhandled
  // rejection on it would be the server's problem, not the caller's. The test
  // runner fails on an unhandled rejection, which is the assertion.
  const queue = new WorkQueue({ concurrency: 2 });
  const task = async () => {
    throw new Error("no pages");
  };
  const handled = queue.run("comic:1", task);
  queue.run("comic:1", task);

  await assert.rejects(() => handled, /no pages/);
  await new Promise((resolve) => setImmediate(resolve));
});

test("idle resolves once the queue has drained", async () => {
  const queue = new WorkQueue({ concurrency: 1 });
  const gate = deferred();
  const running = queue.run("slow", () => gate.promise);

  let drained = false;
  const idle = queue.idle().then(() => {
    drained = true;
  });
  assert.equal(drained, false, "not drained while work is in flight");

  gate.resolve();
  await running;
  await idle;
  assert.equal(drained, true);
});

test("idle on an empty queue resolves at once", async () => {
  await new WorkQueue().idle();
});

test("the queue reports how far behind it got", async () => {
  // A snapshot of `queued` taken after the fact always reads zero. The peak is
  // what says the shelf was waiting.
  const queue = new WorkQueue({ concurrency: 1 });
  const gate = deferred();
  const all = [queue.run("a", () => gate.promise)];
  for (const key of ["b", "c", "d"]) all.push(queue.run(key, async () => key));

  gate.resolve();
  await Promise.all(all);

  const state = queue.state();
  assert.equal(state.queued, 0);
  assert.equal(state.peakQueued, 3);
  assert.equal(state.completed, 4);
});

test("a nonsense concurrency falls back to the default", async () => {
  assert.equal(new WorkQueue({ concurrency: 0 }).concurrency, 2);
  assert.equal(new WorkQueue({ concurrency: -4 }).concurrency, 2);
  assert.equal(new WorkQueue({ concurrency: undefined }).concurrency, 2);
  assert.equal(new WorkQueue({ concurrency: "3" }).concurrency, 3);
  assert.equal(new WorkQueue({ concurrency: 2.7 }).concurrency, 2);
});
