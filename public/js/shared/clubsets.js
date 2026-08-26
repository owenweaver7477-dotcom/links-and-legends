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
  { id: 'signature', name: 'Signature Holo', brand: 'Aurelian', rarity: 'mythic',
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
export function setStats(id, level = 0) {
  const set = setById(id);
  if (!set) return null;
  const tier = SET_TIERS[set.rarity] || SET_TIERS.standard;
  const steps = upgradeCount(set.rarity);
  // clamped, not trusted: a hand-edited save naming level 99 gets a maxed
  // set, never a set beyond max
  const l = Math.max(0, Math.min(steps, Math.floor(Number(level) || 0)));
  const t = steps > 0 ? l / steps : 0;
  const lerp = ([lo, hi]) => lo + (hi - lo) * t;
  return { speed: lerp(tier.speed), faceDamp: lerp(tier.faceDamp) };
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

  /* Walk UPWARD from the rolled rarity looking for a set this player does
     not own yet — same fallthrough rollCase uses, and for the same reason:
     a thin tier should never fail the whole case. Rarer is the direction to
     walk because falling upward is a gift and falling downward is a
     downgrade dressed as a reward. */
  for (let i = Math.min(startIdx, CLUB_CASE_ODDS.length - 1); i < CLUB_CASE_ODDS.length; i++) {
    const rarity = CLUB_CASE_ODDS[i].id;
    const pool = CLUB_SETS.filter(s => s.rarity === rarity && !(s.id in owned));
    if (!pool.length) continue;
    const set = pool[Math.floor(rand() * pool.length)] || pool[0];
    return { kind: 'set', set, rarity };
  }

  /* Everything at or above the rolled rarity is already owned. Upgrade the
     best un-maxed set instead — "best" meaning rarest, since that is the
     one whose ceiling is highest and the upgrade worth most. */
  const upgradable = CLUB_SETS
    .filter(s => s.id in owned && !isMaxed(s.id, owned[s.id]))
    .sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity));
  if (upgradable.length) {
    const set = upgradable[0];
    return { kind: 'upgrade', set, level: (owned[set.id] || 0) + 1 };
  }

  // every set owned and every one of them maxed — there is genuinely
  // nothing left to give but currency
  return { kind: 'gems', amount: DUPLICATE_GEMS };
}
