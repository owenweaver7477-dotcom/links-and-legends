/* =========================================================================
   net.js — Socket.IO plumbing.  The server decides everything; this just
   carries messages and keeps a stable identity across refreshes.
   ========================================================================= */

import { storeGet, storeSet } from './crazygames.js';

export const Net = { socket: null, pid: null, code: null, lastName: null, h: {} };

function loadPid() {
  /* Identity goes through the portal's Data module when there is one.
     localStorage alone is not enough on a game portal: the page runs in a
     partitioned third-party iframe, so the key can be dropped between visits
     and every session looks like a brand-new player with no career.  The
     Data module survives that, and for a signed-in CrazyGames user it
     follows them to another device.  storeGet/storeSet fall back to
     localStorage everywhere else, so this one path covers every host. */
  let pid = storeGet('lg_pid');
  if (!pid || !/^[A-Za-z0-9_-]{8,40}$/.test(pid)) {
    pid = 'p' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-6);
    storeSet('lg_pid', pid);
  }
  return pid;
}

Net.on = (evt, fn) => { Net.h[evt] = fn; };
const fire = (evt, d) => Net.h[evt]?.(d);

/* ═══════════════════════════════════ CONNECTION HEALTH ═══════════════════
   Socket.IO already gives every connection a heartbeat (pingInterval /
   pingTimeout on the server) and a polling fallback for a proxy that
   mangles the websocket upgrade — see §0.5 of the roadmap. What was
   missing was VISIBILITY: a player on a filtered school network has no way
   to tell a broken game apart from a dropped network, and neither did we
   — not from a feedback report alone.

   This just measures what is already happening and remembers it: transport
   in use, round-trip time, and how often — and why — the socket has gone
   down. Cheap and passive, and it turns "the game is laggy" into something
   with a shape: 40ms on websocket is a different bug than 600ms on polling
   after three reconnects. Read via Net.net; HUD listens on 'netquality'. */
Net.net = { transport: null, rtt: null, disconnects: 0, reconnects: 0, reconnectAttempts: 0, lastDisconnectReason: null,
  rttHistory: [], jitter: null, p50: null, p95: null, pingsSent: 0, pingsMissed: 0 };
const netFire = () => fire('netquality', Net.net);

/* A fresh engine.io transport is created on every (re)connect, so this is
   re-attached from the 'connect' handler rather than once — an 'upgrade'
   listener on a stale engine object would never fire again after a drop. */
function watchTransport() {
  const eng = Net.socket?.io?.engine;
  if (!eng) return;
  Net.net.transport = eng.transport?.name || null;
  netFire();
  eng.on('upgrade', t => { Net.net.transport = t.name; netFire(); });
}

/* An application-level ping on top of the transport's own heartbeat. The
   engine.io ping only proves the pipe is alive; this measures how it FEELS
   — the number that actually explains "it works but it's choppy" — and it
   rides the same rate-limit bucket as everything else at one call per 6s,
   nowhere near the limit. */
/* Rolling window for jitter/percentiles — the single latest RTT above
   answers "is it slow right now", not "is it CONSISTENT", and choppy-but-
   fast-on-average is a real, different failure mode from steadily slow.
   Capped short (20 samples = 2 minutes at this ping rate) so a bad patch
   ages out rather than dragging the average down for the rest of the
   session. */
const RTT_WINDOW = 20;
function pctile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}
function recordRtt(ms) {
  const h = Net.net.rttHistory;
  h.push(ms);
  if (h.length > RTT_WINDOW) h.shift();
  // jitter, RFC 3550-style: the running mean of the absolute change between
  // consecutive samples — a connection that alternates 40ms/400ms has the
  // same AVERAGE rtt as one holding steady at 220ms and is a completely
  // different problem to diagnose, which a bare average can't tell apart.
  if (h.length >= 2) {
    const diffs = [];
    for (let i = 1; i < h.length; i++) diffs.push(Math.abs(h[i] - h[i - 1]));
    Net.net.jitter = Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length);
  }
  const sorted = [...h].sort((a, b) => a - b);
  Net.net.p50 = pctile(sorted, 0.5);
  Net.net.p95 = pctile(sorted, 0.95);
}

