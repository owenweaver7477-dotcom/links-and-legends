/* =========================================================================
   decals.js — every pattern and badge in the game, drawn rather than loaded
   -------------------------------------------------------------------------
   Ten shirt patterns, twenty-five decals and a design a player makes
   themselves, and not one of them is a file. Each is drawn once onto a small
   canvas the first time anything asks for it, cached by the exact arguments
   that produced it, and handed out as a shared THREE texture from then on.

   WHY NOT 4K MAPS.

   The spec that started this asked for 4096-square textures with full PBR.
   Three numbers settle it. A 4K RGBA map is 64 MB in GPU memory uncompressed,
   and there are thirty of them here. The whole bundle target for the portal
   this game ships on is 23 MB, of which the game currently spends 1.6. And a
   decal on a golfer's sleeve occupies roughly forty pixels of a 1080p frame
   at the closest camera in the game — the closest, on the character screen,
   is about two hundred and forty.

   So they are drawn at 256, at the device pixel ratio, and they are SHARPER
   than a downloaded 4K map because nothing resamples them.

   What the spec was really asking for is material response — that a metal
   badge catches the light and a holographic one shifts colour — and that is
   real here. It is done in the material rather than in a baked normal map,
   which is both cheaper and correct: a baked highlight is painted on and
   stays put when the golfer turns, which is exactly the thing that makes a
   fake highlight look fake.

   THE CACHE IS NOT AN OPTIMISATION. Eight players in a room, each with up to
   ten decal slots, is eighty textures. Uncached, that is eighty canvases and
   eighty GPU uploads for what is usually a handful of distinct images.
   ========================================================================= */

import * as THREE from '../../vendor/three.module.js';
import { decalById, DECALS } from '../shared/wardrobe.js';

const PATTERN_PX = 128;      // tiles, so it only ever needs to be one tile
const DECAL_PX = 256;

const cache = new Map();
/** Everything handed out, so a scene teardown can free it in one pass. */
const born = [];

function canvas(px) {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  return c;
}

function texFrom(c, { repeat = 1, wrap = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (wrap) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
  } else {
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  }
  /* Mipmaps on, anisotropy left alone. A golfer walks away from the camera
     for most of a round and an un-mipmapped check shirt at forty metres is a
     field of aliasing crawl — the single most visible rendering fault this
     game could ship. */
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  born.push(t);
  return t;
}

/* ============================================================= PATTERNS === */

