/* =========================================================================
   ballistics.js — 3D shot simulation: flight, bounce, roll
   -------------------------------------------------------------------------
   A real golf ball is 45.9 g and 42.7 mm across, and it stays in the air
   because it is spinning: backspin generates lift (the Magnus effect), which
   is why a wedge climbs and a topped drive does not.  That is modelled here,
   along with drag, wind, the bounce when it lands, and the roll-out.

   Everything is a pure function of (lie, club, power, aim, spin, wind) with a
   fixed timestep, so every client simulates the identical shot.  No Math.random.
   ========================================================================= */

import { CLUBS, CLUB_BY_KEY, CARRY } from './clubs.js';
import { SURFACES } from './terrain.js';
import { clamp } from './rng.js';
import { gearEffect } from './gear.js';
import { crewEffect } from './crew.js';
import { canopyOf } from './biomes.js';
import { PROP_KINDS } from './props.js';

/* ------------------------------------------------------------- constants */
const G = 9.80665;
// A rolling solid sphere climbs and falls at 5/7 g — see _stepGround.
const ROLL_G = G * 5 / 7;
// How far clear of the water a penalty drop should sit: two club lengths.
const DROP_CLEAR = 4.5;
// And how far it must move on from the spot the shot was played, so a hazard
// right in front of the ball can never hand it back for an identical replay.
const MIN_DROP_ADVANCE = 6;
const MASS = 0.0459;             // kg
const RADIUS = 0.02135;          // m
const AREA = Math.PI * RADIUS * RADIUS;
const RHO = 1.225;               // kg/m³, sea level
const DT = 1 / 400;              // fixed integration step
const MAX_TOTAL_S = 40;

const REST_SPEED = 0.10;         // m/s — below this on the ground, it has stopped
const HOLE_CAPTURE_SPEED = 1.55; // m/s — faster than this and it lips out
const RPM = Math.PI / 30;        // rpm -> rad/s

/* Drag and lift coefficients for a dimpled ball as a function of spin ratio
   S = r·ω / v.  These curves are the standard empirical fit and give carries
   that line up with real launch-monitor numbers. */
function coeffs(v, omega) {
  const S = v > 0.5 ? clamp((RADIUS * omega) / v, 0, 0.5) : 0;
  const Cl = 0.250 * S / (S + 0.030);         // saturates ~0.22, rises fast at low spin
  const Cd = 0.210 + 0.27 * S;
  return { Cl, Cd };
}

/* =========================================================================
   ShotSim
   ========================================================================= */
