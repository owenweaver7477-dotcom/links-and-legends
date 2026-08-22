/* =========================================================================
   kick.mjs — the host acts alone, the room only acts together
   -------------------------------------------------------------------------
   §8.1. Two authorities, and they must never blur into one another: the
   host can remove somebody from their own private lobby on the spot, but
   nobody — host included in the sense of "unilaterally" — gets to eject a
   player from a PUBLIC room without the room agreeing. So this proves both
   halves separately, plus the seam between them (a private room refuses a
   vote entirely; a public one accepts either), the anti-spam floor (one
   vote per voter per target inside a cooldown), and the one thing that
   makes any of it worth doing: a kicked pid actually cannot walk back in.

   Runs its own server with a fast, env-overridable vote window (see
   server.js) so the "a stale vote resets, not carries over" behaviour is
   provable in milliseconds instead of forty-five real seconds.

   Every socket opened by a subtest is disconnected in a `finally`, not
   after the last assertion — an assertion that throws must not leave a
   client sitting there auto-reconnecting. That exact shape of bug once
   held this whole file's process open for minutes after every test had
   already reported: the failure was logged in seconds, but node --test
   never exits while a handle is still live, so nothing downstream saw a
   thing until something else killed it. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';

const PORT = 3253;
const VOTE_MS = 500;

function start(dir) {
  return spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(PORT), GOLF_DATA_DIR: dir,
           GOLF_KICK_VOTE_MS: String(VOTE_MS) },
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
const closeAll = (...sockets) => { for (const s of sockets) { try { s.disconnect(); } catch { /* already gone */ } } };

