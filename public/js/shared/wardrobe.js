/* =========================================================================
   wardrobe.js — what your golfer is wearing, beyond four colours
   -------------------------------------------------------------------------
   avatars.js gives a shirt colour, a trouser colour, a hat shape and a pair
   of shoes. That is an outfit the way a stick figure is a portrait: enough to
   tell two players apart at twenty metres, and nothing anybody would want to
   look at up close or feel any ownership of.

   This adds the depth — pattern and sheen on the shirt, a cut on the
   trousers, a type of shoe, gloves and a watch and arm sleeves, and decals
   with real placement slots — plus the ready-made outfits that make all of
   that reachable without asking a player to art-direct themselves from a
   blank slate.

   THREE DECISIONS WORTH THE WORDS.

   Everything here is DATA, and every id is short. The look travels on the
   wire to every client in the room on every join, so a wardrobe is a budget:
   ids are two to nine characters and the whole extended look adds well under
   two hundred bytes. Nothing here is a file, a mesh or a downloaded texture —
   patterns and decals are drawn procedurally on a canvas at load (see
   decals.js), which is why a wardrobe this size costs the bundle nothing.

   No real brands, and no real courses. A published game may not put a
   trademark it does not own on a shirt, and "sponsor logos from major golf
   brands and car manufacturers" is a legal problem rather than a feature.
   Every brand here is invented for this game and every course is one of the
   eight this game actually has.

   And custom decals are GENERATED, not uploaded. An arbitrary PNG shown to
   seven strangers in a room is a moderation surface, and this game has no
   moderation and no image storage. A player picks a shape, two colours and
   up to three initials; it travels as about a dozen bytes, it renders
   identically for everybody, and there is nothing to review.
   ========================================================================= */

/* ------------------------------------------------------------- patterns ---
   How the shirt is printed. `weight` is how much of the second colour the
   pattern puts on screen, which the style rating uses — a bold print is a
   louder outfit and it should score as one. */
export const PATTERNS = [
  { id: 'solid',  name: 'Solid',      weight: 0.00 },
  { id: 'stripe', name: 'Stripe',     weight: 0.35 },
  { id: 'pin',    name: 'Pinstripe',  weight: 0.16 },
  { id: 'check',  name: 'Check',      weight: 0.42 },
  { id: 'argyle', name: 'Argyle',     weight: 0.48, at: 10 },
  { id: 'geo',    name: 'Geometric',  weight: 0.52, at: 12 },
  { id: 'camo',   name: 'Camo',       weight: 0.60, at: 18 },
  { id: 'floral', name: 'Floral',     weight: 0.58, at: 26 },
  { id: 'block',  name: 'Colour block', weight: 0.50 },
  { id: 'fade',   name: 'Gradient',   weight: 0.30, at: 24 }
];

/* -------------------------------------------------------------- fabrics ---
   Material response, and the one place a garment choice touches the golf.

   `sheen` drives the renderer: 0 is a matte cotton that takes a flat lambert,
   1 is a technical shell with a specular highlight that moves as you turn.
   `drive` and `acc` are the real, small effects — a performance fabric that
   does not bind across the shoulders is worth a fraction of a percent and
   should not be worth more than that. The numbers are deliberately in the
   range where a good outfit is a nice-to-have and never a requirement. */
export const FABRICS = [
  { id: 'cotton', name: 'Cotton',     sheen: 0.05, drive: 0,      acc: 0.004 },
  { id: 'pique',  name: 'Pique knit', sheen: 0.14, drive: 0.002,  acc: 0.003 },
  { id: 'tech',   name: 'Technical',  sheen: 0.38, drive: 0.008,  acc: 0.002, at: 5 },
  { id: 'shell',  name: 'Windshell',  sheen: 0.62, drive: 0.010,  acc: 0,     at: 26 },
  { id: 'wool',   name: 'Merino',     sheen: 0.10, drive: 0.001,  acc: 0.006 },
  { id: 'silk',   name: 'Silk twill', sheen: 0.78, drive: 0.003,  acc: 0.002, at: 34 },
  { id: 'metal',  name: 'Foil weave', sheen: 1.00, drive: 0.006,  acc: 0.001, at: 55 }
];

