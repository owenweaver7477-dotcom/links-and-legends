/* =========================================================================
   shaftdecals.js — the club-shaft decal band, drawn rather than tinted
   -------------------------------------------------------------------------
   The shaft band (avatar.js's clubDecal) is a real object with eight named
   designs (unlocks.js, kind:'decal': stripe/chevron/houndstooth/carbonweave/
   lightning/tartan/goldleaf/signature) — but until now every one of them
   rendered as the exact same flat rectangle, tinted to the unlock's own
   `color` field and nothing else. A "Houndstooth" band and a "Racing
   stripe" band were visually identical.

   Same approach as decals.js: draw each pattern once onto a small canvas,
   cache it by id+colour, hand out a THREE.CanvasTexture. Small (48px) and
   two-tone — a shaft band occupies a few pixels on screen even up close, so
   there is nothing to gain from a bigger canvas, only VRAM to spend on it.
   ========================================================================= */

import * as THREE from '../../vendor/three.module.js';

const PX = 48;
const cache = new Map();

const shade = (hex, amt) => {
  const c = new THREE.Color(hex);
  if (amt < 0) c.multiplyScalar(1 + amt); else c.lerp(new THREE.Color(0xffffff), amt);
  return '#' + c.getHexString();
};

const DRAW = {
  stripe(g, a, b) {
    g.fillStyle = a; g.fillRect(0, 0, PX, PX);
    g.strokeStyle = b; g.lineWidth = PX * 0.22;
    for (let x = -PX; x < PX * 2; x += PX * 0.5) {
      g.beginPath(); g.moveTo(x, PX); g.lineTo(x + PX, 0); g.stroke();
    }
  },
  chevron(g, a, b) {
    g.fillStyle = a; g.fillRect(0, 0, PX, PX);
    g.strokeStyle = b; g.lineWidth = PX * 0.16;
    for (let y = -PX * 0.5; y < PX * 1.5; y += PX * 0.34) {
      g.beginPath();
      g.moveTo(0, y); g.lineTo(PX * 0.5, y + PX * 0.34); g.lineTo(PX, y);
      g.stroke();
    }
  },
  houndstooth(g, a, b) {
    g.fillStyle = a; g.fillRect(0, 0, PX, PX);
    g.fillStyle = b;
    const s = PX / 4;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      if ((x + y) % 2 === 0) continue;
      g.save();
      g.translate(x * s + s / 2, y * s + s / 2);
      g.rotate(Math.PI / 4);
      g.fillRect(-s * 0.42, -s * 0.42, s * 0.84, s * 0.84);
      g.restore();
    }
  },
  carbonweave(g, a, b) {
    g.fillStyle = a; g.fillRect(0, 0, PX, PX);
    g.strokeStyle = b; g.lineWidth = 1; g.globalAlpha = 0.55;
    const s = PX / 8;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      if ((x + y) % 2) continue;
      g.strokeRect(x * s + 0.5, y * s + 0.5, s - 1, s - 1);
    }
    g.globalAlpha = 1;
  },
  lightning(g, a, b) {
    g.fillStyle = a; g.fillRect(0, 0, PX, PX);
    g.strokeStyle = b; g.lineWidth = PX * 0.14; g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(PX * 0.62, 0); g.lineTo(PX * 0.30, PX * 0.46); g.lineTo(PX * 0.55, PX * 0.46);
    g.lineTo(PX * 0.30, PX);
    g.stroke();
  },
  tartan(g, a, b) {
    g.fillStyle = a; g.fillRect(0, 0, PX, PX);
    g.strokeStyle = b; g.globalAlpha = 0.75;
    g.lineWidth = PX * 0.10;
    for (let p = PX * 0.16; p < PX; p += PX * 0.34) {
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, PX); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(PX, p); g.stroke();
    }
    g.globalAlpha = 1;
  },
  goldleaf(g, a, b) {
    const grad = g.createLinearGradient(0, 0, PX, PX);
    grad.addColorStop(0, a); grad.addColorStop(0.5, b); grad.addColorStop(1, a);
    g.fillStyle = grad; g.fillRect(0, 0, PX, PX);
    g.fillStyle = 'rgba(255,255,255,.5)';
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 26; i++) {
      const x = rnd() * PX, y = rnd() * PX, r = 0.6 + rnd() * 1.1;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  },
  signature(g, a, b) {
    const grad = g.createLinearGradient(0, 0, PX, PX);
    const stops = ['#ff6b9a', '#ffd76b', '#8fe07a', '#5ab8ff', '#c77dff', '#ff6b9a'];
    stops.forEach((c, i) => grad.addColorStop(i / (stops.length - 1), c));
    g.fillStyle = grad; g.fillRect(0, 0, PX, PX);
    g.fillStyle = a; g.globalAlpha = 0.22; g.fillRect(0, 0, PX, PX);
    g.globalAlpha = 1;
  },
  // Outlined, not filled — houndstooth already owns "tessellating filled
  // shapes" and tartan already owns "straight crosshatch", so a diamond
  // lattice needed its own visual grammar to actually read as a third
  // thing rather than a recolour of one of those two.
  diamond(g, a, b) {
    g.fillStyle = a; g.fillRect(0, 0, PX, PX);
    g.strokeStyle = b; g.lineWidth = PX * 0.05; g.lineJoin = 'round';
    const s = PX / 3;
    for (let y = -0.5; y < 4; y++) for (let x = -0.5; x < 4; x++) {
      const cx = x * s, cy = y * s;
      g.beginPath();
      g.moveTo(cx, cy - s * 0.42); g.lineTo(cx + s * 0.42, cy);
      g.lineTo(cx, cy + s * 0.42); g.lineTo(cx - s * 0.42, cy);
      g.closePath(); g.stroke();
    }
  },
  wave(g, a, b) {
    g.fillStyle = a; g.fillRect(0, 0, PX, PX);
    g.strokeStyle = b; g.lineWidth = PX * 0.10; g.lineCap = 'round';
    for (let y = PX * 0.15; y < PX; y += PX * 0.32) {
      g.beginPath();
      for (let x = 0; x <= PX; x += 2) {
        const yy = y + Math.sin((x / PX) * Math.PI * 2) * PX * 0.08;
        if (x === 0) g.moveTo(x, yy); else g.lineTo(x, yy);
      }
      g.stroke();
    }
  }
};

