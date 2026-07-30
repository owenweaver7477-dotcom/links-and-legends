/* =========================================================================
   test/cart.mjs — the golf cart, without a browser
   -------------------------------------------------------------------------
   Everything here runs against the real shared modules in Node.  The point is
   to catch the things that are invisible until they ruin a round: a steering
   sign that turns the wrong way, a slope that pushes the cart uphill, a frame
   rate that changes how far you travel, and a trunk you can drive through.
   ========================================================================= */

import { CartBody, CART_SURF, surfFor, nearestDrivable, drivable,
         MAX_FWD, ABS_MAX, WHEELBASE } from '../public/js/shared/cart.js';
import { TerrainModel, SURFACES, terrainFor } from '../public/js/shared/terrain.js';
import { Walker } from '../public/js/client/walker.js';
import { allCourses } from '../public/js/shared/coursegen.js';
import { BIOMES } from '../public/js/shared/biomes.js';
import { CLIPS, POSE_KEYS, blankPose, reactionFor } from '../public/js/client/celebrations.js';

let pass = 0, fail = 0;
const ok = (name, cond, note = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}${note ? '   [' + note + ']' : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${note ? '   [' + note + ']' : ''}`); }
};
const head = t => console.log('\n' + t);

/* A flat, featureless practice field, so a test isolates one thing. */
function flat({ grade = 0, surface = 'fairway', axis = 'x' } = {}) {
  const T = Object.create(TerrainModel.prototype);
  T.heightAt = (x, z) => -grade * (axis === 'x' ? x : z);
  T.surfaceAt = () => SURFACES[surface];
  T.waterAt = () => null;
  T.bio = { greenSpeed: 1 };
  T.hole = {
    trees: [], waters: [], bunkers: [],
    bounds: { minX: -900, maxX: 900, minZ: -900, maxZ: 900 },
    ob: { minX: -900, maxX: 900, minZ: -900, maxZ: 900 },
    pin: { x: 1e6, z: 1e6 }
  };
  return T;
}
const drive = (T, cart, input, seconds, dt = 1 / 60) => {
  // exactly the same simulated time at every frame rate, or the comparison
  // measures the harness rather than the integrator
  const steps = Math.max(1, Math.round(seconds / dt));
  for (let i = 0; i < steps; i++) cart.step(dt, input, T, T.hole);
  return cart;
};
const GO = { throttle: 1, steer: 0, handbrake: false };
const COAST = { throttle: 0, steer: 0, handbrake: false };

/* ===================================================== signs and direction */
head('signs — these decide whether anything else means anything');
{
  // Forward is (sin h, cos h) and up is +Y.  In that right-handed frame the
  // driver's RIGHT hand points along (-cos h, sin h) — facing +Z, right is -X.
  // Asserting against this vector rather than against "+x" is the point: the
  // first version of this test asserted x > 0 for a right turn, which is
  // backwards, and shipped a cart where A and D were swapped.
  const rightOf = h => ({ x: -Math.cos(h), z: Math.sin(h) });
  const alongRight = (c, h0) => c.x * rightOf(h0).x + c.z * rightOf(h0).z;

  const T = flat();
  const c = new CartBody(0, 0, 0);
  drive(T, c, { throttle: 1, steer: 1, handbrake: false }, 2.0);
  ok('steering right goes to the driver’s right', alongRight(c, 0) > 0.5,
     `${alongRight(c, 0).toFixed(2)} m right, heading ${c.heading.toFixed(2)}`);

  const c2 = new CartBody(0, 0, 0);
  drive(T, c2, { throttle: 1, steer: -1, handbrake: false }, 2.0);
  ok('steering left goes to the driver’s left', alongRight(c2, 0) < -0.5,
     `${(-alongRight(c2, 0)).toFixed(2)} m left, heading ${c2.heading.toFixed(2)}`);

  ok('the two are mirror images', Math.abs(alongRight(c, 0) + alongRight(c2, 0)) < 1e-6);

  const c3 = new CartBody(0, 0, 0);
  drive(T, c3, GO, 1.0);
  ok('forward is +Z at heading 0', c3.z > 1 && Math.abs(c3.x) < 1e-6,
     `z ${c3.z.toFixed(2)}`);
}

/* =============================================== walking uses the same frame */
head('walking — D must strafe the same way the cart steers');
{
  const T = flat();
  const w = new Walker();
  w.enabled = true;
  const press = (keys, seconds, camYaw = 0) => {
    w.keys = new Set(keys);
    const steps = Math.round(seconds / (1 / 60));
    for (let i = 0; i < steps; i++) w.update(1 / 60, camYaw, T, T.hole);
    w.keys = new Set();
  };
  // camera looking along +Z, so the walker's right hand is -X
  w.reset(0, 0, 0); press(['d'], 1.0);
  ok('D strafes to the player’s right', w.x < -0.5, `x ${w.x.toFixed(2)} (right is -x here)`);
  w.reset(0, 0, 0); press(['a'], 1.0);
  ok('A strafes to the player’s left', w.x > 0.5, `x ${w.x.toFixed(2)}`);
  w.reset(0, 0, 0); press(['w'], 1.0);
  ok('W walks away from the camera', w.z > 0.5 && Math.abs(w.x) < 1e-9, `z ${w.z.toFixed(2)}`);
}

/* ================================================================== slope */
head('slope — a parked cart must roll DOWNhill');
{
  // ground falls toward +x, cart pointing +x, no throttle at all
  const T = flat({ grade: 0.20, axis: 'x' });
  const c = new CartBody(0, 0, Math.PI / 2);          // heading +X
  drive(T, c, COAST, 4.0);
  ok('rolls toward lower ground', c.x > 1,
     `travelled ${c.x.toFixed(2)} m toward the fall line`);
  ok('and gains speed doing it', c.speed > 0.5, `${c.speed.toFixed(2)} m/s`);

  const up = flat({ grade: -0.20, axis: 'x' });
  const c2 = new CartBody(0, 0, Math.PI / 2);         // heading uphill
  drive(up, c2, COAST, 4.0);
  ok('does not roll uphill', c2.x <= 0.01, `x ${c2.x.toFixed(3)}`);

  // below PARK_GRADE the handbrake-off cart simply holds, rather than
  // creeping away from you every time you get out
  const gentle = flat({ grade: 0.08, axis: 'x' });
  const c3 = new CartBody(0, 0, Math.PI / 2);
  drive(gentle, c3, COAST, 6.0);
  ok('holds still on a gentle slope', Math.abs(c3.x) < 0.01, `x ${c3.x.toFixed(4)}`);

  // a climb steep enough to beat the motor genuinely costs speed
  const steep = flat({ grade: -0.35, axis: 'x' });
  const cUp = new CartBody(0, 0, Math.PI / 2);
  drive(steep, cUp, GO, 10.0);
  const cFlat = new CartBody(0, 0, Math.PI / 2);
  drive(flat(), cFlat, GO, 10.0);
  ok('climbing is slower than the flat', cUp.speed < cFlat.speed - 1.0,
     `${cUp.speed.toFixed(2)} vs ${cFlat.speed.toFixed(2)} m/s`);
}

/* ========================================================== frame rate */
head('delta time — 30 fps and 144 fps must agree');
{
  const paths = [1 / 30, 1 / 60, 1 / 144, 0.1].map(dt => {
    const c = new CartBody(0, 0, 0);
    drive(flat(), c, { throttle: 1, steer: 0.55, handbrake: false }, 6.0, dt);
    return c;
  });
  const ref = paths[1];
  const worst = Math.max(...paths.map(p =>
    Math.hypot(p.x - ref.x, p.z - ref.z)));
  // 12 cm over a 6 s full-lock corner at 28 mph — imperceptible, and the
  // bound scales with top speed
  ok('same distance travelled at any frame rate', worst < 0.12,
     `worst divergence ${worst.toFixed(3)} m over 6 s`);
  const spread = Math.max(...paths.map(p => p.speed)) - Math.min(...paths.map(p => p.speed));
  ok('same final speed at any frame rate', spread < 0.05, `spread ${spread.toFixed(4)} m/s`);
}

/* =============================================================== limits */
head('speed limits');
{
  const c = new CartBody(0, 0, 0);
  drive(flat(), c, GO, 30);
  ok('tops out near the governed speed', c.speed > 7.5 && c.speed <= MAX_FWD + 0.2,
     `${c.speed.toFixed(2)} m/s (${(c.speed * 2.237).toFixed(1)} mph)`);

  const r = new CartBody(0, 0, 0);
  drive(flat(), r, { throttle: -1, steer: 0, handbrake: false }, 20);
  ok('reverse is slow', r.speed < -1.5 && r.speed > -3.2, `${r.speed.toFixed(2)} m/s`);

  const rough = new CartBody(0, 0, 0);
  drive(flat({ surface: 'rough' }), rough, GO, 30);
  ok('rough is slower than fairway', rough.speed < c.speed - 0.5,
     `${rough.speed.toFixed(2)} vs ${c.speed.toFixed(2)}`);

  // brake from top speed
  const b = new CartBody(0, 0, 0);
  drive(flat(), b, GO, 30);
  const before = b.speed;
  let stopM = 0;
  const z0 = b.z;
  drive(flat(), b, { throttle: -1, steer: 0, handbrake: false }, 4);
  stopM = b.z - z0;
  ok('stops from top speed in a sane distance', b.speed <= 0.01 && stopM < 27,
     `${before.toFixed(1)} m/s -> 0 in ${stopM.toFixed(1)} m`);
}

/* ============================================================= surfaces */
head('surfaces');
{
  const missing = Object.keys(SURFACES).filter(k => !CART_SURF[k]);
  ok('every terrain surface has cart settings', missing.length === 0,
     missing.length ? 'missing: ' + missing.join(', ') : 'all ' + Object.keys(SURFACES).length);

  ok('greens are out of bounds for a cart', CART_SURF.green.block === true);
  ok('bunkers are out of bounds for a cart', CART_SURF.sand.block === true);
  ok('water is out of bounds for a cart', CART_SURF.water.block === true);
  ok('rough is drivable — real carts drive on rough', CART_SURF.rough.block === false);

  // a cart aimed at a green must not end up on it
  const T = flat();
  T.surfaceAt = (x) => (x > 10 ? SURFACES.green : SURFACES.fairway);
  const c = new CartBody(0, 0, Math.PI / 2);
  drive(T, c, GO, 12);
  ok('cannot drive onto the putting surface', c.x <= 10.001, `stopped at x ${c.x.toFixed(2)}`);

  // Water is deliberately ENTERABLE — driving in is how you sink the cart —
  // but it drags hard at the wheels the moment you are in.
  const W = flat();
  W.waterAt = (x) => (x > 8 ? 0 : null);
  const c2 = new CartBody(0, 0, Math.PI / 2);
  drive(W, c2, GO, 12);
  ok('CAN drive into water (to its doom)', c2.x > 8, `reached x ${c2.x.toFixed(2)}`);
  ok('but water drags it down to a crawl', Math.abs(c2.speed) < 4,
     `${c2.speed.toFixed(1)} m/s in the water vs ${MAX_FWD} dry`);
}

/* ================================================================ trees */
head('trees — no tunnelling at any speed, on any hole');
{
  const courses = allCourses();
  let worstOverlap = 0, tested = 0, insideCount = 0;
  for (const course of courses) {
    for (const hole of course.holes) {
      const T = terrainFor(hole, BIOMES[course.id]);
      // drive flat out at each of the first few trees from 25 m away
      for (const t of hole.trees.slice(0, 6)) {
        const solid = (t.species === 'gorse' ? t.r * 0.85 : Math.max(0.2, t.r * 0.16));
        const c = new CartBody(t.x, t.z - 25, 0);
        c.speed = ABS_MAX;
        for (let i = 0; i < 300; i++) c.step(1 / 60, GO, T, hole);
        const d = Math.hypot(c.x - t.x, c.z - t.z);
        tested++;
        if (d < solid) { insideCount++; worstOverlap = Math.max(worstOverlap, solid - d); }
      }
    }
  }
  ok('never ends up inside a trunk', insideCount === 0,
     `${tested} full-speed collisions across 45 holes` +
     (insideCount ? `, worst overlap ${worstOverlap.toFixed(3)} m` : ''));
}

/* ============================================================== finite */
head('numbers stay real');
{
  const courses = allCourses();
  const course = courses[0];
  let bad = 0;
  for (const hole of course.holes) {
    const T = terrainFor(hole, BIOMES[course.id]);
    const c = new CartBody(hole.tee.x, hole.tee.z, 0);
    for (let i = 0; i < 900; i++) {
      // deliberately erratic input, including nonsense
      const inp = {
        throttle: Math.sin(i * 0.11) * 1.6,
        steer: Math.sin(i * 0.037) * 2.2,
        handbrake: i % 97 === 0
      };
      c.step(i % 13 === 0 ? 0.1 : 1 / 60, inp, T, hole);
      if (!isFinite(c.x) || !isFinite(c.z) || !isFinite(c.heading) || !isFinite(c.speed)) { bad++; break; }
    }
  }
  ok('no NaN from any input on any hole', bad === 0,
     bad ? `${bad} holes went non-finite` : '9 holes × 900 steps of garbage input');

  // an unmapped surface must fall back, not poison the state
  const T = flat();
  T.surfaceAt = () => ({ id: 'no-such-surface' });
  const c = new CartBody(0, 0, 0);
  drive(T, c, GO, 3);
  ok('an unknown surface falls back instead of producing NaN',
     isFinite(c.x) && isFinite(c.speed) && c.speed > 0, `speed ${c.speed.toFixed(2)}`);
}

/* ================================================================ spawn */
head('spawning');
{
  const T = flat();
  T.surfaceAt = (x, z) => (Math.hypot(x, z) < 12 ? SURFACES.green : SURFACES.fairway);
  const spot = nearestDrivable(T, 0, 0);
  ok('finds a legal spot when standing on a green', spot && !drivable(T, 0, 0) && drivable(T, spot.x, spot.z),
     spot ? `${Math.hypot(spot.x, spot.z).toFixed(1)} m away` : 'none found');

  const all = flat(); all.surfaceAt = () => SURFACES.green;
  ok('refuses when there is nowhere legal at all', nearestDrivable(all, 0, 0) === null);
}

/* ============================================================ the swing */
head('shot shaping — the drag path is the shape');
{
  const { SwingController } = await import('../public/js/client/swing.js');
  const sw = new SwingController();
  const drag = pts => { sw.enabled = true; sw.reset(); sw.pointerDown(500, 300);
    for (const [dx, dy] of pts) sw.pointerMove(500 + dx, 300 + dy); };

  drag(Array.from({ length: 10 }, (_, i) => [0, (i + 1) * 17]));
  ok('a straight pull back is a straight ball', sw.shapeDeg === 0);

  drag(Array.from({ length: 10 }, (_, i) => [(i + 1) * 4, (i + 1) * 17]));
  const fade = sw.shapeDeg;
  ok('a gentle pull right is a fade', fade > 2 && fade < 6, fade.toFixed(1) + ' deg');

  drag(Array.from({ length: 10 }, (_, i) => [(i + 1) * 12, (i + 1) * 17]));
  ok('a hard pull right is a slice, capped', sw.shapeDeg === 7, sw.shapeDeg + ' deg');

  drag(Array.from({ length: 10 }, (_, i) => [-(i + 1) * 12, (i + 1) * 15]));
  ok('a hard pull left is a hook', sw.shapeDeg === -7, sw.shapeDeg + ' deg');

  // shape chosen going back survives an early release at the top
  drag(Array.from({ length: 10 }, (_, i) => [(i + 1) * 4, (i + 1) * 17]));
  const early = sw.pointerUp();
  ok('early release keeps the deliberate shape',
     !!early && Math.abs(early.faceDeg - fade) < 0.5,
     early ? early.faceDeg.toFixed(1) + ' deg' : 'no shot');

  // and the through-stroke stacks error on top of the chosen shape
  sw.enabled = true; sw.reset(); sw.pointerDown(500, 300);
  for (let i = 1; i <= 10; i++) sw.pointerMove(500 + i * 4, 300 + i * 17);
  for (let i = 9; i >= 4; i--) sw.pointerMove(500 + 40 + (9 - i) * 10, 300 + i * 17);
  ok('through-stroke drift stacks on the shape', sw.faceDeg > sw.shapeDeg + 2,
     sw.shapeDeg.toFixed(1) + ' -> ' + sw.faceDeg.toFixed(1) + ' deg');
}

/* ================================================= a pure strike spins more */
head('spin — loft plus a pure strike earns backspin');
{
  const { ShotSim, makeFlatRange } = await import('../public/js/shared/ballistics.js');
  const T2 = makeFlatRange();
  const spinOf = (club, face) => new ShotSim(T2,
    { x: 0, z: 0, clubKey: club, power: 1, aim: 0, faceDeg: face, attackDeg: 0,
      wind: { speed: 0, dir: 0 } }).spinBack;
  const lwGain = spinOf('LW', 0) / spinOf('LW', 5);
  const drGain = spinOf('DR', 0) / spinOf('DR', 5);
  ok('a flushed lob wedge spins much harder than a mishit', lwGain > 1.15,
     'x' + lwGain.toFixed(2));
  ok('the driver barely cares — loft is what earns it', drGain < 1.08,
     'x' + drGain.toFixed(2));
}

/* ================================================================= gear */
head('gear — bought upgrades change the flight, absence changes nothing');
{
  const { ShotSim, makeFlatRange } = await import('../public/js/shared/ballistics.js');
  const { gearEffect, purchaseBlocked, SHOP, NO_GEAR } = await import('../public/js/shared/gear.js');
  const T3 = makeFlatRange();
  const fire = gear => new ShotSim(T3, { x:0, z:0, clubKey:'DR', power:1, aim:0,
    faceDeg:0, attackDeg:0, wind:{speed:0,dir:0}, gear }).runToEnd().carry;
  const base = fire(null);
  const kitted = fire({ ball:2, irons:1, woods:1, putter:1 });
  ok('no gear means the stock ball exactly', Math.abs(fire(NO_GEAR) - base) < 1e-9);
  ok('the full bag buys a few honest yards', kitted > base + 2 && kitted < base + 14,
     `${base.toFixed(1)} -> ${kitted.toFixed(1)} m`);
  const fx = gearEffect({ ball:2, irons:1, woods:1 }, { type:'iron', loft:34 });
  ok('multipliers stay modest', fx.speed < 1.04 && fx.spin < 1.06,
     `speed x${fx.speed.toFixed(3)}, spin x${fx.spin.toFixed(3)}`);
  ok('a broke player cannot buy',
     purchaseBlocked('ball_tour', { coins: 10, gear: { ...NO_GEAR } }) !== null);
  ok('tiers require their prerequisite',
     purchaseBlocked('ball_pro', { coins: 99999, gear: { ...NO_GEAR } }) !== null);
  ok('a funded player can',
     purchaseBlocked('ball_tour', { coins: 500, gear: { ...NO_GEAR } }) === null);
}

/* ============================================================== economy */
head('the coin economy — the document numbers, exactly');
{
  const { holeCoins, roundCoins } = await import('../public/js/shared/economy.js');
  ok('par pays 35', holeCoins(4, 4) === 35);
  ok('birdie pays 50', holeCoins(3, 4) === 50);
  ok('eagle pays 80', holeCoins(3, 5) === 80);
  ok('an ace pays 170', holeCoins(1, 3) === 170);
  ok('bogey pays 15', holeCoins(5, 4) === 15);
  ok('a blow-up hole never goes negative', holeCoins(11, 4) === 0);
  const par4 = { strokes: 4, par: 4 }, birdie = { strokes: 3, par: 4 };
  const flat9 = roundCoins(Array(9).fill(par4));
  ok('nine pars: holes + the 100 round bonus, no streak',
     flat9.total === 9 * 35 + 100 && flat9.streakPct === 0, 'total ' + flat9.total);
  const hot = roundCoins([par4, birdie, birdie, birdie, birdie, par4, par4, par4, par4]);
  ok('4 birdies in a row pays a 40% streak bonus', hot.streakPct === 40,
     hot.streakPct + '%');
  const clear = roundCoins(Array(9).fill(par4), true);
  ok('first clear of a course adds 500', clear.total === flat9.total + 500);
}

/* ================================================================= crew */
head('the caddie crew — hired stats that actually do things');
{
  const { crewEffect, crewPurchase, cartBoost, NO_CREW, CADDIE_COSTS } = await import('../public/js/shared/crew.js');
  const none = crewEffect(null, 0, 0, { power: 1 });
  ok('no crew, wooden set: exact identity',
     none.speed === 1 && none.faceDamp === 0 && none.windDamp === 0 && none.cupBonus === 0);
  const ace10 = crewEffect({ ...NO_CREW, ace: 10 }, 0, 0, {});
  ok('Ace at Legend damps 40% of mishit drift', Math.abs(ace10.faceDamp - 0.40) < 1e-9);
  const br = crewEffect({ ...NO_CREW, bruiser: 10 }, 0, 0, { power: 1 });
  const brSoft = crewEffect({ ...NO_CREW, bruiser: 10 }, 0, 0, { power: 0.7 });
  ok('Bruiser only fires on full swings', br.speed > 1.09 && brSoft.speed === 1);
  const sig = crewEffect(null, 6, 3, {});
  ok('the Signature Set fully refined is +7.9% ball speed',
     Math.abs(sig.speed - 1.079) < 1e-9, 'x' + sig.speed.toFixed(3));
  ok('Pitstop at Legend is +60% cart', Math.abs(cartBoost({ pitstop: 10 }) - 1.6) < 1e-9);
  // the till
  const broke = crewPurchase('caddie:ace', { coins: 100, crew: { ...NO_CREW } });
  ok('hiring needs 500 coins', !!broke.blocked);
  const rich = crewPurchase('caddie:ace', { coins: 500, crew: { ...NO_CREW } });
  ok('and 500 is exactly enough', rich.cost === 500 && !rich.blocked);
  ok('maxing one caddie costs 39,500 total',
     CADDIE_COSTS.reduce((a, b) => a + b, 0) === 39500);
  const tier = crewPurchase('club:tier', { coins: 1500, clubTier: 0, crew: { ...NO_CREW } });
  ok('the Rusty Iron Set costs 1,500', tier.cost === 1500);
  const p = { coins: 5000, clubTier: 1, refine: 3, crew: { ...NO_CREW } };
  crewPurchase('club:tier', p).apply(p);
  ok('tier-up resets refinement, as designed', p.clubTier === 2 && p.refine === 0);
}

/* ========================================================== celebrations */
head('celebrations');
{
  ok('hole in one is an ace whatever the par', reactionFor(1, 5) === 'ace' && reactionFor(1, 3) === 'ace');
  ok('albatross is an ace', reactionFor(2, 5) === 'ace');
  ok('eagle', reactionFor(3, 5) === 'eagle');
  ok('birdie', reactionFor(4, 5) === 'birdie');
  ok('par is not celebrated', reactionFor(5, 5) === null);
  ok('bogey is not mourned', reactionFor(6, 5) === null);
  ok('double bogey is not mourned', reactionFor(7, 5) === null);
  ok('triple bogey slumps', reactionFor(8, 5) === 'slump');
  ok('picking up slumps', reactionFor(9, 5, true) === 'slump');

  let finite = true, endsNeutral = true, worst = 0, worstKey = '';
  for (const [name, clip] of Object.entries(CLIPS)) {
    const P = blankPose();
    for (let i = 0; i <= 200; i++) {
      blankPose(P);
      clip.pose(P, i / 200);
      for (const k of POSE_KEYS) if (!isFinite(P[k])) finite = false;
    }
    // every clip must land on neutral, because the blend-out IS the release
    blankPose(P);
    clip.pose(P, 1);
    for (const k of POSE_KEYS) {
      // yaw is a rotation: a full turn IS the neutral pose
      const v = k === 'yaw'
        ? Math.abs(Math.atan2(Math.sin(P[k]), Math.cos(P[k])))
        : Math.abs(P[k]);
      if (v > worst) { worst = v; worstKey = name + '.' + k; }
      if (v > 0.02) endsNeutral = false;
    }
  }
  ok('every clip stays finite across its whole length', finite);
  ok('every clip ends on the neutral pose', endsNeutral,
     `worst residual ${worst.toFixed(4)} on ${worstKey}`);
}

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