/* --------------------------------------------------------------- bottoms --- */
export const CUTS = [
  { id: 'straight', name: 'Straight',  drive: 0,      acc: 0.003 },
  { id: 'slim',     name: 'Slim',      drive: 0.004,  acc: 0.002 },
  { id: 'relaxed',  name: 'Relaxed',   drive: 0.002,  acc: 0.005 },
  { id: 'jogger',   name: 'Jogger',    drive: 0.006,  acc: 0,     at: 8 },
  { id: 'knicker',  name: 'Plus fours', drive: 0,     acc: 0.007, at: 6 },
  { id: 'short',    name: 'Shorts',    drive: 0.005,  acc: 0.001 },
  { id: 'skort',    name: 'Skort',     drive: 0.005,  acc: 0.001 }
];

/* ----------------------------------------------------------------- shoes ---
   Grip is the one thing footwear genuinely does in golf: it is what lets you
   turn hard without the trail foot slipping. So spikes carry the drive
   number and the soft/casual end carries none of it. */
export const SHOE_TYPES = [
  /* Soft spikes first, and that is load-bearing: the fallback for anything
     unrecognised or unearned is the first UNGATED entry, and steel spikes
     used to sit at the head of this list carrying a level of 16 — so a
     brand-new player who sent any shoe id at all was handed the level-16
     pair. Every list in this file starts with something free. */
  { id: 'soft',   name: 'Soft spikes',  drive: 0.005, acc: 0.004, spin: 0.01 },
  { id: 'spike-less', name: 'Spikeless', drive: 0.002, acc: 0.005, spin: 0 },
  { id: 'casual', name: 'Trainers',     drive: 0,     acc: 0.003, spin: -0.01 },
  { id: 'spike',  name: 'Steel spikes', drive: 0.009, acc: 0.002, spin: 0.02, at: 8 },
  { id: 'boot',   name: 'Winter boot',  drive: 0.003, acc: 0.002, spin: 0, at: 20 }
];

/* ----------------------------------------------------------- accessories ---
   These are additive slots rather than the single `accessory` the look has
   had until now, which could hold exactly one thing — so a player in glasses
   could not also wear a glove, which is most golfers. */
export const GLOVES = [
  { id: 'none',    name: 'No glove',      acc: 0 },
  { id: 'leather', name: 'Cabretta',      acc: 0.008, hex: '#f2f0e8' },
  { id: 'synth',   name: 'All-weather',   acc: 0.006, hex: '#2b3340' },
  { id: 'tan',     name: 'Tan leather',   acc: 0.008, hex: '#c9a06a' },
  { id: 'winter',  name: 'Winter pair',   acc: 0.004, hex: '#4a5560', at: 14 }
];

export const WATCHES = [
  { id: 'none',   name: 'None' },
  { id: 'sport',  name: 'Range finder', hex: '#22262c', at: 9 },
  { id: 'steel',  name: 'Steel dress',  hex: '#c8ccd2', at: 22 },
  { id: 'gold',   name: 'Gold',         hex: '#e8c15a', at: 45 }
];

export const SLEEVES = [
  { id: 'none',  name: 'Bare arms' },
  { id: 'left',  name: 'Left sleeve',  at: 7 },
  { id: 'right', name: 'Right sleeve', at: 7 },
  { id: 'both',  name: 'Both arms',    at: 12 }
];

export const NECKWEAR = [
  { id: 'none',   name: 'None' },
  { id: 'collar', name: 'Popped collar' },
  { id: 'scarf',  name: 'Neck scarf', at: 6 },
  { id: 'chain',  name: 'Chain',      at: 30 },
  { id: 'buff',   name: 'Neck buff',  at: 16 }
];

/* ================================================================ DECALS ===
   Every one is drawn procedurally — see decals.js for the generators. The
   spec that arrived asked for 4K texture maps; that is 16 to 64 MB per decal
   before compression against a whole-bundle budget of 23 MB, of which this
   game currently spends 1.6. It is also invisible: a shoulder decal on a
   golfer occupies about forty pixels of a 1080p frame at the closest camera
   this game has. These render at 256 and are sharper on screen than a
   downloaded 4K map would be, because they are generated at the device's own
   pixel ratio and never resampled.

   `finish` is the material response and is the part that actually reads:
     flat    — printed on the fabric, takes the light the shirt takes
     emboss  — raised, with a micro-shadow on the light side
     metal   — a specular sweep that moves as the golfer turns
     holo    — hue shifts with the viewing angle */
