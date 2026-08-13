"use strict";

// Grid-sized cover thumbnails, generated without a native image library.
//
// The package ships as a Synology .spk that bundles a Node runtime and exactly
// one dependency, and it is built for x86_64, armv8 and armv7 from the same
// tree. A native image library would need per-architecture binaries, so
// everything here is plain JavaScript: a baseline + progressive JPEG decoder, a
// PNG decoder, a box-filter resampler, and a baseline JPEG encoder.
//
// The decoder never reconstructs the full-resolution image. Covers are three to
// six times larger than a thumbnail, so the inverse DCT runs at the smallest
// 1/8, 1/4, 1/2 or 1/1 scale that still leaves enough pixels to resample from.
// A 1074x1650 cover comes out of the entropy decoder as a 537x825 working image
// rather than a 1074x1650 one, which is a quarter of the IDCT work and a
// quarter of the bytes to resample.

const zlib = require("node:zlib");

// A 2:3 cover at 480 tall is 320 wide. The iPad grid draws cards about 140pt
// wide, and the 13-inch layout stretches them to roughly 180pt, so a Retina
// (@2x) card needs 280-360 device pixels; the web shelf's cards start at 172
// CSS pixels. 480 covers the widest of those with headroom and still lands
// around 20-30x smaller than the original. It is a constant on purpose: a
// caller-chosen size would multiply the on-disk cache by the number of sizes
// ever requested and let anyone pin a NAS CPU by walking through sizes.
const THUMBNAIL_MAX_EDGE = 480;
// The usual encoder default. At 480px the step down from 78 is invisible on a
// card and takes another ~8% off the file.
const THUMBNAIL_QUALITY = 75;
const THUMBNAIL_MIME = "image/jpeg";
const THUMBNAIL_EXTENSION = ".jpg";

const ZIGZAG = new Int32Array([
  0, 1, 8, 16, 9, 2, 3, 10,
  17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34,
  27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36,
  29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46,
  53, 60, 61, 54, 47, 55, 62, 63
]);

// Raised when the bytes are a real image we simply cannot take apart in pure
// JavaScript (WebP, arithmetic-coded or CMYK JPEG, interlaced PNG, ...). The
// caller falls back to the full-size cover rather than failing the request.
class UnsupportedImageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnsupportedImageError";
  }
}

function unsupported(message) {
  return new UnsupportedImageError(message);
}

/* ------------------------------------------------------------------ *
 * JPEG decoding
 * ------------------------------------------------------------------ */

function buildHuffmanTable(codeLengths, values) {
  let code = [];
  let k = 0;
  let length = 16;
  while (length > 0 && !codeLengths[length - 1]) length--;
  code.push({ children: [], index: 0 });
  let p = code[0];
  let q;
  for (let i = 0; i < length; i++) {
    for (let j = 0; j < codeLengths[i]; j++) {
      p = code.pop();
      p.children[p.index] = values[k];
      while (p.index > 0) {
        p = code.pop();
      }
      p.index++;
      code.push(p);
      while (code.length <= i) {
        q = { children: [], index: 0 };
        code.push(q);
        p.children[p.index] = q.children;
        p = q;
      }
      k++;
    }
    if (i + 1 < length) {
      q = { children: [], index: 0 };
      code.push(q);
      p.children[p.index] = q.children;
      p = q;
    }
  }
  return code[0].children;
}

function blockOffsetFor(component, row, col) {
  return 64 * (row * component.blocksPerLineForMcu + col);
}

