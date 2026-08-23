/* =========================================================================
   biomes.js — the five courses and what makes each one play differently
   -------------------------------------------------------------------------
   Every visual and gameplay knob for an area lives here: terrain relief,
   hazard tendencies, tree species, palette, wind and green speed.  The hole
   generator reads these, so adding a sixth course is a matter of adding an
   entry rather than writing new code.
   ========================================================================= */

import { realCourseIds, realCourse } from './realcourses.js';

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
  },

  /* ---------------------------------------------------------- SANDBELT ---
     Melbourne. The one course here where the BUNKERING is the hazard rather
     than the water or the trees: huge sculpted traps with steep sand faces
     cut right into the edge of the green, over baked-out couch grass that
     runs forever. Wide off the tee and terrifying from a hundred yards, so
     it plays the exact opposite way round to the desert. */
  sandbelt: {
    id: 'sandbelt',
    name: 'Barwon Sandbelt',
    blurb: 'Baked couch fairways that run for miles, and the deepest bunkering in the game. Wide off the tee, brutal near the green.',
    region: 'Victoria, Australia',
    continent: 'asia-pacific',
    relief: 5,
    reliefScale: 240,           // broad, lazy folds — sand dunes gone to grass
    ridged: 0,
    fairwayWidth: [32, 44],     // the widest fairways here, and it is a trap
    roughWidth: 18,
    treeDensity: 0.34,
    treeSpecies: ['eucalypt', 'eucalypt', 'gorse'],
    treeHeight: [10, 18],
    waterChance: 0.12,          // almost none: this is a dry-land course
    waterKind: 'pond',
    bunkerCount: [7, 11],       // by far the most, and the point of the place
    greenSpeed: 1.18,           // the fastest greens in the game
    greenSize: [12, 17],
    windBase: 4.2,
    windGust: 3.4,
    firmness: 1.42,             // the hardest ground: everything releases
    palette: {
      sky: ['#7fb2dd', '#e6eef2'],
      sun: '#fff4d8',
      fog: '#dcd8c0',
      fairway: '#93a353', rough: '#7b7f3e', deep: '#615f30',
      green: '#8cc45c', fringe: '#7aac4e',
      sand: '#f0dfae', water: '#3b7f8c', dirt: '#8d7346',
      trunk: '#b4a893'          // eucalypts are pale — almost white in sun
    },
    ambient: 0.68, sunElev: 58, sunAzim: 20
  },

  /* ---------------------------------------------------------- VOLCANIC ---
     Kyushu. Cedar forest on old lava, cut narrow, with soft wet greens that
     hold anything you can land on them. The counterweight to the sandbelt:
     there, the ground gives you nothing and the air is free; here, the air
     is the hazard and the green is a friend. Almost no wind, but the
     corridors are the tightest in the game and the trees are enormous. */
  volcanic: {
    id: 'volcanic',
    name: 'Kurodake Forest',
    blurb: 'Cedar corridors on old lava. No wind to speak of, greens that hold anything — but the tightest driving lines you will play.',
    region: 'Kyushu, Japan',
    continent: 'asia-pacific',
    relief: 13,
    reliefScale: 120,           // steep, close-packed volcanic ground
    ridged: 0.55,
    fairwayWidth: [21, 28],     // the narrowest in the game
    roughWidth: 14,             // and barely any rough before the treeline
    treeDensity: 0.95,          // the densest forest
    treeSpecies: ['cedar', 'cedar', 'fir'],
    treeHeight: [16, 26],
    waterChance: 0.42,
    waterKind: 'pond',
    bunkerCount: [1, 4],
    greenSpeed: 0.88,           // slow, wet, and they hold
    greenSize: [13, 18],
    windBase: 1.2,              // the calmest air anywhere here
    windGust: 1.4,
    firmness: 0.74,             // soft: the ball lands and stops
    slopeBias: 1.15,
    cloudDensity: 1.6,          // low cloud sitting in the valley
    palette: {
      sky: ['#7d9db8', '#dfe7ea'],
      sun: '#fff2e4',
      fog: '#c2cfd2',
      fairway: '#4a8a45', rough: '#2f5f34', deep: '#22452a',
      green: '#68b855', fringe: '#569b45',
      sand: '#4a4640', water: '#2c6b78', dirt: '#3b332c',   // black volcanic sand
      trunk: '#6d5747'          // cedar bark: brown-grey, not terracotta
    },
    ambient: 0.58, sunElev: 46, sunAzim: 210
  },

  /* ------------------------------------------------------------- FJORD ---
     Iceland. No trees at all, black rock, and the ocean on the doorstep —
     links golf taken to its conclusion. The wind is the whole course: the
     strongest in the game by a margin, over ground that gives you nothing
     back. Short on the card and long in the hand. */
  fjord: {
    id: 'fjord',
    name: 'Grimsvik',
    blurb: 'Black rock and open ocean at the top of the world. No trees, nowhere to hide, and the hardest wind in the game.',
    region: 'Vestfirdir, Iceland',
    continent: 'europe',
    relief: 14,
    /* Relief 14 at a 105 m scale is twice Cairnmoor's amplitude at almost the
       same frequency — not big country, just chop, and a ball landing on it
       kicks somewhere random every time. The wind was getting the blame for
       scores the GROUND was causing. Broad landforms at 165 keep the drama
       and give the ball somewhere to settle. */
    reliefScale: 165,
    ridged: 0.6,
    fairwayWidth: [24, 34],
    roughWidth: 30,
    treeDensity: 0.02,          // effectively none
    treeSpecies: ['gorse', 'gorse', 'gorse'],
    treeHeight: [0.8, 1.8],
    waterChance: 0.55,
    waterKind: 'ocean',
    bunkerCount: [3, 7],
    bunkerStyle: 'pot',         // revetted, and deeper than you want
    greenSpeed: 1.05,
    greenSize: [14, 19],        // big greens, because nothing else is fair here
    /* The wind is the course, but 8.5 m/s gusting 4.2 was past hard and into
       pointless: competent players were coming in at +21 to +27 against +2
       to +5 everywhere else, and a course nobody can score on is a course
       nobody plays twice. 7.2 still makes this comfortably the windiest
       place in the game — Cairnmoor, the other links, sits at 6.5. */
    windBase: 7.2,
    windGust: 3.4,
    firmness: 1.30,
    slopeBias: 1.2,
    cloudDensity: 1.4,
    palette: {
      sky: ['#7a8ea3', '#c8d3da'],
      sun: '#f0eee6',
      fog: '#b4bfc6',
      fairway: '#6f8a52', rough: '#55693e', deep: '#3d4a30',
      green: '#7fa855', fringe: '#6c9147',
      sand: '#d6cdb8', water: '#2f5c78', dirt: '#4a4a46',
      trunk: '#5c5348'
    },
    /* A low northern sun is the character of the place, but 22 degrees put
       the whole course in half-light and you could not read the ground. 30
       still rakes long shadows across it; the ambient carries the rest. */
    ambient: 0.76, sunElev: 30, sunAzim: 240
  },

  /* ── the beginner's course ────────────────────────────────────────────
     Deliberately the easiest thing in the game, and the gap that mattered
     most: the softest course on the roster rated a slope of 113, which is
     average BY DEFINITION. There was nowhere for somebody's first nine
     holes to be easy. Everything here is turned the forgiving way — huge
     fairways, big flat greens, almost no water and barely any wind — so a
     new player can hit it, find it, and hit it again. */
  meadow: {
    id: 'meadow',
    name: 'Ashcombe Park',
    lengthScale: 0.90,          // shorter holes as well as wider ones
    blurb: 'A municipal meadow. Wide, flat and friendly — the place to learn.',
    region: 'Shropshire, England',
    continent: 'europe',
    relief: 3,
    reliefScale: 260,
    ridged: 0,
    fairwayWidth: [40, 52],
    roughWidth: 30,
    treeDensity: 0.34,
    treeSpecies: ['oak', 'maple'],
    treeHeight: [7, 12],
    waterChance: 0.12,
    waterKind: 'pond',
    bunkerCount: [0, 2],
    greenSpeed: 0.84,
    greenSize: [17, 21],
    windBase: 1.6,
    windGust: 1.2,
    palette: {
      sky: ['#9ccbe6', '#e2eef6'],
      sun: '#fff6e2',
      fog: '#d3e3ee',
      fairway: '#66a648', rough: '#487536', deep: '#365a28',
      green: '#84cf62', fringe: '#6cae4d',
      sand: '#e6d5a8', water: '#3d8fa2', dirt: '#6f6042',
      trunk: '#6d5239'
    },
    ambient: 0.60, sunElev: 48, sunAzim: 140
  },

  /* ── heathland ────────────────────────────────────────────────────────
     Heather instead of trees: the punishment is the LIE, not the obstacle.
     Narrow corridors through gorse with almost nothing overhead, which is a
     different kind of hard from the parkland's oaks — you can see the green
     from anywhere on it, you simply cannot advance the ball out of the
     stuff you are standing in. */
  heath: {
    id: 'heath',
    name: 'Blackthorn Heath',
    blurb: 'Heather and gorse over sand. You can see the green from anywhere in it.',
    region: 'Surrey, England',
    continent: 'europe',
    relief: 6,
    reliefScale: 170,
    ridged: 0,
    fairwayWidth: [22, 30],
    roughWidth: 34,
    treeDensity: 0.40,
    treeSpecies: ['pine', 'gorse'],
    treeHeight: [6, 13],
    waterChance: 0.16,
    waterKind: 'pond',
    bunkerCount: [4, 8],
    greenSpeed: 1.12,
    greenSize: [11, 15],
    windBase: 3.4,
    windGust: 2.8,
    palette: {
      sky: ['#a8bcd0', '#dfe7ee'],
      sun: '#fff0d6',
      fog: '#ccd6e0',
      fairway: '#6f9a4e', rough: '#6b4f6e', deep: '#4d3550',
      green: '#8ac96a', fringe: '#71a851',
      sand: '#dcc796', water: '#37788c', dirt: '#6a5740',
      trunk: '#5f4733'
    },
    ambient: 0.52, sunElev: 40, sunAzim: 150
  },

  /* ── high veld ────────────────────────────────────────────────────────
     Thin air and open ground: long carries, and a wind with nothing in the
     way of it. Africa, which the roster did not have at all. */
  veld: {
    id: 'veld',
    name: 'Wildeveld',
    blurb: 'High open veld. Thin air, long carries, and wind with nothing to break it.',
    region: 'Free State, South Africa',
    continent: 'africa',
    relief: 9,
    reliefScale: 220,
    ridged: 0,
    fairwayWidth: [26, 36],
    roughWidth: 24,
    treeDensity: 0.20,
    treeSpecies: ['eucalypt', 'palo'],
    treeHeight: [6, 11],
    waterChance: 0.22,
    waterKind: 'lake',
    bunkerCount: [3, 6],
    greenSpeed: 1.06,
    greenSize: [12, 16],
    windBase: 5.4,
    windGust: 4.2,
    palette: {
      sky: ['#7fb8dd', '#e8ecdf'],
      sun: '#fff3cf',
      fog: '#dfe0cd',
      fairway: '#89a54a', rough: '#8f8b47', deep: '#6f6a33',
      green: '#95ce68', fringe: '#7fae52',
      sand: '#e8d3a0', water: '#3d87a0', dirt: '#8a7048',
      trunk: '#7a6142'
    },
    ambient: 0.62, sunElev: 66, sunAzim: 20
  },

  /* ── the hardest thing on the roster ──────────────────────────────────
     A championship headland: cliff-edge holes, ocean on the wrong side, the
     smallest and fastest greens in the game, and wind that never drops. The
     ladder had nowhere to go past Grimsvik, so this is built to sit clearly
     beyond it — somewhere a good player can still score and a careless one
     cannot finish. */
  headland: {
    id: 'headland',
    name: 'Dunmara Head',
    lengthScale: 1.06,          // a championship card, off the very back
    blurb: 'Championship headland. Cliffs, ocean, tiny greens and a wind that never drops.',
    region: 'Co. Clare, Ireland',
    continent: 'europe',
    relief: 16,
    reliefScale: 130,
    ridged: 0.35,
    fairwayWidth: [17, 24],
    roughWidth: 40,
    treeDensity: 0.06,
    treeSpecies: ['gorse'],
    treeHeight: [3, 6],
    waterChance: 0.62,
    waterKind: 'ocean',
    bunkerCount: [5, 10],
    greenSpeed: 1.30,
    greenSize: [9, 12],
    windBase: 7.6,
    windGust: 6.0,
    palette: {
      sky: ['#7f95ab', '#ccd7e0'],
      sun: '#f4eede',
      fog: '#bcc9d4',
      fairway: '#5f8f4a', rough: '#4a6b3c', deep: '#35492b',
      green: '#7cbe5f', fringe: '#699e4c',
      sand: '#d8c8a4', water: '#2b5f7e', dirt: '#5d5340',
      trunk: '#4f4030'
    },
    ambient: 0.46, sunElev: 30, sunAzim: 200
  }
};

