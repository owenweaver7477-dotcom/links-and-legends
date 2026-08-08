/* =========================================================================
   wardrobe.mjs — the golfer you built is the golfer everyone sees
   -------------------------------------------------------------------------
   The look travels: browser -> server -> every other browser, and the server
   normalises it on the way through so a client cannot inject anything the
   renderer does not understand.  That normalisation is the contract, and it
   has to hold in both directions:

     - anything unrecognised falls back to a valid option rather than being
       dropped, because a missing field means a golfer with no head
     - a look saved by an OLDER client, which only knew four colours, must
       still produce a complete golfer — people have these stored
     - nothing hostile survives it

   Also guards the build budget: the whole wardrobe is procedural geometry,
   so adding styles must not add assets.
   ========================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseLook, randomLook, looksEarnedAt,
  CAPS, SHIRTS, SKINS, TROUSERS, SHOES,
  HAIR_COLORS, HAT_STYLES, HAIR_STYLES, ACCESSORIES, BODIES
} from '../public/js/shared/avatars.js';
import { UNLOCKS } from '../public/js/shared/unlocks.js';

const COLOUR_SLOTS = [
  ['cap', CAPS], ['shirt', SHIRTS], ['skin', SKINS],
  ['trousers', TROUSERS], ['hairColor', HAIR_COLORS], ['shoes', SHOES]
];
const STYLE_SLOTS = [
  ['hat', HAT_STYLES], ['hair', HAIR_STYLES], ['accessory', ACCESSORIES],
  ['body', BODIES]
];

/** Every slot present, and every value one the renderer actually knows. */
function assertComplete(look, why) {
  for (const [key, list] of COLOUR_SLOTS) {
    assert.ok(list.some(c => c.hex === look[key]),
      `${why}: ${key} = ${JSON.stringify(look[key])} is not a colour we ship`);
  }
  for (const [key, list] of STYLE_SLOTS) {
    assert.ok(list.some(c => c.id === look[key]),
      `${why}: ${key} = ${JSON.stringify(look[key])} is not a style we ship`);
  }
}

test('a look saved by an older client still dresses a whole golfer', () => {
  // exactly what used to be stored: four colours, nothing else
  const legacy = { cap: '#2b3f6b', shirt: '#e8735a', skin: '#dda87e', trousers: '#33415e' };
  const out = normaliseLook(legacy);
  assertComplete(out, 'legacy look');
  // and it must KEEP the choices that player made
  assert.equal(out.cap, '#2b3f6b');
  assert.equal(out.shirt, '#e8735a');
  assert.equal(out.skin, '#dda87e');
  assert.equal(out.trousers, '#33415e');
});

test('nothing at all still dresses a whole golfer', () => {
  for (const input of [null, undefined, {}, 'nonsense', 42, []]) {
    assertComplete(normaliseLook(input), `from ${JSON.stringify(input)}`);
  }
});

test('junk and hostile values are replaced, never passed through', () => {
  const nasty = normaliseLook({
    cap: '<script>alert(1)</script>',
    shirt: 'url(javascript:x)',
    skin: { toString: () => '#000000' },
    trousers: '#zzzzzz',
    hat: '../../etc/passwd',
    hair: '__proto__',
    hairColor: 'red; background: url(x)',
    accessory: 'constructor',
    shoes: 999
  });
  assertComplete(nasty, 'hostile look');
  for (const v of Object.values(nasty)) {
    /* Earned cosmetics — decal, trail, title, ball finish — are legitimately
       null when nothing is equipped, and "" would be a worse answer: it is a
       falsy string that every `if (look.decal)` still has to guard against
       and that reads as an id in a log. Everything else is a string. */
    assert.ok(v === null || typeof v === 'string', `${JSON.stringify(v)} is neither`);
    if (v !== null) {
      assert.ok(!/[<>(){};]/.test(v), `"${v}" reached the renderer with markup in it`);
    }
  }
});

test('an unearned cosmetic cannot be equipped by asking for it', () => {
  /* The gate that makes a hundred levels mean anything. normaliseLook only
     checks that an id EXISTS — it is shared code with no profile in reach —
     so the server calls looksEarnedAt with the level it holds on record.
     Skip that and every decal, trail and title in the game is one crafted
     socket message away from free. */
  const greedy = { decal: 'signature', trail: 'aurora', title: 'centurion', ballFinish: 'prism' };

  const newbie = looksEarnedAt(greedy, 0, 1);
  for (const k of ['decal', 'trail', 'title', 'ballFinish']) {
    assert.equal(newbie[k], null, `a level 1 player kept ${k}`);
  }

  const maxed = looksEarnedAt(greedy, 0, 100);
  assert.equal(maxed.decal, 'signature');
  assert.equal(maxed.trail, 'aurora');
  assert.equal(maxed.title, 'centurion');
  assert.equal(maxed.ballFinish, 'prism');

  // and the boundary is the level it says, not one either side
  const stripe = UNLOCKS.find(u => u.kind === 'decal' && u.id === 'stripe');
  assert.equal(looksEarnedAt({ decal: 'stripe' }, 0, stripe.at - 1).decal, null);
  assert.equal(looksEarnedAt({ decal: 'stripe' }, 0, stripe.at).decal, 'stripe');
});

