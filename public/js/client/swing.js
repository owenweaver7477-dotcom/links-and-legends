/* =========================================================================
   swing.js — aiming and the swing itself
   -------------------------------------------------------------------------
   Aim with ←/→ (Shift = ultra-fine), pick a club, then play the shot in two
   distinct beats, because they are two distinct skills:

     1. POWER — press and drag DOWN.  How far you pull is how hard you hit,
        and the ANGLE of the pull is the shape of the shot, exactly like a
        swing plane: straight back is straight, angled is a draw or a fade.

     2. ACCURACY — let go, and a marker sweeps across the strike bar.  Click
        (or Space) to strike.  Stop it in the middle and you flush it; stop it
        wide and the face is open or shut by that much.

   The sweep's SPEED is the lie.  Off a tee or fairway it is brisk; light
   rough hurries it; heavy rough is a blur you can barely time.  Sand is the
   exception — the marker crawls, so a bunker shot is the easiest strike on
   the course to time and the hardest to get out of, because the sand itself
   eats most of the ball speed.  That is the trade a real bunker shot makes.
   ========================================================================= */

import { clamp } from '../shared/rng.js';

export const SWING = {
  IDLE: 'idle',
  BACK: 'back',          // dragging down: power and shape
  ACCURACY: 'accuracy',  // marker sweeping: waiting for the strike
  DONE: 'done'
};

const BACKSWING_PX = 190;      // full power drag length
const MAX_OVER = 1.12;         // you can overswing this far
const FACE_MAX = 9.5;          // degrees of face angle at maximum miss
const SHAPE_MAX = 7.0;         // degrees available from the backswing path
const SHAPE_GAIN = 2.6;        // how fast path angle becomes shape

/* Sweeps per second across the strike bar, by what you are standing in.
   One "sweep" is a full there-and-back, so 1.0 means the marker crosses the
   middle twice a second. */
export const LIE_TEMPO = {
  tee: 1.15, fairway: 1.15, path: 1.15,
  fringe: 1.05, green: 0.8,          // putting is a stroke, not a swipe
  rough: 1.55,                       // light rough hurries you
  deep: 2.1, waste: 2.1,             // heavy rough is a blur
  sand: 0.62,                        // slow to time, brutal to escape
  water: 1.15, ob: 1.55
};
export const lieTempo = id => LIE_TEMPO[id] ?? 1.15;

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
    this.sweep = 0;            // -1..1, where the strike marker is
    this.sweepDir = 1;
    this.tempo = 1.15;         // sweeps per second, set by the lie
    this.lie = 'fairway';
  }

  /** The lie decides how fast the strike bar sweeps.  Set before the swing. */
  setLie(id) {
    this.lie = id || 'fairway';
    if (this.state === SWING.IDLE) this.tempo = lieTempo(this.lie);
  }

  /**
   * Advance the strike marker.  Called every frame; does nothing until the
   * power is locked in and the swing is waiting on your timing.
   */
  step(dt) {
    if (this.state !== SWING.ACCURACY) return;
    // a full sweep is 4 units of travel (0 -> 1 -> -1 -> 0), so one "tempo"
    // is one there-and-back per second
    this.sweep += this.sweepDir * this.tempo * 4 * dt;
    while (this.sweep > 1 || this.sweep < -1) {
      if (this.sweep > 1) { this.sweep = 2 - this.sweep; this.sweepDir = -1; }
      if (this.sweep < -1) { this.sweep = -2 - this.sweep; this.sweepDir = 1; }
    }
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
    if (this.state !== SWING.BACK) return;    // once released, aim is fixed
    this.curX = x; this.curY = y;
    const dy = y - this.startY;
    const dx = x - this.startX;

    {
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
    }
  }

  /**
   * Let go of the drag.  This LOCKS the power and hands over to the strike
   * bar — it never plays the shot on its own, because power and strike are
   * now two separate decisions.  Returns nothing.
   */
  pointerUp() {
    if (this.state !== SWING.BACK) return null;
    if (this.peak < 0.06) { this.reset(); return null; }   // a twitch, not a swing
    this.power = this.peak;
    this.state = SWING.ACCURACY;
    this.tempo = lieTempo(this.lie);
    // always start from the middle heading out, so the first sweep is the
    // same shape for everyone and nobody gets a free flush
    this.sweep = 0;
    this.sweepDir = Math.random() < 0.5 ? -1 : 1;
    return null;
  }

  /**
   * Strike.  Called on the click (or Space) that stops the marker; returns
   * the shot, or null if there was no swing waiting.
   */
  commit() {
    if (this.state !== SWING.ACCURACY) return null;
    const power = this.peak;

    // where you stopped the marker IS the face: dead centre flushes it,
    // the edges are a full open or shut face
    const timing = clamp(this.sweep, -1, 1);
    const error = timing * FACE_MAX;

    // overswinging past full costs accuracy — the face gets harder to control
    const over = Math.max(0, power - 1);
    const face = clamp((this.shapeDeg + error) * (1 + over * 2.5),
      -FACE_MAX * 1.8, FACE_MAX * 1.8);

    // a mistimed strike is also a thinner one: caught low on the face, it
    // comes out flatter and shorter
    this.attackDeg = clamp(-Math.abs(timing) * 1.8, -2.5, 2.5);
    this.faceDeg = face;

    const shot = {
      power: Math.min(power, MAX_OVER),
      faceDeg: face,
      attackDeg: this.attackDeg,
      aim: this.aim,
      clubKey: this.clubKey,
      timing: Math.abs(timing)          // for the strike call-out
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
      over: Math.max(0, this.peak - 1),
      sweep: this.sweep,
      tempo: this.tempo,
      lie: this.lie
    };
  }
}

function wrap(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export { BACKSWING_PX, FACE_MAX };
