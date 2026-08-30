"use strict";

const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { jsonError } = require("./util");

const BULK_METADATA_SCHEMA_VERSION = 1;
const DEFAULT_THRESHOLD = 90;
const DEFAULT_MARGIN = 10;
const DEFAULT_DELAY_MS = 750;

function text(value) {
  return value === null || value === undefined
    ? ""
    : String(value).replace(/\s+/g, " ").trim();
}

function metadataEditionForFormat(value) {
  const format = text(value).toLocaleLowerCase();
  if (format.includes("trade paperback") || format === "tpb") {
    return "trade-paperback";
  }
  if (
    format.includes("hardcover") ||
    format === "hc" ||
    format.includes("deluxe edition")
  ) {
    return "hardcover";
  }
  if (format.includes("omnibus")) return "omnibus";
  if (format.includes("graphic novel")) return "graphic-novel";
  if (
    format.includes("single issue") ||
    format.includes("limited series") ||
    format.includes("one-shot") ||
    format.includes("annual")
  ) {
    return "single-issue";
  }
  return "auto";
}

function inferBulkMetadataQuery(comic) {
  const local = comic.embeddedMetadata || {};
  const current = comic.onlineMatch?.record?.metadata || {};
  const rawTitle = text(comic.localTitle || comic.title)
    .replace(/\.(?:cbr|cbz)$/i, "")
    .replace(/^\d+(?:\.\d+)?\s+/, "")
    .trim();
  const volumeMatch = rawTitle.match(
    /\b(?:v|vol(?:ume)?\.?)\s*0*(\d{1,4})\b/i
  );
  const namedVolumeMatch = rawTitle.match(
    /\b(?:tpb|hc|omnibus)\s*#?\s*0*(\d{1,4})\b/i
  );
  let edition = metadataEditionForFormat(local.format || current.format);
  if (edition === "auto") {
    if (/\bomnibus\b/i.test(rawTitle)) edition = "omnibus";
    else if (/\b(?:hc|hardcover|deluxe edition)\b/i.test(rawTitle)) {
      edition = "hardcover";
    } else if (/\bgraphic novel\b/i.test(rawTitle)) {
      edition = "graphic-novel";
    } else if (
      /\b(?:tpb|trade paperback|complete collection|epic collection|masterworks)\b/i.test(
        rawTitle
      ) || volumeMatch
    ) {
      edition = "trade-paperback";
    }
  }

  let series = text(
    local.series || comic.localSeries || current.series || comic.series
  );
  if (!local.series && volumeMatch?.index > 0) {
    const filenameSeries = rawTitle
      .slice(0, volumeMatch.index)
      .replace(/[\s:–—-]+$/, "")
      .trim();
    if (filenameSeries.length >= 2) series = filenameSeries;
  } else if (!local.series && edition !== "auto") {
    const filenameSeries = rawTitle
      .replace(
        /\s+(?:tpb|trade paperback|hc|hardcover|omnibus|gn|graphic novel)(?:\s*#?\s*\d+)?\s*$/i,
        ""
      )
      .trim();
    if (filenameSeries.length >= 2) series = filenameSeries;
  }

  const inferredNumber = volumeMatch?.[1] || namedVolumeMatch?.[1] || "";
  const number = text(local.number || current.number || inferredNumber).replace(
    /^0+(?=\d)/,
    ""
  );
  const volumeToken = volumeMatch || namedVolumeMatch;
  const inferredTitle = volumeToken
    ? rawTitle
        .slice((volumeToken.index || 0) + volumeToken[0].length)
        .replace(/^[\s:–—-]+/, "")
        .replace(/\s+\((?:18|19|20|21)\d{2}\).*$/, "")
        .replace(/\s+\((?:digital|f|webrip|scan|empire|zone)[^)]*\).*$/i, "")
        .trim()
    : "";
  const title = text(local.title || current.title || inferredTitle);
  const filenameYear = rawTitle.match(/\(((?:18|19|20|21)\d{2})\)/)?.[1];
  const year =
    Number(
      local.year ||
        current.year ||
        comic.inferredMetadata?.year ||
        filenameYear
    ) || null;
  const publisher = text(
    local.publisher ||
      current.publisher ||
      comic.publisher?.parent ||
      comic.publisher?.name
  );
  return { provider: "smart", series, title, number, edition, year, publisher };
}

