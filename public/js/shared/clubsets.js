/* =========================================================================
   clubsets.js — the bag you actually swing, and the one place power is
   allowed to come from a case
   -------------------------------------------------------------------------
   This replaces the old coin-bought CLUB_TIERS ladder (Wooden Starter ->
   Signature Set, seven rungs, 792,000 coins end to end). Sets now drop from
   the Club Case, and you upgrade the set you actually pulled rather than
   buying your way up a fixed staircase.

   THE RULE THIS DELIBERATELY BREAKS. Everywhere else in this game, levels
   and cases buy IDENTITY and coins buy DISTANCE — test/xp.mjs enforces it
   by name ("levels buy identity, never power") and it is why a decal has
   never carried a stat. Club sets are the single, deliberate exception:
   a rarer set genuinely hits further. That test still holds for every
   cosmetic kind; it is scoped to them rather than deleted, so the
   exception is recorded rather than quietly lost.

   STATS COME FROM RARITY, NOT FROM THE SET. Every Mythic set is exactly as
   strong as every other Mythic set. Which one you pulled is pure flex, so
   no set is ever a trap, and adding a new brand below can never
   accidentally shift the balance of the game. A set entry is identity
   only: a name, a maker, and what it looks like.

   THE CEILING HAS NOT MOVED. A fully upgraded Mythic set is speed 1.065,
   which is exactly what the old Signature Set was. Course difficulty, the
   twenty calibrated carry targets in test/physics.mjs, and every yardage a
   player has learned all still mean what they meant.
   ========================================================================= */

import { CLUBS, CLUB_BY_KEY, BAG_SIZE, DEFAULT_BAG } from './clubs.js';

/* ═════════════════════════════════════════ THE FIVE CLASSES ══════════════
   Clubs were already strictly classed and already carry their own physics —
   clubs.js gives every one of the 21 a launch angle, a backspin rate and a
   `curve` (sidespin per degree of face). A driver launches at 11.5° with
   2,500 rpm; a lob wedge at 43° with 11,200. test/physics.mjs pins twenty
   carry targets to within a metre of those numbers, so none of that moves.

   What was missing is that a SET applied one number to the whole bag. These
   five classes are the grain a set's stats are authored at, so a set can be
   a bomber or a wedge specialist rather than uniformly "good".

   Driver is its own class rather than a wood: it is one club, it is the one
   everybody notices, and lumping it with the 3-wood would mean no set could
   ever be about driving specifically. */
export const CLUB_CLASSES = ['driver', 'woods', 'irons', 'wedges', 'putter'];

export const CLASS_LABEL = {
  driver: 'Driver', woods: 'Woods & hybrids', irons: 'Irons',
  wedges: 'Wedges', putter: 'Putter'
};

/** Which class a club key belongs to. Derived from clubs.js's own `type`
 *  rather than a second hand-kept list — the only special case is that the
 *  driver is pulled out of 'wood'. */
export function classOf(clubKey) {
  if (clubKey === 'DR') return 'driver';
  const c = CLUB_BY_KEY[clubKey];
  if (!c) return null;
  if (c.putter || c.type === 'putter') return 'putter';
  if (c.type === 'wood' || c.type === 'hybrid') return 'woods';
  if (c.type === 'iron') return 'irons';
  if (c.type === 'wedge') return 'wedges';
  return null;
}

/* WHAT A SET IS MADE OF: the fourteen clubs the rules let you carry, which
   is also what DEFAULT_BAG already is. You collect them one at a time.

   The game has 21 clubs; the other seven (2 iron, 7 wood, the extra
   hybrids, the flop wedge) are alternates you can swap INTO a bag rather
   than pieces of a set. A player carrying one still gets their set's line
   for that club's class — they are just not part of what completes it. */
export const SET_CLUBS = [...DEFAULT_BAG];

/** Every SET club in a class. This is what completion counts against, so
 *  it is over the fourteen, not over all twenty-one. */
export const CLUBS_IN_CLASS = Object.fromEntries(
  CLUB_CLASSES.map(k => [k, SET_CLUBS.filter(key => classOf(key) === k)])
);

/** Every club in a class, including the alternates — for the Locker's own
 *  "what does this class cover" display. */
export const ALL_CLUBS_IN_CLASS = Object.fromEntries(
  CLUB_CLASSES.map(k => [k, CLUBS.filter(c => classOf(c.key) === k).map(c => c.key)])
);

