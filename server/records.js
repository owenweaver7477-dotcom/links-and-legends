/* =========================================================================
   records.js — the course record board
   -------------------------------------------------------------------------
   Who holds the best round on each course, and the best score on each
   individual hole.  Two rules make this worth anything:

     1. A record can only come from a round the SERVER simulated. Nothing
        here is ever taken from a client — every stroke on this board was
        ruled on by the same physics that ruled on everyone else's, so the
        board means something.

     2. A record needs a completed round. Nine holes, played through. That
        stops someone teeing off, holing one lucky 2, and quitting to sit at
        the top of the hole board forever.

   Deliberately its own file with its own store handle rather than a corner
   of profiles.js: records are global and small, profiles are per-player and
   large, and when this moves to a database they want different tables.
   ========================================================================= */
import { loadBlob, saveBlob } from './store.js';

const KEY = 'records';
const HOLES = 9;

/* {
     courseId: {
       round: { name, pid, total, par, at },
       holes: [ { name, pid, strokes, par, at } | null x9 ]
     }
   } */
let board = {};


/* Async now: on a database-backed host this is a query.

   Worth being clear about why the board goes through the durable store at
   all. A player's career can be rebuilt from the snapshot their own device
   keeps — that is what saved one already. Nobody carries a copy of the
   GLOBAL record board, so if the host loses its disk every course record in
   the game is gone with no fallback anywhere. */
export async function loadRecords() {
  board = await loadBlob(KEY, {}) || {};
  const n = Object.keys(board).length;
  console.log(`  records: ${n} course${n === 1 ? '' : 's'} loaded`);
}

const saveSoon = () => saveBlob(KEY, board);

const blank = () => ({ round: null, holes: new Array(HOLES).fill(null) });

/** The board for one course, as the client renders it. */
export function recordsFor(courseId) {
  const c = board[courseId];
  if (!c) return blank();
  return { round: c.round || null, holes: (c.holes || []).slice(0, HOLES) };
}

/**
 * The whole board, for the clubhouse: every course's round record AND its
 * nine hole records.
 *
 * This used to hand back the round record alone, which is the one entry an
 * ordinary player will realistically never own — the full-round record goes
 * to whoever is best at the entire game. The hole records are the reachable
 * ones: anybody can hole a 2. Sending them is eight courses times nine small
 * objects, which is nothing, and it is the difference between a board you
 * read once and a board you chase.
 */
export function allRecords() {
  const out = {};
  for (const [id, c] of Object.entries(board)) {
    out[id] = {
      round: c.round || null,
      holes: (c.holes || []).slice(0, HOLES)
    };
  }
  return out;
}

/**
 * Fold a finished round into the board.
 *
 * @param courseId    which course
 * @param name        display name at the time — stored, not looked up later,
 *                    so a record still reads correctly if they rename
 * @param pid         who
 * @param holeScores  [{ strokes, par }] in hole order, ONLY for holes played
 * @param at          timestamp, passed in so this stays testable
 * @returns { round: bool, holes: number[] }  what was beaten
 */
export function submitRound(courseId, name, pid, holeScores, at = Date.now()) {
  const beat = { round: false, holes: [] };
  if (!courseId || !Array.isArray(holeScores)) return beat;

  /* A partial round cannot set anything. Someone who tees off, holes a
     fluke 2, and leaves must not own that hole forever. */
  if (holeScores.length < HOLES) return beat;
  if (holeScores.some(h => !h || !(h.strokes > 0) || !(h.par > 0))) return beat;

  const c = board[courseId] || (board[courseId] = blank());
  if (!Array.isArray(c.holes)) c.holes = new Array(HOLES).fill(null);

  const total = holeScores.reduce((a, h) => a + h.strokes, 0);
  const par = holeScores.reduce((a, h) => a + h.par, 0);
  // Ties do NOT take the record: whoever got there first keeps it.
  if (!c.round || total < c.round.total) {
    c.round = { name, pid, total, par, at };
    beat.round = true;
  }
  for (let i = 0; i < HOLES; i++) {
    const h = holeScores[i];
    const cur = c.holes[i];
    if (!cur || h.strokes < cur.strokes) {
      c.holes[i] = { name, pid, strokes: h.strokes, par: h.par, at };
      beat.holes.push(i);
    }
  }
  saveSoon();
  return beat;
}

