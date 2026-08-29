/* =========================================================================
   economy.js — how golf becomes coins
   -------------------------------------------------------------------------
   Pure functions, shared by the server (which pays) and the tests (which
   audit).  The formula rewards good golf rather than mere attendance, but a
   rough hole never pays negative: the worst outcome is zero.

   The design document's shape, at eight times its numbers:
     160 per hole finished · +120 par · +240 birdie · +480 eagle · +1200 ace
     -40 per stroke over par (floored at 0 for the hole)
     +800 for finishing the round
     +10% per under-par streak of 3+, capped at +50%
     one-time 4,000 for the first clear of each course

   PAYOUT_SCALE is the whole of that eight, in one place.  The document's raw
   figures paid about 415 a round against 439,450 to own everything — a little
   over a thousand rounds, or two hundred hours, which is not a progression so
   much as a second job.  At this scale a level-par round pays about 3,300 and
   the full crew, the Signature Set and every refinement land at roughly 120
   rounds: 20 to 30 hours, with the first caddie hired on day one and the last
   Legend a long way off.  Change this number to move the whole curve.
   ========================================================================= */

/* Raised from 8. Owning everything sat at 488 rounds against 1,131 for level
   100 — coherent on paper, but 488 rounds is eighty hours before the shop is
   empty, and a player who cannot feel the money moving stops caring about it
   in the first hour. At 13 a level-par round pays about 5,400 and the whole
   shop lands near 300 rounds, which is still a long haul and no longer a
   second job. The club-set prices are unchanged: this moves the whole curve
   from one place, which is exactly what the constant is for. */

/* Raised again, from 13. "Near 300 rounds" above undersold it: measured
   properly (every caddie maxed, every club tier, only the SURVIVING
   refinement — the top tier's, since a tier-up erases the rest — plus the
   one-off gear in shop.js) it was 304, not "near" it, and 304 rounds at
   10-15 minutes each is 51-76 hours before there's nothing left to buy. The
   ask was 200-250. At 18 a level-par round pays about 7,470 and the same
   total lands at 218 rounds (36-55 hours) — inside the window, and still
   comfortably behind level 100 (test/cart.mjs's ratio check keeps that
   order honest). Club-set and caddie prices are unchanged, again: the
   whole curve moves from this one number, which is exactly what it is
   for. */
export const PAYOUT_SCALE = 18;

/* Finishing a hole is worth something no matter how it went.  The appearance
   fee used to be eaten alive by the over-par penalty — at four over it hit
   exactly zero, and a hole caps at par + 6, so every blow-up paid literally
   nothing.  A player having a bad round therefore earned nothing for it,
   which reads as the economy being broken rather than as a penalty.  The
   penalty now shaves the fee and stops, so the worst hole in the game still
   pays something for holing out. */
const SHOW_UP = 20;          // paid for finishing the hole, whatever the score
const WORST_PENALTY = -15;   // never more than this, so the floor is 5

/** Coins for one finished hole.  `rel` = strokes minus par. */
export function holeCoins(strokes, par) {
  if (!(strokes > 0) || !(par > 0)) return 0;
  const rel = strokes - par;
  let bonus;
  if (strokes === 1) bonus = 150;                   // the once-a-year one
  else if (rel <= -2) bonus = 60;
  else if (rel === -1) bonus = 30;
  else if (rel === 0) bonus = 15;
  else bonus = Math.max(WORST_PENALTY, -rel * 5);   // soft penalty, with a bottom
  return Math.max(0, SHOW_UP + bonus) * PAYOUT_SCALE;
}

/**
 * The end-of-round settlement.
 * @param holeScores  [{strokes, par}] for every hole actually finished
 * @param firstClear  true if this course has never been finished before
 * @returns { holes, roundBonus, streakPct, streakBonus, firstClearBonus, total }
 */
