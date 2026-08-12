"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  SERVICE_TYPE,
  decodeQuestions,
  encodeName,
  encodeResponse
} = require("../src/mdns");

test("encodeName writes length-prefixed labels ending in a root byte", () => {
  const encoded = encodeName("a.local");
  assert.deepEqual([...encoded], [1, 0x61, 5, 0x6c, 0x6f, 0x63, 0x61, 0x6c, 0]);
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

test("decodeQuestions returns an empty list for a malformed packet", () => {
  assert.deepEqual(decodeQuestions(Buffer.from([1, 2, 3])), []);
});

test("encodeResponse carries the instance, port, and TXT metadata", () => {
  const packet = encodeResponse({
    instance: "PanelShelf",
    host: "panelshelf.local",
    address: "192.168.1.10",
    port: 8251,
    version: "0.4.3"
  });

  assert.equal(packet.readUInt16BE(2), 0x8400, "authoritative response flags");
  assert.equal(packet.readUInt16BE(6), 4, "PTR, SRV, TXT, and A answers");
  assert.ok(packet.includes(Buffer.from("PanelShelf", "utf8")));
  assert.ok(packet.includes(Buffer.from("version=0.4.3", "utf8")));
  assert.ok(packet.includes(Buffer.from("port=8251", "utf8")));
});

function readAnswerClasses(packet) {
  const classes = {};
  let offset = 12;
  for (let index = 0; index < packet.readUInt16BE(6); index += 1) {
    while (packet[offset] !== 0) offset += packet[offset] + 1;
    offset += 1;
    const type = packet.readUInt16BE(offset);
    classes[type] = packet.readUInt16BE(offset + 2);
    offset += 10 + packet.readUInt16BE(offset + 8);
  }
  return classes;
}

test("encodeResponse sets the cache-flush bit on unique records only", () => {
  const classes = readAnswerClasses(
    encodeResponse({
      instance: "PanelShelf",
      host: "panelshelf.local",
      address: "192.168.1.10",
      port: 8251,
      version: "0.4.3"
    })
  );

  assert.equal(classes[12], 1, "PTR is shared and keeps plain IN");
  assert.equal(classes[33], 0x8001, "SRV is unique and flushes the cache");
  assert.equal(classes[16], 0x8001, "TXT is unique and flushes the cache");
  assert.equal(classes[1], 0x8001, "A is unique and flushes the cache");
});

test("encodeName rejects a label longer than 63 bytes", () => {
  assert.throws(() => encodeName(`${"a".repeat(64)}.local`), {
    message: /label/i
  });
  assert.deepEqual([...encodeName(`${"a".repeat(63)}.local`).subarray(0, 1)], [
    63
  ]);
});
