/* =========================================================================
   make-og.mjs — the link-preview card, drawn from scratch
   -------------------------------------------------------------------------
   This game travels by shared link: an invite in a chat, a post on a forum,
   a portal listing.  Every one of those renders og:image, and without one the
   preview is a grey box that looks broken.

   A PNG is only a zlib stream of filtered scanlines wrapped in CRC'd chunks,
   so it is written here by hand rather than pulling in an image library for
   one 1200x630 file.  No dependencies, deterministic, runs at build time.

       node scripts/make-og.mjs

   The wordmark is not drawn — Open Graph renders og:title as real text over
   the card, so painting it here would only duplicate it at a worse quality.
   ========================================================================= */

import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const W = 1200, H = 630;
const px = new Uint8Array(W * H * 3);

const set = (x, y, r, g, b) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = r; px[i + 1] = g; px[i + 2] = b;
};
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];

/* --- sky: the same dusk the parkland course uses ---------------------- */
const SKY_TOP = [26, 54, 84], SKY_LOW = [126, 176, 198], SUN = [255, 214, 150];
for (let y = 0; y < H; y++) {
  const t = y / H;
  let c = mix(SKY_TOP, SKY_LOW, Math.pow(t, 0.75));
  // a low sun glow behind where the hills will crest
  const gx = W * 0.72, gy = H * 0.60;
  for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - gx, (y - gy) * 1.9) / (W * 0.55);
    const g = Math.max(0, 1 - d);
    const cc = mix(c, SUN, Math.pow(g, 2.2) * 0.55);
    set(x, y, cc[0], cc[1], cc[2]);
  }
}

/* --- three ridges of hills, back to front ----------------------------- */
const ridge = (baseY, amp, freq, phase, col) => {
  for (let x = 0; x < W; x++) {
    const n = Math.sin(x * freq + phase) * 0.6 + Math.sin(x * freq * 2.3 + phase * 1.7) * 0.4;
    const top = Math.round(baseY + n * amp);
    for (let y = top; y < H; y++) {
      // a touch of depth: each ridge darkens slightly toward its own base
      const k = Math.min(1, (y - top) / 260);
      const c = mix(col, [col[0] * 0.72, col[1] * 0.72, col[2] * 0.72], k);
      set(x, y, c[0], c[1], c[2]);
    }
  }
};
ridge(H * 0.60, 26, 0.0042, 0.4, [46, 84, 62]);
ridge(H * 0.70, 34, 0.0031, 2.1, [38, 96, 58]);
ridge(H * 0.82, 22, 0.0052, 4.2, [46, 122, 62]);

/* --- the flag: the one piece of iconography that says golf ------------ */
const FX = Math.round(W * 0.80), FY = Math.round(H * 0.66);
for (let y = FY - 150; y < FY; y++) for (let d = 0; d < 4; d++) set(FX + d, y, 238, 244, 236);
for (let i = 0; i < 54; i++) {                       // pennant
  const y = FY - 150 + i;
  const w = Math.round(52 * (1 - i / 54));
  for (let x = FX + 4; x < FX + 4 + w; x++) set(x, y, 226, 66, 54);
}
for (let a = 0; a < 360; a += 2) {                   // the cup, in shadow
  for (let r = 0; r < 15; r++) {
    const x = FX + 2 + Math.cos(a * Math.PI / 180) * r * 1.9;
    const y = FY + Math.sin(a * Math.PI / 180) * r * 0.55;
    set(Math.round(x), Math.round(y), 24, 52, 32);
  }
}

/* --- a vignette, so overlaid title text always has contrast ----------- */
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 3;
  // darken hard on the left third, where preview cards put their text
  const shade = Math.max(0, 1 - x / (W * 0.62)) * 0.62
              + Math.pow(Math.max(0, (y - H * 0.72) / (H * 0.28)), 2) * 0.35;
  px[i] *= (1 - shade); px[i + 1] *= (1 - shade); px[i + 2] *= (1 - shade);
}

/* ------------------------------------------------------- PNG encoding --- */
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return buf => {
    let c = -1;
    for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;        // bit depth
ihdr[9] = 2;        // colour type 2 = truecolour RGB
// 10,11,12 = deflate, adaptive filtering, no interlace — all zero already

// each scanline carries a leading filter byte; 0 means "none"
const raw = Buffer.alloc(H * (W * 3 + 1));
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  Buffer.from(px.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'og.png');
fs.writeFileSync(out, png);
console.log(`og.png  ${W}x${H}  ${(png.length / 1024).toFixed(0)} KB  ->  ${out}`);
