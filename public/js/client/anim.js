/* =========================================================================
   anim.js — the movement that happens when nothing is happening
   -------------------------------------------------------------------------
   A golfer standing on a tee in this game has been perfectly, absolutely
   still. Not "subtly animated" — still, every frame identical, which is the
   single loudest thing a character can do to announce it is a model rather
   than a person. Everything here runs UNDER whatever the rig is already
   doing: it is a set of layers added to a pose, not an animation that
   competes with one.

   WHAT IS IN HERE AND WHY IT IS SEPARATE.

   avatar.js owns the rig and the clips — the swing, the walk, the
   celebrations, anything with a beginning and an end. This owns the things
   that never stop: breathing, weight shifting, the wind, and the feet
   finding the ground. Those have no start and no finish, they apply to every
   golfer in every state, and threading them through the clip system would
   mean every clip having to remember to keep breathing.

   THE ONE THAT ACTUALLY MATTERS is the feet. Every avatar in this game has
   stood at a fixed height with both shoes at the same level, on terrain that
   is never flat — so on any slope at all one foot is buried in the hill and
   the other is hanging in the air. It is the most visible modelling fault
   the game has and it is on screen for the entire round.

   EVERYTHING IS DELTA-TIMED AND PHASE-OFFSET PER GOLFER. Eight players
   breathing in unison is worse than eight players not breathing.
   ========================================================================= */

const TAU = Math.PI * 2;

/* ─────────────────────────────────────────────────────────────────────────
   EVERY FUNCTION HERE WRITES TO A LAYER, NOT TO THE POSE.

   avatar.js keeps ONE pose buffer and reuses it every frame — clips assign
   into it (`P.armLx = ...`), so stale values are simply overwritten. These
   layers add rather than assign, and adding into a buffer that is never
   cleared compounds without bound: the first version inflated the chest by
   five percent per frame, so a golfer stood on the tee slowly swelling until
   they filled the screen.

   So layers go into their own object, zeroed every frame, and the rig adds
   the two together exactly once when it writes the joints. A layer can then
   be as additive as it likes and can never accumulate.
   ───────────────────────────────────────────────────────────────────────── */
export const LAYER_KEYS = [
  'bodyY', 'bodyRx', 'bodyRz', 'twist', 'headRx', 'headRy', 'headRz',
  'armLx', 'armRx', 'armLz', 'armRz', 'legLz', 'legRz',
  'kneeL', 'kneeR', 'elbowL', 'elbowR', 'ankleL', 'ankleR', 'footL', 'footR', 'breath'
];
export function blankLayer(L = {}) {
  for (let i = 0; i < LAYER_KEYS.length; i++) L[LAYER_KEYS[i]] = 0;
  return L;
}

/* Idle fidgets. Each is a short pose function of its own progress 0..1,
   picked at random and played once. Kept few and kept small — an idle that
   is noticeable is an idle that becomes annoying by the fourth time. */
const FIDGETS = [
  { id: 'shift', dur: 2.6, w: 4, f: (L, k) => {
    // weight onto one hip and back: the thing everybody does standing still
    const e = Math.sin(k * Math.PI);
    L.bodyRz += e * 0.045;
    L.legLz += e * 0.03;
    L.legRz += e * 0.03;
    L.kneeR += e * 0.10;
  } },
  { id: 'lookAround', dur: 2.2, w: 3, f: (L, k) => {
    const e = Math.sin(k * Math.PI);
    L.headRy += Math.sin(k * TAU) * 0.34 * e;
    L.headRx += e * 0.05;
  } },
  { id: 'twirl', dur: 1.9, w: 2, f: (L, k) => {
    // a club twirl: the trail wrist rolls the shaft over and back
    const e = Math.sin(k * Math.PI);
    L.armRz += Math.sin(k * TAU * 1.5) * 0.30 * e;
    L.elbowR -= e * 0.22;
  } },
  { id: 'stretch', dur: 2.9, w: 1, f: (L, k) => {
    const e = Math.sin(k * Math.PI);
    L.armLx -= e * 0.55; L.armRx -= e * 0.5;
    L.elbowL -= e * 0.5; L.elbowR -= e * 0.45;
    L.bodyRx -= e * 0.06;
    L.headRx -= e * 0.10;
  } },
  { id: 'shoulders', dur: 1.5, w: 3, f: (L, k) => {
    const e = Math.sin(k * Math.PI);
    L.armLz += e * 0.10; L.armRz -= e * 0.10;
    L.bodyY += e * 0.012;
  } }
];
const FIDGET_TOTAL = FIDGETS.reduce((a, f) => a + f.w, 0);

/**
 * One golfer's living-body state. Held per avatar rather than globally so
 * every player has their own breath, their own fidget timer and their own
 * phase — which is the whole difference between a crowd and a chorus line.
 */
