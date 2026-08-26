/* =========================================================================
   crew.js — the Caddie Crew, and what the equipment room does to a shot
   -------------------------------------------------------------------------
   Every upgrade in the game is a PERSON: eight caddies, each governing one
   stat, hired and levelled 1-10 with coins.

   CLUB SETS USED TO LIVE HERE. They were a seven-rung coin ladder (Wooden
   Starter -> Signature Set, refined in place between jumps); they are now
   dropped by the Club Case and upgraded individually — see clubsets.js,
   whose header explains why that is the one place power may come from a
   case. CLUB_TIERS and REFINE_COSTS survive below for a single caller, the
   refund migration that pays back what players spent on the old ladder.

   Numbers here are the game's honest interpretation of the design document:
   the document's headline percentages (+65% distance at the top) are
   treated as POSITIONS ON A LADDER, not literal physics — a +65% driver
   would carry 440 yards and stop being golf.  The real multipliers keep the
   fantasy (a Mythic set with a Legend crew plays visibly, measurably
   better) without breaking the sport underneath.

   Shared by server and client: the server APPLIES these effects inside its
   own simulation; the client uses the same tables to preview and to render
   the shop.  No DOM, no Three.js.
   ========================================================================= */
import { setById, upgradeCost, STARTER_SET } from './clubsets.js';

/* ------------------------------------------------------------ the crew --- */
export const CADDIES = {
  ace: {
    name: 'Ace', emoji: '🎯', stat: 'Accuracy',
    blurb: 'Meticulous, calm, speaks in exact degrees. Tightens every shot shape.',
    line: lvl => `-${lvl * 4}% mishit drift`
  },
  bruiser: {
    name: 'Bruiser', emoji: '💪', stat: 'Power',
    blurb: 'Hypes you up on every tee. Full-power swings fly further.',
    // +1% ball speed per level measures out to ~3.3 yds/level on a full
    // driver — the card promises what the simulation actually delivers
    line: lvl => `+${Math.round(lvl * 3.3)} yds on full swings`
  },
  steady: {
    name: 'Steady', emoji: '🧘', stat: 'Control',
    blurb: 'Zen. Breathes audibly. Overswinging punishes you less.',
    line: lvl => `-${lvl * 5}% overswing penalty`
  },
  roller: {
    name: 'Roller', emoji: '🥽', stat: 'Putting',
    blurb: 'Treats every putt like a lab experiment. Reads the green for you.',
    line: lvl => lvl >= 4 ? 'contours + run-out read, steadier putts'
      : lvl >= 1 ? 'green contours near the hole' : ''
  },
  pitstop: {
    name: 'Pitstop', emoji: '🏁', stat: 'Cart speed',
    blurb: 'Pit-crew energy. Revs the cart engine for fun.',
    // the card must promise what the cap actually delivers (see cartBoost).
    // Was 2.2%/level — hiring a level-1 Pitstop bought about 0.7 km/h,
    // which nobody could feel. Raised so the FIRST level is worth having,
    // not just the tenth.
    line: lvl => `+${(lvl * 5.5).toFixed(0)}% cart speed`
  },
  lucky: {
    name: 'Lucky', emoji: '🍀', stat: 'Ball behaviour',
    blurb: 'Superstitious. Somehow the lip-outs go in and the rough sits kinder.',
    line: lvl => `cup grabs ${lvl * 2}% harder, kinder rough`
  },
  gale: {
    name: 'Gale', emoji: '🌬️', stat: 'Wind reading',
    blurb: 'Narrates the weather like a reporter. The wind pushes you less.',
    line: lvl => `-${lvl * 3}% wind push`
  },
  grit: {
    name: 'Grit', emoji: '🧤', stat: 'Resilience',
    blurb: 'Gravel-voiced mentor. After a bad hole, steadies your next tee shot.',
    line: lvl => `-${lvl * 2}% drift on the hole after a bogey`
  }
};
export const CADDIE_KEYS = Object.keys(CADDIES);
export const CADDIE_MAX = 10;

/** Coin cost to move a caddie from level (n-1) to n — straight from the doc. */
export const CADDIE_COSTS = [500, 800, 1200, 1800, 2600, 3600, 4800, 6200, 8000, 10000];
export const caddieCost = fromLevel =>
  fromLevel >= CADDIE_MAX ? null : CADDIE_COSTS[fromLevel];

/** A fresh profile has hired nobody. */
export const NO_CREW = Object.freeze({
  ace: 0, bruiser: 0, steady: 0, roller: 0, pitstop: 0, lucky: 0, gale: 0, grit: 0
});