export const DECAL_FINISHES = ['flat', 'emboss', 'metal', 'holo'];

export const DECALS = [
  /* ---- house brands. Invented, every one of them, for the reason in the
     header: a game may not sell a shirt with somebody else's mark on it. --- */
  { id: 'bogey',   name: 'Bogey & Co.',    cat: 'brand', finish: 'flat',   c: ['#e8eaee', '#1d2733'] },
  { id: 'albatr',  name: 'Albatross',      cat: 'brand', finish: 'flat',   c: ['#2f9e6a', '#eef1ec'] },
  { id: 'ninein',  name: 'Nine Iron',      cat: 'brand', finish: 'emboss', c: ['#c8382f', '#f2f4f0'] },
  { id: 'linksco', name: 'Links Co.',      cat: 'brand', finish: 'flat',   c: ['#2b3f6b', '#e8b93c'] },
  { id: 'caddym',  name: 'Caddymark',      cat: 'brand', finish: 'emboss', c: ['#3a4048', '#8fe07a'] },
  { id: 'fairw',   name: 'Fairway Motors', cat: 'brand', finish: 'metal',  c: ['#c8ccd2', '#22262c'], at: 25 },

  /* ---- flags. Drawn as bands and a device, not as national emblems: a
     recognisable coat of arms is somebody's protected symbol too. ---------- */
  { id: 'fl-tri',  name: 'Tricolour',      cat: 'flag', finish: 'flat', c: ['#2f6fb8', '#eef1ec', '#c8382f'] },
  { id: 'fl-cross',name: 'Nordic cross',   cat: 'flag', finish: 'flat', c: ['#2f6fb8', '#e8c15a'] },
  { id: 'fl-sun',  name: 'Rising sun',     cat: 'flag', finish: 'flat', c: ['#eef1ec', '#c8382f'] },
  { id: 'fl-star', name: 'Southern stars', cat: 'flag', finish: 'flat', c: ['#1d2733', '#eef1ec'] },
  { id: 'fl-band', name: 'Horizontal bands', cat: 'flag', finish: 'flat', c: ['#2f9e6a', '#eef1ec', '#e8c15a'] },
  { id: 'fl-salt', name: 'Saltire',        cat: 'flag', finish: 'flat', c: ['#2b3f6b', '#eef1ec'] },

  /* ---- team badges ------------------------------------------------------ */
  { id: 'tm-green',name: 'Green side',     cat: 'team', finish: 'emboss', c: ['#2f9e6a', '#f2f4f0'] },
  { id: 'tm-gold', name: 'Gold side',      cat: 'team', finish: 'emboss', c: ['#e8b93c', '#3a4048'] },
  { id: 'tm-shield',name: 'Club shield',   cat: 'team', finish: 'emboss', c: ['#7d2f42', '#e8c15a'] },
  { id: 'tm-wreath',name: 'Laurel',        cat: 'team', finish: 'metal',  c: ['#e8c15a', '#28603a'], at: 36 },

  /* ---- achievements. Earned, and they glow. ----------------------------- */
  { id: 'ac-ace',  name: 'Hole in one',    cat: 'earn', finish: 'holo',  c: ['#ffe66b', '#f08a3c'], glow: 1, at: 20 },
  { id: 'ac-eagle',name: 'Eagle badge',    cat: 'earn', finish: 'metal', c: ['#c8ccd2', '#2f6fb8'], glow: 0.6, at: 35 },
  { id: 'ac-champ',name: 'Champion',       cat: 'earn', finish: 'holo',  c: ['#e8c15a', '#c8382f'], glow: 1, at: 65 },
  { id: 'ac-course',name: 'Record holder', cat: 'earn', finish: 'holo',  c: ['#8fe07a', '#2f9e6a'], glow: 1, at: 50 },

  /* ---- seasonal --------------------------------------------------------- */
  { id: 'se-snow', name: 'Winter',         cat: 'season', finish: 'emboss', c: ['#dceaf0', '#2f6fb8'] },
  { id: 'se-leaf', name: 'Autumn',         cat: 'season', finish: 'flat',   c: ['#c4622a', '#e8b93c'] },
  { id: 'se-bloom',name: 'Spring bloom',   cat: 'season', finish: 'flat',   c: ['#dd7fa4', '#8fe07a'] },
  { id: 'se-sun',  name: 'High summer',    cat: 'season', finish: 'metal',  c: ['#ffe66b', '#f08a3c'], at: 40 },

  /* ---- the generated one. `custom` is not in this table twice: one entry,
     and the player's shape/colour/initials ride in the look. --------------- */
  { id: 'custom',  name: 'Your own design', cat: 'custom', finish: 'flat', c: ['#eef1ec', '#2f9e6a'] }
];