let pingTimer = null;
function startPing() {
  clearInterval(pingTimer);
  pingTimer = setInterval(() => {
    if (!Net.socket?.connected) return;
    const t0 = Date.now();
    let answered = false;
    Net.net.pingsSent++;
    Net.socket.emit('net:ping', t0, () => {
      answered = true;
      Net.net.rtt = Date.now() - t0;
      recordRtt(Net.net.rtt);
      netFire();
    });
    /* A missed ping isn't "packet loss" in the way a raw UDP protocol
       would report it — this rides Socket.IO over WebSocket or polling,
       both TCP-based, so nothing is actually dropped silently the way a
       UDP datagram can be. What CAN happen, and what this counts, is the
       ack never arriving within a generous window: a stalled connection,
       a dead transport mid-upgrade, a tab thrown into the background and
       throttled. Reported as what it is (a missed heartbeat rate) rather
       than borrowing "packet loss" for a number that means something
       different on this transport. */
    setTimeout(() => {
      if (!answered && Net.socket?.connected) {
        Net.net.pingsMissed++;
        Net.net.rtt = null;
        netFire();
      }
    }, 4000);
  }, 6000);
}

/* ────────────────────────────── where the server lives ──────────────────
   This build runs in two very different places.

   Served BY the game server (localhost, or the Render deployment) the server
   is simply the page's own origin.  Uploaded to a game portal as a static
   bundle there is NO server on that origin at all — the files sit on the
   portal's CDN — so the socket has to be told, explicitly, to talk back to
   the deployment.  Getting this wrong is silent: the page loads and then
   nothing ever connects.

   Change BACKEND if the deployment moves. */
const BACKEND = 'https://links-and-legends.onrender.com';

/* Which origin actually answered.  Guessing from the hostname is not good
   enough — "localhost" might be our server or might be any static host — so
   this TRIES same-origin first and falls back to the deployment.  Whichever
   one serves the socket.io client is the one we then connect to, which means
   the same build works served by the server, uploaded to a portal, or opened
   from a plain static host, with no build-time switch. */
let resolvedOrigin = null;

/* The socket.io CLIENT is served by the game server, so on a static bundle it
   has to be fetched from the backend too — there is no /socket.io/ on a CDN.
   Loaded on demand rather than with a fixed script tag for exactly that
   reason, and awaited so `io` is guaranteed to exist before we use it. */
const loadScript = src => new Promise(resolve => {
  const el = document.createElement('script');
  el.src = src; el.async = true;
  el.onload = () => resolve(typeof window.io === 'function');
  el.onerror = () => resolve(false);
  document.head.appendChild(el);
});

let ioLoading = null;
function ensureIo() {
  if (typeof window.io === 'function') return Promise.resolve(true);
  if (ioLoading) return ioLoading;            // one attempt in flight at a time
  ioLoading = (async () => {
    // Nudge a sleeping host awake: a free-tier instance cold-starts on the
    // first request, and the script tag can give up before it is up.
    try { fetch(BACKEND + '/healthz', { mode: 'no-cors' }).catch(() => {}); } catch { /* ignore */ }
    // same origin first — that is the case when the server serves the page
    if (await loadScript('socket.io/socket.io.js')) { resolvedOrigin = ''; return true; }
    // otherwise we are a static bundle: talk back to the deployment
    if (await loadScript(BACKEND + '/socket.io/socket.io.js')) { resolvedOrigin = BACKEND; return true; }
    return false;
  })();
  /* Clear the cache on FAILURE.  Holding a resolved-false promise here would
     make every retry return that same false without touching the network, so
     the reconnect loop could never succeed — which is precisely the case that
     matters, because a sleeping free-tier host takes ~30 s to answer and the
     first attempt is EXPECTED to fail. */
  ioLoading.then(ok => { if (!ok) ioLoading = null; });
  return ioLoading;
}

