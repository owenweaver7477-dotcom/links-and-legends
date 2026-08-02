/* =========================================================================
   main.js — the client: input, camera, shot playback, screen routing
   ========================================================================= */

import * as THREE from '../../vendor/three.module.js';
import { GolfScene } from './scene.js';
import { Avatar } from './avatar.js';
import { Walker } from './walker.js';
import { CartManager } from './carts.js';
import { reactionFor, REACTION_TIER } from './celebrations.js';
import { BOARD_RADIUS, KMH, TOP_SPEED_KMH } from '../shared/cart.js';
import { cartBoost, crewEffect, CADDIES, CADDIE_MAX, caddieCost, CLUB_TIERS, REFINE_COSTS } from '../shared/crew.js';
import { gearEffect } from '../shared/gear.js';
import { Roster } from './roster.js';
import { CameraRig, fitMapCamera } from './cameras.js';
import { SwingController, SWING } from './swing.js';
import { HUD } from './hud.js';
import { Net } from './net.js';
import { initCG, loadingStart, loadingStop, gameplayStart, gameplayStop,
         happytime, inviteLink, invitedRoom, storeGet, storeSet, CG } from './crazygames.js';

// The portal measures the download between here and the first gameplay
// start, so this is the first thing the module does.
loadingStart();
import { Sound } from './sound.js';

import { allCourses, getCourse } from '../shared/coursegen.js';
import { terrainFor, SURFACES } from '../shared/terrain.js';
import { BIOMES, COURSE_ORDER } from '../shared/biomes.js';
import { ShotSim, calibrateCarries, suggestedPower, BALL_RADIUS } from '../shared/ballistics.js';
import { CLUBS, CLUB_BY_KEY, suggestClub, clubIndex, normaliseBag, DEFAULT_BAG, BAG_SIZE } from '../shared/clubs.js';
import { toYards, clamp, lerp } from '../shared/rng.js';
import { normaliseLook, SHOT_RADIUS, EYE_HEIGHT, SPRINT_SPEED, CAPS, SHIRTS, SKINS, TROUSERS } from '../shared/avatars.js';

const canvas = document.getElementById('gl');

const G = {
  room: null, myPid: null, joined: false,
  course: null, hole: null, T: null, bio: null,
  loadedKey: null,
  screen: 'home',
  anim: null,              // { pid, sim, srv, done, doneAt, hold }
  queue: [],
  balls: {},               // pid -> {x,y,z}
  wind: { dir: 0, speed: 0 },
  mapOpen: false,
  lastAimPreview: 0,
  avatars: new Map(),       // pid -> Avatar
  remote: new Map(),        // pid -> {x,z,rot,tx,tz,trot,moving} interpolation state
  view: 'third',            // third | first
  profile: null,            // career stats, straight from the server
  celebUntil: 0,            // ms; holds the hole summary back for a reaction
  lastMoveSent: 0
};

calibrateCarries();
const COURSES = allCourses();

const scene = new GolfScene(canvas);
const rig = new CameraRig(scene.camera);
const swing = new SwingController();
const walker = new Walker();
const carts = new CartManager(scene.actorGroup);
const roster = new Roster(HUD.el.rosterList, HUD.el.labelLayer);

/* ===================================================================== */
/*  HELPERS                                                               */
/* ===================================================================== */
const player = pid => G.room?.players.find(p => p.pid === pid) || null;
const me = () => player(G.myPid);
const turnPlayer = () => (G.room ? player(G.room.turnPid) : null);
const myTurn = () => !!(G.room && G.room.state === 'playing' && G.room.turnPid === G.myPid);
const atMyBall = () => !G.T || walker.nearBall(ballOf(G.myPid));

/**
 * What the controls mean right now.  Dispatching on one value beats
 * sprinkling seat checks through eight branches: between the map, a shot
 * animation, having finished, whose turn it is, being in range and being sat
 * in a cart there are six booleans in play, and the combinations win.
 */
function mode() {
  if (G.screen !== 'game') return 'none';
  if (G.mapOpen) return 'map';
  if (carts.driving) return 'drive';
  if (carts.riding) return 'ride';
  if (myTurn() && !G.anim && !G.queue.length && !me()?.finished && atMyBall()) return 'swing';
  return 'walk';
}

const canSwing = () => mode() === 'swing';

function ballOf(pid) {
  const b = G.balls[pid];
  if (b) return b;
  const p = player(pid);
  if (p && G.T) return { x: p.x, y: G.T.heightAt(p.x, p.z) + BALL_RADIUS, z: p.z };
  return { x: 0, y: 0, z: 0 };
}

/* ===================================================================== */
/*  HOLE LOADING                                                          */
/* ===================================================================== */
function ensureHole(courseId, holeIndex) {
  const key = courseId + ':' + holeIndex;
  if (G.loadedKey === key) return false;
  clearMenuBackdrop();               // a real round owns the scene from here
  HUD.show('load');
  HUD.loading('Shaping ' + (BIOMES[courseId]?.name || 'the course') + '…');

  G.course = getCourse(courseId);
  G.hole = G.course.holes[holeIndex];
  G.bio = BIOMES[courseId];
  G.T = terrainFor(G.hole, G.bio);
  scene.loadHole(G.hole, G.T, G.bio);
  carts.clear();               // you do not drive last hole's cart to this tee
  G.loadedKey = key;

  // put every ball on the tee until the server says otherwise
  G.balls = {};
  if (G.room) for (const p of G.room.players) {
    G.balls[p.pid] = { x: p.x, y: G.T.heightAt(p.x, p.z) + BALL_RADIUS, z: p.z };
  }
  HUD.setHole(G.course, G.hole, G.room?.teeSet || 'back');
  aimAtPin();
  rig.reset();
  rig.snap();
  return true;
}

/* Where the club head actually ends up, measured off the rig at address:
   0.70 m in front of the golfer and 0.53 m to their right (the club hangs
   off the right arm).  Standing the golfer at exactly minus that vector puts
   the head ON the ball instead of near it — which is the whole of the
   "club doesn't line up with the ball" bug.  Measured, not guessed: see the
   address-alignment check in test/cart.mjs. */
const CLUB_REACH_FWD = 0.698;
/* The address pose turns the body a touch away from the target line
   (P.yaw = -0.15 at address in avatar.js).  The stance has to be solved in
   that same frame or the club sits off the ball by the arc it sweeps. */
const ADDRESS_YAW_BIAS = -0.15;
const CLUB_REACH_SIDE = 0.526;

/**
 * Where a golfer actually stands to play a ball: a step to the side of the
 * line, not on top of it — otherwise the avatar hides the ball completely.
 */
function addressSpot(ball, aim) {
  /* A right-handed golfer stands with the target off their LEFT shoulder and
     the ball directly in FRONT of their feet.  Facing aim-90°, forward is
     right(aim) — so the golfer belongs on the left(aim) side of the ball, and
     the ball then sits exactly where the club falls.  This used to return the
     right(aim) side, which put the golfer past the ball with the club
     reaching back across their body: the "club isn't next to the ball" bug. */
  // Work in the golfer's ACTUAL body heading, which is the address stance
  // (aim - 90 deg) plus the small turn the address pose itself applies — miss
  // that bias out and the club head lands a consistent 13 cm off the ball.
  const B = aim - Math.PI / 2 + ADDRESS_YAW_BIAS;
  const fx = Math.sin(B), fz = Math.cos(B);      // the golfer's forward
  const rx = -Math.cos(B), rz = Math.sin(B);     // the golfer's right
  return {
    x: ball.x - fx * CLUB_REACH_FWD - rx * CLUB_REACH_SIDE,
    z: ball.z - fz * CLUB_REACH_FWD - rz * CLUB_REACH_SIDE
  };
}

/* ===================================================================== */
/*  MENU BACKDROP — the course IS the title screen                        */
/* ===================================================================== */
/*
 * The best-looking thing this game owns is the game, so the front page
 * stands YOUR golfer on the first tee of Claude National, club in hand,
 * ball teed up, while the camera drifts slowly around them.  Change a
 * shirt swatch and the figure on the tee changes with it — the outfit
 * picker becomes a character screen instead of a wall of coloured squares.
 *
 * It reuses the exact scene a round would build (same loadHole, same
 * G.loadedKey), so pressing Play Now on the default course starts on a
 * course that is ALREADY built — the title screen doubles as a preload.
 */
const menu = { key: null, av: null, t: 0 };
/* Which course the title screen is showing and Play now will start.
   Remembered, so someone who likes the links does not re-pick it. */
let pickedCourse = COURSE_ORDER[0];
try { const c = localStorage.getItem('lg_course');
      if (c && COURSE_ORDER.includes(c)) pickedCourse = c; } catch { /* private mode */ }

function menuBackdrop() {
  if (G.joined || menu.key) return;
  // the actor group survives hole changes on purpose, so avatars from a round
  // just left have to be shown out — or they loiter on the title screen
  for (const [pid, av] of G.avatars) {
    scene.actorGroup.remove(av.root); av.dispose();
    G.avatars.delete(pid); G.remote.delete(pid);
  }
  const courseId = pickedCourse;
  G.course = getCourse(courseId);
  G.hole = G.course.holes[0];
  G.bio = BIOMES[courseId];
  G.T = terrainFor(G.hole, G.bio);
  scene.loadHole(G.hole, G.T, G.bio);
  G.loadedKey = courseId + ':0';
  menu.key = courseId;
  menu.t = 0;
  const tee = G.hole.tee;
  scene.syncBalls([{ pid: 'menu', color: '#f6f9f4', spectator: false }]);
  scene.setBall('menu', tee.x, G.T.heightAt(tee.x, tee.z) + BALL_RADIUS, tee.z);
  refreshMenuAvatar();
}

/** Rebuild the tee-side golfer — called whenever a swatch changes. */
function refreshMenuAvatar() {
  if (!menu.key || !G.hole) return;
  if (menu.av) { scene.actorGroup.remove(menu.av.root); menu.av.dispose(); menu.av = null; }
  const tee = G.hole.tee;
  const aim = Math.atan2(G.hole.pin.x - tee.x, G.hole.pin.z - tee.z);
  const spot = addressSpot(tee, aim);
  const av = menu.av = new Avatar(lookDraft || normaliseLook(null), '#f6f9f4');
  scene.actorGroup.add(av.root);
  av.place(spot.x, G.T.heightAt(spot.x, spot.z), spot.z, aim);
  av.setClub('DR', G.profile?.clubTier ?? 0);
  av.setAddress(true, aim - Math.PI / 2);   // right-handed, as in the round
  av.update(0.016, 0);
}

/** A real round is starting: the stand-in leaves the tee. */
function clearMenuBackdrop() {
  if (menu.av) { scene.actorGroup.remove(menu.av.root); menu.av.dispose(); menu.av = null; }
  menu.key = null;
}

/** One frame of title screen: a slow, low orbit around the golfer. */
function menuFrame(dt) {
  menu.t += dt;
  const tee = G.hole.tee;
  const gy = G.T.heightAt(tee.x, tee.z);
  const a = menu.t * 0.055 + 0.9;
  const r = 8.2;
  const cx = tee.x + Math.sin(a) * r, cz = tee.z + Math.cos(a) * r;
  scene.camera.position.set(cx, gy + 2.35 + Math.sin(menu.t * 0.13) * 0.25, cz);
  // Aim past the golfer's LEFT so they sit in the right-hand two thirds of
  // the frame — the menu column owns the left of the screen.
  const dx = tee.x - cx, dz = tee.z - cz;
  const L = Math.hypot(dx, dz) || 1;
  scene.camera.lookAt(tee.x + (dz / L) * 2.0, gy + 1.2, tee.z - (dx / L) * 2.0);
  scene.setBall('menu', tee.x, gy + BALL_RADIUS, tee.z);   // keep its draw size right
  menu.av?.update(dt, 0);
  scene.windDir = 0.6;
  scene.update(dt);
  scene.render(scene.camera);
}

/** Point the aim straight at the flag (or at the fairway on a long hole). */
function aimAtPin() {
  const b = ballOf(G.myPid);
  const h = G.hole;
  swing.setAim(Math.atan2(h.pin.x - b.x, h.pin.z - b.z));
}

/* ===================================================================== */
/*  CLUB SELECTION                                                        */
/* ===================================================================== */
let clubKey = 'DR';
let clubManual = false;

