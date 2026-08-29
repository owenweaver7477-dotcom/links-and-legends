/* =========================================================================
   gems.mjs — the currency the game never paid you for
   -------------------------------------------------------------------------
   Gems had three sources and none of them was PLAYING: the daily login
   table, duplicate compensation from a case, and selling an item back. So
   somebody who played twenty rounds a day and did not happen to log in on
   the right day earned nothing, and the only currency that buys cases was
   the one the game never rewarded you for having.

   These tests hold the shape of the fix rather than its exact numbers,
   except where a number IS the design — a bogey paying zero is the whole
   reason gems feel different from coins, and the flat finishing bonus being
   most of a round's payout is what stops the system rewarding somebody for
   walking off after the two holes they parred.
   ========================================================================= */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { holeGems, roundGems, ROUND_GEMS, FIRST_CLEAR_GEMS,
         MILESTONES, milestoneRung, milestoneState,
         holeCoins } from '../public/js/shared/economy.js';
import { rewardFor, CYCLE_LENGTH } from '../public/js/shared/loginrewards.js';

process.env.GOLF_DATA_DIR ||= '.test-data-gems';
const OWN = process.env.GOLF_DATA_DIR === '.test-data-gems';
if (OWN) after(() => rm('.test-data-gems', { recursive: true, force: true }).catch(() => {}));

const rid = p => p + '-' + Math.random().toString(36).slice(2);
const par9 = (rel = 0) => Array.from({ length: 9 }, (_, i) =>
  ({ strokes: 4 + (i === 0 ? rel : 0), par: 4 }));

/* ------------------------------------------------------------- the ladder -- */

test('gems reward golf, where coins reward showing up', () => {
  /* The difference between the two currencies, stated as an assertion. A
     bogey still pays coins — a bad round reading as "the economy is broken"
     is worse than a penalty — and pays no gems at all. */
  assert.ok(holeCoins(5, 4) > 0, 'a bogey should still pay coins');
  assert.equal(holeGems(5, 4), 0, 'a bogey must pay no gems — that is the whole distinction');
  assert.equal(holeGems(9, 4), 0);
  assert.equal(holeGems(4, 4), 1, 'a par is worth exactly one');
  assert.equal(holeGems(3, 4), 3);
  assert.equal(holeGems(2, 4), 5);
  assert.equal(holeGems(1, 4), 10, 'an ace is the once-a-year one');
  assert.equal(holeGems(1, 3), 10, 'an ace is an ace whatever the par');
});

test('the ladder only ever climbs', () => {
  let last = -1;
  for (let strokes = 8; strokes >= 1; strokes--) {
    const g = holeGems(strokes, 5);
    assert.ok(g >= last, `${strokes} on a par 5 pays ${g}, worse than the score above it`);
    last = g;
  }
});

test('a malformed hole pays nothing rather than NaN', () => {
  for (const [s, p] of [[0, 4], [4, 0], [-1, 4], [NaN, 4], [4, NaN], [null, null]]) {
    assert.equal(holeGems(s, p), 0, `holeGems(${s}, ${p}) is not 0`);
  }
});

/* ------------------------------------------------------------- the round -- */

test('finishing is most of the payout, and abandoning gets none of it', () => {
  /* The load-bearing one. A per-hole trickle with no finishing bonus would
     pay a player for walking off after the two holes they parred, which is
     rewarding exactly the wrong behaviour. */
  const full = roundGems(par9(), { full: true });
  const quit = roundGems(par9().slice(0, 3), { full: false });
  assert.equal(full.finish, ROUND_GEMS);
  assert.equal(quit.finish, 0, 'an abandoned round collected the finishing bonus');
  assert.ok(full.finish > full.holes,
    `finishing pays ${full.finish} against ${full.holes} for the holes — the bonus has to ` +
    'be the bulk of it or quitting early is worth doing');
  assert.equal(roundGems([], { full: true }).total, 0, 'no holes, no gems');
});

test('a first clear pays extra, and only on a round you finished', () => {
  const first = roundGems(par9(), { full: true, firstClear: true });
  const again = roundGems(par9(), { full: true, firstClear: false });
  assert.equal(first.total - again.total, FIRST_CLEAR_GEMS);
  assert.equal(roundGems(par9().slice(0, 4), { full: false, firstClear: true }).firstClear, 0,
    'an abandoned round claimed a first clear');
});

