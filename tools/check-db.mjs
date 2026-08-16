#!/usr/bin/env node
/* =========================================================================
   check-db.mjs — is this connection string the right one?
   -------------------------------------------------------------------------
   Run this BEFORE putting a string into a live deploy:

       DATABASE_URL='postgresql://...' node tools/check-db.mjs

   It connects, creates the schema, writes a row, reads it back, and deletes
   it — the whole round trip the game does, in about a second, against your
   real database. Then it tells you what went wrong in words rather than in
   a driver stack trace.

   WHY THIS EXISTS. The failure it catches is nasty precisely because it is
   quiet: a wrong connection string leaves the game running perfectly and
   writing to a disk the next deploy erases. Nothing is broken, nothing
   errors where a player would see it, and the only symptom is that a week
   later everybody's career is gone. Finding that out from a command that
   takes a second is better than finding it out from the players.

   The messages below are the point of the file. Every one of them is a
   mistake that is easy to make with a hosted database and impossible to
   diagnose from what the driver says on its own — `ENETUNREACH` does not
   mention IPv6, and `password authentication failed` does not mention that
   the password still has square brackets round it.
   ========================================================================= */

const url = process.env.DATABASE_URL;

const say = (icon, msg) => console.log(`  ${icon}  ${msg}`);
const die = (msg, ...rest) => {
  console.log('');
  say('✗', msg);
  for (const r of rest) console.log(`     ${r}`);
  console.log('');
  process.exit(1);
};

console.log('');
if (!url) {
  die('DATABASE_URL is not set.',
      '',
      "Supabase: click Connect at the top of the dashboard and copy the",
      "SESSION POOLER string — not the direct one.",
      '',
      "  DATABASE_URL='postgresql://...' node tools/check-db.mjs");
}

/* ---- read the string before dialling anything ------------------------- */
let parsed;
try {
  parsed = new URL(url);
} catch {
  die('That does not parse as a URL.',
      'It should start postgresql:// or postgres://');
}

if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
  die(`The URL starts "${parsed.protocol}//", which is not a Postgres connection string.`,
      'You may have copied the project URL (https://xxxx.supabase.co) instead.',
      'The one you want is under Connect, and starts postgresql://');
}
if (/\[|\]/.test(parsed.password || '') || /YOUR-PASSWORD/i.test(url)) {
  die('The password is still the placeholder.',
      'Replace [YOUR-PASSWORD] with the actual database password —',
      'square brackets included, they are not part of it.');
}
if (!parsed.password) {
  die('There is no password in the string.',
      'Supabase shows it as [YOUR-PASSWORD]; paste the real one in its place.');
}

/* CHARACTERS THE URL SWALLOWS. A password is part of a URL, so anything
   with special meaning in one has to be percent-encoded — and this is the
   failure that wastes the most time, because the two parsers involved
   disagree quietly. `new URL()` splits userinfo at the LAST `@`, so a
   password containing one still yields the right host and looks perfectly
   healthy here; node-postgres does its own parsing and need not agree. The
   result is a checker that passes and a server that cannot log in.

   So this reads the raw string rather than the parsed one. */
const rawUserinfo = url.slice(url.indexOf('://') + 3, url.lastIndexOf('@'));
const rawPassword = rawUserinfo.slice(rawUserinfo.indexOf(':') + 1);
const RISKY = ['@', '/', '?', '#', '[', ']', ' '];
const found = RISKY.filter(c => rawPassword.includes(c));
if (found.length) {
  const enc = c => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0');
  die(`The password contains ${found.map(c => c === ' ' ? 'a space' : `"${c}"`).join(' and ')}, which a URL treats specially.`,
      'Percent-encode it, or the driver may read the string differently:',
      ...found.map(c => `    ${c === ' ' ? 'space' : c}  becomes  ${enc(c)}`),
      '',
      'Easiest fix: reset the password under Settings → Database and let',
      'Supabase generate one, which will be safe to paste as-is.');
}

/* The direct host is IPv6-only on Supabase, and most hosts — Render
   included — only have IPv4. It resolves, it looks right, and it times out. */
const direct = /^db\..*\.supabase\.co$/.test(parsed.hostname);
say('•', `host    ${parsed.hostname}`);
say('•', `port    ${parsed.port || '5432'}`);
say('•', `user    ${parsed.username}`);
if (direct) {
  say('!', 'This is the DIRECT connection string.');
  console.log('     Supabase serves it over IPv6 only, and Render is IPv4 only,');
  console.log('     so this will work from your laptop and time out once deployed.');
  console.log('     Use the Session pooler string instead (Connect → Session pooler).');
}
if (parsed.port === '6543') {
  say('!', 'Port 6543 is the TRANSACTION pooler.');
  console.log('     It does not keep a session between statements, which this');
  console.log('     server needs. Use the SESSION pooler (port 5432) instead.');
}