/** the fourteen clubs this player is carrying (server is the source of truth) */
const myBag = () => me()?.bag?.length ? me().bag : normaliseBag(DEFAULT_BAG);

/**
 * How much further this player's ball flies than a stock one.  The carry
 * number under the club name has to promise what the upgraded bag will
 * actually deliver — for a fresh profile every factor is exactly 1.
 */
function carryMult(club) {
  const fx = gearEffect(G.profile?.gear || null, club);
  const cfx = crewEffect(G.profile?.crew || null, G.profile?.clubTier ?? 0,
    G.profile?.refine ?? 0, { power: 1 });
  return fx.speed * cfx.speed;
}

/** The same figure without a club in hand, for choosing one in the first place. */
const reachMult = () => crewEffect(G.profile?.crew || null, G.profile?.clubTier ?? 0,
  G.profile?.refine ?? 0, { power: 1 }).speed;

/** Where this club sits in the bag, so the arrows can grey out at the ends. */
function bagEnds() {
  const bag = myBag();
  const i = clubIndex(clubKey, bag);
  return { longest: i <= 0, shortest: i >= bag.length - 1 };
}

function autoClub() {
  if (clubManual || !G.T) return;
  const b = ballOf(G.myPid);
  const d = G.T.toPin(b.x, b.z);
  const lie = G.T.surfaceAt(b.x, b.z);
  clubKey = suggestClub(d, lie.id, lie.id === 'green', myBag(), reachMult()).key;
  swing.clubKey = clubKey;
  swing.setLie(lie.id);              // the lie sets the strike bar's tempo
  const club = CLUB_BY_KEY[clubKey];
  HUD.setClub(club, lie.id, carryMult(club), bagEnds());
}
function stepClub(dir) {
  const bag = myBag();
  let i = clubIndex(clubKey, bag);
  if (i < 0) i = bag.indexOf(suggestClub(999, 'fairway', false, bag).key);
  clubKey = bag[clamp(i + dir, 0, bag.length - 1)];
  swing.clubKey = clubKey;
  clubManual = true;
  const club = CLUB_BY_KEY[clubKey];
  const lieId = G.T ? G.T.surfaceAt(ballOf(G.myPid).x, ballOf(G.myPid).z).id : 'fairway';
  swing.setLie(lieId);
  HUD.setClub(club, lieId, carryMult(club), bagEnds());
  refreshAimPreview(true);
}

/* ===================================================================== */
/*  AIM PREVIEW                                                           */
/* ===================================================================== */
let previewKey = '';
function refreshAimPreview(force) {
  if (!canSwing() || !G.T) { scene.setAimLine(null); scene.setSlopeRead(null); scene.setGreenRead(false); previewKey = ''; return; }
  const now = performance.now();
  if (!force && now - G.lastAimPreview < 80) return;
  G.lastAimPreview = now;

  const b = ballOf(G.myPid);
  // a full simulation costs ~2 ms, so only redo it when the shot actually changed
  const key = `${clubKey}|${swing.aim.toFixed(4)}|${b.x.toFixed(2)},${b.z.toFixed(2)}|${G.wind.dir.toFixed(2)},${G.wind.speed}`;
  if (!force && key === previewKey) return;
  previewKey = key;

  // Where a well-struck shot with this club would finish.  On the green the
  // caddie aims the read at the hole itself, so the line IS the make line.
  const isPutt = CLUB_BY_KEY[clubKey].putter;
  const toPinD = G.T.toPin(b.x, b.z);
  const myGear = G.profile?.gear || null;
  const myCrew = G.profile?.crew || null;
  const myTier = G.profile?.clubTier ?? 0;
  const myRefine = G.profile?.refine ?? 0;
  const myKit = { crew: myCrew, clubTier: myTier, refine: myRefine };
  const previewPower = isPutt
    ? (suggestedPower(G.T, b.x, b.z, clubKey, swing.aim, G.wind, toPinD + 0.45, myGear, myKit) ?? 1)
    : 1;
  // Roller (or the legacy milled putter) extends the read past the cup,
  // showing the run-out.  Without either, the line ends where the hole
  // would swallow the ball.
  const showRunOut = !isPutt || (myCrew?.roller || 0) >= 4 || (myGear?.putter || 0) >= 1;
  const sim = new ShotSim(G.T, {
    x: b.x, z: b.z, clubKey, power: Math.min(previewPower, 1.12), aim: swing.aim,
    faceDeg: 0, attackDeg: 0, wind: G.wind, ignoreCup: showRunOut, gear: myGear,
    crew: myCrew, clubTier: myTier, refine: myRefine
  });
  const r = sim.runToEnd();

  // The line is the SIMULATED path, not a straight ruler: a putt bends with
  // the borrow, an approach shows its arc and its bounce.  This is the
  // "where will it actually go" read a real caddie gives you.
  const path = sim.path;
  const pts = [];
  const step = Math.max(1, Math.floor(path.length / 60));
  for (let i = 0; i < path.length; i += step) {
    const p = path[i];
    pts.push(new THREE.Vector3(p.x, Math.max(p.y + 0.05, G.T.heightAt(p.x, p.z) + 0.07), p.z));
  }
  const last = path[path.length - 1];
  if (last) pts.push(new THREE.Vector3(last.x, G.T.heightAt(last.x, last.z) + 0.07, last.z));
  scene.setAimLine(pts, isPutt);       // putts get the wide, bright read band
  G.lastPreviewEnd = last ? { x: last.x, z: last.z } : null;

  // Putt difficulty, read off the simulation itself: how far the borrow
  // carries the ball off the straight line, plus the length of the putt.
  if (isPutt && pts.length > 2) {
    const dx = last.x - b.x, dz = last.z - b.z;
    const chord = Math.hypot(dx, dz) || 1;
    let bend = 0;
    for (const p of path) {
      const t = ((p.x - b.x) * dx + (p.z - b.z) * dz) / (chord * chord);
      const px = b.x + dx * t, pz = b.z + dz * t;
      bend = Math.max(bend, Math.hypot(p.x - px, p.z - pz));
    }
    const hard = bend > 0.9 || toPinD > 12;
    const risky = bend > 0.3 || toPinD > 6;
    scene.setAimLineColor(hard ? 0xff7a5c : risky ? 0xffd76b : 0x8fe07a);
    scene.setSlopeRead(b.x, b.z, G.T);
    scene.setGreenRead((myCrew?.roller || 0) >= 1 || (myGear?.putter || 0) >= 1);
  } else {
    scene.setAimLineColor(0xffffff);
    scene.setSlopeRead(null);
    scene.setGreenRead(false);
  }

  // The caddie mark: how hard to hit it to finish at the flag.  On a putt aim
  // to run it a foot and a half past — a putt that dies at the hole never
  // goes in.
  const toPin = G.T.toPin(b.x, b.z);
  const past = CLUB_BY_KEY[clubKey].putter ? 0.45 : 0;
  // the marker swings the same upgraded ball the server will — see suggestedPower
  HUD.setTargetPower(suggestedPower(G.T, b.x, b.z, clubKey, swing.aim, G.wind, toPin + past, myGear, myKit));
}

/* ===================================================================== */
/*  AVATARS                                                               */
/* ===================================================================== */

/** One golfer per player; rebuilt only when their appearance actually changes. */
function syncAvatars(players) {
  if (!G.T) return;
  const seen = new Set();
  for (const pl of players) {
    if (pl.spectator) continue;
    seen.add(pl.pid);
    const look = normaliseLook(pl.look);
    const key = JSON.stringify(look) + pl.color;
    let av = G.avatars.get(pl.pid);
    if (!av || av.lookKey !== key) {
      if (av) { scene.actorGroup.remove(av.root); av.dispose(); }
      av = new Avatar(look, pl.color);
      av.lookKey = key;
      scene.actorGroup.add(av.root);
      G.avatars.set(pl.pid, av);
    }
    if (!G.remote.has(pl.pid)) {
      const x = pl.ax ?? pl.x, z = pl.az ?? pl.z, r = pl.arot ?? 0;
      G.remote.set(pl.pid, { x, z, rot: r, tx: x, tz: z, trot: r, moving: false });
    }
  }
  for (const [pid, av] of G.avatars) {
    if (seen.has(pid)) continue;
    scene.actorGroup.remove(av.root); av.dispose();
    G.avatars.delete(pid); G.remote.delete(pid);
  }
  roster.sync(players, G.myPid);
}

/**
 * Move every avatar for this frame.  The local golfer follows the walker
 * exactly; remote ones EASE toward their last reported position instead of
 * snapping to it, so a 10 Hz feed still reads as continuous walking.
 */
function updateAvatars(dt) {
  if (!G.T || !G.room) return;
  for (const pl of G.room.players) {
    if (pl.spectator) continue;
    const av = G.avatars.get(pl.pid);
    if (!av) continue;

    // Anyone in a seat is placed straight from the cart transform.  Running a
    // passenger through the position ease as WELL as the cart's own ease gives
    // two smoothers on one rigid body, and they visibly slide out of the seat
    // on every corner — no value of k fixes that, it is structural.
    const seat = carts.seatFor(pl.pid, G.myPid);
    if (seat) {
      av.setSeated(true);
      av.place(seat.x, G.T.heightAt(seat.x, seat.z) + seat.y, seat.z, seat.heading);
      av.setRideTilt(seat.pitch || 0, seat.roll || 0);   // lean with the body
      av.update(dt, 0);
      av.setVisible(pl.pid !== G.myPid || G.view !== 'first');
      continue;
    }
    if (av.seated) {
      av.setSeated(false);
      // hard-set both ends of the ease, or they slide in from wherever they
      // were standing when they climbed aboard
      const rr = G.remote.get(pl.pid);
      if (rr) { rr.x = rr.tx; rr.z = rr.tz; rr.rot = rr.trot; rr.moving = false; }
    }

    if (pl.pid === G.myPid) {
      /* Over the ball, the golfer SNAPS to a proper address rather than
         standing wherever the walk happened to stop.  Without this the club
         head sat anywhere from 28 cm to a metre from the ball depending on
         the approach and the aim — and re-aiming swung the whole body around
         the ball instead of the golfer stepping round it.  The walker itself
         is untouched, so the server's walk-radius check still measures where
         the player actually is. */
      let ax = walker.x, az = walker.z, ah = walker.heading;
      if (mode() === 'swing' && walker.speed < 0.2) {
        const b = ballOf(G.myPid);
        const spot = addressSpot(b, swing.aim);
        const k = av._addressed ? 1 : Math.min(1, dt * 9);   // ease in once, then hold
        ax = walker.x + (spot.x - walker.x) * k;
        az = walker.z + (spot.z - walker.z) * k;
        ah = swing.aim - Math.PI / 2;                        // right-handed stance
        if (Math.hypot(spot.x - ax, spot.z - az) < 0.02) av._addressed = true;
      } else {
        av._addressed = false;
      }
      av.place(ax, G.T.heightAt(ax, az), az, ah);
      // over the ball on your turn you take up the stance, and the club goes
      // back exactly as far as the meter says — the swing you see IS the
      // number you are about to play
      if (mode() === 'swing') {
        av.setClub(clubKey, G.profile?.clubTier ?? 0);   // your club, your set
        // A RIGHT-handed golfer stands with the target off their LEFT
        // shoulder.  In this frame heading h+90° points along h's left hand,
        // so the stance that puts the target to the left is aim-90°; the
        // stance was aim+90°, which is a left-hander.
        av.setAddress(true, swing.aim - Math.PI / 2);
        const m = swing.meter();
        av.setBackswing(m.state === 'back' || m.state === 'down' ? m.power / 1.12 : 0);
      } else {
        av.setAddress(false);
      }
      av.update(dt, walker.speed);
      av.setVisible(G.view !== 'first');        // you cannot see your own head
      continue;
    }

    const r = G.remote.get(pl.pid);
    if (!r) continue;
    const k = 1 - Math.exp(-9 * dt);
    const px = r.x, pz = r.z;
    r.x += (r.tx - r.x) * k;
    r.z += (r.tz - r.z) * k;
    let d = r.trot - r.rot;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    r.rot += d * k;

    const measured = Math.hypot(r.x - px, r.z - pz) / Math.max(dt, 1e-3);
    av.place(r.x, G.T.heightAt(r.x, r.z), r.z, r.rot);
    av.update(dt, r.moving ? Math.max(measured, 1.4) : measured);
    av.setVisible(true);
  }
}