test('difficulty scales the whole payout, not the per-hole part', () => {
  /* Paying more on a harder setting is a claim about the ROUND being harder
     to finish. "Your birdie is worth less than theirs" is a different and
     worse claim. */
  const base = roundGems(par9(), { full: true });
  const hard = roundGems(par9(), { full: true, earnMult: 1.5 });
  assert.equal(hard.holes, base.holes, 'the per-hole gems moved with the difficulty');
  assert.equal(hard.total, Math.round(base.total * 1.5));
  // and a nonsense multiplier is ignored rather than zeroing somebody's round
  for (const bad of [0, -2, NaN, null, undefined, 'lots']) {
    assert.equal(roundGems(par9(), { full: true, earnMult: bad }).total, base.total,
      `earnMult ${bad} changed the payout`);
  }
});

test('a round is worth a real fraction of a Club Case', async () => {
  /* The whole point of the rebalance: the chase has to be one a player can
     see the end of. Before this, playing paid zero gems and a 600-gem case
     was unreachable except by logging in for a fortnight. */
  const { CLUB_CASE_GEM_COST, SET_CRATE_GEM_COST } = await import('../public/js/shared/clubsets.js');
  const perRound = roundGems(par9(), { full: true }).total;
  const rounds = CLUB_CASE_GEM_COST / perRound;
  assert.ok(rounds >= 5 && rounds <= 20,
    `a Club Case is ${rounds.toFixed(1)} rounds of play — under 5 is no chase at all, ` +
    'over 20 is the stagnation this replaced');
  // and the Set Crate stays the deliberate long haul it was designed as
  assert.ok(SET_CRATE_GEM_COST / perRound > 100,
    'the Set Crate is no longer the long haul it is priced as');
});

/* --------------------------------------------------------- the milestones -- */

test('every milestone is repeatable, and gets harder without paying flat', () => {
  for (const m of MILESTONES) {
    const rungs = [0, 1, 2, 5, 12].map(n => milestoneRung(m, n));
    for (let i = 1; i < rungs.length; i++) {
      assert.ok(rungs[i].target > rungs[i - 1].target,
        `${m.id} tier ${rungs[i].tier} is not harder than the one before it`);
      assert.ok(rungs[i].gems > rungs[i - 1].gems,
        `${m.id} tier ${rungs[i].tier} pays no more than the one before it`);
    }
    /* Rewards must grow SLOWER than targets. Equal growth is a treadmill
       that pays the same rate forever; faster growth eventually pays more
       than the game can afford. */
    const rateFirst = rungs[0].gems / rungs[0].target;
    const rateLate = rungs.at(-1).gems / rungs.at(-1).target;
    assert.ok(rateLate < rateFirst,
      `${m.id} pays ${rateLate.toFixed(2)} gems per unit at tier ${rungs.at(-1).tier} against ` +
      `${rateFirst.toFixed(2)} at tier 1 — a ladder that pays the same rate forever is a treadmill`);
  }
});

test('milestone state says what is claimable and how far off the rest are', () => {
  const counters = { fairways: 7, pars: 1, birdies: 40, rounds: 0, gir: 15, courses: 2 };
  const st = milestoneState(counters, { birdies: 2 });
  const by = Object.fromEntries(st.map(m => [m.id, m]));
  assert.equal(by.fairways.claimable, true, '7 in a row should clear a target of 5');
  assert.equal(by.pars.claimable, false);
  assert.equal(by.gir.claimable, true, 'exactly on target must count');
  assert.equal(by.rounds.have, 0);
  assert.ok(by.pars.pct > 0 && by.pars.pct < 1);
  assert.equal(by.birdies.tier, 3, 'two claims should put you on tier three');
});

/* -------------------------------------------------------------- the server -- */

test('a claim pays once, then moves the target', async () => {
  const { getProfile, claimMilestone, milestonesFor } = await import('../server/profiles.js');
  const pid = rid('gem-claim');
  const p = getProfile(pid);
  p.runs = { fairway: 0, fairwayBest: 6, par: 0, parBest: 0 };
  p.gems = 0;

  const first = claimMilestone(pid, 'fairways');
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(getProfile(pid).gems, first.gems);

  const second = claimMilestone(pid, 'fairways');
  assert.equal(second.ok, false, 'the same rung paid twice');
  assert.equal(getProfile(pid).gems, first.gems, 'a refused claim moved the balance');

  const st = milestonesFor(pid).find(m => m.id === 'fairways');
  assert.equal(st.tier, 2);
  assert.ok(st.target > 6, 'the target did not move past what was already achieved');
});

