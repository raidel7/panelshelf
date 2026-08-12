"use strict";

const { jsonError } = require("./util");

const COMICINFO_FIELDS = {
  title: "Title",
  series: "Series",
  number: "Number",
  alternateSeries: "AlternateSeries",
  alternateNumber: "AlternateNumber",
  storyArc: "StoryArc",
  storyArcNumber: "StoryArcNumber",
  seriesGroup: "SeriesGroup",
  summary: "Summary",
  notes: "Notes",
  publisher: "Publisher",
  imprint: "Imprint",
  web: "Web",
  language: "LanguageISO",
  format: "Format",
  manga: "Manga",
  blackAndWhite: "BlackAndWhite",
  ageRating: "AgeRating",
  scanInformation: "ScanInformation"
};

const COMICINFO_INTEGER_FIELDS = {
  count: "Count",
  volume: "Volume",
  year: "Year",
  month: "Month",
  day: "Day",
  pageCount: "PageCount"
};

const COMICINFO_NUMBER_FIELDS = {
  communityRating: "CommunityRating"
};

const COMICINFO_LIST_FIELDS = {
  genres: "Genre",
  tags: "Tags",
  characters: "Characters",
  teams: "Teams",
  locations: "Locations"
};

const COMICINFO_CREATOR_FIELDS = {
  writers: "Writer",
  pencillers: "Penciller",
  inkers: "Inker",
  colorists: "Colorist",
  letterers: "Letterer",
  coverArtists: "CoverArtist",
  editors: "Editor"
};

function decodeXmlEntities(value) {
  return String(value || "").replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|amp|lt|gt|quot|apos);/gi,
    (entity, decimal, hexadecimal) => {
      if (decimal) {
        const codePoint = Number(decimal);
        return Number.isInteger(codePoint) && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : entity;
      }
      if (hexadecimal) {
        const codePoint = Number.parseInt(hexadecimal, 16);
        return Number.isInteger(codePoint) && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : entity;
      }
      const named = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&apos;": "'"
      };
      return named[entity.toLocaleLowerCase()] || entity;
    }
  );
}

function textForTag(xml, tag) {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(xml).match(
    new RegExp(
      `<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}\\s*>`,
      "i"
    )
  );
  if (!match) return null;
  const withoutCdata = match[1].replace(
    /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/i,
    "$1"
  );
  const text = decodeXmlEntities(withoutCdata.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function listForTag(xml, tag) {
  const value = textForTag(xml, tag);
  if (!value) return [];
  return value
    .split(/\s*,\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function integerForTag(xml, tag) {
  const value = textForTag(xml, tag);
  if (!/^-?\d+$/.test(value || "")) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function numberForTag(xml, tag) {
  const value = textForTag(xml, tag);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function assignPresent(target, key, value) {
  if (value === null || value === undefined || value === "") return;
  if (Array.isArray(value) && value.length === 0) return;
  target[key] = value;
}

function parseComicInfo(xml) {
  const source = String(xml || "").replace(/^\uFEFF/, "").trim();
  if (
    !/<ComicInfo(?:\s|>)/i.test(source) ||
    !/<\/ComicInfo\s*>/i.test(source)
  ) {
    throw jsonError(
      "ComicInfo.xml does not contain a ComicInfo root element.",
      "COMICINFO_INVALID"
    );
  }

  const metadata = {
    source: "comicinfo",
    creators: {}
  };
  for (const [key, tag] of Object.entries(COMICINFO_FIELDS)) {
    assignPresent(metadata, key, textForTag(source, tag));
  }
  for (const [key, tag] of Object.entries(COMICINFO_INTEGER_FIELDS)) {
    assignPresent(metadata, key, integerForTag(source, tag));
  }
  for (const [key, tag] of Object.entries(COMICINFO_NUMBER_FIELDS)) {
    assignPresent(metadata, key, numberForTag(source, tag));
  }
  for (const [key, tag] of Object.entries(COMICINFO_LIST_FIELDS)) {
    assignPresent(metadata, key, listForTag(source, tag));
  }
  for (const [key, tag] of Object.entries(COMICINFO_CREATOR_FIELDS)) {
    assignPresent(metadata.creators, key, listForTag(source, tag));
  }
  if (Object.keys(metadata.creators).length === 0) delete metadata.creators;
  return metadata;
}

module.exports = {
  decodeXmlEntities,
  parseComicInfo
};
