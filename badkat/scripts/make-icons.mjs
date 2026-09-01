/* Draws the BadKat app icon as a single 1024px source PNG.
 *
 * `tauri icon` (run right after this by the `icons` npm script) takes
 * this file and generates the full platform set — including a Windows
 * .ico with the classic DIB small sizes that Explorer needs. The old
 * version of this script hand-rolled the .ico with PNG-compressed 32px
 * entries, which Windows shows as the generic blank icon.
 *
 * The repo ships no binary assets, so the face is rasterised here and
 * PNG-encoded by hand. Everything is drawn at 4x and box-downsampled so
 * the edges are smooth at every size Tauri slices out of it. */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons");
const SIZE = 1024;
const SS = 4;                       // supersample factor
const W = SIZE * SS;

/* ---------------- PNG encoder ---------------- */
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

/* ---------------- palette (straight from the app) ---------------- */
const BG    = [17, 21, 30];         // #11151e — near-black rounded square
const FUR   = [236, 231, 218];      // #ece7da
const INK   = [23, 27, 34];         // #171b22 — eyes
const EAR   = [194, 144, 127];      // #c2907f — inner ear
const NOSE  = [224, 122, 140];      // #e07a8c

/* ---------------- geometry helpers ---------------- */
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}
function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}
// signed distance to a triangle (negative inside)
function sdTriangle(p, a, b, c) {
  const sub = (u, v) => [u[0] - v[0], u[1] - v[1]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1];
  const e0 = sub(b, a), e1 = sub(c, b), e2 = sub(a, c);
  const v0 = sub(p, a), v1 = sub(p, b), v2 = sub(p, c);
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const pq0 = sub(v0, e0.map((k) => k * clamp01(dot(v0, e0) / dot(e0, e0))));
  const pq1 = sub(v1, e1.map((k) => k * clamp01(dot(v1, e1) / dot(e1, e1))));
  const pq2 = sub(v2, e2.map((k) => k * clamp01(dot(v2, e2) / dot(e2, e2))));
  const s = Math.sign(e0[0] * e2[1] - e0[1] * e2[0]);
  const d0 = Math.min(dot(pq0, pq0), dot(pq1, pq1), dot(pq2, pq2));
  const d1 = Math.min(
    s * (v0[0] * e0[1] - v0[1] * e0[0]),
    s * (v1[0] * e1[1] - v1[1] * e1[0]),
    s * (v2[0] * e2[1] - v2[1] * e2[0])
  );
  return -Math.sqrt(d0) * Math.sign(d1);
}

/* one over-sampled pixel, unit space 0..1 */
function shade(u, v) {
  const S = W;
  // start with the backdrop
  const bgAA = -sdRoundRect(u, v, 0.5, 0.5, 0.5, 0.5, 0.225);
  if (bgAA <= 0) return [0, 0, 0, 0];
  let col = BG.slice();
  let a = Math.min(1, bgAA * S);

  // ---- ears (behind the head) ----
  const earL = [[0.215, 0.415], [0.305, 0.075], [0.520, 0.360]];
  const earR = [[0.480, 0.360], [0.695, 0.075], [0.785, 0.415]];
  const earLd = sdTriangle([u, v], ...earL);
  const earRd = sdTriangle([u, v], ...earR);
  const earD = Math.min(earLd, earRd);
  if (earD < 0) {
    const cov = Math.min(1, -earD * S);
    col = mix(col, FUR, cov);
    // inner ear: same triangle inset toward its centroid
    const inset = (tri) => {
      const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
      const cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
      return tri.map(([x, y]) => [lerp(x, cx, 0.42), lerp(y, cy, 0.42)]);
    };
    const inD = Math.min(sdTriangle([u, v], ...inset(earL)), sdTriangle([u, v], ...inset(earR)));
    if (inD < 0) col = mix(col, EAR, Math.min(1, -inD * S));
  }

  // ---- head ----
  const headD = sdCircle(u, v, 0.5, 0.545, 0.335);
  if (headD < 0) {
    col = mix(col, FUR, Math.min(1, -headD * S));

    // eyes — rounded almonds
    for (const ex of [0.375, 0.625]) {
      const ey = 0.515;
      const d = sdRoundRect(u, v, ex, ey, 0.052, 0.072, 0.05);
      if (d < 0) col = mix(col, INK, Math.min(1, -d * S));
    }
    // nose — small downward triangle
    const noseD = sdTriangle([u, v], [0.470, 0.630], [0.530, 0.630], [0.500, 0.675]);
    if (noseD < 0) col = mix(col, NOSE, Math.min(1, -noseD * S));
  }

  return [col[0], col[1], col[2], Math.round(a * 255)];
}

/* ---------------- render + box downsample ---------------- */
const hi = Buffer.alloc(W * W * 4);
for (let y = 0; y < W; y++) {
  for (let x = 0; x < W; x++) {
    const [r, g, b, al] = shade((x + 0.5) / W, (y + 0.5) / W);
    const i = (y * W + x) * 4;
    hi[i] = r; hi[i + 1] = g; hi[i + 2] = b; hi[i + 3] = al;
  }
}
const out = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let dy = 0; dy < SS; dy++) {
      for (let dx = 0; dx < SS; dx++) {
        const j = ((y * SS + dy) * W + (x * SS + dx)) * 4;
        const pa = hi[j + 3] / 255;
        r += hi[j] * pa; g += hi[j + 1] * pa; b += hi[j + 2] * pa; a += pa;
      }
    }
    const n = SS * SS;
    const i = (y * SIZE + x) * 4;
    if (a > 0) {
      out[i] = Math.round(r / a);
      out[i + 1] = Math.round(g / a);
      out[i + 2] = Math.round(b / a);
    }
    out[i + 3] = Math.round((a / n) * 255);
  }
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "app-icon.png"), encodePng(SIZE, out));
console.log("source icon written to " + join(OUT, "app-icon.png"));
