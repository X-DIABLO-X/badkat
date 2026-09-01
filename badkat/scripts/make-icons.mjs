/* Draws the BadKat app icon and writes the PNG/ICO set Tauri bundles.
 *
 * The repo ships no binary assets, so the cat head is rasterised here
 * and PNG-encoded by hand. ICO simply wraps a PNG, which every Windows
 * version since Vista accepts. */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons");

/* ---- PNG ---- */
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
};

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/* ---- the glyph: cream cat head, dot eyes, on a dark rounded square ---- */
const inTri = (px, py, a, b, c) => {
  const s = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  const d1 = s([px, py], a, b), d2 = s([px, py], b, c), d3 = s([px, py], c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};

function draw(size) {
  const rgba = Buffer.alloc(size * size * 4, 0);
  const k = size / 32;
  const head = { x: 16 * k, y: 20 * k, r: 10.5 * k };
  // outer ear bases sit inside the head circle, or the join leaves a notch
  const earL = [[7.2 * k, 16.5 * k], [10 * k, 4 * k], [17 * k, 14 * k]];
  const earR = [[15 * k, 14 * k], [22 * k, 4 * k], [24.8 * k, 16.5 * k]];
  const eyes = [[12.2 * k, 19 * k], [19.8 * k, 19 * k]];
  const radius = 6 * k;

  const put = (x, y, r, g, b, a) => {
    const i = (y * size + x) * 4;
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = x + 0.5, cy = y + 0.5;

      // rounded-square backdrop
      const qx = Math.max(radius - cx, 0, cx - (size - radius));
      const qy = Math.max(radius - cy, 0, cy - (size - radius));
      if (Math.hypot(qx, qy) > radius) continue;
      put(x, y, 17, 21, 30, 255);

      const dx = cx - head.x, dy = cy - head.y;
      const onHead = dx * dx + dy * dy <= head.r * head.r ||
        inTri(cx, cy, ...earL) || inTri(cx, cy, ...earR);
      if (!onHead) continue;

      const isEye = eyes.some(([ex, ey]) => Math.hypot(cx - ex, cy - ey) <= 1.8 * k);
      if (isEye) put(x, y, 23, 27, 34, 255);
      else put(x, y, 236, 231, 218, 255);
    }
  }
  return encodePng(size, rgba);
}

function ico(pngs) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);            // type: icon
  head.writeUInt16LE(pngs.length, 4);
  let offset = 6 + pngs.length * 16;
  const entries = [], bodies = [];
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);             // colour planes
    e.writeUInt16LE(32, 6);            // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
    bodies.push(data);
  }
  return Buffer.concat([head, ...entries, ...bodies]);
}

mkdirSync(OUT, { recursive: true });

const sizes = [32, 128, 256, 512];
const made = {};
for (const s of sizes) made[s] = draw(s);

writeFileSync(join(OUT, "32x32.png"), made[32]);
writeFileSync(join(OUT, "128x128.png"), made[128]);
writeFileSync(join(OUT, "128x128@2x.png"), made[256]);
writeFileSync(join(OUT, "icon.png"), made[512]);
writeFileSync(join(OUT, "icon.ico"), ico([
  { size: 32, data: made[32] },
  { size: 128, data: made[128] },
  { size: 256, data: made[256] }
]));

console.log("icons written to " + OUT);
