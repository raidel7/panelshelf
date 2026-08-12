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
// A goodbye is the same records with a zero TTL (RFC 6762 §10.1).
const TTL_GOODBYE = 0;

// RFC 6762 §8.3 requires at least two announcements one second apart, and
// permits up to eight with the gap doubling each time. Three covers the case of
// a single datagram being dropped -- multicast is unreliable and nothing
// retransmits it -- without adding meaningful traffic. The first is scheduled
// rather than sent inline so no packet leaves before the caller holds the
// handle, and so a throw can never escape into startAdvertisement's caller.
const ANNOUNCE_DELAYS_MS = [0, 1_000, 3_000];

// Then repeat forever, because a browser that starts later has no way to ask us
// anything: on the NAS our socket never receives queries at all (avahi owns UDP
// 5353), so a client's own query is not a path back to us. 90 seconds is chosen
// against the 120-second record TTL: every announcement refreshes a listener's
// cache with 30 seconds to spare, so a passive client never sees the service
// lapse and reappear, while four records every 90 seconds is negligible next to
// ordinary LAN mDNS chatter.
const ANNOUNCE_INTERVAL_MS = 90_000;
const TYPE_A = 1;
const TYPE_PTR = 12;
const TYPE_TXT = 16;
const TYPE_SRV = 33;
const CLASS_IN = 1;
// RFC 6762 §10.2: the top bit of the class field tells clients to flush any
// cached records with the same name and type. Only for names we own.
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

function record(name, type, data, recordClass = CLASS_IN, ttl = TTL) {
  const encodedName = encodeName(name);
  const header = Buffer.alloc(RECORD_HEADER_LENGTH);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(recordClass, RECORD_CLASS_OFFSET);
  header.writeUInt32BE(ttl, RECORD_TTL_OFFSET);
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

// ttl is a parameter rather than a second encoder because a goodbye (RFC 6762
// §10.1) is byte-for-byte the announcement with every TTL set to zero: clients
// match it against their cache by name, type, class and rdata, so the two must
// never drift apart.
function encodeResponse({ instance, host, address, port, version, ttl = TTL }) {
  const serviceName = `${instance}.${SERVICE_TYPE}`;
  const header = Buffer.alloc(HEADER_LENGTH);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(FLAGS_AUTHORITATIVE_RESPONSE, FLAGS_OFFSET);
  header.writeUInt16BE(ANSWER_COUNT, ANCOUNT_OFFSET);

  const srvData = Buffer.alloc(SRV_FIXED_LENGTH);
  srvData.writeUInt16BE(0, 0); // priority
  srvData.writeUInt16BE(0, SRV_WEIGHT_OFFSET);
  srvData.writeUInt16BE(port, SRV_PORT_OFFSET);

  // The three classes differ deliberately.
  // PTR is shared with any other responder for this service type, so it keeps
  // the plain class.
  // SRV and TXT sit under our own instance name, which nothing else claims, so
  // they flush.
  // A sits under <hostname>.local, which we do NOT own: on DSM (and macOS) the
  // system's own responder owns and defends that name, and RFC 6762 §8 requires
  // probing before claiming a unique name -- which an advertise-only responder
  // deliberately never does. Setting the flush bit here would tell every client
  // on the LAN to discard its cached address for a name belonging to someone
  // else, which is the one thing this responder could break outside PanelShelf.
  const answers = [
    record(SERVICE_TYPE, TYPE_PTR, encodeName(serviceName), CLASS_IN, ttl),
    record(
      serviceName,
      TYPE_SRV,
      Buffer.concat([srvData, encodeName(host)]),
      CLASS_IN_FLUSH,
      ttl
    ),
    record(
      serviceName,
      TYPE_TXT,
      textData([`version=${version}`, `port=${port}`, "path=/api/health"]),
      CLASS_IN_FLUSH,
      ttl
    ),
    record(
      host,
      TYPE_A,
      Buffer.from(address.split(".").map(Number)),
      CLASS_IN,
      ttl
    )
  ];

  return Buffer.concat([header, ...answers]);
}

// State is read over HTTP and written to a log, so every recorded error is
// reduced to a plain string here rather than carrying an Error through JSON,
// which would serialize to {}.
function errorMessage(error) {
  if (!error) return "unknown error";
  return String(error.message || error);
}

function primaryAddress(interfaces) {
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }
  return null;
}