export const DECAL_CATS = [
  { id: 'brand',  name: 'House brands' },
  { id: 'flag',   name: 'Flags & regions' },
  { id: 'team',   name: 'Team badges' },
  { id: 'earn',   name: 'Achievements' },
  { id: 'season', name: 'Seasonal' },
  { id: 'custom', name: 'Your own' }
];

/* The shapes a generated decal can be built from. Deliberately few: three
   shapes times ten colour pairs times initials is already more designs than
   anybody will make, and every extra shape is code in the generator. */
export const CUSTOM_SHAPES = [
  { id: 'shield', name: 'Shield' },
  { id: 'circle', name: 'Roundel' },
  { id: 'diamond', name: 'Diamond' },
  { id: 'banner', name: 'Banner' },
  { id: 'hex',    name: 'Hex' }
];

/* --------------------------------------------------------------- slots ----
   Where a decal can go. `size` is in metres on the avatar, `at` is the level
   the slot itself unlocks — a new player has two places to put a badge, and
   the rest arrive as they play, which is what makes finding a new slot feel
   like something rather than being handed eleven empty boxes on day one. */
export const DECAL_SLOTS = [
  { id: 'armL',   name: 'Left arm',    size: 0.062 },
  { id: 'armR',   name: 'Right arm',   size: 0.062 },
  { id: 'chest',  name: 'Chest',       size: 0.070 },
  { id: 'back',   name: 'Back collar', size: 0.055, at: 11 },
  { id: 'hatF',   name: 'Cap front',   size: 0.048, at: 6 },
  { id: 'hatB',   name: 'Cap back',    size: 0.040, at: 28 },
  { id: 'shoeL',  name: 'Left shoe',   size: 0.034, at: 19 },
  { id: 'shoeR',  name: 'Right shoe',  size: 0.034, at: 19 },
  { id: 'legL',   name: 'Left leg',    size: 0.046, at: 42 },
  { id: 'legR',   name: 'Right leg',   size: 0.046, at: 42 }
];

/* ============================================================== OUTFITS ===
   Ready-made, because a wardrobe with nine slots and a colour picker on each
   is a blank canvas, and a blank canvas is what most people bounce off. Pick
   a look you like in one click, then change the bits you want. */
export const OUTFIT_CATS = [
  { id: 'classic', name: 'Classic',  blurb: 'Knickers, wool and a flat cap.' },
  { id: 'tour',    name: 'Tour pro', blurb: 'What the range looks like today.' },
  { id: 'athletic',name: 'Athletic', blurb: 'Technical, cut to move.' },
  { id: 'luxury',  name: 'Luxury',   blurb: 'Silk, gold and no apology.' },
  { id: 'season',  name: 'Seasonal', blurb: 'Dressed for the weather it is.' },
  { id: 'fantasy', name: 'Fantasy',  blurb: 'Not from around here.' },
  { id: 'regional',name: 'Regional', blurb: 'What they wear where the course is.' }
];

