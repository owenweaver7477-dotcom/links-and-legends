/* =========================================================================
   clubskins.js — what your clubs LOOK like, separately from what they do
   -------------------------------------------------------------------------
   The club set has always been one axis: six tiers, each one strictly better
   and strictly more expensive than the last, and each one looking however
   the tier decided. So a player at the top of the ladder has the same clubs
   as every other player at the top of the ladder, and a player at the bottom
   has no way to make theirs theirs.

   A finish is the other axis. It changes nothing about the ball — that is
   the whole point, and it is why these can be given away for things like a
   hole in one without turning an achievement into an advantage.

   TWO WAYS TO EARN ONE, and they are deliberately different in kind.

     LEVEL finishes arrive for turning up. You will get all of them
     eventually, and they mark how long you have played.

     FEAT finishes arrive for doing something specific and are the only
     things in this game you cannot get by grinding: an ace, an albatross,
     a course record. A player wearing one has a story, and the finish is
     how they tell it without saying anything.

   Nothing here touches speed, forgiveness or spin. A finish that made the
   ball go further would make every achievement a power creep, and the
   player who has not had a hole in one would be playing a worse game for a
   reason they cannot fix by practising.
   ========================================================================= */

/* `need` is how the finish is earned:
     { level: n }         reach that level
     { aces: n }          n holes in one
     { eagles: n }        n eagles or better
     { birdies: n }
     { records: n }       n course or hole records held
     { rounds: n }        n complete rounds
     { clubTier: n }      own that set — a finish only the top set can wear
   `shaft`, `head` and `grip` are what shopview and the avatar draw. */
/* One accent colour per SET TIER (not a skin) — the same seven colours
   avatar.js's setClub() paints the actual club with, duplicated here on
   purpose rather than imported: avatar.js pulls in the whole THREE.js
   client stack, and this is presentation data for a 2D shop card, not a
   3D model. The top three tiers use their real glow colour so a Titanium
   or Signature card looks like what you're actually holding; the bottom
   four have no glow in-game, so their head colour stands in instead. */
export const TIER_ACCENT = [
  '#6e5432', '#8a5a42', '#3a3d42', '#1d1f24', '#141821', '#2f5060', '#6a34a0'
];

export const CLUB_SKINS = [
  { id: 'stock', name: 'Stock', blurb: 'However the set came.',
    need: null, shaft: null, head: null, grip: null },

  /* ---- turning up ---------------------------------------------------- */
  { id: 'brushed', name: 'Brushed steel', blurb: 'Matte, honest, hard to mark.',
    need: { level: 6 }, shaft: '#c2c6cc', head: '#d6d9de', grip: '#2b2b2f' },
  { id: 'blackout', name: 'Blackout', blurb: 'No shine to give you away.',
    need: { level: 18 }, shaft: '#2a2d32', head: '#22252a', grip: '#101014' },
  { id: 'copper', name: 'Copper', blurb: 'Warms up as it wears.',
    need: { level: 30 }, shaft: '#b0714a', head: '#c88a5e', grip: '#3a2b22' },
  { id: 'ivory', name: 'Ivory grip', blurb: 'Pale leather, wound by hand.',
    need: { level: 44 }, shaft: '#d8dbe0', head: '#e8eaee', grip: '#e6dfcd' },
  { id: 'gunmetal', name: 'Gunmetal', blurb: 'Heavy-looking, and it is.',
    need: { level: 58 }, shaft: '#5a5f66', head: '#464b52', grip: '#1c1c20' },
  { id: 'carbonweave', name: 'Carbon weave', blurb: 'Woven, not painted.',
    need: { level: 72 }, shaft: '#2e3136', head: '#1a1c20', grip: '#0d0d10',
    sheen: 0.9 },
  { id: 'platinum', name: 'Platinum', blurb: 'The last one on the ladder.',
    need: { level: 90 }, shaft: '#dfe6ec', head: '#eef2f6', grip: '#2b2b2f',
    sheen: 1 },

  /* ---- feats. Not buyable, not grindable. ----------------------------- */
  { id: 'ace-gold', name: 'Ace gold', blurb: 'For a hole in one.',
    need: { aces: 1 }, shaft: '#e8c15a', head: '#f0d92a', grip: '#3a2f14',
    sheen: 1, feat: true },
  { id: 'ace-triple', name: 'Triple ace', blurb: 'Three holes in one.',
    need: { aces: 3 }, shaft: '#ffd94a', head: '#fff0a8', grip: '#2a2410',
    sheen: 1, glow: '#ffd94a', feat: true },
  { id: 'eagle-wing', name: 'Eagle wing', blurb: 'Ten eagles or better.',
    need: { eagles: 10 }, shaft: '#a98cd8', head: '#c8b3ea', grip: '#241c33',
    sheen: 0.8, feat: true },
  { id: 'birdie-run', name: 'Birdie run', blurb: 'A hundred birdies.',
    need: { birdies: 100 }, shaft: '#6fce8a', head: '#9ae0ad', grip: '#16301f',
    sheen: 0.7, feat: true },
  { id: 'record', name: 'Record holder', blurb: 'Hold a course record.',
    need: { records: 1 }, shaft: '#8fe07a', head: '#c3f0b6', grip: '#152b12',
    sheen: 0.9, glow: '#8fe07a', feat: true },
  { id: 'veteran', name: 'Veteran', blurb: 'Two hundred rounds.',
    need: { rounds: 200 }, shaft: '#9c8f76', head: '#b3a48c', grip: '#2a241c',
    feat: true },
  { id: 'tour-issue', name: 'Tour issue', blurb: 'Only on the top set.',
    need: { clubTier: 5 }, shaft: '#22252a', head: '#c8382f', grip: '#0d0d10',
    sheen: 1, feat: true }
];

