"use strict";

// A ceiling on work that is expensive in a way Node does not throttle by
// itself.
//
// Generating a cover thumbnail opens an archive, reads a full-size page into
// memory, and decodes and re-encodes it in pure JavaScript. A shelf drawing
// sixty uncached cards issues sixty of those at once. The encode is
// synchronous, so the processor cost was always serialized by the event loop —
// but the sixty full-size page buffers were not, and they are the megabytes.
// This is a memory ceiling first and a politeness ceiling second, which is why
// a small number is the right one on a NAS that is also serving pages.
//
// Coalescing earns its place as much as the limit does. Two cards for the same
// comic, or a warm-up meeting a reader scrolling the same shelf, would open the
// same archive twice, decode the same page twice, and race to write the same
// file. Sharing one promise makes the second caller free.

const DEFAULT_CONCURRENCY = 2;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
}

class WorkQueue {
  constructor(options = {}) {
    this.concurrency = positiveInteger(options.concurrency, DEFAULT_CONCURRENCY);
    this.inFlight = new Map();
    this.waiting = [];
    this.active = 0;
    this.completed = 0;
    this.failed = 0;
    this.coalesced = 0;
    this.peakQueued = 0;
    this.idleWaiters = [];
  }

  // What the settings panel and the support bundle report. `peakQueued` is the
  // interesting one for a slow library: it says how far behind the shelf got,
  // which a snapshot of `queued` taken after the fact never shows.
  state() {
    return {
      concurrency: this.concurrency,
      active: this.active,
      queued: this.waiting.length,
      peakQueued: this.peakQueued,
      completed: this.completed,
      failed: this.failed,
      coalesced: this.coalesced
    };
  }

  run(key, task) {
    const keyed = key !== null && key !== undefined;
    // A key already in flight is the same work. Held from the moment the call
    // arrives rather than from the moment it starts, so a duplicate that turns
    // up while the first is still queued joins it instead of queueing a second
    // copy of the same decode.
    if (keyed) {
      const existing = this.inFlight.get(key);
      if (existing) {
        this.coalesced += 1;
        return existing;
      }
    }

    const promise = new Promise((resolve, reject) => {
      this.waiting.push(() => {
        this.active += 1;
        // `task` is allowed to throw synchronously; going through `resolve`
        // first puts that on the same path as a rejected promise.
        //
        // The outcome is captured rather than acted on, because the bookkeeping
        // has to happen before the caller is resolved. Releasing the key
        // afterwards — in a `finally`, say — leaves it in place for the whole
        // microtask in which the awaiting caller resumes, so a call arriving
        // right behind a finished one is handed the finished promise and its
        // work silently never runs. A queue is not a cache.
        Promise.resolve()
          .then(task)
          .then(
            (value) => ({ ok: true, value }),
            (error) => ({ ok: false, error })
          )
          .then((outcome) => {
            this.active -= 1;
            if (keyed) this.inFlight.delete(key);
            if (outcome.ok) {
              this.completed += 1;
              resolve(outcome.value);
            } else {
              this.failed += 1;
              reject(outcome.error);
            }
            this.pump();
          });
      });
    });

    if (keyed) this.inFlight.set(key, promise);
    // The shared copy is handed to every coalesced caller, and a caller that
    // ignores its rejection must not turn this into an unhandled one for the
    // process. Each real caller still sees the rejection on its own copy.
    promise.catch(() => {});
    if (this.waiting.length > this.peakQueued) this.peakQueued = this.waiting.length;
    this.pump();
    return promise;
  }

  pump() {
    // The thunk increments `active` synchronously, so this terminates.
    while (this.active < this.concurrency && this.waiting.length > 0) {
      this.waiting.shift()();
    }
    if (this.active === 0 && this.waiting.length === 0) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const resolve of waiters) resolve();
    }
  }

  // For a shutdown, or a test that needs the queue drained before it looks at
  // what the queue wrote.
  idle() {
    if (this.active === 0 && this.waiting.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }
}

module.exports = { WorkQueue, DEFAULT_CONCURRENCY };
