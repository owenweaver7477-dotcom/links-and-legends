/* =========================================================================
   test/cart.mjs — the golf cart, without a browser
   -------------------------------------------------------------------------
   Everything here runs against the real shared modules in Node.  The point is
   to catch the things that are invisible until they ruin a round: a steering
   sign that turns the wrong way, a slope that pushes the cart uphill, a frame
   rate that changes how far you travel, and a trunk you can drive through.
   ========================================================================= */

import { CartBody, CART_SURF, surfFor, nearestDrivable, drivable,
         MAX_FWD, ABS_MAX, WHEELBASE, MAX_BOOST, TOP_SPEED_KMH, BASE_SPEED_KMH } from '../public/js/shared/cart.js';
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
  drive(T, c3, GO, 2.5);            // a real cart takes a moment to gather itself
  ok('forward is +Z at heading 0', c3.z > 1 && Math.abs(c3.x) < 1e-6,
     `z ${c3.z.toFixed(2)}`);
}

/* ================================================== aiming uses that frame too */
head('aim — left must be the player’s left, on the buttons and the arrows');
{
  // The aim is a heading in the same frame as everything else, so "aim left"
  // means INCREASING it.  The buttons shipped with the opposite sign, so ◄
  // aimed right and ArrowRight aimed left; this pins the convention down.
  const leftOf = h => ({ x: Math.cos(h), z: -Math.sin(h) });
  const movedLeft = (a0, a1) => {
    const d0 = { x: Math.sin(a0), z: Math.cos(a0) };
    const d1 = { x: Math.sin(a1), z: Math.cos(a1) };
    const L = leftOf(a0);
    return (d1.x - d0.x) * L.x + (d1.z - d0.z) * L.z > 0;
  };
  for (const base of [0, 1.2, -2.4, Math.PI]) {
    ok(`+aim is the player’s left (from ${base.toFixed(1)} rad)`, movedLeft(base, base + 0.2));
    ok(`-aim is the player’s right (from ${base.toFixed(1)} rad)`, !movedLeft(base, base - 0.2));
  }
  // and the HUD reads out the same way: positive degrees = aimed right of target
  const readout = (aim, target) => -(((aim - target) * 180 / Math.PI + 540) % 360 - 180);
  ok('the HUD calls a right-of-target aim positive', readout(-0.2, 0) > 0, readout(-0.2, 0).toFixed(1) + '°');
  ok('and a left-of-target aim negative', readout(0.2, 0) < 0, readout(0.2, 0).toFixed(1) + '°');
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
  // A stock cart is what MOST players drive, so this is the number that
  // decides whether the cart feels usable at all.
  ok('a stock cart does the advertised base speed',
     Math.abs(c.speed * 3.6 - BASE_SPEED_KMH) < 1.0,
     `${(c.speed * 3.6).toFixed(1)} km/h vs ${BASE_SPEED_KMH}`);

  const r = new CartBody(0, 0, 0);
  drive(flat(), r, { throttle: -1, steer: 0, handbrake: false }, 20);
  ok('reverse is a crawl', r.speed < -0.8 && r.speed > -2.0, `${(r.speed * 3.6).toFixed(1)} km/h`);

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
head('the swing — the meter is the shot');
{
  const { SwingController } = await import('../public/js/client/swing.js');
  const sw = new SwingController();
  const drag = pts => { sw.enabled = true; sw.reset(); sw.pointerDown(500, 300);
    for (const [dx, dy] of pts) sw.pointerMove(500 + dx, 300 + dy); };

  /* The drag used to add a shape of its own, taken from the angle of the
     pull.  It meant ordinary sideways drift curved a shot the player had
     struck perfectly, with no visible cause — so the strike bar is now the
     only thing that bends the ball.  test/swing.mjs covers this in full;
     these are the two properties the rest of this file leans on. */
  drag(Array.from({ length: 10 }, (_, i) => [(i + 1) * 12, (i + 1) * 17]));
  sw.pointerUp(); sw.sweep = 0;
  const clean = sw.commit();
  ok('a flushed strike is straight however the drag wandered',
     !!clean && clean.faceDeg === 0,
     clean ? clean.faceDeg.toFixed(1) + ' deg' : 'no shot');

  sw.enabled = true; sw.reset();
  sw.pointerDown(500, 300);
  for (let i = 1; i <= 10; i++) sw.pointerMove(500, 300 + i * 17);
  sw.pointerUp();
  sw.sweep = 0.5;
  const missed = sw.commit();
  ok('missing the bar right opens the face', missed.faceDeg > 2,
     missed.faceDeg.toFixed(1) + ' deg');

  // Power is read at the moment of release, not at the deepest point of the
  // drag — overshooting and easing back to the number you want is the whole
  // reason to have a drag meter.
  sw.enabled = true; sw.reset();
  sw.pointerDown(500, 300);
  sw.pointerMove(500, 300 + 190 * 1.0);
  sw.pointerMove(500, 300 + 190 * 0.6);
  sw.pointerUp(); sw.sweep = 0;
  const eased = sw.commit();
  ok('easing back off a full swing commits the eased number',
     Math.abs(eased.power - 0.6) < 0.02, (eased.power * 100).toFixed(0) + '%');
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
     purchaseBlocked('ball_tour', { coins: SHOP.ball_tour.cost, gear: { ...NO_GEAR } }) === null);
}

