/* =========================================================================
   weather.js — what the sky is doing, and what that costs you
   -------------------------------------------------------------------------
   Every round in this game has been played at the same hour of the same
   perfect day since the day it was built. Eight courses in eight climates,
   and the only thing that ever varied was the wind speed.

   This gives a round a TIME, a SEASON and a CONDITION, and makes all three
   matter — not as a filter over the picture, but in the golf: a wet fairway
   does not run, cold air does not carry, fog takes the flag away from you.

   THREE RULES.

   It is SHARED and DETERMINISTIC. Weather changes how far the ball goes, so
   the server and every client have to agree about it exactly, the same way
   they agree about the course. It is derived from the room's seed — no
   Math.random, no Date.now in the derivation, no server broadcast to keep in
   step.

   It is BOUNDED. The worst weather in here costs about 4% of carry and adds
   about a club of wind. A round that is unplayable because of dice nobody
   rolled is a round the player did not choose, and "the weather beat me" is
   only a good story when the weather was survivable.

   And it is HONEST ON SCREEN. Every effect that touches the ball is shown
   before the shot, in the same panel the wind already uses. A hidden
   modifier is indistinguishable from a bug.
   ========================================================================= */

/* ------------------------------------------------------------- seasons ---
   The four are picked from the real calendar month, not from the seed: it
   should be autumn in the game when it is autumn where the player is, which
   costs nothing and is the sort of thing people notice and like.

   `grass` and `tree` multiply the biome's own palette rather than replacing
   it, so a links course in autumn is still a links course. */
export const SEASONS = [
  { id: 'spring', name: 'Spring',
    grass: [1.04, 1.10, 0.96], tree: [0.98, 1.08, 0.94],
    // spring air is cool and dense: slightly less carry
    carry: 0.995, daylight: [6.4, 19.2], bloom: 1.0 },
  { id: 'summer', name: 'Summer',
    grass: [1.10, 1.02, 0.80], tree: [1.02, 1.00, 0.90],
    carry: 1.010, daylight: [5.2, 21.0], bloom: 0.55 },
  { id: 'autumn', name: 'Autumn',
    grass: [1.12, 0.94, 0.74], tree: [1.22, 0.82, 0.58],
    carry: 0.998, daylight: [7.1, 18.4], bloom: 0.2 },
  { id: 'winter', name: 'Winter',
    grass: [0.86, 0.88, 0.84], tree: [0.80, 0.82, 0.84],
    // cold, dense air is the biggest natural carry penalty in golf
    carry: 0.972, daylight: [8.2, 16.4], bloom: 0 }
];

export const seasonOf = (month = new Date().getMonth()) => {
  // `% 12` on a negative month is negative in JavaScript, which indexes off
  // the end of the array and returns undefined rather than a season
  const m = ((Math.trunc(Number(month) || 0) % 12) + 12) % 12;
  return SEASONS[[3, 3, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3][m]];
};

export const seasonById = id => SEASONS.find(s => s.id === id) || SEASONS[1];

/* ---------------------------------------------------------- conditions ---
   What the sky is doing. Every field that is not a colour is a real effect.

     carry     multiplier on ball speed — rain and cold cost distance
     roll      multiplier on ground roll — a wet fairway does not run
     windMul   how much the round's wind is scaled
     vis       fog distance multiplier — 1 is the clear-day 1900 m
     grip      how much a putt breaks less on a wet green (slower surface) */
export const CONDITIONS = [
  { id: 'clear',   name: 'Clear',        icon: '☀️', weight: 30,
    carry: 1,      roll: 1,     windMul: 0.8, vis: 1.00, grip: 1,    wet: 0,   cloud: 0.25 },
  { id: 'fair',    name: 'Fair',         icon: '🌤️', weight: 26,
    carry: 1,      roll: 1,     windMul: 1.0, vis: 0.94, grip: 1,    wet: 0,   cloud: 0.5 },
  { id: 'cloudy',  name: 'Overcast',     icon: '☁️', weight: 18,
    carry: 0.998,  roll: 0.99,  windMul: 1.1, vis: 0.82, grip: 1,    wet: 0.1, cloud: 0.9 },
  { id: 'breezy',  name: 'Blowing',      icon: '🍃', weight: 12,
    carry: 1,      roll: 1.03,  windMul: 1.7, vis: 0.90, grip: 1,    wet: 0,   cloud: 0.45 },
  { id: 'drizzle', name: 'Drizzle',      icon: '🌦️', weight: 8,
    carry: 0.990,  roll: 0.90,  windMul: 1.2, vis: 0.66, grip: 0.94, wet: 0.55, cloud: 0.95,
    rain: 0.35 },
  { id: 'rain',    name: 'Rain',         icon: '🌧️', weight: 5,
    carry: 0.976,  roll: 0.78,  windMul: 1.4, vis: 0.44, grip: 0.88, wet: 1,   cloud: 1,
    rain: 1 },
  { id: 'fog',     name: 'Fog',          icon: '🌫️', weight: 4,
    carry: 0.995,  roll: 0.97,  windMul: 0.5, vis: 0.16, grip: 1,    wet: 0.3, cloud: 0.7 },
  { id: 'snow',    name: 'Snow',         icon: '🌨️', weight: 3,
    carry: 0.962,  roll: 0.82,  windMul: 1.1, vis: 0.36, grip: 0.9,  wet: 0.7, cloud: 1,
    snow: 1 }
];

