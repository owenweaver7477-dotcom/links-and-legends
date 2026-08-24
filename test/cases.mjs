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
import { CASE_POOL, RARITIES, rollCase, caseItemKey, tierIndex, tierOdds, proTierOdds, vaultTierOdds,
         PITY_TIER, VAULT_TIER, PITY_THRESHOLD } from '../public/js/shared/cases.js';

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
  // own everything EXCEPT legend and mythic — every standard/tour/pro roll
  // must fall through to one of those two, never come back empty. Mythic
  // sits above legend now, so a roll that starts there must fall through
  // no further than the two thinnest tiers, not all the way to gems.
  const owned = new Set(CASE_POOL.filter(i => i.rarity !== 'legend' && i.rarity !== 'mythic').map(caseItemKey));
  for (let i = 0; i < 100; i++) {
    const r = rollCase(owned);
    assert.equal(r.ok, true);
    if (r.kind === 'item') assert.ok(r.item.rarity === 'legend' || r.item.rarity === 'mythic',
      `expected legend or mythic, got ${r.item.rarity}`);
  }
});

test('rolls are weighted toward Standard over many trials, not uniform', () => {
  const counts = { standard: 0, tour: 0, pro: 0, legend: 0, mythic: 0, gems: 0 };
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const r = rollCase(new Set());
    counts[r.kind === 'item' ? r.rarity : 'gems']++;
  }
  assert.ok(counts.standard > counts.tour, 'Standard should be pulled more than Tour');
  assert.ok(counts.tour > counts.pro, 'Tour should be pulled more than Pro');
  assert.ok(counts.pro > counts.legend, 'Pro should be pulled more than Legend');
  assert.ok(counts.legend > counts.mythic, 'Legend should be pulled more than Mythic');
  // loose bound, not a strict statistical test — just catching a badly
  // broken weight table, not chasing five-nines confidence
  assert.ok(counts.standard / N > 0.55, `Standard came in at ${(counts.standard / N * 100).toFixed(1)}%, expected roughly 70%`);
});

test('the roll is server-controlled, not client-visible — an injected rand still respects ownership', () => {
  const owned = new Set([caseItemKey(CASE_POOL[0])]);
  const r = rollCase(owned, () => 0);   // always the first candidate in whichever tier
  if (r.kind === 'item') assert.notEqual(caseItemKey(r.item), caseItemKey(CASE_POOL[0]));
});

/* ---- the pity counter --------------------------------------------------
   profiles.js decides WHEN to force it (see rewards.mjs for that seam);
   this file only has to prove rollCase HONOURS forcePity once asked. */
test('forcePity always lands at or above the pity tier, even on a roll that would normally miss', () => {
  const pityIdx = tierIndex(PITY_TIER);
  for (let i = 0; i < 200; i++) {
    // rand()=0.999 would land deep in Standard on a normal roll — forcePity
    // must override that, not just bias it
    const r = rollCase(new Set(), () => 0.999, true);
    if (r.kind === 'item') assert.ok(tierIndex(r.rarity) >= pityIdx,
      `forced pull landed on ${r.rarity}, below the pity tier`);
    // 'gems' is the only acceptable non-item outcome: it means every item
    // at or above the pity tier is already owned, not that pity was ignored
  }
});

test('forcePity still falls through to gems if everything at or above the pity tier is owned', () => {
  const owned = new Set(CASE_POOL.filter(i => tierIndex(i.rarity) >= tierIndex(PITY_TIER)).map(caseItemKey));
  const r = rollCase(owned, Math.random, true);
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'gems', 'a forced pity roll with nothing left to give should fall back to gems, not fail');
});

test('forcePity as a tier id forces that exact floor, not the Pro Case\'s PITY_TIER', () => {
  const floorIdx = tierIndex(VAULT_TIER);
  assert.ok(floorIdx < tierIndex(PITY_TIER), 'test assumes VAULT_TIER sits below PITY_TIER');
  for (let i = 0; i < 200; i++) {
    const r = rollCase(new Set(), () => 0.999, VAULT_TIER);
    if (r.kind === 'item') assert.ok(tierIndex(r.rarity) >= floorIdx,
      `floor-forced pull landed on ${r.rarity}, below ${VAULT_TIER}`);
  }
});

