/* =========================================================================
   afk.mjs — a silent turn cannot stall everyone else forever
   -------------------------------------------------------------------------
   Nothing used to notice the difference between "thinking about the next
   shot" and "closed the laptop mid-turn" — both looked identical to the
   server, and both left every other player in the room waiting on a turn
   that would never come. This proves the sweep actually acts: the quiet
   player is benched (spectator, not disconnected — they can play again
   next hole), and the turn moves on to whoever is left.

   Runs its OWN server with a fast AFK clock (env-overridable, see
   server.js) rather than waiting three real minutes on the shared test
   server every other file uses.
   ========================================================================= */
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';

const PORT = 3252;
const AFK_MS = 600;
const SWEEP_MS = 250;

function start(dir) {
  return spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(PORT), GOLF_DATA_DIR: dir,
           GOLF_AFK_MS: String(AFK_MS), GOLF_AFK_SWEEP_MS: String(SWEEP_MS) },
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

const wait = ms => new Promise(r => setTimeout(r, ms));
const mk = () => io(`http://localhost:${PORT}`, { transports: ['websocket'], forceNew: true });
const rpc = (s, e, d) => new Promise(res => { let f = 0; s.emit(e, d, r => { f = 1; res(r); }); setTimeout(() => f || res(null), 3000); });

test('a silently AFK turn is benched, not left to stall the room', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'golf-afk-'));
  const srv = start(dir);
  try {
    assert.ok(await waitUp(), 'the server never came up');

    const A = mk(); await wait(200);
    let state = null;
    A.on('room:state', s => { state = s; });
    const ra = await rpc(A, 'room:create', { name: 'Ann', pid: 'AFK_A' });
    const code = ra.code;
    const B = mk(); await wait(150);
    await rpc(B, 'room:join', { code, name: 'Ben', pid: 'AFK_B' });
    await wait(150);
    A.emit('game:start');
    await wait(400);

    assert.equal(state?.state, 'playing', 'the round never actually started');
    const idlePid = state.turnPid;
    const busyPid = idlePid === 'AFK_A' ? 'AFK_B' : 'AFK_A';
    const busySocket = busyPid === 'AFK_A' ? A : B;

    // the OTHER player keeps proving they are present, so only the one
    // whose turn it is should ever be benched
    const keepAlive = setInterval(() => busySocket.emit('player:move', { x: 0, z: 0, rot: 0, moving: true }), 120);
    await wait(AFK_MS + SWEEP_MS * 2 + 300);
    clearInterval(keepAlive);

    const idle = state.players.find(p => p.pid === idlePid);
    const busy = state.players.find(p => p.pid === busyPid);
    assert.equal(idle.spectator, true, 'the silent turn was never benched');
    assert.equal(busy.spectator, false, 'the active player was benched by mistake');
    assert.equal(state.turnPid, busyPid, 'the turn did not move to the only remaining player');

    A.disconnect(); B.disconnect();
  } finally {
    srv.kill('SIGKILL');
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

test('the connection-quality heartbeat does not count as being present', async () => {
  /* net.js runs its own net:ping on a bare setInterval the entire time a
     tab is open and connected — proving the pipe is alive, not that a
     human is at the keyboard. It once passed through the same
     activity-stamping middleware as everything else, which meant a
     player who genuinely walked away with the tab open could never be
     swept: their client kept silently resetting lastActiveAt every 6s
     forever. This drives net:ping the way the real client does, on its
     own timer, and asserts the sweep still fires anyway. */
  const dir = await mkdtemp(path.join(tmpdir(), 'golf-afk-ping-'));
  const srv = start(dir);
  try {
    assert.ok(await waitUp(), 'the server never came up');

    const A = mk(); await wait(200);
    let state = null;
    A.on('room:state', s => { state = s; });
    const ra = await rpc(A, 'room:create', { name: 'Ann', pid: 'AFK_PING_A' });
    const code = ra.code;
    const B = mk(); await wait(150);
    await rpc(B, 'room:join', { code, name: 'Ben', pid: 'AFK_PING_B' });
    await wait(150);
    A.emit('game:start');
    await wait(400);

    assert.equal(state?.state, 'playing', 'the round never actually started');
    const idlePid = state.turnPid;
    const idleSocket = idlePid === 'AFK_PING_A' ? A : B;

    // the idle player's tab is "open" — only pinging, never actually acting
    const pinger = setInterval(() => idleSocket.emit('net:ping', Date.now(), () => {}), 150);
    await wait(AFK_MS + SWEEP_MS * 2 + 300);
    clearInterval(pinger);

    const idle = state.players.find(p => p.pid === idlePid);
    assert.equal(idle.spectator, true, 'a live net:ping stream kept the silent turn from being benched');

    A.disconnect(); B.disconnect();
  } finally {
    srv.kill('SIGKILL');
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

test('a solo round is never benched out from under the only player', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'golf-afk-solo-'));
  const srv = start(dir);
  try {
    assert.ok(await waitUp(), 'the server never came up');
    const A = mk(); await wait(200);
    let state = null;
    A.on('room:state', s => { state = s; });
    await rpc(A, 'room:create', { name: 'Solo', pid: 'AFK_SOLO' });
    A.emit('game:start');
    await wait(400);
    assert.equal(state?.state, 'playing');

    await wait(AFK_MS + SWEEP_MS * 2 + 300);   // long enough to sweep several times over
    const me = state.players.find(p => p.pid === 'AFK_SOLO');
    assert.equal(me.spectator, false, 'the only player in the room was benched');
    assert.equal(state.turnPid, 'AFK_SOLO', 'the solo player lost their own turn');

    A.disconnect();
  } finally {
    srv.kill('SIGKILL');
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});