/** Report our position ten times a second — cheap, and only while playing. */
const tintOf = pid => player(pid)?.color || '#2f6d3f';

function pushMyPosition(now) {
  if (!G.room || G.room.state !== 'playing') return;
  if (now - G.lastMoveSent < 100) return;
  G.lastMoveSent = now;
  Net.move(walker.x, walker.z, walker.heading, walker.moving, carts.wire());
}

/**
 * Held-arrow aiming.  In the frame loop and scaled by dt, so the rate is the
 * same whether the machine is running at 144 fps or struggling at 30 — and it
 * cannot stall the way a background-throttled timer would.
 */
/**
 * The landing dot: where THIS power finishes the ball, refreshed a few times
 * a second while the club is going back.  Runs the real simulation, so it
 * bends when the strike is drifting into a hook or a slice.
 */
let lastLanding = 0;
function updateLandingDot(now) {
  if (!G.T) return;
  const m = swing.meter();
  const dragging = canSwing() && (m.state === 'back' || m.state === 'down');
  if (!dragging) {
    if (G.landingOn) { scene.setLanding(null); G.landingOn = false; }
    return;
  }
  if (now - lastLanding < 120 || m.power < 0.05) return;
  lastLanding = now;
  const b = ballOf(G.myPid);
  const r = new ShotSim(G.T, {
    x: b.x, z: b.z, clubKey,
    power: Math.min(m.power, 1.12), aim: swing.aim,
    faceDeg: m.face || 0, attackDeg: 0, wind: G.wind,
    gear: G.profile?.gear || null, crew: G.profile?.crew || null,
    clubTier: G.profile?.clubTier ?? 0, refine: G.profile?.refine ?? 0
  }).runToEnd();
  scene.setLanding(r.x, G.T.heightAt(r.x, r.z), r.z, Math.min(1, Math.abs(m.face || 0) / 7));
  G.landingOn = true;
}

/**
 * Aiming has two speeds in one key: TAP for surgical half-degree nudges,
 * HOLD and the rate winds up from fine to a fast sweep — so lining up on the
 * flag and swinging round a dogleg are the same control.  Shift stays
 * pinned to ultra-fine for putts.
 */
const AIM_RATE_TAP = 0.055;         // rad/s at the first touch — fine
const AIM_RATE_HELD = 0.85;         // rad/s after two seconds — gross
let aimHeldFor = 0;
function stepAim(dt) {
  if (G.screen !== 'game' || !canSwing()) { aimHeldFor = 0; return; }
  const l = keys.has('arrowleft'), r = keys.has('arrowright');
  if (!l && !r) { aimHeldFor = 0; return; }
  aimHeldFor += dt;
  const wind = Math.min(1, aimHeldFor / 2.0);
  let rate = AIM_RATE_TAP + (AIM_RATE_HELD - AIM_RATE_TAP) * wind * wind;
  if (keys.has('shift')) rate = AIM_RATE_TAP * 0.5;      // ultra fine, always
  // Forward is (sin h, cos h) and up is +Y, so the player's RIGHT is reached by
  // DECREASING the heading — the same minus that swaps A and D on the cart.
  // ArrowRight must therefore SUBTRACT, or the arrows aim the wrong way.
  const d = (l ? 1 : 0) - (r ? 1 : 0);
  swing.nudgeAim(d * rate * dt);
  refreshAimPreview();
}

/* The aim buttons: press and HOLD to sweep, exactly like the arrow keys.
   A click alone is one fine nudge, so a tap still places the aim precisely. */
const AIM_BTN = { dir: 0, held: 0 };
function stepAimButtons(dt) {
  if (!AIM_BTN.dir) return;
  // losing the turn mid-sweep must release the button, not leave it glowing
  if (!canSwing()) {
    AIM_BTN.dir = 0;
    for (const id of ['aimL', 'aimR']) document.getElementById(id).classList.remove('held');
    return;
  }
  AIM_BTN.held += dt;
  const wind = Math.min(1, AIM_BTN.held / 2.0);
  const rate = AIM_RATE_TAP + (AIM_RATE_HELD - AIM_RATE_TAP) * wind * wind;
  swing.nudgeAim(AIM_BTN.dir * rate * dt);
  refreshAimPreview();
}
function holdAim(el, dir) {
  const start = e => {
    e.preventDefault();
    AIM_BTN.dir = dir; AIM_BTN.held = 0;
    el.classList.add('held');             // the button says it is sweeping
    swing.nudgeAim(dir * 0.009);          // the tap: ~0.5 degrees
    refreshAimPreview(true);
  };
  const stop = () => { AIM_BTN.dir = 0; AIM_BTN.held = 0; el.classList.remove('held'); };
  el.addEventListener('pointerdown', start);
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointerleave', stop);
  el.addEventListener('pointercancel', stop);
  window.addEventListener('blur', stop);
}

/* A rolling average of real frame time. Averaged over a second so it reads
   steadily rather than flickering on every hitch. */
let _fpsAcc = 0, _fpsN = 0, _fpsAt = 0;
let _slowRuns = 0, _autoDropped = false;
function measureFrame(now) {
  if (_fpsAt) { _fpsAcc += now - _fpsAt; _fpsN++; }
  _fpsAt = now;
  if (_fpsN < 30) return;
  const ms = _fpsAcc / _fpsN;
  _fpsAcc = 0; _fpsN = 0;
  if (HUD.perfVisible()) {
    const r = scene.renderer.info.render;
    HUD.setPerf(1000 / ms, ms, r.calls, r.triangles, HUD.quality);
  }

  /* Adaptive quality.  Sun shadows are a whole extra pass over every caster,
     and with a full course of golfers and carts that is exactly the machine
     that cannot afford them.  Rather than let it grind, notice a sustained
     bad frame time and drop to the blob-shadow path once, saying so.  Only
     ever downward, and only once, so it can never oscillate. */
  if (_autoDropped || HUD.quality !== 'quality' || G.screen !== 'game') return;
  _slowRuns = ms > 34 ? _slowRuns + 1 : 0;      // worse than ~30 fps
  if (_slowRuns >= 12) {                        // ~6 s of it, not one hitch
    _autoDropped = true;
    HUD.quality = 'perf';
    scene.setQuality('perf');
    HUD.toast('Graphics eased to keep things smooth — change it in the clubhouse.', 'info', 4200);
  }
}

/** Which way the camera is looking, flattened onto the ground. */
const _camDir = new THREE.Vector3();
function cameraYaw() {
  scene.camera.getWorldDirection(_camDir);
  return Math.atan2(_camDir.x, _camDir.z);
}

/* ===================================================================== */
/*  SHOT PLAYBACK                                                         */
/* ===================================================================== */
/* How many shots may wait to be watched before we stop watching them. */
const QUEUE_LIMIT = 2;

/**
 * Start the next queued shot.
 *
 * If the backlog has grown — a laptop that was asleep, a background tab, or
 * simply somebody playing quickly while we watched a long one — the older
 * shots are settled instantly instead of played out.  Without this the client
 * falls further and further behind, and because the swing is gated on
 * `!G.anim` the player is locked out of their own turn while it catches up,
 * which feels exactly like the game has frozen.
 */
function pumpQueue() {
  if (G.anim || !G.queue.length) return;

  while (G.queue.length > QUEUE_LIMIT) {
    const skipped = G.queue.shift();
    settleShot(skipped);
  }
  beginShot(G.queue.shift());
}

/** Apply a shot's outcome without animating it. */
function settleShot(msg) {
  const r = msg.result;
  G.balls[msg.pid] = { x: r.x, y: (G.T ? G.T.heightAt(r.x, r.z) : 0) + BALL_RADIUS, z: r.z };
  scene.setBall(msg.pid, r.x, G.balls[msg.pid].y, r.z);
}

function beginShot(msg) {
  const sim = new ShotSim(G.T, msg.shot);
  G.anim = {
    seq: msg.seq, pid: msg.pid, sim, srv: msg.result,
    done: false, doneAt: 0, hold: 0, eventIdx: 0,
    launchDir: msg.shot.aim
  };
  G.balls[msg.pid] = { x: sim.p.x, y: sim.p.y, z: sim.p.z };
  // the golfer swings on every screen, timed so the ball leaves at the hit
  const swingAv = G.avatars.get(msg.pid);
  if (swingAv) { swingAv.setClub(msg.shot.clubKey, player(msg.pid)?.clubTier ?? 0); swingAv.strike(msg.shot.aim); }
  scene.setTraceColor(player(msg.pid)?.color || '#ffffff');
  Sound.strike(CLUB_BY_KEY[msg.shot.clubKey], msg.shot.power);
  scene.clearTrace();
  scene.setAimLine(null);
  rig.kick(0.55);
  HUD.showPlaybar(false);

  const p = player(msg.pid);
  if (p && msg.pid !== G.myPid) HUD.toast(`${p.name} — ${CLUB_BY_KEY[msg.shot.clubKey]?.label || 'shot'}`, 'info', 1500);
}

function drainEvents(a) {
  const evs = a.sim.events;
  for (; a.eventIdx < evs.length; a.eventIdx++) {
    const e = evs[a.eventIdx];
    if (e.type === 'splash') { scene.fx.burst('splash', e.x, e.y, e.z, 24); rig.kick(0.4); Sound.splash(); }
    else if (e.type === 'tree') { scene.fx.burst('leaves', e.x, e.y, e.z, 8); Sound.bounce('grass', e.speed || 8); }
    else if (e.type === 'bounce' || e.type === 'land') {
      if (e.speed > 6) {
        const kind = e.surf === 'sand' ? 'sand' : 'grass';
        scene.fx.burst(kind, e.x, e.y, e.z, e.surf === 'sand' ? 16 : 8);
        Sound.bounce(e.surf, e.speed);
      }
    } else if (e.type === 'holed') { scene.fx.burst('grass', e.x, e.y + 0.2, e.z, 20); Sound.holed(); }
  }
}

function stepAnim(dt, now) {
  const a = G.anim;
  if (!a) return;

  if (!a.done) {
    const res = a.sim.advance(dt);
    // the broadcast-tracer glow rides the ball while it is in the air
    if (a.sim.airborne) {
      scene.setBallGlow(a.sim.p.x, a.sim.p.y, a.sim.p.z, player(a.pid)?.color);
    } else scene.setBallGlow(null);
    drainEvents(a);
    const p = a.sim.p;
    G.balls[a.pid] = { x: p.x, y: p.y, z: p.z };
    scene.setBall(a.pid, p.x, p.y, p.z);
    scene.setTrace(a.sim.path);
    if (res) {
      a.done = true;
      a.doneAt = now;
      a.hold = res.reason === 'holed' ? 1900 : (res.reason === 'water' || res.reason === 'ob') ? 1500 : 900;
      announce(a);
    }
    return;
  }

  if (now - a.doneAt > a.hold) {
    // snap to the server's answer (they agree, but the server is the authority)
    const s = a.srv;
    G.balls[a.pid] = { x: s.x, y: G.T.heightAt(s.x, s.z) + BALL_RADIUS, z: s.z };
    scene.setBall(a.pid, G.balls[a.pid].x, G.balls[a.pid].y, G.balls[a.pid].z);
    scene.clearTrace();
    G.anim = null;
    scene.setBallGlow(null);
    pumpQueue();
    refreshTurnUi();
    if (myTurn()) { clubManual = false; autoClub(); aimAtPin(); rig.reset(); G.view = 'third'; }
    // Your golfer stays where they played from.  Deliberately NO auto-jog
    // after the ball: whether to walk up now, wait for the others to hit, or
    // fetch the cart is the player's call — F jogs you there whenever.
  }
}

