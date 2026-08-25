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

/** Where a tier sits on the ladder, standard=0 through mythic=4 — for
 *  comparing two rarities ("did this pull meet or beat the pity tier")
 *  without either side reaching into RARITY_BOUNDS directly. */
export const tierIndex = id => RARITY_BOUNDS.findIndex(r => r.id === id);

/** The same level-derived tier, for anything gated by level rather than
 *  drawn from a case — the wardrobe's own items use this so a rare
 *  fabric or a deep-level outfit reads with the same colour language a
 *  case pull does, instead of the two systems inventing their own. */
export const rarityForLevel = at => rarityFor(Number(at) || 0);

/** The full case pool, each entry tagged with the rarity its level implies. */
export const CASE_POOL = UNLOCKS
  .filter(u => CASE_KINDS.has(u.kind))
  .map(u => ({ ...u, rarity: rarityFor(u.at).id }));

const idOf = u => u.kind + ':' + u.id;
export const caseItemKey = idOf;

/* The pity counter. A gambling mechanic with no floor is the version that
   gets a game called predatory; one where "how much worse can this get"
   has a hard, published answer is the version that does not. Pro is the
   tier picked rather than Legend or Mythic because THOSE staying rare is
   the whole reason a pull feels earned — the floor exists so a long run of
   Standard duplicates-of-luck cannot happen, not so the top tiers stop
   being special. */
export const PITY_TIER = 'pro';
export const PITY_THRESHOLD = 20;

/* Prices for both case types — shared so the Pro Shop's cards and the
   server's ruling can never quote different numbers, the same reason
   economy.js and crew.js's tables are shared rather than duplicated.

   The standard case (Fairway Supply Crate) moved from a 100-gem price to a
   coin one to match the reference design's entry tier being earnable
   through ordinary play rather than the premium currency. At 2,500 that's
   a third of a single level-par round (~7,470, see economy.js) — a
   same-session purchase, not a grind, but a real one rather than an
   afterthought. The top case (Hole-in-One Case) stays at 400 gems: the
   reference design shows 1200, but login rewards only pay out ~215 gems
   per 14-day cycle, so a 3x hike there is a real economy call, not a
   cosmetic one — deliberately left for a dedicated pass rather than
   guessed at here. */
export const CASE_COIN_COST = 2500;
export const VAULT_GEM_COST = 150;
export const PRO_CASE_GEM_COST = 400;

/** The odds a player is shown before they open anything — every tier's
 *  real share of the roll (not rounded away to nothing for Mythic), which
 *  kinds of item can come from it, and how many items are actually in that
 *  slice of the pool right now. Static: nothing here reads player state,
 *  so a case's contents preview is the same for everyone. */
export function tierOdds() {
  const totalWeight = RARITY_BOUNDS.reduce((s, r) => s + r.weight, 0);
  return RARITY_BOUNDS.map(r => {
    const items = CASE_POOL.filter(it => it.rarity === r.id);
    return {
      id: r.id, name: r.name, color: r.color,
      pct: (r.weight / totalWeight) * 100,
      kinds: [...new Set(items.map(it => it.kind))],
      count: items.length
    };
  });
}

/** The odds for any forced-floor roll (PITY_TIER and above, or any other
 *  tier a case wants to guarantee), re-weighted so the eligible tiers sum
 *  to 100% on their own rather than reading as tiny slices of the full
 *  ladder they no longer share. Shared by every case type that guarantees
 *  a floor rather than rolling the whole ladder. */
function oddsFromFloor(floorId) {
  const eligible = RARITY_BOUNDS.filter(r => tierIndex(r.id) >= tierIndex(floorId));
  const totalWeight = eligible.reduce((s, r) => s + r.weight, 0);
  return eligible.map(r => {
    const items = CASE_POOL.filter(it => it.rarity === r.id);
    return {
      id: r.id, name: r.name, color: r.color,
      pct: (r.weight / totalWeight) * 100,
      kinds: [...new Set(items.map(it => it.kind))],
      count: items.length
    };
  });
}
/** The Pro Case's own contents preview — see oddsFromFloor. */
export function proTierOdds() { return oddsFromFloor(PITY_TIER); }
/** The Vault's floor is one rung below the Pro Case's: guaranteed Tour or
 *  better rather than guaranteed Pro or better, so the three cases form an
 *  actual ladder (natural odds -> Tour+ -> Pro+) instead of two identical
 *  floors wearing different prices. */
export const VAULT_TIER = 'tour';
export function vaultTierOdds() { return oddsFromFloor(VAULT_TIER); }

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
 * @param {boolean|string} forcePity  `false` rolls the whole ladder at its
 *   natural weights. `true` skips straight to PITY_TIER, same as always —
 *   the caller (profiles.js's openCase) decides when the counter has run
 *   out. A tier id (e.g. 'tour') skips straight to THAT tier instead, for
 *   a case that guarantees a different floor than the Pro Case's (the
 *   Vault's openVaultCase passes VAULT_TIER here).
 * @param {{ [decalId: string]: number }} purity  each owned decal's current
 *   0-100 purity, so a fully-exhausted roll can polish one instead of
 *   handing back nothing — see the fallback below.
 * @returns {{ ok: true, kind: 'item', item: object, rarity: string } |
 *           { ok: true, kind: 'purity', item: object, gain: number, newPurity: number } |
 *           { ok: true, kind: 'gems', amount: number }}
 */
export function rollCase(owned, rand = Math.random, forcePity = false, purity = {}) {
  let startIdx;
  if (forcePity === false) {
    const totalWeight = RARITY_BOUNDS.reduce((s, r) => s + r.weight, 0);
    let roll = rand() * totalWeight;
    startIdx = 0;
    for (let i = 0; i < RARITY_BOUNDS.length; i++) {
      if (roll < RARITY_BOUNDS[i].weight) { startIdx = i; break; }
      roll -= RARITY_BOUNDS[i].weight;
      startIdx = i + 1;
    }
  } else {
    startIdx = tierIndex(forcePity === true ? PITY_TIER : forcePity);
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
  // Every tier exhausted — genuinely nothing new left to hand out. Rather
  // than a flat, dead payout every single time from here on (the exact
  // thing that makes a maxed-out account's cases feel pointless to open),
  // an owned decal that isn't already Flawless gets polished instead —
  // see purity.js for what the resulting number means on screen. Only
  // decals: trail/title/ball have no equivalent "getting purer" visual, so
  // those still fall straight to gems once exhausted, same as always.
  const upgradeable = CASE_POOL.filter(it =>
    it.kind === 'decal' && owned.has(idOf(it)) && (purity[it.id] || 0) < 100);
  if (upgradeable.length) {
    const item = upgradeable[Math.floor(rand() * upgradeable.length)];
    const from = purity[item.id] || 0;
    const gain = Math.min(100 - from, 6 + Math.floor(rand() * 9));   // +6..14
    return { ok: true, kind: 'purity', item, gain, newPurity: from + gain };
  }
  // a maxed-out collector — every item AND every decal's purity — still gets something
  return { ok: true, kind: 'gems', amount: 60 };
}