function decodeScan(
  data,
  start,
  frame,
  components,
  resetInterval,
  spectralStart,
  spectralEnd,
  successivePrev,
  successive
) {
  const { mcusPerLine, progressive } = frame;
  let offset = start;
  let bitsData = 0;
  let bitsCount = 0;
  let eobrun = 0;
  let successiveACState = 0;
  let successiveACNextValue = 0;

  function readBit() {
    if (bitsCount > 0) {
      bitsCount--;
      return (bitsData >> bitsCount) & 1;
    }
    if (offset >= data.length) throw unsupported("Truncated JPEG scan.");
    bitsData = data[offset++];
    if (bitsData === 0xff) {
      const next = data[offset];
      if (next === 0x00) {
        offset++;
      } else if (next >= 0xd0 && next <= 0xd7) {
        // A restart marker inside the entropy stream; the caller realigns.
        throw unsupported("Unexpected restart marker in JPEG scan.");
      } else {
        throw unsupported("Unexpected marker in JPEG scan.");
      }
    }
    bitsCount = 7;
    return bitsData >>> 7;
  }

  function decodeHuffman(tree) {
    let node = tree;
    for (;;) {
      node = node[readBit()];
      if (typeof node === "number") return node;
      if (typeof node !== "object" || node === null) {
        throw unsupported("Invalid JPEG Huffman code.");
      }
    }
  }

  function receive(count) {
    let value = 0;
    for (let i = 0; i < count; i++) value = (value << 1) | readBit();
    return value;
  }

  function receiveAndExtend(length) {
    if (length === 0) return 0;
    if (length === 1) return readBit() === 1 ? 1 : -1;
    const value = receive(length);
    if (value >= 1 << (length - 1)) return value;
    return value + (-1 << length) + 1;
  }

  function decodeBaseline(component, blockOffset) {
    const t = decodeHuffman(component.huffmanTableDC);
    const diff = t === 0 ? 0 : receiveAndExtend(t);
    component.pred += diff;
    component.blockData[blockOffset] = component.pred;
    let k = 1;
    while (k < 64) {
      const rs = decodeHuffman(component.huffmanTableAC);
      const s = rs & 15;
      const r = rs >> 4;
      if (s === 0) {
        if (r < 15) break;
        k += 16;
        continue;
      }
      k += r;
      if (k > 63) break;
      component.blockData[blockOffset + ZIGZAG[k]] = receiveAndExtend(s);
      k++;
    }
  }

  function decodeDCFirst(component, blockOffset) {
    const t = decodeHuffman(component.huffmanTableDC);
    const diff = t === 0 ? 0 : receiveAndExtend(t) << successive;
    component.pred += diff;
    component.blockData[blockOffset] = component.pred;
  }

  function decodeDCSuccessive(component, blockOffset) {
    component.blockData[blockOffset] |= readBit() << successive;
  }

  function decodeACFirst(component, blockOffset) {
    if (eobrun > 0) {
      eobrun--;
      return;
    }
    let k = spectralStart;
    while (k <= spectralEnd) {
      const rs = decodeHuffman(component.huffmanTableAC);
      const s = rs & 15;
      const r = rs >> 4;
      if (s === 0) {
        if (r < 15) {
          eobrun = receive(r) + (1 << r) - 1;
          break;
        }
        k += 16;
        continue;
      }
      k += r;
      if (k > 63) break;
      component.blockData[blockOffset + ZIGZAG[k]] =
        receiveAndExtend(s) * (1 << successive);
      k++;
    }
  }

  function decodeACSuccessive(component, blockOffset) {
    let k = spectralStart;
    let r = 0;
    while (k <= spectralEnd) {
      const z = blockOffset + ZIGZAG[k];
      const sign = component.blockData[z] < 0 ? -1 : 1;
      switch (successiveACState) {
        case 0: {
          const rs = decodeHuffman(component.huffmanTableAC);
          const s = rs & 15;
          r = rs >> 4;
          if (s === 0) {
            if (r < 15) {
              eobrun = receive(r) + (1 << r);
              successiveACState = 4;
            } else {
              r = 16;
              successiveACState = 1;
            }
          } else {
            if (s !== 1) throw unsupported("Invalid progressive JPEG scan.");
            successiveACNextValue = receiveAndExtend(s);
            successiveACState = r ? 2 : 3;
          }
          continue;
        }
        case 1:
        case 2:
          if (component.blockData[z]) {
            component.blockData[z] += sign * (readBit() << successive);
          } else {
            r--;
            if (r === 0) successiveACState = successiveACState === 2 ? 3 : 0;
          }
          break;
        case 3:
          if (component.blockData[z]) {
            component.blockData[z] += sign * (readBit() << successive);
          } else {
            component.blockData[z] = successiveACNextValue << successive;
            successiveACState = 0;
          }
          break;
        case 4:
          if (component.blockData[z]) {
            component.blockData[z] += sign * (readBit() << successive);
          }
          break;
        default:
          throw unsupported("Invalid progressive JPEG scan.");
      }
      k++;
    }
    if (successiveACState === 4) {
      eobrun--;
      if (eobrun === 0) successiveACState = 0;
    }
  }

  let decodeFn;
  if (progressive) {
    if (spectralStart === 0) {
      decodeFn = successivePrev === 0 ? decodeDCFirst : decodeDCSuccessive;
    } else {
      decodeFn = successivePrev === 0 ? decodeACFirst : decodeACSuccessive;
    }
  } else {
    decodeFn = decodeBaseline;
  }

  function decodeMcu(component, mcu, row, col) {
    const mcuRow = (mcu / mcusPerLine) | 0;
    const mcuCol = mcu % mcusPerLine;
    decodeFn(
      component,
      blockOffsetFor(
        component,
        mcuRow * component.v + row,
        mcuCol * component.h + col
      )
    );
  }

  function decodeSingleBlock(component, mcu) {
    const row = (mcu / component.blocksPerLine) | 0;
    const col = mcu % component.blocksPerLine;
    decodeFn(component, blockOffsetFor(component, row, col));
  }

  const single = components.length === 1;
  const mcuExpected = single
    ? components[0].blocksPerLine * components[0].blocksPerColumn
    : mcusPerLine * frame.mcusPerColumn;
  const interval = resetInterval || mcuExpected;

  let mcu = 0;
  while (mcu < mcuExpected) {
    for (const component of components) component.pred = 0;
    eobrun = 0;
    successiveACState = 0;
    const stop = Math.min(mcuExpected, mcu + interval);
    try {
      if (single) {
        const component = components[0];
        for (; mcu < stop; mcu++) decodeSingleBlock(component, mcu);
      } else {
        for (; mcu < stop; mcu++) {
          for (const component of components) {
            for (let row = 0; row < component.v; row++) {
              for (let col = 0; col < component.h; col++) {
                decodeMcu(component, mcu, row, col);
              }
            }
          }
        }
      }
    } catch (error) {
      if (!(error instanceof UnsupportedImageError)) throw error;
      // A corrupt or unusual stretch of entropy data: keep whatever blocks
      // decoded and let the caller realign on the next marker.
      mcu = stop;
    }

    // Realign on the byte boundary and consume a restart marker if one is
    // there. Anything else ends the scan.
    bitsCount = 0;
    const marker = peekMarker(data, offset);
    if (marker.marker >= 0xffd0 && marker.marker <= 0xffd7) {
      offset = marker.offset + 2;
    } else {
      offset = marker.offset;
      break;
    }
  }

  return peekMarker(data, offset).offset;
}

