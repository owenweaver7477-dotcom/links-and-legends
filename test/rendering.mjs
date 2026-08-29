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
  /* The colour block, specifically — there is a type-scale :root above it
     now, and matching the first one found would grep the wrong table. */
  const root = CSS.match(/:root \{\s*\/\* text, brightest to quietest \*\/([\s\S]*?)\n\}/);
  assert.ok(root, 'no colour token block in style.css');

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
  // everything after the colour block itself, so the definitions are not
  // read as strays. `root.index` is where the match starts, not a guess.
  const body = CSS.slice(root.index + root[0].length);
  for (const [name, hex] of tokens) {
    const stray = body.match(new RegExp(hex, 'gi'));
    assert.equal(stray, null,
      `${hex} is written out ${stray?.length} time(s) in the body instead of var(--${name})`);
  }
});

test('the type scale has no half-pixel twins left in it', () => {
  /* Thirty-four distinct font sizes, half of them .5 variants of each
     other — 214 declarations between the twins alone. Nobody chose those;
     they are what happens when a size is picked by nudging until a line
     fits, four hundred times. The result is the same label a different
     size on every screen by an amount too small to look deliberate. */
  const CSS = readFileSync(join(__dirname, '../public/css/style.css'), 'utf8');
  const sizes = [...CSS.matchAll(/font-size:\s*([\d.]+)px/g)].map(m => Number(m[1]));
  const halves = sizes.filter(v => v % 1 !== 0);
  assert.deepEqual([...new Set(halves)], [],
    `half-pixel font sizes are back: ${[...new Set(halves)].join(', ')}`);
  // and the scale itself is declared, so the next size is picked not nudged
  assert.ok(/--t-base:\s*\d+px/.test(CSS), 'no type scale declared in :root');
});