function announce(a) {
  const r = a.srv, p = player(a.pid);
  const who = a.pid === G.myPid ? 'You' : (p?.name || 'Player');
  const yd = m => Math.round(HUD.dist(m));

  if (r.holed) {
    const h = G.hole;
    const rel = r.strokes - h.par;
    fireReaction(a.pid, r.strokes, h.par, false);
    const tier = REACTION_TIER[reactionFor(r.strokes, h.par, false)] || 0;
    HUD.flash(HUD.scoreName(rel), `${p?.name || ''} holed out in ${r.strokes}`,
      tier >= 3 ? '#ffd94a' : rel < 0 ? '#8fe07a' : '#fff', tier);
    HUD.toast(`⛳ ${p?.name} holed out in ${r.strokes}`, 'good', 3200);
  } else if (r.reason === 'water') {
    HUD.flash('Water', `${who} — one penalty stroke`, '#7fd4ff');
    HUD.toast(`💦 ${who} found the water — +1`, 'bad', 2800);
  } else if (r.reason === 'ob') {
    HUD.flash('Out of bounds', `${who} — stroke and distance`, '#ff8f7f');
    HUD.toast(`⚑ ${who} went OB — +1, replaying the lie`, 'bad', 2800);
  } else if (r.capped) {
    fireReaction(a.pid, r.strokes, G.hole.par, true);
    HUD.toast(`${who} picked up at ${r.strokes}`, 'warn', 2600);
  } else if (a.pid === G.myPid) {
    const lie = SURFACES[r.lie]?.label || 'Rough';
    HUD.flash(`${yd(r.carry)} ${HUD.unit()}`, `carry · ${yd(r.total)} total · ${lie}`, '#eaf4ec');
  }
}

/**
 * Play whatever this score deserves on that player's golfer.
 *
 * Everyone runs this for everyone, off the shot event every client already
 * receives, so a birdie is celebrated on every screen rather than only the
 * scorer's.  G.celebUntil holds back the hole-over summary so the last player
 * to hole out actually sees their own reaction instead of a black overlay.
 */
function fireReaction(pid, strokes, par, capped) {
  const name = reactionFor(strokes, par, capped);
  if (!name) return;
  const av = G.avatars.get(pid);
  if (!av) return;
  const dur = av.play(name);
  if (dur) {
    G.celebUntil = Math.max(G.celebUntil || 0, performance.now() + dur * 1000);
    const tier = REACTION_TIER[name] || 0;
    Sound.celebrate(tier);
    // an eagle, an albatross or an ace is a genuine milestone — the portal
    // has its own celebration for those, and this is what triggers it
    if (tier >= 2 && pid === G.myPid) happytime();
  }
}

const celebrating = () => (G.celebUntil || 0) > performance.now();

/* ===================================================================== */
/*  FRAME                                                                 */
/* ===================================================================== */
let last = 0;
let smokeAt = 0;                 // countdown between puffs from a damaged cart
function frame(now) {
  requestAnimationFrame(frame);
  const dt = last ? clamp((now - last) / 1000, 0, 0.1) : 0;
  last = now;
  // the title screen: the course drifting behind the menu (and behind the
  // lobby, for a host who has not started yet)
  if (menu.key && G.hole && (!G.joined || G.room?.state === 'lobby')) { menuFrame(dt); return; }
  if (!G.hole) return;

  scene.windDir = G.wind.dir;
  stepAnim(dt, now);

  // walking runs before the camera so the view follows this frame's position
  // rather than lagging it by one
  const m = mode();
  const seated = m === 'drive' || m === 'ride';
  // Holing out does NOT root you to the green: you can walk off, fetch the
  // cart, follow your friends.  The only thing being finished takes away is
  // the swing, which mode() already refuses.
  walker.enabled = !seated && G.screen === 'game' && !G.mapOpen && !G.anim
    && G.room?.state === 'playing';
  walker.arrowsAim = m === 'swing';  // arrows become the aim when in range

  if (m === 'drive') {
    carts.readKeys(keys);
    const wasFlash = carts.hitFlash;
    carts.step(dt, G.T, G.hole);
    if (carts.hitFlash > wasFlash + 0.3) Sound.crash();
    Sound.cart(carts.sinking != null ? 0.5 : carts.body?.speed ?? 0);
    if (carts.sinking != null && carts.sinking < dt * 2) Sound.splash();
    // A damaged cart smokes from the engine bay, harder the worse it is —
    // your warning that the next shunt is the last one.
    if (carts.damage > 0.45 && carts.body) {
      smokeAt -= dt;
      if (smokeAt <= 0) {
        smokeAt = carts.wrecked != null ? 0.06 : lerp(0.5, 0.12, (carts.damage - 0.45) / 0.55);
        const b = carts.body;
        scene.fx.burst('smoke', b.x, G.T.heightAt(b.x, b.z) + 1.0, b.z, carts.wrecked != null ? 5 : 2);
      }
    }
    const wasWrecked = carts.wrecked;
    const shore = carts.resolveSink(dt) || carts.resolveWreck();
    if (shore) {
      // the cart is gone (carts.body is null now), so the seat read below must
      // not run this frame — the walker takes over
      walker.reset(shore.x, shore.z, walker.heading);
      rig.handOff(walker.heading);
      if (wasWrecked != null) {
        const ey = G.T.heightAt(shore.x, shore.z) + 0.7;
        scene.fx.burst('fire', shore.x, ey, shore.z, 26);
        scene.fx.burst('smoke', shore.x, ey + 0.4, shore.z, 18);
        rig.kick(1.1);
        Sound.explode();
        HUD.toast('💥 The cart is a write-off. You are walking.', 'warn', 3800);
      } else {
        HUD.toast('🌊 The cart is at the bottom of the lake. You swam.', 'warn', 3600);
      }
    } else {
      // the golfer goes where the cart goes, so everything downstream — the
      // roster, the ball gate, the camera — keeps working unchanged
      const seat = carts.body.seat('driver');
      walker.x = seat.x; walker.z = seat.z; walker.heading = carts.body.heading;
      walker.speed = 0;
    }
  } else if (m === 'ride') {
    carts.clearInput();
    const seat = carts.seatFor(G.myPid, G.myPid);
    if (seat) { walker.x = seat.x; walker.z = seat.z; walker.heading = seat.heading; }
    walker.speed = 0;
  } else {
    carts.clearInput();
    Sound.cart(null);                  // the motor does not idle without you
  }

  stepAim(dt);
  stepAimButtons(dt);
  // the strike bar sweeps in real time, at a rate the lie decides
  if (swing.state === SWING.ACCURACY) {
    swing.step(dt);
    HUD.setMeter(swing.meter(), true);
  }
  updateLandingDot(now);
  walker.update(dt, cameraYaw(), G.T, G.hole);
  carts.render(dt, G.T, G.myPid, tintOf, now);
  pushMyPosition(now);
  updateAvatars(dt);

  updateCamera(dt);
  // Ball transforms depend on camera distance (they are drawn oversized so you
  // can follow them), so they have to be refreshed every frame, not only when
  // the server sends new positions.
  if (scene.holeGroup) for (const pid of Object.keys(G.balls)) {
    const b = G.balls[pid];
    scene.setBall(pid, b.x, b.y, b.z);
  }
  updateReadouts();
  refreshAimPreview();          // self-throttled; keeps the line on the aim
  if (G.room && G.hole) {
    roster.update(G.room.players, G.avatars, G.hole.pin, scene.camera, cameraYaw(), G.myPid, G.room.turnPid);
    updateWalkPrompt();
  }
  scene.update(dt);

  // the summary was deferred for a celebration — show it once that is done
  if (G.screen === 'game' && G.room?.state === 'holeover' && !celebrating() && !G.anim) route();

  drawMini(now);
  if (G.mapOpen) drawMap();
  scene.render(scene.camera);
  measureFrame(now);
}

function updateCamera(dt) {
  rig.setWorld(G.hole, G.T);        // so the rig can keep out of the canopies
  // driving gets its own framing: further back, higher, and looking well up
  // the road rather than at the back of the roof
  if (!G.anim && carts.inCart && !G.mapOpen) {
    const b = carts.driving && carts.body
      ? carts.body
      : (() => { const st = carts.seatFor(G.myPid, G.myPid); return st && { x: st.x, z: st.z, heading: st.heading, speed: 0 }; })();
    if (b) {
      rig.cart(G.T, b, G.view === 'first');
      rig.update(dt, 1.5);
      if (carts.hitFlash > 0.45) { rig.kick(carts.hitFlash * 0.5); carts.hitFlash = 0; }
      return;
    }
  }
  if (G.anim && !G.anim.done) {
    const s = G.anim.sim;
    rig.chase(G.T, s.p, s.v, G.anim.launchDir);
    rig.update(dt, 1.6);
    return;
  }
  if (G.anim && G.anim.done) {
    const s = G.anim.sim;
    const onGreen = G.T.surfaceAt(s.p.x, s.p.z).id === 'green';
    if (onGreen || G.anim.srv.holed) rig.green(G.T, G.hole, ballOf(G.anim.pid));
    else rig.chase(G.T, s.p, { x: 0, z: 0 }, G.anim.launchDir);
    rig.update(dt, 1.0);
    return;
  }

  const t = turnPlayer();
  const iAmUp = t && t.pid === G.myPid && !me()?.finished;

  // Standing at your own ball on your turn -> the shot view (first person by
  // default, because that is what you aim from).  Otherwise you are just a
  // golfer walking about, so the camera sits behind your shoulder.
  if (iAmUp && atMyBall() && G.view === 'first') {
    const b = ballOf(G.myPid);
    const putting = G.T.surfaceAt(b.x, b.z).id === 'green';
    if (putting) rig.putt(G.T, b, swing.aim, G.T.toPin(b.x, b.z));
    else rig.aim(G.T, b, swing.aim);
    rig.update(dt, 1.0);
    return;
  }

  if (G.room?.state === 'playing' && !me()?.finished) {
    rig.overShoulder(G.T, walker, swing.aim, iAmUp && atMyBall());
    rig.update(dt, 1.4);
    return;
  }

  // spectating (holed out, or between states): watch whoever is up
  const b = ballOf(t ? t.pid : G.myPid);
  const putting = G.T.surfaceAt(b.x, b.z).id === 'green';
  const aim = Math.atan2(G.hole.pin.x - b.x, G.hole.pin.z - b.z);
  if (putting) rig.putt(G.T, b, aim, G.T.toPin(b.x, b.z));
  else rig.aim(G.T, b, aim);
  rig.update(dt, 1.0);
}

/** The nudge that tells you what the game wants from you right now. */
function updateWalkPrompt() {
  const t = turnPlayer();
  const seated = carts.inCart;
  const mine = G.screen === 'game' && G.room?.state === 'playing'
    && t && t.pid === G.myPid && !G.anim && !me()?.finished;

  // The shot controls follow proximity AND the seat, not just whose turn it
  // is — walking away from your ball, or driving off in a cart, has to
  // visibly take the club out of your hands.
  const ready = !!mine && atMyBall() && !seated;
  HUD.showPlaybar(ready);
  swing.enabled = ready;

  // the cart panel, with speed and who is aboard
  if (seated) {
    const rider = carts.driving && carts.rider ? player(carts.rider)?.name : null;
    const kmh = carts.driving && carts.body ? Math.abs(carts.body.speed) * KMH : 0;
    HUD.setCart({
      seat: carts.driving ? 'Driving' : 'Riding',
      kmh,
      topKmh: TOP_SPEED_KMH,
      damage: carts.driving ? carts.damage : 0,
      who: carts.driving ? (rider ? 'with ' + rider : 'solo') : 'passenger'
    });
  } else HUD.setCart(null);

  if (seated && mine) {
    HUD.setWalkPrompt('Get out of the cart to play — press C');
    return;
  }
  if (!mine || atMyBall()) { HUD.setWalkPrompt(null); return; }
  const d = walker.distanceTo(ballOf(G.myPid));
  // Walking is a walk now, so past a certain range the honest advice is to
  // drive — which is the whole reason there is a cart on the tee.
  const far = d > 90 ? ' — take the cart (C)' : '';
  HUD.setWalkPrompt('Walk to your ball — ' + Math.round(HUD.dist(d)) + ' ' + HUD.unit() + ' away' + far);
}

/* ------------------------------------------------------------- the cart */