// createSocket and networkInterfaces exist so tests can drive the responder
// without opening a real multicast socket or depending on the machine's own
// interfaces. announceDelaysMs and announceIntervalMs exist so those tests do
// not have to wait out real seconds. All four default to production values, and
// server.js passes none of them.
function startAdvertisement({
  port,
  version,
  instance = "PanelShelf",
  createSocket = (options) => dgram.createSocket(options),
  networkInterfaces = () => os.networkInterfaces(),
  announceDelaysMs = ANNOUNCE_DELAYS_MS,
  announceIntervalMs = ANNOUNCE_INTERVAL_MS
}) {
  // Every failure path below used to be silent, which made a NAS that simply
  // never appears in dns-sd indistinguishable from one whose socket lost the
  // bind to the system responder. state() reports what actually happened,
  // recorded where it happens rather than inferred afterwards. Nothing here
  // changes what the responder does -- only what it can tell us about it.
  const counters = {
    datagrams: 0,
    queries: 0,
    responses: 0,
    announcements: 0,
    goodbyes: 0
  };
  const lastError = {
    bind: null,
    membership: null,
    multicastInterface: null,
    socket: null,
    send: null
  };
  let bound = false;
  let membership = false;
  let active = false;
  let reason = null;
  let lastAnnouncedAt = null;
  let multicastInterface = null;

  const address = primaryAddress(networkInterfaces());
  const host = `${os.hostname().split(".")[0]}.local`;

  const state = () => ({
    active,
    reason,
    serviceType: SERVICE_TYPE,
    instance,
    host: address ? host : null,
    address,
    port,
    bound,
    membership,
    multicastInterface,
    // Announcing is the path that actually makes us discoverable, so its state
    // has to be readable over HTTP: an operator with no shell on the NAS must
    // be able to tell "announced 5 times, no errors" from "never announced".
    announceIntervalMs,
    lastAnnouncedAt,
    counters: { ...counters },
    lastError: { ...lastError }
  });

  if (!address) {
    reason = "no external IPv4 address found on any interface";
    return { stop() {}, state };
  }

  // Encode once, here, not inside the message handler. encodeName throws on a
  // label over 63 bytes, and a hostname long enough to trip it is entirely
  // ordinary on macOS. Thrown from an EventEmitter handler that would be an
  // uncaught exception that kills the whole server on a stranger's query;
  // thrown here it lands in the caller's try/catch at startup.
  const response = encodeResponse({ instance, host, address, port, version });
  // Built at startup for the same reason as the response: stop() runs on a
  // shutdown path where a throw is least welcome.
  const goodbye = encodeResponse({
    instance,
    host,
    address,
    port,
    version,
    ttl: TTL_GOODBYE
  });

  const socket = createSocket({ type: "udp4", reuseAddr: true });
  let closed = false;
  let stopping = false;
  const timers = new Set();

  // close() throws ERR_SOCKET_DGRAM_NOT_RUNNING once the socket is already
  // closed. The error handler below runs inside an EventEmitter, where a throw
  // is an uncaught exception that would take the whole comic server down, so
  // every close goes through here. Discovery must never cost us HTTP.
  const closeSocket = () => {
    if (closed) return;
    closed = true;
    active = false;
    try {
      socket.close();
    } catch {
      // Never bound, or already closed underneath us.
    }
  };

  // Errors reach us as an EventEmitter event, which carries no indication of
  // which operation failed. The bind is the only thing in flight before the
  // listening callback runs, so an error before then is a bind error and an
  // error after it is the live socket failing. Distinguishing them matters:
  // "lost UDP 5353 to the system responder" and "the socket died later" call
  // for completely different fixes.
  socket.on("error", (error) => {
    if (bound) {
      lastError.socket = errorMessage(error);
      reason = "socket error";
    } else {
      lastError.bind = errorMessage(error);
      reason = "bind failed";
    }
    closeSocket();
  });

  // Sends from the socket bound to 5353. Binding is contended -- on the NAS
  // avahi owns the port and the kernel delivers every query to it -- but
  // sending is not: any socket may send to 224.0.0.251:5353, and sending from
  // the bound one gives the datagram source port 5353, which some clients
  // require of a multicast DNS response. If the bind failed the socket is
  // already closed and the guard below skips the send, so sharing costs us
  // nothing on the failure paths; a separate ephemeral socket would only add a
  // second thing that can fail while making our packets look less legitimate.
  const sendPacket = (packet, done = () => {}) => {
    if (closed) return false;
    try {
      socket.send(packet, MULTICAST_PORT, MULTICAST_ADDRESS, (error) => {
        if (error) lastError.send = errorMessage(error);
        done();
      });
    } catch (error) {
      // dgram throws synchronously if the socket died between the guard above
      // and the call. This runs from a timer and from stop(); an escaping throw
      // would be an uncaught exception that takes the comic server down with
      // it, and discovery must never cost us HTTP.
      lastError.send = errorMessage(error);
      done();
      return false;
    }
    return true;
  };

  // The whole point of the change: we announce unprompted rather than waiting
  // to be asked. RFC 6762 §8.3. Continuous browsers -- dns-sd, and the
  // NWBrowser an iPad client uses -- cache what arrives unsolicited, so this is
  // enough to be discovered even though we never see a single query.
  const announce = () => {
    // Counted when handed to the socket, not when the callback comes back
    // clean, so an announcement into a black hole still shows here with the
    // reason in lastError.send.
    if (!sendPacket(response)) return;
    counters.announcements += 1;
    lastAnnouncedAt = new Date().toISOString();
  };

  const schedule = (fn, delay, repeat = false) => {
    const timer = repeat ? setInterval(fn, delay) : setTimeout(fn, delay);
    // Never let discovery hold the process open. A missing unref would turn a
    // clean shutdown into a hang once server.js stops calling process.exit.
    if (typeof timer.unref === "function") timer.unref();
    timers.add(timer);
    return timer;
  };

  const clearTimers = () => {
    for (const timer of timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    timers.clear();
  };

  // Kept, and no longer load-bearing. On any host where 5353 is free this
  // answers queries directly and costs nothing; on the NAS it never fires,
  // because avahi already owns the port and the kernel hands it every packet
  // (measured: 0 queries seen across a live browse). Treat it as a bonus path
  // -- if discovery breaks, look at the announcements above, not here.
  socket.on("message", (message) => {
    counters.datagrams += 1;
    const wanted = decodeQuestions(message).some(
      (question) => question.name === SERVICE_TYPE && question.type === TYPE_PTR
    );
    if (!wanted) return;
    counters.queries += 1;
    // Counted as sent when handed to the socket, not when the callback comes
    // back clean: a send that failed still shows here, with the reason in
    // lastError.send, so a NAS answering into a black hole is distinguishable
    // from one that never sees a query at all.
    counters.responses += 1;
    sendPacket(response);
  });

  reason = "binding";
  socket.bind(MULTICAST_PORT, () => {
    bound = true;
    if (!closed) {
      active = true;
      reason = null;
    }
    try {
      socket.addMembership(MULTICAST_ADDRESS);
      // Recorded before setMulticastTTL, which is a separate call that can fail
      // on its own: the group join is what decides whether queries ever arrive.
      membership = true;
      socket.setMulticastTTL(255);
    } catch (error) {
      // Discovery is optional; manual entry always works. Recorded rather than
      // swallowed: a socket that bound but never joined the group receives
      // nothing, which from outside looks exactly like a firewall drop.
      lastError.membership = errorMessage(error);
    }

    try {
      // Its own try/catch, because this decides where our announcements go and
      // the group join decides what we receive: one failing must not hide the
      // other. Without it the kernel sends on the default route's interface,
      // which on a host with a VPN or a Docker bridge is not the LAN -- on the
      // developer Mac this was measured sending from a 10.14.0.2 tunnel
      // address while advertising a 192.168.x.x A record, so nothing on the LAN
      // ever saw an announcement. Pinning it to the address we advertise keeps
      // the two consistent.
      socket.setMulticastInterface(address);
      multicastInterface = address;
    } catch (error) {
      lastError.multicastInterface = errorMessage(error);
    }

    // Announcing needs a socket that has finished binding, so the burst starts
    // here rather than at call time. It survives a failed group join: joining
    // decides what we receive, and we no longer depend on receiving anything.
    if (closed || stopping) return;
    for (const delay of announceDelaysMs) schedule(announce, delay);
    schedule(announce, announceIntervalMs, true);
  });

  // The caller may discard this handle: the socket keeps the event loop alive,
  // but server.js shuts down through process.exit, so the process still exits.
  // A future graceful shutdown that drops process.exit would need to both call
  // stop() and unref the socket, or it will hang waiting on this socket.
  return {
    stop() {
      clearTimers();
      // Only the first stop names itself as the reason: a socket that already
      // errored keeps the reason that explains the failure.
      if (!closed) reason = "stopped";
      active = false;
      if (closed || stopping) {
        closeSocket();
        return;
      }
      stopping = true;
      // A goodbye is the same records with TTL 0 (RFC 6762 §10.1): clients drop
      // the service at once instead of showing a dead server for up to the full
      // TTL. Sent before the close, and the close is deferred to the send
      // callback so the datagram is not discarded with the socket. The fallback
      // timer covers a callback that never arrives; both paths run through
      // closeSocket, which is idempotent.
      if (sendPacket(goodbye, closeSocket)) counters.goodbyes += 1;
      schedule(closeSocket, 250);
    },
    state
  };
}

module.exports = {
  SERVICE_TYPE,
  decodeQuestions,
  encodeName,
  encodeResponse,
  startAdvertisement
};
