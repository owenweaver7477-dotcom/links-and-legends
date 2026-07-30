/* =========================================================================
   coursegen.js — builds all five courses, nine holes each
   -------------------------------------------------------------------------
   Holes are DATA, produced deterministically from (courseId, holeNumber).
   The server and every client run this and get byte-identical geometry, so
   nothing about the course ever has to travel over the wire — just the seed.

   Hole 1 of the parkland course is the hand-authored map this project started
   from, converted from its original 1400x1820 top-down units into metres and
   kept faithful: same dogleg, same pond positions, same greenside bunker.
   ========================================================================= */

import { rngKit, hashSeed, clamp, lerp, toYards } from './rng.js';
import { BIOMES, COURSE_ORDER, HOLES_PER_COURSE } from './biomes.js';

/* Standard 9-hole par mix — two 3s, two 5s, five 4s = par 36. */
const PAR_SETS = [
  [4, 5, 3, 4, 4, 3, 5, 4, 4],
  [4, 3, 5, 4, 4, 3, 4, 5, 4],
  [5, 4, 3, 4, 5, 3, 4, 4, 4],
  [4, 4, 3, 5, 4, 4, 3, 4, 5],
  [3, 4, 5, 4, 3, 4, 4, 5, 4]
];

/* Playing length in metres by par. */
const LENGTH_BY_PAR = {
  3: [125, 195],
  4: [290, 415],
  5: [450, 540]
};

/* ---------------------------------------------------------------- route --- */
/**
 * The shapes a golf hole comes in.
 *
 * Each entry returns the TURN RATE along the hole as a function of t (0 at the
 * tee, 1 at the green), which the router integrates into a heading.  Working
 * in turn rate rather than absolute angle is what makes the shapes distinct:
 * a dogleg is a burst of turning in one place, a sweep is a constant trickle,
 * an S-curve changes sign.  The old router had a single sin() profile scaled
 * by a gaussian, which meant most holes came out very nearly straight — the
 * reason every hole looked the same.
 *
 * `amount` is the total heading change in radians; positive bends right.
 */
const HOLE_SHAPES = {
  // The "straight" hole, which on a real course still drifts: a ruler-straight
  // corridor is exactly what made every hole look identical, so even this one
  // leans gently one way over its length.
  straight: (rk, amount) => t => amount * Math.sin(Math.PI * t) * 1.57,

  // one decisive corner: nothing, then a hard turn, then nothing
  dogleg: (rk, amount) => {
    const at = rk.f(0.36, 0.62);                 // where the corner sits
    const w = rk.f(0.13, 0.2);                   // how abruptly it turns
    return t => amount * Math.exp(-(((t - at) / w) ** 2)) / (w * Math.sqrt(Math.PI));
  },

  // a long continuous arc — the whole hole is the curve
  sweep: (rk, amount) => t => amount * (1 + 0.6 * Math.sin(Math.PI * t)) / 1.38,

  // out one way, back the other: the classic snake
  s_curve: (rk, amount) => {
    const at1 = rk.f(0.22, 0.34), at2 = rk.f(0.62, 0.78);
    const w = rk.f(0.11, 0.16);
    const back = rk.f(0.75, 1.15);               // rarely a perfect mirror
    const g = (t, c) => Math.exp(-(((t - c) / w) ** 2)) / (w * Math.sqrt(Math.PI));
    return t => amount * g(t, at1) - amount * back * g(t, at2);
  },

  // straight off the tee, then bends late — the green hides round the corner
  late_bend: (rk, amount) => {
    const at = rk.f(0.66, 0.8), w = rk.f(0.1, 0.15);
    return t => amount * Math.exp(-(((t - at) / w) ** 2)) / (w * Math.sqrt(Math.PI));
  },

  // bends immediately off the tee, then runs dead straight to the green
  early_bend: (rk, amount) => {
    const at = rk.f(0.16, 0.28), w = rk.f(0.1, 0.15);
    return t => amount * Math.exp(-(((t - at) / w) ** 2)) / (w * Math.sqrt(Math.PI));
  }
};

/* How likely each shape is, by par.  Par 3s are mostly straight because you
   are hitting at the green from the tee — but a slight angle is fair game. */
