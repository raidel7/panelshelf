"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { parseComicInfo } = require("../src/metadata");

test("ComicInfo.xml fields, entities, creators, and lists are normalized", () => {
  const metadata = parseComicInfo(`<?xml version="1.0" encoding="utf-8"?>
    <ComicInfo>
      <Title>Bellatrix &amp; the Ice Moon</Title>
      <Series>Bellatrix</Series>
      <Number>3</Number>
      <Volume>1</Volume>
      <Summary><![CDATA[A cold <journey> through space.]]></Summary>
      <Year>2025</Year>
      <Publisher>Dargaud</Publisher>
      <Writer>LEO, Rodolphe</Writer>
      <Penciller>Louis Alloing</Penciller>
      <Genre>Science Fiction, Adventure</Genre>
      <Tags>space, survival</Tags>
      <PageCount>64</PageCount>
      <CommunityRating>4.25</CommunityRating>
    </ComicInfo>`);

  assert.equal(metadata.source, "comicinfo");
  assert.equal(metadata.title, "Bellatrix & the Ice Moon");
  assert.equal(metadata.series, "Bellatrix");
  assert.equal(metadata.number, "3");
  assert.equal(metadata.volume, 1);
  assert.equal(metadata.year, 2025);
  assert.equal(metadata.publisher, "Dargaud");
  assert.equal(metadata.pageCount, 64);
  assert.equal(metadata.communityRating, 4.25);
  assert.deepEqual(metadata.creators.writers, ["LEO", "Rodolphe"]);
  assert.deepEqual(metadata.creators.pencillers, ["Louis Alloing"]);
  assert.deepEqual(metadata.genres, ["Science Fiction", "Adventure"]);
  assert.deepEqual(metadata.tags, ["space", "survival"]);
  assert.equal(metadata.summary, "A cold through space.");
});

test("a non-ComicInfo XML document is rejected without affecting archives", () => {
  assert.throws(
    () => parseComicInfo("<metadata><Title>Wrong root</Title></metadata>"),
    (error) => error.code === "COMICINFO_INVALID"
  );
  assert.throws(
    () => parseComicInfo("<ComicInfo><Title>Truncated</Title>"),
    (error) => error.code === "COMICINFO_INVALID"
  );
});
