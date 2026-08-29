/* =========================================================================
   gear.js — equipment that actually changes the ball
   -------------------------------------------------------------------------
   Purchasable upgrades, applied INSIDE the server's own simulation.  The
   numbers live here, shared, so the client's preview and the server's ruling
   use the identical multipliers — a client can lie about its gear to its own
   preview, but the shot that counts is simulated with the gear the server
   has on file.

   The effects are deliberately modest: an upgraded driver is a handful of
   yards, not a different sport.  Buying gear buys polish, not victory.
   ========================================================================= */

/* Costs scaled ~8x from their original values (a flagged balance pass, not a
   bug fix): a level-par 9-hole round nets roughly 5,400 coins, and the
   original prices summed to 4,700 — the ENTIRE gear shop, all six items,
   was affordable inside a single round. Every other sink in the economy is
   a real grind (caddies ~59 rounds to max, the club ladder 147-300+), so
   gear was the one shop category with no progression curve at all. Now the
   full set totals ~35,500, about 6-7 rounds — still clearly the quick early
   tier relative to caddies/clubs, just no longer trivial.

   (Those per-round figures were at economy.js's old PAYOUT_SCALE; a level-
   par round now nets ~7,470, which drops this same 35,500 to about 5
   rounds. Still the quick early tier — nothing here needed to change,
   the whole curve just moved with the scale, which is the point of
   having one.) */
export const SHOP = {
  ball_tour: {
    name: 'Tour ball', cost: 3000, slot: 'ball', tier: 1, rarity: 'standard',
    blurb: '+1% ball speed, +3% spin — holds its line in wind',
    /* `gains` is the same promise as `blurb`, in a shape the shop can put
       on a comparison row. Authored rather than derived from gearEffect
       below, because that function answers "what does this bag do to this
       club" and a shop card asks "what would this ONE purchase change" —
       two questions with different answers on an item that only helps
       irons. They must agree, and a test holds them to it. */
    gains: [['Ball speed', '+1%'], ['Spin', '+3%']]
  },
  ball_pro: {
    name: 'Pro ball', cost: 9000, slot: 'ball', tier: 2, requires: 'ball_tour',
    rarity: 'pro',
    blurb: '+2% ball speed, +5% spin — checks up hard on the green',
    gains: [['Ball speed', '+2%'], ['Spin', '+5%']]
  },
  irons_plus: {
    name: 'Forged irons', cost: 6000, slot: 'irons', tier: 1, rarity: 'tour',
    blurb: 'About +3 yards on every iron and wedge',
    gains: [['Iron distance', '+1.2%'], ['Carry', '≈ +3 yds']]
  },
  woods_plus: {
    name: 'Carbon woods', cost: 7500, slot: 'woods', tier: 1, rarity: 'tour',
    blurb: 'About +5 yards off the tee',
    gains: [['Wood distance', '+1.1%'], ['Carry', '≈ +5 yds']]
  },
  putter_pro: {
    name: 'Milled putter', cost: 4500, slot: 'putter', tier: 1, rarity: 'tour',
    blurb: 'The green read extends past the cup, showing the run-out',
    gains: [['Green read', 'past the cup']]
  },
  cart_tune: {
    name: 'Tuned cart', cost: 5500, slot: 'cart', tier: 1, rarity: 'standard',
    blurb: '+12% top speed and a stronger motor on your golf cart',
    gains: [['Cart top speed', '+12%']]
  }
};

/* Every item carries a `rarity` on the SAME five-rung ladder as cases, club
   sets and decals — standard / tour / pro / legend / mythic. Not a second
   vocabulary invented for the shop: a player should not have to learn which
   screen says "Epic" and which says "Pro" for the same idea.

   Gear tops out at `pro` on purpose. The best thing in this shop is a Pro
   ball, and the Legend and Mythic rungs belong to the club sets, which come
   from a case and are the actual chase. A shop that sold a Mythic anything
   for coins would flatten that. */
export const GEAR_RARITY_ORDER = ['standard', 'tour', 'pro', 'legend', 'mythic'];

/**
 * What buying this item would change, as rows a card can show BEFORE the
 * money is spent. A price with no visible consequence is not a decision.
 */
export function gearPreview(key) {
  const it = Object.hasOwn(SHOP, key) ? SHOP[key] : null;
  if (!it) return null;
  return {
    name: it.name, cost: it.cost, rarity: it.rarity || 'standard',
    slot: it.slot, tier: it.tier,
    gains: it.gains || [], requires: it.requires || null
  };
}

/** A fresh profile owns nothing. */
export const NO_GEAR = Object.freeze({ ball: 0, irons: 0, woods: 0, putter: 0, cart: 0 });

/**
 * The multipliers a given bag of gear earns for a given club.
 * Everything defaults to exactly 1 — no gear, no change, and the physics
 * test suite runs entirely in this configuration.
 */
export function gearEffect(gear, club) {
  let speed = 1, spin = 1;
  if (!gear) return { speed, spin };
  if (gear.ball >= 1) { speed *= 1.010; spin *= 1.03; }
  if (gear.ball >= 2) { speed *= 1.010; spin *= 1.02; }
  if (club) {
    if (gear.irons >= 1 && (club.type === 'iron' || club.type === 'wedge')) speed *= 1.012;
    if (gear.woods >= 1 && (club.type === 'wood' || club.type === 'hybrid')) speed *= 1.011;
  }
  return { speed, spin };
}

/** Can this profile buy this item right now?  Returns null or a reason. */
export function purchaseBlocked(item, profile) {
  // Own-property lookup only: item names come off the wire, and a key like
  // 'constructor' would otherwise resolve up the prototype chain to something
  // truthy with an undefined cost — and undefined arithmetic NaNs the balance.
  const it = Object.hasOwn(SHOP, item) ? SHOP[item] : null;
  if (!it) return 'No such item.';
  const owned = profile.gear || NO_GEAR;
  const slotTier = owned[it.slot] || 0;
  if (slotTier >= it.tier) return 'Already owned.';
  if (it.requires) {
    const req = Object.hasOwn(SHOP, it.requires) ? SHOP[it.requires] : null;
    if (req && (owned[req.slot] || 0) < req.tier) return `Needs ${req.name} first.`;
  }
  if ((profile.coins || 0) < it.cost) return `Costs ${it.cost} coins — you have ${profile.coins || 0}.`;
  return null;
}