export class ShotSim {
  /**
   * @param {TerrainModel} terrain
   * @param {object} shot  {x,z, clubKey, power 0..1, aim (rad), faceDeg, attackDeg, wind:{dir,speed}}
   */
  constructor(terrain, shot) {
    const T = this.T = terrain;
    const hole = this.hole = terrain.hole;
    const club = this.club = CLUB_BY_KEY[shot.clubKey] || CLUBS[0];

    const lieSurface = T.surfaceAt(shot.x, shot.z);
    this.lieSurface = lieSurface;
    this.lie = { x: shot.x, z: shot.z };

    // Overswings are admitted up to 1.12 — the server accepts them and the
    // meter sends them, so the sim must see them too: the purity penalty
    // below and Steady's overswing damping both key off power > 1.
    const power = clamp(shot.power, 0, 1.12);
    this.power = power;

    // A bad lie costs you speed and kills spin — you cannot spin it out of deep
    // rough.  These are deliberately harsher than they were: missing the
    // fairway used to cost about a club, which is not a penalty, it is a
    // rounding error.  Now it is the difference between reaching and laying up.
    const lieSpeed = lieSurface.id === 'sand' ? 0.64
      : lieSurface.id === 'deep' ? 0.56
        : lieSurface.id === 'rough' ? 0.80
          : lieSurface.id === 'waste' ? 0.72
            : lieSurface.id === 'path' ? 1.0 : 1.0;
    const lieSpin = lieSurface.spinKeep;

    // The Caddie Crew and the club set, applied by whoever runs this sim
    // from whatever the server has on file.  All exact 1s and 0s when absent.
    const cfx = this.cfx = crewEffect(shot.crew, shot.clubTier, shot.refine, {
      power, isPutt: !!club.putter, afterBadHole: !!shot.afterBadHole
    });

    // strike quality: faceDeg is where the face pointed relative to the aim,
    // attackDeg trims launch (thin vs fat).  Ace and a forgiving set tighten
    // the face BEFORE physics sees it — a mishit with a good bag mishits less.
    const face = (shot.faceDeg || 0) * (1 - cfx.faceDamp);
    const attack = shot.attackDeg || 0;

    // Equipment: the shot carries the gear the SERVER holds for this player,
    // so an upgraded ball or forged irons change the flight for real — and a
    // shot with no gear multiplies by exactly 1 everywhere.
    const fx = gearEffect(shot.gear, club);
    /* The weather, as two numbers that ride on the shot the same way gear
       does. `carry` is on the ball speed, so cold dense air and rain cost
       distance in the air; `roll` is held for _stepGround, because a wet
       fairway is not a shorter carry, it is a ball that stops dead when it
       lands. Defaulting both to 1 means every existing caller — the caddie's
       probes, the tests, a shot taken before the weather arrived — behaves
       exactly as it did. */
    this.wx = shot.weather || null;
    const wCarry = this.wx?.carry ?? 1;
    this.rollMul = this.wx?.roll ?? 1;
    let speed = club.speed * power * Math.min(1, lieSpeed + cfx.lieMercy) * fx.speed * cfx.speed * wCarry;
    let launch = club.launch + attack;
    if (lieSurface.id === 'sand') launch += 5;         // you have to dig it out
    if (lieSurface.id === 'deep' || lieSurface.id === 'rough') launch += 2.5;
    launch = clamp(launch, -8, 62);

    // Direction: aim, pushed by the face angle.  An open face has to actually
    // send the ball somewhere — at 0.55 a three-degree miss pushed the ball
    // less than two degrees and every mishit still found the green.
    const dir = shot.aim + face * (Math.PI / 180) * 0.78;

    const lr = launch * Math.PI / 180;
    const groundY = T.heightAt(shot.x, shot.z);
    this.p = { x: shot.x, y: groundY + RADIUS + 0.004, z: shot.z };
    this.v = {
      x: Math.sin(dir) * speed * Math.cos(lr),
      y: speed * Math.sin(lr),
      z: Math.cos(dir) * speed * Math.cos(lr)
    };

    // Spin: backspin about the axis perpendicular to travel, sidespin about
    // vertical.  A PURE strike earns extra backspin, and the more loft on the
    // club the more there is to earn — a flushed wedge checks up hard, a
    // flushed driver barely differs, and nothing extra comes out of a mishit
    // or an overswing.  This is why a good wedge player can attack pins.
    const purity = clamp(1 - Math.abs(face) / 6 - Math.max(0, power - 1) * 2.5, 0, 1);
    const spinReward = 1 + purity * (club.loft / 64) * 0.30;
    const backspin = club.spin * (0.55 + 0.45 * power) * lieSpin * spinReward * fx.spin;
    const sidespin = face * club.curve * 330 * lieSpin;   // rpm per degree of face
    this.spinBack = backspin * RPM;
    this.spinSide = sidespin * RPM;
    this.dir0 = dir;

    this.wind = shot.wind || { dir: 0, speed: 0 };
    const windKeep = 1 - cfx.windDamp;               // Gale, reading the gusts
    this.windV = {
      x: Math.sin(this.wind.dir) * this.wind.speed * windKeep,
      z: Math.cos(this.wind.dir) * this.wind.speed * windKeep
    };

    this.t = 0;
    this.airborne = !club.putter && speed * Math.sin(lr) > 0.4;
    this.result = null;
    this.events = [];
    this.path = [{ x: this.p.x, y: this.p.y, z: this.p.z }];
    this.apex = this.p.y;
    this.carry = 0;
    this.landed = null;
    this.bounces = 0;
    this._acc = 0;
    this._lipped = false;
    // the caddie measures roll distance, so its probes play the hole as if
    // the cup were not cut
    this.ignoreCup = !!shot.ignoreCup;
  }

  speed() { return Math.hypot(this.v.x, this.v.y, this.v.z); }

  /** Advance by elapsed wall time; runs only whole fixed steps so it stays exact. */
  advance(realDt) {
    if (this.result) return this.result;
    this._acc += Math.min(realDt, 0.4);
    let guard = 0;
    while (this._acc >= DT && !this.result && guard < 4000) {
      this._acc -= DT;
      guard++;
      this._step();
    }
    return this.result;
  }

  /** Run the whole shot with no animation — used for reporting and for the caddie. */
  runToEnd() {
    let guard = 0;
    while (!this.result && guard < 200000) { this._step(); guard++; }
    return this.result || this._stop('timeout');
  }

  /* ----------------------------------------------------------- one step */
  _step() {
    if (this.airborne) this._stepAir(); else this._stepGround();
    if (!this.result) {
      this.t += DT;
      if (this.t > MAX_TOTAL_S) this._stop('timeout');
    }
  }

