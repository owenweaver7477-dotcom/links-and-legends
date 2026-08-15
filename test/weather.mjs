/* =========================================================================
   weather.mjs — the sky is allowed to be interesting, not unfair
   -------------------------------------------------------------------------
   Weather changes how far the ball goes, which puts it in the same category
   as the course geometry: the server and every client have to derive
   identical numbers from the same seed, and the numbers have to stay inside
   a range where a round is still winnable.

   The failure this file exists to prevent is the compounding one. Season
   and condition each multiply the carry, and each looked reasonable alone —
   winter at 0.972, snow at 0.962 — while together they took six and a half
   percent off a driver on top of a fairway that no longer ran. That is not
   weather, that is a different game, and it arrives on dice the player did
   not roll.
   ========================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEASONS, CONDITIONS, weatherFor, seasonOf, seasonById, conditionById,
  sunAt, lightAt, clockText, weatherEffects
} from '../public/js/shared/weather.js';
import { COURSE_ORDER } from '../public/js/shared/biomes.js';

const ALL_SEASONS = SEASONS.map(s => s.id);

test('the same seed gives the same weather, always', () => {
  /* The whole architecture rests on this the way it rests on the course
     generator being deterministic. A client that thinks it is a clear noon
     while the server thinks it is raining is a client whose ball goes
     further than the server will allow. */
  for (const course of COURSE_ORDER) {
    for (let seed = 0; seed < 40; seed++) {
      const a = weatherFor(seed, course, 'autumn');
      const b = weatherFor(seed, course, 'autumn');
      assert.deepEqual(a, b, `${course} seed ${seed} produced two different skies`);
    }
  }
});

test('no round is ever unplayable', () => {
  /* The bound the whole system is designed around. Every combination of
     season, condition and course, and the worst of them must still be golf. */
  let worstCarry = 1, worstRoll = 1, worstVis = 1, where = '';
  for (const season of ALL_SEASONS) {
    for (const course of COURSE_ORDER) {
      for (let seed = 0; seed < 400; seed++) {
        const w = weatherFor(seed, course, season);
        if (w.carry < worstCarry) { worstCarry = w.carry; where = `${w.conditionName} in ${w.seasonName}`; }
        worstRoll = Math.min(worstRoll, w.roll);
        worstVis = Math.min(worstVis, w.vis);
      }
    }
  }
  assert.ok(worstCarry >= 0.955,
    `the worst weather costs ${((1 - worstCarry) * 100).toFixed(1)}% of carry (${where})`);
  assert.ok(worstRoll >= 0.74, `the worst weather costs ${((1 - worstRoll) * 100).toFixed(0)}% of roll`);
  // and something has to be visible: at 0.16 the far plane is still ~300 m
  assert.ok(worstVis >= 0.15, `visibility drops to ${worstVis}`);
});

test('the weather suits the place it is happening', () => {
  const share = (course, season, cond) => {
    let n = 0;
    for (let s = 0; s < 2000; s++) if (weatherFor(s, course, season).condition === cond) n++;
    return n / 2000;
  };
  // it does not snow in the Sonoran desert
  assert.equal(share('desert', 'winter', 'snow'), 0, 'it snowed in the desert');
  // and Ayrshire is windier and wetter than Arizona
  assert.ok(share('links', 'autumn', 'breezy') > share('desert', 'autumn', 'breezy') * 2,
    'the links is not windier than the desert');
  assert.ok(share('desert', 'summer', 'clear') > share('fjord', 'summer', 'clear') * 2,
    'Iceland gets as many clear days as Arizona');
  // and snow does not fall in July anywhere
  for (const course of COURSE_ORDER) {
    assert.equal(share(course, 'summer', 'snow'), 0, `it snowed on ${course} in summer`);
  }
});

test('every condition can actually happen somewhere', () => {
  /* A condition in the table that nothing ever rolls is dead code wearing a
     feature's clothes — and the climate multipliers make that easy to do by
     accident. */
  const seen = new Set();
  for (const season of ALL_SEASONS) {
    for (const course of COURSE_ORDER) {
      for (let s = 0; s < 300; s++) seen.add(weatherFor(s, course, season).condition);
    }
  }
  for (const c of CONDITIONS) {
    assert.ok(seen.has(c.id), `"${c.name}" is in the table but never occurs`);
  }
});

