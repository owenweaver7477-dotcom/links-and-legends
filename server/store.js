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
import path from 'node:path';

const FILE = path.join(process.cwd(), 'data', 'profiles.json');
const SAVE_DEBOUNCE = 800;

let impl = null;          // the chosen backend
let dirty = new Set();    // pids changed since the last flush
let timer = null;

/* ------------------------------------------------------------ the file --- */
const fileStore = {
  name: 'json file',
  async load() {
    try {
      return Object.entries(JSON.parse(fs.readFileSync(FILE, 'utf8')));
    } catch { return []; }
  },
  async flush(rows) {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    // whole-file write: the file backend is for one small server, and a
    // partial write here would be far worse than a slightly wasteful one
    fs.writeFileSync(FILE, JSON.stringify(Object.fromEntries(rows)), 'utf8');
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
      const pids = [...changed];
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
export async function openStore(rowsInto) {
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
  return impl.name;
}

/** Mark a profile changed; the flush is debounced. */
export function touch(pid) { if (pid) dirty.add(pid); }

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
const BLOB_DIR = path.join(process.cwd(), 'data');
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
      fs.mkdirSync(BLOB_DIR, { recursive: true });
      fs.writeFileSync(path.join(BLOB_DIR, key + '.json'), JSON.stringify(value), 'utf8');
    } catch (e) { console.error(`  store: blob "${key}" file write failed —`, e.message); }
  }, debounce);
  t.unref?.();
  blobTimers.set(key, t);
}
