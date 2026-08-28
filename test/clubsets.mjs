/* =========================================================================
   clubsets.mjs — the one place power is allowed to come from a case
   -------------------------------------------------------------------------
   Club sets replaced the coin-bought tier ladder. Three things have to hold
   or the rework is worse than what it replaced:

     1. THE CEILING DID NOT MOVE. A fully upgraded Mythic set is exactly
        where the old Signature Set was, so every calibrated carry target
        and every yardage a player has learned still means what it meant.
     2. UPGRADING WHAT YOU PULLED IS NEVER WASTED. A maxed set must beat a
        fresh set one rarity up, or an unlucky player's coins buy nothing.
     3. A DUPLICATE IS WORTH SOMETHING. The case must never come back empty.

   Plus the migration: nobody who bought the old ladder may lose a coin.
   ========================================================================= */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import {
  CLUB_SETS, SET_TIERS, UPGRADE_COSTS, CLUB_CASE_ODDS, STARTER_SET,
  setById, setStats, upgradeCost, upgradeCount, isMaxed, rarityRank, rollClubCase,
  CLASS_LINES, CLASS_BANDS, CLUB_CLASSES, STAT_KEYS, CLUBS_IN_CLASS, classOf
} from '../public/js/shared/clubsets.js';

process.env.GOLF_DATA_DIR ||= '.test-data-clubsets';
const OWN_DIR = process.env.GOLF_DATA_DIR === '.test-data-clubsets';
if (OWN_DIR) after(() => rm('.test-data-clubsets', { recursive: true, force: true }).catch(() => {}));

const RARITIES = ['standard', 'tour', 'pro', 'legend', 'mythic'];
const oneOf = r => CLUB_SETS.find(s => s.rarity === r);

/* ------------------------------------------------------------ the table */
test('every set names a real rarity, and every rarity has at least one set', () => {
  for (const s of CLUB_SETS) {
    assert.ok(RARITIES.includes(s.rarity), `set "${s.id}" has rarity "${s.rarity}"`);
    assert.ok(s.name && s.brand && s.look, `set "${s.id}" is missing identity fields`);
    assert.ok(/^#[0-9a-f]{6}$/i.test(s.shaft), `set "${s.id}" has no shaft colour`);
  }
  for (const r of RARITIES) {
    assert.ok(oneOf(r), `nothing to pull at rarity "${r}" — rollClubCase would skip it`);
  }
  const ids = CLUB_SETS.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length, 'two sets share an id');
  assert.ok(setById(STARTER_SET), 'the starter set must exist');
  assert.equal(setById(STARTER_SET).rarity, 'standard',
    'the starter set must be Standard, or a new player\'s first Club Case is a downgrade');
});

test('the ceiling has not moved: a maxed Mythic set is exactly the old top set', () => {
  const top = setStats(oneOf('mythic').id, 1, 'DR');
  assert.ok(Math.abs(top.speed - 1.065) < 1e-9, `speed is ${top.speed}, was 1.065`);
  assert.ok(Math.abs(top.faceDamp - 0.33) < 1e-9, `faceDamp is ${top.faceDamp}, was 0.33`);
});

test('the ladder climbs, and every rarity is strictly better than the one below', () => {
  for (let i = 1; i < RARITIES.length; i++) {
    const lo = setStats(oneOf(RARITIES[i - 1]).id, 0, 'I7');
    const hi = setStats(oneOf(RARITIES[i]).id, 0, 'I7');
    assert.ok(hi.speed > lo.speed,
      `a fresh ${RARITIES[i]} set (${hi.speed}) must out-hit a fresh ${RARITIES[i - 1]} one (${lo.speed})`);
    assert.ok(hi.faceDamp >= lo.faceDamp, `${RARITIES[i]} is less forgiving than ${RARITIES[i - 1]}`);
  }
});

test('a maxed set always beats a fresh set one rarity up — upgrading is never wasted', () => {
  for (let i = 0; i < RARITIES.length - 1; i++) {
    const lo = RARITIES[i], hi = RARITIES[i + 1];
    const loMax = setStats(oneOf(lo).id, 1, 'I7').speed;
    const hiBase = setStats(oneOf(hi).id, 0, 'I7').speed;
    assert.ok(loMax > hiBase,
      `a maxed ${lo} set (${loMax}) must beat a fresh ${hi} one (${hiBase}) — ` +
      'without this overlap, coins spent on an unlucky pull buy nothing');
  }
});