/** An outfit is a partial look. Anything it leaves out, the player keeps. */
export const OUTFITS = [
  /* ---- classic / vintage ------------------------------------------------ */
  { id: 'hickory', cat: 'classic', name: 'Hickory era', at: 0,
    o: { shirt: '#eef1ec', trousers: '#8a6b4a', pattern: 'check', fabric: 'wool',
         cut: 'knicker', shoeType: 'spike-less', shoes: '#a97c4d', hat: 'flat',
         cap: '#d9c9a3', neck: 'collar', glove: 'tan' } },
  { id: 'gentle',  cat: 'classic', name: 'Gentleman amateur', at: 14,
    o: { shirt: '#f2f4f0', trousers: '#33415e', pattern: 'argyle', fabric: 'wool',
         cut: 'straight', shoeType: 'soft', shoes: '#2b2b2f', hat: 'flat',
         cap: '#2b3f6b', neck: 'collar', watch: 'steel' } },
  { id: 'linkslad',cat: 'classic', name: 'Links tradition', at: 20,
    o: { shirt: '#7d2f42', trousers: '#cfc6b4', pattern: 'pin', fabric: 'wool',
         cut: 'knicker', shoeType: 'spike-less', shoes: '#a97c4d', hat: 'flat',
         cap: '#7d2f42', neck: 'scarf' } },

  /* ---- modern tour pro -------------------------------------------------- */
  { id: 'sunday',  cat: 'tour', name: 'Sunday red', at: 0,
    o: { shirt: '#c8382f', trousers: '#24272c', pattern: 'solid', fabric: 'pique',
         cut: 'slim', shoeType: 'soft', shoes: '#e6e6e0', hat: 'cap',
         cap: '#1d2024', glove: 'leather' } },
  { id: 'range',   cat: 'tour', name: 'Range day', at: 10,
    o: { shirt: '#7fb6dd', trousers: '#e9e6dc', pattern: 'stripe', fabric: 'tech',
         cut: 'slim', shoeType: 'soft', shoes: '#e6e6e0', hat: 'cap',
         cap: '#f2f4f0', glove: 'leather', watch: 'sport' } },
  { id: 'majors',  cat: 'tour', name: 'Major week', at: 26,
    o: { shirt: '#232833', trousers: '#3b4046', pattern: 'block', fabric: 'shell',
         cut: 'slim', shoeType: 'spike', shoes: '#2b2b2f', hat: 'cap',
         cap: '#1d2024', glove: 'synth', watch: 'sport' } },
  { id: 'visorpro',cat: 'tour', name: 'Visor and whites', at: 16,
    o: { shirt: '#eef1ec', trousers: '#e9e6dc', pattern: 'solid', fabric: 'tech',
         cut: 'straight', shoeType: 'spike', shoes: '#e6e6e0', hat: 'visor',
         cap: '#f2f4f0', glove: 'leather' } },

  /* ---- athletic --------------------------------------------------------- */
  { id: 'jogfit',  cat: 'athletic', name: 'Training fit', at: 12,
    o: { shirt: '#2f9e6a', trousers: '#24272c', pattern: 'geo', fabric: 'tech',
         cut: 'jogger', shoeType: 'casual', shoes: '#2b2b2f', hat: 'cap',
         cap: '#28603a', sleeve: 'both', watch: 'sport' } },
  { id: 'summer',  cat: 'athletic', name: 'Hot round', at: 0,
    o: { shirt: '#f08a3c', trousers: '#e9e6dc', pattern: 'solid', fabric: 'tech',
         cut: 'short', shoeType: 'spike-less', shoes: '#e6e6e0', hat: 'visor',
         cap: '#f2f4f0', sleeve: 'none' } },
  { id: 'compress',cat: 'athletic', name: 'Compression', at: 27,
    o: { shirt: '#3560c4', trousers: '#232833', pattern: 'fade', fabric: 'shell',
         cut: 'slim', shoeType: 'spike', shoes: '#2c3a5c', hat: 'cap',
         cap: '#3560c4', sleeve: 'both', glove: 'synth', watch: 'sport' } },

  /* ---- luxury ----------------------------------------------------------- */
  { id: 'silkset', cat: 'luxury', name: 'Silk and stone', at: 52,
    o: { shirt: '#a98cd8', trousers: '#cfc6b4', pattern: 'solid', fabric: 'silk',
         cut: 'straight', shoeType: 'spike-less', shoes: '#a97c4d', hat: 'wide',
         cap: '#d9c9a3', watch: 'gold', neck: 'chain' } },
  { id: 'monaco',  cat: 'luxury', name: 'Clubhouse gold', at: 61,
    o: { shirt: '#232833', trousers: '#24272c', pattern: 'pin', fabric: 'silk',
         cut: 'slim', shoeType: 'soft', shoes: '#2b2b2f', hat: 'none',
         watch: 'gold', neck: 'chain', glove: 'tan' } },
  { id: 'foilfit', cat: 'luxury', name: 'Foil weave', at: 78,
    o: { shirt: '#e8b93c', trousers: '#232833', pattern: 'block', fabric: 'metal',
         cut: 'slim', shoeType: 'spike', shoes: '#e6e6e0', hat: 'cap',
         cap: '#e8b93c', watch: 'gold' } },

  /* ---- seasonal --------------------------------------------------------- */
  { id: 'frost',   cat: 'season', name: 'Frost delay', at: 24,
    o: { shirt: '#dceaf0', trousers: '#33415e', pattern: 'check', fabric: 'wool',
         cut: 'straight', shoeType: 'boot', shoes: '#2b2b2f', hat: 'beanie',
         cap: '#2b3f6b', neck: 'buff', glove: 'winter', sleeve: 'both' } },
  { id: 'autumn',  cat: 'season', name: 'Autumn round', at: 0,
    o: { shirt: '#9c5a35', trousers: '#5f6444', pattern: 'check', fabric: 'wool',
         cut: 'straight', shoeType: 'soft', shoes: '#a97c4d', hat: 'flat',
         cap: '#5f6444', neck: 'scarf' } },
  { id: 'festive', cat: 'season', name: 'Festive', at: 30,
    o: { shirt: '#c8382f', trousers: '#e9e6dc', pattern: 'argyle', fabric: 'wool',
         cut: 'straight', shoeType: 'boot', shoes: '#2b2b2f', hat: 'beanie',
         cap: '#c8382f', neck: 'buff' } },

  /* ---- fantasy ---------------------------------------------------------- */
  { id: 'voidsuit',cat: 'fantasy', name: 'Void suit', at: 45,
    o: { shirt: '#232833', trousers: '#232833', pattern: 'geo', fabric: 'metal',
         cut: 'slim', shoeType: 'spike', shoes: '#2b2b2f', hat: 'none',
         sleeve: 'both', neck: 'buff', watch: 'sport' } },
  { id: 'foresth', cat: 'fantasy', name: 'Forest herald', at: 38,
    o: { shirt: '#28603a', trousers: '#5f6444', pattern: 'floral', fabric: 'silk',
         cut: 'relaxed', shoeType: 'spike-less', shoes: '#3a6b45', hat: 'wide',
         cap: '#28603a', neck: 'scarf' } },
  { id: 'aurora',  cat: 'fantasy', name: 'Aurora', at: 66,
    o: { shirt: '#a98cd8', trousers: '#3560c4', pattern: 'fade', fabric: 'metal',
         cut: 'jogger', shoeType: 'casual', shoes: '#e6e6e0', hat: 'beanie',
         cap: '#a98cd8', sleeve: 'both', neck: 'chain' } },

  /* ---- regional. Named for THIS game's eight courses. -------------------- */
  { id: 'rg-park', cat: 'regional', name: 'Georgia pines', at: 0,
    o: { shirt: '#2f9e6a', trousers: '#e9e6dc', pattern: 'solid', fabric: 'pique',
         cut: 'straight', shoeType: 'soft', shoes: '#e6e6e0', hat: 'cap', cap: '#28603a' } },
  { id: 'rg-links',cat: 'regional', name: 'Ayrshire wind', at: 8,
    o: { shirt: '#4a5560', trousers: '#8a6b4a', pattern: 'check', fabric: 'wool',
         cut: 'knicker', shoeType: 'spike', shoes: '#2b2b2f', hat: 'flat',
         cap: '#4a5560', neck: 'scarf', sleeve: 'both' } },
  { id: 'rg-desert',cat: 'regional', name: 'Sonoran', at: 18,
    o: { shirt: '#d9a731', trousers: '#cfc6b4', pattern: 'camo', fabric: 'tech',
         cut: 'short', shoeType: 'spike-less', shoes: '#a97c4d', hat: 'wide', cap: '#d9c9a3' } },
  { id: 'rg-jp',   cat: 'regional', name: 'Kyushu', at: 32,
    o: { shirt: '#eef1ec', trousers: '#232833', pattern: 'floral', fabric: 'silk',
         cut: 'straight', shoeType: 'soft', shoes: '#e6e6e0', hat: 'bucket',
         cap: '#eef1ec', neck: 'collar' } },
  { id: 'rg-fjord',cat: 'regional', name: 'Vestfirdir', at: 40,
    o: { shirt: '#2b8a86', trousers: '#3b4046', pattern: 'argyle', fabric: 'wool',
         cut: 'straight', shoeType: 'boot', shoes: '#2b2b2f', hat: 'beanie',
         cap: '#2b8a86', neck: 'buff', glove: 'winter' } }
];

