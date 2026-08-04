/* =========================================================================
   walker.js — walking your golfer around the hole
   -------------------------------------------------------------------------
   WASD/arrows move relative to the camera, Shift sprints, F jogs you to your
   ball.  Movement is delta-time based so a frame-rate dip slows nothing down,
   and collision is resolved against the same tree list and hazard geometry the
   ball physics uses — you cannot walk through a trunk or out into a lake.
   ========================================================================= */

import { WALK_SPEED, SPRINT_SPEED, SHOT_RADIUS } from '../shared/avatars.js';
import { clamp } from '../shared/rng.js';

/* Jogging to your ball is a JOG.  This used to scale its speed so that any
   distance was covered in four seconds — 200 m at 50 m/s — which is the single
   biggest reason the course felt miniature.  Walk out to a drive now and it
   takes the time a walk takes, which is exactly why the cart is parked there. */
const BODY_RADIUS = 0.34;

export class Walker {
  constructor() {
    this.x = 0; this.z = 0;
    this.heading = 0;
    this.speed = 0;
    this.auto = null;             // {x, z, speed} while jogging to the ball
    this.keys = new Set();
    this.enabled = false;
    this.arrowsAim = false;   // set by the game when you are over the ball
  }

  reset(x, z, heading = 0) {
    this.x = x; this.z = z; this.heading = heading;
    this.speed = 0; this.auto = null;
  }

  key(k, down) {
    const c = k.toLowerCase();
    if (down) this.keys.add(c); else this.keys.delete(c);
    // any manual input cancels an auto-walk — you are taking over
    if (down && ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(c)) {
      this.auto = null;
    }
  }
  clearKeys() { this.keys.clear(); }

  /** Start jogging to a point; speed scales so it never takes forever. */
  goTo(x, z, speed = SPRINT_SPEED) {
    const d = Math.hypot(x - this.x, z - this.z);
    if (d < 0.4) { this.auto = null; return; }
    this.auto = { x, z, speed };
  }
  cancelAuto() { this.auto = null; }

  get moving() { return this.speed > 0.15; }

  /**
   * @param dt        seconds
   * @param camYaw    where the camera is looking, so W is "away from me"
   * @param terrain   TerrainModel, for ground height and surfaces
   * @param hole      hole data, for trees and bounds
   */
  update(dt, camYaw, terrain, hole) {
    if (!this.enabled || !terrain) { this.speed = 0; return; }

    let vx = 0, vz = 0, want = 0;

    if (this.auto) {
      const dx = this.auto.x - this.x, dz = this.auto.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.35) { this.auto = null; }
      else { vx = dx / d; vz = dz / d; want = Math.min(this.auto.speed, d / Math.max(dt, 1e-3)); }
    } else {
      const k = this.keys;
      // while addressing the ball the arrows belong to aiming, not walking
      const arrows = !this.arrowsAim;
      let fwd = 0, side = 0;
      if (k.has('w') || (arrows && k.has('arrowup'))) fwd += 1;
      if (k.has('s') || (arrows && k.has('arrowdown'))) fwd -= 1;
      if (k.has('a') || (arrows && k.has('arrowleft'))) side -= 1;
      if (k.has('d') || (arrows && k.has('arrowright'))) side += 1;
      if (fwd || side) {
        // Camera-relative: forward is where you are looking, and your right
        // hand is (-cos, sin) — NOT (cos, -sin).  Facing +Z with Y up in a
        // right-handed frame, right points at -X.  Getting this backwards
        // makes D strafe left, which is what "A and D are opposites" means.
        const sinY = Math.sin(camYaw), cosY = Math.cos(camYaw);
        vx = sinY * fwd - cosY * side;
        vz = cosY * fwd + sinY * side;
        const l = Math.hypot(vx, vz) || 1;
        vx /= l; vz /= l;
        want = k.has('shift') ? SPRINT_SPEED : WALK_SPEED;
      }
    }

    // rough and sand slow you down, the way they would
    if (want > 0) {
      const surf = terrain.surfaceAt(this.x, this.z).id;
      if (surf === 'rough') want *= 0.82;
      else if (surf === 'deep' || surf === 'waste') want *= 0.66;
      else if (surf === 'sand') want *= 0.6;
    }