const SHAPE_ODDS = {
  3: [['straight', 6], ['sweep', 2], ['early_bend', 1]],
  4: [['dogleg', 5], ['sweep', 3], ['late_bend', 3], ['early_bend', 2], ['s_curve', 2], ['straight', 1]],
  5: [['dogleg', 4], ['s_curve', 4], ['sweep', 3], ['late_bend', 2], ['early_bend', 2]]
};

/** How much a hole of this shape and par turns, in radians. */
function bendAmount(rk, shape, par) {
  const sign = rk.bool(0.5) ? 1 : -1;
  // A dogleg you can see round is not a dogleg.  These are deliberately
  // BIG — 30 to 75 degrees — because the old holes bent by barely 15 and
  // read as straight lines from the tee.  A sweep needs even more, since it
  // spends its turn over the whole hole rather than in one corner.
  const base = shape === 'straight' ? rk.f(0.12, 0.28)
    : shape === 'sweep' ? rk.f(0.8, 1.5)
      : shape === 's_curve' ? rk.f(0.6, 1.15)
        : rk.f(0.62, 1.32);
  return sign * base * (par === 5 ? 1.0 : par === 4 ? 0.92 : 0.5);
}

/**
 * Lay out the centreline of a hole: start at the origin heading up +Z, then
 * walk `length` metres, turning at the rate this hole's shape asks for.
 */
function buildRoute(rk, lengthM, par) {
  const odds = SHAPE_ODDS[par] || SHAPE_ODDS[4];
  const total = odds.reduce((a, o) => a + o[1], 0);
  let roll = rk.f(0, total), shape = odds[0][0];
  for (const [name, w] of odds) { roll -= w; if (roll <= 0) { shape = name; break; } }

  const amount = bendAmount(rk, shape, par);
  const rate = HOLE_SHAPES[shape](rk, amount);

  // Integrate the turn rate finely, then keep every few samples as control
  // points: a corner needs enough points to actually round off.
  const STEPS = 48;
  const keep = par === 3 ? 6 : 4;
  const segLen = lengthM / STEPS;
  const pts = [[0, 0]];
  let x = 0, z = 0, heading = 0;                 // heading: radians, 0 = +Z
  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS;
    // the shape, plus a little wander so no hole is mechanically perfect
    heading += rate(t) / STEPS + rk.gauss() * 0.012;
    heading = clamp(heading, -1.45, 1.45);       // never fold back on itself
    x += Math.sin(heading) * segLen;
    z += Math.cos(heading) * segLen;
    if (i % keep === 0 || i === STEPS) pts.push([x, z]);
  }
  return { pts, bend: amount, heading, shape };
}

/** Resample a control polyline into a smooth, densely-sampled centreline. */
function smoothRoute(pts, step = 3) {
  // Catmull-Rom through the control points
  const P = i => pts[clamp(i, 0, pts.length - 1)];
  const dense = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(2, Math.ceil(segLen / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      dense.push([
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
      ]);
    }
  }
  dense.push(pts[pts.length - 1].slice());
  return dense;
}

/** Cumulative arc length + helpers for a dense polyline. */
export function routeMetrics(dense) {
  const cum = [0];
  for (let i = 1; i < dense.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  }
  return { cum, total: cum[cum.length - 1] };
}

/** Point on the centreline at arc-length s. */
export function routeAt(dense, cum, s) {
  const total = cum[cum.length - 1];
  s = clamp(s, 0, total);
  let lo = 0, hi = cum.length - 1;
  while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
  const f = (s - cum[lo]) / ((cum[hi] - cum[lo]) || 1);
  return [lerp(dense[lo][0], dense[hi][0], f), lerp(dense[lo][1], dense[hi][1], f)];
}

/** Unit tangent of the centreline at arc-length s. */
export function routeTangent(dense, cum, s) {
  const a = routeAt(dense, cum, Math.max(0, s - 2));
  const b = routeAt(dense, cum, Math.min(cum[cum.length - 1], s + 2));
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
}

/* ------------------------------------------------------------- features --- */

