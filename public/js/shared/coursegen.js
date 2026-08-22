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
import { BIOMES, COURSE_ORDER, HOLES_PER_COURSE, crownOf } from './biomes.js';
import { realCourse } from './realcourses.js';
import { placeProps } from './props.js';

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

  /* 1–2 greenside bunkers, angled off the green — unless the biome asked
     for none at all. The floor used to be a hard 1, so a course configured
     with `bunkerCount: [0, 2]` still got a greenside bunker on every single
     hole and could never come in under nine: the beginners' course was
     built with more sand than the reference nine has, which is the opposite
     of what its config said. A zero roll now means zero. */
  const greensideCount = n > 0 ? clamp(Math.round(n * 0.55), 1, 3) : 0;
  for (let i = 0; i < greensideCount; i++) {
    const a = rk.f(0, Math.PI * 2);
    const d = green.r * rk.f(1.15, 1.5);
    const rx = pot ? rk.f(3.2, 5.0) : rk.f(6, 11);
    const rz = pot ? rx * rk.f(0.8, 1.0) : rx * rk.f(0.55, 0.85);
    bunkers.push({
      x: green.x + Math.cos(a) * d,
      z: green.z + Math.sin(a) * d,
      rx, rz, rot: rk.f(0, Math.PI),
      // sand takes a much stronger wobble than grass — a bunker is a torn
      // edge, and a smooth oval of sand is the other thing that reads as a
      // sticker rather than a hazard
      wob: [rk.f(0.10, 0.22), rk.f(0, 6.283), rk.f(0.05, 0.12), rk.f(0, 6.283)],
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
      wob: [rk.f(0.10, 0.22), rk.f(0, 6.283), rk.f(0.05, 0.12), rk.f(0, 6.283)],
      depth: pot ? rk.f(1.5, 2.2) : rk.f(0.6, 1.1)
    });
  }
  return bunkers;
}

function placeWaters(rk, bio, dense, cum, total, green, tee, par, ob) {
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

  /* The OB check happens AFTER fits(), and shrinks rather than rejects. A
     candidate this far out is usually only barely over the line — dropping
     the whole hazard for that would quietly de-fang whichever hole rolled
     it (and, in aggregate, soften every course's slope rating below what it
     should be), when shrinking it to the room actually available fixes the
     same bug without losing the hazard. Shrinking never moves the centre,
     so a candidate that already cleared the green/tee check above can only
     move further from them, never closer — see clipWatersToBounds for the
     full argument. Only a candidate that would shrink to a token puddle is
     dropped outright. */
  const clampToOb = (w) => {
    if (!ob) return w;
    const roomX = Math.min(w.x - ob.minX, ob.maxX - w.x);
    const roomZ = Math.min(w.z - ob.minZ, ob.maxZ - w.z);
    const c = Math.abs(Math.cos(w.rot || 0)), s = Math.abs(Math.sin(w.rot || 0));
    const hx = w.rx * c + w.rz * s, hz = w.rx * s + w.rz * c;
    if (hx <= roomX && hz <= roomZ) return w;
    const scale = Math.min(roomX / hx, roomZ / hz);
    if (scale < 0.35) return null;             // not worth keeping as water
    return { ...w, rx: w.rx * scale, rz: w.rz * scale };
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
    if (fits(w)) { const c = clampToOb(w); if (c) waters.push(c); }
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
    if (fits(w)) { const c = clampToOb(w); if (c) waters.push(c); }
  }
  return waters;
}

/* Water is classified above every other surface a ball can be on, so if a
   hazard's footprint reaches past the hole's own out-of-bounds line, a
   player standing on dry fairway just inside that line can be sitting
   inside an invisible water volume with no water anywhere near what they
   can see — which reads as "can't hit off some surfaces" (or the pond just
   visibly hangs off the edge of the world). Runs on both generated and
   hand-authored water, since the same invariant has to hold either way.

   SHRINKS ONLY, NEVER MOVES THE CENTRE. placeWaters() already rejects any
   candidate that lands too close to the green or tee at its ORIGINAL size;
   shrinking after that only increases the hazard's distance from them, so
   it can never turn a legal placement into water-on-the-green. Repositioning
   the centre instead — the first version of this did — can push a hazard
   the placement check had already kept clear of the green right back onto
   it, which is a worse bug than the one being fixed. */
function clipWatersToBounds(waters, ob) {
  for (const w of waters) {
    // room available on THIS hazard's own centre before either OB edge —
    // not the bounds' centre, which the hazard is rarely anywhere near
    const roomX = Math.min(w.x - ob.minX, ob.maxX - w.x);
    const roomZ = Math.min(w.z - ob.minZ, ob.maxZ - w.z);
    const c = Math.abs(Math.cos(w.rot || 0)), s = Math.abs(Math.sin(w.rot || 0));
    const hx = w.rx * c + w.rz * s, hz = w.rx * s + w.rz * c;
    if (hx > roomX || hz > roomZ) {
      const scale = Math.max(0.15, Math.min(roomX / hx, roomZ / hz, 1));
      w.rx *= scale; w.rz *= scale;
    }
  }
  return waters;
}

function placeTrees(rk, bio, dense, cum, total, green, tee, bunkers, waters, fairwayWidth, bounds, dist2route, props = []) {
  const trees = [];
  if (bio.treeDensity <= 0.001) return trees;

  const area = (bounds.maxX - bounds.minX) * (bounds.maxZ - bounds.minZ);
  /* One tree per 900 m² at full density was a wood you could see through in
     every direction. A parkland hole is supposed to feel ENCLOSED — that is
     the whole character of the place — and at that spacing the treeline read
     as a hedge with gaps. 460 m² doubles it, and the thinning band below
     still keeps the corridor itself clear, so this fills the country BEYOND
     the rough rather than crowding the golf. */
  const target = Math.round((area / 460) * bio.treeDensity);
  const corridor = fairwayWidth / 2 + bio.roughWidth * 0.55;

  let guard = 0;
  while (trees.length < target && guard < target * 22) {
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
    // nothing grows through a hut
    for (const pr of props) if (Math.hypot(x - pr.x, z - pr.z) < 6) { blocked = true; break; }
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
      r: h * crownOf(species),
      rot: rk.f(0, Math.PI * 2),
      tone: rk.f(0, 1)
    });
  }
  return trees;
}

