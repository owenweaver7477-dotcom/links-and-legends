/* =========================================================================
   swing.js — aiming and the swing itself
   -------------------------------------------------------------------------
   Aim with ←/→ (Shift = ultra-fine), pick a club, then play the shot in two
   distinct beats, because they are two distinct skills:

     1. POWER — press and drag DOWN.  How far you are pulling WHEN YOU LET GO
        is how hard you hit.  Not how far you pulled at some point during the
        drag: overshooting and easing back to the number you wanted is the
        whole reason a drag meter beats a button, so the release is what
        counts and the meter never disagrees with the shot.

     2. ACCURACY — let go, and a marker sweeps across the strike bar.  Click
        (or Space) to strike.  Stop it in the middle and you flush it; stop it
        wide and the face is open or shut by that much.

   The strike bar is the ONLY thing that curves the ball.  The drag used to
   contribute a shape of its own, taken from the angle of the pull, which
   meant a few pixels of ordinary sideways drift put a slice on a shot the
   player had struck perfectly — a curve with no visible cause and no way to
   correct it.  Shape now comes from where you stopped the marker and nowhere
   else, so a flush strike is straight every single time.

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
const FACE_MAX = 7.4;          // degrees of face angle at maximum miss
// A dead-centre band that actually forgives: inside this fraction of the
// bar the strike counts as pure, so a good stop is rewarded rather than
// merely being less bad.  Widened again on the fairway (see PURE_BAND).
const PURE_BASE = 0.10;

/* Sweeps per second across the strike bar, by what you are standing in.
   One "sweep" is a full there-and-back, so 1.0 means the marker crosses the
   middle twice a second. */
export const LIE_TEMPO = {
  // A tee shot is the one you stand over and think about, so it is the
  // CALMEST bar on the course — it used to be as quick as a fairway shot,
  // which made the opening stroke of every hole the twitchiest.  The rough
  // reads at that same measured pace: you are already being punished by the
  // lie, and doubling that with an unreadable bar was the difficulty spike.
  tee: 0.78, rough: 0.78,
  fairway: 1.05, path: 1.05,         // the quick one, as it was
  fringe: 0.95, green: 0.72,         // putting is a stroke, not a swipe
  deep: 1.35, waste: 1.35,           // heavy rough still hurries you
  sand: 0.55,                        // slow to time, brutal to escape
  water: 1.05, ob: 1.35
};
export const lieTempo = id => LIE_TEMPO[id] ?? 1.05;

/* How hard you decided to hit it also drives the bar.
   -------------------------------------------------------------------------
   The lie says how hard the shot is to TIME; the power says how hard it is to
   CONTROL, and until now the second half did not exist — a delicate 30 % chip
   and a full-blooded driver read the same bar at the same pace, so there was
   never a reason not to swing out of your shoes.

   Now there is.  A full swing runs the marker about 17 % faster than it used
   to, and a soft one is calmer than anything the game had before, which turns
   "can I get there with a smooth 8 iron instead?" into a real question.

   Deliberately multiplicative on top of the lie rather than replacing it, so
   every relationship the lie already sets survives: sand is still the slowest
   bar on the course, and the tee shot at FULL power (0.78 x 1.17 = 0.91) is
   still calmer than a fairway shot used to be at any power.  That matters —
   the tee was slowed on purpose because a twitchy opening stroke on every
   hole was the old difficulty spike, and this must not quietly undo it. */
const POWER_CALM = 0.62;   // the multiplier at a dead-soft touch shot
const POWER_GAIN = 0.55;   // ...rising to 1.17 at a full swing
/* A hard ceiling on the bar, whatever the lie and power multiply out to.
   Heavy rough at a full swing came to 1.58 sweeps/s, which is past the point
   where a human is timing anything — the marker crosses the pure band in
   under a tenth of a second and the strike becomes a coin toss.  A lie can be
   the worst place on the course without being a lottery. */
const TEMPO_CEILING = 1.45;

/** Sweeps per second for this lie at this power. */
export const barTempo = (id, power = 1) =>
  Math.min(TEMPO_CEILING,
    lieTempo(id) * (POWER_CALM + POWER_GAIN * clamp(power, 0, MAX_OVER)));

/* How wide the "pure" band is, as a fraction of half the bar.  The fairway is
   deliberately the most forgiving surface in the game — it is the reward for
   hitting the fairway in the first place, and it is where most shots are
   played from, so it sets the felt difficulty of the whole round. */
