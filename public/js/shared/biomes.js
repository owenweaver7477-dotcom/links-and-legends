/* =========================================================================
   biomes.js — the five courses and what makes each one play differently
   -------------------------------------------------------------------------
   Every visual and gameplay knob for an area lives here: terrain relief,
   hazard tendencies, tree species, palette, wind and green speed.  The hole
   generator reads these, so adding a sixth course is a matter of adding an
   entry rather than writing new code.
   ========================================================================= */

export const BIOMES = {
  /* ---------------------------------------------------------- PARKLAND --- */
  parkland: {
    id: 'parkland',
    name: 'Claude National',
    blurb: 'Tree-lined parkland. Generous fairways, water in play, fast bentgrass greens.',
    region: 'Georgia, USA',
    continent: 'north-america',
    relief: 7,                  // metres of terrain amplitude
    reliefScale: 190,           // metres per noise unit — bigger = broader hills
    ridged: 0,
    fairwayWidth: [28, 38],
    roughWidth: 26,
    treeDensity: 0.72,          // 0..1, relative
    treeSpecies: ['oak', 'pine', 'maple'],
    treeHeight: [8, 15],
    waterChance: 0.45,
    waterKind: 'pond',
    bunkerCount: [2, 5],
    greenSpeed: 1.0,            // 1 = tour-ish stimp; higher = faster
    greenSize: [12, 16],        // radius metres — a real green is 25-32 m across
    windBase: 3.0,              // m/s
    windGust: 2.5,
    palette: {
      sky: ['#8fc4e8', '#dbeaf5'],
      sun: '#fff6df',
      fog: '#cadcea',
      fairway: '#5f9c42', rough: '#3f6b32', deep: '#2f5326',
      green: '#7ec95e', fringe: '#67a84a',
      sand: '#e3cf9c', water: '#2a7f96', dirt: '#6b5a3e',
      /* Trunk colours are a stop lighter than they look on a swatch. Lambert
         under a hemisphere light, then ACES tonemapping, takes about a third
         out of a dark value — #4a3524 arrived on screen as very nearly black,
         so every wood in the game was a row of silhouettes. */
      trunk: '#6b5038'
    },
    ambient: 0.55, sunElev: 52, sunAzim: 135
  },

  /* ------------------------------------------------------------- LINKS --- */
  links: {
    id: 'links',
    name: 'Cairnmoor Links',
    blurb: 'Wind-scoured coastal links. Firm running fairways, deep pot bunkers, no trees to hide behind.',
    region: 'Ayrshire, Scotland',
    continent: 'europe',
    relief: 6.5,
    reliefScale: 85,            // tight, choppy dunes
    ridged: 0.65,
    fairwayWidth: [26, 40],
    roughWidth: 34,
    treeDensity: 0.04,
    treeSpecies: ['gorse', 'gorse', 'pine'],
    treeHeight: [1.6, 3.2],
    waterChance: 0.18,
    waterKind: 'ocean',
    bunkerCount: [4, 8],
    bunkerStyle: 'pot',         // small, deep, brutal
    greenSpeed: 1.12,
    greenSize: [13, 17],
    windBase: 6.5,              // the defining hazard
    windGust: 2.6,
    firmness: 1.35,             // extra run-out on landing
    palette: {
      sky: ['#8ba7bd', '#d5dee5'],
      sun: '#f4f0e2',
      fog: '#c3cfd8',
      fairway: '#8a9455', rough: '#6d7f41', deep: '#55632f',
      green: '#8fbe62', fringe: '#7ba552',
      sand: '#efe4c4', water: '#3d6f86', dirt: '#7d6c4c',
      trunk: '#7a6644'
    },
    ambient: 0.62, sunElev: 34, sunAzim: 200
  },

  /* ------------------------------------------------------------ DESERT --- */
  desert: {
    id: 'desert',
    name: 'Red Mesa',
    blurb: 'Target golf carved out of the canyon floor. Miss the grass and you are in the sand and scrub.',
    region: 'Arizona, USA',
    continent: 'north-america',
    relief: 11,
    reliefScale: 150,
    ridged: 0.45,
    fairwayWidth: [24, 32],     // narrow — it is target golf
    roughWidth: 8,              // barely any rough: grass then desert
    treeDensity: 0.16,
    treeSpecies: ['saguaro', 'palo', 'saguaro'],
    treeHeight: [3, 7],
    waterChance: 0.22,
    waterKind: 'pond',
    bunkerCount: [2, 5],
    wasteAreas: true,           // desert scrub outside the corridor plays as sand-ish
    greenSpeed: 1.05,
    greenSize: [11, 15],
    windBase: 4.0,
    windGust: 3.0,
    firmness: 1.25,
    palette: {
      sky: ['#6fa9d8', '#f0d9b8'],
      sun: '#fff1cd',
      fog: '#e3c9a4',
      fairway: '#6aa348', rough: '#8a7a4a', deep: '#9c7a4c',
      green: '#79c257', fringe: '#69a84a',
      sand: '#d9a273', water: '#2f8fa8', dirt: '#a86a42',
      trunk: '#7d6746'
    },
    ambient: 0.7, sunElev: 66, sunAzim: 160
  },

  /* ------------------------------------------------------------ ALPINE --- */
  alpine: {
    id: 'alpine',
    name: 'Hochkar Alpine',
    blurb: 'Cut into a mountain valley. Big elevation changes — read the slope or the ball will not stop.',
    region: 'Tyrol, Austria',
    continent: 'europe',
    relief: 16,                 // the big one
    reliefScale: 210,
    ridged: 0.3,
    fairwayWidth: [26, 36],
    roughWidth: 20,
    treeDensity: 0.7,
    treeSpecies: ['spruce', 'spruce', 'fir'],
    treeHeight: [12, 20],
    waterChance: 0.3,
    waterKind: 'lake',
    bunkerCount: [1, 4],
    greenSpeed: 0.94,           // slower, wetter greens
    greenSize: [12, 16],
    windBase: 2.0,
    windGust: 2.0,
    slopeBias: 1.3,             // exaggerate along-route elevation change
    palette: {
      sky: ['#6fa3d4', '#cfe3f2'],
      sun: '#fffaf0',
      fog: '#bcd2e2',
      fairway: '#4f9440', rough: '#33612e', deep: '#254a24',
      green: '#6fbc55', fringe: '#5c9e46',
      sand: '#ded1ad', water: '#2f7fa5', dirt: '#5b4a35',
      trunk: '#5c4832'
    },
    ambient: 0.5, sunElev: 44, sunAzim: 120
  },

  /* ---------------------------------------------------------- TROPICAL --- */
  tropical: {
    id: 'tropical',
    name: 'Palmera Cay',
    blurb: 'Ocean on one side, lagoons on the other. Soft greens that hold, but water everywhere.',
    region: 'Quintana Roo, Mexico',
    continent: 'latin-america',
    relief: 4,
    reliefScale: 160,
    ridged: 0,
    fairwayWidth: [28, 38],
    roughWidth: 22,
    treeDensity: 0.55,
    treeSpecies: ['palm', 'palm', 'mangrove'],
    treeHeight: [8, 15],
    waterChance: 0.72,          // water on most holes
    waterKind: 'lagoon',
    bunkerCount: [2, 5],
    greenSpeed: 0.97,
    greenSize: [13, 17],
    windBase: 5.0,
    windGust: 3.2,
    firmness: 0.85,             // soft, holds approach shots
    palette: {
      sky: ['#4fa8e0', '#e6f4fb'],
      sun: '#fffbe8',
      fog: '#bfe2ef',
      fairway: '#5fae4b', rough: '#3d7a38', deep: '#2d5c2c',
      green: '#82d162', fringe: '#6cb350',
      sand: '#f2e3c2', water: '#1fa5bd', dirt: '#7a6444',
      trunk: '#8a6f4a'
    },
    ambient: 0.66, sunElev: 60, sunAzim: 145
  }
};