/* =========================================================================
   BLOCKAGES — the fairway does not have to be clean
   -------------------------------------------------------------------------
   Every hole was a smooth graded corridor with the trouble pushed out to the
   sides. That is a driving range with a bend in it: aim down the middle, hit
   it, walk. The interest in a golf hole is what is IN FRONT of you, not what
   is beside you.

   Three things go in the corridor now:

     mounds     humps and hollows in the fairway itself. Terrain, not a
                penalty — a good drive that finishes on the downslope of a
                hump is still a good drive, it just has an awkward stance and
                a bad view of the green.
     cross      a bunker lying ACROSS the line rather than beside it, at a
                distance that asks a question off the tee: carry it, or lay
                up short of it and hit a longer second.
     sentinels  a tree, or two, standing in the corridor. Rare and always at
                the edges of a landing zone, never dead centre, and never
                where the default aim would send you into it (see defaultAim,
                which now steers around anything flagged `blocker`).

   Everything here stays clear of the tee apron, so no hole can be blocked
   from the tee, and clear of the green complex, so nothing sits between you
   and a putt. It is meant to be untidy, not unfair.
   ========================================================================= */

/**
 * Where along the hole it is safe to put something in the way — as fractions
 * of the hole's length, or null if there is nowhere.
 *
 * The near limit is measured from the FORWARD tee, not the back one. That is
 * the whole subtlety: the forward tees sit 17% up the hole, so a hump placed
 * "a comfortable 120 m from the tee" is fifty metres in front of a player
 * using them — inside the launch window, which is the one thing none of this
 * is allowed to do. Short par 3s come back with nowhere at all, and that is
 * the right answer for a 130 m hole rather than a reason to relax the rule.
 */
const CLEAR_OF_TEE = 130;      // metres, from the most forward tee
function blockZone(total, par) {
  const lo = TEE_SETS.forward + CLEAR_OF_TEE / total;
  const hi = par === 3 ? 0.6 : 0.82;
  return hi > lo + 0.03 ? [lo, hi] : null;
}

function placeMounds(rk, bio, dense, cum, total, green, par, fairwayWidth) {
  const mounds = [];
  const zone = blockZone(total, par);
  if (!zone) return mounds;                       // a short hole has no room
  const [lo, hi] = zone;

  /* Par 3s get at most one piece of shaping, since the only shot played over
     it is the tee shot and a blind par 3 is a gimmick rather than a hole. */
  const n = par === 3 ? rk.i(0, 1) : rk.i(1, 3);
  const halfW = fairwayWidth * 0.5;

  for (let i = 0; i < n; i++) {
    const s = total * rk.f(lo, hi);
    const p = routeAt(dense, cum, s);
    const t = routeTangent(dense, cum, s);
    if (Math.hypot(p[0] - green.x, p[1] - green.z) < green.r + 34) continue;

    /* Sideways offset is deliberately small — the point is that it is IN the
       fairway. A hump beside the fairway is just terrain. */
    const off = rk.f(-0.55, 0.55) * halfW;
    const hollow = rk.bool(0.3);

    /* Long axis usually runs across the hole, so it reads as a step in the
       ground you have to cross rather than a lump you walk round. */
    const along = rk.f(9, 17);
    const across = along * rk.f(1.1, 2.2);
    const rot = Math.atan2(t[0], t[1]) + rk.f(-0.5, 0.5);

    /* Height is tied to the SHORT axis, not chosen freely, because the thing
       that decides whether this is character or a wall is the gradient, not
       the height. terrain.js caps the mound with a cosine, whose steepest
       face is h·pi/(2r) — so a fixed fraction of the short radius is a fixed
       grade. 0.10 to 0.17 works out at 16-27%: enough that a running ball
       kicks off it and a stance on it is awkward, gentle enough to walk up
       and to fly over without noticing. A fixed three metres would have been
       a 50% face on the small ones. */
    const grade = hollow ? rk.f(0.08, 0.13) : rk.f(0.10, 0.17);
    mounds.push({
      x: p[0] + (-t[1]) * off,
      z: p[1] + (t[0]) * off,
      rx: across, rz: along, rot,
      h: (hollow ? -1 : 1) * grade * Math.min(along, across)
    });
  }
  return mounds;
}

/**
 * A cross bunker: sand lying across the line, not beside it. The distance is
 * the whole point — it has to sit where a tee shot lands, or it is scenery.
 */
