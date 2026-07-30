/* =========================================================================
   main.js — the client: input, camera, shot playback, screen routing
   ========================================================================= */

import * as THREE from '/vendor/three.module.js';
import { GolfScene } from './scene.js';
import { Avatar } from './avatar.js';
import { Walker } from './walker.js';
import { CartManager } from './carts.js';
import { reactionFor, REACTION_TIER } from './celebrations.js';
import { mph } from './cart3d.js';
import { BOARD_RADIUS } from '../shared/cart.js';
import { Roster } from './roster.js';
import { CameraRig, fitMapCamera } from './cameras.js';
import { SwingController, SWING } from './swing.js';
import { HUD } from './hud.js';
import { Net } from './net.js';

import { allCourses, getCourse } from '../shared/coursegen.js';
import { terrainFor, SURFACES } from '../shared/terrain.js';
import { BIOMES, COURSE_ORDER } from '../shared/biomes.js';
import { ShotSim, calibrateCarries, suggestedPower, BALL_RADIUS } from '../shared/ballistics.js';
import { CLUBS, CLUB_BY_KEY, suggestClub, clubIndex, normaliseBag, DEFAULT_BAG, BAG_SIZE } from '../shared/clubs.js';
import { toYards, clamp, lerp } from '../shared/rng.js';
import { normaliseLook, SHOT_RADIUS, EYE_HEIGHT } from '../shared/avatars.js';

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

/**
 * Where a golfer actually stands to play a ball: a step to the side of the
 * line, not on top of it — otherwise the avatar hides the ball completely.
 */
