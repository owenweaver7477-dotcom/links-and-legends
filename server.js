/* =========================================================================
   server.js — static host + authoritative game server
   -------------------------------------------------------------------------
   Because the whole course generator and the whole flight model are shared,
   pure, deterministic modules, the server does not have to take a client's
   word for anything.  It generates the same 45 holes, and it SIMULATES every
   shot itself (~2 ms) — clients replay the identical simulation purely to
   animate it.  Nothing a client sends can move a ball anywhere the server did
   not put it.
   ========================================================================= */

import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';

import { allCourses, getCourse } from './public/js/shared/coursegen.js';
import { terrainFor } from './public/js/shared/terrain.js';
import { BIOMES, COURSE_ORDER, BALL_COLORS, MAX_PLAYERS, HOLES_PER_COURSE } from './public/js/shared/biomes.js';
import { ShotSim, calibrateCarries } from './public/js/shared/ballistics.js';
import { CLUB_BY_KEY, normaliseBag, DEFAULT_BAG } from './public/js/shared/clubs.js';
import { rngKit, hashSeed, clamp } from './public/js/shared/rng.js';
import { normaliseLook, SHOT_RADIUS } from './public/js/shared/avatars.js';
import { CART_TTL_MS, HAIL_RADIUS } from './public/js/shared/cart.js';
import { loadProfiles, getProfile, publicProfile, recordHole, recordRound, colorAllowed } from './server/profiles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.disable('x-powered-by');
// Behind a tunnel or a PaaS load balancer, the real client address and
// protocol arrive in X-Forwarded-*.  Without this the app thinks every
// player is on localhost.
app.set('trust proxy', true);
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingInterval: 10000,
  pingTimeout: 25000,
  maxHttpBufferSize: 1e5
});

/* Build every course and the yardage table once, at boot. */
const COURSES = allCourses();
calibrateCarries();
loadProfiles();

// No max-age: the client is a handful of small files and an ETag revalidation
// is cheap, whereas a stale module after a deploy is a genuinely confusing bug.
app.use(express.static(path.join(__dirname, 'public'), { etag: true, maxAge: 0 }));
app.get('/healthz', (_req, res) => res.json({
  ok: true, rooms: rooms.size,
  players: [...rooms.values()].reduce((n, r) => n + r.players.length, 0),
  courses: COURSES.map(c => ({ id: c.id, name: c.name, par: c.par, yards: c.yards })),
  uptime: Math.round(process.uptime())
}));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

/* ------------------------------------------------------------------- rooms */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const EMPTY_ROOM_TTL = 20 * 60 * 1000;
const HOLE_SUMMARY_MS = 20000;

const rooms = new Map();
const sockets = new Map();          // socket.id -> {code, pid}

