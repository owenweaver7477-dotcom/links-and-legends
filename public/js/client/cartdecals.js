/* =========================================================================
   cartdecals.js — the livery painted down the side of a cart
   -------------------------------------------------------------------------
   A cart has always taken the player's ball colour on its roof and seats
   (liveryColor in cart3d.js), which is enough to tell eight carts apart at
   distance and nothing more. This is the other half: a PATTERN, on the
   panels a cart actually shows — the flank, the bonnet and the roof edge.

   Six designs rather than twenty-three. A cart livery is read at speed, from
   the side, usually while it is bouncing — so these are all bold, high
   contrast and directional. The delicate patterns that work on a club shaft
   at arm's length (marble, crosshatch, pinstripe) would be grey smears here,
   which is why cart liveries are their own unlock kind and not a second use
   of the club decal list.

   Drawn wide rather than square: a cart flank is roughly 4:1, and a square
   texture stretched across it turns every diagonal into a different angle
   than the one authored. Same cache-by-id+colour contract as shaftdecals.js.
   ========================================================================= */

import * as THREE from '../../vendor/three.module.js';

const W = 256, H = 64;              // 4:1, the shape of the panel it lands on
const cache = new Map();

const shade = (hex, amt) => {
  const c = new THREE.Color(hex);
  if (amt < 0) c.multiplyScalar(1 + amt); else c.lerp(new THREE.Color(0xffffff), amt);
  return '#' + c.getHexString();
};

