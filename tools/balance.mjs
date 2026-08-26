#!/usr/bin/env node
/* =========================================================================
   balance.mjs — what does a round actually score?
   -------------------------------------------------------------------------
   Difficulty here has always been tuned by feel, which is how a swing that
   disagreed with its own meter survived so long.  This plays whole rounds
   with a MODELLED player and reports the scoring, so a change to the strike
   bar can be judged by a number instead of a hunch.

   The model that matters is the timing error.  A player does not miss the
   bar by "0.15 of its width" — they miss it by a fraction of a SECOND, and
   how much sweep that costs depends entirely on how fast the marker is
   moving.  That is the whole point of coupling tempo to power:

       sweep error  =  timing error (s)  ×  tempo (sweeps/s)  ×  4

   (4 because one sweep is 0..1..-1..0, four units of travel.)  So a bar at
   1.4 sweeps/s punishes the same human twice as hard as one at 0.7 — which
   is exactly the mechanic being added, and this is where it gets checked.

     node tools/balance.mjs            # every course, default skill
     node tools/balance.mjs 0.05       # a sloppier player (50 ms error)
   ========================================================================= */
import { allCourses } from '../public/js/shared/coursegen.js';
import { terrainFor } from '../public/js/shared/terrain.js';
import { BIOMES } from '../public/js/shared/biomes.js';
import { ShotSim, calibrateCarries, suggestedPower } from '../public/js/shared/ballistics.js';
import { CLUB_BY_KEY, CARRY, suggestClub, DEFAULT_BAG } from '../public/js/shared/clubs.js';
/* barTempo is the new power-aware bar speed.  Imported loosely so this file
   can measure the BEFORE as well as the after — without it, the bar speed is
   whatever the lie alone says, which is exactly the old behaviour. */
import * as SW from '../public/js/client/swing.js';
const { lieTempo, pureBand, FACE_MAX } = SW;
const barTempo = SW.barTempo || ((lie) => lieTempo(lie));
import { crewEffect } from '../public/js/shared/crew.js';
import { setStats } from '../public/js/shared/clubsets.js';
import { gearEffect } from '../public/js/shared/gear.js';

calibrateCarries();

