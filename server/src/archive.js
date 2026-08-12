"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");
const { promisify } = require("node:util");
const { createExtractorFromFile } = require("node-unrar-js");
const { isImage, jsonError, naturalCompare } = require("./util");

const inflateRaw = promisify(zlib.inflateRaw);
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_EOCD_SEARCH = 65_557;
const MAX_PAGE_BYTES = 150 * 1024 * 1024;
const MAX_COMICINFO_BYTES = 2 * 1024 * 1024;

function archiveType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".cbz" || ext === ".zip") return "cbz";
  if (ext === ".cbr" || ext === ".rar") return "cbr";
  throw jsonError("Unsupported archive type.", "UNSUPPORTED_ARCHIVE");
}

async function detectArchiveType(filePath) {
  const declaredType = archiveType(filePath);
  const handle = await fsp.open(filePath, "r");
  try {
    const signature = Buffer.alloc(8);
    const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
    if (
      bytesRead >= 4 && signature[0] === 0x50 && signature[1] === 0x4b &&
      ((signature[2] === 0x03 && signature[3] === 0x04) ||
       (signature[2] === 0x05 && signature[3] === 0x06) ||
       (signature[2] === 0x07 && signature[3] === 0x08))
    ) return "cbz";
    if (
      bytesRead >= 7 &&
      signature.subarray(0, 7).equals(
        Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00])
      )
    ) return "cbr";
    if (
      bytesRead >= 8 &&
      signature.equals(
        Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00])
      )
    ) return "cbr";
  } finally {
    await handle.close();
  }
  return declaredType;
}

function decodeZipName(buffer, flags) {
  // Comic archives overwhelmingly use UTF-8. CP437 fallback is intentionally
  // decoded as latin1 so names remain stable even when imperfectly displayed.
  return buffer.toString((flags & 0x0800) !== 0 ? "utf8" : "latin1");
}

async function readExactly(handle, length, position) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) {
    throw jsonError("The archive ended unexpectedly.", "DAMAGED_ARCHIVE");
  }
  return buffer;
}

async function findEndOfCentralDirectory(handle, fileSize) {
  const length = Math.min(fileSize, MAX_EOCD_SEARCH);
  const tail = await readExactly(handle, length, fileSize - length);
  for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
    if (tail.readUInt32LE(offset) === EOCD_SIGNATURE) return tail.subarray(offset);
  }
  throw jsonError("The CBZ central directory was not found.", "DAMAGED_ARCHIVE");
}

async function listZipEntries(filePath) {
  const handle = await fsp.open(filePath, "r");
  try {
    const stat = await handle.stat();
    const eocd = await findEndOfCentralDirectory(handle, stat.size);
    const entryCount = eocd.readUInt16LE(10);
    const centralSize = eocd.readUInt32LE(12);
    const centralOffset = eocd.readUInt32LE(16);
    if (
      entryCount === 0xffff ||
      centralSize === 0xffffffff ||
      centralOffset === 0xffffffff
    ) {
      throw jsonError(
        "ZIP64 comic archives are not supported in this first release.",
        "ZIP64_UNSUPPORTED"
      );
    }
    const directory = await readExactly(handle, centralSize, centralOffset);
    const entries = [];
    let cursor = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (
        cursor + 46 > directory.length ||
        directory.readUInt32LE(cursor) !== CENTRAL_SIGNATURE
      ) {
        throw jsonError("The CBZ directory is damaged.", "DAMAGED_ARCHIVE");
      }
      const flags = directory.readUInt16LE(cursor + 8);
      const method = directory.readUInt16LE(cursor + 10);
      const compressedSize = directory.readUInt32LE(cursor + 20);
      const uncompressedSize = directory.readUInt32LE(cursor + 24);
      const nameLength = directory.readUInt16LE(cursor + 28);
      const extraLength = directory.readUInt16LE(cursor + 30);
      const commentLength = directory.readUInt16LE(cursor + 32);
      const localOffset = directory.readUInt32LE(cursor + 42);
      const nameStart = cursor + 46;
      const name = decodeZipName(
        directory.subarray(nameStart, nameStart + nameLength),
        flags
      );
      entries.push({
        name,
        method,
        flags,
        compressedSize,
        uncompressedSize,
        localOffset,
        directory: name.endsWith("/")
      });
      cursor = nameStart + nameLength + extraLength + commentLength;
    }
    return entries;
  } finally {
    await handle.close();
  }
}

async function extractZipEntry(
  filePath,
  entry,
  maximumBytes = MAX_PAGE_BYTES,
  tooLargeCode = "PAGE_TOO_LARGE"
) {
  if ((entry.flags & 0x0001) !== 0) {
    throw jsonError("Encrypted CBZ files are not supported.", "ENCRYPTED_ARCHIVE");
  }
  if (entry.uncompressedSize > maximumBytes) {
    throw jsonError(
      tooLargeCode === "COMICINFO_TOO_LARGE"
        ? "ComicInfo.xml is too large to read safely."
        : "This comic page is too large to open safely.",
      tooLargeCode
    );
  }
  const handle = await fsp.open(filePath, "r");
  try {
    const local = await readExactly(handle, 30, entry.localOffset);
    if (local.readUInt32LE(0) !== LOCAL_SIGNATURE) {
      throw jsonError("The CBZ page header is damaged.", "DAMAGED_ARCHIVE");
    }
    const nameLength = local.readUInt16LE(26);
    const extraLength = local.readUInt16LE(28);
    const dataOffset = entry.localOffset + 30 + nameLength + extraLength;
    const compressed = await readExactly(
      handle,
      entry.compressedSize,
      dataOffset
    );
    let result;
    if (entry.method === 0) {
      result = compressed;
    } else if (entry.method === 8) {
      result = await inflateRaw(compressed);
    } else {
      throw jsonError(
        `CBZ compression method ${entry.method} is not supported.`,
        "UNSUPPORTED_COMPRESSION"
      );
    }
    if (result.length > maximumBytes) {
      throw jsonError(
        tooLargeCode === "COMICINFO_TOO_LARGE"
          ? "ComicInfo.xml is too large to read safely."
          : "This comic page is too large to open safely.",
        tooLargeCode
      );
    }
    return result;
  } finally {
    await handle.close();
  }
}