test('mythics really do take longer', () => {
  for (let i = 1; i < RARITIES.length; i++) {
    assert.ok(upgradeCount(RARITIES[i]) >= upgradeCount(RARITIES[i - 1]),
      `${RARITIES[i]} has fewer rungs than ${RARITIES[i - 1]}`);
  }
  assert.ok(upgradeCount('mythic') > upgradeCount('standard'),
    'a Mythic set must take strictly more upgrades than a Standard one');
  const sum = a => a.reduce((x, y) => x + y, 0);
  assert.ok(sum(UPGRADE_COSTS.mythic) > sum(UPGRADE_COSTS.standard) * 10,
    'a Mythic path must cost far more than a Standard one');
  for (const r of RARITIES) {
    assert.equal(UPGRADE_COSTS[r].length, upgradeCount(r));
    for (let i = 1; i < UPGRADE_COSTS[r].length; i++) {
      assert.ok(UPGRADE_COSTS[r][i] > UPGRADE_COSTS[r][i - 1],
        `${r} upgrade ${i} is not dearer than the one before it`);
    }
  }
});

test('every one of the 70 authored class lines sits inside its rarity band', () => {
  /* Sets now author five INDEPENDENT class lines each, so they genuinely
     differ in character — a bomber is not a wedge specialist. What stops
     280 hand-written numbers drifting into a broken set is this: every one
     must land inside its rarity's band. */
  for (const set of CLUB_SETS) {
    const band = CLASS_BANDS[set.rarity];
    for (const cls of CLUB_CLASSES) {
      const line = CLASS_LINES[set.id]?.[cls];
      assert.ok(line, `${set.id} has no line for ${cls}`);
      for (const k of STAT_KEYS) {
        const [lo, hi] = band[k];
        assert.ok(line[k] >= lo - 1e-9 && line[k] <= hi + 1e-9,
          `${set.id}/${cls}/${k} = ${line[k]} is outside its ${set.rarity} band [${lo}, ${hi}]`);
      }
    }
  }
});

test('sets really do differ per class — a bomber is not a wedge specialist', () => {
  // the whole point of five independent lines: if every set resolved the
  // same, this rework bought nothing
  const bomber = setStats('saltmarsh', 0, 'DR').dist;
  const bomberWedge = setStats('saltmarsh', 0, 'SW').dist;
  assert.ok(bomber > bomberWedge,
    `a bomber's driver (${bomber}) must out-distance its own wedges (${bomberWedge})`);

  const precise = setStats('ironclad', 0, 'I7');
  const blades = setStats('obsidian', 0, 'I7');
  assert.ok(precise.sweet > blades.sweet,
    'a cavity-back set must have a wider sweet spot than a blade set a rarity above it');
  assert.ok(blades.spin > precise.spin, 'blades must out-spin cavity backs');
});

test('a bigger sweet spot really does cost less on a mishit', async () => {
  /* The stat has to be worth displaying. Before mishits cost ball speed,
     sweet spot only nudged backspin and a comparison matrix would have been
     showing the player a number that did almost nothing. */
  const { ShotSim, calibrateCarries, makeFlatRange } = await import('../public/js/shared/ballistics.js');
  calibrateCarries();
  const T = makeFlatRange();
  const carry = (set, faceDeg) => new ShotSim(T, {
    x: 0, z: 0, clubKey: 'I7', power: 1, aim: 0, faceDeg, attackDeg: 0,
    wind: { dir: 0, speed: 0 }, clubSet: set, setDone: 0, ignoreCup: true
  }).runToEnd().carry;

  const starterCost = carry(STARTER_SET, 0) - carry(STARTER_SET, 5);
  const mythicCost = carry('signature', 0) - carry('signature', 5);
  assert.ok(starterCost > mythicCost + 3,
    `a 5-degree mishit should cost the starter set materially more than a Mythic one ` +
    `(${starterCost.toFixed(1)}m vs ${mythicCost.toFixed(1)}m)`);
  assert.ok(mythicCost > 0, 'a mishit must still cost something, even with the best bag');
});

test('a pure strike is exactly neutral, so the calibrated carries cannot move', async () => {
  const { crewEffect } = await import('../public/js/shared/crew.js');
  // smash = 0.90 + 0.10 * purity, and purity is 1 for a square face at
  // full power — the whole reason adding it left physics.mjs untouched
  const ref = crewEffect(null, null, { power: 1 });
  assert.equal(ref.speed, 1);
  assert.equal(ref.sweet, 6, 'the reference sweet spot must stay the hardcoded 6');
  assert.equal(ref.spin, 1);
});

test('a club with no class still resolves, and an unknown one reads as irons', () => {
  assert.ok(setStats(STARTER_SET, 0, 'DR'));
  assert.ok(setStats(STARTER_SET, 0, null));
  assert.deepEqual(setStats(STARTER_SET, 0, 'NOPE'), setStats(STARTER_SET, 0, 'I7'));
});