  _stepAir() {
    const p = this.p, v = this.v;

    // velocity relative to the moving air
    const rx = v.x - this.windV.x, ry = v.y, rz = v.z - this.windV.z;
    const vr = Math.hypot(rx, ry, rz) || 1e-6;

    const omega = Math.hypot(this.spinBack, this.spinSide);
    const { Cl, Cd } = coeffs(vr, omega);

    const qA = 0.5 * RHO * AREA * vr * vr;
    const drag = qA * Cd / MASS;                      // magnitude of a/drag
    let ax = -drag * (rx / vr);
    let ay = -drag * (ry / vr);
    let az = -drag * (rz / vr);

    if (omega > 1) {
      // Magnus: a = (F/m) along (ω × v̂).  Backspin axis is horizontal and
      // perpendicular to the shot line; sidespin axis is vertical.
      const c = Math.cos(this.dir0), s = Math.sin(this.dir0);
      // unit backspin axis (points left of travel) so ω×v lifts the ball
      const bax = -c, bay = 0, baz = s;
      const wx = bax * this.spinBack, wy = this.spinSide, wz = baz * this.spinBack;
      // ω × v̂
      const ux = rx / vr, uy = ry / vr, uz = rz / vr;
      const cx = wy * uz - wz * uy;
      const cy = wz * ux - wx * uz;
      const cz = wx * uy - wy * ux;
      const cm = Math.hypot(cx, cy, cz) || 1e-6;
      const lift = qA * Cl / MASS;
      ax += lift * (cx / cm);
      ay += lift * (cy / cm);
      az += lift * (cz / cm);
    }

    ay -= G;

    v.x += ax * DT; v.y += ay * DT; v.z += az * DT;
    const nx = p.x + v.x * DT, ny = p.y + v.y * DT, nz = p.z + v.z * DT;

    // spin bleeds off in flight
    const decay = Math.exp(-DT / 22);
    this.spinBack *= decay;
    this.spinSide *= decay;

    if (ny > this.apex) this.apex = ny;

    // out of bounds while in the air still counts once it lands, so only test
    // the hard limits of the world here
    if (this._outOfWorld(nx, nz)) {
      p.x = nx; p.y = ny; p.z = nz;
      this._pushPath(true);
      return this._penalty('ob');
    }

    // did it splash?
    const wl = this.T.waterAt(nx, nz);
    if (wl !== null && ny <= wl) {
      p.x = nx; p.z = nz; p.y = wl;
      this._pushPath(true);
      this.events.push({ type: 'splash', x: nx, y: wl, z: nz, speed: this.speed() });
      return this._penalty('water');
    }

    // did it hit a tree — or a building?
    const hit = this._treeHit(p, nx, ny, nz) || this._propHit(nx, ny, nz);
    if (hit) {
      p.x = hit.x; p.y = hit.y; p.z = hit.z;
      this._pushPath(true);
      this.events.push({ type: 'tree', x: hit.x, y: hit.y, z: hit.z, speed: this.speed() });
      // kill most of the energy and knock it down
      v.x = hit.nx * this.speed() * 0.22 + v.x * 0.10;
      v.z = hit.nz * this.speed() * 0.22 + v.z * 0.10;
      v.y = -Math.abs(v.y) * 0.18 - 1.0;
      this.spinBack *= 0.2; this.spinSide *= 0.2;
      return;
    }

    // ground?
    const gy = this.T.heightAt(nx, nz);
    if (ny <= gy + RADIUS) {
      p.x = nx; p.z = nz; p.y = gy + RADIUS;
      this._pushPath(true);
      this._land();
      return;
    }

    p.x = nx; p.y = ny; p.z = nz;
    this._pushPath(false);
  }

