/* =========================================================================
   test/physics.mjs — the golf itself
   -------------------------------------------------------------------------
   No server needed. Checks that club carries match real launch-monitor
   numbers, that putting holes out at believable rates, that every one of the
   45 holes is playable, and that a ball can never come to rest somewhere
   illegal.  Run with `npm run test:physics`.
   ========================================================================= */

import { allCourses, getCourse } from '../public/js/shared/coursegen.js';

/* BY ID, NOT BY POSITION. These used to be `allCourses()[0]` and `[3]` with
   the matching biome named separately — so the day the course list was
   reordered by difficulty, the test built parkland's terrain model around
   Willowbank's holes and then reported that putting and out-of-bounds were
   broken. The two halves of "which course" have to come from one place. */
const courseAndBiome = id => {
  const c = getCourse(id);
  return { c, bio: c.biome };
};
import { terrainFor } from '../public/js/shared/terrain.js';
import { BIOMES } from '../public/js/shared/biomes.js';
import { ShotSim, calibrateCarries, suggestedPower } from '../public/js/shared/ballistics.js';
import { CLUBS, suggestClub } from '../public/js/shared/clubs.js';

calibrateCarries();
const YD = 0.9144;
let failures = 0;
const ok = (name, pass, detail = '') => {
  if (!pass) failures++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '   [' + detail + ']' : ''}`);
};

/* ---------------------------------------------------------- club carries */
console.log('\nclub carries vs real launch-monitor numbers (metres)');
const TARGET = {
  DR: 245, W3: 222, W5: 207, I2: 199, W7: 197, I3: 193, H3: 192,
  I4: 187, H4: 182, I5: 175, H5: 172, I6: 164, I7: 152, I8: 140,
  I9: 128, PW: 117, GW: 104, SW: 88, LW: 70, XW: 58
};
const C = calibrateCarries();
let worst = 0, lastCarry = Infinity, monotonic = true;
for (const c of CLUBS) {
  if (c.putter) continue;
  const err = Math.abs(C[c.key] - TARGET[c.key]);
  worst = Math.max(worst, err);
  if (C[c.key] > lastCarry) monotonic = false;
  lastCarry = C[c.key];
}
ok('every club has a carry target', CLUBS.filter(c => !c.putter).every(c => TARGET[c.key] != null),
  CLUBS.filter(c => !c.putter && TARGET[c.key] == null).map(c => c.key).join(' ') || 'all covered');
ok('every club carries within 1 m of target', worst < 1, `worst ${worst.toFixed(2)} m`);
ok('carries decrease monotonically down the bag', monotonic);
ok('total always exceeds carry (the ball rolls)',
  CLUBS.filter(c => !c.putter).every(c => C[c.key + '_total'] > C[c.key]));
ok('a lob wedge checks up, a driver runs',
  (C.LW_total - C.LW) < (C.DR_total - C.DR),
  `LW +${(C.LW_total - C.LW).toFixed(1)}m vs DR +${(C.DR_total - C.DR).toFixed(1)}m`);

/* -------------------------------------------------------------- putting */
console.log('\nputting: hole-out rate for a careful player (±1.5° off the read, ±5% pace)');
{
  const { c, bio } = courseAndBiome('parkland'), h = c.holes[1], T = terrainFor(h, bio);
  // A green that breaks is the whole point of putting, so the modelled player
  // READS it — they aim along the line the caddie draws (the game shows this
  // as a curved aim line) and are then ±1.5° sloppy about that line.  Aiming
  // straight at the cup and calling the miss a physics failure would only be
  // asserting that greens must be flat.
  // the read is a property of the putt, not of the stroke, so it is worked out
  // once per distance — coarse sweep, then a fine pass around the best line
  const readCache = new Map();
  const readFor = (d, bx, bz, base, straight) => {
    if (readCache.has(d)) return readCache.get(d);
    // Score a line by whether it HOLES the putt, falling back to how close it
    // finishes.  Scoring on distance alone is degenerate at short range —
    // every line inside a couple of feet finishes about the same distance
    // away, so the search picked an arbitrary one and the "careful player"
    // ended up aiming three degrees off a one-metre putt.
    const miss = a => {
      const r = new ShotSim(T, {
        x: bx, z: bz, clubKey: 'PT', power: base,
        aim: straight + a * Math.PI / 180, wind: { dir: 0, speed: 0 }
      }).runToEnd();
      if (r.holed) return -1;
      return Math.hypot(r.x - h.pin.x, r.z - h.pin.z);
    };
    let best = 0, bestD = Infinity;
    for (let a = -12; a <= 12.001; a += 1) { const m = miss(a); if (m < bestD) { bestD = m; best = a; } }
    for (let a = best - 1; a <= best + 1.001; a += 0.1) { const m = miss(a); if (m < bestD) { bestD = m; best = a; } }
    const line = straight + best * Math.PI / 180;
    readCache.set(d, line);
    return line;
  };
  const putt = (d, aimOff, pf) => {
    const bx = h.pin.x - d, bz = h.pin.z;
    const straight = Math.atan2(h.pin.x - bx, h.pin.z - bz);
    const base = suggestedPower(T, bx, bz, 'PT', straight, { dir: 0, speed: 0 }, d + 0.45) ?? 1;
    return new ShotSim(T, {
      x: bx, z: bz, clubKey: 'PT', power: base * pf,
      aim: readFor(d, bx, bz, base, straight) + aimOff * Math.PI / 180, wind: { dir: 0, speed: 0 }
    }).runToEnd();
  };
  const rate = d => {
    let hits = 0, n = 0;
    for (let a = -1.5; a <= 1.5001; a += 0.25) for (let pf = 0.95; pf <= 1.051; pf += 0.025) {
      n++; if (putt(d, a, pf).holed) hits++;
    }
    return Math.round(100 * hits / n);
  };
  const r1 = rate(1), r3 = rate(3), r5 = rate(5), r12 = rate(12);
  console.log(`    1 m ${r1}%   3 m ${r3}%   5 m ${r5}%   12 m ${r12}%`);
  ok('short putts mostly drop', r1 >= 60, `${r1}% from 1 m`);
  // 65 samples per distance, so neighbouring distances can tie exactly; the
  // claim is that the trend falls, not that every step is strictly smaller
  ok('rate falls with distance', r1 > r3 && r3 >= r5 && r5 > r12,
     `${r1} / ${r3} / ${r5} / ${r12}`);
  // This player reads every green PERFECTLY and is only sloppy about the
  // stroke, so the long-putt rate is pure geometry: ±1.5° at 12 m sweeps
  // ±31 cm across a 10.8 cm cup.  A real golfer also misreads the break at
  // that range and makes far fewer — so the honest assertion is that a long
  // putt is several times harder than a short one, not an absolute tour rate.
  ok('long putts are far harder than short ones', r12 <= 25 && r12 * 3 < r1,
    `${r12}% from 12 m vs ${r1}% from 1 m`);
}

/* ----------------------------------------------------------- the caddie */
console.log("\ncaddie power suggestions land on the flag");
{
  const { c, bio } = courseAndBiome('parkland'), h = c.holes[1], T = terrainFor(h, bio);
  let worstPct = 0, tested = 0, skipped = 0;
  // place the ball back down the CENTRELINE — putting it due-west of the pin
  // walks straight off the course, where there is no legal shot to suggest
  for (const d of [30, 60, 90, 120, 160, 200]) {
    const s = Math.max(0, h.total - d);
    const i = Math.min(h.route.length - 1, Math.round(s / 3));
    const bx = h.route[i][0], bz = h.route[i][1];
    const real = Math.hypot(h.pin.x - bx, h.pin.z - bz);
    const aim = Math.atan2(h.pin.x - bx, h.pin.z - bz);
    for (const club of ["DR", "I7", "PW", "SW"]) {
      const p = suggestedPower(T, bx, bz, club, aim, { dir: 0, speed: 0 }, real);
      if (p == null) { skipped++; continue; }        // out of this club's range
      const r = new ShotSim(T, { x: bx, z: bz, clubKey: club, power: p, aim, wind: { dir: 0, speed: 0 } }).runToEnd();
      const along = (r.x - bx) * Math.sin(aim) + (r.z - bz) * Math.cos(aim);
      worstPct = Math.max(worstPct, Math.abs(along - real) / real * 100);
      tested++;
    }
  }
  // a few percent is inherent: landing a metre shorter can be the difference
  // between stopping in the fringe and running out across a fast green
  ok("suggested power finishes within 7% of the target", worstPct < 7,
    `worst ${worstPct.toFixed(1)}% over ${tested} shots (${skipped} out of range)`);
}

/* -------------------------------------------------- every hole is sane */
console.log('\nall 45 holes');
{
  let bad = [];
  let parTotalOk = true;
  for (const c of allCourses()) {
    if (c.par !== 36) parTotalOk = false;
    for (const h of c.holes) {
      const T = terrainFor(h, BIOMES[c.id]);
      if (T.surfaceAt(h.tee.x, h.tee.z).id !== 'tee') bad.push(`${c.id} h${h.number}: tee is not a tee`);
      if (T.surfaceAt(h.pin.x, h.pin.z).id !== 'green') bad.push(`${c.id} h${h.number}: pin is not on the green`);
      // the green must not be eaten by a hazard
      let g = 0, tot = 0;
      for (let a = 0; a < 24; a++) for (let rr = 0.2; rr <= 0.8; rr += 0.3) {
        const x = h.green.x + Math.cos(a / 24 * 6.283) * h.green.rx * rr;
        const z = h.green.z + Math.sin(a / 24 * 6.283) * h.green.rz * rr;
        tot++; if (T.surfaceAt(x, z).id === 'green') g++;
      }
      if (g / tot < 0.85) bad.push(`${c.id} h${h.number}: green only ${Math.round(100 * g / tot)}% intact`);
      // the hole must be playable: the club the caddie picks, aimed at the
      // pin, has to finish in play (a DRIVER on a 150 m par 3 is correctly OB)
      const aim = Math.atan2(h.pin.x - h.tee.x, h.pin.z - h.tee.z);
      const dist = Math.hypot(h.pin.x - h.tee.x, h.pin.z - h.tee.z);
      const club = suggestClub(dist, 'tee', false);
      const pw = suggestedPower(T, h.tee.x, h.tee.z, club.key, aim, { dir: 0, speed: 0 }, dist) ?? 1;
      const r = new ShotSim(T, { x: h.tee.x, z: h.tee.z, clubKey: club.key, power: pw, aim, wind: { dir: 0, speed: 0 } }).runToEnd();
      if (r.reason === 'ob') bad.push(`${c.id} h${h.number}: the sensible tee shot is OB`);
    }
  }
  ok('every course is par 36', parTotalOk);
  ok('tees, pins and greens are all valid', bad.length === 0, bad.slice(0, 3).join(' | '));
}

/* --------------------------------------- a ball never rests somewhere illegal */
console.log('\ninvariants: 1900+ shots fired in all directions');
{
  const { c, bio } = courseAndBiome('parkland'), h = c.holes[0], T = terrainFor(h, bio);
  const starts = [[h.tee.x, h.tee.z], [60, 60], [120, -20], [40, 120], [h.pin.x - 30, h.pin.z - 20]];
  let n = 0, water = 0, obs = 0, holed = 0;
  const bad = [];
  for (const [x, z] of starts) {
    for (let deg = 0; deg < 360; deg += 5) {
      for (const club of ['DR', 'I7', 'SW']) {
        const sim = new ShotSim(T, { x, z, clubKey: club, power: 1, aim: deg * Math.PI / 180, wind: { dir: 1, speed: 5 } });
        const r = sim.runToEnd(); n++;
        if (r.reason === 'water') water++;
        if (r.reason === 'ob') { obs++; if (r.x !== x || r.z !== z) bad.push('OB did not replay the lie'); }
        if (r.holed) holed++;
        const su = T.surfaceAt(r.x, r.z).id;
        if (su === 'water' || su === 'ob') bad.push(`${r.reason} ended on ${su}`);
        if (!isFinite(r.x) || !isFinite(r.z)) bad.push('non-finite resting position');
      }
    }
  }
  console.log(`    ${n} shots · ${water} in water · ${obs} out of bounds · ${holed} holed`);
  ok('no ball ever rests in water or out of bounds', bad.length === 0, bad.slice(0, 3).join(' | '));
  ok('out of bounds always replays the previous lie', !bad.some(b => b.startsWith('OB')));
}

/* ------------------------------------------------------------ determinism */
console.log('\ndeterminism');
{
  const { c, bio } = courseAndBiome('alpine'), h = c.holes[5], T = terrainFor(h, bio);
  const shot = { x: h.tee.x, z: h.tee.z, clubKey: 'I5', power: 0.87, aim: 0.3, faceDeg: 2.4, attackDeg: -1, wind: { dir: 2, speed: 6 } };
  const a = new ShotSim(T, shot).runToEnd();
  const b = new ShotSim(T, shot).runToEnd();
  ok('identical inputs give a bit-identical result',
    a.x === b.x && a.z === b.z && a.reason === b.reason && a.carry === b.carry);
  // the same hole rebuilt from seed must be identical
  const h2 = getCourse('alpine').holes[5];
  ok('courses rebuild identically from their seed',
    JSON.stringify(h2.trees.slice(0, 20)) === JSON.stringify(h.trees.slice(0, 20)) &&
    h2.pin.x === h.pin.x && h2.total === h.total);
}

console.log(`\n${failures ? failures + ' FAILURE(S)' : 'all physics checks passed'}\n`);
process.exit(failures ? 1 : 0);