/* ------------------------------------------------------- the club ladder ---
   The whole point of a ladder is that the bottom rung is genuinely bad.  These
   speeds used to run 1.000 -> 1.065, which meant a brand-new player already
   struck the ball exactly as far as the club table's reference and the entire
   ladder bought 6% — nothing you could feel.  They now run 0.86 -> 1.065, so a
   beginner carries a driver about 231 yards and a Legend with the Signature
   Set, its refinements and Bruiser carries about 318.  That gap is the game.

   1.000 sits at the Tour Pro Set deliberately: the reference the club table is
   calibrated against, and the point where you stop being an amateur. */
/* The ladder, and the shape of the whole game's long term.
   -------------------------------------------------------------------------
   The first four sets are a normal progression: a few rounds each, so a new
   player is visibly getting better equipment while they are still learning
   which end of the club to hold. Then it changes gear.

   The last three used to be 26k / 58k / 120k, which at ~3,300 coins for a
   level-par round meant owning EVERYTHING in the game — every set, every
   caddie, every refinement — took 194 rounds. Level 100 takes 1,131. So a
   dedicated player finished the entire coin ladder six times over before
   they were a third of the way up the level ladder, and then had nothing
   left to spend money on for eight hundred rounds. A currency you cannot
   spend stops being a reward.

   80k / 200k / 500k are the prices; how many ROUNDS that is depends on
   economy.js's PAYOUT_SCALE, which has moved twice since these were set
   (194 rounds to own everything, then 370, were both true once and neither
   is now — check economy.js's own history for the current one rather than
   trusting a number here). At the scale in effect when this was last
   checked, the top three cost roughly 11, 27 and 67 rounds of saving, and
   owning literally everything lands at 218 — comfortably under level 100,
   which is the right relationship between the two: your bag is the
   medium-term goal and your level is the long one, and neither runs out
   while the other is still going.

   The Signature Set at 67 rounds is still deliberately something you
   decide to go after, not something you drift into. */
export const CLUB_TIERS = [
  { name: 'Wooden Starter Set', cost: 0,
    speed: 0.860, faceDamp: 0.00, look: 'wood',
    blurb: 'Rough-hewn wood, rope grips. Short, unforgiving, and where everyone begins.' },
  { name: 'Rusty Iron Set', cost: 1500,
    speed: 0.895, faceDamp: 0.03, look: 'rust',
    blurb: 'Worn steel and duct-taped grips, but it strikes true enough.' },
  { name: 'Polished Steel Set', cost: 3500,
    speed: 0.930, faceDamp: 0.07, look: 'steel',
    blurb: 'Chrome shine, leather grips. The first set you polish on purpose.' },
  { name: 'Carbon Comp Set', cost: 7000,
    speed: 0.965, faceDamp: 0.12, look: 'carbon',
    blurb: 'Matte black carbon fibre. Quiet, fast, forgiving.' },
  { name: 'Tour Pro Set', cost: 80000,
    speed: 1.000, faceDamp: 0.18, look: 'tour',
    blurb: 'Sponsor decals and tour stamping. Full tour length at last.' },
  { name: 'Titanium Elite Set', cost: 200000,
    speed: 1.032, faceDamp: 0.24, look: 'titanium',
    blurb: 'Brushed titanium with a glow inlay. Hits like the future.' },
  { name: 'Signature Set', cost: 500000,
    speed: 1.065, faceDamp: 0.33, look: 'signature',
    blurb: 'Holographic finish, premium everything. The bag of legends.' }
];

/* A shot that names no bag at all is the REFERENCE ball: exactly the club
   table, which is what calibrateCarries() measures and the physics suite
   asserts against.  A real profile always names its set, so this is never
   what a player swings — it is the yardstick the ladder is measured with. */
const REFERENCE_SET = { speed: 1, faceDamp: 0 };

/** LEGACY, and kept alive for exactly one caller: the refund migration in
    server/profiles.js, which pays back what a player spent on the old
    coin-bought ladder before club sets replaced it (see clubsets.js). No
    live code path prices anything from these any more — do not add one.
    `?? 1500`, not `||` — the Wooden Starter Set's cost is a real 0, and `||`
    treated that as "missing", pricing a refund on a FREE set as if it were
    the 1,500-cost tier above it. */
export const REFINE_COSTS = tierIdx => {
  const c = CLUB_TIERS[tierIdx]?.cost ?? 1500;
  return [Math.round(c * 0.2), Math.round(c * 0.35), Math.round(c * 0.5)];
};

/* --------------------------------------------------- what it all DOES ---- */
/**
 * Everything the equipment room contributes to one shot, as multipliers the
 * simulation applies.  Passing nothing returns exact 1s and 0s: the physics
 * suite runs entirely in that configuration.
 *
 * @param crew      caddie levels, e.g. { ace: 3, bruiser: 0, ... }
 * @param set       the equipped club set's resolved stats, `{ speed,
 *                  faceDamp }` from clubsets.js's setStats(id, level), or
 *                  null for the reference ball. Already-resolved rather
 *                  than an id+level pair, so this function stays the pure
 *                  arithmetic it always was and never needs the set table.
 * @param ctx       { power, isPutt, afterBadHole }
 */