const makeCode = () => {
  for (let i = 0; i < 500; i++) {
    let c = '';
    for (let k = 0; k < 4; k++) c += CODE_ALPHABET[(Math.random() * CODE_ALPHABET.length) | 0];
    if (!rooms.has(c)) return c;
  }
  return 'X' + Date.now().toString(36).slice(-3).toUpperCase();
};
const cleanName = raw => (String(raw ?? '')
  // allow-list: letters (any script), digits, space and a little punctuation.
  // Names are rendered in other players' browsers, so nothing that could be
  // markup is permitted through in the first place.
  .replace(/[^\p{L}\p{N} '._-]/gu, '')
  .replace(/\s+/g, ' ').trim().slice(0, 14) || 'Golfer');
const cleanPid = raw => String(raw ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);

function createRoom(code, courseId) {
  const room = {
    code,
    hostPid: null,
    courseId: COURSE_ORDER.includes(courseId) ? courseId : COURSE_ORDER[0],
    // Championship by default: it matches the yardages the lobby advertises
    // and keeps par meaningful. Move forward for a gentler round.
    teeSet: 'back',                 // back | regular | forward
    holeIndex: 0,
    state: 'lobby',                 // lobby | playing | holeover | results
    players: [],
    turnPid: null,
    seq: 0,
    seed: hashSeed(code, 7, 31),
    wind: { dir: 0, speed: 0 },
    summaryTimer: null,
    emptySince: Date.now()
  };
  rooms.set(code, room);
  return room;
}

const course = room => getCourse(room.courseId);
const hole = room => course(room).holes[clamp(room.holeIndex, 0, HOLES_PER_COURSE - 1)];
const biome = room => BIOMES[room.courseId];
const terrain = room => terrainFor(hole(room), biome(room));
const active = room => room.players.filter(p => !p.spectator);
const teeOf = room => (hole(room).tees || {})[room.teeSet] || hole(room).tee;

/** Wind for a hole: deterministic from the room seed, so it never re-rolls. */
function rollWind(room) {
  const bio = biome(room);
  const rk = rngKit(hashSeed(room.code, room.holeIndex, 0x1d));
  // capped at 13 m/s (~29 mph): beyond that even a wedge becomes a lottery
  const speed = clamp(bio.windBase + rk.gauss() * bio.windGust, 0, 13);
  room.wind = { dir: rk.f(-Math.PI, Math.PI), speed: Math.round(speed * 10) / 10 };
}

function addPlayer(room, pid, name, spectator) {
  const used = new Set(room.players.map(p => p.color));
  const col = BALL_COLORS.find(c => !c.lockRating && !used.has(c.hex))
    || BALL_COLORS.find(c => !c.lockRating) || BALL_COLORS[0];
  const h = hole(room);
  const t = teeOf(room);
  const p = {
    pid, name, color: col.hex, colorName: col.name,
    look: normaliseLook(null, room.players.length),
    // where the golfer is standing, as opposed to where the ball is
    ax: t.x, az: t.z, arot: t.rot,
    cart: null, cartAt: 0,
    bag: normaliseBag(DEFAULT_BAG, { pad: true }),
    scores: new Array(HOLES_PER_COURSE).fill(null),
    strokes: 0, penalties: 0, finished: false,
    x: t.x, z: t.z, lie: 'tee',
    connected: true, spectator: !!spectator, socketId: null
  };
  room.players.push(p);
  if (!room.hostPid) room.hostPid = pid;
  return p;
}

/**
 * Put every ball on the tee of the current hole and clear the hole's score.
 * `purge` drops players who are offline — only ever done when a NEW ROUND
 * begins. Between holes everyone is kept, so a dropped connection costs you the
 * holes you miss but never your card or your seat.
 */
function startHole(room, { purge = false } = {}) {
  const t = teeOf(room);
  rollWind(room);
  for (const p of room.players) {
    if (p.spectator && p.connected) p.spectator = false;
    p.strokes = 0; p.penalties = 0; p.finished = false;
    p.x = t.x; p.z = t.z; p.lie = 'tee';
    p.ax = t.x; p.az = t.z; p.arot = t.rot;
    p.cart = null; p.cartAt = 0;      // everyone walks to the tee
    p.holePutts = 0; p.holeFairway = false; p.holeGir = false;
  }
  if (purge) room.players = room.players.filter(p => p.connected);
  if (!room.players.some(p => p.pid === room.hostPid)) {
    room.hostPid = room.players.find(p => p.connected)?.pid ?? null;
  }
  room.state = 'playing';
  pickNextToPlay(room, true);
}

/**
 * Whoever is farthest from the hole plays — which is how golf actually works,
 * and neatly removes the need for a fixed rotation.  On the tee everyone is
 * the same distance out, so honours falls to the best score so far.
 */
function pickNextToPlay(room, teeOff = false) {
  const T = terrain(room);
  const h = hole(room);
  const eligible = active(room).filter(p => !p.finished && p.connected);
  if (!eligible.length) { room.turnPid = null; return; }

  if (teeOff) {
    const totals = p => p.scores.reduce((s, v) => s + (v ?? 0), 0);
    eligible.sort((a, b) => totals(a) - totals(b) || room.players.indexOf(a) - room.players.indexOf(b));
    room.turnPid = eligible[0].pid;
    return;
  }
  let best = eligible[0], bestD = -1;
  for (const p of eligible) {
    const d = Math.hypot(p.x - h.pin.x, p.z - h.pin.z);
    if (d > bestD) { bestD = d; best = p; }
  }
  room.turnPid = best.pid;
}

function everyoneDone(room) {
  const a = active(room).filter(p => p.connected);
  return a.length > 0 && a.every(p => p.finished);
}

function finishHole(room) {
  const h = hole(room);
  for (const p of active(room)) {
    if (p.scores[room.holeIndex] == null) {
      p.scores[room.holeIndex] = p.finished ? p.strokes : h.maxStrokes;
    }
    recordHole(p.pid, {
      strokes: p.scores[room.holeIndex], par: h.par,
      putts: p.holePutts || 0,
      fairwayHit: h.par >= 4 ? !!p.holeFairway : null,
      gir: !!p.holeGir
    });
  }
  room.state = 'holeover';
  room.turnPid = null;
  clearTimeout(room.summaryTimer);
  room.summaryTimer = setTimeout(() => nextHole(room), HOLE_SUMMARY_MS);
}

function nextHole(room) {
  clearTimeout(room.summaryTimer);
  room.summaryTimer = null;
  if (room.holeIndex >= HOLES_PER_COURSE - 1) {
    room.state = 'results';
    room.turnPid = null;
    const parTotal = course(room).holes.reduce((a, x) => a + x.par, 0);
    for (const p of active(room)) {
      const played = p.scores.filter(v => v != null).length;
      const total = p.scores.reduce((a, v) => a + (v ?? 0), 0);
      const prof = recordRound(p.pid, total - parTotal, played);
      const sock = p.socketId && io.sockets.sockets.get(p.socketId);
      if (sock && prof) sock.emit('profile', prof);
    }
    broadcastState(room);
    return;
  }
  room.holeIndex++;
  startHole(room);
  io.to(room.code).emit('game:hole', { holeIndex: room.holeIndex });
  broadcastState(room);
}

/* ---------------------------------------------------------------- snapshot */
function snapshot(room) {
  return {
    code: room.code,
    hostPid: room.hostPid,
    courseId: room.courseId,
    teeSet: room.teeSet,
    holeIndex: room.holeIndex,
    state: room.state,
    turnPid: room.turnPid,
    wind: room.wind,
    maxPlayers: MAX_PLAYERS,
    holes: HOLES_PER_COURSE,
    players: room.players.map(p => ({
      pid: p.pid, name: p.name, color: p.color, colorName: p.colorName,
      scores: p.scores, strokes: p.strokes, penalties: p.penalties,
      finished: p.finished, x: p.x, z: p.z, lie: p.lie, bag: p.bag,
      look: p.look, ax: p.ax, az: p.az, arot: p.arot,
      // Seat membership only — never the cart pose.  Pose belongs on the light
      // players:pos channel for the same reason walking positions do: this
      // snapshot goes to everyone on every state change.
      cart: inCart(p) ? (p.cart.s === 'd' ? { s: 'd', r: p.cart.r } : { s: 'p', o: p.cart.o }) : null,
      connected: p.connected, spectator: p.spectator
    }))
  };
}
/**
 * Whether a player is in a cart RIGHT NOW.
 *
 * Deliberately a timestamp rather than a flag.  A flag has to be cleared on
 * disconnect, on reconnect, on a tab steal, between holes, on a new round and
 * on returning to the lobby — and missing any one of those leaves a player
 * permanently unable to swing, which with no turn timer would wedge the whole
 * room until everybody left.  A timestamp expires on its own, with no
 * cooperation from the client that set it.
 */
const inCart = p => !!p.cart && Date.now() - (p.cartAt || 0) < CART_TTL_MS;

const broadcastState = room => io.to(room.code).emit('room:state', snapshot(room));
const toast = (room, msg, kind) => io.to(room.code).emit('toast', { msg, kind: kind || 'info' });

/* ------------------------------------------------------------------ sockets */
io.on('connection', socket => {

  function bind(room, player) {
    if (player.socketId && player.socketId !== socket.id) {
      const old = io.sockets.sockets.get(player.socketId);
      if (old) { try { old.emit('kicked', { reason: 'Opened in another tab' }); old.disconnect(true); } catch { /* gone */ } }
    }
    player.socketId = socket.id;
    player.connected = true;
    sockets.set(socket.id, { code: room.code, pid: player.pid });
    socket.join(room.code);
    room.emptySince = null;
    socket.emit('profile', publicProfile(player.pid));
  }

  socket.on('room:create', (data, ack) => {
    const pid = cleanPid(data?.pid);
    if (!pid) return ack?.({ ok: false, error: 'Bad client id — refresh the page.' });
    const room = createRoom(makeCode(), data?.courseId);
    rollWind(room);
    const p = addPlayer(room, pid, cleanName(data?.name), false);
    bind(room, p);
    ack?.({ ok: true, code: room.code, pid, state: snapshot(room) });
    broadcastState(room);
  });

  socket.on('room:join', (data, ack) => {
    const pid = cleanPid(data?.pid);
    const code = String(data?.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    if (!pid) return ack?.({ ok: false, error: 'Bad client id — refresh the page.' });
    const room = rooms.get(code);
    if (!room) return ack?.({ ok: false, error: 'No room with code ' + (code || '—') });

    let p = room.players.find(x => x.pid === pid);
    if (p) {
      p.name = cleanName(data?.name);
      bind(room, p);
      // the room may have frozen with no turn while everyone was away
      if (room.state === 'playing') {
        const cur = room.players.find(x => x.pid === room.turnPid);
        if (!cur || !cur.connected || cur.finished) pickNextToPlay(room);
      }
      ack?.({ ok: true, code, pid, state: snapshot(room), rejoined: true });
      broadcastState(room);
      return;
    }
    if (room.players.filter(x => x.connected).length >= MAX_PLAYERS) {
      return ack?.({ ok: false, error: `That room is full (${MAX_PLAYERS} players).` });
    }
    const spec = room.state !== 'lobby';
    p = addPlayer(room, pid, cleanName(data?.name), spec);
    bind(room, p);
    ack?.({ ok: true, code, pid, state: snapshot(room), spectator: spec });
    toast(room, p.name + (spec ? ' is watching until the next hole.' : ' joined.'));
    broadcastState(room);
  });

  socket.on('room:course', ({ courseId } = {}) => {
    const ref = sockets.get(socket.id); if (!ref) return;
    const room = rooms.get(ref.code); if (!room) return;
    if (ref.pid !== room.hostPid || room.state !== 'lobby') return;
    if (!COURSE_ORDER.includes(courseId)) return;
    room.courseId = courseId;
    room.holeIndex = 0;
    rollWind(room);
    const t = teeOf(room);
    for (const p of room.players) { p.x = t.x; p.z = t.z; }
    broadcastState(room);
  });

  socket.on('room:tees', ({ teeSet } = {}) => {
    const ref = sockets.get(socket.id); if (!ref) return;
    const room = rooms.get(ref.code); if (!room) return;
    if (ref.pid !== room.hostPid || room.state !== 'lobby') return;
    if (!['back', 'regular', 'forward'].includes(teeSet)) return;
    room.teeSet = teeSet;
    const t = teeOf(room);
    for (const p of room.players) { p.x = t.x; p.z = t.z; }
    broadcastState(room);
  });

  /** Your own kit: ball colour and the fourteen clubs you carry. */
  socket.on('player:prefs', ({ color, bag } = {}) => {
    const ref = sockets.get(socket.id); if (!ref) return;
    const room = rooms.get(ref.code); if (!room) return;
    const p = room.players.find(x => x.pid === ref.pid); if (!p) return;

    if (typeof color === 'string') {
      const wanted = BALL_COLORS.find(c => c.hex === color);
      // first come first served — two identical balls on one hole is confusing
      const taken = room.players.some(o => o.pid !== p.pid && o.color === color);
      if (wanted && !taken) {
        if (wanted.lockRating && !colorAllowed(ref.pid, wanted.hex)) {
          socket.emit('toast', { msg: `${wanted.name} unlocks at rating ${wanted.lockRating} — you are ${Math.round(getProfile(ref.pid).rating)}.`, kind: 'warn' });
        } else { p.color = wanted.hex; p.colorName = wanted.name; }
      }
    }
    if (Array.isArray(bag)) p.bag = normaliseBag(bag);
    broadcastState(room);
  });

  /**
   * Avatar position.  Cosmetic, so it is taken on trust and simply relayed —
   * but it also gates whether you may play your ball, and it is rebroadcast on
   * its own light channel rather than as a full room snapshot, because these
   * arrive ten times a second per player.
   */
  socket.on('player:move', (d) => {
    const ref = sockets.get(socket.id); if (!ref) return;
    const room = rooms.get(ref.code); if (!room) return;
    const p = room.players.find(x => x.pid === ref.pid); if (!p) return;
    const ax = Number(d?.x), az = Number(d?.z), ar = Number(d?.rot);
    if (!isFinite(ax) || !isFinite(az)) return;
    const b = hole(room).bounds;
    p.ax = clamp(ax, b.minX, b.maxX);
    p.az = clamp(az, b.minZ, b.maxZ);
    p.arot = isFinite(ar) ? ar : p.arot;
    p.amov = !!d.moving;

    // The cart rides the position channel rather than getting its own: it is
    // the same data at the same rate about the same player, and reusing the
    // channel means no second flood surface and no second timer.
    const c = d?.cart;
    const wasIn = !!p.cart;
    if (c && typeof c === 'object' && !Array.isArray(c) && (c.s === 'd' || c.s === 'p')) {
      p.cart = c.s === 'd'
        ? {
            s: 'd',
            x: clamp(Number(c.x) || 0, b.minX, b.maxX),
            z: clamp(Number(c.z) || 0, b.minZ, b.maxZ),
            h: isFinite(Number(c.h)) ? Number(c.h) : 0,
            v: clamp(Number(c.v) || 0, -6, 17),
            r: cleanPid(c.r) || null
          }
        : { s: 'p', o: cleanPid(c.o) || null };
      p.cartAt = Date.now();
    } else {
      // The else is load-bearing.  Without it a seat claim once made never
      // clears, and a bot that never mentions carts can never swing again.
      p.cart = null;
    }
    if (wasIn !== !!p.cart) broadcastState(room);

    socket.to(room.code).emit('players:pos', {
      pid: p.pid, x: p.ax, z: p.az, rot: p.arot, moving: p.amov, cart: p.cart
    });
  });

  socket.on('player:look', ({ look } = {}) => {
    const ref = sockets.get(socket.id); if (!ref) return;
    const room = rooms.get(ref.code); if (!room) return;
    const p = room.players.find(x => x.pid === ref.pid); if (!p) return;
    p.look = normaliseLook(look, room.players.indexOf(p));
    broadcastState(room);
  });

  /**
   * Offer the nearest player a lift.  Holds no state at all: no invite record,
   * no timeout, no accept event — just a message.  They board by walking over
   * and pressing C, which is what they would do anyway, so there is nothing
   * here that can deadlock or leak.
   */
  socket.on('cart:hail', () => {
    const ref = sockets.get(socket.id); if (!ref) return;
    const room = rooms.get(ref.code); if (!room || room.state !== 'playing') return;
    const p = room.players.find(x => x.pid === ref.pid); if (!p) return;
    if (!inCart(p) || p.cart.s !== 'd') return;
    const now = Date.now();
    if (now - (p.hailAt || 0) < 4000) return;         // one every four seconds
    p.hailAt = now;

    let best = null, bestD = HAIL_RADIUS;
    for (const q of room.players) {
      if (q === p || !q.connected || q.spectator || q.finished || inCart(q)) continue;
      const d = Math.hypot(q.ax - p.ax, q.az - p.az);
      if (d < bestD) { bestD = d; best = q; }
    }
    if (!best) return socket.emit('toast', { msg: 'Nobody close enough to offer a lift.', kind: 'warn' });
    const sock = best.socketId && io.sockets.sockets.get(best.socketId);
    if (sock) sock.emit('toast', { msg: `🛺 ${p.name} is offering you a lift — walk over and press C`, kind: 'good', ms: 4200 });
    socket.emit('toast', { msg: `Offered ${best.name} a lift.`, kind: 'info' });
  });

  socket.on('game:start', () => {
    const ref = sockets.get(socket.id); if (!ref) return;
    const room = rooms.get(ref.code); if (!room) return;
    if (ref.pid !== room.hostPid) return socket.emit('toast', { msg: 'Only the host can start.', kind: 'warn' });
    if (room.state === 'playing') return;
    if (!room.players.some(p => p.connected)) return;
    room.holeIndex = 0;
    for (const p of room.players) p.scores = new Array(HOLES_PER_COURSE).fill(null);
    startHole(room, { purge: true });
    io.to(room.code).emit('game:started', { courseId: room.courseId });
    broadcastState(room);
  });

  /* ------------------------------------------------------------ the shot */
  socket.on('game:swing', (data) => {
    const ref = sockets.get(socket.id); if (!ref) return;
    const room = rooms.get(ref.code); if (!room || room.state !== 'playing') return;
    const p = room.players.find(x => x.pid === ref.pid);
    if (!p || p.finished || p.spectator) return;
    if (room.turnPid !== p.pid) return socket.emit('toast', { msg: "It isn't your turn.", kind: 'warn' });

    if (inCart(p)) {
      return socket.emit('toast', { msg: 'Get out of the cart to play.', kind: 'warn' });
    }

    // walk to your ball first — this is soft (avatar position is client-reported
    // and only cosmetic), but it keeps everyone honest about the ritual
    const walk = Math.hypot((p.ax ?? p.x) - p.x, (p.az ?? p.z) - p.z);
    if (walk > SHOT_RADIUS + 1.5) {
      return socket.emit('toast', { msg: 'Walk to your ball first.', kind: 'warn' });
    }

    const club = CLUB_BY_KEY[data?.clubKey];
    if (!club) return;
    const shot = {
      x: p.x, z: p.z,                                  // the server's ball, not theirs
      clubKey: club.key,
      power: clamp(Number(data.power) || 0, 0, 1.12),
      aim: Number(data.aim) || 0,
      faceDeg: clamp(Number(data.faceDeg) || 0, -16, 16),
      attackDeg: clamp(Number(data.attackDeg) || 0, -3, 3),
      wind: room.wind
    };
    if (!isFinite(shot.aim) || shot.power < 0.02) return;

    const h = hole(room);
    const fromGreen = p.lie === 'green';
    const wasTeeShot = p.strokes === 0;
    const result = new ShotSim(terrain(room), shot).runToEnd();

    p.strokes += 1 + result.penalty;
    // the stats book: a putt is a stroke played from the green; a fairway is
    // hit or missed by the tee shot on par 4s and 5s; a green is "in
    // regulation" when you are putting with two strokes of par in hand
    if (fromGreen) p.holePutts++;
    if (wasTeeShot && h.par >= 4 && result.lie === 'fairway') p.holeFairway = true;
    if ((result.lie === 'green' || result.holed) && p.strokes <= h.par - 2) p.holeGir = true;
    p.penalties += result.penalty;
    // the golfer stays where they played from; the ball moves on without them
    p.ax = p.x; p.az = p.z;
    p.x = result.x; p.z = result.z; p.lie = result.lie;

    let capped = false;
    if (result.holed) p.finished = true;
    else if (p.strokes >= h.maxStrokes) { p.strokes = h.maxStrokes; p.finished = true; capped = true; }

    if (p.finished) p.scores[room.holeIndex] = p.strokes;

    room.seq++;
    // Clients replay this exact shot; the outcome rides along so they can snap
    // to it if their animation ever drifts.
    io.to(room.code).emit('game:shot', {
      seq: room.seq, pid: p.pid, shot,
      result: {
        x: result.x, z: result.z, holed: result.holed, penalty: result.penalty,
        reason: result.reason, lie: result.lie, carry: result.carry,
        total: result.total, apex: result.apex, capped,
        strokes: p.strokes, splash: result.splash || null
      }
    });

    if (everyoneDone(room)) finishHole(room);
    else pickNextToPlay(room);
    broadcastState(room);
  });

  socket.on('game:next', () => {
    const ref = sockets.get(socket.id); if (!ref) return;
    const room = rooms.get(ref.code); if (!room) return;
    if (ref.pid !== room.hostPid) return socket.emit('toast', { msg: 'Only the host can do that.', kind: 'warn' });
    if (room.state !== 'holeover') return;
    nextHole(room);
  });

  socket.on('game:again', () => {
    const ref = sockets.get(socket.id); if (!ref) return;
    const room = rooms.get(ref.code); if (!room) return;
    if (ref.pid !== room.hostPid) return socket.emit('toast', { msg: 'Only the host can restart.', kind: 'warn' });
    clearTimeout(room.summaryTimer);
    room.holeIndex = 0;
    for (const p of room.players) p.scores = new Array(HOLES_PER_COURSE).fill(null);
    startHole(room, { purge: true });
    io.to(room.code).emit('game:reset', {});
    broadcastState(room);
  });

  socket.on('room:lobby', () => {
    const ref = sockets.get(socket.id); if (!ref) return;
    const room = rooms.get(ref.code); if (!room) return;
    if (ref.pid !== room.hostPid) return;
    clearTimeout(room.summaryTimer);
    room.state = 'lobby';
    room.holeIndex = 0;
    room.turnPid = null;
    for (const p of room.players) { p.scores = new Array(HOLES_PER_COURSE).fill(null); p.spectator = false; }
    broadcastState(room);
  });

  socket.on('disconnect', () => {
    const ref = sockets.get(socket.id);
    sockets.delete(socket.id);
    if (!ref) return;
    const room = rooms.get(ref.code); if (!room) return;
    const p = room.players.find(x => x.pid === ref.pid);
    if (!p || p.socketId !== socket.id) return;

    p.connected = false;
    p.socketId = null;
    if (room.state === 'lobby') room.players = room.players.filter(x => x.pid !== p.pid);
    if (room.hostPid === p.pid) {
      const heir = room.players.find(x => x.connected);
      room.hostPid = heir?.pid ?? null;
      if (heir) toast(room, heir.name + ' is now the host.');
    }
    if (room.state === 'playing') {
      // Never tear down a round because connections blipped — park it and let
      // them come back to the same scorecard.
      if (everyoneDone(room)) finishHole(room);
      else pickNextToPlay(room);
    }
    if (!room.players.some(x => x.connected)) room.emptySince = Date.now();
    broadcastState(room);
  });
});

/* -------------------------------------------------------------------- reaper */
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.players.some(p => p.connected)) { room.emptySince = null; continue; }
    room.emptySince ??= now;
    if (now - room.emptySince > EMPTY_ROOM_TTL) {
      clearTimeout(room.summaryTimer);
      rooms.delete(code);
    }
  }
}, 60000).unref();

/* ---------------------------------------------------------------------- boot */
httpServer.listen(PORT, HOST, () => {
  console.log('');
  console.log('  ⛳  Golf — 5 courses, 9 holes each, up to ' + MAX_PLAYERS + ' players');
  for (const c of COURSES) {
    console.log(`      ${c.name.padEnd(18)} ${String(c.par).padStart(2)} · ${String(c.yards).padStart(4)} yds · ${c.region}`);
  }
  console.log('  ▸  you          http://localhost:' + PORT);
  // Friends need an address that is not "localhost".  Print every non-internal
  // IPv4 the machine actually has, so there is nothing to look up.
  const lan = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) lan.push({ name, address: a.address });
    }
  }
  if (lan.length) {
    for (const l of lan) {
      console.log(`  ▸  same wifi    http://${l.address}:${PORT}   (${l.name})`);
    }
  } else {
    console.log('  ▸  same wifi    no network address — are you offline?');
  }
  console.log('  ▸  anywhere     npm run share      (opens a public link)');
  console.log('');
});

process.on('SIGTERM', () => httpServer.close(() => process.exit(0)));
process.on('SIGINT', () => httpServer.close(() => process.exit(0)));
