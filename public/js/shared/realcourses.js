/* =========================================================================
   realcourses.js — courses that exist
   -------------------------------------------------------------------------
   Every other course in this game is invented: a biome, a seed, and nine
   holes the generator routes from scratch. This is where a REAL one goes —
   a routing traced from a course that exists, with its actual doglegs, its
   actual bunkers and its actual water.

   HOW A COURSE GETS HERE. `tools/import-course.mjs` reads a GeoJSON export
   of the course's OpenStreetMap data and writes an entry into this file.
   Nothing is fetched at runtime and nothing is loaded from disk: the whole
   roster is static, which is what lets the client and the server agree
   about a hole without either of them asking the other.

   WHAT AN ENTRY OWNS, AND WHAT IT DOES NOT. It owns the things a survey can
   tell you — the centreline of each hole, its par, where the sand and the
   water are, how wide the fairway is, how big the green is. Everything else
   is derived by the same code that finishes a generated hole: terrain,
   trees, props, elevation, out of bounds, the cup. So an imported course
   plays by identical rules and there is no second code path to keep in step.

   ── BEFORE YOU ADD ONE ────────────────────────────────────────────────────

   A course LAYOUT is a geographic fact. A course NAME is a trademark, and
   this game is published commercially — which is why the big golf titles
   license their course lists rather than surveying them. Two safe routes:

     1. Real routing, original name. Nobody's mark is being used.
     2. Real routing, real name, WITH the club's written permission. Small
        clubs are often glad to say yes; it costs them nothing and puts them
        in front of people.

   Do not add a real club's name on the strength of "it's only a small
   course" or "we'll ask later".

   ATTRIBUTION. OpenStreetMap data is ODbL, which requires crediting
   "© OpenStreetMap contributors" anywhere the derived course is shown. The
   `attribution` field below carries it, and the credits screen renders it —
   an entry imported from OSM without one is a licence breach, so the
   importer refuses to write it.
   ========================================================================= */

/**
 * @typedef {object} RealHole
 * @property {number} par
 * @property {[number,number][]} route  centreline, tee first, in metres
 * @property {number} [greenR]          green radius in metres
 * @property {number} [fairwayWidth]    corridor width in metres
 * @property {{x,z,rx,rz,rot?}[]} [bunkers]
 * @property {{x,z,rx,rz,kind?}[]} [waters]
 */

/**
 * @typedef {object} RealCourse
 * @property {string} id           unique, lowercase, no spaces
 * @property {string} name         what it is called in the picker
 * @property {string} region       "Town, Country"
 * @property {string} blurb        one line
 * @property {string} biome        which BIOMES entry supplies the look
 * @property {string} attribution  data credit — required for OSM sources
 * @property {RealHole[]} holes    nine of them
 */

/** @type {Record<string, RealCourse>} */
export const REAL_COURSES = {
  /* Imported courses land here. Empty is a valid roster — the game ships
     with twelve generated courses and this file is additive, so an install
     with no imports behaves exactly as it always has. */
};

export const realCourseIds = () => Object.keys(REAL_COURSES);
export const realCourse = id => REAL_COURSES[id] || null;
export const isRealCourse = id => Object.hasOwn(REAL_COURSES, id);

/**
 * Check an entry before the game tries to build it.
 *
 * Returns a list of problems, empty when it is sound. Called by the importer
 * before it writes and by a test over everything in the file, because a
 * malformed course is far easier to diagnose here than as a crash three
 * layers down inside terrain generation.
 */
export function validateRealCourse(c) {
  const bad = [];
  if (!c || typeof c !== 'object') return ['not an object'];
  for (const k of ['id', 'name', 'region', 'biome']) {
    if (!c[k] || typeof c[k] !== 'string') bad.push(`missing ${k}`);
  }
  if (!Array.isArray(c.holes)) return [...bad, 'holes is not an array'];
  if (c.holes.length !== 9) bad.push(`${c.holes.length} holes, expected 9`);

  c.holes.forEach((h, i) => {
    const at = `hole ${i + 1}`;
    if (!Array.isArray(h.route) || h.route.length < 2) {
      bad.push(`${at}: route needs at least two points`);
      return;
    }
    if (h.route.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))) {
      bad.push(`${at}: route has a point that is not a finite [x, z]`);
    }
    if (![3, 4, 5].includes(h.par)) bad.push(`${at}: par ${h.par} is not 3, 4 or 5`);
    /* Length is the check that actually catches a bad import. A projection
       mistake or a units mix-up shows up here as a hole of four metres or
       of forty kilometres, long before anything tries to render it. */
    let len = 0;
    for (let k = 1; k < h.route.length; k++) {
      len += Math.hypot(h.route[k][0] - h.route[k - 1][0], h.route[k][1] - h.route[k - 1][1]);
    }
    if (len < 80) bad.push(`${at}: only ${Math.round(len)} m long — check the projection`);
    if (len > 800) bad.push(`${at}: ${Math.round(len)} m long — check the units`);
  });
  return bad;
}