function addressSpot(ball, aim) {
  return { x: ball.x - Math.cos(aim) * 1.15, z: ball.z + Math.sin(aim) * 1.15 };
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

function autoClub() {
  if (clubManual || !G.T) return;
  const b = ballOf(G.myPid);
  const d = G.T.toPin(b.x, b.z);
  const lie = G.T.surfaceAt(b.x, b.z);
  clubKey = suggestClub(d, lie.id, lie.id === 'green', myBag()).key;
  swing.clubKey = clubKey;
  HUD.setClub(CLUB_BY_KEY[clubKey], lie.id);
}
function stepClub(dir) {
  const bag = myBag();
  let i = clubIndex(clubKey, bag);
  if (i < 0) i = bag.indexOf(suggestClub(999, 'fairway', false, bag).key);
  clubKey = bag[clamp(i + dir, 0, bag.length - 1)];
  swing.clubKey = clubKey;
  clubManual = true;
  HUD.setClub(CLUB_BY_KEY[clubKey], G.T ? G.T.surfaceAt(ballOf(G.myPid).x, ballOf(G.myPid).z).id : 'fairway');
  refreshAimPreview(true);
}

/* ===================================================================== */
/*  AIM PREVIEW                                                           */
/* ===================================================================== */
let previewKey = '';
function refreshAimPreview(force) {
  if (!canSwing() || !G.T) { scene.setAimLine(null); previewKey = ''; return; }
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
  const previewPower = isPutt
    ? (suggestedPower(G.T, b.x, b.z, clubKey, swing.aim, G.wind, toPinD + 0.45) ?? 1)
    : 1;
  const sim = new ShotSim(G.T, {
    x: b.x, z: b.z, clubKey, power: Math.min(previewPower, 1.12), aim: swing.aim,
    faceDeg: 0, attackDeg: 0, wind: G.wind, ignoreCup: true
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
  scene.setAimLine(pts);

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
  } else {
    scene.setAimLineColor(0xffffff);
    scene.setSlopeRead(null);
  }

  // The caddie mark: how hard to hit it to finish at the flag.  On a putt aim
  // to run it a foot and a half past — a putt that dies at the hole never
  // goes in.
  const toPin = G.T.toPin(b.x, b.z);
  const past = CLUB_BY_KEY[clubKey].putter ? 0.45 : 0;
  HUD.setTargetPower(suggestedPower(G.T, b.x, b.z, clubKey, swing.aim, G.wind, toPin + past));
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
      av.place(walker.x, G.T.heightAt(walker.x, walker.z), walker.z, walker.heading);
      // over the ball on your turn you take up the stance, and the club goes
      // back exactly as far as the meter says — the swing you see IS the
      // number you are about to play
      if (mode() === 'swing') {
        av.setClub(clubKey);              // the club in hand IS the club selected
        av.setAddress(true, swing.aim + Math.PI / 2);
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
    faceDeg: m.face || 0, attackDeg: 0, wind: G.wind
  }).runToEnd();
  scene.setLanding(r.x, G.T.heightAt(r.x, r.z), r.z, Math.min(1, Math.abs(m.face || 0) / 7));
  G.landingOn = true;
}

const AIM_RATE = 0.20;              // radians per second — deliberate, not slewing
function stepAim(dt) {
  if (G.screen !== 'game' || !canSwing()) return;
  const fine = keys.has('shift') ? 0.12 : 1;
  let d = 0;
  if (keys.has('arrowleft')) d -= AIM_RATE * fine * dt;
  if (keys.has('arrowright')) d += AIM_RATE * fine * dt;
  if (d) { swing.nudgeAim(d); refreshAimPreview(); }
}

/* A rolling average of real frame time. Averaged over a second so it reads
   steadily rather than flickering on every hitch. */
let _fpsAcc = 0, _fpsN = 0, _fpsAt = 0;
function measureFrame(now) {
  if (!HUD.perfVisible()) return;
  if (_fpsAt) { _fpsAcc += now - _fpsAt; _fpsN++; }
  _fpsAt = now;
  if (_fpsN >= 30) {
    const ms = _fpsAcc / _fpsN;
    const r = scene.renderer.info.render;
    HUD.setPerf(1000 / ms, ms, r.calls, r.triangles, HUD.quality);
    _fpsAcc = 0; _fpsN = 0;
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
  if (swingAv) { swingAv.setClub(msg.shot.clubKey); swingAv.strike(msg.shot.aim); }
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
    if (e.type === 'splash') { scene.fx.burst('splash', e.x, e.y, e.z, 24); rig.kick(0.4); }
    else if (e.type === 'tree') scene.fx.burst('leaves', e.x, e.y, e.z, 8);
    else if (e.type === 'bounce' || e.type === 'land') {
      if (e.speed > 6) {
        const kind = e.surf === 'sand' ? 'sand' : 'grass';
        scene.fx.burst(kind, e.x, e.y, e.z, e.surf === 'sand' ? 16 : 8);
      }
    } else if (e.type === 'holed') { scene.fx.burst('grass', e.x, e.y + 0.2, e.z, 20); }
  }
}

function stepAnim(dt, now) {
  const a = G.anim;
  if (!a) return;

  if (!a.done) {
    const res = a.sim.advance(dt);
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
  if (dur) G.celebUntil = Math.max(G.celebUntil || 0, performance.now() + dur * 1000);
}

const celebrating = () => (G.celebUntil || 0) > performance.now();

/* ===================================================================== */
/*  FRAME                                                                 */
/* ===================================================================== */
let last = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = last ? clamp((now - last) / 1000, 0, 0.1) : 0;
  last = now;
  if (!G.hole) return;

  scene.windDir = G.wind.dir;
  stepAnim(dt, now);

  // walking runs before the camera so the view follows this frame's position
  // rather than lagging it by one
  const m = mode();
  const seated = m === 'drive' || m === 'ride';
  walker.enabled = !seated && G.screen === 'game' && !G.mapOpen && !G.anim
    && G.room?.state === 'playing' && !me()?.finished;
  walker.arrowsAim = m === 'swing';  // arrows become the aim when in range

  if (m === 'drive') {
    carts.readKeys(keys);
    carts.step(dt, G.T, G.hole);
    // the golfer goes where the cart goes, so everything downstream — the
    // roster, the ball gate, the camera — keeps working unchanged
    const seat = carts.body.seat('driver');
    walker.x = seat.x; walker.z = seat.z; walker.heading = carts.body.heading;
    walker.speed = 0;
  } else if (m === 'ride') {
    carts.clearInput();
    const seat = carts.seatFor(G.myPid, G.myPid);
    if (seat) { walker.x = seat.x; walker.z = seat.z; walker.heading = seat.heading; }
    walker.speed = 0;
  } else {
    carts.clearInput();
  }

  stepAim(dt);
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

  if (G.mapOpen) drawMap();
  scene.render(scene.camera);
  measureFrame(now);
}

function updateCamera(dt) {
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
    const speed = carts.driving && carts.body ? mph(carts.body.speed) : 0;
    HUD.setCart({
      seat: carts.driving ? 'Driving' : 'Riding',
      mph: speed,
      who: carts.driving ? (rider ? 'with ' + rider : 'solo') : 'passenger'
    });
  } else HUD.setCart(null);

  if (seated && mine) {
    HUD.setWalkPrompt('Get out of the cart to play — press C');
    return;
  }
  if (!mine || atMyBall()) { HUD.setWalkPrompt(null); return; }
  const d = walker.distanceTo(ballOf(G.myPid));
  HUD.setWalkPrompt('Walk to your ball — ' + Math.round(HUD.dist(d)) + ' ' + HUD.unit() + ' away');
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
  if (me()?.finished) return;
  const why = carts.board(G.T, G.hole, walker.x, walker.z, walker.heading, G.room.players);
  if (why === 'nowhere') return HUD.toast('No room for a cart here.', 'warn');
  if (why) return;
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
  HUD.setAim(((swing.aim - Math.atan2(G.hole.pin.x - b.x, G.hole.pin.z - b.z)) * 180 / Math.PI + 540) % 360 - 180);
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
  if (ev.button === 2 || ev.button === 1 || ev.altKey) {
    looking = { x: ev.clientX, y: ev.clientY };
    canvas.classList.add('looking');
    return;
  }
  if (!canSwing()) return;
  swing.pointerDown(ev.clientX, ev.clientY);
  canvas.classList.add('swinging');
});