/* ────────────────────────────────────── the four stats a set carries ─────
   Each maps onto a lever the simulation ALREADY has, which is why this can
   be wired in without a second physics model beside the calibrated one:

     dist     multiplies club.speed            ballistics.js "let speed ="
     forgive  damps the face angle before physics sees it    "const face ="
     spin     multiplies the backspin reward   "const spinReward ="
     sweet    widens the sweet spot in DEGREES of face error  "const purity ="

   `sweet` is the odd one and the most interesting: purity is computed as
   1 - |face| / 6, so that 6 is literally how many degrees of open face it
   takes to lose all strike quality. A bigger number is a bigger sweet spot.
   Nothing modified it before this. */
export const STAT_KEYS = ['dist', 'forgive', 'spin', 'sweet'];
export const STAT_LABEL = {
  dist: 'Max distance', forgive: 'Forgiveness',
  spin: 'Spin control', sweet: 'Sweet spot'
};

/* The band each rarity's class lines must sit inside. Authored lines are
   explicit per set (see CLASS_LINES) so a set can have real character, and
   test/clubsets.mjs asserts every one of them lands inside its band — which
   is what stops 280 hand-written numbers drifting into a broken set. */
export const CLASS_BANDS = {
  standard: { dist: [0.860, 0.905], forgive: [0.00, 0.06], spin: [0.92, 0.99], sweet: [5.6, 6.2] },
  tour:     { dist: [0.890, 0.940], forgive: [0.05, 0.12], spin: [0.96, 1.04], sweet: [6.0, 6.8] },
  pro:      { dist: [0.925, 0.980], forgive: [0.11, 0.19], spin: [1.00, 1.09], sweet: [6.5, 7.4] },
  legend:   { dist: [0.965, 1.020], forgive: [0.18, 0.26], spin: [1.04, 1.14], sweet: [7.0, 8.0] },
  mythic:   { dist: [1.000, 1.065], forgive: [0.25, 0.33], spin: [1.08, 1.20], sweet: [7.6, 8.8] }
};

/* ══════════════════════ WHAT EACH SET DOES, PER CLASS ════════════════════
   Five independent stat lines per set, written out. A set is not uniformly
   "good" any more — Saltmarsh Links is a bomber that gives up spin, Ironclad
   CB trades distance for forgiveness and a wide sweet spot, Obsidian Forged
   is a blade: long and high-spin but punishing off centre.

   Every line is a BASE, at zero completion. What you collect scales it
   toward the rarity's ceiling — see setStats.

   `dist` and `forgive` sit LOW in their bands on purpose: a fresh set of
   one rarity must never out-hit a fully collected set of the rarity below,
   or collecting the thing you actually pulled stops paying. `spin` and
   `sweet` are unconstrained by that ladder, so they carry most of a set's
   character — which is why the blades/cavity-back difference reads clearly
   while the distance difference stays modest.

   These were drafted from a per-set archetype against CLASS_BANDS and then
   written out as literals, so any single class of any single set can be
   tuned by hand without disturbing the rest. test/clubsets.mjs asserts all
   280 of them land inside their rarity's band, which is what keeps a
   hand-edit from quietly creating a broken set. */