function placeCrossBunker(rk, bio, dense, cum, total, green, par, fairwayWidth) {
  if (par === 3) return null;                     // nothing to carry on a one-shotter
  if (!rk.bool(0.42)) return null;
  const zone = blockZone(total, par);
  if (!zone) return null;
  const [lo, hi] = zone;
  // 210-250 m is a driver for a good player; on a par 5 the second landing
  // zone is the interesting one, so aim further out.
  const want = par === 5 ? rk.f(0.42, 0.62) : rk.f(0.34, 0.52);
  const s = total * clamp(want, lo, hi);
  const p = routeAt(dense, cum, s);
  const t = routeTangent(dense, cum, s);
  if (Math.hypot(p[0] - green.x, p[1] - green.z) < green.r + 40) return null;

  const halfW = fairwayWidth * 0.5;
  return {
    // offset a little so there is always a way round for someone laying up
    x: p[0] + (-t[1]) * rk.f(-0.4, 0.4) * halfW,
    z: p[1] + (t[0]) * rk.f(-0.4, 0.4) * halfW,
    rx: halfW * rk.f(0.75, 1.05),                 // wide across the corridor
    rz: rk.f(4.5, 8),                             // shallow along it
    rot: Math.atan2(t[0], t[1]) + Math.PI / 2 + rk.f(-0.25, 0.25),
    wob: [rk.f(0.10, 0.22), rk.f(0, 6.283), rk.f(0.05, 0.12), rk.f(0, 6.283)],
    depth: bio.bunkerStyle === 'pot' ? rk.f(1.5, 2.2) : rk.f(0.8, 1.4),
    cross: true
  };
}

/**
 * Sentinel trees: standing IN the corridor. One or two, at the edge of a
 * landing zone, so the fairway has a shape you have to respect rather than a
 * width you can ignore.
 */
function placeSentinels(rk, bio, dense, cum, total, green, par, fairwayWidth) {
  const out = [];
  if (bio.treeDensity <= 0.001) return out;       // a desert has no sentinels
  const zone = blockZone(total, par);
  if (!zone) return out;
  const [lo, hi] = zone;
  const n = par === 3 ? 0 : rk.bool(0.5) ? rk.i(1, 2) : 0;
  const halfW = fairwayWidth * 0.5;

  /* A sentinel has to be a TREE. Picking freely from the biome's species
     let the sandbelt plant a "gorse" — a shrub whose crown is 0.70 of its
     height, because on a links it is a knee-high bush — at the sandbelt's
     tree height of 22 m. That is a gorse bush with a FIFTEEN METRE radius
     standing in the fairway, and it blocked every line down the hole. */
  const woody = bio.treeSpecies.filter(sp => crownOf(sp) <= 0.35);
  if (!woody.length) return out;

  for (let i = 0; i < n; i++) {
    const s = total * rk.f(lo, hi);
    const p = routeAt(dense, cum, s);
    const t = routeTangent(dense, cum, s);
    if (Math.hypot(p[0] - green.x, p[1] - green.z) < green.r + 45) continue;
    /* Never dead centre: 45-80% of the way to the edge. There is always a
       side of it to play down, which is the difference between a hazard and
       a roadblock. */
    const off = rk.sign() * rk.f(0.45, 0.8) * halfW;
    const species = rk.pick(woody);
    const h = rk.f(bio.treeHeight[1] * 0.9, bio.treeHeight[1] * 1.45);
    out.push({
      x: p[0] + (-t[1]) * off,
      z: p[1] + (t[0]) * off,
      species, h,
      // never wider than a third of the fairway, whatever the species says
      r: Math.min(h * crownOf(species), halfW * 0.66),
      rot: rk.f(0, Math.PI * 2), tone: rk.f(0, 1),
      blocker: true            // defaultAim steers around these
    });
  }
  return out;
}

/**
 * How far out the edge sits at this bearing, as a multiplier on the radius.
 *
 * A green and a bunker were perfect ellipses, and a perfect ellipse is the
 * one shape that never occurs on a golf course. Rendered at size it reads as
 * a disc stamped into the grass — which is exactly what the greens looked
 * like, and it is the single most-looked-at object in the game.
 *
 * `wob` is two harmonics chosen when the hole is generated. Three and five
 * lobes rather than two and four: an even count makes a symmetrical shape,
 * which still looks manufactured. Odd counts read as a thing somebody mowed.
 *
 * THIS IS THE ONLY DEFINITION. The physics test, the terrain carve and the
 * painted texture all call it, because a green whose picture and whose edge
 * disagree is the tree-canopy bug again: the ball would break for the fringe
 * a metre before the fringe you can see.
 */
export function edgeScale(e, dx, dz) {
  const w = e.wob;
  if (!w) return 1;
  const th = Math.atan2(dz, dx);
  /* Always <= 1: the edge only ever cuts IN, never bulges out.
     The first version was `1 + a·cos(...)`, which averages one but peaks
     well above it — a bunker could reach a third further than the radius it
     declares. Everything that keeps hazards away from tees and greens is
     computed from rx and rz, so a shape allowed to exceed them silently
     invalidates every one of those clearances at once: the aim test found a
     tee shot flying into a bunker that had grown into the launch window, and
     the green had swollen past the fringe it is measured against.

     Cutting inward can never do that. The declared ellipse stays the outer
     bound of the shape and every existing keep-out remains true. */
  const a = (1 + Math.cos(3 * th + w[1])) * 0.5;
  const b = (1 + Math.cos(5 * th + w[3])) * 0.5;
  return 1 - w[0] * a - w[2] * b;
}

/** Local (rotated) offset from an ellipse's centre. Shared by every test. */
export function localOffset(x, z, e) {
  let dx = x - e.x, dz = z - e.z;
  if (e.rot) {
    const c = Math.cos(-e.rot), s = Math.sin(-e.rot);
    const rx = dx * c - dz * s, rz = dx * s + dz * c;
    dx = rx; dz = rz;
  }
  return [dx, dz];
}

export function inEllipse(x, z, e, pad = 0) {
  const [dx, dz] = localOffset(x, z, e);
  const k = edgeScale(e, dx, dz);
  const a = e.rx * k + pad, b = e.rz * k + pad;
  return (dx * dx) / (a * a) + (dz * dz) / (b * b) <= 1;
}

/* --------------------------------------------------------------- a hole --- */

