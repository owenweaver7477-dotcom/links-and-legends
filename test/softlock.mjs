/* =========================================================================
   softlock.mjs — a round must always be able to continue
   -------------------------------------------------------------------------
   Reported: "after taking a shot the game sometimes gets stuck on waiting for
   host to finish hole and the player can't progress."

   The room can lose its host. When the last connected player drops, the
   disconnect handler looks for an heir among connected players, finds none,
   and sets hostPid to null. Nothing on the way back in ever restores it — so
   the player reconnects into a room that has no host, and every screen that
   waits on one ("Waiting for the host…", game:next) waits forever.

   A solo player is the worst case, because there is never an heir. These
   tests drive a real server over real sockets and assert the round can always
   be continued by somebody.

   Needs a server on localhost:3000.
   ========================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const URL = 'http://localhost:3000';
const wait = ms => new Promise(r => setTimeout(r, ms));

const connect = () => new Promise((resolve, reject) => {
  const s = io(URL, { transports: ['websocket'], forceNew: true, timeout: 4000 });
  s.once('connect', () => resolve(s));
  s.once('connect_error', reject);
});

/* Only room:create and room:join acknowledge. Awaiting an event that does not
   ack waits forever, so `ask` is for the two that answer and everything else
   is a plain fire-and-forget emit — the assertion then waits on the resulting
   room:state, which is the real evidence anyway. */
const ask = (s, ev, data) => new Promise(resolve => s.emit(ev, data, resolve));

/** Latest room:state seen on this socket. */
function track(s) {
  const box = { state: null };
  s.on('room:state', st => { box.state = st; });
  return box;
}

/** Wait until `pred(state)` holds, or fail with what we last saw. */
async function until(box, pred, label, ms = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (box.state && pred(box.state)) return box.state;
    await wait(60);
  }
  assert.fail(`timed out waiting for ${label}; last state = ` +
    JSON.stringify(box.state && {
      state: box.state.state, hostPid: box.state.hostPid,
      turnPid: box.state.turnPid, holeIndex: box.state.holeIndex,
      players: box.state.players.map(p => ({ pid: p.pid, conn: p.connected, fin: p.finished }))
    }));
}

const pid = tag => tag + '-' + Math.random().toString(36).slice(2, 9);

test('a solo player who reconnects still has a host', async () => {
  const me = pid('solo');
  let s = await connect();
  let box = track(s);
  const created = await ask(s, 'room:create', { name: 'Solo', pid: me, courseId: 'parkland' });
  assert.ok(created.ok, 'room:create failed: ' + JSON.stringify(created));
  const code = created.code;

  s.emit('game:start');
  await until(box, st => st.state === 'playing', 'the round to start');

  // The connection blips — an everyday event inside a portal iframe.
  s.disconnect();
  await wait(400);

  s = await connect();
  box = track(s);
  const rejoined = await ask(s, 'room:join', { code, name: 'Solo', pid: me });
  assert.ok(rejoined.ok, 'rejoin failed: ' + JSON.stringify(rejoined));

  const st = await until(box, x => x.state === 'playing', 'to be playing again');
  assert.equal(st.hostPid, me,
    'the only player in the room is not its host, so nothing that needs a ' +
    'host can ever happen again');
  assert.equal(st.turnPid, me, 'and it must be their turn');

  s.disconnect();
});

test('a lone player can always advance the hole summary', async () => {
  const me = pid('adv');
  let s = await connect();
  let box = track(s);
  const { ok, code } = await ask(s, 'room:create', { name: 'Adv', pid: me, courseId: 'parkland' });
  assert.ok(ok);
  s.emit('game:start');
  await until(box, st => st.state === 'playing', 'the round to start');

  // Drop and come back, which is what strands the room without a host.
  s.disconnect();
  await wait(400);
  s = await connect();
  box = track(s);
  await ask(s, 'room:join', { code, name: 'Adv', pid: me });
  await until(box, st => st.state === 'playing', 'to be playing again');

  /* Play the hole out for real: tapping the putter runs the stroke count into
     the hole's cap, which is the same "finished" the cup produces. par + 6,
     so this ends within a dozen strokes. */
  for (let i = 0; i < 20; i++) {
    if (box.state?.state !== 'playing') break;
    if (box.state?.turnPid !== me) break;
    s.emit('game:swing', { clubKey: 'PT', power: 0.05, aim: 0, faceDeg: 0, attackDeg: 0 });
    await wait(140);
  }

  const over = await until(box, st => st.state === 'holeover' || st.holeIndex > 0,
    'the hole to end', 9000);

  if (over.state === 'holeover') {
    const before = over.holeIndex;
    s.emit('game:next');
    await until(box, st => st.holeIndex > before || st.state === 'results',
      'game:next to move the round on — a lone player must never be told ' +
      '"only the host can do that" in their own room', 4000);
  }
  s.disconnect();
});

test('when the host leaves for good, someone still connected inherits', async () => {
  const hostPid = pid('host'), guestPid = pid('guest');
  const hs = await connect(); const hbox = track(hs);
  const { ok, code } = await ask(hs, 'room:create', { name: 'Host', pid: hostPid, courseId: 'parkland' });
  assert.ok(ok);

  const gs = await connect(); const gbox = track(gs);
  const j = await ask(gs, 'room:join', { code, name: 'Guest', pid: guestPid });
  assert.ok(j.ok, 'guest join failed: ' + JSON.stringify(j));
  await until(hbox, st => st.players.length === 2, 'both players in the room');

  hs.emit('game:start');
  await until(gbox, st => st.state === 'playing', 'the round to start');

  hs.disconnect();
  const st = await until(gbox, x => x.hostPid === guestPid,
    'the remaining player to inherit the room');
  assert.equal(st.hostPid, guestPid);

  gs.disconnect();
});

test('the room never sits in play with nobody to play', async () => {
  const me = pid('turn');
  let s = await connect();
  let box = track(s);
  const { ok, code } = await ask(s, 'room:create', { name: 'Turn', pid: me, courseId: 'parkland' });
  assert.ok(ok);
  s.emit('game:start');
  await until(box, st => st.state === 'playing', 'the round to start');

  // Three blips in a row — reconnect storms are exactly when this went wrong.
  for (let i = 0; i < 3; i++) {
    s.disconnect();
    await wait(250);
    s = await connect();
    box = track(s);
    await ask(s, 'room:join', { code, name: 'Turn', pid: me });
    await wait(250);
  }

  const st = await until(box, x => x.state === 'playing', 'to still be playing');
  assert.equal(st.turnPid, me, 'turn was never handed back after reconnecting');
  assert.equal(st.hostPid, me, 'host was never handed back after reconnecting');

  s.disconnect();
});