export const CLASS_LINES = {
  /* Hickory Standard — balanced */
  hickory: {
    driver:  { dist: 0.865, forgive: 0.007, spin: 0.955, sweet: 5.9 },
    woods:   { dist: 0.865, forgive: 0.007, spin: 0.955, sweet: 5.9 },
    irons:   { dist: 0.865, forgive: 0.007, spin: 0.955, sweet: 5.9 },
    wedges:  { dist: 0.865, forgive: 0.007, spin: 0.955, sweet: 5.9 },
    putter:  { dist: 0.865, forgive: 0.007, spin: 0.955, sweet: 5.9 }
  },
  /* Ryebank Municipal — shortgame */
  ryebank: {
    driver:  { dist: 0.863, forgive: 0.008, spin: 0.972, sweet: 5.97 },
    woods:   { dist: 0.863, forgive: 0.008, spin: 0.972, sweet: 5.97 },
    irons:   { dist: 0.865, forgive: 0.008, spin: 0.972, sweet: 5.97 },
    wedges:  { dist: 0.863, forgive: 0.008, spin: 0.989, sweet: 6.17 },
    putter:  { dist: 0.863, forgive: 0.008, spin: 0.984, sweet: 6.14 }
  },
  /* Coalfield Blades — blades */
  coalfield: {
    driver:  { dist: 0.867, forgive: 0.002, spin: 0.988, sweet: 5.66 },
    woods:   { dist: 0.867, forgive: 0.002, spin: 0.988, sweet: 5.66 },
    irons:   { dist: 0.867, forgive: 0.002, spin: 0.988, sweet: 5.66 },
    wedges:  { dist: 0.867, forgive: 0.002, spin: 0.988, sweet: 5.66 },
    putter:  { dist: 0.867, forgive: 0.004, spin: 0.988, sweet: 5.8 }
  },
  /* Kestrel Flight — balanced */
  kestrel: {
    driver:  { dist: 0.895, forgive: 0.058, spin: 1, sweet: 6.4 },
    woods:   { dist: 0.895, forgive: 0.058, spin: 1, sweet: 6.4 },
    irons:   { dist: 0.895, forgive: 0.058, spin: 1, sweet: 6.4 },
    wedges:  { dist: 0.895, forgive: 0.058, spin: 1, sweet: 6.4 },
    putter:  { dist: 0.895, forgive: 0.058, spin: 1, sweet: 6.4 }
  },
  /* Meridian Weave — precision */
  meridian: {
    driver:  { dist: 0.893, forgive: 0.064, spin: 1.006, sweet: 6.74 },
    woods:   { dist: 0.893, forgive: 0.064, spin: 1.006, sweet: 6.74 },
    irons:   { dist: 0.893, forgive: 0.064, spin: 1.016, sweet: 6.74 },
    wedges:  { dist: 0.893, forgive: 0.064, spin: 1.006, sweet: 6.74 },
    putter:  { dist: 0.896, forgive: 0.064, spin: 1.006, sweet: 6.74 }
  },
  /* Saltmarsh Links — bomber */
  saltmarsh: {
    driver:  { dist: 0.901, forgive: 0.056, spin: 0.979, sweet: 6.44 },
    woods:   { dist: 0.9, forgive: 0.056, spin: 0.979, sweet: 6.32 },
    irons:   { dist: 0.896, forgive: 0.056, spin: 0.979, sweet: 6.32 },
    wedges:  { dist: 0.894, forgive: 0.056, spin: 0.989, sweet: 6.32 },
    putter:  { dist: 0.894, forgive: 0.056, spin: 0.979, sweet: 6.32 }
  },
  /* Vantage Tour Issue — balanced */
  vantage: {
    driver:  { dist: 0.931, forgive: 0.119, spin: 1.045, sweet: 6.95 },
    woods:   { dist: 0.931, forgive: 0.119, spin: 1.045, sweet: 6.95 },
    irons:   { dist: 0.931, forgive: 0.119, spin: 1.045, sweet: 6.95 },
    wedges:  { dist: 0.931, forgive: 0.119, spin: 1.045, sweet: 6.95 },
    putter:  { dist: 0.931, forgive: 0.119, spin: 1.045, sweet: 6.95 }
  },
  /* Ironclad CB — precision */
  ironclad: {
    driver:  { dist: 0.929, forgive: 0.126, spin: 1.052, sweet: 7.33 },
    woods:   { dist: 0.929, forgive: 0.126, spin: 1.052, sweet: 7.33 },
    irons:   { dist: 0.929, forgive: 0.126, spin: 1.063, sweet: 7.33 },
    wedges:  { dist: 0.929, forgive: 0.126, spin: 1.052, sweet: 7.33 },
    putter:  { dist: 0.932, forgive: 0.126, spin: 1.052, sweet: 7.33 }
  },
  /* Harrier Pro — bomber */
  harrier: {
    driver:  { dist: 0.937, forgive: 0.117, spin: 1.022, sweet: 7 },
    woods:   { dist: 0.936, forgive: 0.117, spin: 1.022, sweet: 6.86 },
    irons:   { dist: 0.932, forgive: 0.117, spin: 1.022, sweet: 6.86 },
    wedges:  { dist: 0.929, forgive: 0.117, spin: 1.032, sweet: 6.86 },
    putter:  { dist: 0.93, forgive: 0.117, spin: 1.022, sweet: 6.86 }
  },
  /* Halcyon Titanium — bomber */
  halcyon: {
    driver:  { dist: 0.977, forgive: 0.187, spin: 1.064, sweet: 7.55 },
    woods:   { dist: 0.976, forgive: 0.187, spin: 1.064, sweet: 7.4 },
    irons:   { dist: 0.972, forgive: 0.187, spin: 1.064, sweet: 7.4 },
    wedges:  { dist: 0.969, forgive: 0.187, spin: 1.076, sweet: 7.4 },
    putter:  { dist: 0.97, forgive: 0.187, spin: 1.064, sweet: 7.4 }
  },
  /* Obsidian Forged — blades */
  obsidian: {
    driver:  { dist: 0.973, forgive: 0.183, spin: 1.137, sweet: 7.1 },
    woods:   { dist: 0.973, forgive: 0.183, spin: 1.137, sweet: 7.1 },
    irons:   { dist: 0.973, forgive: 0.183, spin: 1.137, sweet: 7.1 },
    wedges:  { dist: 0.973, forgive: 0.183, spin: 1.137, sweet: 7.1 },
    putter:  { dist: 0.973, forgive: 0.186, spin: 1.137, sweet: 7.34 }
  },
  /* Aurelian Gilt — shortgame */
  aurelian: {
    driver:  { dist: 0.968, forgive: 0.191, spin: 1.114, sweet: 7.62 },
    woods:   { dist: 0.969, forgive: 0.191, spin: 1.114, sweet: 7.62 },
    irons:   { dist: 0.971, forgive: 0.191, spin: 1.114, sweet: 7.62 },
    wedges:  { dist: 0.969, forgive: 0.191, spin: 1.139, sweet: 7.95 },
    putter:  { dist: 0.969, forgive: 0.191, spin: 1.132, sweet: 7.9 }
  },
  /* Signature Holo — balanced */
  signet: {
    driver:  { dist: 1.007, forgive: 0.259, spin: 1.14, sweet: 8.2 },
    woods:   { dist: 1.007, forgive: 0.259, spin: 1.14, sweet: 8.2 },
    irons:   { dist: 1.007, forgive: 0.259, spin: 1.14, sweet: 8.2 },
    wedges:  { dist: 1.007, forgive: 0.259, spin: 1.14, sweet: 8.2 },
    putter:  { dist: 1.007, forgive: 0.259, spin: 1.14, sweet: 8.2 }
  },
  /* Nocturne Prototype — blades */
  nocturne: {
    driver:  { dist: 1.01, forgive: 0.253, spin: 1.196, sweet: 7.72 },
    woods:   { dist: 1.01, forgive: 0.253, spin: 1.196, sweet: 7.72 },
    irons:   { dist: 1.01, forgive: 0.253, spin: 1.196, sweet: 7.72 },
    wedges:  { dist: 1.01, forgive: 0.253, spin: 1.196, sweet: 7.72 },
    putter:  { dist: 1.01, forgive: 0.256, spin: 1.196, sweet: 8.01 }
  }
};

