/* =========================================================================
   shaftdecals.js — a club's finish, drawn rather than tinted
   -------------------------------------------------------------------------
   Twenty-three named designs (unlocks.js, kind:'decal') that until recently
   all rendered as the same flat rectangle tinted to the unlock's `color`
   field — a "Houndstooth" and a "Racing stripe" were indistinguishable.
   Same approach as decals.js: draw each pattern once onto a canvas, cache it
   by id+colour, hand out a THREE.CanvasTexture.

   ON RESOLUTION. This was 48px, and the reasoning was sound while a decal
   was a two-centimetre BAND round the shaft: a few pixels on screen even up
   close, so a bigger canvas was VRAM spent on nothing. A decal now covers
   the whole club — the full shaft and a panel shaped to the head — and it is
   shown at 200px on a turntable in the shop, in the case reveal and on the
   inventory card. At 48 that read as a blur, which is the single most
   visible reason the cosmetics looked cheap. 128 costs 64 KB per cached
   texture and every one of them is generated once and kept.

   Every DRAW function is written against PX rather than against literals,
   so raising it re-renders each pattern at the higher resolution rather
   than scaling a small one up. That was true before this change and it is
   the reason the change is one number.
   ========================================================================= */

import * as THREE from '../../vendor/three.module.js';

const PX = 128;          // native pattern resolution — see the note above
const SWATCH = 48;       // what a picker square has always asked for
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
    /* The one pattern with pixel literals rather than PX fractions: a weave
       is a line WEIGHT, and at PX=128 a 1px stroke reads as a faint grid
       instead of woven cloth. Scaled with everything else. */
    const w = Math.max(1, PX / 48);
    g.strokeStyle = b; g.lineWidth = w; g.globalAlpha = 0.55;
    const s = PX / 8;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      if ((x + y) % 2) continue;
      g.strokeRect(x * s + w / 2, y * s + w / 2, s - w, s - w);
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
  },
  spiral(g, a, b) {
    g.fillStyle = a; g.fillRect(0, 0, PX, PX);
    g.strokeStyle = b; g.lineWidth = PX * 0.07; g.lineCap = 'round';
    const cx = PX / 2, cy = PX / 2;
    g.beginPath();
    for (let t = 0; t <= 1; t += 0.01) {
      const ang = t * Math.PI * 5, r = t * PX * 0.62;
      const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r;
      if (t === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  },
  // Sharp points, not chevron's smooth rounded-join V's and not
  // lightning's single bolt — a proper W/M zigzag, tight and repeated.
  zigzag(g, a, b) {
    g.fillStyle = a; g.fillRect(0, 0, PX, PX);
    g.strokeStyle = b; g.lineWidth = PX * 0.11; g.lineJoin = 'miter'; g.miterLimit = 4;
    const step = PX * 0.22;
    for (let y = -step; y < PX + step; y += step * 2) {
      g.beginPath();
      for (let x = -step; x <= PX + step; x += step) {
        const i = Math.round((x + step) / step);
        const yy = y + (i % 2 === 0 ? 0 : step);
        if (x === -step) g.moveTo(x, yy); else g.lineTo(x, yy);
      }
      g.stroke();
    }
  },
  // Concentric rings, off-centre — the one pattern here with no straight
  // line in it at all.
  ripple(g, a, b) {
    g.fillStyle = a; g.fillRect(0, 0, PX, PX);
    g.strokeStyle = b; g.lineWidth = PX * 0.045;
    const cx = PX * 0.38, cy = PX * 0.62;
    for (let r = PX * 0.1; r < PX * 1.05; r += PX * 0.16) {
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();
    }
  },

  /* ---- the second wave. Same rules as everything above: two tones, no
     fine detail (this is 48px wrapped round a shaft you see from twenty
     metres), and every pattern has to still read as ITSELF at that size —
     which is why none of these are line art. ---- */
  pinstripe(g, a, b) {
    g.fillStyle = a; g.fillRect(0, 0, PX, PX);
    g.strokeStyle = b; g.lineWidth = PX * 0.05;
    for (let x = PX * 0.12; x < PX; x += PX * 0.25) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, PX); g.stroke();
    }
  },
  dots(g, a, b) {
    g.fillStyle = a; g.fillRect(0, 0, PX, PX);
    g.fillStyle = b;
    const s = PX / 4;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      // offset every other row, or it reads as a grid rather than a spot
      const ox = (y % 2) * s * 0.5;
      g.beginPath();
      g.arc(x * s + s * 0.5 + ox, y * s + s * 0.5, s * 0.24, 0, Math.PI * 2);
      g.fill();
    }
  },
  crosshatch(g, a, b) {
    g.fillStyle = a; g.fillRect(0, 0, PX, PX);
    g.strokeStyle = b; g.lineWidth = PX * 0.045;
    for (let i = -PX; i < PX * 2; i += PX * 0.22) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + PX, PX); g.stroke();
      g.beginPath(); g.moveTo(i + PX, 0); g.lineTo(i, PX); g.stroke();
    }
  },
  scales(g, a, b) {
    g.fillStyle = a; g.fillRect(0, 0, PX, PX);
    g.strokeStyle = b; g.lineWidth = PX * 0.05;
    const s = PX / 4;
    for (let y = 0; y <= 4; y++) for (let x = -1; x <= 4; x++) {
      const ox = (y % 2) * s * 0.5;
      g.beginPath();
      g.arc(x * s + ox, y * s, s * 0.5, Math.PI, 0);
      g.stroke();
    }
  },
  bolt(g, a, b) {
    g.fillStyle = a; g.fillRect(0, 0, PX, PX);
    g.strokeStyle = b; g.lineWidth = PX * 0.10; g.lineCap = 'round';
    // two offset arrows, so the wrap has something happening on both sides
    for (const ox of [0, PX * 0.5]) {
      g.beginPath();
      g.moveTo(ox + PX * 0.10, PX * 0.80);
      g.lineTo(ox + PX * 0.26, PX * 0.46);
      g.lineTo(ox + PX * 0.14, PX * 0.42);
      g.lineTo(ox + PX * 0.32, PX * 0.14);
      g.stroke();
    }
    g.lineCap = 'butt';
  },
  weave(g, a, b) {
    g.fillStyle = a; g.fillRect(0, 0, PX, PX);
    g.fillStyle = b;
    const s = PX / 6;
    // a basket weave: alternating horizontal and vertical pairs
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) {
      if ((Math.floor(x / 2) + Math.floor(y / 2)) % 2) continue;
      g.fillRect(x * s, y * s, s, s);
    }
  },
  arrows(g, a, b) {
    g.fillStyle = a; g.fillRect(0, 0, PX, PX);
    g.fillStyle = b;
    const s = PX / 3;
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
      const cx = x * s + s * 0.5, cy = y * s + s * 0.5;
      g.beginPath();
      g.moveTo(cx, cy - s * 0.30);
      g.lineTo(cx + s * 0.28, cy + s * 0.22);
      g.lineTo(cx, cy + s * 0.06);
      g.lineTo(cx - s * 0.28, cy + s * 0.22);
      g.closePath(); g.fill();
    }
  },
  marble(g, a, b) {
    g.fillStyle = a; g.fillRect(0, 0, PX, PX);
    g.strokeStyle = b; g.lineWidth = PX * 0.035; g.lineCap = 'round';
    /* Seeded, not Math.random — the same decal must look the same on every
       machine and on every redraw, the same rule goldleaf's speckles follow. */
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 7; i++) {
      const y = rnd() * PX;
      g.beginPath();
      g.moveTo(0, y);
      g.bezierCurveTo(PX * 0.3, y - PX * 0.18 * rnd(), PX * 0.7, y + PX * 0.18 * rnd(), PX, y);
      g.stroke();
    }
    g.lineCap = 'butt';
  },
  circuit(g, a, b) {
    g.fillStyle = a; g.fillRect(0, 0, PX, PX);
    g.strokeStyle = b; g.lineWidth = PX * 0.05;
    g.fillStyle = b;
    const s = PX / 4;
    for (let i = 0; i < 4; i++) {
      const y = i * s + s * 0.5;
      g.beginPath();
      g.moveTo(0, y); g.lineTo(PX * 0.42, y);
      g.lineTo(PX * 0.42, y + (i % 2 ? -s * 0.5 : s * 0.5));
      g.lineTo(PX, y + (i % 2 ? -s * 0.5 : s * 0.5));
      g.stroke();
      g.beginPath(); g.arc(PX * 0.42, y, PX * 0.055, 0, Math.PI * 2); g.fill();
    }
  },
  starfield(g, a, b) {
    g.fillStyle = a; g.fillRect(0, 0, PX, PX);
    g.fillStyle = b;
    let seed = 991;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 26; i++) {
      const x = rnd() * PX, y = rnd() * PX, r = PX * (0.012 + rnd() * 0.030);
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
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

/** A radial vignette (darker at the rim, a touch brighter at the centre) —
 *  layered on top of a pattern that's otherwise flat colour throughout, it
 *  reads as "lit from the front" rather than as a texture pasted flat.
 *  Only worth the extra draw at a size someone's actually looking closely
 *  at (see the `size` param below); at 20-24px in a picker grid it would
 *  just be noise. */
function applyVignette(g, size) {
  const grad = g.createRadialGradient(size * 0.42, size * 0.4, size * 0.05, size * 0.5, size * 0.5, size * 0.72);
  grad.addColorStop(0, 'rgba(255,255,255,.16)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(0,0,0,.28)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
}

/** The same pattern as a data URL, for flat UI (the shaft-decal picker,
 *  the case reveal, the Inventory page, the Items shop) that wants an
 *  <img>/background-image rather than a THREE texture. `size` defaults to
 *  the pattern's own native 48px for the small spots this always rendered
 *  at; a caller showing it bigger (a detail card, not a 20px swatch) can
 *  ask for e.g. 96 and get the vignette pass too — drawn at native
 *  resolution and scaled up rather than re-run at `size`, since every
 *  DRAW function is written against the fixed PX constant, and a flat
 *  geometric pattern scales cleanly (nothing here is fine text or a photo
 *  that would need re-rendering to stay sharp). */
const urlCache = new Map();

export function shaftDecalDataUrl(id, color, purity = 0, size = SWATCH) {
  const draw = DRAW[id];
  if (!draw) return null;
  /* Cached like shaftDecalTexture above and like both of finishpreview.js's
     helpers — this was the one preview function in the client that redrew
     and re-encoded a PNG on EVERY call, and at any size but the native 48
     it did it across two canvases. The Inventory grid alone asks for ~35 of
     these every time it renders, and it re-renders on every equip. */
  const key = id + '|' + color + '|' + purity + '|' + size;
  const hit = urlCache.get(key);
  if (hit) return hit;

  const native = document.createElement('canvas');
  native.width = native.height = PX;
  const ng = native.getContext('2d');
  draw(ng, shade(color, -0.35), shade(color, 0.35));
  applySheen(ng, purity);
  if (size === PX) {
    const url = native.toDataURL('image/png');
    urlCache.set(key, url);
    return url;
  }

  /* The vignette is worth its draw at a size somebody is looking closely at
     and is only noise at a 20px picker swatch — so it is gated on the size
     asked for rather than on "did the caller pass one". That distinction
     used to be the same thing, back when the native resolution and the
     default swatch size were both 48; now they are not, and a swatch would
     otherwise get a vignette it never had. */
  const detail = size >= 64;

  const out = document.createElement('canvas');
  out.width = out.height = size;
  const og = out.getContext('2d');
  og.imageSmoothingEnabled = true;
  og.drawImage(native, 0, 0, size, size);
  if (detail) applyVignette(og, size);
  const url = out.toDataURL('image/png');
  urlCache.set(key, url);
  return url;
}

export const SHAFT_DECAL_IDS = Object.keys(DRAW);
