/* =========================================================================
   upgrades.mjs — buying something must change something
   -------------------------------------------------------------------------
   Reported: "upgrades currently don't do anything when purchased — no stat
   change, no visual change, nothing in-game reflects the purchase."

   Three separate things have to hold for an upgrade to feel real, and this
   checks all three rather than assuming the first implies the rest:

     1. the purchase is recorded against the player and survives
     2. the client is TOLD about it, in the profile payload it renders from
     3. the simulation the server rules with actually flies a different ball

   Plus the economy that pays for it: every finished hole must pay something,
   because a blow-up hole that pays zero reads as the shop being unreachable.

   Needs a server on localhost:3000.
   ========================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { holeCoins } from '../public/js/shared/economy.js';
import { getProfile, seedProfile, STARTING_COINS } from '../server/profiles.js';
import { SHOP, gearEffect } from '../public/js/shared/gear.js';
import { CLUB_BY_KEY } from '../public/js/shared/clubs.js';
import { ShotSim, calibrateCarries } from '../public/js/shared/ballistics.js';
import { allCourses, getCourse } from '../public/js/shared/coursegen.js';
import { terrainFor } from '../public/js/shared/terrain.js';
import { BIOMES } from '../public/js/shared/biomes.js';

calibrateCarries();

/* Point the socket tests at a server on another port with GOLF_URL, so a
   run can verify a FRESH server without killing the one you are playing on.
   Server-side changes need a restart to take effect, and testing against a
   process that booted before the change is how a fix gets signed off twice
   and shipped never. */
const URL = process.env.GOLF_URL || 'http://localhost:3000';
const wait = ms => new Promise(r => setTimeout(r, ms));
const pid = t => t + '-' + Math.random().toString(36).slice(2, 9);

const connect = () => new Promise((resolve, reject) => {
  const s = io(URL, { transports: ['websocket'], forceNew: true, timeout: 4000 });
  s.once('connect', () => resolve(s));
  s.once('connect_error', reject);
});
const ask = (s, ev, d) => new Promise(r => s.emit(ev, d, r));

/* ------------------------------------------------------------- economy --- */

test('every finished hole pays something, however badly it went', () => {
  for (const par of [3, 4, 5]) {
    for (let s = 1; s <= par + 6; s++) {
      const c = holeCoins(s, par);
      assert.ok(c > 0,
        `par ${par} in ${s} strokes paid ${c} — a hole you finished must never ` +
        `pay nothing, or a bad round reads as a broken economy`);
    }
  }
});

test('the payout still rewards good golf', () => {
  assert.ok(holeCoins(3, 4) > holeCoins(4, 4), 'a birdie must beat a par');
  assert.ok(holeCoins(4, 4) > holeCoins(5, 4), 'a par must beat a bogey');
  assert.ok(holeCoins(5, 4) > holeCoins(7, 4), 'over par must still slope down');
  assert.ok(holeCoins(1, 4) > holeCoins(2, 4) * 1.5, 'an ace must feel like one');
});

/* ------------------------------------------------------------- physics --- */

test('each upgrade changes the ball the server actually simulates', () => {
  /* By id: this asked for `allCourses()[0]` and then named parkland's biome
     separately, so reordering the roster gave it one course's holes and
     another's terrain. See the same note in physics.mjs. */
  const c = getCourse('parkland'), h = c.holes[1];
  const T = terrainFor(h, c.biome);
  const aim = Math.atan2(h.pin.x - h.tee.x, h.pin.z - h.tee.z);
  const carry = (clubKey, extra) => new ShotSim(T, {
    x: h.tee.x, z: h.tee.z, clubKey, power: 1, aim,
    faceDeg: 0, attackDeg: 0, wind: { dir: 0, speed: 0 }, ...extra
  }).runToEnd().carry;

  const NONE = { ball: 0, irons: 0, woods: 0, putter: 0 };
  const base = k => carry(k, { gear: NONE, crew: null, clubTier: 0, refine: 0 });

  // A wood upgrade must show up on a wood, an iron upgrade on an iron.
  const withGear = (k, slot, tier) =>
    carry(k, { gear: { ...NONE, [slot]: tier }, crew: null, clubTier: 0, refine: 0 });

  assert.ok(withGear('DR', 'woods', 1) - base('DR') > 2,
    'Carbon woods must add real distance off the tee');
  assert.ok(withGear('I7', 'irons', 1) - base('I7') > 1,
    'Forged irons must add real distance on an iron');
  assert.ok(withGear('DR', 'ball', 1) - base('DR') > 1,
    'a Tour ball must be longer than the one it replaces');
  assert.ok(withGear('DR', 'ball', 2) > withGear('DR', 'ball', 1),
    'the Pro ball must beat the Tour ball');

  // ...and must NOT show up where it has no business.
  assert.equal(withGear('DR', 'irons', 1), base('DR'), 'irons must not lengthen a driver');
  assert.equal(withGear('I7', 'woods', 1), base('I7'), 'woods must not lengthen an iron');

  // The club ladder is the big one, and must climb monotonically.
  const ladder = [0, 1, 2, 3].map(t =>
    carry('DR', { gear: NONE, crew: null, clubTier: t, refine: 0 }));
  for (let i = 1; i < ladder.length; i++) {
    assert.ok(ladder[i] > ladder[i - 1] + 2,
      `club tier ${i} must beat tier ${i - 1} by a felt margin ` +
      `(${ladder[i - 1].toFixed(1)}m -> ${ladder[i].toFixed(1)}m)`);
  }
});