/** C: get in, or get out. */
function toggleCart() {
  if (G.screen !== 'game' || G.room?.state !== 'playing') return;
  if (carts.inCart) {
    const at = carts.eject(G.T);
    if (at) { walker.reset(at.x, at.z, at.heading); walker.cancelAuto(); }
    rig.handOff(walker.heading);
    HUD.toast('Out of the cart.', 'info', 1400);
    return;
  }
  const why = carts.board(G.T, G.hole, walker.x, walker.z, walker.heading, G.room.players);
  if (why === 'nowhere') return HUD.toast('No room for a cart here.', 'warn');
  if (why) return;
  if (carts.body) carts.body.boost = Math.min(1.6,
    ((G.profile?.gear?.cart || 0) >= 1 ? 1.12 : 1) * cartBoost(G.profile?.crew));
  walker.cancelAuto();
  rig.handOff(carts.body ? carts.body.heading : walker.heading);
  HUD.toast(carts.driving ? 'In the cart — W A S D to drive, C to get out'
                          : 'Along for the ride', 'good', 2200);
}

/** G: offer the nearest player a lift. */
function hailRide() {
  if (!carts.driving) return HUD.toast('You need to be driving to offer a lift.', 'warn');
  Net.hail();
}

let readoutTick = 0;
function updateReadouts() {
  if (++readoutTick % 5) return;
  if (!G.room || !G.T) return;
  const t = turnPlayer();
  const b = G.anim ? ballOf(G.anim.pid) : ballOf(t ? t.pid : G.myPid);
  const dist = G.T.toPin(b.x, b.z);
  const lie = G.T.surfaceAt(b.x, b.z);
  const elev = G.T.heightAt(G.hole.pin.x, G.hole.pin.z) - G.T.heightAt(b.x, b.z);
  HUD.setDistance(dist, lie.label, elev);
  HUD.setWind(G.wind, swing.aim);
  // Negated: in this frame (forward = sin h, cos h) the player's RIGHT is
  // reached by DECREASING the heading, so a raw difference reads backwards.
  // Positive degrees must mean "aimed right of the flag".
  HUD.setAim(-(((swing.aim - Math.atan2(G.hole.pin.x - b.x, G.hole.pin.z - b.z)) * 180 / Math.PI + 540) % 360 - 180));
  HUD.setMeter(swing.meter(), canSwing());
}

function refreshTurnUi() {
  if (!G.room) return;
  if (G.room.state !== 'playing') { HUD.showPlaybar(false); return; }
  const t = turnPlayer();
  if (G.anim) {
    const p = player(G.anim.pid);
    HUD.setTurn(`${p?.name || 'Someone'} — ball in the air`, false, p?.color);
    HUD.showPlaybar(false);
    swing.enabled = false;
    return;
  }
  if (!t) { HUD.setTurn('Waiting…', false); HUD.showPlaybar(false); swing.enabled = false; return; }

  if (t.pid === G.myPid) {
    HUD.setTurn(`Your shot — stroke ${t.strokes + 1}`, true, t.color);
    HUD.showPlaybar(true);
    swing.enabled = true;
    autoClub();
    refreshAimPreview(true);
  } else {
    HUD.setTurn(`${t.name} is away — stroke ${t.strokes + 1}`, false, t.color);
    HUD.showPlaybar(false);
    swing.enabled = false;
    scene.setAimLine(null);
  }
}

/* ===================================================================== */
/*  INPUT                                                                 */
/* ===================================================================== */
let looking = null;
const keys = new Set();

canvas.addEventListener('pointerdown', ev => {
  if (G.screen !== 'game' || G.mapOpen) return;
  canvas.setPointerCapture(ev.pointerId);
  // Hold ANY button and move the mouse to look around — walking, driving,
  // spectating, waiting on your turn.  The one exception is standing over
  // your ball, where the left button is the swing itself; the right button,
  // Alt, or SHIFT still looks even there, so you can study the hole without
  // giving up the address.
  const leftIsFree = !canSwing() || ev.shiftKey;
  if (ev.button === 2 || ev.button === 1 || ev.altKey || ev.shiftKey || (ev.button === 0 && leftIsFree)) {
    looking = { x: ev.clientX, y: ev.clientY };
    canvas.classList.add('looking');
    return;
  }
  if (!canSwing()) return;
  // the marker is already sweeping: this click IS the strike, not a new swing
  if (swing.state === SWING.ACCURACY) { strike(); return; }
  swing.pointerDown(ev.clientX, ev.clientY);
  canvas.classList.add('swinging');
});

/**
 * Stop the strike bar and play the shot.  Shared by the click and by Space,
 * because "hit it" wants to be on the key your hand is already near.
 */
/**
 * Back out of a shot.
 *
 * With the auto-equip radius shrunk, stepping away is a deliberate act rather
 * than something that happens by accident — so there has to be an equally
 * deliberate way to put the club away and go and look at the hole.  Escape,
 * the on-screen button and a touch tap all land here.
 */
function cancelShot() {
  if (G.screen !== 'game') return false;

  // Mid-swing: throw the swing away but stay over the ball.
  if (swing.state !== SWING.IDLE && swing.state !== SWING.DONE) {
    swing.cancel();
    canvas.classList.remove('swinging');
    HUD.setMeter(swing.meter(), canSwing());
    HUD.toast('Swing cancelled — line it up again.', 'info', 1400);
    return true;
  }

  /* Standing over the ball with no swing started: this is the case that did
     nothing at all, which is what "the cancel button doesn't work" means.
     Backing out has to actually back you OUT — step clear of the ball so the
     club goes away and the camera is yours again.  Stepping back down the
     target line keeps the hole in front of you. */
  if (!canSwing()) return false;
  const b = ballOf(G.myPid);
  const back = SHOT_RADIUS + 1.6;
  const x = b.x - Math.sin(swing.aim) * back;
  const z = b.z - Math.cos(swing.aim) * back;
  walker.cancelAuto();
  walker.reset(x, z, swing.aim);
  swing.cancel();
  swing.enabled = false;
  HUD.showPlaybar(false);
  HUD.setMeter(swing.meter(), false);
  HUD.toast('Stepped away — walk back in (F) when you are ready.', 'info', 2200);
  return true;
}

function strike() {
  const shot = swing.commit();
  swing.reset();
  if (!shot || !canSwing()) { HUD.setMeter(swing.meter(), canSwing()); return; }
  // call the strike the moment it leaves the face — a golfer knows
  const t = shot.timing ?? 0;
  if (t < 0.06) HUD.flash('FLUSHED', 'right out of the middle', '#8fe07a');
  else if (Math.abs(shot.faceDeg) >= 6 || shot.power > 1.08) {
    HUD.flash('MISHIT', Math.abs(shot.faceDeg) >= 6
      ? (shot.faceDeg > 0 ? 'face wide open' : 'face shut') : 'overswung', '#ff6b52');
  }
  Net.swing({
    clubKey: shot.clubKey, power: shot.power, aim: shot.aim,
    faceDeg: shot.faceDeg, attackDeg: shot.attackDeg
  });
  swing.enabled = false;
  HUD.showPlaybar(false);
  HUD.setMeter(swing.meter(), canSwing());
}

let shiftLook = null;
window.addEventListener('pointermove', ev => {
  if (looking) {
    const dx = ev.clientX - looking.x, dy = ev.clientY - looking.y;
    looking.x = ev.clientX; looking.y = ev.clientY;
    rig.orbit = rig.orbit - dx * 0.005;      // free look — all the way round
    rig.pitch = clamp(rig.pitch - dy * 0.0016, -0.25, 0.6);
    return;
  }
  // Hold SHIFT and move the mouse — no button — to look around while standing
  // still.  Gated on actually being still, so Shift+WASD stays the run key,
  // and never DURING a stroke: Shift is a habit key, and stealing the pointer
  // mid-swing would abandon the shot and spin the camera instead.
  const midSwing = swing.state !== SWING.IDLE && swing.state !== SWING.DONE;
  if (ev.shiftKey && !midSwing && G.screen === 'game' && !G.mapOpen && walker.speed < 0.2) {
    if (shiftLook) {
      const dx = ev.clientX - shiftLook.x, dy = ev.clientY - shiftLook.y;
      rig.orbit = rig.orbit - dx * 0.005;
      rig.pitch = clamp(rig.pitch - dy * 0.0016, -0.25, 0.6);
    }
    shiftLook = { x: ev.clientX, y: ev.clientY };
    return;
  }
  shiftLook = null;
  if (swing.state !== SWING.IDLE && swing.state !== SWING.DONE) {
    swing.pointerMove(ev.clientX, ev.clientY);
    HUD.setMeter(swing.meter(), true);
  }
});

window.addEventListener('pointerup', () => {
  if (looking) { looking = null; canvas.classList.remove('looking'); return; }
  canvas.classList.remove('swinging');
  // Releasing the drag locks the power and starts the strike bar; it does not
  // play the shot.  The next click does that.
  if (swing.state === SWING.BACK) swing.pointerUp();
  else if (swing.state !== SWING.ACCURACY) swing.cancel();
  HUD.setMeter(swing.meter(), canSwing());
});

canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('wheel', ev => {
  if (G.screen !== 'game') return;
  ev.preventDefault();
  // over the ball the wheel is your caddie flicking through clubs; anywhere
  // else it is a zoom, which is what every other 3D game taught your hands
  if (canSwing() && !ev.shiftKey) { stepClub(ev.deltaY > 0 ? 1 : -1); return; }
  rig.zoom = clamp(rig.zoom * (1 + ev.deltaY * 0.001), 0.55, 2.6);
}, { passive: false });

window.addEventListener('keydown', ev => {
  if (ev.target && /^(INPUT|TEXTAREA)$/.test(ev.target.tagName)) return;
  const k = ev.key.toLowerCase();
  keys.add(k);
  walker.key(k, true);
  if (G.screen !== 'game') return;

  // stop the page scrolling while someone is walking with the arrow keys
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) ev.preventDefault();

  const m = mode();
  const seated = m === 'drive' || m === 'ride';

  if (k === 'm') { toggleMap(); ev.preventDefault(); }
  if (k === 'q') stepClub(-1);
  if (k === 'e') stepClub(1);           // E stays the club: the cart toggles on C
  if (k === 'escape' && cancelShot()) return;
  if (k === 'escape') {
    if (seated) toggleCart();           // a safety valve out of the cart
    else { swing.cancel(); HUD.setMeter(swing.meter(), canSwing()); }
  }
  if (k === 'r') {
    rig.reset();
    // never touch the aim from the driving seat — you are not addressing a ball
    if (!seated) { aimAtPin(); refreshAimPreview(true); }
  }
  if (k === 'v') toggleView();
  if (canSwing()) {
    // camera presets, PGA-style: 1 behind, 2 elevated, 3 side-on, 4 first person
    if (k === '1') { rig.orbit = 0; rig.pitch = 0; rig.zoom = 1; G.view = 'third'; }
    if (k === '2') { rig.orbit = 0; rig.pitch = 0.42; rig.zoom = 1.35; G.view = 'third'; }
    if (k === '3') { rig.orbit = Math.PI / 2; rig.pitch = 0.05; rig.zoom = 1.1; G.view = 'third'; }
    if (k === '4') { G.view = 'first'; }
    // Space is the strike while the bar is sweeping — the key your hand is
    // already on — and only re-frames the camera when no shot is waiting.
    if (k === ' ') { if (swing.state === SWING.ACCURACY) strike(); else rig.reset(); }
  }
  if (k === 'c') toggleCart();
  if (k === 'g') hailRide();
  if (k === 'f') {
    if (seated) HUD.toast('Get out of the cart first.', 'warn', 1600);
    else jogToMyBall();
  }
  if (k === 'p') HUD.showPerf(!HUD.perfVisible());
});
window.addEventListener('keyup', ev => {
  const k = ev.key.toLowerCase();
  keys.delete(k);
  walker.key(k, false);
});
// a lost focus must not leave someone sprinting forever
window.addEventListener('blur', () => { keys.clear(); walker.clearKeys(); carts.clearInput(); });

/* continuous aim while a key is held */
/*
 * Aim is on the ARROW keys and only while you are standing over the ball.
 * WASD always walks, so the two never fight: away from the ball the arrows
 * walk too, and the moment you are in range they become the aim.
 */
window.addEventListener('resize', () => { scene.resize(); if (G.mapOpen) drawMap(); });

/* ------------------------------------------------------------- hole map */
/**
 * Third person for walking, first person for playing the shot.  Snapping
 * straight between them is disorienting, so the rig eases; we only flip the
 * flag here.
 */
function toggleView() {
  G.view = G.view === 'first' ? 'third' : 'first';
  HUD.toast(G.view === 'first' ? 'First person' : 'Third person', 'info', 1200);
}

