"use strict";

// Minimal DNS-SD packet encoding for advertising this server over mDNS.
// Wire format per RFC 1035 §4 (header, questions, resource records) with the
// multicast additions of RFC 6762. We only ever advertise, never resolve, so
// this handles the subset of the format a responder needs.

const dgram = require("node:dgram");
const os = require("node:os");

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

// Header layout: 12 bytes of ID, flags, and four section counts.
const HEADER_LENGTH = 12;
const FLAGS_OFFSET = 2;
const QDCOUNT_OFFSET = 4;
const ANCOUNT_OFFSET = 6;
// QR=1 (response), opcode 0, AA=1 (authoritative), RCODE 0. A responder always
// sends this exact value; mDNS ignores the rest of the flag bits.
const FLAGS_AUTHORITATIVE_RESPONSE = 0x8400;

// A question is a name followed by 2-byte type and 2-byte class fields.
const QUESTION_SUFFIX_LENGTH = 4;
// A resource record is a name followed by type, class, TTL, and RDLENGTH.
const RECORD_HEADER_LENGTH = 10;
const RECORD_CLASS_OFFSET = 2;
const RECORD_TTL_OFFSET = 4;
const RECORD_RDLENGTH_OFFSET = 8;

// SRV rdata is priority, weight, and port before the target name.
const SRV_FIXED_LENGTH = 6;
const SRV_WEIGHT_OFFSET = 2;
const SRV_PORT_OFFSET = 4;

const ANSWER_COUNT = 4;
const MAX_LABEL_LENGTH = 63;
// Each TXT string is prefixed with a single length byte.
const MAX_TEXT_ENTRY_LENGTH = 255;

// Throws on a label over 63 bytes, which cannot be expressed on the wire.
// Callers must therefore not pass unvalidated remote input, and must not call
// this from a socket handler where an uncaught throw would take down the
// server. Build responses once at startup, inside a try/catch.
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

// Returns null rather than throwing, because every caller is parsing packets
// that arrived from the network and must not trust them.
function decodeName(buffer, offset) {
  const parts = [];
  let cursor = offset;
  while (cursor < buffer.length) {
    const length = buffer[cursor];
    if (length === 0) return { name: parts.join("."), offset: cursor + 1 };
    // Not a length check: a real label can never exceed 63, so a larger value
    // means the top two bits are set and this is a compression pointer into an
    // earlier name (RFC 1035 §4.1.4). An advertise-only responder never needs
    // to follow one, so we decline to parse the name at all.
    if (length > 63) return null;
    cursor += 1;
    if (cursor + length > buffer.length) return null;
    parts.push(buffer.toString("utf8", cursor, cursor + length));
    cursor += length;
  }
  // Ran off the end without a root byte.
  return null;
}

function decodeQuestions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < HEADER_LENGTH) return [];
  const count = buffer.readUInt16BE(QDCOUNT_OFFSET);
  const questions = [];
  let offset = HEADER_LENGTH;
  for (let index = 0; index < count; index += 1) {
    const decoded = decodeName(buffer, offset);
    // Deliberate give-up point: offsets are only discoverable by walking the
    // names in order, so one unparseable question hides every question after
    // it. We return what we understood rather than dropping the packet, which
    // means a bundled query whose later questions use compression is silently
    // left unanswered. That is an accepted limitation, not a bug -- but it is
    // the first thing to suspect if a client intermittently fails to discover
    // the server.
    if (!decoded || decoded.offset + QUESTION_SUFFIX_LENGTH > buffer.length) {
      return questions;
    }
    questions.push({
      name: decoded.name,
      type: buffer.readUInt16BE(decoded.offset)
    });
    // Skips the question's class field, whose top bit is the QU flag asking
    // for a unicast reply (RFC 6762 §5.4). We always answer by multicast, so
    // the flag is intentionally ignored.
    offset = decoded.offset + QUESTION_SUFFIX_LENGTH;
  }
  return questions;
}