/** A set's line for one class, falling back to the starter set. */
export function classLine(setId, cls) {
  const set = CLASS_LINES[setId] || CLASS_LINES[STARTER_SET];
  return (set && set[cls]) || null;
}

/* Base is what the set does the moment it drops; max is what it does fully
   upgraded. The bands OVERLAP on purpose — a maxed Standard set (0.905)
   beats a fresh Tour set (0.890). Upgrading the thing you actually own is
   therefore always worth doing, which is the whole point: the reward for a
   lucky pull is a higher ceiling, not an instant win. */
export const SET_TIERS = {
  standard: { speed: [0.860, 0.905], faceDamp: [0.00, 0.06] },
  tour:     { speed: [0.890, 0.940], faceDamp: [0.05, 0.12] },
  pro:      { speed: [0.925, 0.980], faceDamp: [0.11, 0.19] },
  legend:   { speed: [0.965, 1.020], faceDamp: [0.18, 0.26] },
  mythic:   { speed: [1.000, 1.065], faceDamp: [0.25, 0.33] }
};

/* "Mythics take longer" is THIS — the number of rungs and what they cost,
   not a bigger number at the end of a shorter road. A Standard set is
   maxed for 7,800 coins across 3 upgrades; a Mythic set takes 8 upgrades
   and 775,900, still under what the old Signature Set cost to buy and
   refine (1,025,000) — and players were refunded that, so the top of the
   game is reachable rather than reset.

   THESE NUMBERS ARE LOAD-BEARING FOR THE WHOLE COIN ECONOMY, not just for
   clubs. test/cart.mjs asserts that owning everything takes 200-250 rounds
   and that the coin ladder empties well before the level ladder does; the
   sum of every path here (1,305,400) is most of that total. Retuning one
   rarity moves both. See economy.js's PAYOUT_SCALE, which is the intended
   knob for moving the whole curve at once.

   Written out rather than generated from a curve so every number is
   visible and tunable on its own — the old ladder's costs were a literal
   list too, for the same reason. */