function placeBunkers(rk, bio, dense, cum, total, green, par) {
  const bunkers = [];
  const [lo, hi] = bio.bunkerCount;
  const n = rk.i(lo, hi);
  const pot = bio.bunkerStyle === 'pot';

  // 1–2 greenside bunkers, angled off the green
  const greensideCount = clamp(Math.round(n * 0.55), 1, 3);
  for (let i = 0; i < greensideCount; i++) {
    const a = rk.f(0, Math.PI * 2);
    const d = green.r * rk.f(1.15, 1.5);
    const rx = pot ? rk.f(3.2, 5.0) : rk.f(6, 11);
    const rz = pot ? rx * rk.f(0.8, 1.0) : rx * rk.f(0.55, 0.85);
    bunkers.push({
      x: green.x + Math.cos(a) * d,
      z: green.z + Math.sin(a) * d,
      rx, rz, rot: rk.f(0, Math.PI),
      depth: pot ? rk.f(1.6, 2.4) : rk.f(0.7, 1.3)
    });
  }

  // fairway bunkers in the landing zones
  for (let i = greensideCount; i < n; i++) {
    if (par === 3) break;
    const s = total * rk.f(0.28, 0.78);
    const p = routeAt(dense, cum, s);
    const t = routeTangent(dense, cum, s);
    const side = rk.sign();
    const off = rk.f(13, 22) * side;
    const rx = pot ? rk.f(3, 4.6) : rk.f(5.5, 9.5);
    bunkers.push({
      x: p[0] + (-t[1]) * off,
      z: p[1] + (t[0]) * off,
      rx, rz: rx * rk.f(0.5, 0.8), rot: Math.atan2(t[0], t[1]) + rk.f(-0.4, 0.4),
      depth: pot ? rk.f(1.5, 2.2) : rk.f(0.6, 1.1)
    });
  }
  return bunkers;
}

function placeWaters(rk, bio, dense, cum, total, green, tee, par) {
  const waters = [];
  if (!rk.bool(bio.waterChance)) return waters;

  const kind = bio.waterKind;
  const guardsGreen = rk.bool(0.5);

  /* Water is classified above every other surface, so a pond that reaches even
     slightly onto a green or tee would swallow it.  Push each one out far
     enough that its own footprint clears both, and drop it if it cannot fit. */
  const fits = (w) => {
    const reach = Math.max(w.rx, w.rz);
    if (Math.hypot(w.x - green.x, w.z - green.z) < green.r + reach + 2.5) return false;
    if (Math.hypot(w.x - tee.x, w.z - tee.z) < reach + 14) return false;
    return true;
  };

  if (guardsGreen) {
    const a = rk.f(0, Math.PI * 2);
    const rx = rk.f(16, 32), rz = rk.f(12, 26);
    const d = green.r + Math.max(rx, rz) + rk.f(4, 14);
    const w = {
      x: green.x + Math.cos(a) * d,
      z: green.z + Math.sin(a) * d,
      rx, rz, rot: rk.f(0, Math.PI), kind, depth: 2.4
    };
    if (fits(w)) waters.push(w);
  }
  if (par !== 3 && rk.bool(0.65)) {
    const s = total * rk.f(0.3, 0.72);
    const p = routeAt(dense, cum, s);
    const t = routeTangent(dense, cum, s);
    const side = rk.sign();
    const rx = rk.f(18, 38), rz = rk.f(14, 30);
    const off = (rk.f(24, 40) + Math.max(rx, rz) * 0.35) * side;
    const w = {
      x: p[0] + (-t[1]) * off,
      z: p[1] + (t[0]) * off,
      rx, rz, rot: rk.f(0, Math.PI), kind, depth: 2.4
    };
    if (fits(w)) waters.push(w);
  }
  return waters;
}

