/* =========================================================================
   loginrewards.js — the daily-return cycle, pure and testable
   -------------------------------------------------------------------------
   Everything here is a pure function over a small piece of state — day,
   cycle, freezes, last-claim-date — so the server can own that state
   without this file ever touching a database, and a test can drive it
   through weeks of pretend time without a clock in sight.

   §7.1's design in three rules:
     - claiming advances one day; missing a day costs a freeze if you have
       one, and resets the cycle to day 1 if you don't
     - a freeze is earned every 7 days claimed, held up to a small stockpile
     - later cycles pay more, so a long-time player's daily login is never
       stuck at day-one numbers forever — capped, so it never spirals

   Day boundary is a UTC calendar date, not "4am local": the roadmap's own
   suggestion needs a per-player timezone this project does not store
   anywhere, and a wrong guess at timezone is worse than a boundary that is
   occasionally an hour early or late for anyone not on UTC.
   ========================================================================= */

export const CYCLE_LENGTH = 14;
export const MAX_FREEZES = 2;
const FREEZE_EVERY = 7;
const CYCLE_SCALE_CAP = 2;      // cycle 3+ pays at most double cycle 1
const CYCLE_SCALE_STEP = 0.4;   // cycle 2 = 1.4x, cycle 3 = 1.8x, then capped

/** Day 1..14. `coins`/`gems` scale with the cycle; `cases` does not — a
    flood of chests would cheapen the one thing this system exists to hand
    out slowly.

    THE COINS ARE NOW TOKENS AND THE GEMS ARE THE POINT. These were written
    when gems had no other source at all, so the table was the entire gem
    economy and had to be stingy with it. Playing now pays gems (see
    economy.js's roundGems), which changes what this table is FOR: it is no
    longer the supply, it is the reason to come back tomorrow.

    So the coins stayed where they are — 400 coins is a rounding error
    against a round's ~7,500 and was already only a gesture — and the gems
    went up to 475 over a full fortnight. Somebody who plays one round a day
    for those fourteen days earns about 870 from the golf, so the streak is
    a bit over half again on top: clearly worth keeping, and clearly not a
    way to skip playing. That is the relationship worth holding.

    Every day pays gems now. A day that paid nothing but 150 coins was a day
    the streak asked you to come back for nothing. */
const BASE_DAYS = [
  { day: 1,  coins: 100, gems: 10 },
  { day: 2,  coins: 150, gems: 10 },
  { day: 3,  cases: 1,   gems: 15 },
  { day: 4,  gems: 30 },
  { day: 5,  coins: 200, gems: 15 },
  { day: 6,  coins: 250, gems: 20 },
  { day: 7,  cases: 1,   gems: 50 },
  { day: 8,  coins: 300, gems: 20 },
  { day: 9,  gems: 45 },
  { day: 10, cases: 1,   gems: 25 },
  { day: 11, coins: 350, gems: 25 },
  { day: 12, gems: 60 },
  { day: 13, coins: 400, gems: 30 },
  { day: 14, cases: 2,   gems: 120 }
];

const cycleScale = cycle =>
  1 + Math.min(CYCLE_SCALE_CAP - 1, Math.max(0, cycle - 1) * CYCLE_SCALE_STEP);

/** What day `day` actually pays, scaled for how many times the cycle has
    already run. Cases are never scaled — see BASE_DAYS' comment. */
export function rewardFor(day, cycle) {
  const base = BASE_DAYS.find(d => d.day === day) || BASE_DAYS[0];
  const scale = cycleScale(cycle);
  const out = {};
  if (base.coins) out.coins = Math.round(base.coins * scale);
  if (base.gems) out.gems = Math.round(base.gems * scale);
  if (base.cases) out.cases = base.cases;
  return out;
}

export const utcDateKey = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/**
 * @param {{ day: number, cycle: number, freezes: number, lastClaimDate: string|null }} state
 * @param {number} nowMs
 * @returns claim outcome; never mutates `state` — the caller applies the
 *   result (see server/profiles.js's claimLogin, the only place this
 *   actually gets written down).
 */
export function planClaim(state, nowMs = Date.now()) {
  const today = utcDateKey(nowMs);
  // day: 0 means "nothing claimed yet" — the increment below turns that
  // into day 1 on a brand-new player's very first claim, same as any other
  // day advancing by one.
  const s = { day: 0, cycle: 1, freezes: 0, lastClaimDate: null, ...state };

  if (s.lastClaimDate === today) {
    return { ok: false, error: 'Already claimed today.' };
  }

  const gap = s.lastClaimDate ? daysBetween(s.lastClaimDate, today) : 1;
  let day = s.day, cycle = s.cycle, freezes = s.freezes, usedFreeze = false, reset = false;

  if (s.lastClaimDate && gap === 2 && freezes > 0) {
    // exactly one day missed, and there's a freeze to cover it — the streak
    // continues as though that day happened
    freezes -= 1;
    usedFreeze = true;
  } else if (s.lastClaimDate && gap > 1) {
    // no freeze, or too big a gap for one freeze to cover — start over,
    // but never punish the return itself, only the streak
    day = 0; cycle = 1; reset = true;
  }

  // Checked on the PRE-increment day, not "did we land on day 1" — a brand
  // new player's very first claim also lands on day 1 (0 -> 1) with
  // reset===false, and that is not a wrapped cycle, it is a first cycle.
  const wrapped = day >= CYCLE_LENGTH && !reset;
  day = day >= CYCLE_LENGTH ? 1 : day + 1;
  if (wrapped) cycle += 1;
  if (day % FREEZE_EVERY === 0) freezes = Math.min(MAX_FREEZES, freezes + 1);

  const reward = rewardFor(day, cycle);
  return {
    ok: true, day, cycle, freezes, usedFreeze, reset, reward,
    comebackBonus: reset && gap > 2 ? { coins: 100 } : null,
    nextState: { day, cycle, freezes, lastClaimDate: today }
  };
}