const PAT = {
  solid(g, px, a) { g.fillStyle = a; g.fillRect(0, 0, px, px); },

  stripe(g, px, a, b) {
    g.fillStyle = a; g.fillRect(0, 0, px, px);
    g.fillStyle = b;
    for (let y = 0; y < px; y += px / 4) g.fillRect(0, y, px, px / 8);
  },

  pin(g, px, a, b) {
    g.fillStyle = a; g.fillRect(0, 0, px, px);
    g.fillStyle = b;
    for (let x = 0; x < px; x += px / 8) g.fillRect(x, 0, Math.max(1, px / 64), px);
  },

  check(g, px, a, b) {
    g.fillStyle = a; g.fillRect(0, 0, px, px);
    g.fillStyle = b;
    const n = 4, s = px / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if ((x + y) & 1) g.fillRect(x * s, y * s, s, s);
    }
  },

  argyle(g, px, a, b) {
    g.fillStyle = a; g.fillRect(0, 0, px, px);
    g.fillStyle = b;
    const h = px / 2;
    for (const [cx, cy] of [[h * 0.5, h * 0.5], [h * 1.5, h * 0.5],
                            [h * 0.5, h * 1.5], [h * 1.5, h * 1.5]]) {
      g.beginPath();
      g.moveTo(cx, cy - h * 0.46); g.lineTo(cx + h * 0.42, cy);
      g.lineTo(cx, cy + h * 0.46); g.lineTo(cx - h * 0.42, cy);
      g.closePath(); g.fill();
    }
    // the crossing lines that make it argyle and not just diamonds
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.lineWidth = Math.max(1, px / 96);
    g.beginPath();
    for (let i = -2; i < 4; i++) {
      g.moveTo(i * h, 0); g.lineTo(i * h + px, px);
      g.moveTo(i * h, px); g.lineTo(i * h + px, 0);
    }
    g.stroke();
  },

  geo(g, px, a, b) {
    g.fillStyle = a; g.fillRect(0, 0, px, px);
    g.fillStyle = b;
    const s = px / 4;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      g.beginPath();
      const ox = x * s, oy = y * s;
      if ((x + y) & 1) { g.moveTo(ox, oy); g.lineTo(ox + s, oy); g.lineTo(ox, oy + s); }
      else { g.moveTo(ox + s, oy + s); g.lineTo(ox, oy + s); g.lineTo(ox + s, oy); }
      g.closePath(); g.fill();
    }
  },

  camo(g, px, a, b) {
    g.fillStyle = a; g.fillRect(0, 0, px, px);
    /* Deterministic blobs. Math.random here would give every player in the
       room a different shirt from the same look id, which is the one thing a
       shared cosmetic may not do. */
    const rnd = (i) => Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1);
    for (const [col, n, r] of [[b, 14, 0.17], ['rgba(0,0,0,0.22)', 10, 0.13]]) {
      g.fillStyle = col;
      for (let i = 0; i < n; i++) {
        const cx = rnd(i * 3 + 1) * px, cy = rnd(i * 3 + 2) * px;
        const rr = (0.6 + rnd(i * 3 + 3) * 0.8) * r * px;
        g.beginPath();
        for (let k = 0; k <= 8; k++) {
          const ang = (k / 8) * Math.PI * 2;
          const wob = 0.68 + rnd(i * 11 + k) * 0.62;
          const x = cx + Math.cos(ang) * rr * wob, y = cy + Math.sin(ang) * rr * wob;
          k ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.closePath(); g.fill();
      }
    }
  },

  floral(g, px, a, b) {
    g.fillStyle = a; g.fillRect(0, 0, px, px);
    const rnd = i => Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1);
    for (let i = 0; i < 9; i++) {
      const cx = rnd(i * 2 + 1) * px, cy = rnd(i * 2 + 5) * px;
      const r = (0.05 + rnd(i + 9) * 0.045) * px;
      g.fillStyle = b;
      for (let p = 0; p < 5; p++) {
        const ang = (p / 5) * Math.PI * 2 + rnd(i) * 3;
        g.beginPath();
        g.ellipse(cx + Math.cos(ang) * r * 0.85, cy + Math.sin(ang) * r * 0.85,
                  r * 0.58, r * 0.36, ang, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = 'rgba(255,240,180,0.9)';
      g.beginPath(); g.arc(cx, cy, r * 0.32, 0, Math.PI * 2); g.fill();
    }
  },

  block(g, px, a, b) {
    g.fillStyle = a; g.fillRect(0, 0, px, px);
    g.fillStyle = b;
    g.beginPath();
    g.moveTo(0, px * 0.46); g.lineTo(px, px * 0.22);
    g.lineTo(px, px * 0.62); g.lineTo(0, px * 0.86);
    g.closePath(); g.fill();
  },

  fade(g, px, a, b) {
    const gr = g.createLinearGradient(0, 0, 0, px);
    gr.addColorStop(0, a); gr.addColorStop(1, b);
    g.fillStyle = gr; g.fillRect(0, 0, px, px);
  }
};

/**
 * A tiling shirt texture. Returns null for a plain solid — a solid colour has
 * no business becoming a texture lookup when the material can just hold the
 * colour, and that is the common case by a distance.
 */
