"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  SERVICE_TYPE,
  decodeQuestions,
  encodeName,
  encodeResponse
} = require("../src/mdns");

const RESPONSE = {
  instance: "PanelShelf",
  host: "panelshelf.local",
  address: "192.168.1.10",
  port: 8251,
  version: "0.4.3"
};

// Walks a name we encoded ourselves. Assumes no compression, which holds for
// every packet encodeResponse produces.
function readName(buffer, offset) {
  const parts = [];
  let cursor = offset;
  while (buffer[cursor] !== 0) {
    const length = buffer[cursor];
    cursor += 1;
    parts.push(buffer.toString("utf8", cursor, cursor + length));
    cursor += length;
  }
  return { name: parts.join("."), offset: cursor + 1 };
}

// Decodes the answer section into plain objects so tests can assert on fields
// rather than on byte offsets. Assumes no compression; see readName.
function decodeAnswers(packet) {
  const answers = [];
  let offset = 12;
  for (let index = 0; index < packet.readUInt16BE(6); index += 1) {
    const decoded = readName(packet, offset);
    offset = decoded.offset;
    const rdlength = packet.readUInt16BE(offset + 8);
    answers.push({
      name: decoded.name,
      type: packet.readUInt16BE(offset),
      class: packet.readUInt16BE(offset + 2),
      ttl: packet.readUInt32BE(offset + 4),
      rdata: packet.subarray(offset + 10, offset + 10 + rdlength)
    });
    offset += 10 + rdlength;
  }
  assert.equal(offset, packet.length, "answers consume the whole packet");
  return answers;
}

function readTextStrings(rdata) {
  const strings = [];
  let cursor = 0;
  while (cursor < rdata.length) {
    const length = rdata[cursor];
    strings.push(rdata.toString("utf8", cursor + 1, cursor + 1 + length));
    cursor += 1 + length;
  }
  return strings;
}

test("encodeName writes length-prefixed labels ending in a root byte", () => {
  const encoded = encodeName("a.local");
  assert.deepEqual([...encoded], [1, 0x61, 5, 0x6c, 0x6f, 0x63, 0x61, 0x6c, 0]);
});

test("encodeName rejects a label longer than 63 bytes", () => {
  assert.throws(() => encodeName(`${"a".repeat(64)}.local`), {
    message: /label/i
  });
  assert.equal(
    encodeName(`${"a".repeat(63)}.local`)[0],
    63,
    "63 bytes is still legal"
  );
});

test("decodeQuestions reads a query for the service type", () => {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(0, 2);
  header.writeUInt16BE(1, 4);
  const question = Buffer.concat([
    encodeName(SERVICE_TYPE),
    Buffer.from([0x00, 0x0c, 0x00, 0x01])
  ]);

  const questions = decodeQuestions(Buffer.concat([header, question]));

  assert.deepEqual(questions, [{ name: SERVICE_TYPE, type: 12 }]);
});

test("decodeQuestions reads every question in a bundled query", () => {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(2, 4);
  const packet = Buffer.concat([
    header,
    encodeName(SERVICE_TYPE),
    Buffer.from([0x00, 0x0c, 0x00, 0x01]),
    encodeName("panelshelf.local"),
    Buffer.from([0x00, 0x01, 0x00, 0x01])
  ]);

  assert.deepEqual(decodeQuestions(packet), [
    { name: SERVICE_TYPE, type: 12 },
    { name: "panelshelf.local", type: 1 }
  ]);
});

test("decodeQuestions returns an empty list for a malformed packet", () => {
  assert.deepEqual(decodeQuestions(Buffer.from([1, 2, 3])), []);
});

