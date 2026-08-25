/* =========================================================================
   marketplace.mjs — listings are the whole feature; this proves the
   escrow can't be gamed and the two-party buy is actually atomic
   -------------------------------------------------------------------------
   Direct-import tests exercise listItem/cancelListing/buyListing in this
   test process's own copy of profiles.js/marketplace.js (same pattern as
   rewards.mjs's buyUnlockDirect/sellUnlock tests) — fast, and doesn't need
   a live server for pure business-rule checks. The one thing that CAN'T be
   proven that way is the actual concurrency claim in buyListing's own
   comment, so the last test below goes over real sockets against the real
   running server instead, same shape as rewards.mjs's double-buy tests.
   ========================================================================= */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { io } from 'socket.io-client';

process.env.GOLF_DATA_DIR ||= '.test-data-marketplace';
const OWN_DATA_DIR = process.env.GOLF_DATA_DIR === '.test-data-marketplace';
if (OWN_DATA_DIR) after(() => rm('.test-data-marketplace', { recursive: true, force: true }).catch(() => {}));

const URL = process.env.GOLF_URL || 'http://localhost:3000';
const connect = () => new Promise((res, rej) => {
  const s = io(URL, { transports: ['websocket'], forceNew: true, timeout: 4000 });
  s.once('connect', () => res(s)); s.once('connect_error', rej);
});
const ask = (s, ev, d) => new Promise(r => { let f = 0; s.emit(ev, d, x => { f = 1; r(x); }); setTimeout(() => f || r(null), 3000); });
const identify = (s, pid, name) => new Promise(res => { s.once('profile', res); s.emit('profile:me', { pid, name }); });
const rid = p => p + '-' + Math.random().toString(36).slice(2);

test('listItem refuses an item the player does not own', async () => {
  const { CASE_POOL } = await import('../public/js/shared/cases.js');
  const profiles = await import('../server/profiles.js');
  const marketplace = await import('../server/marketplace.js');
  const item = CASE_POOL.find(i => i.kind === 'decal');
  const pid = rid('mkt-notowned');
  profiles.getProfile(pid);
  const result = marketplace.listItem(pid, item.kind, item.id, 1, 'Tester');
  assert.equal(result.ok, false, JSON.stringify(result));
});

test('listItem refuses an item the player\'s own level already grants', async () => {
  const { CASE_POOL, caseItemKey } = await import('../public/js/shared/cases.js');
  const profiles = await import('../server/profiles.js');
  const marketplace = await import('../server/marketplace.js');
  const item = CASE_POOL.find(i => i.kind === 'decal');
  const pid = rid('mkt-levelgrant');
  const p = profiles.getProfile(pid);
  p.xp = 999999999;   // max level — owns everything the ladder grants
  p.caseUnlocks = [caseItemKey(item)];
  const result = marketplace.listItem(pid, item.kind, item.id, 1, 'Tester');
  assert.equal(result.ok, false, JSON.stringify(result), 'listing something kept regardless via level is a free-money exploit');
  assert.ok(profiles.getProfile(pid).caseUnlocks.includes(caseItemKey(item)), 'a refused listing must not remove the item');
});

test('listItem refuses a price outside the grade-scaled bounds', async () => {
  const { CASE_POOL, caseItemKey } = await import('../public/js/shared/cases.js');
  const profiles = await import('../server/profiles.js');
  const marketplace = await import('../server/marketplace.js');
  const item = CASE_POOL.find(i => i.kind === 'decal');
  const pid = rid('mkt-badprice');
  const p = profiles.getProfile(pid);
  p.caseUnlocks = [caseItemKey(item)];
  const bounds = marketplace.priceBounds(item.kind, item.id, 0);
  const tooLow = marketplace.listItem(pid, item.kind, item.id, bounds.min - 1, 'Tester');
  assert.equal(tooLow.ok, false, JSON.stringify(tooLow));
  const tooHigh = marketplace.listItem(pid, item.kind, item.id, bounds.max + 1, 'Tester');
  assert.equal(tooHigh.ok, false, JSON.stringify(tooHigh));
  assert.ok(profiles.getProfile(pid).caseUnlocks.includes(caseItemKey(item)), 'a refused listing must not escrow the item');
});

