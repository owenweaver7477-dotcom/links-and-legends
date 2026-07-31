/* =========================================================================
   cart.js — how a golf cart drives
   -------------------------------------------------------------------------
   A bicycle model over the real terrain: the state origin is the REAR AXLE,
   the front wheels steer, and gravity along the slope means a hill actually
   costs you something.  No Three.js, no DOM — this runs in Node so the test
   suite can drive a cart into all 174 trees on all 45 holes without a browser.

   Heading matches walker.js: heading = atan2(vx, vz), so forward is
   (sin h, cos h), right is (cos h, -sin h), and a positive steer turns right.
   ========================================================================= */

import { clamp } from './rng.js';

/* ------------------------------------------------------------- geometry */
export const WHEELBASE = 1.65;    // m, rear axle to front axle
export const TRACK = 1.04;        // m, left wheel to right wheel
export const WHEEL_R = 0.245;     // m — also the chassis ride height
export const PROBE_R = 0.68;      // m, collision circle at each axle
export const BODY_LEN = 2.42;

/* Seats, in the rear-axle frame. x is +right, z is +forward.
   `y` is where the golfer's ROOT sits — the soles of their feet, in the
   footwell — not the cushion.  The avatar rig is a standing figure whose
   thighs rotate forward to sit, so it does not shorten; lifting the root to
   cushion height would push the golfer's head clean through the roof. */
export const SEATS = {
  // y sets the avatar root so the seated torso lands ON the cushion: the
  // bench top sits WHEEL_R + 0.27 = 0.515 m up, and the seated pose puts the
  // torso base 0.597 m above the root, so the root belongs just below ground
  driver:    { x: -0.40, y: -0.06, z: 0.545 },
  passenger: { x:  0.40, y: -0.06, z: 0.545 }
};

/* --------------------------------------------------------------- motion
   A golf cart is not a go-kart.  A real one is governed to about 24 km/h and a
   tuned one tops out around 35, which is where these numbers now sit: 6.1 m/s
   stock, and 9.72 m/s — exactly 35 km/h — with the cart tune and Pitstop at
   Legend.  It was 22 m/s (79 km/h) before, which flattered the course scale
   and made every drive across a fairway feel like a getaway. */
export const KMH = 3.6;                        // m/s -> km/h, used all over the HUD
export const TOP_SPEED_KMH = 35;               // fully upgraded, on a flat fairway
export const MAX_BOOST = 1.6;                  // cart tune x Pitstop at Legend
export const MAX_FWD = TOP_SPEED_KMH / KMH / MAX_BOOST;   // 6.08 m/s stock
export const MAX_REV = 1.6;       // reverse is a crawl, as it should be
export const A_DRIVE = 3.4;       // m/s² at full pull — see the heavy-start ramp below
export const A_DRIVE_REV = 1.2;
export const A_BRAKE = 5.5;       // about 1.8 s from flat out
export const A_HAND = 6.0;        // handbrake
export const ENGINE_BRAKE = 0.75; // coasting with the pedal up. Deliberately
                                  // weaker than gravity on anything above the
                                  // park grade, or a cart would sit on a hill
                                  // with the brake off and never roll.
export const C_AERO = 0.012;      // 1/m
export const ABS_MAX = TOP_SPEED_KMH / KMH + 2;  // hard ceiling just above the
                                  // fully boosted top speed, so a downhill run
                                  // can overspeed a little but never fly

/* --------------------------------------------------------------- slopes */
export const G = 9.81;
export const MAX_GRADE = 0.55;
export const DOWNHILL_GAIN = 0.75;  // asymmetric: real carts have a downhill
                                    // governor, so a descent gives back less
                                    // than a climb takes.  The speed governor
                                    // below is what actually stops a runaway.
export const SLOPE_EPS = 1.15;      // ~0.7 × wheelbase: don't fight bumps
                                    // shorter than the vehicle

/* -------------------------------------------------------------- steering */
export const MAX_STEER = 0.62;      // rad ≈ 35.5°, 2.29 m turning radius at rest
export const STEER_RATE = 2.4;      // rad/s toward the input
export const STEER_RETURN = 3.6;    // rad/s back to centre when released
export const A_LAT_MAX = 5.0;       // m/s² — this alone decides cart vs go-kart

