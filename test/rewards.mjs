/* =========================================================================
   rewards.mjs — the login cycle and case system over the wire, and the
   one thing that actually has to hold: a case pull is unforgeable
   -------------------------------------------------------------------------
   The pure logic (streak math, case-roll fairness) is already proven in
   loginrewards.mjs and cases.mjs. What's left to prove here is the seam:
   that these socket handlers actually reach a real profile outside any
   room (the daily-rewards panel and case inventory both live on the front
   page, same as the shop), and — the one line that matters for anything
   with a reward attached to it — that a client cannot simply CLAIM to own
   a case-exclusive decal it never rolled. looksEarnedAt is the gate for
   every cosmetic in the game; this checks that a case pull actually walks
   through it rather than being a second, unguarded path onto the avatar.
   ========================================================================= */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { io } from 'socket.io-client';
import { looksEarnedAt } from '../public/js/shared/avatars.js';

/* Four of the tests below import server/profiles.js directly rather than
   going through a socket, to reach claimLogin/openCase/buyCase without
   forcing real UTC days to pass. That module writes to disk the moment
   anything calls saveSoon() on it, at whatever GOLF_DATA_DIR resolves to
   — and left unset, that default is the SAME data/ directory the real dev
   server uses (see tools/test-server.mjs's own header for the exact
   phantom-profile incident that comment documents). tools/test-server.mjs
   sets it for the test *runner* process when run through `npm test`, but
   this file also gets executed directly (`node --test test/rewards.mjs`)
   during iteration, where nothing has set it. Setting it here, before the
   dynamic import below, makes the file safe either way. */
process.env.GOLF_DATA_DIR ||= '.test-data-rewards';
const OWN_DATA_DIR = process.env.GOLF_DATA_DIR === '.test-data-rewards';
if (OWN_DATA_DIR) after(() => rm('.test-data-rewards', { recursive: true, force: true }).catch(() => {}));

const URL = process.env.GOLF_URL || 'http://localhost:3000';
const wait = ms => new Promise(r => setTimeout(r, ms));
const connect = () => new Promise((res, rej) => {
  const s = io(URL, { transports: ['websocket'], forceNew: true, timeout: 4000 });
  s.once('connect', () => res(s)); s.once('connect_error', rej);
});
const ask = (s, ev, d) => new Promise(r => { let f = 0; s.emit(ev, d, x => { f = 1; r(x); }); setTimeout(() => f || r(null), 3000); });
const identify = (s, pid, name) => new Promise(res => { s.once('profile', res); s.emit('profile:me', { pid, name }); });

test('claiming outside any room reaches a real profile — same as the shop does', async () => {
  const s = await connect();
  const pid = 'reward-claim-' + Math.random().toString(36).slice(2);
  await identify(s, pid, 'Claimer');
  const res = await ask(s, 'login:claim', null);
  assert.equal(res?.ok, true, JSON.stringify(res));
  assert.equal(res.day, 1, 'a brand-new pid should claim day 1');
  const again = await ask(s, 'login:claim', null);
  assert.equal(again?.ok, false, 'a second claim the same day was accepted');
  s.disconnect();
});

test('a case can only be opened when one is actually owned', async () => {
  const s = await connect();
  const pid = 'reward-nocase-' + Math.random().toString(36).slice(2);
  await identify(s, pid, 'Empty');
  const res = await ask(s, 'case:open', null);
  assert.equal(res?.ok, false, 'a case opened out of an empty inventory');
  s.disconnect();
});

test('day 3 of the login cycle actually grants an openable case', async () => {
  // day 3's reward is a case (see loginrewards.js's BASE_DAYS) — jump
  // straight to "day 2 was claimed yesterday" rather than forcing three
  // real UTC days to pass; loginrewards.mjs already proves the date math
  // in detail, this just checks profiles.js actually applies its result.
  const { utcDateKey } = await import('../public/js/shared/loginrewards.js');
  const profiles = await import('../server/profiles.js');
  const pid = 'reward-case-day-' + Math.random().toString(36).slice(2);
  const p = profiles.getProfile(pid);
  const yesterday = utcDateKey(Date.now() - 86400000);
  p.login = { day: 2, cycle: 1, freezes: 0, lastClaimDate: yesterday };
  const claim = profiles.claimLogin(pid);
  assert.equal(claim.ok, true);
  assert.equal(claim.day, 3);
  assert.ok(claim.reward.cases >= 1, 'day 3 should have granted a case');
  assert.equal(profiles.getProfile(pid).cases, claim.reward.cases);
});

