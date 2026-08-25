/* =========================================================================
   finishpreview.js — ball finishes and ball trails, drawn rather than left
   blank
   -------------------------------------------------------------------------
   Same shape as shaftdecals.js: draw a small pattern once onto a canvas,
   cache it by key, hand back a data URL. Two things a 2D canvas can fake
   convincingly with a gradient and nothing else — a lit sphere (a ball
   finish) and a fading particle stream (a ball trail) — so neither needed
   a WebGL preview to stop looking like a flat colour swatch.
   ========================================================================= */

const cache = new Map();

/* How hard the highlight sits, keyed by the ball unlock's own id — a
 * matte ball wants a soft, wide highlight; chrome wants it small and
 * near-white; unlisted/future ids fall back to a middling satin look
 * rather than erroring. */
const HARDNESS = { matte: 0.55, pearl: 0.35, opal: 0.35, chrome: 0.14, prism: 0.22, lava: 0.26 };
const HOLO_IDS = new Set(['pearl', 'opal', 'prism']);

/** A radial-gradient sphere: dark rim, bright off-centre highlight — the
 *  standard cheap trick for "this reads as lit and round" without an
 *  actual light or camera. `id` is the ball unlock's own id, driving how
 *  hard the highlight is and whether it gets the iridescent sweep. */
export function ballFinishDataUrl(color, id = '', size = 64) {
  const key = 'ball|' + color + '|' + id + '|' + size;
  let url = cache.get(key);
  if (url) return url;

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const cx = size / 2, cy = size / 2, r = size * 0.46;

  const h = HARDNESS[id] ?? 0.32;
  const hx = cx - r * 0.32, hy = cy - r * 0.38;

  const base = g.createRadialGradient(hx, hy, r * h * 0.15, cx, cy, r);
  base.addColorStop(0, '#ffffff');
  base.addColorStop(h, color);
  base.addColorStop(1, shade2(color, -0.45));
  g.fillStyle = base;
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();

  // rim light — a thin bright arc opposite the highlight, the second cue
  // (after the highlight itself) that reads as "sphere" rather than "disc"
  g.strokeStyle = 'rgba(255,255,255,.35)';
  g.lineWidth = size * 0.02;
  g.beginPath();
  g.arc(cx, cy, r - g.lineWidth, Math.PI * 0.15, Math.PI * 0.85);
  g.stroke();

  if (HOLO_IDS.has(id)) {
    const sweep = g.createLinearGradient(0, 0, size, size);
    ['#ff6b9a', '#ffd76b', '#8fe07a', '#5ab8ff', '#c77dff'].forEach((c, i, a) => sweep.addColorStop(i / (a.length - 1), c));
    g.globalCompositeOperation = 'overlay';
    g.globalAlpha = 0.35;
    g.fillStyle = sweep;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  url = canvas.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

/** A curved trail of fading dots in the trail's own colour, evoking the
 *  particle stream the ball actually leaves rather than a flat swatch. */
export function trailPreviewDataUrl(color, size = 64) {
  const key = 'trail|' + color + '|' + size;
  let url = cache.get(key);
  if (url) return url;

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const N = 9;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const x = size * (0.14 + t * 0.72);
    const y = size * (0.82 - Math.sin(t * Math.PI * 0.9) * 0.62);
    const rad = size * (0.02 + (1 - t) * 0.06);
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fillStyle = color;
    g.globalAlpha = 0.25 + (1 - t) * 0.65;
    g.fill();
  }
  g.globalAlpha = 1;

  url = canvas.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

const shade2 = (hex, amt) => {
  const n = parseInt(hex.replace('#', ''), 16);
  let r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
  const mix = (c) => amt < 0 ? c * (1 + amt) : c + (255 - c) * amt;
  r = Math.max(0, Math.min(255, mix(r)));
  gg = Math.max(0, Math.min(255, mix(gg)));
  b = Math.max(0, Math.min(255, mix(b)));
  return `rgb(${r | 0},${gg | 0},${b | 0})`;
};
