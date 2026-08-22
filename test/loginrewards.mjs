/* =========================================================================
   loginrewards.mjs — the streak survives a missed day exactly once
   -------------------------------------------------------------------------
   The whole point of a freeze is the day it's needed, so the tests that
   matter most here are the boundary ones: exactly one day missed with a
   freeze in hand keeps the streak alive, two days missed does not, and the
   very first claim of a brand-new player's life pays day 1 and not day 2.
   That last one is an easy off-by-one to ship — an early draft of
   planClaim treated "haven't claimed yet" the same as "already claimed day
   1", so a new player's first login silently paid out day 2's reward.
   ========================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planClaim, rewardFor, utcDateKey, CYCLE_LENGTH, MAX_FREEZES } from '../public/js/shared/loginrewards.js';

const DAY = 86400000;
const day0 = Date.UTC(2026, 0, 1, 12);   // an arbitrary UTC noon to start from

test('a brand-new player claims day 1, not day 2', () => {
  const r = planClaim({ day: 0, cycle: 1, freezes: 0, lastClaimDate: null }, day0);
  assert.equal(r.ok, true);
  assert.equal(r.day, 1);
  assert.equal(r.cycle, 1);
  assert.deepEqual(r.reward, rewardFor(1, 1));
});

test('claiming twice on the same UTC day is refused', () => {
  const first = planClaim({ day: 0, cycle: 1, freezes: 0, lastClaimDate: null }, day0);
  const second = planClaim(first.nextState, day0 + 60000);   // a minute later, same day
  assert.equal(second.ok, false);
});

test('consecutive days advance the streak by exactly one each time', () => {
  let state = { day: 0, cycle: 1, freezes: 0, lastClaimDate: null };
  for (let i = 1; i <= 5; i++) {
    const r = planClaim(state, day0 + DAY * (i - 1));
    assert.equal(r.day, i, `expected day ${i}, got ${r.day}`);
    assert.equal(r.reset, false);
    state = r.nextState;
  }
});

test('the cycle wraps from 14 back to 1 and the cycle number advances', () => {
  let state = { day: 13, cycle: 1, freezes: 0, lastClaimDate: utcDateKey(day0) };
  const r = planClaim(state, day0 + DAY);
  assert.equal(r.day, 14);
  const r2 = planClaim(r.nextState, day0 + DAY * 2);
  assert.equal(r2.day, 1);
  assert.equal(r2.cycle, 2, 'wrapping past day 14 should start cycle 2');
  assert.equal(r2.reset, false, 'a normal wrap is not a reset');
});

test('a freeze in hand covers exactly one missed day', () => {
  const state = { day: 5, cycle: 1, freezes: 1, lastClaimDate: utcDateKey(day0) };
  const r = planClaim(state, day0 + DAY * 2);   // one day skipped
  assert.equal(r.ok, true);
  assert.equal(r.day, 6, 'the streak should have advanced through the freeze');
  assert.equal(r.usedFreeze, true);
  assert.equal(r.freezes, 0, 'the freeze should have been spent');
  assert.equal(r.reset, false);
});

test('two missed days is too many for one freeze', () => {
  const state = { day: 5, cycle: 1, freezes: 1, lastClaimDate: utcDateKey(day0) };
  const r = planClaim(state, day0 + DAY * 3);   // two days skipped
  assert.equal(r.reset, true);
  assert.equal(r.day, 1);
  assert.equal(r.cycle, 1);
});

test('a missed day with no freeze resets to day 1, with a comeback bonus for a long absence', () => {
  const state = { day: 8, cycle: 2, freezes: 0, lastClaimDate: utcDateKey(day0) };
  const r = planClaim(state, day0 + DAY * 10);   // nine days gone
  assert.equal(r.reset, true);
  assert.equal(r.day, 1);
  assert.equal(r.cycle, 1);
  assert.ok(r.comebackBonus, 'a nine-day absence should soften the reset with something');
});

test('a freeze is earned every 7 days claimed, capped at MAX_FREEZES', () => {
  let state = { day: 0, cycle: 1, freezes: 0, lastClaimDate: null };
  for (let i = 1; i <= 7; i++) {
    const r = planClaim(state, day0 + DAY * (i - 1));
    state = r.nextState;
  }
  assert.equal(state.day, 7);
  assert.equal(state.freezes, 1, 'day 7 should have granted a freeze');

  for (let i = 8; i <= 14; i++) {
    const r = planClaim(state, day0 + DAY * (i - 1));
    state = r.nextState;
  }
  assert.equal(state.day, 14);
  assert.equal(state.freezes, 2, 'day 14 should have granted a second freeze');

  // one more full cycle should NOT push freezes past the cap
  for (let i = 1; i <= 14; i++) {
    const r = planClaim(state, day0 + DAY * (13 + i));
    state = r.nextState;
  }
  assert.ok(state.freezes <= MAX_FREEZES, `freezes climbed to ${state.freezes}, past the cap of ${MAX_FREEZES}`);
});

test('later cycles pay more, capped rather than climbing forever', () => {
  const day1cycle1 = rewardFor(1, 1);
  const day1cycle2 = rewardFor(1, 2);
  const day1cycle10 = rewardFor(1, 10);
  const day1cycle50 = rewardFor(1, 50);
  assert.ok(day1cycle2.coins > day1cycle1.coins, 'cycle 2 should pay more than cycle 1');
  assert.deepEqual(day1cycle10, day1cycle50, 'the scale should be capped, not still climbing at cycle 50');
});

test('a case day never scales with the cycle — chests stay rare on purpose', () => {
  assert.equal(rewardFor(3, 1).cases, rewardFor(3, 50).cases);
});

test('CYCLE_LENGTH matches the table this file actually defines', () => {
  // a guard against the constant and the table silently drifting apart
  const state = { day: CYCLE_LENGTH - 1, cycle: 1, freezes: 0, lastClaimDate: utcDateKey(day0) };
  const r = planClaim(state, day0 + DAY);
  assert.equal(r.day, CYCLE_LENGTH);
  const r2 = planClaim(r.nextState, day0 + DAY * 2);
  assert.equal(r2.day, 1, 'claiming past CYCLE_LENGTH should wrap, not keep counting up');
});