  /** First touchdown, then each subsequent bounce. */
  _land() {
    const surf = this.T.surfaceAt(this.p.x, this.p.z);
    if (this.landed === null) {
      this.landed = { x: this.p.x, z: this.p.z, surf: surf.id };
      this.carry = Math.hypot(this.p.x - this.lie.x, this.p.z - this.lie.z);
      this.events.push({ type: 'land', x: this.p.x, y: this.p.y, z: this.p.z, surf: surf.id, speed: this.speed() });
    }
    if (surf.id === 'water') return this._penalty('water');

    const firm = this.T.bio.firmness || 1;
    const n = this.T.normalAt(this.p.x, this.p.z);
    const v = this.v;

    // split into normal and tangential components against the slope
    const vn = v.x * n[0] + v.y * n[1] + v.z * n[2];
    let tx = v.x - vn * n[0], ty = v.y - vn * n[1], tz = v.z - vn * n[2];

    let rest = surf.bounce * firm;
    // Backspin bites on the first bounce — this is the whole difference between
    // a wedge that checks up next to the flag and a driver that runs 20 more
    // metres.  spinBite is how much of the forward speed the turf steals.
    const spinBite = clamp(this.spinBack / 850, 0, 1) * surf.grab;
    const tangentKeep = clamp((1 - surf.grab * 0.74) - spinBite * 0.40, 0.05, 0.95);

    tx *= tangentKeep; ty *= tangentKeep; tz *= tangentKeep;

    // A heavily spinning ball also drags backwards along its own line, and a
    // really spinny wedge will hop and come back toward you.
    if (this.spinBack > 40 && this.bounces < 2) {
      const back = Math.min(6.0, this.spinBack * 0.0052) * surf.grab * (this.bounces === 0 ? 1 : 0.4);
      tx -= Math.sin(this.dir0) * back;
      tz -= Math.cos(this.dir0) * back;
    }

    const bounceN = -vn * rest;
    v.x = tx + bounceN * n[0];
    v.y = ty + bounceN * n[1];
    v.z = tz + bounceN * n[2];

    this.spinBack *= 0.35;
    this.spinSide *= 0.25;
    this.bounces++;

    this.events.push({ type: 'bounce', x: this.p.x, y: this.p.y, z: this.p.z, surf: surf.id, speed: this.speed() });

    // once it is barely hopping, hand over to rolling
    if (v.y < 1.1 || this.bounces > 7) {
      this.airborne = false;
      v.y = 0;
    }
  }

  /* --------------------------------------------------------- rolling out */
  _stepGround() {
    const p = this.p, v = this.v;
    const surf = this.T.surfaceAt(p.x, p.z);
    if (surf.id === 'water') return this._penalty('water');
    if (surf.id === 'ob') return this._penalty('ob');

    const n = this.T.normalAt(p.x, p.z);

    // Gravity along the slope makes the ball run downhill — this is what makes
    // reading a green matter.
    //
    // Mind the sign.  normalAt() returns nx = -dh/dx (see terrain.js), and the
    // tangential component of gravity on a plane of normal n is
    //     g - (g·n)n  with  g = (0,-G,0)   =>   a = (+G·ny·nx, …, +G·ny·nz)
    // so a slope RISING toward +x has nx < 0 and must accelerate the ball
    // toward -x.  The sign here was negated until 2026-07-30, which broke every
    // putt uphill: on a 4% fall a straight putt drifted 1.81 m the wrong way.
    //
    // ROLL_G is the other half of the physics.  A rolling sphere does not
    // accelerate down a slope at g·sinθ — some of the potential energy goes
    // into spinning it up, and for a solid sphere (I = 2/5 m r²) the tangential
    // acceleration is (5/7)·g·sinθ.  Using the full g made every green break
    // 40% harder than a real one, and a 3 m putt on a 2 % slope moved 56 cm
    // sideways where a real one moves about 20.
    const gax = ROLL_G * n[0] * n[1];
    const gaz = ROLL_G * n[2] * n[1];

    let sp = Math.hypot(v.x, v.z);

    // rolling resistance, scaled by how fast the greens are on this course
    const greenAdj = surf.id === 'green' || surf.id === 'fringe' ? (1 / (this.T.bio.greenSpeed || 1)) : 1;
    /* Wet ground grabs. `rollMul` below 1 means less roll, so it has to
       INCREASE the resistance — dividing rather than multiplying, which is
       the sort of sign error that would have made rain add fifty yards. */
    const mu = surf.roll * greenAdj / (this.rollMul || 1);
    const decel = mu * G;

    let ax = gax, az = gaz;
    if (sp > 1e-4) {
      ax -= decel * (v.x / sp);
      az -= decel * (v.z / sp);
    }

    v.x += ax * DT;
    v.z += az * DT;
    v.y = 0;

    const nx = p.x + v.x * DT, nz = p.z + v.z * DT;

    if (this._outOfWorld(nx, nz)) return this._penalty('ob');

    // trees are solid on the ground too
    const th = this._treeHitGround(nx, nz);
    if (th) {
      const s2 = Math.hypot(v.x, v.z);
      const dot = v.x * th.nx + v.z * th.nz;
      if (dot < 0) { v.x = (v.x - 2 * dot * th.nx) * 0.35; v.z = (v.z - 2 * dot * th.nz) * 0.35; }
      p.x = th.px; p.z = th.pz;
      if (s2 > 1.5) this.events.push({ type: 'tree', x: p.x, y: p.y, z: p.z, speed: s2 });
    } else {
      p.x = nx; p.z = nz;
    }
    p.y = this.T.heightAt(p.x, p.z) + RADIUS;
    this._pushPath(false);

    // the hole
    const cup = this.hole.cup;
    const dcup = this.ignoreCup ? Infinity : Math.hypot(p.x - cup.x, p.z - cup.z);
    sp = Math.hypot(v.x, v.z);
    const capture = HOLE_CAPTURE_SPEED * (1 + (this.cfx?.cupBonus || 0));
    if (dcup <= cup.r + RADIUS * 0.5 && sp <= capture) {
      this.events.push({ type: 'holed', x: cup.x, y: p.y, z: cup.z });
      return this._finish({ reason: 'holed', holed: true, penalty: 0, x: cup.x, z: cup.z, lie: 'green' });
    }
    // Too much pace: the ball catches the lip, loses most of its speed and is
    // thrown off line.  This must fire ONCE — applying it every step while the
    // ball is over the hole would be a 400 Hz impulse that scrambles the putt.
    if (!this._lipped && dcup <= cup.r + RADIUS && sp > capture && sp < capture * 2.6) {
      this._lipped = true;
      this.events.push({ type: 'lipout', x: cup.x, y: p.y, z: cup.z });
      // deflect away from whichever side of the hole it was already running
      const side = Math.sign((p.x - cup.x) * v.z - (p.z - cup.z) * v.x) || 1;
      const a = Math.atan2(v.x, v.z) + side * 0.42;
      const ns = sp * 0.45;
      v.x = Math.sin(a) * ns;
      v.z = Math.cos(a) * ns;
    }

    // A slope can hold a slow ball forever, so stop only when it is genuinely
    // still — but never during the first moments of the shot, or a gentle
    // tap-in would be declared finished before it had rolled anywhere.
    if (sp < REST_SPEED && this.t > 0.12) {
      const slope = Math.hypot(n[0], n[2]);
      if (slope < 0.09 || sp < 0.035) return this._stop('rest');
    }
  }

