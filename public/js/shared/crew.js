/* =========================================================================
   crew.js — the Caddie Crew and the club-tier ladder
   -------------------------------------------------------------------------
   Every upgrade in the game is a PERSON: eight caddies, each governing one
   stat, hired and levelled 1-10 with coins.  Clubs climb a seven-tier ladder
   from the Wooden Starter Set to the Signature Set, refined in place between
   tier jumps.

   Numbers here are the game's honest interpretation of the design document:
   the document's headline percentages (+65% distance at the top tier) are
   treated as POSITIONS ON THE LADDER, not literal physics — a +65% driver
   would carry 440 yards and stop being golf.  The real multipliers keep the
   fantasy (a Signature Set with a Legend crew plays visibly, measurably
   better) without breaking the sport underneath.

   Shared by server and client: the server APPLIES these effects inside its
   own simulation; the client uses the same tables to preview and to render
   the shop.  No DOM, no Three.js.
   ========================================================================= */

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
    line: lvl => `+${(lvl * 4.5).toFixed(0)} yds on full swings`
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
    line: lvl => `+${lvl * 6}% cart speed`
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

/* ------------------------------------------------------- the club ladder --- */
export const CLUB_TIERS = [
  { name: 'Wooden Starter Set', cost: 0,
    speed: 1.000, faceDamp: 0.00, look: 'wood',
    blurb: 'Rough-hewn wood, rope grips. Where everyone begins.' },
  { name: 'Rusty Iron Set', cost: 1500,
    speed: 1.008, faceDamp: 0.03, look: 'rust',
    blurb: 'Worn steel and duct-taped grips, but it strikes true enough.' },
  { name: 'Polished Steel Set', cost: 3500,
    speed: 1.016, faceDamp: 0.07, look: 'steel',
    blurb: 'Chrome shine, leather grips. The first set you polish on purpose.' },
  { name: 'Carbon Comp Set', cost: 7000,
    speed: 1.026, faceDamp: 0.12, look: 'carbon',
    blurb: 'Matte black carbon fibre. Quiet, fast, forgiving.' },
  { name: 'Tour Pro Set', cost: 13000,
    speed: 1.038, faceDamp: 0.18, look: 'tour',
    blurb: 'Sponsor decals and tour stamping. Plays like a paycheque.' },
  { name: 'Titanium Elite Set', cost: 22000,
    speed: 1.050, faceDamp: 0.24, look: 'titanium',
    blurb: 'Brushed titanium with a glow inlay. Hits like the future.' },
  { name: 'Signature Set', cost: 35000,
    speed: 1.065, faceDamp: 0.33, look: 'signature',
    blurb: 'Holographic finish, premium everything. The bag of legends.' }
];

/** Refinements: three sub-levels inside a tier, lost on tier-up (by design). */
export const REFINE_COSTS = tierIdx => {
  const c = CLUB_TIERS[tierIdx]?.cost || 1500;
  return [Math.round(c * 0.2), Math.round(c * 0.35), Math.round(c * 0.5)];
};
export const REFINE_SPEED = [0.004, 0.008, 0.014];   // cumulative extra ball speed

/* --------------------------------------------------- what it all DOES ---- */
/**
 * Everything the equipment room contributes to one shot, as multipliers the
 * simulation applies.  Passing nothing returns exact 1s and 0s: the physics
 * suite runs entirely in that configuration.
 *
 * @param crew      caddie levels, e.g. { ace: 3, bruiser: 0, ... }
 * @param clubTier  0-6 index into CLUB_TIERS
 * @param refine    0-3 refinement level within the tier
 * @param ctx       { power, isPutt, afterBadHole }
 */
export function crewEffect(crew, clubTier = 0, refine = 0, ctx = {}) {
  const c = crew || NO_CREW;
  const tier = CLUB_TIERS[Math.max(0, Math.min(6, clubTier))] || CLUB_TIERS[0];
  const ref = REFINE_SPEED[Math.max(0, Math.min(3, refine)) - 1] || 0;

  // ball speed: the club set, its refinement, and Bruiser on full swings
  let speed = tier.speed + ref;
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
  1 + Math.min(0.60, (crew?.pitstop || 0) * 0.06);

/* ----------------------------------------------------------- the till ---- */
/**
 * What may be bought right now, and for how much.  Returns { cost } or
 * { blocked: reason }.  item forms: 'caddie:ace' | 'club:tier' | 'club:refine'
 */
export function crewPurchase(item, profile) {
  const coins = profile.coins || 0;
  const [kind, which] = String(item).split(':');

  if (kind === 'caddie') {
    if (!CADDIES[which]) return { blocked: 'No such caddie.' };
    const lvl = (profile.crew || NO_CREW)[which] || 0;
    const cost = caddieCost(lvl);
    if (cost == null) return { blocked: `${CADDIES[which].name} is already a Legend.` };
    if (coins < cost) return { blocked: `Costs ${cost} coins — you have ${coins}.` };
    return { cost, apply: p => { p.crew[which] = lvl + 1; } };
  }

  if (kind === 'club' && which === 'tier') {
    const t = (profile.clubTier ?? 0) + 1;
    if (t > 6) return { blocked: 'You already carry the Signature Set.' };
    const cost = CLUB_TIERS[t].cost;
    if (coins < cost) return { blocked: `Costs ${cost} coins — you have ${coins}.` };
    // refinements are lost on tier-up, deliberately: a new set starts raw
    return { cost, apply: p => { p.clubTier = t; p.refine = 0; } };
  }

  if (kind === 'club' && which === 'refine') {
    const r = profile.refine ?? 0;
    if (r >= 3) return { blocked: 'This set is fully refined.' };
    const cost = REFINE_COSTS(profile.clubTier ?? 0)[r];
    if (coins < cost) return { blocked: `Costs ${cost} coins — you have ${coins}.` };
    return { cost, apply: p => { p.refine = r + 1; } };
  }

  return { blocked: 'No such item.' };
}
