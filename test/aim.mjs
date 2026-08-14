/* =========================================================================
   aim.mjs — where the game points you before you touch anything
   -------------------------------------------------------------------------
   The default aim used to be "straight at the flag", which is wrong on any
   hole that bends.  On the opening hole of Claude National it pointed at a
   19-metre maple standing thirty metres from the tee, so the first shot of a
   new player's first round was a flushed driver into a trunk: 19 metres of
   carry off a perfect strike.  That reads as the swing being broken, and it
   is indistinguishable from it without looking at the tree.

   So: from every tee on every course, the shot the game sets up for you must
   actually get down the hole.  This flies the real simulation to check it,
   because the only definition of "a clear line" that matters is whether the
   ball arrives.
   ========================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allCourses, defaultAim, aimPlan } from '../public/js/shared/coursegen.js';
import { terrainFor } from '../public/js/shared/terrain.js';
import { BIOMES } from '../public/js/shared/biomes.js';
import { ShotSim, calibrateCarries, makeFlatRange, suggestedPower } from '../public/js/shared/ballistics.js';
import { CARRY } from '../public/js/shared/clubs.js';

calibrateCarries();

const NO_WIND = { dir: 0, speed: 0 };
const yd = m => Math.round(m / 0.9144);

/* Building a hole's terrain is the expensive part and every test wants the
   same 45 of them, so build each once. */
const terrainCache = new Map();
const terrainOf = (hole, biome) => {
  const k = biome.name + '|' + hole.number;
  if (!terrainCache.has(k)) terrainCache.set(k, terrainFor(hole, biome));
  return terrainCache.get(k);
};

/**
 * Play the shot the game would set up: its aim AND its power.
 *
 * This used to aim with defaultAim and then swing at full power regardless,
 * which was the same shot right up until the game learned to lay up. On a
 * hole with a lake across the driver landing zone the game now says "hit it
 * 195 m" and a full driver flies 274 into the water — and the test called
 * that a hole aimed into something. It is not: it is a hole the game told
 * you not to hit driver on, and the test was ignoring half of what it said.
 *
 * The caddie's number is what a player is shown, so the caddie's number is
 * what gets hit. Fully blocked holes still fail, which is the point.
 */
function teeShot(hole, biome, clubKey = 'DR') {
  const T = terrainOf(hole, biome);
  const reach = CARRY[clubKey] || 200;
  const plan = aimPlan(hole, hole.tee.x, hole.tee.z, reach);
  const power = suggestedPower(T, hole.tee.x, hole.tee.z, clubKey, plan.aim,
    NO_WIND, plan.dist, null, null) ?? 1;
  const r = new ShotSim(T, {
    x: hole.tee.x, z: hole.tee.z, clubKey, power, aim: plan.aim,
    faceDeg: 0, attackDeg: 0, wind: NO_WIND
  }).runToEnd();
  return { aim: plan.aim, plan, power, ...r };
}

test('nothing is standing in the way of the shot the game sets up', () => {
  /* The property that belongs to AIMING, isolated from everything else: a
     flushed shot along the default line should fly about as far as that club
     flies with nothing in front of it.  If it comes up dramatically short,
     something is in the way — which is exactly the bug this file exists for,
     where hole 1 pointed at a maple thirty metres from the tee and a perfect
     driver went nineteen metres.

     Deliberately NOT "the ball finishes on the fairway": a full driver on a
     hole that turns at 240 yds runs through into the rough, and that is
     correct golf rather than an aiming fault. */
  const flat = makeFlatRange();
  const clear = {};
  for (const k of ['DR', 'I7']) {
    clear[k] = new ShotSim(flat, { x: 0, z: 0, clubKey: k, power: 1, aim: 0,
      faceDeg: 0, attackDeg: 0, wind: NO_WIND }).runToEnd().carry;
  }

  const blocked = [];
  for (const course of allCourses()) {
    const biome = BIOMES[course.id];
    for (const h of course.holes) {
      const club = h.par < 4 ? 'I7' : 'DR';
      const r = teeShot(h, biome, club);
      /* Against the shot the game PLANNED, not the club's maximum. A hole
         that asks for a 195 m lay-up is not a blocked hole, and judging it
         against a 268 m driver says it is. */
      const want = Math.min(r.plan.dist, clear[club]) * 0.70;
      if (r.carry < want) {
        blocked.push(`${course.name} h${h.number} (par ${h.par}, ${h.yards}yds): ` +
          `${club} carried ${yd(r.carry)} yds of a clear ${yd(clear[club])} ` +
          `— ${r.reason}`);
      }
    }
  }
  assert.equal(blocked.length, 0,
    'the game aimed these tee shots into something:\n   ' + blocked.join('\n   '));
});

test('a par 3 is aimed at the green', () => {
  for (const course of allCourses()) {
    for (const h of course.holes) {
      if (h.par !== 3) continue;
      // short hole: the pin is nearer than any route point a club could reach,
      // so the aim must collapse to the straight line at the flag
      const aim = defaultAim(h, h.tee.x, h.tee.z, CARRY.DR || 200);
      const straight = Math.atan2(h.pin.x - h.tee.x, h.pin.z - h.tee.z);
      const off = Math.abs(((aim - straight + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      assert.ok(off < 0.02,
        `${course.name} h${h.number} is a par 3 but aims ` +
        `${(off * 180 / Math.PI).toFixed(1)}° off the flag`);
    }
  }
});

test('on the green the aim is at the cup, never down the fairway', () => {
  for (const course of allCourses()) {
    for (const h of course.holes) {
      // standing three metres from the cup, with a putter's reach
      const x = h.pin.x + 3, z = h.pin.z;
      const aim = defaultAim(h, x, z, CARRY.PT || 8);
      const straight = Math.atan2(h.pin.x - x, h.pin.z - z);
      const off = Math.abs(((aim - straight + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      assert.ok(off < 0.02,
        `${course.name} h${h.number}: a 3 m putt aims ` +
        `${(off * 180 / Math.PI).toFixed(1)}° away from the hole`);
    }
  }
});

test('the aim is always a usable number', () => {
  for (const course of allCourses()) {
    for (const h of course.holes) {
      for (const [x, z] of [[h.tee.x, h.tee.z], [h.pin.x, h.pin.z], [0, 0], [9999, -9999]]) {
        const a = defaultAim(h, x, z, 200);
        assert.ok(Number.isFinite(a), `${course.name} h${h.number} at ${x},${z} gave ${a}`);
      }
    }
  }
});
