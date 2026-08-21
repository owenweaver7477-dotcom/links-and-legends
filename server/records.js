/* =========================================================================
   records.js — the course record board
   -------------------------------------------------------------------------
   Who holds the best round on each course, and the best score on each
   individual hole. Three rules make this worth anything:

     1. A record can only come from a round the SERVER simulated. Nothing
        here is ever taken from a client — every stroke on this board was
        ruled on by the same physics that ruled on everyone else's, so the
        board means something.

     2. A record needs a completed round. Nine holes, played through. That
        stops someone teeing off, holing one lucky 2, and quitting to sit at
        the top of the hole board forever.

     3. A record is only ever compared against rounds set on the SAME
        difficulty. Casual draws the aim line, reads the putt and marks the
        sweet spot; Tournament shows you nothing but the flag. A board that
        let those compete was really two boards wearing one name, and the
        harder one always lost — which is backwards, since it is the harder
        one that should mean more.

   Deliberately its own file with its own store handle rather than a corner
   of profiles.js: records are global and small, profiles are per-player and
   large, and when this moves to a database they want different tables.
   ========================================================================= */
import { loadBlob, saveBlob } from './store.js';
import { DIFFICULTIES } from '../public/js/shared/difficulty.js';

const KEY = 'records';
const HOLES = 9;

/* Casual is real golf, same physics as everyone else — it just cannot set a
   record, because the whole point of a record is that it was earned without
   the game telling you where to aim. Derived from difficulty.js rather than
   written out a second time, so a mode that stops earning records (or
   starts) only ever has to change in one place.

   ORDER MATTERS here beyond just iteration: it is also the tie-break for
   "Course Record" when two difficulties somehow land on the identical
   total (see courseRecordFor) — hardest wins a tie, on the theory that the
   same score with less help drawn on screen is the harder thing to have
   done. */
const RECORD_DIFFICULTIES = DIFFICULTIES.filter(d => d.records).map(d => d.id);

/* {
     courseId: {
       [difficulty]: {
         round: { name, pid, total, par, at },
         holes: [ { name, pid, strokes, par, at } | null x9 ]
       }
     }
   } */
let board = {};

const blank = () => ({ round: null, holes: new Array(HOLES).fill(null) });
const blankCourse = () =>
  Object.fromEntries(RECORD_DIFFICULTIES.map(d => [d, blank()]));

/**
 * Is this a difficulty-separated course entry, or one written before
 * difficulty separation existed?
 *
 * A pre-separation entry has `round`/`holes` sitting directly on it. A
 * current one never does — its own keys are difficulty ids, each holding
 * its own `round`/`holes` — so the two shapes cannot be confused with each
 * other by accident.
 */
const isLegacyEntry = e => !!e && (e.round !== undefined || Array.isArray(e.holes));

/**
 * Bring one course entry up to the difficulty-separated shape.
 *
 * Every record on this board was set before difficulty separation existed,
 * which — since records were only ever accepted from Standard and above,
 * and Standard was and is the default — means every one of them was almost
 * certainly a Standard-mode round. Filing history under a guess is still
 * better than deleting it: a real player's real round either lands in the
 * one bucket that is probably right, or sits there mislabelled but intact,
 * never silently gone. Nothing about this invents a record that was not
 * there; it only decides which shelf an existing one goes on.
 */
function migrateEntry(e) {
  if (!isLegacyEntry(e)) return e;
  const c = blankCourse();
  c.standard = { round: e.round || null,
                 holes: Array.isArray(e.holes) ? e.holes.slice(0, HOLES) : new Array(HOLES).fill(null) };
  return c;
}

function migrateBoard(raw) {
  const out = {};
  let migrated = 0;
  for (const [courseId, entry] of Object.entries(raw || {})) {
    const wasLegacy = isLegacyEntry(entry);
    out[courseId] = migrateEntry(entry);
    if (wasLegacy) migrated++;
  }
  return { board: out, migrated };
}

/* Async now: on a database-backed host this is a query.

   Worth being clear about why the board goes through the durable store at
   all. A player's career can be rebuilt from the snapshot their own device
   keeps — that is what saved one already. Nobody carries a copy of the
   GLOBAL record board, so if the host loses its disk every course record in
   the game is gone with no fallback anywhere. */