export const COURSE_ORDER = ['parkland', 'links', 'desert', 'alpine', 'tropical'];

/* ---------------------------------------------------------------- crowns ---
   How wide a tree's canopy is, as a fraction of its height. ONE number per
   species, and it is the single source of truth for three things that were
   previously each guessing:

     coursegen  sets the tree's collision radius from it
     ballistics tests the ball against a canopy of that radius
     scene      normalises the DRAWN lobes so they reach exactly that far

   They had drifted apart, and drift here is the worst kind of bug in a golf
   game: a broadleaf was drawn with lobes reaching 0.49 of its height and
   collided at 0.34, so a ball could vanish into leaves and come out clean —
   or, from the tee camera, appear to miss by four metres and be knocked
   down. Either way the player concludes the physics is lying, and they are
   right. Now the picture IS the collider.

   The numbers themselves are also smaller than they were. A real oak has a
   crown about half its height wide and that is genuinely what a parkland
   course looks like, but at that ratio a treeline reads as a solid wall from
   inside a 30 m corridor, and the game is played from inside the corridor. */
export const CROWN = {
  maple: 0.28, oak: 0.28, mangrove: 0.26,
  fir: 0.20, pine: 0.20,
  palm: 0.17, saguaro: 0.12, gorse: 0.70
};
export const crownOf = species => CROWN[species] ?? 0.28;