/* An outfit may not be offered before every piece of it is. Computed here
   rather than typed into each entry, because it was typed in once and
   sixteen of the twenty-four were wrong: the card said "wool, plus fours"
   and a level-3 player who picked it got cotton and straight legs, because
   normaliseWardrobe correctly refused the pieces they had not earned. A
   wardrobe that shows you an outfit and then hands you a different one is
   worse than one that makes you wait.

   Doing it as a pass means adding an outfit later cannot reintroduce it. */
{
  const LISTS = { pattern: PATTERNS, fabric: FABRICS, cut: CUTS, shoeType: SHOE_TYPES,
                  glove: GLOVES, watch: WATCHES, sleeve: SLEEVES, neck: NECKWEAR };
  for (const o of OUTFITS) {
    let need = o.at || 0;
    for (const [key, list] of Object.entries(LISTS)) {
      const v = o.o[key];
      if (!v) continue;
      const it = list.find(x => x.id === v);
      if (it?.at && it.at > need) need = it.at;
    }
    o.at = need;
  }
}

/* ================================================================ STATS ===
   The four numbers the wardrobe shows, and they are REAL — every one is fed
   from the same table the shot uses, so the panel is a readout rather than a
   decoration. That mattered enough to do properly: a stat line that does
   nothing is worse than no stat line, because a player who works that out
   stops believing the other numbers too.

   The ceiling is deliberately low. Head to toe in the best-performing kit in
   the game is about +2.5% carry against nothing, which is four metres on a
   driver — enough to be worth choosing, nowhere near enough that a player in
   the outfit they like is playing a different game. And every piece of it is
   earned by LEVEL, never bought, so this cannot become pay-to-win. */
