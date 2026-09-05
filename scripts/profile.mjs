#!/usr/bin/env node
// Builds a synthetic library of a given size and measures what the server does
// with it. Section 10 of the roadmap asks for 5,000, 25,000 and 100,000.
//
// What this can and cannot tell you matters. Run on a laptop it finds
// algorithmic cliffs — a scan that goes quadratic, an index that will not fit
// in memory, a response that takes longer to serialise than to send. Those are
// properties of the code and they show up anywhere. It cannot tell you what a
// DS1825+ does with a spinning disk, and the numbers below are not NAS numbers.
//
//   node scripts/profile.mjs 5000
//   node scripts/profile.mjs 25000 --keep
//
// The corpus is synthetic but shaped like a real library: publishers, series,
// issues, and a share of loose files, because a flat directory of 25,000 comics
// exercises nothing the scanner actually struggles with.

import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { performance } from "node:perf_hooks";

const args = process.argv.slice(2);
const count = Number(args.find((value) => !value.startsWith("--")) || 5000);
const keep = args.includes("--keep");

if (!Number.isFinite(count) || count < 1) {
  console.error("usage: profile.mjs <comic-count> [--keep]");
  process.exit(2);
}

// A one-pixel PNG, the smallest thing that is still a decodable image. The
// point here is the number of files and index entries, not image bytes.
const PIXEL = Buffer.from(
  "89504e470d0a1a0a0000000d494844520000000100000001080600000" +
    "01f15c4890000000d4944415478da636040000000030001aabf1cc00000000049454e44ae426082",
  "hex"
);

function zipBuffer(files) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const source = Buffer.from(file.data);
    const compressed = zlib.deflateRawSync(source);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6);
    head.writeUInt16LE(8, 8);
    head.writeUInt32LE(0, 14);
    head.writeUInt32LE(compressed.length, 18);
    head.writeUInt32LE(source.length, 22);
    head.writeUInt16LE(name.length, 26);
    local.push(head, name, compressed);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(0, 16);
    entry.writeUInt32LE(compressed.length, 20);
    entry.writeUInt32LE(source.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += head.length + name.length + compressed.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuffer, end]);
}

const PUBLISHERS = ["DC Comics", "Vertigo", "Wildstorm", "Milestone", "Black Label"];
const SERIES = [
  "Detective Comics", "Action Comics", "The Sandman", "Swamp Thing",
  "Doom Patrol", "Animal Man", "Hellblazer", "Starman", "The Question",
  "Batman", "Superman", "Wonder Woman", "The Flash", "Green Lantern"
];

function report(label, value) {
  console.log(`  ${label.padEnd(38)} ${value}`);
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(2)} s`;
}

async function build(root) {
  const archive = zipBuffer([
    { name: "001.png", data: PIXEL },
    { name: "002.png", data: PIXEL }
  ]);
  const started = performance.now();
  let made = 0;
  // Batched, because 100,000 outstanding writes is its own memory problem and
  // not one the server has.
  const queue = [];
  for (let index = 0; index < count; index += 1) {
    const publisher = PUBLISHERS[index % PUBLISHERS.length];
    const series = SERIES[Math.floor(index / 40) % SERIES.length];
    const volume = 1 + (Math.floor(index / 400) % 6);
    // One in twelve sits loose at the publisher root, which is what a real
    // library looks like and what the unfiled shelf exists for.
    const directory =
      index % 12 === 0
        ? path.join(root, publisher)
        : path.join(root, publisher, `${series} v${String(volume).padStart(2, "0")}`);
    const name = `${series} ${String((index % 400) + 1).padStart(3, "0")}.cbz`;
    queue.push({ directory, file: path.join(directory, `${index}-${name}`) });
    if (queue.length === 500 || index === count - 1) {
      const directories = [...new Set(queue.map((item) => item.directory))];
      await Promise.all(directories.map((dir) => fsp.mkdir(dir, { recursive: true })));
      await Promise.all(queue.map((item) => fsp.writeFile(item.file, archive)));
      made += queue.length;
      queue.length = 0;
      // Only to a terminal: this is a carriage-return progress line and it is
      // noise in a log or a CI transcript.
      if (made % 5000 === 0 && process.stdout.isTTY) {
        process.stdout.write(`\r  building… ${made}/${count}`.padEnd(40));
      }
    }
  }
  if (process.stdout.isTTY) process.stdout.write(`\r${" ".repeat(40)}\r`);
  return performance.now() - started;
}

async function main() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "panelshelf-profile-"));
  const comics = path.join(root, "Comics");
  const data = path.join(root, "data");
  process.env.PANELSHELF_ALLOW_ANY_PATH = "1";

  console.log(`\nPanelShelf profile — ${count.toLocaleString()} comics`);
  console.log(`  ${root}\n`);

  const buildMs = await build(comics);
  report("corpus built in", seconds(buildMs));

  const { ComicLibrary } = await import("../server/src/library.js");
  const baseline = process.memoryUsage();

  // Sampled rather than read once at the end: the scan's high-water mark is
  // what has to fit, and by the time it returns the garbage collector has
  // usually been through. Resident set is the number the kernel's out-of-memory
  // killer looks at, so it is the one that decides whether the ARMv7 package
  // can carry a library this size at all.
  let peakRss = baseline.rss;
  const sampler = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 100);
  sampler.unref();

  const library = new ComicLibrary(data);
  await library.initialize();
  await library.saveConfig([comics]);

  const scanStarted = performance.now();
  const scan = await library.scan();
  const scanMs = performance.now() - scanStarted;

  report("scan", `${seconds(scanMs)} · ${Math.round(scan.foundComics / (scanMs / 1000)).toLocaleString()} comics/s`);
  report("comics indexed", scan.foundComics.toLocaleString());
  report("scan errors", String(scan.errors.length));

  const indexBytes = (await fsp.stat(path.join(data, "library.json"))).size;
  report("library.json", mb(indexBytes));
  report("heap held after scan", mb(process.memoryUsage().heapUsed - baseline.heapUsed));
  report("peak resident set", mb(peakRss));

  // The two shapes the shelf can ask for. The compact one exists because the
  // full one was 71 MB; this is the check that it still is what it claims.
  for (const [label, build] of [
    ["full listing", () => library.listComics().map((comic) => library.publicComic(comic))],
    ["compact listing", () => library.listComics().map((comic) => library.compactComic(comic))]
  ]) {
    const started = performance.now();
    const value = build();
    const built = performance.now() - started;
    const serialiseStarted = performance.now();
    const json = JSON.stringify(value);
    report(
      label,
      `${mb(json.length)} · build ${seconds(built)} · serialise ${seconds(performance.now() - serialiseStarted)}`
    );
  }

  // A restart. This is the number that decides whether the package still starts
  // in a time DSM is willing to wait for.
  const reopenStarted = performance.now();
  const reopened = new ComicLibrary(data);
  await reopened.initialize();
  report("restart (load index)", seconds(performance.now() - reopenStarted));
  report("comics after restart", reopened.listComics().length.toLocaleString());

  const coverStarted = performance.now();
  const first = reopened.listComics()[0];
  await reopened.cover(first.id, { thumbnail: true });
  report("first cover, cold", seconds(performance.now() - coverStarted));

  clearInterval(sampler);
  report("peak resident set, whole run", mb(peakRss));

  console.log("");
  if (keep) console.log(`  kept: ${root}\n`);
  else await fsp.rm(root, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