/* IN ORDER OF DIFFICULTY, easiest first — and the order is checked against
   the measured slope rating in test/difficultyorder.mjs rather than trusted.
   It was previously the order the courses happened to be written in, which
   put the sixth-hardest course first and the easiest one third; a player
   working down the list got no sense of progression at all.

   Slope is the right axis rather than yardage or par: it is exactly the
   question "how much harder is this for an ordinary golfer than for a very
   good one", it is computed from the real geometry in handicap.js, and it
   is the number the handicap system already uses. */
const GENERATED_ORDER = [
  'meadow',                                     //  97 — the beginners' course
  'volcanic', 'veld', 'desert', 'sandbelt',     // 109-114
  'alpine', 'parkland', 'links', 'tropical',    // 118-124
  'heath', 'fjord',                             // 128-131
  'headland'                                    // 139 — the championship test
];

/* Real, imported courses join the roster automatically. They are ids like
   any other from here on — nothing downstream knows or cares that one was
   surveyed rather than generated — so adding one is a matter of importing
   it, not of editing this list.

   Appended rather than sorted in: the difficulty order above is asserted by
   a test over the GENERATED courses, whose ratings are deterministic. A real
   course's rating depends on data that arrives with it, and blocking an
   import on where it lands in a list would be the tail wagging the dog. The
   picker sorts what it shows, which is where the ordering actually matters. */
