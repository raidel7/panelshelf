"use strict";

const SERVICE_TYPE = "_panelshelf._tcp.local";
const MULTICAST_ADDRESS = "224.0.0.251";
const MULTICAST_PORT = 5353;
const TTL = 120;
const TYPE_A = 1;
const TYPE_PTR = 12;
const TYPE_TXT = 16;
const TYPE_SRV = 33;
const CLASS_IN = 1;

function encodeName(name) {
  const parts = name.split(".").filter(Boolean);
  const buffers = parts.map((part) => {
    const label = Buffer.from(part, "utf8");
    return Buffer.concat([Buffer.from([label.length]), label]);
  });
  return Buffer.concat([...buffers, Buffer.from([0])]);
}

function decodeName(buffer, offset) {
  const parts = [];
  let cursor = offset;
  while (cursor < buffer.length) {
    const length = buffer[cursor];
    if (length === 0) return { name: parts.join("."), offset: cursor + 1 };
    if (length > 63) return null;
    cursor += 1;
    if (cursor + length > buffer.length) return null;
    parts.push(buffer.toString("utf8", cursor, cursor + length));
    cursor += length;
  }
  return null;
}

function decodeQuestions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return [];
  const count = buffer.readUInt16BE(4);
  const questions = [];
  let offset = 12;
  for (let index = 0; index < count; index += 1) {
    const decoded = decodeName(buffer, offset);
    if (!decoded || decoded.offset + 4 > buffer.length) return questions;
    questions.push({
      name: decoded.name,
      type: buffer.readUInt16BE(decoded.offset)
    });
    offset = decoded.offset + 4;
  }
  return questions;
}

function record(name, type, data) {
  const encodedName = encodeName(name);
  const header = Buffer.alloc(10);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(CLASS_IN, 2);
  header.writeUInt32BE(TTL, 4);
  header.writeUInt16BE(data.length, 8);
  return Buffer.concat([encodedName, header, data]);
}

function textData(entries) {
  return Buffer.concat(
    entries.map((entry) => {
      const value = Buffer.from(entry, "utf8");
      return Buffer.concat([Buffer.from([value.length]), value]);
    })
  );
}

function encodeResponse({ instance, host, address, port, version }) {
  const serviceName = `${instance}.${SERVICE_TYPE}`;
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(0x8400, 2);
  header.writeUInt16BE(4, 6);

  const srvData = Buffer.alloc(6);
  srvData.writeUInt16BE(0, 0);
  srvData.writeUInt16BE(0, 2);
  srvData.writeUInt16BE(port, 4);

  const answers = [
    record(SERVICE_TYPE, TYPE_PTR, encodeName(serviceName)),
    record(serviceName, TYPE_SRV, Buffer.concat([srvData, encodeName(host)])),
    record(
      serviceName,
      TYPE_TXT,
      textData([`version=${version}`, `port=${port}`, "path=/api/health"])
    ),
    record(host, TYPE_A, Buffer.from(address.split(".").map(Number)))
  ];

  return Buffer.concat([header, ...answers]);
}

module.exports = {
  MULTICAST_ADDRESS,
  MULTICAST_PORT,
  SERVICE_TYPE,
  TYPE_PTR,
  decodeQuestions,
  encodeName,
  encodeResponse
};
