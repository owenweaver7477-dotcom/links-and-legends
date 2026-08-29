/* =========================================================================
   profileview.mjs — what a stranger may see, asserted as an allow-list
   -------------------------------------------------------------------------
   Opening somebody else's profile is the first thing in this game that
   sends one player's data to another, and the shape it takes is the whole
   risk. `publicProfile` carries about thirty-five fields including coins,
   gems and case counts, and until now it was only ever emitted to the
   socket that owns it — so there was no leak to have, and no test needed.

   `visitorProfile` is the new one, and it is written as an ALLOW-LIST for a
   reason this file exists to keep true. The obvious implementation is to
   take publicProfile and delete the private keys, and that is exactly the
   version that leaks: the next person to add a field adds it to
   publicProfile, never thinks about the projection, and it ships to
   strangers by default.

   So the assertions below are deliberately the strict kind. Not "coins is
   absent" — that catches one field somebody already thought about — but
   "the key set is exactly VISITOR_FIELDS", which fails on ANY field that
   arrives without a decision.
   ========================================================================= */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

process.env.GOLF_DATA_DIR ||= '.test-data-profileview';
const OWN = process.env.GOLF_DATA_DIR === '.test-data-profileview';
if (OWN) after(() => rm('.test-data-profileview', { recursive: true, force: true }).catch(() => {}));

const rid = p => p + '-' + Math.random().toString(36).slice(2);

/* Everything about somebody's economy, settings or engagement. Named one by
   one rather than derived, so adding a currency does not silently shrink
   the list this checks. */
const NEVER = [
  'coins', 'gems', 'cases', 'proCases', 'vaultCases', 'clubCases', 'setCrates',
  'casesSincePity', 'difficulty', 'earnRate', 'login', 'xp'
];

test('a visitor profile carries none of the owner-only fields', async () => {
  const { getProfile, visitorProfile } = await import('../server/profiles.js');
  const pid = rid('vis');
  const p = getProfile(pid);
  // give it something in every private field, so an absence is a real absence
  p.coins = 999999; p.gems = 4242; p.cases = 7; p.proCases = 3; p.vaultCases = 1;
  p.clubCases = 5; p.setCrates = 2; p.casesSincePity = 9; p.difficulty = 'easy';
  p.login = { day: 12, cycle: 3, freezes: 2, lastClaimDate: '2026-08-29' };

  const v = visitorProfile(pid);
  for (const k of NEVER) {
    assert.equal(k in v, false,
      `visitorProfile sends "${k}" to strangers — that is somebody else's ${
        k === 'difficulty' || k === 'earnRate' ? 'settings' :
        k === 'login' ? 'engagement data' : 'wallet'}`);
  }
});

test('the projection is exactly its allow-list, with nothing extra', async () => {
  /* THE assertion in this file. A "delete the private keys" projection
     passes the test above and still leaks the next field somebody adds;
     this one cannot. */
  const { getProfile, visitorProfile, VISITOR_FIELDS } = await import('../server/profiles.js');
  const pid = rid('vis-shape');
  getProfile(pid);
  const keys = Object.keys(visitorProfile(pid)).sort();
  assert.deepEqual(keys, [...VISITOR_FIELDS].sort(),
    'visitorProfile returns a different key set than VISITOR_FIELDS declares — ' +
    'a field arriving here should be a decision somebody made, not one they inherited');
});

test('publicProfile still carries the wallet, and still goes only to its owner', async () => {
  /* The other half of the split. If publicProfile ever stopped carrying
     these, somebody has "fixed" the leak by breaking the owner's own
     screens — and if a handler other than the two that answer to the owning
     socket starts sending it, that is the leak itself. */
  const { getProfile, publicProfile } = await import('../server/profiles.js');
  const pid = rid('vis-owner');
  const p = getProfile(pid);
  p.coins = 1234; p.gems = 56;
  const pub = publicProfile(pid);
  assert.equal(pub.coins, 1234, 'the owner can no longer see their own coins');
  assert.equal(pub.gems, 56);

  /* The real invariant is not a count — publicProfile is referenced ~34
     times — it is the CHANNEL. Every place that ships the whole object
     ships it on the 'profile' event, which the client reads as "mine", to
     the socket that owns it. Everywhere else reads a few named fields into
     a fresh object (friendPeople, friendBoardRows, the room roster), which
     is a projection by hand and fine.

     So: no emit may carry a whole publicProfile on any event but 'profile'.
     A `room:state`, a `presence:who` or a new social event that reached for
     it would be the leak, and this is the line that fails on it. */
  const src = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const bad = [...src.matchAll(/emit\(\s*'([^']+)'[^;\n]*publicProfile\(/g)]
    .map(m => m[1]).filter(ev => ev !== 'profile');
  assert.deepEqual(bad, [],
    `publicProfile is emitted on ${bad.join(', ')} — it carries the wallet and may ` +
    "only ever go to its owner on 'profile'");

  assert.equal(/profile:of[\s\S]{0,900}publicProfile\(/.test(src), false,
    'the profile:of handler answers with publicProfile — it must use visitorProfile');
});

test('a visitor profile still shows the things somebody looked them up FOR', async () => {
  /* The projection has to be tight AND useful. "Their profile, their skins
     and everything" was the ask, so cosmetics and record are the point of
     it — a profile stripped back to a name would be safe and pointless. */
  const { getProfile, visitorProfile } = await import('../server/profiles.js');
  const pid = rid('vis-full');
  const p = getProfile(pid);
  p.rounds = 30; p.aces = 1; p.clubSkin = 'ace-gold';
  p.mastery = { I7: 400, DR: 900 };
  p.caseUnlocks = ['decal:tartan'];

  const v = visitorProfile(pid);
  for (const k of ['look', 'clubSkin', 'clubSet', 'clubPieces', 'clubGrades',
                   'caseUnlocks', 'decalPurity', 'equippedEmotes', 'mastery',
                   'rating', 'handicap', 'rounds', 'best', 'aces', 'records']) {
    assert.ok(k in v, `a visitor cannot see "${k}" — that is most of why anybody opens a profile`);
  }
  assert.equal(v.clubSkin, 'ace-gold');
  assert.deepEqual(v.mastery, { I7: 400, DR: 900 });
  assert.equal(v.pid, pid, 'the profile does not say whose it is');
});

test('looking up a player who does not exist does not create one', async () => {
  /* getProfile MINTS a profile on a miss, which is right for the owner and
     wrong for a lookup: without the existence gate, asking for a made-up pid
     answers as though it were a real player AND grows the store from
     outside, one request at a time. */
  const { profileExists, getProfile } = await import('../server/profiles.js');
  const ghost = rid('vis-ghost');
  assert.equal(profileExists(ghost), false);
  getProfile(ghost);                       // the owner path, which does create
  assert.equal(profileExists(ghost), true);

  const src = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const handler = src.match(/socket\.on\('profile:of'[\s\S]*?\n  \}\);/);
  assert.ok(handler, 'no profile:of handler in server.js');
  assert.ok(/profileExists\(other\)/.test(handler[0]),
    'profile:of does not check the player exists — it will mint one for any pid asked for');
  assert.ok(/hasBlocked\(other, me\)/.test(handler[0]),
    'profile:of ignores blocking — somebody who blocked you can still be looked up');
  assert.equal(/publicProfile/.test(handler[0]), false,
    'profile:of reaches for publicProfile');
});
