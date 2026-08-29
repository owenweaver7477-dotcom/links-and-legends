/* =========================================================================
   unlocks.js — what levelling actually gives you
   -------------------------------------------------------------------------
   Coins buy power; levels buy IDENTITY. Nothing in this file changes how far
   the ball goes, and that separation is deliberate — a player who has ground
   to level 60 should look unmistakable without hitting it further than
   someone who bought the same clubs on day one.

   Everything here is procedural: a decal is a colour and a pattern the club
   shader already understands, a trail is particles the effect pool already
   has. No assets, so a hundred levels of rewards cost nothing to download.

   `at` is the level it arrives. Deliberately spread the whole way to 100,
   because a reward table that stops at 20 tells everyone past 20 that the
   game is finished with them.
   ========================================================================= */

export const UNLOCK_KINDS = {
  emote:  { name: 'Emote',        blurb: 'A new thing to do on the tee' },
  decal:  { name: 'Club decal',   blurb: 'Marks the clubs you carry' },
  trail:  { name: 'Ball trail',   blurb: 'Follows the ball through the air' },
  hat:    { name: 'Headwear',     blurb: 'For the wardrobe' },
  title:  { name: 'Title',        blurb: 'Shown beside your name' },
  melee:  { name: 'Melee',        blurb: 'A new way to lay hands on somebody' },
  cartdecal: { name: 'Cart livery', blurb: 'Painted down the side of your cart' },
  ball:   { name: 'Ball finish',  blurb: 'How your ball catches the light' },
  /* Not a level unlock — nothing in UNLOCKS below has this kind, and
     nothing may: club sets carry real stats and come from the Club Case
     (see clubsets.js), which is exactly what test/xp.mjs's "levels buy
     identity, never power" still forbids here. It lives in this table only
     so the case reveal has a proper display name for one, instead of
     printing the raw kind string. */
  clubset: { name: 'Club set',     blurb: 'The bag you actually swing' }
};

