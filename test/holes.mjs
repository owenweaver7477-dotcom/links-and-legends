/* =========================================================================
   holes.mjs — the holes have to be different from each other, and playable
   -------------------------------------------------------------------------
   Two things pull in opposite directions here and both are real failures.

   Generic. Every hole was a smooth graded corridor with a gaussian wobble on
   its elevation, and a gaussian around zero averages to nothing — so the
   average hole was flat, straight-ish and clean, and forty-five of them were
   the same hole. Variety is not a nice-to-have on a course you are asked to
   play a thousand rounds of; it is the product.

   Unplayable. The obvious fix — put things in the way — is also the obvious
   way to ruin it. A hump in the launch window is a driver into a hillside. A
   tree dead centre is a hole with no tee shot. A hollow on the green is a
   putt that cannot be read. Every blockage here has a keep-out it must
   respect, and this file is where those are enforced rather than remembered.
   ========================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allCourses, elevationAlongRoute, aimPlan, edgeScale, inEllipse }
  from '../public/js/shared/coursegen.js';

const HOLES = allCourses().flatMap(c => c.holes.map(h => ({ course: c, hole: h })));
const generated = HOLES.filter(({ hole }) => !hole.signature);

test('the holes are not all the same hole', () => {
  const kinds = new Set(generated.map(({ hole }) => hole.elevProfile.kind));
  assert.ok(kinds.size >= 5,
    `only ${kinds.size} elevation archetypes across ${generated.length} holes: ` +
    [...kinds].join(', '));

  // and no single archetype may dominate — a course of nothing but valleys
  // is exactly as repetitive as a course of nothing at all
  for (const k of kinds) {
    const n = generated.filter(({ hole }) => hole.elevProfile.kind === k).length;
    assert.ok(n < generated.length * 0.4, `${k} is ${n} of ${generated.length} holes`);
  }
});

test('the ground actually does something', () => {
  /* The complaint that started this was that holes were flat and generic.
     A hole is allowed to be gentle, but the SET is not allowed to be. */
  let dramatic = 0;
  for (const { hole } of generated) {
    let lo = Infinity, hi = -Infinity;
    for (let s = 0; s <= hole.total; s += 5) {
      const e = elevationAlongRoute(hole, s);
      lo = Math.min(lo, e); hi = Math.max(hi, e);
    }
    if (hi - lo >= 8) dramatic++;
  }
  assert.ok(dramatic >= generated.length * 0.4,
    `only ${dramatic} of ${generated.length} holes move 8 m or more vertically`);
});

test('an elevated tee is elevated', () => {
  const teeBoxes = generated.filter(({ hole }) => hole.elevProfile.kind === 'tee_box');
  assert.ok(teeBoxes.length > 0, 'no hole picked the elevated-tee archetype');
  for (const { course, hole } of teeBoxes) {
    const atTee = elevationAlongRoute(hole, 0);
    const outThere = elevationAlongRoute(hole, hole.total * 0.45);
    assert.ok(atTee - outThere > 3,
      `${course.name} h${hole.number} calls itself an elevated tee but only ` +
      `drops ${(atTee - outThere).toFixed(1)} m`);
  }
});

test('nothing rears up in the launch window', () => {
  /* The failure this prevents is specific and was seen: a crest profile
     shaped like sin(pi t) is STEEPEST AT THE TEE, so a hole that rises to a
     ridge puts that gradient in the first fifty metres and a flushed driver
     flies into the hill. Every climbing term is now flat at t = 0; this is
     the check that it stayed that way. */
  for (const { course, hole } of generated) {
    const at0 = elevationAlongRoute(hole, 0);
    for (let s = 5; s <= 95; s += 5) {
      const rise = elevationAlongRoute(hole, s) - at0;
      const grade = rise / s;
      /* 10% over the launch window is a genuinely uphill tee shot and the
         ball still clears it — aim.mjs flies the real simulation off every
         tee in the game and is the authority on that. This is the guard
         against the profile going back to 19%, which it was. */
      assert.ok(grade < 0.10,
        `${course.name} h${hole.number} climbs ${(grade * 100).toFixed(0)}% ` +
        `${s} m off the tee (${hole.elevProfile.kind})`);
    }
  }
});