/** For tests: wipe the board without touching disk. */
export function _reset() { board = {}; }

/* =========================================================================
   RESTORE BY QUORUM — surviving a host with no disk
   -------------------------------------------------------------------------
   The board is a file, and a free-tier host throws its disk away on every
   deploy. A committed seed stops it being BLANK, but records set since the
   last push still vanish, and "the records don't save" has been the single
   most-reported thing about this game.

   Without a database the only copy of a fresh record that outlives the host
   is the one sitting in the players' browsers. So on a cold boot the server
   will accept the board back from them — under conditions strict enough that
   it is not simply a "set any record you like" endpoint:

     1. ONLY while the board has no entry for that course. A restore can
        never overwrite or beat a record the server actually holds.
     2. ONLY in the first few minutes after boot. This is a recovery path,
        not a permanent inbox.
     3. TWO INDEPENDENT CLIENTS must offer the same score for the same
        course before it is taken. One browser is a claim; two browsers that
        have never met agreeing to the stroke is evidence. Forging it means
        controlling two clients and racing them into the window.

   It is weaker than a database and stronger than losing everything, and the
   trade is written down here so nobody has to guess why it exists. Set
   DATABASE_URL and none of this runs.
   ========================================================================= */
const RESTORE_WINDOW_MS = 6 * 60 * 1000;
const bootAt = Date.now();
const offers = new Map();          // courseId -> [{ from, json }]

/** True while a cold-booted board may still be rebuilt from clients. */
export const restoreOpen = () =>
  !process.env.DATABASE_URL && Date.now() - bootAt < RESTORE_WINDOW_MS;

/**
 * A client offers its cached copy of the board.
 * @returns how many courses were actually taken
 */
export function offerRecords(from, incoming) {
  if (!restoreOpen() || !incoming || typeof incoming !== 'object') return 0;
  let taken = 0;

  for (const [courseId, entry] of Object.entries(incoming)) {
    if (typeof courseId !== 'string' || courseId.length > 32) continue;
    if (board[courseId]?.round) continue;              // we already know better
    const r = entry?.round;
    if (!r || !(r.total > 0) || !(r.par > 0) || typeof r.name !== 'string') continue;
    // a shape check, so a malformed offer cannot become a permanent record
    if (r.total < HOLES || r.total > HOLES * 12) continue;

    const key = `${r.total}|${r.par}|${String(r.name).slice(0, 14)}`;
    const list = offers.get(courseId) || [];
    if (list.some(o => o.from === from)) continue;     // one vote per client
    list.push({ from, key, entry });
    offers.set(courseId, list);

    // two clients that have never met, agreeing to the stroke
    const seconder = list.find(o => o.from !== from && o.key === key);
    if (!seconder) continue;

    const holes = Array.isArray(entry.holes)
      ? entry.holes.slice(0, HOLES).map(h =>
          h && h.strokes > 0 && h.par > 0
            ? { name: String(h.name || '?').slice(0, 14), pid: String(h.pid || ''),
                strokes: h.strokes | 0, par: h.par | 0, at: Number(h.at) || bootAt }
            : null)
      : new Array(HOLES).fill(null);
    board[courseId] = {
      round: { name: String(r.name).slice(0, 14), pid: String(r.pid || ''),
               total: r.total | 0, par: r.par | 0, at: Number(r.at) || bootAt,
               restored: true },
      holes
    };
    taken++;
    console.log(`  records: ${courseId} restored from two agreeing clients`);
  }
  if (taken) saveSoon();
  return taken;
}