function idleState() {
  return {
    schemaVersion: BULK_METADATA_SCHEMA_VERSION,
    jobId: null,
    status: "idle",
    threshold: DEFAULT_THRESHOLD,
    margin: DEFAULT_MARGIN,
    total: 0,
    processed: 0,
    autoApproved: 0,
    reviewRequired: 0,
    unmatched: 0,
    skipped: 0,
    errors: 0,
    currentComicId: null,
    currentTitle: "",
    startedAt: null,
    updatedAt: null,
    finishedAt: null,
    queue: [],
    results: []
  };
}

async function atomicWriteJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600
  });
  await fsp.rename(temporary, filePath);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class BulkMetadataMatcher {
  constructor(dataDirectory, options = {}) {
    this.filePath = path.join(dataDirectory, "bulk-metadata.json");
    this.search = options.search;
    this.confirm = options.confirm;
    this.getComic = options.getComic;
    this.publicComic = options.publicComic;
    this.delayMs = Number.isFinite(options.delayMs)
      ? Math.max(0, options.delayMs)
      : DEFAULT_DELAY_MS;
    this.state = idleState();
    this.runner = null;
    this.persistQueue = Promise.resolve();
  }

  async initialize() {
    const saved = await readJson(this.filePath, idleState());
    const valid = saved && typeof saved === "object" ? saved : {};
    this.state = {
      ...idleState(),
      ...valid,
      schemaVersion: BULK_METADATA_SCHEMA_VERSION,
      queue: Array.isArray(valid.queue) ? valid.queue.filter(Boolean) : [],
      results: Array.isArray(valid.results) ? valid.results : []
    };
    if (this.state.status === "running") {
      this.state.status = "paused";
      this.state.updatedAt = new Date().toISOString();
      await this.persist();
    }
  }

  async persist() {
    const snapshot = structuredClone(this.state);
    this.persistQueue = this.persistQueue
      .catch(() => {})
      .then(() => atomicWriteJson(this.filePath, snapshot));
    await this.persistQueue;
  }

  publicState() {
    const { queue, results, ...summary } = this.state;
    return {
      ...structuredClone(summary),
      remaining: queue.length,
      recentResults: structuredClone(results.slice(-50).reverse())
    };
  }

  async start(comics, input = {}) {
    if (this.state.status === "running") {
      throw jsonError(
        "Bulk metadata enrichment is already running.",
        "METADATA_JOB_RUNNING"
      );
    }
    const threshold = Math.max(
      90,
      Math.min(100, Number(input.threshold) || DEFAULT_THRESHOLD)
    );
    const margin = Math.max(
      5,
      Math.min(30, Number(input.margin) || DEFAULT_MARGIN)
    );
    const queue = comics
      .filter(
        (comic) =>
          comic.available !== false &&
          !comic.onlineMatch &&
          comic.id
      )
      .map((comic) => comic.id);
    const now = new Date().toISOString();
    this.state = {
      ...idleState(),
      jobId: `metadata_${crypto.randomBytes(12).toString("hex")}`,
      status: queue.length > 0 ? "running" : "completed",
      threshold,
      margin,
      total: queue.length,
      startedAt: now,
      updatedAt: now,
      finishedAt: queue.length > 0 ? now : null,
      queue
    };
    await this.persist();
    if (queue.length > 0) this.schedule();
    return this.publicState();
  }

  async pause() {
    if (this.state.status === "running") {
      this.state.status = "paused";
      this.state.updatedAt = new Date().toISOString();
      await this.persist();
    }
    return this.publicState();
  }

  async resume() {
    if (this.state.status !== "paused") return this.publicState();
    this.state.status = "running";
    this.state.updatedAt = new Date().toISOString();
    await this.persist();
    this.schedule();
    return this.publicState();
  }

  async cancel() {
    if (["running", "paused"].includes(this.state.status)) {
      this.state.status = "cancelled";
      this.state.currentComicId = null;
      this.state.currentTitle = "";
      this.state.finishedAt = new Date().toISOString();
      this.state.updatedAt = this.state.finishedAt;
      await this.persist();
    }
    return this.publicState();
  }

  // The job runs in the background and persists as it goes, so a caller that
  // needs the file to be final — a shutdown, a test about to remove the
  // directory underneath it — has to wait for the run and for the write behind
  // it. The loop is because a finished run reschedules itself while work
  // remains, so one await is not necessarily the last one.
  async settled() {
    while (this.runner) await this.runner;
    await this.persistQueue;
  }

  schedule() {
    if (this.runner || this.state.status !== "running") return;
    this.runner = this.run()
      .catch((error) => {
        console.error(
          JSON.stringify({
            time: new Date().toISOString(),
            message: "Bulk metadata job failed",
            error: error.stack || error.message
          })
        );
      })
      .finally(() => {
        this.runner = null;
        if (this.state.status === "running" && this.state.queue.length > 0) {
          this.schedule();
        }
      });
  }

  // The comics still waiting on a person, rather than the last fifty things
  // that happened. `publicState` reports progress; this reports work.
  //
  // Only the newest verdict for a comic counts. A comic checked twice —
  // reviewed on one pass, auto-approved on a later one — is settled, and
  // listing it because an older row still says review would send someone to
  // decide something already decided. The reverse holds too: a later review
  // puts a previously approved comic back in the queue.
  reviewQueue() {
    const latest = new Map();
    for (const result of this.state.results || []) {
      if (!result || !result.comicId) continue;
      const held = latest.get(result.comicId);
      if (!held || String(result.checkedAt || "") >= String(held.checkedAt || "")) {
        latest.set(result.comicId, result);
      }
    }
    return [...latest.values()]
      .filter((result) => result.status === "review")
      .map((result) => ({
        comicId: result.comicId,
        title: result.title || "",
        provider: result.provider || null,
        recordId: result.recordId || null,
        displayName: result.displayName || "",
        score: result.score ?? null,
        runnerUpScore: result.runnerUpScore ?? null,
        reason: result.reason || "",
        checkedAt: result.checkedAt || null
      }));
  }

  result(comic, status, details = {}) {
    this.state.results.push({
      comicId: comic?.id || this.state.currentComicId,
      title: comic?.title || this.state.currentTitle,
      status,
      checkedAt: new Date().toISOString(),
      ...details
    });
  }

  async run() {
    while (this.state.status === "running" && this.state.queue.length > 0) {
      const comicId = this.state.queue[0];
      let comic;
      try {
        comic = this.publicComic(this.getComic(comicId));
        this.state.currentComicId = comic.id;
        this.state.currentTitle = comic.title;
        this.state.updatedAt = new Date().toISOString();
        await this.persist();

        if (comic.onlineMatch) {
          this.state.skipped += 1;
          this.result(comic, "skipped", { reason: "Already matched" });
        } else if (comic.available === false) {
          this.state.skipped += 1;
          this.result(comic, "skipped", { reason: "Source unavailable" });
        } else {
          const query = inferBulkMetadataQuery(comic);
          if (!query.series) {
            this.state.unmatched += 1;
            this.result(comic, "unmatched", { reason: "No series could be inferred" });
          } else {
            const searchResult = await this.search(query);
            const candidates = searchResult.candidates || [];
            const first = candidates[0] || null;
            const second = candidates[1] || null;
            const score = Number(first?.matchScore) || 0;
            const runnerUpScore = Number(second?.matchScore) || 0;
            const clearWinner = !second || score - runnerUpScore >= this.state.margin;
            if (first && score >= this.state.threshold && clearWinner) {
              await this.confirm(comic.id, first.provider, first.recordId);
              this.state.autoApproved += 1;
              this.result(comic, "auto-approved", {
                provider: first.provider,
                recordId: first.recordId,
                displayName: first.displayName,
                score,
                runnerUpScore
              });
            } else if (first) {
              this.state.reviewRequired += 1;
              this.result(comic, "review", {
                provider: first.provider,
                recordId: first.recordId,
                displayName: first.displayName,
                score,
                runnerUpScore,
                reason:
                  score < this.state.threshold
                    ? `Confidence below ${this.state.threshold}%`
                    : `Runner-up is within ${this.state.margin} points`
              });
            } else {
              this.state.unmatched += 1;
              this.result(comic, "unmatched", { reason: "No candidates found" });
            }
          }
        }
      } catch (error) {
        this.state.errors += 1;
        this.result(comic, "error", {
          code: error.code || "METADATA_ERROR",
          reason: error.message
        });
      }

      this.state.queue.shift();
      this.state.processed += 1;
      this.state.currentComicId = null;
      this.state.currentTitle = "";
      this.state.updatedAt = new Date().toISOString();
      if (this.state.queue.length === 0) {
        this.state.status = "completed";
        this.state.finishedAt = this.state.updatedAt;
      }
      await this.persist();
      if (this.state.status === "running" && this.state.queue.length > 0) {
        await delay(this.delayMs);
      }
    }
  }
}

module.exports = {
  BulkMetadataMatcher,
  inferBulkMetadataQuery
};