test('blockages keep clear of the tee and the green', () => {
  for (const { course, hole } of generated) {
    const where = `${course.name} h${hole.number}`;
    const blockages = [
      ...(hole.mounds || []).map(m => ({ ...m, what: 'a mound' })),
      ...hole.bunkers.filter(b => b.cross).map(b => ({ ...b, what: 'a cross bunker' })),
      ...hole.trees.filter(t => t.blocker).map(t => ({ ...t, rx: t.r, rz: t.r, what: 'a sentinel' }))
    ];
    for (const b of blockages) {
      const reach = Math.max(b.rx, b.rz);
      for (const t of Object.values(hole.tees)) {
        const d = Math.hypot(b.x - t.x, b.z - t.z);
        assert.ok(d - reach > 55,
          `${where}: ${b.what} sits ${Math.round(d - reach)} m from the ${
            Object.keys(hole.tees).find(k => hole.tees[k] === t)} tee`);
      }
      const dg = Math.hypot(b.x - hole.green.x, b.z - hole.green.z);
      assert.ok(dg - reach > hole.green.r + 4,
        `${where}: ${b.what} reaches the green complex`);
    }
  }
});

test('a mound is a mound and not a wall', () => {
  /* terrain.js caps a mound with a cosine, whose steepest face is
     h·pi/(2r) on the short axis. Anything past ~30% is unwalkable and a ball
     cannot come to rest on it, which turns fairway shaping into a hazard. */
  let total = 0;
  for (const { course, hole } of generated) {
    for (const m of hole.mounds || []) {
      total++;
      const grade = Math.abs(m.h) * Math.PI / (2 * Math.min(m.rx, m.rz));
      assert.ok(grade < 0.32,
        `${course.name} h${hole.number}: a mound with a ${(grade * 100).toFixed(0)}% face`);
    }
  }
  assert.ok(total >= 20, `only ${total} mounds across ${generated.length} holes`);
});

test('a sentinel never stands in the middle of the fairway', () => {
  /* There is always a side of it to play down. That is the difference
     between a hazard and a hole with no tee shot. */
  let found = 0;
  for (const { course, hole } of generated) {
    for (const t of hole.trees.filter(t => t.blocker)) {
      found++;
      // distance from the centreline, measured the way the physics does
      let near = Infinity;
      for (const p of hole.route) {
        near = Math.min(near, Math.hypot(p[0] - t.x, p[1] - t.z));
      }
      assert.ok(near > hole.fairwayWidth * 0.2,
        `${course.name} h${hole.number}: a sentinel ${near.toFixed(1)} m from ` +
        `the centreline of a ${hole.fairwayWidth.toFixed(0)} m fairway`);
    }
  }
  assert.ok(found > 0, 'no hole in the game has a sentinel tree');
});

test('every hole is still generated identically everywhere', () => {
  /* The whole architecture rests on this: the server and every client build
     the course from the seed and must agree byte for byte. New shaping is
     new opportunity to introduce something non-deterministic. */
  const again = allCourses.call(null);
  const a = JSON.stringify(HOLES.map(({ hole }) => [hole.mounds, hole.elevProfile]));
  const b = JSON.stringify(again.flatMap(c => c.holes).map(h => [h.mounds, h.elevProfile]));
  assert.equal(a, b);
});

test('the game never sets up a shot that cannot advance the ball', () => {
  /* The worst bug this project has had, and it shipped for one commit.
     aimPlan walks the fairway looking for the furthest point it can reach
     over short grass. If the very first step fails — standing behind a
     sentinel tree, say — it used to hand back the next route sample, about
     three metres away. Harmless while the plan only set the AIM. Fatal once
     the club and the caddie's power followed it: the game handed you a lob
     wedge a hundred and eighty metres out and told you to hit it three
     metres, and you tapped forward until the stroke cap ended the hole.
     Barwon Sandbelt's third did it every single time.

     So: from anywhere on any fairway on any course, the shot the game sets
     up must be worth playing. */
  const bad = [];
  for (const { course, hole } of HOLES) {
    for (let s = 0; s < hole.total - 10; s += 12) {
      let i = 0;
      while (i < hole.cum.length - 1 && hole.cum[i] < s) i++;
      const [x, z] = hole.route[i];
      const toPin = Math.hypot(hole.pin.x - x, hole.pin.z - z);
      const plan = aimPlan(hole, x, z, 210);
      if (toPin > 30 && plan.dist < 30) {
        bad.push(`${course.name} h${hole.number} at ${Math.round(s)}m: ` +
          `${plan.dist.toFixed(0)} m plan with ${toPin.toFixed(0)} m to the pin`);
      }
    }
  }
  assert.deepEqual(bad, [], 'the game sets up an unplayable shot here:\n   ' + bad.join('\n   '));
});

