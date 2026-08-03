/* =========================================================================
   xp.mjs — the second currency, and the unlocks it gates
   -------------------------------------------------------------------------
   XP is not coins.  Coins are a budget you spend down to nothing and rebuild;
   XP only ever goes up, so a bad session still moves something forward.  The
   two must therefore behave differently, and one thing they must share is
   DURABILITY: an emote unlocked over ten rounds cannot be taken away by a
   host wiping its disk, which is a failure coins have already had once.
   ========================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holeXp, roundXp, xpForLevel, levelFromXp } from '../public/js/shared/economy.js';
import { EMOTES, EMOTE_CLIPS, emotesAt, POSE_KEYS, blankPose } from '../public/js/client/celebrations.js';
import { io } from 'socket.io-client';

const URL = 'http://localhost:3000';
const wait = ms => new Promise(r => setTimeout(r, ms));
const pid = t => t + '-' + Math.random().toString(36).slice(2, 9);
const connect = () => new Promise((res, rej) => {
  const s = io(URL, { transports: ['websocket'], forceNew: true, timeout: 4000 });
  s.once('connect', () => res(s)); s.once('connect_error', rej);
});
const ask = (s, ev, d) => new Promise(r => s.emit(ev, d, r));

/* ------------------------------------------------------------- earning --- */

test('every finished hole earns something, and good golf earns more', () => {
  for (const par of [3, 4, 5]) {
    for (let s = 1; s <= par + 6; s++) {
      assert.ok(holeXp(s, par) > 0, `par ${par} in ${s} earned nothing`);
    }
  }
  assert.ok(holeXp(3, 4) > holeXp(4, 4), 'a birdie must beat a par');
  assert.ok(holeXp(4, 4) > holeXp(6, 4), 'a par must beat a double');
  assert.ok(holeXp(1, 3) > holeXp(2, 3) * 1.5, 'an ace must feel like one');
});

test('finishing the round is worth more than the holes alone', () => {
  const card = Array(9).fill({ strokes: 4, par: 4 });
  const holes = card.reduce((a, h) => a + holeXp(h.strokes, h.par), 0);
  assert.ok(roundXp(card) > holes, 'there must be a reason to play all nine');
  assert.equal(roundXp([]), 0, 'no holes, no XP');
  assert.equal(roundXp(null), 0);
});

test('a better round is worth more XP than a worse one', () => {
  const good = [3, 3, 4, 4, 4, 4, 4, 5, 4].map(s => ({ strokes: s, par: 4 }));
  const bad = [6, 7, 5, 6, 6, 5, 7, 6, 6].map(s => ({ strokes: s, par: 4 }));
  assert.ok(roundXp(good) > roundXp(bad) * 1.2,
    'playing well must be worth meaningfully more');
  assert.ok(roundXp(bad) > 0, 'but a rough round still counts for something');
});

/* -------------------------------------------------------------- levels --- */

test('the level curve is monotonic and starts at 1', () => {
  assert.equal(xpForLevel(1), 0, 'everyone starts at level 1 with no XP');
  assert.equal(levelFromXp(0).level, 1);
  let prev = -1;
  for (let L = 1; L <= 20; L++) {
    const need = xpForLevel(L);
    assert.ok(need > prev, `level ${L} needs no more XP than ${L - 1}`);
    prev = need;
  }
});

test('levelFromXp agrees with xpForLevel at every boundary', () => {
  for (let L = 1; L <= 15; L++) {
    const at = xpForLevel(L);
    assert.equal(levelFromXp(at).level, L, `exactly ${at} XP should be level ${L}`);
    if (L > 1) {
      assert.equal(levelFromXp(at - 1).level, L - 1,
        `one XP short of level ${L} must still be ${L - 1}`);
    }
  }
});

test('the progress bar never leaves 0..1, at any XP', () => {
  for (const xp of [0, 1, 259, 260, 5000, 1e6, -50, NaN, undefined, null, 'x']) {
    const l = levelFromXp(xp);
    assert.ok(l.progress >= 0 && l.progress <= 1, `progress ${l.progress} at xp=${xp}`);
    assert.ok(Number.isFinite(l.level) && l.level >= 1, `level ${l.level} at xp=${xp}`);
    assert.ok(Number.isFinite(l.into) && l.into >= 0, `into ${l.into} at xp=${xp}`);
  }
});

test('the first unlock is quick and the last is a grind', () => {
  const good = [3, 3, 4, 4, 4, 4, 4, 5, 4].map(s => ({ strokes: s, par: 4 }));
  const perRound = roundXp(good);
  const first = EMOTES.reduce((a, e) => Math.min(a, e.at), 99);
  const last = EMOTES.reduce((a, e) => Math.max(a, e.at), 0);

  const roundsTo = L => xpForLevel(L) / perRound;
  assert.ok(roundsTo(first) <= 2,
    `the first emote takes ${roundsTo(first).toFixed(1)} rounds — too far away ` +
    `to tell a new player the system exists`);
  assert.ok(roundsTo(last) >= 8,
    `the last emote takes only ${roundsTo(last).toFixed(1)} rounds — no grind at all`);
  assert.ok(roundsTo(last) <= 40,
    `the last emote takes ${roundsTo(last).toFixed(1)} rounds, which is a second job`);
});

/* -------------------------------------------------------------- emotes --- */

