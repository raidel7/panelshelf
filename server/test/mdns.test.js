"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  SERVICE_TYPE,
  decodeQuestions,
  encodeName,
  encodeResponse,
  startAdvertisement
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

test("encodeResponse can build the same records with a zero TTL", () => {
  const answers = decodeAnswers(encodeResponse({ ...RESPONSE, ttl: 0 }));
  const live = decodeAnswers(encodeResponse(RESPONSE));

  assert.deepEqual(
    answers.map((answer) => answer.ttl),
    [0, 0, 0, 0],
    "a goodbye expires every record immediately (RFC 6762 s10.1)"
  );
  // Same records, same order, same classes -- only the TTL differs, because a
  // client matches a goodbye against its cache by name, type, class and rdata.
  assert.deepEqual(
    answers.map((answer) => [answer.name, answer.type, answer.class]),
    live.map((answer) => [answer.name, answer.type, answer.class])
  );
  assert.deepEqual(
    answers.map((answer) => answer.rdata.toString("hex")),
    live.map((answer) => answer.rdata.toString("hex"))
  );
});

test("encodeResponse rejects a TXT entry longer than 255 bytes", () => {
  assert.throws(
    () => encodeResponse({ ...RESPONSE, version: "9".repeat(256) }),
    { message: /text entry/i }
  );
});

// --- startAdvertisement, driven through the injection seam ---------------
//
// The socket wrapper needs a real multicast socket, which a unit test must not
// open: binding UDP 5353 on a developer machine collides with the system's own
// responder and makes the suite depend on the local network. startAdvertisement
// therefore accepts a socket factory and an interface source, both defaulting to
// dgram and os, so these tests can drive a fake.

const { EventEmitter } = require("node:events");

function fakeSocket() {
  const socket = new EventEmitter();
  socket.sent = [];
  socket.closeCount = 0;
  socket.membershipCalls = 0;
  socket.bindCalls = [];
  socket.failMembership = null;
  socket.sendError = null;
  socket.bind = (port, callback) => {
    socket.bindCalls.push(port);
    // dgram invokes the listening callback asynchronously; these tests want the
    // post-bind state to be settled by the time startAdvertisement returns, and
    // the wrapper must not care either way.
    if (callback) callback();
  };
  socket.addMembership = () => {
    socket.membershipCalls += 1;
    if (socket.failMembership) throw socket.failMembership;
  };
  socket.setMulticastTTL = () => {};
  socket.multicastInterface = null;
  socket.failMulticastInterface = null;
  socket.setMulticastInterface = (address) => {
    if (socket.failMulticastInterface) throw socket.failMulticastInterface;
    socket.multicastInterface = address;
  };
  socket.send = (message, port, address, callback) => {
    socket.sent.push({ message, port, address });
    if (callback) callback(socket.sendError);
  };
  socket.close = () => {
    socket.closeCount += 1;
  };
  return socket;
}

const LAN_INTERFACES = {
  lo0: [{ family: "IPv4", internal: true, address: "127.0.0.1" }],
  eth0: [{ family: "IPv4", internal: false, address: "192.168.1.69" }]
};

function advertise(overrides = {}) {
  const socket = fakeSocket();
  const handle = startAdvertisement({
    port: 8251,
    version: "0.4.4",
    createSocket: () => socket,
    networkInterfaces: () => LAN_INTERFACES,
    ...overrides
  });
  return { socket, handle };
}

function queryPacket(name, type = 12) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(1, 4);
  const suffix = Buffer.alloc(4);
  suffix.writeUInt16BE(type, 0);
  suffix.writeUInt16BE(1, 2);
  return Buffer.concat([header, encodeName(name), suffix]);
}

