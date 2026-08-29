/* =========================================================================
   rendering.mjs — the visual pass, asserted where it can be
   -------------------------------------------------------------------------
   Most of this file's subject is pixels, and pixels are not a thing a Node
   test can look at. What it CAN hold are the claims that are really about
   consistency, and every one of these was a real defect before it was an
   assertion:

     A quality tier that declares a lever nothing reads is a promise the
     settings screen makes and never keeps. `water` was declared by all
     three tiers and read by nothing; `precip` was read and declared by
     none, so it silently resolved to full density on a machine asking for
     low.

     Two places describing the same thing have to agree. Shadows were
     declared twice — once by the tier, once hard-coded in the constructor
     — and the two disagreed, so whether the game had shadows depended on
     whether setQuality happened to run before the first hole was built.

     A finish must be the same finish everywhere it is shown. The ball on
     the turntable and the ball in flight now read one table; before, the
     shop drew every finish as the same shiny white sphere.

   Read out of the source the same way test/clubdecal.mjs reads avatar.js:
   scene.js needs a WebGL context to instantiate and Node has none.
   ========================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BALL_FINISH, BALL_PLAIN, ballFinish } from '../public/js/shared/ballfinish.js';
import { UNLOCKS } from '../public/js/shared/unlocks.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = f => readFileSync(join(__dirname, '../public/js/client/', f), 'utf8');
const SCENE = src('scene.js');
const SHOP = src('shopview.js');

/** The QUALITY table, parsed out of scene.js rather than imported — the
 *  module needs a WebGL context at import time. */
function tiers() {
  const m = SCENE.match(/export const QUALITY = \{([\s\S]*?)\n\};/);
  assert.ok(m, 'no QUALITY table in scene.js');
  const out = {};
  for (const line of m[1].split('\n')) {
    const row = line.match(/^\s*(\w+):\s*\{(.*)\},?\s*$/);
    if (!row) continue;
    const fields = {};
    for (const pair of row[2].split(',')) {
      const kv = pair.split(':').map(x => x.trim());
      if (kv.length === 2) fields[kv[0]] = kv[1];
    }
    out[row[1]] = fields;
  }
  return out;
}

test('every quality tier declares every lever, and every lever is read', () => {
  const T = tiers();
  const names = Object.keys(T);
  assert.deepEqual(names, ['low', 'medium', 'high'], 'the tier list changed shape');

  const keys = Object.keys(T.low);
  for (const n of names) {
    assert.deepEqual(Object.keys(T[n]).sort(), keys.slice().sort(),
      `tier "${n}" does not declare the same levers as the others — a tier ` +
      'that omits one falls back to whatever default the reader happens to use');
  }

  /* And each one has to be READ. `q.water` was declared by all three and
     read nowhere, so turning quality down never simplified the water. */
  for (const k of keys) {
    if (k === 'pixelRatio' || k === 'shadowMap') continue;   // read via Q.<name> in setQuality
    const read = new RegExp(`(?:this\\.)?q(?:\\?)?\\.${k}\\b|Q\\.${k}\\b`).test(SCENE);
    assert.ok(read, `the quality tiers declare "${k}" and nothing ever reads it`);
  }
});

test('the low tier actually asks for less than the high one', () => {
  const T = tiers();
  const num = v => Number(v);
  for (const k of ['pixelRatio', 'scenery', 'precip', 'env']) {
    assert.ok(num(T.low[k]) <= num(T.medium[k]) && num(T.medium[k]) <= num(T.high[k]),
      `"${k}" is not monotonic across the tiers: ` +
      `low ${T.low[k]}, medium ${T.medium[k]}, high ${T.high[k]}`);
  }
  assert.equal(T.low.shadows, 'false', 'the low tier should not be paying for shadow maps');
  assert.equal(T.low.water, '0', 'the low tier should not be running the water shader');
});