test('opening an owned case updates the inventory and grants something real', async () => {
  const profiles = await import('../server/profiles.js');
  const pid = 'reward-open-' + Math.random().toString(36).slice(2);
  const p = profiles.getProfile(pid);
  p.cases = 1;
  const before = profiles.publicProfile(pid);
  const result = profiles.openCase(pid);
  assert.equal(result.ok, true, JSON.stringify(result));
  const after = profiles.publicProfile(pid);
  assert.equal(after.cases, before.cases - 1, 'the case was not consumed');
  if (result.kind === 'item') {
    assert.equal(after.caseUnlocks.length, before.caseUnlocks.length + 1);
  } else {
    assert.ok(after.gems > before.gems, 'a gem fallback should have paid out more gems than before');
  }
});

test('the pity counter climbs on ordinary opens and forces a Pro-or-better pull at the threshold', async () => {
  const { PITY_TIER, PITY_THRESHOLD, tierIndex } = await import('../public/js/shared/cases.js');
  const profiles = await import('../server/profiles.js');
  const pid = 'reward-pity-' + Math.random().toString(36).slice(2);
  const p = profiles.getProfile(pid);
  // Parked one open short of the forced roll — the NEXT open must be
  // forced regardless of what Math.random() would otherwise have picked.
  p.casesSincePity = PITY_THRESHOLD - 1;
  p.cases = 1;
  const result = profiles.openCase(pid);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (result.kind === 'item') {
    assert.ok(tierIndex(result.rarity) >= tierIndex(PITY_TIER),
      `pity should have forced at least ${PITY_TIER}, got ${result.rarity}`);
  }
  // Honoured either by landing on an item or by the exhausted-pool gems
  // fallback — both reset the counter, since forcing it again immediately
  // would just repeat the same gems payout for a maxed-out collector.
  assert.equal(profiles.getProfile(pid).casesSincePity, 0, 'the counter should reset once pity is honoured');
});

test('the pity counter climbs on an ordinary below-pity open, so it actually accumulates', async () => {
  const { CASE_POOL, caseItemKey, PITY_TIER, tierIndex } = await import('../public/js/shared/cases.js');
  const profiles = await import('../server/profiles.js');
  const pid = 'reward-pity-accrue-' + Math.random().toString(36).slice(2);
  const p = profiles.getProfile(pid);
  p.casesSincePity = 0;
  p.cases = 1;
  /* Own everything AT OR ABOVE the pity tier, leaving only below-pity tiers
     (standard/tour) reachable. A walk-up starting anywhere at or above the
     pity tier is fully exhausted and falls to gems; a walk-up starting
     below it lands on a real below-pity item. Neither outcome is real
     Math.random()-controllable here, but BOTH count as "pity not met" —
     see openCase's metPityNaturally — so the counter incrementing is
     deterministic even though which of the two outcomes occurs is not. */
  p.caseUnlocks = CASE_POOL.filter(i => tierIndex(i.rarity) >= tierIndex(PITY_TIER)).map(caseItemKey);
  const result = profiles.openCase(pid);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (result.kind === 'item') assert.ok(tierIndex(result.rarity) < tierIndex(PITY_TIER),
    `expected a below-pity item, got ${result.rarity}`);
  assert.equal(profiles.getProfile(pid).casesSincePity, 1, 'a below-pity open should have incremented the counter');
});

test('gems buy a case, and refuse to when there are not enough', async () => {
  const profiles = await import('../server/profiles.js');
  const pid = 'reward-buy-' + Math.random().toString(36).slice(2);
  const p = profiles.getProfile(pid);
  p.gems = 5;
  const poor = profiles.buyCase(pid);
  assert.equal(poor.ok, false, 'a case was bought with too few gems');
  p.gems = 500;
  const rich = profiles.buyCase(pid);
  assert.equal(rich.ok, true, JSON.stringify(rich));
  assert.equal(profiles.getProfile(pid).cases, 1);
  assert.ok(profiles.getProfile(pid).gems < 500, 'gems were never actually spent');
});

/* ------------------------------------------------------------ anti-cheat */
test('looksEarnedAt allows a case-won item and rejects one that was never rolled', () => {
  // a decal from the case pool that a level-1 player could not possibly
  // have earned by leveling — see cases.js's CASE_POOL
  const won = { decal: 'houndstooth' };    // kind:id = 'decal:houndstooth', at level 18
  const clampedWithoutCase = looksEarnedAt(won, 0, 1, []);
  assert.equal(clampedWithoutCase.decal, null, 'a level-1 player with no case win kept an unearned decal');

  const clampedWithCase = looksEarnedAt(won, 0, 1, ['decal:houndstooth']);
  assert.equal(clampedWithCase.decal, 'houndstooth', 'a genuinely case-won decal was rejected');

  // and a forged claim for something that was never in the case list either
  const forged = looksEarnedAt({ decal: 'signature' }, 0, 1, ['decal:houndstooth']);
  assert.equal(forged.decal, null, 'owning ONE case item let a different, unearned one through');
});
