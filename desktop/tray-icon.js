"use strict";

/* ------------------------------------------------------------------
   tray-icon.js — draws the tray glyph at runtime
   ------------------------------------------------------------------
   The app ships no binary assets, so the 32x32 cat head is rasterised
   here and encoded as a PNG by hand. It is a small amount of code in
   exchange for the repo staying pure text.
------------------------------------------------------------------ */

const zlib = require("zlib");
const { nativeImage } = require("electron");

/* ---- minimal PNG writer (RGBA, no interlace, filter 0) ---------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) { c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) { c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); }
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;        // bit depth
  ihdr[9] = 6;        // colour type: RGBA
  ihdr[10] = 0;       // deflate
  ihdr[11] = 0;       // adaptive filtering
  ihdr[12] = 0;       // no interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;                       // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/* ---- the glyph -------------------------------------------------- */

function inTriangle(px, py, a, b, c) {
  const sign = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  const d1 = sign([px, py], a, b);
  const d2 = sign([px, py], b, c);
  const d3 = sign([px, py], c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function build(size, dim) {
  const rgba = Buffer.alloc(size * size * 4, 0);
  const k = size / 32;
  const head = { x: 16 * k, y: 19.5 * k, r: 11 * k };
  const earL = [[5 * k, 15 * k], [10 * k, 3 * k], [16 * k, 14 * k]];
  const earR = [[16 * k, 14 * k], [22 * k, 3 * k], [27 * k, 15 * k]];
  const eyes = [[12 * k, 18 * k], [20 * k, 18 * k]];

  const fur = dim ? [140, 136, 126] : [236, 231, 218];
  const ink = dim ? [40, 42, 48] : [23, 27, 34];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = x + 0.5, cy = y + 0.5;
      const dx = cx - head.x, dy = cy - head.y;
      const inHead = dx * dx + dy * dy <= head.r * head.r;
      const on = inHead || inTriangle(cx, cy, ...earL) || inTriangle(cx, cy, ...earR);
      if (!on) { continue; }

      const isEye = eyes.some(([ex, ey]) => {
        const ddx = cx - ex, ddy = cy - ey;
        return ddx * ddx + ddy * ddy <= (1.9 * k) * (1.9 * k);
      });

      const [r, g, b] = isEye ? ink : fur;
      const i = (y * size + x) * 4;
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
    }
  }
  return encodePng(size, size, rgba);
}

function trayIcon(dim) {
  const img = nativeImage.createFromBuffer(build(32, dim));
  img.setTemplateImage(false);
  return img;
}

module.exports = { trayIcon, encodePng };