/* ============================================================== economy */
head('the coin economy — the document’s shape, at PAYOUT_SCALE');
{
  const { holeCoins, roundCoins, PAYOUT_SCALE: K } = await import('../public/js/shared/economy.js');
  ok('par pays 35 x scale', holeCoins(4, 4) === 35 * K, String(holeCoins(4, 4)));
  ok('birdie pays 50 x scale', holeCoins(3, 4) === 50 * K, String(holeCoins(3, 4)));
  ok('eagle pays 80 x scale', holeCoins(3, 5) === 80 * K, String(holeCoins(3, 5)));
  ok('an ace pays 170 x scale', holeCoins(1, 3) === 170 * K, String(holeCoins(1, 3)));
  ok('bogey pays 15 x scale', holeCoins(5, 4) === 15 * K, String(holeCoins(5, 4)));
  /* A hole you finished always pays. The over-par penalty used to eat the
     whole appearance fee — zero coins from four over, and holes cap at par+6,
     so every blow-up paid nothing and the economy read as broken. */
  ok('a blow-up hole never goes negative', holeCoins(11, 4) > 0, String(holeCoins(11, 4)));
  ok('the worst hole still pays the floor', holeCoins(10, 4) === 5 * K, String(holeCoins(10, 4)));
  ok('and it is worse than a bogey', holeCoins(10, 4) < holeCoins(5, 4));
  const par4 = { strokes: 4, par: 4 }, birdie = { strokes: 3, par: 4 };
  const flat9 = roundCoins(Array(9).fill(par4));
  ok('nine pars: holes + the round bonus, no streak',
     flat9.total === (9 * 35 + 100) * K && flat9.streakPct === 0, 'total ' + flat9.total);
  const hot = roundCoins([par4, birdie, birdie, birdie, birdie, par4, par4, par4, par4]);
  ok('4 birdies in a row pays a 40% streak bonus', hot.streakPct === 40,
     hot.streakPct + '%');
  const clear = roundCoins(Array(9).fill(par4), true);
  ok('first clear of a course adds 500 x scale', clear.total === flat9.total + 500 * K);
}