async function listRarEntries(filePath) {
  const extractor = await createExtractorFromFile({ filepath: filePath });
  const listing = extractor.getFileList();
  return [...listing.fileHeaders].map((header) => ({
    name: header.name,
    directory: Boolean(header.flags && header.flags.directory),
    encrypted: Boolean(header.flags && header.flags.encrypted),
    uncompressedSize: Number(header.unpSize || 0)
  }));
}

async function extractRarEntry(
  filePath,
  entry,
  tempBase,
  maximumBytes = MAX_PAGE_BYTES,
  tooLargeCode = "PAGE_TOO_LARGE"
) {
  if (entry.encrypted) {
    throw jsonError("Encrypted CBR files are not supported.", "ENCRYPTED_ARCHIVE");
  }
  if (entry.uncompressedSize > maximumBytes) {
    throw jsonError(
      tooLargeCode === "COMICINFO_TOO_LARGE"
        ? "ComicInfo.xml is too large to read safely."
        : "This comic page is too large to open safely.",
      tooLargeCode
    );
  }
  await fsp.mkdir(tempBase, { recursive: true });
  const tempDirectory = await fsp.mkdtemp(path.join(tempBase, "rar-"));
  const safeName = `entry${path.extname(entry.name).toLowerCase() || ".bin"}`;
  try {
    const extractor = await createExtractorFromFile({
      filepath: filePath,
      targetPath: tempDirectory,
      filenameTransform: (candidate) =>
        candidate === entry.name ? safeName : path.basename(candidate)
    });
    const extracted = extractor.extract({ files: [entry.name] });
    // The iterator performs the actual extraction.
    [...extracted.files];
    const result = await fsp.readFile(path.join(tempDirectory, safeName));
    if (result.length > maximumBytes) {
      throw jsonError(
        tooLargeCode === "COMICINFO_TOO_LARGE"
          ? "ComicInfo.xml is too large to read safely."
          : "This comic page is too large to open safely.",
        tooLargeCode
      );
    }
    return result;
  } finally {
    await fsp.rm(tempDirectory, { recursive: true, force: true });
  }
}

async function listPages(filePath) {
  const type = await detectArchiveType(filePath);
  const entries =
    type === "cbz"
      ? await listZipEntries(filePath)
      : await listRarEntries(filePath);
  return entries
    .filter((entry) => !entry.directory && isImage(entry.name))
    .sort((left, right) => naturalCompare(left.name, right.name));
}

function pageEntries(entries) {
  return entries
    .filter((entry) => !entry.directory && isImage(entry.name))
    .sort((left, right) => naturalCompare(left.name, right.name));
}

function comicInfoEntry(entries) {
  return entries
    .filter(
      (entry) =>
        !entry.directory &&
        path.basename(entry.name).toLocaleLowerCase() === "comicinfo.xml"
    )
    .sort(
      (left, right) =>
        left.name.split(/[\\/]/).length - right.name.split(/[\\/]/).length ||
        naturalCompare(left.name, right.name)
    )[0] || null;
}

async function inspectComicArchive(filePath, tempBase) {
  const declaredType = archiveType(filePath);
  const type = await detectArchiveType(filePath);
  const entries =
    type === "cbz"
      ? await listZipEntries(filePath)
      : await listRarEntries(filePath);
  const pages = pageEntries(entries);
  const metadataEntry = comicInfoEntry(entries);
  const archiveDetails = { format: type, extensionMismatch: type !== declaredType };
  if (!metadataEntry) {
    return { pages, comicInfo: null, comicInfoName: null, ...archiveDetails };
  }

  try {
    const buffer =
      type === "cbz"
        ? await extractZipEntry(
            filePath,
            metadataEntry,
            MAX_COMICINFO_BYTES,
            "COMICINFO_TOO_LARGE"
          )
        : await extractRarEntry(
            filePath,
            metadataEntry,
            tempBase,
            MAX_COMICINFO_BYTES,
            "COMICINFO_TOO_LARGE"
          );
    return {
      pages,
      comicInfo: buffer.toString("utf8"),
      comicInfoName: metadataEntry.name,
      ...archiveDetails
    };
  } catch (error) {
    return {
      pages,
      comicInfo: null,
      comicInfoName: metadataEntry.name,
      comicInfoError: error,
      ...archiveDetails
    };
  }
}

async function readPage(filePath, entry, tempBase) {
  return (await detectArchiveType(filePath)) === "cbz"
    ? extractZipEntry(filePath, entry)
    : extractRarEntry(filePath, entry, tempBase);
}

async function isReadableFile(filePath) {
  await fsp.access(filePath, fs.constants.R_OK);
  const stat = await fsp.stat(filePath);
  return stat.isFile();
}

module.exports = {
  archiveType,
  detectArchiveType,
  isReadableFile,
  inspectComicArchive,
  listPages,
  listRarEntries,
  listZipEntries,
  readPage
};