test('kicking — host authority, room votes, and the block that follows', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'golf-kick-'));
  const srv = start(dir);
  try {
    assert.ok(await waitUp(), 'the server never came up');

    await t.test('the host removes somebody from a private lobby immediately', async () => {
      const A = mk(), B = mk();
      try {
        await wait(200);
        const ra = await rpc(A, 'room:create', { name: 'Host', pid: 'kick_h1', privacy: 'private' });
        const code = ra.code;
        let kickedReason = null;
        B.on('kicked', d => { kickedReason = d?.reason; });
        await rpc(B, 'room:join', { code, name: 'Target', pid: 'kick_t1' });
        await wait(150);

        const res = await rpc(A, 'player:kick', { targetPid: 'kick_t1', reason: 'testing' });
        assert.equal(res?.ok, true, JSON.stringify(res));
        assert.equal(res.kicked, true, 'the host kick did not take effect immediately');
        await wait(200);
        assert.ok(kickedReason, 'the removed player never received a kicked event');
      } finally { closeAll(A, B); }
    });

    await t.test('nobody but the host can remove anyone in a private lobby', async () => {
      const A = mk(), B = mk(), C = mk();
      try {
        await wait(200);
        const ra = await rpc(A, 'room:create', { name: 'Host', pid: 'kick_h2', privacy: 'private' });
        const code = ra.code;
        await rpc(B, 'room:join', { code, name: 'Bee', pid: 'kick_b2' });
        await rpc(C, 'room:join', { code, name: 'Cee', pid: 'kick_c2' });
        await wait(150);

        const res = await rpc(B, 'player:kick', { targetPid: 'kick_c2' });
        assert.equal(res?.ok, false, 'a non-host removed someone from a private lobby');
        assert.match(res.error, /host/i);
      } finally { closeAll(A, B, C); }
    });

    await t.test('a public-room vote needs the threshold, not one voter', async () => {
      const A = mk(), B = mk(), C = mk(), D = mk();
      try {
        await wait(200);
        // host is not the target and not a voter here — only the three
        // "others" matter for the 60% threshold against the target
        const ra = await rpc(A, 'room:create', { name: 'Host', pid: 'kick_h3', privacy: 'public' });
        const code = ra.code;
        await rpc(B, 'room:join', { code, name: 'Bee', pid: 'kick_b3' });
        await rpc(C, 'room:join', { code, name: 'Cee', pid: 'kick_c3' });
        await rpc(D, 'room:join', { code, name: 'Dee', pid: 'kick_d3' });
        await wait(150);
        // others = {host, Bee, Cee} = 3 -> threshold = ceil(3*0.6) = 2

        const v1 = await rpc(B, 'player:kick', { targetPid: 'kick_d3' });
        assert.equal(v1?.ok, true, JSON.stringify(v1));
        assert.equal(v1.kicked, false, 'a single vote out of three others already kicked the target');
        assert.equal(v1.votes, 1);

        let kickedD = null;
        D.on('kicked', d => { kickedD = d; });
        const v2 = await rpc(C, 'player:kick', { targetPid: 'kick_d3' });
        assert.equal(v2?.ok, true, JSON.stringify(v2));
        assert.equal(v2.kicked, true, 'the second vote reached the threshold and did not kick');
        await wait(200);
        assert.ok(kickedD, 'the voted-out player never received a kicked event');
      } finally { closeAll(A, B, C, D); }
    });

    await t.test('the same voter cannot vote the same target twice inside the cooldown', async () => {
      const A = mk(), B = mk(), C = mk(), D = mk();
      try {
        await wait(200);
        const ra = await rpc(A, 'room:create', { name: 'Host', pid: 'kick_h4', privacy: 'public' });
        const code = ra.code;
        await rpc(B, 'room:join', { code, name: 'Bee', pid: 'kick_b4' });
        await rpc(C, 'room:join', { code, name: 'Cee', pid: 'kick_c4' });
        await rpc(D, 'room:join', { code, name: 'Dee', pid: 'kick_d4' });
        await wait(150);

        const v1 = await rpc(B, 'player:kick', { targetPid: 'kick_d4' });
        assert.equal(v1?.ok, true);
        const v2 = await rpc(B, 'player:kick', { targetPid: 'kick_d4' });
        assert.equal(v2?.ok, false, 'a repeat vote from the same player was accepted');
      } finally { closeAll(A, B, C, D); }
    });

    await t.test('a stale vote resets instead of quietly carrying a tally forever', async () => {
      const A = mk(), B = mk(), C = mk(), D = mk();
      try {
        await wait(200);
        const ra = await rpc(A, 'room:create', { name: 'Host', pid: 'kick_h5', privacy: 'public' });
        const code = ra.code;
        await rpc(B, 'room:join', { code, name: 'Bee', pid: 'kick_b5' });
        await rpc(C, 'room:join', { code, name: 'Cee', pid: 'kick_c5' });
        await rpc(D, 'room:join', { code, name: 'Dee', pid: 'kick_d5' });
        await wait(150);

        const v1 = await rpc(B, 'player:kick', { targetPid: 'kick_d5' });
        assert.equal(v1.votes, 1);

        await wait(VOTE_MS + 200);   // let the window go stale

        const v2 = await rpc(C, 'player:kick', { targetPid: 'kick_d5' });
        assert.equal(v2.kicked, false, 'a stale vote plus a fresh one reached the threshold — the window never reset');
        assert.equal(v2.votes, 1, `expected a fresh tally of 1, got ${v2.votes} — the old vote carried over`);
      } finally { closeAll(A, B, C, D); }
    });

    await t.test('a public-room vote is refused below the minimum room size', async () => {
      const A = mk(), B = mk();
      try {
        await wait(200);
        const ra = await rpc(A, 'room:create', { name: 'Host', pid: 'kick_h6', privacy: 'public' });
        await rpc(B, 'room:join', { code: ra.code, name: 'Bee', pid: 'kick_b6' });
        await wait(150);
        // only {host, Bee} connected — a vote by Bee against the host has zero
        // "others" left, nowhere near enough for a vote to mean anything
        const res = await rpc(B, 'player:kick', { targetPid: 'kick_h6' });
        assert.equal(res?.ok, false, 'a vote was accepted with far too few players present');
      } finally { closeAll(A, B); }
    });

    await t.test('a removed player cannot walk straight back into the same room', async () => {
      const A = mk(), B = mk();
      let B2 = null;
      try {
        await wait(200);
        const ra = await rpc(A, 'room:create', { name: 'Host', pid: 'kick_h7', privacy: 'private' });
        const code = ra.code;
        await rpc(B, 'room:join', { code, name: 'Target', pid: 'kick_t7' });
        await wait(150);

        const kick = await rpc(A, 'player:kick', { targetPid: 'kick_t7' });
        assert.equal(kick?.ok, true);
        await wait(200);

        // A FRESH connection, not the one the server just kicked. B itself
        // is now mid-reconnect (Socket.IO retries a server-initiated
        // disconnect by default) and anything emitted on it queues until
        // that finishes rather than acking on this room:join — which is
        // real, correct client behaviour, just not what a rejoin attempt
        // looks like in practice: net.js's own 'kicked' handler sends a
        // removed player back to the menu, it never auto-rejoins.
        B2 = mk(); await wait(200);
        const rejoin = await rpc(B2, 'room:join', { code, name: 'Target', pid: 'kick_t7' });
        assert.equal(rejoin?.ok, false, 'a kicked pid was allowed straight back into the room it was removed from');
        assert.match(rejoin.error, /remov|kick/i);
      } finally { closeAll(A, B, B2); }
    });

    await t.test('you cannot target yourself, and a departed pid is refused cleanly', async () => {
      const A = mk();
      try {
        await wait(200);
        const ra = await rpc(A, 'room:create', { name: 'Host', pid: 'kick_h8', privacy: 'private' });
        const self = await rpc(A, 'player:kick', { targetPid: 'kick_h8' });
        assert.equal(self?.ok, false, 'kicking yourself was accepted');
        const ghost = await rpc(A, 'player:kick', { targetPid: 'never_here' });
        assert.equal(ghost?.ok, false, 'kicking a pid not in the room was accepted');
      } finally { closeAll(A); }
    });
  } finally {
    srv.kill('SIGKILL');
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});
