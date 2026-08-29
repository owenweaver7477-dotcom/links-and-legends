/* =========================================================================
   mastery.js — how many shots you have actually hit with a club
   -------------------------------------------------------------------------
   PRESTIGE ONLY, and that is load-bearing rather than a limitation. Club
   sets are already the one place power comes from a case (see clubsets.js);
   making time-in-game a THIRD source of distance would mean a player who
   has hit ten thousand 7 irons out-drives one who has not, on top of
   rarity and on top of collection. That is the point where equipment stops
   being a choice and becomes a tax on hours played.

   So mastery buys a number, a name and a mark on the club. Nothing else.
   test/xp.mjs asserts it never reaches crewEffect.
   ========================================================================= */

/* Thresholds in SHOTS. Deliberately reachable early and then long: the
   first rank should arrive inside a round or two so the system announces
   itself, and the last should be something almost nobody has. */
const RANKS = [
  { at: 0,     name: 'Unranked',  color: '#5f7266' },
  { at: 25,    name: 'Familiar',  color: '#9fb0a6' },
  { at: 100,   name: 'Practised', color: '#7fd0a0' },
  { at: 300,   name: 'Sharp',     color: '#5ab8ff' },
  { at: 750,   name: 'Trusted',   color: '#c77dff' },
  { at: 1500,  name: 'Signature', color: '#ffd94a' },
  { at: 3000,  name: 'Mastered',  color: '#ff3864' }
];

export const MASTERY_RANKS = RANKS;

/** The rank a shot count has reached, and how far into the next one. */
export function masteryRank(shots) {
  const n = Math.max(0, Math.floor(Number(shots) || 0));
  let i = 0;
  for (let k = 0; k < RANKS.length; k++) if (n >= RANKS[k].at) i = k;
  const here = RANKS[i];
  const next = RANKS[i + 1] || null;
  return {
    level: i, name: here.name, color: here.color, shots: n,
    next: next ? next.at : null,
    into: next ? n - here.at : 0,
    need: next ? next.at - here.at : 0,
    pct: next ? Math.min(1, (n - here.at) / (next.at - here.at)) : 1
  };
}

/** Total shots across every club — the one number a profile card wants. */
export const totalShots = mastery =>
  Object.values(mastery || {}).reduce((a, v) => a + (Number(v) || 0), 0);

/** The clubs you have hit most, best first. */
export function topClubs(mastery, n = 3) {
  return Object.entries(mastery || {})
    .filter(([, v]) => (Number(v) || 0) > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, shots]) => ({ key, shots, rank: masteryRank(shots) }));
}
