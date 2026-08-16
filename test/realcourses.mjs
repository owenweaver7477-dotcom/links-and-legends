/* =========================================================================
   realcourses.mjs — an imported course plays like any other
   -------------------------------------------------------------------------
   A real course enters this game as data, not as code: nine centrelines,
   nine pars, and whatever sand and water the survey recorded. Everything
   after that — terrain, trees, elevation, out of bounds, the cup, the
   rating — is the same machinery a generated hole goes through, which is
   the whole design. There is deliberately no second code path.

   So the risk is not that an imported course plays differently. It is that
   one arrives MALFORMED and takes the game down three layers deep inside
   terrain generation, where the error says nothing about the course being
   the problem. A projection mistake gives holes four metres long; a units
   mix-up gives holes forty kilometres long; a way drawn green-to-tee plays
   the hole backwards and looks fine in the file.

   These run the importer against a synthetic nine — not a real club, a
   fixture built to have every feature the importer reads — and then check
   the result actually builds into something playable.
   ========================================================================= */

import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { REAL_COURSES, validateRealCourse } from '../public/js/shared/realcourses.js';
import { getCourse } from '../public/js/shared/coursegen.js';
import { ratingsFor } from '../public/js/shared/handicap.js';
import { COURSE_ORDER, coursesByRegion } from '../public/js/shared/biomes.js';

const run = promisify(execFile);
const TOOL = fileURLToPath(new URL('../tools/import-course.mjs', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/synthetic-nine.geojson', import.meta.url));

/* ---- the importer ------------------------------------------------------ */

test('the importer reads a course and reports what it found', async () => {
  const { stdout } = await run(process.execPath, [TOOL, FIXTURE,
    '--id', 'fixture', '--name', 'Fixture', '--region', 'Nowhere',
    '--biome', 'parkland', '--dry']);
  assert.match(stdout, /9 holes/, 'did not find nine holes');
  assert.match(stdout, /par 36/, 'did not read the par tags');
  assert.match(stdout, /9 bunkers/, 'did not find the bunkers');
  assert.match(stdout, /nothing written/, 'a dry run wrote something');
});

test('it refuses to name a real club without a record of permission', async () => {
  /* A layout is a geographic fact; a club's NAME is a trademark, and this
     game is published commercially. The flag exists so the answer is
     written down somewhere other than somebody's memory. */
  await assert.rejects(
    run(process.execPath, [TOOL, FIXTURE, '--id', 'permcheck', '--name', 'X',
                           '--region', 'Y', '--biome', 'parkland']),
    e => /permission is required/.test(e.stderr), 'a course imported with no permission recorded');
});

test('it refuses a file that is not a golf course', async () => {
  await assert.rejects(
    run(process.execPath, [TOOL, fileURLToPath(new URL('../package.json', import.meta.url)),
                           '--id', 'notacourse', '--name', 'X', '--region', 'Y',
                           '--biome', 'parkland', '--dry']),
    e => /no features|golf=hole/.test(e.stderr));
});

/* ---- validation catches the mistakes that actually happen -------------- */

const sound = () => ({
  id: 'ok', name: 'Ok', region: 'Here', biome: 'parkland',
  holes: Array.from({ length: 9 }, () => ({
    par: 4, route: [[0, 0], [150, 0], [330, 20]]
  }))
});

test('a sound course validates clean', () => {
  assert.deepEqual(validateRealCourse(sound()), []);
});

test('a projection mistake is caught, not rendered', () => {
  const c = sound();
  c.holes[3].route = [[0, 0], [2, 0]];                 // two metres long
  assert.match(validateRealCourse(c).join(' '), /hole 4.*check the projection/);
});

test('a units mix-up is caught', () => {
  const c = sound();
  c.holes[0].route = [[0, 0], [40000, 0]];             // forty kilometres
  assert.match(validateRealCourse(c).join(' '), /hole 1.*check the units/);
});

test('a wrong hole count and a bad par are caught', () => {
  const c = sound();
  c.holes.pop();
  c.holes[0].par = 7;
  const bad = validateRealCourse(c).join(' ');
  assert.match(bad, /8 holes/);
  assert.match(bad, /par 7/);
});

/* ---- and every course actually in the registry ------------------------- */

test('every imported course in the registry is sound and playable', () => {
  for (const [id, c] of Object.entries(REAL_COURSES)) {
    assert.deepEqual(validateRealCourse(c), [], `${id} is malformed`);
    assert.ok(COURSE_ORDER.includes(id), `${id} is imported but not on the roster`);
    /* AND IN THE PICKER. `coursesByRegion` grouped by `BIOMES[id]`, which is
       undefined for an imported course — so one could generate, rate, and be
       impossible to choose. The generated-course version of this check
       filtered imported ones out, so it could never have caught it. */
    const shown = coursesByRegion().flatMap(r => r.courses.map(x => x.id));
    assert.ok(shown.includes(id), `${id} is on the roster but not in the picker`);
    const meta = coursesByRegion().flatMap(r => r.courses).find(x => x.id === id);
    assert.equal(meta.name, c.name, `${id} shows the biome's name, not its own`);
    assert.equal(meta.region, c.region, `${id} shows the biome's region, not its own`);

    /* It has to survive the full build, which is where a bad import would
       otherwise surface — as a crash inside terrain generation. */
    const built = getCourse(id);
    assert.equal(built.holes.length, 9);
    assert.ok(built.real, `${id} did not come through as a real course`);
    assert.ok(built.yards > 1500 && built.yards < 8000, `${id} is ${built.yards} yards`);
    for (const h of built.holes) {
      assert.ok(h.route.length >= 2 && h.green && h.pin && h.cup, 'a hole came out incomplete');
      assert.ok(Number.isFinite(h.total) && h.total > 50, 'a hole has no length');
    }
    const r = ratingsFor(built);
    assert.ok(r.slope >= 55 && r.slope <= 155, `${id} rates slope ${r.slope}`);

    /* OSM data is ODbL and requires attribution wherever the derived course
       is shown. An entry without it is a licence breach. */
    if (/OpenStreetMap/i.test(c.attribution || '') === false && c.attribution == null) {
      assert.fail(`${id} has no attribution — where did its data come from?`);
    }
  }
});
