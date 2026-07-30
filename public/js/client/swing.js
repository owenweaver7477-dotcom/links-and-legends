/* =========================================================================
   swing.js — aiming and the swing itself
   -------------------------------------------------------------------------
   Aim with the mouse (or A/D), pick a club, then make a swing:

     press and drag DOWN   -> backswing, power builds
     drag back UP and let go near the ball -> the strike

   The PATH of the drag is the shape of the shot, exactly like a swing plane:

     pull straight back                    -> straight ball
     pull back angled left or right       -> draw / fade that way; steeper
                                              angle turns it into a hook / slice
     drift sideways coming back through   -> strike error on top of the shape

   So a deliberate fade is: pull back a little right, come through clean.
   Overswinging past 100% costs accuracy, which is exactly the decision a
   real golfer makes on a long par 5.
   ========================================================================= */

import { clamp } from '../shared/rng.js';

export const SWING = {
  IDLE: 'idle',
  BACK: 'back',
  DOWN: 'down',
  DONE: 'done'
};

const BACKSWING_PX = 190;      // full power drag length
const MAX_OVER = 1.12;         // you can overswing this far
const FACE_MAX = 9.5;          // degrees of face angle at maximum miss
const SHAPE_MAX = 7.0;         // degrees available from the backswing path
const SHAPE_GAIN = 2.6;        // how fast path angle becomes shape

export class SwingController {
  constructor() {
    this.reset();
    this.aim = 0;              // radians, world heading
    this.clubKey = 'DR';
    this.enabled = false;
  }

  reset() {
    this.state = SWING.IDLE;
    this.power = 0;
    this.faceDeg = 0;
    this.shapeDeg = 0;
    this.downX = 0;
    this.attackDeg = 0;
    this.startX = 0; this.startY = 0;
    this.curX = 0; this.curY = 0;
    this.peak = 0;
    this.tempoT = 0;
    this.result = null;
  }

  /* -------------------------------------------------------------- input */
  pointerDown(x, y) {
    if (!this.enabled) return;
    this.state = SWING.BACK;
    this.startX = x; this.startY = y;
    this.curX = x; this.curY = y;
    this.power = 0; this.peak = 0; this.faceDeg = 0; this.shapeDeg = 0;
    this.downX = x;
  }

  pointerMove(x, y) {
    if (this.state === SWING.IDLE || this.state === SWING.DONE) return;
    this.curX = x; this.curY = y;
    const dy = y - this.startY;
    const dx = x - this.startX;

    if (this.state === SWING.BACK) {
      // pulling down fills the backswing
      this.power = clamp(dy / BACKSWING_PX, 0, MAX_OVER);
      this.peak = Math.max(this.peak, this.power);

      // The ANGLE of the pull is the shape of the shot.  Normalising by how
      // far back you are makes it a direction, not a distance — a 15° pull
      // is the same fade from a half swing as from a full one.  It only
      // starts reading once the swing is properly under way, so the first
      // wobble of the drag does not decide your shot.
      if (this.power > 0.15) {
        const pathAngle = dx / Math.max(dy, 30);
        this.shapeDeg = clamp(pathAngle * SHAPE_MAX * SHAPE_GAIN, -SHAPE_MAX, SHAPE_MAX);
      }
      this.faceDeg = this.shapeDeg;      // so the meter and the ring show it live

      // once you start coming back up, you are into the downswing
      if (this.peak > 0.08 && dy < this.peak * BACKSWING_PX - 14) {
        this.state = SWING.DOWN;
        this.downX = x;                  // drift is measured from HERE, so the
      }                                  // shape you set going back is kept
    }

    if (this.state === SWING.DOWN) {
      // drift sideways coming back through the ball is strike ERROR, layered
      // on top of the shape you chose going back
      const drift = (x - this.downX) / BACKSWING_PX;
      const error = clamp(drift * FACE_MAX * 2.2, -FACE_MAX, FACE_MAX);
      this.faceDeg = clamp(this.shapeDeg + error, -FACE_MAX * 1.5, FACE_MAX * 1.5);
      // coming through steeply or shallow trims the launch a touch
      this.attackDeg = clamp((this.peak - this.power) * 2.0 - 1.0, -2.5, 2.5);
    }
  }

  /** Release. Returns a shot if the swing was committed, otherwise null. */
  pointerUp() {
    if (this.state === SWING.IDLE || this.state === SWING.DONE) { this.reset(); return null; }

    const power = this.peak;
    if (power < 0.06) { this.reset(); return null; }

    // Letting go at the top of the backswing PLAYS the shot with whatever
    // shape the pull-back chose and no through-stroke error — the deliberate
    // draw or fade, struck clean.  Requiring the return stroke meant an early
    // release silently threw the shot away, which read as "I can't hit it".
    const raw = this.state === SWING.BACK ? this.shapeDeg : this.faceDeg;

    // overswinging past full costs accuracy — the face gets harder to control
    const over = Math.max(0, power - 1);
    const facePenalty = over * 26;
    const face = clamp(raw * (1 + over * 2.5)
      + Math.sign(raw || 1) * facePenalty * 0.12, -FACE_MAX * 1.6, FACE_MAX * 1.6);

    const shot = {
      power: Math.min(power, MAX_OVER),
      faceDeg: face,
      attackDeg: this.attackDeg,
      aim: this.aim,
      clubKey: this.clubKey
    };
    this.state = SWING.DONE;
    this.result = shot;
    return shot;
  }

  cancel() { this.reset(); }

  /* --------------------------------------------------------------- aim */
  nudgeAim(dRad) { this.aim = wrap(this.aim + dRad); }
  setAim(rad) { this.aim = wrap(rad); }

  /** 0..1 how far through the backswing, for drawing the meter. */
  meter() {
    return {
      state: this.state,
      power: this.state === SWING.BACK ? this.power : this.peak,
      peak: this.peak,
      face: this.faceDeg,
      shape: this.shapeDeg,
      over: Math.max(0, this.peak - 1)
    };
  }
}

function wrap(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export { BACKSWING_PX, FACE_MAX };
