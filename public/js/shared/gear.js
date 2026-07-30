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

export const SHOP = {
  ball_tour: {
    name: 'Tour ball', cost: 400, slot: 'ball', tier: 1,
    blurb: '+1% ball speed, +3% spin — holds its line in wind'
  },
  ball_pro: {
    name: 'Pro ball', cost: 1200, slot: 'ball', tier: 2, requires: 'ball_tour',
    blurb: '+2% ball speed, +5% spin — checks up hard on the green'
  },
  irons_plus: {
    name: 'Forged irons', cost: 800, slot: 'irons', tier: 1,
    blurb: 'About +3 yards on every iron and wedge'
  },
  woods_plus: {
    name: 'Carbon woods', cost: 1000, slot: 'woods', tier: 1,
    blurb: 'About +5 yards off the tee'
  },
  putter_pro: {
    name: 'Milled putter', cost: 600, slot: 'putter', tier: 1,
    blurb: 'The green read extends past the cup, showing the run-out'
  }
};

/** A fresh profile owns nothing. */
export const NO_GEAR = Object.freeze({ ball: 0, irons: 0, woods: 0, putter: 0 });

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
  const it = SHOP[item];
  if (!it) return 'No such item.';
  const owned = profile.gear || NO_GEAR;
  const slotTier = owned[it.slot] || 0;
  if (slotTier >= it.tier) return 'Already owned.';
  if (it.requires) {
    const req = SHOP[it.requires];
    if ((owned[req.slot] || 0) < req.tier) return `Needs ${req.name} first.`;
  }
  if ((profile.coins || 0) < it.cost) return `Costs ${it.cost} coins — you have ${profile.coins || 0}.`;
  return null;
}