export async function loadRecords() {
  const raw = await loadBlob(KEY, {}) || {};
  const { board: migratedBoard, migrated } = migrateBoard(raw);
  board = migratedBoard;
  if (migrated) {
    console.log(`  records: ${migrated} course${migrated === 1 ? '' : 's'} filed under Standard from before difficulty separation`);
  }

  /* MERGE THE SEED IN, never just fall back to it.

     loadBlob returns the seed only when there is no live file at all. That
     covers a fresh deploy and misses the case that actually happened: a live
     file that EXISTS but has lost records the seed still has. Two server
     processes pointed at the same data directory is all it takes — the
     second one loads, the first one flushes its older in-memory board over
     the top, and the file goes backwards. It went from six courses to two.

     Merging on every load makes that self-healing rather than permanent. A
     record only ever moves in one direction, so taking the better of the two
     copies can never lose a genuine score, and the seed can only ever add
     back something a live file dropped. */
  const seedRaw = await loadSeedOnly();
  const { board: seed } = migrateBoard(seedRaw);
  let healed = 0;
  for (const [courseId, sc] of Object.entries(seed || {})) {
    const live = board[courseId] || (board[courseId] = blankCourse());
    for (const diff of RECORD_DIFFICULTIES) {
      const scDiff = sc[diff] || blank();
      const liveDiff = live[diff] || (live[diff] = blank());
      if (better(scDiff.round, liveDiff.round)) { liveDiff.round = scDiff.round; healed++; }
      const sh = scDiff.holes || [];
      liveDiff.holes = liveDiff.holes || new Array(HOLES).fill(null);
      for (let i = 0; i < HOLES; i++) {
        if (better(sh[i], liveDiff.holes[i])) { liveDiff.holes[i] = sh[i]; healed++; }
      }
    }
  }
  const n = Object.keys(board).length;
  console.log(`  records: ${n} course${n === 1 ? '' : 's'} loaded` +
    (healed ? ` (${healed} restored from the seed)` : ''));
  if (healed || migrated) saveSoon();
}

/** Lower is better, and a missing record loses to any record at all. */
function better(a, b) {
  if (!a || typeof a.strokes !== 'number') return false;
  if (!b || typeof b.strokes !== 'number') return true;
  return a.strokes < b.strokes;
}

/* The committed seed on its own, whatever the live file says. loadBlob
   cannot be reused here — it deliberately prefers the live copy, which is
   the copy this is checking. */
async function loadSeedOnly() {
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    return JSON.parse(fs.readFileSync(
      path.join(here, '..', 'data', KEY + '.seed.json'), 'utf8'));
  } catch { return null; }
}

const saveSoon = () => saveBlob(KEY, board);

/**
 * The single best round for a course, across every difficulty that has one
 * — "Course Record" as players actually mean it: the best anyone has ever
 * carded there, full stop, whatever they had switched on. Always equal to
 * the best of the per-difficulty records, never stored separately, so it
 * can never itself drift out of sync with them.
 *
 * A tie goes to the harder difficulty (see RECORD_DIFFICULTIES) rather than
 * whichever was set first — the fairer read of "the same score with less
 * help drawn on screen is the harder thing to have done" than an arrival
 * order nobody watching would know to credit.
 */
function courseRecordFor(courseId) {
  const c = board[courseId];
  if (!c) return null;
  let best = null;
  for (const diff of RECORD_DIFFICULTIES) {
    const r = c[diff]?.round;
    if (!r) continue;
    // <=, not <: RECORD_DIFFICULTIES runs easiest to hardest, so on a tie
    // the harder difficulty (checked later) overwrites and wins, per the
    // comment above this function
    if (!best || r.total <= best.round.total) best = { difficulty: diff, round: r };
  }
  return best;
}

/**
 * The board for one course.
 *
 * @param courseId
 * @param difficulty  optional. Given, returns just that difficulty's board
 *   — the shape every existing caller already expects. Omitted, returns
 *   every record-eligible difficulty at once plus the derived course
 *   record, for a screen comparing them side by side.
 */
export function recordsFor(courseId, difficulty) {
  const c = board[courseId] || blankCourse();
  if (difficulty) {
    const d = c[difficulty] || blank();
    return { round: d.round || null, holes: (d.holes || []).slice(0, HOLES) };
  }
  const out = { courseRecord: courseRecordFor(courseId) };
  for (const diff of RECORD_DIFFICULTIES) {
    const d = c[diff] || blank();
    out[diff] = { round: d.round || null, holes: (d.holes || []).slice(0, HOLES) };
  }
  return out;
}

/**
 * The whole board, for the clubhouse: every course, every difficulty's
 * round record AND its nine hole records, plus the derived course record.
 *
 * This used to hand back the round record alone, which is the one entry an
 * ordinary player will realistically never own — the full-round record goes
 * to whoever is best at the entire game. The hole records are the reachable
 * ones: anybody can hole a 2. Sending them is a few courses times a few
 * difficulties times nine small objects, which is still nothing, and it is
 * the difference between a board you read once and a board you chase.
 */
export function allRecords() {
  const out = {};
  for (const courseId of Object.keys(board)) out[courseId] = recordsFor(courseId);
  return out;
}

/**
 * Fold a finished round into the board.
 *
 * @param courseId    which course
 * @param difficulty  which difficulty this round was played on. Rejected
 *   silently (nothing beaten) if it is not one that accepts records —
 *   callers already gate on allowsRecords() before this, so reaching here
 *   with e.g. 'casual' would mean that gate was skipped somewhere, and the
 *   safe response to that is to write nothing rather than guess.
 * @param name        display name at the time — stored, not looked up later,
 *                    so a record still reads correctly if they rename
 * @param pid         who
 * @param holeScores  [{ strokes, par }] in hole order, ONLY for holes played
 * @param at          timestamp, passed in so this stays testable
 * @returns { round: bool, holes: number[] }  what was beaten
 */
