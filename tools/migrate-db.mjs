#!/usr/bin/env node
/* =========================================================================
   migrate-db.mjs — copy careers from the JSON file into Postgres
   -------------------------------------------------------------------------
   COPIES.  It does not move, and it never deletes the file.  After this runs
   both stores hold the same data, so switching back is unsetting one
   environment variable.

     DATABASE_URL=postgres://... node tools/migrate-db.mjs
     DATABASE_URL=postgres://... node tools/migrate-db.mjs --dry-run

   Idempotent: running it twice is harmless, it just overwrites rows with the
   same content.  It refuses to report success unless the number of profiles
   that went in matches the number that came back out, because the one thing
   worse than not migrating is believing you did.
   ========================================================================= */
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.join(process.cwd(), 'data', 'profiles.json');
const DRY = process.argv.includes('--dry-run');
const url = process.env.DATABASE_URL;

if (!url) {
  console.error('\n  DATABASE_URL is not set.\n');
  console.error('  Create a free Postgres project (Neon or Supabase), then:');
  console.error('    DATABASE_URL=postgres://... node tools/migrate-db.mjs --dry-run\n');
  process.exit(1);
}

let raw;
try {
  raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch (e) {
  console.error(`\n  Could not read ${FILE}: ${e.message}`);
  console.error('  Nothing to migrate — if this is a fresh host, that is fine.\n');
  process.exit(1);
}

const entries = Object.entries(raw);
console.log(`\n  ${entries.length} profiles in ${FILE}`);

/* A profile worth migrating has actually been played. Blank rows are the
   welcome-purse-only profiles of people who opened the page once, and there
   are a lot of them; carrying them over costs storage and buys nothing. */
const played = entries.filter(([, p]) =>
  (p?.rounds || 0) > 0 || (p?.holes || 0) > 0 || (p?.xp || 0) > 0 ||
  Object.keys(p?.clubSets || {}).length > 0 || Object.values(p?.gear || {}).some(v => v > 0));
console.log(`  ${played.length} of them have actually played — migrating those`);

/* The boards, listed the same way whether this is a rehearsal or the real
   thing. A dry run that reports on the profiles and stays silent about the
   leaderboard is a dry run of half the job — and the boards are the half
   somebody would only notice was missing after switching over. */
function boardFiles() {
  const dir = path.dirname(FILE);
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json') && f !== 'profiles.json' && !f.endsWith('.seed.json'))
    .map(f => f.slice(0, -'.json'.length));
}
const boards = boardFiles();
console.log(boards.length
  ? `  boards to copy: ${boards.join(', ')}`
  : '  no boards to copy (no records, friends or names yet)');

if (DRY) {
  console.log('\n  --dry-run: nothing written. Re-run without it to migrate.\n');
  process.exit(0);
}

const { default: pkg } = await import('pg');
const pool = new pkg.Pool({
  connectionString: url,
  ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false }
});

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS profiles (
      pid  TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

  const BATCH = 200;
  let done = 0;
  for (let i = 0; i < played.length; i += BATCH) {
    const chunk = played.slice(i, i + BATCH);
    const values = chunk.map((_, j) => `($${j * 2 + 1}, $${j * 2 + 2}::jsonb, now())`).join(',');
    const params = [];
    for (const [pid, p] of chunk) params.push(pid, JSON.stringify(p));
    await pool.query(
      `INSERT INTO profiles (pid, data, updated_at) VALUES ${values}
       ON CONFLICT (pid) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      params
    );
    done += chunk.length;
    process.stdout.write(`\r  written ${done}/${played.length}`);
  }
  process.stdout.write('\n');

  /* Read it back and count. "It ran without throwing" is not the same as
     "the careers are in there". */
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM profiles');
  const inDb = rows[0].n;
  if (inDb < played.length) {
    console.error(`\n  MISMATCH: wrote ${played.length}, database holds ${inDb}.`);
    console.error('  The file is untouched. Do NOT set DATABASE_URL yet.\n');
    process.exit(2);
  }

  /* ── AND THE BOARDS ────────────────────────────────────────────────────
     Course records, friendships and claimed names do not live in
     profiles.json — they are separate blobs, and this tool used to leave
     every one of them behind. You would migrate, switch DATABASE_URL, and
     find the leaderboard empty, nobody's friends list intact and every
     reserved name free again, with the old data sitting in files the server
     had stopped reading. Copied here for the same reason and by the same
     rule: overwrite nothing that is already in the database. */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blobs (
      key  TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

  const dataDir = path.dirname(FILE);
  let blobs = 0;
  for (const key of boards) {
    let body;
    try { body = JSON.parse(fs.readFileSync(path.join(dataDir, key + '.json'), 'utf8')); }
    catch { console.warn(`  skipped ${key} — not valid JSON`); continue; }
    await pool.query(
      `INSERT INTO blobs (key, data, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [key, JSON.stringify(body)]);
    console.log(`  copied ${key}`);
    blobs++;
  }
  console.log(`\n  done — ${inDb} profiles and ${blobs} board${blobs === 1 ? '' : 's'} in the database.`);
  console.log(`  ${FILE} untouched.`);
  console.log('  Set DATABASE_URL on the server to switch over.');
  console.log('  Unset it to switch straight back.\n');
} finally {
  await pool.end();
}