export const UPGRADE_COSTS = {
  standard: [1500, 2400, 3900],
  tour:     [4000, 6400, 10200, 16300],
  pro:      [9500, 14300, 21400, 32100, 48200],
  legend:   [21000, 29800, 42300, 60000, 85200, 121000],
  mythic:   [35000, 44800, 57300, 73400, 94000, 120300, 154000, 197100]
};

/** How many upgrades a set of this rarity has in it. */
export const upgradeCount = rarity => (UPGRADE_COSTS[rarity] || UPGRADE_COSTS.standard).length;

/** What the next upgrade costs, or null when the set is already maxed. */
export function upgradeCost(rarity, level) {
  const costs = UPGRADE_COSTS[rarity] || UPGRADE_COSTS.standard;
  const l = Math.max(0, Math.floor(Number(level) || 0));
  return l >= costs.length ? null : costs[l];
}

/* -------------------------------------------------------------- the sets */
/* Identity only — see the header. `shaft`/`head`/`grip` are carried here
   rather than looked up from a seven-entry table keyed on `look`, because
   that table only ever had seven entries and the 3D turntable's own copy
   of it only had FOUR: buildClub fell through to plain silver for the top
   three sets, so Tour Pro, Titanium Elite and Signature all rendered
   identically. Giving every set its own colours here is what fixes that,
   and it means a new brand needs no new art to be visually distinct.

   `look` stays as the key into clubart.js's 2D FINISH table for the small
   SVG card art, where seven silhouettes is still plenty. */
/* Ids are unique across EVERY collectible in the game, not just within
   this table — a decal is already called 'signature', and two different
   things answering to one id is the kind of thing that works until the day
   something looks one up without knowing which kind it wanted. This set is
   'signet' for that reason; its display name is unchanged. */
export const CLUB_SETS = [
  /* ---- Standard: where everyone starts, and the honest cheap stuff ---- */
  { id: 'hickory', name: 'Hickory Standard', brand: 'Ashcombe', rarity: 'standard',
    look: 'wood', shaft: '#8a6a42', head: '#6e5432', grip: '#5a4630',
    blurb: 'Rope-bound hickory. Short, unforgiving, and where everyone begins.' },
  { id: 'ryebank', name: 'Ryebank Municipal', brand: 'Ashcombe', rarity: 'standard',
    look: 'rust', shaft: '#7a6a5c', head: '#8a5a42', grip: '#3f3a34',
    blurb: 'Pitted heads and duct-taped grips, but it strikes true enough.' },
  { id: 'coalfield', name: 'Coalfield Blades', brand: 'Kestrel', rarity: 'standard',
    look: 'steel', shaft: '#9aa0a8', head: '#41454b', grip: '#23262b',
    blurb: 'Plain forged steel, no cavity, no mercy. Honest metal.' },

  /* ---- Tour: the first sets that feel deliberately chosen ---- */
  { id: 'kestrel', name: 'Kestrel Flight', brand: 'Kestrel', rarity: 'tour',
    look: 'steel', shaft: '#c9ccd2', head: '#3a3d42', grip: '#23262b',
    blurb: 'Polished steel, leather wraps. The first set you clean on purpose.' },
  { id: 'meridian', name: 'Meridian Weave', brand: 'Vantage', rarity: 'tour',
    look: 'carbon', shaft: '#2e3136', head: '#1d1f24', grip: '#15171a',
    blurb: 'Matte carbon shafts. Quiet through the swing, and forgiving.' },
  { id: 'saltmarsh', name: 'Saltmarsh Links', brand: 'Ashcombe', rarity: 'tour',
    look: 'steel', shaft: '#b6c2c0', head: '#48544f', grip: '#242a28',
    blurb: 'Built low and heavy for a coastal wind that never quite drops.' },

  /* ---- Pro: real equipment, and it shows ---- */
  { id: 'vantage', name: 'Vantage Tour Issue', brand: 'Vantage', rarity: 'pro',
    look: 'tour', shaft: '#e8eaee', head: '#22242a', grip: '#1a1c20',
    blurb: 'Tour stamping, milled faces, full length at last.' },
  { id: 'ironclad', name: 'Ironclad CB', brand: 'Ironclad', rarity: 'pro',
    look: 'carbon', shaft: '#3b4046', head: '#14161a', grip: '#101216',
    blurb: 'Deep cavity backs. Ugly, beloved, and impossible to miss with.' },
  { id: 'harrier', name: 'Harrier Pro', brand: 'Kestrel', rarity: 'pro',
    look: 'tour', shaft: '#dfe6ee', head: '#2a3038', grip: '#1c2026',
    blurb: 'Thin faces and a sound at impact you can hear from the next tee.' },

  /* ---- Legend: the ones people notice on the tee ---- */
  { id: 'halcyon', name: 'Halcyon Titanium', brand: 'Vantage', rarity: 'legend',
    look: 'titanium', shaft: '#cdd9e2', head: '#4a5058', grip: '#2a2f35',
    blurb: 'Brushed titanium with a cold blue inlay. Hits like next season.' },
  { id: 'obsidian', name: 'Obsidian Forged', brand: 'Ironclad', rarity: 'legend',
    look: 'carbon', shaft: '#26282e', head: '#0d0e11', grip: '#0a0b0d',
    blurb: 'Black on black on black. Absorbs the light and the golf course.' },
  { id: 'aurelian', name: 'Aurelian Gilt', brand: 'Aurelian', rarity: 'legend',
    look: 'titanium', shaft: '#e8d9a8', head: '#5a4c2e', grip: '#332b1a',
    blurb: 'Gold-anodised crowns. Loud, expensive, and entirely unashamed.' },

  /* ---- Mythic: two, and two is right ---- */
  { id: 'signet', name: 'Signature Holo', brand: 'Aurelian', rarity: 'mythic',
    look: 'signature', shaft: '#e6d8ff', head: '#2a2438', grip: '#1d1828',
    blurb: 'Holographic everything. The bag they put on the poster.' },
  { id: 'nocturne', name: 'Nocturne Prototype', brand: 'Ironclad', rarity: 'mythic',
    look: 'signature', shaft: '#9fe8d8', head: '#10231f', grip: '#0a1614',
    blurb: 'Never went to retail. Seven exist. Nobody agrees on the number.' }
];