/**
 * One hole.
 *
 * @param authored  real geometry for this hole, from an imported course —
 *   `{ par, route: [[x,z]...], greenR?, bunkers?, waters?, fairwayWidth? }`
 *   in metres, already in local coordinates. When present it REPLACES the
 *   generated routing and hazards; everything else — terrain, trees, props,
 *   elevation, the cup, out of bounds — is derived exactly as it is for a
 *   generated hole, so an imported course plays by identical rules and needs
 *   no second code path anywhere downstream.
 */
function makeHole(courseId, bio, number, seed, authored = null, courseState = null) {
  const rk = rngKit(seed);
  const parSet = PAR_SETS[hashSeed(courseId) % PAR_SETS.length];
  const par = authored?.par ?? parSet[number - 1];
  const [lmin, lmax] = LENGTH_BY_PAR[par];
  /* A course can be longer or shorter than the standard card. Hole length
     was a single global table, so every course on the roster played to the
     same yardage band whatever it was meant to be — a beginners' meadow and
     a championship headland were dealt identical holes and could only
     differ in what was beside them. Optional, and 1 is exactly the old
     behaviour, so no existing course moves. */
  const ls = bio.lengthScale ?? 1;
  const lengthM = rk.f(lmin * ls, lmax * ls);

  /* A real routing is already the shape it is: smoothed once to take the
     corners off a hand-traced polyline, not three times like a generated
     one, which would round a genuine dogleg into a curve. */
  const gen = authored ? null : buildRoute(rk, lengthM, par);
  const shape = authored ? (authored.shape || 'imported') : gen.shape;
  const dense = authored ? smoothRoute(authored.route, 1) : smoothRoute(gen.pts, 3);
  const { cum, total } = routeMetrics(dense);

  // bounds: everything the hole occupies plus a margin of scenery. Computed
  // here, before anything gets placed inside them, so placement itself can
  // reject a candidate that would cross the line rather than needing to be
  // corrected afterward — the bounds depend only on the route, never on
  // what ends up placed within it.
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

  const fairwayWidth = authored?.fairwayWidth
    ?? rk.f(bio.fairwayWidth[0], bio.fairwayWidth[1]);
  /* The edge wobble only ever cuts inward (see edgeScale), so a green built
     to the biome's radius comes out about 6% smaller in area than the number
     says. Sized back up, or every green in the game quietly got harder to
     hit and harder to putt on. */
  const greenR = (authored?.greenR ?? rk.f(bio.greenSize[0], bio.greenSize[1])) * 1.06;

  const end = dense[dense.length - 1];
  const endT = routeTangent(dense, cum, total);
  const green = {
    x: end[0], z: end[1],
    r: greenR,
    rx: greenR, rz: greenR * rk.f(0.78, 1.0),
    rot: Math.atan2(endT[0], endT[1]) + rk.f(-0.5, 0.5),
    // gentle on a green — you still have to be able to read a putt on it
    wob: [rk.f(0.05, 0.11), rk.f(0, 6.283), rk.f(0.02, 0.05), rk.f(0, 6.283)]
  };

  const tees = buildTees(dense, cum, total);
  const tee = tees.back;

  // pin somewhere sensible on the green, not right on the edge
  const pinA = rk.f(0, Math.PI * 2), pinD = greenR * rk.f(0, 0.5);
  const pin = { x: green.x + Math.cos(pinA) * pinD, z: green.z + Math.sin(pinA) * pinD };

  /* Imported hazards are the real ones and are used exactly as surveyed —
     including a hole with none, which is why this checks for the ARRAY
     rather than for it being non-empty. A real course with no bunker on its
     third is not a course that wants two invented. */
  let bunkers, waters;
  if (authored?.bunkers) {
    bunkers = authored.bunkers.map(b => ({ wob: [0.12, 1.1, 0.07, 4.2], depth: 1.0, ...b }));
  } else {
    bunkers = placeBunkers(rk, bio, dense, cum, total, green, par);
    const cross = placeCrossBunker(rk, bio, dense, cum, total, green, par, fairwayWidth);
    if (cross) bunkers.push(cross);
  }
  if (authored?.waters) {
    waters = authored.waters.map(w => ({ kind: bio.waterKind, depth: 2.2, rot: 0, ...w }));
    // Authored water is surveyed data, not a candidate placeWaters can
    // reject — a real course doesn't get a pond removed because the
    // generator's OB margin is tight around it. Shrinking is the only safe
    // correction available here (see clipWatersToBounds for why it never
    // repositions), which is why authored water still needs this pass even
    // though generated water no longer does.
    clipWatersToBounds(waters, ob);
  } else {
    waters = placeWaters(rk, bio, dense, cum, total, green, tee, par, ob);
  }
  const mounds = placeMounds(rk, bio, dense, cum, total, green, par, fairwayWidth);
  const sentinels = placeSentinels(rk, bio, dense, cum, total, green, par, fairwayWidth);

  const elevProfile = buildElevProfile(rk, bio, total, par, !!courseState?.dramaticGreenUsed);
  if (courseState && DRAMATIC_GREEN.has(elevProfile.kind)) courseState.dramaticGreenUsed = true;

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
    cup: { x: pin.x, z: pin.z, r: 0.054 },     // a real hole is 108mm ACROSS — half that is the radius
    bunkers, waters, mounds,
    bounds, ob,
    trees: [],
    // terrain shaping
    terrainSeed: (seed ^ 0x5f3a7c1) >>> 0,
    elevProfile,
    greenTilt: { ax: rk.gauss() * 0.028, az: rk.gauss() * 0.028 },
    maxStrokes: par + 6
  };

  const dist2route = makeRouteDistanceFn(hole);
  /* The furniture, before the trees: props claim their spot against the golf
     and the trees then avoid THEM, rather than a hut being dropped into a
     wood that is already there. */
  hole.props = placeProps(rk, hole, bio, dist2route);
  hole.trees = placeTrees(rk, bio, dense, cum, total, green, tee, bunkers, waters, fairwayWidth, bounds, dist2route, hole.props);
  /* Sentinels go in LAST and unfiltered: placeTrees rejects anything inside
     the corridor, which is exactly where these are supposed to be. */
  hole.trees.push(...sentinels);
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

