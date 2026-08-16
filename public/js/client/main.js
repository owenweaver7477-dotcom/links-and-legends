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
import { EMOTES, MELEES, meleesAt, meleeById } from './celebrations.js';
import { UNLOCKS, unlockedBetween, nextUnlock, UNLOCK_KINDS } from '../shared/unlocks.js';
import { SwingController, SWING, setForgiveness, setMarkBand } from './swing.js';
import { HUD } from './hud.js';
import { playIntro3D } from './intro3d.js';
import { wearOutfit, normaliseCustom, outfitEffect } from '../shared/wardrobe.js';
import { weatherText, weatherEffects } from '../shared/weather.js';
import { tickHolo } from './decals.js';
import { isAct, actionFor, keysFor, resetBinds } from './binds.js';
import { Net } from './net.js';
import { initCG, loadingStart, loadingStop, gameplayStart, gameplayStop,
         happytime, inviteLink, invitedRoom, storeGet, storeSet, CG } from './crazygames.js';

// The portal measures the download between here and the first gameplay
// start, so this is the first thing the module does.
loadingStart();
import { Sound } from './sound.js';
import { aidsFor, DEFAULT_DIFFICULTY } from '../shared/difficulty.js';
import { showShot, hide as hideShotCard } from './shotcard.js';
import { bindRadial, radialOpen, closeRadial } from './radial.js';

import { allCourses, getCourse, defaultAim, aimPlan } from '../shared/coursegen.js';
import { ratingsFor } from '../shared/handicap.js';
import { FORMATS, formatById, isScramble, TEAM_NAMES } from '../shared/scramble.js';
import { terrainFor, SURFACES } from '../shared/terrain.js';
import { BIOMES, COURSE_ORDER, coursesByRegion, regionOf, REGIONS, biomeFor, courseMeta } from '../shared/biomes.js';
import { ShotSim, calibrateCarries, suggestedPower, BALL_RADIUS } from '../shared/ballistics.js';
import { CLUBS, CLUB_BY_KEY, CARRY, suggestClub, clubIndex, normaliseBag, DEFAULT_BAG, BAG_SIZE } from '../shared/clubs.js';
import { toYards, clamp, lerp } from '../shared/rng.js';
import { normaliseLook, randomLook, SHOT_RADIUS, EYE_HEIGHT, SPRINT_SPEED,
         ballDashSpeed } from '../shared/avatars.js';

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
  if (G.loadedKey === key) {
    /* The GEOMETRY is already built — but that is not the same as the HUD
       being right, and the early return used to skip both.
       The title screen renders the first tee of whatever course you have
       picked, and it sets loadedKey when it does. So pressing Play now on
       that course arrives here with the key already matching, the function
       returns, and HUD.setHole never runs: the card keeps whatever hole it
       last showed. Pick Palmera Cay from the menu and you tee off on Palmera
       Cay while the card says Claude National, 541 yards, on a 420-yard
       hole. Everything underneath was correct; only the sign was wrong,
       which is the kind of bug a player reports as "the game is confused".
       Cheap to do, and it has to happen on both paths. */
    if (G.course && G.hole) HUD.setHole(G.course, G.hole, G.room?.teeSet || 'back');
    return false;
  }
  clearMenuBackdrop();               // a real round owns the scene from here
  HUD.show('load');
  HUD.loading('Shaping ' + (courseMeta(courseId)?.name || 'the course') + '…');

  G.course = getCourse(courseId);
  G.hole = G.course.holes[holeIndex];
  G.bio = biomeFor(courseId);
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
/* Which format a hosted round uses. Remembered like the course, because a
   group that plays scrambles plays scrambles. */
let pickedFormat = 'stroke';
try { const f = localStorage.getItem('lg_format');
      if (f && FORMATS.some(x => x.id === f)) pickedFormat = f; } catch { /* private mode */ }

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
  G.bio = biomeFor(courseId);
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
  _liveKey = '';                       // a fresh avatar needs the ground now
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
/* Close-up on the golfer while the wardrobe is being used.
   -------------------------------------------------------------------------
   The figure on the tee has always updated the instant a swatch is clicked,
   but at eight metres in the corner of a wide shot you cannot see a shirt
   change, let alone a hat or a club decal — so the wardrobe felt like it was
   doing nothing. Touching anything in the panel pulls the camera in to a
   portrait framing and holds it there while you keep changing things; a few
   seconds after you stop, it drifts back out to the title shot on its own.

   No second renderer and no second avatar: it is the same golfer, standing
   on the same tee, seen properly. */
/* A countdown in SECONDS, spent by the frame's own dt — not a wall-clock
   deadline. Mixing performance.now() with a dt-driven camera means the hold
   and the ease are measured by different clocks, and the moment the frame
   loop is throttled (a backgrounded tab, a slow machine) they disagree. */
let portraitHold = 0;
export function showGolferCloseUp(seconds = 4.5) {
  portraitHold = Math.max(portraitHold, seconds);
}
let portraitK = 0;                 // 0 = wide title shot, 1 = portrait

/* ══════════════════════════════════════════════ THE LANDING PAGE ═══════
   The front door renders the SAME live course the menu does, but from the
   air: high, slow, drifting. Two reasons it is not the tee-level menu shot.

   A tee-level camera is a player's-eye view and it is the right frame for a
   menu, where the golfer standing on the tee IS the character preview. On a
   landing page there is no golfer yet and nothing to preview — what a
   visitor needs to be told in one glance is "this is a golf course, and it
   is a real one", and the shot that says that is the broadcast aerial.

   And it is cheap: the hole is already built and already being rendered
   behind the menu, so the landing page costs one camera. */
let landT = 0;
function landingFrame(dt) {
  landT += dt;
  const h = G.hole;
  // frame the middle of the hole, which is where its shape reads
  const mid = h.route[Math.floor(h.route.length * 0.42)];
  const far = h.route[Math.floor(h.route.length * 0.72)];
  const gy = G.T.heightAt(mid[0], mid[1]);

  /* A slow orbit rather than a straight drift: a straight drift eventually
     runs out of hole and has to cut back, and there is no cut on this page. */
  const a = landT * 0.028 + 2.15;
  const r = 168 + Math.sin(landT * 0.11) * 14;
  scene.camera.position.set(
    mid[0] + Math.sin(a) * r,
    gy + 96 + Math.sin(landT * 0.07) * 6,
    mid[1] + Math.cos(a) * r
  );
  // look a little past the middle, down the hole, so the green is in shot
  scene.camera.lookAt((mid[0] + far[0]) * 0.5, gy + 4, (mid[1] + far[1]) * 0.5);
  const t0 = h.tee;
  scene.setBall('menu', t0.x, G.T.heightAt(t0.x, t0.z) + BALL_RADIUS, t0.z);
  scene.windDir = 0.6;
  scene.update(dt);
  scene.render(scene.camera);
}

/* The side panel. One pane at a time, closed by default, and it lives on
   the landing page rather than replacing it — which is the difference
   between a front door with rooms off it and a stack of screens. */
const SIDE_TITLE = { friends: 'Friends & players online', course: 'Choose a course', golfer: 'Your golfer' };
function openSide(pane) {
  const side = HUD.el.lpSide;
  if (!side) return;
  if (!side.hidden && side.dataset.pane === pane) { closeSide(); return; }
  side.hidden = false;
  side.dataset.pane = pane;
  HUD.el.lpSideTitle.textContent = SIDE_TITLE[pane] || '';
  for (const p of side.querySelectorAll('.lp-pane')) p.hidden = p.dataset.pane !== pane;
  document.body.classList.add('side-open');
  if (pane === 'friends') { refreshRoomsSafe(); loadFriendsSafe(); }
  if (pane === 'golfer') drawLookSafe();
}
function closeSide() {
  const side = HUD.el.lpSide;
  if (!side) return;
  side.hidden = true;
  side.dataset.pane = '';
  document.body.classList.remove('side-open');
}
/* refreshRooms lives inside boot(); this is the hook boot fills in, so the
   panel can ask for a room list without this function reaching into a scope
   it is not in. That exact mistake shipped once already — see the note on
   the community legend. */
let refreshRoomsSafe = () => {};
let loadFriendsSafe = () => {};
let drawLookSafe = () => {};

/* Leaving the landing page.  The intro plays over the top of it and the
   destination screen is revealed underneath — so the animation is a
   TRANSITION and not a loading screen with a ball on it.

   It runs once per session (sessionStorage, not localStorage: a player who
   comes back tomorrow should get the whole thing again; a player who
   reloads twice in a minute should not). */
let introBusy = false;
let introStep = null;    // set while the opener is running; drives it per frame
let ambienceOk = false;   // set at the first click: audio may not start before one
async function leaveLanding(target = 'play') {
  if (introBusy) return;
  introBusy = true;
  const canvas = HUD.el.introCanvas;

  let seen = false;
  try { seen = sessionStorage.getItem('lg_seen_intro') === '1'; } catch { /* private mode */ }

  if (!seen) {
    try { sessionStorage.setItem('lg_seen_intro', '1'); } catch { /* private mode */ }
    document.body.classList.add('introing');
    /* The one gesture-gated moment in the game: a click got us here, so the
       audio context may legally start. */
    ambienceOk = true;
    Sound.ambience(true);

    /* THE OPENER IS THE REAL GAME NOW.

       It used to be a 2D canvas, drawn because three.js might not be ready.
       That reasoning expired: the landing page renders the real course
       behind itself, so the renderer, the terrain and the avatars all exist
       before anybody presses play. An ace on the third at Claude National,
       shot from two hundred metres up, with six golfers on the green. */
    const c3 = getCourse('parkland');
    const h3 = c3.holes[2];                    // 147 yards, par 3
    const T3 = terrainFor(h3, BIOMES.parkland);
    G.course = c3; G.hole = h3; G.T = T3; G.bio = BIOMES.parkland;
    /* The opener gets its OWN weather, and it is always the same: a clear
       late afternoon. Everything else in this game rolls the sky from a
       seed, which is right for a round and wrong for a trailer — the first
       thing anybody ever sees cannot be a wet grey Tuesday because that is
       what the dice said. 4:40 pm is low enough for long shadows and warm
       light without being so late it goes orange. */
    scene.setWeather({
      season: 'summer', seasonName: 'Summer', condition: 'clear',
      conditionName: 'Clear', icon: '☀️', hour: 16.7,
      vis: 1, cloud: 0.16, wet: 0, rain: 0, snow: 0,
      carry: 1, roll: 1, windMul: 0.8, grip: 1
    });
    scene.loadHole(h3, T3, BIOMES.parkland);
    G.loadedKey = 'parkland:2';
    menu.key = null;                           // the menu backdrop rebuilds after

    await new Promise(res => {
      playIntro3D(scene, h3, T3, {
        onStrike: () => Sound.strike({ type: 'iron', loft: 28 }, 1),
        onDrop: () => { Sound.holed(); Sound.celebrate(3); },
        /* The intro drives itself off OUR frame loop rather than starting a
           second one — two rAF loops rendering the same scene is a fight
           over the camera nobody wins. */
        onFrame: step => { introStep = step; }
      }).then(() => { introStep = null; res(); });
    });

    document.body.classList.remove('introing');
    scene.setWeather(G.weather || null);       // give the sky back to the round
    menuBackdrop();                            // back to the landing aerial
  }

  ambienceOk = true;
  /* Only re-show the front page for the legends that STAY on it. When the
     caller is about to tee off, showing the landing page first is a flash
     of the menu between the opener and the first tee. */
  if (target !== 'play') {
    G.screen = 'landing';
    HUD.show('landing');
    openLegend(target);
  }
  introBusy = false;
}

/* Where each legend goes. Every one of these is a screen that already
   exists — the landing page is a front door onto the game, not five new
   pages that have to be kept in step with it. */
