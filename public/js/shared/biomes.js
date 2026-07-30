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
    relief: 7,                  // metres of terrain amplitude
    reliefScale: 190,           // metres per noise unit — bigger = broader hills
    ridged: 0,
    fairwayWidth: [28, 38],
    roughWidth: 26,
    treeDensity: 0.72,          // 0..1, relative
    treeSpecies: ['oak', 'pine', 'maple'],
    treeHeight: [9, 17],
    waterChance: 0.45,
    waterKind: 'pond',
    bunkerCount: [2, 5],
    greenSpeed: 1.0,            // 1 = tour-ish stimp; higher = faster
    greenSize: [17, 24],        // radius metres
    windBase: 3.0,              // m/s
    windGust: 2.5,
    palette: {
      sky: ['#8fc4e8', '#dbeaf5'],
      sun: '#fff6df',
      fog: '#cadcea',
      fairway: '#5f9c42', rough: '#3f6b32', deep: '#2f5326',
      green: '#7ec95e', fringe: '#67a84a',
      sand: '#e3cf9c', water: '#2a7f96', dirt: '#6b5a3e',
      trunk: '#4a3524'
    },
    ambient: 0.55, sunElev: 52, sunAzim: 135
  },

  /* ------------------------------------------------------------- LINKS --- */
  links: {
    id: 'links',
    name: 'Cairnmoor Links',
    blurb: 'Wind-scoured coastal links. Firm running fairways, deep pot bunkers, no trees to hide behind.',
    region: 'Ayrshire, Scotland',
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
    greenSize: [18, 27],
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
      trunk: '#5a4a30'
    },
    ambient: 0.62, sunElev: 34, sunAzim: 200
  },

  /* ------------------------------------------------------------ DESERT --- */
  desert: {
    id: 'desert',
    name: 'Red Mesa',
    blurb: 'Target golf carved out of the canyon floor. Miss the grass and you are in the sand and scrub.',
    region: 'Arizona, USA',
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
    greenSize: [16, 22],
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
      trunk: '#5d4a32'
    },
    ambient: 0.7, sunElev: 66, sunAzim: 160
  },

  /* ------------------------------------------------------------ ALPINE --- */
  alpine: {
    id: 'alpine',
    name: 'Hochkar Alpine',
    blurb: 'Cut into a mountain valley. Big elevation changes — read the slope or the ball will not stop.',
    region: 'Tyrol, Austria',
    relief: 16,                 // the big one
    reliefScale: 210,
    ridged: 0.3,
    fairwayWidth: [26, 36],
    roughWidth: 20,
    treeDensity: 0.7,
    treeSpecies: ['spruce', 'spruce', 'fir'],
    treeHeight: [14, 24],
    waterChance: 0.3,
    waterKind: 'lake',
    bunkerCount: [1, 4],
    greenSpeed: 0.94,           // slower, wetter greens
    greenSize: [17, 23],
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
      trunk: '#3d2e1f'
    },
    ambient: 0.5, sunElev: 44, sunAzim: 120
  },

  /* ---------------------------------------------------------- TROPICAL --- */
  tropical: {
    id: 'tropical',
    name: 'Palmera Cay',
    blurb: 'Ocean on one side, lagoons on the other. Soft greens that hold, but water everywhere.',
    region: 'Quintana Roo, Mexico',
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
    greenSize: [18, 25],
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
      trunk: '#6b5334'
    },
    ambient: 0.66, sunElev: 60, sunAzim: 145
  }
};

export const COURSE_ORDER = ['parkland', 'links', 'desert', 'alpine', 'tropical'];

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