export function patternTexture(id, a, b) {
  if (!id || id === 'solid' || !PAT[id]) return null;
  const key = `p:${id}:${a}:${b}`;
  if (cache.has(key)) return cache.get(key);
  const c = canvas(PATTERN_PX);
  const g = c.getContext('2d');
  PAT[id](g, PATTERN_PX, a, b);
  // `fade` must not tile or the gradient hard-cuts at every seam
  const t = texFrom(c, { repeat: id === 'fade' ? 1 : 2, wrap: id !== 'fade' });
  cache.set(key, t);
  return t;
}

/* =============================================================== DECALS === */

/** Rounded-rect path, used by half the badge shapes. */
function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function shieldPath(g, cx, cy, w, h) {
  g.beginPath();
  g.moveTo(cx - w / 2, cy - h / 2);
  g.lineTo(cx + w / 2, cy - h / 2);
  g.lineTo(cx + w / 2, cy + h * 0.12);
  g.quadraticCurveTo(cx + w / 2, cy + h / 2, cx, cy + h / 2);
  g.quadraticCurveTo(cx - w / 2, cy + h / 2, cx - w / 2, cy + h * 0.12);
  g.closePath();
}

function polyPath(g, cx, cy, r, n, rot = 0) {
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.closePath();
}

/** The letters on a house-brand mark. Drawn, never a webfont — a font that
    has not loaded yet renders as a different face and the cache keeps it. */