/** A diagonal sheen, laid over an already-drawn pattern and clipped to it
 *  (source-atop, same trick decals.js uses for its metal/holo finishes) —
 *  brighter and wider as purity climbs toward Flawless. 0 draws nothing. */
function applySheen(g, purity) {
  if (!purity) return;
  const p = Math.min(1, purity / 100);
  const grad = g.createLinearGradient(0, 0, PX, PX);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.5, `rgba(255,255,255,${(0.15 + p * 0.45).toFixed(2)})`);
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = grad;
  g.fillRect(0, 0, PX, PX);
  g.globalCompositeOperation = 'source-over';
}

/** A cached THREE.CanvasTexture for one shaft design, tinted from its own
 *  unlock colour. `color` is the unlock's `color` field; the second tone is
 *  derived so no design needs a second data field. `purity` (0-100, see
 *  shared/purity.js) layers a sheen on top — 0 looks exactly as it always
 *  has. */
export function shaftDecalTexture(id, color, purity = 0) {
  const key = id + '|' + color + '|' + purity;
  let tex = cache.get(key);
  if (tex) return tex;
  const draw = DRAW[id];
  if (!draw) return null;

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PX;
  const g = canvas.getContext('2d');
  draw(g, shade(color, -0.35), shade(color, 0.35));
  applySheen(g, purity);

  tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  cache.set(key, tex);
  return tex;
}

/** The same pattern as a data URL, for flat UI (the shaft-decal picker,
 *  the case reveal) that wants an <img>/background-image rather than a
 *  THREE texture. */
export function shaftDecalDataUrl(id, color, purity = 0) {
  const draw = DRAW[id];
  if (!draw) return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PX;
  const g = canvas.getContext('2d');
  draw(g, shade(color, -0.35), shade(color, 0.35));
  applySheen(g, purity);
  return canvas.toDataURL('image/png');
}

export const SHAFT_DECAL_IDS = Object.keys(DRAW);
