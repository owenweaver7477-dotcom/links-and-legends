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
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';

import { allCourses, getCourse } from './public/js/shared/coursegen.js';
import { terrainFor } from './public/js/shared/terrain.js';
import { BIOMES, COURSE_ORDER, BALL_COLORS, MAX_PLAYERS, HOLES_PER_COURSE } from './public/js/shared/biomes.js';
import { ShotSim, calibrateCarries } from './public/js/shared/ballistics.js';
import { CLUB_BY_KEY, normaliseBag, DEFAULT_BAG } from './public/js/shared/clubs.js';
import { rngKit, hashSeed, clamp } from './public/js/shared/rng.js';
import { normaliseLook, looksEarnedAt, SHOT_RADIUS } from './public/js/shared/avatars.js';
import { CART_TTL_MS, HAIL_RADIUS } from './public/js/shared/cart.js';
import { loadProfiles, getProfile, publicProfile, recordHole, recordRound, colorAllowed, buyItem, seedProfile } from './server/profiles.js';
import { SHOP, purchaseBlocked } from './public/js/shared/gear.js';
import { EMOTES } from './public/js/client/celebrations.js';
import { prepare as prepareChat, phraseText, forget as forgetChat, allow as allowChat, PHRASES } from './server/chat.js';
import { levelFromXp } from './public/js/shared/economy.js';
import { crewPurchase, cartBoost } from './public/js/shared/crew.js';
import { settleRound } from './server/profiles.js';
import { loadRecords, recordsFor, allRecords, submitRound } from './server/records.js';

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
/* The store may be a database now, so bringing it up is async. Everything
   below depends on profiles existing, so this is awaited at the top level
   rather than fired and forgotten. */
await loadProfiles();
await loadRecords();

/* ═══════════════════════════════════════════════════════════════ assets ═══
   Everything under public/ is read, hashed and COMPRESSED once at boot, then
   served from memory.  Compressing per request would burn CPU on a free-tier
   box for a file that never changes; doing it here costs a few hundred
   milliseconds at startup and turns 672 KB of three.js into about 150 KB on
   the wire — which on a phone is the difference between a game that loads and
   one the player abandons.
   ═══════════════════════════════════════════════════════════════════════ */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json'
};
// text compresses; images and fonts are already compressed and would only grow
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.webmanifest']);
const assets = new Map();          // '/js/client/main.js' -> { body, br, gz, type, etag }

function loadAssets(dir, prefix = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { loadAssets(full, prefix + '/' + entry.name); continue; }
    const ext = path.extname(entry.name).toLowerCase();
    const body = fs.readFileSync(full);
    const rec = {
      body,
      type: MIME[ext] || 'application/octet-stream',
      etag: '"' + crypto.createHash('sha1').update(body).digest('base64').slice(0, 22) + '"'
    };
    if (COMPRESSIBLE.has(ext) && body.length > 512) {
      rec.gz = zlib.gzipSync(body, { level: 9 });
      rec.br = zlib.brotliCompressSync(body, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length
        }
      });
    }
    assets.set(prefix + '/' + entry.name, rec);
  }
}
loadAssets(path.join(__dirname, 'public'));

/* In development the files on disk are the truth: reading them at boot only
   is right for production but means an edit does not show up until a restart.
   NODE_ENV=production (what Render sets) keeps the fast in-memory path. */
const DEV = process.env.NODE_ENV !== 'production';
if (DEV) console.log('  dev mode: assets re-read from disk, browser caching off');

/** Serve one precompressed asset, honouring the client's encodings and ETag. */
function sendAsset(req, res, rec) {
  res.setHeader('Content-Type', rec.type);
  res.setHeader('ETag', rec.etag);
  res.setHeader('Vary', 'Accept-Encoding');
  // The HTML is the only file whose URL never changes but whose content must
  // be picked up the instant a deploy lands, so it always revalidates.  The
  // rest may sit in cache briefly; the ETag makes the recheck a 304.
  // In dev nothing may be cached by the browser either, or an edit sits behind
  // a ten-minute max-age and you debug a file you are no longer running.
  res.setHeader('Cache-Control', DEV ? 'no-store'
    : rec.type.startsWith('text/html') ? 'no-cache'
    : 'public, max-age=600, must-revalidate');

  if (req.headers['if-none-match'] === rec.etag) return res.status(304).end();

  const accept = String(req.headers['accept-encoding'] || '');
  if (rec.br && /\bbr\b/.test(accept)) {
    res.setHeader('Content-Encoding', 'br');
    return res.end(req.method === 'HEAD' ? undefined : rec.br);
  }
  if (rec.gz && /\bgzip\b/.test(accept)) {
    res.setHeader('Content-Encoding', 'gzip');
    return res.end(req.method === 'HEAD' ? undefined : rec.gz);
  }
  res.end(req.method === 'HEAD' ? undefined : rec.body);
}