test('a milestone that has not been reached pays nothing', async () => {
  const { getProfile, claimMilestone } = await import('../server/profiles.js');
  const pid = rid('gem-early');
  const p = getProfile(pid);
  p.gems = 0; p.birdies = 1;
  const r = claimMilestone(pid, 'birdies');
  assert.equal(r.ok, false);
  assert.equal(getProfile(pid).gems, 0);
  assert.equal(claimMilestone(pid, 'not-a-milestone').ok, false);
  assert.equal(claimMilestone(pid, null).ok, false);
  assert.equal(getProfile(pid).gems, 0, 'a junk id moved the balance');
});

test('a run survives the end of a round, because a milestone asks "ever"', async () => {
  const { getProfile, recordHole } = await import('../server/profiles.js');
  const pid = rid('gem-runs');
  getProfile(pid);
  // four fairways, then a par 3 with no fairway to hit, then two more
  for (const hit of [true, true, true, true]) recordHole(pid, { strokes: 4, par: 4, putts: 2, fairwayHit: hit, gir: false });
  recordHole(pid, { strokes: 3, par: 3, putts: 2, fairwayHit: null, gir: true });
  for (const hit of [true, true]) recordHole(pid, { strokes: 4, par: 4, putts: 2, fairwayHit: hit, gir: false });
  const p = getProfile(pid);
  assert.equal(p.runs.fairway, 6,
    'a par 3 broke a fairway streak — you cannot miss a fairway that was never offered');
  assert.equal(p.runs.fairwayBest, 6);

  recordHole(pid, { strokes: 5, par: 4, putts: 2, fairwayHit: false, gir: false });
  assert.equal(getProfile(pid).runs.fairway, 0, 'a missed fairway did not break the run');
  assert.equal(getProfile(pid).runs.fairwayBest, 6, 'the record was lost when the run broke');
});

test('the round pays gems into the balance, once', async () => {
  const { getProfile, settleRound } = await import('../server/profiles.js');
  const pid = rid('gem-settle');
  const p = getProfile(pid);
  p.gems = 0;
  const rc = settleRound(pid, 'parkland', par9(), 1);
  assert.ok(rc.gems.total > 0, 'a finished round paid no gems');
  assert.equal(getProfile(pid).gems, rc.gems.total);
  assert.ok(rc.gems.firstClear > 0, 'a course never cleared before paid no first-clear bonus');

  const again = settleRound(pid, 'parkland', par9(), 1);
  assert.equal(again.gems.firstClear, 0, 'the first clear paid twice');
  assert.equal(getProfile(pid).gems, rc.gems.total + again.gems.total);
});

/* ----------------------------------------------------------- login streak -- */

test('every day of the streak is worth coming back for', () => {
  /* A day paying nothing but 150 coins — a rounding error against a round's
     ~7,500 — was a day the streak asked you to return for nothing. */
  for (let d = 1; d <= CYCLE_LENGTH; d++) {
    const r = rewardFor(d, 1);
    assert.ok((r.gems || 0) > 0 || r.cases,
      `day ${d} pays ${JSON.stringify(r)} — nothing anybody would come back for`);
  }
});

test('the streak is a bonus on top of playing, never a substitute for it', () => {
  let cycleGems = 0;
  for (let d = 1; d <= CYCLE_LENGTH; d++) cycleGems += rewardFor(d, 1).gems || 0;
  const playing = roundGems(par9(), { full: true }).total * CYCLE_LENGTH;
  assert.ok(cycleGems < playing,
    `a fortnight of logging in pays ${cycleGems} against ${playing} for playing one round a ` +
    'day — the streak must never out-earn the game');
  assert.ok(cycleGems > playing * 0.25,
    `a fortnight of logging in pays ${cycleGems} against ${playing} — too small a fraction ` +
    'to be worth the streak');
});

/* =========================================================================
   THE SHOP — grades and upgrade previews
   ------------------------------------------------------------------------- */

test('every shop item carries a grade, on the game\'s own ladder', async () => {
  /* One vocabulary. The game already grades cases, club sets and decals as
     standard/tour/pro/legend/mythic; inventing a second set of words for
     the shop would mean a player learning which screen says "Epic" and
     which says "Pro" for the same idea. */
  const { SHOP, GEAR_RARITY_ORDER } = await import('../public/js/shared/gear.js');
  const { RARITIES } = await import('../public/js/shared/cases.js');
  const known = new Set(RARITIES.map(r => r.id));
  assert.deepEqual(GEAR_RARITY_ORDER, RARITIES.map(r => r.id),
    'the shop ranks rarities differently from the case system');
  for (const [key, it] of Object.entries(SHOP)) {
    assert.ok(known.has(it.rarity), `"${key}" has grade "${it.rarity}", which is not one the game uses`);
  }
});

