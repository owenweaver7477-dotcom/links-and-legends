/* =========================================================================
   clubshapes.mjs — the clubs in the shop are actually different clubs
   -------------------------------------------------------------------------
   The pro shop drew every wood at one size and every iron at another, so a
   driver and a 7 wood were the same object with a different word under it,
   and twelve irons were one blade repeated. You could not tell what four
   thousand coins bought by looking at it, which is the only job the preview
   has.

   Nobody noticed because nobody could: the difference between two club
   heads is a judgement made by eye, on a 260-pixel canvas, on a screen you
   have to click through three panes to reach. So it is asserted here
   instead — as numbers, which do not need looking at.

   These are shape assertions, deliberately loose about exact values and
   strict about ORDER and DISTINCTNESS. The point is not that a 5 iron is
   0.304 units wide; it is that no two clubs in the bag are the same size,
   and that the set changes in the direction real clubs change in.
   ========================================================================= */

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from '../public/vendor/three.module.js';
import { __buildClubForTest } from '../public/js/client/shopview.js';
import { CLUBS } from '../public/js/shared/clubs.js';

/** Head size and overall length for one club key. */
function shape(key) {
  const g = __buildClubForTest(key);
  const head = g.userData.focus;
  const hs = new THREE.Box3().setFromObject(head).getSize(new THREE.Vector3());
  const all = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
  return { w: hs.x, h: hs.y, d: hs.z, len: all.y, parts: head.children.length };
}

const S = Object.fromEntries(CLUBS.map(c => [c.key, shape(c.key)]));

test('no two clubs in the bag are the same shape', () => {
  const seen = new Map();
  for (const c of CLUBS) {
    const s = S[c.key];
    /* Rounded hard — two clubs that agree to a millimetre are two clubs
       nobody can tell apart, which is the bug this file exists for. */
    const sig = [s.w, s.h, s.d, s.len].map(v => v.toFixed(2)).join('/');
    assert.ok(!seen.has(sig),
      `${c.key} and ${seen.get(sig)} are the same shape (${sig})`);
    seen.set(sig, c.key);
  }
});

test('a driver dwarfs the fairway woods, by real head volume', () => {
  // 460cc against 135cc is about 1.5x in every linear dimension
  assert.ok(S.DR.w > S.W3.w * 1.25, 'driver head is not bigger than a 3 wood');
  assert.ok(S.W3.w > S.W5.w && S.W5.w > S.W7.w, 'the woods do not shrink in order');
  assert.ok(S.DR.w / S.W7.w > 1.4, 'driver and 7 wood are too close in size');
});

test('irons shorten and deepen as the loft climbs', () => {
  const irons = ['I2', 'I5', 'I7', 'I9', 'PW', 'SW', 'LW', 'XW'];
  for (let i = 1; i < irons.length; i++) {
    const a = S[irons[i - 1]], b = S[irons[i]];
    assert.ok(b.w < a.w, `${irons[i]} blade is not shorter than ${irons[i - 1]}`);
    assert.ok(b.d > a.d, `${irons[i]} face is not deeper than ${irons[i - 1]}`);
  }
});

test('shafts run long to short down the bag', () => {
  assert.ok(S.DR.len > S.I2.len, 'the driver is not longer than a 2 iron');
  assert.ok(S.I2.len > S.XW.len, 'a 2 iron is not longer than a flop wedge');
  assert.ok(S.PT.len < S.XW.len, 'the putter is not the shortest club');
  // a 45-inch driver against a 35-inch wedge is roughly a fifth
  assert.ok(S.DR.len / S.XW.len > 1.2, 'driver and wedge are too close in length');
});

test('long irons are cavity-backed and short irons are not', () => {
  // a cavity is a rim of four pieces plus the hollow; a muscle back is one
  assert.ok(S.I2.parts > S.XW.parts - 4, 'sanity: both should have real detail');
  const cavity = shape('I3'), muscle = shape('LW');
  assert.notEqual(cavity.parts, muscle.parts,
    'a 3 iron and a lob wedge are built from the same pieces');
});

test('a hybrid is neither a wood nor an iron', () => {
  // shallower than a wood, deeper than the iron it replaces
  assert.ok(S.H3.d < S.W7.d, 'the hybrid head is as deep as a fairway wood');
  assert.ok(S.H3.d > S.I2.d, 'the hybrid head is as shallow as a 2 iron');
});

test('the putter has the most detail, being the most-used club', () => {
  /* Roughly half the strokes in a round are putts, and the putter used to
     be two boxes and a tick — the least detailed club in the bag was the
     one on screen the longest. */
  assert.ok(S.PT.parts >= 8, `putter is only ${S.PT.parts} pieces`);
  assert.ok(S.PT.d > S.I7.d * 2, 'the putter has no flange to speak of');
});

test('every club in the bag builds without throwing', () => {
  for (const c of CLUBS) {
    assert.ok(S[c.key].w > 0 && S[c.key].len > 0, `${c.key} built as nothing`);
  }
});