/* ============================================== how long the climb actually is */
head('progression — bad at the start, and a ladder that outlasts the shop');
{
  const { roundCoins, roundXp, xpForLevel, maxLevel } =
    await import('../public/js/shared/economy.js');
  const { CADDIE_COSTS, CADDIE_KEYS, crewEffect } =
    await import('../public/js/shared/crew.js');
  const { SHOP } = await import('../public/js/shared/gear.js');
  const { CLUB_SETS, STARTER_SET, setStats, piecePrice, SET_CLUBS } =
    await import('../public/js/shared/clubsets.js');

  const sum = a => a.reduce((x, y) => x + y, 0);
  /* "Everything" is every caddie, every gear item, and completing a set of
     each rarity. Club sets are not a coin purchase in themselves — they drop
     from the Club Case — but the fourteen clubs that COMPLETE one can each
     be bought by name, and that is the club-shaped part of the coin sink. */
  const oneOfEach = r => CLUB_SETS.find(x => x.rarity === r).id;
  const RAR = ['standard', 'tour', 'pro', 'legend', 'mythic'];
  const allSetPaths = sum(RAR.map(r => piecePrice(oneOfEach(r)) * SET_CLUBS.length));
  const toMax = sum(CADDIE_COSTS) * CADDIE_KEYS.length
    + allSetPaths
    + Object.values(SHOP).reduce((a, i) => a + i.cost, 0);

  const perRound = roundCoins(Array(9).fill({ strokes: 4, par: 4 })).total;
  const firstClears = roundCoins([{ strokes: 4, par: 4 }], true).firstClearBonus * 5;
  const rounds = Math.ceil((toMax - firstClears) / perRound);
  /* A nine-hole round is 10-15 minutes; the bound is deliberately wide
     because pace of play is the one number here that is not ours to measure.

     This used to assert 20-30 hours. The top three club sets were then
     repriced upward on purpose — a Signature Set you could own by the end of
     your second session is not something anyone looks forward to — so the
     target moved with it, to 60-130 hours (~240-520 rounds). That
     overcorrected: 304 rounds measured out to 51-76 hours before the shop
     was empty, and a player who cannot afford the FIRST club upgrade for
     weeks stops believing the ladder is climbable at all. The target is now
     the rounds directly — 200-250, not an hour range with a wide margin
     built in for a pace nobody measured — moved by raising economy.js's
     PAYOUT_SCALE rather than touching any of the prices below, which is
     exactly what that constant is for. */
  const pathOf = r => piecePrice(oneOfEach(r)) * SET_CLUBS.length;
  const early = pathOf('standard') + pathOf('tour');
  const earlyRounds = Math.ceil(early / perRound);
  ok('completing a Standard and a Tour set is a normal early progression', earlyRounds <= 12,
     earlyRounds + ' rounds for both lower sets');
  /* The whole point of rarity: the top two must dwarf the bottom two, or
     pulling a Mythic set costs nothing to live up to. */
  const top = pathOf('legend') + pathOf('mythic');
  ok('the top two sets cost far more than the bottom two', top > early * 5,
     'top two ' + top + ' vs bottom two ' + early);

  ok('owning everything takes 200-250 rounds, not 300+', rounds >= 200 && rounds <= 250,
     `${rounds} rounds = ${(rounds * 10 / 60).toFixed(0)}-${(rounds * 15 / 60).toFixed(0)} h`);

  /* The invariant that actually matters, and the one that was broken:
     the COIN ladder and the LEVEL ladder have to finish in the right order
     and not by a silly margin. Coins used to run out at 194 rounds against
     1,131 for level 100 — a player emptied the shop six times over and then
     had eight hundred rounds with nothing to spend on, which is a currency
     that has stopped being a reward. Your bag is the medium-term goal and
     your level is the long one; between a third and three-quarters of the
     way keeps both alive at once. */
  const perRoundXp = roundXp(Array(9).fill({ strokes: 4, par: 4 }));
  const roundsToMaxLevel = xpForLevel(maxLevel()) / perRoundXp;
  const ratio = rounds / roundsToMaxLevel;
  ok('the shop empties well before the level ladder does, but not early',
     ratio > 0.3 && ratio < 0.75,
     `gear at ${rounds} rounds vs level 100 at ${Math.round(roundsToMaxLevel)} ` +
     `(${Math.round(ratio * 100)}% of the way)`);
  ok('but the first caddie is affordable after one round',
     perRound >= CADDIE_COSTS[0], `${perRound} vs ${CADDIE_COSTS[0]}`);
  ok('and the last Legend level is not', perRound < CADDIE_COSTS[9],
     `${perRound} vs ${CADDIE_COSTS[9]}`);

  // the distance arc is the point of the ladder: a beginner must be short
  // completion 0..1 now, and the DRIVER's line specifically — a set's stats
  // are authored per club class, so "how far does this set hit" needs a club
  const mult = (setId, done, bruiser) => crewEffect(
    bruiser ? { ace: 0, bruiser: 10, steady: 0, roller: 0, pitstop: 0, lucky: 0, gale: 0, grit: 0 } : null,
    setStats(setId, done, 'DR'), { power: 1 }).speed;
  const anyOf = r => CLUB_SETS.find(x => x.rarity === r).id;
  const starter = STARTER_SET, mythic = anyOf('mythic');

  ok('an unnamed bag is the reference the club table is calibrated to',
     crewEffect(null, null, { power: 1 }).speed === 1);
  ok('the starter set is genuinely short', mult(starter, 0, false) < 0.9,
     'x' + mult(starter, 0, false).toFixed(3));
  ok('a maxed Mythic set lands exactly where the old top set did',
     Math.abs(mult(mythic, 1, false) - 1.065) < 1e-9,
     'x' + mult(mythic, 1, false).toFixed(3));
  ok('and a maxed player hits it a third further than a beginner',
     mult(mythic, 1, true) / mult(starter, 0, false) > 1.3,
     'x' + (mult(mythic, 1, true) / mult(starter, 0, false)).toFixed(2));

  /* The property the whole rework rests on: upgrading what you actually
     pulled is never wasted. A maxed set of any rarity must out-hit a fresh
     set of the NEXT rarity up, or a bad-luck player's coins buy nothing. */
  const order = ['standard', 'tour', 'pro', 'legend', 'mythic'];
  let overlapHolds = true, overlapDetail = '';
  for (let i = 0; i < order.length - 1; i++) {
    const lo = anyOf(order[i]), hi = anyOf(order[i + 1]);
    const loMax = mult(lo, 1, false);
    const hiBase = mult(hi, 0, false);
    if (!(loMax > hiBase)) {
      overlapHolds = false;
      overlapDetail = `${order[i]} maxed ${loMax.toFixed(3)} <= fresh ${order[i + 1]} ${hiBase.toFixed(3)}`;
    }
  }
  ok('a maxed set always beats a fresh set one rarity up', overlapHolds, overlapDetail);
}