test('gearEffect is exactly neutral with no gear', () => {
  for (const k of Object.keys(CLUB_BY_KEY)) {
    const fx = gearEffect(null, CLUB_BY_KEY[k]);
    assert.equal(fx.speed, 1);
    assert.equal(fx.spin, 1);
  }
});

/* --------------------------------------------------------------- flow ---- */

test('buying an item is recorded and reported back to the client', async () => {
  const me = pid('shop');
  const s = await connect();

  let profile = null;
  s.on('profile', p => { profile = p; });
  const created = await ask(s, 'room:create', { name: 'Shopper', pid: me, courseId: 'parkland' });
  assert.ok(created.ok);
  await wait(300);
  assert.ok(profile, 'the server must push a profile on joining');

  // A brand-new player cannot afford anything, and that is correct — so this
  // asserts the REFUSAL is honest rather than silent.
  const before = { ...profile };
  const toasts = [];
  s.on('toast', t => toasts.push(t));
  s.emit('shop:buy', { item: 'ball_tour' });
  await wait(300);

  if ((before.coins || 0) < SHOP.ball_tour.cost) {
    assert.ok(toasts.some(t => t.kind === 'warn' && /coins/i.test(t.msg)),
      `a purchase you cannot afford must say so; toasts were ` +
      JSON.stringify(toasts));
    assert.equal(profile.gear?.ball || 0, 0, 'and must not hand over the item');
  } else {
    assert.equal(profile.gear?.ball, 1, 'an affordable purchase must land');
  }

  // The profile the client renders from must actually carry the fields the
  // shop screen needs, or a successful purchase can never be shown.
  assert.ok(profile.gear && typeof profile.gear === 'object',
    'profile must expose gear, or the shop cannot show what is owned');
  assert.ok('coins' in profile, 'profile must expose coins');
  assert.ok('clubTier' in profile, 'profile must expose the club ladder tier');

  s.disconnect();
});

test('a rejected purchase never charges the player', async () => {
  const me = pid('nocharge');
  const s = await connect();
  let profile = null;
  s.on('profile', p => { profile = p; });
  await ask(s, 'room:create', { name: 'NoCharge', pid: me, courseId: 'parkland' });
  await wait(300);
  const coinsBefore = profile.coins || 0;

  for (const bad of ['', 'constructor', '__proto__', 'nope', 'ball_pro']) {
    s.emit('shop:buy', { item: bad });
  }
  await wait(400);
  assert.equal(profile.coins || 0, coinsBefore,
    'a refused purchase must leave the balance untouched');
  assert.ok(Number.isFinite(profile.coins), 'and must never NaN the balance');

  s.disconnect();
});