/* =========================================================================
   ELEVATION — what the hole does vertically
   -------------------------------------------------------------------------
   The old profile was `drop * t + midBump * sin(pi t)`, both drawn from a
   gaussian around zero. That is a fair description of gently undulating
   ground and it is why every hole felt the same: the expected value of a
   gaussian is nothing, so the average hole was flat, and the ones that were
   not still only rose or fell by a few metres spread over four hundred.

   A real course does not undulate randomly, it has SET PIECES — a tee cut
   into the hillside so you are hitting out over the tops of the trees, a
   green perched above you that hides its own surface, a valley you drive
   into and climb out of. Those are the holes anybody remembers.

   So a hole now picks an archetype and commits to it, and the wander is what
   is layered on top rather than the whole story.
   ========================================================================= */

const ELEV_KINDS = [
  /* The one the player asked for by name: you start high. Ten to twenty
     metres above the fairway is a genuine drop — the ball hangs, carries
     further than the number says, and the whole hole is laid out in front
     of you from the tee, which is most of the pleasure of it. */
  ['tee_box', 4],
  ['uphill_green', 3],     // the green sits above you and hides its surface
  ['valley', 3],           // down off the tee, climb back to the green
  ['plateau', 2],          // climbs early, then runs flat along a shelf
  ['punchbowl', 2],        // green sits in a hollow: everything feeds in
  ['ridge', 2],            // a crest partway, blind over the top
  ['rolling', 3]           // no set piece, just genuinely uneven ground
];

/* uphill_green and punchbowl are the two archetypes that move the GREEN
   itself, not just the ground on the way to it — a green perched on a
   mound or sitting in a bowl rather than merely a hole with a hill on it
   somewhere. Rolled independently per hole, together they landed on about
   a quarter of all holes, which meant most 9-hole courses had two or three
   — reported back as "craters and massive hills," not as terrain variety.
   Capped here at one per course: once a course has used its one, both are
   dropped from the pool and the rest of ELEV_KINDS reweights over what's
   left, same as it would if they had never been in the list. */
const DRAMATIC_GREEN = new Set(['uphill_green', 'punchbowl']);

function buildElevProfile(rk, bio, total, par, dramaticGreenUsed) {
  const bias = bio.slopeBias || 1;
  /* Flat courses get flat holes. A links course pretending to be a mountain
     course is worse than either, so relief scales the whole archetype rather
     than being ignored. */
  const scale = clamp(((bio.relief || 7) / 9) * bias, 0.45, 1.6);

  const pool = dramaticGreenUsed
    ? ELEV_KINDS.filter(([name]) => !DRAMATIC_GREEN.has(name))
    : ELEV_KINDS;
  const sum = pool.reduce((a, k) => a + k[1], 0);
  let roll = rk.f(0, sum), kind = pool[0][0];
  for (const [name, w] of pool) { roll -= w; if (roll <= 0) { kind = name; break; } }

  const p = {
    kind, total,
    drop: rk.gauss() * 3.5 * bias,          // the old gentle net tilt, kept
    midBump: rk.gauss() * 2.5 * bias,
    teeDrop: 0,                             // height the tee sits above the rest
    teeSpan: 0.14,                          // how quickly it falls away
    shelf: 0,                               // an early climb onto a terrace
    greenLift: 0,                           // green above (+) or in a bowl (-)
    rollAmp: rk.f(0.6, 2.2) * scale,        // the ground is never actually flat
    rollFreq: rk.f(2.2, 4.4),
    rollPhase: rk.f(0, Math.PI * 2)
  };

  switch (kind) {
    case 'tee_box':
      p.teeDrop = rk.f(9, 19) * scale;
      p.teeSpan = rk.f(0.10, 0.18);
      p.drop -= rk.f(0, 3) * bias;
      break;
    case 'uphill_green':
      p.greenLift = rk.f(6, 14) * scale;
      break;
    case 'valley':
      p.midBump = -rk.f(7, 15) * scale;     // the floor of it, halfway down
      p.greenLift = rk.f(1, 5) * scale;
      break;
    case 'plateau':
      p.shelf = rk.f(4, 9) * scale;         // climbs onto a terrace, then runs flat
      break;
    case 'punchbowl':
      p.greenLift = -rk.f(4, 9) * scale;
      break;
    case 'ridge':
      p.midBump = rk.f(6, 13) * scale;      // blind over the top of it
      break;
    default:                                 // rolling
      p.rollAmp *= rk.f(1.6, 2.6);
      p.rollFreq = rk.f(1.6, 3.0);
  }

  /* Set pieces scale with the LENGTH of the hole, not with its par.
     What makes ground playable is the gradient, and a gradient is a height
     over a distance — so a twenty-metre crest is a gentle roll on a 520 m
     par 5 and a cliff on a 150 m par 3. Halving it for par 3s was the rough
     version of this and it was not enough on the steep courses: Kurodake,
     with the highest relief and a slope bias on top, still put an 11% climb
     across the launch window of its short second. */
  const lenK = clamp(total / 380, 0.42, 1.15);
  p.teeDrop *= lenK; p.greenLift *= lenK; p.midBump *= lenK; p.shelf *= lenK;
  /* A short hole on a low-relief biome could stack the low end of teeDrop's
     own range with the low end of both scale and lenK — 9 * 0.45 * 0.42 is
     under 2m, which is not an elevated tee, it is a tee. This was always
     possible; it took the archetype landing on the right unlucky combination
     of course and hole to actually roll it. Floored rather than narrowing
     the range above, so short holes still get real variety and only the
     one degenerate corner of it is closed off. */
  if (kind === 'tee_box') p.teeDrop = Math.max(p.teeDrop, 5);
  return p;
}

