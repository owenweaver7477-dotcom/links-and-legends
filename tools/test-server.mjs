/* =========================================================================
   test-server.mjs — the server the test suite talks to, and only that one
   -------------------------------------------------------------------------
   Six test files open sockets to a running game. Every one of them defaulted
   to localhost:3000, which in development is the REAL server with the REAL
   data directory — so `npm test` created a profile for every fake player it
   invented, and did it on every run. Five and a half thousand profiles named
   things like `atk1` and `persist_prob` accumulated in the live store, all
   of them eligible for the leaderboards. That is where the phantom golfers
   holding records came from.

   This starts a server on a port nothing else uses, pointed at a data
   directory nothing else reads, runs the tests against it, and takes it down
   afterwards. The suite is now self-contained: it cannot see live data and
   live data cannot see it.
   ========================================================================= */
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';

const PORT = process.env.GOLF_TEST_PORT || '3199';
const DIR = '.test-data';

rmSync(DIR, { recursive: true, force: true });   // every run starts clean

const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT, GOLF_DATA_DIR: DIR, GOLF_QUIET: '1' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverLog = '';
server.stdout.on('data', d => { serverLog += d; });
server.stderr.on('data', d => { serverLog += d; });

/* Wait for it to actually answer rather than sleeping a fixed amount: a
   fixed sleep is either too short on a loaded machine or wasted on a fast
   one, and the failure mode of "too short" is a test suite that reports
   socket failures nobody can reproduce. */
const up = async () => {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/`);
      if (r.ok) return true;
    } catch { /* not yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
};

if (!await up()) {
  console.error('test server did not come up:\n' + serverLog);
  server.kill('SIGKILL');
  process.exit(1);
}

const args = process.argv.slice(2);
const tests = spawn(process.execPath, ['--test', ...(args.length ? args : ['test/'])], {
  env: { ...process.env, GOLF_URL: `http://localhost:${PORT}`, GOLF_DATA_DIR: DIR },
  stdio: 'inherit'
});

tests.on('exit', code => {
  server.kill('SIGKILL');
  process.exit(code ?? 1);
});
