/* =========================================================================
   intro3d.js — an ace on the third at Claude National, from the air
   -------------------------------------------------------------------------
   The old opener was a hand-drawn 2D canvas. It was the right call at the
   time and it is the wrong one now, for a reason that has changed: the
   landing page already renders the real course behind it, so three.js is
   loaded, the terrain is built and the avatars exist before this ever runs.
   There is nothing left to protect against by drawing a fake.

   So this is the actual game. The real hole, the real ball, the real rig,
   six real golfers — shot from a camera that starts two hundred metres up
   and comes down with the ball.

   WHY THE THIRD. It is a 147-yard par 3, and a hole in one has to happen on
   a hole where one is possible. An ace on the 541-yard opener would be the
   first thing the game ever showed a golfer and it would be a lie.

   THE SHAPE OF IT.

     0.0 - 1.4   two hundred metres up, looking straight down the hole. The
                 ball is already in the air.
     1.4 - 3.0   the camera falls with it, tilting from plan view to a low
                 angle as the green comes up.
     3.0 - 3.4   pitch, one hop, and in.
     3.4 - 5.4   six golfers erupt. The camera swings round the flag.
     5.4 - 6.0   settles, and the menu fades up over the top.

   Everything is a function of one clock, so skipping is a seek rather than
   an unwind — press escape at four seconds and the last frame drawn is the
   frame at six.
   ========================================================================= */

import * as THREE from '../../vendor/three.module.js';
import { Avatar } from './avatar.js';
import { normaliseLook, randomLook } from '../shared/avatars.js';

const T_HIGH   = 1400;   // plan view, ball already flying
const T_FALL   = 3000;   // camera descends with the ball
const T_DROP   = 3400;   // pitch, hop, in
const T_PARTY  = 5400;   // six golfers celebrate
const TOTAL    = 6000;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const easeIn = t => { t = clamp(t, 0, 1); return t * t; };

/* Where the six stand, as offsets around the green in metres. Deliberately
   NOT evenly spaced: six figures at exactly sixty degrees reads as a menu,
   not as a group of people who walked up to watch. */
const CROWD = [
  { a: -0.30, r: 0.62, clip: 'ace' },
  { a: 0.52,  r: 0.55, clip: 'fistpump' },
  { a: 1.55,  r: 0.68, clip: 'clap' },
  { a: 2.60,  r: 0.58, clip: 'ace' },
  { a: -1.45, r: 0.72, clip: 'dance' },
  { a: 3.55,  r: 0.64, clip: 'flex' }
];

/**
 * Play the opener on an already-built scene.
 *
 * @param scene   the live GolfScene — already rendering the landing aerial
 * @param hole    parkland hole 3
 * @param T       its terrain
 * @param opts    { onStrike, onDrop, onDone }
 */