function placeTrees(rk, bio, dense, cum, total, green, tee, bunkers, waters, fairwayWidth, bounds, dist2route) {
  const trees = [];
  if (bio.treeDensity <= 0.001) return trees;

  const area = (bounds.maxX - bounds.minX) * (bounds.maxZ - bounds.minZ);
  const target = Math.round((area / 900) * bio.treeDensity);
  const corridor = fairwayWidth / 2 + bio.roughWidth * 0.55;

  let guard = 0;
  while (trees.length < target && guard < target * 25) {
    guard++;
    const x = rk.f(bounds.minX, bounds.maxX);
    const z = rk.f(bounds.minZ, bounds.maxZ);

    // never inside the playing corridor, the green complex, a hazard or the tee
    const dr = dist2route(x, z);
    if (dr < corridor) continue;
    if (Math.hypot(x - green.x, z - green.z) < green.r + 9) continue;
    if (Math.hypot(x - tee.x, z - tee.z) < 14) continue;
    let blocked = false;
    for (const b of bunkers) if (inEllipse(x, z, b, 4)) { blocked = true; break; }
    if (blocked) continue;
    for (const w of waters) if (inEllipse(x, z, w, 4)) { blocked = true; break; }
    if (blocked) continue;

    // thin out very close to the corridor so the treeline reads as an edge
    const edge = clamp((dr - corridor) / 18, 0, 1);
    if (rk.raw() > 0.25 + 0.75 * edge) continue;

    const species = rk.pick(bio.treeSpecies);
    const h = rk.f(bio.treeHeight[0], bio.treeHeight[1]);
    trees.push({
      x, z, species,
      h,
      r: h * (species === 'palm' ? 0.20 : species === 'gorse' ? 0.75 : species === 'saguaro' ? 0.12 : 0.34),
      rot: rk.f(0, Math.PI * 2),
      tone: rk.f(0, 1)
    });
  }
  return trees;
}

export function inEllipse(x, z, e, pad = 0) {
  let dx = x - e.x, dz = z - e.z;
  if (e.rot) {
    const c = Math.cos(-e.rot), s = Math.sin(-e.rot);
    const rx = dx * c - dz * s, rz = dx * s + dz * c;
    dx = rx; dz = rz;
  }
  const a = e.rx + pad, b = e.rz + pad;
  return (dx * dx) / (a * a) + (dz * dz) / (b * b) <= 1;
}

/* --------------------------------------------------------------- a hole --- */

function makeHole(courseId, bio, number, seed) {
  const rk = rngKit(seed);
  const parSet = PAR_SETS[hashSeed(courseId) % PAR_SETS.length];
  const par = parSet[number - 1];
  const [lmin, lmax] = LENGTH_BY_PAR[par];
  const lengthM = rk.f(lmin, lmax);

  const { pts, shape } = buildRoute(rk, lengthM, par);
  const dense = smoothRoute(pts, 3);
  const { cum, total } = routeMetrics(dense);

  const fairwayWidth = rk.f(bio.fairwayWidth[0], bio.fairwayWidth[1]);
  const greenR = rk.f(bio.greenSize[0], bio.greenSize[1]);

  const end = dense[dense.length - 1];
  const endT = routeTangent(dense, cum, total);
  const green = {
    x: end[0], z: end[1],
    r: greenR,
    rx: greenR, rz: greenR * rk.f(0.78, 1.0),
    rot: Math.atan2(endT[0], endT[1]) + rk.f(-0.5, 0.5)
  };

  const tees = buildTees(dense, cum, total);
  const tee = tees.back;

  // pin somewhere sensible on the green, not right on the edge
  const pinA = rk.f(0, Math.PI * 2), pinD = greenR * rk.f(0, 0.5);
  const pin = { x: green.x + Math.cos(pinA) * pinD, z: green.z + Math.sin(pinA) * pinD };

  const bunkers = placeBunkers(rk, bio, dense, cum, total, green, par);
  const waters = placeWaters(rk, bio, dense, cum, total, green, tee, par);

  // bounds: everything the hole occupies plus a margin of scenery
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of dense) {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]);
  }
  const margin = 78;
  const bounds = { minX: minX - margin, maxX: maxX + margin, minZ: minZ - margin, maxZ: maxZ + margin };

  // out of bounds sits a little inside the scenery margin
  const obInset = 26;
  const ob = {
    minX: bounds.minX + obInset, maxX: bounds.maxX - obInset,
    minZ: bounds.minZ + obInset, maxZ: bounds.maxZ - obInset
  };

  const hole = {
    courseId, number, par, shape,
    lengthM: total,
    yards: Math.round(toYards(total)),
    seed,
    route: dense, cum, total,
    fairwayWidth,
    roughWidth: bio.roughWidth,
    tee, tees, teeYards: teeYardage(tees, total),
    green, pin,
    cup: { x: pin.x, z: pin.z, r: 0.108 },     // a real hole is 108 mm across
    bunkers, waters,
    bounds, ob,
    trees: [],
    // terrain shaping
    terrainSeed: (seed ^ 0x5f3a7c1) >>> 0,
    elevProfile: buildElevProfile(rk, bio, total),
    greenTilt: { ax: rk.gauss() * 0.028, az: rk.gauss() * 0.028 },
    maxStrokes: par + 6
  };

  const dist2route = makeRouteDistanceFn(hole);
  hole.trees = placeTrees(rk, bio, dense, cum, total, green, tee, bunkers, waters, fairwayWidth, bounds, dist2route);
  hole.name = describeHole(hole, rk);
  return hole;
}

