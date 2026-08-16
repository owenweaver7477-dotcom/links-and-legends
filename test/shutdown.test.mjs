/* =========================================================================
   shutdown.test.mjs — a deploy does not eat the last few seconds
   -------------------------------------------------------------------------
   Profile writes are debounced by 800 ms. The shutdown path called
   `process.exit(0)` as soon as the HTTP server closed, so everything inside
   that window went with it — and a host that redeploys on every push does
   that several times a day. From a player's side it is indistinguishable
   from the game not saving, which is a complaint this project has already
   had once.

   The reason it survived a careful reading is better than the bug. A
   graceful shutdown WAS added to server.js, and it was dead code: the store
   registers its own SIGTERM listener when it claims the lock file, that
   listener calls `process.exit(0)`, and Node runs signal listeners in
   registration order. The store's ran first, every time. The new handler
   never logged and never flushed, and nothing about either file looked
   wrong on its own.

   That is only observable from outside the process, so this test spawns a
   real server, changes something, sends it a real SIGTERM and reads the
   disk.
   ========================================================================= */

import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';

const PORT = 3247;
const PID = 'shutdown-flush-check';

/** Wait for the server to answer, or give up. */
async function waitForBoot(ms = 12000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(`http://localhost:${PORT}/healthz`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

test('SIGTERM writes pending changes before exiting', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'golf-shutdown-'));
  const srv = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(PORT), GOLF_DATA_DIR: dir, NODE_ENV: 'test' },
    stdio: 'ignore'
  });

  try {
    assert.ok(await waitForBoot(), 'the test server never came up');

    const s = io(`http://localhost:${PORT}`, { transports: ['websocket'] });
    await new Promise((res, rej) => {
      s.on('connect', res);
      setTimeout(() => rej(new Error('socket never connected')), 6000);
    });
    s.emit('profile:me', { pid: PID, name: 'Flusher' });
    await new Promise(res => s.once('profile', res));

    /* Change something and kill the server almost immediately — well inside
       the save debounce, which is the whole point. */
    s.emit('player:look', { look: { shirt: '#5c8a4a', hat: 'visor' } });
    await new Promise(r => setTimeout(r, 120));
    s.close();

    const gone = new Promise(res => srv.once('exit', res));
    srv.kill('SIGTERM');
    await Promise.race([gone, new Promise(r => setTimeout(r, 9000))]);

    const raw = await readFile(path.join(dir, 'profiles.json'), 'utf8')
      .catch(() => null);
    assert.ok(raw, 'no profiles file was written at all');
    const saved = JSON.parse(raw)[PID];
    assert.ok(saved, `${PID} is not in the saved store`);
    assert.equal(saved.look?.shirt, '#5c8a4a', 'the look change was lost on shutdown');
    assert.equal(saved.look?.hat, 'visor');
  } finally {
    srv.kill('SIGKILL');
    await rm(dir, { recursive: true, force: true });
  }
});

test('the writer lock is released on the way out', async () => {
  /* The lock exists so two servers cannot share a data directory. If a clean
     shutdown left it behind, the next boot would refuse to start — which is
     a worse failure than the one the lock prevents. */
  const dir = await mkdtemp(path.join(tmpdir(), 'golf-lock-'));
  const srv = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(PORT + 1), GOLF_DATA_DIR: dir },
    stdio: 'ignore'
  });
  try {
    const until = Date.now() + 12000;
    while (Date.now() < until) {
      try { if ((await fetch(`http://localhost:${PORT + 1}/healthz`)).ok) break; }
      catch { /* not yet */ }
      await new Promise(r => setTimeout(r, 200));
    }
    const gone = new Promise(res => srv.once('exit', res));
    srv.kill('SIGTERM');
    await Promise.race([gone, new Promise(r => setTimeout(r, 9000))]);
    const still = await readFile(path.join(dir, '.writer.lock'), 'utf8').catch(() => null);
    assert.equal(still, null, 'the lock file outlived the process that held it');
  } finally {
    srv.kill('SIGKILL');
    await rm(dir, { recursive: true, force: true });
  }
});
