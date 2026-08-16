#!/usr/bin/env node
/* =========================================================================
   import-course.mjs — turn a real golf course into a playable one
   -------------------------------------------------------------------------
   Reads a GeoJSON export of a course's OpenStreetMap data and writes an
   entry into public/js/shared/realcourses.js.

   ── GETTING THE DATA ──────────────────────────────────────────────────────

   Most golf courses are already mapped. Go to overpass-turbo.eu, put the
   course in view, and run:

       [out:json][timeout:60];
       (
         way["golf"](bbox);
         relation["golf"](bbox);
       );
       out geom;

   Then Export → GeoJSON. That is the file this takes.

   ── WHAT IT READS ─────────────────────────────────────────────────────────

     golf=hole          a LineString down the middle of the hole, tee first.
                        `par` and `ref` tags are used when present.
     golf=green         a polygon. Its centroid is the green, its area gives
                        the radius.
     golf=fairway       a polygon. Its area over the hole's length gives the
                        corridor width.
     golf=bunker        polygons, fitted to ellipses.
     golf=water_hazard  polygons, likewise. `lateral_water_hazard` too.

   Anything missing falls back to the generator's own numbers, so a
   thinly-mapped course still imports and plays — it simply gets invented
   bunkers instead of real ones, and says so in the report.

   ── PROJECTION ────────────────────────────────────────────────────────────

   Longitude and latitude are degrees on a sphere; the game is metres on a
   plane. Over a golf course — two kilometres at the very outside — an
   equirectangular projection about the course's own centre is accurate to
   a few centimetres, which is well inside the width of a mown edge. Doing
   anything cleverer here would be precision the source data does not have.

   ── USAGE ─────────────────────────────────────────────────────────────────

     node tools/import-course.mjs course.geojson \
       --id rosewood --name "Rosewood" --region "Rosewood, NSW" \
       --biome parkland --blurb "..." --permission "email 2026-08-14, R. Chen"

   `--permission` is required and is not decoration: a real club's NAME is a
   trademark even where its layout is not, and this tool records who said
   yes so that the answer is written down somewhere other than somebody's
   memory. Use --name to give it an original name instead if you would
   rather not ask.
   ========================================================================= */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const HOLES = 9;
const OUT = new URL('../public/js/shared/realcourses.js', import.meta.url);

/* ------------------------------------------------------------- arguments -- */
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    /* A flag with no value is a boolean. Taking the next argument
       unconditionally meant `--dry` at the end of the line swallowed
       `undefined` and read as false, and `--dry --id x` would have eaten the
       flag after it. */
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[a.slice(2)] = true;
    else out[a.slice(2)] = argv[++i];
  }
  return out;
}

function die(msg) {
  console.error('\n  ✗ ' + msg + '\n');
  process.exit(1);
}

/* ------------------------------------------------------------ projection -- */
/**
 * Degrees to metres, about a fixed origin.
 *
 * A degree of latitude is 111.32 km everywhere; a degree of longitude is
 * that times cos(latitude), which is why the origin's latitude is baked in
 * rather than recomputed per point — over a course it does not change
 * enough to matter, and recomputing it would bend straight lines.
 */
const M_PER_DEG = 111320;
function projector(lat0, lon0) {
  const kx = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  return ([lon, lat]) => [ (lon - lon0) * kx, (lat - lat0) * M_PER_DEG ];
}

/* -------------------------------------------------------------- geometry -- */
const ringOf = f =>
  f.geometry?.type === 'Polygon' ? f.geometry.coordinates[0]
  : f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates[0][0]
  : null;

const lineOf = f =>
  f.geometry?.type === 'LineString' ? f.geometry.coordinates
  : f.geometry?.type === 'MultiLineString' ? f.geometry.coordinates.flat()
  : null;

/** Centroid and area of a projected ring, by the shoelace formula. */
function ringStats(pts) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [x1, z1] = pts[j], [x2, z2] = pts[i];
    const f = x1 * z2 - x2 * z1;
    a += f; cx += (x1 + x2) * f; cz += (z1 + z2) * f;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-9) {
    // degenerate: fall back to the mean of the points
    const n = pts.length || 1;
    return { x: pts.reduce((s, p) => s + p[0], 0) / n,
             z: pts.reduce((s, p) => s + p[1], 0) / n, area: 0 };
  }
  return { x: cx / (6 * a), z: cz / (6 * a), area: Math.abs(a) };
}

/**
 * The ellipse that best stands in for a polygon.
 *
 * The game draws bunkers and water as rotated ellipses with an edge wobble,
 * so a traced outline has to become one. Taken from the principal axes of
 * the outline — the direction it is longest in, and the direction at right
 * angles — which keeps a long thin greenside bunker long and thin instead
 * of turning it into a circle of the same area.
 */