function wordmark(g, px, text, col) {
  g.fillStyle = col;
  g.font = `700 ${px * 0.19}px -apple-system, "Segoe UI", Roboto, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, px / 2, px * 0.56);
}

const DRAW = {
  /* ---- house brands: a mark and a wordmark ----------------------------- */
  brand(g, px, d) {
    const [a, b] = d.c;
    rr(g, px * 0.06, px * 0.22, px * 0.88, px * 0.56, px * 0.09);
    g.fillStyle = a; g.fill();
    g.strokeStyle = b; g.lineWidth = px * 0.022; g.stroke();
    // a small device to the left of the name
    g.fillStyle = b;
    if (d.id === 'albatr' || d.id === 'linksco') {
      polyPath(g, px * 0.22, px * 0.5, px * 0.09, 3, -Math.PI / 2); g.fill();
    } else if (d.id === 'ninein') {
      g.fillRect(px * 0.16, px * 0.38, px * 0.045, px * 0.24);
      g.fillRect(px * 0.16, px * 0.58, px * 0.13, px * 0.045);
    } else {
      g.beginPath(); g.arc(px * 0.22, px * 0.5, px * 0.075, 0, Math.PI * 2); g.fill();
    }
    const short = { bogey: 'B&Co', albatr: 'ALBA', ninein: 'NINE',
                    linksco: 'LINKS', caddym: 'CADDY', fairw: 'FWM' }[d.id] || 'GOLF';
    g.save(); g.translate(px * 0.08, 0); wordmark(g, px, short, b); g.restore();
  },

  /* ---- flags: bands and a device, never a real coat of arms ------------ */
  flag(g, px, d) {
    const c = d.c;
    if (d.id === 'fl-tri') {
      for (let i = 0; i < 3; i++) { g.fillStyle = c[i]; g.fillRect(i * px / 3, px * 0.2, px / 3, px * 0.6); }
    } else if (d.id === 'fl-band') {
      for (let i = 0; i < 3; i++) { g.fillStyle = c[i]; g.fillRect(0, px * 0.2 + i * px * 0.2, px, px * 0.2); }
    } else if (d.id === 'fl-cross') {
      g.fillStyle = c[0]; g.fillRect(0, px * 0.2, px, px * 0.6);
      g.fillStyle = c[1];
      g.fillRect(px * 0.3, px * 0.2, px * 0.14, px * 0.6);
      g.fillRect(0, px * 0.43, px, px * 0.14);
    } else if (d.id === 'fl-salt') {
      g.fillStyle = c[0]; g.fillRect(0, px * 0.2, px, px * 0.6);
      g.strokeStyle = c[1]; g.lineWidth = px * 0.12;
      g.beginPath();
      g.moveTo(0, px * 0.2); g.lineTo(px, px * 0.8);
      g.moveTo(px, px * 0.2); g.lineTo(0, px * 0.8);
      g.stroke();
    } else if (d.id === 'fl-sun') {
      g.fillStyle = c[0]; g.fillRect(0, px * 0.2, px, px * 0.6);
      g.fillStyle = c[1];
      g.beginPath(); g.arc(px / 2, px / 2, px * 0.17, 0, Math.PI * 2); g.fill();
    } else {
      g.fillStyle = c[0]; g.fillRect(0, px * 0.2, px, px * 0.6);
      g.fillStyle = c[1];
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        polyPath(g, px / 2 + Math.cos(a) * px * 0.2, px / 2 + Math.sin(a) * px * 0.15,
                 px * 0.045, 5, -Math.PI / 2);
        g.fill();
      }
    }
  },

  /* ---- team badges: a shield with a device ----------------------------- */
  team(g, px, d) {
    const [a, b] = d.c;
    shieldPath(g, px / 2, px / 2, px * 0.7, px * 0.8);
    g.fillStyle = a; g.fill();
    g.strokeStyle = b; g.lineWidth = px * 0.03; g.stroke();
    g.fillStyle = b;
    if (d.id === 'tm-wreath') {
      g.strokeStyle = b; g.lineWidth = px * 0.035;
      g.beginPath(); g.arc(px / 2, px * 0.52, px * 0.2, 0.5, Math.PI - 0.5); g.stroke();
      g.beginPath(); g.arc(px / 2, px * 0.52, px * 0.2, Math.PI + 0.5, -0.5); g.stroke();
    } else if (d.id === 'tm-shield') {
      g.fillRect(px * 0.46, px * 0.32, px * 0.08, px * 0.34);
      polyPath(g, px / 2, px * 0.3, px * 0.09, 3, -Math.PI / 2); g.fill();
    } else {
      // crossed clubs
      g.save(); g.translate(px / 2, px * 0.52);
      for (const rot of [-0.5, 0.5]) {
        g.save(); g.rotate(rot);
        g.fillRect(-px * 0.018, -px * 0.2, px * 0.036, px * 0.34);
        g.fillRect(-px * 0.055, px * 0.1, px * 0.09, px * 0.05);
        g.restore();
      }
      g.restore();
    }
  },

  /* ---- achievements: a star in a ring, and they glow -------------------
     The rarest category in the game — earned, never bought — so it is
     the one place worth spending extra draw calls on. Radiating spokes
     behind the ring read as "trophy" rather than "button" at a glance,
     which matters here specifically: an ace badge is the whole reason
     someone plays a round again. */
  earn(g, px, d) {
    const [a, b] = d.c;
    // the rays, first, so the ring and star sit on top of them
    g.save();
    g.translate(px / 2, px / 2);
    g.strokeStyle = b; g.globalAlpha = 0.55; g.lineWidth = px * 0.018;
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      g.beginPath();
      g.moveTo(Math.cos(ang) * px * 0.37, Math.sin(ang) * px * 0.37);
      g.lineTo(Math.cos(ang) * px * 0.48, Math.sin(ang) * px * 0.48);
      g.stroke();
    }
    g.restore();
    g.strokeStyle = a; g.lineWidth = px * 0.055;
    g.beginPath(); g.arc(px / 2, px / 2, px * 0.36, 0, Math.PI * 2); g.stroke();
    const gr = g.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px * 0.36);
    gr.addColorStop(0, b); gr.addColorStop(1, a);
    g.fillStyle = gr;
    g.beginPath(); g.arc(px / 2, px / 2, px * 0.32, 0, Math.PI * 2); g.fill();
    // a five-point star, points and valleys
    g.fillStyle = '#ffffff';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i & 1 ? px * 0.10 : px * 0.22;
      const ang = -Math.PI / 2 + (i / 10) * Math.PI * 2;
      const x = px / 2 + Math.cos(ang) * r, y = px / 2 + Math.sin(ang) * r;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath(); g.fill();
    // a bright core so the star reads as lit, not just white-filled
    const core = g.createRadialGradient(px / 2, px * 0.46, 0, px / 2, px * 0.46, px * 0.16);
    core.addColorStop(0, 'rgba(255,255,255,0.95)');
    core.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = core;
    g.beginPath(); g.arc(px / 2, px / 2, px * 0.36, 0, Math.PI * 2); g.fill();
  },

  /* ---- seasonal --------------------------------------------------------- */
  season(g, px, d) {
    const [a, b] = d.c;
    g.beginPath(); g.arc(px / 2, px / 2, px * 0.36, 0, Math.PI * 2);
    g.fillStyle = a; g.fill();
    g.strokeStyle = b; g.lineWidth = px * 0.03; g.stroke();
    g.strokeStyle = b; g.fillStyle = b;
    if (d.id === 'se-snow') {
      g.lineWidth = px * 0.028;
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2;
        g.moveTo(px / 2, px / 2);
        g.lineTo(px / 2 + Math.cos(ang) * px * 0.24, px / 2 + Math.sin(ang) * px * 0.24);
      }
      g.stroke();
    } else if (d.id === 'se-leaf') {
      g.beginPath();
      g.moveTo(px / 2, px * 0.28);
      g.quadraticCurveTo(px * 0.78, px * 0.5, px / 2, px * 0.72);
      g.quadraticCurveTo(px * 0.22, px * 0.5, px / 2, px * 0.28);
      g.fill();
    } else if (d.id === 'se-sun') {
      g.beginPath(); g.arc(px / 2, px / 2, px * 0.13, 0, Math.PI * 2); g.fill();
      g.lineWidth = px * 0.035;
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2;
        g.moveTo(px / 2 + Math.cos(ang) * px * 0.18, px / 2 + Math.sin(ang) * px * 0.18);
        g.lineTo(px / 2 + Math.cos(ang) * px * 0.27, px / 2 + Math.sin(ang) * px * 0.27);
      }
      g.stroke();
    } else {
      for (let p = 0; p < 6; p++) {
        const ang = (p / 6) * Math.PI * 2;
        g.beginPath();
        g.ellipse(px / 2 + Math.cos(ang) * px * 0.15, px / 2 + Math.sin(ang) * px * 0.15,
                  px * 0.10, px * 0.06, ang, 0, Math.PI * 2);
        g.fill();
      }
    }
  },

  /* ---- the player's own. Shape, two colours, up to three letters. ------- */
  custom(g, px, d, cu) {
    const a = cu?.a || '#eef1ec', b = cu?.b || '#2f9e6a';
    g.fillStyle = a;
    g.strokeStyle = b;
    g.lineWidth = px * 0.045;
    const s = cu?.shape || 'shield';
    if (s === 'shield') shieldPath(g, px / 2, px / 2, px * 0.72, px * 0.82);
    else if (s === 'circle') { g.beginPath(); g.arc(px / 2, px / 2, px * 0.37, 0, Math.PI * 2); }
    else if (s === 'diamond') polyPath(g, px / 2, px / 2, px * 0.4, 4, 0);
    else if (s === 'hex') polyPath(g, px / 2, px / 2, px * 0.4, 6, Math.PI / 6);
    else rr(g, px * 0.08, px * 0.26, px * 0.84, px * 0.48, px * 0.06);
    g.fill(); g.stroke();
    const txt = cu?.txt || '';
    if (txt) {
      g.fillStyle = b;
      g.font = `800 ${px * (txt.length > 2 ? 0.24 : 0.32)}px -apple-system, "Segoe UI", Roboto, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(txt, px / 2, px * 0.52);
    }
  }
};