/* In development the files on disk are the truth: reading them at boot only
   is right for production but means an edit does not show up until a restart,
   which is a genuinely confusing way to lose ten minutes.  NODE_ENV=production
   (what Render sets) keeps the fast in-memory path. */
/* Kept in step with BACKEND in public/js/client/net.js by hand — there is no
   build step to share a constant through, and a mismatch here shows up as a
   blocked request rather than as anything louder. */
const BACKEND_ORIGIN = 'https://links-and-legends.onrender.com';

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  // Security headers a published game should carry.  Note the DELIBERATE
  // absence of X-Frame-Options and the wide frame-ancestors: this game is
  // meant to be embedded by portals, and locking that down would break the
  // very thing it is published for.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  /* The CSP has to let the CrazyGames SDK in, or the portal build silently
     loses save-data, ad timing and audio muting — the script would simply be
     blocked and every SDK call would no-op.  Their SDK also talks to their
     own origins, hence the connect-src entries.  frame-ancestors stays wide
     open because being embedded is the point. */
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "img-src 'self' data: https://images.crazygames.com; " +
    "style-src 'self' 'unsafe-inline'; " +
    /* The deployment's own origin has to be allowed explicitly. net.js falls
       back to fetching the socket.io client from BACKEND when the page is a
       static bundle with no server behind it, and it pings /healthz first to
       wake a sleeping free-tier host. Served by us that fallback is never
       needed — but the ping fires regardless, and a CSP that blocks your own
       backend logs two errors on every single page load, which is exactly
       the kind of noise that hides a real one. */
    "script-src 'self' https://sdk.crazygames.com " + BACKEND_ORIGIN + '; ' +
    "connect-src 'self' ws: wss: https://*.crazygames.com https://sdk.crazygames.com " +
      BACKEND_ORIGIN + ' ' + BACKEND_ORIGIN.replace(/^https:/, 'wss:') + '; ' +
    "frame-ancestors *");
  const key = req.path === '/' ? '/index.html' : req.path;
  if (DEV) {                       // pick up edits without a restart
    try {
      const full = path.join(__dirname, 'public', key);
      if (full.startsWith(path.join(__dirname, 'public')) && fs.existsSync(full)
          && fs.statSync(full).isFile()) {
        const ext = path.extname(key).toLowerCase();
        const body = fs.readFileSync(full);
        return sendAsset(req, res, {
          body, type: MIME[ext] || 'application/octet-stream',
          etag: '"' + crypto.createHash('sha1').update(body).digest('base64').slice(0, 22) + '"'
        });
      }
    } catch { /* fall through to the cached copy */ }
  }
  const rec = assets.get(key);
  if (!rec) return next();
  sendAsset(req, res, rec);
});
app.get('/healthz', (_req, res) => res.json({
  ok: true, rooms: rooms.size,
  players: [...rooms.values()].reduce((n, r) => n + r.players.length, 0),
  courses: COURSES.map(c => ({ id: c.id, name: c.name, par: c.par, yards: c.yards })),
  uptime: Math.round(process.uptime())
}));
/**
 * A field-error beacon.
 *
 * Once this is published the only bugs that matter are the ones happening on
 * hardware I will never see.  The client posts anything it throws here and it
 * lands in the server log, rate-limited hard so it can never become a way to
 * flood the box.  Body is capped by express, the message is truncated, and
 * nothing is stored or forwarded anywhere.
 */
const errSeen = new Map();          // ip -> { n, at }
app.post('/clienterror', express.json({ limit: '4kb' }), (req, res) => {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const rec = errSeen.get(ip) || { n: 0, at: now };
  if (now - rec.at > 60000) { rec.n = 0; rec.at = now; }
  rec.n++; errSeen.set(ip, rec);
  if (errSeen.size > 500) errSeen.clear();          // never grows without bound
  if (rec.n <= 5) {
    const d = req.body || {};
    console.error('  CLIENT —', String(d.msg || '').slice(0, 300),
      '|', String(d.where || '').slice(0, 120),
      '|', String(req.headers['user-agent'] || '').slice(0, 90));
  }
  res.status(204).end();
});