function peekMarker(data, from) {
  let offset = from;
  while (offset < data.length - 1) {
    if (data[offset] === 0xff) {
      const next = data[offset + 1];
      if (next !== 0x00 && next !== 0xff) {
        return { marker: 0xff00 | next, offset };
      }
    }
    offset++;
  }
  return { marker: 0xffd9, offset: data.length };
}

function prepareComponents(frame) {
  const mcusPerLine = Math.ceil(frame.samplesPerLine / 8 / frame.maxH);
  const mcusPerColumn = Math.ceil(frame.scanLines / 8 / frame.maxV);
  for (const component of frame.components) {
    component.blocksPerLine = Math.ceil(
      (Math.ceil(frame.samplesPerLine / 8) * component.h) / frame.maxH
    );
    component.blocksPerColumn = Math.ceil(
      (Math.ceil(frame.scanLines / 8) * component.v) / frame.maxV
    );
    component.blocksPerLineForMcu = mcusPerLine * component.h;
    component.blocksPerColumnForMcu = mcusPerColumn * component.v;
    component.blockData = new Int16Array(
      64 * component.blocksPerColumnForMcu * component.blocksPerLineForMcu
    );
  }
  frame.mcusPerLine = mcusPerLine;
  frame.mcusPerColumn = mcusPerColumn;
}

function parseJpeg(data) {
  let offset = 0;
  const quantizationTables = [];
  const huffmanTablesDC = [];
  const huffmanTablesAC = [];
  let frame = null;
  let resetInterval = 0;
  let adobeTransform = null;

  function readUint16() {
    const value = (data[offset] << 8) | data[offset + 1];
    offset += 2;
    return value;
  }

  if (readUint16() !== 0xffd8) throw unsupported("Not a JPEG.");

  let marker = readUint16();
  while (marker !== 0xffd9 && offset < data.length) {
    switch (marker) {
      case 0xffe0:
      case 0xffe1:
      case 0xffe2:
      case 0xffe3:
      case 0xffe4:
      case 0xffe5:
      case 0xffe6:
      case 0xffe7:
      case 0xffe8:
      case 0xffe9:
      case 0xffea:
      case 0xffeb:
      case 0xffec:
      case 0xffed:
      case 0xffee:
      case 0xffef:
      case 0xfffe: {
        const length = readUint16();
        if (
          marker === 0xffee &&
          data.length >= offset + 5 &&
          String.fromCharCode(...data.subarray(offset, offset + 5)) === "Adobe"
        ) {
          adobeTransform = data[offset + length - 3];
        }
        offset += length - 2;
        break;
      }
      case 0xffdb: {
        const end = offset + readUint16() - 2;
        while (offset < end) {
          const spec = data[offset++];
          const table = new Uint16Array(64);
          if (spec >> 4 === 0) {
            for (let j = 0; j < 64; j++) table[ZIGZAG[j]] = data[offset++];
          } else {
            for (let j = 0; j < 64; j++) table[ZIGZAG[j]] = readUint16();
          }
          quantizationTables[spec & 15] = table;
        }
        break;
      }
      case 0xffc0:
      case 0xffc1:
      case 0xffc2: {
        if (frame) throw unsupported("Multi-frame JPEG.");
        readUint16();
        frame = { progressive: marker === 0xffc2, components: [] };
        const precision = data[offset++];
        if (precision !== 8) throw unsupported("Non 8-bit JPEG.");
        frame.scanLines = readUint16();
        frame.samplesPerLine = readUint16();
        const count = data[offset++];
        let maxH = 1;
        let maxV = 1;
        for (let i = 0; i < count; i++) {
          const id = data[offset];
          const h = data[offset + 1] >> 4 || 1;
          const v = (data[offset + 1] & 15) || 1;
          maxH = Math.max(maxH, h);
          maxV = Math.max(maxV, v);
          frame.components.push({
            id,
            h,
            v,
            quantizationId: data[offset + 2]
          });
          offset += 3;
        }
        frame.maxH = maxH;
        frame.maxV = maxV;
        if (!frame.scanLines || !frame.samplesPerLine) {
          throw unsupported("JPEG with no dimensions.");
        }
        prepareComponents(frame);
        break;
      }
      case 0xffc4: {
        const end = offset + readUint16() - 2;
        while (offset < end) {
          const spec = data[offset++];
          const codeLengths = new Uint8Array(16);
          let total = 0;
          for (let i = 0; i < 16; i++) {
            codeLengths[i] = data[offset + i];
            total += codeLengths[i];
          }
          offset += 16;
          const values = new Uint8Array(total);
          for (let i = 0; i < total; i++) values[i] = data[offset + i];
          offset += total;
          const table = buildHuffmanTable(codeLengths, values);
          if (spec >> 4 === 0) huffmanTablesDC[spec & 15] = table;
          else huffmanTablesAC[spec & 15] = table;
        }
        break;
      }
      case 0xffdd: {
        readUint16();
        resetInterval = readUint16();
        break;
      }
      case 0xffda: {
        if (!frame) throw unsupported("JPEG scan before its frame.");
        readUint16();
        const count = data[offset++];
        const components = [];
        for (let i = 0; i < count; i++) {
          const id = data[offset++];
          const tables = data[offset++];
          const component = frame.components.find((entry) => entry.id === id);
          if (!component) throw unsupported("JPEG scan names a missing component.");
          component.huffmanTableDC = huffmanTablesDC[tables >> 4];
          component.huffmanTableAC = huffmanTablesAC[tables & 15];
          components.push(component);
        }
        const spectralStart = data[offset++];
        const spectralEnd = data[offset++];
        const successive = data[offset++];
        offset = decodeScan(
          data,
          offset,
          frame,
          components,
          resetInterval,
          spectralStart,
          spectralEnd,
          successive >> 4,
          successive & 15
        );
        break;
      }
      case 0xffc8:
      case 0xffc3:
      case 0xffc5:
      case 0xffc6:
      case 0xffc7:
      case 0xffc9:
      case 0xffca:
      case 0xffcb:
      case 0xffcd:
      case 0xffce:
      case 0xffcf:
        throw unsupported("Lossless or arithmetic-coded JPEG.");
      default: {
        if (marker >= 0xffd0 && marker <= 0xffd7) break;
        if ((marker & 0xff00) !== 0xff00) {
          const next = peekMarker(data, offset);
          if (next.offset >= data.length) {
            offset = data.length;
            break;
          }
          offset = next.offset;
          break;
        }
        offset += readUint16() - 2;
        break;
      }
    }
    if (offset >= data.length - 1) break;
    const next = peekMarker(data, offset);
    if (next.offset >= data.length) break;
    offset = next.offset + 2;
    marker = next.marker;
  }

  if (!frame) throw unsupported("JPEG without a frame.");
  for (const component of frame.components) {
    component.quantizationTable = quantizationTables[component.quantizationId];
    if (!component.quantizationTable) {
      throw unsupported("JPEG component without a quantization table.");
    }
  }
  frame.adobeTransform = adobeTransform;
  return frame;
}

