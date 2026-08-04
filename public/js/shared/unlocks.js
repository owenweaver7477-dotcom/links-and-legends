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
  ball:   { name: 'Ball finish',  blurb: 'How your ball catches the light' }
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
  { at: 12, kind: 'decal', id: 'chevron',     name: 'Chevron',        color: '#ffd94a' },
  { at: 14, kind: 'ball',  id: 'matte',       name: 'Matte finish' },
  { at: 16, kind: 'trail', id: 'ember',       name: 'Ember',          color: '#ff8a3d' },
  { at: 18, kind: 'decal', id: 'houndstooth', name: 'Houndstooth',    color: '#e8eaee' },
  { at: 20, kind: 'title', id: 'clubman',     name: 'Clubman' },
  { at: 23, kind: 'hat',   id: 'wide',        name: 'Wide brim' },
  { at: 26, kind: 'trail', id: 'mint',        name: 'Mint vapour',    color: '#4ce0b3' },
  { at: 29, kind: 'decal', id: 'carbonweave', name: 'Carbon weave',   color: '#2e3136' },

  /* -- thirties to fifties: every four or five, and they get louder -- */
  { at: 33, kind: 'ball',  id: 'pearl',       name: 'Pearlescent' },
  { at: 37, kind: 'title', id: 'sharpshooter',name: 'Sharpshooter' },
  { at: 41, kind: 'decal', id: 'lightning',   name: 'Lightning',      color: '#ffe66b' },
  { at: 45, kind: 'trail', id: 'azure',       name: 'Azure comet',    color: '#38a9ff' },
  { at: 50, kind: 'title', id: 'halfcentury', name: 'Half Century' },
  { at: 55, kind: 'decal', id: 'tartan',      name: 'Tartan',         color: '#7d2f42' },
  { at: 60, kind: 'ball',  id: 'chrome',      name: 'Chrome' },

  /* -- the long tail: rarer, and each one obviously expensive -- */
  { at: 66, kind: 'trail', id: 'violet',      name: 'Violet plume',   color: '#c77dff' },
  { at: 72, kind: 'decal', id: 'goldleaf',    name: 'Gold leaf',      color: '#ffd94a' },
  { at: 78, kind: 'title', id: 'veteran',     name: 'Veteran' },
  { at: 84, kind: 'trail', id: 'aurora',      name: 'Aurora',         color: '#8fe07a' },
  { at: 90, kind: 'ball',  id: 'prism',       name: 'Prism' },
  { at: 95, kind: 'decal', id: 'signature',   name: 'Signature holo', color: '#d8c8f0' },
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