  /* ------------------------------------------------------------- endings */
  _stop(reason) {
    let { x, z } = this.p;
    const pushed = this._pushOutOfTrees(x, z);
    x = pushed.x; z = pushed.z;
    const surf = this.T.surfaceAt(x, z);
    if (surf.id === 'water') return this._penalty('water');
    if (surf.id === 'ob') return this._penalty('ob');

    const cup = this.hole.cup;
    if (!this.ignoreCup && Math.hypot(x - cup.x, z - cup.z) <= cup.r) {
      this.events.push({ type: 'holed', x: cup.x, y: this.p.y, z: cup.z });
      return this._finish({ reason: 'holed', holed: true, penalty: 0, x: cup.x, z: cup.z, lie: 'green' });
    }
    return this._finish({ reason, holed: false, penalty: 0, x, z, lie: surf.id });
  }

  /**
   * Water and OB.  Water drops you where the ball last crossed dry land on its
   * way in; OB sends you back to the previous lie, stroke and distance.
   */
  _penalty(kind) {
    if (kind === 'ob') {
      this.events.push({ type: 'ob', x: this.p.x, y: this.p.y, z: this.p.z });
      return this._finish({
        reason: 'ob', holed: false, penalty: 1,
        x: this.lie.x, z: this.lie.z,
        lie: this.T.surfaceAt(this.lie.x, this.lie.z).id
      });
    }

    // Walk back along the flight path for the last dry, playable, tree-free
    // spot — but take a PROPER drop, a couple of club lengths clear of the
    // water rather than in its face.  The last dry sample on the line is often
    // a metre from the edge, in the wet sand margin, which leaves the next
    // shot playing out of the hazard's lip for no reason the rules require.
    const entry = { x: this.p.x, z: this.p.z };
    const path = this.path;
    // A drop must never land back on the spot the shot was played from.  When
    // the water starts immediately in front of the ball, every point on the
    // flight line is wet except the origin — so the old walk-back handed the
    // ball straight back, the player replayed the identical shot, and the
    // hole became an unbreakable loop costing a stroke a time.  Relief is
    // taken AT THE HAZARD, so the drop has to make progress.
    const advanced = (x, z) =>
      Math.hypot(x - this.lie.x, z - this.lie.z) > MIN_DROP_ADVANCE;
    let drop = null;
    for (let i = path.length - 1; i >= 0 && !drop; i--) {
      const q = path[i];
      if (advanced(q.x, q.z) && this._dryPlayable(q.x, q.z) && this._clearOfWater(q.x, q.z)) {
        drop = { x: q.x, z: q.z };
      }
    }
    // no roomy spot on the line: the last dry one that still makes progress
    for (let i = path.length - 1; i >= 0 && !drop; i--) {
      const q = path[i];
      if (advanced(q.x, q.z) && this._dryPlayable(q.x, q.z)) drop = { x: q.x, z: q.z };
    }
    if (!drop) {
      // Nothing on the line — take relief beside the point of entry, working
      // outwards.  Preferring ground that ALSO advances on the lie keeps the
      // no-progress loop closed here too.
      let fallback = null;
      outer:
      for (let r = 2; r <= 60; r += 2) {
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * Math.PI * 2;
          const cx = entry.x + Math.cos(a) * r, cz = entry.z + Math.sin(a) * r;
          if (!this._dryPlayable(cx, cz)) continue;
          if (!fallback) fallback = { x: cx, z: cz };
          if (advanced(cx, cz)) { drop = { x: cx, z: cz }; break outer; }
        }
      }
      if (!drop) drop = fallback;
    }
    if (!drop) drop = { x: this.lie.x, z: this.lie.z };

