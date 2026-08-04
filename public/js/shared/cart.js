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
   BASE_SPEED_KMH is the number to change, and it is what a cart with nothing
   bought actually does.  It was derived the wrong way round before: 24 was
   the FULLY UPGRADED top, which left a stock cart at 15 km/h — most players
   own no upgrades, so most players got the slowest cart in the game.  Now 24
   is the floor everyone gets, and the shop takes it to 31 rather than being
   the price of admission to a usable speed. */
export const KMH = 3.6;                        // m/s -> km/h, used all over the HUD
export const BASE_SPEED_KMH = 32;              // stock, on a flat fairway
export const MAX_BOOST = 1.3;                  // cart tune x Pitstop at Legend
export const TOP_SPEED_KMH = BASE_SPEED_KMH * MAX_BOOST;   // 41.6 fully upgraded
export const MAX_FWD = BASE_SPEED_KMH / KMH;   // 8.89 m/s stock
export const MAX_REV = 1.8;       // reverse is a crawl, as it should be
export const A_DRIVE = 3.9;       // m/s² at full pull — see the heavy-start ramp below
export const A_DRIVE_REV = 1.3;
export const A_BRAKE = 6.0;       // about 1.8 s from flat out
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
export const A_LAT_MAX = 6.2;       // m/s² — this alone decides cart vs go-kart.
                                    // Raised with the top speed: at 24 km/h a
                                    // 5.0 limit cornered tidily, but the same
                                    // grip at 32 turns every bend into a slide
                                    // and the cart stops answering the wheel.