export const PURE_BAND = {
  fairway: 0.26, tee: 0.22, fringe: 0.20, green: 0.18,
  /* A bad lie is now punished through PRECISION as well as distance.  The
     rough took a fifth off the ball speed and then handed you almost the
     fairway's target, so the only thing it really cost was carry.  Missing
     the fairway should mean the strike is harder to find, not merely shorter.

     Sand keeps the trade it was built around: the SLOWEST bar on the course
     (see LIE_TEMPO) and now the smallest target on it. Easy to time, hard to
     hit — which is a different kind of hard from the rough, and the reason a
     bunker shot feels like its own skill. */
  rough: 0.13, deep: 0.11, waste: 0.11, sand: 0.13, path: 0.22
};
export const pureBand = id => PURE_BAND[id] ?? PURE_BASE;

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
    this.downX = 0;
    this.attackDeg = 0;
    this.startX = 0; this.startY = 0;
    this.curX = 0; this.curY = 0;
    this.peak = 0;
    this.tempoT = 0;
    this.result = null;
    this.sweep = 0;            // -1..1, where the strike marker is
    this.strikeAt = 0;         // where it was stopped, for debug()
    this.sweepDir = 1;
    this.tempo = 1.15;         // sweeps per second, set by the lie
    this.lie = 'fairway';
  }

  /** The lie decides how fast the strike bar sweeps.  Set before the swing. */
  setLie(id) {
    this.lie = id || 'fairway';
    if (this.state === SWING.IDLE) this.tempo = barTempo(this.lie, 1);
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
    this.power = 0; this.peak = 0; this.faceDeg = 0;
    this.downX = x;
  }

  pointerMove(x, y) {
    if (this.state !== SWING.BACK) return;    // once released, aim is fixed
    this.curX = x; this.curY = y;
    const dy = y - this.startY;

    // Pulling down fills the backswing, and easing back up empties it again.
    // `peak` is remembered ONLY to tell a real swing from a twitch — it must
    // never become the shot, or a player who corrects an overshoot is
    // silently given the overshoot.
    this.power = clamp(dy / BACKSWING_PX, 0, MAX_OVER);
    this.peak = Math.max(this.peak, this.power);

    // Sideways drift is not a shot shape.  The face is decided at the strike.
    this.faceDeg = 0;
  }

  /**
   * Let go of the drag.  This LOCKS the power and hands over to the strike
   * bar — it never plays the shot on its own, because power and strike are
   * now two separate decisions.  Returns nothing.
   */
  pointerUp() {
    if (this.state !== SWING.BACK) return null;
    if (this.peak < 0.06) { this.reset(); return null; }   // a twitch, not a swing
    // whatever the meter was reading at the instant of release IS the shot,
    // and it is also what sets the pace of the bar you now have to stop
    this.state = SWING.ACCURACY;
    this.tempo = barTempo(this.lie, this.power);
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
    const power = this.power;

    // Where you stopped the marker IS the face — but the middle of the bar is
    // a BAND, not a point.  Inside it the strike is flush and the face error
    // is zero; outside it the error ramps from the edge of the band, so a
    // near-miss is a small miss rather than a cliff.
    const raw = clamp(this.sweep, -1, 1);
    this.strikeAt = raw;
    const band = pureBand(this.lie);
    const over = Math.max(0, Math.abs(raw) - band) / Math.max(1e-6, 1 - band);
    const timing = Math.sign(raw) * over;
    const error = timing * FACE_MAX;

    // Overswinging past full costs accuracy — the face gets harder to
    // control.  It multiplies the strike error rather than adding a curve of
    // its own, so a flush strike stays flush however hard you swung.
    const overswing = Math.max(0, power - 1);
    const face = clamp(error * (1 + overswing * 2.5),
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
      timing: Math.abs(timing),         // 0 = flush, 1 = worst
      pure: Math.abs(raw) <= band       // did it land in the band?
    };
    this.state = SWING.DONE;
    this.result = shot;
    return shot;
  }

  /**
   * What the last swing ACTUALLY committed — the three numbers that were
   * being guessed at when power and shape could disagree with the meter.
   * accuracyPct is 100 for a flush strike and falls off to 0 at the far edge
   * of the bar, so it reads the way a player would describe it.
   */
  debug() {
    const r = this.result;
    if (!r) return null;
    const band = pureBand(this.lie);
    const off = Math.abs(clamp(this.strikeAt, -1, 1));
    return {
      powerPct: Math.round(r.power * 1000) / 10,
      accuracyPct: Math.round(Math.max(0, 1 - off) * 1000) / 10,
      strikeAt: Math.round(this.strikeAt * 1000) / 1000,
      band: Math.round(band * 1000) / 1000,
      pure: r.pure,
      faceDeg: r.faceDeg,
      shape: r.faceDeg > 0.05 ? 'slice' : r.faceDeg < -0.05 ? 'hook' : 'straight',
      lie: this.lie,
      club: r.clubKey
    };
  }

  cancel() { this.reset(); }

  /* --------------------------------------------------------------- aim */
  nudgeAim(dRad) { this.aim = wrap(this.aim + dRad); }
  setAim(rad) { this.aim = wrap(rad); }

  /** 0..1 how far through the backswing, for drawing the meter. */
  meter() {
    return {
      state: this.state,
      power: this.power,
      peak: this.peak,
      face: this.faceDeg,
      over: Math.max(0, this.peak - 1),
      sweep: this.sweep,
      /* During the drag this must be the bar you are about to GET, not the
         one the lie alone implies — the whole point of the power coupling is
         that the player can see it coming while they still have a choice. */
      tempo: this.state === SWING.BACK ? barTempo(this.lie, this.power) : this.tempo,
      calmTempo: barTempo(this.lie, 0.25),
      fastTempo: barTempo(this.lie, 1),
      lie: this.lie,
      band: pureBand(this.lie)
    };
  }
}

function wrap(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export { BACKSWING_PX, FACE_MAX };