window.addEventListener('pointermove', ev => {
  if (looking) {
    const dx = ev.clientX - looking.x, dy = ev.clientY - looking.y;
    looking.x = ev.clientX; looking.y = ev.clientY;
    rig.orbit = clamp(rig.orbit - dx * 0.005, -Math.PI * 0.85, Math.PI * 0.85);
    rig.pitch = clamp(rig.pitch - dy * 0.0016, -0.25, 0.6);
    return;
  }
  if (swing.state !== SWING.IDLE && swing.state !== SWING.DONE) {
    swing.pointerMove(ev.clientX, ev.clientY);
    HUD.setMeter(swing.meter(), true);
  }
});

window.addEventListener('pointerup', () => {
  if (looking) { looking = null; canvas.classList.remove('looking'); return; }
  canvas.classList.remove('swinging');
  if (swing.state === SWING.IDLE || swing.state === SWING.DONE) { swing.cancel(); return; }
  const shot = swing.pointerUp();
  swing.reset();
  if (shot && canSwing()) {
    Net.swing({
      clubKey: shot.clubKey, power: shot.power, aim: shot.aim,
      faceDeg: shot.faceDeg, attackDeg: shot.attackDeg
    });
    swing.enabled = false;
    HUD.showPlaybar(false);
  }
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
  if (!G.room || G.room.state !== 'playing' || me()?.finished) return;
  const b = ballOf(G.myPid);
  if (walker.nearBall(b)) { HUD.toast('You are already at your ball.', 'info', 1200); return; }
  const spot = addressSpot(b, swing.aim);
  walker.goTo(spot.x, spot.z);
}

function toggleMap() {
  G.mapOpen = !G.mapOpen;
  HUD.el.mapwrap.hidden = !G.mapOpen;
  if (G.mapOpen) drawMap();
}
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
  fitMapCamera(scene.mapCamera, G.hole, aspect);

  // Fog is tuned for eye level; from 600 m up it would grey the whole hole out.
  // Everything here mutates shared scene state, so it MUST be unwound even if
  // the render throws — otherwise the course stays fogless for the rest of the
  // round.
  const prev = scene.renderer.getSize(new THREE.Vector2());
  const fog = scene.scene.fog;
  const bg = scene.scene.background;
  try {
    scene.scene.fog = null;
    scene.scene.background = new THREE.Color(0x0d1512);
    scene.renderer.setSize(w, h, false);
    scene.render(scene.mapCamera);
    c.getContext('2d').drawImage(scene.renderer.domElement, 0, 0, w, h);
  } finally {
    scene.scene.fog = fog;
    scene.scene.background = bg;
    scene.renderer.setSize(prev.x, prev.y, false);
    scene.resize();
  }
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
      if (G.anim && G.anim.pid === p.pid) continue;
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
  carts.feed(d.pid, d.cart, performance.now());
  const r = G.remote.get(d.pid);
  if (!r) return;
  r.tx = d.x; r.tz = d.z; r.trot = d.rot; r.moving = !!d.moving;
});