test("startAdvertisement answers a PTR query for our service type", () => {
  const { socket, handle } = advertise();

  socket.emit("message", queryPacket(SERVICE_TYPE));

  assert.equal(socket.sent.length, 1, "one response sent");
  assert.equal(socket.sent[0].port, 5353);
  assert.equal(socket.sent[0].address, "224.0.0.251");
  assert.ok(
    socket.sent[0].message.includes(Buffer.from("_panelshelf", "utf8")),
    "the datagram carries our service records"
  );

  const state = handle.state();
  assert.equal(state.active, true);
  assert.equal(state.reason, null);
  assert.equal(state.bound, true);
  assert.equal(state.membership, true);
  assert.equal(state.address, "192.168.1.69");
  assert.equal(state.port, 8251);
  assert.equal(state.instance, "PanelShelf");
  assert.equal(state.serviceType, SERVICE_TYPE);
  assert.deepEqual(state.counters, {
    datagrams: 1,
    queries: 1,
    responses: 1,
    announcements: 0,
    goodbyes: 0
  });
  handle.stop();
});

test("startAdvertisement ignores a query for someone else's service", () => {
  const { socket, handle } = advertise();

  socket.emit("message", queryPacket("_airplay._tcp.local"));
  socket.emit("message", queryPacket(SERVICE_TYPE, 1)); // right name, A not PTR
  socket.emit("message", Buffer.from([1, 2, 3])); // malformed

  assert.equal(socket.sent.length, 0, "no response to an unrelated query");
  assert.deepEqual(handle.state().counters, {
    datagrams: 3,
    queries: 0,
    responses: 0,
    announcements: 0,
    goodbyes: 0
  });
  handle.stop();
});

test("startAdvertisement counts every datagram, query, and response", () => {
  const { socket, handle } = advertise();

  socket.emit("message", queryPacket(SERVICE_TYPE));
  socket.emit("message", queryPacket("_smb._tcp.local"));
  socket.emit("message", queryPacket(SERVICE_TYPE));

  assert.deepEqual(handle.state().counters, {
    datagrams: 3,
    queries: 2,
    responses: 2,
    announcements: 0,
    goodbyes: 0
  });
  handle.stop();
});

// Measured on this developer Mac: a socket that does not pick an interface
// sends from 10.14.0.2, a VPN address, because the kernel uses the default
// route -- so every announcement left on the tunnel and never touched the LAN.
// A NAS with a VPN, a Docker bridge, or a second NIC can do exactly the same.
test("startAdvertisement sends on the interface it advertises", () => {
  const { socket, handle } = advertise();

  assert.equal(
    socket.multicastInterface,
    "192.168.1.69",
    "the send interface is the address in the A record, not the default route"
  );
  assert.equal(handle.state().multicastInterface, "192.168.1.69");
  handle.stop();
});

test("a multicast interface failure is reported in state, not thrown", () => {
  const socket = fakeSocket();
  socket.failMulticastInterface = new Error("EADDRNOTAVAIL: cannot assign");

  const handle = startAdvertisement({
    port: 8251,
    version: "0.4.4",
    createSocket: () => socket,
    networkInterfaces: () => LAN_INTERFACES
  });

  const state = handle.state();
  assert.equal(state.multicastInterface, null);
  assert.match(state.lastError.multicastInterface, /EADDRNOTAVAIL/);
  assert.equal(
    state.membership,
    true,
    "the group join is separate and still succeeded"
  );
  assert.equal(state.lastError.membership, null);
  handle.stop();
});

test("a multicast membership failure is reported in state, not thrown", () => {
  const socket = fakeSocket();
  socket.failMembership = new Error("EADDRNOTAVAIL: no such interface");

  const handle = startAdvertisement({
    port: 8251,
    version: "0.4.4",
    createSocket: () => socket,
    networkInterfaces: () => LAN_INTERFACES
  });

  const state = handle.state();
  assert.equal(state.bound, true, "the bind itself still succeeded");
  assert.equal(state.membership, false);
  assert.match(state.lastError.membership, /EADDRNOTAVAIL/);
  handle.stop();
});