export function playIntro3D(scene, hole, T, opts = {}) {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  return new Promise(resolve => {
    let t = 0, last = 0, done = false, dropped = false;
    const crowd = [];
    const guards = [];

    const tee = hole.tees?.back || hole.tee;
    const cup = hole.cup || hole.pin;
    const cupY = T.heightAt(cup.x, cup.z);
    const teeY = T.heightAt(tee.x, tee.z);

    /* The flight, as a function of time rather than a simulation. A real
       ShotSim would be more honest and is the wrong tool: it would have to
       be TUNED until it happened to go in, and a scripted arc that lands in
       the cup every time is what this shot is. */
    const dx = cup.x - tee.x, dz = cup.z - tee.z;
    const flightK = ms => clamp((ms - 0) / T_DROP, 0, 1);
    function ballAt(ms) {
      const k = flightK(ms);
      if (ms >= T_DROP) {
        return { x: cup.x, y: cupY - 0.08, z: cup.z, inCup: true };
      }
      /* Two arcs: the flight, then a low hop off the pitch mark into the
         hole. The hop is what makes it read as a golf shot rather than as a
         ball being lowered onto a target. */
      const HOP_AT = 0.88;
      if (k < HOP_AT) {
        const f = k / HOP_AT;
        return {
          x: tee.x + dx * f, z: tee.z + dz * f,
          y: lerp(teeY, cupY, f) + Math.sin(f * Math.PI) * 34
        };
      }
      const f = (k - HOP_AT) / (1 - HOP_AT);
      return {
        x: tee.x + dx * lerp(HOP_AT, 1, f), z: tee.z + dz * lerp(HOP_AT, 1, f),
        y: cupY + Math.sin(f * Math.PI) * 2.1
      };
    }

    /* The camera. Starts on top of the hole looking straight down, falls
       with the ball, and finishes low beside the flag. Every leg is eased,
       because a linear camera move is the loudest possible tell. */
    function place(ms) {
      const b = ballAt(ms);
      const cam = scene.camera;

      if (ms < T_HIGH) {
        // plan view: the whole hole, from two hundred metres
        const k = ease(ms / T_HIGH);
        const mid = { x: (tee.x + cup.x) / 2, z: (tee.z + cup.z) / 2 };
        cam.position.set(mid.x, teeY + lerp(210, 150, k), mid.z + lerp(8, 26, k));
        cam.lookAt(mid.x, teeY, mid.z);
      } else if (ms < T_FALL) {
        /* Falling with the ball. The camera trails it and tilts from
           overhead to level as it comes down, which is the shot every
           broadcast uses for a tee shot on a short hole. */
        const k = ease((ms - T_HIGH) / (T_FALL - T_HIGH));
        const back = lerp(30, 17, k);
        const up = lerp(150, 9, k);
        const dir = Math.atan2(dx, dz);
        cam.position.set(b.x - Math.sin(dir) * back, b.y + up, b.z - Math.cos(dir) * back);
        cam.lookAt(b.x, b.y - lerp(40, 1.5, k), b.z);
      } else if (ms < T_PARTY) {
        /* The camera has to sit OUTSIDE the ring of golfers, or it stands
           among them and four of the six are behind it — which is what the
           first pass did. The crowd is at about 0.7 of the green radius, so
           the orbit is roughly double that, and high enough to look down on
           the whole group rather than through it. */
        const k = ease((ms - T_FALL) / (T_PARTY - T_FALL));
        const ring = Math.max(12, hole.green.r * 1.15);
        const a = -0.75 + k * 1.35;
        const r = lerp(ring * 1.25, ring, k);
        cam.position.set(cup.x + Math.sin(a) * r, cupY + lerp(7.5, 5.2, k), cup.z + Math.cos(a) * r);
        cam.lookAt(cup.x, cupY + lerp(1.0, 1.5, k), cup.z);
      } else {
        // settle, and hold while the UI comes up over it
        const k = ease((ms - T_PARTY) / (TOTAL - T_PARTY));
        const ring = Math.max(12, hole.green.r * 1.15);
        const a = 0.6 + k * 0.20;
        const r = lerp(ring, ring * 1.08, k);
        cam.position.set(cup.x + Math.sin(a) * r, cupY + lerp(5.2, 5.6, k), cup.z + Math.cos(a) * r);
        cam.lookAt(cup.x, cupY + 1.5, cup.z);
      }
      cam.updateProjectionMatrix();
      scene.setBall('intro', b.x, b.y, b.z);
      return b;
    }

    /* ---- the six ---------------------------------------------------- */
    function buildCrowd() {
      for (let i = 0; i < CROWD.length; i++) {
        const c = CROWD[i];
        const look = normaliseLook(randomLook(), i);
        const av = new Avatar(look, '#f6f9f4');
        const gx = cup.x + Math.sin(c.a) * (hole.green.r * c.r);
        const gz = cup.z + Math.cos(c.a) * (hole.green.r * c.r);
        av.place(gx, T.heightAt(gx, gz), gz, Math.atan2(cup.x - gx, cup.z - gz));
        av.setTerrain?.(T);
        av.setWind?.(2, 0.6);
        scene.actorGroup.add(av.root);
        crowd.push({ av, clip: c.clip, fired: false });
      }
    }

    function tickCrowd(dt, ms) {
      for (const c of crowd) {
        /* They erupt when the ball DROPS, not on a timer — and staggered,
           because six people reacting on the same frame is a chorus line.
           A crowd reacts in the order it works out what happened. */
        if (!c.fired && ms > T_DROP + Math.random() * 260) {
          c.fired = true;
          c.av.play(c.clip);
        }
        c.av.update(dt, 0);
      }
    }

    function cleanUp() {
      for (const c of crowd) {
        scene.actorGroup.remove(c.av.root);
        c.av.dispose();
      }
      crowd.length = 0;
      for (const g of guards) g();
    }

    function finish() {
      if (done) return;
      done = true;
      cleanUp();
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', finish);
      resolve();
    }
    function onKey(e) { if (e.key || e.code) finish(); }

    /** One frame. Returns false when the sequence is over. */
    function step(dt) {
      if (done) return false;
      t += dt * 1000;
      const ms = Math.min(t, TOTAL);

      if (t >= T_HIGH && !opts._struck) { opts._struck = true; opts.onStrike?.(); }
      if (!dropped && ms >= T_DROP) { dropped = true; opts.onDrop?.(); }

      place(ms);
      tickCrowd(dt, ms);
      scene.update(dt);
      scene.render(scene.camera);

      if (t >= TOTAL) { finish(); return false; }
      return true;
    }

    scene.syncBalls([{ pid: 'intro', color: '#f6f9f4', spectator: false }]);
    buildCrowd();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', finish);

    /* The same failsafe the 2D opener needed, for the same reason: every
       other way out of this runs inside a frame, and frames stop in a
       backgrounded tab. setTimeout does not. */
    const failsafe = setTimeout(finish, reduced ? 700 : TOTAL + 2500);
    guards.push(() => clearTimeout(failsafe));

    if (reduced) {
      place(TOTAL);
      for (const c of crowd) { c.fired = true; c.av.play(c.clip); c.av.update(0.016, 0); }
      scene.render(scene.camera);
      return;
    }
    opts.onFrame?.(step);      // the caller drives it from its own loop
  });
}

export const INTRO3D_TOTAL = TOTAL;
