#!/usr/bin/env node
/* =========================================================================
   build-portal.mjs — the zip CrazyGames' upload box actually wants
   -------------------------------------------------------------------------
   The hosting split this project is built for (see net.js, and BACKEND_ORIGIN
   in server.js) already works: the client detects whether it is being
   served by the game server or as a static bundle, and falls back to
   talking to the Render deployment either way. What was still missing was
   the last, purely mechanical step — turning public/ into the actual file
   a developer drags into the portal's upload box.

   This does three things, in order, and stops at the first that fails:

     1. Runs the SAME check `npm test` already runs before every commit —
        does every reference in the build resolve when served from a
        subdirectory, the way the portal serves it. A zip that fails this
        is not worth making; uploading it just moves the discovery of the
        problem from a laptop to a review queue.
     2. Zips the CONTENTS of public/ — index.html at the zip's root, not
        inside a public/ folder — which is the shape every portal upload
        box expects and the shape a folder-structure mismatch is the
        single easiest way to get wrong by hand.
     3. Reports what shipped: file count, size against the budget, and the
        exact next step, because "now what" is where a build gets fumbled
        as easily as the zip itself.

   Uploading the result and everything after — cover art, the QA Tool,
   payout details — is still a human at the CrazyGames dev portal. This is
   the part that was mechanical and did not need to be.

     node tools/build-portal.mjs
   ========================================================================= */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT_ZIP = path.join(OUT_DIR, 'links-and-legends-portal.zip');
const LIMIT_MB = 23;

const say = (icon, msg) => console.log(`  ${icon}  ${msg}`);
const die = (msg, ...rest) => {
  console.log('');
  say('✗', msg);
  for (const r of rest) console.log(`     ${r}`);
  console.log('');
  process.exit(1);
};

/** Run a child process and resolve/reject on its exit code. */
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...opts });
    p.on('error', reject);
    p.on('exit', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)));
  });
}

console.log('');
say('…', 'checking the build resolves from a subdirectory (same check npm test runs)');
try {
  await run(process.execPath, [path.join(ROOT, 'tools', 'verify-bundle.mjs')]);
} catch {
  die('verify-bundle failed — see above.',
      'Fix what it reported before zipping. A build that is not portal-safe',
      'locally will not become portal-safe by being uploaded.');
}

await fs.mkdir(OUT_DIR, { recursive: true });
try { await fs.unlink(OUT_ZIP); } catch { /* did not exist yet */ }

say('…', 'zipping public/ — contents at the root, the shape the upload box wants');
/* `zip -r OUT . ` from INSIDE public/ puts index.html at the zip root.
   Zipping public/ itself from outside it would nest everything one folder
   too deep — exactly the mismatch that makes an otherwise-correct build
   404 on the portal and nowhere else, since every local test serves the
   folder rather than its contents. Pre-compressed siblings are excluded:
   the portal compresses on its own end, and shipping both is dead weight
   that also fails the walk in verify-bundle if a script tag ever pointed
   at one directly by mistake. */
try {
  await run('zip', ['-r', '-X', '-q', OUT_ZIP, '.', '-x', '.*', '-x', '*.br', '-x', '*.gz'],
    { cwd: PUBLIC });
} catch {
  die('The `zip` command is not available.',
      '',
      'Zip public/\'s CONTENTS (not the public folder itself) by hand instead —',
      'index.html must sit at the root of the archive, not inside a public/',
      'folder — then upload that. On macOS/Linux, from inside public/:',
      '',
      '  zip -r ../dist/links-and-legends-portal.zip . -x ".*"');
}

async function dirCount(dir) {
  let n = 0;
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    n += e.isDirectory() ? await dirCount(path.join(dir, e.name)) : 1;
  }
  return n;
}

const stat = await fs.stat(OUT_ZIP);
const mb = stat.size / 1024 / 1024;
const files = await dirCount(PUBLIC);

console.log('');
say('✓', `${OUT_ZIP.replace(ROOT + path.sep, '')}`);
say('•', `${files} files, ${mb.toFixed(2)} MB zipped`);
if (mb > LIMIT_MB) {
  say('!', `over the ${LIMIT_MB} MB internal target — still fine against CrazyGames'`);
  console.log(`     own limits, but check §0.1 of the roadmap before this grows further.`);
}
console.log('');
console.log('  Next, at crazygames.com/developer:');
console.log('   1. Upload this zip as a new build.');
console.log('   2. Run their QA Tool against it before submitting — it runs the game');
console.log('      exactly as the portal will, catching what a local check cannot.');
console.log('   3. The multiplayer backend stays on Render — net.js already falls back');
console.log('      to it automatically. Nothing to configure on that side.');
console.log('');
