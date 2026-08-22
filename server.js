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
import { ratingsFor } from './public/js/shared/handicap.js';
import { weatherFor } from './public/js/shared/weather.js';
import { loadNames, claimName, checkName, adoptName, nameOf as claimedName,
         renameQuote, nameHistory } from './server/names.js';
import { loadFriends, friendState, friendCode, requestFriend, acceptFriend,
         declineFriend, removeFriend, blockPlayer, unblockPlayer,
         toggleFavourite, friendsOf, areFriends } from './server/friends.js';

/* Course rating and slope, computed once per course and kept. The geometry
   is a pure function of the seed, so these cannot change while the process
   is up — and recomputing them for every player at the end of every round
   would walk nine holes of hazards eight times for an answer that never
   moves. */
/* Who a player's friends ARE, as cards: name, level, handicap, and where
   they are right now. Presence comes from the live socket map rather than
   from anything stored — "online" is only ever a claim about this instant. */
function friendPeople(pid) {
  const out = [];
  for (const fid of friendsOf(pid)) {
    const p = publicProfile(fid);
    const live = liveOf(fid);
    out.push({
      pid: fid,
      name: nameOf(fid),
      level: p.level, index: p.index ?? null, rating: p.rating,
      rounds: p.rounds, best: p.best ?? null,
      online: !!live,
      where: live?.where || null,
      room: live?.joinable ? live.room : null
    });
  }
  // favourites first, then online, then by level
  const fav = new Set(friendState(pid).favourites);
  out.sort((a, b) =>
    (fav.has(b.pid) - fav.has(a.pid)) || (b.online - a.online) || (b.level - a.level));
  for (const f of out) f.fav = fav.has(f.pid);
  return out;
}

/** Where a player is, if they are connected at all. */
function liveOf(pid) {
  /* Two places a connection can be known, and both have to be checked.

     `sockets` only holds players BOUND TO A ROOM. Somebody sitting in the
     clubhouse or on the front page has never been bound — they identified
     with profile:me, which puts the id on socket.data and nowhere else. The
     first version scanned only the room map, so every friend who was not
     mid-round showed as offline, which is most of them most of the time. */
  for (const sk of io.sockets.sockets.values()) {
    if (sk.data?.pid === pid && !sockets.get(sk.id)) {
      return { where: 'In the menu', room: null, joinable: false };
    }
  }
  for (const ref of sockets.values()) {
    if (ref.pid !== pid) continue;
    const room = ref.code ? rooms.get(ref.code) : null;
    if (!room) return { where: 'In the menu', room: null, joinable: false };
    const c = biomeFor(room.courseId);
    return {
      where: room.state === 'lobby'
        ? `Waiting in a lobby${c ? ' at ' + c.name : ''}`
        : `${c ? c.name : 'Playing'} · hole ${room.holeIndex + 1}`,
      room: room.code,
      /* Joinable only if there is a seat AND the round has not started —
         dropping somebody into hole six of a round they did not play is
         not joining a friend, it is ruining a scorecard. */
      joinable: room.state === 'lobby' && room.players.length < MAX_PLAYERS
    };
  }
  return null;
}

const nameOf = pid => {
  /* The REGISTRY first, because it is the only copy anybody claimed. The
     live room name and the profile copy are both caches of it, and a cache
     that outranks its source is how two players end up looking like one. */
  const claimed = claimedName(pid);
  if (claimed) return claimed;
  for (const ref of sockets.values()) if (ref.pid === pid && ref.name) return ref.name;
  return getProfile(pid).name || 'Golfer';
};

/* `name` on a room player is the live one and wins; the profile copy is the
   fallback that makes an offline friend readable. */

/* friends.js stores edges and nothing else — no names, because a name is
   not a property of a friendship and storing a copy of one is storing a
   stale copy of one. The panel needs them, so they are attached here, from
   the profile, at the moment of sending. */
function decorate(pid) {
  const st = friendState(pid);
  st.pending = st.pending.map(q => ({ ...q, name: nameOf(q.pid) }));
  return st;
}

/**
 * Every friend as a leaderboard row, ranked among themselves.
 *
 * Not a filter over the global board: a friends-only view that can only show
 * friends who happen to be in the world top hundred is a view that is empty
 * for almost everybody, which is the opposite of what it is for.
 */