// out[i][u] for an N-point inverse DCT taken over the top-left NxN
// coefficients, scaled so the result keeps the amplitude of the full 8-point
// transform (the N-point basis is sqrt(8/N) larger, per axis).
const idctMatrixCache = new Map();
function idctMatrix(n) {
  const cached = idctMatrixCache.get(n);
  if (cached) return cached;
  const matrix = new Float64Array(n * n);
  const amplitude = Math.sqrt(n / 8);
  for (let i = 0; i < n; i++) {
    for (let u = 0; u < n; u++) {
      const alpha = u === 0 ? Math.sqrt(1 / n) : Math.sqrt(2 / n);
      matrix[i * n + u] =
        amplitude * alpha * Math.cos(((2 * i + 1) * u * Math.PI) / (2 * n));
    }
  }
  idctMatrixCache.set(n, matrix);
  return matrix;
}

// Inverse-transform one component's blocks straight to 1/8, 1/4, 1/2 or 1/1
// scale, returning a plane of blocksPerLine*n by blocksPerColumn*n samples.
function componentPlane(component, n) {
  const width = component.blocksPerLine * n;
  const height = component.blocksPerColumn * n;
  const plane = new Uint8ClampedArray(width * height);
  const matrix = idctMatrix(n);
  const quant = component.quantizationTable;
  const block = component.blockData;
  const coefficients = new Float64Array(64);
  const rows = new Float64Array(n * n);

  for (let blockRow = 0; blockRow < component.blocksPerColumn; blockRow++) {
    for (let blockCol = 0; blockCol < component.blocksPerLine; blockCol++) {
      const offset = blockOffsetFor(component, blockRow, blockCol);
      for (let i = 0; i < 64; i++) coefficients[i] = block[offset + i] * quant[i];
      for (let v = 0; v < n; v++) {
        for (let x = 0; x < n; x++) {
          let sum = 0;
          for (let u = 0; u < n; u++) {
            sum += matrix[x * n + u] * coefficients[v * 8 + u];
          }
          rows[v * n + x] = sum;
        }
      }
      for (let y = 0; y < n; y++) {
        const target = (blockRow * n + y) * width + blockCol * n;
        for (let x = 0; x < n; x++) {
          let sum = 0;
          for (let v = 0; v < n; v++) {
            sum += matrix[y * n + v] * rows[v * n + x];
          }
          plane[target + x] = sum + 128;
        }
      }
    }
  }
  return { data: plane, width, height };
}

function decodeJpeg(data, targetWidth, targetHeight) {
  const frame = parseJpeg(data);
  const { samplesPerLine: width, scanLines: height, components } = frame;

  if (components.length !== 1 && components.length !== 3) {
    throw unsupported(`JPEG with ${components.length} components.`);
  }

  // The smallest IDCT scale that still leaves at least as many pixels as the
  // thumbnail needs.
  let n = 8;
  for (const candidate of [1, 2, 4]) {
    if (
      Math.floor((width * candidate) / 8) >= targetWidth &&
      Math.floor((height * candidate) / 8) >= targetHeight
    ) {
      n = candidate;
      break;
    }
  }

  const planes = components.map((component) => componentPlane(component, n));
  const workWidth = Math.max(
    1,
    Math.min(Math.round((width * n) / 8), planes[0].width)
  );
  const workHeight = Math.max(
    1,
    Math.min(Math.round((height * n) / 8), planes[0].height)
  );
  const rgb = new Uint8Array(workWidth * workHeight * 3);

  // Adobe files with transform 0, and files whose components are literally
  // tagged R, G and B, are already RGB.
  const rgbDirect =
    components.length === 3 &&
    (frame.adobeTransform === 0 ||
      (components[0].id === 0x52 &&
        components[1].id === 0x47 &&
        components[2].id === 0x42));

  const sample = (plane, component, x, y) => {
    const sx = Math.min(
      plane.width - 1,
      Math.floor((x * component.h) / frame.maxH)
    );
    const sy = Math.min(
      plane.height - 1,
      Math.floor((y * component.v) / frame.maxV)
    );
    return plane.data[sy * plane.width + sx];
  };

  let target = 0;
  for (let y = 0; y < workHeight; y++) {
    for (let x = 0; x < workWidth; x++) {
      if (components.length === 1) {
        const value = sample(planes[0], components[0], x, y);
        rgb[target++] = value;
        rgb[target++] = value;
        rgb[target++] = value;
        continue;
      }
      const a = sample(planes[0], components[0], x, y);
      const b = sample(planes[1], components[1], x, y);
      const c = sample(planes[2], components[2], x, y);
      if (rgbDirect) {
        rgb[target++] = a;
        rgb[target++] = b;
        rgb[target++] = c;
        continue;
      }
      rgb[target++] = clampByte(a + 1.402 * (c - 128));
      rgb[target++] = clampByte(a - 0.344136 * (b - 128) - 0.714136 * (c - 128));
      rgb[target++] = clampByte(a + 1.772 * (b - 128));
    }
  }

  return { data: rgb, width: workWidth, height: workHeight };
}

