/* =========================================================================
   store.js — where careers live
   -------------------------------------------------------------------------
   One seam, two implementations, chosen at boot:

     DATABASE_URL set    -> Postgres
     DATABASE_URL unset  -> data/profiles.json, exactly as before

   The file backend is not a stepping stone to be thrown away; it is what
   keeps local development and the whole test suite fast and offline. Nothing
   in the game knows which one it is talking to.

   Everything is READ THROUGH A MEMORY CACHE and written behind a debounce.
   That is not an optimisation bolted on — the game reads a profile several
   times per shot (the caddie's marker alone runs a binary search over the
   simulation), and a database round trip in that path would be absurd. So
   Postgres is the durable copy, and memory is what the game actually talks
   to. The consequence to keep in mind: two servers sharing one database will
   each hold their own cache, so this is single-instance-safe today and would
   need a short TTL or a notify channel before scaling out. Written down here
   rather than discovered later.
   ========================================================================= */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/* WHERE THE DATA LIVES.
   -------------------------------------------------------------------------
   Overridable, and it has to be. The test suite starts real servers and
   plays real rounds against them, and with a hard-coded path every one of
   those wrote into the live store — five and a half thousand profiles named
   `atk1` and `persist_prob`, most with no name and no rounds, all of them
   eligible for the leaderboards. That is where the phantom golfers holding
   records came from, and no amount of filtering fixes a test suite that
   scribbles on production data. */
const DATA_DIR = process.env.GOLF_DATA_DIR || path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'profiles.json');
const SAVE_DEBOUNCE = 800;

let impl = null;          // the chosen backend
let dirty = new Set();    // pids changed since the last flush
let timer = null;

/* ------------------------------------------------------- serialisation ---
   Each profile is stringified ONCE and the result kept until that profile
   changes. The flush then joins cached strings instead of walking the whole
   store again.

   This matters because JSON.stringify is synchronous and there is no way to
   make it otherwise: at six thousand profiles it alone blocked the event
   loop for 25 ms, on a debounce, after every hole. Eight players finishing a
   hole changes eight profiles; re-serialising the other five thousand nine
   hundred and ninety-two of them was the entire cost.

   `touch(pid)` already told us exactly which ones changed — the file
   backend simply never used it. */
const jsonCache = new Map();      // pid -> its serialised form

/* Whether a row is worth keeping. Set by profiles.js at open time, because
   the store must not need to know what a profile IS — only whether the owner
   says this one matters.

   The reason it exists: on a games portal, most visitors load the page,
   look, and leave. Every one of them gets a profile the moment their client
   says hello, and a file store rewrites EVERY row on every save. Twenty
   thousand of those is 23 MB written after every hole anybody anywhere
   plays, on a debounce, to a free-tier disk. That is the same event-loop
   starvation that once produced "everything has gone really slow and
   sometimes I can't even hit my ball", arriving by success rather than by
   a bug.

   A profile with no progress in it is exactly reproducible from the
   defaults, so dropping it loses nothing: somebody who comes back gets an
   identical blank one. */
let shouldPersist = null;
export const setPersistFilter = fn => { shouldPersist = typeof fn === 'function' ? fn : null; };

function serialise(rows) {
  const parts = [];
  for (const [pid, p] of rows) {
    if (shouldPersist && !shouldPersist(p)) continue;
    let j = jsonCache.get(pid);
    if (j === undefined) {
      j = JSON.stringify(p);
      jsonCache.set(pid, j);
    }
    parts.push(JSON.stringify(pid) + ':' + j);
  }
  return '{' + parts.join(',') + '}';
}

/* ------------------------------------------------------------ the file --- */
const fileStore = {
  name: 'json file',
  async load() {
    try {
      return Object.entries(JSON.parse(fs.readFileSync(FILE, 'utf8')));
    } catch { return []; }
  },
  async flush(rows) {
    /* ASYNC AND ATOMIC, and the async half is the one that was hurting.

       This used to be writeFileSync. Node is single-threaded, so a
       synchronous whole-file write blocks EVERY socket message for its
       whole duration — measured at 29 ms with six thousand profiles, which
       is what the live store had grown to. It fires on a debounce after
       every hole for every player, and while it runs a player pressing
       strike gets nothing: the server is not listening. "Everything has
       gone really slow and sometimes I can't even hit my ball" is precisely
       what a blocked event loop feels like from the outside.

       Temp file plus rename, because a whole-file write that is interrupted
       halfway leaves a truncated JSON file and every career in it is gone.
       rename() is atomic on every filesystem this runs on: the store is
       either the old one or the new one, never half of each. */
    const dir = path.dirname(FILE);
    await fsp.mkdir(dir, { recursive: true });
    const tmp = FILE + '.tmp';
    await fsp.writeFile(tmp, serialise(rows), 'utf8');
    await fsp.rename(tmp, FILE);
  }
};

/* -------------------------------------------------------------- postgres --- */
/**
 * `pg` is imported lazily and only when DATABASE_URL is set, so it stays an
 * optional dependency: a checkout with no database and no `pg` installed
 * still runs, and the test suite never touches it.
 */
