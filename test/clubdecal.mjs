/* =========================================================================
   clubdecal.mjs — the club's finish: a real pattern, in the right places
   -------------------------------------------------------------------------
   Both avatar.js and shaftdecals.js were already built and working — one
   real attachment-point mesh on the club (avatar.js's clubDecal), one
   canvas-drawn, per-design, colour-tinted texture per unlock (shaftdecals.js,
   its own header comment explains the bug it replaced: every design used to
   render as the same flat tinted rectangle). Persistence and level/case
   gating are already covered generically for the `decal` field alongside
   trail/title/ballFinish in wardrobe.mjs.

   What had no coverage at all: that every decal UNLOCK actually has a
   drawn PATTERN behind it (the exact bug this file's history describes —
   an id with no matching DRAW function silently falls back to the flat
   rectangle it was supposed to replace), and that the band's attachment
   point actually sits on the shaft rather than floating in space or
   burying itself in the grip.

   avatar.js needs a live `document` (canvas, DOM) to construct an Avatar
   at all, which a Node test doesn't have — same situation test/pinflag.mjs
   already solved for the flagstick, by re-deriving the pure geometry from
   the source rather than instantiating the class. Same technique here. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SHAFT_DECAL_IDS } from '../public/js/client/shaftdecals.js';
import { UNLOCKS } from '../public/js/shared/unlocks.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AVATAR_SRC = readFileSync(join(__dirname, '../public/js/client/avatar.js'), 'utf8');
const SHOP_SRC = readFileSync(join(__dirname, '../public/js/client/shopview.js'), 'utf8');

test('every decal unlock has an actual drawn pattern, not just a colour', () => {
  const unlockIds = UNLOCKS.filter(u => u.kind === 'decal').map(u => u.id);
  assert.ok(unlockIds.length > 0, 'no decal unlocks found — did unlocks.js change shape?');
  for (const id of unlockIds) {
    assert.ok(SHAFT_DECAL_IDS.includes(id),
      `"${id}" is a decal unlock with no DRAW pattern — shaftDecalTexture will ` +
      `silently fall back to a flat rectangle for it, the exact bug this file replaced`);
  }
});

test('every drawn pattern is actually reachable as a real unlock', () => {
  const unlockIds = new Set(UNLOCKS.filter(u => u.kind === 'decal').map(u => u.id));
  for (const id of SHAFT_DECAL_IDS) {
    assert.ok(unlockIds.has(id), `"${id}" has a DRAW pattern but no matching decal unlock — dead code`);
  }
});

/** Pulls the (h, y) — scale height and local Y position — out of a
 *  `part(mat, w, h, d, x, y, z)` call for one club part, straight from the
 *  source. avatar.js's part() scales a unit box, so the part's local Y
 *  extent is exactly [y - h/2, y + h/2]. */
function partExtent(varName) {
  const re = new RegExp(`this\\.${varName}\\s*=\\s*part\\([^,]+,\\s*([-\\d.]+),\\s*([-\\d.]+),\\s*[-\\d.]+,\\s*[-\\d.]+,\\s*([-\\d.]+),`);
  const m = AVATAR_SRC.match(re);
  assert.ok(m, `couldn't find "this.${varName} = part(...)" in avatar.js — did the club model change shape?`);
  const h = Number(m[2]), y = Number(m[3]);
  return [y - h / 2, y + h / 2];
}

test('the decal sleeve covers the shaft, and stops at the grip', () => {
  const [gripLo] = partExtent('clubGrip');
  const [shaftLo, shaftHi] = partExtent('clubShaft');
  const [decalLo, decalHi] = partExtent('clubDecal');

  assert.ok(decalLo >= shaftLo && decalHi <= shaftHi,
    `decal sleeve [${decalLo}, ${decalHi}] is not fully within the shaft [${shaftLo}, ${shaftHi}]`);
  assert.ok(decalHi <= gripLo,
    `decal sleeve top (${decalHi}) overlaps the grip (grip starts at ${gripLo})`);
  /* And it is a SLEEVE, not a band. A decal that covers a tenth of the
     shaft is a smudge you have to be told the location of, which is what
     this used to be — the band was 0.10 against a 0.80 shaft. */
  assert.ok((decalHi - decalLo) >= (shaftHi - shaftLo) * 0.9,
    `the decal covers ${(((decalHi - decalLo) / (shaftHi - shaftLo)) * 100).toFixed(0)}% of ` +
    'the shaft — a decal is the club\'s finish, not a ring somewhere down it');
});

test('the decal sleeve is proud of the shaft, so it never z-fights it', () => {
  const width = v => {
    const m = AVATAR_SRC.match(new RegExp(`this\\.${v}\\s*=\\s*part\\([^,]+,\\s*([-\\d.]+),`));
    assert.ok(m, `couldn't find this.${v} = part(...)`);
    return Number(m[1]);
  };
  const shaft = width('clubShaft'), decal = width('clubDecal');
  assert.ok(decal > shaft,
    `the decal sleeve (${decal}) is not wider than the shaft (${shaft}) — two coplanar ` +
    'surfaces flicker against each other as the camera moves');
  assert.ok(decal - shaft < 0.01,
    `the decal sleeve stands ${(decal - shaft).toFixed(3)} off the shaft — that reads as a tube ` +
    'around the club rather than as its finish');
});