test('a decal\'s listed price scales with its stored purity grade', async () => {
  const { CASE_POOL } = await import('../public/js/shared/cases.js');
  const marketplace = await import('../server/marketplace.js');
  const item = CASE_POOL.find(i => i.kind === 'decal');
  const raw = marketplace.marketValue(item.kind, item.id, 0);
  const flawless = marketplace.marketValue(item.kind, item.id, 100);
  assert.ok(flawless > raw, `a Flawless decal (${flawless}) should be worth more than a Raw one (${raw})`);
});

test('listItem escrows the item immediately — gone from caseUnlocks the instant it lists', async () => {
  const { CASE_POOL, caseItemKey } = await import('../public/js/shared/cases.js');
  const profiles = await import('../server/profiles.js');
  const marketplace = await import('../server/marketplace.js');
  const item = CASE_POOL.find(i => i.kind === 'decal');
  const pid = rid('mkt-escrow');
  const p = profiles.getProfile(pid);
  p.caseUnlocks = [caseItemKey(item)];
  p.decalPurity = { [item.id]: 60 };
  const fair = marketplace.priceBounds(item.kind, item.id, 60).fair;
  const result = marketplace.listItem(pid, item.kind, item.id, fair, 'Tester');
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.listing.purity, 60, 'the listing should carry the seller\'s actual purity, not a default');
  assert.ok(!profiles.getProfile(pid).caseUnlocks.includes(caseItemKey(item)), 'the item must leave caseUnlocks the moment it\'s listed');
});

test('cancelListing refuses a listing that is not the caller\'s, and returns one that is', async () => {
  const { CASE_POOL, caseItemKey } = await import('../public/js/shared/cases.js');
  const profiles = await import('../server/profiles.js');
  const marketplace = await import('../server/marketplace.js');
  const item = CASE_POOL.find(i => i.kind === 'decal');
  const seller = rid('mkt-cancel-seller');
  const other = rid('mkt-cancel-other');
  const p = profiles.getProfile(seller);
  p.caseUnlocks = [caseItemKey(item)];
  const fair = marketplace.priceBounds(item.kind, item.id, 0).fair;
  const listed = marketplace.listItem(seller, item.kind, item.id, fair, 'Seller');
  assert.equal(listed.ok, true, JSON.stringify(listed));

  profiles.getProfile(other);
  const wrongOwner = marketplace.cancelListing(other, listed.listing.id);
  assert.equal(wrongOwner.ok, false, JSON.stringify(wrongOwner));

  const cancelled = marketplace.cancelListing(seller, listed.listing.id);
  assert.equal(cancelled.ok, true, JSON.stringify(cancelled));
  assert.ok(profiles.getProfile(seller).caseUnlocks.includes(caseItemKey(item)), 'cancelling should return the item to the seller');
});

test('buyListing refuses self-purchase, an already-owned item, and insufficient gems', async () => {
  const { CASE_POOL, caseItemKey, DIRECT_BUY_GEMS } = await import('../public/js/shared/cases.js');
  const profiles = await import('../server/profiles.js');
  const marketplace = await import('../server/marketplace.js');
  const item = CASE_POOL.find(i => i.kind === 'ball');   // flat-priced kind, no purity to juggle
  const fair = marketplace.priceBounds(item.kind, item.id, 0).fair;

  const seller = rid('mkt-buy-seller');
  const sp = profiles.getProfile(seller);
  sp.caseUnlocks = [caseItemKey(item)];
  const listed = marketplace.listItem(seller, item.kind, item.id, fair, 'Seller');
  assert.equal(listed.ok, true, JSON.stringify(listed));

  const selfBuy = marketplace.buyListing(seller, listed.listing.id);
  assert.equal(selfBuy.ok, false, JSON.stringify(selfBuy), 'a seller must not be able to buy their own listing');

  const alreadyOwns = rid('mkt-buy-owns');
  const op = profiles.getProfile(alreadyOwns);
  op.gems = 999999;
  op.caseUnlocks = [caseItemKey(item)];
  const ownedResult = marketplace.buyListing(alreadyOwns, listed.listing.id);
  assert.equal(ownedResult.ok, false, JSON.stringify(ownedResult));

  const poor = rid('mkt-buy-poor');
  const pp = profiles.getProfile(poor);
  pp.gems = fair - 1;
  const poorResult = marketplace.buyListing(poor, listed.listing.id);
  assert.equal(poorResult.ok, false, JSON.stringify(poorResult));
  assert.equal(profiles.getProfile(poor).gems, fair - 1, 'a refused buy must not touch gems');
});

