/* =========================================================================
   kit.mjs — what you are wearing is still there tomorrow
   -------------------------------------------------------------------------
   Appearance, ball colour and bag lived ONLY on the room player: an object
   created when you join a room and thrown away when the room dies. So every
   one of them reset to a default the next time you played, and the wardrobe
   — which is reached from the front page, where you are in no room at all —
   sent a message the server dropped on the floor without reading.

   Two separate faults with one symptom, "the appearance goes back to
   default", and neither is visible from inside a single session: you have
   to leave and come back to see it. That is exactly the kind of bug that
   needs a test rather than a look.

   These run against the profile store directly rather than over a socket.
   The socket path is a thin wrapper over these calls, and a test that
   stands a server up to check a Map is a slow test of the wrong thing.
   ========================================================================= */

import assert from 'node:assert/strict';
import test from 'node:test';
import { getProfile, publicProfile, setLook, setBallColor, setBag, kitOf,
         setDifficulty } from '../server/profiles.js';
import { normaliseLook } from '../public/js/shared/avatars.js';
import { normaliseBag } from '../public/js/shared/clubs.js';

const PID = 'kit-test-1';

test('a look survives being written and read back', () => {
  const want = normaliseLook({ shirt: '#5c8a4a', hat: 'visor', hair: 'buzz' });
  setLook(PID, want);
  assert.deepEqual(kitOf(PID).look, want);
  /* And through the public view, which is what the client actually gets —
     a value saved but never sent back is a value the browser cannot use. */
  assert.equal(publicProfile(PID).look.shirt, '#5c8a4a');
  assert.equal(publicProfile(PID).look.hat, 'visor');
});

test('a brand-new profile has no kit, rather than a made-up one', () => {
  /* `kitOf` returning a default would be worse than returning nothing: the
     room would dress a new player in it and then save it back, and the
     player would appear to have chosen a look they never picked. */
  const fresh = kitOf('kit-test-never-seen');
  assert.equal(fresh, null);
  getProfile('kit-test-blank');
  assert.equal(kitOf('kit-test-blank').look, null);
});

test('the ball colour and the bag persist too', () => {
  setBallColor(PID, '#ffd76b', 'Mustard');
  const bag = normaliseBag(['DR', 'W3', 'I7', 'PW', 'SW']);
  setBag(PID, bag);
  const kit = kitOf(PID);
  assert.equal(kit.color, '#ffd76b');
  assert.equal(kit.colorName, 'Mustard');
  assert.deepEqual(kit.bag, bag);
  assert.ok(kit.bag.includes('PT'), 'the putter is always in the bag');
});

test('changing one part of the kit does not clear the others', () => {
  /* Each setter writes one field. Written as three separate calls on one
     profile because that is how the server uses them — a look change and a
     bag change arrive on different sockets messages, and an early version
     of this replaced the whole kit object each time. */
  const look = kitOf(PID).look;
  setBag(PID, normaliseBag(['DR', 'I5']));
  assert.deepEqual(kitOf(PID).look, look, 'saving a bag wiped the look');
  setLook(PID, normaliseLook({ shirt: '#7fb6dd' }));
  assert.equal(kitOf(PID).color, '#ffd76b', 'saving a look wiped the ball colour');
});

test('difficulty is remembered, and an invented one is not', () => {
  assert.equal(publicProfile(PID).difficulty, 'standard', 'the default is Standard');
  setDifficulty(PID, 'tournament');
  assert.equal(publicProfile(PID).difficulty, 'tournament');
  assert.ok(publicProfile(PID).earnRate > 1, 'a harder mode should pay more');
  /* An unknown mode becomes the default rather than throwing: far more
     likely to be an old tab than an attack, and Standard is a correct
     answer either way. */
  setDifficulty(PID, 'god-mode');
  assert.equal(publicProfile(PID).difficulty, 'standard');
});

test('a null look is allowed, and means "the default golfer"', () => {
  setLook(PID, null);
  assert.equal(kitOf(PID).look, null);
  assert.equal(publicProfile(PID).look, null);
});

/* ═══════════════════════════════════ WHAT A DIFFICULTY ACTUALLY PAYS ═══
   The multiplier was applied to `rc.total`, which INCLUDES the per-hole
   coins already banked as the round was played. Scaling that and then
   subtracting the unscaled holes applies the rate to money the player had
   twenty minutes ago: on a bogey nine, Casual credited 689 against a base
   of 1300 — a 47% cut sold on the picker as 20% — and Tournament paid 176%
   where it promised 75%.

   Every number on the difficulty picker was wrong, in both directions, and
   nothing about the screen looked broken. Asserted against the ADVERTISED
   rate, so the picker and the payout cannot drift apart again. */
import { settleRound } from '../server/profiles.js';
import { DIFFICULTIES, earnRate } from '../public/js/shared/difficulty.js';

/** Coins actually credited at the end of one round on a given rate. */
function credited(pid, rate) {
  const p = getProfile(pid);
  const before = p.coins;
  const holes = Array.from({ length: 9 }, () => ({ strokes: 5, par: 4 }));
  settleRound(pid, null, holes, rate);
  return getProfile(pid).coins - before;
}