/* ------------------------------------------------------------- clamping */
test('an upgrade level is clamped, never trusted', () => {
  const id = oneOf('standard').id;
  const max = setStats(id, 1, 'I7');
  assert.deepEqual(setStats(id, 99, 'I7'), max, 'a hand-edited completion went past the cap');
  assert.deepEqual(setStats(id, -5, 'I7'), setStats(id, 0, 'I7'), 'a negative completion went below the floor');
  assert.deepEqual(setStats(id, NaN, 'I7'), setStats(id, 0, 'I7'), 'NaN must read as uncollected, not NaN stats');
});

test('an unknown set resolves to null, which crewEffect already reads as the reference ball', () => {
  assert.equal(setStats('no-such-set', 0, 'I7'), null);
  assert.equal(setStats(undefined, 0, 'I7'), null);
  assert.equal(upgradeCost('standard', upgradeCount('standard')), null, 'a maxed set must have no price');
});

test('isMaxed agrees with the cost table', () => {
  for (const r of RARITIES) {
    const id = oneOf(r).id;
    assert.equal(isMaxed(id, upgradeCount(r) - 1), false);
    assert.equal(isMaxed(id, upgradeCount(r)), true);
    assert.equal(upgradeCost(r, upgradeCount(r)), null);
  }
});

/* ------------------------------------------------------------- the case */
test('the Club Case odds are a real distribution weighted toward the common end', () => {
  const total = CLUB_CASE_ODDS.reduce((s, r) => s + r.weight, 0);
  assert.ok(total > 0);
  for (let i = 1; i < CLUB_CASE_ODDS.length; i++) {
    assert.ok(CLUB_CASE_ODDS[i].weight <= CLUB_CASE_ODDS[i - 1].weight,
      'a rarer tier must never be more likely than a commoner one');
  }
  /* The whole reason sets do not ride the cosmetic table: a Mythic decal is
     a ~0.1% pull, which is fine for a decal and absurd for the best bag in
     the game. This asserts the top set stays genuinely reachable. */
  const mythic = CLUB_CASE_ODDS.find(r => r.id === 'mythic');
  assert.ok(mythic.weight / total >= 0.01,
    `a Mythic set is a ${(mythic.weight / total * 100).toFixed(2)}% pull — too rare to be a real goal`);
});

test('rollClubCase respects its odds over many rolls', () => {
  // a fixed seeded generator, so this asserts the distribution rather than
  // hoping Math.random behaves on the day
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const counts = {};
  for (let i = 0; i < 4000; i++) {
    const r = rollClubCase({}, rand);          // owns nothing: always a set
    assert.equal(r.kind, 'set');
    counts[r.set.rarity] = (counts[r.set.rarity] || 0) + 1;
  }
  const total = CLUB_CASE_ODDS.reduce((s, r) => s + r.weight, 0);
  for (const { id, weight } of CLUB_CASE_ODDS) {
    const want = weight / total, got = (counts[id] || 0) / 4000;
    assert.ok(Math.abs(got - want) < 0.05,
      `${id} came up ${(got * 100).toFixed(1)}% of the time, expected ~${(want * 100).toFixed(1)}%`);
  }
});

test('a duplicate pull upgrades an owned set instead of coming back empty', () => {
  // owns every set, all unupgraded — every roll must land on an upgrade
  const owned = Object.fromEntries(CLUB_SETS.map(s => [s.id, 0]));
  for (let i = 0; i < 50; i++) {
    const r = rollClubCase(owned, Math.random);
    assert.equal(r.kind, 'upgrade', 'a duplicate should have upgraded something');
    assert.equal(r.level, 1, 'an upgrade should raise the level by exactly one');
    // and it should favour the rarest un-maxed set, since that ceiling is highest
    assert.equal(r.set.rarity, 'mythic', 'the rarest un-maxed set should be upgraded first');
  }
});

test('only when everything is owned AND maxed does the case pay gems', () => {
  const owned = Object.fromEntries(CLUB_SETS.map(s => [s.id, upgradeCount(s.rarity)]));
  const r = rollClubCase(owned, Math.random);
  assert.equal(r.kind, 'gems');
  assert.ok(r.amount > 0, 'a case must never come back with literally nothing');
});

test('a roll never hands out a set the player already owns', () => {
  const owned = { [oneOf('standard').id]: 0 };
  for (let i = 0; i < 200; i++) {
    const r = rollClubCase(owned, Math.random);
    if (r.kind === 'set') assert.ok(!(r.set.id in owned), `rolled a duplicate: ${r.set.id}`);
  }
});

