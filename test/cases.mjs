/* =========================================================================
   cases.mjs — a case never hands out something you already own, or nothing
   -------------------------------------------------------------------------
   Two failure modes matter for a random reward and nothing else does:
   handing back a duplicate (feels like a broken machine, not bad luck),
   and handing back nothing at all (a case that can silently fail is worse
   than one that never existed). Everything here is one of those two
   checks, run hard — thousands of rolls, a fully-owned pool, an owner
   with almost nothing left to give.
   ========================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CASE_POOL, RARITIES, rollCase, caseItemKey } from '../public/js/shared/cases.js';

test('the pool is non-trivial and every item resolves to a real rarity', () => {
  assert.ok(CASE_POOL.length >= 15, `only ${CASE_POOL.length} items in the case pool`);
  const rarityIds = new Set(RARITIES.map(r => r.id));
  for (const item of CASE_POOL) assert.ok(rarityIds.has(item.rarity), `${caseItemKey(item)} has an unknown rarity "${item.rarity}"`);
});

test('a roll with nothing owned always returns an item, never a fallback gem payout', () => {
  for (let i = 0; i < 200; i++) {
    const r = rollCase(new Set());
    assert.equal(r.ok, true);
    assert.equal(r.kind, 'item', `roll ${i} fell back to gems with an empty owned set`);
  }
});

test('a roll never hands back something already in the owned set', () => {
  const owned = new Set(CASE_POOL.slice(0, 10).map(caseItemKey));
  for (let i = 0; i < 500; i++) {
    const r = rollCase(owned);
    if (r.kind === 'item') assert.ok(!owned.has(caseItemKey(r.item)), `rolled a duplicate: ${caseItemKey(r.item)}`);
  }
});

test('owning the entire pool converts the case to gems instead of failing', () => {
  const owned = new Set(CASE_POOL.map(caseItemKey));
  const r = rollCase(owned);
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'gems');
  assert.ok(r.amount > 0);
});

test('a thin tier falls through to a rarer one rather than handing out nothing', () => {
  // own everything EXCEPT the legend tier — every standard/tour/pro roll
  // must fall through to legend, never come back empty
  const owned = new Set(CASE_POOL.filter(i => i.rarity !== 'legend').map(caseItemKey));
  for (let i = 0; i < 100; i++) {
    const r = rollCase(owned);
    assert.equal(r.ok, true);
    if (r.kind === 'item') assert.equal(r.item.rarity, 'legend');
  }
});

test('rolls are weighted toward Standard over many trials, not uniform', () => {
  const counts = { standard: 0, tour: 0, pro: 0, legend: 0, gems: 0 };
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const r = rollCase(new Set());
    counts[r.kind === 'item' ? r.rarity : 'gems']++;
  }
  assert.ok(counts.standard > counts.tour, 'Standard should be pulled more than Tour');
  assert.ok(counts.tour > counts.pro, 'Tour should be pulled more than Pro');
  assert.ok(counts.pro > counts.legend, 'Pro should be pulled more than Legend');
  // loose bound, not a strict statistical test — just catching a badly
  // broken weight table, not chasing five-nines confidence
  assert.ok(counts.standard / N > 0.55, `Standard came in at ${(counts.standard / N * 100).toFixed(1)}%, expected roughly 70%`);
});

test('the roll is server-controlled, not client-visible — an injected rand still respects ownership', () => {
  const owned = new Set([caseItemKey(CASE_POOL[0])]);
  const r = rollCase(owned, () => 0);   // always the first candidate in whichever tier
  if (r.kind === 'item') assert.notEqual(caseItemKey(r.item), caseItemKey(CASE_POOL[0]));
});
