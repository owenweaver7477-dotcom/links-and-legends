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

test('opening a fully-owned case polishes a decal instead of paying out gems, and never touches caseUnlocks', async () => {
  const { CASE_POOL, caseItemKey } = await import('../public/js/shared/cases.js');
  const profiles = await import('../server/profiles.js');
  const pid = 'reward-purity-' + Math.random().toString(36).slice(2);
  const p = profiles.getProfile(pid);
  p.cases = 1;
  p.caseUnlocks = CASE_POOL.map(caseItemKey);   // own literally everything
  const before = profiles.publicProfile(pid);
  const result = profiles.openCase(pid);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.kind, 'purity', JSON.stringify(result));
  const after = profiles.publicProfile(pid);
  assert.equal(after.caseUnlocks.length, before.caseUnlocks.length, 'a purity result should never add a caseUnlocks entry');
  assert.equal(after.decalPurity[result.item.id], result.newPurity);
  assert.equal(after.gems, before.gems, 'a purity result should not also pay out gems');
});

test('a second purity roll on the same decal adds to its existing purity rather than restarting it', async () => {
  const { CASE_POOL, caseItemKey } = await import('../public/js/shared/cases.js');
  const profiles = await import('../server/profiles.js');
  const pid = 'reward-purity-stack-' + Math.random().toString(36).slice(2);
  const p = profiles.getProfile(pid);
  const decals = CASE_POOL.filter(i => i.kind === 'decal');
  p.cases = 2;
  p.caseUnlocks = CASE_POOL.map(caseItemKey);
  // every decal but one already maxed, so both rolls are forced onto the
  // one left over — deterministic, not "whichever one happens to roll"
  p.decalPurity = Object.fromEntries(decals.slice(1).map(d => [d.id, 100]));
  const target = decals[0].id;

  const first = profiles.openCase(pid);
  assert.equal(first.kind, 'purity', JSON.stringify(first));
  assert.equal(first.item.id, target);
  const afterFirst = profiles.getProfile(pid).decalPurity[target];
  assert.equal(afterFirst, first.newPurity);

  const second = profiles.openCase(pid);
  assert.equal(second.kind, 'purity', JSON.stringify(second));
  assert.equal(second.item.id, target);
  assert.equal(profiles.getProfile(pid).decalPurity[target], second.newPurity);
  assert.ok(second.newPurity > afterFirst, 'a second roll on the same decal should have added to it, not reset it');
});