/* Every term that CLIMBS has to leave the tee flat.
   -------------------------------------------------------------------------
   This is the whole difference between a mountain hole and a broken one. A
   plain `sin(pi t)` bump is steepest at t = 0, so a hole that rises fifteen
   metres to a crest puts most of that gradient in the first fifty metres —
   directly in the launch window, where a flushed driver flies into the
   hillside and the player concludes the swing is broken.

   terrain.js grades an apron in front of each tee for exactly this reason,
   but a cap is a patch over a bad profile; it stops the disaster and leaves
   the hole feeling like a ramp. So the shapes themselves are chosen to have
   ZERO SLOPE at the tee: sin² instead of sin for the crest, a smoothstep for
   the terrace, t³ for the green. Only the tee_box drop is steep at t = 0,
   and that one falls away from you, which is the point of it. */
const sstep = (a, b, t) => {
  const u = clamp((t - a) / ((b - a) || 1), 0, 1);
  return u * u * (3 - 2 * u);
};

export function elevationAlongRoute(hole, s) {
  const p = hole.elevProfile;
  const t = clamp(s / (p.total || 1), 0, 1);
  /* A crest uses sin², which is flat at the tee — but "flat at t = 0" is not
     the same as "flat for the first hundred metres", and on a short hole
     t = 0.28 is already 65% of the way up the bump. So the crest is ALSO
     faded in over the launch window in metres, exactly like the roll. A
     hollow needs none of this: falling ground off the tee is the good kind. */
  const sin2 = Math.sin(Math.PI * t) ** 2;
  const crest = p.midBump > 0 ? sin2 * sstep(0, 135, s) : Math.sin(Math.PI * t);
  let h = p.drop * t + p.midBump * crest;
  /* The tee's own height decays away over the first stretch, so the drop is
     off the tee where you can see it, not a slab tilting the whole hole. */
  if (p.teeDrop) h += p.teeDrop * Math.exp(-t / (p.teeSpan || 0.14));
  /* The terrace starts climbing outside the launch window and takes its
     time about it — in metres, for the same reason the roll does. */
  if (p.shelf) h += p.shelf * sstep(55, Math.max(190, p.total * 0.45), s);
  // the green's arrives late, for the same reason in reverse
  if (p.greenLift) h += p.greenLift * (t * t * t);
  /* The general unevenness fades in over the first hundred metres, so it
     cannot put a two-metre wave across the launch window either. Note that
     the fade is in METRES and not in t: a fixed fraction of the hole is 26 m
     on a par 3 and 90 m on a par 5, and the launch window is the same length
     on both. Getting that wrong put a 14% climb ten metres off one tee. */
  if (p.rollAmp) {
    h += p.rollAmp * Math.sin(t * Math.PI * p.rollFreq + p.rollPhase) * sstep(0, 100, s);
  }
  return h;
}

function describeHole(hole, rk) {
  const { par } = hole;
  // bendOf compares the tee tangent with the green tangent, which is zero for
  // an S-curve — it comes back to the same heading.  The shape knows better,
  // so a snaking hole is never called "Straightaway".
  const dog = hole.route.length > 2 ? bendOf(hole) : 0;
  const names = [];
  if (hole.shape === 's_curve') names.push('The Snake');
  else if (Math.abs(dog) > 0.34) names.push(dog > 0 ? 'Dogleg Right' : 'Dogleg Left');
  else if (hole.shape === 'sweep') names.push(dog > 0 ? 'The Right Bend' : 'The Left Bend');
  else names.push(par === 3 ? 'The Short' : 'Straightaway');
  if (hole.waters.length >= 2) names.push('Double Cross');
  else if (hole.waters.length === 1) names.push('Watermark');
  if (hole.bunkers.length >= 6) names.push('The Sandbox');

  /* What the hole DOES vertically is usually the thing you remember about
     it, so it gets a name at least as often as the water does. */
  const ELEV_NAMES = {
    tee_box: ['The High Tee', 'Lookout', 'The Drop'],
    uphill_green: ['The Climb', 'Long Way Up'],
    valley: ['The Valley', 'Dip and Rise'],
    plateau: ['The Shelf', 'Tabletop'],
    punchbowl: ['Punchbowl', 'The Dell'],
    ridge: ['Blind Man’s', 'Over the Crest'],
    rolling: []
  };
  names.push(...(ELEV_NAMES[hole.elevProfile?.kind] || []));
  if (hole.bunkers.some(b => b.cross)) names.push('The Carry');
  if (hole.trees.some(t => t.blocker)) names.push('The Sentinel');
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
  /* A REAL COURSE borrows a biome for its look — the palette, the trees, the
     sky — and supplies its own routing. So the lookup is: is this an
     imported course, and if so which biome does it dress itself in. */
  const real = realCourse(courseId);
  const bio = real ? BIOMES[real.biome] : BIOMES[courseId];
  if (!bio) throw new Error('Unknown course: ' + courseId);

  const holes = [];
  // shared across every hole on this course, so the second uphill_green or
  // punchbowl in a row gets rerolled into something else instead of standing
  const courseState = { dramaticGreenUsed: false };
  for (let n = 1; n <= HOLES_PER_COURSE; n++) {
    holes.push(makeHole(courseId, bio, n, hashSeed(courseId, n, 0x9e37),
                        real ? real.holes[n - 1] : null, courseState));
  }
  // hole 1 of the parkland course is the original hand-drawn map
  if (courseId === 'parkland') holes[0] = makeSignatureHole(bio);

  const par = holes.reduce((s, h) => s + h.par, 0);
  const yards = holes.reduce((s, h) => s + h.yards, 0);
  return {
    id: courseId,
    name: real?.name ?? bio.name,
    blurb: real?.blurb ?? bio.blurb,
    region: real?.region ?? bio.region,
    /* Carried through so the credits screen can show it. A course built
       from OpenStreetMap data has to say so wherever it appears. */
    attribution: real?.attribution ?? null,
    real: !!real,
    biome: bio, holes, par, yards
  };
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
  clipWatersToBounds(waters, ob);

  const hole = {
    courseId: 'parkland', number: 1, par: 5,
    lengthM: total, yards: 541,
    seed: hashSeed('parkland', 1, 0xA11CE),
    route: dense, cum, total,
    fairwayWidth: 176 / U,                         // the original 176-unit corridor
    roughWidth: bio.roughWidth,
    tee, tees, teeYards: teeYardage(tees, total),
    green, pin,
    cup: { x: pin.x, z: pin.z, r: 0.054 },     // 108mm across, radius is half that
    bunkers, waters,
    /* The signature hole is the hand-drawn map and stays that way — no
       generated shaping goes in it. It keeps the field so nothing downstream
       has to ask whether a hole has mounds. */
    mounds: [],
    props: [],
    bounds, ob,
    trees: [],
    terrainSeed: 0x51a7c33d >>> 0,
    elevProfile: { kind: 'rolling', drop: -2.5, midBump: 3.0, total },
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
  /* The hand-drawn hole keeps its hand-drawn shaping, but it is still a golf
     course and it is the first thing anybody sees — so it gets the same
     furniture as everywhere else. Placed before the trees, as on generated
     holes, so the tree loop below can keep clear of it. */
  hole.props = placeProps(rk, hole, bio, dist2route);
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
      for (const pp of hole.props) if (Math.hypot(x - pp.x, z - pp.z) < 5) { bad = true; break; }
      if (bad) continue;
      const species = rk.pick(bio.treeSpecies);
      // 'tall' clusters are old growth: two to three times the normal canopy
      const h = cl.tall ? rk.f(cl.tall[0], cl.tall[1]) : rk.f(bio.treeHeight[0], bio.treeHeight[1]);
      hole.trees.push({ x, z, species, h, r: h * crownOf(species), rot: rk.f(0, Math.PI * 2), tone: rk.f(0, 1) });
      placed++;
    }
  }
  return hole;
}

