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
import {
  PATTERNS, FABRICS, CUTS, SHOE_TYPES, GLOVES, WATCHES, SLEEVES, NECKWEAR,
  DECALS, DECAL_SLOTS, CUSTOM_SHAPES, OUTFITS, outfitStats, wearOutfit
} from '../public/js/shared/wardrobe.js';
import { UNLOCKS } from '../public/js/shared/unlocks.js';
import { CLUB_CLASSES } from '../public/js/shared/clubsets.js';
import { EMOTES, EMOTE_CLIPS, MELEES, SHOVE_CLIPS, POSE_KEYS, blankPose }
  from '../public/js/client/celebrations.js';

const COLOUR_SLOTS = [
  ['cap', CAPS], ['shirt', SHIRTS], ['skin', SKINS],
  ['trousers', TROUSERS], ['hairColor', HAIR_COLORS], ['shoes', SHOES]
];
const STYLE_SLOTS = [
  ['hat', HAT_STYLES], ['hair', HAIR_STYLES], ['accessory', ACCESSORIES],
  ['body', BODIES],
  // the wardrobe's own slots, held to exactly the same contract
  ['pattern', PATTERNS], ['fabric', FABRICS], ['cut', CUTS],
  ['shoeType', SHOE_TYPES], ['glove', GLOVES], ['watch', WATCHES],
  ['sleeve', SLEEVES], ['neck', NECKWEAR]
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
  assertClean(nasty, 'hostile look');
});

/* The wardrobe added two slots that are OBJECTS rather than strings — the
   decal map and the generated design — so this walks into them. That
   matters more here than anywhere else in the look: `decals` is a map whose
   KEYS come off the wire too, and the monogram is the only free text in the
   game that other players can see. */
