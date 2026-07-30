/* Adversarial server test: hostile names, malformed swings, out-of-turn play,
   spoofed positions, flooding, and disconnect/rejoin around a hole change. */
import { io } from 'socket.io-client';
const URL = 'http://localhost:3000';
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

  /* ---------------- report ---------------- */
  const fails = results.filter(r => !r.pass);
  for (const r of results) console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '   [' + r.detail + ']' : ''}`);
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  process.exit(fails.length ? 1 : 0);
};

run().catch(e => { console.error('harness error', e); process.exit(2); });
setTimeout(() => { console.error('TIMEOUT'); process.exit(2); }, 90000);