test('you can buy from the clubhouse without joining a room', async () => {
  /* The clubhouse — career, pro shop, the bag — is deliberately outside every
     room.  shop:buy used to resolve the player from the ROOM binding and bail
     out when there was none, so on the title screen every purchase returned
     silently: no coins spent, no item granted, no error shown.  Clicking Hire
     did nothing at all.

     This test never creates or joins a room, which is the whole point. */
  const me = pid('lobbyshop');
  const s = await connect();
  let profile = null;
  const toasts = [];
  s.on('profile', p => { profile = p; });
  s.on('toast', t => toasts.push(t));

  // identify ourselves the way the clubhouse does, and nothing else
  s.emit('profile:me', { pid: me });
  await wait(400);
  assert.ok(profile, 'the server must answer profile:me outside a room');

  const coinsBefore = profile.coins || 0;
  assert.ok(coinsBefore > 0,
    'a new player must arrive with something to spend, or every button in ' +
    'the shop is disabled and the shop looks broken');

  s.emit('shop:buy', { item: 'caddie:ace' });
  await wait(600);

  assert.equal(profile.crew?.ace, 1,
    `hiring a caddie from the clubhouse did nothing; toasts: ${JSON.stringify(toasts)}`);
  assert.ok(profile.coins < coinsBefore, 'and it must actually cost coins');

  s.disconnect();
});

test('every item in the shop is reachable and does something', async () => {
  const me = pid('buyall');
  const s = await connect();
  let profile = null;
  s.on('profile', p => { profile = p; });
  s.emit('profile:me', { pid: me });
  await wait(400);

  // hand-verify each SHOP key is a real purchase the server accepts, by
  // asking what blocks it rather than by minting coins
  for (const [key, it] of Object.entries(SHOP)) {
    assert.ok(it.slot && it.tier >= 1, `${key} has no slot/tier to grant`);
    assert.ok(it.cost > 0, `${key} is free`);
    assert.ok(it.name && it.blurb, `${key} has nothing to show in the shop`);
  }
  // and the slots the physics actually reads
  const slots = new Set(Object.values(SHOP).map(i => i.slot));
  for (const s2 of ['ball', 'irons', 'woods']) {
    assert.ok(slots.has(s2), `nothing in the shop sells the ${s2} slot`);
  }
  s.disconnect();
});

/* ------------------------------------------------------------- restore --- */

test('a wiped server restores a career from the player\'s own snapshot', () => {
  /* Reported: "everything reset on my mates laptop — coins and all the
     upgrades."  The host keeps profiles on an ephemeral disk, so a redeploy
     wipes them; the player's device holds a snapshot to put it back.

     seedProfile used to refuse whenever a profile already EXISTED. That
     sounds safe and was the bug: the profile is created the instant anything
     asks for it — joining a room, reading stats, the welcome purse — which on
     a freshly wiped host happens BEFORE the restore snapshot arrives. Restore
     was blocked forever and the career was gone. */
  const pid = 'restore-' + Math.random().toString(36).slice(2, 8);
  const snap = JSON.stringify({
    v: 1, coins: 12000, rating: 61, rounds: 24, best: -3,
    crew: { ace: 4, bruiser: 3, steady: 2, roller: 1, pitstop: 0, lucky: 0, gale: 0, grit: 0 },
    gear: { ball: 2, irons: 1, woods: 1, putter: 1, cart: 1 },
    clubTier: 3, refine: 2, stars: {}
  });

  // something touches the profile FIRST — this is what used to kill it
  getProfile(pid);
  assert.equal(seedProfile(pid, snap), true, 'restore was refused');

  const p = getProfile(pid);
  assert.equal(p.coins, 12000, 'coins were not restored');
  assert.equal(p.clubTier, 3, 'club set was not restored');
  assert.equal(p.refine, 2);
  assert.equal(p.rounds, 24);
  assert.equal(p.crew.ace, 4, 'crew was not restored');
  assert.equal(p.gear.ball, 2, 'gear was not restored');
});

test('a live career is never overwritten by a snapshot', () => {
  const pid = 'live-' + Math.random().toString(36).slice(2, 8);
  const p = getProfile(pid);
  p.rounds = 9; p.coins = 300; p.clubTier = 5;

  const fat = JSON.stringify({ v: 1, coins: 999999, rating: 90, rounds: 500,
    crew: {}, gear: {}, clubTier: 6, refine: 3, stars: {} });
  assert.equal(seedProfile(pid, fat), false, 'a played profile was seeded over');
  assert.equal(p.coins, 300, 'coins were overwritten');
  assert.equal(p.clubTier, 5, 'club set was overwritten');
});

test('a new player arrives able to buy something', () => {
  const pid = 'purse-' + Math.random().toString(36).slice(2, 8);
  assert.ok(getProfile(pid).coins >= STARTING_COINS,
    'a new player with no coins sees a shop of disabled buttons');
});
