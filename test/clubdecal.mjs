/* =========================================================================
   clubdecal.mjs — the shaft decal band: a real pattern, in the right place
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

test('the shaft decal band sits on the shaft, not the grip or floating past it', () => {
  const [gripLo, gripHi] = partExtent('clubGrip');
  const [shaftLo, shaftHi] = partExtent('clubShaft');
  const [decalLo, decalHi] = partExtent('clubDecal');

  assert.ok(decalLo >= shaftLo && decalHi <= shaftHi,
    `decal band [${decalLo}, ${decalHi}] is not fully within the shaft [${shaftLo}, ${shaftHi}]`);
  assert.ok(decalHi <= gripLo,
    `decal band top (${decalHi}) overlaps the grip (grip starts at ${gripLo})`);
});