function fitEllipse(pts) {
  const c = ringStats(pts);
  let sxx = 0, szz = 0, sxz = 0;
  for (const [x, z] of pts) {
    const dx = x - c.x, dz = z - c.z;
    sxx += dx * dx; szz += dz * dz; sxz += dx * dz;
  }
  const n = Math.max(1, pts.length);
  sxx /= n; szz /= n; sxz /= n;
  const rot = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const cs = Math.cos(rot), sn = Math.sin(rot);
  let ra = 0, rb = 0;
  for (const [x, z] of pts) {
    const dx = x - c.x, dz = z - c.z;
    ra = Math.max(ra, Math.abs(dx * cs + dz * sn));
    rb = Math.max(rb, Math.abs(-dx * sn + dz * cs));
  }
  return { x: +c.x.toFixed(2), z: +c.z.toFixed(2),
           rx: +Math.max(2, ra).toFixed(2), rz: +Math.max(2, rb).toFixed(2),
           rot: +rot.toFixed(3), area: c.area };
}

const lengthOf = pts => {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return d;
};

/** Is a point inside the axis-aligned box of a ring, loosely? */
const nearRing = (p, e, pad = 25) =>
  Math.hypot(p[0] - e.x, p[1] - e.z) < Math.max(e.rx, e.rz) + pad;

/* ------------------------------------------------------------------ main -- */
const args = parseArgs(process.argv.slice(2));
const src = args._[0];

if (!src || args.help) {
  console.log(`
  Turn a real course into a playable one.

    node tools/import-course.mjs <course.geojson> --id <id> --name "<name>" \\
      --region "<Town, Country>" --biome <biome> --permission "<who, when>"

  Optional:  --blurb "<one line>"   --dry   (report without writing)

  See the header of this file for how to export the GeoJSON, and
  public/js/shared/realcourses.js for what you may and may not name a course.
`);
  process.exit(src ? 0 : 1);
}

for (const need of ['id', 'name', 'region', 'biome']) {
  if (!args[need]) die(`--${need} is required`);
}
if (!/^[a-z][a-z0-9-]{1,23}$/.test(args.id)) {
  die('--id must be lowercase letters, digits and dashes');
}
if (!args.permission && !args.dry) {
  die('--permission is required: record who agreed to this course being used,\n' +
      '    and when. A layout is a geographic fact; a club\'s NAME is a trademark.\n' +
      '    If you would rather not ask, give it an original name with --name.');
}

const raw = JSON.parse(await readFile(src, 'utf8'));
const features = raw.features || (raw.type === 'Feature' ? [raw] : []);
if (!features.length) die('no features in that GeoJSON');

const tag = (f, k) => f.properties?.[k] ?? f.properties?.tags?.[k];
const isGolf = (f, v) => tag(f, 'golf') === v;

/* Centre the projection on the middle of everything, so coordinates come
   out small and symmetrical rather than as large offsets from Greenwich. */
let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
const eachCoord = (g, fn) => {
  if (!g) return;
  const walk = c => Array.isArray(c[0]) ? c.forEach(walk) : fn(c);
  walk(g.coordinates);
};
for (const f of features) eachCoord(f.geometry, ([x, y]) => {
  lo = [Math.min(lo[0], x), Math.min(lo[1], y)];
  hi = [Math.max(hi[0], x), Math.max(hi[1], y)];
});
const lon0 = (lo[0] + hi[0]) / 2, lat0 = (lo[1] + hi[1]) / 2;
const project = projector(lat0, lon0);

/* ---- the holes ---------------------------------------------------------- */
const holeFeatures = features.filter(f => isGolf(f, 'hole') && lineOf(f));
if (!holeFeatures.length) die('no golf=hole ways found — is this a golf course export?');

holeFeatures.sort((a, b) => {
  const na = Number(tag(a, 'ref')) || 999, nb = Number(tag(b, 'ref')) || 999;
  return na - nb;
});

const greens = features.filter(f => isGolf(f, 'green') && ringOf(f))
  .map(f => fitEllipse(ringOf(f).map(project)));
const fairways = features.filter(f => isGolf(f, 'fairway') && ringOf(f))
  .map(f => fitEllipse(ringOf(f).map(project)));
const bunkers = features.filter(f => isGolf(f, 'bunker') && ringOf(f))
  .map(f => fitEllipse(ringOf(f).map(project)));
const waters = features
  .filter(f => (isGolf(f, 'water_hazard') || isGolf(f, 'lateral_water_hazard')) && ringOf(f))
  .map(f => fitEllipse(ringOf(f).map(project)));

const report = [];
const holes = [];

