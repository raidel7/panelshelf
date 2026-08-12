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
// RFC 6762 §10.2: the top bit of the class field tells clients to flush any
// cached records with the same name and type. Only for records unique to us.
const CLASS_IN_FLUSH = 0x8001;
const MAX_LABEL_LENGTH = 63;

function encodeName(name) {
  const parts = name.split(".").filter(Boolean);
  const buffers = parts.map((part) => {
    const label = Buffer.from(part, "utf8");
    if (label.length > MAX_LABEL_LENGTH) {
      throw new Error(
        `mDNS label "${part}" is ${label.length} bytes; the limit is ${MAX_LABEL_LENGTH}`
      );
    }
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

function record(name, type, data, recordClass = CLASS_IN) {
  const encodedName = encodeName(name);
  const header = Buffer.alloc(10);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(recordClass, 2);
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
    // PTR is shared with any other responder for this service type, so it
    // keeps the plain class; the rest describe only this instance.
    record(SERVICE_TYPE, TYPE_PTR, encodeName(serviceName)),
    record(
      serviceName,
      TYPE_SRV,
      Buffer.concat([srvData, encodeName(host)]),
      CLASS_IN_FLUSH
    ),
    record(
      serviceName,
      TYPE_TXT,
      textData([`version=${version}`, `port=${port}`, "path=/api/health"]),
      CLASS_IN_FLUSH
    ),
    record(
      host,
      TYPE_A,
      Buffer.from(address.split(".").map(Number)),
      CLASS_IN_FLUSH
    )
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