/** Jog over to your own ball (F).  Any WASD input takes back control. */
function jogToMyBall() {
  if (!G.room || G.room.state !== 'playing') return;
  if (me()?.finished) { HUD.toast('Holed out — wander where you like.', 'info', 1600); return; }
  const b = ballOf(G.myPid);
  if (walker.nearBall(b)) { HUD.toast('You are already at your ball.', 'info', 1200); return; }
  const spot = addressSpot(b, swing.aim);
  walker.goTo(spot.x, spot.z, SPRINT_SPEED);   // F sprints, it does not amble
}

function toggleMap() {
  G.mapOpen = !G.mapOpen;
  HUD.el.mapwrap.hidden = !G.mapOpen;
  if (G.mapOpen) drawMap();
}
let mapBase = null, mapBaseKey = '';
function drawMap() {
  if (!G.hole || !scene.holeGroup) return;
  const c = HUD.el.mapc;
  const bd = G.hole.bounds;
  const aspect = (bd.maxX - bd.minX) / (bd.maxZ - bd.minZ);

  // Fit inside the viewport in BOTH axes — holes are often far taller than
  // wide.  Floor the size: a hidden or zero-width window would otherwise ask
  // for a 0x0 render target, which drawImage rejects.
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const vw = Math.max(innerWidth || 0, 480), vh = Math.max(innerHeight || 0, 360);
  let w = Math.min(vw * 0.88, 1000);
  let h = w / aspect;
  const maxH = vh * 0.84;
  if (h > maxH) { h = maxH; w = h * aspect; }
  w = Math.max(320, Math.round(w * dpr));
  h = Math.max(240, Math.round(h * dpr));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }

  // The terrain render is expensive (a second full scene pass at up to
  // 2000x2500, plus two drawing-buffer resizes) and the terrain never moves —
  // so render it ONCE per hole and size into an offscreen base, and per frame
  // only stamp the base and redraw the live markers on top.
  // the graphics setting changes how the terrain renders, so it belongs in the
  // key — otherwise switching quality leaves the map showing the old pass
  const baseKey = G.room?.courseId + ':' + G.hole.number + ':' + w + 'x' + h + ':' + HUD.quality;
  if (!mapBase || mapBaseKey !== baseKey) {
    // The camera must letterbox to the CANVAS aspect, not the hole-bounds
    // aspect — the size floors above can change it, and the marker overlay
    // below maps through the canvas aspect.  One mapping, or dots drift.
    fitMapCamera(scene.mapCamera, G.hole, w / h);

    // Fog is tuned for eye level; from 600 m up it would grey the whole hole
    // out.  Everything here mutates shared scene state, so it MUST be unwound
    // even if the render throws — otherwise the course stays fogless for the
    // rest of the round.
    const prev = scene.renderer.getSize(new THREE.Vector2());
    const fog = scene.scene.fog;
    const bg = scene.scene.background;
    try {
      scene.scene.fog = null;
      scene.scene.background = new THREE.Color(0x0d1512);
      scene.renderer.setSize(w, h, false);
      scene.render(scene.mapCamera);
      mapBase = document.createElement('canvas');
      mapBase.width = w; mapBase.height = h;
      mapBase.getContext('2d').drawImage(scene.renderer.domElement, 0, 0, w, h);
      mapBaseKey = baseKey;
    } finally {
      scene.scene.fog = fog;
      scene.scene.background = bg;
      scene.renderer.setSize(prev.x, prev.y, false);
      scene.resize();
    }
  }
  c.getContext('2d').drawImage(mapBase, 0, 0);

  // Live markers over the render: every ball, the flag, the wind, a scale.
  // The ortho camera letterboxes to the canvas aspect, so recompute the same
  // expanded extents fitMapCamera used or everything lands offset.
  const ctx = c.getContext('2d');
  const cx2 = (bd.minX + bd.maxX) / 2, cz2 = (bd.minZ + bd.maxZ) / 2;
  let hw = (bd.maxX - bd.minX) * 0.51, hh = (bd.maxZ - bd.minZ) * 0.51;
  const casp = w / h;
  if (hw / hh < casp) hw = hh * casp; else hh = hw / casp;
  const mx = x => (x - (cx2 - hw)) / (hw * 2) * w;
  const mz = z => ((cz2 + hh) - z) / (hh * 2) * h;

  // the flag: a proper red pennant at the pin
  const fx = mx(G.hole.pin.x), fz = mz(G.hole.pin.z);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * dpr;
  ctx.beginPath(); ctx.moveTo(fx, fz); ctx.lineTo(fx, fz - 16 * dpr); ctx.stroke();
  ctx.fillStyle = '#ff5347';
  ctx.beginPath(); ctx.moveTo(fx, fz - 16 * dpr);
  ctx.lineTo(fx + 11 * dpr, fz - 12.5 * dpr); ctx.lineTo(fx, fz - 9 * dpr);
  ctx.closePath(); ctx.fill();

  // every ball in play, mine ringed
  if (G.room) for (const p of G.room.players) {
    if (p.spectator) continue;
    const bl = G.balls[p.pid] || p;
    ctx.beginPath();
    ctx.arc(mx(bl.x), mz(bl.z), (p.pid === G.myPid ? 6 : 4.5) * dpr, 0, Math.PI * 2);
    ctx.fillStyle = p.color; ctx.fill();
    ctx.strokeStyle = p.pid === G.myPid ? '#fff' : 'rgba(0,0,0,.5)';
    ctx.lineWidth = 1.6 * dpr; ctx.stroke();
  }

  // wind arrow, top-left of the map
  ctx.save();
  ctx.translate(34 * dpr, 34 * dpr);
  ctx.rotate(G.wind.dir + Math.PI);
  ctx.fillStyle = G.wind.speed < 3.5 ? '#8fe07a' : G.wind.speed < 8 ? '#ffd76b' : '#ff7a5c';
  ctx.beginPath(); ctx.moveTo(0, -14 * dpr); ctx.lineTo(8 * dpr, 10 * dpr);
  ctx.lineTo(0, 4 * dpr); ctx.lineTo(-8 * dpr, 10 * dpr); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#e8f2ea'; ctx.font = 700 + ' ' + 11 * dpr + 'px system-ui';
  ctx.fillText(Math.round(G.wind.speed * 2.237) + ' mph', 20 * dpr, 58 * dpr);

  // a scale bar: how long 100 m is on this map
  const px100 = 100 / (hw * 2) * w;
  ctx.strokeStyle = '#e8f2ea'; ctx.lineWidth = 2 * dpr;
  ctx.beginPath(); ctx.moveTo(20 * dpr, h - 20 * dpr); ctx.lineTo(20 * dpr + px100, h - 20 * dpr); ctx.stroke();
  ctx.fillText('100 m', 20 * dpr, h - 28 * dpr);
}

