/* =========================================================================
   rng.js — deterministic randomness
   -------------------------------------------------------------------------
   Everything the world is built from (courses, holes, terrain, trees) comes
   out of these functions.  Same seed, same course, on every laptop and on the
   server.  Nothing in here touches the DOM or Math.random.
   ========================================================================= */

/** Fast, well-distributed 32-bit PRNG. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mix a few integers into one stable seed (so hole 3 of course 2 is always hole 3 of course 2). */
export function hashSeed(...parts) {
  let h = 0x811c9dc5;
  for (const p of parts) {
    let v = typeof p === 'string' ? strHash(p) : (p | 0);
    h ^= v;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function strHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** A little grab-bag of helpers on top of a raw 0..1 generator. */
export function rngKit(seed) {
  const r = mulberry32(seed);
  const kit = {
    raw: r,
    f: (a = 0, b = 1) => a + (b - a) * r(),
    i: (a, b) => Math.floor(a + (b - a + 1) * r()),
    bool: (p = 0.5) => r() < p,
    pick: arr => arr[Math.floor(r() * arr.length)],
    sign: () => (r() < 0.5 ? -1 : 1),
    /** roughly normal, mean 0 sd 1 */
    gauss: () => {
      let s = 0;
      for (let i = 0; i < 4; i++) s += r();
      return (s - 2) * 1.2247;
    },
    shuffle: arr => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }
  };
  return kit;
}

/* ------------------------------------------------------------------ noise */
/* Value noise with smooth interpolation.  Cheap, seedless-per-call (the seed
   is baked into the hash), and identical everywhere — which is what matters,
   since terrain height decides where the ball ends up. */

function hash2(ix, iz, seed) {
  let h = seed ^ Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

const fade = t => t * t * t * (t * (t * 6 - 15) + 10);

export function valueNoise2(x, z, seed) {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const fx = fade(x - x0), fz = fade(z - z0);
  const a = hash2(x0, z0, seed), b = hash2(x0 + 1, z0, seed);
  const c = hash2(x0, z0 + 1, seed), d = hash2(x0 + 1, z0 + 1, seed);
  const top = a + (b - a) * fx;
  const bot = c + (d - c) * fx;
  return top + (bot - top) * fz;      // 0..1
}

/** Fractal brownian motion — octaves of value noise. Returns roughly -1..1. */
export function fbm(x, z, seed, octaves = 4, lacunarity = 2.0, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * (valueNoise2(x * freq, z * freq, seed + o * 1013) * 2 - 1);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / (norm || 1);
}

/** Ridged noise — good for dunes and rocky spines. */
export function ridged(x, z, seed, octaves = 4) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(valueNoise2(x * freq, z * freq, seed + o * 7717) * 2 - 1);
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return (sum / (norm || 1)) * 2 - 1;
}

/* --------------------------------------------------------------- utilities */
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
};
export const M_PER_YARD = 0.9144;
export const toYards = m => m / M_PER_YARD;
export const toMeters = y => y * M_PER_YARD;
