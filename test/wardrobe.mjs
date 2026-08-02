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
  normaliseLook, randomLook,
  CAPS, SHIRTS, SKINS, TROUSERS, SHOES,
  HAIR_COLORS, HAT_STYLES, HAIR_STYLES, ACCESSORIES
} from '../public/js/shared/avatars.js';

const COLOUR_SLOTS = [
  ['cap', CAPS], ['shirt', SHIRTS], ['skin', SKINS],
  ['trousers', TROUSERS], ['hairColor', HAIR_COLORS], ['shoes', SHOES]
];
const STYLE_SLOTS = [
  ['hat', HAT_STYLES], ['hair', HAIR_STYLES], ['accessory', ACCESSORIES]
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
    assert.equal(typeof v, 'string');
    assert.ok(!/[<>(){};]/.test(v), `"${v}" reached the renderer with markup in it`);
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