test('a string floor is not silently treated as truthy-boolean pity — it lands at ITS tier, not PITY_TIER', () => {
  // if the `forcePity === true` branch mis-widened to `if (forcePity)`,
  // any truthy string (including VAULT_TIER, which sits below PITY_TIER)
  // would incorrectly jump all the way to PITY_TIER instead of its own,
  // lower floor — this proves the two floors are actually distinguishable
  let sawBelowPityTier = false;
  for (let i = 0; i < 200; i++) {
    const r = rollCase(new Set(), Math.random, VAULT_TIER);
    if (r.kind === 'item' && r.rarity === VAULT_TIER) { sawBelowPityTier = true; break; }
  }
  assert.ok(sawBelowPityTier, `200 VAULT_TIER-floored rolls never once landed on ${VAULT_TIER} itself — ` +
    `looks like it jumped straight to PITY_TIER instead`);
});

test('tierIndex orders the ladder standard (rarest-last) through mythic (rarest)', () => {
  assert.equal(tierIndex('standard'), 0);
  assert.ok(tierIndex('mythic') > tierIndex('legend'));
  assert.ok(tierIndex('legend') > tierIndex('pro'));
  assert.ok(tierIndex('pro') > tierIndex('tour'));
  assert.equal(tierIndex('not-a-real-tier'), -1);
});

test('tierOdds covers every rarity once, sums to 100%, and never invents an item that is not in the pool', () => {
  const odds = tierOdds();
  assert.equal(odds.length, RARITIES.length);
  const total = odds.reduce((s, t) => s + t.pct, 0);
  assert.ok(Math.abs(total - 100) < 0.01, `odds summed to ${total}, expected 100`);
  const poolCount = odds.reduce((s, t) => s + t.count, 0);
  assert.equal(poolCount, CASE_POOL.length, 'tierOdds counted a different number of items than CASE_POOL actually has');
  for (const t of odds) assert.ok(t.count > 0, `${t.id} has no items at all — a tier the UI would advertise but never pay out`);
});

test('PITY_THRESHOLD is a real, positive number the UI can count down from', () => {
  assert.ok(Number.isInteger(PITY_THRESHOLD) && PITY_THRESHOLD > 0);
});

/* ---- the Pro Case's own odds table --------------------------------------
   A second case type, not a second tier carved out of the first one's pool
   (see profiles.js's openProCase) — this only has to prove the odds table
   shown for it is honest: pro-tier-and-up only, and summing to 100% on its
   own rather than reading like a sliver of the full ladder. */
test('proTierOdds only covers PITY_TIER and rarer, and sums to 100% on its own', () => {
  const odds = proTierOdds();
  const full = tierOdds();
  assert.ok(odds.length < full.length, 'the Pro Case table should be a strict subset of the full ladder');
  for (const t of odds) assert.ok(tierIndex(t.id) >= tierIndex(PITY_TIER), `${t.id} is below the Pro Case's own floor`);
  const total = odds.reduce((s, t) => s + t.pct, 0);
  assert.ok(Math.abs(total - 100) < 0.01, `Pro Case odds summed to ${total}, expected 100`);
});

test('every tier at or above PITY_TIER on the full ladder also appears in proTierOdds', () => {
  const odds = proTierOdds();
  const ids = new Set(odds.map(t => t.id));
  for (const r of RARITIES) if (tierIndex(r.id) >= tierIndex(PITY_TIER)) assert.ok(ids.has(r.id), `${r.id} missing from the Pro Case table`);
});

/* ---- the Vault's own odds table — same shape of checks as the Pro Case's,
   plus one that actually proves it's a DIFFERENT, wider table rather than
   proTierOdds relabelled: the Vault's floor is lower, so it must cover
   strictly more tiers than the Pro Case does. */
test('vaultTierOdds only covers VAULT_TIER and rarer, and sums to 100% on its own', () => {
  const odds = vaultTierOdds();
  const full = tierOdds();
  assert.ok(odds.length < full.length, 'the Vault table should be a strict subset of the full ladder');
  for (const t of odds) assert.ok(tierIndex(t.id) >= tierIndex(VAULT_TIER), `${t.id} is below the Vault's own floor`);
  const total = odds.reduce((s, t) => s + t.pct, 0);
  assert.ok(Math.abs(total - 100) < 0.01, `Vault odds summed to ${total}, expected 100`);
});

test('the Vault table covers strictly more tiers than the Pro Case table — a real middle rung', () => {
  assert.ok(vaultTierOdds().length > proTierOdds().length,
    'the Vault should include at least one tier the Pro Case excludes (its own floor tier)');
});