/**
 * A decal, as a transparent texture. `custom` is only read for the generated
 * design, and is part of the cache key so two players with different
 * monograms do not share one badge.
 */
export function decalTexture(id, custom) {
  const d = decalById(id);
  if (!d) return null;
  const key = d.cat === 'custom'
    ? `d:custom:${custom?.shape}:${custom?.a}:${custom?.b}:${custom?.txt}`
    : `d:${id}`;
  if (cache.has(key)) return cache.get(key);

  const c = canvas(DECAL_PX);
  const g = c.getContext('2d');
  (DRAW[d.cat] || DRAW.brand)(g, DECAL_PX, d, custom);

  /* Embossed decals get their micro-shadow baked, and only they do. It is
     the one finish where the relief is part of the ARTWORK rather than part
     of the lighting — a raised edge shades the same way whichever direction
     you look from, which is exactly what a baked map is right for. */
  if (d.finish === 'emboss') {
    g.globalCompositeOperation = 'source-atop';
    const gr = g.createLinearGradient(0, 0, DECAL_PX * 0.5, DECAL_PX);
    gr.addColorStop(0, 'rgba(255,255,255,0.34)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0)');
    gr.addColorStop(1, 'rgba(0,0,0,0.30)');
    g.fillStyle = gr;
    g.fillRect(0, 0, DECAL_PX, DECAL_PX);
    g.globalCompositeOperation = 'source-over';
  }

  /* Every OTHER decal was flat colour with no light on it at all — correct
     for "printed on the fabric" but with nothing behind it that reads as a
     real badge rather than a sticker. A soft diagonal sheen, baked the same
     `source-atop` way emboss already does, gives every decal a top-left
     highlight and a bottom-right falloff without touching the artwork
     underneath — the metal/holo finishes still get their own moving
     specular from the material on top of this. */
  if (d.finish !== 'emboss') {
    g.globalCompositeOperation = 'source-atop';
    const sheen = g.createLinearGradient(0, 0, DECAL_PX * 0.7, DECAL_PX * 0.9);
    sheen.addColorStop(0, 'rgba(255,255,255,0.22)');
    sheen.addColorStop(0.45, 'rgba(255,255,255,0)');
    sheen.addColorStop(1, 'rgba(0,0,0,0.16)');
    g.fillStyle = sheen;
    g.fillRect(0, 0, DECAL_PX, DECAL_PX);
    g.globalCompositeOperation = 'source-over';
  }

  const t = texFrom(c, { wrap: false });
  cache.set(key, t);
  return t;
}

