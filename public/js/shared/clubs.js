/* =========================================================================
   clubs.js — the bag
   -------------------------------------------------------------------------
   Twenty clubs plus a putter.  Lofts and spin rates are real; the ball speeds
   were solved numerically against the flight model so each club's carry lands
   on a real launch-monitor number (test/physics.mjs re-checks it every run).

   The rules of golf let you carry fourteen, so you pick fourteen — and the
   overlaps are the point: a 7 wood, a 2 iron, a 3 iron and a 3 hybrid all go
   about the same distance and fly completely differently.  Listed longest
   first, which is the order Q/E steps through.
   ========================================================================= */

export const CLUBS = [
  // key  label       type      ballSpeed  launch°  backspin  curve  minPow  loft°
  { key: 'DR', label: 'Driver',   type: 'wood',   speed: 74.1, launch: 11.5, spin: 2500,  curve: 1.35, minPow: 0.55, loft: 10.5 },
  { key: 'W3', label: '3 Wood',   type: 'wood',   speed: 66.6, launch: 13.5, spin: 3300,  curve: 1.20, minPow: 0.50, loft: 15 },
  { key: 'W5', label: '5 Wood',   type: 'wood',   speed: 62.4, launch: 15.0, spin: 3900,  curve: 1.12, minPow: 0.50, loft: 18 },
  { key: 'I2', label: '2 Iron',   type: 'iron',   speed: 60.7, launch: 15.0, spin: 3900,  curve: 1.14, minPow: 0.45, loft: 18 },
  { key: 'W7', label: '7 Wood',   type: 'wood',   speed: 59.7, launch: 16.5, spin: 4400,  curve: 1.06, minPow: 0.48, loft: 21 },
  { key: 'I3', label: '3 Iron',   type: 'iron',   speed: 58.8, launch: 16.5, spin: 4300,  curve: 1.08, minPow: 0.42, loft: 21 },
  { key: 'H3', label: '3 Hybrid', type: 'hybrid', speed: 58.7, launch: 16.0, spin: 4300,  curve: 1.02, minPow: 0.44, loft: 19 },
  { key: 'I4', label: '4 Iron',   type: 'iron',   speed: 57.2, launch: 17.5, spin: 4700,  curve: 1.02, minPow: 0.40, loft: 24 },
  { key: 'H4', label: '4 Hybrid', type: 'hybrid', speed: 56.1, launch: 17.5, spin: 4700,  curve: 0.99, minPow: 0.42, loft: 22 },
  { key: 'I5', label: '5 Iron',   type: 'iron',   speed: 54.4, launch: 19.0, spin: 5300,  curve: 0.96, minPow: 0.40, loft: 27 },
  { key: 'H5', label: '5 Hybrid', type: 'hybrid', speed: 53.7, launch: 19.0, spin: 5200,  curve: 0.96, minPow: 0.40, loft: 25 },
  { key: 'I6', label: '6 Iron',   type: 'iron',   speed: 51.8, launch: 21.0, spin: 6100,  curve: 0.90, minPow: 0.35, loft: 30 },
  { key: 'I7', label: '7 Iron',   type: 'iron',   speed: 49.2, launch: 23.0, spin: 6900,  curve: 0.84, minPow: 0.30, loft: 34 },
  { key: 'I8', label: '8 Iron',   type: 'iron',   speed: 46.6, launch: 25.5, spin: 7800,  curve: 0.78, minPow: 0.25, loft: 38 },
  { key: 'I9', label: '9 Iron',   type: 'iron',   speed: 44.1, launch: 28.0, spin: 8700,  curve: 0.72, minPow: 0.20, loft: 42 },
  { key: 'PW', label: 'Pitching', type: 'wedge',  speed: 41.7, launch: 30.5, spin: 9400,  curve: 0.66, minPow: 0.15, loft: 46 },
  { key: 'GW', label: 'Gap',      type: 'wedge',  speed: 38.7, launch: 33.0, spin: 10000, curve: 0.60, minPow: 0.10, loft: 50 },
  { key: 'SW', label: 'Sand',     type: 'wedge',  speed: 34.9, launch: 36.5, spin: 10600, curve: 0.55, minPow: 0.05, loft: 54 },
  { key: 'LW', label: 'Lob',      type: 'wedge',  speed: 30.7, launch: 43.0, spin: 11200, curve: 0.50, minPow: 0.05, loft: 58 },
  { key: 'XW', label: 'Flop',     type: 'wedge',  speed: 27.9, launch: 48.0, spin: 11500, curve: 0.45, minPow: 0.05, loft: 64 },
  { key: 'PT', label: 'Putter',   type: 'putter', speed: 6.4,  launch: 0.6,  spin: 0,     curve: 0.30, minPow: 0.02, loft: 3, putter: true }
];