    return this._finish({
      reason: 'water', holed: false, penalty: 1,
      x: drop.x, z: drop.z, lie: this.T.surfaceAt(drop.x, drop.z).id,
      splash: entry
    });
  }

  _dryPlayable(x, z) {
    const s = this.T.surfaceAt(x, z);
    if (s.id === 'water' || s.id === 'ob') return false;
    return !this._insideTree(x, z);
  }

  /** Room to swing: no water within a couple of club lengths. */
  _clearOfWater(x, z) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const cx = x + Math.cos(a) * DROP_CLEAR, cz = z + Math.sin(a) * DROP_CLEAR;
      if (this.T.surfaceAt(cx, cz).id === 'water') return false;
    }
    return true;
  }

  _finish(res) {
    res.carry = this.carry;
    res.apex = this.apex - this.T.heightAt(this.lie.x, this.lie.z);
    res.total = Math.hypot(res.x - this.lie.x, res.z - this.lie.z);
    res.flightTime = this.t;
    res.landed = this.landed;
    this.result = res;
    this.p.x = res.x; this.p.z = res.z;
    this.p.y = this.T.heightAt(res.x, res.z) + RADIUS;
    return res;
  }

  /* --------------------------------------------------------------- trees */
  _treeHit(p, nx, ny, nz) {
    const trees = this.hole.trees;
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      const dx = nx - t.x, dz = nz - t.z;
      const rr = t.r + RADIUS;
      if (dx * dx + dz * dz > rr * rr) continue;
      /* The canopy is an ELLIPSOID, not a cylinder, and it starts where the
         leaves actually start.

         This was a cylinder of full radius running from 0.28 of the tree's
         height to the top. A broadleaf is drawn as five lobes centred around
         0.68..1.00 of its height, the lowest of which bottoms out near 0.45 —
         so between 0.28 and 0.45 there was a band of solid, invisible canopy
         wrapped around a bare trunk. On a 19 m maple that is more than three
         metres of it, sitting exactly at the height a driver flies. Hitting a
         tree you were nowhere near is that band.

         The cylinder was also full width at the very top and bottom, where
         the real canopy has tapered to nothing. Matching the drawn shape
         fixes both at once. */
      const base = this.T.heightAt(t.x, t.z);
      const gorse = t.species === 'gorse';
      /* Where the leaves sit, from biomes.js — the same table the renderer
         normalises the drawn lobes against. A conifer's skirts start at a
         third of its height and a broadleaf's canopy at half, and having
         that inlined here as one number for every species is how the band
         of solid, invisible canopy around a bare trunk got in. */
      const [cyF, halfF] = canopyOf(t.species);
      const cy = base + t.h * cyF;
      const halfH = t.h * halfF;

      const trunkR = t.r * (gorse ? 0.9 : 0.14);
      const canopyHi = cy + halfH;
      const inTrunk = dx * dx + dz * dz <= (trunkR + RADIUS) * (trunkR + RADIUS) && ny <= canopyHi;

      // radius tapers with height, so the top and bottom of the mass are thin
      const u = (ny - cy) / halfH;
      let inCanopy = false;
      if (u > -1 && u < 1) {
        const rAt = (t.r + RADIUS) * Math.sqrt(1 - u * u);
        inCanopy = dx * dx + dz * dz <= rAt * rAt;
      }
      if (inCanopy || inTrunk) {
        const d = Math.hypot(dx, dz) || 1e-6;
        return { x: nx, y: ny, z: nz, nx: dx / d, nz: dz / d, tree: t };
      }
    }
    return null;
  }

  /* A hut is a building, and a ball does not go through one.
     Only the SOLID props (see props.js) — a bench and a bin are furniture
     the ball is welcome to rattle off the ground past, and making every
     sign a collider would turn the walk into an obstacle course. */
  _propHit(nx, ny, nz) {
    const props = this.hole.props;
    if (!props) return null;
    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      const k = PROP_KINDS[p.kind];
      if (!k || !k.solid) continue;
      const base = this.T.heightAt(p.x, p.z);
      if (ny > base + k.h) continue;                 // over the roof
      const dx = nx - p.x, dz = nz - p.z;
      const rr = k.r + RADIUS;
      if (dx * dx + dz * dz > rr * rr) continue;
      const d = Math.hypot(dx, dz) || 1e-6;
      return { x: nx, y: ny, z: nz, nx: dx / d, nz: dz / d };
    }
    return null;
  }

  _treeHitGround(nx, nz) {
    const trees = this.hole.trees;
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      const trunkR = (t.species === 'gorse' ? t.r * 0.85 : Math.max(0.16, t.r * 0.14)) + RADIUS;
      const dx = nx - t.x, dz = nz - t.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > trunkR * trunkR) continue;
      const d = Math.sqrt(d2) || 1e-6;
      return { nx: dx / d, nz: dz / d, px: t.x + (dx / d) * trunkR, pz: t.z + (dz / d) * trunkR };
    }
    return null;
  }

  _insideTree(x, z) {
    const trees = this.hole.trees;
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      const trunkR = (t.species === 'gorse' ? t.r * 0.85 : Math.max(0.16, t.r * 0.14)) + RADIUS;
      const dx = x - t.x, dz = z - t.z;
      if (dx * dx + dz * dz <= trunkR * trunkR) return true;
    }
    return false;
  }

  _pushOutOfTrees(x, z) {
    for (let pass = 0; pass < 4; pass++) {
      const h = this._treeHitGround(x, z);
      if (!h) break;
      x = h.px; z = h.pz;
    }
    return { x, z };
  }

  _outOfWorld(x, z) {
    const b = this.hole.bounds;
    return x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ;
  }

  _pushPath(force) {
    const p = this.p;
    const last = this.path[this.path.length - 1];
    const d = Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z);
    if (force || d > 0.6) this.path.push({ x: p.x, y: p.y, z: p.z });
  }
}

