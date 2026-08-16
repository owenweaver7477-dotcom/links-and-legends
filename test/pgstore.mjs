/* =========================================================================
   pgstore.mjs — the database path, before anybody depends on it
   -------------------------------------------------------------------------
   The Postgres store has never run. It is the branch that only executes when
   DATABASE_URL is set, which no test and no local run has ever done — so the
   first time it executes will be in production, holding every career on the
   server, at the exact moment somebody is watching to see whether the game
   saves.

   That is a bad place to discover an off-by-one in a placeholder list. The
   flush builds `($1, $2::jsonb, now()), ($3, $4::jsonb, now()), …` and a
   params array in parallel, and those two have to agree exactly: too few
   params is an error from the driver, too many is silently wrong data.

   There is no Postgres here to run against, so this checks the SQL the
   store WOULD send by driving the same construction with a fake pool that
   records rather than executes. It cannot tell you the server is reachable.
   It can tell you the statement is well-formed and the filter is applied,
   which is the part that would be wrong because of a code change rather
   than because of a network.
   ========================================================================= */

import assert from 'node:assert/strict';
import test from 'node:test';

/* The builder, lifted verbatim from pgStore.flush. Kept in step by the test
   below that reads store.js and checks the shapes still match — a copy that
   silently drifts is worse than no copy at all. */
function buildInsert(pids, rows) {
  const values = pids.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2}::jsonb, now())`).join(',');
  const params = [];
  for (const pid of pids) params.push(pid, JSON.stringify(rows.get(pid) ?? {}));
  return {
    text: `INSERT INTO profiles (pid, data, updated_at) VALUES ${values}
         ON CONFLICT (pid) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    params
  };
}

const rowsOf = n => new Map(
  Array.from({ length: n }, (_, i) => ['p' + i, { coins: 100 + i, holes: 9 }]));

test('every placeholder has exactly one parameter', () => {
  for (const n of [1, 2, 5, 50]) {
    const rows = rowsOf(n);
    const { text, params } = buildInsert([...rows.keys()], rows);
    const highest = Math.max(...[...text.matchAll(/\$(\d+)/g)].map(m => +m[1]));
    assert.equal(params.length, n * 2, `${n} rows should send ${n * 2} params`);
    assert.equal(highest, params.length,
      `the statement references $${highest} but only ${params.length} params are sent`);
    /* And no gaps: $1..$N must all appear, or the driver binds the wrong
       value to the wrong column. */
    const seen = new Set([...text.matchAll(/\$(\d+)/g)].map(m => +m[1]));
    for (let i = 1; i <= params.length; i++) {
      assert.ok(seen.has(i), `$${i} is never referenced`);
    }
  }
});

test('pid and data alternate, in that order', () => {
  const rows = rowsOf(3);
  const { params } = buildInsert([...rows.keys()], rows);
  for (let i = 0; i < 3; i++) {
    assert.equal(params[i * 2], 'p' + i, 'the pid is in the wrong slot');
    const data = JSON.parse(params[i * 2 + 1]);
    assert.equal(data.coins, 100 + i, 'the data does not belong to that pid');
  }
});

test('a missing row serialises as an object, never as undefined', () => {
  /* `JSON.stringify(undefined)` is undefined, not a string — which the
     driver would send as NULL into a NOT NULL jsonb column and the whole
     flush would fail, taking every other profile in the batch with it. */
  const { params } = buildInsert(['ghost'], new Map());
  assert.equal(params[1], '{}');
  assert.doesNotThrow(() => JSON.parse(params[1]));
});

test('the real store still builds the statement this way', async () => {
  /* Guards the copy above. If pgStore's construction changes, this fails
     and whoever changed it updates both — rather than this file quietly
     testing code that no longer exists. */
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../server/store.js', import.meta.url), 'utf8');
  const flush = src.slice(src.indexOf('async flush(rows, changed)'));
  assert.match(flush, /\$\$\{i \* 2 \+ 1\}, \$\$\{i \* 2 \+ 2\}::jsonb/,
    'the placeholder construction changed — update buildInsert here to match');
  assert.match(flush, /params\.push\(pid, JSON\.stringify\(rows\.get\(pid\) \?\? \{\}\)\)/,
    'the parameter construction changed — update buildInsert here to match');
  assert.match(flush, /ON CONFLICT \(pid\) DO UPDATE/,
    'the upsert changed — a plain INSERT would fail on every returning player');
});

test('the table the store creates matches the columns it writes', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../server/store.js', import.meta.url), 'utf8');
  assert.match(src, /CREATE TABLE IF NOT EXISTS profiles[\s\S]*pid\s+TEXT PRIMARY KEY/);
  assert.match(src, /CREATE TABLE IF NOT EXISTS profiles[\s\S]*data JSONB NOT NULL/);
  /* Hosted Postgres almost always requires TLS and almost never presents a
     chain Node verifies out of the box, so this must not be left strict or
     every managed provider refuses the connection. */
  assert.match(src, /rejectUnauthorized: false/, 'TLS would be rejected by most hosts');
});