/* ===================================================================== */
/*  MINIMAP — the hole at a glance, always on                             */
/* ===================================================================== */
let miniAt = 0;
function drawMini(now) {
  if (G.screen !== 'game' || !G.hole) { HUD.el.miniPanel.style.display = 'none'; return; }
  HUD.el.miniPanel.style.display = '';
  if (now - miniAt < 250) return;           // 4 Hz is plenty for a map
  miniAt = now;

  const h = G.hole, b = h.bounds;
  const spanX = b.maxX - b.minX, spanZ = b.maxZ - b.minZ;
  const W = 132, H = Math.round(W * spanZ / spanX);
  const c = HUD.el.minic;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  // W is a constant, so the height must be checked too — each hole has its
  // own aspect, and a stale backing-store height squashes every later hole
  if (c.width !== W * dpr || c.height !== H * dpr) { c.width = W * dpr; c.height = H * dpr; }
  c.style.height = H + 'px';
  const x2 = x => (x - b.minX) / spanX * W * dpr;
  // flip z so up the canvas is up the hole (tee at the bottom)
  const z2 = z => (b.maxZ - z) / spanZ * H * dpr;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#11241a';
  ctx.fillRect(0, 0, c.width, c.height);

  // the fairway ribbon, straight off the route
  const fw = h.fairwayWidth / spanX * W * dpr;
  for (const [width, col] of [[fw + h.roughWidth * 0.9 / spanX * W * dpr, '#1a3624'], [fw, '#2e6b38']]) {
    ctx.beginPath();
    for (let i = 0; i < h.route.length; i += 2) {
      const q = h.route[i];
      i === 0 ? ctx.moveTo(x2(q[0]), z2(q[1])) : ctx.lineTo(x2(q[0]), z2(q[1]));
    }
    ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = col; ctx.stroke();
  }

  const ell = (e, fill) => {
    ctx.beginPath();
    ctx.ellipse(x2(e.x), z2(e.z), (e.rx || e.r) / spanX * W * dpr, (e.rz || e.r) / spanZ * H * dpr, -(e.rot || 0), 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
  };
  for (const w of h.waters) ell(w, '#1d5c7a');
  for (const s2 of h.bunkers) ell(s2, '#c9b177');
  ell(h.green, '#3f9a4d');

  // trees: the hazard the aim line cares about most
  ctx.fillStyle = 'rgba(16,48,24,0.9)';
  for (const t of h.trees) {
    const r = Math.max(1.2, t.r / spanX * W * dpr * 0.8);
    ctx.beginPath(); ctx.arc(x2(t.x), z2(t.z), r, 0, Math.PI * 2); ctx.fill();
  }

  // my aim line out to where the preview says the ball finishes
  const meBall = G.balls[G.myPid];
  if (meBall && G.lastPreviewEnd && canSwing()) {
    ctx.beginPath();
    ctx.moveTo(x2(meBall.x), z2(meBall.z));
    ctx.lineTo(x2(G.lastPreviewEnd.x), z2(G.lastPreviewEnd.z));
    ctx.lineWidth = 1.4 * dpr; ctx.setLineDash([4 * dpr, 3 * dpr]);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(x2(G.lastPreviewEnd.x), z2(G.lastPreviewEnd.z), 2.6 * dpr, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2 * dpr; ctx.stroke();
  }

  // everyone's ball, mine ringed
  if (G.room) for (const p of G.room.players) {
    if (p.spectator) continue;
    const bl = G.balls[p.pid] || p;
    ctx.beginPath();
    ctx.arc(x2(bl.x), z2(bl.z), (p.pid === G.myPid ? 3.2 : 2.4) * dpr, 0, Math.PI * 2);
    ctx.fillStyle = p.color; ctx.fill();
    if (p.pid === G.myPid) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.3 * dpr; ctx.stroke(); }
  }

  // the pin
  ctx.beginPath();
  ctx.arc(x2(h.pin.x), z2(h.pin.z), 2.2 * dpr, 0, Math.PI * 2);
  ctx.fillStyle = '#ff5347'; ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = dpr; ctx.stroke();
}

/* ===================================================================== */
/*  NETWORK                                                               */
/* ===================================================================== */
Net.on('state', s => {
  const prev = G.room;
  G.room = s;
  G.myPid = Net.pid;
  G.wind = s.wind || G.wind;

  if (s.state !== 'lobby') ensureHole(s.courseId, s.holeIndex);
  else if (!G.loadedKey) { /* lobby: nothing loaded yet, that's fine */ }

  if (G.T) {
    for (const p of s.players) {
      // never snap a ball whose shot is mid-animation OR still waiting its
      // turn in the replay queue — snapping a queued player's ball teleports
      // it to its final lie before their shot has even played on this screen
      if (G.anim && G.anim.pid === p.pid) continue;
      if (G.queue.some(q => q.pid === p.pid)) continue;
      const cur = G.balls[p.pid];
      if (!cur || Math.hypot(cur.x - p.x, cur.z - p.z) > 0.05) {
        G.balls[p.pid] = { x: p.x, y: G.T.heightAt(p.x, p.z) + BALL_RADIUS, z: p.z };
      }
    }
    for (const pid of Object.keys(G.balls)) if (!s.players.some(p => p.pid === pid)) delete G.balls[pid];
    if (scene.holeGroup) {
      scene.syncBalls(s.players);
      for (const p of s.players) { const b = G.balls[p.pid]; if (b) scene.setBall(p.pid, b.x, b.y, b.z); }
    }
    HUD.renderBoard(s, G.myPid, G.course);
  }

  syncAvatars(s.players);

  // whenever the server moves our golfer (new hole, or straight after our own
  // shot) the walker has to follow, or we would be walking a ghost
  const mine = me();
  if (mine && G.T) {
    const srvX = mine.ax ?? mine.x, srvZ = mine.az ?? mine.z;
    const drifted = Math.hypot(walker.x - srvX, walker.z - srvZ);
    if (G.walkerHole !== G.loadedKey || drifted > 45) {
      const aimAt = Math.atan2(G.hole.pin.x - srvX, G.hole.pin.z - srvZ);
      const spot = addressSpot({ x: srvX, z: srvZ }, aimAt);
      walker.reset(spot.x, spot.z, aimAt);
      G.walkerHole = G.loadedKey;
    }
  }
  // keep other players' interpolation targets fresh from the authoritative list
  for (const pl of s.players) {
    if (pl.pid === G.myPid) continue;
    const r = G.remote.get(pl.pid);
    if (r && pl.ax != null) { r.tx = pl.ax; r.tz = pl.az; r.trot = pl.arot ?? r.trot; }
  }

  const becamePlaying = prev?.state !== 'playing' && s.state === 'playing';
  if (becamePlaying) {
    // the round may reuse the very hole the title screen built, in which case
    // ensureHole never ran — the stand-in golfer still has to leave the tee
    clearMenuBackdrop();
    clubManual = false; autoClub(); aimAtPin(); rig.reset(); rig.snap();
    G.view = 'third';
  }

  refreshTurnUi();
  route();
});

Net.on('started', () => HUD.toast('Play away.', 'good', 2200));

Net.on('hole', () => {
  G.anim = null; G.queue.length = 0;
  HUD.show(null);
});

Net.on('shot', msg => {
  if (G.anim?.seq === msg.seq) return;
  if (G.queue.some(q => q.seq === msg.seq)) return;
  G.queue.push(msg);
  pumpQueue();
  refreshTurnUi();
});

Net.on('reset', () => {
  G.anim = null; G.queue.length = 0;
  HUD.toast('Fresh card — back to the first tee.', 'good', 2400);
});

/** Somebody else moved.  Store it as a target; the frame loop eases toward it. */
Net.on('pos', d => {
  if (!d || d.pid === G.myPid) return;
  // A spectator has no golfer on the course, so they get no cart either —
  // otherwise a mid-round joiner could parade an EMPTY cart around the hole.
  const sender = player(d.pid);
  if (!sender || sender.spectator) return;
  carts.feed(d.pid, d.cart, performance.now());
  const r = G.remote.get(d.pid);
  if (!r) return;
  r.tx = d.x; r.tz = d.z; r.trot = d.rot; r.moving = !!d.moving;
});

Net.on('profile', prof => {
  const before = G.profile;
  G.profile = prof;
  renderClubhouse();
  previewKey = '';                     // gear may have changed the flight
  if (G.room?.state === 'lobby') renderLobbyAll(G.room);
  // the post-round payout, announced once the results are up
  if (before && prof.coins > before.coins) {
    HUD.toast(`🪙 +${prof.coins - before.coins} coins · rating ${prof.rating}`, 'good', 4200);
  }
});

Net.on('toast', d => HUD.toast(d.msg, d.kind));
Net.on('kicked', d => { G.joined = false; G.room = null; route(); HUD.homeError(d.reason || 'Disconnected.'); });
Net.on('disconnect', () => HUD.toast('Lost the connection — reconnecting…', 'warn', 2200));

/* ===================================================================== */
/*  ROUTING                                                               */
/* ===================================================================== */
function route() {
  const r = G.room;
  // the touch pad belongs to a live round, never over a menu
  const inPlay = !!r && r.state === 'playing';
  HUD.showTouchPad(inPlay);
  /* The portal schedules its ads around these, so they have to mean actual
     play: not the title screen, not the clubhouse, not the hole summary. */
  if (inPlay) gameplayStart(); else gameplayStop();
  if (!G.joined || !r) {
    G.screen = 'home'; HUD.show('home');
    menuBackdrop();                  // back out of a room: the tee returns
    return;
  }
  if (r.state === 'lobby') {
    G.screen = 'lobby';
    HUD.show('lobby');
    renderLobbyAll(r);
    return;
  }
  // Joining mid-summary: the join ack routes before any state broadcast has
  // run ensureHole(), so the course may not be loaded yet.  Both summary
  // screens dereference it; hold the loading screen for the moment it takes
  // the first broadcast to arrive and route again.
  if ((r.state === 'results' || r.state === 'holeover') && !G.course) {
    G.screen = 'load'; HUD.show('load'); return;
  }
  if (r.state === 'results') { G.screen = 'results'; HUD.show('results'); HUD.renderResults(r, G.myPid, G.course); return; }
  if (r.state === 'holeover') {
    // Do not drop the black summary over a celebration that is still running.
    // The server holds the hole open for 20 s on its own timer, so a couple of
    // seconds here costs nothing and is purely local.
    if (celebrating() || G.anim) { G.screen = 'game'; HUD.show(null); return; }
    G.screen = 'holeover'; HUD.show('holeover'); HUD.renderHoleOver(r, G.myPid, G.course); return;
  }
  G.screen = 'game';
  HUD.show(null);
}

/* ===================================================================== */
/*  LOBBY: course, tees, ball colour, your fourteen clubs                 */
/* ===================================================================== */
let bagDraft = null;
let lookDraft = null;

/**
 * Redraw the appearance swatches and push the change straight out.
 *
 * This lives on the FRONT PAGE, not inside a room: your golfer is who you
 * are, not a setting for one game.  A change applies immediately — to the
 * server if you are in a round, and to the local draft either way, so the
 * next room you join already has it.
 */
function drawLookPicker() {
  HUD.renderLook(lookDraft, (key, hex) => {
    lookDraft = normaliseLook({ ...lookDraft, [key]: hex });
    drawLookPicker();
    saveLook(lookDraft);
    refreshMenuAvatar();             // the golfer on the tee changes NOW
    if (G.joined) Net.setLook(lookDraft);
  });
}

const LOOK_KEY = 'golf.look';
const saveLook = look => { try { localStorage.setItem(LOOK_KEY, JSON.stringify(look)); } catch { /* private mode */ } };
const loadLook = () => {
  try { return normaliseLook(JSON.parse(localStorage.getItem(LOOK_KEY) || 'null')); }
  catch { return normaliseLook(null); }
};

/** The clubhouse: career, pro shop and the bag, all outside any room. */
function renderClubhouse() {
  const prof = G.profile;
  HUD.renderCareer(prof);
  HUD.renderShop(prof, item => Net.buy(item));
  bagDraft = me()?.bag?.length ? me().bag.slice()
    : (bagDraft || normaliseBag(DEFAULT_BAG, { pad: true }));
  HUD.renderBag(bagDraft, toggleClubInBag);
  HUD.setHomeCoins(prof?.coins ?? 0);
  HUD.setCoins(prof?.coins ?? 0);
  /* Back the career up where the PLAYER's platform keeps it.
     The server is the source of truth while it is running, but its profile
     file lives on an ephemeral disk — a free-tier host wipes it on every
     deploy and restart, which would silently reset everyone's coins and
     crew.  A snapshot in the Data module survives that, and the server only
     ever uses it to seed a profile it has never seen. */
  if (prof) {
    try {
      storeSet('lg_save', JSON.stringify({
        v: 1, coins: prof.coins, rating: prof.rating, crew: prof.crew,
        gear: prof.gear, clubTier: prof.clubTier, refine: prof.refine,
        stars: prof.stars, rounds: prof.rounds, best: prof.best
      }));
    } catch { /* over quota or no store: the server still has it */ }
  }
}

function renderLobbyAll(r) {
  const isHost = r.hostPid === G.myPid;
  const course = getCourse(r.courseId);
  HUD.renderLobby(r, G.myPid);
  HUD.renderCourses(COURSES, r.courseId, isHost, id => Net.pickCourse(id));
  HUD.renderTees(course.holes[0], r.teeSet || 'back', isHost, t => Net.pickTees(t));
  HUD.renderColours(r, G.myPid, hex => Net.prefs({ color: hex }), G.profile?.rating || 0);
  bagDraft = me()?.bag?.length ? me().bag.slice() : normaliseBag(DEFAULT_BAG, { pad: true });
  // the room owns the round; the golfer came with us, so push what we already
  // chose on the front page rather than reading it back off the server
  if (lookDraft) Net.setLook(lookDraft);
}

/** Swap a club in or out. Fourteen is the legal maximum, so adding a
 *  fifteenth is refused rather than silently dropping something. */
function toggleClubInBag(key) {
  const set = new Set(bagDraft);
  if (set.has(key)) {
    if (set.size <= 2) return;                 // never leave them with just a putter
    set.delete(key);
  } else {
    if (set.size >= BAG_SIZE) {
      HUD.toast('You can only carry ' + BAG_SIZE + ' clubs — take one out first.', 'warn');
      return;
    }
    set.add(key);
  }
  bagDraft = normaliseBag([...set]);   // optimistic; the server echo confirms it
  HUD.renderBag(bagDraft, toggleClubInBag);
  Net.prefs({ bag: bagDraft });
}

document.getElementById('btnBagReset').addEventListener('click', () => {
  bagDraft = normaliseBag(DEFAULT_BAG, { pad: true });
  HUD.renderBag(bagDraft, toggleClubInBag);
  Net.prefs({ bag: bagDraft });
});

HUD.el.boardRoom.addEventListener('click', copyLink);

/* Mark the document the first time a real finger lands, so the touch controls
   appear for devices whose pointer the browser reports as "fine" — plenty of
   tablets and touchscreen laptops do — without ever showing them to a mouse. */
window.addEventListener('touchstart', function once() {
  document.documentElement.classList.add('touch');
  window.removeEventListener('touchstart', once);
}, { passive: true, once: true });

/* The touch pad.  These call exactly the same functions the keys do, so there
   is one implementation of each action and no second code path to drift. */
/* Collapsible HUD panels — a player tidying their own screen.  The state is
   remembered, because someone who folds the scorecard away wants it folded
   away next hole too, not every hole. */
for (const [btnId, panelId, key] of [
  ['boardCollapse', 'board', 'lg_fold_board'],
  ['rosterCollapse', 'rosterPanel', 'lg_fold_roster']
]) {
  const btn = document.getElementById(btnId);
  const panel = document.getElementById(panelId);
  if (!btn || !panel) continue;
  let folded = false;
  try { folded = localStorage.getItem(key) === '1'; } catch { /* private mode */ }
  const apply = () => {
    panel.classList.toggle('collapsed', folded);
    btn.setAttribute('aria-expanded', String(!folded));
    btn.title = folded ? 'Expand' : 'Collapse';
  };
  apply();
  btn.addEventListener('click', ev => {
    ev.stopPropagation();                 // the header is also the copy button
    folded = !folded;
    try { localStorage.setItem(key, folded ? '1' : '0'); } catch { /* ignore */ }
    apply();
  });
}

/* Leaving a round.  Two taps, because a mis-click that dumps you out of a
   hole you are six shots into would be worse than no button at all.  Your
   coins are already banked hole by hole, so nothing earned is lost. */
const quitBtn = document.getElementById('btnQuitRound');
if (quitBtn) {
  let armed = 0;
  quitBtn.addEventListener('click', () => {
    const now = Date.now();
    if (now - armed > 3000) {
      armed = now;
      quitBtn.classList.add('confirm');
      quitBtn.textContent = 'Leave — tap again';
      HUD.toast('Coins from finished holes are already saved.', 'info', 2600);
      setTimeout(() => {
        quitBtn.classList.remove('confirm');
        quitBtn.textContent = '✕ Leave';
      }, 3000);
      return;
    }
    Net.leave?.();
    G.joined = false; G.room = null; G.anim = null; G.queue.length = 0;
    carts.clear();
    quitBtn.classList.remove('confirm');
    quitBtn.textContent = '✕ Leave';
    stampRoomUrl('');
    route();
  });
}

document.getElementById('btnCancelShot')?.addEventListener('click', ev => {
  ev.preventDefault(); cancelShot();
});

for (const [id, fn] of [
  ['tbBall', () => { if (carts.inCart) HUD.toast('Get out of the cart first.', 'warn', 1600); else jogToMyBall(); }],
  ['tbCart', () => toggleCart()],
  ['tbView', () => toggleView()],
  ['tbMap',  () => toggleMap()]
]) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', ev => { ev.preventDefault(); fn(); });
}