test('every round is played in daylight', () => {
  /* Not a preference — the light model returns a night palette below the
     horizon, and a round that starts at 3 am is one nobody can see. The hour
     is drawn inside the season's own daylight window. */
  for (const season of SEASONS) {
    for (const course of COURSE_ORDER) {
      for (let s = 0; s < 200; s++) {
        const w = weatherFor(s, course, season.id);
        const sun = sunAt(w.hour, season.id);
        assert.ok(sun.up, `${season.name} on ${course}: ${clockText(w.hour)} is not daylight`);
        assert.ok(sun.elev > 0, `the sun is below the horizon at ${clockText(w.hour)}`);
      }
    }
  }
});

test('the sun goes up, across, and down', () => {
  for (const season of ALL_SEASONS) {
    const s = seasonById(season);
    const [dawn, dusk] = s.daylight;
    const noon = (dawn + dusk) / 2;
    const morning = sunAt(dawn + 1, season);
    const midday = sunAt(noon, season);
    const evening = sunAt(dusk - 1, season);
    assert.ok(midday.elev > morning.elev && midday.elev > evening.elev,
      `${season}: the sun is not highest at noon`);
    // and it travels east to west
    assert.ok(morning.azim < midday.azim && midday.azim < evening.azim,
      `${season}: the sun does not move west`);
  }
  // a winter sun never climbs as high as a summer one
  assert.ok(sunAt(12, 'winter').elev < sunAt(13, 'summer').elev * 0.6,
    'the winter sun climbs as high as the summer sun');
});

test('the light is warm at the ends of the day and white in the middle', () => {
  const s = seasonById('summer');
  const [dawn, dusk] = s.daylight;
  const early = lightAt(dawn + 0.3, 'summer');
  const noon = lightAt((dawn + dusk) / 2, 'summer');
  const late = lightAt(dusk - 0.3, 'summer');
  assert.ok(early.golden > 0.3, `dawn is not golden (${early.golden.toFixed(2)})`);
  assert.ok(late.golden > 0.3, `dusk is not golden (${late.golden.toFixed(2)})`);
  assert.ok(noon.golden < 0.02, `noon is golden (${noon.golden.toFixed(2)})`);
  // golden light is redder than it is blue
  assert.ok(early.warm[0] > early.warm[2], 'the dawn light is not warm');
  assert.ok(noon.strength > early.strength, 'noon is not brighter than dawn');
  // night is a different palette, not a dimmer one
  const night = lightAt(2, 'summer');
  assert.equal(night.night, 1);
  assert.ok(night.warm[2] > night.warm[0], 'night is not cool');
});

test('nothing hostile survives a bad season or condition id', () => {
  assert.ok(seasonById('__proto__').id);
  assert.ok(seasonById(null).id);
  assert.ok(conditionById('<script>').id);
  const w = weatherFor(7, 'not-a-course', 'not-a-season');
  assert.ok(SEASONS.some(s => s.id === w.season));
  assert.ok(CONDITIONS.some(c => c.id === w.condition));
  assert.ok(Number.isFinite(w.carry) && Number.isFinite(w.hour));
});

test('the effects panel never claims an effect that is not there', () => {
  /* The panel is the contract: everything that touches the ball is shown.
     The converse matters just as much — a clear day must not list effects,
     or a player learns to ignore the panel. */
  const clear = weatherEffects({ carry: 1, roll: 1, windMul: 1, vis: 1, grip: 1 });
  assert.equal(clear.length, 0, `a clear day listed ${clear.length} effects`);
  const rain = weatherEffects({ carry: 0.976, roll: 0.78, windMul: 1.4, vis: 0.44, grip: 0.88 });
  const labels = rain.map(f => f.label);
  for (const want of ['Carry', 'Roll', 'Wind', 'Visibility', 'Greens']) {
    assert.ok(labels.includes(want), `rain does not report ${want}`);
  }
  // and a penalty is never dressed as good news
  assert.ok(rain.every(f => f.good === false), 'rain reported something as good');
});

test('the clock reads the way a clock reads', () => {
  assert.equal(clockText(13.5), '1:30 pm');
  assert.equal(clockText(0), '12:00 am');
  assert.equal(clockText(12), '12:00 pm');
  assert.equal(clockText(9.25), '9:15 am');
});

test('the real calendar picks the season', () => {
  assert.equal(seasonOf(0).id, 'winter');    // January
  assert.equal(seasonOf(3).id, 'spring');    // April
  assert.equal(seasonOf(6).id, 'summer');    // July
  assert.equal(seasonOf(9).id, 'autumn');    // October
  // and it survives a nonsense month rather than returning undefined
  assert.ok(seasonOf(99).id);
  assert.ok(seasonOf(-1).id !== undefined);
});