test('every floating surface is the same material', () => {
  /* Glass is four things at once — a gradient, a lit top edge, a bottom lip
     and two shadows — and the point of putting them in tokens is that a new
     panel cannot quietly be a flat fill with a 1px border again. Eleven of
     those over a fairway is what made this read as a debug overlay. */
  const CSS = readFileSync(join(__dirname, '../public/css/style.css'), 'utf8');
  for (const t of ['--glass-bg', '--glass-line', '--glass-lit', '--glass-lip',
                   '--glass-cast', '--glass-blur']) {
    assert.ok(new RegExp(t + ':').test(CSS), `no ${t} token`);
  }
  /* The old hard-coded panel fill. A handful survive on non-floating
     surfaces (a swatch border, an inset well), so this is a ceiling rather
     than a ban — but a jump means somebody built a panel by hand again. */
  const strays = (CSS.match(/rgba\(10,\s*18,\s*15,/g) || []).length;
  assert.ok(strays <= 8,
    `${strays} surfaces still hard-code the old panel fill instead of using --glass-bg`);
});

test('the page wipe and the confetti both respect reduced motion', () => {
  /* A full-screen wipe and a burst of ninety flying elements are precisely
     what that setting exists for. */
  const CSS = readFileSync(join(__dirname, '../public/css/style.css'), 'utf8');
  const HUD = readFileSync(join(__dirname, '../public/js/client/hud.js'), 'utf8');
  assert.ok(/prefers-reduced-motion: reduce\)\s*\{[^}]*\.pagewipe \{ display: none/s.test(CSS),
    'the page wipe is not disabled under reduced motion');
  assert.ok(/@media \(prefers-reduced-motion: reduce\) \{ \.burst \{ display: none/.test(CSS),
    'the confetti is not disabled under reduced motion');
  assert.ok(/const REDUCED = typeof matchMedia/.test(HUD),
    'hud.js does not check prefers-reduced-motion at all');
  assert.ok(/HUD\.burst = \(opts = \{\}\) => \{\s*\n\s*if \(REDUCED\) return;/.test(HUD),
    'HUD.burst still builds its elements under reduced motion');
});

test('the confetti allocates nothing per frame', () => {
  /* It can fire mid-round, so it has to cost one style recalculation and
     then run on the compositor — not a requestAnimationFrame loop over
     ninety elements. */
  const HUD = readFileSync(join(__dirname, '../public/js/client/hud.js'), 'utf8');
  const fn = HUD.match(/HUD\.burst = \(opts = \{\}\) => \{[\s\S]*?\n\};/);
  assert.ok(fn, 'no HUD.burst');
  assert.equal(/requestAnimationFrame/.test(fn[0]), false,
    'the burst runs a per-frame loop — that is the frame rate of the golf underneath it');
  assert.ok(/setTimeout\(\(\) => layer\.remove\(\), \d+\)/.test(fn[0]),
    'the burst never removes its layer, so every celebration leaks one');
  // capped, or a caller could ask for ten thousand
  assert.ok(/Math\.min\(\d+, opts\.n/.test(fn[0]), 'the piece count is unbounded');
});

test('detail is a tier lever of its own, separate from scenery density', () => {
  /* `scenery` is how MANY things there are and `detail` is how many sides
     they have — two different questions that one number was answering. A
     tree with a five-sided trunk reads as a paper model however many of
     them you put on a hill, and the fix for that is not more trees. */
  const T = tiers();
  for (const n of ['low', 'medium', 'high']) {
    assert.ok('detail' in T[n], `tier "${n}" declares no detail level`);
  }
  assert.equal(T.low.detail, '0', 'the low tier should keep the counts it always had');
  assert.ok(Number(T.high.detail) > Number(T.medium.detail));

  const src = SCENE;
  assert.ok(/export const seg = \(q, base\) =>/.test(src), 'no seg helper');
  const uses = (src.match(/seg\(this\.q, /g) || []).length;
  assert.ok(uses >= 8,
    `only ${uses} generators ask for a segment count — the rest are still fixed`);

  /* A tier change that alters the world's GEOMETRY has to rebuild the hole,
     the same as a density change does, or the cached geometry stays at the
     old resolution and the setting silently does nothing. */
  assert.ok(/wasDetail !== Q\.detail/.test(src),
    'changing the detail tier does not ask for a rebuild');
});

test('props are chamfered, and cached per size AND per tier', () => {
  /* Same reasoning as the avatar: a hard 90-degree edge takes the light in
     exactly two steps, and every hut, bench and marker post on every hole
     was made of those. */
  assert.ok(/function bevelBox\(w, h, d, b\)/.test(SCENE), 'no bevelled box for the props');
  assert.ok(/cached\(`pbox\$\{w\}_\$\{h\}_\$\{d\}@\$\{D\}`/.test(SCENE),
    'the prop box cache key omits the detail tier — a tier change would hand ' +
    'back geometry built for the previous one');
  /* Proportional to the smallest dimension, or a 0.1m sole plate is eaten
     by its own bevel while a 4.4m hut wall barely shows one. */
  assert.ok(/Math\.min\(w, h, d\) \* 0\.\d+/.test(SCENE),
    'the prop bevel is a fixed distance rather than a proportion');
  assert.ok(/D > 0 \?/.test(SCENE), 'the low tier does not keep its plain boxes');
});

test('tree geometry is cached per detail level too', () => {
  /* treeParts is module level and has no scene to ask, so it is handed the
     number — and every cache key inside carries it. */
  assert.ok(/function treeParts\(species, bio, d = 1\)/.test(SCENE),
    'treeParts does not take a detail level');
  assert.ok(/const K = key => key \+ '@' \+ d;/.test(SCENE),
    'tree cache keys do not carry the detail level');
  const body = SCENE.slice(SCENE.indexOf('function treeParts('));
  const bare = body.slice(0, body.indexOf('\nfunction ')).match(/cached\('[a-z]/gi);
  assert.equal(bare, null,
    `${bare?.length} tree geometries are cached under a bare key — a tier change ` +
    'would reuse the previous tier\'s mesh');
});

test('a nav tab re-enters its page when the screen it named is gone', () => {
  /* A round calls HUD.show(null) and never touches HUD.page, so after
     leaving one the remembered page still named a screen that was no longer
     up. Guarding the no-wipe shortcut on the page NAME alone made that tab
     a dead button — no screen appeared, no error, and to a player every tab
     looked broken because the one they were on was the one they pressed
     first. "Already there" has to mean what is on screen. */
  const HUD = readFileSync(join(__dirname, '../public/js/client/hud.js'), 'utf8');
  assert.ok(/if \(HUD\.page === page && HUD\.current === def\.screen\)/.test(HUD),
    'goPage short-circuits on the page name alone — a tab whose screen has been ' +
    'replaced by a round becomes a dead button');
});

test('every prop bevel-box face winds outward, not inward', () => {
  /* Same bug, same shape, as the avatar's chamferedBox in avatar.js: the
     ±X faces of the props' bevelBox — every hut, bench, sign and bin —
     were wound backwards, so THREE's default FrontSide culling dropped
     their side walls entirely. Invisible from any camera outside the box
     on that axis, which is exactly a side-on view of the prop. Re-derived
     from the source, so a future edit to the face table cannot reintroduce
     this without the test computing the same cross product and catching it. */
  const m = SCENE.match(/function bevelBox\(w, h, d, b\) \{[\s\S]*?for \(const \[axis, pts\] of \[([\s\S]*?)\n  \]\) \{/);
  assert.ok(m, 'no face table in bevelBox');
  const rowRe = /\['([xyz])',\s*(\[\[.+?\]\])\]/g;
  const rows = [...m[1].matchAll(rowRe)];
  assert.equal(rows.length, 6, `found ${rows.length} face rows, expected 6`);

  // bevelBox's own corner points: sx*x (outer) vs sx*xi (inset) per axis —
  // collapsed to the same o/i shape the avatar's box uses, since bevelBox
  // is a rectangular box (w,h,d) rather than a cube: only the RATIO of
  // outer to inset matters for winding, so any b < min(w,h,d)/2 works.
  const o = 0.5, i = 0.3;
  const AXIS = { x: 0, y: 1, z: 2 };
  for (const [, axis, ptsSrc] of rows) {
    // bevelBox has two rows per axis (no explicit sign column) — the sign
    // is the shared sx/sy/sz of the face's four corners
    const octants = JSON.parse(ptsSrc);
    const sign = octants[0][AXIS[axis]];
    assert.ok(octants.every(pt => pt[AXIS[axis]] === sign),
      `face '${axis}' mixes signs on its own axis — not a planar face`);

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
      `bevelBox face '${axis}' (sign ${sign}) winds inward — this is the exact bug ` +
      "that dropped a prop's side wall from FrontSide culling");
  }
});