export const conditionById = id => CONDITIONS.find(c => c.id === id) || CONDITIONS[0];

/* Some weather does not belong on some courses. A links in Ayrshire is
   windy; the Sonoran desert does not get snow, and Iceland in this game is
   not having a clear still day. Multipliers on the base weight — zero means
   never. */
const CLIMATE = {
  parkland: { snow: 0.3, fog: 1.2 },
  links:    { breezy: 3.0, rain: 2.0, drizzle: 2.0, snow: 0.2, clear: 0.5 },
  desert:   { snow: 0, rain: 0.15, drizzle: 0.2, fog: 0.2, clear: 2.5 },
  alpine:   { snow: 2.5, fog: 1.8, clear: 0.8 },
  tropical: { snow: 0, rain: 2.2, drizzle: 1.6, fog: 0.5 },
  sandbelt: { snow: 0.05, rain: 0.6, clear: 1.8 },
  volcanic: { rain: 1.8, fog: 1.6, snow: 0.4 },
  fjord:    { snow: 3.0, fog: 2.0, breezy: 2.2, clear: 0.25, rain: 1.5 }
};

/* -------------------------------------------------------------- picking ---
   A tiny seeded generator, local to this file. The shared rng kit takes a
   whole seed and produces a stream; here a single reproducible number from
   a seed and a salt is all that is wanted, and pulling in the stream would
   couple the weather to the order it is asked for. */
