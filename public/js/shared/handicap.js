/* =========================================================================
   handicap.js — how good you are, on a scale golf already agreed on
   -------------------------------------------------------------------------
   The game had one number for skill: a rating from 2 to 98 that drifted
   toward a target every round. It works, but it is ours, it means nothing
   outside this game, and it cannot answer the only question a golfer
   actually asks another golfer — "what do you play off?"

   So this is the real thing: a course rating and a slope for every one of
   the eight courses, computed from the holes rather than typed in, and a
   handicap index built from score differentials the way the World Handicap
   System builds one.

     differential = (score − course rating) × 113 ÷ slope
     index        = average of the best 8 of your last 20

   WHY COMPUTE THE RATINGS RATHER THAN AUTHOR THEM.

   Every course here is generated from a seed. A hand-written rating would
   be a guess that goes stale the moment a generator constant changes — and
   they have changed: trees doubled, greens grew 6%, the wobble stopped
   bulging outward. A rating derived from the geometry moves with the course
   it describes, which is the only way it stays true.

   NINE HOLES, NOT EIGHTEEN. Every round in this game is nine holes, so
   every rating, differential and index here is on a nine-hole scale and par
   is 36. The WHS would have you double a nine-hole differential to get an
   eighteen-hole index; doing that would print a number twice the size of
   anything a player here can check against their own card, which is worse
   than being unconventional. The scale is stated everywhere it is shown.
   ========================================================================= */

/* The reference nine: what a course of exactly average difficulty looks
   like. Everything below is a departure from these, in strokes. */
const REF = {
  yards: 3320,        // a standard nine off the middle tees
  fairway: 34,        // metres of short grass, corridor width
  rough: 24,          // metres of rough either side before it gets serious
  greenR: 13.5,       // metres, green radius
  bunkers: 14,        // per nine
  waters: 3,          // per nine
  climb: 34,          // metres of cumulative elevation change per nine
  wind: 3.4           // m/s of prevailing wind — a normal breezy afternoon
};

/* Strokes per unit of departure. Every one of these is the answer to "how
   much harder does this make a nine for a scratch golfer", and they are
   deliberately small — the spread across eight courses should be a few
   strokes, which is what a real set of ratings looks like. */
const W = {
  yards: 1 / 240,     // a stroke per 240 yards of extra length
  narrow: 0.055,      // per metre the fairway is narrower than the reference
  rough: 0.020,       // per metre of extra rough
  green: 0.075,       // per metre the greens are smaller
  bunker: 0.030,      // per bunker over the reference
  water: 0.150,       // per water hazard over the reference — the expensive one
  climb: 0.0065,      // per metre of cumulative climb
  /* Per m/s of prevailing wind over the reference. Wind was missing from
     this model entirely, which meant a headland course that plays in a
     permanent 7 m/s gale rated exactly the same as a sheltered meadow with
     the same yardage — and it is the single thing players would name first
     if you asked which of the two was harder.

     Weighted like roughly two-thirds of a club per m/s over nine holes: it
     costs a scratch player some clubbing decisions and it costs an ordinary
     one a lot of golf balls, which is exactly what slope measures. */
  wind: 0.085
};

/* A bogey golfer is hurt MORE than a scratch golfer by the same feature, and
   by different amounts for different features: length and forced carries are
   brutal, a small green barely registers when you were not going to hit it
   anyway. The gap between the two ratings is what slope measures. */
/* Wind at 2.9 is the second-highest multiplier here, behind water and just
   ahead of yardage — deliberately. A scratch player flights the ball down
   and takes more club; an ordinary one balloons it, loses thirty yards into
   the breeze and puts it in the gorse. Nothing else on this list separates
   the two as sharply. */
const BOGEY = { yards: 2.6, narrow: 2.2, rough: 2.4, green: 0.7, bunker: 1.8,
                water: 3.1, climb: 1.4, wind: 2.9 };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Sum up what a course is made of. One pass, so a rating is cheap. */