export function makeLife(seed = Math.random()) {
  return {
    t: seed * 100,                  // phase offset, so nobody is in sync
    breathRate: 0.22 + seed * 0.06, // ~13-17 breaths a minute
    idleFor: 0,
    fidget: null,
    fidgetK: 0,
    nextFidget: 3 + seed * 2.5,
    swayL: 0, swayR: 0,             // smoothed foot heights
    lean: 0
  };
}

/**
 * Add the always-on layers to a pose.
 *
 * @param L      the layer buffer, zeroed by the caller each frame
 * @param life   this golfer's state, from makeLife
 * @param dt     seconds
 * @param ctx    { moving, swinging, seated, wind, windDir, facing }
 */
export function breathe(L, life, dt, ctx = {}) {
  life.t += dt;
  const { moving = false, swinging = false, seated = false } = ctx;

  /* ---- breathing ------------------------------------------------------
     Faster and deeper after walking, which is the only reason anybody would
     ever consciously notice it. A sine is not quite right — a real breath
     is a quick in and a slow out — so the wave is skewed. */
  const rate = life.breathRate * (moving ? 1.9 : 1);
  const ph = (life.t * rate) % 1;
  const skew = ph < 0.38 ? Math.sin((ph / 0.38) * Math.PI * 0.5)
                         : Math.cos(((ph - 0.38) / 0.62) * Math.PI * 0.5);
  L.breath += skew * (moving ? 1 : 0.62);
  L.bodyY += skew * 0.004;

  /* ---- the wind ------------------------------------------------------
     The upper body leans away from a strong wind and trembles slightly in a
     gusty one. Small: a golfer visibly staggering in a 20 mph breeze reads
     as a bug, not as weather. */
  const w = Math.min(1, (ctx.wind || 0) / 13);
  if (w > 0.05) {
    const gust = w + Math.sin(life.t * 1.7) * 0.18 * w + Math.sin(life.t * 4.1) * 0.06 * w;
    /* Relative to the way the golfer FACES, so a headwind pushes them back
       and a crosswind pushes them sideways — the same lean in every
       direction is just a golfer who stands crooked. */
    const rel = (ctx.windDir || 0) - (ctx.facing || 0);
    L.bodyRx += Math.cos(rel) * gust * 0.035;
    L.bodyRz += Math.sin(rel) * gust * 0.045;
  }

  /* ---- idle fidgets ---------------------------------------------------
     Only when genuinely doing nothing. A fidget that fires mid-swing is a
     golfer who shrugs at the top of their backswing. */
  if (moving || swinging || seated) {
    life.idleFor = 0;
    life.fidget = null;
    return L;
  }
  life.idleFor += dt;

  if (life.fidget) {
    life.fidgetK += dt / life.fidget.dur;
    if (life.fidgetK >= 1) {
      life.fidget = null;
      life.nextFidget = 3 + Math.random() * 2.5;   // every 3-5 s, as specified
    } else {
      life.fidget.f(L, life.fidgetK);
    }
  } else if (life.idleFor > life.nextFidget) {
    let r = Math.random() * FIDGET_TOTAL;
    for (const f of FIDGETS) { r -= f.w; if (r <= 0) { life.fidget = f; break; } }
    life.fidgetK = 0;
    life.idleFor = 0;
  }
  return L;
}

/* ═══════════════════════════════════════════════════════ FOOT PLACEMENT ═══
   The feet find the ground, and the hips settle onto the lower of the two.

   THE PROBLEM, precisely. The rig is a figure of fixed height planted at one
   sampled ground height. Both shoes therefore sit at exactly the same level.
   On a 12% slope — which is ordinary on these courses — a golfer standing
   across the hill has one foot 5 cm under the turf and the other 5 cm above
   it, and you can see daylight beneath a shoe from twenty metres.

   THE FIX is the standard two-step every game uses:
     1. sample the ground under each foot,
     2. drop the hips to the LOWER of the two so neither foot has to sink,
        and raise the higher foot by the difference.
   Plus a tilt, so the shoe lies along the slope rather than staying level on
   a hillside.

   Smoothed, because terrain sampled per-frame under a walking golfer is
   noisy and unsmoothed IK is a figure that vibrates.
*/
const STANCE = 0.262;               // half the distance between the feet

export function footPlant(L, life, dt, {
  T, x, z, facing = 0, moving = false, ground = null
} = {}) {
  if (!T) return L;

  // where each foot is in the world, given which way the golfer faces
  const c = Math.cos(facing), s = Math.sin(facing);
  const lx = x + c * STANCE, lz = z - s * STANCE;
  const rx = x - c * STANCE, rz = z + s * STANCE;

  const gL = T.heightAt(lx, lz);
  const gR = T.heightAt(rx, rz);
  const base = ground != null ? ground : Math.max(gL, gR);

  /* Both feet measured DOWN from the higher ground: the hips sit on the
     high foot and the low one reaches. Reaching down is what a leg does on a
     slope; sinking into the hill is not. */
  const wantL = Math.min(0, gL - base);
  const wantR = Math.min(0, gR - base);

  // smoothing: fast enough to keep up with a walk, slow enough not to buzz
  const k = Math.min(1, dt * (moving ? 14 : 6));
  life.swayL += (wantL - life.swayL) * k;
  life.swayR += (wantR - life.swayR) * k;

  /* Clamped. A leg has a length, and a cliff edge under one foot would
     otherwise stretch it to the bottom of the valley. */
  const LIMIT = 0.22;
  L.footL = Math.max(-LIMIT, life.swayL);
  L.footR = Math.max(-LIMIT, life.swayR);

  /* The hips tilt across the slope, and the knee on the downhill side takes
     the bend — which is what actually reads as "standing on a hill" rather
     than "standing level with one long leg". */
  const across = (life.swayL - life.swayR);
  L.bodyRz += across * 0.55;
  if (across < 0) L.kneeR += -across * 1.1; else L.kneeL += across * 1.1;

  return L;
}