    // ease toward the target speed so starts and stops are not instant
    this.speed += (want - this.speed) * Math.min(1, dt * 11);
    if (this.speed < 0.02) this.speed = 0;

    if (this.speed > 0.02 && (vx || vz)) {
      this.heading = Math.atan2(vx, vz);
      this._step(vx * this.speed * dt, vz * this.speed * dt, terrain, hole);
    }

    /* Being shoved.
       -------------------------------------------------------------------
       A shove is a real impulse, integrated properly rather than nudged.
       The first version decayed the velocity 4.2/s and stopped below
       0.12 m/s, which at 60fps is a slide of about 20 cm over a third of a
       second — technically a push, visually a twitch.

       Now it is a genuine stumble: the impulse survives long enough to
       carry you, and it fights your own footing rather than your own
       footing simply ignoring it. */
    if (this.knock) {
      const k = this.knock;
      k.t = (k.t || 0) + dt;

      // Friction rises as you get your feet back under you — a hard shove
      // slides for a moment before you can resist it at all.
      const grip = 1.6 + k.t * 5.5;
      const decay = Math.max(0, 1 - dt * grip);

      this._step(k.x * dt, k.z * dt, terrain, hole);
      k.x *= decay; k.z *= decay;

      /* While being carried, your own walking is damped — you cannot simply
         run out of a barge. This is what makes it read as being shoved
         rather than as the world briefly sliding underneath you. */
      const carry = Math.hypot(k.x, k.z);
      if (carry > 0.5) this.speed *= Math.max(0, 1 - dt * 3.0);
      if (carry < 0.25) this.knock = null;
    }
  }

  /**
   * Take a shove. (nx,nz) is the direction, `power` its strength in m/s.
   *
   * Cancels an auto-walk — being barged off your route should feel like it —
   * and turns you with the blow, because a person who is knocked sideways
   * does not keep facing primly forward.
   */
  shove(nx, nz, power) {
    const p = Math.max(0, Math.min(14, power || 0));
    const prev = this.knock;
    // a second shove while still sliding ADDS, so being ganged up on compounds
    this.knock = {
      x: (prev?.x || 0) * 0.5 + nx * p,
      z: (prev?.z || 0) * 0.5 + nz * p,
      t: 0
    };
    this.auto = null;
    this.speed *= 0.35;                       // knocked off your stride
    if (p > 1.5) this.heading = Math.atan2(nx, nz);
  }

  /** Move, then push back out of anything solid. */
  _step(dx, dz, terrain, hole) {
    let nx = this.x + dx, nz = this.z + dz;

    // stay inside the hole (a little inside the OB line, so you can still
    // stand over a ball that finished near the edge)
    const b = hole.bounds;
    nx = clamp(nx, b.minX + 3, b.maxX - 3);
    nz = clamp(nz, b.minZ + 3, b.maxZ - 3);

    // trees are solid: push out along the normal rather than stopping dead,
    // so you slide around a trunk instead of sticking to it
    for (const t of hole.trees) {
      const trunk = (t.species === 'gorse' ? t.r * 0.85 : Math.max(0.2, t.r * 0.16)) + BODY_RADIUS;
      const ddx = nx - t.x, ddz = nz - t.z;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 < trunk * trunk && d2 > 1e-9) {
        const d = Math.sqrt(d2);
        nx = t.x + (ddx / d) * trunk;
        nz = t.z + (ddz / d) * trunk;
      }
    }

    // you do not wade into the water — slide along the bank instead
    if (terrain.waterAt(nx, nz) !== null) {
      const alongX = terrain.waterAt(nx, this.z) === null;
      const alongZ = terrain.waterAt(this.x, nz) === null;
      if (alongX) nz = this.z;
      else if (alongZ) nx = this.x;
      else { nx = this.x; nz = this.z; }
      if (this.auto) this.auto = null;          // an auto-walk cannot swim
    }

    this.x = nx; this.z = nz;
  }

  /** Are we close enough to that ball to play it? */
  nearBall(ball) {
    return Math.hypot(this.x - ball.x, this.z - ball.z) <= SHOT_RADIUS;
  }
  distanceTo(ball) { return Math.hypot(this.x - ball.x, this.z - ball.z); }
}

export { SHOT_RADIUS };
