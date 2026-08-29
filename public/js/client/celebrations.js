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
/* The joints a clip may write.  Anything it leaves alone stays as walking.

   Five were added after every animation in the game was described as stiff,
   and they were the five the rig could not do:

     twist        the torso turning while the FEET STAY PUT. `yaw` rotates
                  the whole figure, legs and all, which is a pivot — nobody
                  slaps, throws or swings anything without turning their
                  shoulders against their hips first, and without this every
                  arm movement was an arm movement and nothing else.
     armLy/armRy  arms crossing the body. Shoulders could only swing forward
                  and out, so a backhand, a wave across the chest and a slap
                  all had to be faked with the one axis that was there.
     legLz/legRz  legs splaying sideways: a wide stance, a stagger, a dance.
*/
export const POSE_KEYS = [
  'legLx', 'legRx', 'armLx', 'armRx', 'armLz', 'armRz',
  'bodyY', 'bodyRx', 'bodyRz', 'yaw', 'headRx', 'headRy', 'hatY', 'hatRx',
  'twist', 'armLy', 'armRy', 'legLz', 'legRz',
  /* Added with the two-segment limbs. Every one defaults to 0, so a clip
     written before they existed produces exactly the pose it always did —
     which is why blankPose zeroing the whole list matters more than it
     looks. */
  'kneeL', 'kneeR', 'elbowL', 'elbowR',
  'footL', 'footR',      // ankle lift, from the ground under each shoe
  'headRz', 'breath'
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

   `mood` picks which family of sound Sound.emote reaches for — cheer, laugh,
   groan or stinger — so an emote SOUNDS like what it looks like instead of
   every one playing the same chime. See sound.js. */
export const EMOTES = [
  { id: 'wave', name: 'Wave', icon: 'wave', at: 2, mood: 'cheer',
    blurb: 'A friendly one for the tee box' },
  { id: 'fistpump', name: 'Fist pump', icon: 'fistpump', at: 3, mood: 'stinger',
    blurb: 'For when it drops from distance' },
  { id: 'twirl', name: 'Club twirl', icon: 'twirl', at: 4, mood: 'cheer',
    blurb: 'Pure showboating, and it is earned' },
  { id: 'shrug', name: 'Shrug', icon: 'shrug', at: 5, mood: 'laugh',
    blurb: 'No idea what happened there either' },
  { id: 'clap', name: 'Slow clap', icon: 'clap', at: 6, mood: 'cheer',
    blurb: 'Sincere. Mostly.' },

  /* The back half. Five emotes ran out at level 6, which on a hundred-level
     ladder meant the wheel was finished before anybody had really started —
     and the emote wheel is the most-opened thing in the game after the
     scorecard. These are spread the rest of the way up. */
  { id: 'bow', name: 'Take a bow', icon: 'bow', at: 15, mood: 'stinger',
    blurb: 'For an audience that may not exist' },
  { id: 'facepalm', name: 'Facepalm', icon: 'facepalm', at: 21, mood: 'groan',
    blurb: 'The only honest response to that one' },
  { id: 'point', name: 'Called it', icon: 'point', at: 30, mood: 'cheer',
    blurb: 'Point at the hole before it drops' },
  { id: 'dance', name: 'Little dance', icon: 'dance', at: 44, mood: 'laugh',
    blurb: 'Undignified and entirely earned' },
  { id: 'airswing', name: 'Air swing', icon: 'airswing', at: 50, mood: 'laugh',
    blurb: 'A practice pass at absolutely nothing' },
  { id: 'flex', name: 'Flex', icon: 'flex', at: 58, mood: 'stinger',
    blurb: 'Both arms. No apology.' },
  { id: 'tip', name: 'Cap tip', icon: 'tip', at: 70, mood: 'cheer',
    blurb: 'The old-fashioned one' },
  { id: 'crown', name: 'Crown', icon: 'crown', at: 80, mood: 'stinger',
    blurb: 'Both hands, held above the head' },
  { id: 'sleep', name: 'Slow play', icon: 'sleep', at: 88, mood: 'groan',
    blurb: 'For whoever is reading their putt again' },
  { id: 'micdrop', name: 'Mic drop', icon: 'micdrop', at: 95, mood: 'stinger',
    blurb: 'Nothing left to prove up here' }
];

/** Which emotes a player of this level has. */
export const emotesAt = level =>
  EMOTES.filter(e => e.at <= (Number(level) || 1));

/* ---- the loadout -------------------------------------------------------
   "Own many, carry a few" — the same shape as the club bag. A player earns
   the whole back half of this list over a hundred levels; scrolling all of
   it open-wheel mid-round is the exact complaint this fixes. Equipping is a
   PROFILE setting (validated here, on both ends) so a level lost to nothing
   — levels do not go down — never leaves a stale id in the loadout; the
   filter below is what makes that true regardless of how it got there. */
export const EMOTE_SLOTS = 8;

/**
 * Clean a client-submitted loadout down to ids the player actually owns,
 * deduplicated and capped at EMOTE_SLOTS, preserving the order given (that
 * order is the whole point — it is what drag-to-reorder is arranging).
 * An empty or entirely-invalid submission is not an error, just a player
 * who has not built a loadout yet — falls back to their earliest unlocks,
 * so the wheel is never blank the first time it opens.
 */
export function normaliseEmoteLoadout(ids, level) {
  const owned = new Set(emotesAt(level).map(e => e.id));
  const clean = [...new Set((Array.isArray(ids) ? ids : []).filter(id => owned.has(id)))]
    .slice(0, EMOTE_SLOTS);
  return clean.length ? clean : emotesAt(level).slice(0, EMOTE_SLOTS).map(e => e.id);
}

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

/* --- the back half of the wheel, levels 15 to 88 --------------------- */

EMOTE_CLIPS.bow = {
  dur: 1.30, in: 0.16, out: 0.32,
  pose(P, k) {
    const down = Math.min(1, Math.sin(Math.PI * k) * 1.6);
    P.bodyRx = 0.92 * down;                 // fold at the waist
    P.headRx = 0.30 * down;
    P.armLx = 0.55 * down; P.armRx = 0.55 * down;
    P.armLz = 0.30 * down; P.armRz = -0.30 * down;
    P.bodyY = -0.10 * down;
    P.hatRx = 0.18 * down;
  }
};

EMOTE_CLIPS.facepalm = {
  dur: 1.55, in: 0.14, out: 0.34,
  pose(P, k) {
    // hand up fast, then it just stays there a while
    const up = Math.min(1, k / 0.22);
    const hold = Math.max(0, 1 - Math.max(0, k - 0.72) / 0.28);
    const e = up * hold;
    P.armRx = UP * 0.62 * e;
    P.armRz = -0.62 * e;
    P.headRx = 0.30 * e;
    P.bodyRx = 0.14 * e;
    P.bodyY = -0.05 * e;
  }
};

EMOTE_CLIPS.point = {
  dur: 1.05, in: 0.12, out: 0.26,
  pose(P, k) {
    const jab = env(k, 2.1) * (0.72 + 0.28 * Math.sin(k * Math.PI * 5));
    P.armRx = -1.62 * jab;                  // arm straight out ahead
    P.armRz = -0.12 * jab;
    P.bodyRx = -0.10 * jab;
    P.headRx = -0.08 * jab;
    P.yaw = -0.06 * jab;
  }
};

EMOTE_CLIPS.dance = {
  dur: 2.10, in: 0.18, out: 0.36,
  pose(P, k) {
    const e = env(k, 2.0);
    const beat = k * Math.PI * 8;
    P.bodyY = Math.abs(Math.sin(beat)) * 0.075 * e;
    P.bodyRz = Math.sin(beat) * 0.16 * e;
    P.yaw = Math.sin(beat * 0.5) * 0.30 * e;
    P.armLx = (UP * 0.42 + Math.sin(beat) * 0.5) * e;
    P.armRx = (UP * 0.42 - Math.sin(beat) * 0.5) * e;
    P.armLz = 0.42 * e; P.armRz = -0.42 * e;
    P.legLx = Math.sin(beat) * 0.34 * e;
    P.legRx = -Math.sin(beat) * 0.34 * e;
    P.headRy = Math.sin(beat * 0.5) * 0.22 * e;
  }
};

EMOTE_CLIPS.flex = {
  dur: 1.45, in: 0.16, out: 0.32,
  pose(P, k) {
    const e = env(k, 1.9);
    const pulse = 0.86 + 0.14 * Math.sin(k * Math.PI * 6);
    // both arms up and in, elbows out — the double biceps
    P.armLx = UP * 0.60 * e * pulse; P.armRx = UP * 0.60 * e * pulse;
    P.armLz = 0.95 * e; P.armRz = -0.95 * e;
    P.bodyRx = -0.14 * e;
    P.bodyY = 0.035 * e;
    P.headRx = -0.10 * e;
  }
};

EMOTE_CLIPS.tip = {
  dur: 1.20, in: 0.14, out: 0.30,
  pose(P, k) {
    const lift = env(k, 2.2);
    P.armRx = UP * 0.52 * lift;
    P.armRz = -0.42 * lift;
    P.hatY = 0.13 * lift;                   // the cap actually comes off
    P.hatRx = -0.42 * lift;
    P.headRx = 0.14 * lift;
    P.bodyRx = 0.12 * lift;
  }
};

/** A big, self-mocking practice pass at nothing — the swing overcooks its
 *  own follow-through and the feet catch up a beat late. */
EMOTE_CLIPS.airswing = {
  dur: 1.60, in: 0.14, out: 0.30,
  pose(P, k) {
    const e = env(k, 1.6);
    const swing = Math.sin(k * Math.PI * 1.3);
    P.yaw = swing * 1.1 * e;
    P.armRx = -0.9 * e + swing * 0.6 * e;
    P.armRz = -0.5 * e;
    P.armLx = -0.5 * e;
    P.armLz = 0.3 * e;
    P.bodyRz = swing * 0.35 * e;
    P.legLx = -swing * 0.2 * e;
    P.legRx = swing * 0.25 * e;
    P.headRy = swing * 0.3 * e;
    P.bodyY = -Math.max(0, swing) * 0.05 * e;     // a little stumble at the end
  }
};

/** Both hands meet above the head — a crown, not a fist pump. Held rather
 *  than pulsed, the way a real "yes, obviously" pose would be. */
EMOTE_CLIPS.crown = {
  dur: 1.50, in: 0.18, out: 0.34,
  pose(P, k) {
    const e = env(k, 1.8);
    P.armLx = UP * 0.95 * e;
    P.armRx = UP * 0.95 * e;
    P.armLz = 0.5 * e;
    P.armRz = -0.5 * e;
    P.bodyY = 0.05 * e;
    P.bodyRx = -0.06 * e;
  }
};

/** Up fast, held, then dropped hard well before the clip ends — the whole
 *  point is the drop, so unlike everything else here the arm does not ease
 *  back out with a symmetric envelope. Every channel below is scaled by
 *  the SAME armPhase rather than tracking k independently, which is what
 *  guarantees they all reach exactly zero together once the drop
 *  finishes — a channel with its own timing is a channel that can still
 *  be nonzero after the arm has already let go. */
EMOTE_CLIPS.micdrop = {
  dur: 1.35, in: 0.10, out: 0.10,
  pose(P, k) {
    const RISE = 0.35, DROP_AT = 0.62, DROP_DUR = 0.18;
    let armPhase;
    if (k < RISE) armPhase = k / RISE;
    else if (k < DROP_AT) armPhase = 1;
    else armPhase = Math.max(0, 1 - (k - DROP_AT) / DROP_DUR);
    P.armRx = UP * 0.55 * armPhase;
    P.armRz = -0.3 * armPhase;
    P.headRy = 0.14 * armPhase;
    P.bodyRz = -0.05 * armPhase;
    P.bodyY = 0.02 * armPhase;
  }
};

EMOTE_CLIPS.sleep = {
  dur: 2.30, in: 0.20, out: 0.40,
  pose(P, k) {
    const e = env(k, 2.0);
    const snore = Math.sin(k * Math.PI * 3.5);
    P.headRx = 0.34 * e + snore * 0.06 * e;
    P.bodyRx = 0.16 * e;
    P.bodyRz = -0.12 * e;
    P.bodyY = -0.05 * e + snore * 0.012 * e;
    P.armLx = 0.22 * e; P.armRx = 0.22 * e;
    P.legLx = 0.10 * e;
  }
};

/* =========================================================================
   MELEE — the three ways to lay hands on somebody
   -------------------------------------------------------------------------
   There was one: a barge. It did one thing, at one strength, and it looked
   the same every time, so after ten minutes nobody pressed the key.

   Three moves now, and they differ in the ways a player can feel rather than
   in a number on a stat card:

     barge   what you always had. Shoulder in, medium power, no wind-up, and
             available from the first minute.
     slap    fast and cheap. Barely moves them, but it spins them on the spot
             and the recovery is short enough to do it again immediately —
             the annoying one.
     kick    slow, telegraphed, and it launches. Longest cooldown in the game
             and the longest wind-up, so a good player sees it coming and
             walks away — which is what makes landing one funny.

   `at` is the level it unlocks. Nothing here is available on day one except
   the barge, so a melee is something you grow into.
   ========================================================================= */
export const MELEES = [
  { id: 'barge', name: 'Barge', icon: 'barge', at: 1, key: 'B',
    power: 1.0, cool: 320, spin: 0.0, reach: 2.4,
    blurb: 'Shoulder first. Always in the bag.' },
  { id: 'slap', name: 'Slap', icon: 'slap', at: 11, key: 'B',
    power: 0.42, cool: 240, spin: 2.6, reach: 2.1,
    blurb: 'Barely moves them. Spins them right round.' },
  { id: 'kick', name: 'Boot', icon: 'kick', at: 28, key: 'B',
    power: 1.85, cool: 1100, spin: 0.6, reach: 2.6,
    blurb: 'Slow, obvious, and it sends them.' }
];

export const meleeById = id => MELEES.find(m => m.id === id) || MELEES[0];
/** Which melees a player of this level has. */
export const meleesAt = level =>
  MELEES.filter(m => m.at <= (Number(level) || 1));

/* A shove, from both ends. Not in EMOTES — these are not chosen from a
   wheel, they are what happens to you. */
export const SHOVE_CLIPS = {
  /** The barge: load onto the back foot, then drive the shoulder through. */
  shoving: {
    dur: 0.62, in: 0.08, out: 0.22,
    pose(P, k) {
      const e = env(k, 2.2);
      // wind the shoulders back, then throw them forward through the target
      const load = k < 0.28 ? k / 0.28 : 0;
      const push = k >= 0.28 ? Math.min(1, (k - 0.28) / 0.16) : 0;
      const back = Math.max(0, 1 - (k - 0.44) / 0.56);
      const drive = push * back;
      /* THE HIPS DRIVE IT. Every melee clip in this file expressed its whole
         rotation as `twist`, which before the rig had a pelvis meant the
         torso turned and the legs were counter-rotated to hold the feet —
         so a barge was a man swivelling his chest at somebody. A shove
         comes off the ground: the hips open first and the shoulders arrive
         after them, which is the same kinematic sequence the golf swing
         got and the same reason it reads as a body rather than a hinge.

         Split roughly 45/55 between pelvis and coil, with the pelvis
         slightly ahead into the drive. */
      P.yaw = (0.20 * load - 0.34 * drive);
      P.twist = (0.24 * load - 0.24 * drive);
      P.armLx = (-0.4 * load - 1.75 * drive); P.armRx = (-0.4 * load - 1.6 * drive);
      P.armLz = 0.34 * drive; P.armRz = -0.34 * drive;
      P.armLy = -0.35 * drive; P.armRy = 0.28 * drive;   // hands meet in front
      P.bodyRx = (0.12 * load - 0.30 * drive);
      P.bodyRz = 0.12 * e;
      P.legRx = -0.30 * load + 0.34 * drive;             // step into it
      P.legLx = 0.22 * load - 0.20 * drive;
      P.bodyY = -0.045 * load;
    }
  },
  /** The slap: the whole torso whips, the arm is just the end of it. */
  slapping: {
    dur: 0.42, in: 0.05, out: 0.18,
    pose(P, k) {
      const wind = k < 0.30 ? k / 0.30 : 0;
      const swing = k >= 0.30 ? Math.min(1, (k - 0.30) / 0.14) : 0;
      const back = Math.max(0, 1 - (k - 0.44) / 0.56);
      const hit = swing * back;
      /* The twist does the work and the arm follows. Written the other way
         round — arm only — it looked like someone shooing a fly. */
      /* Same split as the barge above — the hips wind up and unwind first,
         and the shoulders carry the rest. A slap driven entirely from the
         chest is the "shooing a fly" this clip's own comment warns about,
         one level further up the body than it was thinking about. */
      P.yaw = (0.26 * wind - 0.44 * hit);
      P.twist = (0.36 * wind - 0.51 * hit);
      P.armRx = -1.5 * (wind * 0.35 + hit);
      P.armRz = -0.55 * wind + 1.15 * hit;
      P.armRy = 0.85 * wind - 1.25 * hit;         // right across the body
      P.armLx = -0.35 * hit; P.armLz = 0.30 * hit;
      P.bodyRz = 0.18 * hit;
      P.headRy = -0.34 * hit;
      P.legLz = 0.10 * hit; P.legRz = -0.10 * hit;
    }
  },

  /** The boot: plant, load, and swing a leg through. Deliberately slow. */
  kicking: {
    dur: 0.78, in: 0.06, out: 0.24,
    pose(P, k) {
      /* Half the clip is the wind-up. That is the design, not padding — the
         boot is meant to be seen coming, so the reward for landing one is
         that they did not walk away in time. */
      const load = k < 0.45 ? k / 0.45 : Math.max(0, 1 - (k - 0.45) / 0.2);
      const swing = k >= 0.45 ? Math.min(1, (k - 0.45) / 0.18) : 0;
      const back = Math.max(0, 1 - (k - 0.63) / 0.37);
      P.legRx = (0.55 * load - 2.15 * swing) * back;   // back, then through
      P.legLx = 0.18 * load * back;
      P.legRz = -0.20 * swing * back;                  // the boot turns over
      P.bodyRx = (0.26 * load + 0.34 * swing) * back;  // lean back over the plant
      /* "hips open into it" is what this line always said it was doing, and
         `twist` is the SHOULDERS — before the rig had a pelvis there was
         nowhere else to put it. There is now: the pelvis opens around the
         plant foot and the shoulders COUNTER-rotate, which is what keeps a
         kicker upright and is most of why a kick reads as a kick. */
      P.yaw = (-0.30 * load + 0.46 * swing) * back;    // the pelvis, around the plant
      P.twist = (-0.14 * load - 0.20 * swing) * back;  // shoulders counter, for balance
      P.armLx = -0.95 * (load + swing) * back;         // arms up for balance
      P.armRx = -0.55 * (load + swing) * back;
      P.armLz = 0.62 * back * (load + swing);
      P.armRy = -0.30 * swing * back;
      P.bodyY = -0.06 * load * back + 0.04 * swing * back;
      P.headRx = -0.12 * swing * back;
    }
  },

  /** Taking one: knocked back, arms out for balance, then recovering. */
  staggered: {
    dur: 0.85, in: 0.05, out: 0.34,
    pose(P, k) {
      const e = env(k, 2.0);
      const hit = Math.max(0, 1 - k / 0.4);
      P.bodyRx = 0.34 * hit;                 // rocked backwards
      P.bodyRz = -0.16 * e;
      P.armLx = -1.1 * e; P.armRx = -0.9 * e;
      P.armLz = 0.72 * e; P.armRz = -0.62 * e;
      P.legLx = 0.42 * hit; P.legRx = -0.30 * hit;
      P.legLz = 0.24 * e; P.legRz = -0.16 * e;    // feet scrabble wide
      /* Being shoved turns the WHOLE body — you are knocked off your line,
         not swivelled at the chest. The pelvis takes most of it and the
         shoulders whip a little further, which is the difference between
         stumbling and shrugging. */
      P.yaw = -0.34 * e;
      P.twist = -0.20 * e;
      P.armLy = 0.30 * e; P.armRy = -0.24 * e;
      P.headRx = 0.22 * hit;
      P.bodyY = -0.06 * hit;
    }
  }
};

/* Taking a BOOT is not taking a barge. Off the feet, round on the spot, and
   a slower climb back up — the reaction has to sell the difference or the
   move is just a bigger number. */
SHOVE_CLIPS.launched = {
  dur: 1.35, in: 0.04, out: 0.42,
  pose(P, k) {
    const e = env(k, 2.0);
    const hit = Math.max(0, 1 - k / 0.28);
    const air = Math.max(0, Math.sin(Math.PI * Math.min(1, k / 0.55)));
    P.bodyRx = 0.85 * hit + 0.30 * air;
    P.bodyRz = -0.34 * e;
    P.yaw = 1.9 * air;                       // spun round by it
    P.twist = 0.55 * air;
    P.bodyY = 0.20 * air - 0.10 * hit;
    P.legLx = -0.95 * air; P.legRx = 0.70 * air;
    P.legLz = 0.40 * air; P.legRz = -0.34 * air;
    P.armLx = -1.5 * e; P.armRx = -1.3 * e;
    P.armLz = 0.95 * e; P.armRz = -0.85 * e;
    P.headRx = 0.34 * hit;
  }
};

/* And a slap barely moves you — it just makes you look silly. */
SHOVE_CLIPS.spun = {
  dur: 0.62, in: 0.04, out: 0.24,
  pose(P, k) {
    const e = env(k, 2.4);
    P.yaw = 1.15 * e;
    P.twist = 0.45 * e;
    P.headRy = -0.5 * e;
    P.bodyRz = 0.18 * e;
    P.armLz = 0.5 * e; P.armRz = -0.45 * e;
    P.armLx = -0.5 * e; P.armRx = -0.4 * e;
  }
};