export function roundCoins(holeScores, firstClear = false) {
  let holes = 0, bestStreak = 0, run = 0;
  for (const h of holeScores) {
    holes += holeCoins(h.strokes, h.par);
    if (h.strokes - h.par < 0) { run++; bestStreak = Math.max(bestStreak, run); }
    else run = 0;
  }
  const roundBonus = holeScores.length > 0 ? 100 * PAYOUT_SCALE : 0;
  // +10% for each hole of the best under-par streak once it reaches 3, cap 50%
  const streakPct = bestStreak >= 3 ? Math.min(50, bestStreak * 10) : 0;
  const streakBonus = Math.round((holes + roundBonus) * streakPct / 100);
  const firstClearBonus = firstClear ? 500 * PAYOUT_SCALE : 0;
  return {
    holes, roundBonus, streakPct, streakBonus, firstClearBonus,
    total: holes + roundBonus + streakBonus + firstClearBonus
  };
}

/* =========================================================================
   GEMS
   -------------------------------------------------------------------------
   THE PROBLEM THIS FIXES. Gems had exactly three sources: the daily login
   table, duplicate compensation from a case, and selling an item back. None
   of them is PLAYING. So somebody who played twenty rounds a day and did
   not happen to log in on the right day of a streak earned nothing, and the
   only currency that buys cases was the one the game never paid you for.
   That is not a slow economy, it is a disconnected one.

   THE SHAPE. Coins already reward showing up — the worst hole in the game
   still pays a floor, because a bad round should not read as the economy
   being broken. Gems are the opposite on purpose: they reward GOLF. A bogey
   is worth nothing, a par is worth one, and the ladder climbs steeply from
   there. That difference is what makes them feel like different currencies
   rather than two numbers that both go up.

     ace          10     the once-a-year one
     albatross     8
     eagle         5
     birdie        3
     par           1
     bogey+        0     nothing, and that is the point

   Nine holes at level par is 9 gems; a good round is 15-20. On top of that
   a completed round pays a flat 50, which is deliberately the bulk of it:
   the thing the game most wants is for you to FINISH, and a per-hole
   trickle that rewards abandoning a bad round after the two holes you
   parred would reward exactly the wrong behaviour.

   So a round is roughly 60-70 gems. A Club Case is 600 — nine or ten rounds
   for a real pull, which is a chase you can see the end of. A Set Crate is
   9,000, about 140 rounds, which is the "deliberately not cheap" it was
   always meant to be and was previously unreachable by playing at all.
   ========================================================================= */

const GEM_ACE = 10, GEM_ALBATROSS = 8, GEM_EAGLE = 5, GEM_BIRDIE = 3, GEM_PAR = 1;

/** Gems for one finished hole. Nothing at all for a bogey — see above. */
export function holeGems(strokes, par) {
  if (!(strokes > 0) || !(par > 0)) return 0;
  if (strokes === 1) return GEM_ACE;
  const rel = strokes - par;
  if (rel <= -3) return GEM_ALBATROSS;
  if (rel === -2) return GEM_EAGLE;
  if (rel === -1) return GEM_BIRDIE;
  if (rel === 0) return GEM_PAR;
  return 0;
}

/** Finishing the round is worth more than any single hole in it. */
export const ROUND_GEMS = 50;
/** And the first time you finish a course you have never cleared. */
export const FIRST_CLEAR_GEMS = 100;

/**
 * The end-of-round gem settlement.
 *
 * `earnMult` is the difficulty's own earn rate (see difficulty.js), applied
 * to the WHOLE payout rather than to the per-hole part: the argument for
 * paying more on a harder setting is about the round being harder to
 * finish, and a player on an easier setting having a birdie be worth less
 * than somebody else's birdie is a different and worse claim.
 *
 * @param holeScores  [{strokes, par}] for every hole actually finished
 * @param opts.firstClear  this course has never been finished before
 * @param opts.full        a complete round, not an abandoned one
 * @param opts.earnMult    the difficulty multiplier, default 1
 */
export function roundGems(holeScores, opts = {}) {
  if (!Array.isArray(holeScores) || !holeScores.length) {
    return { holes: 0, finish: 0, firstClear: 0, total: 0 };
  }
  const holes = holeScores.reduce((a, h) => a + holeGems(h.strokes, h.par), 0);
  const finish = opts.full ? ROUND_GEMS : 0;
  const firstClear = (opts.full && opts.firstClear) ? FIRST_CLEAR_GEMS : 0;
  const mult = Number.isFinite(opts.earnMult) && opts.earnMult > 0 ? opts.earnMult : 1;
  const total = Math.round((holes + finish + firstClear) * mult);
  return { holes, finish, firstClear, mult, total };
}