/* ------------------------------------------------------------- collision */
export const HIT_RATE = { tree: 9.0, bank: 5.5, fence: 4.0 };
export const IMPACT = { tree: 0.45, bank: 0.25, fence: 0.15 };
export const CRASH_SPEED = 7.0;     // above this a tree stops you dead
export const FENCE_INSET = 4;       // m inside the hole bounds

/* ------------------------------------------------------------ integration */
export const SUB_DT = 1 / 240;   // doubled with the top speed: accuracy scales with it
export const MAX_SUB = 26;          // covers a full 0.1 s clamped frame
export const PARK_GRADE = 0.12;
export const PARK_SPEED = 0.35;

/* ------------------------------------------------------------- lifecycle */
export const CART_TTL_MS = 1200;    // 12 consecutive dropped position packets
export const BOARD_RADIUS = 3.0;
export const HAIL_RADIUS = 12;

/**
 * Per-surface driving.  `top` scales the speed limit only — never the
 * position step, because scaling the step teleport-pops the cart across a
 * surface seam.  `block` means the wheels will not go there at all.
 *
 * Note this deliberately allows rough: real golf carts drive on rough
 * constantly.  What they are actually banned from is the putting surface and
 * the bunkers, which is exactly what is blocked here.
 */
export const CART_SURF = {
  tee:     { top: 0.55, crr: 0.030, grip: 1.00, block: false },
  fairway: { top: 1.00, crr: 0.035, grip: 1.00, block: false },
  fringe:  { top: 0.72, crr: 0.040, grip: 0.95, block: false },
  green:   { top: 0.00, crr: 0.030, grip: 1.00, block: true },
  rough:   { top: 0.86, crr: 0.055, grip: 0.90, block: false },
  deep:    { top: 0.62, crr: 0.085, grip: 0.78, block: false },
  waste:   { top: 0.70, crr: 0.060, grip: 0.72, block: false },
  sand:    { top: 0.34, crr: 0.160, grip: 0.55, block: true },
  water:   { top: 0.00, crr: 3.000, grip: 0.30, block: true },
  ob:      { top: 0.55, crr: 0.070, grip: 0.85, block: false },
  // unreachable today — surfaceAt() never returns it — but present so that
  // adding real cart paths one day needs no change here
  path:    { top: 1.15, crr: 0.020, grip: 1.05, block: false }
};
const DEFAULT_SURF = CART_SURF.rough;
export const surfFor = id => CART_SURF[id] || DEFAULT_SURF;

/** Is this spot legal to put a wheel on? */
export function drivable(terrain, x, z) {
  return !surfFor(terrain.surfaceAt(x, z).id).block && terrain.waterAt(x, z) === null;
}

/**
 * Nearest legal spot to spawn a cart, searching outward in rings.  Returns
 * null if there is nowhere within 24 m — which happens if you are standing in
 * the middle of a green, and is refused with a toast rather than silently
 * dropping you somewhere odd.
 */
export function nearestDrivable(terrain, x, z) {
  if (drivable(terrain, x, z)) return { x, z };
  for (const r of [3, 6, 9, 13, 18, 24]) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (drivable(terrain, px, pz)) return { x: px, z: pz };
    }
  }
  return null;
}

/* ========================================================================= */

export class CartBody {
  constructor(x = 0, z = 0, heading = 0) {
    this.x = x; this.z = z;
    this.heading = heading;
    this.speed = 0;                 // m/s along the heading, signed
    this.steer = 0;                 // rad, + = right
    this.hit = 0;                   // 0..1, decays — drives the crunch effects
    this._wasTouching = false;      // edge trigger, so a scrape isn't a crash
    this.odo = 0;                   // m, for spinning the wheels
    this.boost = 1;                 // the shop's cart tune: multiplies top and motor
  }

  set(x, z, heading, speed = 0) {
    this.x = x; this.z = z; this.heading = heading; this.speed = speed;
    this.steer = 0;
  }