test("a socket error does not escape and is recorded in state", () => {
  const { socket, handle } = advertise();

  // An EventEmitter with no error listener rethrows; the wrapper must own it.
  socket.emit("error", new Error("EACCES: permission denied"));

  const state = handle.state();
  assert.equal(state.active, false);
  assert.match(state.lastError.socket, /EACCES/);
  assert.equal(socket.closeCount, 1, "the socket is closed on error");
  handle.stop();
  assert.equal(socket.closeCount, 1, "stop() after an error is idempotent");
});

test("a bind failure is recorded as a bind error, not a socket error", () => {
  const socket = fakeSocket();
  socket.bind = (port) => {
    socket.bindCalls.push(port);
    socket.emit("error", new Error("EADDRINUSE: address already in use"));
  };

  const handle = startAdvertisement({
    port: 8251,
    version: "0.4.4",
    createSocket: () => socket,
    networkInterfaces: () => LAN_INTERFACES
  });

  const state = handle.state();
  assert.equal(state.active, false);
  assert.equal(state.bound, false);
  assert.match(state.reason, /bind/i);
  assert.match(state.lastError.bind, /EADDRINUSE/);
  assert.equal(state.lastError.socket, null, "the bind never succeeded");
  handle.stop();
});

test("a send failure is recorded without throwing", () => {
  const { socket, handle } = advertise();
  socket.sendError = new Error("ENETUNREACH: network is unreachable");

  socket.emit("message", queryPacket(SERVICE_TYPE));

  assert.match(handle.state().lastError.send, /ENETUNREACH/);
  handle.stop();
});

test("a host with no usable address reports inactive with a reason", () => {
  let created = false;
  const handle = startAdvertisement({
    port: 8251,
    version: "0.4.4",
    createSocket: () => {
      created = true;
      return fakeSocket();
    },
    networkInterfaces: () => ({
      lo0: [{ family: "IPv4", internal: true, address: "127.0.0.1" }],
      eth0: [{ family: "IPv6", internal: false, address: "fe80::1" }]
    })
  });

  const state = handle.state();
  assert.equal(created, false, "no socket is opened without an address");
  assert.equal(state.active, false);
  assert.equal(state.bound, false);
  assert.equal(state.address, null);
  assert.match(state.reason, /address/i);
  assert.deepEqual(state.counters, {
    datagrams: 0,
    queries: 0,
    responses: 0,
    announcements: 0,
    goodbyes: 0
  });
  handle.stop();
  handle.stop();
});

test("stop() marks the advertisement inactive and stays idempotent", () => {
  const { socket, handle } = advertise();

  handle.stop();
  handle.stop();

  assert.equal(socket.closeCount, 1);
  const state = handle.state();
  assert.equal(state.active, false);
  assert.match(state.reason, /stop/i);
});

// --- unsolicited announcement --------------------------------------------
//
// Measured on the NAS: our socket binds 5353 with reuseAddr while avahi already
// owns it, and the kernel hands every query to avahi. /api/discovery reported
// 169 datagrams and 0 queries over 18 minutes, and a live 12-second dns-sd
// browse from another machine moved the datagram counter by zero. Receiving is
// therefore not something we can rely on; sending is unaffected by the
// contention, so the responder announces on its own (RFC 6762 s8.3) and these
// tests cover that path.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Tiny delays keep the suite fast. The seam exists only for that -- production
// keeps the RFC-shaped burst and the 90-second refresh.
const FAST = { announceDelaysMs: [0, 5], announceIntervalMs: 1_000_000 };

