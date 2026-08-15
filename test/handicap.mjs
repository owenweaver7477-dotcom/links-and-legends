/* =========================================================================
   handicap.mjs — the number a golfer would recognise
   -------------------------------------------------------------------------
   A handicap is the one statistic in this game that a player can check
   against something outside it. That makes it the one statistic that cannot
   be approximately right: a golfer who plays off 12 in life and off 24 here
   will conclude the game does not know what a handicap is, and they will be
   correct.

   So this file holds the system to three things.

     - The ratings have to be plausible AND ordered. A generated course that
       rates easier than another it is visibly harder than is a rating nobody
       will believe twice.
     - The index has to be monotonic. Play worse, go up. Always.
     - It must refuse to answer when it cannot. A handicap off one round is
       not a handicap, and printing one tells a player something untrue about
       themselves that they will then repeat.
   ========================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  courseRating, slopeRating, ratingsFor, differential, handicapIndex,
  ratingTier, RATING_TIERS, rankTier, RANK_TIERS, handicapText, topPercent,
  MILESTONES, nextMilestone
} from '../public/js/shared/handicap.js';
import { allCourses } from '../public/js/shared/coursegen.js';

const COURSES = allCourses();

test('every course rates inside the range a rating can be', () => {
  for (const c of COURSES) {
    const par = c.holes.reduce((a, h) => a + h.par, 0);
    const r = courseRating(c), s = slopeRating(c);
    /* A nine-hole rating lives within a few strokes of par in both
       directions. Outside that the number is not a course rating, it is a
       bug wearing one. */
    assert.ok(r > par - 4 && r < par + 5,
      `${c.name} rates ${r} against par ${par}`);
    assert.ok(s >= 55 && s <= 155, `${c.name} has a slope of ${s}`);
    // and slope is an integer, because that is how slope is written
    assert.equal(s, Math.round(s), `${c.name} slope ${s} is not a whole number`);
  }
});

test('the ratings order the courses the way the courses are ordered', () => {
  /* Not an absolute check — nobody can say Grimsvik should rate exactly
     38.7. But the game already knows which of its courses are hard, because
     it built them: more water, less fairway, more climb. If the rating
     disagrees with the geometry it was computed from, it is not measuring
     what it claims to. */
  const rows = COURSES.map(c => {
    let water = 0, fairway = 0;
    for (const h of c.holes) { water += h.waters.length; fairway += h.fairwayWidth; }
    return { name: c.name, rating: courseRating(c), water, fairway: fairway / c.holes.length };
  });
  const hardest = rows.slice().sort((a, b) => b.rating - a.rating)[0];
  const easiest = rows.slice().sort((a, b) => a.rating - b.rating)[0];
  assert.ok(hardest.rating - easiest.rating > 0.8,
    `only ${(hardest.rating - easiest.rating).toFixed(1)} strokes between the ` +
    `hardest and easiest course — the rating is not discriminating`);
  // the hardest course must not also have the widest fairways and least water
  assert.ok(!(hardest.fairway > easiest.fairway && hardest.water < easiest.water),
    `${hardest.name} rates hardest but is wider and drier than ${easiest.name}`);
});

test('a rating is a pure function of the course', () => {
  // the whole architecture rests on client and server agreeing
  for (const c of COURSES) {
    assert.equal(courseRating(c), courseRating(c));
    assert.equal(slopeRating(c), slopeRating(c));
  }
});

test('the index refuses to answer before it can', () => {
  const d = [3.2, 1.1];
  assert.equal(handicapIndex([]), null);
  assert.equal(handicapIndex([3.2]), null);
  assert.equal(handicapIndex(d), null, 'two rounds is not a handicap');
  assert.ok(handicapIndex([...d, 4.0]) !== null, 'three rounds should give one');
  // and junk in the list never becomes a number out of it
  assert.equal(handicapIndex([NaN, undefined, null]), null);
  assert.ok(Number.isFinite(handicapIndex([2, 3, 4, NaN, 'x', 5])));
});

test('playing worse always moves the handicap up, never down', () => {
  /* The property that makes the whole thing trustworthy. It is easy to get
     wrong: the index takes the BEST 8 of 20, so a bad round can leave the
     counting set untouched — but it must never IMPROVE it. */
  const base = [2.0, 3.0, 4.0, 2.5, 3.5, 5.0, 1.5, 4.5, 3.2, 2.8];
  const before = handicapIndex(base);
  for (const worse of [6, 9, 14, 30]) {
    const after = handicapIndex([...base, worse]);
    assert.ok(after >= before - 0.001,
      `adding a ${worse} differential moved the index from ${before} to ${after}`);
  }
  // and a great round must never move it up
  for (const better of [-4, -1, 0.5]) {
    const after = handicapIndex([...base, better]);
    assert.ok(after <= before + 0.001,
      `adding a ${better} differential moved the index from ${before} to ${after}`);
  }
});