function pgStore(url) {
  let pool = null;
  return {
    name: 'postgres',
    async load() {
      const { default: pkg } = await import('pg');
      pool = new pkg.Pool({
        connectionString: url,
        // hosted Postgres almost always wants TLS, and almost never presents
        // a chain node verifies out of the box
        ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
        max: 4
      });
      await pool.query(`
        CREATE TABLE IF NOT EXISTS profiles (
          pid  TEXT PRIMARY KEY,
          data JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      const { rows } = await pool.query('SELECT pid, data FROM profiles');
      return rows.map(r => [r.pid, r.data]);
    },
    async flush(rows, changed) {
      if (!pool || !changed.size) return;
      /* Only what changed, in one statement. Rewriting every profile on every
         flush would turn a nine-hole round into thousands of pointless
         writes. */
      /* The same filter the file store uses, for the same reason — a
         database does not care about the write cost the way a whole-file
         rewrite does, but a table with a row per drive-by visitor is still
         a table nobody wants to page through. */
      const pids = [...changed].filter(pid => {
        const row = rows.get(pid);
        return row && (!shouldPersist || shouldPersist(row));
      });
      if (!pids.length) return;
      const values = pids.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2}::jsonb, now())`).join(',');
      const params = [];
      for (const pid of pids) params.push(pid, JSON.stringify(rows.get(pid) ?? {}));
      await pool.query(
        `INSERT INTO profiles (pid, data, updated_at) VALUES ${values}
         ON CONFLICT (pid) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        params
      );
    }
  };
}

/* ---------------------------------------------------------------- api ---- */

/**
 * Bring the store up and hand back every profile it holds.
 * Falls back to the file — loudly — rather than starting empty, because a
 * server that boots with no profiles hands every returning player a brand new
 * career, which is far worse than being down.
 */
/* ═══════════════════════════════════════════════ ONE WRITER ONLY ═══════
   A lock file, and it exists because this has now destroyed data twice.

   Two server processes pointed at the same data directory each hold their
   own copy of every profile in memory and each flush the whole lot on a
   debounce. The second one to start loads the file, the first one to flush
   writes its older copy over the top, and everything that happened in
   between is gone. It took the record board from six courses to two, and it
   is exactly what "nothing saves" looks like from a player's seat: you buy
   something, it works, you come back and it never happened.

   Refusing to start is the right answer rather than trying to merge. A
   merge would have to guess which of two divergent copies is correct, and
   the honest answer is that nobody knows.

   Stale locks are cleared: the pid in the file is checked, and a lock left
   by a process that is no longer running is simply taken over. Without that,
   one hard kill would leave the game unable to start at all — which is a
   worse failure than the one being prevented. */
function claimLock() {
  const lockFile = path.join(DATA_DIR, '.writer.lock');
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const held = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    if (held?.pid && held.pid !== process.pid) {
      let alive = false;
      try { process.kill(held.pid, 0); alive = true; } catch { alive = false; }
      if (alive) {
        console.error('');
        console.error('  ✖  ANOTHER SERVER IS ALREADY USING THIS DATA DIRECTORY');
        console.error(`     process ${held.pid}, started ${new Date(held.at).toLocaleString()}`);
        console.error(`     directory: ${DATA_DIR}`);
        console.error('');
        console.error('     Two servers on one data directory overwrite each');
        console.error("     other's profiles — careers vanish. Stop the other one,");
        console.error('     or set GOLF_DATA_DIR to give this one its own.');
        console.error('');
        process.exit(1);
      }
    }
  } catch { /* no lock, or an unreadable one: ours now */ }
  try {
    fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, at: Date.now() }), 'utf8');
    const drop = () => { try { fs.unlinkSync(lockFile); } catch { /* already gone */ } };
    /* ON EXIT ONLY. This used to also listen for SIGINT and SIGTERM and call
       `process.exit(0)` from inside them — which released the lock correctly
       and, because Node runs signal listeners in the order they were
       registered and this one is registered when the store opens, killed the
       process before ANY shutdown handler the application added later could
       run. A graceful shutdown written in server.js was silently dead code:
       it never logged, never flushed, and every deploy dropped whatever was
       inside the save debounce.

       'exit' still fires however the process goes down, so the lock is
       released just the same — it simply no longer decides WHEN to go. */
    process.on('exit', drop);
  } catch { /* read-only disk: the lock is advisory, carry on */ }
}

export async function openStore(rowsInto) {
  claimLock();
  const url = process.env.DATABASE_URL;
  if (url) {
    try {
      impl = pgStore(url);
      const rows = await impl.load();
      for (const [pid, p] of rows) rowsInto.set(pid, p);
      console.log(`  store: postgres — ${rows.length} profiles`);
      return impl.name;
    } catch (e) {
      console.error('  store: POSTGRES UNAVAILABLE —', e.message);
      console.error('  store: falling back to the file. Careers are NOT being');
      console.error('         written to the database until this is fixed.');
    }
  }
  impl = fileStore;
  const rows = await impl.load();
  for (const [pid, p] of rows) rowsInto.set(pid, p);
  console.log(`  store: json file — ${rows.length} profiles`);
  /* The records board already says this loudly and careers did not, which
     is the wrong way round: a lost leaderboard is a shame and a lost career
     is the thing a player will actually leave over. Said once, at boot,
     where whoever is deploying will see it. */
  if (!process.env.DATABASE_URL) {
    console.log('  store: NO DATABASE_URL — every career lives in this file.');
    console.log('         On a host with an ephemeral disk (Render, Fly, most');
    console.log('         free tiers) that means coins, levels and outfits reset');
    console.log('         on every deploy. Set DATABASE_URL to keep them.');
  }
  return impl.name;
}

/** Mark a profile changed; the flush is debounced. */
export function touch(pid) {
  if (!pid) return;
  dirty.add(pid);
  // and drop the cached serialisation, so the next flush re-does this one
  // and only this one
  jsonCache.delete(pid);
}

/** Schedule a write of everything touched since the last one. */
export function saveSoon(rows) {
  clearTimeout(timer);
  timer = setTimeout(() => flushNow(rows), SAVE_DEBOUNCE);
  timer.unref?.();
}

export async function flushNow(rows) {
  if (!impl) return;
  const changed = dirty;
  dirty = new Set();
  try {
    await impl.flush(rows, changed);
  } catch (e) {
    // put them back so the next flush retries rather than losing the writes
    for (const pid of changed) dirty.add(pid);
    console.error('  store: save failed —', e.message);
  }
}

export const storeName = () => impl?.name || '(not open)';

/* =========================================================================
   BLOBS — small global documents, not per-player rows
   -------------------------------------------------------------------------
   The course record board is one object for the whole game, not one row per
   player, so it does not fit the profiles table. It also matters more than
   profiles do in one specific way: a player's career can be rebuilt from the
   snapshot on their own device, but nobody carries a copy of the global
   record board. If the host loses its disk, every course record in the game
   is gone and there is no fallback anywhere.

   So it rides the same DATABASE_URL switch: a file when there is no
   database, a row in a tiny key-value table when there is.
   ========================================================================= */
const BLOB_DIR = DATA_DIR;
let blobPool = null;

async function blobPg() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (blobPool) return blobPool;
  const { default: pkg } = await import('pg');
  blobPool = new pkg.Pool({
    connectionString: url,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
    max: 2
  });
  await blobPool.query(`
    CREATE TABLE IF NOT EXISTS blobs (
      key  TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  return blobPool;
}

/** Read a global document. Returns `fallback` if there is nothing stored. */
export async function loadBlob(key, fallback = {}) {
  try {
    const pool = await blobPg();
    if (pool) {
      const { rows } = await pool.query('SELECT data FROM blobs WHERE key = $1', [key]);
      if (rows.length) return rows[0].data;
      return fallback;
    }
  } catch (e) {
    console.error(`  store: blob "${key}" read failed —`, e.message);
  }
  try {
    return JSON.parse(fs.readFileSync(path.join(BLOB_DIR, key + '.json'), 'utf8'));
  } catch { /* no live file — try the committed seed below */ }

  /* THE SEED.
     -----------------------------------------------------------------------
     data/ is gitignored, which is right for a live file and fatal for a
     deployment: a fresh checkout on a host with no persistent disk has no
     records file at all, so the board came up blank after every single
     deploy. "The records are blank and don't save over" was exactly this.

     A seed file IS committed, so the board starts from a known snapshot
     instead of from nothing. It is not a substitute for a database — records
     set between deploys are still lost without one — but the difference
     between "last month's records" and "no records at all" is the difference
     between a leaderboard and a bug. */
  try {
    const seed = JSON.parse(
      fs.readFileSync(path.join(BLOB_DIR, key + '.seed.json'), 'utf8'));
    console.log(`  store: "${key}" restored from the committed seed`);
    return seed;
  } catch { return fallback; }
}

/* Debounced per key, because the record board is rewritten at the end of
   every round and several rounds can finish at once. */
const blobTimers = new Map();
export function saveBlob(key, value, debounce = 900) {
  clearTimeout(blobTimers.get(key));
  const t = setTimeout(async () => {
    try {
      const pool = await blobPg();
      if (pool) {
        await pool.query(
          `INSERT INTO blobs (key, data, updated_at) VALUES ($1, $2::jsonb, now())
           ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
          [key, JSON.stringify(value)]);
        return;
      }
    } catch (e) {
      console.error(`  store: blob "${key}" write failed —`, e.message);
    }
    try {
      // same reasoning as the profile store above: never block the loop,
      // never leave a half-written file behind
      await fsp.mkdir(BLOB_DIR, { recursive: true });
      const tmp = path.join(BLOB_DIR, key + '.json.tmp');
      await fsp.writeFile(tmp, JSON.stringify(value), 'utf8');
      await fsp.rename(tmp, path.join(BLOB_DIR, key + '.json'));
    } catch (e) { console.error(`  store: blob "${key}" file write failed —`, e.message); }
  }, debounce);
  t.unref?.();
  blobTimers.set(key, t);
}