function clampByte(value) {
  if (value < 0) return 0;
  if (value > 255) return 255;
  return value + 0.5;
}

// Walks the marker chain strictly by segment length. Scanning for the next
// 0xFF instead would wander into an EXIF segment's embedded thumbnail, which
// carries its own SOI/SOF/EOI markers.
function jpegSize(data) {
  let offset = 2;
  while (offset + 3 < data.length) {
    if (data[offset] !== 0xff) return null;
    const marker = 0xff00 | data[offset + 1];
    offset += 2;
    if (marker === 0xffd8 || marker === 0xffd9) continue;
    if (marker >= 0xffd0 && marker <= 0xffd7) continue;
    if (marker === 0xff01 || marker === 0xffff) continue;
    if (
      marker >= 0xffc0 &&
      marker <= 0xffcf &&
      marker !== 0xffc4 &&
      marker !== 0xffc8 &&
      marker !== 0xffcc
    ) {
      return {
        height: (data[offset + 3] << 8) | data[offset + 4],
        width: (data[offset + 5] << 8) | data[offset + 6]
      };
    }
    if (marker === 0xffda) return null;
    offset += (data[offset] << 8) | data[offset + 1];
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * PNG decoding
 * ------------------------------------------------------------------ */

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function decodePng(data) {
  if (!data.subarray(0, 8).equals(PNG_SIGNATURE)) throw unsupported("Not a PNG.");
  let offset = 8;
  let header = null;
  let palette = null;
  const idat = [];
  while (offset + 8 <= data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString("latin1", offset + 4, offset + 8);
    const start = offset + 8;
    if (type === "IHDR") {
      header = {
        width: data.readUInt32BE(start),
        height: data.readUInt32BE(start + 4),
        depth: data[start + 8],
        colorType: data[start + 9],
        interlace: data[start + 12]
      };
    } else if (type === "PLTE") {
      palette = data.subarray(start, start + length);
    } else if (type === "IDAT") {
      idat.push(data.subarray(start, start + length));
    } else if (type === "IEND") {
      break;
    }
    offset = start + length + 4;
  }
  if (!header) throw unsupported("PNG without a header.");
  if (header.interlace !== 0) throw unsupported("Interlaced PNG.");
  if (!header.width || !header.height) throw unsupported("Empty PNG.");
  if (idat.length === 0) throw unsupported("PNG without image data.");

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.colorType];
  if (!channels) throw unsupported(`PNG colour type ${header.colorType}.`);
  if (header.colorType === 3 && !palette) throw unsupported("PNG without a palette.");

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const { width, height, depth } = header;
  const bitsPerPixel = channels * depth;
  const bytesPerPixel = Math.max(1, bitsPerPixel >> 3);
  const bytesPerRow = Math.ceil((width * bitsPerPixel) / 8);
  if (raw.length < height * (bytesPerRow + 1)) throw unsupported("Truncated PNG.");

  const pixels = Buffer.alloc(height * bytesPerRow);
  let source = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[source++];
    const row = y * bytesPerRow;
    const previous = row - bytesPerRow;
    for (let x = 0; x < bytesPerRow; x++) {
      const value = raw[source++];
      const left = x >= bytesPerPixel ? pixels[row + x - bytesPerPixel] : 0;
      const up = y > 0 ? pixels[previous + x] : 0;
      const upLeft =
        y > 0 && x >= bytesPerPixel ? pixels[previous + x - bytesPerPixel] : 0;
      switch (filter) {
        case 0:
          pixels[row + x] = value;
          break;
        case 1:
          pixels[row + x] = value + left;
          break;
        case 2:
          pixels[row + x] = value + up;
          break;
        case 3:
          pixels[row + x] = value + ((left + up) >> 1);
          break;
        case 4:
          pixels[row + x] = value + paeth(left, up, upLeft);
          break;
        default:
          throw unsupported(`PNG row filter ${filter}.`);
      }
    }
  }

  const rgb = new Uint8Array(width * height * 3);
  const maxValue = (1 << depth) - 1;
  let target = 0;
  for (let y = 0; y < height; y++) {
    const row = y * bytesPerRow;
    for (let x = 0; x < width; x++) {
      let r;
      let g;
      let b;
      let alpha = 255;
      if (header.colorType === 3) {
        const index = readSample(pixels, row, x, 0, 1, depth);
        const at = index * 3;
        if (at + 2 >= palette.length) throw unsupported("PNG palette index out of range.");
        r = palette[at];
        g = palette[at + 1];
        b = palette[at + 2];
      } else {
        const scale = 255 / maxValue;
        const first = readSample(pixels, row, x, 0, channels, depth) * scale;
        if (header.colorType === 0 || header.colorType === 4) {
          r = first;
          g = first;
          b = first;
          if (header.colorType === 4) {
            alpha = readSample(pixels, row, x, 1, channels, depth) * scale;
          }
        } else {
          r = first;
          g = readSample(pixels, row, x, 1, channels, depth) * scale;
          b = readSample(pixels, row, x, 2, channels, depth) * scale;
          if (header.colorType === 6) {
            alpha = readSample(pixels, row, x, 3, channels, depth) * scale;
          }
        }
      }
      if (alpha < 255) {
        const mix = alpha / 255;
        r = r * mix + 255 * (1 - mix);
        g = g * mix + 255 * (1 - mix);
        b = b * mix + 255 * (1 - mix);
      }
      rgb[target++] = r + 0.5;
      rgb[target++] = g + 0.5;
      rgb[target++] = b + 0.5;
    }
  }
  return { data: rgb, width, height };
}