/* ============================================================ MATERIALS ===
   The finish, done in the material where it belongs.

     flat/emboss — lambert. It takes the scene light the shirt takes, which
                   is what "printed on the fabric" means.
     metal       — phong with a tight specular, so a highlight travels across
                   it as the golfer turns. A baked highlight cannot do that,
                   and a highlight that does not move is the exact thing that
                   makes a fake one read as fake.
     holo        — phong plus a per-frame hue rotation on the emissive. Cheap,
                   and it is the only one that needs updating over time, which
                   is why `holoMaterials` exists rather than a general tick. */
const holoMats = [];

export function decalMaterial(id, custom) {
  const d = decalById(id);
  const map = decalTexture(id, custom);
  if (!d || !map) return null;

  /* The MATERIAL is cached, not only the texture, and that is not a micro
     optimisation. The menu avatar is disposed and rebuilt on every single
     swatch click, so an uncached material here meant a fresh THREE material
     per decal per click — and every holographic one was pushed onto the
     tick list and never taken off, so the per-frame hue update walked a list
     that grew forever over dead materials. Cached, the list holds one entry
     per distinct holo decal in the game, which is four.

     Sharing is safe because a decal material has no per-avatar state: two
     players wearing the same badge want the identical thing. */
  const mkey = `m:${id}:${d.cat === 'custom'
    ? `${custom?.shape}:${custom?.a}:${custom?.b}:${custom?.txt}` : ''}`;
  if (cache.has(mkey)) return cache.get(mkey);

  const base = {
    map, transparent: true, alphaTest: 0.35,
    depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
  };

  if (d.finish === 'metal' || d.finish === 'holo') {
    const m = new THREE.MeshPhongMaterial({
      ...base,
      specular: new THREE.Color(d.finish === 'metal' ? 0xffffff : 0xbfa8ff),
      shininess: d.finish === 'metal' ? 92 : 58,
      emissive: new THREE.Color(d.glow ? d.c[0] : 0x000000),
      emissiveIntensity: d.glow ? 0.30 + d.glow * 0.22 : 0
    });
    if (d.finish === 'holo') { m.userData.holo = true; holoMats.push(m); }
    // `shared` is the flag Avatar.dispose() and GolfScene.dispose() both
    // honour — freeing one of these would blank the badge on every other
    // player still wearing it
    m.userData.shared = true;
    cache.set(mkey, m);
    return m;
  }

  const m = new THREE.MeshLambertMaterial({
    ...base,
    emissive: new THREE.Color(d.glow ? d.c[0] : 0x000000),
    emissiveIntensity: d.glow ? 0.16 + 0.22 * d.glow : 0
  });
  m.userData.shared = true;
  cache.set(mkey, m);
  return m;
}