test('a difficulty pays exactly what its card claims', () => {
  const base = credited('earn-base', 1);
  assert.ok(base > 0, 'a finished round should pay something');
  for (const d of DIFFICULTIES) {
    const got = credited('earn-' + d.id, d.earn);
    const want = Math.round(base * d.earn);
    /* Within a coin, for rounding. Anything wider would let the old bug —
       which was out by a factor of two — slip straight back through. */
    assert.ok(Math.abs(got - want) <= 1,
      `${d.name} pays ${got}, its card promises ${want} (${d.earn}x of ${base})`);
  }
});

test('the multiplier never turns a finished round into a loss', () => {
  /* The failure mode of scaling the total: with enough banked hole coins
     relative to the bonus, `scaled total − unscaled holes` goes negative
     and the balance DROPS when you finish a round. */
  for (const d of DIFFICULTIES) {
    assert.ok(credited('loss-' + d.id, d.earn) > 0,
      `${d.name} took coins away for completing a round`);
  }
});

test('an unknown rate falls back to paying normally', () => {
  const base = credited('earn-fallback-a', 1);
  for (const bad of [0, -3, NaN, undefined, null]) {
    const got = credited('earn-fallback-' + String(bad), bad);
    assert.equal(got, base, `a rate of ${String(bad)} changed the payout`);
  }
  assert.equal(earnRate('nonsense'), 1, 'an invented mode should earn normally');
});

/* ══════════════════════════ WHAT REACHES THE DISK, AND WHAT DOES NOT ═══
   On a games portal most visitors load the page, look, and leave. Every one
   of them gets a profile the moment their client says hello, and the file
   store rewrites EVERY row on every save — twenty thousand of those is
   23 MB written after every hole anybody anywhere plays. That is the same
   event-loop starvation behind "everything has gone really slow and
   sometimes I can't even hit my ball", arriving through success instead of
   through a bug.

   So blank profiles are not written. The danger in that is obvious in
   hindsight and was not obvious while writing it: "blank" must mean blank to
   the PLAYER, not blank to the progression system. Somebody who opens the
   wardrobe, spends five minutes on an outfit and closes the tab has played
   no holes, earned no coins and bought no gear — and would have come back to
   the default golfer. The first version of the filter did exactly that. */

import { worthSaving } from '../server/profiles.js';

/* Asserted on the PREDICATE rather than by writing to disk. Opening the real
   store here would claim the writer lock on the shared test directory, which
   the suite's own server already holds — the lock is right to refuse, and
   fighting it would mean weakening it for a test.

   The disk round-trip is covered where it belongs, in persistence.mjs, which
   stands up its own server in its own directory and checks an outfit survives
   a session. */
const blank = () => ({ rounds: 0, holes: 0, xp: 0, coins: 900,
                       gear: {}, crew: {}, clubSets: { hickory: 0 }, clubSet: 'hickory' });

test('a profile nobody has done anything with is not written', () => {
  assert.equal(worthSaving(blank()), false, 'an untouched profile would reach the disk');
});

test('merely having visited does not count', () => {
  /* `lastSeen` is stamped for every visitor the moment they connect. If it
     counted, the filter would keep everything and do nothing at all — a
     failure that looks exactly like success. */
  assert.equal(worthSaving({ ...blank(), lastSeen: Date.now() }), false,
    'a bare visit was treated as progress');
});

test('an outfit alone is enough to be worth saving', () => {
  /* The near-miss. Somebody who opens the wardrobe, spends five minutes on
     an outfit and closes the tab has played no holes, earned no coins and
     bought no gear — and the first version of this filter dropped them. */
  assert.equal(worthSaving({ ...blank(), look: normaliseLook({ shirt: '#5c8a4a' }) }), true,
    'a player who dressed their golfer but never played would lose their outfit');
});

test('every other deliberate choice counts too', () => {
  const cases = {
    bag: { bag: normaliseBag(['DR', 'I7']) },
    'ball colour': { ballColor: '#ffd76b' },
    difficulty: { difficulty: 'tournament' },
    'club finish': { clubSkin: 'brushed' },
    'a best round': { best: 4 },
    'a cleared course': { cleared: ['parkland'] },
    'a head-to-head': { h2h: { someone: { w: 1, l: 0, d: 0 } } }
  };
  for (const [what, patch] of Object.entries(cases)) {
    assert.equal(worthSaving({ ...blank(), ...patch }), true,
      `${what} would be dropped on the way to the disk`);
  }
});

test('a played hole counts, obviously', () => {
  assert.equal(worthSaving({ ...blank(), holes: 1, strokes: 5 }), true);
});

test('the default difficulty is not a choice', () => {
  /* Standard is what everybody starts on, so storing it says nothing. */
  assert.equal(worthSaving({ ...blank(), difficulty: 'standard' }), false);
  assert.equal(worthSaving({ ...blank(), clubSkin: 'stock' }), false);
});
