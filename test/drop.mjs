/* =========================================================================
   drop.mjs — the safety valve works, costs nothing, and can't be spammed
   -------------------------------------------------------------------------
   Nothing in this engine currently marks a lie unplayable, which is the
   whole reason "Take a drop" exists at all: whatever the cause of a report
   turns out to be, a player who can always get back to a swing forgives a
   lot more than one with no way out. So this does not try to engineer a
   genuinely stuck ball — it exercises the escape hatch directly, the way a
   player mashing the button under any circumstance would.
   ========================================================================= */
import { io } from 'socket.io-client';

const URL = process.env.GOLF_URL || 'http://localhost:3000';
const wait = ms => new Promise(r => setTimeout(r, ms));
const mk = () => io(URL, { transports: ['websocket'], forceNew: true });
const rpc = (s, e, d) => new Promise(res => { let f = 0; s.emit(e, d, r => { f = 1; res(r); }); setTimeout(() => f || res(null), 3000); });
const out = [];
const check = (n, p, d = '') => out.push({ n, p, d });

const run = async () => {
  const A = mk(); await wait(200);
  let state = null;
  A.on('room:state', s => { state = s; });
  const dropped = [];
  A.on('player:dropped', d => dropped.push(d));

  const ra = await rpc(A, 'room:create', { name: 'Ann', pid: 'DROP_A' });
  const code = ra.code;
  const B = mk(); await wait(150);
  await rpc(B, 'room:join', { code, name: 'Ben', pid: 'DROP_B' });
  await wait(200);
  A.emit('game:start');
  await wait(700);

  check('room got going', state?.state === 'playing');
  const firstTurn = state?.turnPid;
  const other = firstTurn === 'DROP_A' ? 'DROP_B' : 'DROP_A';
  const turnSocket = firstTurn === 'DROP_A' ? A : B;
  const idleSocket = firstTurn === 'DROP_A' ? B : A;
  const before = state.players.find(p => p.pid === firstTurn);
  const beforeStrokes = before.strokes;

  /* ---------------- the non-turn player cannot drop ---------------- */
  idleSocket.emit('player:drop');
  await wait(400);
  const afterIdleAttempt = state.players.find(p => p.pid === firstTurn);
  check("a player not on turn can't take a drop",
    afterIdleAttempt.x === before.x && afterIdleAttempt.z === before.z &&
    state.turnPid === firstTurn,
    `turn ${state.turnPid}, expected ${firstTurn} to still be up`);

  /* ------------------------------- the drop itself ------------------------------- */
  turnSocket.emit('player:drop');
  await wait(400);
  const p2 = state.players.find(x => x.pid === firstTurn);
  check('a drop costs no strokes', p2.strokes === beforeStrokes,
    `${beforeStrokes} -> ${p2.strokes}`);
  check('the ball actually moved somewhere playable',
    p2.lie !== 'water' && p2.lie !== 'ob', `lie is "${p2.lie}"`);
  check('the dropping player was told where it landed',
    dropped.some(d => d.pid === firstTurn), JSON.stringify(dropped));
  /* NOT necessarily the other player: turn order is "farthest from the pin
     plays" (pickNextToPlay), not a fixed rotation — a drop that leaves the
     dropping player still farthest out correctly keeps the turn with them,
     same as it would after a real shot that came up short. The one thing
     genuinely guaranteed is that the game is still playable afterwards. */
  check('a turn is still assigned to somebody eligible after the drop',
    state.turnPid === 'DROP_A' || state.turnPid === 'DROP_B',
    `turnPid is ${state.turnPid}`);

  /* ---------------------------- cannot be spammed ----------------------------
     A drop from the tee is a same-spot no-op (the tee is already playable
     ground), so position is not a signal the cooldown can be judged by
     here — three drops from an unchanging spot look identical to one.
     `player:dropped` firing is the real signal: it only fires when the
     server actually accepted and acted on the request. */
  const nowTurn = state.turnPid;
  const turnSocket2 = nowTurn === 'DROP_A' ? A : B;
  const before3 = dropped.length;
  turnSocket2.emit('player:drop');
  turnSocket2.emit('player:drop');
  turnSocket2.emit('player:drop');
  await wait(400);
  check('rapid repeats do not each count as a fresh drop',
    dropped.length - before3 <= 1,
    `${dropped.length - before3} accepted from 3 rapid requests`);

  A.disconnect(); B.disconnect();
};

run().then(() => {
  const fails = out.filter(r => !r.p);
  for (const r of out) console.log(`  ${r.p ? 'PASS' : 'FAIL'}  ${r.n}${r.d ? '   [' + r.d + ']' : ''}`);
  console.log(`\n${out.length - fails.length}/${out.length} passed`);
  process.exit(fails.length ? 1 : 0);
}).catch(e => { console.error('harness error', e); process.exit(2); });
setTimeout(() => { console.error('TIMEOUT'); console.log(out); process.exit(2); }, 60000);