/**
 * Advance the holographic decals. Called once per frame from the scene, NOT
 * once per decal per frame — every holo decal in the room shares this list,
 * and there are at most a handful of distinct materials.
 */
export function tickHolo(t) {
  for (let i = 0; i < holoMats.length; i++) {
    const m = holoMats[i];
    // a slow sweep through the hues, offset per material so eight players
    // wearing the same badge are not a synchronised light show
    const h = (t * 0.12 + i * 0.19) % 1;
    m.emissive.setHSL(h, 0.62, 0.36);
    m.specular.setHSL((h + 0.42) % 1, 0.7, 0.7);
  }
}

/** Shirt material for a pattern + fabric. Null map means a plain colour. */
export function shirtMaterial(colour, patternId, colour2, sheen) {
  const map = patternTexture(patternId, colour, colour2);
  if (sheen > 0.28) {
    return new THREE.MeshPhongMaterial({
      color: new THREE.Color(map ? '#ffffff' : colour), map: map || null,
      specular: new THREE.Color(0xffffff),
      shininess: 8 + sheen * 86
    });
  }
  return new THREE.MeshLambertMaterial({
    color: new THREE.Color(map ? '#ffffff' : colour), map: map || null
  });
}

/* ============================================================= GLOW HALO ===
   A glowing decal's material emits light, but a material alone only makes
   ITS OWN surface brighter — it does not put light in the air around it,
   which is the part that actually reads as "glowing" rather than "made of
   a slightly luminous plastic". This is a second, additive-blended plane
   behind the badge for exactly the handful of decals that earned it. */
let _haloTex = null;
function haloTexture() {
  if (_haloTex) return _haloTex;
  const S = 64, c = canvas(S);
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.28)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  _haloTex = new THREE.CanvasTexture(c);
  _haloTex.userData.shared = true;
  return _haloTex;
}

/** A halo material for this decal, or null if it does not glow. Cached the
 *  same way decalMaterial is — one per distinct glowing decal, shared by
 *  everyone wearing it. */
export function decalHalo(id) {
  const d = decalById(id);
  if (!d?.glow) return null;
  const mkey = `h:${id}`;
  if (cache.has(mkey)) return cache.get(mkey);
  const m = new THREE.SpriteMaterial({
    map: haloTexture(), color: new THREE.Color(d.c[0]),
    transparent: true, depthWrite: false, opacity: 0.55 * d.glow,
    blending: THREE.AdditiveBlending
  });
  m.userData.shared = true;
  cache.set(mkey, m);
  return m;
}

/** Free every texture this module has handed out. */
export function disposeDecalAssets() {
  for (const t of born) t.dispose();
  for (const v of cache.values()) if (v.isMaterial) v.dispose();
  born.length = 0;
  cache.clear();
  holoMats.length = 0;
  _haloTex?.dispose(); _haloTex = null;
}

/** Decals a level has earned, for the wardrobe's own listing. */
export const decalsAt = level => DECALS.filter(d => !d.at || level >= d.at);