/* ===================================== fifty rounds of a real, uneven player */
head('progression — what fifty rounds of actual golf, not idealised par, buys');
{
  /* The 200-250 target above is built on a level-par round: every hole
     exactly at par, nine holes straight, no blow-ups. Nobody plays that.
     This plays fifty rounds against a realistic score mix (bogeys more
     common than birdies — a player still learning the game, not a scratch
     golfer) and checks the coins that ACTUALLY land still make sense
     against the tables above: real income is close enough to the idealised
     figure that the 200-250 claim is honest, the first few club sets are
     within easy reach the way crew.js's own comment claims, and the top of
     the ladder still is not. */
  const { roundCoins } = await import('../public/js/shared/economy.js');
  const { mulberry32 } = await import('../public/js/shared/rng.js');
  const { CADDIE_COSTS, CADDIE_KEYS } =
    await import('../public/js/shared/crew.js');
  const { SHOP } = await import('../public/js/shared/gear.js');
  const { CLUB_SETS, piecePrice, SET_CLUBS } = await import('../public/js/shared/clubsets.js');
  const sum = a => a.reduce((x, y) => x + y, 0);
  const pathOf = r => piecePrice(CLUB_SETS.find(x => x.rarity === r).id) * SET_CLUBS.length;

  // relative-to-par distribution for a mixed-skill player: eagle, birdie,
  // par, bogey, double, triple — bogey the single most likely outcome,
  // matching how amateurs actually score rather than how a pro would
  const BUCKETS = [[-2, 0.02], [-1, 0.15], [0, 0.35], [1, 0.30], [2, 0.13], [3, 0.05]];
  const rng = mulberry32(20260824);
  const drawRel = () => {
    let r = rng(), acc = 0;
    for (const [rel, p] of BUCKETS) { acc += p; if (r <= acc) return rel; }
    return 3;
  };

  let earned = 0;
  for (let round = 0; round < 50; round++) {
    const holes = Array.from({ length: 9 }, () => ({ strokes: Math.max(1, 4 + drawRel()), par: 4 }));
    earned += roundCoins(holes, round === 0).total;
  }

  const idealPerRound = roundCoins(Array(9).fill({ strokes: 4, par: 4 })).total;
  const realAvg = earned / 50;
  ok('a realistic mixed-skill round still pays close to the idealised figure',
     realAvg > idealPerRound * 0.5 && realAvg <= idealPerRound,
     `${Math.round(realAvg)} vs ${idealPerRound} idealised (${Math.round(realAvg / idealPerRound * 100)}%)`);

  const earlyPaths = pathOf('standard') + pathOf('tour');
  ok('the lower club sets are affordable well within fifty rounds', earned >= earlyPaths * 2,
     `${earned} earned vs ${earlyPaths} to complete a Standard and a Tour set`);

  const everything = sum(CADDIE_COSTS) * CADDIE_KEYS.length
    + sum(['standard', 'tour', 'pro', 'legend', 'mythic'].map(pathOf))
    + Object.values(SHOP).reduce((a, i) => a + i.cost, 0);
  ok('but the whole shop is nowhere close after fifty rounds', earned < everything * 0.3,
     `${earned} of ${everything}`);
}

/* ================================================================= crew */
head('the caddie crew — hired stats that actually do things');
{
  const { crewEffect, crewPurchase, cartBoost, NO_CREW, CADDIE_COSTS } = await import('../public/js/shared/crew.js');
  const { setStats, STARTER_SET, CLUB_SETS, upgradeCount } =
    await import('../public/js/shared/clubsets.js');
  // no crew AND no bag named: the reference ball, exactly 1s and 0s.  This is
  // the configuration the physics suite and calibrateCarries() run in.
  const none = crewEffect(null, null, { power: 1 });
  ok('nothing equipped at all: exact identity',
     none.speed === 1 && none.faceDamp === 0 && none.windDamp === 0 && none.cupBonus === 0);
  const ace10 = crewEffect({ ...NO_CREW, ace: 10 }, null, {});
  ok('Ace at Legend damps 40% of mishit drift', Math.abs(ace10.faceDamp - 0.40) < 1e-9);
  const br = crewEffect({ ...NO_CREW, bruiser: 10 }, null, { power: 1 });
  const brSoft = crewEffect({ ...NO_CREW, bruiser: 10 }, null, { power: 0.7 });
  ok('Bruiser only fires on full swings', br.speed > 1.09 && brSoft.speed === 1,
     `full x${br.speed.toFixed(3)}, soft x${brSoft.speed.toFixed(3)}`);
  const topSet = CLUB_SETS.find(x => x.rarity === 'mythic');
  const sig = crewEffect(null, setStats(topSet.id, 1, 'DR'), {});
  ok('a fully upgraded Mythic set is +6.5% ball speed, exactly where the old top set sat',
     Math.abs(sig.speed - 1.065) < 1e-9, 'x' + sig.speed.toFixed(3));
  // Pitstop tops up a cart that is already usable rather than unlocking one:
  // the stock cart does the full base speed, so the cap here is deliberate.
  ok('Pitstop at Legend tops the cart up by the capped amount',
     Math.abs(cartBoost({ pitstop: 10 }) - 1.55) < 1e-9,
     'x' + cartBoost({ pitstop: 10 }).toFixed(3));
  // the till
  const broke = crewPurchase('caddie:ace', { coins: 100, crew: { ...NO_CREW } });
  ok('hiring needs 500 coins', !!broke.blocked);
  const rich = crewPurchase('caddie:ace', { coins: 500, crew: { ...NO_CREW } });
  ok('and 500 is exactly enough', rich.cost === 500 && !rich.blocked);
  ok('maxing one caddie costs 39,500 total',
     CADDIE_COSTS.reduce((a, b) => a + b, 0) === 39500);
  /* The club-set upgrade branch is gone from this till: sets are COLLECTED
     now, and coins buy a named club through piece:buy on the server. What
     is left here is the caddie crew, which is what it was always for. */
  ok('the till no longer sells club upgrades', !!crewPurchase('set:upgrade', { coins: 999999, crew: { ...NO_CREW } }).blocked);

  // a partial crew object (older save, hand-edited file, or a future ninth
  // caddie) must behave as zeros, never as NaN — NaN here is a NaN ball
  const partial = crewEffect({ ace: 2 }, setStats(STARTER_SET, 0, 'I7'), { power: 1, isPutt: true, afterBadHole: true });
  ok('a partial crew object never NaNs the shot',
     [partial.speed, partial.faceDamp, partial.windDamp, partial.cupBonus, partial.lieMercy]
       .every(Number.isFinite),
     JSON.stringify(partial));

  // prototype-chain names must not hire phantoms or charge for them
  ok('caddie:constructor is refused',
     !!crewPurchase('caddie:constructor', { coins: 99999, crew: { ...NO_CREW } }).blocked);
}

