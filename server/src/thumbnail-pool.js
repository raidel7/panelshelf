"use strict";

const os = require("node:os");
const path = require("node:path");
const { Worker } = require("node:worker_threads");

const { UnsupportedImageError, createThumbnail } = require("./thumbnail");

// Thumbnails, made somewhere other than the event loop.
//
// Building one opens no files and awaits nothing: it decodes a full-size page,
// scales it and re-encodes it, all synchronously and all in JavaScript. On the
// NAS this was measured on that is about a second of held loop per cover, and
// the server answers nothing at all while it runs — a request for /api/health
// during a run of them came back in 8.7 seconds, against 4 milliseconds idle.
// Browsing into a chronology branch nobody had opened before asks for twenty of
// them at once, which is the stall.
//
// Raising the queue's concurrency never fixed that and could not: the decode is
// synchronous, so more of them at once still means one at a time, just with the
// loop held for longer. The work has to leave the thread. Once it has, the
// concurrency is real, and a machine with cores gets to use them.

const WORKER_FILE = path.join(__dirname, "thumbnail-worker.js");

// Four is the ceiling because the gain past it is small next to what it costs:
// each worker holds a full-size decoded page while it works, and that is the
// megabytes. The memory term is what keeps a value ARM box — cores it has,
// memory it does not — from being sized like a rack server.
const MAX_WORKERS = 4;
const BYTES_PER_WORKER = 1024 * 1024 * 1024;
const DEFAULT_IDLE_MS = 30_000;

function defaultPoolSize(env = process.env, machine = {}) {
  const raw = env.PANELSHELF_THUMBNAIL_WORKERS;
  const cpus = Number.isFinite(machine.cpus) ? machine.cpus : os.availableParallelism();
  const memoryBytes = Number.isFinite(machine.memoryBytes)
    ? machine.memoryBytes
    : os.totalmem();

  if (raw !== undefined && raw !== "") {
    const parsed = Number(raw);
    // Zero is a real choice — it says "make them on the main thread, the way
    // every build before this one did" — so it is honoured, and only a value
    // that means nothing falls through to the default.
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
    console.warn(
      `PANELSHELF_THUMBNAIL_WORKERS is not a number of threads (${raw}); ` +
        `sizing the pool for this machine instead.`
    );
  }

  // One core is left to the event loop: the point of this is that the server
  // stays answerable while covers are made, and taking every core back would
  // give that up in a different way.
  return Math.max(
    1,
    Math.min(MAX_WORKERS, cpus - 1, Math.floor(memoryBytes / BYTES_PER_WORKER))
  );
}

function unsupported(message) {
  return new UnsupportedImageError(message);
}

class ThumbnailPool {
  constructor(options = {}) {
    this.size =
      options.size === undefined
        ? defaultPoolSize()
        : Math.max(0, Math.floor(Number(options.size) || 0));
    this.idleMs = Number.isFinite(options.idleMs) ? options.idleMs : DEFAULT_IDLE_MS;
    // Workers are started on the first cover rather than at boot. A server
    // nobody is browsing should not be holding threads, and most restarts are
    // followed by nothing at all.
    this.workers = [];
    this.waiting = [];
    this.pending = new Map();
    this.nextId = 1;
    this.idleTimer = null;
    this.closed = false;
  }

  stats() {
    return {
      size: this.size,
      workers: this.workers.length,
      busy: this.workers.filter((worker) => worker.jobs > 0).length,
      queued: this.waiting.length
    };
  }

  // Returns { buffer, mime, width, height }, or null when the cover is already
  // small enough to serve as it is. Throws UnsupportedImageError for a format
  // the decoder does not read — the same contract as calling createThumbnail
  // directly, which is what this falls back to when there are no workers.
  async createThumbnail(buffer) {
    if (this.size === 0 || this.closed) return createThumbnail(buffer);
    let worker;
    try {
      worker = this.claim();
    } catch (error) {
      // A machine that will not give us a thread is not a machine that cannot
      // show covers. Say so once, then carry on the slow way.
      if (!this.warnedAboutWorkers) {
        this.warnedAboutWorkers = true;
        console.warn(
          `PanelShelf could not start a thumbnail worker (${error.message}); ` +
            `covers will be built on the main thread instead.`
        );
      }
      this.size = 0;
      return createThumbnail(buffer);
    }

    const id = this.nextId++;
    worker.jobs += 1;
    this.stopIdleTimer();
    try {
      return await new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        worker.thread.postMessage({ id, buffer });
      });
    } finally {
      worker.jobs -= 1;
      this.scheduleIdleShutdown();
    }
  }

  // The least busy worker, starting a new one while the pool is under size.
  // Round-robin would do as well; this keeps a single slow cover from holding
  // up a request that could have gone elsewhere.
  claim() {
    if (this.workers.length < this.size) return this.start();
    let chosen = this.workers[0];
    for (const worker of this.workers) {
      if (worker.jobs < chosen.jobs) chosen = worker;
    }
    return chosen;
  }

  start() {
    const thread = new Worker(WORKER_FILE);
    const worker = { thread, jobs: 0 };
    thread.on("message", (message) => this.settle(message));
    thread.on("error", (error) => this.fail(worker, error));
    // A worker that exits with work outstanding has taken those answers with
    // it. Failing them is what lets the request return an error instead of
    // hanging until the browser gives up.
    thread.on("exit", () => {
      this.forget(worker);
      if (worker.jobs > 0) this.fail(worker, new Error("The thumbnail worker stopped."));
    });
    thread.unref();
    this.workers.push(worker);
    return worker;
  }

  settle(message) {
    const waiter = this.pending.get(message.id);
    if (!waiter) return;
    this.pending.delete(message.id);
    if (message.ok) {
      waiter.resolve(
        message.empty
          ? null
          : {
              buffer: Buffer.from(message.buffer),
              mime: message.mime,
              width: message.width,
              height: message.height
            }
      );
      return;
    }
    waiter.reject(
      message.unsupported ? unsupported(message.message) : new Error(message.message)
    );
  }

  fail(worker, error) {
    this.forget(worker);
    // Everything outstanding is failed, not just this worker's: the id-to-
    // promise map is shared, and a job whose worker died has no other way to
    // be answered. In practice a worker only dies on a bug in the decoder, and
    // the cost of over-failing is one shelf of covers falling back to the
    // full-size image.
    for (const [id, waiter] of this.pending) {
      this.pending.delete(id);
      waiter.reject(error);
    }
    worker.jobs = 0;
  }

  forget(worker) {
    const index = this.workers.indexOf(worker);
    if (index !== -1) this.workers.splice(index, 1);
  }

  stopIdleTimer() {
    if (!this.idleTimer) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  // Threads are given back after a quiet spell. A shelf is browsed in bursts,
  // and holding four of them for the hours between is memory the NAS wants for
  // the things it is actually doing.
  scheduleIdleShutdown() {
    this.stopIdleTimer();
    if (this.closed || !this.idleMs || this.pending.size > 0) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.pending.size === 0) this.terminate();
    }, this.idleMs);
    this.idleTimer.unref();
  }

  terminate() {
    const stopping = this.workers.map((worker) => worker.thread.terminate());
    this.workers = [];
    return Promise.all(stopping);
  }

  async close() {
    this.closed = true;
    this.stopIdleTimer();
    await this.terminate();
  }
}

module.exports = {
  ThumbnailPool,
  defaultPoolSize,
  DEFAULT_IDLE_MS,
  MAX_WORKERS
};
