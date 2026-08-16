/* =========================================================================
   partialround.mjs — a round you did not finish is not a course record
   -------------------------------------------------------------------------
   A player's score for the round was worked out as their total strokes minus
   the par of the WHOLE course. Their total only counts holes they actually
   played — an unplayed hole reads as zero — so anybody who joined late,
   dropped out, or spectated the front nine had their three holes in twelve
   recorded as 12 − 36 = twenty-four under par.

   That one number then poisoned everything downstream, because `best` only
   ever moves down and the rating is driven by the mean per hole. A player
   who had never finished a round could sit at rating 95 with a best of −23,
   which is exactly what the career screen was showing — and neither number
   could ever be corrected by playing better, because nothing can beat −23.

   The arithmetic looked right in the source. It only goes wrong when the
   scorecard has gaps in it, which never happens in a round you play through
   from the first tee — which is every round anybody tests by hand.
   ========================================================================= */

import assert from 'node:assert/strict';
import test from 'node:test';
import { getProfile, recordRound, repairBests } from '../server/profiles.js';

const PARS = [4, 5, 3, 4, 4, 5, 3, 4, 4];        // par 36
const COURSE_PAR = PARS.reduce((a, b) => a + b, 0);

/** Score a card that may have gaps, the way the server does. */
function scoreCard(scores) {
  const total = scores.reduce((a, v) => a + (v ?? 0), 0);
  const playedPar = scores.reduce((a, v, i) => a + (v == null ? 0 : PARS[i]), 0);
  return { total, rel: total - playedPar, played: scores.filter(v => v != null).length };
}

test('a three-hole cameo is scored against three holes of par', () => {
  const card = [4, 5, 3, null, null, null, null, null, null];
  const s = scoreCard(card);
  assert.equal(s.played, 3);
  assert.equal(s.rel, 0, 'three holes played to par should be level, not under');
  /* The old arithmetic, spelled out, so the size of the error is on record. */
  const old = s.total - COURSE_PAR;
  assert.equal(old, -24, 'sanity: this is what the bug produced');
});

test('a partial round cannot set a best', () => {
  const pid = 'partial-1';
  const p = getProfile(pid);
  p.best = null;
  recordRound(pid, -2, 3);                    // two under through three holes
  assert.equal(p.best, null, 'three holes set a best round');
  recordRound(pid, 4, 9);                     // a real, mediocre round
  assert.equal(p.best, 4, 'a complete round should set the best');
});

test('a complete round still sets and improves a best', () => {
  const pid = 'partial-2';
  const p = getProfile(pid);
  p.best = null;
  recordRound(pid, 6, 9);
  assert.equal(p.best, 6);
  recordRound(pid, 2, 9);
  assert.equal(p.best, 2, 'a better complete round should win');
  recordRound(pid, 8, 9);
  assert.equal(p.best, 2, 'a worse round should not');
});

test('an impossible best left by the bug is repaired from history', () => {
  const pid = 'partial-3';
  const p = getProfile(pid);
  p.best = -23;                                          // the poisoned value
  p.history = [
    { rel: 5, c: 'claude', h: 9 },
    { rel: 3, c: 'claude', h: 9 },
    { rel: -24, c: 'claude', h: 3 }                      // the cameo that did it
  ];
  assert.equal(repairBests(new Map([[pid, p]])), 1);
  assert.equal(p.best, 3, 'should fall back to the best COMPLETE round');
});

test('a legitimate best is never touched by the repair', () => {
  const pid = 'partial-4';
  const p = getProfile(pid);
  p.best = -4;
  p.history = [{ rel: -4, c: 'claude', h: 9 }, { rel: 2, c: 'claude', h: 9 }];
  assert.equal(repairBests(new Map([[pid, p]])), 0, 'a supported best was changed');
  assert.equal(p.best, -4);
});

test('with no complete round on record, the repair leaves well alone', () => {
  /* History is capped at twenty entries, so a long-standing player's
     evidence can rotate away. Guessing would be worse than doing nothing. */
  const pid = 'partial-5';
  const p = getProfile(pid);
  p.best = -23;
  p.history = [{ rel: -24, c: 'claude', h: 3 }];
  assert.equal(repairBests(new Map([[pid, p]])), 0);
  assert.equal(p.best, -23, 'nothing to justify a change');
});