function measure(course) {
  const holes = course.holes || [];
  if (!holes.length) return null;
  let yards = 0, fairway = 0, rough = 0, greenR = 0, bunkers = 0, waters = 0, climb = 0, par = 0;
  for (const h of holes) {
    yards += h.yards || (h.total * 1.0936);
    fairway += h.fairwayWidth || REF.fairway;
    rough += h.roughWidth || REF.rough;
    greenR += h.green?.r || REF.greenR;
    bunkers += (h.bunkers || []).length;
    waters += (h.waters || []).length;
    par += h.par || 4;
    /* Elevation as CUMULATIVE change rather than net: a hole that climbs
       twenty metres and comes back down is a hard walk and a hard set of
       clubbing decisions, and a net figure of zero says neither. */
    const e = h.elevProfile;
    if (e) climb += Math.abs(e.drop || 0) + Math.abs(e.midBump || 0) * 1.4;
  }
  const n = holes.length;
  /* Wind is a property of the PLACE, not of a hole, so it comes off the
     biome rather than being averaged out of the holes like everything else.
     A course with no biome attached falls back to the reference, which
     leaves such a course rated exactly as it was before wind existed. */
  const wind = course.biome?.windBase ?? REF.wind;
  return {
    n, par, yards,
    fairway: fairway / n, rough: rough / n, greenR: greenR / n,
    bunkers, waters, climb, wind
  };
}

/**
 * The course rating: the score a scratch golfer is expected to shoot.
 * Returned to one decimal, as golf writes it.
 */
export function courseRating(course) {
  const m = measure(course);
  if (!m) return 36;
  const d = departures(m);
  const over =
    d.yards * W.yards + d.narrow * W.narrow + d.rough * W.rough +
    d.green * W.green + d.bunker * W.bunker + d.water * W.water + d.climb * W.climb +
    d.wind * W.wind;
  return Math.round((m.par + over) * 10) / 10;
}

/* How much a GENEROUS feature counts for, against what a punishing one
   counts against. Not symmetric, because golf is not: taking ten metres off
   a fairway costs an ordinary player far more than adding ten metres saves
   them — at some width you simply stop missing it, and every metre after
   that is free. */
const EASE = 0.45;

/**
 * How far this course sits from the reference nine, feature by feature.
 *
 * These four used to be clamped at zero, so a course could only ever be
 * measured as harder than the reference and never as easier: fifty-two metre
 * fairways were scored as thirty-four, and a flat course with big greens got
 * no credit for either. The lowest slope the whole model could produce was
 * about 112 — against a real-world floor of 55 — which meant a beginners'
 * course was not a thing the game could describe, let alone build.
 */
function departures(m) {
  const scale = m.n / 9;                   // so a different hole count still works
  /* Positive is harder. Below the reference the same distance counts for
     less, rather than not at all. */
  const eased = v => (v >= 0 ? v : v * EASE);
  return {
    yards: m.yards - REF.yards * scale,
    narrow: eased(REF.fairway - m.fairway),
    rough: eased(m.rough - REF.rough),
    green: eased(REF.greenR - m.greenR),
    bunker: m.bunkers - REF.bunkers * scale,
    water: m.waters - REF.waters * scale,
    climb: eased(m.climb - REF.climb * scale),
    wind: eased(m.wind - REF.wind)
  };
}

/**
 * Slope: how much harder this course plays for a bogey golfer than for a
 * scratch one. 113 is average by definition, and the WHS caps it at 55-155.
 */
export function slopeRating(course) {
  const m = measure(course);
  if (!m) return 113;
  const d = departures(m);
  let gap = 0;                             // bogey rating minus scratch rating
  gap += d.yards * W.yards * (BOGEY.yards - 1);
  gap += d.narrow * W.narrow * (BOGEY.narrow - 1);
  gap += d.rough * W.rough * (BOGEY.rough - 1);
  gap += d.green * W.green * (BOGEY.green - 1);
  gap += d.bunker * W.bunker * (BOGEY.bunker - 1);
  gap += d.water * W.water * (BOGEY.water - 1);
  gap += d.climb * W.climb * (BOGEY.climb - 1);
  gap += d.wind * W.wind * (BOGEY.wind - 1);
  /* A bogey golfer is about 8 strokes worse than scratch over nine on a
     course of average difficulty; that baseline is what 113 represents.
     5.381 is the WHS constant for men, applied to the nine-hole gap. */
  const BASE_GAP = 8;
  return clamp(Math.round(113 + gap * 5.381), 55, 155);
}