/**
 * Where to point a shot by default, from anywhere on a hole.
 *
 * NOT simply "at the flag".  On a dogleg the straight line to the pin cuts
 * across the corner and into the trees — on the opening hole of Claude
 * National it pointed at a maple thirty metres from the tee, so every
 * player's first drive in the game was a flushed shot into a trunk, which
 * reads as a broken swing rather than a wrong aim.
 *
 * The default follows the fairway route out to roughly as far as the club can
 * carry, and switches to the flag once the flag is the nearer thing.  On a
 * straight hole the route is the line to the pin, so this changes nothing.
 *
 * @param hole    a generated hole, with .route and .pin
 * @param x,z     where the ball is
 * @param reach   how far the club in hand actually carries, in metres
 * @returns heading in radians, in this project's (sin h, cos h) convention
 */
export function defaultAim(hole, x, z, reach = 200) {
  return aimPlan(hole, x, z, reach).aim;
}

/**
 * The same decision, but it also hands back HOW FAR the aim is pointing.
 *
 * That second number matters as much as the first and used to be thrown
 * away. The caddie's power marker asked for the distance to the PIN however
 * the aim was set, so on a dogleg the game pointed you at the corner and
 * then told you to hit hard enough to reach the flag — a flushed shot went
 * straight through the corner into the trees, doing exactly what aiming at
 * the corner was supposed to avoid. Aim and power have to describe one shot.
 *
 * @returns { aim, dist }  heading in radians, and the distance to what it is
 *                         actually pointing at
 */