const find = (list, id) => list.find(x => x.id === id) || list[0];

export function outfitStats(look) {
  const l = look || {};
  const fab = find(FABRICS, l.fabric);
  const cut = find(CUTS, l.cut);
  const shoe = find(SHOE_TYPES, l.shoeType);
  const glove = find(GLOVES, l.glove);
  const pat = find(PATTERNS, l.pattern);

  const drive = fab.drive + cut.drive + shoe.drive;
  const accuracy = fab.acc + cut.acc + shoe.acc + glove.acc;
  const spin = shoe.spin || 0;

  /* Style is the one number that is a judgement rather than a sum, so it is
     built from things that can be checked: how much the outfit commits to a
     print, whether the pieces agree with each other, whether anything on it
     was hard to get, and whether it is wearing a badge at all. */
  let style = 4.2;
  style += pat.weight * 2.4;                       // a print is a choice
  style += (l.decals ? Object.keys(l.decals).filter(k => l.decals[k]).length : 0) * 0.42;
  if (l.watch && l.watch !== 'none') style += 0.5;
  if (l.neck && l.neck !== 'none') style += 0.4;
  if (l.glove && l.glove !== 'none') style += 0.3;
  if (l.sleeve && l.sleeve !== 'none') style += 0.35;
  style += fab.sheen * 1.1;
  // a coherent outfit reads better than a pile of unrelated good pieces
  if (l.outfit) style += 0.8;

  return {
    drive,                                          // fraction, e.g. 0.025
    accuracy,
    spin,
    style: Math.min(10, Math.round(style * 10) / 10)
  };
}