Net.connect = async () => {
  Net.pid = loadPid();
  if (!(await ensureIo())) {
    fire('offline');
    return;
  }
  Net.socket = resolvedOrigin
    ? io(resolvedOrigin, { transports: ['websocket', 'polling'], reconnectionDelayMax: 4000 })
    : io({ transports: ['websocket', 'polling'], reconnectionDelayMax: 4000 });

  Net.socket.on('connect', () => {
    fire('connect');
    watchTransport();
    startPing();
    if (Net.code && Net.lastName) {
      Net.socket?.emit('room:join', { code: Net.code, name: Net.lastName, pid: Net.pid }, res => {
        if (res?.ok) fire('state', res.state);
      });
    }
  });
  Net.socket.on('disconnect', reason => {
    Net.net.disconnects++;
    Net.net.lastDisconnectReason = reason;
    Net.net.rtt = null;
    // stale samples from the connection that just died would misrepresent
    // whatever comes next as jittery when it's actually a clean reconnect
    Net.net.rttHistory = [];
    Net.net.jitter = null; Net.net.p50 = null; Net.net.p95 = null;
    netFire();
    fire('disconnect');
  });
  Net.socket.io.on('reconnect_attempt', () => { Net.net.reconnectAttempts++; netFire(); });
  Net.socket.io.on('reconnect', () => { Net.net.reconnects++; netFire(); });
  Net.socket.on('room:state', s => fire('state', s));
  Net.socket.on('players:pos', d => fire('pos', d));
  Net.socket.on('connect', () => Net.fetchProfile());
  Net.socket.on('game:started', d => fire('started', d));
  Net.socket.on('game:shot', d => fire('shot', d));
  Net.socket.on('game:hole', d => fire('hole', d));
  Net.socket.on('game:reset', d => fire('reset', d));
  Net.socket.on('toast', d => fire('toast', d));
  Net.socket.on('player:emote', d => fire('emote', d));
  Net.socket.on('levelup', d => fire('levelup', d));
  Net.socket.on('chat:msg', d => fire('chat', d));
  Net.socket.on('player:shoved', d => fire('shoved', d));
  Net.socket.on('profile', d => fire('profile', d));
  Net.socket.on('kicked', d => fire('kicked', d));
  /* Sent to EVERY connection, not just the room that set it: the record
     board is one board for the whole game, so it has to change under
     everyone the moment it changes at all. */
  Net.socket.on('records:beat', d => fire('records', d));
  Net.socket.on('scramble:gather', d => fire('gather', d));
};

/* ═══════════════════════════════════════ EVERY ASK GETS AN ANSWER ═══════
   The single worst bug this client could have, and it had it.

   `Net.socket?.emit(...)` with an ack callback does NOTHING AT ALL when the
   socket is null — the optional chain skips the call, the callback is never
   invoked, and whatever was waiting on it waits forever. And even with a
   live socket, an ack that is lost in flight never arrives either.

   The caller for Play now shows the loading screen and then waits for the
   callback. So on a dropped connection — or one slow ack — the game sat on
   "Walking to the first tee…" permanently, with every button behind it
   unreachable. "Most of the buttons don't work" is exactly what that looks
   like from the outside, and it is not a performance problem at all.

   So: nothing asks the server anything without a deadline. `ask` guarantees
   the callback runs exactly once, with an answer or with an error, whatever
   the socket is doing. */
function ask(event, payload, cb, ms = 8000) {
  let done = false;
  const settle = res => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    cb(res);
  };
  const timer = setTimeout(() => settle({
    ok: false,
    error: Net.socket?.connected
      ? 'The server did not answer. Try again.'
      : 'You are offline — reconnecting.'
  }), ms);

  if (!Net.socket) { settle({ ok: false, error: 'Not connected yet.' }); return; }
  try {
    Net.socket.emit(event, payload, res => settle(res || { ok: false, error: 'Empty reply.' }));
  } catch {
    settle({ ok: false, error: 'Could not reach the server.' });
  }
}
Net.ask = ask;

Net.create = (name, courseId, cb, format, privacy) => {
  Net.lastName = name;
  ask('room:create', { name, courseId, format, privacy, pid: Net.pid }, res => {
    if (res?.ok) Net.code = res.code;
    cb(res);
  });
};

Net.join = (code, name, cb) => {
  Net.lastName = name;
  ask('room:join', { code, name, pid: Net.pid }, res => {
    if (res?.ok) Net.code = res.code;
    cb(res);
  });
};

Net.pickCourse = courseId => Net.socket?.emit('room:course', { courseId });
Net.pickTees = teeSet => Net.socket?.emit('room:tees', { teeSet });
Net.setPrivacy = privacy => Net.socket?.emit('room:privacy', { privacy });

/* ---------------------------------------------------------- feedback --- */
Net.submitFeedback = (data, cb) => ask('feedback:submit', data, res => cb?.(res));
Net.listFeedback = (sort, cb) => ask('feedback:list', { sort }, res => cb?.(res?.items || []));
Net.voteFeedback = (id, cb) => ask('feedback:vote', { id }, res => cb?.(res));
Net.reportPlayer = (targetPid, reason, context, cb) =>
  ask('player:report', { targetPid, reason, context }, res => cb?.(res));