export function crewEffect(crew, set = null, ctx = {}) {
  // Merge over NO_CREW rather than trusting the shape: a profile written by
  // an older build (or a hand-edited save) may miss keys, and one undefined
  // level would NaN the whole shot — ball position included.
  const c = crew ? { ...NO_CREW, ...crew } : NO_CREW;
  /* No set named at all means the reference ball (see REFERENCE_SET). A real
     set always names both numbers, and Number.isFinite guards a malformed
     one — a NaN speed here would move the ball to NaN and lose it entirely.
     Note the old signature took a tier INDEX plus a separate refine level,
     and added the refinement speed even on the reference path, so
     crewEffect(null, null, 3) quietly returned 1.014 instead of 1. Folding
     upgrades into the resolved stats removes that seam. */
  const tier = (set && Number.isFinite(set.speed) && Number.isFinite(set.faceDamp))
    ? set
    : REFERENCE_SET;

  // ball speed: the club set and Bruiser on full swings
  let speed = tier.speed;
  if ((ctx.power ?? 0) > 0.92 && c.bruiser > 0) speed *= 1 + c.bruiser * 0.010;

  // face drift damping: the set's forgiveness, Ace always, Steady only on
  // overswings, Grit on the hole after a bogey, Roller on the greens
  let damp = tier.faceDamp + c.ace * 0.04;
  if ((ctx.power ?? 0) > 1.0) damp += c.steady * 0.05;
  if (ctx.afterBadHole) damp += c.grit * 0.02;
  if (ctx.isPutt) damp += c.roller * 0.03;
  damp = Math.min(0.85, damp);                      // never a perfect robot

  // the world softens too
  const windDamp = Math.min(0.30, c.gale * 0.03);   // wind pushes less
  const cupBonus = Math.min(0.20, c.lucky * 0.02);  // lip-outs drop more often
  const lieMercy = Math.min(0.10, c.lucky * 0.01);  // rough steals less speed

  return { speed, faceDamp: damp, windDamp, cupBonus, lieMercy };
}

/** Cart speed never touches the shot sim — the cart reads this directly. */
export const cartBoost = crew =>
  // Capped so a maxed Pitstop, stacked with gear.js's cart_tune (+12%),
  // lands exactly on MAX_BOOST in cart.js — that file explains why the two
  // numbers are 1.55 and 1.12 rather than something rounder.
  1 + Math.min(0.55, (crew?.pitstop || 0) * 0.055);

/* ----------------------------------------------------------- the till ---- */
/**
 * What may be bought right now, and for how much.  Returns { cost } or
 * { blocked: reason }.  item forms: 'caddie:ace' | 'set:upgrade'
 */
export function crewPurchase(item, profile) {
  const coins = profile.coins || 0;
  const [kind, which] = String(item).split(':');

  if (kind === 'caddie') {
    // own-property only: 'caddie:constructor' must not hire a phantom
    if (!Object.hasOwn(CADDIES, which)) return { blocked: 'No such caddie.' };
    const lvl = (profile.crew || NO_CREW)[which] || 0;
    const cost = caddieCost(lvl);
    if (cost == null) return { blocked: `${CADDIES[which].name} is already a Legend.` };
    if (coins < cost) return { blocked: `Costs ${cost} coins — you have ${coins}.` };
    return { cost, apply: p => { p.crew[which] = lvl + 1; } };
  }

  /* Upgrading the set you actually carry, which replaced buying your way up
     a fixed ladder. Everything real is re-derived from the profile — which
     set is equipped, what level it is at, what that rarity's next rung
     costs — so the client naming 'set:upgrade' can only ever mean "one
     more rung on the thing I am holding", never a set or a price of its
     choosing. */
  if (kind === 'set' && which === 'upgrade') {
    const id = profile.clubSet || STARTER_SET;
    const set = setById(id);
    if (!set) return { blocked: 'No such set.' };
    if (!(profile.clubSets && id in profile.clubSets)) {
      return { blocked: 'You do not own that set.' };
    }
    const level = profile.clubSets[id] || 0;
    const cost = upgradeCost(set.rarity, level);
    if (cost == null) return { blocked: `Your ${set.name} is fully upgraded.` };
    if (coins < cost) return { blocked: `Costs ${cost} coins — you have ${coins}.` };
    return { cost, apply: p => { p.clubSets = { ...p.clubSets, [id]: level + 1 }; } };
  }

  return { blocked: 'No such item.' };
}