/* ================================================ the two-beat swing */
head('swing — power is a drag, the strike is a timing');
{
  const { SwingController, SWING, lieTempo } = await import('../public/js/client/swing.js');

  // the lie sets the tempo, and these relationships are the mechanic
  ok('sand gives you the most time to strike', lieTempo('sand') < lieTempo('tee'),
     `sand ${lieTempo('sand')} vs tee ${lieTempo('tee')}`);
  // The tee is the calmest bar on the course — it is the shot you stand over
  // and think about — and the rough reads at that same measured pace, because
  // the lie is already the punishment.  The fairway is the quick one.
  ok('a tee shot is a calm, readable bar', lieTempo('tee') < lieTempo('fairway'),
     `tee ${lieTempo('tee')} vs fairway ${lieTempo('fairway')}`);
  ok('the rough is played at that same measured pace',
     Math.abs(lieTempo('rough') - lieTempo('tee')) < 1e-9,
     `rough ${lieTempo('rough')} vs tee ${lieTempo('tee')}`);
  ok('heavy rough still hurries you', lieTempo('deep') > lieTempo('rough'),
     `deep ${lieTempo('deep')} vs rough ${lieTempo('rough')}`);
  ok('an unknown lie falls back to the fairway tempo', lieTempo('nonsense') === lieTempo('fairway'));

  const drag = (sw, px) => {
    sw.pointerDown(500, 300);
    for (let i = 1; i <= 10; i++) sw.pointerMove(500, 300 + px * i / 10);
  };

  // releasing the drag must NOT play the shot — it hands over to the strike bar
  const sw = new SwingController();
  sw.enabled = true; sw.setLie('fairway');
  drag(sw, 190);
  ok('dragging down builds power', sw.meter().power > 0.9, sw.meter().power.toFixed(2));
  const onRelease = sw.pointerUp();
  ok('letting go plays nothing', onRelease === null);
  ok('letting go locks the power and starts the strike bar',
     sw.state === SWING.ACCURACY && sw.meter().power > 0.9);

  // the marker sweeps and turns around at the ends, never escaping the bar
  let minS = 1, maxS = -1;
  for (let i = 0; i < 400; i++) { sw.step(1 / 60); minS = Math.min(minS, sw.sweep); maxS = Math.max(maxS, sw.sweep); }
  ok('the marker stays inside the bar', minS >= -1.0001 && maxS <= 1.0001,
     `${minS.toFixed(2)} .. ${maxS.toFixed(2)}`);
  ok('and actually sweeps the whole width', minS < -0.9 && maxS > 0.9);

  // stopping dead centre flushes it; stopping wide opens the face
  const strikeAt = (sweep, lie = 'fairway') => {
    const s = new SwingController();
    s.enabled = true; s.setLie(lie);
    drag(s, 190); s.pointerUp(); s.sweep = sweep;
    return s.commit();
  };
  const pure = strikeAt(0);
  ok('a centred strike is dead straight', Math.abs(pure.faceDeg) < 0.01, pure.faceDeg.toFixed(2) + '°');
  const wide = strikeAt(1);
  ok('a strike at the edge is a full miss', wide.faceDeg > 6, wide.faceDeg.toFixed(1) + '°');
  const other = strikeAt(-1);
  ok('and the other edge misses the other way', other.faceDeg < -6, other.faceDeg.toFixed(1) + '°');

  /* The forgiving band: stopping just off centre must NOT be punished as a
     miss, or the strike is a coin flip rather than a skill.  The fairway has
     the widest band in the game deliberately — it is what hitting the fairway
     buys you, and it sets the felt difficulty of the whole round. */
  const { pureBand } = await import('../public/js/client/swing.js');
  ok('the fairway is the most forgiving lie to strike from',
     pureBand('fairway') > pureBand('rough') && pureBand('fairway') > pureBand('deep'),
     `fairway ${pureBand('fairway')} vs rough ${pureBand('rough')}`);
  const nearMiss = strikeAt(pureBand('fairway') * 0.9, 'fairway');
  ok('a strike inside the band is genuinely pure',
     Math.abs(nearMiss.faceDeg) < 0.01 && nearMiss.pure === true,
     nearMiss.faceDeg.toFixed(2) + '°');
  const justOut = strikeAt(pureBand('fairway') + 0.05, 'fairway');
  ok('and just outside it is a small miss, not a cliff',
     Math.abs(justOut.faceDeg) > 0 && Math.abs(justOut.faceDeg) < 1.2,
     justOut.faceDeg.toFixed(2) + '°');
  ok('a mistimed strike also comes out thin', wide.attackDeg < -1, wide.attackDeg.toFixed(2));
  ok('a flushed one does not', Math.abs(pure.attackDeg) < 0.01);

  // a twitch is not a swing
  const tiny = new SwingController();
  tiny.enabled = true;
  tiny.pointerDown(500, 300); tiny.pointerMove(500, 304);
  tiny.pointerUp();
  ok('a twitch never arms the strike bar', tiny.state === SWING.IDLE);
}