/**
 * Three sets of tees, cut back along the centreline.  Playing the forward tees
 * takes roughly a sixth off the hole, which is exactly what they are for.
 */
const TEE_SETS = { back: 0, regular: 0.08, forward: 0.17 };
function buildTees(dense, cum, total) {
  const out = {};
  for (const [name, frac] of Object.entries(TEE_SETS)) {
    const s = total * frac;
    const p = routeAt(dense, cum, s);
    const t = routeTangent(dense, cum, s);
    out[name] = { x: p[0], z: p[1], w: 9, d: 7, rot: Math.atan2(t[0], t[1]), s };
  }
  return out;
}
function teeYardage(tees, total) {
  const out = {};
  for (const [name, t] of Object.entries(tees)) out[name] = Math.round(toYards(total - t.s));
  return out;
}

/** Gentle along-the-hole elevation change: uphill, downhill or a valley. */
function buildElevProfile(rk, bio, total) {
  const bias = (bio.slopeBias || 1);
  const drop = rk.gauss() * 6 * bias;                  // net rise/fall in metres
  const midBump = rk.gauss() * 4 * bias;
  return { drop, midBump, total };
}

export function elevationAlongRoute(hole, s) {
  const { drop, midBump, total } = hole.elevProfile;
  const t = clamp(s / (total || 1), 0, 1);
  return drop * t + midBump * Math.sin(Math.PI * t);
}

function describeHole(hole, rk) {
  const { par } = hole;
  const dog = hole.route.length > 2 ? bendOf(hole) : 0;
  const names = [];
  if (Math.abs(dog) > 0.34) names.push(dog > 0 ? 'Dogleg Right' : 'Dogleg Left');
  else names.push(par === 3 ? 'The Short' : 'Straightaway');
  if (hole.waters.length >= 2) names.push('Double Cross');
  else if (hole.waters.length === 1) names.push('Watermark');
  if (hole.bunkers.length >= 6) names.push('The Sandbox');
  return rk.pick(names);
}

function bendOf(hole) {
  const d = hole.route;
  const a = routeTangent(d, hole.cum, 0);
  const b = routeTangent(d, hole.cum, hole.total);
  return Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]) * -1;
}

/* --------------------------------------------- fast distance-to-centreline --- */
/**
 * A uniform grid over the hole that stores which centreline samples fall in
 * each cell, so "how far am I from the fairway middle" is O(few) instead of
 * O(route length).  Physics calls this constantly.
 */
