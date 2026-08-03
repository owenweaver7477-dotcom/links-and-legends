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