/* ============================================== a hazard must never wedge a hole */
head('water relief — a penalty drop has to make progress');
{
  const { ShotSim } = await import('../public/js/shared/ballistics.js');
  const { TerrainModel, SURFACES } = await import('../public/js/shared/terrain.js');

  // A pond starting three metres in front of the ball and running 120 m: the
  // worst case, where every point on the flight line except the origin is wet.
  // The drop used to walk back to the ball's own spot, so the identical shot
  // replayed for ever and the hole could only end on the stroke cap.
  const moat = () => {
    const T = Object.create(TerrainModel.prototype);
    const wet = (x, z) => z > 3 && z < 123 && Math.abs(x) < 90;
    T.heightAt = () => 0;
    T.surfaceAt = (x, z) => wet(x, z) ? SURFACES.water : SURFACES.fairway;
    T.waterAt = (x, z) => wet(x, z) ? -0.4 : null;
    T.normalAt = () => [0, 1, 0];
    T.bio = { greenSpeed: 1, firmness: 1 };
    T.toPin = (x, z) => Math.hypot(x - 0, z - 300);
    T.hole = {
      trees: [], bunkers: [],
      waters: [{ x: 0, z: 63, rx: 90, rz: 60, rot: 0 }],
      bounds: { minX: -900, maxX: 900, minZ: -900, maxZ: 900 },
      ob: { minX: -900, maxX: 900, minZ: -900, maxZ: 900 },
      pin: { x: 0, z: 300 }, cup: { x: 0, z: 300, r: 0.108 },
      green: { x: 0, z: 300, rx: 20, rz: 20, rot: 0 }
    };
    return T;
  };

  const T = moat();
  let p = { x: 0, z: 0 }, drops = 0, stuck = false;
  for (let i = 0; i < 6; i++) {
    const r = new ShotSim(T, { x: p.x, z: p.z, clubKey: 'I7', power: 0.5, aim: 0,
      faceDeg: 0, attackDeg: 0, wind: { dir: 0, speed: 0 } }).runToEnd();
    if (r.penalty === 0) break;
    drops++;
    const moved = Math.hypot(r.x - p.x, r.z - p.z);
    if (moved < 1e-6) { stuck = true; break; }
    p = { x: r.x, z: r.z };
  }
  ok('a drop never returns the ball to the spot it was played from', !stuck,
     `${drops} drops, finished at z ${p.z.toFixed(1)}`);
  ok('and each drop advances toward the hole', p.z > 0, `z ${p.z.toFixed(1)}`);

  // the ordinary case still behaves: carry the water, no penalty at all
  const over = new ShotSim(T, { x: 0, z: 0, clubKey: 'DR', power: 1, aim: 0,
    faceDeg: 0, attackDeg: 0, wind: { dir: 0, speed: 0 } }).runToEnd();
  ok('a shot that clears the water is not penalised', over.penalty === 0,
     `carried ${over.carry.toFixed(0)} m to z ${over.z.toFixed(0)}`);
}

