/* Connection-resilience tests: mid-hole refresh, disconnect across a hole
   change, spectator promotion, host migration. */
import { io } from 'socket.io-client';
import { getCourse } from '../public/js/shared/coursegen.js';
import { terrainFor } from '../public/js/shared/terrain.js';
import { BIOMES } from '../public/js/shared/biomes.js';
import { calibrateCarries, suggestedPower } from '../public/js/shared/ballistics.js';
import { suggestClub } from '../public/js/shared/clubs.js';
calibrateCarries();

/* Point the socket tests at a server on another port with GOLF_URL, so a
   run can verify a FRESH server without killing the one you are playing on.
   Server-side changes need a restart to take effect, and testing against a
   process that booted before the change is how a fix gets signed off twice
   and shipped never. */
const URL = process.env.GOLF_URL || 'http://localhost:3000';
const wait = ms => new Promise(r => setTimeout(r, ms));
const out = [];
const check = (n, p, d = '') => out.push({ n, p, d });
const mk = () => io(URL, { transports: ['websocket'], forceNew: true });
const rpc = (s, e, d) => new Promise(res => { let f = 0; s.emit(e, d, r => { f = 1; res(r); }); setTimeout(() => f || res(null), 3000); });

let state = null;
const watch = s => s.on('room:state', x => { state = x; });

/** play one shot for whoever is up, using the caddie */
function playTurn(sockets) {
  if (!state || state.state !== 'playing' || !state.turnPid) return false;
  const p = state.players.find(x => x.pid === state.turnPid);
  const s = sockets[p.pid];
  if (!s) return false;
  const h = getCourse(state.courseId).holes[state.holeIndex];
  const T = terrainFor(h, BIOMES[state.courseId]);
  const dist = Math.hypot(h.pin.x - p.x, h.pin.z - p.z);
  const lie = T.surfaceAt(p.x, p.z);
  const club = suggestClub(dist, lie.id, lie.id === 'green');
  const aim = Math.atan2(h.pin.x - p.x, h.pin.z - p.z);
  const pw = suggestedPower(T, p.x, p.z, club.key, aim, state.wind, dist + (club.putter ? 0.45 : 0)) ?? 1;
  s.emit('player:move', { x: p.x, z: p.z, rot: aim, moving: false });
  s.emit('game:swing', { clubKey: club.key, power: pw, aim, faceDeg: 0, attackDeg: 0 });
  return true;
}

const run = async () => {
  /* ---- set up a 3-player room ---- */
  let A = mk(); await wait(300); watch(A);
  const ra = await rpc(A, 'room:create', { name: 'Ann', pid: 'PA' });
  const code = ra.code;
  const B = mk(); await wait(120); watch(B);
  await rpc(B, 'room:join', { code, name: 'Ben', pid: 'PB' });
  const C = mk(); await wait(120); watch(C);
  await rpc(C, 'room:join', { code, name: 'Cai', pid: 'PC' });
  A.emit('game:start'); await wait(700);
  check('3 players started', state?.players.length === 3 && state.state === 'playing');

  const socks = { PA: A, PB: B, PC: C };

  /* ---- 1. mid-hole refresh keeps your seat, ball and strokes ---- */
  for (let i = 0; i < 4; i++) { playTurn(socks); await wait(500); }
  const beforeRefresh = state.players.find(p => p.pid === 'PB');
  B.close(); await wait(400);
  const gone = state.players.find(p => p.pid === 'PB');
  check('disconnect marks player away, keeps them on the card',
    !!gone && gone.connected === false && gone.strokes === beforeRefresh.strokes,
    `strokes ${gone?.strokes}`);

  const B2 = mk(); await wait(250); watch(B2); socks.PB = B2;
  const rj = await rpc(B2, 'room:join', { code, name: 'Ben', pid: 'PB' });
  await wait(300);
  const back = state.players.find(p => p.pid === 'PB');
  check('rejoin restores the same seat mid-hole',
    rj?.ok && rj.rejoined === true && back.connected &&
    back.strokes === beforeRefresh.strokes &&
    Math.abs(back.x - beforeRefresh.x) < 0.01 && Math.abs(back.z - beforeRefresh.z) < 0.01,
    `strokes ${back?.strokes}, pos match ${Math.abs(back.x - beforeRefresh.x) < 0.01}`);

  /* ---- 2. turn never stalls on an absent player ---- */
  C.close(); await wait(400);
  check('turn skips the disconnected player',
    state.turnPid !== 'PC' || state.state !== 'playing', `turn=${state.turnPid}`);

  /* ---- 3. finish hole 1 with C still away, then cross to hole 2 ---- */
  let guard = 0;
  while (state.state === 'playing' && guard++ < 60) { playTurn(socks); await wait(420); }
  check('hole completes with a player absent', state.state === 'holeover', `state=${state.state}`);

  const cScoreBefore = state.players.find(p => p.pid === 'PC')?.scores[0];
  A.emit('game:next'); await wait(900);

  const cAfter = state.players.find(p => p.pid === 'PC');
  check('ABSENT PLAYER SURVIVES THE HOLE CHANGE',
    !!cAfter, cAfter ? `kept, hole-1 score ${cAfter.scores[0]}` : 'DROPPED from the room');

  /* ---- 4. they can come back and still have their card ---- */
  const C2 = mk(); await wait(250); watch(C2); socks.PC = C2;
  const rc = await rpc(C2, 'room:join', { code, name: 'Cai', pid: 'PC' });
  await wait(400);
  const cBack = state.players.find(p => p.pid === 'PC');
  check('reconnect after a hole change keeps the scorecard',
    rc?.ok && cBack && cBack.scores[0] === cScoreBefore && !cBack.spectator,
    `rejoined=${rc?.rejoined} spectator=${cBack?.spectator} h1=${cBack?.scores[0]} (was ${cScoreBefore})`);

  /* ---- 5. late joiner is a spectator, promoted next hole ---- */
  const D = mk(); await wait(250); watch(D);
  const rd = await rpc(D, 'room:join', { code, name: 'Dee', pid: 'PD' });
  await wait(300);
  const dNow = state.players.find(p => p.pid === 'PD');
  check('mid-round joiner is a spectator', rd?.ok && dNow?.spectator === true);

  socks.PD = D;
  guard = 0;
  while (state.state === 'playing' && guard++ < 60) { playTurn(socks); await wait(420); }
  if (state.state === 'holeover') { A.emit('game:next'); await wait(900); }
  const dLater = state.players.find(p => p.pid === 'PD');
  check('spectator promoted at the next hole', dLater && dLater.spectator === false,
    `spectator=${dLater?.spectator}`);

  /* ---- 6. host migration ---- */
  const hostWas = state.hostPid;
  A.close(); await wait(600);
  check('host migrates when the host leaves',
    state.hostPid && state.hostPid !== hostWas, `${hostWas} -> ${state.hostPid}`);

  for (const s of [B2, C2, D]) s.close();
  await wait(200);

  const fails = out.filter(r => !r.p);
  for (const r of out) console.log(`  ${r.p ? 'PASS' : 'FAIL'}  ${r.n}${r.d ? '   [' + r.d + ']' : ''}`);
  console.log(`\n${out.length - fails.length}/${out.length} passed`);
  process.exit(fails.length ? 1 : 0);
};
run().catch(e => { console.error('harness error', e); process.exit(2); });
setTimeout(() => { console.error('TIMEOUT'); console.log(out); process.exit(2); }, 180000);