test('the head wears the decal too, on a plate shaped per club', () => {
  /* A decal that stops at the hosel is a wrapped shaft, not a finished club.
     _shapeDecal picks a different surface per club type — a wood's crown, a
     blade's cavity back, the putter's flange — because those are three
     genuinely different shapes and one plate cannot suit all of them. That
     branching is the reason decals can be set per club CLASS at all. */
  assert.ok(/this\.clubDecalHead\s*=\s*part\(/.test(AVATAR_SRC),
    'the club head has no decal plate — the decal stops at the hosel');
  const fn = AVATAR_SRC.match(/_shapeDecal\(c\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(fn, 'no _shapeDecal in avatar.js — the head plate is one size for every club');
  const body = fn[0];
  assert.ok(/c\.putter/.test(body), '_shapeDecal does not special-case the putter');
  assert.ok(/c\.type === 'wood'/.test(body), '_shapeDecal does not special-case the woods');
  // and every branch must place it, not just scale it
  assert.equal((body.match(/d\.position\.set\(/g) || []).length,
    (body.match(/d\.scale\.set\(/g) || []).length,
    'a _shapeDecal branch scales the plate without placing it');
});

test('a decal is resolved per club class, falling through to the bag-wide one', async () => {
  const { normaliseLook, clubDecalFor } = await import('../public/js/shared/avatars.js');
  const look = normaliseLook({
    decal: 'stripe',
    clubDecals: { putter: 'goldleaf', wedges: 'tartan' }
  });
  assert.equal(clubDecalFor(look, 'PT'), 'goldleaf', 'the putter ignores its own override');
  assert.equal(clubDecalFor(look, 'SW'), 'tartan');
  assert.equal(clubDecalFor(look, 'LW'), 'tartan', 'a class override must cover its whole class');
  assert.equal(clubDecalFor(look, 'DR'), 'stripe', 'a class with no override falls through');
  assert.equal(clubDecalFor(look, 'I7'), 'stripe');
  assert.equal(clubDecalFor(null, 'DR'), null);

  // and a class override cannot be a decal the player has not unlocked
  const cheat = normaliseLook({ clubDecals: { driver: 'not-a-real-decal' } }, 0, new Set());
  assert.deepEqual(cheat.clubDecals, {},
    'the per-class map is a way to wear an unearned decal');
});

test('a cart livery is its own unlock kind, with its own art', async () => {
  /* Cart liveries deliberately do NOT reuse the club decal list. A club
     shaft is read at arm's length on a turntable; a cart flank is read from
     the side, at speed, usually while it is bouncing. The delicate patterns
     (marble, crosshatch, pinstripe) that carry a club would be grey smears
     on a cart, which is the whole reason for a second, bolder set. */
  const { CART_DECAL_IDS } = await import('../public/js/client/cartdecals.js');
  const liveries = UNLOCKS.filter(u => u.kind === 'cartdecal');
  assert.ok(liveries.length >= 4, 'too few cart liveries to be worth a slot');
  for (const u of liveries) {
    assert.ok(CART_DECAL_IDS.includes(u.id),
      `"${u.id}" is a cart livery unlock with no drawn pattern`);
    assert.ok(/^#[0-9a-f]{6}$/i.test(u.color || ''),
      `"${u.id}" has no colour, and cartDecalTexture derives its other two tones from it`);
  }
  for (const id of CART_DECAL_IDS) {
    assert.ok(liveries.some(u => u.id === id), `"${id}" is drawn but unreachable`);
  }
  // and the two lists must not collide: a shared id would make "chrome" mean
  // two different things depending on which picker you were looking at
  const clubIds = new Set(UNLOCKS.filter(u => u.kind === 'decal').map(u => u.id));
  for (const id of CART_DECAL_IDS) {
    assert.equal(clubIds.has(id), false,
      `"${id}" is both a club decal and a cart livery — one id, two meanings`);
  }
});

test('the shop turntable puts a decal on every kind of head, not just the shaft', () => {
  /* Same claim as the avatar's _shapeDecal, on the other renderer. It cannot
     be checked by building a club here — shaftDecalTexture needs a canvas and
     Node has none — so it is read out of the source the way this file already
     reads the club's part() calls.

     Four branches, because buildClub has four head shapes: putter, wood,
     hybrid and the irons/wedges blade. A branch that forgets its plate gives
     that whole club class a wrapped shaft and a bare head, which is the exact
     half-finished look this replaced. */
  const shaft = SHOP_SRC.match(/g\.add\(rod\(decalMat,[^)]*\)\)/);
  assert.ok(shaft, 'the shop club does not wrap its shaft in the decal at all');

  const plates = SHOP_SRC.match(/if \(decalMat\) head\.add\(|if \(decalMat\) \{\n\s*head\.add\(/g) || [];
  assert.ok(plates.length >= 4,
    `only ${plates.length} of the four head shapes wear a decal plate — ` +
    'a club class with a bare head is the half-finished look this replaced');

  // and framing must not stay on the head alone, or the shaft goes off-screen
  assert.ok(/if \(!decal\) \{\n\s*g\.userData\.focus = head;/.test(SHOP_SRC),
    'the turntable frames on the head even when a decal is on — the shaft is the ' +
    'larger half of the pattern and would be cropped out');
});