/* =========================================================================
   Helpers
   ========================================================================= */

/** Simulate a full shot without animating it. */
export function simulate(terrain, shot) {
  return new ShotSim(terrain, shot).runToEnd();
}

/**
 * The caddie's number: how hard to hit this club, from this lie, in this wind,
 * for the ball to finish `targetDist` metres away.  Binary search over a
 * monotonic-enough function; returns null if even a full swing comes up short.
 *
 * This is what the marker on the power meter points at, and it is the single
 * thing that makes the game playable rather than a guessing exercise.
 */
export function suggestedPower(terrain, x, z, clubKey, aim, wind, targetDist, gear = null, kit = null) {
  // `kit` carries the rest of the equipment room — { crew, clubTier, refine }.
  // The probe MUST swing the same ball the server will: a Signature Set with
  // a Legend Bruiser flies up to ~19% faster than a bare one, and a marker
  // calibrated for the bare ball would sail every green.
  const run = p => {
    const r = new ShotSim(terrain, {
      x, z, clubKey, power: p, aim, faceDeg: 0, attackDeg: 0, wind, gear,
      crew: kit?.crew || null,
      // null, not 0: no kit named means the reference ball, exactly as the
      // simulation treats it.  Defaulting to 0 would quietly price every
      // caller's marker for a Wooden Starter Set.
      clubTier: kit ? (kit.clubTier ?? 0) : null,
      refine: kit?.refine ?? 0,
      ignoreCup: true          // measure how far it ROLLS, not whether it drops
    }).runToEnd();
    // measure along the aim line, so a shot that leaks sideways is not
    // mistaken for a shot that came up short
    return (r.x - x) * Math.sin(aim) + (r.z - z) * Math.cos(aim);
  };
  const club = CLUB_BY_KEY[clubKey];
  if (!club) return null;
  if (run(1) < targetDist - 1e-6) return null;      // cannot get there

  // ...and you cannot hit a driver thirty metres. If even the softest swing
  // this club allows sails past the target there is no honest answer: say so,
  // the marker disappears, and that tells the player to change club.
  let lo = club.minPow * 0.5, hi = 1;
  if (run(lo) > targetDist + 1e-6) return null;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (run(mid) < targetDist - 1e-6) lo = mid; else hi = mid;
  }
  /* LOCAL REFINEMENT, because the distance curve is not monotonic.
     -----------------------------------------------------------------------
     A bisection assumes that hitting it harder always goes further, and over
     a bounce that is simply untrue: a few percent more power can catch a
     downslope, or carry a hump that the softer shot rolled up, and the ball
     finishes ten metres past where the extra power should have put it. The
     search then converges on the boundary of that jump and hands back a mark
     that is confidently wrong — measured worst case was a 3-wood asked for
     40 m and delivering 49.5.

     So the bisection narrows it down and then a short sweep across the
     neighbourhood picks the power that ACTUALLY finishes nearest the target.
     Nine extra probes on a number computed once per aim change, and it turns
     a 24% miss into a rounding error. */
  const centre = (lo + hi) / 2;
  let bestP = centre, bestErr = Math.abs(run(centre) - targetDist);

  /* Only pay for the sweep when the bisection actually landed badly.
     Every probe is a full flight-and-roll simulation and this number is
     recomputed whenever the aim moves, so running the sweep unconditionally
     roughly doubled the cost of aiming — 29 ms a frame became 54. In the
     overwhelming majority of cases the bisection is already inside five
     centimetres, and the discontinuity it cannot handle announces itself by
     leaving a metre or more on the table. So: check first, refine only if
     the answer is wrong. Fast path is exactly what it always was. */
  if (bestErr <= 1.2) return Math.max(0.045, bestP);

  const span = Math.max(0.030, (hi - lo) * 4);
  for (let i = -7; i <= 7; i++) {
    if (i === 0) continue;
    const p = centre + (i / 7) * span;
    if (p < club.minPow * 0.5 || p > 1.0) continue;
    const err = Math.abs(run(p) - targetDist);
    // ties go to the SOFTER swing: a shot that just reaches is a better miss
    // than one that just goes through, and the greens run away from you
    if (err < bestErr - 1e-9 || (err < bestErr + 1e-9 && p < bestP)) {
      bestErr = err; bestP = p;
    }
  }

  // below this the ball barely leaves the clubface; round up so the
  // suggestion is always a shot you can actually hit
  return Math.max(0.045, bestP);
}