/* ================================================= the courses are not corridors */
head('hole shapes — five courses must not be forty-five straight lines');
{
  const courses = allCourses();
  const used = new Set();
  let sum = 0, n = 0, flatLongHoles = 0, biggest = 0;
  for (const c of courses) {
    for (const h of c.holes) {
      if (!h.shape) continue;                 // the hand-authored opener
      used.add(h.shape);
      // how far the centreline strays from the straight tee-to-green line,
      // as a fraction of that line — this is what "dogleg" means to a player
      const a = h.route[0], b = h.route[h.route.length - 1];
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
      let off = 0;
      for (const p of h.route) {
        const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (L * L);
        off = Math.max(off, Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dz * t)));
      }
      const pct = off / L * 100;
      sum += pct; n++;
      biggest = Math.max(biggest, pct);
      if (pct < 4 && h.par !== 3) flatLongHoles++;
    }
  }
  const avg = sum / n;
  ok('every shape in the catalogue actually gets built', used.size >= 5,
     [...used].join(', '));
  ok('the average hole bends meaningfully', avg > 8, `${avg.toFixed(1)}% of its length`);
  ok('and some hole is a genuine dogleg', biggest > 20, `biggest ${biggest.toFixed(1)}%`);
  /* A SHARE, not a count. This was `<= 3` absolute, which was a sensible
     number when the roster was eight courses and became a failing one the
     moment it grew to twelve — the generator had not changed at all, there
     were simply more holes to find rulers among. Six per cent keeps the
     claim ("a dead straight par 4 is rare") true at any roster size. */
  ok('par 4s and 5s are almost never rulers', flatLongHoles <= Math.ceil(n * 0.06),
     `${flatLongHoles} of ${n} holes under 4% (allowed ${Math.ceil(n * 0.06)})`);
}

/* =========================================== the club has to reach the ball */
head('address — a right-handed golfer whose club lands ON the ball');
{
  /* These mirror main.js exactly.  They are the numbers that decide whether
     the club sits next to the ball or a metre away from it, and they were
     measured off the real rig rather than guessed — so a change to the arm
     length or the address pose must move them, and this catches it. */
  const CLUB_REACH_FWD = 0.698, CLUB_REACH_SIDE = 0.526, ADDRESS_YAW_BIAS = -0.15;
  const addressSpot = (ball, aim) => {
    const B = aim - Math.PI / 2 + ADDRESS_YAW_BIAS;
    const fx = Math.sin(B), fz = Math.cos(B);
    const rx = -Math.cos(B), rz = Math.sin(B);
    return { x: ball.x - fx * CLUB_REACH_FWD - rx * CLUB_REACH_SIDE,
             z: ball.z - fz * CLUB_REACH_FWD - rz * CLUB_REACH_SIDE };
  };
  // where the club head ends up, given where the golfer stands
  const clubHead = (spot, aim) => {
    const B = aim - Math.PI / 2 + ADDRESS_YAW_BIAS;
    const fx = Math.sin(B), fz = Math.cos(B);
    const rx = -Math.cos(B), rz = Math.sin(B);
    return { x: spot.x + fx * CLUB_REACH_FWD + rx * CLUB_REACH_SIDE,
             z: spot.z + fz * CLUB_REACH_FWD + rz * CLUB_REACH_SIDE };
  };

  let worst = 0;
  for (const aim of [0, 0.7, 1.9, -1.2, Math.PI, -2.8]) {
    const ball = { x: 12, z: -30 };
    const h = clubHead(addressSpot(ball, aim), aim);
    worst = Math.max(worst, Math.hypot(h.x - ball.x, h.z - ball.z));
  }
  ok('the club head lands on the ball at every aim', worst < 1e-9,
     `worst ${(worst * 100).toFixed(2)} cm`);

  // and the golfer stands on the correct SIDE for a right-hander: the target
  // must be off their left shoulder, never their right
  const leftOf = h => ({ x: Math.cos(h), z: -Math.sin(h) });
  let allLeft = true;
  for (const aim of [0, 0.7, 1.9, -1.2, Math.PI]) {
    const ball = { x: 0, z: 0 };
    const spot = addressSpot(ball, aim);
    // vector from golfer to ball, against the golfer's left
    const L = leftOf(aim - Math.PI / 2 + ADDRESS_YAW_BIAS);
    const toTarget = { x: Math.sin(aim), z: Math.cos(aim) };
    if (toTarget.x * L.x + toTarget.z * L.z < 0.5) allLeft = false;
  }
  ok('the target sits off the golfer’s left shoulder', allLeft);
}

