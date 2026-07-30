/* =========================================================================
   terrain.js — ground height and what you're lying on
   -------------------------------------------------------------------------
   One authority for the shape of the world.  The renderer builds its mesh by
   sampling heightAt(); the physics finds the ground with the same function.
   They can never disagree, which is the whole point — if it looks like the
   ball is on the downslope of a bunker, it is.
   ========================================================================= */

import { fbm, ridged, lerp, smoothstep } from './rng.js';
import { inEllipse, elevationAlongRoute, makeRouteDistanceFn } from './coursegen.js';

/* roll  = rolling resistance coefficient; deceleration is roll × g, so green
           0.065 gives ~0.64 m/s² and a 3 m/s putt runs about 7 m — right.
   bounce = restitution on landing
   grab   = how much the surface kills forward speed and bites on backspin
   spinKeep = how much spin you can put on the ball from this lie */
export const SURFACES = {
  // roll 0.070 puts a green at a Stimpmeter reading around 8 ft — a good club
  // green.  Tour greens run 10-12, but paired with the slope term that breaks a
  // 3 m putt more than half a metre, which needs AimPoint-grade reading to hole
  // anything.  8 ft breaks about 35 cm: enough that the read matters, little
  // enough that a player who trusts the caddie's line makes it.
  green:    { id: 'green',    label: 'Green',      roll: 0.070, bounce: 0.30, grab: 0.72, spinKeep: 0.55 },
  fringe:   { id: 'fringe',   label: 'Fringe',     roll: 0.170, bounce: 0.26, grab: 0.80, spinKeep: 0.40 },
  fairway:  { id: 'fairway',  label: 'Fairway',    roll: 0.230, bounce: 0.30, grab: 0.70, spinKeep: 0.50 },
  tee:      { id: 'tee',      label: 'Tee',        roll: 0.230, bounce: 0.30, grab: 0.70, spinKeep: 0.50 },
  rough:    { id: 'rough',    label: 'Rough',      roll: 0.620, bounce: 0.15, grab: 0.90, spinKeep: 0.12 },
  deep:     { id: 'deep',     label: 'Deep rough', roll: 1.100, bounce: 0.08, grab: 0.96, spinKeep: 0.05 },
  sand:     { id: 'sand',     label: 'Bunker',     roll: 2.200, bounce: 0.04, grab: 0.99, spinKeep: 0.05 },
  waste:    { id: 'waste',    label: 'Waste area', roll: 0.800, bounce: 0.14, grab: 0.88, spinKeep: 0.10 },
  path:     { id: 'path',     label: 'Cart path',  roll: 0.045, bounce: 0.62, grab: 0.15, spinKeep: 0.30 },
  water:    { id: 'water',    label: 'Water',      roll: 3.000, bounce: 0.00, grab: 1.00, spinKeep: 0.00 },
  ob:       { id: 'ob',       label: 'Out of bounds', roll: 0.700, bounce: 0.14, grab: 0.9, spinKeep: 0.1 }
};

/* =========================================================================
   TerrainModel — one per hole, cached
   ========================================================================= */
export class TerrainModel {
  constructor(hole, biome) {
    this.hole = hole;
    this.bio = biome;
    this.dist2route = makeRouteDistanceFn(hole);
    this.seed = hole.terrainSeed;
    this.iScale = 1 / (biome.reliefScale || 160);

    // water surface heights, resolved once (a pond is flat, obviously)
    this.waterLevels = hole.waters.map(w => {
      const base = this._natural(w.x, w.z);
      // Nearly to the brim.  The old level sat most of a metre down, which
      // left every pond ringed by a wide dry bowl — a dam nobody filled.
      return base - 0.22;
    });

    // green plane, so putting surfaces are smooth and readable
    this.greenBase = this._natural(hole.green.x, hole.green.z);
  }

  /* -------- the underlying landform, before any golf course was built ----- */
  _natural(x, z) {
    const bio = this.bio;
    const s = this.iScale;
    let h = fbm(x * s, z * s, this.seed, 4) * bio.relief;
    if (bio.ridged) {
      h = lerp(h, ridged(x * s * 1.7, z * s * 1.7, this.seed ^ 0x2f, 3) * bio.relief, bio.ridged);
    }
    // a little fine detail everywhere so nothing looks synthetic
    h += fbm(x * 0.06, z * 0.06, this.seed ^ 0x77, 2) * 0.35;
    return h;
  }

  /* -------- the corridor the greenkeeper flattened out ------------------- */
  _corridor(x, z) {
    const { d, s } = this.dist2route(x, z, true);
    return { d, s, base: elevationAlongRoute(this.hole, s) };
  }