export function submitRound(courseId, difficulty, name, pid, holeScores, at = Date.now()) {
  const beat = { round: false, holes: [] };
  if (!courseId || !Array.isArray(holeScores)) return beat;
  if (!RECORD_DIFFICULTIES.includes(difficulty)) return beat;

  /* A partial round cannot set anything. Someone who tees off, holes a
     fluke 2, and leaves must not own that hole forever. */
  if (holeScores.length < HOLES) return beat;
  if (holeScores.some(h => !h || !(h.strokes > 0) || !(h.par > 0))) return beat;

  const course = board[courseId] || (board[courseId] = blankCourse());
  const c = course[difficulty] || (course[difficulty] = blank());
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

/**
 * What this player holds, so the game can put a badge on them.
 *
 * A record board nobody wears is a list. The point of holding one is that
 * everybody you play with can see it — so the count of course records and
 * hole records travels with the player, and the room draws it beside their
 * name. Counted across every difficulty: a Tournament record is still a
 * record.
 */
export function badgesFor(pid) {
  if (!pid) return null;
  let courses = 0, holes = 0, bestCourse = null;
  for (const [id, c] of Object.entries(board)) {
    let holds = false;
    for (const diff of RECORD_DIFFICULTIES) {
      const d = c[diff];
      if (!d) continue;
      if (d.round?.pid === pid) holds = true;
      for (const h of (d.holes || [])) if (h?.pid === pid) holes++;
    }
    if (holds) { courses++; if (!bestCourse) bestCourse = id; }
  }
  return (courses || holes) ? { courses, holes, bestCourse } : null;
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

     1. ONLY while the board has no entry for that course AND difficulty. A
        restore can never overwrite or beat a record the server actually
        holds.
     2. ONLY in the first few minutes after boot. This is a recovery path,
        not a permanent inbox.
     3. TWO INDEPENDENT CLIENTS must offer the same score for the same
        course and difficulty before it is taken. One browser is a claim;
        two browsers that have never met agreeing to the stroke is evidence.
        Forging it means controlling two clients and racing them into the
        window.

   It is weaker than a database and stronger than losing everything, and the
   trade is written down here so nobody has to guess why it exists. Set
   DATABASE_URL and none of this runs.

   What a client actually offers is whatever allRecords() last gave it —
   `{ courseId: { standard: {round,holes}, pro: {...}, tournament: {...},
   courseRecord } }` — so this never has to reconcile a shape the rest of
   the file does not already produce and consume itself.
   ========================================================================= */
const RESTORE_WINDOW_MS = 6 * 60 * 1000;
const bootAt = Date.now();
const offers = new Map();          // "courseId|difficulty" -> [{ from, key, entry }]

/** True while a cold-booted board may still be rebuilt from clients. */
export const restoreOpen = () =>
  !process.env.DATABASE_URL && Date.now() - bootAt < RESTORE_WINDOW_MS;

/**
 * A client offers its cached copy of the board.
 * @returns how many course+difficulty boards were actually taken
 */
export function offerRecords(from, incoming) {
  if (!restoreOpen() || !incoming || typeof incoming !== 'object') return 0;
  let taken = 0;

  for (const [courseId, courseEntry] of Object.entries(incoming)) {
    if (typeof courseId !== 'string' || courseId.length > 32) continue;
    if (!courseEntry || typeof courseEntry !== 'object') continue;

    for (const diff of RECORD_DIFFICULTIES) {
      const entry = courseEntry[diff];
      const r = entry?.round;
      if (!r || !(r.total > 0) || !(r.par > 0) || typeof r.name !== 'string') continue;
      // a shape check, so a malformed offer cannot become a permanent record
      if (r.total < HOLES || r.total > HOLES * 12) continue;
      if (board[courseId]?.[diff]?.round) continue;      // we already know better

      const slot = `${courseId}|${diff}`;
      const key = `${r.total}|${r.par}|${String(r.name).slice(0, 14)}`;
      const list = offers.get(slot) || [];
      if (list.some(o => o.from === from)) continue;     // one vote per client
      list.push({ from, key, entry });
      offers.set(slot, list);

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
      const course = board[courseId] || (board[courseId] = blankCourse());
      course[diff] = {
        round: { name: String(r.name).slice(0, 14), pid: String(r.pid || ''),
                 total: r.total | 0, par: r.par | 0, at: Number(r.at) || bootAt,
                 restored: true },
        holes
      };
      taken++;
      console.log(`  records: ${courseId} (${diff}) restored from two agreeing clients`);
    }
  }
  if (taken) saveSoon();
  return taken;
}