export const CLUB_BY_KEY = Object.fromEntries(CLUBS.map(c => [c.key, c]));
export const PUTTER = CLUB_BY_KEY.PT;

/** The rules let you carry fourteen. */
export const BAG_SIZE = 14;

/** A sensible default set: driver, two woods, a hybrid, irons 5–9, four wedges. */
export const DEFAULT_BAG = ['DR', 'W3', 'W5', 'H4', 'I5', 'I6', 'I7', 'I8', 'I9', 'PW', 'GW', 'SW', 'LW', 'PT'];

/**
 * Keep a bag legal: putter always in, never more than BAG_SIZE, longest first.
 * Carrying FEWER than fourteen is perfectly legal, so padding is opt-in — pad
 * only when filling a brand-new bag, never while the player is editing one, or
 * removing a club would instantly put it back.
 */
export function normaliseBag(keys, { pad = false } = {}) {
  const order = CLUBS.map(c => c.key);
  const valid = (Array.isArray(keys) ? keys : []).filter(k => CLUB_BY_KEY[k] && k !== 'PT');
  const uniq = [...new Set(valid)].slice(0, BAG_SIZE - 1);
  if (pad) for (const k of DEFAULT_BAG) {
    if (uniq.length >= BAG_SIZE - 1) break;
    if (k !== 'PT' && !uniq.includes(k)) uniq.push(k);
  }
  uniq.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return [...uniq, 'PT'];
}

/** Nominal full carry in metres, filled in by ballistics.js at load. */
export const CARRY = {};

/**
 * Pick a club for the shot in front of you, from the clubs you are carrying.
 * The green gets the putter, a bunker gets loft, otherwise take the shortest
 * club that still covers the distance.
 */
export function suggestClub(distanceM, surfaceId, onGreen, bag = null) {
  const carried = (bag && bag.length ? bag : CLUBS.map(c => c.key)).filter(k => CLUB_BY_KEY[k]);
  const has = k => carried.includes(k);
  if (onGreen || surfaceId === 'green') return PUTTER;

  if (surfaceId === 'sand') {
    // you need loft to get out; shortest lofted club that still gets there
    for (const k of ['XW', 'LW', 'SW', 'GW', 'PW', 'I9']) {
      if (has(k) && (CARRY[k] || 0) * 0.8 >= distanceM) return CLUB_BY_KEY[k];
    }
    for (const k of ['SW', 'LW', 'GW', 'PW', 'XW', 'I9']) if (has(k)) return CLUB_BY_KEY[k];
  }

  let best = null;
  for (const c of CLUBS) {                            // longest first
    if (c.putter || !has(c.key)) continue;
    if (!best) best = c;                              // fallback: the longest we carry
    if ((CARRY[c.key] || 0) >= distanceM) best = c;   // keep taking shorter clubs that still reach
  }
  return best || PUTTER;
}

export function clubIndex(key, bag = null) {
  const list = bag && bag.length ? bag : CLUBS.map(c => c.key);
  return list.indexOf(key);
}
