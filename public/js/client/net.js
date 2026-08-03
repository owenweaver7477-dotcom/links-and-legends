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
    if (Net.code && Net.lastName) {
      Net.socket?.emit('room:join', { code: Net.code, name: Net.lastName, pid: Net.pid }, res => {
        if (res?.ok) fire('state', res.state);
      });
    }
  });
  Net.socket.on('disconnect', () => fire('disconnect'));
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
  Net.socket.on('profile', d => fire('profile', d));
  Net.socket.on('kicked', d => fire('kicked', d));
};

Net.create = (name, courseId, cb) => {
  Net.lastName = name;
  Net.socket?.emit('room:create', { name, courseId, pid: Net.pid }, res => {
    if (res?.ok) Net.code = res.code;
    cb(res || { ok: false, error: 'No response from the server.' });
  });
};

Net.join = (code, name, cb) => {
  Net.lastName = name;
  Net.socket?.emit('room:join', { code, name, pid: Net.pid }, res => {
    if (res?.ok) Net.code = res.code;
    cb(res || { ok: false, error: 'No response from the server.' });
  });
};

Net.pickCourse = courseId => Net.socket?.emit('room:course', { courseId });
Net.pickTees = teeSet => Net.socket?.emit('room:tees', { teeSet });
Net.prefs = p => Net.socket?.emit('player:prefs', p);
Net.setLook = look => Net.socket?.emit('player:look', { look });
Net.move = (x, z, rot, moving, cart) => Net.socket?.emit('player:move', { x, z, rot, moving, cart });
Net.hail = () => Net.socket?.emit('cart:hail');
Net.emote = id => Net.socket?.emit('player:emote', { id });
/** The global record board. Answers with {} if we are not connected yet. */
Net.records = cb => {
  if (!Net.socket) return cb({});
  Net.socket.emit('records:all', null, res => cb(res?.records || {}));
};
/** Who is online right now.  Polled from the menu; never while playing. */
Net.presence = cb => {
  if (!Net.socket) return cb([]);
  Net.socket.emit('presence:who', null, res => cb(res?.online || []));
};
Net.buy = item => Net.socket?.emit('shop:buy', { item });
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
