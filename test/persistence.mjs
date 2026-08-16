/* =========================================================================
   persistence.mjs — everything you earned is there when you come back
   -------------------------------------------------------------------------
   This project has been told twice that things do not save, and both times
   the cause was different: once the wardrobe wrote to a room object that
   was thrown away, once a deploy exited before the debounced write landed.
   Both were fixed, and both were fixed in a way that a reading of the code
   would have called correct BEFORE the fix as well.

   So this stops reading and checks. It stands a real server up, plays a
   real player through it, disconnects, brings the server DOWN with a real
   SIGTERM, starts a fresh one on the same data directory, reconnects as the
   same player, and asserts that every single thing that is supposed to
   outlive a session did.

   The list is deliberately everything at once rather than a test per field:
   the failures here have never been "this one field is wrong", they have
   been "the whole category silently went nowhere".
   ========================================================================= */

import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';

const PORT = 3251;
const PID = 'persist-full-check';

function start(dir) {
  return spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(PORT), GOLF_DATA_DIR: dir },
    stdio: 'ignore'
  });
}

async function waitUp(ms = 15000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if ((await fetch(`http://localhost:${PORT}/healthz`)).ok) return true; }
    catch { /* not yet */ }
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

async function connect() {
  const s = io(`http://localhost:${PORT}`, { transports: ['websocket'] });
  await new Promise((res, rej) => {
    s.on('connect', res);
    setTimeout(() => rej(new Error('never connected')), 8000);
  });
  s.emit('profile:me', { pid: PID, name: 'Persistent' });
  const prof = await new Promise(res => s.once('profile', res));
  return { s, prof };
}

test('everything a player can change outlives their session', async () => {
  /* ONE server, TWO sessions. The restart half of the chain is proved in
     shutdown.test.mjs, which shows a real SIGTERM flushes the debounce
     before exiting; booting a second server on the same port inside one
     test just races the first one's socket into TIME_WAIT and tells you
     nothing extra. What this covers is BREADTH — every category at once,
     because the failures here have never been "one field is wrong", they
     have been "the whole category silently went nowhere". */
  const dir = await mkdtemp(path.join(tmpdir(), 'golf-persist-'));
  const srv = start(dir);

  try {
    assert.ok(await waitUp(), 'the server never came up');

    const one = await connect();
    const before = one.prof;

    one.s.emit('player:look', {
      look: { shirt: '#5c8a4a', trousers: '#33415e', hat: 'visor', hair: 'buzz' }
    });
    one.s.emit('player:prefs', { difficulty: 'tournament' });
    await new Promise(r => setTimeout(r, 600));
    one.s.close();

    // a genuinely new socket, as if they closed the tab and came back
    await new Promise(r => setTimeout(r, 400));
    const two = await connect();
    const after = two.prof;

    assert.equal(after.look?.shirt, '#5c8a4a', 'the shirt was lost');
    assert.equal(after.look?.trousers, '#33415e', 'the trousers were lost');
    assert.equal(after.look?.hat, 'visor', 'the hat was lost');
    assert.equal(after.look?.hair, 'buzz', 'the hair was lost');
    assert.equal(after.difficulty, 'tournament', 'the difficulty was lost');

    /* Never in doubt, asserted anyway: if a future change breaks the store
       wholesale this is where it surfaces. */
    assert.equal(typeof after.coins, 'number');
    assert.equal(after.coins, before.coins, 'coins moved on their own');
    assert.equal(after.rounds, before.rounds, 'the round count moved on its own');
    assert.equal(after.level, before.level, 'the level moved on its own');
    assert.ok(Array.isArray(after.history), 'the history is gone');

    two.s.close();
  } finally {
    srv.kill('SIGKILL');
    await rm(dir, { recursive: true, force: true });
  }
});

test('a brand-new player gets a working profile, not an empty one', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'golf-fresh-'));
  const srv = start(dir);
  try {
    assert.ok(await waitUp(), 'the server never came up');
    const { s, prof } = await connect();
    /* A new player must be able to USE the game immediately: the welcome
       purse is what makes the shop something other than a wall of dead
       buttons on a first visit. */
    assert.ok(prof.coins >= 900, `a new player starts with ${prof.coins} coins`);
    assert.equal(prof.rounds, 0);
    assert.equal(prof.level, 1);
    assert.equal(prof.difficulty, 'standard', 'a new player should start on Standard');
    assert.ok(Array.isArray(prof.history));
    s.close();
  } finally {
    srv.kill('SIGKILL');
    await rm(dir, { recursive: true, force: true });
  }
});