test("decodeQuestions gives up on names it cannot parse", () => {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(1, 4);

  // A label claiming 5 bytes when only 2 remain.
  assert.deepEqual(
    decodeQuestions(Buffer.concat([header, Buffer.from([5, 0x61, 0x62])])),
    [],
    "truncated label"
  );

  // A compression pointer (top two bits set), which we never follow.
  assert.deepEqual(
    decodeQuestions(
      Buffer.concat([header, Buffer.from([0xc0, 0x0c, 0x00, 0x0c, 0x00, 0x01])])
    ),
    [],
    "compression pointer"
  );

  // Labels that run off the end of the buffer with no root byte.
  assert.deepEqual(
    decodeQuestions(
      Buffer.concat([header, Buffer.from([3, 0x61, 0x62, 0x63])])
    ),
    [],
    "missing root byte"
  );

  // A well-formed name whose type and class bytes were cut off.
  assert.deepEqual(
    decodeQuestions(Buffer.concat([header, encodeName("a.local")])),
    [],
    "missing question suffix"
  );
});

test("decodeQuestions keeps the questions it parsed before giving up", () => {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(3, 4);
  const packet = Buffer.concat([
    header,
    encodeName(SERVICE_TYPE),
    Buffer.from([0x00, 0x0c, 0x00, 0x01]),
    Buffer.from([0xc0, 0x0c, 0x00, 0x0c, 0x00, 0x01])
  ]);

  assert.deepEqual(decodeQuestions(packet), [
    { name: SERVICE_TYPE, type: 12 }
  ]);
});

test("encodeResponse carries the instance, port, and TXT metadata", () => {
  const packet = encodeResponse(RESPONSE);

  assert.equal(packet.readUInt16BE(2), 0x8400, "authoritative response flags");
  assert.equal(packet.readUInt16BE(6), 4, "PTR, SRV, TXT, and A answers");
  assert.ok(packet.includes(Buffer.from("PanelShelf", "utf8")));
  assert.ok(packet.includes(Buffer.from("version=0.4.3", "utf8")));
  assert.ok(packet.includes(Buffer.from("port=8251", "utf8")));
});

test("encodeResponse builds each answer record in full", () => {
  const answers = decodeAnswers(encodeResponse(RESPONSE));
  const serviceName = `PanelShelf.${SERVICE_TYPE}`;

  assert.deepEqual(
    answers.map((answer) => answer.type),
    [12, 33, 16, 1],
    "PTR, SRV, TXT, then A"
  );
  assert.deepEqual(
    answers.map((answer) => answer.ttl),
    [120, 120, 120, 120]
  );

  const [ptr, srv, txt, a] = answers;

  assert.equal(ptr.name, SERVICE_TYPE);
  assert.equal(readName(ptr.rdata, 0).name, serviceName);

  assert.equal(srv.name, serviceName);
  assert.equal(srv.rdata.readUInt16BE(0), 0, "priority");
  assert.equal(srv.rdata.readUInt16BE(2), 0, "weight");
  assert.equal(srv.rdata.readUInt16BE(4), 8251, "port");
  assert.equal(readName(srv.rdata, 6).name, "panelshelf.local", "target");
  assert.equal(
    readName(srv.rdata, 6).offset,
    srv.rdata.length,
    "target ends the rdata"
  );

  assert.equal(txt.name, serviceName);
  assert.deepEqual(readTextStrings(txt.rdata), [
    "version=0.4.3",
    "port=8251",
    "path=/api/health"
  ]);

  assert.equal(a.name, "panelshelf.local");
  assert.deepEqual([...a.rdata], [192, 168, 1, 10], "address octets in order");
});

test("encodeResponse sets the cache-flush bit only on names we own", () => {
  const answers = decodeAnswers(encodeResponse(RESPONSE));
  const classOf = (type) =>
    answers.find((answer) => answer.type === type).class;

  assert.equal(classOf(12), 1, "PTR is shared and keeps plain IN");
  assert.equal(classOf(33), 0x8001, "SRV is under our own instance name");
  assert.equal(classOf(16), 0x8001, "TXT is under our own instance name");
  // <hostname>.local belongs to the host's own responder, and RFC 6762 §8
  // requires probing before claiming a unique name -- which an advertise-only
  // responder deliberately never does. Flushing it would tell every client on
  // the LAN to discard a record we have no claim to.
  assert.equal(classOf(1), 1, "A is a name we do not own and must not flush");
});

test("encodeResponse rejects a TXT entry longer than 255 bytes", () => {
  assert.throws(
    () => encodeResponse({ ...RESPONSE, version: "9".repeat(256) }),
    { message: /text entry/i }
  );
});