test('a sentinel is a tree, not a bush the size of a house', () => {
  /* Sentinels picked freely from the biome's species list, and a links gorse
     — a knee-high shrub whose crown is 0.70 of its height — planted at the
     sandbelt's 22 m tree height became a bush with a FIFTEEN METRE radius
     standing in the middle of the fairway. It blocked every line down the
     hole. Two rules: woody species only, and never wider than a third of the
     fairway whatever the species table says. */
  for (const { course, hole } of generated) {
    for (const t of hole.trees.filter(t => t.blocker)) {
      assert.ok(t.r <= hole.fairwayWidth * 0.34 + 0.01,
        `${course.name} h${hole.number}: a ${t.species} sentinel ${t.r.toFixed(1)} m ` +
        `across a ${hole.fairwayWidth.toFixed(0)} m fairway`);
    }
  }
});

test('a green is not a circle, and a bunker is not an oval', () => {
  /* A perfect ellipse is the one shape that never occurs on a golf course,
     and at size it reads as a disc stamped into the grass. The green is the
     most-looked-at object in the game and it was a stamped disc.

     The wobble only ever cuts INWARD — see edgeScale. That direction is not
     cosmetic: everything that keeps a hazard clear of a tee or a green is
     computed from rx and rz, so a shape allowed to bulge past them silently
     invalidates every one of those clearances at once. The first version
     bulged and the aim test immediately found a driver flying into a bunker
     that had grown into the launch window. */
  let wobbled = 0;
  for (const { course, hole } of generated) {
    for (const e of [hole.green, ...hole.bunkers]) {
      assert.ok(Array.isArray(e.wob) && e.wob.length === 4,
        `${course.name} h${hole.number}: a shape with no edge wobble`);
      wobbled++;
      // sample the edge all the way round: never outside the declared ellipse
      for (let a = 0; a < 360; a += 10) {
        const th = a * Math.PI / 180;
        const k = edgeScale(e, Math.cos(th), Math.sin(th));
        assert.ok(k <= 1.0000001,
          `${course.name} h${hole.number}: edge bulges to ${k.toFixed(3)} of its radius`);
        assert.ok(k > 0.55,
          `${course.name} h${hole.number}: edge collapses to ${k.toFixed(3)}`);
      }
    }
  }
  assert.ok(wobbled > 200, `only ${wobbled} shapes carry a wobble`);
});

test('the sand you can see is the sand the ball reacts to', () => {
  /* The green-and-bunker version of the tree-canopy bug. surfacemap paints
     the outline and inEllipse rules on the lie, and if they use different
     shapes the ball breaks for the fringe a metre before the fringe you can
     see. They read the SAME edgeScale, and this is the check that they
     still do: well inside the wobbled edge must be in, well outside must be
     out, all the way round every shape in the game. */
  let probes = 0, bad = [];
  for (const { course, hole } of HOLES) {
    for (const b of hole.bunkers) {
      const cs = Math.cos(b.rot || 0), sn = Math.sin(b.rot || 0);
      for (let a = 0; a < 360; a += 30) {
        const th = a * Math.PI / 180, ct = Math.cos(th), st = Math.sin(th);
        const at = f => {
          const lx = b.rx * f * ct, lz = b.rz * f * st;
          return [b.x + lx * cs - lz * sn, b.z + lx * sn + lz * cs];
        };
        const inn = at(0.55), out = at(1.45);
        probes += 2;
        if (!inEllipse(inn[0], inn[1], b)) bad.push(`${course.name} h${hole.number} inside-but-out`);
        if (inEllipse(out[0], out[1], b)) bad.push(`${course.name} h${hole.number} outside-but-in`);
      }
    }
  }
  assert.ok(probes > 1000, `only ${probes} probes`);
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} of ${probes} probes disagree`);
});