/* ------------------------------------------------------------- collision */
export const HIT_RATE = { tree: 9.0, bank: 5.5, fence: 4.0 };
export const IMPACT = { tree: 0.45, bank: 0.25, fence: 0.15 };
export const CRASH_SPEED = 9.5;     // a genuinely head-on hit at speed
export const RESTITUTION = 0.32;    // how much of the closing speed bounces back
export const YAW_KICK = 2.6;        // rad/s of spin from a glancing blow
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
    this.impactYaw = 0;             // rad/s of spin owed from a collision
    this.stunned = 0;               // seconds of no-throttle after a big hit
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

    /* A heavy square impact stalls it briefly — the throttle does nothing
       while the driver is picking themselves up, which is what stops a
       crash being something you drive straight out of. */
    if (this.stunned > 0) {
      this.stunned -= dt;
      input = { throttle: 0, steer: input?.steer || 0, handbrake: false };
    }

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
      let dh = -(this.speed * Math.tan(this.steer) / WHEELBASE) * dt;
      /* Spin left over from a glancing impact, bled off over about a third of
         a second.  This is what makes a clipped tree turn the cart instead of
         just slowing it — steering is the driver's input, this is the world
         pushing back, and they add. */
      if (this.impactYaw) {
        dh += this.impactYaw * dt;
        this.impactYaw *= Math.max(0, 1 - dt * 3.2);
        if (Math.abs(this.impactYaw) < 1e-3) this.impactYaw = 0;
      }
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
    if (cx !== nx || cz !== nz) {
      // the normal points back in off whichever edge we ran into
      const fnX = cx !== nx ? (nx > cx ? -1 : 1) : 0;
      const fnZ = cz !== nz ? (nz > cz ? -1 : 1) : 0;
      nx = cx; nz = cz;
      this._deflect(fnX, fnZ, 'fence');
      touching = true;
    }

    /* trees: push out along the normal and scrub speed */
    const trees = hole.trees;
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      const solid = (t.species === 'gorse' ? t.r * 0.85 : Math.max(0.2, t.r * 0.16)) + PROBE_R;
      const ddx = nx - t.x, ddz = nz - t.z;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 < solid * solid && d2 > 1e-9) {
        const d = Math.sqrt(d2);
        const nX = ddx / d, nZ = ddz / d;          // surface normal, out of the trunk
        nx = t.x + nX * solid;
        nz = t.z + nZ * solid;
        this._deflect(nX, nZ, 'tree');
        touching = true;
      }
    }

    /* Greens and bunkers: the wheels simply refuse.  Water does NOT refuse —
       you are free to drive into the lake, and the cart will do exactly what
       a cart does in a lake.  Spawning still checks water via drivable(). */
    const blockedHere = (x, z) => surfFor(terrain.surfaceAt(x, z).id).block
      && terrain.waterAt(x, z) === null;
    if (blockedHere(nx, nz)) {
      /* Slide along the edge rather than along the world axes.  Axis-aligned
         sliding made every green and bunker feel like a square block: you
         could be scraping a curved bunker lip and the cart would jerk to due
         north.  Sampling which way is still legal gives the actual edge
         direction, so the cart follows the shape it is touching. */
      const alongX = !blockedHere(nx, fromZ);
      const alongZ = !blockedHere(fromX, nz);
      if (alongX) { nz = fromZ; this._deflect(0, nz > fromZ ? -1 : 1, 'bank'); }
      else if (alongZ) { nx = fromX; this._deflect(nx > fromX ? -1 : 1, 0, 'bank'); }
      else {
        // cornered: back out the way we came in
        const bx = fromX - nx, bz = fromZ - nz;
        const bl = Math.hypot(bx, bz) || 1;
        nx = fromX; nz = fromZ;
        this._deflect(bx / bl, bz / bl, 'bank');
      }
      touching = true;
    }
    // deep water drags hard at the wheels the moment you are in it
    if (terrain.waterAt(nx, nz) !== null) this.speed *= Math.max(0, 1 - 3.5 * SUB_DT);

    this.x = nx; this.z = nz;
    this._wasTouching = touching;
  }

  /**
   * Hit something solid.  (nX, nZ) is the surface normal pointing back out of
   * whatever we hit.  Edge-triggered, so a long scrape is one accident.
   *
   * This used to be `_scrub`, and all it did was multiply the speed down —
   * with a special case that set speed to EXACTLY ZERO for any tree hit above
   * CRASH_SPEED.  That is why collisions looked so bad: the cart stopped dead
   * against an invisible wall, kept pointing the same way it had been, and
   * then jittered as the push-out fought the throttle.  Nothing ever turned
   * the cart, so a wheel-brush at 30° and a head-on hit looked identical.
   *
   * Now the angle decides.  Head-on kills the speed and bounces back a
   * little; a glancing blow keeps most of the momentum, scrapes along the
   * surface, and yaws the cart away from what it clipped — which is what a
   * real vehicle does and what the eye is expecting to see.
   */
  _deflect(nX, nZ, what) {
    const first = !this._wasTouching;
    const sp = this.speed;
    if (Math.abs(sp) < 0.05) return;

    /* A proper reflection, not a scaling.
       -----------------------------------------------------------------
       The previous version multiplied the speed down and added a yaw kick,
       which meant the cart never actually CHANGED DIRECTION at a collision —
       it slowed, twitched, and carried on the way it was pointing. That is
       why hitting things looked so poor: nothing on screen matched what a
       vehicle does when it strikes something.

       This reflects the velocity about the contact normal the way a real
       impact does:

           v' = v - (1 + e)(v·n)n

       so a shallow clip skims off along the obstacle keeping most of its
       speed, and a square hit reverses out. The heading follows the
       reflected vector, which is the part you can actually see. */
    const dirX = Math.sin(this.heading), dirZ = Math.cos(this.heading);
    // velocity in world terms, signed so reverse behaves too
    let vx = dirX * sp, vz = dirZ * sp;

    const into = vx * nX + vz * nZ;             // <0 means moving into it
    if (into >= 0) return;                      // already leaving; don't grab it

    const head = Math.min(1, Math.abs(into) / Math.max(1e-3, Math.abs(sp)));
    const e = RESTITUTION * (0.35 + 0.65 * head);   // square hits bounce most
    vx -= (1 + e) * into * nX;
    vz -= (1 + e) * into * nZ;

    /* Friction along the surface: a cart scraping a trunk sheds speed on the
       tangent as well, or a glancing blow would cost nothing at all. */
    const mu = (what === 'tree' ? 0.30 : what === 'bank' ? 0.20 : 0.12) * (first ? 1 : 0.20);
    const tX = -nZ, tZ = nX;
    const along = vx * tX + vz * tZ;
    vx -= along * mu * tX;
    vz -= along * mu * tZ;

    const newSp = Math.hypot(vx, vz);
    if (newSp > 0.08) {
      this.heading = Math.atan2(vx, vz);
      this.speed = Math.sign(sp) * Math.min(newSp, ABS_MAX);
    } else {
      this.speed = 0;
    }

    if (first) {
      this.hit = Math.max(this.hit, Math.min(1, (Math.abs(sp) / MAX_FWD) * (0.4 + 0.6 * head)));
      /* Spin, and enough of it to see. A clipped wing sends a real cart
         slewing; the old kick was bled off in a sixth of a second and read
         as a wobble. Scaled by how GLANCING the hit was — a square impact
         stops you, it does not spin you. */
      const side = nX * dirZ - nZ * dirX;
      const glance = 1 - head;
      /* Clamped: repeated contact while the throttle is still held into the
         obstacle would otherwise stack kick on kick and spin the cart like a
         top. One clip should slew you, not launch you into orbit. */
      const kick = side * glance * YAW_KICK * (Math.abs(sp) / MAX_FWD);
      this.impactYaw = clamp((this.impactYaw || 0) + kick, -2.6, 2.6);
      // and a genuinely heavy square hit stalls the drivetrain for a beat
      if (what === 'tree' && head > 0.7 && Math.abs(sp) > CRASH_SPEED) this.stunned = 0.45;
    }
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