/** Both at once, which is how everything downstream wants them. */
export function ratingsFor(course) {
  return { rating: courseRating(course), slope: slopeRating(course) };
}

/**
 * One round's score differential.
 *
 * @param score   strokes taken (gross)
 * @param rating  the course rating
 * @param slope   the slope rating
 */
export const differential = (score, rating, slope) =>
  Math.round(((score - rating) * 113 / (slope || 113)) * 10) / 10;

/* How many of your best rounds count, by how many you have played. This is
   the WHS table, not an approximation of it — the whole point of using a
   real system is that a golfer can check it. `adj` is the extra allowance
   given while the sample is still thin. */
const COUNTING = [
  /* rounds, take best, adjustment.

     The adjustments are HALVED from the published table, and that is not a
     liberty — the WHS numbers (-2.0, -1.0) are strokes on an eighteen-hole
     differential, and everything here is on a nine-hole scale. Applied
     unscaled they hand a player two full strokes of credit off three rounds
     of nine, which had a golfer averaging +3.6 showing a plus handicap. */
  [3, 1, -1.0], [4, 1, -0.5], [5, 1, 0], [6, 2, -0.5], [7, 2, 0], [8, 2, 0],
  [9, 3, 0], [10, 3, 0], [11, 3, 0], [12, 4, 0], [13, 4, 0], [14, 4, 0],
  [15, 5, 0], [16, 5, 0], [17, 6, 0], [18, 6, 0], [19, 7, 0], [20, 8, 0]
];

/**
 * The handicap index, from a list of differentials (most recent last).
 *
 * Returns null below three rounds rather than a number — a handicap off one
 * round is not a handicap, and showing "Handicap: 24.0" to somebody who has
 * played once tells them something untrue about themselves.
 */
export function handicapIndex(differentials) {
  const list = (differentials || []).filter(d => Number.isFinite(d)).slice(-20);
  if (list.length < 3) return null;
  const row = COUNTING[Math.min(list.length, 20) - 3] || COUNTING[COUNTING.length - 1];
  const [, take, adj] = row;
  const best = list.slice().sort((a, b) => a - b).slice(0, take);
  const avg = best.reduce((a, b) => a + b, 0) / best.length;
  /* 0.96 is the WHS "bonus for excellence": it shades every index very
     slightly downward so that a field of players off their handicaps does
     not average out to a tie. */
  const idx = (avg + adj) * 0.96;
  return Math.round(clamp(idx, -10, 54) * 10) / 10;
}

/* ------------------------------------------------------------- the tiers ---
   Where a player sits against the course rating, which is a different
   question from their handicap: the handicap says how you play everywhere,
   this says how you are playing HERE. */
export const RATING_TIERS = [
  { id: 'S', name: 'Tier S', blurb: '3 or more under the rating', min: -99,  max: -3, color: '#e8c15a' },
  { id: 'A', name: 'Tier A', blurb: '1 to 3 under',               min: -3,   max: -1, color: '#a98cd8' },
  { id: 'B', name: 'Tier B', blurb: 'within 2 of the rating',     min: -1,   max: 2,  color: '#6fce8a' },
  { id: 'C', name: 'Tier C', blurb: '2 to 5 over',                min: 2,    max: 5,  color: '#7fb6dd' },
  { id: 'D', name: 'Tier D', blurb: '5 or more over',             min: 5,    max: 99, color: '#9fbaa6' }
];

/** Which tier an average-score-versus-rating figure falls in. */
export function ratingTier(avgVsRating) {
  if (!Number.isFinite(avgVsRating)) return null;
  for (const t of RATING_TIERS) {
    if (avgVsRating >= t.min && avgVsRating < t.max) return t;
  }
  return RATING_TIERS[RATING_TIERS.length - 1];
}