test('shadows are declared once — the constructor follows the tier', () => {
  /* They used to be declared twice and disagree: `this.q = QUALITY.medium`
     asks for shadows and the next line hard-coded them off, so whether the
     game had shadows depended on call order rather than on a decision. */
  assert.ok(/this\.renderer\.shadowMap\.enabled = this\.q\.shadows/.test(SCENE),
    'the constructor hard-codes shadowMap.enabled instead of reading the tier');
  assert.ok(/this\.renderer\.shadowMap\.autoUpdate = this\.q\.shadows/.test(SCENE),
    'the constructor hard-codes shadowMap.autoUpdate instead of reading the tier');
});

test('both renderers manage colour the same way', () => {
  /* The shop renderer had neither, so the same club under the same lights
     came out visibly different in the shop than in your hand — and the shop
     is where somebody decides whether to buy it. */
  for (const [name, s] of [['scene.js', SCENE], ['shopview.js', SHOP]]) {
    assert.ok(/outputColorSpace = THREE\.SRGBColorSpace/.test(s),
      `${name}'s renderer sets no output colour space`);
    assert.ok(/toneMapping = THREE\.ACESFilmicToneMapping/.test(s),
      `${name}'s renderer does no tone mapping`);
  }
});

test('there is an environment map, and it is generated rather than downloaded', () => {
  assert.ok(/PMREMGenerator/.test(SCENE), 'the course has no environment map');
  assert.ok(/PMREMGenerator/.test(SHOP), 'the shop has no environment map');
  /* The whole art direction depends on this: README says there are no
     textures, and the portal bundle budget assumes it. An environment map
     that arrived as a file would break both. */
  for (const [name, s] of [['scene.js', SCENE], ['shopview.js', SHOP]]) {
    assert.equal(/\.(hdr|exr|png|jpg|ktx2)['"]/.test(s), false,
      `${name} references an image file — every environment here must be generated`);
  }
});

test('the environment render target is released with the hole that made it', () => {
  /* It is generated FROM the sky material, so it has to die with it. A
     leaked render target per hole is eighteen of them by the end of a
     round, and they are the largest single GPU allocation in the scene. */
  const dispose = SCENE.match(/\n  dispose\(\) \{[\s\S]*?\n  \}/);
  assert.ok(dispose, 'no dispose() in scene.js');
  assert.ok(/_envRT\?\.dispose\(\)/.test(dispose[0]),
    'dispose() does not release the environment render target');
  assert.ok(/_envRT\?\.dispose\(\)/.test(SCENE.match(/_buildEnvironment\(skyMat\) \{[\s\S]*?\n  \}/)[0]),
    'rebuilding the environment leaks the previous one');
});

test('the shop builds its environment per renderer, never shared', () => {
  /* PMREM output is a WebGLRenderTarget and belongs to the GL context that
     made it. This module gives every canvas its own WebGLRenderer, so a
     shared target renders BLACK on every canvas but the first — and a metal
     is nothing but its reflection, so a chrome ball came out as a black
     circle with one white dot on it. */
  assert.equal(/let _studioRT/.test(SHOP), false,
    'the shop caches one environment across renderers — it will be black on all but the first');
  assert.ok(/envRT\?\.dispose\(\)/.test(SHOP), 'the shop leaks its environment render targets');
});

/* ---------------------------------------------------------- ball finish -- */

test('every earned ball finish has real material numbers', () => {
  const earned = UNLOCKS.filter(u => u.kind === 'ball');
  assert.ok(earned.length >= 4);
  for (const u of earned) {
    const f = BALL_FINISH[u.id];
    assert.ok(f, `"${u.name}" is an earnable finish with no entry in BALL_FINISH — ` +
      'it would silently fall back to a plain ball, i.e. no visual effect at all ' +
      'despite being a real, earned reward');
    assert.ok(f.rough >= 0 && f.rough <= 1, `${u.id} roughness out of range`);
    assert.ok(f.metal >= 0 && f.metal <= 1, `${u.id} metalness out of range`);
  }
  for (const id of Object.keys(BALL_FINISH)) {
    assert.ok(earned.some(u => u.id === id), `"${id}" is a finish nobody can earn`);
  }
});

test('the finishes are actually distinguishable from each other', () => {
  /* The point of the table. Two finishes with the same numbers are two
     names for one reward, which is the "can't tell the difference"
     complaint this whole pass exists to answer. */
  const seen = new Map();
  for (const [id, f] of Object.entries(BALL_FINISH)) {
    const key = `${f.rough}|${f.metal}|${f.clear || 0}`;
    assert.equal(seen.has(key), false,
      `"${id}" and "${seen.get(key)}" are materially identical — same roughness, ` +
      'metalness and clearcoat, so they render as the same ball');
    seen.set(key, id);
  }
  // and matte must actually be the matte one
  const r = Object.entries(BALL_FINISH).sort((a, b) => b[1].rough - a[1].rough);
  assert.equal(r[0][0], 'matte', 'the roughest finish is not the one called matte');
  const m = Object.entries(BALL_FINISH).sort((a, b) => b[1].metal - a[1].metal);
  assert.equal(m[0][0], 'chrome', 'the most metallic finish is not the one called chrome');
});

test('an unknown finish falls back to a normal ball rather than a black one', () => {
  /* A fully metallic material with nothing to reflect renders BLACK, so the
     fallback has to be a dielectric. This is the difference between an
     unrecognised id being invisible and it being a bug report. */
  assert.equal(ballFinish('not-a-finish'), BALL_PLAIN);
  assert.equal(ballFinish(null), BALL_PLAIN);
  assert.ok(BALL_PLAIN.metal < 0.2, 'the fallback ball is metallic — it will render black');
});

test('the shop and the course read one finish table', () => {
  for (const [name, s] of [['scene.js', SCENE], ['shopview.js', SHOP]]) {
    assert.ok(/from '\.\.\/shared\/ballfinish\.js'/.test(s),
      `${name} does not read the shared ball finish table`);
  }
  // and neither keeps a private copy of it
  assert.equal(/const BALL_FINISH = \{/.test(SCENE), false,
    'scene.js still has its own copy of the finish table');
});

/* ------------------------------------------------------------- geometry -- */

test('the avatar is built from a chamfered box, not a cube', () => {
  /* A hard 90-degree edge has one normal on each side and nothing between
     them, so it takes the light in exactly two steps — it is the single
     strongest "made of boxes" signal there is, and it is why these figures
     read as placeholder art however well they are lit. */
  const AV = src('avatar.js');
  assert.ok(/const box = \(\) => \(_box \|\| \(_box = shared\(chamferedBox\(\)\)\)\)/.test(AV),
    'the avatar still shares a plain BoxGeometry for every part');
  const c = AV.match(/const CHAMFER = ([\d.]+);/);
  assert.ok(c, 'no CHAMFER constant');
  const v = Number(c[1]);
  assert.ok(v > 0 && v < 0.12,
    `a chamfer of ${v} is not a chamfer — under ~0.02 it is invisible and over ~0.1 ` +
    'the parts stop meeting each other');
});

/* ---------------------------------------------------------------- chrome -- */

test('the stylesheet has a palette, and nothing re-types a colour it names', () => {
  /* ~4,400 lines of hex literals meant the same decision got made again
     slightly differently each time: FIVE muted greens were doing the job of
     one text ladder, two of them four points apart per channel. */
  const CSS = readFileSync(join(__dirname, '../public/css/style.css'), 'utf8');
  const root = CSS.match(/:root \{([\s\S]*?)\n\}/);
  assert.ok(root, 'no :root token block in style.css');

  const tokens = [...root[1].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)]
    .map(m => [m[1], m[2].toLowerCase()]);
  assert.ok(tokens.length >= 6, 'the palette is too small to be a system');

  // no two tokens may be the same colour: that is the duplicate this fixed
  const byHex = new Map();
  for (const [name, hex] of tokens) {
    assert.equal(byHex.has(hex), false,
      `--${name} and --${byHex.get(hex)} are the same colour under two names`);
    byHex.set(hex, name);
  }

  // and the body must not re-type any of them as a literal
  const body = CSS.slice(CSS.indexOf('}', CSS.indexOf(':root {')) + 1);
  for (const [name, hex] of tokens) {
    const stray = body.match(new RegExp(hex, 'gi'));
    assert.equal(stray, null,
      `${hex} is written out ${stray?.length} time(s) in the body instead of var(--${name})`);
  }
});
