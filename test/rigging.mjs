/* =========================================================================
   rigging.mjs — the skeleton, and the two things that were geometrically
   impossible before it changed
   -------------------------------------------------------------------------
   avatar.js needs a live document to instantiate, which Node has none of,
   so this reads the source the way test/clubdecal.mjs already does — and
   re-derives the geometry, which is the part that actually matters here.

   TWO CLAIMS.

   There is a PELVIS. The rig had one group holding the hip box, the chest,
   the head and all four limbs, so turning the shoulders turned the legs and
   the code faked separation by counter-rotating both legs — which holds the
   feet still and leaves the hip box rotating with the chest. A golfer's
   pelvis and shoulders were welded together.

   And the HANDS CAN REACH THE CLUB. They could not: the club hung 0.355H
   below the trail shoulder, the shoulders sit 0.262 either side of centre,
   and an arm reaches 0.30H — so the grip was 0.76 from the lead shoulder
   against a 0.53 reach. No pose could fix that, which is why every golfer
   swung one-handed with the other arm keeping time near the chest.
   ========================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AVATAR_HEIGHT } from '../public/js/shared/avatars.js';

const SRC = readFileSync(new URL('../public/js/client/avatar.js', import.meta.url), 'utf8');
const num = (re, what) => {
  const m = SRC.match(re);
  assert.ok(m, `could not find ${what} in avatar.js`);
  return Number(m[1]);
};

/* The three numbers the whole arm/club geometry rests on. */
const H = AVATAR_HEIGHT;
const SHOULDER_X = num(/this\.armL = limb\([^,]+,[^,]+,[^,]+,\s*([\d.]+),/, 'the shoulder offset');
const ARM = H * num(/this\._armLen = H \* ([\d.]+);/, 'the arm length');
const GRIP_DROP = H * num(/const GRIP_DROP = AVATAR_HEIGHT \* ([\d.]+);/, 'GRIP_DROP');
const GRIP_RISE = H * num(/const GRIP_RISE = AVATAR_HEIGHT \* ([\d.]+);/, 'GRIP_RISE');

test('the rig has a pelvis, and the legs hang off it', () => {
  assert.ok(/this\.hips = new THREE\.Group\(\)/.test(SRC), 'no pelvis group');
  assert.ok(/this\.torso = new THREE\.Group\(\)/.test(SRC), 'no torso group');
  assert.ok(/this\.body\.add\(this\.hips\)/.test(SRC), 'the pelvis is not on the body');
  assert.ok(/this\.hips\.add\(this\.torso\)/.test(SRC), 'the torso does not hang off the pelvis');
  assert.ok(/this\.hips\.add\(this\.legL, this\.legR\)/.test(SRC),
    'the legs are not on the pelvis — turning the shoulders will turn them');
  assert.ok(/this\.torso\.add\(this\.armL, this\.armR\)/.test(SRC),
    'the arms are not on the torso, so they cannot turn against the hips');
});

test('the leg counter-rotation hack is gone', () => {
  /* It held the feet still while the hip box rotated with the chest. With a
     real pelvis the legs simply follow it and there is nothing to cancel. */
  assert.equal(/legL\.rotation\.y = -\(/.test(SRC), false,
    'the legs are still being counter-rotated to fake hip separation');
  assert.ok(/this\.hips\.rotation\.y = P\.yaw/.test(SRC), 'yaw does not drive the pelvis');
  assert.ok(/this\.torso\.rotation\.y = P\.twist/.test(SRC), 'twist does not drive the torso');
});

test('the spine leans, rather than the whole figure toppling', () => {
  /* Tilting `body` tilted the legs with it, so a golfer bent over the ball
     had both feet pivoting off the turf. */
  assert.ok(/this\.torso\.rotation\.x = \(P\.bodyRx/.test(SRC), 'the lean is not on the torso');
  assert.ok(/this\.hips\.rotation\.x = \(P\.bodyRx/.test(SRC), 'the pelvis takes none of the lean');
  // and the two shares add up to exactly the lean that was authored
  const t = num(/this\.torso\.rotation\.x = \(P\.bodyRx \+ L\.bodyRx\) \* ([\d.]+)/, 'the torso share');
  const h = num(/this\.hips\.rotation\.x = \(P\.bodyRx \+ L\.bodyRx\) \* ([\d.]+)/, 'the pelvis share');
  assert.ok(Math.abs(t + h - 1) < 1e-9,
    `the lean sums to ${t + h} rather than 1 — every clip's spine angle just changed`);
});

test('BOTH hands can physically reach the grip', () => {
  /* The geometry, re-derived rather than asserted from the source. Two
     spheres of radius ARM centred 2*SHOULDER_X apart intersect in a lens
     whose lowest point on the centreline is sqrt(ARM² - SHOULDER_X²) below
     the shoulder line. A grip below that is unreachable by BOTH arms, and a
     grip off the centreline is unreachable by the far one. */
  const maxDrop = Math.sqrt(ARM * ARM - SHOULDER_X * SHOULDER_X);
  assert.ok(GRIP_DROP < maxDrop,
    `the grip hangs ${GRIP_DROP.toFixed(3)} below the shoulders and the arms can only ` +
    `reach ${maxDrop.toFixed(3)} on the centreline — no pose can put a hand on it`);
  // reachable, but not so close that the arms are folded up at the chest
  assert.ok(GRIP_DROP > maxDrop * 0.8,
    'the grip is so high the arms would be bent double holding it');

  const reach = Math.hypot(SHOULDER_X, GRIP_DROP);
  assert.ok(reach <= ARM,
    `each hand is ${reach.toFixed(3)} from its shoulder against a ${ARM.toFixed(3)} reach`);
});

test('the club hangs between the shoulders, not off one of them', () => {
  assert.ok(/this\.hands = new THREE\.Group\(\)/.test(SRC), 'no hands group');
  assert.ok(/this\.hands\.add\(this\.club\)/.test(SRC), 'the club is not in the hands');
  assert.equal(/this\.armR\.add\(this\.club\)/.test(SRC), false,
    'the club still hangs off the trail shoulder — the lead hand can never reach it, ' +
    'and solving the trail arm would move the target it is aiming at');
  assert.ok(/this\.club\.position\.set\(0, -GRIP_DROP/.test(SRC),
    'the club does not hang at GRIP_DROP');
});

test('every shaft is lengthened by exactly what the grip rose', () => {
  /* The grip moved up from 0.355H to GRIP_DROP. If the shaft did not gain
     that back, every club in the game would stop reaching the ball. */
  const OLD_DROP = H * 0.355;
  assert.ok(Math.abs((OLD_DROP - GRIP_DROP) - GRIP_RISE) < 0.02,
    `the grip rose ${(OLD_DROP - GRIP_DROP).toFixed(3)} and the shaft gained ` +
    `${GRIP_RISE.toFixed(3)} — the club head no longer meets the ball`);
  assert.ok(/\) \+ GRIP_RISE;/.test(SRC), 'setClub does not add GRIP_RISE to the shaft');
});

test('both arms are solved onto the grip, and the solver is a real one', () => {
  assert.ok(/reachTo\(armL, this\._armLen, _ikTarget\)/.test(SRC), 'the lead arm is not solved');
  assert.ok(/reachTo\(armR, this\._armLen, _ikTarget\)/.test(SRC), 'the trail arm is not solved');
  // two-link solve: the fold comes from the law of cosines, not from a guess
  assert.ok(/Math\.acos\(Math\.min\(1, Math\.max\(0, d \/ len\)\)\)/.test(SRC),
    'reachTo does not solve the elbow fold from the distance');
  // and the scratch objects are module level, not per-call
  assert.ok(/^const _ikQ = new THREE\.Quaternion\(\);/m.test(SRC),
    'the IK allocates per call — that is garbage every frame, per avatar');
});

test('the swing turns the hips and the shoulders by different amounts', () => {
  /* Re-derived from the two curves in the source, because the whole point
     of the pelvis is the difference between them. */
  const shoulders = (b, f) => -0.15 - 1.30 * b + 1.45 * Math.pow(f, 1.30);
  const hips = (b, f) => -0.15 - 0.62 * b + 1.32 * Math.pow(f, 0.70);
  assert.ok(/const shoulderTurn = -0\.15 - 1\.30 \* b \+ 1\.45 \* Math\.pow\(f, 1\.30\)/.test(SRC),
    'the shoulder curve in avatar.js no longer matches the one asserted here');
  assert.ok(/const hipTurn      = -0\.15 - 0\.62 \* b \+ 1\.32 \* Math\.pow\(f, 0\.70\)/.test(SRC),
    'the hip curve in avatar.js no longer matches the one asserted here');

  // at the top: coiled, shoulders well past the hips
  const coil = shoulders(1, 0) - hips(1, 0);
  assert.ok(coil < -0.5,
    `only ${(-coil * 57.3).toFixed(0)} degrees of coil at the top — the pelvis exists to carry more`);

  // through the ball: the HIPS lead, which is the recognisable half
  const mid = shoulders(0, 0.35) - hips(0, 0.35);
  assert.ok(mid < 0, 'the shoulders are ahead of the hips through impact — they must trail');

  // and the finish is square
  assert.ok(Math.abs(shoulders(0, 1) - hips(0, 1)) < 0.25,
    'the body never squares up at the finish — it ends permanently twisted');
});

test('a melee comes off the ground, not out of the chest', async () => {
  /* Every clip in SHOVE_CLIPS expressed its whole rotation as `twist`,
     which — before the rig had a pelvis — meant the torso turned and the
     legs were counter-rotated to hold the feet. So a barge was a man
     swivelling his chest at somebody, and there was nowhere to put the
     part that comes off the ground. */
  const { SHOVE_CLIPS, blankPose } = await import('../public/js/client/celebrations.js');
  for (const [name, clip] of Object.entries(SHOVE_CLIPS)) {
    let sawYaw = false, sawTwist = false, leadFrames = 0, sampled = 0;
    for (let i = 1; i < 40; i++) {
      const k = i / 40;
      const P = blankPose({});
      clip.pose(P, k);
      if (Math.abs(P.yaw || 0) > 1e-6) sawYaw = true;
      if (Math.abs(P.twist || 0) > 1e-6) sawTwist = true;
      /* Wherever the body is really turning, the PELVIS should be carrying
         at least its share. Sampled on magnitude rather than sign: half
         these clips are reactions and drive the other way. */
      if (Math.abs(P.yaw || 0) > 0.05) {
        sampled++;
        if (Math.abs(P.yaw) >= Math.abs(P.twist || 0) * 0.6) leadFrames++;
      }
    }
    assert.ok(sawYaw, `"${name}" never turns the pelvis — it is all chest`);
    assert.ok(sawTwist, `"${name}" has no shoulder coil over the pelvis at all`);
    assert.ok(sampled > 0, `"${name}" never turns the pelvis by a meaningful amount`);
    assert.ok(leadFrames / sampled > 0.8,
      `"${name}" leaves the pelvis behind through the drive on ` +
      `${sampled - leadFrames} of ${sampled} frames`);
  }
});

test('the club is put down for a melee, and does not whip about otherwise', () => {
  /* A barge with a driver still held in front of you is a golfer shoving
     somebody while carrying a club — and on this rig, where the club hangs
     between the shoulders and the arms swing independently, it reads as the
     club being flung about rather than held. */
  assert.ok(/this\._melee = !!SHOVE_CLIPS\[name\]/.test(SRC),
    'nothing marks a melee clip, so the club cannot be put down for one');
  assert.ok(/this\.club\.visible = \(!!g \|\| !moving\) && !\(this\._melee && this\.cel\)/.test(SRC),
    'the club stays in hand through a melee');
  /* And outside the swing the hands EASE toward a carried rest pose rather
     than snapping to whatever the arms are doing — an arm thrown to -1.7
     radians used to swing the club through a horizontal arc like a spear. */
  assert.ok(/this\.hands\.rotation\.x \+= \(rest - this\.hands\.rotation\.x\)/.test(SRC),
    'the hands snap to the arm pose instead of easing — the club will whip');
});

/* ═══════════════════════════════════════════ WINDING, NOT A THEME BUG ═══
   "My character goes transparent when I turn sideways" was never about
   opacity — nothing on the body is transparent. It was the ±X faces of the
   chamfered box (every torso, arm and leg segment) wound BACKWARDS: their
   computed normal pointed INTO the box instead of out of it, so THREE's
   default FrontSide culling dropped them. A face pointing the wrong way is
   invisible from every camera outside the box on that axis — which a
   front-on view never looks at, and a side-on view looks at directly. Y and
   Z's point order happened to give an outward normal; carrying the same
   (second, third)-axis order over to X does not, because X, Y, Z do not
   cycle the same way.

   Re-derived from the SOURCE rather than asserted by eye, so a future edit
   to the face table cannot reintroduce this without the test computing the
   same cross product and catching it. */
test('every chamfered-box face winds outward, not inward', () => {
  const CH = Number(SRC.match(/const CHAMFER = ([\d.]+);/)[1]);
  const i = 0.5 - CH, o = 0.5;
  // faces: [axis, sign, [[sx,sy,sz], ...four corners...]]
  const m = SRC.match(/const faces = \[([\s\S]*?)\n  \];/);
  assert.ok(m, 'no faces table in chamferedBox');
  const rowRe = /\['([xyz])',\s*(-?1),\s*(\[\[.+?\]\])\]/g;
  const rows = [...m[1].matchAll(rowRe)];
  assert.equal(rows.length, 6, `found ${rows.length} face rows, expected 6`);

  const AXIS = { x: 0, y: 1, z: 2 };
  for (const [, axis, signStr, ptsSrc] of rows) {
    const sign = Number(signStr);
    const octants = JSON.parse(ptsSrc);
    // corner point for octant [sx,sy,sz], picking the vertex the real
    // corner-builder assigns to `axis` — offset o along `axis`, i elsewhere
    const point = ([sx, sy, sz]) => {
      const s = { x: sx, y: sy, z: sz };
      const v = [0, 0, 0];
      for (const a of ['x', 'y', 'z']) v[AXIS[a]] = s[a] * (a === axis ? o : i);
      return v;
    };
    const [p0, p1, p2] = octants.slice(0, 3).map(point);
    const e1 = p1.map((v, k) => v - p0[k]);
    const e2 = p2.map((v, k) => v - p1[k]);
    const normal = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0]
    ];
    const outward = normal[AXIS[axis]] * sign;
    assert.ok(outward > 0,
      `face ['${axis}', ${sign}] winds inward (normal[${axis}] = ${normal[AXIS[axis]].toFixed(3)}) — ` +
      'this is the exact bug that made a side-on view of the golfer see through the body');
  }
});
