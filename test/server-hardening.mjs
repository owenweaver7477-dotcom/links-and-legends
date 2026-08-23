/* Adversarial server test: hostile names, malformed swings, out-of-turn play,
   spoofed positions, flooding, and disconnect/rejoin around a hole change. */
import { io } from 'socket.io-client';
/* Point the socket tests at a server on another port with GOLF_URL, so a
   run can verify a FRESH server without killing the one you are playing on.
   Server-side changes need a restart to take effect, and testing against a
   process that booted before the change is how a fix gets signed off twice
   and shipped never. */
const URL = process.env.GOLF_URL || 'http://localhost:3000';
const wait = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, pass, detail = '') =>
  results.push({ name, pass, detail });

function mk(pid) {
  return io(URL, { transports: ['websocket'], forceNew: true, query: { t: pid } });
}
const rpc = (s, evt, data) => new Promise(res => {
  let done = false;
  s.emit(evt, data, r => { done = true; res(r); });
  setTimeout(() => { if (!done) res(null); }, 3000);
});

const run = async () => {
  /* ---------------- 1. hostile names ---------------- */
  const a = mk('a'); await wait(300);
  const hostile = [
    ['<img src=x onerror=alert(1)>', 'html tag'],
    ['<b>bold</b>', 'markup'],
    ['"><script>x', 'attribute break'],
    ['a\u0000b\u001fc\u007f', 'control chars'],
    ['   ', 'whitespace only'],
    ['Ω山田 José-Ann', 'international'],
    ['x'.repeat(500), 'overlong']
  ];
  let r = await rpc(a, 'room:create', { name: hostile[0][0], pid: 'atk1' });
  check('create with hostile name succeeds', !!r?.ok, r?.error || '');
  const code = r?.code;
  let nm = r?.state?.players?.[0]?.name;
  check('hostile name stripped of markup', !/[<>&"']/.test(nm || ''), `-> "${nm}"`);

  for (const [raw, label] of hostile.slice(1)) {
    const c = mk(label); await wait(120);
    const rr = await rpc(c, 'room:join', { code, name: raw, pid: 'p_' + Math.random().toString(36).slice(2, 9) });
    const got = rr?.ok ? rr.state.players.at(-1).name : null;
    check(`name sanitised: ${label}`,
      // spaces and hyphens are legitimate in names; markup characters are not
      rr?.ok && got != null && !/[<>&"\u0027]/.test(got) && got.length <= 14,
      `"${raw.slice(0, 20)}" -> "${got}"`);
    c.close();
  }

  /* ---------------- 2. malformed swings ---------------- */
  const b = mk('b'); await wait(200);
  let state = null;
  a.on('room:state', x => { state = x; });
  b.on('room:state', x => { state = x; });
  const rb = await rpc(b, 'room:join', { code, name: 'Bee', pid: 'pb' });
  check('second player joined', !!rb?.ok);
  a.emit('game:start'); await wait(600);

  await wait(300);

  const turnIsA = state?.turnPid === 'atk1';
  const shooter = turnIsA ? a : b;
  const idler = turnIsA ? b : a;

  // out of turn
  const before = JSON.parse(JSON.stringify(state.players));
  idler.emit('game:swing', { clubKey: 'DR', power: 1, aim: 0, faceDeg: 0, attackDeg: 0 });
  await wait(400);
  check('out-of-turn swing rejected',
    state.players.every((p, i) => p.strokes === before[i].strokes));

  // garbage payloads must not crash the server or move anything
  const garbage = [
    null, undefined, 'string', 42, [],
    { clubKey: 'NOPE', power: 1, aim: 0 },
    { clubKey: 'DR', power: NaN, aim: 0 },
    { clubKey: 'DR', power: Infinity, aim: 0 },
    { clubKey: 'DR', power: 1e9, aim: 1e9 },
    { clubKey: 'DR', power: -5, aim: 0 },
    { clubKey: 'DR', power: 1, aim: NaN },
    { clubKey: 'DR', power: 1, aim: 0, faceDeg: 1e6, attackDeg: 1e6 },
    { clubKey: 'DR', power: 1, aim: 0, x: 99999, z: 99999 },   // spoofed position
    { clubKey: { toString() { throw new Error('boom'); } }, power: 1, aim: 0 }
  ];
  const s0 = JSON.parse(JSON.stringify(state.players));
  for (const g of garbage) { try { idler.emit('game:swing', g); } catch (_) {} }
  await wait(700);
  const alive = await rpc(a, 'room:join', { code, name: 'atk', pid: 'atk1' });
  check('server survives garbage swings', !!alive?.ok);
  check('garbage swings moved nothing',
    state.players.every((p, i) => p.strokes === s0[i].strokes));

  // spoofed position on a LEGAL swing: server must use its own ball
  const legalShooter = state.turnPid === 'atk1' ? a : b;
  const meBefore = state.players.find(p => p.pid === state.turnPid);
  const posBefore = { x: meBefore.x, z: meBefore.z };
  legalShooter.emit('game:swing', { clubKey: 'PW', power: 0.5, aim: 0, faceDeg: 0, attackDeg: 0, x: 5000, z: 5000 });
  await wait(900);
  const meAfter = state.players.find(p => p.pid === meBefore.pid);
  const moved = Math.hypot(meAfter.x - posBefore.x, meAfter.z - posBefore.z);
  check('legal swing applied', meAfter.strokes === meBefore.strokes + 1, `strokes ${meBefore.strokes}->${meAfter.strokes}`);
  check('spoofed position ignored', moved < 400 && Math.abs(meAfter.x) < 900, `moved ${moved.toFixed(0)}m to (${meAfter.x.toFixed(0)},${meAfter.z.toFixed(0)})`);

  /* ---------------- 3. flooding ---------------- */
  const t0 = Date.now();
  for (let i = 0; i < 3000; i++) idler.emit('game:swing', { clubKey: 'DR', power: 1, aim: i });
  await wait(1200);
  const alive2 = await rpc(a, 'room:join', { code, name: 'atk', pid: 'atk1' });
  check('server survives 3000-message flood', !!alive2?.ok, `${Date.now() - t0}ms`);

  /* ---------------- 4. non-host cannot control the room ---------------- */
  const nonHost = state.hostPid === 'atk1' ? b : a;
  const hp = state.hostPid;
  nonHost.emit('game:start');
  nonHost.emit('room:course', { courseId: 'desert' });
  nonHost.emit('game:again');
  nonHost.emit('room:lobby');
  await wait(500);
  check('non-host cannot hijack the room', state.hostPid === hp && state.state === 'playing',
    `host=${state.hostPid} state=${state.state}`);

  /* ---------------- 5. bad room codes ---------------- */
  const c2 = mk('c2'); await wait(200);
  const bad = await rpc(c2, 'room:join', { code: '../../etc/passwd', name: 'x', pid: 'pz' });
  check('path-ish room code rejected cleanly', bad && bad.ok === false, bad?.error);
  const bad2 = await rpc(c2, 'room:join', { code: 'ZZZZ', name: 'x', pid: 'pz' });
  check('unknown room code rejected cleanly', bad2 && bad2.ok === false, bad2?.error);
  const bad3 = await rpc(c2, 'room:create', { name: 'x', pid: '' });
  check('empty pid rejected', bad3 && bad3.ok === false, bad3?.error);
  c2.close();

  /* ---------------- 6. player cap ---------------- */
  const extras = [];
  for (let i = 0; i < 9; i++) {
    const e = mk('e' + i); extras.push(e); await wait(60);
    await rpc(e, 'room:join', { code, name: 'X' + i, pid: 'cap' + i });
  }
  await wait(400);
  check('player cap enforced at 8', state.players.filter(p => p.connected).length <= 8,
    `${state.players.filter(p => p.connected).length} connected`);
  for (const e of extras) e.close();

  /* ---------------- 7. carts ---------------- */
  // A cart is cosmetic — the shot is simulated server-side from the server's
  // own ball position — so the real risks are a hostile payload crashing the
  // server and a stuck seat locking a player out of ever playing again.
  const ca = mk('ca'); await wait(150);
  const rc = await rpc(ca, 'room:create', { name: 'Cartie', pid: 'cart_a' });
  const ccode = rc?.code;
  const cb = mk('cb'); await wait(150);
  await rpc(cb, 'room:join', { code: ccode, name: 'Rider', pid: 'cart_b' });
  let cstate = null;
  ca.on('room:state', x => { cstate = x; });
  cb.on('room:state', x => { cstate = x; });
  ca.emit('game:start'); await wait(700);

  const meA = () => cstate?.players.find(p => p.pid === 'cart_a');
  const startStrokes = meA()?.strokes ?? 0;

  // NB: nothing here may exceed maxHttpBufferSize (1e5) — the server drops the
  // connection for oversized frames, which is correct but would leave every
  // later assertion running against a dead socket.  That case is tested on its
  // own connection at the end of this section.
  const nasty = [
    [{ s: 'd', x: NaN, z: Infinity, h: 'x', v: 1e9, r: '../../etc/passwd' }, 'NaN + traversal'],
    [[], 'array'],
    ['driver', 'string'],
    [{ s: 'zzz' }, 'unknown seat'],
    [{ s: 'd', x: 1e12, z: -1e12, h: 1e12, v: 999, r: 'x'.repeat(4000) }, 'huge values + 4kB pid'],
    [{ s: 'd', x: 0, z: 0, h: 0, v: 0, r: { toString() { throw new Error('boom'); } } }, 'throwing pid'],
    [{ s: 'p', o: null }, 'passenger with no driver']
  ];
  for (const [cart] of nasty) {
    ca.emit('player:move', { x: 0, z: 0, rot: 0, moving: false, cart });
    await wait(90);
  }
  await wait(300);
  check('server survives hostile cart payloads',
    !!cstate && cstate.players.length === 2, nasty.length + ' payloads');
  check('a seat claim never changes strokes', (meA()?.strokes ?? 0) === startStrokes);
  const cf = meA()?.cart;
  check('the snapshot carries seat membership, never the cart pose',
    cf == null || (cf.x === undefined && cf.z === undefined));

  // Claiming a seat must block the swing.  Aim this at whichever bot actually
  // has the turn, or the check passes without ever exercising the gate.
  const upPid = cstate?.turnPid;
  const upSock = upPid === 'cart_a' ? ca : cb;
  const upBefore = cstate?.players.find(p => p.pid === upPid)?.strokes ?? 0;
  upSock.emit('player:move', { x: 0, z: 0, rot: 0, moving: false, cart: { s: 'd', x: 0, z: 0, h: 0, v: 0, r: null } });
  await wait(200);
  let refused = null;
  upSock.once('toast', t => { refused = t?.msg || ''; });
  upSock.emit('game:swing', { clubKey: 'DR', power: 0.9, aim: 0, faceDeg: 0, attackDeg: 0 });
  await wait(450);
  check('cannot swing while sat in a cart', /cart/i.test(refused || ''),
    upPid + ' refused with: ' + refused);
  check('a refused swing costs no strokes',
    (cstate?.players.find(p => p.pid === upPid)?.strokes ?? -1) === upBefore);
  // release the seat again so the TTL test below starts from a known state
  upSock.emit('player:move', { x: 0, z: 0, rot: 0, moving: false });
  await wait(150);
  ca.emit('player:move', { x: 0, z: 0, rot: 0, moving: false, cart: { s: 'd', x: 0, z: 0, h: 0, v: 0, r: null } });
  await wait(150);

  // The important one: stop mentioning carts and the seat expires by itself.
  // A flag needing explicit clearing on disconnect / hole change / reconnect
  // would eventually stick, and with no turn timer that wedges the whole room.
  await wait(1500);
  ca.emit('player:move', { x: 0, z: 0, rot: 0, moving: false });
  await wait(350);
  check('a seat claim expires with no client cooperation at all',
    meA()?.cart == null, 'after the 1200 ms TTL');

  let after = null;
  ca.once('toast', t => { after = t?.msg || ''; });
  ca.emit('game:swing', { clubKey: 'DR', power: 0.9, aim: 0, faceDeg: 0, attackDeg: 0 });
  await wait(500);
  check('and the player can play again once it has', !/cart/i.test(after || ''),
    after ? 'toast: ' + after : 'accepted');

  // Both bots sit on the tee, so they are well inside the 12 m hail radius.
  // Assert the offer actually ARRIVES as well as being rate limited — a hail
  // that silently never fires would pass a "<= 1" check while being broken.
  let hails = 0;
  cb.on('toast', t => { if (/lift/i.test(t?.msg || '')) hails++; });
  ca.emit('player:move', { x: 0, z: 0, rot: 0, moving: false, cart: { s: 'd', x: 0, z: 0, h: 0, v: 0, r: null } });
  await wait(200);
  for (let i = 0; i < 10; i++) { ca.emit('cart:hail'); await wait(40); }
  await wait(500);
  check('offering a lift reaches the other player', hails >= 1, hails + ' received');
  check('and ten attempts still only send one', hails === 1, hails + ' offers from 10 attempts');

  // An oversized cart frame must be refused at the transport, not parsed.
  // Done last and on a throwaway connection, because the server drops the
  // socket — which is the correct answer, and would poison anything after it.
  const cc = mk('cc'); await wait(200);
  await rpc(cc, 'room:join', { code: ccode, name: 'Fat', pid: 'cart_c' });
  await wait(200);
  let dropped = false;
  cc.on('disconnect', () => { dropped = true; });
  cc.emit('player:move', { x: 0, z: 0, rot: 0, moving: false,
    cart: { s: 'd', x: 0, z: 0, h: 0, v: 0, r: 'x'.repeat(200000) } });
  await wait(700);
  check('an oversized cart frame drops the connection rather than being parsed', dropped);
  const stillUp = await rpc(ca, 'cart:hail', {});
  await wait(200);
  check('and the room survives it', !!cstate && cstate.players.length >= 2,
    cstate?.players.length + ' players still listed');
  cc.close();

  ca.close(); cb.close();
  await wait(200);

  a.close(); b.close();
  await wait(300);

  /* ---------------- 8. null payloads on every handler ---------------- */
  // A parameter-list `({x} = {})` default only covers undefined, not null —
  // this exact shape once let `emit('room:course', null)` kill the process.
  const nA = mk('nA'); await wait(200);
  const nr = await rpc(nA, 'room:create', { name: 'Null', pid: 'null_a' });
  const nCode = nr?.code;
  for (const evt of ['room:course', 'room:tees', 'room:privacy', 'player:prefs', 'player:look',
                     'shop:buy', 'player:move', 'game:swing', 'game:drop', 'cart:hail',
                     'feedback:submit', 'feedback:list', 'feedback:vote', 'player:report', 'net:ping', 'player:kick', 'login:claim', 'case:open', 'case:buy']) {
    nA.emit(evt, null);
    nA.emit(evt, undefined);
    nA.emit(evt, 'string');
    nA.emit(evt, 42);
  }
  await wait(500);
  const nAlive = await rpc(nA, 'room:join', { code: nCode, name: 'Null', pid: 'null_a' });
  check('null payloads on every handler leave the server alive', !!nAlive?.ok);

  // an ack slot filled with a non-function must not be callable-crashed either
  nA.emit('room:create', { pid: 'null_a' }, 'boom');
  nA.emit('room:join', { code: 'ZZZZ', pid: 'null_a' }, 12345);
  nA.emit('room:join', { code: nCode, pid: '' }, { not: 'a function' });
  await wait(500);
  const nAlive2 = await rpc(nA, 'room:join', { code: nCode, name: 'Null', pid: 'null_a' });
  check('a non-function ack cannot crash create or join', !!nAlive2?.ok);
  nA.close();
  await wait(200);

  /* ---------------- 9. the shop till ---------------- */
  // Prototype-chain keys ('constructor' etc) once resolved to truthy objects
  // with an undefined cost — one purchase NaN'd the balance permanently.
  const sA = mk('sA');
  let prof = null;
  sA.on('profile', p => { prof = p; });
  await wait(200);
  await rpc(sA, 'room:create', { name: 'Shopper', pid: 'shop_a' });
  await wait(300);
  const coins0 = prof?.coins;
  for (const item of ['constructor', 'toString', '__proto__', 'hasOwnProperty',
                      'caddie:constructor', 'caddie:__proto__', 'club:constructor']) {
    sA.emit('shop:buy', { item });
    await wait(60);
  }
  await wait(400);
  // ask for a fresh profile via a rejected known-item purchase (server replies
  // with a toast either way; profile arrives only on success — so re-join)
  sA.close(); await wait(200);
  const sB = mk('sB');
  let prof2 = null;
  sB.on('profile', p => { prof2 = p; });
  await wait(200);
  await rpc(sB, 'room:create', { name: 'Shopper', pid: 'shop_a' });
  await wait(300);
  check('prototype-chain shop keys buy nothing',
    Number.isFinite(prof2?.coins) && prof2.coins === coins0
    && !Object.keys(prof2?.crew || {}).includes('constructor'),
    `coins ${coins0} -> ${prof2?.coins}`);
  sB.close();
  await wait(200);

  /* ---------------- 10. rooms are released, seats are kept honest ------- */
  // One socket creating rooms in a loop used to leak them all: the old room
  // kept a phantom `connected` player forever and the reaper skipped it.
  const lA = mk('lA'); await wait(200);
  const r1 = await rpc(lA, 'room:create', { name: 'Leaky', pid: 'leak_a' });
  const r2 = await rpc(lA, 'room:create', { name: 'Leaky', pid: 'leak_a' });
  const peek = mk('peek'); await wait(200);
  const p1 = await rpc(peek, 'room:join', { code: r1?.code, name: 'Peek', pid: 'peek_a' });
  // the first room must NOT still list leak_a as connected — either the seat
  // is marked disconnected or (lobby, never played) dropped entirely
  const ghost = p1?.state?.players?.find(p => p.pid === 'leak_a');
  check('creating a second room releases the first',
    !!p1?.ok && (!ghost || ghost.connected === false),
    ghost ? `leak_a connected=${ghost.connected}` : 'seat dropped');
  peek.close(); lA.close();
  await wait(200);

  // A second tab binding the same pid in the lobby once deleted the player
  // mid-bind, acking rejoined:true into a room that no longer listed them.
  const t1 = mk('t1'); await wait(200);
  const tr = await rpc(t1, 'room:create', { name: 'TabOne', pid: 'tab_pid' });
  const t2 = mk('t2'); await wait(200);
  const tr2 = await rpc(t2, 'room:join', { code: tr?.code, name: 'TabTwo', pid: 'tab_pid' });
  const tabSeat = tr2?.state?.players?.find(p => p.pid === 'tab_pid');
  check('a second tab keeps the seat and the host',
    !!tr2?.ok && !!tabSeat && tr2?.state?.hostPid === 'tab_pid',
    `players=${tr2?.state?.players?.length} host=${tr2?.state?.hostPid}`);
  t1.close(); t2.close();
  await wait(200);

  /* ---------------- 11. churn and amplification ---------------- */
  // Join/leave churn during a round must not grow the roster without bound.
  const hostC = mk('hostC'); await wait(200);
  const cr = await rpc(hostC, 'room:create', { name: 'Churn', pid: 'churn_host' });
  hostC.emit('game:start'); await wait(600);
  for (let i = 0; i < 24; i++) {
    const ghostS = mk('g' + i); await wait(50);
    await rpc(ghostS, 'room:join', { code: cr?.code, name: 'G' + i, pid: 'ghost' + i });
    ghostS.close();
  }
  await wait(500);
  const after8 = await rpc(hostC, 'room:join', { code: cr?.code, name: 'Churn', pid: 'churn_host' });
  check('mid-round join churn cannot grow the roster without bound',
    !!after8?.ok && (after8?.state?.players?.length ?? 999) <= 16,
    `${after8?.state?.players?.length} seats after 24 join/leave cycles`);

  // identical look/prefs spam must not fan out as full snapshots
  const wA = mk('wA'); await wait(200);
  await rpc(wA, 'room:join', { code: cr?.code, name: 'Watcher', pid: 'watch_a' });
  await wait(400);
  let casts = 0;
  wA.on('room:state', () => casts++);
  for (let i = 0; i < 60; i++) hostC.emit('player:look', { look: { shirt: '#ff0000' } });
  await wait(800);
  check('60 identical look messages coalesce to at most 2 snapshots',
    casts <= 2, `${casts} snapshots for 60 messages`);

  // ...but coalescing must never SWALLOW the last change, or a player's kit
  // silently reverts for everyone else.  Palette colours only: the server
  // allow-lists them, so arbitrary hexes are replaced by the default.
  let lastState = null;
  wA.on('room:state', st => { lastState = st; });
  for (const hex of ['#7fb6dd', '#e8735a', '#5c8a4a', '#d9a731', '#a98cd8']) {
    hostC.emit('player:look', { look: { shirt: hex } });
    await wait(20);
  }
  await wait(700);
  const finalShirt = lastState?.players?.find(p => p.pid === 'churn_host')?.look?.shirt;
  check('a coalesced burst still delivers the FINAL look',
    finalShirt === '#a98cd8', `shirt ${finalShirt}`);
  wA.close(); hostC.close();
  await wait(200);

  /* ---------------- 12. the host can leave mid-round ---------------- */
  // A round must never die because whoever created the room closed their tab.
  const hA = mk('hA'); await wait(150);
  const hr = await rpc(hA, 'room:create', { name: 'Host', pid: 'leave_host' });
  const hB = mk('hB'); await wait(150);
  await rpc(hB, 'room:join', { code: hr?.code, name: 'Other', pid: 'leave_other' });
  let hState = null; hB.on('room:state', x => { hState = x; });
  hA.emit('game:start'); await wait(700);
  hA.close(); await wait(700);
  check('the round survives the host leaving mid-round',
    hState?.state === 'playing', `state ${hState?.state}`);
  check('a connected player inherits the room',
    hState?.hostPid === 'leave_other', `host ${hState?.hostPid}`);
  check('and the leaver keeps their seat and scorecard',
    !!hState?.players?.some(p => p.pid === 'leave_host' && !p.connected));
  hB.close();
  await wait(200);

  /* ------- 13. the server as a public endpoint (portal conditions) ------- */
  // Published on a game portal this is reachable by anyone, so every handler
  // has to survive every shape of nonsense, not just the ones a real client
  // could send.  This is the cross product: every event, every junk payload.
  const pA = mk('pA'); await wait(200);
  const EVENTS = ['room:create', 'room:join', 'room:course', 'room:tees', 'room:privacy',
                  'player:prefs', 'player:move', 'player:look', 'cart:hail', 'shop:buy',
                  'game:start', 'game:swing', 'game:drop', 'game:next', 'game:again', 'room:lobby',
                  'feedback:submit', 'feedback:list', 'feedback:vote',
                  'player:report', 'net:ping', 'player:kick', 'login:claim', 'case:open', 'case:buy'];
  const JUNK = [null, undefined, 0, '', 'x', [], {}, true, NaN,
                { a: { b: { c: 1 } } }, { item: '__proto__' }, { pid: null }, { code: null }];
  for (const e of EVENTS) for (const j of JUNK) { try { pA.emit(e, j); } catch { /* ignore */ } }
  await wait(900);
  const pAlive = await rpc(pA, 'room:create', { pid: 'portal_a', name: 'A' });
  check('every event survives every junk payload',
    !!pAlive?.ok, `${EVENTS.length} events x ${JUNK.length} payloads`);
  pA.close(); await wait(150);

  // Drive-by loads: a portal sends a lot of people who open the page and leave.
  for (let i = 0; i < 30; i++) { const s = mk('churn' + i); s.close(); }
  await wait(900);
  const pB = mk('pB'); await wait(250);
  const pBAlive = await rpc(pB, 'room:create', { pid: 'portal_b', name: 'B' });
  check('survives 30 connect/disconnect cycles', !!pBAlive?.ok);
  pB.close(); await wait(150);

  /* ---------------- report ---------------- */
  const fails = results.filter(r => !r.pass);
  for (const r of results) console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '   [' + r.detail + ']' : ''}`);
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  process.exit(fails.length ? 1 : 0);
};

run().catch(e => { console.error('harness error', e); process.exit(2); });
setTimeout(() => { console.error('TIMEOUT'); process.exit(2); }, 90000);