function openLegend(target) {
  if (target === 'clubhouse') { HUD.openClubhouse?.(); return; }
  /* The boards are their own screen now, so the legend goes straight there
     rather than into the clubhouse and along to a tab. */
  if (target === 'leaderboards' || target === 'rankings') {
    G.screen = 'boards';
    HUD.show('boards');
    HUD.bindBoardsScreen();
    HUD.showBoardTab(target === 'rankings' ? 'ranks' : 'records');
    Net.h2h(rows => HUD.renderH2H(rows));
    return;
  }
  const tab = { settings: 'keys' }[target];
  if (tab) {
    renderClubhouse();
    G.screen = 'shop';
    HUD.show('shop');
    try { HUD.bindClubhouse?.(); HUD.showClubhouseTab(tab); } catch (e) { console.error('clubhouse:', e); }
    if (tab === 'world') Net.ranking(d => HUD.renderWorld(d, G.myPid));
    if (tab === 'ranks') HUD.onBoards(null);
    return;
  }
  if (target === 'community') {
    // the online box on the home screen, opened and scrolled to
    const box = document.getElementById('onlineBox');
    if (box) {
      /* Setting `open` fires the toggle event, and the room list already
         refreshes on that — so this must NOT also call refreshRooms, which
         lives inside boot() and is not in scope here. It would have been a
         ReferenceError on the one legend nobody tests by hand. */
      box.open = true;
      box.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
}

/* ══════════════════════════════════════════════════ THE WARDROBE ═══════
   Your golfer, full height, with the eight courses cycling behind them.

   The backdrop is the REAL course — the same loadHole the game uses to play
   it — because the whole point of a preview is that it is not a mock-up. A
   still image per course would have been cheaper and would have been a
   picture of a golfer who is not you standing somewhere the game does not
   go; every outfit you approve here is approved on the ground you will
   actually wear it on. */
const wd = { t: 0, idx: 0, auto: true, hold: 0,
             /* Turned by hand. `spin` is the player's own offset on top of
                the automatic turntable, `lift` raises or lowers the eye, and
                `dragging` stops the turntable while they are holding it —
                a figure that keeps rotating under your finger is one you
                cannot line up. */
             spin: 0, lift: 0, dragging: false, zoom: 1 };

/**
 * Drag the golfer round in the wardrobe.
 *
 * The turntable shows every side eventually, which is right for browsing and
 * useless the moment somebody wants to look at ONE thing — a decal on a
 * sleeve, how a hat sits. Waiting eleven seconds for the back of a shoe to
 * come round again is exactly the friction the turntable was meant to
 * remove, moved somewhere else.
 *
 * Horizontal drag turns, vertical drag raises the eye, wheel moves closer.
 * Bound to the whole screen rather than a canvas because the golfer is drawn
 * into the main scene behind the panels, so there is no element over them to
 * hang it on — and the panels stop the events themselves, so a drag that
 * starts on a shelf still scrolls the shelf.
 */
function bindWardrobeDrag() {
  let last = null;
  const onDown = e => {
    if (G.screen !== 'wardrobe') return;
    if (e.target.closest('.wd-right, .wd-cats, .wd-fits, button, input, select')) return;
    last = { x: e.clientX, y: e.clientY };
    wd.dragging = true;
    wd.auto = false;                 // stop cycling courses while they work
  };
  const onMove = e => {
    if (!last || G.screen !== 'wardrobe') return;
    wd.spin -= (e.clientX - last.x) * 0.011;
    wd.lift = Math.max(-0.5, Math.min(1.5, wd.lift + (e.clientY - last.y) * 0.006));
    last = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  };
  const onUp = () => { last = null; wd.dragging = false; };

  window.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('wheel', e => {
    if (G.screen !== 'wardrobe') return;
    wd.zoom = Math.max(0.62, Math.min(1.7, wd.zoom + Math.sign(e.deltaY) * 0.08));
  }, { passive: true });
}
const WD_DWELL = 3.0;              // seconds a course holds before the next

function wardrobeFrame(dt) {
  /* The turntable clock does not run while the player is holding the
     golfer. Advancing it regardless and merely ignoring it in the angle
     would make letting go SNAP to wherever the clock had reached, which is
     the opposite of picking up where you left off. */
  if (!wd.dragging) wd.t += dt;
  if (wd.auto && G.screen === 'wardrobe') {
    wd.hold += dt;
    if (wd.hold >= WD_DWELL) { wd.hold = 0; wdCourse(wd.idx + 1); }
  }

  const tee = G.hole.tee;
  /* Orbit the GOLFER, not the tee. They stand at their address spot, which
     is about a metre to the side of the ball — so a turntable centred on the
     tee swung the camera straight through them once a revolution, and the
     first frame of the wardrobe was the inside of a shirt. */
  const p = menu.av?.root?.position;
  const cx = p ? p.x : tee.x, cz = p ? p.z : tee.z;
  const gy = G.T.heightAt(cx, cz);

  /* A slow turntable rather than a fixed three-quarter view: a decal on the
     back collar and one on a shoe cannot both be checked from one angle, and
     asking a player to drag the camera to see what they just bought is the
     kind of friction that ends with them not bothering.

     It STARTS AT THE FRONT. The golfer faces the pin, so an orbit starting
     at zero opens on the back of their head — the one angle where none of
     what you just chose is visible. */
  const aim = Math.atan2(G.hole.pin.x - tee.x, G.hole.pin.z - tee.z);
  /* The turntable stops while they are holding it, and their own offset is
     kept afterwards — let go and it carries on from where you left it
     rather than snapping back to wherever the clock had got to. */
  const a = aim + wd.t * 0.22 + wd.spin;
  /* Back off on a narrow screen. three.js's fov is VERTICAL, so a phone held
     upright does not automatically show more of a standing figure — it shows
     the same height in a narrower window, and the outfit shelf and the stats
     bar then eat into it from both ends. Widening the orbit is what puts the
     whole golfer between them. */
  const narrow = Math.min(1, Math.max(0, (1.1 - scene.camera.aspect) / 0.7));
  const r = (3.4 + narrow * 1.9) * wd.zoom;
  scene.camera.position.set(cx + Math.sin(a) * r, gy + 1.34 + wd.lift, cz + Math.cos(a) * r);
  /* Aimed BELOW the golfer's middle so they sit high in frame: the stats bar
     owns the bottom fifth of the screen, and a centred golfer has their
     shoes behind it — which are a slot you can put a decal on. */
  scene.camera.lookAt(cx, gy + 0.80 + narrow * 0.1 + wd.lift * 0.55, cz);
  /* Re-place the ball every frame, exactly as menuFrame does. It is drawn
     oversized and grows with camera distance so it stays followable at 200
     metres — which means a ball last positioned while the camera was 168 m
     up in the landing aerial is drawn about ten times life size, and the
     wardrobe opened on a golfer standing next to a beach ball. */
  const tee0 = G.hole.tee;
  scene.setBall('menu', tee0.x, G.T.heightAt(tee0.x, tee0.z) + BALL_RADIUS, tee0.z);
  menu.av?.update(dt, 0);
  scene.windDir = 0.6;
  scene.update(dt);
  tickHolo(wd.t);                  // the holographic decals shift hue
  scene.render(scene.camera);
}

/** Put a different course behind the golfer. */
function wdCourse(i) {
  const n = COURSE_ORDER.length;
  wd.idx = ((i % n) + n) % n;
  const id = COURSE_ORDER[wd.idx];
  pickedCourse = id;
  menu.key = null;                 // force menuBackdrop to rebuild
  menuBackdrop();
  const bio = biomeFor(id);
  HUD.el.wdCourseName.textContent = bio.name;
  HUD.el.wdCourseWhere.textContent = bio.region || '';
  refreshCourseLegend();
  HUD.el.wdDots.innerHTML = COURSE_ORDER
    .map((_, k) => `<i class="wd-dot${k === wd.idx ? ' on' : ''}"></i>`).join('');
}

/**
 * Name the course on the front page's "Choose a course" legend.
 *
 * It was hard-coded to "Claude National" in the markup and nothing ever
 * wrote to it — the element was even registered in the HUD's lookup table,
 * which made it look wired. So it read Claude National whatever you picked,
 * and it was wrong before you picked anything at all: the roster is ordered
 * by difficulty now, so COURSE_ORDER[0] is Ashcombe Park.
 *
 * Called from every place `pickedCourse` moves. Uses `courseMeta` rather
 * than the biome, so an imported real course shows its own name rather than
 * the name of the biome it borrows its look from.
 */
function refreshCourseLegend() {
  const meta = courseMeta(pickedCourse);
  if (HUD.el.lpCourseName && meta) HUD.el.lpCourseName.textContent = meta.name;
}

function openWardrobe() {
  G.screen = 'wardrobe';
  HUD.show('wardrobe');
  HUD.bindWardrobe();
  wd.t = 0; wd.hold = 0;
  wdCourse(COURSE_ORDER.indexOf(pickedCourse) >= 0 ? COURSE_ORDER.indexOf(pickedCourse) : 0);
  drawWardrobe();
}

function drawWardrobe() {
  HUD.renderWardrobe(lookDraft, G.profile?.level ?? 1,
    Net.lastName || document.getElementById('inpName')?.value || 'Your golfer');
}

/**
 * Everything the wardrobe can change arrives here as a patch. The four
 * underscore keys are commands rather than fields — an outfit is a dozen
 * fields at once, a decal is a key in a map, and neither is expressible as
 * `{key: value}`.
 */
function applyWardrobe(patch) {
  if (!patch || typeof patch !== 'object') { drawWardrobe(); return; }

  if (patch.__outfit) {
    lookDraft = normaliseLook(wearOutfit(lookDraft, patch.__outfit),
      0, undefined, G.profile?.level ?? 1);
  } else if (patch.__decal) {
    const d = { ...(lookDraft.decals || {}) };
    if (patch.__decal.id) d[patch.__decal.slot] = patch.__decal.id;
    else delete d[patch.__decal.slot];
    lookDraft = normaliseLook({ ...lookDraft, decals: d, outfit: lookDraft.outfit },
      0, undefined, G.profile?.level ?? 1);
  } else if (patch.__custom) {
    lookDraft = normaliseLook({
      ...lookDraft,
      custom: normaliseCustom({ ...lookDraft.custom, ...patch.__custom })
    }, 0, undefined, G.profile?.level ?? 1);
  } else {
    const fields = Object.keys(patch).filter(k => !k.startsWith('__'));
    if (fields.length) {
      /* Changing one garment breaks the outfit it came from — it is no
         longer "Sunday red", it is Sunday red with different shoes. Saying
         so is more honest than leaving the name on it. */
      const next = { ...lookDraft, outfit: null };
      for (const k of fields) next[k] = patch[k];
      lookDraft = normaliseLook(next, 0, undefined, G.profile?.level ?? 1);
    }
  }

  saveLook(lookDraft);
  refreshMenuAvatar();
  /* ALWAYS, not only in a room. The wardrobe is reached from the front page,
     where `G.joined` is false — so this sent nothing at all in exactly the
     place people actually dress their golfer, and the outfit lived in this
     browser's localStorage and nowhere else. Come back on another device,
     or after the store was cleared, and you were the default golfer again.
     The server takes it without a room now; see player:look. */
  Net.setLook(lookDraft);

  /* The monogram field must not be re-rendered out from under a player who
     is still typing in it — the caret would jump to the end of the value on
     every keystroke, which makes the field unusable. */
  if (patch.__keepFocus) { HUD.renderWardrobeStats(lookDraft); return; }
  drawWardrobe();
}

function menuFrame(dt) {
  menu.t += dt;
  const tee = G.hole.tee;
  const gy = G.T.heightAt(tee.x, tee.z);
  const a = menu.t * 0.055 + 0.9;

  // ease between the two framings rather than cutting
  portraitHold = Math.max(0, portraitHold - dt);
  const want = portraitHold > 0 ? 1 : 0;
  portraitK += (want - portraitK) * Math.min(1, dt * 3.2);

  const r = lerp(8.2, 3.9, portraitK);      // close, but the whole golfer in frame
  const cx = tee.x + Math.sin(a) * r, cz = tee.z + Math.cos(a) * r;
  scene.camera.position.set(cx, gy + lerp(2.35, 1.62, portraitK)
    + Math.sin(menu.t * 0.13) * 0.25 * (1 - portraitK), cz);
  // Aim past the golfer's LEFT so they sit in the right-hand two thirds of
  // the frame — the menu column owns the left of the screen. Up close that
  // offset shrinks, or the golfer walks out of shot.
  const dx = tee.x - cx, dz = tee.z - cz;
  const L = Math.hypot(dx, dz) || 1;
  const off = lerp(2.0, 0.30, portraitK);
  scene.camera.lookAt(tee.x + (dz / L) * off, gy + lerp(1.2, 0.98, portraitK),
    tee.z - (dx / L) * off);
  scene.setBall('menu', tee.x, gy + BALL_RADIUS, tee.z);   // keep its draw size right
  menu.av?.update(dt, 0);
  scene.windDir = 0.6;
  scene.update(dt);
  scene.render(scene.camera);
}

/**
 * Point the aim down the hole — which is not always at the flag.  The rule
 * itself lives in coursegen.js beside the routes it reads, so the tests can
 * check every tee on every course; this only supplies the player's reach.
 */
/**
 * ONE plan for the shot the game is setting up: where to aim, and how far
 * that aim is actually pointing.
 *
 * These used to be worked out in three different places from two different
 * numbers, and they disagreed. The aim came from the fairway corridor, so on
 * a dogleg it pointed at the corner. The club and the caddie's power marker
 * both came from the distance to the PIN. So the game pointed you at the
 * corner, handed you a driver, and told you to hit it hard enough to reach
 * the flag — and a flushed shot went straight through the corner into the
 * trees, which is the exact thing aiming at the corner exists to avoid.
 *
 * Twelve of the seventy-two tees in the game are tight enough that the plan
 * is genuinely short of a full driver. On those you now get an iron and a
 * full swing instead of a driver at half power, which is both better golf
 * and a far clearer instruction.
 */
function shotPlan(reach) {
  const b = ballOf(G.myPid);
  return aimPlan(G.hole, b.x, b.z, reach);
}

function aimAtPin() {
  const b = ballOf(G.myPid);
  const club = CLUB_BY_KEY[clubKey];
  const reach = (CARRY[clubKey] || 200) * carryMult(club);
  swing.setAim(shotPlan(reach).aim);
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
  /* The outfit is a real, small factor and it goes HERE — through the same
     function the carry number under the club name is computed from. That is
     the whole reason it is in this function rather than applied at the
     strike: the wardrobe advertises "+2.5% drive", so the yardage the game
     promises has to already contain it. A stat that changes the shot but not
     the number the player aims with is worse than no stat at all. */
  /* The weather is the last factor and it is the only one that can make
     the number go DOWN. Cold, dense air and rain cost carry; the panel
     under the club name has to say so, or a player whose driver suddenly
     flies 240 instead of 250 will conclude the game is broken rather than
     that it is raining. */
  return fx.speed * cfx.speed * outfitEffect(lookDraft).speed * (G.weather?.carry ?? 1);
}

/** The same figure without a club in hand, for choosing one in the first place. */
const reachMult = () => crewEffect(G.profile?.crew || null, G.profile?.clubTier ?? 0,
  G.profile?.refine ?? 0, { power: 1 }).speed * outfitEffect(lookDraft).speed;

/** Where this club sits in the bag, so the arrows can grey out at the ends. */
function bagEnds() {
  const bag = myBag();
  const i = clubIndex(clubKey, bag);
  return { longest: i <= 0, shortest: i >= bag.length - 1 };
}

function autoClub() {
  if (clubManual || !G.T) return;
  const b = ballOf(G.myPid);
  const lie = G.T.surfaceAt(b.x, b.z);
  /* On Pro and above the club is YOUR decision. The putter is still handed
     to you on the green, because walking onto a green and being given a 4
     iron is not a test of judgement, it is a missing feature. */
  if (!AIDS().club && lie.id !== 'green') {
    swing.clubKey = clubKey;
    swing.setLie(lie.id);
    HUD.setClub(CLUB_BY_KEY[clubKey], lie.id, carryMult(CLUB_BY_KEY[clubKey]), bagEnds());
    return;
  }
  /* Club for the shot the game is actually setting up, not for the straight
     line to the flag. On a dogleg those are different distances and picking
     by the flag hands you a driver for a 110 m lay-up. */
  const far = (CARRY.DR || 220) * reachMult();
  const d = lie.id === 'green' ? G.T.toPin(b.x, b.z)
    : Math.min(G.T.toPin(b.x, b.z), shotPlan(far).dist);
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
/* The aids the current mode allows. Read through a function rather than
   captured once, because the mode can change from the settings pane mid-
   round and every draw site must see the new answer on the next frame. */
const AIDS = () => aidsFor(G.profile?.difficulty || DEFAULT_DIFFICULTY);

/* Push the mode into the two places that cannot ask for it themselves.
   The swing meter is loaded by the physics tests as well as the browser, so
   it takes its forgiveness by injection rather than importing a preference;
   see setForgiveness in swing.js. */
/* Named rather than inline, so the re-render after a pick passes the SAME
   handler. The picker only wires its listener once, so a re-render with a
   different callback would quietly keep the old one — which works, and
   works for a reason nobody reading it would guess. */
function pickDifficulty(id) {
  Net.setDifficulty(id);
  // paint it immediately; the server's 'profile' reply confirms it
  if (G.profile) G.profile.difficulty = id;
  applyDifficulty();
  HUD.renderDifficulty(id, pickDifficulty);
  HUD.toast(`${id[0].toUpperCase() + id.slice(1)} — saved.`, 'good', 1600);
}

function applyDifficulty() {
  const a = AIDS();
  setForgiveness(a.forgive);
  setMarkBand(a.power !== 'blind');
  /* The wind readout keeps its ARROW and loses its digits — a wind whose
     direction you cannot see is not a harder read, it is a coin toss, and
     the flags and the trees show it anyway. */
  HUD.setWindDetail(a.wind);
  if (!a.trace) hideShotCard();
  previewKey = '';                       // the line may be drawn differently now
  refreshAimPreview(true);
}

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
    faceDeg: 0, attackDeg: 0, wind: G.wind, weather: G.weather, ignoreCup: showRunOut, gear: myGear,
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
  /* HOW MUCH OF THAT LINE YOU ARE ALLOWED TO SEE. The simulation runs
     either way — it is what the caddie mark and the club suggestion are
     built from — but a mode decides how much of it is drawn.

       full     the whole flight and the roll-out
       partial  the flight to where it lands, and no run-out
       aim      a short pointer, so you know which way you are facing
       none     nothing

     Gated here rather than at the call sites so a mode can never half-apply:
     one place decides, and the read band, the colour and the slope arrows
     below all key off the same answer. */
  const aid = AIDS();
  const seeLine = isPutt ? aid.putt !== 'none' : aid.line !== 'none';
  let shown = pts;
  if (!seeLine) shown = null;
  else if (aid.line === 'partial' && !isPutt) {
    // cut it at the landing point: you get the carry, not the run-out
    const landAt = sim.events.findIndex(e => e.type === 'land');
    if (landAt >= 0) {
      const lp = sim.events[landAt];
      let cut = pts.length;
      for (let i = 0; i < pts.length; i++) {
        if (Math.hypot(pts[i].x - lp.x, pts[i].z - lp.z) < 1.5) { cut = i + 1; break; }
      }
      shown = pts.slice(0, Math.max(2, cut));
    }
  } else if (aid.line === 'aim' && !isPutt) {
    // a pointer, not a prediction: 25 m down the line you are actually on
    const f = { x: Math.sin(swing.aim), z: Math.cos(swing.aim) };
    shown = [
      new THREE.Vector3(b.x, G.T.heightAt(b.x, b.z) + 0.07, b.z),
      new THREE.Vector3(b.x + f.x * 25, G.T.heightAt(b.x + f.x * 25, b.z + f.z * 25) + 0.07,
                        b.z + f.z * 25)
    ];
  }
  scene.setAimLine(shown, isPutt);     // putts get the wide, bright read band
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
    /* The borrow drawn on the green is the single biggest aid in the game —
       it turns reading a putt from a skill into a lookup. `full` gets it,
       `arrow` gets the direction without the amount, and above that you
       read it yourself. */
    scene.setAimLineColor(aid.putt === 'full' ? (hard ? 0xff7a5c : risky ? 0xffd76b : 0x8fe07a)
                                             : 0xffffff);
    if (aid.putt === 'full') {
      scene.setSlopeRead(b.x, b.z, G.T);
      scene.setGreenRead((myCrew?.roller || 0) >= 1 || (myGear?.putter || 0) >= 1);
    } else {
      scene.setSlopeRead(null);
      scene.setGreenRead(false);
    }
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
  /* How far to hit it, along the line you are ACTUALLY aiming down.
     Straight at the flag this is the distance to the flag, unchanged. Aimed
     away from it — at a dogleg corner, or punching out sideways from the
     trees — the pin is projected onto the aim line, so the number is the
     depth you need rather than a distance you are not travelling. Aiming
     forty degrees off and being told to hit full driver is how a recovery
     shot ends up in the trees on the other side. */
  const bearing = Math.atan2(G.hole.pin.x - b.x, G.hole.pin.z - b.z);
  const off = Math.atan2(Math.sin(swing.aim - bearing), Math.cos(swing.aim - bearing));
  const projected = Math.max(2, toPin * Math.cos(off));
  // `club` is not bound in this function — only clubKey is. Using it here
  // threw a ReferenceError on the very first aim refresh.
  const reach = (CARRY[clubKey] || 200) * carryMult(CLUB_BY_KEY[clubKey]);
  const plan = shotPlan(reach);
  const onPlan = Math.abs(Math.atan2(Math.sin(swing.aim - plan.aim),
                                     Math.cos(swing.aim - plan.aim))) < 0.03;
  const target = onPlan ? Math.min(plan.dist, projected) : projected;
  // the marker swings the same upgraded ball the server will — see suggestedPower
  HUD.setTargetPower(suggestedPower(G.T, b.x, b.z, clubKey, swing.aim, G.wind, target + past, myGear, myKit));
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
      _liveKey = '';                   // and so does a player who just joined
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
    faceDeg: m.face || 0, attackDeg: 0, wind: G.wind, weather: G.weather,
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

  /* Adaptive quality. Sun shadows are a whole extra pass over every caster,
     and with a full course of golfers and carts that is exactly the machine
     that cannot afford them. Rather than let it grind, notice a sustained bad
     frame time and step down one tier, saying so. Only ever downward, and
     only once, so it can never oscillate.

     This was still written against the OLD two-value setting — it tested for
     'quality' and set 'perf', and the setting became low/medium/high a while
     back. So the guard was never true and this never fired: anyone on a weak
     machine simply ground away at whatever they had picked. And if it HAD
     fired it would have been worse than doing nothing, because setQuality
     falls back to medium on an unknown name while HUD.quality was assigned
     'perf' directly, leaving the setting and the renderer disagreeing and the
     clubhouse dropdown showing a blank. */
  const STEP_DOWN = { high: 'medium', medium: 'low' };
  const easier = STEP_DOWN[HUD.quality];
  if (_autoDropped || !easier || G.screen !== 'game') return;
  _slowRuns = ms > 34 ? _slowRuns + 1 : 0;      // worse than ~30 fps
  if (_slowRuns >= 12) {                        // ~6 s of it, not one hitch
    _autoDropped = true;
    HUD.setQuality(easier);                     // validates and persists
    if (scene.setQuality(easier) && G.hole) scene.loadHole(G.hole, G.T, G.bio);
    if (HUD.el.optQuality) HUD.el.optQuality.value = HUD.quality;
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
    launchDir: msg.shot.aim,
    // what the swing actually did, for the post-shot card
    faceDeg: msg.shot.faceDeg || 0, attackDeg: msg.shot.attackDeg || 0
  };
  G.balls[msg.pid] = { x: sim.p.x, y: sim.p.y, z: sim.p.z };
  // the golfer swings on every screen, timed so the ball leaves at the hit
  const swingAv = G.avatars.get(msg.pid);
  if (swingAv) { swingAv.setClub(msg.shot.clubKey, player(msg.pid)?.clubTier ?? 0); swingAv.strike(msg.shot.aim); }
  /* The trail is a LEVEL reward, so it wins over the ball colour when the
     player has one equipped. That is the point of it: the line your shot
     draws in the air is the most-watched three seconds in the game, and it
     is the only cosmetic everyone in the room is guaranteed to look at. */
  const shooter = player(msg.pid);
  const trail = shooter?.look?.trail
    ? UNLOCKS.find(u => u.kind === 'trail' && u.id === shooter.look.trail)
    : null;
  scene.setTraceColor(trail?.color || shooter?.color || '#ffffff');
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
      /* The analysis, for YOUR shots only. A card about somebody else's
         swing is a card about a swing you cannot change, and it would cover
         the course four times a hole in a four-ball. */
      if (a.pid === G.myPid && AIDS().trace) {
        showShot(a.sim, {
          clubKey: a.sim.club?.key, aim: a.launchDir,
          faceDeg: a.faceDeg, attackDeg: a.attackDeg,
          dist: HUD.dist, unit: HUD.unit(),
          // `label`, not `name` — surfaces have no `name`, so the lie tag on
          // the card was undefined on every shot and simply never rendered
          surface: G.T?.surfaceAt(a.sim.p.x, a.sim.p.z)?.label || null,
          holed: res.reason === 'holed'
        });
      }
    }
    return;
  }

  if (now - a.doneAt > a.hold) {
    // snap to the server's answer (they agree, but the server is the authority)
    const s = a.srv;
    G.balls[a.pid] = { x: s.x, y: G.T.heightAt(s.x, s.z) + BALL_RADIUS, z: s.z };
    scene.setBall(a.pid, G.balls[a.pid].x, G.balls[a.pid].y, G.balls[a.pid].z);
    /* Tournament does not leave the line your ball drew hanging in the air
       after it lands. Everywhere else it stays until the next shot, which
       is the single most useful thing on the screen for working out what
       the wind did to you. */
    if (AIDS().trace) scene.holdTrace?.(); else scene.clearTrace();
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
  } else if (r.conceded) {
    /* A gimme still counts the stroke, so this celebrates the score rather
       than the putt — it is a holed-out hole in everything but the tap. */
    const rel = r.strokes - G.hole.par;
    fireReaction(a.pid, r.strokes, G.hole.par, false);
    HUD.flash(HUD.scoreName(rel), `${who} — that's good`,
      rel < 0 ? '#8fe07a' : '#fff', REACTION_TIER[reactionFor(r.strokes, G.hole.par, false)] || 0);
    HUD.toast(`⛳ ${who} — given, ${r.strokes}`, 'good', 2600);
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
/* The ground and the wind, handed to every avatar that exists.

   Both are per-hole rather than per-avatar, and setting them at each of the
   five places an avatar is updated is five places to forget one. Cheap: two
   property writes per golfer, and only when the hole or the wind changes. */
let _liveKey = '';
let _stride = 0, _strideSide = 1;   // footfall accumulator
function feedAvatars() {
  const key = `${G.loadedKey}|${G.wind.speed}|${G.wind.dir.toFixed(2)}`;
  if (key === _liveKey || !G.T) return;
  _liveKey = key;
  const give = av => {
    if (!av) return;
    av.setTerrain?.(G.T);
    av.setWind?.(G.wind.speed, G.wind.dir);
  };
  give(menu.av);
  for (const a of G.avatars.values()) give(a);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = last ? clamp((now - last) / 1000, 0, 0.1) : 0;
  last = now;
  /* Birds and wind on the menus, silence in a round — a round has its own
     sound and an ambient bed under a putt is a distraction. Idempotent, so
     calling it every frame costs a comparison. */
  Sound.ambience(ambienceOk && G.screen !== 'game');
  feedAvatars();
  // the title screen: the course drifting behind the menu (and behind the
  // lobby, for a host who has not started yet)
  /* The opener owns the camera and the scene while it runs, so it comes
     before every other framing decision. */
  if (introStep) { if (!introStep(dt)) introStep = null; return; }
  if (G.screen === 'landing' && menu.key && G.hole) { landingFrame(dt); return; }
  if (G.screen === 'wardrobe' && menu.key && G.hole) { wardrobeFrame(dt); return; }
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

    /* It went over.
       You stay in it — strapped in, going nowhere, watching the sky for
       three seconds while it is hauled back onto its wheels. Throwing the
       driver out was the first design and it meant unpicking the seat, the
       cart's ownership and the walker all in one frame for a three-second
       event; sitting there is both simpler and, watching it, funnier. The
       cost is real either way: no throttle, no steering, and a stun on the
       way back up. */
    const flip = carts.takeFlip();
    if (flip > 0) {
      rig.kick(1.15 + flip * 0.6);
      Sound.crash();
      HUD.toast('You put it on its side.', 'warn', 2400);
    }
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
  /* Footprints, on the stride. Driven from the DISTANCE walked rather than
     from a timer, so a jog leaves prints the same distance apart as a stroll
     rather than the same number per second. */
  if (walker.speed > 0.4) {
    _stride += walker.speed * dt;
    if (_stride > 0.62) {
      _stride = 0;
      _strideSide = -_strideSide;
      const a = walker.heading ?? cameraYaw();
      scene.addPrint(
        walker.x + Math.cos(a) * 0.16 * _strideSide,
        walker.z - Math.sin(a) * 0.16 * _strideSide, a);
    }
  }
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

/* Shot telemetry.  Power and shape used to be tuned by feel, which is how a
   meter that disagreed with the shot went unnoticed for so long — every
   number here is the one actually committed, read back off the controller
   after the fact.  Off unless asked for: ?debug=1 in the URL, or Ctrl+Shift+D
   in play.  Survives a reload so a whole round can be watched. */
let shotDebug = (() => {
  try {
    if (new URLSearchParams(location.search).get('debug') === '1') return true;
    return localStorage.getItem('lg_shotdebug') === '1';
  } catch { return false; }
})();
let dbgEl = null;
function shotDebugPanel() {
  if (dbgEl) return dbgEl;
  dbgEl = document.createElement('pre');
  dbgEl.id = 'shotDebug';
  dbgEl.style.cssText =
    'position:fixed;left:12px;bottom:74px;z-index:60;margin:0;padding:8px 10px;' +
    'font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#8fe07a;' +
    'background:rgba(6,12,10,.82);border:1px solid rgba(143,224,122,.28);' +
    'border-radius:8px;pointer-events:none;white-space:pre;max-width:46vw';
  document.body.appendChild(dbgEl);
  return dbgEl;
}
function reportShot(d) {
  if (!d) return;
  const line =
    `power    ${String(d.powerPct).padStart(5)} %   (${d.club} from ${d.lie})\n` +
    `accuracy ${String(d.accuracyPct).padStart(5)} %   stop ${d.strikeAt >= 0 ? '+' : ''}` +
    `${d.strikeAt.toFixed(3)}  band ±${d.band}\n` +
    `shape    ${d.shape.padStart(8)}   face ${d.faceDeg >= 0 ? '+' : ''}` +
    `${d.faceDeg.toFixed(2)}°  ${d.pure ? 'PURE' : ''}`;
  shotDebugPanel().textContent = line;
  console.log('[shot]', d);
}
window.addEventListener('keydown', ev => {
  if (!(ev.ctrlKey && ev.shiftKey && ev.code === 'KeyD')) return;
  ev.preventDefault();
  shotDebug = !shotDebug;
  try { localStorage.setItem('lg_shotdebug', shotDebug ? '1' : '0'); } catch { /* private mode */ }
  if (!shotDebug && dbgEl) { dbgEl.remove(); dbgEl = null; }
  else shotDebugPanel().textContent = 'shot telemetry on — play a shot';
});

function strike() {
  const shot = swing.commit();
  if (shotDebug) reportShot(swing.debug());   // BEFORE reset, which clears it
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
  /* The controls panel eats the next key when it is waiting for one. First,
     before anything else looks at it — otherwise binding a key to "Emote"
     also fires the emote wheel on the way past. */
  if (HUD.bindsListening() && HUD.bindsCapture(ev)) return;
  const k = ev.key.toLowerCase();
  keys.add(k);
  walker.key(k, true);
  if (G.screen !== 'game') return;

  // stop the page scrolling while someone is walking with the arrow keys
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) ev.preventDefault();

  const m = mode();
  const seated = m === 'drive' || m === 'ride';

  /* Keys are DATA — see binds.js. Every comparison below asks what ACTION
     this key is bound to rather than whether it is a particular letter, so
     the whole scheme is rebindable and the dispatch did not have to change
     shape to make it so. */
  const a = actionFor(k);

  if (a === 'map') { toggleMap(); ev.preventDefault(); }
  if (a === 'clubDown') stepClub(-1);
  if (a === 'clubUp') stepClub(1);
  if (a === 'cancel' && cancelShot()) return;
  if (a === 'cancel') {
    if (seated) toggleCart();           // a safety valve out of the cart
    else { swing.cancel(); HUD.setMeter(swing.meter(), canSwing()); }
  }
  if (a === 'reAim') {
    rig.reset();
    // never touch the aim from the driving seat — you are not addressing a ball
    if (!seated) { aimAtPin(); refreshAimPreview(true); }
  }
  if (a === 'view') toggleView();
  if (canSwing()) {
    // camera presets, PGA-style: 1 behind, 2 elevated, 3 side-on, 4 first person
    if (a === 'cam1') { rig.orbit = 0; rig.pitch = 0; rig.zoom = 1; G.view = 'third'; }
    if (a === 'cam2') { rig.orbit = 0; rig.pitch = 0.42; rig.zoom = 1.35; G.view = 'third'; }
    if (a === 'cam3') { rig.orbit = Math.PI / 2; rig.pitch = 0.05; rig.zoom = 1.1; G.view = 'third'; }
    if (a === 'cam4') { G.view = 'first'; }
    // Space is the strike while the bar is sweeping — the key your hand is
    // already on — and only re-frames the camera when no shot is waiting.
    if (a === 'strike') { if (swing.state === SWING.ACCURACY) strike(); else rig.reset(); }
  }
  if (a === 'cart') toggleCart();
  if (a === 'hail') hailRide();
  if (a === 'toBall') {
    if (seated) HUD.toast('Get out of the cart first.', 'warn', 1600);
    else jogToMyBall();
  }
  // Enter opens the box; the box itself handles send and close (see above).
  if (a === 'chat' && G.screen === 'game') { HUD.showChat(true); return; }
  /* Push is on B, on its own. It was on R, which already resets the camera
     and re-aims at the pin — so every shove also yanked the view and threw
     away whatever aim the player had set. */
  if (a === 'melee' && !seated && G.screen === 'game') {
    /* Shove whoever is nearest and in reach. No target picking: at barging
       distance there is only ever one person you could mean, and a wheel
       would turn a physical act into a menu. */
    let best = null, bestD = 2.9;
    for (const pl of (G.room?.players || [])) {
      if (pl.pid === G.myPid || !pl.connected) continue;
      /* Reach for whichever is nearer: the golfer, or the cart they are
         sitting in. A parked cart's seat can be a couple of metres from
         where the server thinks its driver is standing. */
      const dFoot = Math.hypot((pl.ax ?? pl.x) - walker.x, (pl.az ?? pl.z) - walker.z);
      const rc = carts.remote?.get?.(pl.pid);
      const dCart = rc ? Math.hypot(rc.x - walker.x, rc.z - walker.z) : Infinity;
      const d = Math.min(dFoot, dCart);
      if (d < bestD) { bestD = d; best = pl; }
    }
    if (best) {
      const mv = currentMelee();
      Net.shove(best.pid, mv.id);
      // play it locally at once — waiting for the round trip makes the key
      // feel dead, and the server's answer only ever downgrades the move
      G.avatars.get(G.myPid)?.play(MELEE_CLIP[mv.id] || 'shoving');
    }
    return;
  }
  /* Cycle which melee is on the key. One button, because at barging distance
     there is only ever one person you could mean and a wheel would turn a
     physical act into a menu — but you choose WHICH thing the button does. */
  if (a === 'meleeNext' && !seated && G.screen === 'game') {
    const have = meleesAt(G.profile?.level ?? 1);
    if (have.length > 1) {
      const i = have.findIndex(m => m.id === meleePick);
      meleePick = have[(i + 1) % have.length].id;
      const m = meleeById(meleePick);
      HUD.toast(`${m.icon} ${m.name} — ${m.blurb}`, 'info', 1800);
    }
    return;
  }
  if (a === 'emote' && !seated) {
    // hold T for the wheel; it closes on keyup or once something is picked
    if (!HUD.emotesOpen()) {
      HUD.renderEmotes(G.profile?.level ?? 1, id => { Net.emote(id); HUD.showEmotes(false); });
      HUD.showEmotes(true);
    }
  }
  if (a === 'perf') HUD.showPerf(!HUD.perfVisible());
});
window.addEventListener('keyup', ev => {
  const k = ev.key.toLowerCase();
  if (isAct(k, 'emote')) HUD.showEmotes(false);
  keys.delete(k);
  walker.key(k, false);
});
// a lost focus must not leave someone sprinting forever
window.addEventListener('blur', () => { keys.clear(); walker.clearKeys(); carts.clearInput(); HUD.showEmotes(false); });

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
  // Scaled to the distance, so the walk is short whether the ball is thirty
  // metres away or two hundred — see ballDashSpeed.
  const d = Math.hypot(spot.x - walker.x, spot.z - walker.z);
  walker.goTo(spot.x, spot.z, ballDashSpeed(d));
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
    /* Clouds sit between the map camera and the course, so from 600 m up
       they park white blobs over the hole you are trying to read. On a
       tactical map that is not atmosphere, it is a smudge on the paper. */
    const clouds = scene.clouds;
    const cloudsWere = clouds ? clouds.visible : false;
    try {
      scene.scene.fog = null;
      if (clouds) clouds.visible = false;
      scene.scene.background = new THREE.Color(0x0d1512);
      scene.renderer.setSize(w, h, false);
      scene.render(scene.mapCamera);
      mapBase = document.createElement('canvas');
      mapBase.width = w; mapBase.height = h;
      mapBase.getContext('2d').drawImage(scene.renderer.domElement, 0, 0, w, h);
      mapBaseKey = baseKey;
    } finally {
      scene.scene.fog = fog;
      if (clouds) clouds.visible = cloudsWere;
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
  /* Same flip as the minimap, and here it was worse: this canvas draws live
     markers OVER a real 3D render, and the two disagreed. fitMapCamera looks
     straight down with up = +z, which puts screen-right at world -x — the
     player's right. The marker projection put screen-right at world +x. So
     the flag and every ball were drawn mirrored against the picture of the
     hole underneath them: your ball shown in the trees on the left while the
     render had it on the fairway to the right. */
  const mx = x => ((cx2 + hw) - x) / (hw * 2) * w;
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
  /* BOTH axes flip, and that is the whole bug.
     -----------------------------------------------------------------------
     In this project's convention world +z is forward and world +x is the
     player's LEFT (see the note on left(h) in avatars.js). The map flipped z
     so that up-canvas is up-the-hole — correct — but left x alone, so
     right-on-canvas was world +x, which is the player's left. That is a
     determinant of -1: a MIRROR. Every dogleg bent the wrong way, and a
     player checking the map before a blind shot was being shown the reverse
     of what they were about to hit into.

     Flipping x as well makes it a 180-degree rotation instead of a
     reflection — determinant +1 — so up-canvas is still up the hole and
     right-canvas is now genuinely the player's right. */
  const x2 = x => (b.maxX - x) / spanX * W * dpr;
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
  /* Weather arrives with the state and is applied ONCE per round, not per
     broadcast — rebuilding fourteen hundred rain particles ten times a
     second is a stutter, and the weather does not change within a round. */
  if (s.weather && s.weather.condition !== G.weather?.condition) {
    G.weather = s.weather;
    HUD.setWeather(s.weather);
  }
  /* Handed to the scene on every hole too, not only when it changes: a new
     hole builds a fresh set of lights, and they come out of loadHole lit for
     whatever the scene last knew. */
  if (G.weather && scene.weather !== G.weather) scene.setWeather(G.weather);

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

/* Somebody emoted.  The server has already checked they own it, so this just
   plays it on whoever's avatar it belongs to — including our own, so what we
   see is the same thing everyone else sees rather than a local guess. */
/* Levelling up is a moment, not a number quietly changing.  The server tells
   us when it happened as part of the round settlement, because only it knows
   what the level was before the round was folded in. */
function levelUpMoment(from, to) {
  const el = document.createElement('div');
  el.className = 'levelup';
  /* Everything earned between the two levels, not just emotes — a level that
     hands you a club decal should say so rather than reading as empty. */
  const gained = unlockedBetween(from, to);
  const next = nextUnlock(to);
  el.innerHTML = `<div><b>LEVEL ${to}</b><span>` +
    (gained.length
      ? gained.map(g => `${g.name} — ${(UNLOCK_KINDS[g.kind] || {}).name || g.kind}`).join(' · ')
      : next ? `Next: ${next.name} at ${next.at}` : 'Everything unlocked') +
    `</span></div>`;
  document.body.appendChild(el);
  try { Sound.celebrate?.('birdie'); } catch { /* audio may be blocked */ }
  setTimeout(() => el.remove(), 2700);
}

Net.on('levelup', d => { if (d?.to) levelUpMoment(d.from || 1, d.to); });

/** Which melee the B key throws, and the animation each one plays. */
const MELEE_CLIP = { barge: 'shoving', slap: 'slapping', kick: 'kicking' };
const TOOK_IT = { barge: 'staggered', slap: 'spun', kick: 'launched' };
let meleePick = 'barge';
function currentMelee() {
  const have = meleesAt(G.profile?.level ?? 1);
  return have.find(m => m.id === meleePick) || have[0];
}

/* Somebody got shoved. The stagger plays on whoever took it, on every
   screen; the PUSH only applies to our own golfer, because each client owns
   its own position and applying it to a remote avatar would fight the
   position updates already arriving for them. */
Net.on('shoved', d => {
  const move = d.move || 'barge';
  G.avatars.get(d.pid)?.play(TOOK_IT[move] || 'staggered');
  G.avatars.get(d.from)?.play(MELEE_CLIP[move] || 'shoving');
  if (d.pid === G.myPid) {
    // in a cart, the shove goes into the CART; on foot, into your own legs
    if (d.cart && carts.body) carts.shoveBody(d.nx, d.nz, d.power);
    else walker.shove(d.nx, d.nz, d.power);
    /* A slap spins you where you stand. It moves you barely at all, so
       without this it would land as nothing — the turn IS the move. */
    if (d.spin) walker.heading += (Math.random() < 0.5 ? -1 : 1) * d.spin;
    // and the camera hit scales with what hit you
    rig.kick(move === 'kick' ? 0.85 : move === 'slap' ? 0.2 : 0.35);
    Sound.thud?.();
  }
});

/* A scramble side has picked its ball. Everyone on it is standing on the
   same spot now, so say WHOSE shot they are all playing — that line is the
   whole social point of the format, and without it the teleport is just
   confusing. */
Net.on('gather', d => {
  const who = player(d.pid)?.name || 'someone';
  const mine = G.room?.players?.find(p => p.pid === G.myPid)?.team === d.team;
  if (mine) {
    HUD.toast(`Playing ${who}'s ball — ${d.yards} yds out`, 'good', 2600);
    // your golfer and your ball are both somewhere else now
    walker.reset(d.x, d.z, walker.heading);
    rig.snap();
  }
});

Net.on('chat', d => HUD.chatMessage(d, G.myPid));

Net.on('emote', d => {
  const av = G.avatars?.get(d?.pid);
  if (av) av.play(d.id);
});

Net.on('profile', prof => {
  const before = G.profile;
  G.profile = prof;
  applyDifficulty();
  /* THE SERVER'S COPY WINS on the first profile of a session. localStorage is
     a cache in front of it, not the record — so a browser that has never
     seen this player (new device, cleared store, private window) gets their
     golfer back instead of the default one. Only on the FIRST profile: after
     that the local draft is what the player is actively editing, and letting
     a later broadcast overwrite it would undo their changes mid-click. */
  /* `hasLocalLook`, not a bare localStorage read. Reading storage THROWS in
     a sandboxed iframe and in Safari's private mode, and this sits inside
     the profile handler — so on a portal that blocks storage the throw would
     take out the clubhouse render, the difficulty picker and the look
     restore in one go, on the first message the server sends. Every other
     storage access in this file is already wrapped; this one was added later
     and was not. */
  if (!before && prof.look && !hasLocalLook()) {
    lookDraft = normaliseLook(prof.look, 0, undefined, prof.level ?? 1);
    saveLook(lookDraft);
    refreshMenuAvatar();
  }
  renderClubhouse();
  // the front page carries the level and the rating, and the wardrobe's
  // earned rows depend on the level, so both are redrawn when it lands
  HUD.renderCharacter(prof, Net.lastName || document.getElementById('inpName')?.value);
  if (lookDraft) drawLookPicker();
  previewKey = '';                     // gear may have changed the flight
  if (G.room?.state === 'lobby') renderLobbyAll(G.room);
  // the post-round payout, announced once the results are up
  if (before && prof.coins > before.coins) {
    HUD.toast(`🪙 +${prof.coins - before.coins} coins · rating ${prof.rating}`, 'good', 4200);
  }
});

Net.on('toast', d => HUD.toast(d.msg, d.kind));

/* A record fell somewhere in the game. Take the whole board with it — it is
   a handful of rows, and a partial update would leave the clubhouse showing
   one fresh row among stale ones. Re-render only if the board is on screen;
   otherwise the next open picks it up from G.records for free. */
Net.on('records', d => {
  if (d?.all) G.records = d.all;
  const box = document.getElementById('recordBox');
  if (box && box.offsetParent !== null) {      // on screen right now
    HUD.renderRecords(COURSES, G.records || {}, G.myPid);
  }
  /* Somebody else's record, announced to everyone. Yours is already toasted
     by the room you set it in, so it is not said twice. */
  if (d?.pid && d.pid !== G.myPid && d.round) {
    HUD.toast(`🏆 ${d.name} set the course record at ${d.course} — ${d.round.total}`, 'good');
  }
});
Net.on('kicked', d => { G.joined = false; G.room = null; route(); HUD.homeError(d.reason || 'Disconnected.'); });
/* ── a blip is not an outage ──────────────────────────────────────────────
   Socket.IO reconnects on its own, and on a free-tier host it has to do so
   fairly often — a dropped websocket that is back in two seconds is a fact
   of the platform, not an event in the player's round. Announcing every one
   of them turned an invisible reconnect into "the game keeps losing
   connection", which is a far worse experience than the drop itself.

   So the warning waits. If the socket is back before the timer fires the
   player never learns it happened, which is the honest description of what
   occurred. If it is still down after four seconds it is worth saying, and
   then the message stays until it is fixed rather than flashing past. */
let dropWarn = 0;
Net.on('disconnect', () => {
  clearTimeout(dropWarn);
  dropWarn = setTimeout(() => {
    G.warnedDrop = true;
    HUD.toast('Connection lost — reconnecting…', 'warn', 6000);
  }, 4000);
});
Net.on('connect', () => {
  clearTimeout(dropWarn);
  /* Only after a drop the player was actually told about, or every ordinary
     first connect would announce itself as a recovery. */
  if (G.warnedDrop) { HUD.toast('Back online.', 'good', 1600); G.warnedDrop = false; }
});

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
    /* The landing page outranks the default route. Connecting to the server
       fires this, and without the guard the front door was replaced by the
       menu about a second after it appeared — for everyone with a fast
       connection, which is to say everyone. */
    if (G.screen === 'landing') { menuBackdrop(); return; }
    G.screen = 'landing'; HUD.show('landing');
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
  if (r.state === 'results') {
    G.screen = 'results';
    HUD.show('results');
    HUD.renderResults(r, G.myPid, G.course);
    /* How it compared. Computed from the same card the table above is drawn
       from, so the two can never disagree about what you shot. */
    const meRow = r.players.find(p => p.pid === G.myPid && !p.spectator);
    if (meRow) {
      const tot = meRow.scores.reduce((a, v) => a + (v ?? 0), 0);
      const others = r.players
        .filter(p => !p.spectator && p.pid !== G.myPid)
        .map(p => ({ pid: p.pid, name: p.name,
                     total: p.scores.reduce((a, v) => a + (v ?? 0), 0) }));
      Net.h2h(rows => {
        /* Keyed by pid. Names are not unique, they can be changed between
           rounds, and two players called Sam in one room would have shown
           each other's record. */
        const by = new Map(rows.map(x => [x.pid, x]));
        HUD.renderResultCompare(tot, G.course.par, G.profile, G.course.id,
          others.map(o => ({ ...o, record: by.get(o.pid) || null })));
      });
    }
    return;
  }
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
  HUD.renderCharacter(G.profile, Net.lastName || document.getElementById('inpName')?.value);
  HUD.renderLook(lookDraft, (key, value) => {
    lookDraft = normaliseLook({ ...lookDraft, [key]: value });
    drawLookPicker();
    saveLook(lookDraft);
    refreshMenuAvatar();             // the golfer on the tee changes NOW
    showGolferCloseUp();             // ...and you are close enough to see it
    Net.setLook(lookDraft);   // the wardrobe is outside any room — see line ~611
  }, G.profile?.level ?? 1);
}
drawLookSafe = drawLookPicker;

const LOOK_KEY = 'golf.look';
/** Is there a look cached in this browser? False when storage is unavailable. */
const hasLocalLook = () => {
  try { return !!localStorage.getItem(LOOK_KEY); } catch { return false; }
};
const saveLook = look => { try { localStorage.setItem(LOOK_KEY, JSON.stringify(look)); } catch { /* private mode */ } };
const loadLook = () => {
  try { return normaliseLook(JSON.parse(localStorage.getItem(LOOK_KEY) || 'null')); }
  catch { return normaliseLook(null); }
};

/** The clubhouse: career, pro shop and the bag, all outside any room. */
function renderClubhouse() {
  /* The mode picker. Rendered here with everything else on the screen, so
     it cannot fall out of step with the profile the server just sent. */
  HUD.renderDifficulty(G.profile?.difficulty || DEFAULT_DIFFICULTY, pickDifficulty);

  const prof = G.profile;
  HUD.renderCareer(prof);
  /* The record board. Asked for rather than pushed: it is global data that
     changes rarely, and the clubhouse is the only place that wants all of it
     at once. Rendered from whatever we last heard, so opening the clubhouse
     is never a blank panel waiting on a round trip. */
  HUD.renderRecords(COURSES, G.records || {}, G.myPid);
  Net.records(r => { G.records = r; HUD.renderRecords(COURSES, r, G.myPid); });
  HUD.renderRewards(prof);
  HUD.renderBinds();
  Net.ranking(d => HUD.renderWorld(d, G.myPid));
  HUD.renderShop(prof, item => Net.buy(item));
  bagDraft = me()?.bag?.length ? me().bag.slice()
    : (bagDraft || normaliseBag(DEFAULT_BAG, { pad: true }));
  HUD.renderBag(bagDraft, toggleClubInBag, G.profile?.clubTier ?? 0, G.profile?.clubSkin || 'stock');
  HUD.renderClubSkins(G.profile, id => Net.setClubSkin(id, res => {
    if (res?.error) return HUD.toast(res.error, 'warn', 3000);
    if (G.profile) G.profile.clubSkin = res.skin;
    HUD.renderClubSkins(G.profile, () => {});
    HUD.renderBag(bagDraft, toggleClubInBag, G.profile?.clubTier ?? 0, res.skin);
  }));
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
        stars: prof.stars, rounds: prof.rounds, best: prof.best,
        xp: prof.xp                       // or a wiped host eats every unlock
      }));
    } catch { /* over quota or no store: the server still has it */ }
  }
}

