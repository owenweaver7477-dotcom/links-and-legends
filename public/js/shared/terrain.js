/* =========================================================================
   terrain.js — ground height and what you're lying on
   -------------------------------------------------------------------------
   One authority for the shape of the world.  The renderer builds its mesh by
   sampling heightAt(); the physics finds the ground with the same function.
   They can never disagree, which is the whole point — if it looks like the
   ball is on the downslope of a bunker, it is.
   ========================================================================= */

import { fbm, ridged, lerp, smoothstep } from './rng.js';
import { inEllipse, elevationAlongRoute, makeRouteDistanceFn,
         edgeScale, localOffset } from './coursegen.js';

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
  green:    { id: 'green',    label: 'Green',      roll: 0.062, bounce: 0.30, grab: 0.72, spinKeep: 0.55 },
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

/* How far in front of a tee the ground is graded, and the steepest climb it
   is allowed over that stretch.  6% for 95 m clears the launch window on any
   terrain without levelling the mountain the hole is cut into. */
const TEE_APRON = 95;
const TEE_CLIMB = 0.06;

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

    // green plane, so putting surfaces are smooth and readable
    this.greenBase = this._natural(hole.green.x, hole.green.z);

    /* Water surface heights, resolved once — a pond is flat, obviously.
       -------------------------------------------------------------------
       This used to be the NATURAL height at the pond's centre, which is
       right only on ground that is level. On steep ground it is badly wrong:
       Grimsvik has relief 14 and a ridge factor of 0.8, so the land can fall
       six metres across a pond, and a surface set from the middle hangs in
       mid-air above the downhill rim with a black pit carved out beneath it.
       Water floating over a hole in the ground is, fairly, what a player
       calls "not rendering properly".

       Water finds the LOW point. So the level is the minimum ground height
       around the pond's shoulder — sampled just outside the basin the carve
       digs, using the terrain as it would be with no water in it at all. Set
       a touch under that and the pond meets its bank the whole way round. */
    this.waterLevels = hole.waters.map(w => {
      let lo = Infinity;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        // q = 1.32: outside the carve (which fades out by 1.3), so this is
        // the dry bank rather than the bowl we are about to dig
        let dx = Math.cos(a) * w.rx * 1.32, dz = Math.sin(a) * w.rz * 1.32;
        if (w.rot) {
          const c = Math.cos(w.rot), sn = Math.sin(w.rot);
          const rx = dx * c - dz * sn, rz = dx * sn + dz * c;
          dx = rx; dz = rz;
        }
        lo = Math.min(lo, this.heightAt(w.x + dx, w.z + dz, true));
      }
      if (!Number.isFinite(lo)) lo = this._natural(w.x, w.z);
      // Nearly to the brim. A level set well down leaves every pond ringed
      // by a wide dry bowl — a dam nobody filled.
      return lo - 0.22;
    });
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
  heightAt(x, z, dry = false) {
    const hole = this.hole;
    const { d, s, base } = this._corridor(x, z);
    const natural = this._natural(x, z);

    // how strongly the course has been graded here: full on the fairway,
    // fading out into the natural land beyond the rough
    const halfW = hole.fairwayWidth * 0.5;
    const graded = 1 - smoothstep(halfW, halfW + hole.roughWidth + 26, d);
    let h = lerp(natural, base + natural * 0.22, graded * 0.85);

    /* The launch apron.
       A tee pad on its own is only a few metres across, so on a high-relief
       course the natural land could rear up into a wall a few paces in front
       of it — Hochkar had corridors climbing 28% at 5 m, and a drive simply
       slammed into the hillside.  Real courses grade the ground away from a
       tee; here the corridor is given a CEILING that climbs no faster than
       TEE_CLIMB for the first stretch, then fades back into the natural land.
       Only the rise is capped, so a tee shot into a falling valley — the good
       part of mountain golf — is untouched. */
    if (graded > 0.001) {
      for (const t of Object.values(hole.tees || { back: hole.tee })) {
        const along = s - (t.s || 0);
        if (along <= 0 || along >= TEE_APRON) continue;
        const teeH = elevationAlongRoute(hole, t.s || 0) + 0.15;
        const ceiling = teeH + along * TEE_CLIMB;
        if (h > ceiling) {
          // full authority close in, releasing back to the landform by the end
          const k = graded * (1 - smoothstep(TEE_APRON * 0.55, TEE_APRON, along));
          h = lerp(h, ceiling, k);
        }
      }
    }

    /* Mounds and hollows in the fairway itself.
       These go on AFTER the corridor has been graded, because the whole
       point of them is that the greenkeeper did not flatten this bit — and
       BEFORE the green and the tee pads, which are allowed to overrule any
       shaping that strays into them. Nothing in the game ever putts across a
       hump or tees off the side of one. */
    for (const m of hole.mounds || []) {
      const q = ellipseQ(x, z, m);
      if (q < 1) {
        // cosine cap: zero height and zero slope at the rim, so it blends
        // into the fairway rather than sitting on it like a dropped bowl
        h += m.h * 0.5 * (1 + Math.cos(Math.PI * q));
      }
    }

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

    /* Water: carve a basin that is actually UNDER its own water.
       The old profile eased from the bed depth to the natural ground across
       0..1.15, which put the bed only 12% of the way down by the time it
       reached q=0.9 — still inside the pond.  The result was a bed sitting a
       metre and a half ABOVE the water surface around the whole rim: the
       ground punched up through the water plane, and the exposed ring of
       shadowed bowl is the dark band that made every pond look wrong.

       Now the bowl is parabolic and meets the waterline exactly at the
       ellipse edge, then climbs to the natural bank just outside it. Inside
       the pond the ground is always below the water; outside, it is the
       course again within a quarter of a radius. */
    // `dry` skips the basins entirely — used while WORKING OUT where the
    // water goes, which cannot depend on the water already being there
    for (let i = 0; !dry && i < hole.waters.length; i++) {
      const w = hole.waters[i];
      const q = ellipseQ(x, z, w);
      if (q < 1.3) {
        const lvl = this.waterLevels[i];
        const t = Math.min(1, q);
        const bed = Math.min(lvl - 0.06, lvl - (w.depth || 2.2) * (1 - t * t));
        h = lerp(h, bed, 1 - smoothstep(1.0, 1.3, q));
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

/* Same wobbled edge the ball is tested against — see edgeScale in
   coursegen.js. If the carve used a clean ellipse while the lie test used a
   wobbled one, the sand you can see and the sand the ball reacts to would be
   different shapes. */
function ellipseQ(x, z, e) {
  const [dx, dz] = localOffset(x, z, e);
  const k = edgeScale(e, dx, dz);
  return Math.sqrt((dx * dx) / (e.rx * e.rx * k * k) + (dz * dz) / (e.rz * e.rz * k * k));
}

/* ------------------------------------------------------------------ cache */
const _models = new Map();
export function terrainFor(hole, biome) {
  const key = hole.courseId + ':' + hole.number;
  let m = _models.get(key);
  if (!m) { m = new TerrainModel(hole, biome); _models.set(key, m); }
  return m;
}