function friendBoardRows(pid) {
  const rows = [];
  for (const fid of [pid, ...friendsOf(pid)]) {
    const p = publicProfile(fid);
    if (!p) continue;
    rows.push({
      pid: fid, name: nameOf(fid),
      index: p.index ?? null, level: p.level, xp: p.xp || 0,
      rounds: p.rounds || 0, best: p.best ?? null,
      rating: p.rating,
      friend: fid !== pid, me: fid === pid,
      online: !!liveOf(fid)
    });
  }
  /* Ranked on handicap where there is one, and everybody without one goes
     to the bottom — a player with three rounds is not better than a scratch
     golfer just because their index is null. */
  rows.sort((a, b) => {
    const ai = a.index == null ? 1e9 : a.index;
    const bi = b.index == null ? 1e9 : b.index;
    return ai - bi || b.level - a.level;
  });
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

/* pid -> [invite]. In memory on purpose: an invitation to a round that has
   already teed off is not an invitation, so they die with the process the
   same way the rooms they point at do. */
const invites = new Map();
const INVITE_TTL_MS = 10 * 60 * 1000;

/** This player's invitations, minus the dead ones. */
function liveInvites(pid) {
  const now = Date.now();
  const list = (invites.get(pid) || []).filter(x => {
    if (x.expires < now) return false;
    const room = rooms.get(x.room);
    // an invite whose room is gone or already playing is not answerable
    return !!room && room.state === 'lobby';
  });
  invites.set(pid, list);
  return list;
}

function pushInvites(pid) {
  for (const [sid, r] of sockets) {
    if (r.pid === pid) io.to(sid).emit('invite:state', { invites: liveInvites(pid) });
  }
  for (const sk of io.sockets.sockets.values()) {
    if (sk.data?.pid === pid && !sockets.get(sk.id)) {
      sk.emit('invite:state', { invites: liveInvites(pid) });
    }
  }
}

/** Push a fresh friends payload to one player, if they are connected. */
function pushFriends(pid) {
  if (!pid) return;
  for (const [sid, ref] of sockets) {
    if (ref.pid !== pid) continue;
    io.to(sid).emit('friends:state',
      { state: decorate(pid), people: friendPeople(pid) });
  }
}

const _ratings = new Map();
const courseRatings = id => {
  if (!_ratings.has(id)) _ratings.set(id, ratingsFor(getCourse(id)));
  return _ratings.get(id);
};
import { storeName } from './server/store.js';
import { terrainFor } from './public/js/shared/terrain.js';
import { BIOMES, COURSE_ORDER, BALL_COLORS, MAX_PLAYERS, HOLES_PER_COURSE,
         biomeFor, courseMeta } from './public/js/shared/biomes.js';
import { ShotSim, calibrateCarries } from './public/js/shared/ballistics.js';
import { CLUB_BY_KEY, normaliseBag, DEFAULT_BAG } from './public/js/shared/clubs.js';
import { rngKit, hashSeed, clamp } from './public/js/shared/rng.js';
import { normaliseLook, looksEarnedAt, SHOT_RADIUS } from './public/js/shared/avatars.js';
import { CART_TTL_MS, HAIL_RADIUS } from './public/js/shared/cart.js';
import { loadProfiles, getProfile, publicProfile, recordHole, recordRound, colorAllowed, buyItem, seedProfile,
         worldRanking, worldPlace, handicapRanking, handicapPlace, levelRanking, rememberName,
         setClubSkin,
         weeklyGainers, seasonBoard, courseBoard } from './server/profiles.js';
import { SHOP, purchaseBlocked } from './public/js/shared/gear.js';
import { EMOTES, meleeById } from './public/js/client/celebrations.js';
import { prepare as prepareChat, phraseText, forget as forgetChat, allow as allowChat, PHRASES, clean } from './server/chat.js';
import { levelFromXp } from './public/js/shared/economy.js';
import { crewPurchase, cartBoost } from './public/js/shared/crew.js';
import { settleRound, setDifficulty, difficultyOf,
         setLook, setBallColor, setBag, kitOf, markSeen,
         flushProfiles, claimLogin, openCase, buyCase } from './server/profiles.js';
import { normaliseDifficulty, earnRate, allowsRecords, difficultyById } from './public/js/shared/difficulty.js';
import * as Activity from './server/activity.js';
import { loadRecords, recordsFor, allRecords, submitRound,
         offerRecords, restoreOpen, badgesFor } from './server/records.js';
import { loadFeedback, submitFeedback, submitReport, listFeedback, voteFeedback } from './server/feedback.js';
/* Shared, not server-only: the client needs the same format table to draw
   the picker and the same team colours to draw the card, and two copies of a
   list like that drift within a week. */
import { FORMATS, formatById, isScramble, seatsFor, assignTeams, teamLevel,
         bestBall, gatherTeam, finishTeam, teamCard } from './public/js/shared/scramble.js';

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
await loadFeedback();
await loadFriends();
await loadNames();
/* Say it out loud when the board cannot survive a deploy. Without a database
   the records live in a file, and a host with no persistent disk (Render's
   free tier, for one) discards it every time you push. Records set today will
   be gone tomorrow, and there is nothing in the code that can fix that — so
   it should at least be impossible to be surprised by it. */
if (!process.env.DATABASE_URL) {
  console.log('  records: NO DATABASE_URL — the board is a file on this disk.');
  console.log('           On a host without persistent storage it resets on');
  console.log('           every deploy. Set DATABASE_URL to keep it for good.');
}

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
  /* CACHE SKEW IS THE ENEMY HERE, not bandwidth.
     -----------------------------------------------------------------------
     The HTML revalidated on every load and the scripts sat in cache for ten
     minutes. So for ten minutes after every deploy a returning player got
     BRAND NEW HTML DRIVEN BY OLD JAVASCRIPT — and that is not a slightly
     stale page, it is a broken one. It shipped exactly that way: the new
     markup carried a tab bar whose inactive panels are hidden, the cached
     script had no code to switch tabs, and the Pro Shop became unreachable
     while three new courses failed to appear. From the outside it looks like
     the UI was rebuilt badly. Nothing was wrong with the UI.

     There is no build step here and no content-hashed filenames, so the only
     way to make the HTML and the module graph land together is to revalidate
     both. That is one conditional request per file, answered with a 304 and
     no body, and it is worth it.

     /vendor/ is the exception and keeps a long immutable cache: three.js is
     1.2 MB of the 1.47 MB bundle and its URL changes when the library does.
     So the big download is still cached hard; only the small files we
     actually edit are rechecked. */
  const vendored = req.path.startsWith('/vendor/');
  res.setHeader('Cache-Control', DEV ? 'no-store'
    : vendored ? 'public, max-age=31536000, immutable'
    : 'no-cache');

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
app.get('/healthz', (_req, res) => {
  /* WHERE THE CAREERS ARE GOING, checkable with a URL. The store says this
     at boot, but a boot message is only findable by whoever is reading the
     logs at the time — and the failure it reports is silent from every other
     angle: a wrong DATABASE_URL leaves the game working perfectly and
     quietly writing to a disk that the next deploy wipes. `persistent:
     false` here is the one place you can check it in a second, from
     anywhere, after the fact. */
  const store = storeName();
  res.json({
    ok: true, rooms: rooms.size,
    players: [...rooms.values()].reduce((n, r) => n + r.players.length, 0),
    store,
    persistent: store === 'postgres',
    warning: store === 'postgres' ? undefined
      : 'No database: careers and records reset when this host redeploys. Set DATABASE_URL.',
    courses: COURSES.map(c => ({ id: c.id, name: c.name, par: c.par, yards: c.yards })),
    uptime: Math.round(process.uptime())
  });
});
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
// how long a turn can sit with nothing at all happening before it is taken
// away — see the AFK sweep near the bottom of the file. Overridable so a
// test can see it happen in seconds rather than waiting three real minutes.
const AFK_MS = Number(process.env.GOLF_AFK_MS) || 3 * 60 * 1000;
const AFK_SWEEP_MS = Number(process.env.GOLF_AFK_SWEEP_MS) || 20000;
const KICK_VOTE_WINDOW_MS = Number(process.env.GOLF_KICK_VOTE_MS) || 45000;
const KICK_VOTE_COOLDOWN_MS = Number(process.env.GOLF_KICK_COOLDOWN_MS) || 5 * 60 * 1000;

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

function createRoom(code, courseId, format, privacy) {
  const room = {
    code,
    hostPid: null,
    courseId: COURSE_ORDER.includes(courseId) ? courseId : COURSE_ORDER[0],
    format: formatById(format).id,  // stroke | 2v2 | 3v3 | 4v4 — see scramble.js
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
    emptySince: Date.now(),
    /* Public is the default because it always has been — every room already
       showed up in "Open rounds" and the online panel before this field
       existed, and defaulting the other way would quietly un-list every
       room a host didn't touch a new checkbox for. Private only ever
       happens because the host asked for it. */
    privacy: privacy === 'private' ? 'private' : 'public'
  };
  rooms.set(code, room);
  return room;
}

const course = room => getCourse(room.courseId);
const hole = room => course(room).holes[clamp(room.holeIndex, 0, HOLES_PER_COURSE - 1)];
const biome = room => biomeFor(room.courseId);
const terrain = room => terrainFor(hole(room), biome(room));
const active = room => room.players.filter(p => !p.spectator);
const teeOf = room => (hole(room).tees || {})[room.teeSet] || hole(room).tee;

/** Wind for a hole: deterministic from the room seed, so it never re-rolls. */
function rollWind(room) {
  const bio = biome(room);
  const rk = rngKit(hashSeed(room.code, room.holeIndex, 0x1d));
  /* The weather scales the wind rather than replacing it: a blowing day on
     a links is the links wind turned up, not a different wind. Computed
     from the ROOM code alone, so it holds for the whole round — weather
     that changed between holes would be a different game every hole, and
     the ball-flight numbers a player learned on the first tee would be
     lies by the fourth. */
  const w = room.weather || (room.weather = weatherFor(hashSeed(room.code, 0, 0x1d), room.courseId));
  // capped at 13 m/s (~29 mph): beyond that even a wedge becomes a lottery
  const speed = clamp((bio.windBase + rk.gauss() * bio.windGust) * w.windMul, 0, 13);
  room.wind = { dir: rk.f(-Math.PI, Math.PI), speed: Math.round(speed * 10) / 10 };
}

function addPlayer(room, pid, name, spectator) {
  // every route into a room passes through here, so this is the one place
  // that has to remember the name for the friends list to read later
  rememberName(pid, name);
  /* WHAT THEY ALREADY OWN. Appearance, ball colour and bag live on the
     profile now — see setLook in profiles.js — so a player arrives dressed
     as themselves rather than as the default golfer. */
  const kit = kitOf(pid);
  const used = new Set(room.players.map(p => p.color));
  /* Their saved colour if it is free, otherwise the first unused one. Two
     identical balls on one hole is genuinely confusing, so the room still
     wins over the preference — but only when it has to. */
  const saved = kit?.color && !used.has(kit.color)
    ? BALL_COLORS.find(c => c.hex === kit.color) : null;
  const col = saved
    || BALL_COLORS.find(c => !c.lockRating && !used.has(c.hex))
    || BALL_COLORS.find(c => !c.lockRating) || BALL_COLORS[0];
  const h = hole(room);
  const t = teeOf(room);
  const p = {
    pid, name, color: col.hex, colorName: col.name,
    look: normaliseLook(kit?.look || null, room.players.length),
    // where the golfer is standing, as opposed to where the ball is
    ax: t.x, az: t.z, arot: t.rot,
    cart: null, cartAt: 0,
    bag: normaliseBag(kit?.bag || DEFAULT_BAG, { pad: true }),
    scores: new Array(HOLES_PER_COURSE).fill(null),
    strokes: 0, penalties: 0, finished: false,
    x: t.x, z: t.z, lie: 'tee',
    connected: true, spectator: !!spectator, socketId: null,
    lastActiveAt: Date.now()
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
  // spectators just became players, so the sides need recounting
  assignTeams(room);
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
    eligible[0].lastActiveAt = Date.now();
    return;
  }
  /* In a SCRAMBLE nobody plays twice until their side is level.
     After a gather every member of a team stands on the same ball, so they
     take their shots one at a time — but the moment the first one plays,
     their ball has moved and could easily be FARTHER from the hole than a
     teammate who has not swung yet. Farthest-plays would hand them the turn
     again and they would play the whole hole on their own. So anyone who is
     already a stroke ahead of the slowest player on their side waits. */
  let pool = eligible;
  if (isScramble(room.format)) {
    const behind = new Map();
    for (const p of eligible) {
      if (!Number.isInteger(p.team)) continue;
      const cur = behind.get(p.team);
      if (cur === undefined || p.strokes < cur) behind.set(p.team, p.strokes);
    }
    const waiting = eligible.filter(
      p => !Number.isInteger(p.team) || p.strokes === behind.get(p.team));
    if (waiting.length) pool = waiting;
  }

  let best = pool[0], bestD = -1;
  for (const p of pool) {
    const d = Math.hypot(p.x - h.pin.x, p.z - h.pin.z);
    if (d > bestD) { bestD = d; best = p; }
  }
  room.turnPid = best.pid;
  // the AFK sweep measures from the moment a turn actually starts, not
  // from whatever they last did while waiting for everyone else
  best.lastActiveAt = Date.now();
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

/* How long a removed pid is refused this room's code. Long enough that a
   griefer can't just rejoin and start over, short enough that a wrongful
   kick — the vote misfired, or the host changes their mind — is not a
   life sentence against a room that only lives as long as the round does
   anyway. */
const KICK_BLOCK_MS = 30 * 60 * 1000;

/**
 * The one path a player leaves a room involuntarily. Unlike a disconnect —
 * which parks the seat so a dropped connection never costs a scorecard —
 * this clears it outright: a kicked player is meant to be gone, not
 * reconnectable. Handles host/turn succession itself via ensureContinuable
 * so every caller gets that for free.
 */
function removePlayer(room, pid, reason) {
  const p = room.players.find(x => x.pid === pid);
  if (!p) return;
  room.kickBlocklist ??= new Map();
  room.kickBlocklist.set(pid, Date.now() + KICK_BLOCK_MS);
  const sid = p.socketId;
  room.players = room.players.filter(x => x.pid !== pid);
  if (room.turnPid === pid) room.turnPid = null;
  if (sid) {
    // Removed from `sockets` here, ahead of disconnect() firing, so that
    // handler's own lookup finds nothing and no-ops rather than repeating
    // (or fighting) the cleanup this function just did.
    sockets.delete(sid);
    const s = io.sockets.sockets.get(sid);
    if (s) { try { s.emit('kicked', { reason }); s.disconnect(true); } catch { /* already gone */ } }
  }
  ensureContinuable(room);
  if (!room.players.some(x => x.connected)) room.emptySince = Date.now();
}

/* Long enough that coming back is news, short enough that it is not an
   obituary. Somebody who plays every evening never triggers it. */
const AWAY_MS = 3 * 24 * 60 * 60 * 1000;

function greetReturner(pid) {
  const away = markSeen(pid);
  /* Only for players who have actually played — a feed entry saying a
     brand-new account is "back" is a feed entry about nothing. */
  if (away <= AWAY_MS || (getProfile(pid).rounds || 0) < 1) return;
  const days = Math.round(away / 86400000);
  Activity.push(pid, 'joined',
    days >= 14 ? `came back after ${Math.round(days / 7)} weeks`
               : `came back after ${days} days`);
}

/** "two under", "level", "five over" — the way a golfer says a score. */
function relName(rel) {
  if (rel === 0) return 'level par';
  const n = Math.abs(rel);
  return `${n} ${rel < 0 ? 'under' : 'over'}`;
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
    /* The moments worth telling a friend about, written as they happen
       rather than at the end of the round — an ace on the third should be
       in the feed while people are still playing the fourth. */
    const rel = p.scores[room.holeIndex] - h.par;
    if (p.scores[room.holeIndex] === 1) {
      Activity.push(p.pid, 'ace', `holed out from the tee on ${course(room).name} ${h.number}`);
    } else if (rel <= -3) {
      Activity.push(p.pid, 'albatross', `made an albatross on ${course(room).name} ${h.number}`);
    } else if (rel === -2) {
      Activity.push(p.pid, 'eagle', `made an eagle on ${course(room).name} ${h.number}`);
    }
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
      /* Harder modes pay more — the multiplier is the only thing a
         difficulty changes about the game's arithmetic. */
      const mode = difficultyOf(p.pid);
      const rc = settleRound(p.pid, room.courseId, holeScores, earnRate(mode));
      rc.difficulty = mode;
      /* The card the handicap is built from. Computed HERE rather than in
         profiles.js because this is the only place that has the course
         object — and it has to be the course as it is right now, since a
         rating derived from the geometry moves when the generator does. */
      const cr = courseRatings(room.courseId);
      /* PAR OVER THE HOLES ACTUALLY PLAYED, not the whole course.
         `total` counts only holes with a score — an unplayed hole reads as
         0 — while this was subtracting the par of all nine. So anybody who
         joined late, dropped out, or was still a spectator for the front
         nine was recorded as monstrously under par: three holes in 12 came
         out as 12 − 36 = −24.

         That single number then poisoned everything downstream. It became
         their `best`, which is what the profile screen shows and what the
         boards rank on; and the rating target is driven by the mean per
         hole, so −24 over three holes read as eight under a hole and
         clamped the rating to its ceiling. A player who had never finished
         a round could sit at 95 with a best of −23, which is exactly what
         the career screen was showing. */
      const playedPar = p.scores.reduce((a, v, i) => a + (v == null ? 0 : pars[i]), 0);
      const relToPar = total - playedPar;
      const prof = recordRound(p.pid, relToPar, played,
        played >= 9 ? { courseId: room.courseId, gross: total, rating: cr.rating, slope: cr.slope } : null);
      /* The record board only ever sees rounds THIS server simulated, and
         only complete ones — see records.js for why both matter. */
      /* RECORDS ARE GATED ON THE MODE. A course record set with the aim
         line drawn for you, the putt read on the green and a marked sweet
         spot is not the same achievement as one set without them, and a
         board that mixes the two is a board nobody trusts. Casual plays the
         same golf course — it just cannot write to the record book. */
      const beat = allowsRecords(mode)
        ? submitRound(room.courseId, mode, p.name, p.pid, holeScores)
        : { round: null, holes: [] };
      if (beat.round || beat.holes.length) {
        /* Beating your own difficulty's board is not always beating THE
           course record — a Standard round can retake the Standard board
           while Tournament still holds a lower total overall. Checked
           here, once, rather than guessed at from `beat` alone, so the
           toast never claims a bigger achievement than actually happened. */
        const cr = beat.round ? recordsFor(room.courseId).courseRecord : null;
        const isCourseRecord = cr && cr.round.pid === p.pid && cr.round.total === total;
        const diffName = difficultyById(mode).name;
        io.to(room.code).emit('toast', {
          msg: beat.round
            ? (isCourseRecord
                ? `🏆 ${p.name} set the course record — ${total} at ${course(room).name} (${diffName})`
                : `🥈 ${p.name} set the ${diffName} record — ${total} at ${course(room).name}`)
            : `🏆 ${p.name} set a new best on hole ${beat.holes[0] + 1} (${diffName})`,
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
          difficulty: mode,
          name: p.name,
          pid: p.pid,
          round: beat.round ? { total, par: parTotal } : null,
          courseRecord: isCourseRecord,
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

      /* THE FEED. Written from the server's own numbers, at the one moment
         it knows both what happened and what it beat. Everything here is
         past tense and nameless — the reader's view puts the name on, so
         one entry reads correctly as "You" and as "Sam". */
      const rel = relToPar;
      if (beat.round) {
        Activity.push(p.pid, 'record', `set the course record at ${course(room).name} — ${total}`);
      } else if (prof && prof.best === rel && played >= 9) {
        Activity.push(p.pid, 'best', `carded a new personal best — ${relName(rel)} at ${course(room).name}`);
      } else {
        Activity.push(p.pid, 'round', `went round ${course(room).name} in ${relName(rel)}`);
      }
      if (rc.leveledUp) Activity.push(p.pid, 'level', `reached level ${rc.leveledUp.to}`);
    }

    /* HEAD TO HEAD. Every pair in the room, which is why a four-ball is six
       separate records — that is what playing one feels like. Only players
       who actually finished count; a record that includes the round
       somebody's connection died in is one that loses the argument it
       exists to settle. */
    Activity.recordHeadToHead(
      active(room).map(p => ({
        pid: p.pid, name: p.name,
        total: p.scores.reduce((a, v) => a + (v ?? 0), 0),
        finished: p.scores.filter(v => v != null).length >= HOLES_PER_COURSE
      })),
      pid => getProfile(pid)
    );

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
    privacy: room.privacy || 'public',
    turnPid: room.turnPid,
    wind: room.wind,
    /* Sent rather than re-derived on the client. The client COULD compute
       it from the room code — it is a pure function — but then a change to
       the weather tables would need both sides redeployed in lockstep, and
       a client one version behind would be playing different weather from
       the server it is scored by. */
    weather: room.weather || null,
    records: recordsFor(room.courseId),
    format: room.format,
    teams: teamCard(room),
    maxPlayers: MAX_PLAYERS,
    noShove: !!room.noShove,
    holes: HOLES_PER_COURSE,
    players: room.players.map(p => ({
      pid: p.pid, name: p.name, color: p.color, colorName: p.colorName, team: p.team ?? null,
      badge: badgesFor(p.pid),
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
/* ── one player cannot spoil the room ─────────────────────────────────────
   Chat has always been rate limited; nothing else was. A client emitting
   `player:look` in a loop makes the server re-serialise and re-write the
   whole profile store every 800 ms, and every other player in every other
   room pays for it — which is the same blocked-event-loop failure that
   already produced "everything has gone really slow and sometimes I can't
   even hit my ball", just triggered deliberately.

   A token bucket per socket, not per message type: the thing being
   protected is the server's time, and it does not care which message spent
   it. Sized so that no honest client can reach it — a busy round sends
   position updates ten times a second, which is a fifth of this — and so
   that a loop hits it within a few frames.

   Position updates are exempt because they are the ten-a-second channel,
   they do no work beyond a rebroadcast, and rate limiting them would make a
   golfer stutter across the fairway on a bad connection. */
const BUCKET_MAX = 50;             // messages
const BUCKET_REFILL = 50;          // per second
const CHEAP = new Set(['player:move']);

function overRate(socket, event) {
  if (CHEAP.has(event)) return false;
  const now = Date.now();
  const b = socket.data._bucket || (socket.data._bucket = { t: now, n: BUCKET_MAX });
  b.n = Math.min(BUCKET_MAX, b.n + ((now - b.t) / 1000) * BUCKET_REFILL);
  b.t = now;
  if (b.n < 1) {
    /* Told once, then silence. A client that is looping will trip this on
       every message, and a warning per message is a second flood. */
    if (!socket.data._warned) {
      socket.data._warned = true;
      socket.emit('toast', { msg: 'Slow down a moment — too many requests.', kind: 'warn' });
      setTimeout(() => { socket.data._warned = false; }, 5000);
    }
    return true;
  }
  b.n -= 1;
  return false;
}

io.on('connection', socket => {
  socket.data.connectedAt = Date.now();

  /* An app-level echo on top of the engine.io heartbeat already configured
     above (pingInterval/pingTimeout). That proves the pipe is alive; this
     is what the client times to know how it FEELS — the number that turns
     "the game is laggy" into "40ms on websocket" or "600ms on polling
     after three reconnects", see §0.5. Trivial enough not to need its own
     exemption from the rate limiter above: a ping every few seconds is a
     rounding error against it. */
  socket.on('net:ping', (t, ack) => { if (typeof ack === 'function') ack(t); });

  /* Applied to every handler at once rather than remembered at each one:
     a guard you have to add by hand is a guard somebody forgets on the
     handler that needed it most. */
  socket.use(([event], next) => {
    if (overRate(socket, event)) return;   // dropped, deliberately silently
    /* Any message at all is evidence of a present human — chat, an emote,
       just moving the camera around while waiting your turn. Stamped here
       rather than in each handler for the same reason the rate limit is:
       one guard everything passes through beats one added by hand to
       every place that might need it. See the AFK sweep below for what
       actually reads this. */
    const ref = sockets.get(socket.id);
    if (ref) {
      const room = rooms.get(ref.code);
      const p = room?.players.find(x => x.pid === ref.pid);
      if (p) p.lastActiveAt = Date.now();
    }
    next();
  });


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
    const room = createRoom(makeCode(), data?.courseId, data?.format, data?.privacy);
    rollWind(room);
    const p = addPlayer(room, pid, cleanName(data?.name), false);
    assignTeams(room);
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
    // A kicked pid stays out of THIS room for the block's duration — see
    // removePlayer. Checked ahead of everything else so there is no path
    // back in, rejoin included.
    const blockedUntil = room.kickBlocklist?.get(pid);
    if (blockedUntil && blockedUntil > Date.now()) {
      return reply({ ok: false, error: 'You were removed from this room and cannot rejoin it yet.' });
    }
    const prev = sockets.get(socket.id);
    if (!prev || prev.code !== code || prev.pid !== pid) unbind();

    let p = room.players.find(x => x.pid === pid);
    if (p) {
      p.name = cleanName(data?.name);
      rememberName(pid, p.name);
      assignTeams(room);  // a returning player may have lost their side
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
    /* A joiner needs a side. Assigning only on create meant the host was on
       Green and everybody else was on no team at all — the format was on, the
       card drew one row, and the best-ball gather fired for a team of one. */
    assignTeams(room);
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

  /* Host-only, lobby-only — same pattern as room:course and room:tees.
     Mid-round is deliberately not allowed: flipping visibility on a room
     other people are already mid-round in is a different, harder problem
     (who does it affect, does a spectator who already found it get bounced)
     and the lobby is where every host actually wants this decision made. */
  socket.on('room:privacy', (d) => {
    const privacy = d?.privacy === 'private' ? 'private' : 'public';
    const ref = sockets.get(socket.id); if (!ref) return;
    const room = rooms.get(ref.code); if (!room) return;
    if (ref.pid !== room.hostPid || room.state !== 'lobby') return;
    if (room.privacy === privacy) return;
    room.privacy = privacy;
    broadcastState(room);
  });

  /** Your own kit: ball colour and the fourteen clubs you carry. */
  socket.on('player:prefs', (d) => {
    const color = d?.color, bag = d?.bag;
    const ref = sockets.get(socket.id);
    /* IDENTITY FIRST, ROOM SECOND — the same fault `player:look` had, in the
       handler right next to it. This bailed out when the sender was not in a
       room, and the difficulty picker lives in the CLUBHOUSE, which is
       outside every room. So choosing Tournament sent a message the server
       dropped, and the only reason it appeared to work is that the client
       applies the aids locally: the picker highlighted, the aim line went
       away, and the server still had you on Standard. Which meant the coin
       multiplier and the records gate — the two things the mode is supposed
       to change about the game's arithmetic — never moved, and the whole
       choice reset the next time you opened the page. */
    const pid = ref?.pid || socket.data.pid;
    if (!pid) return;

    if (typeof d?.difficulty === 'string') {
      const set = setDifficulty(pid, d.difficulty);
      socket.emit('profile', publicProfile(pid));
      // the room player carries it too, when there is one
      const inRoom = ref && rooms.get(ref.code)?.players.find(x => x.pid === pid);
      if (inRoom) inRoom.difficulty = set;
    }

    /* THE BAG IS A PROFILE SETTING, not a room one — and it is edited in
       the clubhouse, which is outside every room. So this dropped it for
       exactly the same reason it dropped the difficulty and the look before
       it: three separate settings, three separate reports of "it doesn't
       save", one shared assumption that a preference only exists inside a
       game.

       Only the ball COLOUR genuinely needs a room, because it is the one
       choice another player can take off you — two identical balls on one
       hole is confusing, so it is first come first served. */
    if (Array.isArray(bag)) {
      const clean = normaliseBag(bag);
      setBag(pid, clean);
      socket.emit('profile', publicProfile(pid));
      const inRoom = ref && rooms.get(ref.code)?.players.find(x => x.pid === pid);
      if (inRoom) inRoom.bag = clean;
    }

    const room = ref ? rooms.get(ref.code) : null;
    if (!room) return;                       // the colour needs a room
    const p = room.players.find(x => x.pid === ref.pid); if (!p) return;

    const before = p.color + '|' + JSON.stringify(p.bag);
    if (typeof color === 'string') {
      const wanted = BALL_COLORS.find(c => c.hex === color);
      // first come first served — two identical balls on one hole is confusing
      const taken = room.players.some(o => o.pid !== p.pid && o.color === color);
      if (wanted && !taken) {
        if (wanted.lockRating && !colorAllowed(ref.pid, wanted.hex)) {
          socket.emit('toast', { msg: `${wanted.name} unlocks at rating ${wanted.lockRating} — you are ${Math.round(getProfile(ref.pid).rating)}.`, kind: 'warn' });
        } else {
        p.color = wanted.hex; p.colorName = wanted.name;
        setBallColor(ref.pid, wanted.hex, wanted.name);
      }
      }
    }


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
            // body roll, so everyone sees the same cart on its side
            t: clamp(Number(c.t) || 0, -1.6, 1.6),
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
    /* THE WARDROBE IS OUTSIDE ANY ROOM. This used to bail when the sender
       was not in one, which is where every player who has ever opened the
       wardrobe from the front page is — so dressing your golfer there sent
       a message the server dropped on the floor, and the changes were gone
       the moment the page reloaded. The clubhouse and the profile socket
       already worked this way; this one did not, and that is the whole of
       "nothing saves".

       So identity comes from the socket first and the room second, and the
       room is used only for the parts that need one. */
    const ref = sockets.get(socket.id);
    const pid = ref?.pid || socket.data.pid;
    if (!pid) return;
    const room = ref ? rooms.get(ref.code) : null;
    const p = room?.players.find(x => x.pid === pid) || null;
    /* Cosmetics ride in the look, so this is the gate on them. A client can
       ask for anything; what comes out is clamped to the level the SERVER
       has on record. Without this every decal, trail and title in the game
       is one hand-written socket message away from free, and a hundred
       levels of rewards mean nothing. */
    const prof = getProfile(pid);
    const level = levelFromXp(prof?.xp || 0).level;
    const seat = p && room ? room.players.indexOf(p) : 0;
    const next = looksEarnedAt(d?.look, seat, level, prof?.caseUnlocks || []);

    // Not in a room: save it and stop. There is nobody to broadcast to.
    if (!p) { setLook(pid, next); return; }
    // only broadcast a real change, and coalesce bursts (see castSoon)
    if (JSON.stringify(next) === JSON.stringify(p.look)) { setLook(pid, next); return; }
    p.look = next;
    /* AND SAVE IT. The clamped version, not what the client asked for — so
       what is written to the profile is what the server agreed to, and a
       piece that gets un-earned somehow cannot be restored past the gate on
       the next join. */
    setLook(pid, next);
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
    // The clubhouse is outside any room, so this is where an offline-capable
    // name has to be captured too — a friends list that only learns names
    // from rooms shows "Golfer" for everybody who has not played today.
    if (d?.name) {
      const n = cleanName(d.name);
      rememberName(pid, n);
      /* Grandfathering. Anybody already playing under a name keeps it,
         registered but not enforced against the others who share it — see
         names.js. Only a NEW claim has to be unique. */
      adoptName(pid, n);
    }
    // A player we have never seen may be a genuinely new player, or the same
    // player after this host wiped its disk on a deploy.  seedProfile tells
    // those apart safely: it only ever fills a blank, and only within clamps.
    if (d?.restore) {
      try { seedProfile(pid, d.restore); } catch { /* malformed: ignore */ }
    }
    /* "Sam is back after a fortnight" — the one entry in the feed that is
       about somebody arriving rather than about a score, and the reason to
       say hello rather than just to notice they are online. It was in the
       kinds table from the start and nothing ever pushed it, which made the
       table a list of what the feed COULD say rather than what it does. */
    greetReturner(pid);
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

    /* WHICH move. The client says what it wants; the server decides whether
       they have it, exactly like every other unlock. A melee is picked from
       the same table both sides read, so the reach, the cooldown and the
       power cannot drift apart. */
    const lvl = levelFromXp(getProfile(ref.pid)?.xp || 0).level;
    const asked = meleeById(String(d?.move || 'barge'));
    const move = asked.at <= lvl ? asked : meleeById('barge');

    const now = Date.now();
    /* Per-move, because the cooldown IS the balance: a slap you can throw
       four times a second and a boot you get once a second are the same
       button doing genuinely different things. */
    if (now - (me.shoveAt || 0) < move.cool) return;

    const dx = (target.ax ?? target.x) - (me.ax ?? me.x);
    const dz = (target.az ?? target.z) - (me.az ?? me.z);
    const dist = Math.hypot(dx, dz);
    if (dist > move.reach || dist < 1e-3) return;       // out of reach

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
    let power = (3.4 + speed * 1.15) * move.power;   // and what the move is worth

    /* Shoving a CART. It weighs a great deal more than a golfer, so the same
       barge moves it far less — but it does move, which is the point: a cart
       parked across your line is now something you can lean on rather than
       something you have to walk around. */
    const cart = inCart(target);
    if (cart) power *= 0.28;

    io.to(room.code).emit('player:shoved', {
      from: me.pid, pid: target.pid, cart: !!cart, move: move.id, spin: move.spin,
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

  /* THE ROOM BROWSER.
     -------------------------------------------------------------------
     "Play with friends" needed a code somebody gave you, so a player with
     nobody to play with had exactly one option: play alone. Every open room
     in the game is listed here with what it is and who is in it, which is
     the difference between a multiplayer game and a single-player game that
     happens to have sockets. */
  socket.on('world:ranking', (d, ack) => {
    if (typeof ack !== 'function') return;
    const ref = sockets.get(socket.id);
    const pid = ref?.pid || socket.data?.pid || null;
    ack({ top: worldRanking(50), me: pid ? worldPlace(pid) : null });
  });

  /* Every ladder in one call. Four boards plus your own place on two of
     them is one round trip; asking for them separately would be four, and
     the screen shows them as tabs the player flips between — so they all
     have to be there before the first tab is drawn or every flip is a wait. */
  socket.on('world:boards', (d, ack) => {
    if (typeof ack !== 'function') return;
    const ref = sockets.get(socket.id);
    const pid = ref?.pid || socket.data?.pid || null;
    const courseId = COURSE_ORDER.includes(d?.course) ? d.course : COURSE_ORDER[0];
    /* Who on these boards is a friend. Sent as a SET OF IDS rather than a
       flag on every row, because the same player appears on up to five
       boards and marking each row is five copies of one fact — and because
       a friends-only view needs the set anyway. */
    const mine = pid ? new Set(friendsOf(pid)) : new Set();
    const mark = rows => rows.map(r => (mine.has(r.pid) ? { ...r, friend: true } : r));

    ack({
      handicap: mark(handicapRanking(100)),
      level: mark(levelRanking(100)),
      weekly: mark(weeklyGainers(50)),
      season: mark(seasonBoard(100)),
      course: { id: courseId, rows: mark(courseBoard(courseId, 50)),
                ...courseRatings(courseId) },
      ratings: Object.fromEntries(COURSE_ORDER.map(id => [id, courseRatings(id)])),
      /* Friends who did not make the top hundred still belong on the
         friends-only view, so their rows are computed separately rather than
         filtered out of a list they were never in. */
      friendRows: pid ? friendBoardRows(pid) : [],
      me: pid ? { world: worldPlace(pid), handicap: handicapPlace(pid) } : null
    });
  });

  /* ═══════════════════════════════════════════════════ FRIENDS ═══════
     One handler, an action name and a payload, because eleven separate
     socket events for eleven verbs on the same graph is eleven places to
     forget the pid check. Every branch below re-reads the pid from the
     socket rather than trusting anything the client sent — the client
     supplies WHO IT WANTS TO ACT ON, never who it is. */
  /* What your friends have been up to. Read-time filtered by friendship —
     see activity.js for why that check cannot live at write time. */
  socket.on('feed:list', (d, ack) => {
    if (typeof ack !== 'function') return;
    const pid = sockets.get(socket.id)?.pid || cleanPid(d?.pid);
    if (!pid) return ack({ items: [] });
    ack({ items: Activity.feedFor(pid, { limit: 30, nameOf }) });
  });

  /* Your record against everybody you have finished a round with. */
  socket.on('h2h:list', (d, ack) => {
    if (typeof ack !== 'function') return;
    const pid = sockets.get(socket.id)?.pid || cleanPid(d?.pid);
    if (!pid) return ack({ rows: [] });
    const rows = Activity.headToHeadFor(getProfile(pid), 20)
      .map(r => ({ ...r, name: nameOf(r.pid) || r.name }));
    ack({ rows });
  });

  socket.on('friends:do', (d, ack) => {
    if (typeof ack !== 'function') return;
    const pid = sockets.get(socket.id)?.pid || socket.data?.pid || null;
    if (!pid) return ack({ error: 'Not connected.' });
    const act = String(d?.act || '');
    const other = typeof d?.pid === 'string' ? d.pid.slice(0, 64) : null;

    /* Redeeming a code is the one action an attacker would want to run in a
       loop, so it is the one that is limited. Eight characters of a
       31-letter alphabet is 850 billion; at six tries a minute that is not a
       search anybody finishes, and a real player redeeming one code has
       never needed a seventh attempt. */
    if (act === 'request') {
      const now = Date.now();
      const gate = socket.data._fr || (socket.data._fr = []);
      while (gate.length && now - gate[0] > 60000) gate.shift();
      if (gate.length >= 6) return ack({ error: 'Too many tries. Wait a minute.' });
      gate.push(now);
      const r = requestFriend(pid, d?.code, d?.note);
      if (r.ok && r.to) pushFriends(r.to);
      return ack({ ...r, state: decorate(pid), people: friendPeople(pid) });
    }

    let r = { ok: true };
    if (act === 'accept') { r = acceptFriend(pid, other); if (r.ok) pushFriends(other); }
    else if (act === 'decline') r = declineFriend(pid, other, !!d?.block);
    else if (act === 'remove') { r = removeFriend(pid, other); pushFriends(other); }
    else if (act === 'block') { r = blockPlayer(pid, other); pushFriends(other); }
    else if (act === 'unblock') r = unblockPlayer(pid, other);
    else if (act === 'favourite') r = toggleFavourite(pid, other);
    else if (act !== 'state') return ack({ error: 'Unknown action.' });

    ack({ ...r, state: decorate(pid), people: friendPeople(pid) });
  });

  /* ═══════════════════════════════════════════════════════ NAMES ═══════
     Checking is free and unlimited — it runs as the player types. Claiming
     is the one that costs, and the cost is decided by the registry rather
     than by anything the client sends. */
  socket.on('name:check', (d, ack) => {
    if (typeof ack !== 'function') return;
    const pid = sockets.get(socket.id)?.pid || socket.data?.pid || null;
    ack({ ...checkName(d?.name, pid), quote: pid ? renameQuote(pid) : null });
  });

  socket.on('name:claim', (d, ack) => {
    if (typeof ack !== 'function') return;
    const pid = sockets.get(socket.id)?.pid || socket.data?.pid || null;
    if (!pid) return ack({ error: 'Not connected.' });
    /* The charge is a callback so names.js never has to know what a coin is,
       and so the deduction and the claim cannot end up half-applied: if the
       player cannot pay, the name is never taken. */
    const res = claimName(pid, d?.name, cost => {
      const prof = getProfile(pid);
      if ((prof.coins || 0) < cost) return false;
      prof.coins -= cost;
      return true;
    });
    if (res.ok) {
      rememberName(pid, res.name);
      // and everyone in the room they are standing in sees it change
      const ref = sockets.get(socket.id);
      const room = ref?.code ? rooms.get(ref.code) : null;
      if (room) {
        const pl = room.players.find(x => x.pid === pid);
        if (pl) { pl.name = res.name; broadcastState(room); }
      }
      socket.emit('profile', publicProfile(pid));
    }
    ack({ ...res, quote: renameQuote(pid), history: nameHistory(pid) });
  });

  /* ═══════════════════════════════════════════════ INVITATIONS ═══════
     An invite is a room code plus a note, held for the invitee until they
     answer or it expires. Not a persistent object in a store: an invitation
     to a round that has already teed off is not an invitation, so they live
     in memory and die with the room they point at. */
  socket.on('invite:send', (d, ack) => {
    if (typeof ack !== 'function') return;
    const pid = sockets.get(socket.id)?.pid || socket.data?.pid || null;
    if (!pid) return ack({ error: 'Not connected.' });
    const ref = sockets.get(socket.id);
    const room = ref?.code ? rooms.get(ref.code) : null;
    if (!room) return ack({ error: 'Host or join a round first, then invite.' });
    if (room.state !== 'lobby') return ack({ error: 'That round has already started.' });

    const to = Array.isArray(d?.pids) ? d.pids.slice(0, 3) : [];
    const note = String(d?.note || '').slice(0, 50);
    const sent = [];
    for (const other of to) {
      /* Only friends, and only friends who have not blocked you. An invite
         system open to strangers is a spam system with a golf theme. */
      if (!areFriends(pid, other) || hasBlocked(other, pid)) continue;
      const inv = {
        id: `${room.code}:${pid}:${Date.now()}`,
        from: pid, fromName: nameOf(pid),
        room: room.code, courseId: room.courseId,
        courseName: courseMeta(room.courseId)?.name || room.courseId,
        format: room.format || 'stroke',
        seats: `${room.players.length}/${MAX_PLAYERS}`,
        note, at: Date.now(), expires: Date.now() + INVITE_TTL_MS
      };
      const list = invites.get(other) || [];
      // one live invite per inviter: three from the same person is spam
      const kept = list.filter(x => x.from !== pid);
      kept.push(inv);
      invites.set(other, kept.slice(-8));
      sent.push(nameOf(other));
      pushInvites(other);
    }
    ack({ ok: true, sent });
  });

  socket.on('invite:list', (d, ack) => {
    if (typeof ack !== 'function') return;
    const pid = sockets.get(socket.id)?.pid || socket.data?.pid || null;
    ack({ invites: pid ? liveInvites(pid) : [] });
  });

  socket.on('invite:answer', (d, ack) => {
    if (typeof ack !== 'function') return;
    const pid = sockets.get(socket.id)?.pid || socket.data?.pid || null;
    if (!pid) return ack({ error: 'Not connected.' });
    const list = invites.get(pid) || [];
    const inv = list.find(x => x.id === d?.id);
    invites.set(pid, list.filter(x => x.id !== d?.id));
    pushInvites(pid);
    if (!inv) return ack({ error: 'That invitation has gone.' });
    if (!d?.accept) {
      // the inviter is told, without being told why
      for (const [sid, r] of sockets) {
        if (r.pid === inv.from) io.to(sid).emit('toast',
          { msg: `${nameOf(pid)} declined your invitation.`, kind: 'info' });
      }
      return ack({ ok: true, declined: true });
    }
    const room = rooms.get(inv.room);
    if (!room) return ack({ error: 'That round is no longer there.' });
    if (room.state !== 'lobby') return ack({ error: 'That round has already started.' });
    ack({ ok: true, room: inv.room });
  });

  /* The club finish. Picked by the client, decided here — a finish gated on
     a hole in one is worth nothing if the client can just claim it. */
  socket.on('club:skin', (d, ack) => {
    const pid = sockets.get(socket.id)?.pid || socket.data?.pid;
    if (!pid) return typeof ack === 'function' && ack({ error: 'Not connected.' });
    const got = setClubSkin(pid, d?.id);
    socket.emit('profile', publicProfile(pid));
    if (typeof ack === 'function') ack({ ok: true, skin: got });
  });

  socket.on('rooms:open', (d, ack) => {
    if (typeof ack !== 'function') return;
    const out = [];
    for (const room of rooms.values()) {
      if (room.privacy === 'private') continue;   // invite link only — never listed
      const live = room.players.filter(p => p.connected);
      if (!live.length) continue;
      const bio = biomeFor(room.courseId);
      const f = formatById(room.format);
      // A room mid-round can still be joined — you watch until the next hole
      // — so it is listed, marked, and sorted below the ones about to start.
      out.push({
        code: room.code,
        courseId: room.courseId,
        course: bio?.name || room.courseId,
        region: bio?.continent || 'other',
        where: bio?.region || '',
        format: room.format,
        formatName: f.name,
        players: live.length,
        max: f.teams ? f.teams * f.per : MAX_PLAYERS,
        state: room.state,
        starting: room.state === 'lobby',
        hole: room.state === 'playing' ? room.holeIndex + 1 : 0,
        // the strongest golfer in there, so you can see what you are joining
        topRating: Math.max(0, ...live.map(p => Math.round(publicProfile(p.pid)?.rating || 0))),
        names: live.slice(0, 8).map(p => p.name)
      });
    }
    out.sort((a, b) =>
      (b.starting - a.starting) || (b.players - a.players) || a.code.localeCompare(b.code));
    ack({ rooms: out.slice(0, 40), total: rooms.size });
  });

  /**
   * QUICK MATCH — the button for somebody who just wants to play with people.
   *
   * Finds the fullest room that matches what they asked for and still has a
   * seat, and makes one if there is none. Fullest rather than emptiest on
   * purpose: joining the room with three people in it starts a game, and
   * joining the one with nobody in it starts another empty room.
   */
  socket.on('rooms:quick', (d, ack) => {
    if (typeof ack !== 'function') return;
    const wantFormat = formatById(d?.format).id;
    const wantRegion = typeof d?.region === 'string' ? d.region : 'any';
    let best = null;
    for (const room of rooms.values()) {
      if (room.state !== 'lobby') continue;
      if (room.privacy === 'private') continue;    // never auto-join a private lobby
      if (room.format !== wantFormat) continue;
      const bio = biomeFor(room.courseId);
      if (wantRegion !== 'any' && bio?.continent !== wantRegion) continue;
      const f = formatById(room.format);
      const cap = f.teams ? f.teams * f.per : MAX_PLAYERS;
      const live = room.players.filter(p => p.connected).length;
      if (live >= cap) continue;
      if (!best || live > best.live) best = { room, live };
    }
    if (best) return ack({ ok: true, code: best.room.code, joined: true });

    /* Nothing to join, so open one — in the region they asked for, or any
       course if they did not care. Returning "no rooms" would be a dead end
       on the one button that exists to avoid dead ends. */
    const pool = wantRegion === 'any'
      ? COURSE_ORDER
      : COURSE_ORDER.filter(id => biomeFor(id)?.continent === wantRegion);
    const courseId = pool[Math.floor(Math.random() * pool.length)] || COURSE_ORDER[0];
    ack({ ok: true, courseId, format: wantFormat, create: true });
  });

  socket.on('presence:who', (d, ack) => {
    if (typeof ack !== 'function') return;
    const out = [];
    for (const room of rooms.values()) {
      if (room.privacy === 'private') continue;   // a private host isn't found this way either
      const h = room.state === 'playing' || room.state === 'holeover'
        ? course(room)?.holes?.[room.holeIndex] : null;
      for (const p of room.players) {
        if (!p.connected) continue;
        /* Who they ARE, not just where they are. The panel listed names and
           a hole number, which tells you nothing about whether you want to
           play with them — a rating and a best round is the whole reason to
           look at a list of strangers. Read from the profile store, so it is
           the server's number and not a claim from their client. */
        const prof = publicProfile(p.pid);
        out.push({
          pid: p.pid, name: p.name, code: room.code,
          courseId: room.courseId,
          rating: prof ? Math.round(prof.rating) : null,
          level: prof ? prof.level : null,
          best: prof ? prof.best : null,
          rounds: prof ? prof.rounds : 0,
          badge: badgesFor(p.pid),
          doing: room.state === 'lobby' ? 'in a lobby'
            : room.state === 'results' ? 'finishing a round'
              : h ? `on the ${h.number}${['th','st','nd','rd'][h.number % 10 > 3 ? 0 : h.number % 10] || 'th'}`
                : 'on the course',
          joinable: room.state === 'lobby' &&
            room.players.filter(x => x.connected).length < MAX_PLAYERS,
          /* A room mid-round cannot be JOINED but can be WATCHED — the
             server already seats a late arrival as a spectator, and has
             since rooms existed. What was missing was any way to find out
             that was possible: the panel showed "on the 4th" and no button,
             so watching a friend play was a feature nobody could reach. */
          watchable: (room.state === 'playing' || room.state === 'holeover') &&
            room.players.length < MAX_PLAYERS * 3
        });
      }
    }
    ack({ online: out.slice(0, 60), rooms: rooms.size });
  });

  socket.on('records:all', (d, ack) => {
    /* A client hands back the copy it kept, and on a cold-booted host that
       is the only surviving copy of anything set since the last deploy.
       Ignored entirely once the board has entries or the window has closed —
       see offerRecords for why it needs two agreeing clients. */
    if (d && d.mine && restoreOpen()) {
      const pid = socket.data?.pid || socket.id;
      try { offerRecords(pid, d.mine); } catch (e) { console.error('  records: offer failed —', e.message); }
    }
    if (typeof ack === 'function') ack({ records: allRecords() });
  });

  /* Reachable from the clubhouse, outside any room — same reasoning as
     records:all: a bug or an idea does not wait for a lobby to exist. */
  socket.on('feedback:submit', (d, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const pid = socket.data.pid;
    if (!pid) return reply({ ok: false, error: 'Still connecting — try again in a moment.' });
    reply(submitFeedback(pid, d?.category, d?.body, d?.courseId, d?.hole, d?.context));
  });

  socket.on('feedback:list', (d, ack) => {
    if (typeof ack !== 'function') return;
    ack({ items: listFeedback({ sort: d?.sort === 'votes' ? 'votes' : 'new' }) });
  });

  socket.on('feedback:vote', (d, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const pid = socket.data.pid;
    if (!pid) return reply({ ok: false });
    reply(voteFeedback(pid, d?.id));
  });

  /* The target's NAME is looked up from the room rather than trusted from
     the reporter's client — the one thing worse than an unmoderated report
     board would be one where the label on it could be forged too. */
  socket.on('player:report', (d, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const pid = socket.data.pid;
    if (!pid) return reply({ ok: false, error: 'Still connecting — try again in a moment.' });
    const ref = sockets.get(socket.id);
    const room = ref && rooms.get(ref.code);
    const target = room?.players.find(p => p.pid === d?.targetPid);
    reply(submitReport(pid, d?.targetPid, target?.name, d?.reason, ref?.code, d?.context));
  });

  /* §8.1 — a player can always be removed, but never unilaterally except by
     the host. In a private lobby that authority is absolute and immediate:
     it's the host's link, the host's guest list. In a public one — where
     nobody chose to be in the room with anybody else — the host still acts
     immediately, but so can the room itself, by vote: 60% of everyone
     present other than the target, at least two of them, inside a 45s
     window that resets if the vote goes stale. The reason travels no
     further than this server's own log — there is no moderator role yet to
     read a stored one, and a public "why you were kicked" board is just a
     second harassment channel with extra steps. */
  socket.on('player:kick', (d, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const ref = sockets.get(socket.id);
    if (!ref) return reply({ ok: false, error: 'Not in a room.' });
    const room = rooms.get(ref.code);
    if (!room) return reply({ ok: false, error: 'Room is gone.' });
    const targetPid = cleanPid(d?.targetPid);
    if (!targetPid || targetPid === ref.pid) return reply({ ok: false, error: 'Pick somebody else.' });
    const target = room.players.find(p => p.pid === targetPid);
    if (!target) return reply({ ok: false, error: 'They already left.' });
    const reason = clean(String(d?.reason || '')).slice(0, 200) || '(no reason given)';

    if (ref.pid === room.hostPid) {
      console.log(`  kick: host removed ${targetPid} from ${room.code} — ${reason}`);
      toast(room, `${target.name} was removed by the host.`, 'warn');
      removePlayer(room, targetPid, 'Removed by the host.');
      broadcastState(room);
      return reply({ ok: true, kicked: true });
    }

    if (room.privacy !== 'public') {
      return reply({ ok: false, error: 'Only the host can remove players in a private lobby.' });
    }
    const others = room.players.filter(p => p.connected && p.pid !== targetPid);
    if (others.length < 2) {
      return reply({ ok: false, error: 'Not enough other players for a vote.' });
    }
    const cdKey = ref.pid + '|' + targetPid;
    room.kickCooldowns ??= new Map();
    const lastVote = room.kickCooldowns.get(cdKey) || 0;
    if (Date.now() - lastVote < KICK_VOTE_COOLDOWN_MS) {
      return reply({ ok: false, error: 'You already voted on this — give it a few minutes.' });
    }
    room.kickCooldowns.set(cdKey, Date.now());

    room.kickVotes ??= new Map();
    let v = room.kickVotes.get(targetPid);
    if (!v || Date.now() - v.startedAt > KICK_VOTE_WINDOW_MS) {
      v = { voters: new Set(), startedAt: Date.now() };
      room.kickVotes.set(targetPid, v);
    }
    v.voters.add(ref.pid);
    const threshold = Math.max(2, Math.ceil(others.length * 0.6));

    if (v.voters.size >= threshold) {
      room.kickVotes.delete(targetPid);
      console.log(`  kick: vote removed ${targetPid} from ${room.code} — ${reason}`);
      toast(room, `${target.name} was voted out.`, 'warn');
      removePlayer(room, targetPid, 'Voted out by the room.');
      broadcastState(room);
      return reply({ ok: true, kicked: true });
    }
    toast(room, `Vote to remove ${target.name}: ${v.voters.size}/${threshold}`, 'warn');
    return reply({ ok: true, kicked: false, votes: v.voters.size, needed: threshold });
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

  /* §7.1/§6 — outside any room, same as the shop: the daily-rewards panel
     and the case inventory both live in the clubhouse/front page, so
     identity comes from the socket, never room membership. */
  socket.on('login:claim', (d, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const pid = sockets.get(socket.id)?.pid || socket.data.pid;
    if (!pid) return reply({ ok: false, error: 'Still connecting — try again in a second.' });
    const result = claimLogin(pid);
    if (result.ok) socket.emit('profile', publicProfile(pid));
    reply(result);
  });

  socket.on('case:open', (d, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const pid = sockets.get(socket.id)?.pid || socket.data.pid;
    if (!pid) return reply({ ok: false, error: 'Still connecting — try again in a second.' });
    const result = openCase(pid);
    if (result.ok) socket.emit('profile', publicProfile(pid));
    reply(result);
  });

  socket.on('case:buy', (d, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const pid = sockets.get(socket.id)?.pid || socket.data.pid;
    if (!pid) return reply({ ok: false, error: 'Still connecting — try again in a second.' });
    const result = buyCase(pid);
    if (result.ok) socket.emit('profile', publicProfile(pid));
    reply(result);
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

    let capped = false, conceded = false;
    if (result.holed) p.finished = true;
    else if (p.strokes >= h.maxStrokes) { p.strokes = h.maxStrokes; p.finished = true; capped = true; }
    else {
      /* THE GIMME. Inside this range the putt is conceded and counted — the
         "that's good, pick it up" of every friendly round. It costs you the
         stroke either way, so this is not a shortcut; it saves you tapping
         in from ten inches, which is not golf, it is admin.

         Ranged by difficulty and zero on Tournament, where you hole
         everything out. Decided by the SERVER off its own result, because a
         client that could concede its own putts could concede them from the
         fringe. */
      const gim = difficultyById(difficultyOf(p.pid)).aids.gimme;
      /* ONLY A PUTT CAN BE CONCEDED, and leaving that out was a genuinely
         bad bug. Without `fromGreen` this fired on ANY shot that finished
         within the gimme radius — so a tee shot on a par 3 that pulled up
         two feet from the cup was "conceded", picked up a stroke, and ended
         the hole. The player watched the ball stop short of the hole and
         the game said it was in, for a 2.

         Which also means a genuine hole in one was impossible to record on
         any hole where the ball came to rest rather than dropping: the ace
         became a 2, and a 2 on a par 3 is a birdie. Both of the things that
         looked like separate faults were this one line.

         A gimme is something the other players give you when it is your
         turn to PUTT. It is never given on a shot from the tee, and the tap
         you are being spared has to be a tap you were actually facing. */
      /* NEVER IN A SCRAMBLE. A side plays one ball, so "your turn to putt"
         is not a thing that happens to an individual — conceding one
         player's putt would end the hole for the whole side on a ball the
         others had not agreed to, and the scramble gather is built around
         everybody playing the same shot count. In a format where the team
         shares the ball, the team holes it out. */
      const scramble = isScramble(room.format);
      if (gim > 0 && !scramble && fromGreen && result.lie === 'green') {
        const cup = h.cup || h.pin;
        if (Math.hypot(result.x - cup.x, result.z - cup.z) <= gim) {
          p.strokes++;                       // the tap-in you were given
          p.finished = true;
          conceded = true;
        }
      }
    }

    if (p.finished) p.scores[room.holeIndex] = p.strokes;

    room.seq++;
    // Clients replay this exact shot; the outcome rides along so they can snap
    // to it if their animation ever drifts.
    io.to(room.code).emit('game:shot', {
      seq: room.seq, pid: p.pid, shot,
      result: {
        x: result.x, z: result.z, holed: result.holed, penalty: result.penalty,
        reason: result.reason, lie: result.lie, carry: result.carry,
        total: result.total, apex: result.apex, capped, conceded,
        strokes: p.strokes, splash: result.splash || null
      }
    });

    /* SCRAMBLE: the team plays the best ball.
       ---------------------------------------------------------------------
       Everything above this line is ordinary stroke play and stays that way —
       the shot was real, the physics ruled on it, the penalties and the
       stroke cap applied. All that happens here is that once every member of
       a side has played the same number of shots, they all move onto whichever
       of those balls finished nearest the hole.

       Deliberately after the game:shot broadcast, so every client has already
       watched the shot land before anybody is teleported. Gathering first
       would snap the ball away mid-flight. */
    if (isScramble(room.format) && Number.isInteger(p.team)) {
      const lvl = teamLevel(room, p.team);
      if (lvl !== null) {
        /* Somebody on the side holed out: the hole is over for all of them,
           at the score of whoever got it in. The rest do not keep playing a
           ball that is already in the cup. */
        /* `conceded` counts as holed HERE, and leaving it out broke every
           scramble. A given putt finishes that player without setting
           `result.holed`, so the side took the else branch and gathered
           onto a ball that was, for all practical purposes, already in the
           cup — with one member marked finished and the rest still to play,
           which is a state the turn order has no answer for.

           A conceded putt IS the hole being over. The only difference from
           holing out is that nobody had to tap it. */
        if (result.holed || conceded) {
          finishTeam(room, p.team, p.strokes, room.holeIndex);
        } else {
          const ball = bestBall(room, p.team, h.pin);
          if (ball) {
            gatherTeam(room, p.team, ball);
            io.to(room.code).emit('scramble:gather', {
              team: p.team, pid: ball.pid,
              x: ball.x, z: ball.z, lie: ball.lie,
              yards: Math.round(ball.dist / 0.9144), strokes: lvl
            });
          }
        }
      }
    }

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

  socket.on('disconnect', reason => {
    /* §0.5's diagnostic question is literally "does it fail immediately or
       drop after working for a bit" — the duration answers that on sight,
       and the reason string (Socket.IO's own: 'ping timeout', 'transport
       close', 'transport error', 'io server disconnect', ...) tells apart
       an idle-timeout proxy from a genuinely dead connection. Console
       rather than a store: this is for reading server logs by hand while
       chasing a specific complaint, not a metrics pipeline (that's §0.3). */
    const heldFor = Date.now() - (socket.data.connectedAt || Date.now());
    console.log(`  disconnect: ${reason} · held ${(heldFor / 1000).toFixed(1)}s · ${socket.id}`);
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

/**
 * AFK sweep. A connected player who is simply quiet costs nobody anything
 * — most of a round is watching somebody else play. The actual failure
 * mode is a player whose TURN it is going silent, because that stalls
 * every other player in the room with them. So this only ever acts on
 * whoever currently holds the turn, checked against the clock that
 * pickNextToPlay resets the moment a turn actually starts.
 *
 * Acts by handing them the spectator flag rather than disconnecting them
 * — the same flag a mid-round joiner gets, and `startHole` already
 * promotes any CONNECTED spectator back to play at the next hole with no
 * further code needed here. A quiet three minutes costs the rest of this
 * hole, not the round.
 *
 * Skipped entirely below two eligible players: the whole point is
 * unblocking somebody ELSE, which does not apply to a solo round — and
 * spectating the only active player would stall the hole with nobody
 * left whose turn could ever end it.
 */
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.state !== 'playing' || !room.turnPid) continue;
    const eligible = active(room).filter(p => !p.finished && p.connected);
    if (eligible.length < 2) continue;
    const p = room.players.find(x => x.pid === room.turnPid);
    if (!p || p.spectator || !p.connected || p.finished) continue;
    if (now - (p.lastActiveAt || 0) < AFK_MS) continue;

    p.spectator = true;
    toast(room, `${p.name} was away too long and is sitting out this hole.`, 'warn');
    if (everyoneDone(room)) finishHole(room);
    else pickNextToPlay(room);
    broadcastState(room);
  }
}, AFK_SWEEP_MS).unref();

/* ---------------------------------------------------------------------- boot */
httpServer.listen(PORT, HOST, () => {
  console.log('');
  // counted, not typed: this said "5 courses" while printing eight of them
  console.log('  ⛳  Golf — ' + COURSE_ORDER.length + ' courses, ' + HOLES_PER_COURSE +
    ' holes each, up to ' + MAX_PLAYERS + ' players');
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

/* ── staying awake ───────────────────────────────────────────────────────
   A free instance spins down when no HTTP request has arrived for a while,
   and takes about fifty seconds to come back. That is the single most
   expensive thing about this deployment: the first person to arrive from a
   portal after a quiet spell waits at a loading screen, and most of them
   will not.

   The usual fix is an external uptime service pinging the health endpoint.
   This does the same thing without needing an account anywhere: Render
   publishes the service's own public URL as RENDER_EXTERNAL_URL, so the
   server can keep itself in traffic.

   Deliberately conditional on that variable, so it does nothing at all on a
   laptop, in a test, or on any host that does not set it — a server that
   quietly makes network requests to itself in development is a confusing
   thing to debug. And it is a HEAD of /healthz every fourteen minutes,
   which is the cheapest request the app can serve and well inside the
   fifteen-minute idle window.

   To turn it off, unset KEEPALIVE (or set it to 0). */
const keepAliveUrl = process.env.RENDER_EXTERNAL_URL || process.env.KEEPALIVE_URL;
if (keepAliveUrl && process.env.KEEPALIVE !== '0') {
  const ping = () => {
    fetch(new URL('/healthz', keepAliveUrl), { method: 'HEAD' })
      .catch(() => { /* a missed ping is not worth a log line every 14 min */ });
  };
  setInterval(ping, 14 * 60 * 1000).unref();
  console.log(`  keep-alive: pinging ${keepAliveUrl}/healthz every 14 min`);
  console.log('              (so the first player of the day does not wait for a cold start)');
}

/* ── shutting down without losing the last few seconds ──────────────────
   This used to be `httpServer.close(() => process.exit(0))`, which throws
   away every profile change still sitting in the store's 800 ms debounce.
   A host that redeploys on every push does that several times a day, and it
   is indistinguishable from the game not saving.

   The order matters. Stop taking new connections first, tell the people
   already here what is happening so their client can say so rather than
   just dying, then write. The socket layer is closed LAST because a player
   mid-swing should get the message before the pipe goes. */
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n  ${signal} — finishing up`);

  httpServer.close();
  try { io.emit('toast', { msg: 'Server restarting — back in a moment.', kind: 'warn' }); }
  catch { /* nobody connected */ }

  /* Bounded, because the platform sends SIGKILL a few seconds later and a
     hung database call must not eat the whole window: better a partial save
     than none. */
  try {
    await Promise.race([
      flushProfiles(),
      new Promise(r => setTimeout(r, 4000))
    ]);
    console.log('  profiles written');
  } catch (e) {
    console.error('  store: final save failed —', e?.message || e);
  }

  try { io.close(); } catch { /* already down */ }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// The last line of defence, never the first: every handler above normalises
// its own input, but no single bug should ever take down every room on the
// server.  Log it loudly and keep serving.
process.on('uncaughtException', err => {
  console.error('  UNCAUGHT —', err?.stack || err);
});
process.on('unhandledRejection', err => {
  console.error('  UNHANDLED REJECTION —', err?.stack || err);
});