export const setById = id => CLUB_SETS.find(s => s.id === id) || null;

/** The free set every profile starts with, and falls back to. Standard on
 *  purpose: a new player's first Club Case must be a genuine upgrade. */
export const STARTER_SET = 'hickory';

/* ------------------------------------------------------------- the maths */
/**
 * What a set at a given upgrade level is actually worth, as the two
 * numbers the simulation consumes.
 *
 * Returns `null` for an unknown id — callers pass that straight into
 * crewEffect, where null already means "the reference ball", so a profile
 * naming a set that no longer exists degrades to the calibration baseline
 * rather than throwing or silently becoming a Wooden Starter Set.
 */
/** The reference bag: what a shot naming no set at all swings. These are
 *  the values the simulation treats as neutral, and `sweet: 6` is the
 *  divisor ballistics.js has always hardcoded on its purity line. */
export const REFERENCE_LINE = { dist: 1, forgive: 0, spin: 1, sweet: 6 };

/* What a 0.000 grade is worth against a 1.000 one. "A slight scaling
   bonus" — 1.5%, which is about a yard and a half on a driver: enough that
   a Mint pull is genuinely better and nowhere near enough to make a Worn
   set of a rarity above worse than a Mint one below. */
export const GRADE_FLOOR = 0.985;

/**
 * The grade a freshly dropped set rolls, 0.000 to 1.000.
 *
 * Skewed toward the low end (x^1.7) so Mint is rare and worth showing off
 * — a flat roll would make the average pull 0.5 and the number boring.
 */
export function rollGrade(rand = Math.random) {
  return Math.pow(Math.max(0, Math.min(1, rand())), 1.7);
}

/**
 * What a set does for ONE CLUB, at a given completion.
 *
 * `completion` is 0..1 — how much of this set you have collected. The
 * authored class line is the base; every stat then travels from there
 * toward its rarity's ceiling. Character therefore lives across the whole
 * collection (a half-built bomber really is a bomber), and a fully
 * completed set of a rarity lands exactly on that rarity's ceiling —
 * which is what keeps a maxed Mythic at 1.065, exactly where the old
 * Signature Set sat and where test/physics.mjs's carry targets assume.
 *
 * Returns null for an unknown set. Callers pass that straight into
 * crewEffect, which already reads null as the reference bag, so a profile
 * naming a set that no longer exists degrades to the calibration baseline
 * rather than throwing.
 */