test('everything the level table offers can actually be worn', () => {
  /* A reward nobody can equip is not a reward. Every unlock of a wearable
     kind has to survive normalisation into the field the renderer reads. */
  const FIELD = { decal: 'decal', trail: 'trail', title: 'title', ball: 'ballFinish' };
  for (const u of UNLOCKS) {
    const field = FIELD[u.kind];
    if (!field) continue;                       // emotes and hats live elsewhere
    assert.equal(looksEarnedAt({ [field]: u.id }, 0, u.at)[field], u.id,
      `${u.kind} "${u.name}" unlocks at ${u.at} but does not stick`);
  }
});

test('every option we ship survives a round trip unchanged', () => {
  for (const [key, list] of COLOUR_SLOTS) {
    for (const c of list) {
      assert.equal(normaliseLook({ [key]: c.hex })[key], c.hex,
        `${key} "${c.name}" is offered but not accepted`);
    }
  }
  for (const [key, list] of STYLE_SLOTS) {
    for (const c of list) {
      assert.equal(normaliseLook({ [key]: c.id })[key], c.id,
        `${key} "${c.name}" is offered but not accepted`);
    }
  }
});

test('normalising twice changes nothing', () => {
  // the server normalises what the client already normalised; if that were
  // not stable a look would drift every time it crossed the wire
  for (let i = 0; i < 40; i++) {
    const once = randomLook();
    assert.deepEqual(normaliseLook(once), once);
  }
});

test('the dice always produce a legal golfer', () => {
  for (let i = 0; i < 60; i++) assertComplete(randomLook(), 'random look');
});

test('colours are real hex and ids are plain slugs', () => {
  for (const [, list] of COLOUR_SLOTS) {
    for (const c of list) {
      assert.match(c.hex, /^#[0-9a-f]{6}$/i, `${c.name} is not a hex colour`);
      assert.ok(c.name && typeof c.name === 'string');
    }
  }
  for (const [, list] of STYLE_SLOTS) {
    for (const c of list) {
      assert.match(c.id, /^[a-z][a-z0-9-]*$/, `${c.id} is not a safe id`);
      assert.ok(c.name && typeof c.name === 'string');
    }
  }
});

test('no two options in a slot collide', () => {
  for (const [key, list] of COLOUR_SLOTS) {
    const hexes = list.map(c => c.hex.toLowerCase());
    assert.equal(new Set(hexes).size, hexes.length,
      `${key} offers the same colour twice, so one swatch can never be selected`);
  }
  for (const [key, list] of STYLE_SLOTS) {
    const ids = list.map(c => c.id);
    assert.equal(new Set(ids).size, ids.length, `${key} has a duplicate id`);
  }
});

test('the wardrobe is big enough to be worth having', () => {
  const combos = [...COLOUR_SLOTS, ...STYLE_SLOTS]
    .reduce((n, [, list]) => n * list.length, 1);
  assert.ok(combos > 1e6,
    `only ${combos.toLocaleString()} distinct golfers`);
});

/* ---------------------------------------------------------------- builds */

test('every build shares the shoulders, arms and club mount', () => {
  /* The club hangs off the right arm, and the stance is solved from a reach
     MEASURED off that rig (CLUB_REACH_FWD / CLUB_REACH_SIDE in main.js). If a
     build moved the shoulder anchor or changed the arm length, the club would
     stop landing on the ball for that build — a bug that was expensive to
     find the first time. So no build is allowed a shoulder or arm multiplier
     at all; the shape lives entirely in the torso, hips and legs. */
  for (const b of BODIES) {
    for (const banned of ['shoulder', 'armLen', 'reach', 'arm']) {
      assert.equal(b[banned], undefined,
        `build "${b.id}" defines ${banned}, which would move the club off the ball`);
    }
  }
});

test('the builds are actually different shapes', () => {
  const straight = BODIES.find(b => b.id === 'straight');
  const curved = BODIES.find(b => b.id === 'curved');
  const broad = BODIES.find(b => b.id === 'broad');
  assert.ok(curved, 'there must be a curved build');

  // it has to read as a different silhouette, not a recolour
  assert.ok(curved.waist < straight.waist * 0.9, 'curved needs a real waist');
  assert.ok(curved.hips > curved.waist, 'and hips wider than that waist');
  assert.ok(curved.chest < straight.chest, 'with narrower shoulders through the chest');
  assert.ok(curved.bust > 0, 'and a bust, or it is the same figure in a different shirt');
  assert.ok(curved.legLen > straight.legLen, 'legs take more of the same height');

  assert.ok(broad.waist > straight.waist && broad.limb > straight.limb,
    'broad must be genuinely heavier, not just wider');
});

test('every build has sane, finite proportions', () => {
  for (const b of BODIES) {
    for (const k of ['chest', 'waist', 'hips', 'hipSpread', 'legLen', 'limb', 'depth']) {
      const v = b[k];
      assert.ok(Number.isFinite(v) && v > 0.5 && v < 1.8,
        `${b.id}.${k} = ${v} is outside anything that renders as a person`);
    }
    assert.ok(b.bust >= 0 && b.bust < 0.2, `${b.id}.bust = ${b.bust}`);
  }
});