/* The host removes immediately; anyone else in a public room casts a vote.
   Same call either way — the server already knows which one applies, see
   §8.1 in server.js — so the client never has to guess and be wrong. */
Net.kickPlayer = (targetPid, reason, cb) =>
  ask('player:kick', { targetPid, reason }, res => cb?.(res));

/* ------------------------------------------------------ login & cases --- */
Net.claimLogin = cb => ask('login:claim', null, res => cb?.(res));
Net.openCase = cb => ask('case:open', null, res => cb?.(res));
Net.buyCase = cb => ask('case:buy', null, res => cb?.(res));
Net.openVaultCase = cb => ask('case:openVault', null, res => cb?.(res));
Net.buyVaultCase = cb => ask('case:buyVault', null, res => cb?.(res));
Net.openProCase = cb => ask('case:openPro', null, res => cb?.(res));
/** DEV-ONLY: the server refuses this outright in production. */
Net.debugLevelUp = (level, cb) => ask('debug:levelup', { level }, res => cb?.(res));
Net.debugTestCase = cb => ask('debug:testcase', null, res => cb?.(res));
Net.buyProCase = cb => ask('case:buyPro', null, res => cb?.(res));
Net.buyItem = (kind, id, cb) => ask('item:buy', { kind, id }, res => cb?.(res));
Net.sellItem = (kind, id, cb) => ask('item:sell', { kind, id }, res => cb?.(res));
Net.browseMarket = cb => ask('market:browse', null, res => cb?.(res?.listings || []));
Net.myListings = cb => ask('market:mine', null, res => cb?.(res?.listings || []));
Net.listItem = (kind, id, price, cb) => ask('market:list', { kind, id, price }, res => cb?.(res));
Net.cancelListing = (listingId, cb) => ask('market:cancel', { listingId }, res => cb?.(res));
Net.buyListing = (listingId, cb) => ask('market:buy', { listingId }, res => cb?.(res));
Net.prefs = p => Net.socket?.emit('player:prefs', p);
Net.setLook = look => Net.socket?.emit('player:look', { look });
Net.move = (x, z, rot, moving, cart) => Net.socket?.emit('player:move', { x, z, rot, moving, cart });
Net.hail = () => Net.socket?.emit('cart:hail');
Net.emote = id => Net.socket?.emit('player:emote', { id });
Net.say = text => Net.socket?.emit('chat:say', { text });
Net.shove = (pid, move) => Net.socket?.emit('player:shove', { pid, move });
Net.setShove = on => Net.socket?.emit('room:shove', { on });
Net.phrase = id => Net.socket?.emit('chat:say', { phrase: id });
/** The global record board. Answers with {} if we are not connected yet. */
/* The board, and OUR copy of it going the other way.
   A host with no persistent disk loses the board on every deploy, so the
   only surviving copy of a fresh record is the one in the players' browsers.
   Handing it back costs one small object on a call that was already being
   made; the server ignores it unless it cold-booted and two clients agree. */
const RECORD_CACHE = 'lg_records';
Net.records = cb => {
  if (!Net.socket) return cb({});
  let mine = null;
  try { mine = JSON.parse(localStorage.getItem(RECORD_CACHE) || 'null'); } catch { /* private mode */ }
  Net.socket.emit('records:all', { mine }, res => {
    const r = res?.records || {};
    // keep a copy for the next cold boot — only if it is worth keeping
    try {
      if (Object.keys(r).length) localStorage.setItem(RECORD_CACHE, JSON.stringify(r));
    } catch { /* private mode */ }
    cb(r);
  });
};
/** Every open room in the game, so a player without a code can still play. */
Net.openRooms = cb => {
  if (!Net.socket) return cb([]);
  Net.socket.emit('rooms:open', null, res => cb(res?.rooms || []));
};

/** Find a game, or be told to open one. */
Net.quickMatch = (format, region, cb) => {
  if (!Net.socket) return cb(null);
  Net.socket.emit('rooms:quick', { format, region }, res => cb(res || null));
};

/** The world ranking, and where we sit in it. */
Net.ranking = cb => ask('world:ranking', null, res => cb(res.error ? { top: [], me: null } : res));

/* ------------------------------------------------------------------ names ---
   Checking is free and runs as you type; claiming is the one that costs. */