/* A deterministic normal, so two runs of this file are comparable. */
let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const gauss = () => {
  const u = Math.max(1e-9, rnd()), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/** Mid-tier equipment: what a player has after a few hours, not day one. */
const MID = {
  gear: { ball: 1, irons: 1, woods: 1, putter: 1, cart: 0 },
  crew: { ace: 2, bruiser: 2, steady: 2, roller: 2, pitstop: 0, lucky: 1, gale: 1, grit: 1 },
  // a mid-rarity set part-way up its own upgrade path — the club-ladder
  // equivalent of what "a few hours in" used to mean at tier 3 refine 1
  clubSet: 'vantage', setLevel: 2
};

/**
 * Play one shot the way a competent player would: the caddie's club, the
 * caddie's power, and a strike that misses the middle of the bar by a human
 * fraction of a second.
 */
function playShot(T, hole, x, z, lie, aim, wind, kit, timingSigma) {
  const toPin = Math.hypot(hole.pin.x - x, hole.pin.z - z);
  const cfx = crewEffect(kit.crew, setStats(kit.clubSet, kit.setLevel), { power: 1 });
  const reach = cfx.speed;
  const club = suggestClub(toPin, lie, lie === 'green', DEFAULT_BAG, reach);
  const key = club.key;

  let power = suggestedPower(T, x, z, key, aim, wind, toPin, kit.gear, kit) ?? 1;
  power = Math.max(0.05, Math.min(1, power));

  // Where the marker actually got stopped, in bar units.
  const tempo = barTempo(lie, power);
  const sweepErr = gauss() * timingSigma * tempo * 4;
  const raw = Math.max(-1, Math.min(1, sweepErr));

  const band = pureBand(lie);
  const over = Math.max(0, Math.abs(raw) - band) / Math.max(1e-6, 1 - band);
  const timing = Math.sign(raw) * over;
  const faceDeg = timing * FACE_MAX;
  const attackDeg = Math.max(-2.5, Math.min(2.5, -Math.abs(timing) * 1.8));

  const r = new ShotSim(T, {
    x, z, clubKey: key, power, aim, faceDeg, attackDeg, wind,
    gear: kit.gear, crew: kit.crew, clubSet: kit.clubSet, setLevel: kit.setLevel
  }).runToEnd();
  return { r, key, power, raw, band, tempo };
}

/* Where the difficulty actually landed.  The headline score can stay flat
   while the game underneath changes completely, so this splits the strike
   rate by what you were standing in and how hard you swung. */
export const byLie = {};
export const byPower = { 'soft <40%': [0, 0], 'half 40-70%': [0, 0], 'full >70%': [0, 0] };
function note(lie, power, pure) {
  (byLie[lie] = byLie[lie] || [0, 0])[0] += pure ? 1 : 0;
  byLie[lie][1]++;
  const k = power < 0.4 ? 'soft <40%' : power < 0.7 ? 'half 40-70%' : 'full >70%';
  byPower[k][0] += pure ? 1 : 0; byPower[k][1]++;
}

function playHole(T, hole, kit, timingSigma) {
  let x = hole.tee.x, z = hole.tee.z, lie = 'tee';
  const wind = { dir: 0, speed: 3 };
  const max = hole.maxStrokes ?? hole.par + 6;
  let strokes = 0, pures = 0;
  for (let i = 0; i < max; i++) {
    const aim = Math.atan2(hole.pin.x - x, hole.pin.z - z);
    const { r, raw, band, power } = playShot(T, hole, x, z, lie, aim, wind, kit, timingSigma);
    strokes += 1 + (r.penalty || 0);
    const pure = Math.abs(raw) <= band;
    if (pure) pures++;
    note(lie, power, pure);
    if (r.holed) return { strokes, pures };
    x = r.x; z = r.z; lie = r.lie;
    if (strokes >= max) break;
  }
  return { strokes: Math.min(strokes, max), pures };
}

const SIGMA = Number(process.argv[2] || 0.038);   // 38 ms — a decent player

console.log(`\n  modelled player: ${(SIGMA * 1000).toFixed(0)} ms timing error, mid-tier kit\n`);
console.log('  course               rounds   avg score   vs par    pures');
console.log('  ' + '-'.repeat(60));

/* Several rounds per course, averaged.  A single round is far too noisy to
   tune on: one blown hole cascades through the card, and two runs of the same
   build came out +1.6 and +3.8 apart on nothing but seed. */
const ROUNDS = Number(process.env.ROUNDS || 6);
let allRel = 0, allPure = 0, allShots = 0, n = 0;
for (const course of allCourses()) {
  const biome = BIOMES[course.id];
  const terrains = course.holes.map(h => terrainFor(h, biome));
  const par = course.holes.reduce((a, h) => a + h.par, 0);
  let sumTotal = 0, pures = 0, shots = 0, best = 999, worst = -999;
  for (let r = 0; r < ROUNDS; r++) {
    seed = 1000 + r * 7919;                      // a different, repeatable draw
    let total = 0;
    for (let i = 0; i < course.holes.length; i++) {
      const { strokes, pures: p } = playHole(terrains[i], course.holes[i], MID, SIGMA);
      total += strokes; pures += p; shots += strokes;
    }
    sumTotal += total;
    best = Math.min(best, total - par); worst = Math.max(worst, total - par);
  }
  const avg = sumTotal / ROUNDS, rel = avg - par;
  allRel += rel; allPure += pures; allShots += shots; n++;
  console.log('  ' + course.name.padEnd(20) + String(ROUNDS).padStart(5) + '     ' +
    avg.toFixed(1).padStart(5) + '     ' + (rel >= 0 ? '+' : '') + rel.toFixed(1).padStart(5) +
    '   ' + (best >= 0 ? '+' : '') + best + ' to ' + (worst >= 0 ? '+' : '') + worst);
}
console.log('  ' + '-'.repeat(60));
console.log('  AVERAGE                          ' + (allRel / n >= 0 ? '+' : '') +
  (allRel / n).toFixed(1).padStart(5) + '     ' + (allPure / allShots * 100).toFixed(0) + '% pure\n');

const pct = ([a, b]) => b ? (a / b * 100).toFixed(0).padStart(3) + '%' : '   -';
console.log('  strike rate by lie');
for (const [k, v] of Object.entries(byLie).sort((a, b) => b[1][1] - a[1][1]))
  console.log('    ' + k.padEnd(10) + pct(v) + '   (' + v[1] + ' shots)');
console.log('\n  strike rate by how hard you swung');
for (const [k, v] of Object.entries(byPower))
  console.log('    ' + k.padEnd(14) + pct(v) + '   (' + v[1] + ' shots)');
console.log('');