export const COURSE_ORDER = [...GENERATED_ORDER, ...realCourseIds()];

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
  /* A eucalypt is nearly all trunk with a thin crown at the very top, and a
     cedar is a tall narrow spire. Both are deliberately SLIMMER than a
     broadleaf: the sandbelt is meant to be wide and open and the cedar
     corridors are already the tightest in the game, so a fat canopy on
     either would ruin the thing that makes the course what it is. */
  eucalypt: 0.22, cedar: 0.16,
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
  cedar: [0.66, 0.40],                 // a spire: leaves nearly all the way down
  eucalypt: [0.86, 0.20],              // a crown perched on a long bare trunk
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
/* `flag` is an icons.js NAME (all five share the one globe glyph — these are
   continents, not countries, and five near-identical globe-with-a-highlight
   icons would cost more to draw than they'd tell you). */
export const REGIONS = [
  { id: 'north-america', name: 'North America', flag: 'globe',
    blurb: 'Parkland and desert — generous off the tee, punishing around the green' },
  { id: 'europe', name: 'Europe', flag: 'globe',
    blurb: 'Wind off the sea, thin mountain air, and the north Atlantic' },
  { id: 'latin-america', name: 'Latin America', flag: 'globe',
    blurb: 'Water, palms and soft greens that hold' },
  { id: 'asia-pacific', name: 'Asia Pacific', flag: 'globe',
    blurb: 'Deep sand and cedar corridors — the widest driving and the tightest' },
  { id: 'africa', name: 'Africa', flag: 'globe',
    blurb: 'High open veld — thin air, long carries, and nothing to stop the wind' }
];

