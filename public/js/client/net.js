/* =========================================================================
   net.js — Socket.IO plumbing.  The server decides everything; this just
   carries messages and keeps a stable identity across refreshes.
   ========================================================================= */

export const Net = { socket: null, pid: null, code: null, lastName: null, h: {} };

function loadPid() {
  let pid = null;
  try { pid = localStorage.getItem('lg_pid'); } catch { /* private mode */ }
  if (!pid || !/^[A-Za-z0-9_-]{8,40}$/.test(pid)) {
    pid = 'p' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-6);
    try { localStorage.setItem('lg_pid', pid); } catch { /* ignore */ }
  }
  return pid;
}

Net.on = (evt, fn) => { Net.h[evt] = fn; };
const fire = (evt, d) => Net.h[evt]?.(d);

Net.connect = () => {
  Net.pid = loadPid();
  Net.socket = io({ transports: ['websocket', 'polling'], reconnectionDelayMax: 4000 });

  Net.socket.on('connect', () => {
    fire('connect');
    if (Net.code && Net.lastName) {
      Net.socket.emit('room:join', { code: Net.code, name: Net.lastName, pid: Net.pid }, res => {
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
  Net.socket.on('profile', d => fire('profile', d));
  Net.socket.on('kicked', d => fire('kicked', d));
};

Net.create = (name, courseId, cb) => {
  Net.lastName = name;
  Net.socket.emit('room:create', { name, courseId, pid: Net.pid }, res => {
    if (res?.ok) Net.code = res.code;
    cb(res || { ok: false, error: 'No response from the server.' });
  });
};

Net.join = (code, name, cb) => {
  Net.lastName = name;
  Net.socket.emit('room:join', { code, name, pid: Net.pid }, res => {
    if (res?.ok) Net.code = res.code;
    cb(res || { ok: false, error: 'No response from the server.' });
  });
};

Net.pickCourse = courseId => Net.socket.emit('room:course', { courseId });
Net.pickTees = teeSet => Net.socket.emit('room:tees', { teeSet });
Net.prefs = p => Net.socket.emit('player:prefs', p);
Net.setLook = look => Net.socket.emit('player:look', { look });
Net.move = (x, z, rot, moving, cart) => Net.socket.emit('player:move', { x, z, rot, moving, cart });
Net.hail = () => Net.socket.emit('cart:hail');
Net.buy = item => Net.socket.emit('shop:buy', { item });
Net.start = () => Net.socket.emit('game:start');

/* Leave the room you are in.  Dropping and remaking the socket is the honest
   way to do it: the server's disconnect path already releases the seat, hands
   the room on if you were the host, and keeps your scorecard if the round is
   live — so there is no second teardown path to get out of step. */
/** Ask the server for our career, without needing to be in a room. */
Net.fetchProfile = () => {
  try { Net.socket?.emit('profile:me', { pid: Net.pid }); } catch { /* not up yet */ }
};

Net.leave = () => {
  try { Net.socket?.disconnect(); } catch { /* already gone */ }
  Net.code = null;
  setTimeout(() => { try { Net.socket?.connect(); } catch { /* ignore */ } }, 120);
};
Net.next = () => Net.socket.emit('game:next');
Net.again = () => Net.socket.emit('game:again');
Net.lobby = () => Net.socket.emit('room:lobby');
Net.swing = shot => Net.socket.emit('game:swing', shot);