Net.checkName = (name, cb) => ask('name:check', { name },
  res => cb?.(res.error ? { ok: false, reason: res.error } : res), 5000);
Net.claimName = (name, cb) => ask('name:claim', { name }, res => cb?.(res));

/* ------------------------------------------------------------ invitations ---
   Sent to friends, answered once, and pushed rather than polled — an invite
   that arrives thirty seconds late is an invite to a round that started. */
Net.invite = (pids, note, cb) => ask('invite:send', { pids, note }, res => cb?.(res));
Net.answerInvite = (id, accept, cb) => ask('invite:answer', { id, accept }, res => cb?.(res));
Net.invites = cb => ask('invite:list', null, res => cb?.(res.error ? { invites: [] } : res), 5000);
Net.onInvites = fn => Net.socket?.on('invite:state', fn);

/* ---------------------------------------------------------------- friends ---
   One call for eleven verbs, matching the server's single handler. The
   client never says who it IS — only who it wants to act on. */
Net.friends = (act, payload, cb) =>
  ask('friends:do', { act, ...(payload || {}) }, res => cb?.(res));
/** Pushed when somebody accepts, removes or blocks you. */
Net.onFriends = fn => Net.socket?.on('friends:state', fn);

/** Every ladder at once. One round trip, because the screen is tabs. */
Net.boards = (courseId, cb) => {
  const empty = { handicap: [], level: [], weekly: [], season: [],
                  course: { rows: [] }, ratings: {}, me: null };
  ask('world:boards', { course: courseId }, res => cb(res.error ? empty : res));
};

/** The whole player base's level spread, for "X% of players own this" reads
 *  on cosmetics — see server/profiles.js's levelHistogram(). */
Net.levelStats = cb => {
  const empty = { counts: new Array(101).fill(0), total: 0 };
  ask('profiles:levels', {}, res => cb?.(res?.error ? empty : res));
};

/** Top three by XP gained this week, for the landing page preview. */
Net.weeklyTop = cb => ask('world:weeklyTop', {}, res => cb?.(res?.error ? { top: [] } : res));

/** What your friends have been up to. */
Net.feed = cb => ask('feed:list', {}, res => cb?.(res?.items || []));

/** Your record against everybody you have finished a round with. */
Net.h2h = cb => ask('h2h:list', {}, res => cb?.(res?.rows || []));

/** Change how much the game reads for you. Server confirms via 'profile'. */
Net.setDifficulty = id => Net.socket?.emit('player:prefs', { difficulty: id });

/** Who is online right now.  Polled from the menu; never while playing. */
Net.presence = cb => {
  if (!Net.socket) return cb([]);
  Net.socket.emit('presence:who', null, res => cb(res?.online || []));
};
Net.buy = item => Net.socket?.emit('shop:buy', { item });
/** Pick a club finish. The server decides whether it is earned. */
Net.setClubSkin = (id, cb) => ask('club:skin', { id }, res => cb?.(res));
Net.start = () => Net.socket?.emit('game:start');

/* Leave the room you are in.  Dropping and remaking the socket is the honest
   way to do it: the server's disconnect path already releases the seat, hands
   the room on if you were the host, and keeps your scorecard if the round is
   live — so there is no second teardown path to get out of step. */
/** Ask the server for our career, without needing to be in a room. */
Net.restoreFrom = null;      // set by main.js: our Data-module snapshot
Net.fetchProfile = () => {
  if (!Net.socket) return;
  try {
    Net.socket?.emit('profile:me', {
      pid: Net.pid,
      // so a friend who is offline still has a name on somebody else's list
      name: Net.lastName || null,
      // Offered, never trusted: the server uses this ONLY to seed a profile
      // it has no record of, which is what happens after the host wipes its
      // disk on a deploy.  An existing career is never overwritten by it.
      restore: Net.restoreFrom?.() || null
    });
  } catch { /* not up yet */ }
};

Net.leave = () => {
  try { Net.socket?.disconnect(); } catch { /* already gone */ }
  Net.code = null;
  setTimeout(() => { try { Net.socket?.connect(); } catch { /* ignore */ } }, 120);
};
Net.next = () => Net.socket?.emit('game:next');
Net.again = () => Net.socket?.emit('game:again');
Net.lobby = () => Net.socket?.emit('room:lobby');
Net.swing = shot => Net.socket?.emit('game:swing', shot);
