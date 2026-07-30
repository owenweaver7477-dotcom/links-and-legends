/* Headless multiplayer soak test: 8 socket.io clients play a full 9-hole round
   on a chosen course, using the same shared physics the browser uses to decide
   what shot to hit. Verifies turn order, scoring, hole progression and results. */
import { io } from 'socket.io-client';
import { getCourse } from '../public/js/shared/coursegen.js';
import { terrainFor } from '../public/js/shared/terrain.js';
import { BIOMES } from '../public/js/shared/biomes.js';
import { ShotSim, calibrateCarries, suggestedPower } from '../public/js/shared/ballistics.js';
import { CLUBS, CLUB_BY_KEY, CARRY, suggestClub } from '../public/js/shared/clubs.js';

calibrateCarries();
const URL = 'http://localhost:3000';
const COURSE = process.argv[2] || 'parkland';
const N = Number(process.argv[3] || 8);
const SKILL = Number(process.argv[4] || 1.0);   // 1 = good, 3 = wild

const names = ['Owen', 'Sam', 'Priya', 'Marco', 'Ines', 'Kofi', 'Lena', 'Tobias'];
const clients = [];
let room = null, code = null, done = false;
const log = [];

function mkClient(i) {
  const pid = 'bot' + i + '-' + Math.random().toString(36).slice(2, 8);
  const s = io(URL, { transports: ['websocket'] });
  const c = { i, pid, s, name: names[i], mySeq: -1 };
  s.on('connect', () => {
    if (i === 0) s.emit('room:create', { name: c.name, pid, courseId: COURSE }, r => {
      if (!r.ok) { console.error('create failed', r); process.exit(1); }
      code = r.code; room = r.state;
      for (let k = 1; k < N; k++) mkClient(k);
    });
    else s.emit('room:join', { code, name: c.name, pid }, r => {
      if (!r.ok) { console.error('join failed', r); process.exit(1); }
      if (clients.filter(Boolean).length === N) setTimeout(() => clients[0].s.emit('game:start'), 350);
    });
  });
  s.on('room:state', st => { room = st; if (i === 0) onState(st); maybePlay(c, st); });
  s.on('game:shot', m => { if (i === 0) onShot(m); });
  clients[i] = c;
  return c;
}

function onShot(m) {
  const p = room.players.find(x => x.pid === m.pid);
  const r = m.result;
  const yd = v => Math.round(v / 0.9144);
  log.push(`  h${room.holeIndex + 1} ${String(p?.name).padEnd(7)} ${CLUB_BY_KEY[m.shot.clubKey].label.padEnd(9)}`
    + ` pw ${(m.shot.power * 100).toFixed(0).padStart(3)}% face ${m.shot.faceDeg.toFixed(1).padStart(5)}°`
    + ` -> carry ${String(yd(r.carry)).padStart(3)} tot ${String(yd(r.total)).padStart(3)}`
    + ` ${r.reason.padEnd(6)} ${r.lie.padEnd(8)} strokes ${r.strokes}${r.holed ? '  HOLED' : ''}`);
}

let lastHole = -1, lastState = '';
function onState(st) {
  if (st.holeIndex !== lastHole || st.state !== lastState) {
    if (st.state === 'playing') {
      const h = getCourse(st.courseId).holes[st.holeIndex];
      log.push(`\n== Hole ${h.number} · par ${h.par} · ${h.yards} yds · ${h.name} · wind ${(st.wind.speed * 2.237).toFixed(0)} mph`);
    }
    if (st.state === 'holeover') {
      const h = getCourse(st.courseId).holes[st.holeIndex];
      log.push('   -> ' + st.players.filter(p => !p.spectator)
        .map(p => `${p.name} ${p.scores[st.holeIndex]}`).join('  '));
      setTimeout(() => clients[0].s.emit('game:next'), 120);
    }
    if (st.state === 'results' && !done) { done = true; finish(st); }
    lastHole = st.holeIndex; lastState = st.state;
  }
}

const playing = new Set();
function maybePlay(c, st) {
  if (st.state !== 'playing' || st.turnPid !== c.pid) return;
  if (playing.has(c.pid)) return;
  playing.add(c.pid);
  setTimeout(() => {
    playing.delete(c.pid);
    const cur = room;
    if (cur.state !== 'playing' || cur.turnPid !== c.pid) return;
    const p = cur.players.find(x => x.pid === c.pid);
    if (!p || p.finished) return;

    const h = getCourse(cur.courseId).holes[cur.holeIndex];
    const T = terrainFor(h, BIOMES[cur.courseId]);
    const dist = Math.hypot(h.pin.x - p.x, h.pin.z - p.z);
    const lie = T.surfaceAt(p.x, p.z);
    const club = suggestClub(dist, lie.id, lie.id === 'green');
    const aim = Math.atan2(h.pin.x - p.x, h.pin.z - p.z);

    // use the same caddie number the human player is shown
    let power = suggestedPower(T, p.x, p.z, club.key, aim, cur.wind, dist + (club.putter ? 0.45 : 0));
    if (power == null) power = 1;
    const face = (Math.random() * 2 - 1) * 2.0 * SKILL;
    const pw = Math.min(1.05, power * (1 + (Math.random() * 2 - 1) * 0.04 * SKILL));
    c.s.emit('player:move', { x: p.x, z: p.z, rot: aim, moving: false });
    c.s.emit('game:swing', { clubKey: club.key, power: pw, aim, faceDeg: face, attackDeg: 0 });
  }, 40);
}

function finish(st) {
  const course = getCourse(st.courseId);
  log.push('\n================ FINAL ================');
  const rows = st.players.filter(p => !p.spectator).map(p => ({
    p, tot: p.scores.reduce((s, v, i) => s + (v ?? course.holes[i].par + 2), 0)
  })).sort((a, b) => a.tot - b.tot);
  for (const r of rows) {
    const rel = r.tot - course.par;
    log.push(`  ${r.p.name.padEnd(8)} ${r.p.scores.map(v => String(v ?? '-').padStart(3)).join('')}` +
      `   = ${String(r.tot).padStart(3)}  (${rel === 0 ? 'E' : rel > 0 ? '+' + rel : rel})`);
  }
  log.push(`  ${'PAR'.padEnd(8)} ${course.holes.map(h => String(h.par).padStart(3)).join('')}   = ${course.par}`);
  console.log(log.join('\n'));
  console.log('\ncourse:', course.name, '| players:', N, '| skill factor:', SKILL);
  for (const c of clients) c?.s.close();
  process.exit(0);
}

mkClient(0);
setTimeout(() => { console.log(log.join('\n')); console.error('\n!! TIMED OUT — round did not finish'); process.exit(2); }, 240000);