/* Where the leaves are, vertically: the centre of the canopy and its half
   height, both as fractions of the tree's height. Same reasoning as CROWN —
   the physics tests an ellipsoid and the renderer draws lobes, and they have
   to describe the same object.

   A conifer is the one to look at. Its skirts start at 0.34 of its height,
   so a band centred at 0.80 like a broadleaf leaves the bottom third of a
   fir drawn and not solid. */
export const CANOPY = {
  maple: [0.82, 0.33], oak: [0.82, 0.33], mangrove: [0.82, 0.33], palo: [0.88, 0.28],
  pine: [0.70, 0.36], fir: [0.70, 0.36], spruce: [0.70, 0.36],
  palm: [0.88, 0.16], gorse: [0.50, 0.45], saguaro: [0.62, 0.42]
};
export const canopyOf = species => CANOPY[species] || CANOPY.maple;

/* -------------------------------------------------------------- regions ---
   Courses are chosen by where in the world they are, not from a flat list.
   This is the only place that mapping lives: to add a course, give it a
   `continent` in BIOMES above and it appears under that heading — and a
   continent with no courses yet is simply skipped, so the list below can be
   filled in ahead of the courses that will go in it.

   `blurb` is what the region is like to play, not a geography lesson. */
export const REGIONS = [
  { id: 'north-america', name: 'North America', flag: '🌎',
    blurb: 'Parkland and desert — generous off the tee, punishing around the green' },
  { id: 'europe', name: 'Europe', flag: '🌍',
    blurb: 'Wind off the sea and thin mountain air' },
  { id: 'latin-america', name: 'Latin America', flag: '🏝️',
    blurb: 'Water, palms and soft greens that hold' },
  { id: 'asia-pacific', name: 'Asia Pacific', flag: '🌏',
    blurb: 'Coming soon' }
];

/** Courses grouped by region, in REGIONS order, with empty regions dropped. */
export function coursesByRegion() {
  return REGIONS.map(r => ({
    ...r,
    courses: COURSE_ORDER
      .filter(id => BIOMES[id]?.continent === r.id)
      .map(id => ({ id, ...BIOMES[id] }))
  })).filter(r => r.courses.length > 0);
}

/** Which region a course belongs to, or null if it has not been placed. */
export const regionOf = id =>
  REGIONS.find(r => r.id === BIOMES[id]?.continent) || null;

/* Ball colours — eight distinct, all readable against grass. */
export const BALL_COLORS = [
  { name: 'Ivory',    hex: '#f6f7f2' },
  { name: 'Scarlet',  hex: '#ff4d4d' },
  { name: 'Azure',    hex: '#38a9ff' },
  { name: 'Amber',    hex: '#ffcf3f' },
  { name: 'Coral',    hex: '#ff8a3d' },
  { name: 'Orchid',   hex: '#c77dff' },
  { name: 'Mint',     hex: '#4ce0b3' },
  { name: 'Rose',     hex: '#ff7ab8' },
  // earned, not given: the server refuses these until your rating clears the bar
  { name: 'Tour Gold', hex: '#ffd94a', lockRating: 45 },
  { name: 'Pearl',     hex: '#e8f4ff', lockRating: 70 }
];

export const MAX_PLAYERS = 8;
export const HOLES_PER_COURSE = 9;