/* --------------------------------------------------------- the refund */
test('the migration pays back the retired ladder exactly, and only once', async () => {
  const { migrateProfile, ladderRefund } = await import('../server/profiles.js');

  // the most expensive career possible under the old ladder
  const p = migrateProfile({ schemaVersion: 2, coins: 1000, clubTier: 6, refine: 3 });
  assert.equal(p.coins, 1000 + ladderRefund(6, 3), 'the refund was not paid in full');
  assert.equal(p.clubTier, undefined, 'a retired field survived the migration');
  assert.equal(p.refine, undefined);
  assert.deepEqual(p.clubSets, { [STARTER_SET]: 0 }, 'everyone starts on the free set');
  assert.equal(p.clubSet, STARTER_SET);

  // idempotent — running it twice must not pay twice
  const coinsAfterOnce = p.coins;
  const again = migrateProfile(p);
  assert.equal(again, p, 'migrateProfile should return the same object when already current');
  assert.equal(again.coins, coinsAfterOnce, 'the refund was paid a second time');
});

test('the refund is worth more the further up the old ladder you got', async () => {
  const { ladderRefund } = await import('../server/profiles.js');
  assert.equal(ladderRefund(0, 0), 0, 'the free starter tier cost nothing to reach');
  let last = -1;
  for (let t = 0; t <= 6; t++) {
    const v = ladderRefund(t, 0);
    assert.ok(v > last, `refund did not grow from tier ${t - 1} to ${t}`);
    last = v;
  }
  assert.ok(ladderRefund(6, 3) > ladderRefund(6, 0),
    'refinements standing at the top tier must be repaid too');
  // and a nonsense profile cannot mint coins
  assert.equal(ladderRefund(99, 99), ladderRefund(6, 3), 'an out-of-range tier was not clamped');
  assert.equal(ladderRefund(-1, -1), 0);
  assert.equal(ladderRefund(NaN, NaN), 0);
});

test('a fresh profile owns the starter set and nothing else', async () => {
  const { getProfile } = await import('../server/profiles.js');
  const pid = 'clubset-fresh-' + Math.random().toString(36).slice(2);
  const p = getProfile(pid);
  assert.deepEqual(p.clubSets, { [STARTER_SET]: 0 });
  assert.equal(p.clubSet, STARTER_SET);
  // its own object, never one literal shared by every player at once
  const q = getProfile(pid + '-b');
  assert.notEqual(p.clubSets, q.clubSets, 'two profiles share one clubSets object');
});

test('equipping is gated on ownership, server-side', async () => {
  const { getProfile, equipClubSet } = await import('../server/profiles.js');
  const pid = 'clubset-equip-' + Math.random().toString(36).slice(2);
  const p = getProfile(pid);
  const mythic = oneOf('mythic').id;

  const stolen = equipClubSet(pid, mythic);
  assert.equal(stolen.ok, false, 'a set nobody pulled was equipped — that is free distance');
  assert.equal(p.clubSet, STARTER_SET);

  assert.equal(equipClubSet(pid, 'no-such-set').ok, false);

  p.clubSets = { ...p.clubSets, [mythic]: 0 };
  const real = equipClubSet(pid, mythic);
  assert.equal(real.ok, true, JSON.stringify(real));
  assert.equal(getProfile(pid).clubSet, mythic);
});

test('opening a Club Case needs one in hand, and spends exactly one', async () => {
  const { getProfile, openClubCase } = await import('../server/profiles.js');
  const pid = 'clubset-open-' + Math.random().toString(36).slice(2);
  const p = getProfile(pid);

  assert.equal(openClubCase(pid).ok, false, 'opened a case that was never bought');

  p.clubCases = 2;
  const r = openClubCase(pid);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.clubCasesLeft, 1, 'opening must spend exactly one case');
  /* Reported in the same shape a cosmetic case reports an item, so the reel
     and reveal need no special case for club sets. */
  assert.ok(['item', 'gems'].includes(r.kind), `unexpected kind "${r.kind}"`);
  if (r.kind === 'item') {
    assert.equal(r.item.kind, 'clubset', 'the reveal needs a kind it can pick an icon for');
    assert.ok(RARITIES.includes(r.rarity));
    assert.ok(r.item.id in getProfile(pid).clubSets, 'the pulled set did not reach the profile');
  }
});

test('a duplicate pull is reported as an upgrade, not as a fresh set', async () => {
  const { getProfile, openClubCase } = await import('../server/profiles.js');
  const pid = 'clubset-dupe-' + Math.random().toString(36).slice(2);
  const p = getProfile(pid);
  // owns everything unupgraded, so the next pull can only be a duplicate
  p.clubSets = Object.fromEntries(CLUB_SETS.map(s => [s.id, 0]));
  p.clubCases = 1;

  const r = openClubCase(pid);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.kind, 'item');
  assert.equal(r.upgraded, 1, 'a duplicate should report the level it upgraded to');
  assert.ok(r.steps > 0, 'the reveal needs to know how long the path is');
  assert.equal(getProfile(pid).clubSets[r.item.id], 1, 'the upgrade did not reach the profile');
});