test('gear tops out below the club sets, which are the actual chase', async () => {
  /* A shop that sold a Mythic anything for coins would flatten the thing
     cases exist for. */
  const { SHOP, GEAR_RARITY_ORDER } = await import('../public/js/shared/gear.js');
  const rank = r => GEAR_RARITY_ORDER.indexOf(r);
  const best = Math.max(...Object.values(SHOP).map(it => rank(it.rarity)));
  assert.ok(best <= rank('pro'),
    `the coin shop sells a ${GEAR_RARITY_ORDER[best]} item — the top two rungs belong to ` +
    'the club sets, which come from a case');
});

test('what a gear card promises is what the simulation does', async () => {
  /* `gains` is authored text on a card and `gearEffect` is what the server
     runs. They are two statements of one fact, which is exactly the shape
     of thing that drifts. */
  const { SHOP, gearEffect } = await import('../public/js/shared/gear.js');
  const pct = s => {
    const m = String(s).match(/([+-]?[\d.]+)%/);
    return m ? Number(m[1]) : null;
  };
  const iron = { type: 'iron' }, wood = { type: 'wood' };

  const ballOne = gearEffect({ ball: 1 }, iron);
  assert.equal(pct(SHOP.ball_tour.gains.find(g => g[0] === 'Ball speed')[1]),
    Math.round((ballOne.speed - 1) * 1000) / 10);
  assert.equal(pct(SHOP.ball_tour.gains.find(g => g[0] === 'Spin')[1]),
    Math.round((ballOne.spin - 1) * 100));

  const ballTwo = gearEffect({ ball: 2 }, iron);
  assert.equal(pct(SHOP.ball_pro.gains.find(g => g[0] === 'Ball speed')[1]),
    Math.round((ballTwo.speed - 1) * 100), 'the Pro ball card and the simulation disagree');
  assert.equal(pct(SHOP.ball_pro.gains.find(g => g[0] === 'Spin')[1]),
    Math.round((ballTwo.spin - 1) * 100));

  assert.equal(pct(SHOP.irons_plus.gains[0][1]),
    Math.round((gearEffect({ irons: 1 }, iron).speed - 1) * 1000) / 10);
  assert.equal(pct(SHOP.woods_plus.gains[0][1]),
    Math.round((gearEffect({ woods: 1 }, wood).speed - 1) * 1000) / 10);
});

test('a caddie grade is a readout of investment, not a label', async () => {
  const { caddieGrade, CADDIE_MAX, CADDIE_KEYS } = await import('../public/js/shared/crew.js');
  const { RARITIES } = await import('../public/js/shared/cases.js');
  const order = RARITIES.map(r => r.id);
  let last = -1;
  for (let l = 0; l <= CADDIE_MAX; l++) {
    const i = order.indexOf(caddieGrade(l));
    assert.ok(i >= 0, `level ${l} grades as something the game does not recognise`);
    assert.ok(i >= last, `level ${l} grades LOWER than level ${l - 1}`);
    last = i;
  }
  assert.equal(caddieGrade(0), 'standard', 'a fresh hire should be the bottom rung');
  assert.equal(caddieGrade(CADDIE_MAX), 'mythic', 'a maxed caddie should be the top rung');
  // and it is level, not identity — eight identical ladders
  for (const k of CADDIE_KEYS) assert.equal(caddieGrade(5), 'pro');
});

test('an upgrade says what it buys before the money is spent', async () => {
  /* "Level up · 1,200 coins" asks somebody to spend a fifth of a round's
     earnings on a number they cannot see. */
  const { caddiePreview, CADDIES, CADDIE_MAX } = await import('../public/js/shared/crew.js');
  for (const key of Object.keys(CADDIES)) {
    const fresh = caddiePreview(key, 0);
    assert.ok(fresh, `${key} has no preview at level 0`);
    assert.equal(fresh.from, null, 'a caddie not yet hired should have nothing to compare against');
    assert.ok(fresh.to && fresh.to.length, `${key} cannot describe what hiring it does`);
    assert.equal(fresh.level, 1);
    assert.ok(fresh.cost > 0);

    const mid = caddiePreview(key, 4);
    assert.ok(mid.from && mid.to, `${key} shows no before/after mid-ladder`);
    assert.notEqual(mid.from, mid.to,
      `${key} levelling from 4 to 5 shows the same line twice — the delta is the point`);

    assert.equal(caddiePreview(key, CADDIE_MAX), null, 'a maxed caddie previewed a level that does not exist');
  }
  assert.equal(caddiePreview('not-a-caddie', 0), null);
});