/**
 * The multipliers the shot actually applies. Same shape as gearEffect so the
 * two compose without either knowing about the other.
 */
export function outfitEffect(look) {
  const s = outfitStats(look);
  return { speed: 1 + s.drive, spin: 1 + s.spin, accuracy: 1 + s.accuracy };
}

/** How the panel words a spin number that is usually zero. */
export const spinWord = v => (v > 0.005 ? 'Extra grip' : v < -0.005 ? 'Slick' : 'Neutral');

/* ------------------------------------------------------------ validation ---
   The same contract avatars.js has: coerce anything into something legal
   rather than rejecting it, so an older client that has never heard of
   fabrics still produces a complete golfer. */
const pickId = (list, id, level) => {
  /* The fallback is the first entry WITHOUT a level on it, not simply the
     first entry. Those are usually the same and once they were not, which
     handed every new player a piece of kit they had not earned. Resolving it
     here rather than by convention means a list can be reordered later
     without quietly reopening it. */
  const free = list.find(x => !x.at) || list[0];
  const it = list.find(x => x.id === id);
  if (!it) return free.id;
  if (it.at && (Number(level) || 999) < it.at) return free.id;
  return it.id;
};

const DECAL_BY_ID = new Map(DECALS.map(d => [d.id, d]));
const SLOT_BY_ID = new Map(DECAL_SLOTS.map(s => [s.id, s]));

/** Clean the decal map: known slots, known decals, and nothing unearned. */
export function normaliseDecals(map, level = 999) {
  const out = {};
  if (!map || typeof map !== 'object') return out;
  for (const [slot, id] of Object.entries(map)) {
    const s = SLOT_BY_ID.get(slot);
    const d = DECAL_BY_ID.get(id);
    if (!s || !d) continue;
    if (s.at && level < s.at) continue;
    if (d.at && level < d.at) continue;
    out[slot] = id;
  }
  return out;
}

/** The generated design: a shape, two colours and up to three initials. */
export function normaliseCustom(c) {
  const o = c && typeof c === 'object' ? c : {};
  const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : d);
  return {
    shape: (CUSTOM_SHAPES.find(s => s.id === o.shape) || CUSTOM_SHAPES[0]).id,
    a: hex(o.a, '#eef1ec'),
    b: hex(o.b, '#2f9e6a'),
    /* Three characters, letters and digits only. Not a free text field: this
       is drawn on a shirt every other player in the room can see, and the
       shortest path to a slur on somebody's chest is a text box with no
       rules. Three characters of A-Z and 0-9 is a monogram, not a message. */
    txt: String(o.txt || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3)
  };
}

/** Everything this file adds to a look, validated. */
export function normaliseWardrobe(look, level = 999) {
  const l = look && typeof look === 'object' ? look : {};
  return {
    pattern: pickId(PATTERNS, l.pattern, level),
    fabric: pickId(FABRICS, l.fabric, level),
    cut: pickId(CUTS, l.cut, level),
    shoeType: pickId(SHOE_TYPES, l.shoeType, level),
    glove: pickId(GLOVES, l.glove, level),
    watch: pickId(WATCHES, l.watch, level),
    sleeve: pickId(SLEEVES, l.sleeve, level),
    neck: pickId(NECKWEAR, l.neck, level),
    /* The second shirt colour, which every pattern needs and which had
       nowhere to live: a stripe has to be a stripe OF something. */
    shirt2: /^#[0-9a-f]{6}$/i.test(String(l.shirt2)) ? String(l.shirt2) : '#232833',
    decals: normaliseDecals(l.decals, level),
    custom: normaliseCustom(l.custom),
    outfit: OUTFITS.some(o => o.id === l.outfit) ? l.outfit : null
  };
}

/** Apply a preset over a look, keeping everything it does not mention. */
export function wearOutfit(look, outfitId) {
  const o = OUTFITS.find(x => x.id === outfitId);
  if (!o) return look;
  return { ...look, ...o.o, outfit: o.id };
}

export const outfitById = id => OUTFITS.find(o => o.id === id) || null;
export const decalById = id => DECAL_BY_ID.get(id) || null;
export const slotById = id => SLOT_BY_ID.get(id) || null;
