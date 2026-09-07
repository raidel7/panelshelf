"use strict";

// One worker thread's whole job: turn a full-size cover into a thumbnail and
// send it back. It exists because `createThumbnail` is a synchronous decode,
// resize and re-encode in pure JavaScript, and on a NAS that is roughly a
// second per cover — a second in which the event loop cannot answer anything.
//
// The parent addresses every request by id rather than assuming replies come
// back in order, so a worker is free to be given more than one at a time.

const { parentPort } = require("node:worker_threads");
const { UnsupportedImageError, createThumbnail } = require("./thumbnail");

parentPort.on("message", (message) => {
  const { id, buffer } = message || {};
  try {
    const thumbnail = createThumbnail(Buffer.from(buffer));
    // `null` is a real answer: the cover is already smaller than a card, and
    // the caller should serve it as it is.
    parentPort.postMessage(
      thumbnail
        ? {
            id,
            ok: true,
            buffer: thumbnail.buffer,
            mime: thumbnail.mime,
            width: thumbnail.width,
            height: thumbnail.height
          }
        : { id, ok: true, empty: true }
    );
  } catch (error) {
    // An Error does not survive a structured clone with its class intact, and
    // the difference between "this format is not supported" and "something
    // went wrong" is one the caller acts on: the first is recorded so the
    // decode is never attempted again.
    parentPort.postMessage({
      id,
      ok: false,
      unsupported: error instanceof UnsupportedImageError,
      message: error && error.message ? error.message : "The cover could not be read."
    });
  }
});
