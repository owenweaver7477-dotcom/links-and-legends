/* =========================================================================
   clubskins.mjs — earned, and never worth anything but the story
   -------------------------------------------------------------------------
   A club finish is the first thing in this game handed out for a FEAT rather
   than for time or coins. That makes two properties load-bearing.

   It must be worth nothing mechanically. The moment a finish earned by a
   hole in one makes the ball go further, every player who has not had one is
   playing a worse game for a reason they cannot fix by practising — and an
   achievement has quietly become power creep.

   And it must not be claimable. The client picks; the server decides. A
   finish gated on something hard is worth exactly nothing if a crafted
   socket message can ask for it.
   ========================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLUB_SKINS, skinById, skinEarned, skinRequirement, skinProgress,
  skinsFor, normaliseSkin
} from '../public/js/shared/clubskins.js';

const FRESH = { level: 1, aces: 0, eagles: 0, birdies: 0, rounds: 0, records: 0,
                clubPieces: { hickory: [] } };

test('a finish changes nothing about the golf', () => {
  /* The property the whole idea rests on. If a key ever appears here that
     the shot simulation reads, this test is the thing that catches it. */
  const PHYSICS = ['speed', 'spin', 'drive', 'carry', 'roll', 'acc', 'accuracy',
                   'faceDamp', 'forgiveness', 'power', 'loft'];
  for (const sk of CLUB_SKINS) {
    for (const k of PHYSICS) {
      assert.ok(!(k in sk),
        `"${sk.name}" carries a physics key (${k}) — a finish must be cosmetic`);
    }
  }
});

test('only stock is free', () => {
  const free = CLUB_SKINS.filter(s => skinEarned(s, FRESH));
  assert.deepEqual(free.map(s => s.id), ['stock'],
    'a brand-new player was given more than the stock finish');
});

test('every finish is reachable, and says how', () => {
  for (const sk of CLUB_SKINS) {
    if (!sk.need) continue;
    const req = skinRequirement(sk);
    assert.ok(req && req.length > 3, `"${sk.name}" does not say how to earn it`);
    // and the requirement has to be satisfiable by some profile
    const maxed = { level: 100, aces: 99, eagles: 99, birdies: 999, rounds: 999,
                    records: 9, clubPieces: { hickory: [], halcyon: [] } };
    assert.ok(skinEarned(sk, maxed), `"${sk.name}" cannot be earned by anybody`);
  }
});

test('a feat finish cannot be reached by grinding levels', () => {
  /* The distinction that makes them mean something: no amount of turning up
     produces an ace. A level-100 player with no feats gets the level ones
     and nothing else. */
  const grinder = { ...FRESH, level: 100, rounds: 150 };
  for (const sk of CLUB_SKINS.filter(s => s.feat)) {
    assert.equal(skinEarned(sk, grinder), false,
      `"${sk.name}" is a feat finish but a level-100 grinder has it`);
  }
  // while every level finish IS theirs
  for (const sk of CLUB_SKINS.filter(s => s.need?.level)) {
    assert.ok(skinEarned(sk, grinder), `"${sk.name}" is unreachable at level 100`);
  }
});

test('a hole in one earns exactly what it should', () => {
  const acer = { ...FRESH, aces: 1 };
  assert.ok(skinEarned(skinById('ace-gold'), acer), 'an ace did not earn Ace gold');
  assert.equal(skinEarned(skinById('ace-triple'), acer), false, 'one ace earned the triple');
  assert.ok(skinEarned(skinById('ace-triple'), { ...FRESH, aces: 3 }));
});

test('the server refuses a finish that was not earned', () => {
  /* normaliseSkin is the gate. Everything a client can send has to come back
     as something that profile has actually earned. */
  for (const sk of CLUB_SKINS) {
    assert.equal(normaliseSkin(sk.id, FRESH), sk.need ? 'stock' : sk.id,
      `a fresh profile was allowed "${sk.name}"`);
  }
  // and junk falls back rather than throwing
  for (const junk of [null, undefined, 42, {}, '__proto__', '<script>', 'nope']) {
    assert.equal(normaliseSkin(junk, FRESH), 'stock');
  }
  // what IS earned passes through untouched
  const decent = { ...FRESH, level: 30, aces: 1 };
  assert.equal(normaliseSkin('copper', decent), 'copper');
  assert.equal(normaliseSkin('ace-gold', decent), 'ace-gold');
  assert.equal(normaliseSkin('platinum', decent), 'stock');
});

test('progress counts towards the thing you have to do', () => {
  const p = { ...FRESH, level: 34, birdies: 45 };
  const ivory = skinProgress(skinById('ivory'), p);
  assert.deepEqual({ have: ivory.have, want: ivory.want }, { have: 34, want: 44 });
  const birds = skinProgress(skinById('birdie-run'), p);
  assert.deepEqual({ have: birds.have, want: birds.want }, { have: 45, want: 100 });
  assert.ok(birds.pct > 0.4 && birds.pct < 0.5);
  // an earned one is capped rather than reporting over 100%
  const done = skinProgress(skinById('ivory'), { ...p, level: 90 });
  assert.equal(done.pct, 1);
  assert.equal(skinProgress(skinById('stock'), p), null);
});

test('skinsFor and skinEarned never disagree', () => {
  const p = { level: 44, aces: 1, eagles: 12, birdies: 20, rounds: 30, records: 1,
              clubPieces: { hickory: [], kestrel: ['DR'] } };
  const list = skinsFor(p);
  for (const sk of CLUB_SKINS) {
    assert.equal(list.includes(sk), skinEarned(sk, p),
      `"${sk.name}" is in one answer and not the other`);
  }
});

test('ids are unique and stable-looking', () => {
  const ids = CLUB_SKINS.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length, 'two finishes share an id');
  for (const id of ids) assert.match(id, /^[a-z][a-z0-9-]*$/, `"${id}" is not a safe id`);
});