test('there are five emotes and they unlock one at a time', () => {
  assert.equal(EMOTES.length, 5, 'the brief asked for five');
  const levels = EMOTES.map(e => e.at);
  assert.equal(new Set(levels).size, levels.length,
    'two emotes unlocking at the same level wastes one of the moments');
  for (const e of EMOTES) {
    assert.ok(e.at >= 2, `${e.id} unlocks at level ${e.at} — nothing should be free`);
    assert.ok(EMOTE_CLIPS[e.id], `${e.id} is offered but has no animation`);
    assert.ok(e.name && e.icon && e.blurb, `${e.id} is missing display text`);
  }
});

test('emotesAt hands out exactly what the level has earned', () => {
  assert.equal(emotesAt(1).length, 0, 'level 1 has nothing yet');
  for (const e of EMOTES) {
    assert.ok(emotesAt(e.at).some(x => x.id === e.id),
      `${e.id} should be available at level ${e.at}`);
    assert.ok(!emotesAt(e.at - 1).some(x => x.id === e.id),
      `${e.id} is available a level early`);
  }
  assert.equal(emotesAt(99).length, EMOTES.length, 'a high level has them all');
});

test('every emote animation is finite and ends on the neutral pose', () => {
  /* The blend-out is what hands control back to the walk cycle: a clip that
     does not return to neutral leaves the golfer stuck in a pose forever. */
  const P = blankPose({});
  for (const [id, clip] of Object.entries(EMOTE_CLIPS)) {
    assert.ok(clip.dur > 0.3 && clip.dur < 4, `${id} runs for ${clip.dur}s`);
    for (let k = 0; k <= 1.00001; k += 0.01) {
      blankPose(P);
      clip.pose(P, Math.min(1, k));
      for (const key of POSE_KEYS) {
        assert.ok(Number.isFinite(P[key]), `${id}.${key} went non-finite at k=${k.toFixed(2)}`);
        assert.ok(Math.abs(P[key]) < 6, `${id}.${key} = ${P[key]} at k=${k.toFixed(2)} is off the rig`);
      }
    }
    blankPose(P);
    clip.pose(P, 1);
    for (const key of POSE_KEYS) {
      assert.ok(Math.abs(P[key]) < 1e-6,
        `${id} leaves ${key} at ${P[key]} when it finishes — the golfer will stick`);
    }
  }
});

/* ------------------------------------------------------- over the wire --- */

test('the server refuses an emote the player has not earned', async () => {
  const me = pid('lock');
  const s = await connect();
  const relayed = [], toasts = [];
  s.on('player:emote', d => relayed.push(d));
  s.on('toast', t => toasts.push(t.msg));

  const { ok } = await ask(s, 'room:create', { name: 'Locked', pid: me, courseId: 'parkland' });
  assert.ok(ok);
  await wait(300);

  // a brand-new player is level 1 and owns nothing
  const top = EMOTES.reduce((a, e) => (e.at > a.at ? e : a));
  s.emit('player:emote', { id: top.id });
  await wait(500);

  assert.equal(relayed.length, 0,
    'an unearned emote was broadcast — the unlock is the whole reward, and it ' +
    'is worth nothing if a modified client can skip it');
  assert.ok(toasts.some(t => /unlocks at level/i.test(t)),
    `and the refusal must say why; toasts were ${JSON.stringify(toasts)}`);
  s.disconnect();
});

test('XP survives a wiped server, and unlocks come back with it', async () => {
  /* The exact failure coins already had once: the host loses its disk, the
     player reconnects, and everything they earned is gone. XP has to ride the
     same restore snapshot, or ten rounds of unlocks evaporate on a deploy. */
  const me = pid('restore');
  const s = await connect();
  let profile = null;
  const relayed = [];
  s.on('profile', p => { profile = p; });
  s.on('player:emote', d => relayed.push(d));

  const enough = xpForLevel(EMOTES.reduce((a, e) => Math.max(a, e.at), 0));
  s.emit('profile:me', { pid: me, restore: JSON.stringify({ v: 1, xp: enough + 50 }) });
  await wait(500);

  assert.ok(profile, 'the server must answer profile:me');
  assert.ok((profile.xp || 0) >= enough,
    `XP did not survive the restore: got ${profile.xp}, needed ${enough}`);
  const top = EMOTES.reduce((a, e) => (e.at > a.at ? e : a));
  assert.ok(profile.level >= top.at,
    `restored to level ${profile.level}, below the ${top.at} the XP pays for`);

  // and the restored level really does unlock it
  const { ok } = await ask(s, 'room:create', { name: 'Restored', pid: me, courseId: 'parkland' });
  assert.ok(ok);
  await wait(250);
  s.emit('player:emote', { id: top.id });
  await wait(500);
  assert.equal(relayed.length, 1,
    'a restored career must be able to use what it earned');
  assert.equal(relayed[0].id, top.id);
  s.disconnect();
});

test('the profile carries level and progress, not just raw XP', async () => {
  const me = pid('shape');
  const s = await connect();
  let profile = null;
  s.on('profile', p => { profile = p; });
  s.emit('profile:me', { pid: me });
  await wait(400);
  for (const k of ['xp', 'level', 'into', 'need', 'progress']) {
    assert.ok(k in profile, `profile is missing ${k}, so the XP bar cannot be drawn`);
  }
  assert.ok(profile.progress >= 0 && profile.progress <= 1);
  s.disconnect();
});