/* ------------------------------------------------- calibrate the yardages
   Run each club once on a flat, windless range so the UI can show honest
   carry numbers instead of made-up ones. */
let _calibrated = false;
export function calibrateCarries() {
  if (_calibrated) return CARRY;
  const flat = makeFlatRange();
  for (const c of CLUBS) {
    if (c.putter) { CARRY[c.key] = 0; continue; }
    const r = new ShotSim(flat, {
      x: 0, z: 0, clubKey: c.key, power: 1, aim: 0,
      faceDeg: 0, attackDeg: 0, wind: { dir: 0, speed: 0 }
    }).runToEnd();
    CARRY[c.key] = Math.round(r.carry * 10) / 10;
    CARRY[c.key + '_total'] = Math.round(r.total * 10) / 10;
  }
  _calibrated = true;
  return CARRY;
}

/** A featureless practice ground: flat fairway, no hazards, no trees. */
export function makeFlatRange() {
  const hole = {
    courseId: '_range', number: 0, par: 4,
    route: [[0, 0], [0, 700]], cum: [0, 700], total: 700,
    fairwayWidth: 400, roughWidth: 200,
    tee: { x: 0, z: 0, w: 9, d: 7, rot: 0 },
    green: { x: 0, z: 690, r: 18, rx: 18, rz: 18, rot: 0 },
    pin: { x: 0, z: 690 },
    cup: { x: 0, z: 690, r: 0.108 },
    bunkers: [], waters: [], trees: [],
    bounds: { minX: -400, maxX: 400, minZ: -80, maxZ: 900 },
    ob: { minX: -390, maxX: 390, minZ: -70, maxZ: 890 },
    elevProfile: { drop: 0, midBump: 0, total: 700 },
    greenTilt: { ax: 0, az: 0 },
    terrainSeed: 1, maxStrokes: 99
  };
  return {
    hole,
    bio: { firmness: 1, greenSpeed: 1, relief: 0, reliefScale: 200 },
    heightAt: () => 0,
    normalAt: () => [0, 1, 0],
    waterAt: () => null,
    surfaceAt: (x, z) => {
      const b = hole.ob;
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return SURFACES.ob;
      return SURFACES.fairway;
    },
    toPin: (x, z) => Math.hypot(x - hole.pin.x, z - hole.pin.z)
  };
}

export const BALL_RADIUS = RADIUS;