/* ============================================ the golfer fits in the seat */
head('seating — a rider must sit ON the bench, not through it');
{
  const { SEATS, WHEEL_R } = await import('../public/js/shared/cart.js');
  const { AVATAR_HEIGHT } = await import('../public/js/shared/avatars.js');
  // These mirror cart3d.js's CHASSIS_BOXES and avatar.js's seated pose.  The
  // avatar has no knee, so the seated pose shortens the leg — without that a
  // straight 0.84 m leg speared the bonnet, and the rider read as standing.
  const CUSHION_TOP = WHEEL_R + 0.27;
  const FLOOR_TOP = WHEEL_R + 0.10;
  const ROOF_UNDER = WHEEL_R + 1.72 - 0.035;
  const DASH_FRONT = 1.16;
  const SEATED_LEG = 0.62, LEG_ANGLE = 1.32, BODY_DROP = 0.24;

  const H = AVATAR_HEIGHT;
  const rootY = SEATS.driver.y;                 // relative to the ground
  const hipY = rootY + H * 0.47 - BODY_DROP;    // where the legs hang from
  const legLen = (H * 0.42 + H * 0.05) * SEATED_LEG;
  const footY = hipY - Math.cos(LEG_ANGLE) * legLen;
  const footZ = SEATS.driver.z + Math.sin(LEG_ANGLE) * legLen;
  const headTop = rootY + H * 0.7925 + H * 0.1595;

  ok('the hips land on the cushion', Math.abs(hipY - CUSHION_TOP) < 0.06,
     `hips ${hipY.toFixed(3)} m vs cushion ${CUSHION_TOP.toFixed(3)} m`);
  ok('the feet reach the floor pan without going through it',
     footY > FLOOR_TOP - 0.08 && footY < FLOOR_TOP + 0.14,
     `feet ${footY.toFixed(3)} m vs floor ${FLOOR_TOP.toFixed(3)} m`);
  ok('the knees stop short of the dashboard', footZ < DASH_FRONT,
     `feet reach z ${footZ.toFixed(2)} m, dash at ${DASH_FRONT} m`);
  ok('the head clears the canopy', headTop < ROOF_UNDER - 0.1,
     `head ${headTop.toFixed(2)} m, roof ${ROOF_UNDER.toFixed(2)} m`);
  ok('driver and passenger sit either side of the centreline',
     SEATS.driver.x < 0 && SEATS.passenger.x > 0
     && Math.abs(SEATS.driver.x + SEATS.passenger.x) < 1e-9);
}

/* ========================================================== overswing */
head('overswing — power past 1.0 must actually reach the simulation');
{
  const { ShotSim, makeFlatRange } = await import('../public/js/shared/ballistics.js');
  const { NO_CREW } = await import('../public/js/shared/crew.js');
  const T4 = makeFlatRange();
  const fire = (power, crew) => new ShotSim(T4, { x: 0, z: 0, clubKey: 'DR',
    power, aim: 0, faceDeg: 3, attackDeg: 0, wind: { speed: 0, dir: 0 }, crew });
  // the sim once clamped power to 1.0, which made every overswing consequence
  // dead code: no extra speed, no purity penalty, and Steady did nothing
  const over = fire(1.12, null).runToEnd().carry;
  const fullC = fire(1.0, null).runToEnd().carry;
  ok('an overswing genuinely flies further than a full swing',
     over > fullC + 5, `${fullC.toFixed(0)} -> ${over.toFixed(0)} m`);
  const calm = fire(1.12, { ...NO_CREW, steady: 10 });
  const raw = fire(1.12, null);
  ok('Steady damps the face on an overswing',
     calm.cfx.faceDamp > raw.cfx.faceDamp + 0.3,
     `damp ${raw.cfx.faceDamp.toFixed(2)} -> ${calm.cfx.faceDamp.toFixed(2)}`);
  const full = fire(1.0, { ...NO_CREW, steady: 10 });
  ok('but never on an ordinary full swing', full.cfx.faceDamp === 0);
}

/* ============================================== the boosted cart is honest */
head('boost — Pitstop’s +5.5% per level must be real speed, not a clamp');
{
  const T = flat();
  const stock = new CartBody(0, 0, 0);
  drive(T, stock, GO, 30);
  const tuned = new CartBody(0, 0, 0);
  tuned.boost = MAX_BOOST;                // Pitstop 10 + the cart tune, capped
  drive(T, tuned, GO, 40);
  // The headline number: a fully upgraded cart peaks around 55 km/h.
  // Everything below it is a real gain, not a step toward a hidden clamp.
  const kmh = tuned.speed * 3.6;
  ok('a fully upgraded cart peaks at the advertised top speed',
     Math.abs(kmh - TOP_SPEED_KMH) < 1.2, `${kmh.toFixed(1)} km/h vs ${TOP_SPEED_KMH}`);
  ok('and every boost level in between buys real speed',
     tuned.speed > stock.speed * 1.15,
     `stock ${(stock.speed * 3.6).toFixed(1)} -> boosted ${kmh.toFixed(1)} km/h`);
  ok('nothing can exceed the hard ceiling', tuned.speed <= ABS_MAX);
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
