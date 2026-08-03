/* =========================================================================
   celebrations.js — what a golfer does when the putt drops
   -------------------------------------------------------------------------
   Pure pose data: no imports, no Three.js, no DOM.  Each clip writes joint
   values into a caller-supplied object, so playing one allocates nothing and
   adds no geometry — the celebration rides the same thirteen boxes the avatar
   already has.

   Every clip is authored on k ∈ [0,1] and MUST return to the neutral pose at
   k = 1, because the blend-out is what hands control back to the walk cycle.
   ========================================================================= */

/** The joints a clip may write.  Anything it leaves alone stays as walking. */
export const POSE_KEYS = [
  'legLx', 'legRx', 'armLx', 'armRx', 'armLz', 'armRz',
  'bodyY', 'bodyRx', 'bodyRz', 'yaw', 'headRx', 'headRy', 'hatY', 'hatRx'
];

export function blankPose(P = {}) {
  for (let i = 0; i < POSE_KEYS.length; i++) P[POSE_KEYS[i]] = 0;
  return P;
}

/* An envelope that rises quickly, holds, and is exactly 0 at both ends —
   so a clip never has to special-case its own entry and exit. */
const env = (k, sharpness = 1.7) => Math.min(1, Math.sin(Math.PI * k) * sharpness);

/* Arms hang down the -Y axis, so rotating a shoulder by -π raises it overhead. */
const UP = -2.75;

export const CLIPS = {
  /* --------------------------------------------------------------- birdie --
     Deliberately restrained.  Birdies are the workhorse of a good round; if
     one looks like winning the Open then an eagle has nowhere left to go. */
  birdie: {
    dur: 1.25, in: 0.14, out: 0.30,
    pose(P, k) {
      // two short fist pumps under one envelope
      const pump = env(k) * Math.abs(Math.sin(Math.PI * 2 * k));
      P.armRx = UP * 0.85 * pump;
      P.armRz = -0.22 * pump;
      P.armLx = 0.30 * pump;
      P.bodyRx = -0.10 * pump;
      P.headRx = -0.14 * pump;
      P.bodyY = 0.05 * pump;
    }
  },

  /* ---------------------------------------------------------------- eagle --
     Both arms up, one hop, a quarter turn to the gallery. */
  eagle: {
    dur: 1.80, in: 0.16, out: 0.34,
    pose(P, k) {
      const e = env(k);
      const hop = k < 0.46 ? Math.sin(Math.PI * (k / 0.46)) : 0;
      P.armLx = UP * e; P.armRx = UP * e;
      P.armLz = 0.34 * e; P.armRz = -0.34 * e;
      P.bodyRx = -0.16 * e;
      P.bodyY = 0.30 * hop;
      P.legLx = -0.55 * hop; P.legRx = -0.48 * hop;
      P.yaw = 0.40 * e;
      P.headRx = -0.20 * e;
    }
  },

  /* ------------------------------------------------------------------ ace --
     Hole in one, or better than an eagle.  Two hops, a full turn, and the cap
     comes off at the end — the one animation allowed to be theatrical. */
  ace: {
    dur: 2.40, in: 0.12, out: 0.40,
    pose(P, k) {
      const e = env(k, 2.4);
      const hop = k < 0.60 ? Math.max(0, Math.sin(Math.PI * 2.4 * k)) : 0;
      P.armLx = UP * 1.02 * e; P.armRx = UP * 1.02 * e;
      P.armLz = 0.45 * e; P.armRz = -0.45 * e;
      P.bodyY = 0.42 * hop;
      P.legLx = -0.78 * hop; P.legRx = -0.62 * hop;
      P.bodyRx = -0.22 * e;
      P.headRx = -0.26 * e;
      // one full revolution, eased, finishing square so the blend-out is clean
      const t = Math.min(1, Math.max(0, (k - 0.12) / 0.70));
      P.yaw = Math.PI * 2 * (t * t * (3 - 2 * t));

      // cap doff over the last third: the hat lifts and the right arm holds it
      const doff = k > 0.66 ? Math.sin(Math.PI * ((k - 0.66) / 0.34)) : 0;
      if (doff > 0) {
        P.hatY = 0.34 * doff;
        P.hatRx = -0.95 * doff;
        P.armRx = UP * 0.68 * e - 0.35 * doff;
      }
    }
  },

  /* ---------------------------------------------------------------- slump --
     Triple bogey or a pick-up.  Shoulders down, two slow shakes of the head.
     The shake frequency is chosen so it lands exactly on zero at k = 1. */
  slump: {
    dur: 1.85, in: 0.28, out: 0.45,
    pose(P, k) {
      const e = env(k, 1.9);
      P.bodyRx = 0.30 * e;
      P.armLx = 0.42 * e; P.armRx = 0.42 * e;
      P.armLz = -0.12 * e; P.armRz = 0.12 * e;
      P.headRx = 0.34 * e;
      P.headRy = 0.30 * e * Math.sin(Math.PI * 4 * k);   // two full shakes
      P.bodyY = -0.055 * e;
    }
  }
};

export const REACTION_TIER = { ace: 3, eagle: 2, birdie: 1, slump: -1 };