/* ------------------------------------------------------- the rank ladder ---
   The level bands, and what each one is called. Levels already exist and
   already gate the wardrobe; this is what a level MEANS.

   `ranks` is what the band unlocks in the ranking screens, and it is the
   part that has to be honest: a game with forty players cannot offer a
   meaningful regional ladder to a level-30 player and a global one to a
   level-60 one, so what these actually gate is which board you are LISTED
   on by default, not which you may look at. Everybody can see everything. */
/* `badge` is an icons.js NAME, not a literal glyph — see icons.js. */
export const RANK_TIERS = [
  { id: 'novice', name: 'Novice',       from: 1,  to: 10,
    color: '#6fce8a', glow: 'rgba(111,206,138,.30)', badge: 'seedling',
    ranks: 'Unranked — play five rounds to get a handicap' },
  { id: 'amateur', name: 'Amateur',     from: 11, to: 25,
    color: '#7fb6dd', glow: 'rgba(127,182,221,.32)', badge: 'golfer',
    ranks: 'Listed on your regional board' },
  { id: 'semipro', name: 'Semi-Pro',    from: 26, to: 50,
    color: '#a98cd8', glow: 'rgba(169,140,216,.34)', badge: 'flag',
    ranks: 'Regional rankings, weekly gainers' },
  { id: 'pro', name: 'Professional',    from: 51, to: 75,
    color: '#e8c15a', glow: 'rgba(232,193,90,.36)', badge: 'trophy',
    ranks: 'Global rankings and seasonal boards' },
  { id: 'master', name: 'Master',       from: 76, to: 100,
    color: '#dfe6ec', glow: 'rgba(223,230,236,.42)', badge: 'crown',
    ranks: 'Elite — eligible for the Hall of Fame' }
];

export function rankTier(level) {
  const L = clamp(Math.floor(Number(level) || 1), 1, 100);
  return RANK_TIERS.find(t => L >= t.from && L <= t.to) || RANK_TIERS[0];
}

/** "Owen, Semi-Pro" — the suffix that goes after a name on a board. */
export const rankTitle = level => rankTier(level).name;

/* ------------------------------------------------------- the milestones ---
   What each band gives you. Every one of these is a thing that already
   exists in the game — the wardrobe, hosting, the club tiers — rather than
   a promise of something that does not, which is the failure mode of a
   rewards table written before the features it names. */
export const MILESTONES = [
  { at: 10,  name: 'Amateur status',
    gives: 'Regional board, argyle and the first outfits' },
  { at: 25,  name: 'Semi-Pro status',
    gives: 'Club refinement, the weekly gainers board' },
  { at: 50,  name: 'Professional status',
    gives: 'Host your own rounds, global board, seasonal ladder' },
  { at: 75,  name: 'Master status',
    gives: 'Foil weave, exclusive decals, elite cosmetics' },
  { at: 100, name: 'Hall of Fame',
    gives: 'Permanent golden badge and every cosmetic in the game' }
];

/** The next milestone above a level, or null at the top. */
export const nextMilestone = level =>
  MILESTONES.find(m => m.at > (Number(level) || 1)) || null;

/* -------------------------------------------------------------- display ---
   A handicap is written with a sign and one decimal, and a PLUS handicap —
   better than scratch — is written "+2.4" rather than "-2.4", which looks
   backwards to anybody who has not played golf and is exactly right to
   anybody who has. */
export function handicapText(idx) {
  if (idx === null || idx === undefined || !Number.isFinite(idx)) return '—';
  if (idx < -0.05) return '+' + Math.abs(idx).toFixed(1);
  return idx.toFixed(1);
}

/** Where a handicap puts you, in words, for the line under the number. */
export function handicapBand(idx) {
  if (idx === null || !Number.isFinite(idx)) return 'Not enough rounds yet';
  if (idx < 0) return 'Better than scratch';
  if (idx < 5) return 'Scratch to 5 — a serious golfer';
  if (idx < 10) return 'Single figures';
  if (idx < 15) return 'A solid club player';
  if (idx < 20) return 'Mid handicap';
  if (idx < 28) return 'Improving';
  return 'Getting started';
}

/** "Top 15%" from a place and a field size. */
export function topPercent(place, of) {
  if (!place || !of || of < 2) return null;
  const pct = Math.ceil((place / of) * 100);
  return `Top ${clamp(pct, 1, 100)}%`;
}