/**
 * Walk cycle knee bend, layered onto whatever gait the rig already has.
 * A straight-legged walk is the other half of why the old rig scissored.
 */
/* `phase` is the SAME stride clock the legs swing on, and that is the whole
   point of the argument.
   -------------------------------------------------------------------------
   This used to derive its own: `Math.sin(life.t * speed * 3.1)`. The legs
   swing on `avatar.phase`, which integrates `2.1 + speed * 0.62` — a
   different frequency AND a different origin. At a walk the two ran at 3.1
   against 5.0 rad/s; at a run, 4.8 against 13.6. So the knee bent while the
   leg was pushing off and straightened while it swung through, drifting in
   and out of sync forever rather than being wrong in a fixed way.

   That is the "running looks off" nobody can point at: every joint below the
   hip was animating to a metronome the leg above it could not hear. */
export function walkKnees(L, phase, speed) {
  if (speed < 0.15) return L;
  const sw = Math.sin(phase);
  /* The knee bends on the way THROUGH, not on the way back — a leg swinging
     forward is bent and a leg pushing off is straight, and getting that
     backwards is the uncanny walk everybody recognises and nobody can name. */
  L.kneeL += Math.max(0, -sw) * 0.62 * Math.min(1, speed / 2);
  L.kneeR += Math.max(0, sw) * 0.62 * Math.min(1, speed / 2);
  L.elbowL -= Math.max(0, sw) * 0.30 * Math.min(1, speed / 2);
  L.elbowR -= Math.max(0, -sw) * 0.30 * Math.min(1, speed / 2);
  /* The ankle rolls through the step rather than staying a rigid plank on
     the shin: toe lifts clear of the ground while the leg swings through,
     then points down through push-off just before the next heel-strike.
     Same phase as the knee it sits below, so the two read as one motion
     rather than two independent wobbles. */
  const m = Math.min(1, speed / 2);
  L.ankleL += (Math.max(0, -sw) * 0.34 - Math.max(0, sw) * 0.20) * m;
  L.ankleR += (Math.max(0, sw) * 0.34 - Math.max(0, -sw) * 0.20) * m;
  return L;
}

/* ═══════════════════════════════════════════════════════════ THE SWING ═══
   Weight shift and lag, as a layer over the existing swing clip.

   The clip already has the timing right — backswing, transition, downswing,
   impact, follow-through. What it has never had is the part that makes a
   swing look like a swing rather than like a pendulum: the weight moving to
   the trail foot and back, the shoulders turning further than the hips, and
   the arms LAGGING the club before releasing it.

   `f` is the clip's own 0..1 progress, and `back` says which side of impact
   we are on — this reads the swing rather than driving it, so the two cannot
   disagree about where the ball gets hit.
*/
export function swingLayers(L, f, back) {
  /* Weight: 50/50 at address, 70/30 onto the trail foot at the top, and
     through to the lead foot by the finish. Expressed as a lean and a knee
     flex, because there is no pelvis to translate. */
  const toTop = back ? f : 1;
  const thru = back ? 0 : f;
  const weight = toTop * 0.7 - thru * 1.15;         // + is onto the trail side
  L.bodyRz += weight * 0.055;
  L.kneeR += Math.max(0, weight) * 0.30;            // trail knee flexes going back
  L.kneeL += Math.max(0, -weight) * 0.22;           // lead knee braces coming through

  /* Shoulders lead hips. The rig turns them together on `twist`, so this
     adds the DIFFERENCE — the coil that a swing stores and releases. */
  const coil = back ? Math.sin(f * Math.PI * 0.5) : Math.cos(f * Math.PI * 0.5);
  L.twist = (L.twist || 0) + coil * 0.16 * (back ? 1 : 1);

  /* Lag: the elbows stay folded into the downswing and snap straight through
     impact. Peaks around 90 degrees at the top, which is what the brief
     asked for and also what it actually is. */
  const lag = back ? Math.sin(f * Math.PI * 0.5) : Math.max(0, 1 - f * 2.4);
  L.elbowR -= lag * 1.05;
  L.elbowL -= lag * 0.45;

  // the head stays on the ball: it is the one thing that must NOT move
  L.headRy -= (L.twist || 0) * 0.55;
  return L;
}