Net.on('profile', prof => {
  const before = G.profile;
  G.profile = prof;
  HUD.renderCareer(prof);
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
  if (!G.joined || !r) { G.screen = 'home'; HUD.show('home'); return; }
  if (r.state === 'lobby') {
    G.screen = 'lobby';
    HUD.show('lobby');
    renderLobbyAll(r);
    return;
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

/** Redraw the appearance swatches, and push any change to the server. */
function drawLookPicker() {
  HUD.renderLook(lookDraft, (key, hex) => {
    lookDraft = normaliseLook({ ...lookDraft, [key]: hex });
    drawLookPicker();
    Net.setLook(lookDraft);
  });
}

function renderLobbyAll(r) {
  const isHost = r.hostPid === G.myPid;
  const course = getCourse(r.courseId);
  HUD.renderLobby(r, G.myPid);
  HUD.renderCourses(COURSES, r.courseId, isHost, id => Net.pickCourse(id));
  HUD.renderTees(course.holes[0], r.teeSet || 'back', isHost, t => Net.pickTees(t));
  HUD.renderColours(r, G.myPid, hex => Net.prefs({ color: hex }), G.profile?.rating || 0);
  bagDraft = me()?.bag?.length ? me().bag.slice() : normaliseBag(DEFAULT_BAG, { pad: true });
  HUD.renderBag(bagDraft, toggleClubInBag);
  lookDraft = normaliseLook(me()?.look);
  drawLookPicker();
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

HUD.el.optQuality.value = HUD.quality;
scene.setQuality(HUD.quality);
HUD.el.optQuality.addEventListener('change', e => {
  HUD.setQuality(e.target.value);
  scene.setQuality(HUD.quality);
  HUD.toast(HUD.quality === 'quality' ? 'Sun shadows on' : 'Performance mode — blob shadows', 'info', 1600);
});

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

document.getElementById('btnCreate').addEventListener('click', () => {
  HUD.homeError('');
  Net.create(nameValue(), COURSE_ORDER[0], res => {
    if (!res.ok) return HUD.homeError(res.error);
    G.joined = true; G.myPid = res.pid; G.room = res.state;
    history.replaceState(null, '', '/?room=' + res.code);
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
    history.replaceState(null, '', '/?room=' + res.code);
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
document.getElementById('aimL').addEventListener('click', () => { swing.nudgeAim(-0.009); refreshAimPreview(true); });   // ~0.5°
document.getElementById('aimR').addEventListener('click', () => { swing.nudgeAim(0.009); refreshAimPreview(true); });
document.getElementById('mapwrap').addEventListener('click', () => toggleMap());

/* ===================================================================== */
/*  BOOT                                                                  */
/* ===================================================================== */
(function boot() {
  const q = new URLSearchParams(location.search);
  const room = (q.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  if (room) HUD.el.inpCode.value = room;
  try { const n = localStorage.getItem('lg_name'); if (n) HUD.el.inpName.value = n; } catch { /* ignore */ }
  (HUD.el.inpName.value ? HUD.el.inpCode : HUD.el.inpName).focus();

  HUD.show('home');
  scene.resize();
  Net.connect();
  requestAnimationFrame(frame);

  window.__G = G; window.__scene = scene; window.__rig = rig; window.__swing = swing;
  window.__frame = frame;        // lets a headless harness drive frames itself
  window.__walker = walker;
  window.__carts = carts;
  window.__ready = true;
})();