/**
 * What, if anything, a score is worth reacting to.
 *
 * Par and bogey get nothing on purpose.  They are the two most common
 * outcomes in the game, and celebrating them makes a birdie feel like
 * nothing.  A double bogey is ordinary off championship tees, so the
 * dejection starts at a triple.
 *
 * @param strokes  total strokes for the hole, penalties included
 * @param par      the hole's par
 * @param capped   true if the player picked up at the stroke limit
 */
export function reactionFor(strokes, par, capped) {
  if (capped) return 'slump';
  if (!(strokes > 0) || !(par > 0)) return null;
  if (strokes === 1) return 'ace';               // checked before par-relative
  const rel = strokes - par;
  if (rel <= -3) return 'ace';                   // albatross or better
  if (rel === -2) return 'eagle';
  if (rel === -1) return 'birdie';
  if (rel >= 3) return 'slump';
  return null;                                   // par, bogey, double
}

/** Seconds a reaction runs for, or 0 if there is no such clip. */
export const clipDuration = name => CLIPS[name]?.dur || 0;

/* =========================================================================
   EMOTES — the ones you choose, rather than the ones the scorecard chooses
   -------------------------------------------------------------------------
   Same pose contract as the celebrations above: authored on k in [0,1],
   neutral at both ends, writing into a caller-supplied object.  They cost no
   geometry and no download — an emote is a few numbers moving the thirteen
   boxes the golfer already has.

   Unlocked by LEVEL, not bought, so there is a reason to keep playing that
   coins do not already cover.  `at` is the level each one arrives at.
   ========================================================================= */
export const EMOTES = [
  { id: 'wave', name: 'Wave', icon: '👋', at: 2,
    blurb: 'A friendly one for the tee box' },
  { id: 'fistpump', name: 'Fist pump', icon: '💪', at: 3,
    blurb: 'For when it drops from distance' },
  { id: 'twirl', name: 'Club twirl', icon: '🌀', at: 4,
    blurb: 'Pure showboating, and it is earned' },
  { id: 'shrug', name: 'Shrug', icon: '🤷', at: 5,
    blurb: 'No idea what happened there either' },
  { id: 'clap', name: 'Slow clap', icon: '👏', at: 6,
    blurb: 'Sincere. Mostly.' }
];

/** Which emotes a player of this level has. */
export const emotesAt = level =>
  EMOTES.filter(e => e.at <= (Number(level) || 1));

export const EMOTE_CLIPS = {
  wave: {
    dur: 1.45, in: 0.16, out: 0.30,
    pose(P, k) {
      const e = env(k);
      // arm up and out, hand swinging from the shoulder
      P.armRx = UP * 0.78 * e;
      P.armRz = -0.30 * e + Math.sin(k * Math.PI * 6) * 0.34 * e;
      P.headRy = 0.12 * e;
      P.bodyRz = -0.04 * e;
    }
  },

  fistpump: {
    dur: 1.15, in: 0.12, out: 0.26,
    pose(P, k) {
      const pump = env(k, 1.9) * Math.abs(Math.sin(Math.PI * 2.5 * k));
      P.armRx = UP * 0.92 * pump;
      P.armRz = -0.18 * pump;
      P.armLx = 0.34 * pump;
      P.bodyRx = -0.13 * pump;
      P.headRx = -0.16 * pump;
      P.bodyY = 0.06 * pump;
    }
  },

  twirl: {
    dur: 1.60, in: 0.14, out: 0.32,
    pose(P, k) {
      const e = env(k);
      // the club hand spins through a full turn, the body rides it
      P.armRx = -1.15 * e + Math.sin(k * Math.PI * 2) * 0.55 * e;
      P.armRz = -Math.cos(k * Math.PI * 2) * 0.7 * e;
      P.armLx = 0.20 * e;
      P.yaw = Math.sin(k * Math.PI * 2) * 0.30 * e;
      P.bodyRx = -0.06 * e;
      P.headRy = Math.sin(k * Math.PI * 2) * 0.18 * e;
    }
  },

  shrug: {
    dur: 1.35, in: 0.20, out: 0.34,
    pose(P, k) {
      // hold at the top rather than pulsing — a shrug is a pause, not a wave
      const hold = Math.min(1, Math.sin(Math.PI * k) * 2.6);
      P.armLx = -0.62 * hold; P.armRx = -0.62 * hold;
      P.armLz = 0.85 * hold; P.armRz = -0.85 * hold;
      P.bodyY = 0.045 * hold;
      P.headRx = 0.16 * hold;
      P.headRy = -0.10 * hold;
    }
  },

  clap: {
    dur: 1.75, in: 0.16, out: 0.30,
    pose(P, k) {
      const e = env(k);
      // hands meet in front, slowly, four times
      const beat = (Math.cos(k * Math.PI * 8) + 1) * 0.5;
      P.armLx = -1.42 * e; P.armRx = -1.42 * e;
      P.armLz = (0.10 + 0.42 * beat) * e;
      P.armRz = -(0.10 + 0.42 * beat) * e;
      P.headRx = -0.08 * e;
      P.bodyRx = -0.05 * e;
    }
  }
};