test("startAdvertisement announces unsolicited at startup", async () => {
  const { socket, handle } = advertise(FAST);

  assert.equal(socket.sent.length, 0, "nothing is sent synchronously");
  await sleep(40);

  assert.equal(socket.sent.length, 2, "RFC 6762 s8.3 wants at least two");
  for (const datagram of socket.sent) {
    assert.equal(datagram.port, 5353);
    assert.equal(datagram.address, "224.0.0.251");
    const answers = decodeAnswers(datagram.message);
    assert.deepEqual(
      answers.map((answer) => answer.type),
      [12, 33, 16, 1],
      "a full announcement, not just the PTR"
    );
    assert.deepEqual(
      answers.map((answer) => answer.ttl),
      [120, 120, 120, 120],
      "a live announcement, not a goodbye"
    );
  }

  const state = handle.state();
  assert.equal(state.counters.announcements, 2);
  assert.equal(state.counters.goodbyes, 0);
  assert.equal(state.lastError.send, null);
  assert.ok(
    Date.now() - Date.parse(state.lastAnnouncedAt) < 10_000,
    `lastAnnouncedAt is a recent timestamp, got ${state.lastAnnouncedAt}`
  );
  handle.stop();
});

test("startAdvertisement keeps announcing on a timer", async () => {
  const { socket, handle } = advertise({
    announceDelaysMs: [0],
    announceIntervalMs: 10
  });

  await sleep(80);
  const sentWhileRunning = socket.sent.length;

  assert.ok(
    sentWhileRunning >= 3,
    `the timer keeps announcing, got ${sentWhileRunning}`
  );
  assert.equal(handle.state().counters.announcements, sentWhileRunning);
  handle.stop();
});

test("stop() sends a goodbye and halts the timer", async () => {
  const { socket, handle } = advertise({
    announceDelaysMs: [0],
    announceIntervalMs: 10
  });

  await sleep(50);
  const announced = socket.sent.length;
  handle.stop();

  const goodbye = socket.sent[socket.sent.length - 1];
  assert.equal(socket.sent.length, announced + 1, "exactly one goodbye");
  assert.equal(goodbye.port, 5353);
  assert.equal(goodbye.address, "224.0.0.251");
  assert.deepEqual(
    decodeAnswers(goodbye.message).map((answer) => answer.ttl),
    [0, 0, 0, 0],
    "a goodbye expires every record"
  );
  assert.equal(handle.state().counters.goodbyes, 1);
  assert.equal(socket.closeCount, 1);

  await sleep(50);
  assert.equal(
    socket.sent.length,
    announced + 1,
    "the timer is stopped, so nothing is sent after stop()"
  );

  handle.stop();
  assert.equal(socket.closeCount, 1, "stop() stays idempotent");
  assert.equal(
    handle.state().counters.goodbyes,
    1,
    "a second stop() does not send a second goodbye"
  );
});

test("a failed announcement is recorded, not thrown", async () => {
  const { socket, handle } = advertise(FAST);
  socket.sendError = new Error("ENETUNREACH: network is unreachable");

  await sleep(40);

  const state = handle.state();
  assert.ok(state.counters.announcements >= 1, "the attempt is still counted");
  assert.match(state.lastError.send, /ENETUNREACH/);
  assert.equal(state.active, true, "a failed send does not kill the responder");
  handle.stop();
});

test("a socket that throws on send does not take the process down", async () => {
  const socket = fakeSocket();
  socket.send = () => {
    throw new Error("ERR_SOCKET_DGRAM_NOT_RUNNING");
  };
  const handle = startAdvertisement({
    port: 8251,
    version: "0.4.4",
    createSocket: () => socket,
    networkInterfaces: () => LAN_INTERFACES,
    ...FAST
  });

  await sleep(40);

  assert.match(handle.state().lastError.send, /NOT_RUNNING/);
  handle.stop(); // the goodbye throws too, and must stay contained
  assert.equal(handle.state().active, false);
});

test("an advertisement with no address never announces", async () => {
  const handle = startAdvertisement({
    port: 8251,
    version: "0.4.4",
    createSocket: () => fakeSocket(),
    networkInterfaces: () => ({}),
    ...FAST
  });

  await sleep(30);

  const state = handle.state();
  assert.equal(state.counters.announcements, 0);
  assert.equal(state.lastAnnouncedAt, null);
  handle.stop();
  assert.equal(state.counters.goodbyes, 0);
});