app.get('*', (req, res) => {
  const rec = assets.get('/index.html');
  if (rec) return sendAsset(req, res, rec);
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ------------------------------------------------------------------- rooms */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const EMPTY_ROOM_TTL = 20 * 60 * 1000;
const HOLE_SUMMARY_MS = 20000;

/* A published game is a public one, and every visitor who presses Play Now
   creates a room.  The reaper collects idle ones after 20 minutes, but that
   is a floor, not a ceiling: this is the ceiling.  Well above any plausible
   real load, and low enough that a script cannot exhaust the box. */
const MAX_ROOMS = 600;

const rooms = new Map();
const sockets = new Map();          // socket.id -> {code, pid}

/**
 * Make room for a new game when the table is full: drop the emptiest, oldest
 * room first.  Returns false only if every single room is genuinely occupied,
 * which is the one case where refusing is the honest answer.
 */
function evictIfFull() {
  if (rooms.size < MAX_ROOMS) return true;
  let worst = null;
  for (const [code, r] of rooms) {
    if (r.players.some(p => p.connected)) continue;        // never evict a live game
    const idle = r.emptySince ?? 0;
    if (!worst || idle < worst.idle) worst = { code, idle };
  }
  if (!worst) return false;
  const doomed = rooms.get(worst.code);
  clearTimeout(doomed?.summaryTimer);
  rooms.delete(worst.code);
  return true;
}

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
  // Every path into a fresh hole comes through here, so this is the one place
  // the hole-summary timer can be cancelled without missing an entry point —
  // a stale timer would later yank the live round forward a hole on its own.
  clearTimeout(room.summaryTimer);
  room.summaryTimer = null;
  const t = teeOf(room);
  rollWind(room);
  for (const p of room.players) {
    if (p.spectator && p.connected) p.spectator = false;
    p.strokes = 0; p.penalties = 0; p.finished = false;
    p.x = t.x; p.z = t.z; p.lie = 'tee';
    p.ax = t.x; p.az = t.z; p.arot = t.rot;
    p.cart = null; p.cartAt = 0;      // everyone walks to the tee
    // Grit's after-a-bad-hole calm carries hole to hole, but a NEW round
    // (purge) starts with a clean slate — no hole preceded its first tee.
    if (purge) p.afterBad = false;
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

/**
 * A room must always be continuable by somebody.  Three things can strand it,
 * and all three come from the same event — the last connected player dropping:
 *
 *   - hostPid goes null, because the heir search only considers CONNECTED
 *     players and there were none.  Nothing restored it on the way back in, so
 *     the player reconnected into a room with no host, and every screen that
 *     waits on one ("Waiting for the host…", game:next) waited forever.  This
 *     is the reported "stuck waiting for host to finish hole".
 *   - turnPid goes null, because nobody was eligible to play.
 *   - the hole-summary timer is the only thing that can advance a holeover,
 *     so if it is ever lost the summary is permanent.
 *
 * Rather than patch each caller, every path that changes who is in the room
 * ends here.  Idempotent and cheap.
 */
function ensureContinuable(room) {
  const present = room.players.filter(p => p.connected);
  if (!present.length) return;                 // nobody to hand anything to

  // The host must be someone actually here.  A disconnected host cannot press
  // Continue, which makes it identical to having no host at all.
  const host = room.players.find(p => p.pid === room.hostPid);
  if (!host || !host.connected) {
    room.hostPid = present[0].pid;
    if (host && host.pid !== room.hostPid) toast(room, present[0].name + ' is now the host.');
  }

  if (room.state === 'playing') {
    const cur = room.players.find(p => p.pid === room.turnPid);
    if (!cur || !cur.connected || cur.finished) {
      if (everyoneDone(room)) finishHole(room);
      else pickNextToPlay(room);
    }
  } else if (room.state === 'holeover' && !room.summaryTimer) {
    // Re-arm the fallback: the summary must always be on its way out.
    room.summaryTimer = setTimeout(() => nextHole(room), HOLE_SUMMARY_MS);
  }
}

function everyoneDone(room) {
  const a = active(room).filter(p => p.connected);
  return a.length > 0 && a.every(p => p.finished);
}

/**
 * A departing player keeps their seat mid-round — a dropped connection must
 * never cost anyone their scorecard.  But a seat is only worth keeping if it
 * has a card: in the lobby, or for a spectator who never played a hole, the
 * seat is dropped so join/leave churn cannot grow the roster (and with it
 * every snapshot) without bound.
 */
function dropIfNeverPlayed(room, p) {
  if (room.state === 'lobby' || (p.spectator && p.scores.every(s => s == null))) {
    room.players = room.players.filter(x => x.pid !== p.pid);
  }
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
    p.afterBad = p.scores[room.holeIndex] > h.par;    // Grit steadies the next tee
    // coins are banked hole by hole, so the counter should move hole by hole
    const sock = p.socketId && io.sockets.sockets.get(p.socketId);
    if (sock) sock.emit('profile', publicProfile(p.pid));
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
    const pars = course(room).holes.map(x => x.par);
    for (const p of active(room)) {
      const played = p.scores.filter(v => v != null).length;
      const total = p.scores.reduce((a, v) => a + (v ?? 0), 0);
      const holeScores = p.scores.map((s, i) => s == null ? null : { strokes: s, par: pars[i] }).filter(Boolean);
      const rc = settleRound(p.pid, room.courseId, holeScores);
      const prof = recordRound(p.pid, total - parTotal, played);
      /* The record board only ever sees rounds THIS server simulated, and
         only complete ones — see records.js for why both matter. */
      const beat = submitRound(room.courseId, p.name, p.pid, holeScores);
      if (beat.round || beat.holes.length) {
        io.to(room.code).emit('toast', {
          msg: beat.round
            ? `🏆 ${p.name} set the course record — ${total} at ${course(room).name}`
            : `🏆 ${p.name} set a new best on hole ${beat.holes[0] + 1}`,
          kind: 'good'
        });
        /* The board is one board for everybody, so a new record has to reach
           everybody — not just the four people who watched it happen. Anyone
           sitting in the clubhouse sees the row change under them, and anyone
           playing another round on this course sees the target they are
           chasing move. Without this the board is only as live as the last
           time you happened to open the screen. */
        io.emit('records:beat', {
          courseId: room.courseId,
          course: course(room).name,
          name: p.name,
          pid: p.pid,
          round: beat.round ? { total, par: parTotal } : null,
          holes: beat.holes,
          all: allRecords()
        });
      }
      const sock = p.socketId && io.sockets.sockets.get(p.socketId);
      if (sock && prof) {
        sock.emit('profile', prof);
        const bits = ['🪙 +' + rc.total + ' this round'];
        if (rc.xp) bits.push('+' + rc.xp + ' XP');
        if (rc.streakPct) bits.push('streak +' + rc.streakPct + '%');
        if (rc.firstClearBonus) bits.push('first clear +500');
        sock.emit('toast', { msg: bits.join(' · '), kind: 'good' });
        /* Only the server knows what the level was BEFORE this round was
           folded in, so the level-up has to be announced from here. */
        if (rc.leveledUp) sock.emit('levelup', rc.leveledUp);
      }
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
    records: recordsFor(room.courseId),
    maxPlayers: MAX_PLAYERS,
    noShove: !!room.noShove,
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
      clubTier: getProfile(p.pid).clubTier ?? 0,
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

/**
 * Broadcast for the chatty per-player channels (look, prefs).  A snapshot goes
 * to every player, so a client scripting hundreds of messages a second must
 * not become a bandwidth amplifier: bursts coalesce to at most ~5 snapshots a
 * second per player, with a trailing send so the last change always lands.
 */
function castSoon(room, p) {
  const now = Date.now();
  if (now - (p.castAt || 0) >= 200) { p.castAt = now; broadcastState(room); return; }
  if (p.castTimer) return;
  p.castTimer = setTimeout(() => {
    p.castTimer = null; p.castAt = Date.now(); broadcastState(room);
  }, 220);
  p.castTimer.unref?.();
}
const toast = (room, msg, kind) => io.to(room.code).emit('toast', { msg, kind: kind || 'info' });

/* ------------------------------------------------------------------ sockets */
io.on('connection', socket => {

  function bind(room, player) {
    // Claim the seat FIRST.  Kicking the old socket runs its disconnect
    // handler synchronously, and that handler bows out only when the seat's
    // socketId no longer matches — reassign after the kick and the handler
    // would remove the very player we are binding.
    const oldId = player.socketId;
    player.socketId = socket.id;
    player.connected = true;
    if (oldId && oldId !== socket.id) {
      const old = io.sockets.sockets.get(oldId);
      if (old) { try { old.emit('kicked', { reason: 'Opened in another tab' }); old.disconnect(true); } catch { /* gone */ } }
    }
    sockets.set(socket.id, { code: room.code, pid: player.pid });
    socket.data.pid = player.pid;
    socket.join(room.code);
    room.emptySince = null;
    // Arriving is one of the two events that can un-strand a room.
    ensureContinuable(room);
    socket.emit('profile', publicProfile(player.pid));
  }

  /**
   * A socket holds one seat at a time.  Before it creates or joins a room,
   * release whatever it was bound to — otherwise the old room keeps a phantom
   * `connected` player forever, the reaper can never collect it, and this
   * socket keeps receiving that room's broadcasts on top of the new one's.
   */
  function unbind() {
    const ref = sockets.get(socket.id);
    if (!ref) return;
    sockets.delete(socket.id);
    forgetChat(ref.pid);
    socket.leave(ref.code);
    const room = rooms.get(ref.code); if (!room) return;
    const p = room.players.find(x => x.pid === ref.pid);
    if (!p || p.socketId !== socket.id) return;
    p.connected = false;
    p.socketId = null;
    dropIfNeverPlayed(room, p);
    ensureContinuable(room);
    if (!room.players.some(x => x.connected)) room.emptySince = Date.now();
    broadcastState(room);
  }

  socket.on('room:create', (data, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const pid = cleanPid(data?.pid);
    if (!pid) return reply({ ok: false, error: 'Bad client id — refresh the page.' });
    if (!evictIfFull()) {
      return reply({ ok: false, error: 'The course is completely full right now — try again in a minute.' });
    }
    unbind();
    const room = createRoom(makeCode(), data?.courseId);
    rollWind(room);
    const p = addPlayer(room, pid, cleanName(data?.name), false);
    bind(room, p);
    reply({ ok: true, code: room.code, pid, state: snapshot(room) });
    broadcastState(room);
  });

  socket.on('room:join', (data, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const pid = cleanPid(data?.pid);
    const code = String(data?.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    if (!pid) return reply({ ok: false, error: 'Bad client id — refresh the page.' });
    const room = rooms.get(code);
    if (!room) return reply({ ok: false, error: 'No room with code ' + (code || '—') });
    const prev = sockets.get(socket.id);
    if (!prev || prev.code !== code || prev.pid !== pid) unbind();

    let p = room.players.find(x => x.pid === pid);
    if (p) {
      p.name = cleanName(data?.name);
      bind(room, p);      // ensureContinuable inside covers a frozen room
      reply({ ok: true, code, pid, state: snapshot(room), rejoined: true });
      broadcastState(room);
      return;
    }
    if (room.players.filter(x => x.connected).length >= MAX_PLAYERS) {
      return reply({ ok: false, error: `That room is full (${MAX_PLAYERS} players).` });
    }
    // Join/leave churn during a round must not grow the roster without bound:
    // every seat rides inside every snapshot.  Reclaim dead spectator seats
    // first, and past a hard cap turn newcomers away.
    if (room.players.length >= MAX_PLAYERS * 2) {
      const ghost = room.players.find(x =>
        !x.connected && x.pid !== room.hostPid && x.scores.every(s => s == null));
      if (ghost) room.players = room.players.filter(x => x !== ghost);
      if (room.players.length >= MAX_PLAYERS * 3) {
        return reply({ ok: false, error: 'That room is full.' });
      }
    }
    const spec = room.state !== 'lobby';
    p = addPlayer(room, pid, cleanName(data?.name), spec);
    bind(room, p);
    reply({ ok: true, code, pid, state: snapshot(room), spectator: spec });
    toast(room, p.name + (spec ? ' is watching until the next hole.' : ' joined.'));
    broadcastState(room);
  });

  // Payloads are normalised INSIDE the body, never destructured in the
  // parameter list: a `= {}` default only covers undefined, so a client
  // emitting `null` would throw before the first guard ran — and an uncaught
  // throw in a socket handler kills the whole process.
  socket.on('room:course', (d) => {
    const courseId = d?.courseId;
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

  socket.on('room:tees', (d) => {
    const teeSet = d?.teeSet;
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
  socket.on('player:prefs', (d) => {
    const color = d?.color, bag = d?.bag;
    const ref = sockets.get(socket.id); if (!ref) return;
    const room = rooms.get(ref.code); if (!room) return;
    const p = room.players.find(x => x.pid === ref.pid); if (!p) return;

    const before = p.color + '|' + JSON.stringify(p.bag);
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
    // only broadcast a real change, and coalesce bursts (see castSoon)
    if (before === p.color + '|' + JSON.stringify(p.bag)) return;
    castSoon(room, p);
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
    /* Speed, derived from the positions they report rather than taken on
       trust from a number they send. A shove's strength comes from this, so
       it is worth computing rather than believing. */
    const tNow = Date.now();
    if (p.moveAt) {
      const dt = (tNow - p.moveAt) / 1000;
      if (dt > 0.02) {
        const d = Math.hypot(p.ax - (p.moveX ?? p.ax), p.az - (p.moveZ ?? p.az));
        p.aspeed = Math.min(12, d / dt);
      }
    }
    p.moveAt = tNow; p.moveX = p.ax; p.moveZ = p.az;

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
            v: clamp(Number(c.v) || 0, -6, 37),
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

  socket.on('player:look', (d) => {
    const ref = sockets.get(socket.id); if (!ref) return;
    const room = rooms.get(ref.code); if (!room) return;
    const p = room.players.find(x => x.pid === ref.pid); if (!p) return;
    /* Cosmetics ride in the look, so this is the gate on them. A client can
       ask for anything; what comes out is clamped to the level the SERVER
       has on record. Without this every decal, trail and title in the game
       is one hand-written socket message away from free, and a hundred
       levels of rewards mean nothing. */
    const level = levelFromXp(getProfile(ref.pid)?.xp || 0).level;
    const next = looksEarnedAt(d?.look, room.players.indexOf(p), level);
    // only broadcast a real change, and coalesce bursts (see castSoon)
    if (JSON.stringify(next) === JSON.stringify(p.look)) return;
    p.look = next;
    castSoon(room, p);
  });

  /**
   * Offer the nearest player a lift.  Holds no state at all: no invite record,
   * no timeout, no accept event — just a message.  They board by walking over
   * and pressing C, which is what they would do anyway, so there is nothing
   * here that can deadlock or leak.
   */
  /* Your career before you have joined anything.
     The profile used to arrive only when a socket bound to a room, so the
     title screen showed 0 coins to a returning player with thousands — you
     could not see your own credits until you were already playing. */
  socket.on('profile:me', (d) => {
    const pid = cleanPid(d?.pid);
    if (!pid) return;
    // Remember who this socket belongs to.  The clubhouse — career, pro shop,
    // the bag — is deliberately OUTSIDE any room, so room membership cannot be
    // the only way we know a player's identity.
    socket.data.pid = pid;
    // A player we have never seen may be a genuinely new player, or the same
    // player after this host wiped its disk on a deploy.  seedProfile tells
    // those apart safely: it only ever fills a blank, and only within clamps.
    if (d?.restore) {
      try { seedProfile(pid, d.restore); } catch { /* malformed: ignore */ }
    }
    socket.emit('profile', publicProfile(pid));
  });

  /* Emotes.  Relayed rather than trusted: the server checks the id is one we
     ship AND that this player's level has actually unlocked it, so a modified
     client cannot broadcast an emote it has not earned — the unlock is the
     whole reward, and it would be worth nothing if it could be skipped.
     Rate-limited because it is a broadcast anyone can trigger at will. */
  socket.on('player:emote', (d) => {
    const ref = sockets.get(socket.id); if (!ref) return;
    const room = rooms.get(ref.code); if (!room) return;
    const p = room.players.find(x => x.pid === ref.pid); if (!p) return;

    const id = String(d?.id || '');
    const e = EMOTES.find(x => x.id === id);
    if (!e) return;
    const lvl = levelFromXp(getProfile(ref.pid).xp || 0).level;
    if (lvl < e.at) {
      return socket.emit('toast', { msg: `${e.name} unlocks at level ${e.at}.`, kind: 'warn' });
    }
    const now = Date.now();
    if (now - (p.lastEmoteAt || 0) < 1200) return;      // one at a time
    p.lastEmoteAt = now;
    io.to(room.code).emit('player:emote', { pid: p.pid, id });
  });

  /* ------------------------------------------------------------ presence --
     Who is online and what they are doing.  Built from the live room table
     rather than a second store, so it cannot drift out of step with reality
     and there is nothing to clean up when someone drops.

     Note the honesty about identity: this is keyed on the same pid as
     everything else, which for a CrazyGames GUEST is a local id CrazyGames
     themselves warn against trusting across sessions ("multiple users might
     share the same device").  Presence is fine on that basis — it only has
     to be true right now — but a durable FRIENDS list is not, and that is
     why this ships and the friend list waits for a real account. */
  /* ------------------------------------------------------------ melee ----
     Shoving another golfer, with a real positional effect. The griefing risk
     was raised and accepted, so this moves people for real — including off a
     green. Two guards remain, kept on their merits rather than as hedging:

       - you cannot shove someone who is standing over their ball on their
         turn. That is the difference between griefing and stealing a stroke,
         and it costs nothing to prevent. The server can tell: it knows whose
         turn it is and where their ball is.
       - the host can switch it off for their room.

     Everything is checked here. Range, cooldown and strength all come from
     the server's own view of where people are — a client that lies about its
     position is already constrained by the walk-to-your-ball rule. */
  socket.on('player:shove', (d) => {
    const ref = sockets.get(socket.id); if (!ref) return;
    const room = rooms.get(ref.code); if (!room) return;
    if (room.noShove) return;
    const me = room.players.find(x => x.pid === ref.pid); if (!me) return;
    const target = room.players.find(x => x.pid === cleanPid(d?.pid));
    if (!target || target.pid === me.pid || !target.connected) return;
    // You have to be on foot to barge. Ramming FROM a cart is what the cart
    // collision code is for, and it already does it better than this would.
    if (inCart(me)) return;

    const now = Date.now();
    /* Short enough to shove repeatedly — the second-and-a-half cooldown made
       it feel like a move you were being rationed. This is only here so one
       held key cannot become a per-frame flood on the wire. */
    if (now - (me.shoveAt || 0) < 320) return;

    const dx = (target.ax ?? target.x) - (me.ax ?? me.x);
    const dz = (target.az ?? target.z) - (me.az ?? me.z);
    const dist = Math.hypot(dx, dz);
    if (dist > 2.4 || dist < 1e-3) return;              // out of reach

    /* Standing over their own ball, on their own turn: hands off. */
    const atBall = !inCart(target) && room.turnPid === target.pid &&
      Math.hypot((target.ax ?? 0) - target.x, (target.az ?? 0) - target.z) <= SHOT_RADIUS + 0.5;
    if (atBall) {
      return socket.emit('toast', { msg: 'Not while they are over the ball.', kind: 'warn' });
    }

    me.shoveAt = now;
    /* Strength, from the speed the SERVER measured off their reported
       positions rather than a number the client sends. */
    const speed = Math.min(9, me.aspeed || 0);
    let power = 3.4 + speed * 1.15;            // 3.4 standing .. 13.7 sprinting

    /* Shoving a CART. It weighs a great deal more than a golfer, so the same
       barge moves it far less — but it does move, which is the point: a cart
       parked across your line is now something you can lean on rather than
       something you have to walk around. */
    const cart = inCart(target);
    if (cart) power *= 0.28;

    io.to(room.code).emit('player:shoved', {
      from: me.pid, pid: target.pid, cart: !!cart,
      nx: dx / dist, nz: dz / dist, power
    });
  });

  /* The host's switch. Default is ON — the risk was accepted — but a lobby
     that turns sour can shut it off without anyone having to leave. */
  socket.on('room:shove', (d) => {
    const ref = sockets.get(socket.id); if (!ref) return;
    const room = rooms.get(ref.code); if (!room) return;
    if (ref.pid !== room.hostPid) return;
    room.noShove = !d?.on;
    toast(room, room.noShove ? 'Shoving is off in this room.' : 'Shoving is on.');
    broadcastState(room);
  });

  /* ------------------------------------------------------------- chat ----
     Filtered, rate limited and rebroadcast from HERE. The client escapes on
     render; this is the only place a check is worth anything, because this
     is where the message is copied to everyone else. */
  socket.on('chat:say', (d) => {
    const ref = sockets.get(socket.id); if (!ref) return;
    const room = rooms.get(ref.code); if (!room) return;
    const p = room.players.find(x => x.pid === ref.pid); if (!p) return;

    // a quick phrase is fixed text we wrote, so it skips the filter entirely
    const quick = d?.phrase ? phraseText(String(d.phrase)) : null;
    let text, hits = 0;
    if (quick) {
      /* Fixed text we wrote, so it skips the FILTER — but not the rate limit.
         Skipping both made the phrase wheel an unlimited spam channel, which
         is the same problem free text has, just with politer words. */
      const gate = allowChat(ref.pid);
      if (!gate.ok) return socket.emit('toast', { msg: gate.why, kind: 'warn' });
      text = quick;
    } else {
      const res = prepareChat(ref.pid, d?.text);
      if (!res) return;                               // empty after cleaning
      if (res.error) return socket.emit('toast', { msg: res.error, kind: 'warn' });
      text = res.text; hits = res.hits;
    }
    io.to(room.code).emit('chat:msg', {
      pid: p.pid, name: p.name, color: p.color, text,
      at: Date.now(), filtered: hits > 0
    });
  });

  socket.on('presence:who', (d, ack) => {
    if (typeof ack !== 'function') return;
    const out = [];
    for (const room of rooms.values()) {
      const h = room.state === 'playing' || room.state === 'holeover'
        ? course(room)?.holes?.[room.holeIndex] : null;
      for (const p of room.players) {
        if (!p.connected) continue;
        out.push({
          pid: p.pid, name: p.name, code: room.code,
          courseId: room.courseId,
          doing: room.state === 'lobby' ? 'in a lobby'
            : room.state === 'results' ? 'finishing a round'
              : h ? `on the ${h.number}${['th','st','nd','rd'][h.number % 10 > 3 ? 0 : h.number % 10] || 'th'}`
                : 'on the course',
          joinable: room.state === 'lobby' &&
            room.players.filter(x => x.connected).length < MAX_PLAYERS
        });
      }
    }
    ack({ online: out.slice(0, 60), rooms: rooms.size });
  });

  socket.on('records:all', (d, ack) => {
    if (typeof ack === 'function') ack({ records: allRecords() });
  });

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

  /**
   * The pro shop.  Coins were earned from shots this server simulated, and
   * the gear bought here is applied by this server inside the simulation —
   * the client never tells us what equipment it has, it ASKS what it owns.
   */
  socket.on('shop:buy', (d) => {
    const item = d?.item;
    /* Identity, NOT room membership.  This used to read the room binding and
       bail out when there was none — and the shop lives in the clubhouse,
       which is outside every room, so on the title screen every single
       purchase returned here silently.  No coins spent, no item granted, no
       error shown: the player clicked Hire and absolutely nothing happened.
       That is the whole of "the upgrades don't work". */
    const pid = sockets.get(socket.id)?.pid || socket.data.pid;
    if (!pid) return socket.emit('toast', { msg: 'Still connecting — try again in a second.', kind: 'warn' });
    const why = buyItem(pid, String(item || ''), SHOP, purchaseBlocked, crewPurchase);
    if (why) return socket.emit('toast', { msg: why, kind: 'warn' });
    socket.emit('toast', { msg: 'In the bag.', kind: 'good' });
    socket.emit('profile', publicProfile(pid));
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
    const prof = getProfile(p.pid);
    const shot = {
      x: p.x, z: p.z,                                  // the server's ball, not theirs
      gear: prof.gear || null,                         // what WE have on file
      crew: prof.crew || null,
      clubTier: prof.clubTier ?? 0,
      refine: prof.refine ?? 0,
      afterBadHole: !!p.afterBad,                      // Grit's moment
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
    dropIfNeverPlayed(room, p);
    // Never tear down a round because connections blipped — park it and let
    // them come back to the same scorecard.
    ensureContinuable(room);
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

// The last line of defence, never the first: every handler above normalises
// its own input, but no single bug should ever take down every room on the
// server.  Log it loudly and keep serving.
process.on('uncaughtException', err => {
  console.error('  UNCAUGHT —', err?.stack || err);
});
process.on('unhandledRejection', err => {
  console.error('  UNHANDLED REJECTION —', err?.stack || err);
});
