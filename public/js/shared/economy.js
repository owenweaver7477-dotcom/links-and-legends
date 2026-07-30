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

export const PAYOUT_SCALE = 8;

/** Coins for one finished hole.  `rel` = strokes minus par. */
export function holeCoins(strokes, par) {
  if (!(strokes > 0) || !(par > 0)) return 0;
  const rel = strokes - par;
  let c = 20;                                       // showing up to the green
  if (strokes === 1) c += 150;                      // the once-a-year one
  else if (rel <= -2) c += 60;
  else if (rel === -1) c += 30;
  else if (rel === 0) c += 15;
  else c -= rel * 5;                                // soft penalty over par
  return Math.max(0, c) * PAYOUT_SCALE;
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