export function setStats(id, completion = 0, clubKey = null, grade = 1) {
  const set = setById(id);
  if (!set) return null;
  const cls = classOf(clubKey) || 'irons';   // a bag-wide question reads as irons
  const line = classLine(set.id, cls);
  if (!line) return null;
  const band = CLASS_BANDS[set.rarity] || CLASS_BANDS.standard;
  // clamped, not trusted: a hand-edited save claiming 3.0 gets a maxed set
  const t = Math.max(0, Math.min(1, Number(completion) || 0));
  /* THE GRADE SCALES THE WHOLE LINE, IT DOES NOT ADD TO IT. A worn set is
     1.5% short of what a mint one of the same set does; a mint one is
     exactly the number the tables say. Done this way round on purpose —
     a bonus stacked ON TOP would push a maxed Mythic past 1.065 and quietly
     inflate the whole game, and every calibrated carry with it. This way
     the ceiling is still the ceiling and the grade decides how close to it
     you actually get. */
  const g = Math.max(0, Math.min(1, Number(grade) ?? 1));
  const gradeScale = GRADE_FLOOR + (1 - GRADE_FLOOR) * g;
  const out = {};
  for (const k of STAT_KEYS) {
    const hi = band[k][1];
    const base = line[k];
    out[k] = (base + (hi - base) * t) * gradeScale;
  }
  /* `speed` and `faceDamp` are the names crewEffect and every existing
     caller already use. Kept as aliases rather than renamed so the physics
     seam stays exactly where it was. */
  out.speed = out.dist;
  out.faceDamp = out.forgive;
  return out;
}

/** Completion from the CURRENT storage shape (an upgrade level). One
 *  helper so client and server can never disagree about what fraction a
 *  given level represents — and one place to change when collection moves
 *  from upgrade levels to the fourteen pieces. */
export function doneFromLevel(setId, level = 0) {
  const set = setById(setId);
  if (!set) return 0;
  const steps = upgradeCount(set.rarity);
  if (steps <= 0) return 0;
  return Math.max(0, Math.min(1, (Number(level) || 0) / steps));
}

/** Completion of a whole set, 0..1 — what the Locker shows as "6/14". */
export function completionOf(pieces) {
  const n = Array.isArray(pieces) ? pieces.filter(k => SET_CLUBS.includes(k)).length : 0;
  return Math.max(0, Math.min(1, n / SET_CLUBS.length));
}

/** Completion of ONE class — what fraction of that class's clubs you hold. */
export function classCompletion(pieces, cls) {
  const want = CLUBS_IN_CLASS[cls] || [];
  if (!want.length) return 0;
  const have = new Set(Array.isArray(pieces) ? pieces : []);
  return want.filter(k => have.has(k)).length / want.length;
}

/**
 * THE COMPLETION THAT ACTUALLY DRIVES A SHOT: the class the club belongs
 * to, not the whole set.
 *
 * This is what makes collecting mean something specific — finishing your
 * wedges upgrades your short game, and a bag that is four drivers' worth
 * of woods and nothing else plays exactly like that.
 */
export function pieceCompletionFor(pieces, clubKey) {
  return classCompletion(pieces, classOf(clubKey) || 'irons');
}

/** Which of a set's clubs you are still missing. */
export function missingPieces(pieces) {
  const have = new Set(Array.isArray(pieces) ? pieces : []);
  return SET_CLUBS.filter(k => !have.has(k));
}

/** True when there is nothing left to buy for this set. */
export const isMaxed = (id, level) => {
  const set = setById(id);
  return !!set && (Number(level) || 0) >= upgradeCount(set.rarity);
};

/* ------------------------------------------------------------- the case */
/* The Club Case rolls on its OWN table, not the cosmetic one. The cosmetic
   weights make Mythic a ~0.1% pull, which is the right shape for a decal
   nobody needs — but the best bag in the game cannot sit behind a 1-in-1000
   lottery, so sets get odds where a Mythic is rare and genuinely reachable.
   Keeping it separate also means adding fifteen sets does not dilute how
   often a Fairway Supply Crate hands out a decal. */
export const CLUB_CASE_ODDS = [
  { id: 'standard', weight: 40 },
  { id: 'tour',     weight: 30 },
  { id: 'pro',      weight: 20 },
  { id: 'legend',   weight: 8 },
  { id: 'mythic',   weight: 2 }
];

export const CLUB_CASE_GEM_COST = 600;

/* THE SET CRATE. One club at a time is the chase; this is the way out of
   it for somebody who would rather pay than grind — a whole set, complete,
   in one go. Priced deliberately steep: fourteen Club Cases is 8,400 gems
   and this is 9,000, so buying the crate is never the CHEAP route, it is
   the certain one. You are paying for knowing what you get. */