HUD.el.optQuality.value = HUD.quality;
scene.setQuality(HUD.quality);

/* Losing the GPU context is the browser equivalent of a crash: every buffer
   goes invalid at once.  Say what happened rather than leaving a frozen
   picture, and rebuild the hole when it comes back — the course is generated
   from a seed, so there is nothing to lose. */
scene.onContextLost = () => HUD.toast('Graphics context lost — recovering…', 'warn', 6000);
scene.onContextRestored = () => {
  const key = G.loadedKey;
  G.loadedKey = null;                        // force a full rebuild
  if (key && G.room) {
    const i = key.lastIndexOf(':');
    ensureHole(key.slice(0, i), Number(key.slice(i + 1)));
    syncAvatars(G.room.players || []);
  }
  scene.setQuality(HUD.quality);
  HUD.toast('Graphics restored.', 'good', 2400);
};

HUD.el.optQuality.addEventListener('change', e => {
  HUD.setQuality(e.target.value);
  scene.setQuality(HUD.quality);
  HUD.toast(HUD.quality === 'quality' ? 'Sun shadows on' : 'Performance mode — blob shadows', 'info', 1600);
});

const sndBox = document.getElementById('optSound');
sndBox.checked = !Sound.muted();
sndBox.addEventListener('change', e => Sound.setMuted(!e.target.checked));
HUD.el.optMetres.checked = HUD.metric;
HUD.el.optMetres.addEventListener('change', e => {
  HUD.setMetric(e.target.checked);
  if (G.room) renderLobbyAll(G.room);
  if (G.course && G.hole) HUD.setHole(G.course, G.hole, G.room?.teeSet || 'back');
});

/* ===================================================================== */
/*  BUTTONS                                                               */
/* ===================================================================== */
const nameValue = () => {
  const v = (HUD.el.inpName.value || '').trim();
  try { localStorage.setItem('lg_name', v); } catch { /* ignore */ }
  return v || 'Golfer';
};

/**
 * Rewrite the address bar with the room code, so a refresh comes back to the
 * same game and the link is shareable.  Wrapped because a sandboxed iframe —
 * which is how a game portal embeds this — throws on history writes from a
 * different origin, and losing a cosmetic URL must never cost the round.
 */
function stampRoomUrl(code) {
  try { history.replaceState(null, '', code ? '/?room=' + code : '/'); } catch { /* embedded */ }
}

/**
 * Play now: straight to the first tee, alone.
 *
 * Somebody arriving from a game portal has no friends here and no room code,
 * and a lobby is a wall in front of the thing they came to do.  This makes
 * the room and starts the round in one click; hosting and joining are still
 * there for people who actually want company.
 */
document.getElementById('btnPlay').addEventListener('click', () => {
  HUD.homeError('');
  const btn = document.getElementById('btnPlay');
  btn.disabled = true;                       // a double click must not make two rooms
  HUD.show('load');
  HUD.loading('Walking to the first tee…');
  Net.create(nameValue(), pickedCourse, res => {
    btn.disabled = false;
    if (!res.ok) { HUD.show('home'); return HUD.homeError(res.error); }
    G.joined = true; G.myPid = res.pid; G.room = res.state;
    stampRoomUrl(res.code);
    Net.start();                             // no lobby: tee off
    route();
  });
});

document.getElementById('btnCreate').addEventListener('click', () => {
  HUD.homeError('');
  Net.create(nameValue(), pickedCourse, res => {
    if (!res.ok) return HUD.homeError(res.error);
    G.joined = true; G.myPid = res.pid; G.room = res.state;
    stampRoomUrl(res.code);
    route();
  });
});
document.getElementById('btnJoin').addEventListener('click', () => {
  HUD.homeError('');
  const code = (HUD.el.inpCode.value || '').trim().toUpperCase();
  if (code.length < 4) return HUD.homeError('Enter the 4-character room code.');
  Net.join(code, nameValue(), res => {
    if (!res.ok) return HUD.homeError(res.error);
    G.joined = true; G.myPid = res.pid; G.room = res.state;
    stampRoomUrl(res.code);
    route();
    if (res.spectator) HUD.toast("Round in progress — you're in at the next hole.", 'warn', 3400);
  });
});
HUD.el.inpCode.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('btnJoin').click(); });
HUD.el.inpName.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  ((HUD.el.inpCode.value || '').trim().length >= 4 ? document.getElementById('btnJoin') : document.getElementById('btnCreate')).click();
});
/**
 * Copy the invite link.  Bound to the lobby button AND the room code on the
 * in-game scorecard, so you can still pull somebody in after you have teed
 * off — the server lets a late joiner watch until the next hole.
 */
async function copyLink() {
  const link = G.room ? HUD.inviteLink(G.room.code) : HUD.el.lobbyLink.value;
  try { await navigator.clipboard.writeText(link); }
  catch { HUD.el.lobbyLink.select(); document.execCommand('copy'); }
  HUD.toast(HUD.linkIsLocal()
    ? 'Link copied — but it only works on your network. Run  npm run share  for a public one.'
    : 'Invite link copied.', 'good', 3400);
  const btn = document.getElementById('btnCopy');
  if (btn) {
    btn.classList.add('copied');
    const was = btn.textContent;
    btn.textContent = 'Copied ✓';
    setTimeout(() => { btn.classList.remove('copied'); btn.textContent = was; }, 1800);
  }
}
document.getElementById('btnCopy').addEventListener('click', copyLink);
document.getElementById('btnStart').addEventListener('click', () => Net.start());
document.getElementById('btnLeave').addEventListener('click', () => { location.href = '/'; });
document.getElementById('btnNext').addEventListener('click', () => Net.next());
document.getElementById('btnAgain').addEventListener('click', () => Net.again());
document.getElementById('btnBackLobby').addEventListener('click', () => Net.lobby());
document.getElementById('clubUp').addEventListener('click', () => stepClub(1));
document.getElementById('clubDown').addEventListener('click', () => stepClub(-1));
// left is +heading in this frame (see stepAim), and both buttons repeat on hold
holdAim(document.getElementById('aimL'), 1);
holdAim(document.getElementById('aimR'), -1);
document.getElementById('mapwrap').addEventListener('click', () => toggleMap());

/* ===================================================================== */
/*  BOOT                                                                  */
/* ===================================================================== */
(async function boot() {
  const q = new URLSearchParams(location.search);
  /* On the portal the address bar belongs to CrazyGames, so a ?room= link
     never reaches us — their invite parameters are the supported channel. */
  const room = invitedRoom()
    || (q.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  if (room) HUD.el.inpCode.value = room;
  // Returning players are recognised, not interrogated: the same browser
  // key that pins your career also pins your name, so the front door says
  // hello instead of asking who you are.  "Change" brings the field back.
  try { const n = localStorage.getItem('lg_name'); if (n) HUD.el.inpName.value = n; } catch { /* ignore */ }
  const chip = document.getElementById('identityChip');
  const nameField = document.getElementById('nameField');
  const known = (HUD.el.inpName.value || '').trim();
  if (known) {
    chip.hidden = false;
    nameField.hidden = true;
    document.getElementById('idName').textContent = known;
  }
  document.getElementById('btnNotYou').addEventListener('click', () => {
    chip.hidden = true;
    nameField.hidden = false;
    HUD.el.inpName.select();
    // a new name deserves a fresh career, so re-key the browser identity
    try { localStorage.removeItem('lg_pid'); } catch { /* ignore */ }
  });
  (HUD.el.inpName.value ? HUD.el.inpCode : HUD.el.inpName).focus();

  // Your golfer, restored from the last visit and editable right here on the
  // front page — no room required, and a change shows up immediately.
  lookDraft = loadLook();
  drawLookPicker();
  renderClubhouse();

  /* The course strip.  Choosing one rebuilds the title-screen backdrop, so
     the picture behind the menu IS the course you are about to play. */
  const drawCourses = () => {
    const row = document.getElementById('homeCourses');
    if (!row) return;
    row.innerHTML = '';
    for (const c of COURSES) {
      const b = document.createElement('button');
      b.className = 'cpbtn' + (c.id === pickedCourse ? ' on' : '');
      b.textContent = c.name;
      const sub = document.createElement('small');
      sub.textContent = `${c.region} · par ${c.par}`;
      b.appendChild(sub);
      b.addEventListener('click', () => {
        if (c.id === pickedCourse) return;
        pickedCourse = c.id;
        try { localStorage.setItem('lg_course', c.id); } catch { /* ignore */ }
        drawCourses();
        clearMenuBackdrop();     // drop the old tee...
        G.loadedKey = null;
        menuBackdrop();          // ...and stand on the new one
      });
      row.appendChild(b);
    }
  };
  drawCourses();

  // the dice: a whole outfit in one press, for people who hate picking
  document.getElementById('btnRandomLook')?.addEventListener('click', () => {
    const pick = arr => arr[(Math.random() * arr.length) | 0].hex;
    lookDraft = normaliseLook({ cap: pick(CAPS), shirt: pick(SHIRTS), skin: pick(SKINS), trousers: pick(TROUSERS) });
    saveLook(lookDraft);
    drawLookPicker();
    refreshMenuAvatar();
    if (G.joined) Net.setLook(lookDraft);
  });

  // The title screen is the course itself — unless this visit is an invite
  // link, which goes straight to its own room and will build its own hole.
  if (!room) menuBackdrop();

  // the clubhouse: career, pro shop and bag, reachable without hosting a game
  HUD.el.btnClubhouse.addEventListener('click', () => {
    renderClubhouse();
    G.screen = 'shop';
    HUD.show('shop');
  });
  HUD.el.btnShopBack.addEventListener('click', () => route());

  HUD.show('home');
  scene.resize();

  /* Bring the portal up before we connect, so the Data module is ready when
     net.js asks it for our player id.  It always resolves — off-portal this
     is a no-op and the game plays exactly as it does now. */
  await initCG({
    onMute: muted => Sound.setPlatformMute(muted)
  });
  if (CG.muted) Sound.setPlatformMute(true);
  loadingStop();                    // the download is done; gameplay may start

  Net.restoreFrom = () => { try { return storeGet('lg_save'); } catch { return null; } };
  /* If the game server cannot be reached the page must SAY so.  Silently
     sitting on a dead menu is the worst outcome, and on a portal it is also
     the most likely one — a static bundle depends on the backend being awake
     (a free-tier host sleeps when idle and takes ~30 s to come back). */
  let wakeTries = 0;
  Net.on('offline', () => {
    /* Almost always a sleeping host rather than a dead one: a free-tier
       instance takes about half a minute to cold-start, so the FIRST attempt
       failing is expected, not exceptional.  Say so, keep a visible count so
       the wait reads as progress rather than a hung menu, and never stop
       retrying — the player has nothing else to do here. */
    wakeTries++;
    HUD.homeError(wakeTries < 12
      ? `Waking the game server up… this takes about half a minute on a cold start. (attempt ${wakeTries})`
      : 'Still cannot reach the game server. It may be down — this page will keep trying.');
    setTimeout(() => Net.connect(), Math.min(3000 + wakeTries * 1000, 10000));
  });
  Net.on('connect', () => { wakeTries = 0; HUD.homeError(''); });
  await Net.connect();
  requestAnimationFrame(frame);

  /* Once this is published, the only bugs that matter happen on hardware I
     will never see.  Report the first few of a session — capped here as well
     as on the server, so a repeating fault cannot turn a player's browser
     into a flood.  Never fires locally, and carries nothing personal. */
  let reported = 0;
  const report = (msg, where) => {
    if (reported >= 3 || location.hostname === 'localhost') return;
    reported++;
    try {
      fetch('/clienterror', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg: String(msg).slice(0, 300), where: String(where || '').slice(0, 120) }),
        keepalive: true
      }).catch(() => {});
    } catch { /* never let reporting an error throw one */ }
  };
  window.addEventListener('error', e => report(e.message, (e.filename || '') + ':' + (e.lineno || '')));
  window.addEventListener('unhandledrejection', e => report(e.reason?.message || e.reason, 'promise'));

  window.__G = G; window.__scene = scene; window.__rig = rig; window.__swing = swing;
  window.__frame = frame;        // lets a headless harness drive frames itself
  window.__walker = walker;
  window.__carts = carts;
  window.__ready = true;
})();