/* ------------------------------------------------------------ milestones ---
   REPEATABLE, and that is the whole design. A one-off achievement list pays
   out once and then the game is quieter than it was before you cleared it,
   which is the opposite of what a "consistent pipeline" means. Every one of
   these is a rung on a ladder that keeps going, so there is always a next
   one and it is always further away than the last.

   `n` is how many times it has been claimed. The target grows and so does
   the reward, but the reward grows SLOWER than the target — a ladder where
   both scale together is a treadmill that pays the same rate forever, and
   one where the reward outpaces the target eventually pays more than the
   game can afford.

   Every one of these is measured from things the server already records
   about a shot it simulated itself. Nothing here can be claimed by a
   client saying it happened. */
export const MILESTONES = [
  { id: 'fairways', name: 'Off the tee',
    unit: 'fairways in a row', base: 5, step: 3, gems: 25, gemStep: 10,
    blurb: 'Find the short grass, five drives running.' },
  { id: 'pars', name: 'Steady hands',
    unit: 'pars or better in a row', base: 3, step: 2, gems: 30, gemStep: 12,
    blurb: 'Three holes without dropping a shot.' },
  { id: 'birdies', name: 'Card of birdies',
    unit: 'birdies', base: 10, step: 10, gems: 40, gemStep: 15,
    blurb: 'They add up over a career.' },
  { id: 'rounds', name: 'Regular',
    unit: 'rounds finished', base: 5, step: 5, gems: 35, gemStep: 15,
    blurb: 'Turning up is most of it.' },
  { id: 'gir', name: 'Ball striking',
    unit: 'greens in regulation', base: 15, step: 15, gems: 35, gemStep: 15,
    blurb: 'On the dance floor with a putt for birdie.' },
  { id: 'courses', name: 'Tour player',
    unit: 'courses cleared', base: 3, step: 2, gems: 60, gemStep: 25,
    blurb: 'See the whole tour, not one favourite hole.' }
];

export const milestoneById = id => MILESTONES.find(m => m.id === id) || null;

/** The target and reward for the nth claim of a milestone (n = claims so far). */
export function milestoneRung(m, n = 0) {
  const done = Math.max(0, Math.floor(Number(n) || 0));
  return {
    tier: done + 1,
    target: m.base + m.step * done,
    /* Rewards grow, but sub-linearly against the target: a ladder where
       both scale together pays the same rate forever, which is a treadmill
       rather than progress. */
    gems: Math.round(m.gems + m.gemStep * Math.sqrt(done))
  };
}

/**
 * How far along every milestone a set of counters is, and what is claimable.
 * Pure — the caller supplies the counters and the claim history, so the
 * server can rule on it and the client can render the same answer.
 */
export function milestoneState(counters = {}, claims = {}) {
  return MILESTONES.map(m => {
    const n = Math.max(0, Math.floor(Number(claims[m.id]) || 0));
    const have = Math.max(0, Math.floor(Number(counters[m.id]) || 0));
    const rung = milestoneRung(m, n);
    return {
      id: m.id, name: m.name, unit: m.unit, blurb: m.blurb,
      tier: rung.tier, target: rung.target, gems: rung.gems,
      have, claimable: have >= rung.target,
      pct: Math.min(1, rung.target ? have / rung.target : 0)
    };
  });
}

/* =========================================================================
   XP AND LEVELS
   -------------------------------------------------------------------------
   Coins buy things; XP unlocks them.  The two are deliberately separate
   currencies with different shapes: coins are a budget you spend down to
   nothing and rebuild, XP only ever goes up, so a bad session still moves
   something forward.  That matters more than it sounds — a player who blows
   up a round and earns 400 coins they immediately want to spend has nothing
   to show for the hour otherwise.

   The award follows the same shape as the coin payout: showing up is worth
   something, good golf is worth much more.
   ========================================================================= */