test('a successful buy moves gems both directions, transfers the item with its purity, and clears the listing', async () => {
  const { CASE_POOL, caseItemKey } = await import('../public/js/shared/cases.js');
  const profiles = await import('../server/profiles.js');
  const marketplace = await import('../server/marketplace.js');
  const item = CASE_POOL.find(i => i.kind === 'decal');

  const seller = rid('mkt-sale-seller');
  const sp = profiles.getProfile(seller);
  sp.gems = 0;
  sp.caseUnlocks = [caseItemKey(item)];
  sp.decalPurity = { [item.id]: 80 };
  const fair = marketplace.priceBounds(item.kind, item.id, 80).fair;
  const listed = marketplace.listItem(seller, item.kind, item.id, fair, 'Seller');
  assert.equal(listed.ok, true, JSON.stringify(listed));

  const buyer = rid('mkt-sale-buyer');
  const bp = profiles.getProfile(buyer);
  bp.gems = fair + 500;
  const bought = marketplace.buyListing(buyer, listed.listing.id);
  assert.equal(bought.ok, true, JSON.stringify(bought));
  assert.equal(bought.price, fair);

  assert.equal(profiles.getProfile(buyer).gems, 500, 'buyer should be charged exactly the listed price');
  assert.equal(profiles.getProfile(seller).gems, fair, 'seller should be credited exactly the listed price');
  assert.ok(profiles.getProfile(buyer).caseUnlocks.includes(caseItemKey(item)), 'the buyer should now own the item');
  assert.equal(profiles.getProfile(buyer).decalPurity[item.id], 80, 'the item\'s grade must travel with it, not reset');
  assert.equal(marketplace.allListings().find(l => l.id === listed.listing.id), undefined, 'a sold listing must disappear from Browse');
});

/* -------------------------------------------------------------- concurrency
   The one thing that can't be checked by calling functions directly: that
   this actually holds under real, near-simultaneous requests over the
   wire, not just "no await gap" reasoning about the source. Same shape as
   rewards.mjs's double-buy/double-open tests — two real sockets, one real
   listing, Promise.all, exactly one winner. */
test('firing two buys at once over the wire never sells the same listing twice', async () => {
  const { weeklyItemRotation, DIRECT_BUY_GEMS } = await import('../public/js/shared/cases.js');
  // cheapest item in this week's rotation, so both the seller's own
  // purchase and each buyer's debug:testcase grant (550 gems) comfortably
  // cover it regardless of which items happen to be in rotation this week
  const item = [...weeklyItemRotation()].sort((a, b) => DIRECT_BUY_GEMS[a.rarity] - DIRECT_BUY_GEMS[b.rarity])[0];

  const seller = await connect();
  const sellerPid = rid('mkt-wire-seller');
  await identify(seller, sellerPid, 'WireSeller');
  const funded = await ask(seller, 'debug:testcase', null);
  assert.equal(funded?.ok, true, 'debug:testcase is unavailable — is this server running with NODE_ENV=production?');
  const bought = await ask(seller, 'item:buy', { kind: item.kind, id: item.id });
  assert.equal(bought?.ok, true, JSON.stringify(bought));

  const marketplace = await import('../server/marketplace.js');
  const price = marketplace.priceBounds(item.kind, item.id, 0).min;   // cheapest legal ask, well within a 550-gem grant
  const listed = await ask(seller, 'market:list', { kind: item.kind, id: item.id, price });
  assert.equal(listed?.ok, true, JSON.stringify(listed));
  seller.disconnect();

  const buyerA = await connect();
  const buyerB = await connect();
  await identify(buyerA, rid('mkt-wire-buyerA'), 'WireBuyerA');
  await identify(buyerB, rid('mkt-wire-buyerB'), 'WireBuyerB');
  const [fundA, fundB] = await Promise.all([ask(buyerA, 'debug:testcase', null), ask(buyerB, 'debug:testcase', null)]);
  assert.equal(fundA?.ok, true); assert.equal(fundB?.ok, true);

  const [a, b] = await Promise.all([
    ask(buyerA, 'market:buy', { listingId: listed.listing.id }),
    ask(buyerB, 'market:buy', { listingId: listed.listing.id })
  ]);
  const oks = [a, b].filter(r => r?.ok).length;
  assert.equal(oks, 1, `expected exactly one of two simultaneous buys to succeed, got ${oks}. ${JSON.stringify({ a, b })}`);
  buyerA.disconnect(); buyerB.disconnect();
});
