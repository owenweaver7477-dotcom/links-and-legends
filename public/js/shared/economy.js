/* =========================================================================
   economy.js — how golf becomes coins
   -------------------------------------------------------------------------
   Pure functions, shared by the server (which pays) and the tests (which
   audit).  The formula rewards good golf rather than mere attendance, but a
   rough hole never pays negative: the worst outcome is zero.

   From the design document, implemented as written:
     20 per hole finished · +15 par · +30 birdie · +60 eagle · +150 ace
     -5 per stroke over par (floored at 0 for the hole)
     +100 for finishing the round
     +10% per under-par streak of 3+, capped at +50%
     one-time 500 for the first clear of each course
   ========================================================================= */

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
  return Math.max(0, c);
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
  const roundBonus = holeScores.length > 0 ? 100 : 0;
  // +10% for each hole of the best under-par streak once it reaches 3, cap 50%
  const streakPct = bestStreak >= 3 ? Math.min(50, bestStreak * 10) : 0;
  const streakBonus = Math.round((holes + roundBonus) * streakPct / 100);
  const firstClearBonus = firstClear ? 500 : 0;
  return {
    holes, roundBonus, streakPct, streakBonus, firstClearBonus,
    total: holes + roundBonus + streakBonus + firstClearBonus
  };
}