export function makeRouteDistanceFn(hole) {
  const CELL = 24;
  const { bounds, route } = hole;
  const gw = Math.ceil((bounds.maxX - bounds.minX) / CELL) + 1;
  const gh = Math.ceil((bounds.maxZ - bounds.minZ) / CELL) + 1;
  const grid = new Array(gw * gh);

  for (let i = 0; i < route.length; i++) {
    const cx = Math.floor((route[i][0] - bounds.minX) / CELL);
    const cz = Math.floor((route[i][1] - bounds.minZ) / CELL);
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const gx = cx + dx, gz = cz + dz;
      if (gx < 0 || gz < 0 || gx >= gw || gz >= gh) continue;
      const k = gz * gw + gx;
      (grid[k] || (grid[k] = [])).push(i);
    }
  }

  return function dist2route(x, z, wantS = false) {
    const cx = clamp(Math.floor((x - bounds.minX) / CELL), 0, gw - 1);
    const cz = clamp(Math.floor((z - bounds.minZ) / CELL), 0, gh - 1);
    const list = grid[cz * gw + cx];
    let best = Infinity, bestS = 0;
    if (list) {
      for (let k = 0; k < list.length; k++) {
        const i = list[k];
        const p = route[i];
        const d = (p[0] - x) * (p[0] - x) + (p[1] - z) * (p[1] - z);
        if (d < best) { best = d; bestS = hole.cum[i]; }
      }
    } else {
      // outside the indexed band — coarse scan, only happens far off the hole
      for (let i = 0; i < route.length; i += 4) {
        const p = route[i];
        const d = (p[0] - x) * (p[0] - x) + (p[1] - z) * (p[1] - z);
        if (d < best) { best = d; bestS = hole.cum[i]; }
      }
    }
    const dd = Math.sqrt(best);
    return wantS ? { d: dd, s: bestS } : dd;
  };
}

/* -------------------------------------------------------------- courses --- */

export function buildCourse(courseId) {
  const bio = BIOMES[courseId];
  if (!bio) throw new Error('Unknown course: ' + courseId);
  const holes = [];
  for (let n = 1; n <= HOLES_PER_COURSE; n++) {
    holes.push(makeHole(courseId, bio, n, hashSeed(courseId, n, 0x9e37)));
  }
  // hole 1 of the parkland course is the original hand-drawn map
  if (courseId === 'parkland') holes[0] = makeSignatureHole(bio);

  const par = holes.reduce((s, h) => s + h.par, 0);
  const yards = holes.reduce((s, h) => s + h.yards, 0);
  return { id: courseId, name: bio.name, blurb: bio.blurb, region: bio.region, biome: bio, holes, par, yards };
}

let _cache = null;
export function allCourses() {
  if (!_cache) _cache = COURSE_ORDER.map(buildCourse);
  return _cache;
}
export function getCourse(id) {
  return allCourses().find(c => c.id === id) || allCourses()[0];
}
export function getHole(courseId, index) {
  const c = getCourse(courseId);
  return c.holes[clamp(index, 0, c.holes.length - 1)];
}

/* ------------------------------------------------- the signature opener --- */
/**
 * Hole 1 of Claude National, converted from the original top-down map.
 * The map was 1400x1820 units for a 541-yard hole, i.e. ~4.09 units/metre;
 * every feature below is the original coordinate divided by that and re-based
 * so the tee sits at the origin facing up +Z.
 */