  /**
   * Advance the cart.
   *
   * @param dt       seconds since the last frame (already clamped by caller)
   * @param input    { throttle -1..1, steer -1..1, handbrake bool }
   * @param terrain  TerrainModel
   * @param hole     hole data — trees and bounds
   */
  step(dt, input, terrain, hole) {
    if (!(dt > 0)) return;
    // Fixed substeps: the result must be identical at 30 and 144 fps, and a
    // variable step would let a slow machine drive through a tree trunk.
    const n = Math.min(MAX_SUB, Math.max(1, Math.ceil(dt / SUB_DT)));
    const h = dt / n;
    for (let i = 0; i < n; i++) this._sub(h, input, terrain, hole);
    this.hit = Math.max(0, this.hit - dt * 2.2);
  }

  _sub(dt, input, terrain, hole) {
    const surf = surfFor(terrain.surfaceAt(this.x, this.z).id);

    /* ---------------------------------------------------------- steering */
    const want = clamp(input.steer || 0, -1, 1) * MAX_STEER;
    const rate = Math.abs(want) < 1e-3 ? STEER_RETURN : STEER_RATE;
    // Rate-limited, not eased: an exponential ease is framerate-dependent at
    // the 20% level by 30 fps, and this has to be identical at every rate.
    const dsteer = clamp(want - this.steer, -rate * dt, rate * dt);
    this.steer += dsteer;

    // Don't let it corner harder than the tyres can hold: a_lat = v² tanδ / L.
    const v2 = this.speed * this.speed;
    if (v2 > 0.5) {
      const maxTan = (A_LAT_MAX * surf.grip * WHEELBASE) / v2;
      const maxSteer = Math.atan(maxTan);
      this.steer = clamp(this.steer, -maxSteer, maxSteer);
    }
    this.steer = clamp(this.steer, -MAX_STEER, MAX_STEER);

    /* ------------------------------------------------------------- slope */
    const nrm = terrain.normalAt(this.x, this.z, SLOPE_EPS);
    const sinH = Math.sin(this.heading), cosH = Math.cos(this.heading);
    // grade along the direction of travel; + = climbing
    const grade = clamp(
      -(nrm[0] * sinH + nrm[2] * cosH) / (nrm[1] || 1e-6),
      -MAX_GRADE, MAX_GRADE
    );
    const aSlope = -G * grade * (grade > 0 ? 1 : DOWNHILL_GAIN) * (nrm[1] * nrm[1]);

    /* ------------------------------------------------------------ engine */
    const thr = clamp(input.throttle || 0, -1, 1);
    const vTop = MAX_FWD * surf.top * this.boost;
    let a = aSlope;

    if (input.handbrake) {
      a -= Math.sign(this.speed) * A_HAND;
      if (Math.abs(this.speed) < A_HAND * dt) { this.speed = 0; a = aSlope; }
    } else if (thr > 0.01) {
      // Pressing forward while rolling backwards is a brake, not a gear
      // change.  And a cart at rest is HEAVY: barely a third of the motor
      // until it is rolling, so pulling away feels like mass, not a go-kart.
      const heavy = 0.35 + 0.65 * Math.min(1, Math.abs(this.speed) / 6);
      a += this.speed < -0.2 ? A_BRAKE
        : A_DRIVE * this.boost * heavy * thr * (this.speed < vTop ? 1 : 0);
    } else if (thr < -0.01) {
      a += this.speed > 0.2 ? -A_BRAKE : -A_DRIVE_REV * -thr * (this.speed > -MAX_REV ? 1 : 0);
    } else if (Math.abs(this.speed) > 0.01) {
      a -= Math.sign(this.speed) * ENGINE_BRAKE;
    }

    // rolling resistance and drag always oppose motion
    if (Math.abs(this.speed) > 0.01) {
      a -= Math.sign(this.speed) * surf.crr * G;
      a -= Math.sign(this.speed) * C_AERO * v2;
    }

    this.speed += a * dt;
    this.speed = clamp(this.speed, -ABS_MAX, ABS_MAX);
    // the governor pulls you back to the surface limit rather than clipping
    if (this.speed > vTop) this.speed -= Math.min(this.speed - vTop, 6.0 * dt);
    if (this.speed < -MAX_REV) this.speed += Math.min(-MAX_REV - this.speed, 6.0 * dt);

    // park: below walking pace on gentle ground with no pedal, just stop
    if (!input.handbrake && Math.abs(thr) < 0.01 &&
        Math.abs(this.speed) < PARK_SPEED && Math.abs(grade) < PARK_GRADE) {
      this.speed = 0;
    }

    /* --------------------------------------------------------- kinematics */
    if (Math.abs(this.speed) > 1e-5) {
      // Bicycle model about the rear axle.  The position step uses the MIDPOINT
      // heading rather than the end-point: stepping along the final heading is
      // first-order and makes a hard corner depend on the frame rate — 60 fps
      // and 144 fps ended a six-second full-lock turn 0.8 m apart before this.
      //
      // Note the MINUS.  Forward is (sin h, cos h) and up is +Y, so in this
      // right-handed frame the driver's right hand points along (-cos h, sin h)
      // — which is the direction you reach by DECREASING h.  Turning right is
      // therefore -dh, not +dh; getting this backwards swaps A and D.
      const dh = -(this.speed * Math.tan(this.steer) / WHEELBASE) * dt;
      const mid = this.heading + dh * 0.5;
      this.heading += dh;
      const s = Math.sin(mid), c = Math.cos(mid);
      this._move(s * this.speed * dt, c * this.speed * dt, terrain, hole);
      this.odo += Math.abs(this.speed) * dt;
    }
  }