const DRAW = {
  /* A single hard flash tapering to the rear — the shape a stripe makes on
     anything that is supposed to look quick. */
  racer(g, a, b, base) {
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    g.fillStyle = a;
    g.beginPath();
    g.moveTo(W, H * 0.20); g.lineTo(W, H * 0.62);
    g.lineTo(0, H * 0.78); g.lineTo(0, H * 0.50);
    g.closePath(); g.fill();
    g.fillStyle = b;
    g.beginPath();
    g.moveTo(W, H * 0.66); g.lineTo(W, H * 0.76);
    g.lineTo(0, H * 0.86); g.lineTo(0, H * 0.80);
    g.closePath(); g.fill();
  },

  /* Two long waves crossing, which reads as movement from any angle rather
     than only from square on. */
  sidewind(g, a, b, base) {
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    g.lineCap = 'round';
    for (const [col, off, amp, lw] of [[a, 0.46, 0.20, H * 0.20], [b, 0.62, 0.14, H * 0.11]]) {
      g.strokeStyle = col; g.lineWidth = lw;
      g.beginPath();
      for (let x = -4; x <= W + 4; x += 6) {
        const y = H * off + Math.sin(x / W * Math.PI * 2.2) * H * amp;
        x === -4 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
    }
  },

  /* Licks off the nose. A flame job is a solid mass at the front breaking
     into long POINTED tongues that sweep backward and taper — the first
     attempt stacked fat teardrops and came out as a beige smear, because
     rounded blobs of similar size read as one shape however many you draw.
     What makes it a flame is the sharp tip and the length, so both are
     exaggerated well past the panel's height. */
  flames(g, a, b, base) {
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    /* One tongue: a fat root at the nose narrowing to a point up and back.
       The two control points have to sit on OPPOSITE sides of the tongue —
       the underside's low, the top edge's high. Putting both on the same
       side (which the first pass did) collapses the two edges into each
       other and draws a sliver, which is what made this read as a scratch
       rather than as fire. */
    const lick = (col, xRoot, yRoot, len, rise, thick) => {
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(xRoot, yRoot + thick / 2);
      g.quadraticCurveTo(xRoot - len * 0.50, yRoot + thick * 0.42,   // underside, low
                         xRoot - len, yRoot - rise);                 // the tip
      g.quadraticCurveTo(xRoot - len * 0.34, yRoot - rise * 0.72 - thick * 0.22,
                         xRoot, yRoot - thick / 2);                  // top edge, high
      g.closePath(); g.fill();
    };
    // the mass at the nose the tongues come out of
    g.fillStyle = a;
    g.beginPath();
    g.moveTo(W, H); g.lineTo(W, H * 0.04);
    g.quadraticCurveTo(W * 0.90, H * 0.26, W * 0.76, H);
    g.closePath(); g.fill();
    /* Lengths are a fraction of W and thicknesses a fraction of H, and on a
       4:1 panel that is a trap: the first pass asked for len 0.52 and thick
       0.30 and got a 133px needle off a 19px root. Every tongue below is
       kept near two-to-one root-to-length, which is what reads as fire
       rather than as a scratch. */
    for (const [x, len, rise, th] of [
      [0.86, 0.34, 0.30, 0.44], [0.80, 0.28, 0.62, 0.28],
      [0.78, 0.42, 0.06, 0.40], [0.70, 0.32, 0.46, 0.26],
      [0.62, 0.26, 0.20, 0.24], [0.54, 0.20, 0.38, 0.18]
    ]) lick(a, W * x, H * 0.70, W * len, H * rise, H * th);
    // the inner highlights are deliberately much smaller than the tongues
    // they sit inside — matched sizes read as two flame jobs overlaid
    for (const [x, len, rise, th] of [
      [0.80, 0.20, 0.24, 0.22], [0.74, 0.16, 0.46, 0.15], [0.68, 0.22, 0.08, 0.18]
    ]) lick(b, W * x, H * 0.74, W * len, H * rise, H * th);
  },

  /* A hard two-tone split with a shoulder line — the plainest of the six,
     and the one that suits a cart somebody wants to look expensive. */
  panels(g, a, b, base) {
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    g.fillStyle = a;
    g.beginPath();
    g.moveTo(0, H); g.lineTo(W, H); g.lineTo(W, H * 0.40); g.lineTo(0, H * 0.58);
    g.closePath(); g.fill();
    g.fillStyle = b;
    g.fillRect(0, H * 0.54, W, H * 0.055);
    g.globalAlpha = 0.5;
    g.fillRect(0, H * 0.30, W, H * 0.03);
    g.globalAlpha = 1;
  },

  /* Brushed metal: many fine horizontal strokes at varying brightness, which
     is what actually makes a flat colour read as metal at this distance. */
  chrome(g, a, b, base) {
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, b); grad.addColorStop(0.42, a);
    grad.addColorStop(0.52, '#ffffff'); grad.addColorStop(0.62, a);
    grad.addColorStop(1, base);
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    g.globalAlpha = 0.16; g.strokeStyle = '#ffffff'; g.lineWidth = 1;
    for (let y = 0; y < H; y += 3) {
      g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); g.stroke();
    }
    g.globalAlpha = 1;
  },

  /* Two rows offset by half a square, which is the only way a chequer stays
     a chequer when the panel it is on is not square. */
  checker(g, a, b, base) {
    /* Against `base` rather than `b`: a chequer is a CONTRAST, and the
       lighter derived tone of an already-pale unlock colour is the same
       white twice — which is what this drew before, an empty panel. */
    const s = H / 4;
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    g.fillStyle = a;
    for (let y = 0; y * s < H; y++) {
      for (let x = 0; x * s < W; x++) {
        if ((x + y) % 2) continue;
        g.fillRect(x * s, y * s, s, s);
      }
    }
  }
};

/** A cached THREE.CanvasTexture for one cart livery. `color` is the unlock's
 *  own colour; the other two tones are derived from it, so a livery needs no
 *  second data field — the same contract shaftDecalTexture uses. */
export function cartDecalTexture(id, color) {
  const key = id + '|' + color;
  const hit = cache.get(key);
  if (hit) return hit;
  const draw = DRAW[id];
  if (!draw) return null;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  draw(g, color, shade(color, 0.45), shade(color, -0.62));

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  cache.set(key, tex);
  return tex;
}

/** The same as a data URL, for the picker and the inventory card. */
const urlCache = new Map();
export function cartDecalDataUrl(id, color, w = 96) {
  const key = id + '|' + color + '|' + w;
  const hit = urlCache.get(key);
  if (hit) return hit;
  const draw = DRAW[id];
  if (!draw) return null;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  draw(g, color, shade(color, 0.45), shade(color, -0.62));
  if (w === W) {
    const u = canvas.toDataURL('image/png'); urlCache.set(key, u); return u;
  }
  const out = document.createElement('canvas');
  out.width = w; out.height = Math.round(w * H / W);
  const og = out.getContext('2d');
  og.imageSmoothingEnabled = true;
  og.drawImage(canvas, 0, 0, out.width, out.height);
  const url = out.toDataURL('image/png');
  urlCache.set(key, url);
  return url;
}

export const CART_DECAL_IDS = Object.keys(DRAW);
