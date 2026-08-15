/* =========================================================================
   prune-profiles.mjs — take the test suite's litter back out of the store
   -------------------------------------------------------------------------
   Every `npm test` run used to create profiles on the live server, because
   the socket tests defaulted to localhost:3000. That is fixed at the source
   (tools/test-server.mjs), but five and a half thousand of them are already
   in the file and every one is eligible for a leaderboard.

   The rule for removal is deliberately conservative, because deleting a real
   player's career to tidy a list is far worse than leaving a blank row on
   one: a profile goes only if it has NEVER PLAYED A ROUND, has no name, and
   holds nothing anybody could have earned. Anything with a single round, a
   name, a purchase or a star is kept, whatever its id looks like.

   Run with --dry to see what it would do.
   ========================================================================= */
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.env.GOLF_DATA_DIR || 'data';
const FILE = path.join(DIR, 'profiles.json');
const dry = process.argv.includes('--dry');

const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const rows = raw.rows || raw;
const keys = Object.keys(rows);

const STARTING_COINS = 900;
let removed = 0;
const kept = {};
/* Ids the test suite invents. These go regardless of what they hold —
   a profile called `rec-hfjp41can45` with eleven rounds on it is not a
   player who will miss its career. Kept deliberately narrow: every pattern
   here matches something in test/, and nothing here matches the ids the
   client actually generates (`p_` + base36, or a portal id). */
const TEST_PID = /^(bot\d|scr\d|demo|shop[-_]|host[-_]|rec-|leave_|persist|atk\d|test[A-Z]|P[AB]$|softlock|xp[-_]|res[-_]|restore-|seed[-_]|Rec-)/;

for (const [pid, p] of Object.entries(rows)) {
  if (TEST_PID.test(pid)) { removed++; continue; }
  const played = (p.rounds || 0) > 0 || (p.holes || 0) > 0;
  const named = !!p.name;
  const earned = (p.xp || 0) > 0 || (p.coins || 0) !== STARTING_COINS
    || Object.keys(p.stars || {}).length > 0
    || (p.cleared || []).length > 0
    || Object.values(p.gear || {}).some(v => v > 0)
    || Object.values(p.crew || {}).some(v => v > 0);
  if (played || named || earned) kept[pid] = p; else removed++;
}

console.log(`${keys.length} profiles: keeping ${Object.keys(kept).length}, removing ${removed}`);
if (dry) { console.log('(dry run — nothing written)'); process.exit(0); }
if (!removed) process.exit(0);

fs.copyFileSync(FILE, FILE + '.bak');
fs.writeFileSync(FILE, JSON.stringify(raw.rows ? { ...raw, rows: kept } : kept), 'utf8');
console.log(`written. previous file kept as ${path.basename(FILE)}.bak`);
