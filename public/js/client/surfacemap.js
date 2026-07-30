/* =========================================================================
   surfacemap.js — paints the hole's ground texture
   -------------------------------------------------------------------------
   The terrain mesh carries the SHAPE; this canvas carries the LOOK. Drawing
   the fairway as a thick stroked spline, the green as an ellipse and so on
   (exactly the way the original top-down course map did it) gives crisp,
   correctly-placed edges no matter how coarse the mesh is — and it is drawn
   from the same hole data the physics reads, so the mown edge you can see is
   the edge the ball reacts to.
   ========================================================================= */

import { mulberry32, clamp } from '../shared/rng.js';

const MAX_PX = 2048;

export function buildSurfaceTexture(hole, bio) {
  const b = hole.bounds;
  const spanX = b.maxX - b.minX, spanZ = b.maxZ - b.minZ;
  const aspect = spanX / spanZ;
  let W, H;
  if (aspect >= 1) { W = MAX_PX; H = Math.round(MAX_PX / aspect); }
  else { H = MAX_PX; W = Math.round(MAX_PX * aspect); }

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const P = bio.palette;
  const rnd = mulberry32(hole.terrainSeed ^ 0xBEEF);

  // world -> pixel
  const sx = W / spanX, sz = H / spanZ;
  const px = x => (x - b.minX) * sx;
  const pz = z => (z - b.minZ) * sz;
  const pr = m => m * sx;                       // radius in px (x-axis scale)

  g.imageSmoothingEnabled = true;

  /* 1 ─ the wild land beyond the course --------------------------------- */
  g.fillStyle = bio.wasteAreas ? P.deep : P.deep;
  g.fillRect(0, 0, W, H);
  mottle(g, W, H, rnd, bio.wasteAreas ? ['#a98a58', '#8d7345'] : [P.deep, P.rough], 620);

  /* 2 ─ the corridor: rough, first cut, fairway -------------------------- */
  const path = routePath(hole, px, pz);
  g.lineCap = 'round'; g.lineJoin = 'round';

  g.strokeStyle = P.rough;
  g.lineWidth = pr(hole.fairwayWidth + hole.roughWidth * 2);
  g.stroke(path);
  // soften the rough's outer edge so it does not read as a painted stripe
  g.save();
  g.globalAlpha = 0.5;
  g.strokeStyle = P.rough;
  g.lineWidth = pr(hole.fairwayWidth + hole.roughWidth * 2.5);
  g.stroke(path);
  g.restore();

  g.strokeStyle = P.fringe;
  g.lineWidth = pr(hole.fairwayWidth + 5);
  g.stroke(path);

  g.strokeStyle = P.fairway;
  g.lineWidth = pr(hole.fairwayWidth);
  g.stroke(path);

  // mow stripes — masked to the fairway stroke so they stop at the first cut
  strokeMasked(g, W, H, path, pr(hole.fairwayWidth), layer => {
    drawStripes(layer, W, H, pr(16), 0.42, ['#ffffff', '#000000'], 0.055);
  });

  mottle(g, W, H, rnd, [P.rough, P.fairway], 260, 0.05);

  /* 3 ─ tee boxes -------------------------------------------------------- */
  for (const t of Object.values(hole.tees || { back: hole.tee })) {
    g.save();
    g.translate(px(t.x), pz(t.z));
    g.rotate(-t.rot);
    g.fillStyle = P.fringe;
    roundRect(g, -pr(t.w / 2), -pr(t.d / 2), pr(t.w), pr(t.d), pr(1.2));
    g.fill();
    g.restore();
  }

  /* 4 ─ bunkers ---------------------------------------------------------- */
  for (const bk of hole.bunkers) {
    g.save();
    // damp shadow inside the lip
    g.fillStyle = 'rgba(30,26,14,.22)';
    ellipse(g, px(bk.x), pz(bk.z), pr(bk.rx) * 1.06, pr(bk.rz) * 1.06, -bk.rot); g.fill();
    const grd = g.createRadialGradient(
      px(bk.x) - pr(bk.rx) * .3, pz(bk.z) - pr(bk.rz) * .35, pr(1),
      px(bk.x), pz(bk.z), pr(Math.max(bk.rx, bk.rz)));
    grd.addColorStop(0, lighten(P.sand, 0.16));
    grd.addColorStop(0.7, P.sand);
    grd.addColorStop(1, darken(P.sand, 0.14));
    g.fillStyle = grd;
    ellipse(g, px(bk.x), pz(bk.z), pr(bk.rx), pr(bk.rz), -bk.rot); g.fill();
    // rake lines
    g.strokeStyle = 'rgba(150,128,86,.42)'; g.lineWidth = Math.max(1, pr(0.16));
    for (let i = 1; i < 6; i++) {
      ellipse(g, px(bk.x), pz(bk.z), pr(bk.rx) * (i / 6), pr(bk.rz) * (i / 6), -bk.rot);
      g.stroke();
    }
    g.restore();
  }

  /* 5 ─ green + fringe --------------------------------------------------- */
  {
    const gr = hole.green;
    g.save();
    g.fillStyle = P.fringe;
    ellipse(g, px(gr.x), pz(gr.z), pr(gr.rx + 2.6), pr(gr.rz + 2.6), -gr.rot); g.fill();
    const grd = g.createRadialGradient(
      px(gr.x) - pr(gr.rx) * .3, pz(gr.z) - pr(gr.rz) * .35, pr(1),
      px(gr.x), pz(gr.z), pr(Math.max(gr.rx, gr.rz)));
    grd.addColorStop(0, lighten(P.green, 0.12));
    grd.addColorStop(1, P.green);
    g.fillStyle = grd;
    ellipse(g, px(gr.x), pz(gr.z), pr(gr.rx), pr(gr.rz), -gr.rot); g.fill();
    // fine green stripes
    g.save();
    ellipse(g, px(gr.x), pz(gr.z), pr(gr.rx), pr(gr.rz), -gr.rot); g.clip();
    drawStripes(g, W, H, pr(3.2), 1.05, ['#ffffff', '#000000'], 0.045);
    g.restore();
    g.restore();
  }

  /* 6 ─ the water bed (the surface itself is real geometry) -------------- */
  for (const w of hole.waters) {
    g.save();
    g.fillStyle = darken(P.dirt, 0.35);
    ellipse(g, px(w.x), pz(w.z), pr(w.rx), pr(w.rz), -w.rot); g.fill();
    g.strokeStyle = P.sand;
    g.lineWidth = pr(1.6);
    ellipse(g, px(w.x), pz(w.z), pr(w.rx), pr(w.rz), -w.rot); g.stroke();
    g.restore();
  }

  /* 7 ─ baked tree shadows: cheap, and they ground the trees properly ---- */
  g.save();
  const sunX = Math.sin(bio.sunAzim * Math.PI / 180);
  const sunZ = Math.cos(bio.sunAzim * Math.PI / 180);
  const shLen = 1 / Math.tan(bio.sunElev * Math.PI / 180);
  for (const t of hole.trees) {
    const off = Math.min(t.h * shLen, t.h * 1.6);
    const cx = px(t.x - sunX * off * 0.5);
    const cy = pz(t.z - sunZ * off * 0.5);
    const rr = pr(t.r * 0.95);
    const grd = g.createRadialGradient(cx, cy, rr * 0.2, cx, cy, rr * 1.5);
    grd.addColorStop(0, 'rgba(12,20,10,.42)');
    grd.addColorStop(1, 'rgba(12,20,10,0)');
    g.fillStyle = grd;
    g.beginPath(); g.ellipse(cx, cy, rr * 1.5, rr * 1.15, 0, 0, 7); g.fill();
  }
  g.restore();

  /* 8 ─ overall grain so nothing looks like flat paint ------------------- */
  grain(g, W, H, rnd, 0.055);

  return cv;
}

