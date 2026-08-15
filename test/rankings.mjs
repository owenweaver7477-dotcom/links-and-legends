/* =========================================================================
   rankings.mjs — the number beside you agrees with the list beneath it
   -------------------------------------------------------------------------
   A world ranking is two separate pieces of arithmetic: the top fifty, and
   "you are 14th of 60". They were written months apart and they filtered
   the field differently — the list required a name, the placing did not —
   so a player could be told they were 14th of 60 on a board showing nine
   people. Both numbers were correct. They were answering different
   questions, and only one of them was the question being asked.

   That is a class of bug no amount of looking finds, because every number
   on screen is individually plausible. It only shows up when you check the
   two against each other, which is what this file does.
   ========================================================================= */

import assert from 'node:assert/strict';
import test from 'node:test';
import { getProfile, worldRanking, worldPlace, handicapPlace } from '../server/profiles.js';

/** A player with a name, a rating and enough rounds to be ranked. */
function player(pid, name, rating, rounds = 12) {
  const p = getProfile(pid);
  p.name = name;
  p.rating = rating;
  p.rounds = rounds;
  return p;
}

/* A field with three kinds of profile in it, because the bug lived in the
   gap between them: ranked players, a player who never chose a name, and a
   player who has not played enough rounds yet. */
player('r-alice', 'Alice', 1800);
player('r-bob', 'Bob', 1600);
player('r-cara', 'Cara', 1400);
const anon = getProfile('r-anon');            // plenty of rounds, NO name
anon.rating = 2500; anon.rounds = 40;
const anon2 = getProfile('r-anon2');
anon2.rating = 2400; anon2.rounds = 40;
player('r-new', 'Newcomer', 1900, 2);         // named, but only two rounds

test('the field size matches the number of players actually listed', () => {
  const list = worldRanking(500).filter(r => r.pid.startsWith('r-'));
  const place = worldPlace('r-bob');
  assert.equal(place.ranked, true);
  /* The list is capped and the field is not, so this is not an equality in
     general — but with a handful of players it must be, and if it is not
     the two are counting different populations. */
  assert.equal(place.of, list.length,
    `told "of ${place.of}" while the board lists ${list.length}`);
});

test('an unnamed player inflates neither the field nor your rank', () => {
  /* The two anons out-rate everybody here. If they counted, Bob would be
     told he was 4th rather than 2nd — of a board he can see he is 2nd on. */
  const place = worldPlace('r-bob');
  assert.equal(place.rank, 2, `Bob is 2nd of the named players, told ${place.rank}`);
  const names = worldRanking(500).filter(r => r.pid.startsWith('r-')).map(r => r.name);
  assert.deepEqual(names, ['Alice', 'Bob', 'Cara'],
    'an unnamed or under-played profile reached the board');
});

test('your rank agrees with where you appear in the list', () => {
  const list = worldRanking(500);
  for (const pid of ['r-alice', 'r-bob', 'r-cara']) {
    const place = worldPlace(pid);
    const row = list.find(r => r.pid === pid);
    assert.ok(row, `${pid} is placed but not listed`);
    assert.equal(place.rank, row.rank,
      `${pid} is told rank ${place.rank} but sits at ${row.rank} in the list`);
  }
});

test('too few rounds is unranked, and says how many are left', () => {
  const place = worldPlace('r-new');
  assert.equal(place.ranked, false);
  assert.equal(place.need, 3, 'the countdown to being ranked is wrong');
});

test('the handicap board counts its own field the same way', () => {
  // it always did — this is here so it cannot drift apart the way world did
  const h = handicapPlace('r-bob');
  assert.ok(h.of >= 0 && Number.isFinite(h.of));
});