for (let i = 0; i < Math.min(HOLES, holeFeatures.length); i++) {
  const f = holeFeatures[i];
  let route = lineOf(f).map(project);

  /* OSM does not promise which end of the way is the tee. A hole runs from
     the tee to the green, so whichever end is nearer a green polygon is the
     green end — and if the line is the wrong way round, reverse it. Getting
     this wrong plays the hole backwards, which is not subtle but is very
     easy to miss in a list of nine. */
  const nearestGreen = pt => greens.reduce(
    (best, g) => Math.min(best, Math.hypot(pt[0] - g.x, pt[1] - g.z)), Infinity);
  if (greens.length && nearestGreen(route[0]) < nearestGreen(route[route.length - 1])) {
    route = route.slice().reverse();
    report.push(`hole ${i + 1}: route reversed — it was drawn green-to-tee`);
  }

  const len = lengthOf(route);
  const end = route[route.length - 1];

  // the green nearest this hole's finish
  let green = null, bestD = 70;
  for (const g of greens) {
    const d = Math.hypot(end[0] - g.x, end[1] - g.z);
    if (d < bestD) { bestD = d; green = g; }
  }
  if (!green) report.push(`hole ${i + 1}: no green mapped nearby — using a generated one`);

  /* Par from the tag when it is there, otherwise from the length, using the
     bands a committee would use. */
  let par = Number(tag(f, 'par'));
  if (![3, 4, 5].includes(par)) {
    par = len < 210 ? 3 : len < 400 ? 4 : 5;
    report.push(`hole ${i + 1}: no par tag — read ${par} from ${Math.round(len)} m`);
  }

  // fairway corridor width, from the fairway polygon that overlaps this hole
  let fw = null;
  const mid = route[Math.floor(route.length / 2)];
  for (const fwy of fairways) {
    if (Math.hypot(mid[0] - fwy.x, mid[1] - fwy.z) < Math.max(fwy.rx, fwy.rz) + 40) {
      fw = Math.round(Math.min(60, Math.max(14, fwy.rz * 2)));
      break;
    }
  }

  const near = list => list.filter(e =>
    route.some(p => nearRing(p, e, 45))).map(({ area, ...rest }) => rest);

  const h = { par, route: route.map(([x, z]) => [+x.toFixed(1), +z.toFixed(1)]) };
  if (green) h.greenR = +Math.max(8, Math.sqrt(green.area / Math.PI)).toFixed(1);
  if (fw) h.fairwayWidth = fw;
  const hb = near(bunkers), hw = near(waters);
  if (hb.length) h.bunkers = hb;
  if (hw.length) h.waters = hw;
  holes.push(h);
}

if (holes.length < HOLES) {
  die(`only ${holes.length} holes found, need ${HOLES}. ` +
      'A nine-hole course needs nine golf=hole ways.');
}

/* ---- check it before writing ------------------------------------------- */
const { validateRealCourse } = await import('../public/js/shared/realcourses.js');
const entry = {
  id: args.id, name: args.name, region: args.region,
  blurb: args.blurb || `${args.name} — a real course, surveyed.`,
  biome: args.biome,
  attribution: '© OpenStreetMap contributors (ODbL)',
  permission: args.permission || '(dry run)',
  holes
};
const problems = validateRealCourse(entry);
if (problems.length) {
  console.error('\n  ✗ that course will not build:\n');
  for (const p of problems) console.error('     ' + p);
  console.error('');
  process.exit(1);
}

/* ---- the report -------------------------------------------------------- */
const totalYards = Math.round(holes.reduce((s, h) => s + lengthOf(h.route), 0) * 1.0936);
console.log(`\n  ${entry.name} — ${entry.region}`);
console.log(`  ${holes.length} holes · par ${holes.reduce((s, h) => s + h.par, 0)} · ${totalYards} yds`);
console.log(`  ${bunkers.length} bunkers and ${waters.length} water hazards mapped`);
for (const r of report) console.log('    · ' + r);
if (!report.length) console.log('    · everything mapped cleanly');

if (args.dry) {
  console.log('\n  (dry run — nothing written)\n');
  process.exit(0);
}

/* ---- write it in ------------------------------------------------------- */
const file = await readFile(OUT, 'utf8');
const marker = 'export const REAL_COURSES = {';
const at = file.indexOf(marker);
if (at < 0) die('could not find REAL_COURSES in realcourses.js');

if (new RegExp(`\\n  ${args.id}:`).test(file)) {
  die(`'${args.id}' is already in realcourses.js — remove it first, or use a different --id`);
}

/* Compact the numeric arrays onto single lines. `JSON.stringify(_, null, 2)`
   puts every coordinate of every route on a line of its own, which turns a
   nine-hole course into two thousand lines and puts all of it in the
   browser bundle. A route reads better as rows of pairs anyway. */
const body = JSON.stringify(entry, null, 2)
  .replace(/\[\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g, '[$1, $2]')
  .replace(/\{\s+("(?:x|kind)"[\s\S]{0,200}?)\s+\}/g,
           (m, inner) => '{ ' + inner.replace(/\s*\n\s*/g, ' ') + ' }')
  .split('\n').map((l, i) => (i === 0 ? l : '  ' + l)).join('\n');
const insert = `\n  /* Imported ${new Date().toISOString().slice(0, 10)} from OpenStreetMap.\n` +
  `     Permission: ${entry.permission} */\n  ${args.id}: ${body},\n`;

const next = file.slice(0, at + marker.length) + insert + file.slice(at + marker.length);
await writeFile(OUT, next, 'utf8');

console.log(`\n  ✓ written into public/js/shared/realcourses.js as '${args.id}'`);
console.log('    Run `npm test` — realcourses.mjs will check it builds and plays.\n');