test('a better golfer has a lower index than a worse one', () => {
  const { rating, slope } = ratingsFor(COURSES[0]);
  const idx = scores => handicapIndex(scores.map(g => differential(g, rating, slope)));
  const pro = idx([32, 31, 34, 30, 33, 32, 35, 31]);
  const club = idx([40, 38, 42, 37, 41, 39, 44, 36]);
  const mid = idx([45, 44, 48, 43, 47, 45, 50, 44]);
  const beginner = idx([56, 54, 58, 53, 57, 55, 60, 54]);
  assert.ok(pro < club && club < mid && mid < beginner,
    `indexes out of order: pro ${pro}, club ${club}, mid ${mid}, beginner ${beginner}`);
  // and the spread has to be wide enough to be worth showing
  assert.ok(beginner - pro > 10,
    `only ${(beginner - pro).toFixed(1)} strokes between a tour pro and a beginner`);
});

test('the slope actually changes what a score is worth', () => {
  /* The point of slope: the same score on a harder course is a better
     round. If this ever stops being true the 113 has been dropped somewhere. */
  const easy = differential(42, 36.5, 113);
  const hard = differential(42, 36.5, 140);
  assert.ok(hard < easy, `42 on a 140-slope rated worse than on a 113`);
});

test('the tiers cover every number with no gaps and no overlaps', () => {
  for (let v = -12; v <= 12; v += 0.5) {
    const hits = RATING_TIERS.filter(t => v >= t.min && v < t.max);
    assert.equal(hits.length, 1, `${v} versus rating matched ${hits.length} tiers`);
  }
  assert.equal(ratingTier(-5).id, 'S');
  assert.equal(ratingTier(0).id, 'B');
  assert.equal(ratingTier(9).id, 'D');
  assert.equal(ratingTier(NaN), null);
});

test('the rank ladder covers every level from 1 to 100', () => {
  for (let lv = 1; lv <= 100; lv++) {
    const hits = RANK_TIERS.filter(t => lv >= t.from && lv <= t.to);
    assert.equal(hits.length, 1, `level ${lv} matched ${hits.length} rank tiers`);
  }
  assert.equal(rankTier(1).id, 'novice');
  assert.equal(rankTier(100).id, 'master');
  // out-of-range input must still land somewhere rather than returning undefined
  assert.ok(rankTier(0).id);
  assert.ok(rankTier(9999).id);
  assert.ok(rankTier(null).id);
});

test('every milestone names something the game actually has', () => {
  /* The failure mode of a rewards table is that it is written before the
     features it promises. Each of these has to line up with a rank tier
     boundary, so the table and the ladder cannot drift apart. */
  for (const m of MILESTONES) {
    assert.ok(m.gives && m.gives.length > 8, `milestone at ${m.at} promises nothing`);
    const t = rankTier(m.at);
    assert.ok(t.from === m.at || t.to === m.at,
      `the milestone at level ${m.at} is not on a tier boundary (${t.name} is ${t.from}-${t.to})`);
  }
  assert.equal(nextMilestone(1).at, 10);
  assert.equal(nextMilestone(100), null);
});

test('a plus handicap is written the way golf writes it', () => {
  /* "+2.4" means two and a half strokes BETTER than scratch. It looks
     backwards to anybody who has not played and is exactly right to anybody
     who has, and getting it wrong is the fastest way to tell a golfer this
     game was not made by one. */
  assert.equal(handicapText(-2.4), '+2.4');
  assert.equal(handicapText(0), '0.0');
  assert.equal(handicapText(7.2), '7.2');
  assert.equal(handicapText(null), '—');
  assert.equal(handicapText(undefined), '—');
  assert.equal(handicapText(NaN), '—');
});

test('top-percent never claims more than it knows', () => {
  assert.equal(topPercent(1, 100), 'Top 1%');
  assert.equal(topPercent(15, 100), 'Top 15%');
  assert.equal(topPercent(100, 100), 'Top 100%');
  // a field of one is not a ranking
  assert.equal(topPercent(1, 1), null);
  assert.equal(topPercent(null, 50), null);
  assert.equal(topPercent(3, 0), null);
});
