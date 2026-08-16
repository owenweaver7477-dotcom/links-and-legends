/* =========================================================================
   difficultyorder.mjs — the list is in the order it claims to be in
   -------------------------------------------------------------------------
   COURSE_ORDER is the order courses appear everywhere: the picker, the
   boards, the "next course" progression. It used to be the order they
   happened to have been written in, which put the sixth-hardest course
   first and the easiest one third — so a player working down the list got
   no sense of progression at all, and the hardest course on the roster sat
   in the middle of it.

   Ordering it by hand is not enough, because the courses are GENERATED:
   change a biome's fairway width or its wind and the difficulty moves
   without anybody touching the list. So the list is asserted against the
   measured slope rather than trusted, and this fails the moment the two
   disagree.

   Slope is the right axis. It is precisely "how much harder is this for an
   ordinary golfer than for a very good one", it comes out of the real
   geometry, and it is the number the handicap system already runs on.
   ========================================================================= */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { allCourses, getCourse } from '../public/js/shared/coursegen.js';
import { ratingsFor } from '../public/js/shared/handicap.js';
import { COURSE_ORDER, REGIONS, BIOMES, coursesByRegion } from '../public/js/shared/biomes.js';

const rated = COURSE_ORDER.map(id => {
  const c = getCourse(id);
  return { id, name: c.name, ...ratingsFor(c) };
});

test('COURSE_ORDER runs easiest to hardest', () => {
  for (let i = 1; i < rated.length; i++) {
    const prev = rated[i - 1], cur = rated[i];
    assert.ok(cur.slope >= prev.slope,
      `${cur.name} (slope ${cur.slope}) is listed after ` +
      `${prev.name} (slope ${prev.slope}) but plays easier`);
  }
});

test('every course is on the list exactly once', () => {
  const ids = allCourses().map(c => c.id);
  assert.equal(new Set(COURSE_ORDER).size, COURSE_ORDER.length, 'a duplicate id');
  for (const id of ids) {
    assert.ok(COURSE_ORDER.includes(id), `${id} exists but is not in COURSE_ORDER`);
  }
  assert.equal(COURSE_ORDER.length, ids.length);
});

test('the roster spans a real range, not a cluster', () => {
  /* Twelve courses that all rate within a few points of each other are
     twelve versions of one course. The WHS scale runs 55-155; a roster
     worth having should use a decent slice of it. */
  const lo = rated[0].slope, hi = rated[rated.length - 1].slope;
  assert.ok(lo <= 105, `the easiest course rates ${lo} — nowhere for a beginner to start`);
  assert.ok(hi >= 140, `the hardest course rates ${hi} — no championship test`);
  assert.ok(hi - lo >= 40, `the whole roster spans only ${hi - lo} slope points`);
});

test('every slope and rating is inside what the WHS allows', () => {
  for (const r of rated) {
    assert.ok(r.slope >= 55 && r.slope <= 155, `${r.name} slope ${r.slope} is out of range`);
    assert.ok(r.rating > 25 && r.rating < 45, `${r.name} rating ${r.rating} is implausible for nine holes`);
  }
});

test('a course rated harder actually plays longer or tighter', () => {
  /* A sanity check on the model rather than on the roster: the hardest
     course must not be the shortest AND widest AND flattest one, which
     would mean the rating was being driven by something cosmetic. */
  const easy = getCourse(COURSE_ORDER[0]);
  const hard = getCourse(COURSE_ORDER[COURSE_ORDER.length - 1]);
  const width = c => c.holes.reduce((a, h) => a + h.fairwayWidth, 0) / c.holes.length;
  assert.ok(hard.yards > easy.yards, 'the championship course is shorter than the beginners one');
  assert.ok(width(hard) < width(easy), 'the championship course has wider fairways');
});

test('every course belongs to a region that exists', () => {
  /* A course whose continent has no REGION entry is filtered out of the
     picker and simply cannot be chosen — it is in the game, generates, has
     a rating, and is invisible. Kopjesrand shipped exactly like that for
     the length of one commit because 'africa' was a new continent and the
     region list had never needed it. */
  const known = new Set(REGIONS.map(r => r.id));
  for (const id of COURSE_ORDER) {
    const bio = BIOMES[id];
    assert.ok(known.has(bio.continent),
      `${bio.name} is in '${bio.continent}', which is not a region — it will not appear in the picker`);
  }
  const shown = coursesByRegion().flatMap(r => r.courses.map(c => c.id));
  assert.equal(shown.length, COURSE_ORDER.length,
    `the picker shows ${shown.length} of ${COURSE_ORDER.length} courses`);
});

test('each region lists its courses easiest first', () => {
  for (const region of coursesByRegion()) {
    const slopes = region.courses.map(c => ratingsFor(getCourse(c.id)).slope);
    for (let i = 1; i < slopes.length; i++) {
      assert.ok(slopes[i] >= slopes[i - 1],
        `${region.name} lists slope ${slopes[i]} after ${slopes[i - 1]}`);
    }
  }
});

test('every course has a backdrop, so no hole plays against a bare horizon', async () => {
  /* `_buildBackdrop` returns an empty group for a biome with no entry, so a
     course added without one gets nothing on the skyline. That was fixed
     once for the original eight and then quietly undone by adding four
     more — which is precisely the kind of table that needs a test rather
     than a habit.

     Read as text: scene.js imports three.js and a DOM, and neither is worth
     standing up to check the keys of an object literal. */
  const src = await readFile(new URL('../public/js/client/scene.js', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('export const BACKDROPS = {'));
  const table = block.slice(0, block.indexOf('\n};'));
  for (const id of COURSE_ORDER) {
    assert.ok(new RegExp(`\\b${id}\\s*:`).test(table),
      `${BIOMES[id].name} has no BACKDROPS entry — it will play against an empty skyline`);
  }
});

test('a coastal course actually gets a sea', () => {
  /* A links or headland course whose backdrop has no `sea` is a seaside
     course with no sea in it. Checked against the biome's own water kind,
     so the two cannot disagree. */
  for (const id of COURSE_ORDER) {
    if (BIOMES[id].waterKind !== 'ocean') continue;
    assert.ok(SEASIDE.includes(id),
      `${BIOMES[id].name} has ocean water but no sea on its backdrop`);
  }
});
const SEASIDE = ['links', 'tropical', 'fjord', 'headland'];