  /**
   * Ground height at (x,z).
   * Natural landform, blended toward a graded corridor near the centreline,
   * then flattened to a tilted plane on the green and dished out in bunkers.
   */
  heightAt(x, z) {
    const hole = this.hole;
    const { d, s, base } = this._corridor(x, z);
    const natural = this._natural(x, z);

    // how strongly the course has been graded here: full on the fairway,
    // fading out into the natural land beyond the rough
    const halfW = hole.fairwayWidth * 0.5;
    const graded = 1 - smoothstep(halfW, halfW + hole.roughWidth + 26, d);
    let h = lerp(natural, base + natural * 0.22, graded * 0.85);

    // green: a smooth, gently tilted plateau
    const g = hole.green;
    const dg = Math.hypot(x - g.x, z - g.z);
    const gw = 1 - smoothstep(g.r * 0.9, g.r * 1.55, dg);
    if (gw > 0.001) {
      const tilt = this.greenBase
        + (x - g.x) * hole.greenTilt.ax
        + (z - g.z) * hole.greenTilt.az
        + fbm(x * 0.035, z * 0.035, this.seed ^ 0x1234, 2) * 0.30;   // subtle contour
      h = lerp(h, tilt, gw);
    }

    // tees: a level pad for each set
    for (const t of Object.values(hole.tees || { back: hole.tee })) {
      const dt = Math.max(Math.abs(x - t.x) / (t.w * 0.5), Math.abs(z - t.z) / (t.d * 0.5));
      if (dt < 1.6) {
        const tw = 1 - smoothstep(1.0, 1.6, dt);
        h = lerp(h, elevationAlongRoute(hole, t.s || 0) + 0.15, tw);
      }
    }

    // bunkers: dish the ground down, with a lip on the far side
    for (const b of hole.bunkers) {
      const q = ellipseQ(x, z, b);
      if (q < 2.2) {
        const inner = 1 - smoothstep(0.0, 1.0, q);
        const lip = smoothstep(1.0, 1.25, q) * (1 - smoothstep(1.25, 1.7, q));
        h -= inner * b.depth;
        h += lip * b.depth * 0.35;
      }
    }

    // water: carve the basin so the pond has a bed under it
    for (let i = 0; i < hole.waters.length; i++) {
      const w = hole.waters[i];
      const q = ellipseQ(x, z, w);
      if (q < 1.35) {
        const inner = 1 - smoothstep(0.0, 1.15, q);
        h = lerp(h, this.waterLevels[i] - (w.depth || 2.2), inner);
      }
    }
    return h;
  }

  /** Surface normal, by sampling. Used for slope, roll direction and shading. */
  normalAt(x, z, eps = 0.6) {
    const hL = this.heightAt(x - eps, z), hR = this.heightAt(x + eps, z);
    const hD = this.heightAt(x, z - eps), hU = this.heightAt(x, z + eps);
    const nx = (hL - hR) / (2 * eps);
    const nz = (hD - hU) / (2 * eps);
    const len = Math.hypot(nx, 1, nz);
    return [nx / len, 1 / len, nz / len];
  }

  /** Water surface height at a point, or null if there's no water here. */
  waterAt(x, z) {
    const hole = this.hole;
    for (let i = 0; i < hole.waters.length; i++) {
      if (inEllipse(x, z, hole.waters[i])) return this.waterLevels[i];
    }
    return null;
  }

  /* -------------------------------------------------------- what's my lie */
  surfaceAt(x, z) {
    const hole = this.hole;
    const ob = hole.ob;
    if (x < ob.minX || x > ob.maxX || z < ob.minZ || z > ob.maxZ) return SURFACES.ob;

    for (const w of hole.waters) if (inEllipse(x, z, w)) return SURFACES.water;

    for (const t of Object.values(hole.tees || { back: hole.tee })) {
      if (Math.abs(x - t.x) <= t.w * 0.5 && Math.abs(z - t.z) <= t.d * 0.5) return SURFACES.tee;
    }

    const g = hole.green;
    if (inEllipse(x, z, { x: g.x, z: g.z, rx: g.rx, rz: g.rz, rot: g.rot })) return SURFACES.green;
    if (inEllipse(x, z, { x: g.x, z: g.z, rx: g.rx + 2.6, rz: g.rz + 2.6, rot: g.rot })) return SURFACES.fringe;

    for (const b of hole.bunkers) if (inEllipse(x, z, b)) return SURFACES.sand;

    const d = this.dist2route(x, z);
    const halfW = hole.fairwayWidth * 0.5;
    if (d <= halfW) return SURFACES.fairway;
    if (d <= halfW + 2.5) return SURFACES.fringe;
    if (d <= halfW + hole.roughWidth) return SURFACES.rough;

    if (this.bio.wasteAreas) return SURFACES.waste;
    return SURFACES.deep;
  }

  /** Distance to the pin in metres. */
  toPin(x, z) {
    return Math.hypot(x - this.hole.pin.x, z - this.hole.pin.z);
  }
}

function ellipseQ(x, z, e) {
  let dx = x - e.x, dz = z - e.z;
  if (e.rot) {
    const c = Math.cos(-e.rot), s = Math.sin(-e.rot);
    const rx = dx * c - dz * s, rz = dx * s + dz * c;
    dx = rx; dz = rz;
  }
  return Math.sqrt((dx * dx) / (e.rx * e.rx) + (dz * dz) / (e.rz * e.rz));
}

/* ------------------------------------------------------------------ cache */
const _models = new Map();
export function terrainFor(hole, biome) {
  const key = hole.courseId + ':' + hole.number;
  let m = _models.get(key);
  if (!m) { m = new TerrainModel(hole, biome); _models.set(key, m); }
  return m;
}