/** XP for finishing one hole. */
export function holeXp(strokes, par) {
  if (!(strokes > 0) || !(par > 0)) return 0;
  const rel = strokes - par;
  let xp = 10;                                      // finishing it at all
  if (strokes === 1) xp += 120;                     // an ace is a story
  else if (rel <= -2) xp += 45;
  else if (rel === -1) xp += 25;
  else if (rel === 0) xp += 12;
  else xp += Math.max(0, 6 - rel);                  // over par still counts
  return xp;
}

/** XP for finishing a whole round, on top of the holes. */
export function roundXp(holeScores) {
  if (!Array.isArray(holeScores) || !holeScores.length) return 0;
  const holes = holeScores.reduce((a, h) => a + holeXp(h.strokes, h.par), 0);
  const played = holeScores.length;
  const rel = holeScores.reduce((a, h) => a + (h.strokes - h.par), 0);
  // Finishing is the point: a completed round is worth roughly a third again
  // on top of its holes, and beating par adds to that.
  const completion = played >= 9 ? 120 : Math.round(played * 8);
  const underPar = Math.max(0, -rel) * 15;
  return holes + completion + underPar;
}

/* The curve, to level 100.
   -------------------------------------------------------------------------
   The old curve was a flat 1.55x per level, which reaches level 100 at a
   number with thirty digits in it — a ceiling nobody can see, let alone
   approach. A cap only means something if the top is reachable by somebody.

   So the growth DECAYS. Early levels climb steeply, because that is where
   the sense of progress has to come from; by the nineties each level is only
   a few percent more than the last, so the grind is long and flat rather
   than literally impossible. Level 100 lands around three thousand rounds —
   a genuine long-haul target, not a joke.

   One number to move if the whole thing feels wrong: XP_BASE scales
   everything, GROWTH_HI is how brutal the early climb is, and GROWTH_LO is
   where it settles. */
/* Levelling was 1,131 rounds to 100 — a genuine long-haul target, and also
   slow enough in the MIDDLE that the wheel of rewards went quiet for hours
   at a stretch. XP_BASE down and the power slightly flatter pulls the whole
   curve in by about 40%: level 100 lands near 660 rounds, level 25 at 65,
   and the first ten levels come inside a session, which is where a reward
   ladder has to prove it exists. */
const XP_BASE = 210;         // the cost of level 2 — about half a good round
const XP_POWER = 0.60;       // how fast the cost climbs
const MAX_LEVEL = 100;

/* Built once: the XP each level costs, and the running total to reach it.

   The step is a POWER of the level, not a multiplier on the last one. That
   distinction is the whole design. An exponential curve — even a gentle 1.05
   — reaches level 100 at a number nobody will ever see; the first attempt at
   this put it at forty million rounds, which is not a ceiling, it is a joke.

   A power curve climbs steeply where it matters and then flattens, so:

     level   2      1 round        the system announces itself immediately
     level   6     10 rounds       the last emote, a real but fair grind
     level  25     ~95 rounds      committed
     level 100   ~2,300 rounds     a genuine long-haul target that a
                                   dedicated player could actually reach */
const STEP = [0, 0];         // STEP[L] = XP to go from L-1 to L
const TOTAL = [0, 0];        // TOTAL[L] = XP to reach L from zero
(function buildCurve() {
  for (let L = 2; L <= MAX_LEVEL; L++) {
    STEP[L] = Math.round(XP_BASE * Math.pow(L - 1, XP_POWER));
    TOTAL[L] = TOTAL[L - 1] + STEP[L];
  }
})();

/** Total XP needed to REACH this level from zero. */
export function xpForLevel(level) {
  const L = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  return TOTAL[L];
}

export const maxLevel = () => MAX_LEVEL;

/** Level, and how far through it, from a lifetime XP total. */
export function levelFromXp(xp) {
  const x = Math.max(0, Number(xp) || 0);
  let level = 1;
  while (level < MAX_LEVEL && x >= xpForLevel(level + 1)) level++;
  const base = xpForLevel(level);
  const capped = level >= MAX_LEVEL;
  const next = capped ? base : xpForLevel(level + 1);
  const span = Math.max(1, next - base);
  return {
    level,
    into: x - base,
    need: span,
    progress: capped ? 1 : Math.max(0, Math.min(1, (x - base) / span)),
    nextAt: next,
    maxed: capped
  };
}