function record(name, type, data, recordClass = CLASS_IN) {
  const encodedName = encodeName(name);
  const header = Buffer.alloc(RECORD_HEADER_LENGTH);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(recordClass, RECORD_CLASS_OFFSET);
  header.writeUInt32BE(TTL, RECORD_TTL_OFFSET);
  header.writeUInt16BE(data.length, RECORD_RDLENGTH_OFFSET);
  return Buffer.concat([encodedName, header, data]);
}

// Same contract as encodeName: throws rather than emitting a length byte that
// has silently wrapped modulo 256.
function textData(entries) {
  return Buffer.concat(
    entries.map((entry) => {
      const value = Buffer.from(entry, "utf8");
      if (value.length > MAX_TEXT_ENTRY_LENGTH) {
        throw new Error(
          `mDNS text entry "${entry}" is ${value.length} bytes; the limit is ${MAX_TEXT_ENTRY_LENGTH}`
        );
      }
      return Buffer.concat([Buffer.from([value.length]), value]);
    })
  );
}

function encodeResponse({ instance, host, address, port, version }) {
  const serviceName = `${instance}.${SERVICE_TYPE}`;
  const header = Buffer.alloc(HEADER_LENGTH);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(FLAGS_AUTHORITATIVE_RESPONSE, FLAGS_OFFSET);
  header.writeUInt16BE(ANSWER_COUNT, ANCOUNT_OFFSET);

  const srvData = Buffer.alloc(SRV_FIXED_LENGTH);
  srvData.writeUInt16BE(0, 0); // priority
  srvData.writeUInt16BE(0, SRV_WEIGHT_OFFSET);
  srvData.writeUInt16BE(port, SRV_PORT_OFFSET);

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

function primaryAddress() {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }
  return null;
}

function startAdvertisement({ port, version, instance = "PanelShelf" }) {
  const address = primaryAddress();
  if (!address) return { stop() {} };

  const host = `${os.hostname().split(".")[0]}.local`;

  // Encode once, here, not inside the message handler. encodeName throws on a
  // label over 63 bytes, and a hostname long enough to trip it is entirely
  // ordinary on macOS. Thrown from an EventEmitter handler that would be an
  // uncaught exception that kills the whole server on a stranger's query;
  // thrown here it lands in the caller's try/catch at startup.
  const response = encodeResponse({ instance, host, address, port, version });

  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  let closed = false;

  // close() throws ERR_SOCKET_DGRAM_NOT_RUNNING once the socket is already
  // closed. The error handler below runs inside an EventEmitter, where a throw
  // is an uncaught exception that would take the whole comic server down, so
  // every close goes through here. Discovery must never cost us HTTP.
  const closeSocket = () => {
    if (closed) return;
    closed = true;
    try {
      socket.close();
    } catch {
      // Never bound, or already closed underneath us.
    }
  };

  socket.on("error", closeSocket);

  socket.on("message", (message) => {
    const wanted = decodeQuestions(message).some(
      (question) => question.name === SERVICE_TYPE && question.type === TYPE_PTR
    );
    if (!wanted) return;
    socket.send(response, MULTICAST_PORT, MULTICAST_ADDRESS, () => {});
  });

  socket.bind(MULTICAST_PORT, () => {
    try {
      socket.addMembership(MULTICAST_ADDRESS);
      socket.setMulticastTTL(255);
    } catch {
      // Discovery is optional; manual entry always works.
    }
  });

  // The caller may discard this handle: the socket keeps the event loop alive,
  // but server.js shuts down through process.exit, so the process still exits.
  // A future graceful shutdown that drops process.exit would need to both call
  // stop() and unref the socket, or it will hang waiting on this socket.
  return { stop: closeSocket };
}

module.exports = {
  MULTICAST_ADDRESS,
  MULTICAST_PORT,
  SERVICE_TYPE,
  TYPE_PTR,
  decodeQuestions,
  encodeName,
  encodeResponse,
  startAdvertisement
};
