/* =========================================================================
   purity.js — how far a decal has been polished
   -------------------------------------------------------------------------
   A decal used to be binary: owned or not. Once a case roll had nothing new
   left to give (see cases.js's rollCase, the 'purity' result kind), it
   still gave nothing — a flat gem payout, forever, on every open after
   that. Now a duplicate pull polishes the decal you already have instead,
   0 to 100, six bands from Raw to Flawless. Ascending, not CS:GO's
   descending wear scale — this is "how far it's been refined", not "how
   beat up it is" — but the same idea: a number nobody chose, sitting
   underneath a name, that keeps a fully-owned account's cases worth
   opening.
   ========================================================================= */

const TIERS = [
  { max: 19,  name: 'Raw',      color: '#9fb0a6' },
  { max: 39,  name: 'Cut',      color: '#7fd0a0' },
  { max: 59,  name: 'Polished', color: '#5ab8ff' },
  { max: 79,  name: 'Refined',  color: '#c77dff' },
  { max: 99,  name: 'Pristine', color: '#ffd94a' },
  { max: 100, name: 'Flawless', color: '#f4f8ff' }
];

/** The band a purity value (0-100) falls into — a name and a colour,
 *  nothing else, for wherever a decal's purity gets shown. */
export function purityTier(v) {
  const n = Math.max(0, Math.min(100, Number(v) || 0));
  return TIERS.find(t => n <= t.max) || TIERS[TIERS.length - 1];
}
