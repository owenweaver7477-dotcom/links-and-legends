/* =========================================================================
   schema.mjs — a profile always knows what shape it is in
   -------------------------------------------------------------------------
   PROFILE_SCHEMA_VERSION exists so that the day a save actually needs to
   change shape — a renamed field, a restructured `crew`, coins splitting
   into coins and gems — there is somewhere for that migration to live and
   a way to tell an old profile from a current one. Nothing in the game
   depends on the number being anything other than 1 yet; this file is
   making sure the machinery underneath it works before that day arrives,
   not after.
   ========================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getProfile, migrateProfile, PROFILE_SCHEMA_VERSION } from '../server/profiles.js';

test('a freshly created profile is already current', () => {
  const p = getProfile('schema-fresh-' + Math.random().toString(36).slice(2));
  assert.equal(p.schemaVersion, PROFILE_SCHEMA_VERSION);
});

test('a profile from before the field existed is brought up to date', () => {
  // every profile written before this file existed looks exactly like this:
  // real data, no schemaVersion key at all
  const legacy = { coins: 4200, rounds: 12, rating: 1450 };
  const migrated = migrateProfile(legacy);
  assert.equal(migrated.schemaVersion, PROFILE_SCHEMA_VERSION);
  // migrating is not re-creating: nothing it already had should move
  assert.equal(migrated.coins, 4200);
  assert.equal(migrated.rounds, 12);
  assert.equal(migrated.rating, 1450);
});

test('migrating an already-current profile changes nothing', () => {
  const p = { schemaVersion: PROFILE_SCHEMA_VERSION, coins: 900 };
  const again = migrateProfile(p);
  assert.equal(again, p, 'migrateProfile should not need to replace the object');
  assert.equal(again.schemaVersion, PROFILE_SCHEMA_VERSION);
  assert.equal(again.coins, 900);
});

test('migrateProfile survives a call with nothing to migrate', () => {
  assert.equal(migrateProfile(null), null);
  assert.equal(migrateProfile(undefined), undefined);
});