function makeSignatureHole(bio) {
  const U = 4.086;                                  // original units per metre
  const OX = 338, OZ = 475;                         // original tee position
  const cv = (ux, uz) => [(ux - OX) / U, (uz - OZ) / U];

  const ctrl = [
    [338, 475], [316, 466], [300, 558], [356, 820], [470, 1086],
    [642, 1238], [816, 1176], [886, 974], [906, 770], [950, 566],
    [1016, 442], [1092, 372], [1150, 352]
  ].map(p => cv(p[0], p[1]));

  const dense = smoothRoute(ctrl, 3);
  const { cum, total } = routeMetrics(dense);
  const rk = rngKit(hashSeed('parkland', 1, 0xA11CE));

  const g = cv(1140, 372);
  const green = { x: g[0], z: g[1], r: 118 / U, rx: 118 / U, rz: (118 * 0.92) / U, rot: 0 };
  const p = cv(1150, 352);
  const pin = { x: p[0], z: p[1] };

  const b = cv(1002, 398);
  const bunkers = [{ x: b[0], z: b[1], rx: 98 / U, rz: 66 / U, rot: -0.2, depth: 1.1 }];

  const w1 = cv(576, 558), w2 = cv(1246, 812);
  const waters = [
    { x: w1[0], z: w1[1], rx: 150 / U, rz: 112 / U, rot: 0, kind: 'pond', depth: 2.4 },
    { x: w2[0], z: w2[1], rx: 120 / U, rz: 252 / U, rot: 0, kind: 'pond', depth: 2.4 }
  ];

  const tees = buildTees(dense, cum, total);
  const tee = tees.back;

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const q of dense) {
    minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]);
    minZ = Math.min(minZ, q[1]); maxZ = Math.max(maxZ, q[1]);
  }
  const margin = 78;
  const bounds = { minX: minX - margin, maxX: maxX + margin, minZ: minZ - margin, maxZ: maxZ + margin };
  const ob = { minX: bounds.minX + 26, maxX: bounds.maxX - 26, minZ: bounds.minZ + 26, maxZ: bounds.maxZ - 26 };

  const hole = {
    courseId: 'parkland', number: 1, par: 5,
    lengthM: total, yards: 541,
    seed: hashSeed('parkland', 1, 0xA11CE),
    route: dense, cum, total,
    fairwayWidth: 176 / U,                         // the original 176-unit corridor
    roughWidth: bio.roughWidth,
    tee, tees, teeYards: teeYardage(tees, total),
    green, pin,
    cup: { x: pin.x, z: pin.z, r: 0.108 },
    bunkers, waters,
    bounds, ob,
    trees: [],
    terrainSeed: 0x51a7c33d >>> 0,
    elevProfile: { drop: -2.5, midBump: 3.0, total },
    greenTilt: { ax: 0.02, az: -0.016 },
    maxStrokes: 11,
    name: 'Dogleg Right',
    signature: true
  };

  // the original tree masses, converted the same way
  const clusters = [
    { x: 296, z: 812, rx: 250, rz: 330, n: 46 },
    { x: 250, z: 556, rx: 168, rz: 170, n: 14 },
    { x: 726, z: 906, rx: 266, rz: 300, n: 48 },
    { x: 1086, z: 706, rx: 150, rz: 262, n: 22 },
    { x: 520, z: 1410, rx: 330, rz: 180, n: 26 },
    { x: 1120, z: 560, rx: 120, rz: 120, n: 10 },
    // The sentinels.  The dogleg used to be cuttable — 201 m straight at the
    // pin on a 500 m par 5 — so two walls of towering oaks now stand on the
    // inside of the corner, tall enough to catch a driver while it is still
    // climbing.  Play the hole the way it bends.
    { x: 560, z: 436, rx: 160, rz: 200, n: 24, tall: [15, 23] },
    { x: 742, z: 410, rx: 170, rz: 210, n: 26, tall: [14, 21] }
  ];
  const dist2route = makeRouteDistanceFn(hole);
  const corridor = hole.fairwayWidth / 2 + 8;
  for (const cl of clusters) {
    const c = cv(cl.x, cl.z);
    let placed = 0, guard = 0;
    while (placed < cl.n && guard < cl.n * 40) {
      guard++;
      const a = rk.f(0, Math.PI * 2), rr = Math.sqrt(rk.raw());
      const x = c[0] + Math.cos(a) * (cl.rx / U) * rr;
      const z = c[1] + Math.sin(a) * (cl.rz / U) * rr;
      if (x < bounds.minX + 6 || x > bounds.maxX - 6 || z < bounds.minZ + 6 || z > bounds.maxZ - 6) continue;
      if (dist2route(x, z) < corridor) continue;
      if (Math.hypot(x - green.x, z - green.z) < green.r + 8) continue;
      if (Math.hypot(x - tee.x, z - tee.z) < 17) continue;
      let bad = false;
      for (const bb of bunkers) if (inEllipse(x, z, bb, 6)) { bad = true; break; }
      if (bad) continue;
      for (const ww of waters) if (inEllipse(x, z, ww, 6)) { bad = true; break; }
      if (bad) continue;
      const species = rk.pick(bio.treeSpecies);
      // 'tall' clusters are old growth: two to three times the normal canopy
      const h = cl.tall ? rk.f(cl.tall[0], cl.tall[1]) : rk.f(bio.treeHeight[0], bio.treeHeight[1]);
      hole.trees.push({ x, z, species, h, r: h * 0.34, rot: rk.f(0, Math.PI * 2), tone: rk.f(0, 1) });
      placed++;
    }
  }
  return hole;
}
