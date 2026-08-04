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

/** Every course's round record, for the clubhouse. */
export function allRecords() {
  const out = {};
  for (const [id, c] of Object.entries(board)) out[id] = c.round || null;
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