export const SET_CRATE_GEM_COST = 9000;

/* And the third route: buying ONE NAMED club, for coins, in the Shop.
   The case is random and the crate is expensive; this is how somebody one
   club short of a set finishes it deliberately. Coins rather than gems on
   purpose — it is the sink that replaced the retired upgrade ladder, and
   it keeps test/cart.mjs's "owning everything takes 200-250 rounds" true.

   THESE NUMBERS ARE LOAD-BEARING FOR THE WHOLE COIN ECONOMY. Buying one
   set of each rarity outright comes to 1,302,000 coins, which is what the
   retired UPGRADE_COSTS ladder summed to — that is deliberate, and it is
   what keeps test/cart.mjs's "owning everything takes 200-250 rounds"
   true. Retuning one rarity moves that. See economy.js's PAYOUT_SCALE,
   which is the intended knob for shifting the whole curve at once.

   Rounded to something legible because a price of 3,847 reads as a bug. */
const PIECE_BASE = { standard: 1200, tour: 3500, pro: 9800, legend: 25000, mythic: 53500 };
export function piecePrice(setId) {
  const set = setById(setId);
  if (!set) return null;
  return PIECE_BASE[set.rarity] ?? PIECE_BASE.standard;
}

/** Where a rarity sits on the club-case ladder, standard=0 through
 *  mythic=4 — the same job tierIndex does for the cosmetic table. */
export const rarityRank = id => CLUB_CASE_ODDS.findIndex(r => r.id === id);

/* A duplicate is worth something. Pulling a set you already own upgrades it
   instead of handing back a dud — the same move rollCase already makes when
   it polishes an owned decal's purity rather than paying flat gems, and the
   reason is the same: a case that can come back empty is a case nobody
   wants to open twice. It is also the second source of upgrades, so a run
   of bad luck still moves you forward. */
export const DUPLICATE_GEMS = 120;

/**
 * Roll one Club Case.
 *
 * @param {{ [setId: string]: number }} owned  setId -> current upgrade level
 * @param {() => number} rand  injected for deterministic tests
 * @returns {{ kind: 'set', set: object, rarity: string }
 *          | { kind: 'upgrade', set: object, level: number }
 *          | { kind: 'gems', amount: number }}
 */
export function rollClubCase(owned = {}, rand = Math.random) {
  const total = CLUB_CASE_ODDS.reduce((s, r) => s + r.weight, 0);
  let roll = rand() * total;
  let startIdx = 0;
  for (let i = 0; i < CLUB_CASE_ODDS.length; i++) {
    if (roll < CLUB_CASE_ODDS[i].weight) { startIdx = i; break; }
    roll -= CLUB_CASE_ODDS[i].weight;
    startIdx = i + 1;
  }

  /* Walk UPWARD from the rolled rarity looking for a set with a piece you
     are still missing — same fallthrough the cosmetic case uses, and for
     the same reason: a thin tier should never fail a whole case. Rarer is
     the direction to walk because falling upward is a gift and falling
     downward is a downgrade dressed as a reward. */
  for (let i = Math.min(startIdx, CLUB_CASE_ODDS.length - 1); i < CLUB_CASE_ODDS.length; i++) {
    const rarity = CLUB_CASE_ODDS[i].id;
    const candidates = CLUB_SETS
      .filter(s => s.rarity === rarity)
      .map(s => ({ set: s, missing: missingPieces(owned[s.id]) }))
      .filter(c => c.missing.length);
    if (!candidates.length) continue;
    /* Prefer a set already STARTED. Fourteen half-finished sets is a
       collection nobody can finish; spreading a player thinner the more
       they open is the opposite of a chase. */
    const started = candidates.filter(c => (owned[c.set.id] || []).length > 0);
    const pool = started.length ? started : candidates;
    const pick = pool[Math.floor(rand() * pool.length)] || pool[0];
    const clubKey = pick.missing[Math.floor(rand() * pick.missing.length)] || pick.missing[0];
    return {
      kind: 'piece', set: pick.set, clubKey, rarity,
      first: !(owned[pick.set.id] || []).length,
      have: (owned[pick.set.id] || []).length + 1,
      of: SET_CLUBS.length
    };
  }

  // every set at or above the rolled rarity is already complete
  return { kind: 'gems', amount: DUPLICATE_GEMS };
}

/** Every club in a set, granted at once. What the Set Crate hands over. */
export function wholeSet() {
  return [...SET_CLUBS];
}