function readSample(pixels, row, x, channel, channels, depth) {
  if (depth === 8) return pixels[row + x * channels + channel];
  if (depth === 16) {
    return pixels[row + (x * channels + channel) * 2] * 256 +
      pixels[row + (x * channels + channel) * 2 + 1];
  }
  const index = x * channels + channel;
  const bit = index * depth;
  const byte = pixels[row + (bit >> 3)];
  const shift = 8 - depth - (bit & 7);
  return (byte >> shift) & ((1 << depth) - 1);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function pngSize(data) {
  if (data.length < 24 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

/* ------------------------------------------------------------------ *
 * Resampling
 * ------------------------------------------------------------------ */

// Area average. Every source pixel under the target pixel's footprint
// contributes in proportion to how much of it the footprint covers, so a
// non-integer ratio does not favour one edge of the box. Comic pages are line
// art and lettering; a nearest-neighbour drop would alias them badly.
function resizeSpans(sourceLength, targetLength) {
  const ratio = sourceLength / targetLength;
  const spans = [];
  for (let i = 0; i < targetLength; i++) {
    const start = i * ratio;
    const end = Math.min(sourceLength, (i + 1) * ratio);
    const first = Math.floor(start);
    const last = Math.max(first + 1, Math.ceil(end));
    const weights = new Float64Array(last - first);
    let total = 0;
    for (let s = first; s < last; s++) {
      const weight = Math.max(0, Math.min(s + 1, end) - Math.max(s, start));
      weights[s - first] = weight;
      total += weight;
    }
    if (total === 0) {
      weights[0] = 1;
      total = 1;
    }
    for (let s = 0; s < weights.length; s++) weights[s] /= total;
    spans.push({ first, weights });
  }
  return spans;
}

function resizeRgb(image, width, height) {
  if (image.width === width && image.height === height) return image;
  const columns = resizeSpans(image.width, width);
  const rows = resizeSpans(image.height, height);
  const output = new Uint8Array(width * height * 3);

  // Horizontal pass first, into a float buffer the vertical pass reads.
  const horizontal = new Float64Array(width * image.height * 3);
  for (let y = 0; y < image.height; y++) {
    const sourceRow = y * image.width * 3;
    const targetRow = y * width * 3;
    for (let x = 0; x < width; x++) {
      const span = columns[x];
      let r = 0;
      let g = 0;
      let b = 0;
      for (let i = 0; i < span.weights.length; i++) {
        const weight = span.weights[i];
        const source = sourceRow + (span.first + i) * 3;
        r += image.data[source] * weight;
        g += image.data[source + 1] * weight;
        b += image.data[source + 2] * weight;
      }
      const target = targetRow + x * 3;
      horizontal[target] = r;
      horizontal[target + 1] = g;
      horizontal[target + 2] = b;
    }
  }

  for (let y = 0; y < height; y++) {
    const span = rows[y];
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let i = 0; i < span.weights.length; i++) {
        const weight = span.weights[i];
        const source = ((span.first + i) * width + x) * 3;
        r += horizontal[source] * weight;
        g += horizontal[source + 1] * weight;
        b += horizontal[source + 2] * weight;
      }
      const target = (y * width + x) * 3;
      output[target] = r + 0.5;
      output[target + 1] = g + 0.5;
      output[target + 2] = b + 0.5;
    }
  }
  return { data: output, width, height };
}

/* ------------------------------------------------------------------ *
 * JPEG encoding
 * ------------------------------------------------------------------ */

const STD_LUMA_QUANT = [
  16, 11, 10, 16, 24, 40, 51, 61,
  12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77,
  24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99
];

const STD_CHROMA_QUANT = [
  17, 18, 24, 47, 99, 99, 99, 99,
  18, 21, 26, 66, 99, 99, 99, 99,
  24, 26, 56, 99, 99, 99, 99, 99,
  47, 66, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99
];

// The example Huffman tables from ITU T.81 Annex K, the ones essentially every
// encoder ships with.
const DC_LUMA_BITS = [0, 0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_LUMA_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const DC_CHROMA_BITS = [0, 0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const DC_CHROMA_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

const AC_LUMA_BITS = [
  0, 0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d
];
const AC_LUMA_VALUES = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12,
  0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
  0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
  0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
  0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16,
  0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39,
  0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
  0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79,
  0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98,
  0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
  0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
  0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
  0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4,
  0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea,
  0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa
];

const AC_CHROMA_BITS = [
  0, 0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77
];
const AC_CHROMA_VALUES = [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21,
  0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
  0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91,
  0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
  0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34,
  0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
  0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38,
  0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
  0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58,
  0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
  0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78,
  0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
  0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96,
  0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
  0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4,
  0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
  0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2,
  0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
  0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9,
  0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa
];

function buildEncodeTable(bits, values) {
  const table = [];
  let code = 0;
  let k = 0;
  for (let length = 1; length <= 16; length++) {
    for (let i = 0; i < bits[length]; i++) {
      table[values[k++]] = { code, length };
      code++;
    }
    code <<= 1;
  }
  return table;
}

function scaleQuantTable(base, quality) {
  const clamped = Math.min(100, Math.max(1, quality));
  const scale = clamped < 50 ? 5000 / clamped : 200 - clamped * 2;
  const table = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    table[i] = Math.min(255, Math.max(1, Math.floor((base[i] * scale + 50) / 100)));
  }
  return table;
}

const FDCT_MATRIX = (() => {
  const matrix = new Float64Array(64);
  for (let u = 0; u < 8; u++) {
    const alpha = u === 0 ? Math.sqrt(1 / 8) : 0.5;
    for (let x = 0; x < 8; x++) {
      matrix[u * 8 + x] = alpha * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
    }
  }
  return matrix;
})();

class BitWriter {
  constructor() {
    this.bytes = [];
    this.buffer = 0;
    this.count = 0;
  }

  write(code, length) {
    for (let i = length - 1; i >= 0; i--) {
      this.buffer = (this.buffer << 1) | ((code >> i) & 1);
      this.count++;
      if (this.count === 8) {
        const byte = this.buffer & 0xff;
        this.bytes.push(byte);
        // A 0xFF in the entropy stream has to be stuffed so it is not read as
        // a marker.
        if (byte === 0xff) this.bytes.push(0x00);
        this.buffer = 0;
        this.count = 0;
      }
    }
  }

  flush() {
    while (this.count !== 0) this.write(1, 1);
  }
}

function magnitudeCategory(value) {
  let magnitude = Math.abs(value);
  let bits = 0;
  while (magnitude) {
    bits++;
    magnitude >>= 1;
  }
  return bits;
}

function encodeJpeg(image, quality) {
  const { width, height } = image;
  const lumaQuant = scaleQuantTable(STD_LUMA_QUANT, quality);
  const chromaQuant = scaleQuantTable(STD_CHROMA_QUANT, quality);
  const dcLuma = buildEncodeTable(DC_LUMA_BITS, DC_LUMA_VALUES);
  const acLuma = buildEncodeTable(AC_LUMA_BITS, AC_LUMA_VALUES);
  const dcChroma = buildEncodeTable(DC_CHROMA_BITS, DC_CHROMA_VALUES);
  const acChroma = buildEncodeTable(AC_CHROMA_BITS, AC_CHROMA_VALUES);

  const header = [];
  const push16 = (value) => header.push((value >> 8) & 0xff, value & 0xff);
  header.push(0xff, 0xd8);
  header.push(0xff, 0xe0);
  push16(16);
  header.push(0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0);
  for (const [id, table] of [[0, lumaQuant], [1, chromaQuant]]) {
    header.push(0xff, 0xdb);
    push16(67);
    header.push(id);
    for (let i = 0; i < 64; i++) header.push(table[ZIGZAG[i]]);
  }
  header.push(0xff, 0xc0);
  push16(17);
  header.push(8);
  push16(height);
  push16(width);
  header.push(3);
  // 4:2:0 — luma at full resolution, both chroma planes at half. The eye is
  // far less sensitive to chroma detail, and at 480px it takes roughly a third
  // off the file for no visible loss.
  header.push(1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1);
  for (const [id, bits, values] of [
    [0x00, DC_LUMA_BITS, DC_LUMA_VALUES],
    [0x10, AC_LUMA_BITS, AC_LUMA_VALUES],
    [0x01, DC_CHROMA_BITS, DC_CHROMA_VALUES],
    [0x11, AC_CHROMA_BITS, AC_CHROMA_VALUES]
  ]) {
    header.push(0xff, 0xc4);
    push16(19 + values.length);
    header.push(id);
    for (let i = 1; i <= 16; i++) header.push(bits[i]);
    for (const value of values) header.push(value);
  }
  header.push(0xff, 0xda);
  push16(12);
  header.push(3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0);

  const writer = new BitWriter();
  const luma = new Float64Array(64);
  const blue = new Float64Array(64);
  const red = new Float64Array(64);
  const quantized = new Int32Array(64);
  const rows = new Float64Array(64);
  let predLuma = 0;
  let predBlue = 0;
  let predRed = 0;

  const forwardDct = (samples) => {
    for (let v = 0; v < 8; v++) {
      for (let x = 0; x < 8; x++) {
        let sum = 0;
        for (let y = 0; y < 8; y++) sum += FDCT_MATRIX[v * 8 + y] * samples[y * 8 + x];
        rows[v * 8 + x] = sum;
      }
    }
    for (let v = 0; v < 8; v++) {
      for (let u = 0; u < 8; u++) {
        let sum = 0;
        for (let x = 0; x < 8; x++) sum += FDCT_MATRIX[u * 8 + x] * rows[v * 8 + x];
        samples[v * 8 + u] = sum;
      }
    }
  };

  const writeBlock = (samples, quant, pred, dcTable, acTable) => {
    forwardDct(samples);
    for (let i = 0; i < 64; i++) {
      quantized[i] = Math.round(samples[i] / quant[i]);
    }
    const diff = quantized[0] - pred;
    if (diff === 0) {
      writer.write(dcTable[0].code, dcTable[0].length);
    } else {
      const bits = magnitudeCategory(diff);
      const symbol = dcTable[bits];
      writer.write(symbol.code, symbol.length);
      writer.write((diff < 0 ? diff - 1 : diff) & ((1 << bits) - 1), bits);
    }
    let run = 0;
    for (let k = 1; k < 64; k++) {
      const value = quantized[ZIGZAG[k]];
      if (value === 0) {
        run++;
        continue;
      }
      while (run > 15) {
        writer.write(acTable[0xf0].code, acTable[0xf0].length);
        run -= 16;
      }
      const bits = magnitudeCategory(value);
      const symbol = acTable[(run << 4) | bits];
      writer.write(symbol.code, symbol.length);
      writer.write((value < 0 ? value - 1 : value) & ((1 << bits) - 1), bits);
      run = 0;
    }
    if (run > 0) writer.write(acTable[0x00].code, acTable[0x00].length);
    return quantized[0];
  };

  // Separate the planes once, averaging chroma down 2x1 in each direction.
  const yPlane = new Float32Array(width * height);
  const chromaWidth = Math.ceil(width / 2);
  const chromaHeight = Math.ceil(height / 2);
  const bPlane = new Float32Array(chromaWidth * chromaHeight);
  const rPlane = new Float32Array(chromaWidth * chromaHeight);
  const counts = new Uint8Array(chromaWidth * chromaHeight);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 3;
      const r = image.data[source];
      const g = image.data[source + 1];
      const b = image.data[source + 2];
      yPlane[y * width + x] = 0.299 * r + 0.587 * g + 0.114 * b;
      const chroma = (y >> 1) * chromaWidth + (x >> 1);
      bPlane[chroma] += -0.168736 * r - 0.331264 * g + 0.5 * b;
      rPlane[chroma] += 0.5 * r - 0.418688 * g - 0.081312 * b;
      counts[chroma]++;
    }
  }
  for (let i = 0; i < counts.length; i++) {
    bPlane[i] /= counts[i];
    rPlane[i] /= counts[i];
  }

  const fillBlock = (target, plane, planeWidth, planeHeight, originX, originY, shift) => {
    for (let y = 0; y < 8; y++) {
      const sy = Math.min(planeHeight - 1, originY + y);
      for (let x = 0; x < 8; x++) {
        const sx = Math.min(planeWidth - 1, originX + x);
        target[y * 8 + x] = plane[sy * planeWidth + sx] - shift;
      }
    }
  };

  const mcusPerLine = Math.ceil(width / 16);
  const mcusPerColumn = Math.ceil(height / 16);
  for (let mcuY = 0; mcuY < mcusPerColumn; mcuY++) {
    for (let mcuX = 0; mcuX < mcusPerLine; mcuX++) {
      for (let block = 0; block < 4; block++) {
        fillBlock(
          luma,
          yPlane,
          width,
          height,
          mcuX * 16 + (block & 1) * 8,
          mcuY * 16 + (block >> 1) * 8,
          128
        );
        predLuma = writeBlock(luma, lumaQuant, predLuma, dcLuma, acLuma);
      }
      fillBlock(blue, bPlane, chromaWidth, chromaHeight, mcuX * 8, mcuY * 8, 0);
      predBlue = writeBlock(blue, chromaQuant, predBlue, dcChroma, acChroma);
      fillBlock(red, rPlane, chromaWidth, chromaHeight, mcuX * 8, mcuY * 8, 0);
      predRed = writeBlock(red, chromaQuant, predRed, dcChroma, acChroma);
    }
  }
  writer.flush();

  return Buffer.concat([
    Buffer.from(header),
    Buffer.from(writer.bytes),
    Buffer.from([0xff, 0xd9])
  ]);
}

