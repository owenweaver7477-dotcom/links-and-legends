/* =========================================================================
   mastery.mjs — mastery counts shots and buys nothing
   -------------------------------------------------------------------------
   Two claims, and the second one is the important one.

   It ACCRUES on real shots — server-side, off a shot the server itself
   simulated, so it records what happened rather than what a client said.

   And it stays PRESTIGE. Club sets are already the one place power comes
   from a case; if time-in-game became a third source of distance, on top of
   rarity and on top of collection, a player who has hit ten thousand 7 irons
   would out-drive one who has not and equipment would stop being a choice.
   The no-power rule in xp.mjs guards the rank table itself; this file guards
   the other end — that the number the server keeps never reaches a shot.
   ========================================================================= */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { masteryRank, totalShots, topClubs, MASTERY_RANKS } from '../public/js/shared/mastery.js';

process.env.GOLF_DATA_DIR ||= '.test-data-mastery';
const OWN = process.env.GOLF_DATA_DIR === '.test-data-mastery';
if (OWN) after(() => rm('.test-data-mastery', { recursive: true, force: true }).catch(() => {}));

const rid = p => p + '-' + Math.random().toString(36).slice(2);

test('a shot is counted against the exact club that hit it', async () => {
  const { getProfile, recordShot } = await import('../server/profiles.js');
  const pid = rid('mast-count');
  getProfile(pid);

  for (let i = 0; i < 30; i++) recordShot(pid, 'I7');
  for (let i = 0; i < 4; i++) recordShot(pid, 'DR');

  const p = getProfile(pid);
  assert.equal(p.mastery.I7, 30);
  assert.equal(p.mastery.DR, 4);
  assert.equal(p.mastery.PT, undefined, 'a club never swung must not appear at all');
  assert.equal(totalShots(p.mastery), 34);
});

test('a swing with no club named is ignored rather than counted as ""', async () => {
  const { getProfile, recordShot } = await import('../server/profiles.js');
  const pid = rid('mast-null');
  getProfile(pid);
  recordShot(pid, null);
  recordShot(pid, undefined);
  recordShot(pid, '');
  assert.deepEqual(getProfile(pid).mastery, {}, 'a malformed swing wrote a mastery key');
});

test('ranks arrive in order and the last one is reachable but rare', () => {
  let last = -1;
  for (const r of MASTERY_RANKS) {
    assert.ok(r.at > last, `rank thresholds must ascend: ${r.name} at ${r.at}`);
    last = r.at;
    assert.equal(masteryRank(r.at).name, r.name, `${r.at} shots should read as ${r.name}`);
    assert.equal(masteryRank(r.at - 1).name === r.name, false || r.at === 0,
      `${r.at - 1} shots should not already be ${r.name}`);
  }
  // the first rank inside a round or two, so the system announces itself
  assert.ok(MASTERY_RANKS[1].at <= 40, 'the first rank is too far away to be noticed');
  // and the top one at a count nobody reaches by accident
  assert.ok(MASTERY_RANKS.at(-1).at >= 2000, 'the top rank is too cheap to mean anything');
  assert.equal(masteryRank(MASTERY_RANKS.at(-1).at).next, null, 'the top rank must be the top');
  assert.equal(masteryRank(999999).pct, 1);
});

test('progress into the next rank is measured from the current one', () => {
  const a = MASTERY_RANKS[2].at, b = MASTERY_RANKS[3].at;
  const half = masteryRank(Math.round((a + b) / 2));
  assert.ok(Math.abs(half.pct - 0.5) < 0.02,
    `halfway between ranks should read ~0.50, read ${half.pct.toFixed(3)} ` +
    '— measuring from zero instead of from the current rank makes every bar look full');
  assert.equal(half.need, b - a);
});

test('the clubs-you-know board is ordered by shots and skips the unswung', () => {
  const top = topClubs({ I7: 300, DR: 1200, PW: 12, SW: 0 }, 3);
  assert.deepEqual(top.map(t => t.key), ['DR', 'I7', 'PW']);
  assert.equal(top[0].rank.name, masteryRank(1200).name);
  assert.equal(topClubs({}).length, 0, 'a new career shows no board rather than an empty one');
  assert.equal(topClubs({ DR: 0 }).length, 0, 'a zero is not a club you know');
});

test('the profile the client is sent carries mastery, and mastery only', async () => {
  const { getProfile, recordShot, publicProfile } = await import('../server/profiles.js');
  const pid = rid('mast-pub');
  getProfile(pid);
  recordShot(pid, 'I7');
  const pub = publicProfile(pid);
  assert.deepEqual(pub.mastery, { I7: 1 });
  /* And nothing derived from it leaked into the payload as a stat. If a
     future change wants mastery to do something, it has to go through the
     rank table, which xp.mjs holds to prestige. */
  for (const k of ['masterySpeed', 'masteryBonus', 'masteryPower']) {
    assert.equal(k in pub, false, `${k} is mastery selling power`);
  }
});

test('two identical shots are identical whether or not the club is mastered', async () => {
  /* The real end of the claim: the simulation is not given the number at
     all, so there is nothing for it to read even by accident. */
  const { ShotSim } = await import('../public/js/shared/ballistics.js');
  const { terrainFor } = await import('../public/js/shared/terrain.js');
  const { getCourse } = await import('../public/js/shared/coursegen.js');
  const course = getCourse('parkland');
  const hole = course.holes[1];
  const T = terrainFor(hole, course.biome);

  const play = extra => new ShotSim(T, {
    x: hole.tee.x, z: hole.tee.z, clubKey: 'DR', power: 1, aim: 0,
    faceDeg: 0, attackDeg: 0, wind: { speed: 0, dir: 0 }, crew: null,
    clubSet: null, setDone: 0, setGrade: 1, ...extra
  }).runToEnd();

  const plain = play({});
  const mastered = play({ mastery: { DR: 9999 }, masteryRank: 6, shots: 9999 });
  assert.ok(Math.abs(plain.carry - mastered.carry) < 1e-9,
    `mastery moved a shot ${(mastered.carry - plain.carry).toFixed(4)}m — it must move nothing`);
  assert.ok(Math.abs(plain.total - mastered.total) < 1e-9);
});