/**
 * The biome a course id draws its LOOK from.
 *
 * A generated course is its own biome. An imported one borrows a biome for
 * the palette, the trees and the sky, and supplies everything else itself —
 * so `BIOMES[id]` is undefined for it, and every lookup that went straight
 * through that silently dropped the course. That is how an imported course
 * generated fine, rated fine, and could not be chosen by anybody.
 */
export const biomeFor = id => BIOMES[id] || BIOMES[realCourse(id)?.biome] || null;

/**
 * What the picker shows for a course: the biome's look, with the real
 * course's own name, region and blurb over the top where it has them.
 */
export function courseMeta(id) {
  const bio = biomeFor(id);
  if (!bio) return null;
  const real = realCourse(id);
  return real
    ? { ...bio, id, name: real.name, region: real.region, blurb: real.blurb, real: true }
    : { ...bio, id };
}

/** Courses grouped by region, in REGIONS order, with empty regions dropped. */
export function coursesByRegion() {
  return REGIONS.map(r => ({
    ...r,
    courses: COURSE_ORDER
      .filter(id => biomeFor(id)?.continent === r.id)
      .map(courseMeta)
  })).filter(r => r.courses.length > 0);
}

/** Which region a course belongs to, or null if it has not been placed. */
export const regionOf = id =>
  REGIONS.find(r => r.id === biomeFor(id)?.continent) || null;

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