function renderLobbyAll(r) {
  const isHost = r.hostPid === G.myPid;
  const course = getCourse(r.courseId);
  HUD.renderLobby(r, G.myPid);
  HUD.renderCourses(COURSES, r.courseId, isHost, id => Net.pickCourse(id),
    Object.fromEntries(COURSES.map(c => [c.id, ratingsFor(c)])));
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
  HUD.renderBag(bagDraft, toggleClubInBag, G.profile?.clubTier ?? 0, G.profile?.clubSkin || 'stock');
  HUD.renderClubSkins(G.profile, id => Net.setClubSkin(id, res => {
    if (res?.error) return HUD.toast(res.error, 'warn', 3000);
    if (G.profile) G.profile.clubSkin = res.skin;
    HUD.renderClubSkins(G.profile, () => {});
    HUD.renderBag(bagDraft, toggleClubInBag, G.profile?.clubTier ?? 0, res.skin);
  }));
  Net.prefs({ bag: bagDraft });
}

document.getElementById('btnBagReset').addEventListener('click', () => {
  bagDraft = normaliseBag(DEFAULT_BAG, { pad: true });
  HUD.renderBag(bagDraft, toggleClubInBag, G.profile?.clubTier ?? 0, G.profile?.clubSkin || 'stock');
  HUD.renderClubSkins(G.profile, id => Net.setClubSkin(id, res => {
    if (res?.error) return HUD.toast(res.error, 'warn', 3000);
    if (G.profile) G.profile.clubSkin = res.skin;
    HUD.renderClubSkins(G.profile, () => {});
    HUD.renderBag(bagDraft, toggleClubInBag, G.profile?.clubTier ?? 0, res.skin);
  }));
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
  ['rosterCollapse', 'rosterPanel', 'lg_fold_roster'],
  ['mapCollapse', 'miniPanel', 'lg_fold_map']
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
  // scenery density is baked into the hole's geometry, so a change to it
  // needs the hole rebuilt — setQuality says when that is
  const rebuild = scene.setQuality(HUD.quality);
  if (rebuild && G.room && G.loadedKey) {
    const key = G.loadedKey, i = key.lastIndexOf(':');
    G.loadedKey = null;
    ensureHole(key.slice(0, i), Number(key.slice(i + 1)));
    syncAvatars(G.room.players || []);
  }
  HUD.toast({ low: 'Low — lightest, no shadows', medium: 'Medium', high: 'High — full shadows and scenery' }[HUD.quality] || HUD.quality, 'info', 1800);
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
/* The one path onto a course, called by the legend and by the pinned
   button. Two copies of this is how they got to disagree. */
function startRoundNow() {
  HUD.homeError('');
  const btn = document.getElementById('btnPlay');
  if (btn?.disabled) return;                 // a double click must not make two rooms
  if (btn) btn.disabled = true;
  HUD.show('load');
  HUD.loading('Walking to the first tee…');
  Net.create(nameValue(), pickedCourse, res => {
    if (btn) btn.disabled = false;
    if (!res.ok) { HUD.show('landing'); return HUD.homeError(res.error); }
    G.joined = true; G.myPid = res.pid; G.room = res.state;
    stampRoomUrl(res.code);
    Net.start();                             // no lobby: tee off
    route();
  });
}
document.getElementById('btnPlay')?.addEventListener('click', startRoundNow);

document.getElementById('btnCreate').addEventListener('click', () => {
  HUD.homeError('');
  Net.create(nameValue(), pickedCourse, res => {
    if (!res.ok) return HUD.homeError(res.error);
    G.joined = true; G.myPid = res.pid; G.room = res.state;
    stampRoomUrl(res.code);
    route();
  }, pickedFormat);
});
/* Joining by code, from the box or from the online panel. */
/**
 * @param toWatch  the player pressed Watch rather than Join. The request is
 *   identical — the server decides whether a joiner is a spectator, and it
 *   already does that correctly — so this only changes what we SAY. Sending
 *   a "spectate" flag would be a second source of truth about a decision
 *   the server has to make anyway.
 */
function joinByCode(code, toWatch = false) {
  HUD.homeError('');
  Net.join(code, nameValue(), res => {
    if (!res.ok) return HUD.homeError(res.error);
    G.joined = true; G.myPid = res.pid; G.room = res.state;
    stampRoomUrl(res.code);
    route();
    if (res.spectator) {
      HUD.toast(toWatch
        ? "Watching — you're in at the next hole."
        : "Round in progress — you're in at the next hole.", toWatch ? 'good' : 'warn', 3400);
    }
  });
}

/* Who else is on the course, refreshed while the menu is open and never
   while a round is running — it is a menu decoration, not a game system, and
   it must not put traffic on the wire during play. */
let presenceTimer = null;
function watchPresence() {
  clearInterval(presenceTimer);
  const tick = () => {
    if (G.screen !== 'home' || !Net.socket?.connected) return;
    Net.presence(list => HUD.renderOnline(list, G.myPid, joinByCode));
  };
  tick();
  presenceTimer = setInterval(tick, 8000);
}

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

    /* Grouped by where in the world the course is, because "Scotland or
       Arizona?" is a question a player can answer and "course 2 or course 4?"
       is not.  The grouping is data — a course declares its continent in
       biomes.js and lands here automatically, so adding one is a one-line
       change and empty regions never render. */
    for (const region of coursesByRegion()) {
      const group = document.createElement('div');
      group.className = 'cp-region';

      const head = document.createElement('div');
      head.className = 'cp-rhead';
      head.innerHTML = `<span class="cp-flag">${region.flag}</span>` +
        `<span class="cp-rname">${region.name}</span>` +
        `<span class="cp-rblurb">${region.blurb}</span>`;
      group.appendChild(head);

      const list = document.createElement('div');
      list.className = 'cp-rlist';
      for (const c of region.courses) {
        const meta = COURSES.find(x => x.id === c.id) || {};
        const b = document.createElement('button');
        b.className = 'cpbtn' + (c.id === pickedCourse ? ' on' : '');
        b.type = 'button';
        b.setAttribute('aria-pressed', c.id === pickedCourse ? 'true' : 'false');
        b.textContent = c.name;
        /* The difficulty, computed here rather than fetched: `ratingsFor` is
           shared code reading the same generated geometry the server reads,
           so the answer is identical and costs no round trip. Regions are
           filtered out of COURSE_ORDER, which is itself difficulty-ordered,
           so the courses inside each region already run easiest first. */
        const rt = meta.id ? ratingsFor(meta) : null;
        if (rt) {
          const band = HUD.slopeBand(rt.slope);
          const chip = document.createElement('em');
          chip.className = 'cp-diff ' + band.cls;
          chip.textContent = band.name;
          chip.title = `Course rating ${rt.rating} · slope ${rt.slope}`;
          b.appendChild(chip);
        }
        const sub = document.createElement('small');
        sub.textContent = `${c.region} · par ${meta.par ?? 36}`
          + (rt ? ` · ${meta.yards} yds` : '');
        b.appendChild(sub);
        b.addEventListener('click', () => {
          if (c.id === pickedCourse) return;
          pickedCourse = c.id;
          try { localStorage.setItem('lg_course', c.id); } catch { /* ignore */ }
          drawCourses();
          refreshCourseLegend();

  /* ---- data credits ----------------------------------------------------
     An imported course is built from OpenStreetMap data, which is ODbL and
     requires attribution wherever the derived work is shown. Collected from
     the courses actually on the roster rather than hard-coded, so it says
     nothing on an install with no imports and cannot go stale on one that
     has them. */
  const attribs = [...new Set(COURSES.map(c => c.attribution).filter(Boolean))];
  const attribEl = document.getElementById('lpAttrib');
  if (attribEl && attribs.length) {
    attribEl.hidden = false;
    attribEl.textContent = 'Course data ' + attribs.join(' · ');
  }
          clearMenuBackdrop();     // drop the old tee...
          G.loadedKey = null;
          menuBackdrop();          // ...and stand on the new one
        });
        list.appendChild(b);
      }
      group.appendChild(list);
      row.appendChild(group);
    }
  };
  bindWardrobeDrag();      // defined above and, until this line, never called

  drawCourses();
  refreshCourseLegend();   // the legend must be right on the first paint too

  /* The format picker. Hosting only — a scramble needs four to eight people
     and offering it on the solo button would be an invitation to a game that
     cannot start. */
  const fmtRow = document.getElementById('formatRow');
  function drawFormats() {
    if (!fmtRow) return;
    fmtRow.textContent = '';
    for (const f of FORMATS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fmtbtn' + (f.id === pickedFormat ? ' on' : '');
      b.setAttribute('aria-pressed', f.id === pickedFormat ? 'true' : 'false');
      b.textContent = f.name;
      const sub = document.createElement('small');
      sub.textContent = f.teams ? `${f.teams * f.per} players · ${f.blurb}` : f.blurb;
      b.appendChild(sub);
      b.addEventListener('click', () => {
        pickedFormat = f.id;
        try { localStorage.setItem('lg_format', f.id); } catch { /* private mode */ }
        drawFormats();
      });
      fmtRow.appendChild(b);
    }
  }
  drawFormats();

  /* ---- PLAY ONLINE: region, mode, the browser and quick match ------------
     "Play with friends" needed a code somebody handed you, so a player with
     nobody to play with had exactly one option: play alone. This is the
     other half of a multiplayer game. */
  const qmRegion = document.getElementById('qmRegion');
  const qmFormat = document.getElementById('qmFormat');
  refreshRoomsSafe = () => refreshRooms();
  const refreshRooms = () => Net.openRooms(list => {
    const reg = qmRegion?.value || 'any';
    HUD.renderRooms(reg === 'any' ? list : list.filter(r => r.region === reg), joinByCode);
  });
  if (qmRegion) {
    qmRegion.innerHTML = '<option value="any">Anywhere</option>' +
      REGIONS.map(r => `<option value="${r.id}">${r.flag} ${r.name}</option>`).join('');
    try { qmRegion.value = localStorage.getItem('lg_region') || 'any'; } catch { /* ignore */ }
    qmRegion.addEventListener('change', () => {
      try { localStorage.setItem('lg_region', qmRegion.value); } catch { /* ignore */ }
      refreshRooms();
    });
  }
  if (qmFormat) {
    qmFormat.innerHTML = FORMATS.map(f => `<option value="${f.id}">${f.name}</option>`).join('');
    qmFormat.value = pickedFormat;
    qmFormat.addEventListener('change', () => {
      pickedFormat = qmFormat.value;
      try { localStorage.setItem('lg_format', pickedFormat); } catch { /* ignore */ }
      drawFormats();
    });
  }
  document.getElementById('onlineBox')?.addEventListener('toggle', e => {
    if (e.target.open) refreshRooms();
  });
  /* One button for somebody who just wants to play with people: join the
     fullest room that fits, or open one if there is none. Being told "no
     rooms" would be a dead end on the one control that exists to avoid them. */
  document.getElementById('btnQuick')?.addEventListener('click', () => {
    HUD.homeError('');
    const region = qmRegion?.value || 'any';
    Net.quickMatch(pickedFormat, region, res => {
      if (!res?.ok) return HUD.homeError('Could not reach the course — try again.');
      if (res.joined) return joinByCode(res.code);
      HUD.show('load');
      HUD.loading('Opening a game…');
      Net.create(nameValue(), res.courseId, r => {
        if (!r.ok) { HUD.show('landing'); return HUD.homeError(r.error); }
        G.joined = true; G.myPid = r.pid; G.room = r.state;
        stampRoomUrl(r.code);
        route();
      }, res.format);
    });
  });

  /* The course count and the venue strip are written from the data, not
     typed into the markup. Both still said "five courses" after the eighth
     one landed — a small lie on the front page, and the kind a player reads
     as nobody being home. */
  const wmSub = document.getElementById('wmSub');
  if (wmSub) wmSub.textContent =
    `${COURSES.length} courses · nine holes · up to eight friends`;
  const venues = document.getElementById('venueStrip');
  if (venues) {
    venues.textContent = '';
    COURSES.forEach((c, i) => {
      if (i) { const dot = document.createElement('i'); dot.textContent = '·'; venues.appendChild(dot); }
      const sp = document.createElement('span'); sp.textContent = c.name; venues.appendChild(sp);
    });
  }

  /* Hovering or focusing the panel is enough to get the close-up. You should
     be able to LOOK at your golfer without having to change something first. */
  const golferPanel = document.querySelector('.home-golfer');
  if (golferPanel) {
    golferPanel.addEventListener('pointerenter', () => showGolferCloseUp(2.5));
    golferPanel.addEventListener('pointermove', () => showGolferCloseUp(2.5));
    golferPanel.addEventListener('focusin', () => showGolferCloseUp(5));
  }

  // the dice: a whole outfit in one press, for people who hate picking
  document.getElementById('btnRandomLook')?.addEventListener('click', () => {
    lookDraft = randomLook();      // the whole wardrobe, not just the colours
    saveLook(lookDraft);
    drawLookPicker();
    refreshMenuAvatar();
    showGolferCloseUp(6);
    Net.setLook(lookDraft);   // the wardrobe is outside any room — see line ~611
  });

  // The title screen is the course itself — unless this visit is an invite
  // link, which goes straight to its own room and will build its own hole.
  if (!room) menuBackdrop();

  // the clubhouse: career, pro shop and bag, reachable without hosting a game
  const openClubhouse = () => {
    renderClubhouse();
    /* Showing the screen comes FIRST and the tab wiring is guarded, in that
       order deliberately. Anything that can throw between the click and
       HUD.show leaves the player looking at a button that does nothing —
       and the tabs are a convenience, while getting into the clubhouse at
       all is not. */
    G.screen = 'shop';
    HUD.show('shop');
    try { HUD.bindClubhouse?.(); } catch (e) { console.error('clubhouse tabs:', e); }
  };
  /* Named on HUD as well as bound to a button, because the button it used
     to live on no longer exists — the clubhouse is a landing-page legend
     now, and openLegend calls HUD.openClubhouse. Assigning it here is what
     was missing: the legend rendered, was clickable, and did nothing. */
  HUD.openClubhouse = openClubhouse;
  HUD.el.btnClubhouse?.addEventListener('click', openClubhouse);
  /* ---- the two phone-only toggles -------------------------------------
     Both exist because a phone has room for the golf OR for a panel, never
     both — so everything that is not needed on every shot is one tap away
     rather than permanently on screen. */
  document.getElementById('tbSay')?.addEventListener('click', () => {
    document.body.classList.toggle('saying');
  });
  /* Saying something closes the tray: on a phone the tray covers the swing
     controls, so leaving it open after a tap would mean the next shot is
     played blind. */
  document.getElementById('phraseBar')?.addEventListener('click', e => {
    if (e.target.closest('.phrasebtn')) document.body.classList.remove('saying');
  });
  document.getElementById('tbMore')?.addEventListener('click', () => {
    const board = document.getElementById('board');
    board?.classList.toggle('open');
  });

  /* ---- the HUD gets out of the way -------------------------------------
     A golf game is a game about looking at a landscape, and the landscape
     was permanently framed by six panels. This fades the chrome — the
     panels, not the controls — when nothing has happened for a few seconds,
     and brings it straight back on any input.

     WHAT NEVER FADES: the swing meter and the club, because they are what
     you are using; and nothing fades at all while a shot is in the air or
     it would vanish at the exact moment somebody is watching it. */
  let idleTimer = 0;
  const IDLE_MS = 4200;
  const wake = () => {
    document.body.classList.remove('hudfade');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (G.screen === 'game' && !G.anim && !radialOpen() && !HUD.emotesOpen()) {
        document.body.classList.add('hudfade');
      }
    }, IDLE_MS);
  };
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel']) {
    window.addEventListener(ev, wake, { passive: true });
  }
  wake();

  /* ---- the radial ------------------------------------------------------
     Everything that is not hitting the ball, on one gesture. Bound as a
     HOLD, so More still opens the scorecard on a tap — the wheel is added
     to that button rather than taking it over.

     This is what lets the phone layout stop drawing a labelled button per
     action: the actions are all still there, they are just not all on
     screen at once. */
  const RADIAL_ACTIONS = () => {
    const seated = mode() === 'drive' || mode() === 'ride';
    return [
      { id: 'emote', icon: '😄', name: 'Emote' },
      { id: 'chat',  icon: '💬', name: 'Say something' },
      { id: 'toBall', icon: '🏃', name: seated ? 'Get out first' : 'Jog to my ball',
        locked: seated, sub: 'not from the cart' },
      { id: 'cart',  icon: '🛺', name: seated ? 'Get out' : 'Get in the cart' },
      { id: 'hail',  icon: '📣', name: 'Hail a cart' },
      { id: 'map',   icon: '🗺️', name: 'Hole map' },
      { id: 'view',  icon: '🎥', name: 'Change view' },
      { id: 'card',  icon: '📋', name: 'Scorecard' }
    ];
  };
  /* ON DESKTOP TOO. The wheel was bound only to the phone-only More button,
     so on a mouse it existed and was unreachable — the same class of mistake
     as the clubhouse legend that rendered, was clickable, and did nothing.
     Middle-click or hold the right button anywhere on the course; both are
     gestures nothing else in the game uses. */
  const stage = document.getElementById('stage') || document.body;
  stage.addEventListener('contextmenu', e => {
    if (G.screen === 'game') e.preventDefault();   // the hold opens the wheel
  });
  /* ONLY DURING A ROUND. Every action on the wheel is a thing you do on a
     golf course, and binding it to the whole stage meant right-holding in
     the clubhouse or on the landing page opened a menu offering to put you
     in a cart. An empty list is refused by openRadial, so this is also what
     stops it appearing there at all. */
  bindRadial(stage, () => (G.screen === 'game' ? RADIAL_ACTIONS() : []),
             (id, item) => radialPick(id, item),
             /* Mouse only. On touch this surface is the swing — see the note
                in bindRadial. The More button carries the wheel on a phone. */
             { holdMs: 220, buttons: [1, 2], mouseOnly: true });
  bindRadial(document.getElementById('tbMore'), RADIAL_ACTIONS, (id, item) => {
    radialPick(id, item);
  });

  function radialPick(id, item) {
    if (!id) { if (item) HUD.toast(`${item.name} — ${item.sub || 'not now'}`, 'warn', 1500); return; }
    if (id === 'emote') {
      HUD.renderEmotes(G.profile?.level ?? 1, e => { Net.emote(e); HUD.showEmotes(false); });
      HUD.showEmotes(true);
    } else if (id === 'chat') document.body.classList.add('saying');
    else if (id === 'toBall') jogToMyBall();
    else if (id === 'cart') toggleCart();
    else if (id === 'hail') hailRide();
    else if (id === 'map') toggleMap();
    else if (id === 'view') toggleView();
    else if (id === 'card') document.getElementById('board')?.classList.toggle('open');
  }
  /* The scorecard header is a tap target in its own right, so the card can
     be closed by the thing that opened it. */
  document.querySelector('#board .board-head')?.addEventListener('click', e => {
    if (window.innerWidth <= 560 && !e.target.closest('.roomtag')) {
      document.getElementById('board')?.classList.toggle('open');
    }
  });

  HUD.el.btnShopBack.addEventListener('click', () => route());
  HUD.bindLevelTrack();
  HUD.el.bdBack.addEventListener('click', () => route());
  HUD.onRecordsTab = () => Net.records(r => { G.records = r; HUD.renderRecords(COURSES, r, G.myPid); });

  /* ---- the wardrobe ---------------------------------------------------- */
  HUD.onWardrobe = applyWardrobe;
  document.getElementById('btnWardrobe')?.addEventListener('click', openWardrobe);
  HUD.el.wdPrev.addEventListener('click', () => { wd.auto = false; syncAuto(); wd.hold = 0; wdCourse(wd.idx - 1); });
  HUD.el.wdNext.addEventListener('click', () => { wd.auto = false; syncAuto(); wd.hold = 0; wdCourse(wd.idx + 1); });
  HUD.el.wdAuto.addEventListener('click', () => { wd.auto = !wd.auto; wd.hold = 0; syncAuto(); });
  const syncAuto = () => {
    HUD.el.wdAuto.classList.toggle('on', wd.auto);
    HUD.el.wdAuto.textContent = wd.auto ? '⏸' : '▶';
    HUD.el.wdAuto.title = wd.auto ? 'Stop cycling' : 'Cycle through the courses';
  };
  syncAuto();

  HUD.el.wdRandom.addEventListener('click', () => {
    lookDraft = normaliseLook(randomLook(), 0, undefined, G.profile?.level ?? 1);
    saveLook(lookDraft); refreshMenuAvatar();
    Net.setLook(lookDraft);   // the wardrobe is outside any room — see line ~611
    drawWardrobe();
  });

  /* "See in-game" is the honest version of a preview: it puts you on the
     first tee of the course currently behind you, in what you are wearing,
     with the real camera. Everything the wardrobe shows is already the real
     renderer, so this is not a different picture — it is the same golfer at
     the distance you will actually play them from, which is the one thing
     the turntable cannot tell you. */
  document.getElementById('wdCustom')?.addEventListener('click', () => {
    HUD.wdDetail = !HUD.wdDetail;
    document.getElementById('wdCustom').textContent = HUD.wdDetail ? 'Done customising' : 'Customise';
    drawWardrobe();
  });
  HUD.el.wdSeeIn?.addEventListener('click', () => {
    wd.auto = false; syncAuto();
    G.screen = 'landing';
    HUD.show('landing');
    showGolferCloseUp(7);
    HUD.toast('This is your golfer on the first tee. Press Play when you like it.', 'info', 3600);
  });

  HUD.el.wdDone.addEventListener('click', () => {
    wd.auto = false; syncAuto();
    drawLookPicker();
    route();
  });
  /* ---- your name ------------------------------------------------------
     Checked as you type and CLAIMED when you leave the field. A name is
     taken for good, so finding out it was gone after pressing Play is the
     wrong moment to find out. */
  const nmState = document.getElementById('nameState');
  const nmSuggest = document.getElementById('nameSuggest');
  let nmTimer = 0, nmLast = '';
  const showName = (cls, msg) => {
    if (!nmState) return;
    nmState.className = 'nm-state ' + cls;
    nmState.textContent = msg || '';
  };
  const checkNameSoon = () => {
    const v = HUD.el.inpName.value.trim();
    clearTimeout(nmTimer);
    nmSuggest.innerHTML = '';
    if (!v) { showName('', ''); return; }
    showName('busy', 'Checking…');
    /* Debounced, because this is a socket round trip on every keystroke
       otherwise — and 300 ms is under the point where a person notices a
       delay but well over the gap between two keys. */
    nmTimer = setTimeout(() => {
      Net.checkName(v, res => {
        if (HUD.el.inpName.value.trim() !== v) return;   // they kept typing
        if (res.ok) { showName('ok', 'That name is free ✓'); return; }
        showName('bad', res.reason || 'Not available.');
        nmSuggest.innerHTML = (res.suggestions || [])
          .map(t => `<button type="button" data-nm="${t}">${t}</button>`).join('');
      });
    }, 300);
  };
  HUD.el.inpName.addEventListener('input', checkNameSoon);
  nmSuggest?.addEventListener('click', e => {
    const b = e.target.closest('[data-nm]');
    if (!b) return;
    HUD.el.inpName.value = b.dataset.nm;
    checkNameSoon();
  });
  const claimNameNow = () => {
    const v = HUD.el.inpName.value.trim();
    if (!v || v === nmLast) return;
    Net.claimName(v, res => {
      if (res.error) { showName('bad', res.error); return; }
      nmLast = res.name;
      HUD.el.inpName.value = res.name;
      showName('ok', res.charged ? `Changed — ${res.charged} coins.` : 'Saved ✓');
      Net.lastName = res.name;
      Net.fetchProfile();
    });
  };
  HUD.el.inpName.addEventListener('blur', claimNameNow);

  /* ---- friends --------------------------------------------------------- */
  HUD.bindFriends();
  let myFriendCode = null;
  const drawFriends = res => {
    if (res?.state) myFriendCode = res.state.code || myFriendCode;
    HUD.renderFriends(res?.state, res?.people);
  };
  const loadFriends = () => {
    Net.friends('state', {}, drawFriends);
    // the feed rides on the same panel opening, so it costs no extra poll
    Net.feed(items => HUD.renderFeed(items));
  };
  loadFriendsSafe = loadFriends;
  /* Pushed, not polled. Somebody accepting your request while you are
     looking at the panel should appear in it — and a poll fast enough to
     feel live is a poll nobody should be paying for. */
  Net.onFriends(drawFriends);

  HUD.onFriendAct = (act, d) => {
    HUD.friendError('');
    if (act === 'mycode') {
      if (!myFriendCode) return HUD.friendError('Not connected yet.');
      /* Copied AND shown. A code you can only read off the screen is one
         people retype wrong; a code that is only copied is one they cannot
         check. */
      navigator.clipboard?.writeText(myFriendCode).catch(() => {});
      HUD.toast(`Your friend code is ${myFriendCode} — copied.`, 'good', 6000);
      return;
    }
    if (act === 'join') {
      if (d.room) { HUD.el.inpCode.value = d.room; document.getElementById('btnJoin').click(); }
      return;
    }
    if (act === 'request') {
      const code = String(d.code || '').trim();
      if (!code) return HUD.friendError('Paste a friend code first.');
      return Net.friends('request', { code }, res => {
        if (res.error) return HUD.friendError(res.error);
        document.getElementById('frCode').value = '';
        HUD.toast(res.pid ? 'You are now friends.' : 'Request sent.', 'good', 3000);
        drawFriends(res);
      });
    }
    if (act === 'invite') { HUD.onFriendInvite([d.pid]); return; }
    if (act === 'remove' && !confirm('Remove this friend?')) return;
    Net.friends(act, { pid: d.pid }, res => {
      if (res.error) return HUD.friendError(res.error);
      drawFriends(res);
    });
  };

  /* ---- invitations ----------------------------------------------------- */
  HUD.bindInvites();
  const drawInvites = r => HUD.renderInvites(r?.invites || []);
  Net.onInvites(drawInvites);
  Net.invites(drawInvites);
  HUD.onInvite = (id, accept) => {
    Net.answerInvite(id, accept, res => {
      if (res.error) return HUD.toast(res.error, 'warn', 3000);
      if (!res.room) return;
      /* Joining takes the same path a room code does, so an invite and a
         pasted code cannot end up behaving differently. */
      HUD.el.inpCode.value = res.room;
      document.getElementById('btnJoin').click();
    });
  };

  /* Inviting FROM the friends list. The friend has to be in a lobby-ready
     state on the server; this just names them and lets the server refuse. */
  HUD.onFriendInvite = pids => {
    Net.invite(pids, '', res => {
      if (res.error) return HUD.toast(res.error, 'warn', 4000);
      HUD.toast(res.sent?.length ? `Invited ${res.sent.join(', ')}.`
                                 : 'Nobody could be invited.', 'good', 3000);
    });
  };

  /* ---- the ranking boards --------------------------------------------- */
  HUD.bindBoards();
  const courseNames = COURSE_ORDER.map(id => ({ id, name: courseMeta(id).name }));
  const loadBoards = (courseId) => {
    Net.boards(courseId || HUD.rkCourse || pickedCourse, data => {
      HUD.renderRankMe(G.profile, data.me,
        Net.lastName || document.getElementById('inpName')?.value);
      HUD.renderBoards(data, G.myPid, courseNames);
    });
  };
  HUD.onBoards = loadBoards;
  HUD.onWorldTab = () => Net.ranking(d => HUD.renderWorld(d, G.myPid));

  document.getElementById('btnBindsReset')?.addEventListener('click', () => {
    resetBinds();
    HUD.renderBinds();
  Net.ranking(d => HUD.renderWorld(d, G.myPid));
    HUD.toast('Controls back to defaults.', 'info', 1800);
  });

  /* THE FRONT DOOR.
     An invite link is somebody being asked to join a specific game right
     now — sending them to a landing page first would be answering a knock
     at the door with a brochure. Everybody else gets the landing page. */
  if (room) {
    HUD.show('landing');
  } else {
    G.screen = 'landing';
    HUD.show('landing');
    HUD.el.lpLegend.addEventListener('click', e => {
      const b = e.target.closest('.lp-item');
      if (!b) return;
      /* Two kinds of legend. One GOES somewhere and takes the intro with it;
         the other opens the side panel in place. Keeping the second kind on
         this page is the whole point — "play with friends" used to mean
         leaving the front door for a screen of form fields. */
      if (b.dataset.panel) { openSide(b.dataset.panel); return; }
      /* "Play now" STARTS A ROUND. It used to hand off to the old home
         screen, where a second Play button did the actual work — but the
         landing page IS the home screen now, so that handed off to the page
         it was already on and the button did nothing at all. */
      /* Play now runs the opener (once a session) and THEN tees off. These
         two were fixed in separate commits and collided: making the legend
         call startRoundNow directly cured "Play now does nothing" and
         skipped the intro entirely, because the intro lived in the path it
         had just stopped using. One await, one order, one place. */
      if (b.dataset.go === 'play') {
        closeSide();
        leaveLanding('play').then(startRoundNow);
        return;
      }
      if (b.dataset.go) leaveLanding(b.dataset.go);
    });
    HUD.el.lpSideClose.addEventListener('click', () => closeSide());
    document.getElementById('lpSide')?.addEventListener('click', e => {
      // picking a course closes the panel: the choice IS the confirmation
      if (e.target.closest('.cpbtn')) setTimeout(closeSide, 220);
    });
    /* Enter on a focused legend is free — they are real buttons. This is for
       the visitor who presses a key at the title screen expecting something
       to happen, which is a thing people do. */
    window.addEventListener('keydown', e => {
      if (G.screen !== 'landing' || introBusy) return;
      if (e.key === 'Enter' || e.key === ' ') {
        if (document.activeElement?.classList?.contains('lp-item')) return;
        e.preventDefault(); leaveLanding('play');
      }
    });
  }
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
  /* ── the boot screen ───────────────────────────────────────────────────
     The static overlay in index.html, now that there is something to say.
     Two jobs, and they are different: the bundle downloading (quick, and
     the player just needs to know it is happening) and the SERVER waking
     (slow, and the player needs to know it is normal and worth waiting for).

     Never a bare "Loading…" once we know it is the second one. A free-tier
     host takes about half a minute to cold-start, and thirty seconds of an
     unexplained spinner is indistinguishable from a broken game — which is
     the single most likely reason somebody arriving from a portal leaves
     before playing. */
  let wakeTries = 0;
  const bootEl = () => document.getElementById('bootScreen');
  const bootSay = (msg, pct) => {
    const m = document.getElementById('bootMsg');
    const b = document.getElementById('bootBar');
    if (m && msg) m.textContent = msg;
    if (b && pct != null) b.style.width = pct + '%';
  };
  const bootDone = () => {
    const el = bootEl();
    if (!el) return;
    el.style.transition = 'opacity .45s ease';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 500);
  };
  /* A loading screen that outlives the load is worse than none, so it comes
     off on a timer if nothing is happening — a boot that threw somewhere
     should leave the player looking at the game rather than at a reassuring
     message about a game they cannot reach.

     But NOT while the server is being woken, which is the one case where a
     long wait is correct and the message is the whole point. Dropping the
     screen at twenty-five seconds into a fifty-second cold start would take
     the explanation away at exactly the moment it is doing its job. */
  setTimeout(() => { if (!wakeTries) bootDone(); }, 25000);
  bootSay('Loading the course…', 25);

  Net.on('offline', () => {
    /* Almost always a sleeping host rather than a dead one: a free-tier
       instance takes about half a minute to cold-start, so the FIRST attempt
       failing is expected, not exceptional.  Say so, keep a visible count so
       the wait reads as progress rather than a hung menu, and never stop
       retrying — the player has nothing else to do here. */
    wakeTries++;
    /* Worded for somebody who has never heard of a cold start. "Waking the
       game server up (attempt 4)" is honest and reads like something going
       wrong; what a player needs to know is that the wait is expected, that
       it is nearly over, and that it will not happen next time. */
    const msg = wakeTries < 14
      ? 'Waking the course up — the server sleeps when nobody is playing. '
        + 'This takes up to a minute the first time, then it is instant.'
      : 'Still trying to reach the game server. Leave this open — it will '
        + 'connect as soon as the server answers.';
    bootSay(msg, Math.min(90, 30 + wakeTries * 5));
    HUD.homeError(wakeTries < 14 ? '' : msg);
    setTimeout(() => Net.connect(), Math.min(3000 + wakeTries * 1000, 10000));
  });
  Net.on('connect', () => {
    wakeTries = 0;
    HUD.homeError('');
    bootSay('Ready', 100);
    bootDone();
  });
  await Net.connect();
  watchPresence();
  /* The quick phrases. Fixed text we wrote, so they skip the filter — and on
     a phone they are the only realistic way to say anything at all. */
  HUD.el.chatText?.addEventListener('keydown', ev => {
    /* The game's key handler bails out on INPUT targets — correctly, so that
       typing never walks the golfer — which means send and close have to be
       handled on the box itself. */
    if (ev.key === 'Enter') {
      ev.preventDefault();
      const t = HUD.chatValue().trim();
      if (t) Net.say(t);
      HUD.showChat(false);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      HUD.showChat(false);
    }
    ev.stopPropagation();
  });
  HUD.renderPhrases(
    [{ id: 'nice', text: 'Nice shot!' }, { id: 'unlucky', text: 'Unlucky.' },
     { id: 'yourturn', text: 'Your turn.' }, { id: 'goodluck', text: 'Good luck!' },
     { id: 'sorry', text: 'Sorry!' }, { id: 'thanks', text: 'Thanks!' }],
    id => Net.phrase(id));
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
