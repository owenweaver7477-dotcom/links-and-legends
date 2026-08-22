/* =========================================================================
   cases.js — what a chest actually contains
   -------------------------------------------------------------------------
   The tempting version of this file invents a whole new item pool: new
   decal art, new trail colours, a rarity ladder nobody has seen before.
   That means new rendering code, new places for a case-exclusive id to
   collide with a level-earned one, and a second cosmetic system sitting
   next to the first one wardrobe.js and unlocks.js already got right.

   So a case draws from the SAME 100-level unlock table everybody already
   earns by playing — decal, trail, title and ball-finish only, the four
   kinds that ride the generic `known`-set ownership check in avatars.js
   (emotes, melees and hats are validated differently and are level-only,
   deliberately left out of the case pool rather than bolting on a second
   enforcement path for them). A case is an accelerated, randomised way to
   reach an item you would otherwise wait dozens of levels for — not a
   parallel currency of stuff. Nothing here needed a single new asset.

   Rarity is DERIVED, not authored twice: how deep an item sits in the
   level table already encodes how much of a flex it is, so the four tiers
   below are just that same table cut into quartiles. A level-95 pull
   landing on a level-14 account is exactly the story a case is supposed to
   tell.
   ========================================================================= */
import { UNLOCKS } from './unlocks.js';

const CASE_KINDS = new Set(['decal', 'trail', 'title', 'ball']);

/* Mythic carves off the top of what used to be Legend's whole back half
   (86-100 -> 86-84... i.e. the last three items on the table: Prism,
   Signature holo, Centurion) rather than inventing a fifth slice of
   content nobody earns by levelling. Same rule as every other tier here:
   how deep an item sits in the level table already says how rare it is,
   Mythic just draws the cut line closer to the top. */
const RARITY_BOUNDS = [
  { id: 'standard', name: 'Standard', color: '#9fb0a6', weight: 70,  max: 25 },
  { id: 'tour',     name: 'Tour',     color: '#5ab8ff', weight: 22,  max: 50 },
  { id: 'pro',      name: 'Pro',      color: '#c77dff', weight: 7,   max: 75 },
  { id: 'legend',   name: 'Legend',   color: '#ffd94a', weight: 0.9, max: 84 },
  { id: 'mythic',   name: 'Mythic',   color: '#ff3864', weight: 0.1, max: 100 }
];
export const RARITIES = RARITY_BOUNDS.map(({ id, name, color }) => ({ id, name, color }));
const rarityFor = at => RARITY_BOUNDS.find(r => at <= r.max) || RARITY_BOUNDS[RARITY_BOUNDS.length - 1];

/** The full case pool, each entry tagged with the rarity its level implies. */
export const CASE_POOL = UNLOCKS
  .filter(u => CASE_KINDS.has(u.kind))
  .map(u => ({ ...u, rarity: rarityFor(u.at).id }));

const idOf = u => u.kind + ':' + u.id;
export const caseItemKey = idOf;

/**
 * Roll one case. `owned` is a Set of "kind:id" strings — everything this
 * player already has, from level OR a previous case, so a duplicate can
 * never be handed out as if it were new.
 *
 * Weighted tier first, then a uniform pick inside it. If that tier is
 * completely exhausted (a high-level account that already owns every item
 * in it — rare, but a level-100 player owns the whole Standard tier by
 * definition), the roll falls through to the next tier up rather than
 * failing outright, and if EVERY tier is exhausted the case converts to a
 * flat gem payout. A case that can come back empty is a case nobody wants
 * to open twice.
 * @param {Set<string>} owned
 * @param {() => number} rand  0..1 generator — Math.random by default, or
 *   injected for a test to make deterministic
 * @returns {{ ok: true, kind: 'item', item: object, rarity: string } |
 *           { ok: true, kind: 'gems', amount: number }}
 */
export function rollCase(owned, rand = Math.random) {
  const totalWeight = RARITY_BOUNDS.reduce((s, r) => s + r.weight, 0);
  let roll = rand() * totalWeight;
  let startIdx = 0;
  for (let i = 0; i < RARITY_BOUNDS.length; i++) {
    if (roll < RARITY_BOUNDS[i].weight) { startIdx = i; break; }
    roll -= RARITY_BOUNDS[i].weight;
    startIdx = i + 1;
  }
  // walk upward from the rolled tier through rarer ones until something is
  // actually available — a thin Pro pool should not fail a whole case
  for (let i = Math.min(startIdx, RARITY_BOUNDS.length - 1); i < RARITY_BOUNDS.length; i++) {
    const tier = RARITY_BOUNDS[i];
    const candidates = CASE_POOL.filter(it => it.rarity === tier.id && !owned.has(idOf(it)));
    if (candidates.length) {
      const item = candidates[Math.floor(rand() * candidates.length)];
      return { ok: true, kind: 'item', item, rarity: tier.id };
    }
  }
  // every tier exhausted — a maxed-out collector still gets something
  return { ok: true, kind: 'gems', amount: 60 };
}