function hash01(seed, salt) {
  let h = (Math.imul(seed >>> 0, 0x9e3779b1) ^ Math.imul(salt >>> 0, 0x85ebca6b)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * The weather for one round, from the room's seed and the course.
 *
 * @param seed      the room seed — the same number the course is built from
 * @param courseId  for the climate table
 * @param season    optional override; defaults to the real calendar season
 */
export function weatherFor(seed, courseId, season = null) {
  const s = season ? seasonById(season) : seasonOf();
  const bias = CLIMATE[courseId] || {};

  // pick a condition by weight
  const pool = CONDITIONS.map(c => {
    let w = c.weight * (bias[c.id] ?? 1);
    // and by season: snow in July is a bug, not a surprise
    if (c.id === 'snow') w *= s.id === 'winter' ? 2.4 : s.id === 'autumn' ? 0.25 : 0;
    if (c.id === 'fog') w *= s.id === 'autumn' || s.id === 'winter' ? 1.6 : 0.7;
    if (c.id === 'clear') w *= s.id === 'summer' ? 1.5 : 1;
    return { c, w: Math.max(0, w) };
  });
  const total = pool.reduce((a, p) => a + p.w, 0) || 1;
  let roll = hash01(seed, 0x5EA5) * total;
  let cond = pool[0].c;
  for (const p of pool) { roll -= p.w; if (roll <= 0) { cond = p.c; break; } }

  /* The hour. Weighted toward the middle of the day rather than uniform —
     most golf is played between nine and five, and a game where half the
     rounds are at dusk is a game where dusk stops being special. */
  const [dawn, dusk] = s.daylight;
  const k = hash01(seed, 0xA11E);
  /* CLAMPED, and it has to be: the shaping term is
     0.5 + (k−0.5)·|k−0.5|·2.2, which at k=0 comes out at −0.05. Multiplied
     by a fifteen-hour summer span that is forty-seven minutes BEFORE dawn,
     and the light model correctly answered that the sun was below the
     horizon — so about one round in a thousand was played in the dark. */
  const shaped = Math.max(0, Math.min(1, 0.5 + (k - 0.5) * Math.abs(k - 0.5) * 2.2));
  const hour = dawn + 0.6 + shaped * (dusk - dawn - 1.4);

  return {
    season: s.id, seasonName: s.name,
    condition: cond.id, conditionName: cond.name, icon: cond.icon,
    hour: Math.round(hour * 10) / 10,
    /* One place computes the combined effects, so nothing downstream has to
       remember to multiply the season in as well as the condition.

       CLAMPED, and the clamp is the whole reason this is a single function.
       Season and condition multiply: winter (0.972) with snow (0.962) is
       0.935, which is sixteen yards off a driver on top of a fairway that
       does not run — a round nobody chose to play and could not win. The
       floor holds the worst weather in the game to 4%, which is a club and
       a story rather than a different sport. */
    carry: Math.round(Math.max(0.960, cond.carry * s.carry) * 1000) / 1000,
    roll: Math.max(0.75, cond.roll),
    windMul: cond.windMul,
    vis: cond.vis,
    grip: cond.grip,
    wet: cond.wet,
    cloud: cond.cloud,
    rain: cond.rain || 0,
    snow: cond.snow || 0
  };
}

/* ---------------------------------------------------------- the daylight ---
   Sun elevation and azimuth from the hour, so the shadows point the right
   way and the light warms as it drops. Simplified — no latitude, no date —
   because a golf round lasts twenty minutes and nobody is checking the
   solar declination, but the SHAPE is right: low and warm at the ends, high
   and white in the middle. */
export function sunAt(hour, season = 'summer') {
  const s = seasonById(season);
  const [dawn, dusk] = s.daylight;
  const span = dusk - dawn;
  const t = (hour - dawn) / span;                    // 0 at dawn, 1 at dusk
  const day = t >= 0 && t <= 1;
  /* Elevation as a sine over the daylight span, peaking at solar noon and
     scaled by season — a winter sun never gets high, which is most of why
     winter light looks like winter light. */
  const peak = s.id === 'winter' ? 26 : s.id === 'summer' ? 68 : 48;
  const elev = day ? Math.sin(Math.max(0, Math.min(1, t)) * Math.PI) * peak : -8;
  // east at dawn through south at noon to west at dusk
  const azim = 95 + Math.max(0, Math.min(1, t)) * 170;
  return { elev, azim, up: day, t: Math.max(0, Math.min(1, t)) };
}

/**
 * The light's colour and strength at an hour. Returned as multipliers on the
 * biome's own palette so a course keeps its identity — a desert at dusk is
 * still a desert.
 */
export function lightAt(hour, season = 'summer') {
  const { elev, t, up } = sunAt(hour, season);
  if (!up) {
    // night: cold, dim, and the moon is the key
    return { warm: [0.62, 0.70, 1.00], strength: 0.16, ambient: 0.34,
             skyTop: [0.10, 0.14, 0.28], skyBot: [0.20, 0.24, 0.38], night: 1, golden: 0 };
  }
  /* Golden hour is a fact about air, not a filter: near the horizon the
     light travels through more atmosphere, the blue scatters out, and what
     reaches you is red. `low` is how near the horizon the sun is. */
  const low = Math.max(0, 1 - elev / 24);            // 1 at the horizon, 0 by 24 degrees
  const golden = low * low;
  const warm = [
    1 + golden * 0.34,
    1 - golden * 0.10,
    1 - golden * 0.42
  ];
  const strength = 0.42 + Math.sin(t * Math.PI) * 0.72;
  return {
    warm, strength,
    ambient: 0.72 + Math.sin(t * Math.PI) * 0.36,
    skyTop: [1 - golden * 0.16, 1 - golden * 0.06, 1 + golden * 0.04],
    skyBot: [1 + golden * 0.30, 1 - golden * 0.02, 1 - golden * 0.30],
    night: 0, golden
  };
}

/** "3:40 pm" — the hour as a player reads a clock. */
export function clockText(hour) {
  const h = Math.floor(hour), m = Math.round((hour - h) * 60);
  const ampm = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** One line for the HUD: "Rain · 4:10 pm · autumn". */
export const weatherText = w =>
  `${w.icon} ${w.conditionName} · ${clockText(w.hour)} · ${w.seasonName.toLowerCase()}`;

/** What the weather is doing to your ball, for the pre-shot panel. */
/**
 * @param windMs  the wind the player is ACTUALLY getting, in m/s. Optional,
 *   because this is called from a couple of places and a missing value must
 *   not change what the older ones show.
 */
export function weatherEffects(w, windMs = null) {
  const out = [];
  const pct = v => Math.round((v - 1) * 1000) / 10;
  if (Math.abs(w.carry - 1) > 0.002) {
    out.push({ label: 'Carry', value: `${pct(w.carry) > 0 ? '+' : ''}${pct(w.carry)}%`,
               good: w.carry > 1 });
  }
  if (Math.abs(w.roll - 1) > 0.01) {
    out.push({ label: 'Roll', value: `${pct(w.roll) > 0 ? '+' : ''}${pct(w.roll)}%`,
               good: w.roll > 1 });
  }
  /* `windMul` is a MULTIPLIER on the round's wind, not the wind. Showing
     the chip on the multiplier alone meant a Blowing day on a still course
     announced "Wind strong" next to a rose reading 0 mph and "calm" — the
     panel contradicting itself in the space of two centimetres, which is
     exactly the sort of thing that makes a player stop believing any of it.

     1.7 times nothing is nothing. So the chip needs the resulting wind to
     be worth mentioning as well: about 5 m/s, which is where it starts
     costing a club. */
  if (w.windMul > 1.2 && (windMs == null || windMs >= 5)) {
    out.push({ label: 'Wind', value: 'strong', good: false });
  }
  if (w.vis < 0.5) out.push({ label: 'Visibility', value: 'poor', good: false });
  if (w.grip < 1) out.push({ label: 'Greens', value: 'slow', good: false });
  return out;
}