/* ------------------------------------------------------------------ *
 * Public surface
 * ------------------------------------------------------------------ */

function imageSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return jpegSize(buffer);
  return pngSize(buffer);
}

function targetSize(width, height, maxEdge) {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return null;
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

/**
 * Shrink a cover to grid size. Returns null when the source is already small
 * enough to send as it is, and throws UnsupportedImageError when the format is
 * one this pure-JavaScript path cannot read — in both cases the caller serves
 * the original bytes.
 */
function createThumbnail(buffer, options = {}) {
  const maxEdge = options.maxEdge || THUMBNAIL_MAX_EDGE;
  const quality = options.quality || THUMBNAIL_QUALITY;
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) {
    throw unsupported("Not an image.");
  }

  const size = imageSize(buffer);
  if (size && !targetSize(size.width, size.height, maxEdge)) return null;

  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
  const isPng = buffer.subarray(0, 8).equals(PNG_SIGNATURE);
  if (!isJpeg && !isPng) throw unsupported("Unsupported image format.");

  const target = size ? targetSize(size.width, size.height, maxEdge) : null;
  const decoded = isJpeg
    ? decodeJpeg(buffer, target ? target.width : maxEdge, target ? target.height : maxEdge)
    : decodePng(buffer);

  const wanted =
    targetSize(
      size ? size.width : decoded.width,
      size ? size.height : decoded.height,
      maxEdge
    ) || { width: decoded.width, height: decoded.height };
  const scaled = resizeRgb(
    decoded,
    Math.min(wanted.width, decoded.width),
    Math.min(wanted.height, decoded.height)
  );

  return {
    buffer: encodeJpeg(scaled, quality),
    mime: THUMBNAIL_MIME,
    width: scaled.width,
    height: scaled.height
  };
}

module.exports = {
  THUMBNAIL_EXTENSION,
  THUMBNAIL_MAX_EDGE,
  THUMBNAIL_MIME,
  THUMBNAIL_QUALITY,
  UnsupportedImageError,
  createThumbnail,
  decodeJpeg,
  decodePng,
  encodeJpeg,
  imageSize,
  resizeRgb
};