  /** Step the position, then refuse anything the wheels cannot go on. */
  _move(dx, dz, terrain, hole) {
    const fromX = this.x, fromZ = this.z;
    let nx = this.x + dx, nz = this.z + dz;
    let touching = false;

    /* the fence: stay inside the hole */
    const b = hole.bounds;
    const cx = clamp(nx, b.minX + FENCE_INSET, b.maxX - FENCE_INSET);
    const cz = clamp(nz, b.minZ + FENCE_INSET, b.maxZ - FENCE_INSET);
    if (cx !== nx || cz !== nz) { nx = cx; nz = cz; this._scrub('fence'); touching = true; }

    /* trees: push out along the normal and scrub speed */
    const trees = hole.trees;
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      const solid = (t.species === 'gorse' ? t.r * 0.85 : Math.max(0.2, t.r * 0.16)) + PROBE_R;
      const ddx = nx - t.x, ddz = nz - t.z;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 < solid * solid && d2 > 1e-9) {
        const d = Math.sqrt(d2);
        nx = t.x + (ddx / d) * solid;
        nz = t.z + (ddz / d) * solid;
        this._scrub('tree');
        touching = true;
      }
    }

    /* Greens and bunkers: the wheels simply refuse.  Water does NOT refuse —
       you are free to drive into the lake, and the cart will do exactly what
       a cart does in a lake.  Spawning still checks water via drivable(). */
    const blockedHere = (x, z) => surfFor(terrain.surfaceAt(x, z).id).block
      && terrain.waterAt(x, z) === null;
    if (blockedHere(nx, nz)) {
      const alongX = !blockedHere(nx, fromZ);
      const alongZ = !blockedHere(fromX, nz);
      if (alongX) { nz = fromZ; }
      else if (alongZ) { nx = fromX; }
      else { nx = fromX; nz = fromZ; }
      this._scrub('bank');
      touching = true;
    }
    // deep water drags hard at the wheels the moment you are in it
    if (terrain.waterAt(nx, nz) !== null) this.speed *= Math.max(0, 1 - 3.5 * SUB_DT);

    this.x = nx; this.z = nz;
    this._wasTouching = touching;
  }

  /** Lose speed on contact.  Edge-triggered, so a scrape is not a crash. */
  _scrub(what) {
    const first = !this._wasTouching;
    const sp = Math.abs(this.speed);
    if (what === 'tree' && first && sp > CRASH_SPEED) {
      this.speed = 0;
      this.hit = 1;
      return;
    }
    this.speed *= (1 - IMPACT[what] * (first ? 1 : 0.25));
    if (first) this.hit = Math.max(this.hit, Math.min(1, sp / MAX_FWD));
  }

  /** World position of a seat. */
  seat(which) {
    const s = SEATS[which] || SEATS.driver;
    const sinH = Math.sin(this.heading), cosH = Math.cos(this.heading);
    return {
      x: this.x + sinH * s.z + cosH * s.x,
      z: this.z + cosH * s.z - sinH * s.x,
      y: s.y
    };
  }
}