/* ------------------------------------------------------------- helpers --- */

function routePath(hole, px, pz) {
  const p = new Path2D();
  const r = hole.route;
  p.moveTo(px(r[0][0]), pz(r[0][1]));
  for (let i = 1; i < r.length; i++) p.lineTo(px(r[i][0]), pz(r[i][1]));
  return p;
}

/**
 * Canvas can clip to a *filled* path but not to a stroked one, so draw into an
 * offscreen layer, keep only the pixels that land under the thick stroke, then
 * composite the result back.  This is what stops the mow stripes from bleeding
 * out of the fairway and across the rough.
 */
function strokeMasked(g, W, H, path, width, drawFn) {
  const layer = document.createElement('canvas');
  layer.width = W; layer.height = H;
  const lg = layer.getContext('2d');
  drawFn(lg);
  lg.globalCompositeOperation = 'destination-in';
  lg.lineCap = 'round'; lg.lineJoin = 'round';
  lg.strokeStyle = '#fff';
  lg.lineWidth = width;
  lg.stroke(path);
  g.drawImage(layer, 0, 0);
}

function drawStripes(g, W, H, period, angle, colors, alpha) {
  g.save();
  g.globalAlpha = alpha;
  g.translate(W / 2, H / 2);
  g.rotate(angle);
  const span = Math.hypot(W, H);
  for (let i = -Math.ceil(span / period); i < Math.ceil(span / period); i++) {
    g.fillStyle = i % 2 ? colors[0] : colors[1];
    g.fillRect(-span, i * period, span * 2, period);
  }
  g.restore();
}

function mottle(g, W, H, rnd, colors, n, alphaScale = 1) {
  g.save();
  for (let i = 0; i < n; i++) {
    const x = rnd() * W, y = rnd() * H, r = (0.008 + rnd() * 0.035) * Math.max(W, H);
    g.globalAlpha = (0.04 + rnd() * 0.06) * alphaScale;
    g.fillStyle = colors[Math.floor(rnd() * colors.length)];
    g.beginPath(); g.ellipse(x, y, r, r * (0.5 + rnd() * 0.5), rnd() * 3, 0, 7); g.fill();
  }
  g.restore();
}

function grain(g, W, H, rnd, alpha) {
  const tile = document.createElement('canvas');
  tile.width = tile.height = 128;
  const tc = tile.getContext('2d');
  const img = tc.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 150 + rnd() * 105;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = rnd() * 255;
  }
  tc.putImageData(img, 0, 0);
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = g.createPattern(tile, 'repeat');
  g.fillRect(0, 0, W, H);
  g.restore();
}

function ellipse(g, x, y, rx, rz, rot) {
  g.beginPath();
  g.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, rz), rot || 0, 0, Math.PI * 2);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function hexToRgb(h) {
  const s = h.replace('#', '');
  const n = parseInt(s.length === 3 ? s.split('').map(c => c + c).join('') : s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function lighten(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  const f = v => Math.round(clamp(v + (255 - v) * amt, 0, 255));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
export function darken(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  const f = v => Math.round(clamp(v * (1 - amt), 0, 255));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