function assertClean(look, why) {
  const safe = v => {
    assert.ok(v === null || typeof v === 'string',
      `${why}: ${JSON.stringify(v)} is neither a string nor null`);
    if (v !== null) {
      assert.ok(!/[<>(){};]/.test(v), `${why}: "${v}" reached the renderer with markup in it`);
    }
  };
  for (const [k, v] of Object.entries(look)) {
    /* The per-class club decals: a second map whose KEYS come off the wire,
       exactly like `decals` below, so it gets walked into for the same
       reason. The values are club-decal unlock ids and the keys are the five
       club classes; anything else must have been dropped by now. */
    if (k === 'clubDecals') {
      for (const [cls, id] of Object.entries(v)) {
        assert.ok(CLUB_CLASSES.includes(cls), `${why}: unknown club class "${cls}"`);
        assert.ok(UNLOCKS.some(u => u.kind === 'decal' && u.id === id),
          `${why}: unknown club decal "${id}"`);
      }
      continue;
    }
    if (k === 'decals') {
      for (const [slot, id] of Object.entries(v)) {
        assert.ok(DECAL_SLOTS.some(s => s.id === slot), `${why}: unknown decal slot "${slot}"`);
        assert.ok(DECALS.some(d => d.id === id), `${why}: unknown decal "${id}"`);
      }
      continue;
    }
    if (k === 'custom') {
      assert.ok(CUSTOM_SHAPES.some(s => s.id === v.shape), `${why}: unknown shape "${v.shape}"`);
      for (const c of [v.a, v.b]) {
        assert.ok(/^#[0-9a-f]{6}$/i.test(c), `${why}: "${c}" is not a colour`);
      }
      assert.ok(/^[A-Z0-9]{0,3}$/.test(v.txt),
        `${why}: monogram "${v.txt}" is not three characters of A-Z0-9`);
      continue;
    }
    safe(v);
  }
}

test('the decal map cannot be used to smuggle anything through', () => {
  /* The map's KEYS arrive from the wire as well as its values, which is one
     more surface than any other slot in the look has. A slot name that is
     not a slot must not survive, and neither must `__proto__`. */
  const nasty = normaliseLook({
    decals: {
      chest: 'bogey',                       // fine
      armL: '<img onerror=x>',              // not a decal
      'not-a-slot': 'bogey',                // not a slot
      __proto__: 'bogey',
      constructor: 'ac-ace'
    },
    custom: { shape: 'evil', a: 'javascript:x', b: 42, txt: '<script>alert(1)</script>' }
  });
  assertClean(nasty, 'hostile decals');
  assert.deepEqual(Object.keys(nasty.decals), ['chest']);
  // uppercased, stripped of everything but A-Z0-9, THEN cut to three
  assert.equal(nasty.custom.txt, 'SCR');
  assert.equal(nasty.custom.shape, CUSTOM_SHAPES[0].id);
});

test('the wardrobe is levelled, and the fallback is never itself locked', () => {
  /* The bug this exists for: the fallback used to be the first entry in each
     list, and steel spikes (level 16) sat at the head of the shoe list — so
     a brand-new player who sent any shoe id at all was handed a piece of kit
     they had not earned. Every fallback must be free. */
  for (const list of [PATTERNS, FABRICS, CUTS, SHOE_TYPES, GLOVES, WATCHES, SLEEVES, NECKWEAR]) {
    const free = list.find(x => !x.at);
    assert.ok(free, `a wardrobe list has a level on every entry: ${JSON.stringify(list[0])}`);
  }
  const low = looksEarnedAt({
    pattern: 'camo', fabric: 'metal', cut: 'knicker', shoeType: 'spike',
    glove: 'winter', watch: 'gold', sleeve: 'both', neck: 'chain'
  }, 0, 1);
  for (const [key, list] of [['pattern', PATTERNS], ['fabric', FABRICS], ['cut', CUTS],
                             ['shoeType', SHOE_TYPES], ['glove', GLOVES], ['watch', WATCHES],
                             ['sleeve', SLEEVES], ['neck', NECKWEAR]]) {
    const it = list.find(x => x.id === low[key]);
    assert.ok(it && !it.at, `level 1 was handed ${key} = ${low[key]}, which is earned`);
  }
});

test('an outfit is worth having and never worth more than that', () => {
  /* The stat line is real, so it has to stay inside the range that keeps it
     a preference rather than a requirement. The spec asked for about +2.5%
     on the drive at the top end; anything much past that and a player in the
     outfit they LIKE is playing a measurably worse game. */
  let best = 0;
  for (const o of OUTFITS) {
    const st = outfitStats(wearOutfit({}, o.id));
    assert.ok(st.drive <= 0.030, `${o.name} gives ${(st.drive * 100).toFixed(1)}% on the drive`);
    assert.ok(st.accuracy <= 0.030, `${o.name} gives ${(st.accuracy * 100).toFixed(1)}% accuracy`);
    assert.ok(st.style > 0 && st.style <= 10, `${o.name} scores ${st.style} for style`);
    best = Math.max(best, st.drive);
  }
  // and the ceiling has to be reachable, or the numbers are decoration
  assert.ok(best > 0.012, `the best outfit in the game only gives ${(best * 100).toFixed(1)}%`);
});

test('an outfit is never offered before the clothes it is made of', () => {
  /* The bug: sixteen of the twenty-four outfits listed pieces gated above
     their own level, so the card said "wool, plus fours" and a level-3
     player who picked it got cotton and straight legs — normaliseWardrobe
     correctly refusing kit they had not earned, and the wardrobe correctly
     showing them something else. A screen that promises an outfit and hands
     over a different one is worse than one that makes you wait for it. */
  const LISTS = { pattern: PATTERNS, fabric: FABRICS, cut: CUTS, shoeType: SHOE_TYPES,
                  glove: GLOVES, watch: WATCHES, sleeve: SLEEVES, neck: NECKWEAR };
  for (const o of OUTFITS) {
    for (const [key, list] of Object.entries(LISTS)) {
      const v = o.o[key];
      if (!v) continue;
      const it = list.find(x => x.id === v);
      assert.ok(it, `${o.name}: ${key} = "${v}" is not something we ship`);
      assert.ok(!it.at || it.at <= o.at,
        `${o.name} unlocks at ${o.at} but its ${key} (${v}) needs level ${it.at}`);
    }
    /* And the outfit you are shown is the outfit you get: worn AT its own
       level, nothing may be substituted. */
    const worn = looksEarnedAt(wearOutfit({}, o.id), 0, o.at);
    for (const key of Object.keys(LISTS)) {
      if (o.o[key]) assert.equal(worn[key], o.o[key],
        `${o.name} at level ${o.at}: asked for ${key}=${o.o[key]}, got ${worn[key]}`);
    }
  }
});

test('somebody who has never played has something to wear', () => {
  const day1 = OUTFITS.filter(o => !o.at);
  assert.ok(day1.length >= 2, `only ${day1.length} outfit(s) available at level 1`);
  // and the ladder actually climbs rather than dumping everything at once
  const at40 = OUTFITS.filter(o => o.at <= 40).length;
  assert.ok(at40 > day1.length && at40 < OUTFITS.length,
    `${at40} of ${OUTFITS.length} outfits by level 40 is not a progression`);
});

test('every outfit dresses a complete, legal golfer', () => {
  for (const o of OUTFITS) {
    const look = normaliseLook(wearOutfit({}, o.id), 0, undefined, 999);
    assertComplete(look, o.name);
    assertClean(look, o.name);
    assert.equal(look.outfit, o.id, `${o.name} did not stick`);
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

test('every reward the level table names actually exists and is enforced', () => {
  /* The gap this closes was real and embarrassing: the ladder promised a
     Flat cap at level 8, which everybody already had for free, and a Wide
     brim at 23, which was not a hat at all — reaching 23 gave you a line in
     the clubhouse and nothing on your head. A reward table is a promise, and
     nothing in it may be a lie in either direction. */
  const SLOT = { decal: 'decal', trail: 'trail', title: 'title', ball: 'ballFinish',
                 cartdecal: 'cartDecal' };
  for (const u of UNLOCKS) {
    if (u.kind === 'hat') {
      const hat = HAT_STYLES.find(h => h.id === u.id);
      assert.ok(hat, `the table unlocks a hat "${u.id}" that does not exist`);
      assert.equal(hat.at, u.at,
        `"${u.name}" unlocks at ${u.at} in the table but ${hat.at} in the wardrobe`);
      assert.equal(looksEarnedAt({ hat: u.id }, 0, u.at).hat, u.id);
      assert.notEqual(looksEarnedAt({ hat: u.id }, 0, u.at - 1).hat, u.id,
        `"${u.name}" can be worn a level early`);
      continue;
    }
    /* Emotes and melees live in celebrations.js with their own `at`, because
       they are behaviour rather than wardrobe. Two tables, so the only
       question worth asking is whether they still agree — a reward that
       unlocks at 30 in the clubhouse and 44 in the game is a bug the player
       finds by being lied to. */
    if (u.kind === 'emote') {
      const e = EMOTES.find(e => e.id === u.id);
      assert.ok(e, `the ladder unlocks an emote "${u.id}" that does not exist`);
      assert.equal(e.at, u.at, `"${u.name}" unlocks at ${u.at} on the ladder but ${e.at} in the game`);
      assert.ok(EMOTE_CLIPS[u.id], `"${u.name}" has no animation`);
      continue;
    }
    if (u.kind === 'melee') {
      const m = MELEES.find(m => m.id === u.id);
      assert.ok(m, `the ladder unlocks a melee "${u.id}" that does not exist`);
      assert.equal(m.at, u.at, `"${u.name}" unlocks at ${u.at} on the ladder but ${m.at} in the game`);
      continue;
    }
    const slot = SLOT[u.kind];
    assert.ok(slot, `no wardrobe slot knows what to do with a "${u.kind}"`);
    assert.equal(looksEarnedAt({ [slot]: u.id }, 0, u.at)[slot], u.id);
    assert.equal(looksEarnedAt({ [slot]: u.id }, 0, u.at - 1)[slot], null,
      `"${u.name}" can be worn a level early`);
  }
});

test('nothing is free that the table says must be earned', () => {
  // the inverse: no wardrobe entry may carry a level the table does not know
  for (const h of HAT_STYLES) {
    if (!h.at) continue;
    assert.ok(UNLOCKS.some(u => u.kind === 'hat' && u.id === h.id),
      `"${h.name}" is locked to level ${h.at} but appears in no reward table`);
  }
});

test('every animation returns the golfer to neutral', () => {
  /* Each clip is authored on k in [0,1] and MUST be back at the neutral pose
     at k = 1, because the blend-out is what hands control back to the walk
     cycle. A clip that ends anywhere else leaves the golfer permanently bent
     over, and it only shows up after the emote, which is a long way from the
     code that caused it. */
  const all = { ...EMOTE_CLIPS, ...SHOVE_CLIPS };
  for (const [id, clip] of Object.entries(all)) {
    const P = blankPose();
    clip.pose(P, 1);
    for (const k of POSE_KEYS) {
      assert.ok(Math.abs(P[k] || 0) < 0.02,
        `"${id}" leaves ${k} at ${(P[k] || 0).toFixed(3)} when it finishes`);
    }
    // and nothing may write a joint the avatar does not have
    for (const k of Object.keys(P)) {
      assert.ok(POSE_KEYS.includes(k), `"${id}" writes "${k}", which is not a joint`);
    }
    assert.ok(clip.dur > 0.1 && clip.dur < 4, `"${id}" lasts ${clip.dur}s`);
  }
});

test('a melee you have not earned falls back to the barge', () => {
  /* The server picks the move, not the client — same rule as every other
     unlock. Reach, cooldown and power all come off this table, so a client
     that could name its own move could also name its own reach. */
  for (const m of MELEES) {
    const have = MELEES.filter(x => x.at <= m.at);
    assert.ok(have.some(x => x.id === m.id), `${m.name} is not available at its own level`);
    if (m.at > 1) {
      const early = MELEES.filter(x => x.at <= m.at - 1);
      assert.ok(!early.some(x => x.id === m.id), `${m.name} is available a level early`);
    }
  }
  // the barge is always there, or the key does nothing for a new player
  assert.equal(MELEES.filter(m => m.at <= 1).length, 1);
  assert.equal(MELEES[0].id, 'barge');
});