export const UNLOCKS = [
  /* -- the first stretch: something every level, so the system announces
        itself before anybody has decided whether to care -- */
  { at: 2,  kind: 'emote', id: 'wave',        name: 'Wave' },
  { at: 3,  kind: 'emote', id: 'fistpump',    name: 'Fist pump' },
  { at: 4,  kind: 'emote', id: 'twirl',       name: 'Club twirl' },
  { at: 5,  kind: 'emote', id: 'shrug',       name: 'Shrug' },
  { at: 6,  kind: 'emote', id: 'clap',        name: 'Slow clap' },
  { at: 7,  kind: 'decal', id: 'stripe',      name: 'Racing stripe',  color: '#8fe07a' },
  { at: 8,  kind: 'hat',   id: 'flat',        name: 'Flat cap' },
  { at: 9,  kind: 'trail', id: 'faint',       name: 'Faint trace',    color: '#cfe4d3' },
  { at: 10, kind: 'title', id: 'regular',     name: 'Regular' },

  /* -- teens and twenties: every two or three levels -- */
  { at: 11, kind: 'melee', id: 'slap',        name: 'Slap' },
  { at: 12, kind: 'decal', id: 'chevron',     name: 'Chevron',        color: '#ffd94a' },
  { at: 13,  kind: 'decal', id: 'pinstripe',  name: 'Pinstripe',      color: '#cfd6dd' },
  { at: 14, kind: 'ball',  id: 'matte',       name: 'Matte finish', color: '#d4d4d0' },
  { at: 15, kind: 'emote', id: 'bow',         name: 'Take a bow' },
  { at: 16, kind: 'trail', id: 'ember',       name: 'Ember',          color: '#ff8a3d' },
  { at: 17, kind: 'cartdecal', id: 'racer',   name: 'Racing flash',   color: '#ff6b4a' },
  { at: 18, kind: 'decal', id: 'houndstooth', name: 'Houndstooth',    color: '#e8eaee' },
  { at: 19, kind: 'title', id: 'grinder',     name: 'Grinder' },
  { at: 20, kind: 'title', id: 'clubman',     name: 'Clubman' },
  { at: 21, kind: 'emote', id: 'facepalm',    name: 'Facepalm' },
  { at: 22,  kind: 'decal', id: 'dots',       name: 'Polka',          color: '#f0a3c0' },
  { at: 23, kind: 'hat',   id: 'wide',        name: 'Wide brim' },
  { at: 25,  kind: 'decal', id: 'crosshatch', name: 'Crosshatch',     color: '#a8b8a0' },
  { at: 26, kind: 'trail', id: 'mint',        name: 'Mint vapour',    color: '#4ce0b3' },
  { at: 28, kind: 'melee', id: 'kick',        name: 'Boot' },
  { at: 29, kind: 'decal', id: 'carbonweave', name: 'Carbon weave',   color: '#2e3136' },
  { at: 30, kind: 'emote', id: 'point',       name: 'Called it' },
  { at: 31, kind: 'cartdecal', id: 'sidewind', name: 'Sidewinder',    color: '#5ab8ff' },

  /* -- thirties to fifties: every four or five, and they get louder -- */
  { at: 33, kind: 'ball',  id: 'pearl',       name: 'Pearlescent', color: '#f0e6f0' },
  { at: 34, kind: 'trail', id: 'crimson',     name: 'Crimson wake',   color: '#c8382f' },
  { at: 35,  kind: 'decal', id: 'scales',     name: 'Fish scale',     color: '#4fbfa8' },
  { at: 37, kind: 'title', id: 'sharpshooter',name: 'Sharpshooter' },
  { at: 41, kind: 'decal', id: 'lightning',   name: 'Lightning',      color: '#ffe66b' },
  { at: 43,  kind: 'decal', id: 'weave',      name: 'Basket weave',   color: '#c9a05e' },
  { at: 44, kind: 'emote', id: 'dance',       name: 'Little dance' },
  { at: 45, kind: 'trail', id: 'azure',       name: 'Azure comet',    color: '#38a9ff' },
  { at: 46, kind: 'decal', id: 'spiral',      name: 'Spiral',         color: '#ff8a3d' },
  { at: 47, kind: 'cartdecal', id: 'flames',  name: 'Flame front',    color: '#ff9f3d' },
  { at: 49,  kind: 'decal', id: 'arrows',     name: 'Arrowhead',      color: '#ff9f4a' },
  { at: 50, kind: 'title', id: 'halfcentury', name: 'Half Century' },
  { at: 55, kind: 'decal', id: 'tartan',      name: 'Tartan',         color: '#7d2f42' },
  { at: 57,  kind: 'decal', id: 'bolt',       name: 'Double bolt',    color: '#ffe066' },
  { at: 58, kind: 'emote', id: 'flex',        name: 'Flex' },
  { at: 60, kind: 'ball',  id: 'chrome',      name: 'Chrome', color: '#e8ecf0' },
  { at: 61, kind: 'cartdecal', id: 'panels',  name: 'Panel split',    color: '#7fd0a0' },
  { at: 62, kind: 'decal', id: 'diamond',     name: 'Diamond lattice', color: '#3fe0ff' },
  { at: 63, kind: 'trail', id: 'frost',       name: 'Frost trail',    color: '#a6e6ff' },

  /* -- the long tail: rarer, and each one obviously expensive -- */
  { at: 66, kind: 'trail', id: 'violet',      name: 'Violet plume',   color: '#c77dff' },
  { at: 67,  kind: 'decal', id: 'marble',     name: 'Marble',         color: '#e6e2dc' },
  { at: 68, kind: 'trail', id: 'copper',      name: 'Copper trail',   color: '#c8804a' },
  { at: 70, kind: 'emote', id: 'tip',         name: 'Cap tip' },
  { at: 72, kind: 'decal', id: 'goldleaf',    name: 'Gold leaf',      color: '#ffd94a' },
  { at: 74, kind: 'ball',  id: 'opal',        name: 'Opal', color: '#f4d8ec' },
  { at: 76, kind: 'decal', id: 'zigzag',      name: 'Zigzag',         color: '#e8c15a' },
  { at: 77, kind: 'cartdecal', id: 'chrome',  name: 'Chrome wrap',    color: '#dfe6ec' },
  { at: 78, kind: 'title', id: 'veteran',     name: 'Veteran' },
  { at: 80, kind: 'decal', id: 'wave',        name: 'Wave',           color: '#2f9e8a' },
  { at: 81, kind: 'title', id: 'master',      name: 'Master' },
  { at: 82, kind: 'title', id: 'oldhand',     name: 'Old Hand' },
  { at: 83,  kind: 'decal', id: 'circuit',    name: 'Circuit',        color: '#5ce0c0' },
  { at: 84, kind: 'trail', id: 'aurora',      name: 'Aurora',         color: '#8fe07a' },
  { at: 88, kind: 'emote', id: 'sleep',       name: 'Slow play' },
  { at: 90, kind: 'ball',  id: 'prism',       name: 'Prism', color: '#d8e8ff' },
  { at: 91, kind: 'decal', id: 'ripple',      name: 'Ripple',         color: '#5ab8ff' },
  { at: 92, kind: 'cartdecal', id: 'checker', name: 'Chequered flag', color: '#f0f2f5' },
  { at: 94,  kind: 'decal', id: 'starfield',  name: 'Starfield',      color: '#c9b8ff' },
  { at: 95, kind: 'decal', id: 'signature',   name: 'Signature holo', color: '#d8c8f0' },
  { at: 96, kind: 'ball',  id: 'lava',        name: 'Lava flow', color: '#ff6b3d' },
  { at: 100,kind: 'title', id: 'centurion',   name: 'Centurion' }
];

/** Everything a player of this level has earned. */
export const unlocksAt = level =>
  UNLOCKS.filter(u => u.at <= (Number(level) || 1));

/** What arrives between two levels — the level-up moment's contents. */
export const unlockedBetween = (from, to) =>
  UNLOCKS.filter(u => u.at > from && u.at <= to);

/** The next thing to look forward to, or null at the ceiling. */
export const nextUnlock = level =>
  UNLOCKS.find(u => u.at > (Number(level) || 1)) || null;

/** Only the ones of a given kind, for the wardrobe and the shop. */
export const unlocksOfKind = (level, kind) =>
  unlocksAt(level).filter(u => u.kind === kind);

/** Everything of one kind a player can actually equip: the level-gated
 *  ladder PLUS whatever a case has handed them early. This used to be
 *  level-only wherever the wardrobe read it, which meant a decal/trail/
 *  title/ball won from a case above the player's own level had no way
 *  onto the equip screen at all — the item really was owned (caseUnlocks
 *  already had it, and looksEarnedAt already trusted it, see test/
 *  rewards.mjs), there was just never a control that would let you pick
 *  it. Same rule renderClubDecalPicker already applied to decals only;
 *  this is that rule for all four kinds, in the one place both the
 *  wardrobe and the decal picker can share it from. */
export const ownedOfKind = (level, kind, caseUnlocks = []) => {
  const levelOwned = unlocksOfKind(level, kind);
  const levelIds = new Set(levelOwned.map(u => u.id));
  const cased = UNLOCKS.filter(u => u.kind === kind && !levelIds.has(u.id)
    && caseUnlocks.includes(u.kind + ':' + u.id));
  return [...levelOwned, ...cased];
};