export function aimPlan(hole, x, z, reach = 200) {
  const straight = Math.atan2(hole.pin.x - x, hole.pin.z - z);
  const toPin = Math.hypot(hole.pin.x - x, hole.pin.z - z);
  const at = (a, d) => ({ aim: a, dist: d });
  const route = hole.route;
  if (!Array.isArray(route) || route.length < 2) return at(straight, toPin);

  // nearest point on the fairway route to where the ball actually is
  let near = 0, nd = Infinity;
  for (let i = 0; i < route.length; i++) {
    const dx = route[i][0] - x, dz = route[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < nd) { nd = d; near = i; }
  }
  const offLine = Math.sqrt(nd);

  /* THE PUNCH-OUT.
     -------------------------------------------------------------------------
     Everything beyond the fairway and its rough is deep rough, and it goes on
     forever — there is no far edge to it, only out of bounds eventually. So a
     ball forty metres offline that is aimed DOWN THE HOLE travels ninety
     metres forward and lands forty metres offline again. Measured over the
     whole game, fifty-four per cent of shots played from deep rough failed to
     escape it. That is not a hazard, that is the game taking the controller
     off you for three shots, and it was the single biggest thing making a
     round unpleasant.

     A caddie handed that ball says one thing: get it back in play. So when
     the ball is well outside the corridor, the aim goes to the nearest part
     of the fairway, nudged forward so you gain a little ground rather than
     hitting sideways or backwards. From in play it is unchanged — this only
     ever fires when you are already in trouble, which is exactly when the
     default aim was making it worse.

     The player can still aim anywhere they like. This is what the game
     SUGGESTS, and suggesting the shot that leaves you in the rough again was
     bad advice. */
  const halfW = hole.fairwayWidth * 0.5;
  const RECOVER_AT = halfW + hole.roughWidth * 0.9;
  if (offLine > RECOVER_AT) {
    // a little forward of square, and never further than the club can carry
    const gain = Math.min(reach * 0.55, Math.max(24, offLine * 0.7));
    let ti = near;
    while (ti < route.length - 1 && hole.cum[ti] < hole.cum[near] + gain) ti++;
    const t = route[ti];
    // ...unless the pin is genuinely the nearer thing, in which case go at it
    const d = Math.hypot(t[0] - x, t[1] - z);
    if (toPin > d * 0.85) return at(Math.atan2(t[0] - x, t[1] - z), d);
    return at(straight, toPin);
  }

  /* Walk forward and take the FURTHEST route point we can still reach in a
     straight line without leaving the fairway corridor.  Picking the point at
     exactly the club's carry is not enough on its own: past the corner of a
     dogleg that line goes through the trees again, just further along.  This
     asks the only question that matters — does the ball stay over short grass
     all the way there — and stops at the corner when the answer turns no. */
  const STEP = 3;                             // the route is sampled ~3 m apart
  /* How far the straight line may stray from the centreline before the shot
     counts as leaving the short grass. A flat 16 m was far too strict: the
     fairways here run 24 to 44 m wide, so on the wide ones the test failed
     while the ball was still comfortably in the middle third, and the plan
     came back 111 m on a 547-yard par 5 — which handed the player an 8 iron
     off the tee. Half the fairway width is the honest number, with a floor
     so a narrow course does not become unplayable. */
  const CORRIDOR = Math.max(15, hole.fairwayWidth * 0.5);
  const maxAhead = Math.max(1, Math.round(reach / STEP));
  let best = Math.min(route.length - 1, near + 1);

  /* The corridor is no longer empty — sentinel trees stand in it on purpose
     (see placeSentinels), and any ordinary tree can end up near a ball that
     is not on the fairway to begin with. Staying over short grass is
     therefore no longer enough to call a line clear: the aim has to miss
     every trunk it comes near, or the game points the player down a line
     ballistics.js is about to deflect off — every tree collides, not only
     the ones flagged `blocker`, and the suggested aim has to agree with
     that or the drawn line (a real simulation, not a ruler — see
     refreshAimPreview) shows a shot that dies three metres out for no
     visible reason. Filtered against the ROUTE ahead, not just the ball's
     position: a wooded hole can carry several hundred trees, and a circle
     wide enough to cover every candidate line (up to `reach` out) still
     catches most of a forest, which turned this from a handful of blocker
     checks into hundreds of thousands of distance calls in the sample loop
     below — measured at 4ms+ per call on Kakoda Forest, fifty times what it
     cost before. A tree can only ever matter here if it sits near the
     fairway band the walk is actually allowed to stray into, so that band
     is the filter, not the ball's reach in every direction. */
  const aheadEnd = Math.min(route.length - 1, near + maxAhead);
  const nearbyTrees = (hole.trees || []).filter(t => {
    for (let i = near; i <= aheadEnd; i++) {
      if (Math.hypot(t.x - route[i][0], t.z - route[i][1]) <= CORRIDOR + t.r + 3) return true;
    }
    return false;
  });
  /* WATER counts as something you may not be aimed into.
     Sentinel trees were already handled; lakes never were, on the assumption
     that a hazard sits beside a fairway rather than across it. Sometimes it
     sits across it, and then the game was pointing a full driver into the
     middle of a lake and calling it the recommended shot. A caddie lays up
     short of the water; so does this now, because the corridor walk simply
     stops at the near bank and hands back that distance. */
  const waters = hole.waters || [];

  for (let k = 2; k <= maxAhead; k++) {
    const i = near + k;
    if (i > route.length - 1) break;
    const tx = route[i][0], tz = route[i][1];
    const dx = tx - x, dz = tz - z;
    const len = Math.hypot(dx, dz) || 1;
    // does the straight line to this point stay near the route the whole way?
    let clear = true;
    for (let j = 1; j < k; j++) {
      const t = j / k;
      const lx = x + dx * t, lz = z + dz * t;
      const rx = route[near + j][0], rz = route[near + j][1];
      if (Math.hypot(lx - rx, lz - rz) > CORRIDOR) { clear = false; break; }
      for (const b of nearbyTrees) {
        if (Math.hypot(lx - b.x, lz - b.z) < b.r + 3) { clear = false; break; }
      }
      if (clear) {
        for (const w of waters) {
          if (inEllipse(lx, lz, w, 2)) { clear = false; break; }
        }
      }
      if (!clear) break;
    }
    if (!clear) break;
    best = i;
  }

  const tx = route[best][0], tz = route[best][1];
  // Once the flag is as close as the point we would aim at — or that point is
  // effectively the green anyway — aim at the flag.
  const toRoute = Math.hypot(tx - x, tz - z);
  if (toPin <= toRoute || Math.hypot(tx - hole.pin.x, tz - hole.pin.z) < 20) return at(straight, toPin);

  /* NEVER hand back a tap.
     If the corridor walk fails on its very first step — standing behind a
     sentinel, say — `best` stays one route sample ahead and the plan comes
     back as three metres. That was harmless while the plan only set the aim.
     It is a disaster now the CLUB and the caddie's power follow it too: the
     game hands you a lob wedge a hundred and eighty metres from the green
     and tells you to hit it three metres, and you tap forward for the rest
     of your life. Sandbelt's third hole did exactly that, every time.

     There is no safe line from here, so say so the way a caddie would: go at
     the flag and deal with what is in the way. A hard shot is a golf hole; a
     shot that cannot advance the ball is a bug. */
  const MIN_USEFUL = 30;
  if (toRoute < MIN_USEFUL && toPin > MIN_USEFUL) return at(straight, toPin);
  return at(Math.atan2(tx - x, tz - z), toRoute);
}