test('the Pro Case and the Vault also polish decals through the same fallback, once fully owned', async () => {
  const { CASE_POOL, caseItemKey } = await import('../public/js/shared/cases.js');
  const profiles = await import('../server/profiles.js');
  const allOwned = CASE_POOL.map(caseItemKey);

  const proPid = 'reward-purity-pro-' + Math.random().toString(36).slice(2);
  const proP = profiles.getProfile(proPid);
  proP.proCases = 1;
  proP.caseUnlocks = allOwned;
  const proResult = profiles.openProCase(proPid);
  assert.equal(proResult.kind, 'purity', JSON.stringify(proResult));
  assert.equal(profiles.getProfile(proPid).decalPurity[proResult.item.id], proResult.newPurity);

  const vaultPid = 'reward-purity-vault-' + Math.random().toString(36).slice(2);
  const vaultP = profiles.getProfile(vaultPid);
  vaultP.vaultCases = 1;
  vaultP.caseUnlocks = allOwned;
  const vaultResult = profiles.openVaultCase(vaultPid);
  assert.equal(vaultResult.kind, 'purity', JSON.stringify(vaultResult));
  assert.equal(profiles.getProfile(vaultPid).decalPurity[vaultResult.item.id], vaultResult.newPurity);
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

test('coins buy the standard case, and refuse to when there are not enough', async () => {
  const { CASE_COIN_COST } = await import('../public/js/shared/cases.js');
  const profiles = await import('../server/profiles.js');
  const pid = 'reward-buy-' + Math.random().toString(36).slice(2);
  const p = profiles.getProfile(pid);
  p.coins = 5;
  const poor = profiles.buyCase(pid);
  assert.equal(poor.ok, false, 'a case was bought with too few coins');
  p.coins = CASE_COIN_COST;
  const rich = profiles.buyCase(pid);
  assert.equal(rich.ok, true, JSON.stringify(rich));
  assert.equal(profiles.getProfile(pid).cases, 1);
  assert.equal(profiles.getProfile(pid).coins, 0, 'coins were never actually spent');
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

/* --------------------------------------------------------- the Pro Case */
test('a Pro case can only be opened when one is actually owned', async () => {
  const profiles = await import('../server/profiles.js');
  const pid = 'reward-procase-none-' + Math.random().toString(36).slice(2);
  const result = profiles.openProCase(pid);
  assert.equal(result.ok, false, 'a Pro case opened out of an empty inventory');
});

test('opening a Pro case always lands at or above PITY_TIER — the guarantee IS the product', async () => {
  const { PITY_TIER, tierIndex } = await import('../public/js/shared/cases.js');
  const profiles = await import('../server/profiles.js');
  const pid = 'reward-procase-open-' + Math.random().toString(36).slice(2);
  const p = profiles.getProfile(pid);
  p.proCases = 5;
  for (let i = 0; i < 5; i++) {
    const result = profiles.openProCase(pid);
    assert.equal(result.ok, true, JSON.stringify(result));
    if (result.kind === 'item') {
      assert.ok(tierIndex(result.rarity) >= tierIndex(PITY_TIER),
        `Pro case landed on ${result.rarity}, below its own floor`);
    }
    // 'gems' is still an acceptable outcome — it means every item at or
    // above the floor is already owned, not that the floor was skipped
  }
  assert.equal(profiles.getProfile(pid).proCases, 0, 'five opens should have consumed all five cases');
});

test('opening a Pro case does not touch the regular case\'s pity counter', async () => {
  const profiles = await import('../server/profiles.js');
  const pid = 'reward-procase-pity-' + Math.random().toString(36).slice(2);
  const p = profiles.getProfile(pid);
  p.proCases = 1;
  p.casesSincePity = 7;
  profiles.openProCase(pid);
  assert.equal(profiles.getProfile(pid).casesSincePity, 7,
    'a Pro case open changed the regular case\'s pity progress');
});

test('buying a Pro case costs gems and only gems — the premium currency, unlike the coin-priced regular case', async () => {
  const profiles = await import('../server/profiles.js');
  const pid = 'reward-procase-buy-' + Math.random().toString(36).slice(2);
  const p = profiles.getProfile(pid);
  p.gems = 100;
  const short = profiles.buyProCase(pid);
  assert.equal(short.ok, false, 'a Pro case was bought for fewer gems than it costs');
  p.gems = 500;
  const bought = profiles.buyProCase(pid);
  assert.equal(bought.ok, true, JSON.stringify(bought));
  assert.equal(profiles.getProfile(pid).proCases, 1);
  assert.ok(profiles.getProfile(pid).gems < 500, 'gems were not actually spent');
});

/* -------------------------------------------------------- the Vault Case,
   the middle rung between the coin-priced crate and the Pro Case's own
   floor. Same shape of tests as the Pro Case above — it's the same
   mechanism (rollCase's forcePity, now given a tier id instead of a bare
   boolean) at a different floor, so it should behave the same way. */
test('a Vault case can only be opened when one is actually owned', async () => {
  const profiles = await import('../server/profiles.js');
  const pid = 'reward-vault-none-' + Math.random().toString(36).slice(2);
  const result = profiles.openVaultCase(pid);
  assert.equal(result.ok, false, 'a Vault case opened out of an empty inventory');
});

test('opening a Vault case always lands at or above VAULT_TIER', async () => {
  const { VAULT_TIER, tierIndex } = await import('../public/js/shared/cases.js');
  const profiles = await import('../server/profiles.js');
  const pid = 'reward-vault-open-' + Math.random().toString(36).slice(2);
  const p = profiles.getProfile(pid);
  p.vaultCases = 5;
  for (let i = 0; i < 5; i++) {
    const result = profiles.openVaultCase(pid);
    assert.equal(result.ok, true, JSON.stringify(result));
    if (result.kind === 'item') {
      assert.ok(tierIndex(result.rarity) >= tierIndex(VAULT_TIER),
        `Vault case landed on ${result.rarity}, below its own floor`);
    }
  }
  assert.equal(profiles.getProfile(pid).vaultCases, 0, 'five opens should have consumed all five cases');
});

test('the Vault\'s floor is genuinely below the Pro Case\'s — a real middle rung, not a relabelled duplicate', async () => {
  const { VAULT_TIER, PITY_TIER, tierIndex } = await import('../public/js/shared/cases.js');
  assert.ok(tierIndex(VAULT_TIER) < tierIndex(PITY_TIER),
    `Vault floor (${VAULT_TIER}) is not below the Pro Case floor (${PITY_TIER})`);
});

test('opening a Vault case touches neither the regular case\'s pity counter nor Pro case inventory', async () => {
  const profiles = await import('../server/profiles.js');
  const pid = 'reward-vault-pity-' + Math.random().toString(36).slice(2);
  const p = profiles.getProfile(pid);
  p.vaultCases = 1;
  p.casesSincePity = 7;
  p.proCases = 3;
  profiles.openVaultCase(pid);
  assert.equal(profiles.getProfile(pid).casesSincePity, 7,
    'a Vault case open changed the regular case\'s pity progress');
  assert.equal(profiles.getProfile(pid).proCases, 3,
    'a Vault case open touched the separate Pro case inventory');
});

test('buying a Vault case costs gems, at its own price — not the Pro Case\'s', async () => {
  const { VAULT_GEM_COST, PRO_CASE_GEM_COST } = await import('../public/js/shared/cases.js');
  const profiles = await import('../server/profiles.js');
  const pid = 'reward-vault-buy-' + Math.random().toString(36).slice(2);
  const p = profiles.getProfile(pid);
  assert.ok(VAULT_GEM_COST < PRO_CASE_GEM_COST, 'the Vault should cost less than the Pro Case, not the same or more');
  p.gems = VAULT_GEM_COST - 1;
  const short = profiles.buyVaultCase(pid);
  assert.equal(short.ok, false, 'a Vault case was bought for fewer gems than it costs');
  p.gems = VAULT_GEM_COST;
  const bought = profiles.buyVaultCase(pid);
  assert.equal(bought.ok, true, JSON.stringify(bought));
  assert.equal(profiles.getProfile(pid).vaultCases, 1);
  assert.equal(profiles.getProfile(pid).gems, 0, 'gems were not spent for exactly the cost');
});

/* ------------------------------------------------------- double-spend ---
   The concern: a double-click, or a client that fires the same socket
   event twice before the first ack lands, buying (or opening) two cases
   for the price of one. Node's event loop is single-threaded and neither
   buyCase/buyVaultCase/buyProCase nor their socket handlers have an
   `await` anywhere between reading the balance and writing the debit —
   see profiles.js's own functions — so there is no gap for a second,
   near-simultaneous request to land IN. Whichever request's handler the
   event loop picks up first runs to completion, balance and all, before
   the second one even starts reading it. That's not a defence that could
   fail under load; it's a property of how the language executes
   synchronous code. This proves it against the real running server, over
   real sockets, rather than trusting the reasoning. */
test('firing two buys at once over the wire never buys two cases for the price of one', async () => {
  const { CASE_COIN_COST } = await import('../public/js/shared/cases.js');
  const s = await connect();
  const pid = 'reward-dblbuy-' + Math.random().toString(36).slice(2);
  await identify(s, pid, 'Doubler');
  // exactly enough for ONE crate — funded over the wire via the same
  // DEV-only hook the ?testcase debug mode uses, not by reaching into the
  // server's memory from this process (a separate process; see
  // tools/test-server.mjs)
  const funded = await ask(s, 'debug:testcase', null);
  assert.equal(funded?.ok, true, 'debug:testcase is unavailable — is this server running with NODE_ENV=production?');
  assert.ok(funded.coins >= CASE_COIN_COST);

  const [a, b] = await Promise.all([ask(s, 'case:buy', null), ask(s, 'case:buy', null)]);
  const oks = [a, b].filter(r => r?.ok).length;
  assert.equal(oks, 1, `expected exactly one of two simultaneous buys to succeed, got ${oks}. ${JSON.stringify({ a, b })}`);
  s.disconnect();
});

test('firing two opens at once over the wire never opens the same single case twice', async () => {
  const s = await connect();
  const pid = 'reward-dblopen-' + Math.random().toString(36).slice(2);
  await identify(s, pid, 'DoubleOpener');
  const funded = await ask(s, 'debug:testcase', null);
  assert.equal(funded?.ok, true, 'debug:testcase is unavailable — is this server running with NODE_ENV=production?');
  const bought = await ask(s, 'case:buy', null);
  assert.equal(bought?.ok, true, JSON.stringify(bought));
  assert.equal(bought.cases, 1, 'expected exactly one case in inventory before the double-open attempt');

  const [a, b] = await Promise.all([ask(s, 'case:open', null), ask(s, 'case:open', null)]);
  const oks = [a, b].filter(r => r?.ok).length;
  assert.equal(oks, 1, `expected exactly one of two simultaneous opens to succeed, got ${oks}. ${JSON.stringify({ a, b })}`);
  s.disconnect();
});

/* ---- buying and selling a specific item outright, rather than rolling
   for it — the Items shop tab and the Inventory page's Sell action. ---- */
test('buyUnlockDirect refuses when gems are short, and never charges a failed attempt', async () => {
  const { CASE_POOL, DIRECT_BUY_GEMS } = await import('../public/js/shared/cases.js');
  const profiles = await import('../server/profiles.js');
  const item = CASE_POOL.find(i => i.kind === 'decal');
  const pid = 'reward-directbuy-poor-' + Math.random().toString(36).slice(2);
  const p = profiles.getProfile(pid);
  p.gems = DIRECT_BUY_GEMS[item.rarity] - 1;
  const result = profiles.buyUnlockDirect(pid, item.kind, item.id);
  assert.equal(result.ok, false);
  assert.equal(profiles.getProfile(pid).gems, DIRECT_BUY_GEMS[item.rarity] - 1, 'a failed buy should not touch gems');
  assert.equal((profiles.getProfile(pid).caseUnlocks || []).length, 0);
});

test('buyUnlockDirect refuses an item the player already owns, whether by level or by a previous case', async () => {
  const { CASE_POOL, DIRECT_BUY_GEMS, caseItemKey } = await import('../public/js/shared/cases.js');
  const profiles = await import('../server/profiles.js');
  const item = CASE_POOL.find(i => i.kind === 'decal');

  const byLevel = 'reward-directbuy-lvl-' + Math.random().toString(36).slice(2);
  const p1 = profiles.getProfile(byLevel);
  p1.xp = 999999999;   // max level — owns everything the ladder grants
  p1.gems = 999999;
  const r1 = profiles.buyUnlockDirect(byLevel, item.kind, item.id);
  assert.equal(r1.ok, false, JSON.stringify(r1));

  const byCase = 'reward-directbuy-case-' + Math.random().toString(36).slice(2);
  const p2 = profiles.getProfile(byCase);
  p2.gems = 999999;
  p2.caseUnlocks = [caseItemKey(item)];
  const r2 = profiles.buyUnlockDirect(byCase, item.kind, item.id);
  assert.equal(r2.ok, false, JSON.stringify(r2));
});

test('buyUnlockDirect succeeds, deducts the exact rarity-scaled price, and writes caseUnlocks', async () => {
  const { CASE_POOL, DIRECT_BUY_GEMS, caseItemKey } = await import('../public/js/shared/cases.js');
  const profiles = await import('../server/profiles.js');
  const item = CASE_POOL.find(i => i.kind === 'decal');
  const cost = DIRECT_BUY_GEMS[item.rarity];
  const pid = 'reward-directbuy-ok-' + Math.random().toString(36).slice(2);
  const p = profiles.getProfile(pid);
  p.gems = cost + 500;
  const result = profiles.buyUnlockDirect(pid, item.kind, item.id);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.cost, cost);
  const after = profiles.getProfile(pid);
  assert.equal(after.gems, 500);
  assert.ok(after.caseUnlocks.includes(caseItemKey(item)));
});

test('sellUnlock refuses an item not owned, and one the player\'s own level already grants', async () => {
  const { CASE_POOL, caseItemKey } = await import('../public/js/shared/cases.js');
  const profiles = await import('../server/profiles.js');
  const item = CASE_POOL.find(i => i.kind === 'decal');

  const notOwned = 'reward-sell-none-' + Math.random().toString(36).slice(2);
  profiles.getProfile(notOwned);
  const r1 = profiles.sellUnlock(notOwned, item.kind, item.id);
  assert.equal(r1.ok, false, JSON.stringify(r1));

  const grantedByLevel = 'reward-sell-lvl-' + Math.random().toString(36).slice(2);
  const p = profiles.getProfile(grantedByLevel);
  p.xp = 999999999;
  p.caseUnlocks = [caseItemKey(item)];   // also happens to be in caseUnlocks, e.g. levelled past a case win
  const r2 = profiles.sellUnlock(grantedByLevel, item.kind, item.id);
  assert.equal(r2.ok, false, JSON.stringify(r2), 'selling something the player keeps regardless via level is a free-money exploit');
  assert.ok(profiles.getProfile(grantedByLevel).caseUnlocks.includes(caseItemKey(item)), 'a refused sell must not remove the item');
});

test('sellUnlock succeeds for a case-only item, removes it and credits half the buy price', async () => {
  const { CASE_POOL, DIRECT_BUY_GEMS, caseItemKey } = await import('../public/js/shared/cases.js');
  const profiles = await import('../server/profiles.js');
  const item = CASE_POOL.find(i => i.kind === 'decal');
  const pid = 'reward-sell-ok-' + Math.random().toString(36).slice(2);
  const p = profiles.getProfile(pid);
  p.gems = 0;
  p.caseUnlocks = [caseItemKey(item)];
  const result = profiles.sellUnlock(pid, item.kind, item.id);
  assert.equal(result.ok, true, JSON.stringify(result));
  const expectedPayout = Math.round(DIRECT_BUY_GEMS[item.rarity] / 2);
  assert.equal(result.payout, expectedPayout);
  const after = profiles.getProfile(pid);
  assert.equal(after.gems, expectedPayout);
  assert.ok(!after.caseUnlocks.includes(caseItemKey(item)));
});
