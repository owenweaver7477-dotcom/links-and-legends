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