/* ---- now actually talk to it ------------------------------------------ */
let pg;
try {
  ({ default: pg } = await import('pg'));
} catch {
  die('The `pg` package is not installed.', 'Run: npm install');
}

const pool = new pg.Pool({
  connectionString: url,
  ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
  max: 1,
  connectionTimeoutMillis: 12000
});

const TEST_PID = '__connection-check__';

try {
  console.log('');
  say('…', 'connecting');
  const { rows: [{ version }] } = await pool.query('SELECT version()');
  say('✓', version.split(',')[0]);

  say('…', 'creating the schema if it is not there');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS profiles (
      pid TEXT PRIMARY KEY, data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blobs (
      key TEXT PRIMARY KEY, data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  say('✓', 'profiles and blobs are present');

  /* The round trip that matters. Reading is not enough — a role can very
     easily have SELECT and not INSERT, and the game would come up looking
     healthy and silently fail to save a single thing. */
  say('…', 'writing a row, reading it back, deleting it');
  await pool.query(
    `INSERT INTO profiles (pid, data, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (pid) DO UPDATE SET data = EXCLUDED.data`,
    [TEST_PID, JSON.stringify({ check: true, at: Date.now() })]);
  const { rows } = await pool.query('SELECT data FROM profiles WHERE pid = $1', [TEST_PID]);
  if (!rows.length || rows[0].data?.check !== true) {
    die('The row was written but did not read back.',
        'That should not be possible — stop and check the database by hand.');
  }
  await pool.query('DELETE FROM profiles WHERE pid = $1', [TEST_PID]);
  say('✓', 'read and write both work');

  const { rows: [counts] } = await pool.query(
    `SELECT (SELECT count(*)::int FROM profiles) AS profiles,
            (SELECT count(*)::int FROM blobs)    AS blobs`);
  console.log('');
  say('•', `${counts.profiles} careers and ${counts.blobs} boards in there now`);

  console.log('');
  say('✓', 'This connection string works.');
  if (direct) {
    console.log('');
    say('!', 'It worked from HERE, but this is still the direct string and');
    console.log('     Render is IPv4 only. Use the Session pooler one there.');
  }
  console.log('');
  console.log('  Next: put it on Render as DATABASE_URL, then check');
  console.log('  /healthz reports "persistent": true.');
  console.log('');
} catch (e) {
  const m = String(e?.message || e);
  console.log('');
  if (/ENETUNREACH|EHOSTUNREACH/.test(m)) {
    die('Could not reach the host.',
        direct ? 'This is the direct string, which Supabase serves over IPv6 only.'
               : 'The host did not answer on IPv4.',
        'Use the Session pooler string: Connect → Session pooler.');
  }
  if (/ENOTFOUND|EAI_AGAIN/.test(m)) {
    die(`No such host: ${parsed.hostname}`, 'Check for a typo, or that the project still exists.');
  }
  if (/ETIMEDOUT|timeout/i.test(m)) {
    /* Ordered by what is actually most likely GIVEN what we already know
       about the string. A timeout on the direct host is almost always the
       IPv6 problem, and leading with "your project may be paused" would
       send somebody to check a dashboard that is perfectly healthy. */
    if (direct) {
      die('The connection timed out on the direct host.',
          'Supabase serves that one over IPv6 only, and most networks —',
          'including Render — have no IPv6 route to it. This is expected.',
          '',
          'Use the Session pooler string: Connect → Session pooler.');
    }
    die('The connection timed out.',
        'A paused Supabase project does this — open the dashboard and',
        'resume it, then try again. A firewall would do it too.');
  }
  if (/password authentication failed|SASL|SCRAM/i.test(m)) {
    die('The password was rejected.',
        'Reset it under Settings → Database, then paste the new one in.',
        'Special characters must be percent-encoded in a URL: @ is %40.');
  }
  if (/permission denied|must be owner/i.test(m)) {
    die('Connected, but this role is not allowed to do that.',
        'Use the postgres user from the Connect panel rather than a',
        'restricted one you made yourself.');
  }
  if (/self.signed|certificate/i.test(m)) {
    die('TLS refused the certificate.',
        'This should not happen — the checker already accepts hosted chains.',
        m);
  }
  die('Could not complete the check.', m);
} finally {
  await pool.end().catch(() => {});
}