export const skinById = id => CLUB_SKINS.find(s => s.id === id) || CLUB_SKINS[0];

/**
 * Has this profile earned this finish?
 *
 * Takes the whole profile rather than a level, because half of these are
 * about what somebody has DONE and there is no single number for that.
 */
export function skinEarned(skin, p) {
  if (!skin?.need) return true;
  const n = skin.need;
  if (n.level != null) return (p?.level ?? 1) >= n.level;
  if (n.aces != null) return (p?.aces ?? 0) >= n.aces;
  if (n.eagles != null) return (p?.eagles ?? 0) >= n.eagles;
  if (n.birdies != null) return (p?.birdies ?? 0) >= n.birdies;
  if (n.rounds != null) return (p?.rounds ?? 0) >= n.rounds;
  if (n.records != null) return (p?.records ?? 0) >= n.records;
  if (n.clubTier != null) return (p?.clubTier ?? 0) >= n.clubTier;
  return false;
}

/** What it says on a locked one — the thing to go and do. */
export function skinRequirement(skin) {
  const n = skin?.need;
  if (!n) return '';
  if (n.level != null) return `Level ${n.level}`;
  if (n.aces != null) return n.aces === 1 ? 'A hole in one' : `${n.aces} holes in one`;
  if (n.eagles != null) return `${n.eagles} eagles`;
  if (n.birdies != null) return `${n.birdies} birdies`;
  if (n.rounds != null) return `${n.rounds} rounds`;
  if (n.records != null) return 'Hold a course record';
  if (n.clubTier != null) return 'Own the top club set';
  return '';
}

/** How close they are, for the progress line under a locked finish. */
export function skinProgress(skin, p) {
  const n = skin?.need;
  if (!n) return null;
  const pairs = [['level', p?.level ?? 1], ['aces', p?.aces ?? 0], ['eagles', p?.eagles ?? 0],
                 ['birdies', p?.birdies ?? 0], ['rounds', p?.rounds ?? 0],
                 ['records', p?.records ?? 0], ['clubTier', p?.clubTier ?? 0]];
  for (const [k, have] of pairs) {
    if (n[k] != null) return { have, want: n[k], pct: Math.min(1, have / n[k]) };
  }
  return null;
}

/** Everything a profile has earned, for the picker. */
export const skinsFor = p => CLUB_SKINS.filter(s => skinEarned(s, p));

/** Validate a chosen finish against a profile — the server's gate. */
export function normaliseSkin(id, p) {
  const s = CLUB_SKINS.find(x => x.id === id);
  return s && skinEarned(s, p) ? s.id : 'stock';
}
