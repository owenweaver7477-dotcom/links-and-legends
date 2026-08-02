/* =========================================================================
   cameras.js — where you watch the golf from
   -------------------------------------------------------------------------
   Four rigs: standing behind the ball to aim, chasing the ball down the
   fairway, crouched low for a putt, and a top-down look at the whole hole.
   All of them ease rather than snap, because a camera that teleports makes a
   3D golf game feel like a spreadsheet.
   ========================================================================= */

import * as THREE from '../../vendor/three.module.js';
import { clamp, lerp } from '../shared/rng.js';

const EYE = 1.62;          // a golfer's eye height

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.mode = 'aim';
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.tPos = new THREE.Vector3();
    this.tLook = new THREE.Vector3();
    this.snapNext = true;
    this.shake = 0;
    this.orbit = 0;            // extra yaw the player has dragged in
    this.pitch = 0;
    this.zoom = 1;
  }

  /** Standing behind the ball, looking down the aim line. */
  aim(terrain, ball, aimDir, opts = {}) {
    // Stand further back and lower than a real golfer would: it keeps the ball
    // around two-thirds down the frame, clear of the club and swing HUD, and
    // still shows the target.
    const back = (opts.back != null ? opts.back : 8.6) * this.zoom;
    const height = opts.height != null ? opts.height : EYE + 0.25;
    const dir = aimDir + this.orbit;
    const bx = ball.x - Math.sin(dir) * back;
    const bz = ball.z - Math.cos(dir) * back;
    const groundY = terrain.heightAt(bx, bz);
    const ballY = terrain.heightAt(ball.x, ball.z);

    this.tPos.set(bx, Math.max(groundY, ballY) + height, bz);

    // Look along the AIM line, not the orbited one.  The camera position
    // swings round the ball, but the thing it looks at has to stay the shot
    // itself — orbiting the look point too swept the ball down to the bottom
    // of the frame, straight behind the swing meter, on the side-on preset.
    const ahead = opts.ahead != null ? opts.ahead : 30;
    const lx = ball.x + Math.sin(aimDir) * ahead;
    const lz = ball.z + Math.cos(aimDir) * ahead;

    /* Then SOLVE for the look height rather than guessing it.
       The ball has to sit at a known fraction down the frame — never in the
       bottom quarter, where the club, meter and aim controls live — and that
       has to hold at every orbit, pitch and zoom.  Given the camera position,
       the angle down to the ball is known, so the angle the camera must look
       along is just that angle plus the offset we want on screen; the look
       height follows from the horizontal distance.  The player's pitch still
       tilts the view, but only within a band that keeps the ball clear. */
    const camY = this.tPos.y;
    const dBall = Math.max(0.5, Math.hypot(ball.x - bx, ball.z - bz));
    const ballAng = Math.atan2(ballY - camY, dBall);
    const fovY = (this.cam?.fov ?? 55) * Math.PI / 180;
    const frac = clamp(0.56 - this.pitch * 0.22, 0.42, 0.62);   // 0.5 is dead centre
    const wantAng = ballAng + (frac - 0.5) * fovY;
    const dLook = Math.max(1, Math.hypot(lx - bx, lz - bz));
    this.tLook.set(lx, camY + Math.tan(wantAng) * dLook, lz);
  }

  /** Crouched behind a putt: low, close, looking at the hole. */
  putt(terrain, ball, aimDir, target) {
    const dir = aimDir + this.orbit;
    const back = 3.6 * this.zoom;
    const bx = ball.x - Math.sin(dir) * back;
    const bz = ball.z - Math.cos(dir) * back;
    this.tPos.set(bx, terrain.heightAt(bx, bz) + 1.05, bz);
    const ahead = Math.max(4, Math.min(28, target || 8));
    const lx = ball.x + Math.sin(dir) * ahead;
    const lz = ball.z + Math.cos(dir) * ahead;
    this.tLook.set(lx, terrain.heightAt(lx, lz) + 0.75, lz);
  }

  /**
   * Chase the ball.  Sits behind and above it along its own direction of
   * travel, pulling back as the ball climbs so a towering drive stays framed.
   */
  chase(terrain, ballPos, vel, launchDir) {
    const sp = Math.hypot(vel.x, vel.z);
    let dx, dz;
    if (sp > 1.2) { dx = vel.x / sp; dz = vel.z / sp; }
    else { dx = Math.sin(launchDir); dz = Math.cos(launchDir); }

    const groundY = terrain.heightAt(ballPos.x, ballPos.z);
    const alt = Math.max(0, ballPos.y - groundY);
    const back = clamp(9 + alt * 0.9, 9, 42);
    const up = clamp(3.2 + alt * 0.55, 3.2, 26);

    const cx = ballPos.x - dx * back;
    const cz = ballPos.z - dz * back;
    this.tPos.set(cx, Math.max(terrain.heightAt(cx, cz) + 2.2, ballPos.y + up * 0.35), cz);
    this.tLook.set(ballPos.x + dx * 5, ballPos.y + 0.6, ballPos.z + dz * 5);
  }

  /**
   * Third person, behind and slightly above the walking golfer.  Frames what
   * is ahead of them rather than the back of their head, and tightens in when
   * they are standing over the ball ready to play.
   */
  overShoulder(terrain, walker, aimDir, atBall) {
    // The camera yaw must NOT follow the walker's heading. Movement is
    // camera-relative, so if the camera chased the character's facing the two
    // would feed each other and every sideways step would curve into a circle.
    // The player owns the yaw (aim + whatever they have dragged); the avatar
    // turns to face where it is going, independently.
    const yaw = aimDir + this.orbit;
    const back = (atBall ? 7.4 : 8.4) * this.zoom;
    const up = atBall ? 2.9 : 3.1;
    const bx = walker.x - Math.sin(yaw) * back;
    const bz = walker.z - Math.cos(yaw) * back;
    this.tPos.set(bx, Math.max(terrain.heightAt(bx, bz), terrain.heightAt(walker.x, walker.z)) + up, bz);
    const ahead = atBall ? 30 : 20;
    const lx = walker.x + Math.sin(yaw) * ahead;
    const lz = walker.z + Math.cos(yaw) * ahead;

    if (!atBall) {
      this.tLook.set(lx, terrain.heightAt(lx, lz) + 1.5 + this.pitch * 22, lz);
      return;
    }

    /* Over the ball, SOLVE for the look height instead of guessing it.
       The golfer and the ball have to sit clear of the bottom of the screen,
       where the club, strike meter and aim controls live, and that has to hold
       at every orbit, pitch and zoom the player can dial in.  The angle down
       to the golfer's feet is known from the camera position, so the angle the
       camera must look along is that plus the offset we want on screen, and
       the look height falls out of the horizontal distance.  Pitch still
       tilts the view, but inside a band that always keeps the shot visible. */
    const camY = this.tPos.y;
    const footY = terrain.heightAt(walker.x, walker.z);
    const dGolfer = Math.max(0.5, Math.hypot(walker.x - bx, walker.z - bz));
    const ang = Math.atan2(footY - camY, dGolfer);
    const fovY = (this.cam?.fov ?? 55) * Math.PI / 180;
    const frac = clamp(0.62 - this.pitch * 0.2, 0.46, 0.68);   // 0.5 is dead centre
    const wantAng = ang + (frac - 0.5) * fovY;
    const dLook = Math.max(1, Math.hypot(lx - bx, lz - bz));
    this.tLook.set(lx, camY + Math.tan(wantAng) * dLook, lz);
  }

  /**
   * Behind a moving cart.  The yaw follows the CART's heading, which is safe
   * in a way it is not on foot: steering is heading-relative, so there is no
   * feedback loop for the camera to spiral into.  (Walking is camera-relative,
   * which is exactly why overShoulder must never chase the walker's facing.)
   */
  cart(terrain, body, firstPerson) {
    const yaw = body.heading + this.orbit;
    const speed = Math.abs(body.speed || 0);
    if (firstPerson) {
      const s = Math.sin(body.heading), co = Math.cos(body.heading);
      const ex = body.x + s * 0.72 - co * 0.40;
      const ez = body.z + co * 0.72 + s * 0.40;
      this.tPos.set(ex, terrain.heightAt(ex, ez) + 1.42, ez);
      const lx = body.x + Math.sin(yaw) * 26, lz = body.z + Math.cos(yaw) * 26;
      this.tLook.set(lx, terrain.heightAt(lx, lz) + 2.0 + this.pitch * 22, lz);
      return;
    }
    // pull back and rise as it speeds up, so fast reads as fast
    const back = (9.4 + speed * 0.42) * this.zoom;
    const up = 4.5 + speed * 0.08;
    const bx = body.x - Math.sin(yaw) * back;
    const bz = body.z - Math.cos(yaw) * back;
    this.tPos.set(bx, Math.max(terrain.heightAt(bx, bz), terrain.heightAt(body.x, body.z)) + up, bz);
    const ahead = 12 + speed * 1.1;
    const lx = body.x + Math.sin(yaw) * ahead;
    const lz = body.z + Math.cos(yaw) * ahead;
    this.tLook.set(lx, terrain.heightAt(lx, lz) + 2.6 + this.pitch * 22, lz);
  }

  /**
   * Getting out of the cart.  The orbit the player dragged while driving is
   * relative to the CART's heading; on foot it is relative to the aim, so
   * carrying it across would swing the view somewhere arbitrary.
   */
  handOff() { this.orbit = 0; this.pitch = 0; }

  /** Looking back up the hole from over the flag — used while the ball settles. */
  green(terrain, hole, from) {
    const gx = hole.pin.x, gz = hole.pin.z;
    const dx = from.x - gx, dz = from.z - gz;
    const l = Math.hypot(dx, dz) || 1;
    const cx = gx + (dx / l) * 16, cz = gz + (dz / l) * 16;
    this.tPos.set(cx, terrain.heightAt(cx, cz) + 7.5, cz);
    this.tLook.set(gx, terrain.heightAt(gx, gz) + 0.6, gz);
  }

  /** Ease toward whatever target was set this frame. */
  update(dt, snappy = 1) {
    const k = this.snapNext ? 1 : 1 - Math.exp(-6.0 * snappy * Math.max(0, dt));
    this.snapNext = false;
    this.pos.lerp(this.tPos, k);
    this.look.lerp(this.tLook, k);

    let px = this.pos.x, py = this.pos.y, pz = this.pos.z;
    if (this.shake > 0.001) {
      this.shake = Math.max(0, this.shake - dt * 2.4);
      const s = this.shake * 0.12;
      px += Math.sin(dt * 977 + this.shake * 41) * s;
      py += Math.cos(dt * 811 + this.shake * 57) * s;
    }
    // Do not let a canopy swallow the shot.  The hole and terrain are handed
    // to the rig each frame by the game; without them this is a no-op, so the
    // menu backdrop and the map camera are unaffected.
    if (this.hole) {
      const clear = resolveCameraOcclusion(
        this.cam, this.look, { x: px, y: py, z: pz }, this.hole, this.terrain);
      px = clear.x; py = clear.y; pz = clear.z;
    }
    this.cam.position.set(px, py, pz);
    this.cam.lookAt(this.look);
  }

  /** The game supplies the world each frame so the rig can avoid the trees. */
  setWorld(hole, terrain) { this.hole = hole; this.terrain = terrain; }

  snap() { this.snapNext = true; }
  kick(amount) { this.shake = Math.min(1.2, this.shake + amount); }
  reset() { this.orbit = 0; this.pitch = 0; this.zoom = 1; }
}

/** Fit an orthographic camera to look straight down at the whole hole. */
/**
 * Keep the camera out of the trees.
 *
 * There was no occlusion handling at all, which is why a canopy could fill the
 * screen with no trunk anywhere near the view: the camera simply flew INSIDE
 * the leaves.  A tree's visual canopy is a blob roughly 0.55 of its height in
 * radius, centred about 0.72 of the way up — that is the bound to respect, not
 * the thin trunk the ball collides with.  If the desired camera position sits
 * inside one, slide it back along the ray toward whatever it is looking at
 * until it is clear, so the shot stays framed instead of going green.
 *
 * @param cam     the camera about to be placed
 * @param look    the point it is looking at (the golfer or the ball)
 * @param want    where it would like to be
 * @param hole    hole data, for the tree list
 * @param terrain for ground height under each tree
 */
export function resolveCameraOcclusion(cam, look, want, hole, terrain) {
  if (!hole || !hole.trees || !hole.trees.length) return want;
  const dx = want.x - look.x, dy = want.y - look.y, dz = want.z - look.z;
  const dist = Math.hypot(dx, dz) || 1e-6;
  let closest = 1;                       // fraction of the way out we may sit

  for (const t of hole.trees) {
    // cheap reject: only trees whose canopy could reach the camera at all
    const R = t.r * 1.02 + 0.45;         // canopy radius + a little clearance
    const dxt = t.x - want.x, dzt = t.z - want.z;
    if (Math.abs(dxt) > R + dist || Math.abs(dzt) > R + dist) continue;

    const groundY = terrain ? terrain.heightAt(t.x, t.z) : 0;
    const cy = groundY + t.h * 0.72;     // canopy centre, matching the mesh

    // march back along the ray and take the earliest fraction that is clear
    for (let f = 1; f > 0.25; f -= 0.06) {
      const px = look.x + dx * f, py = look.y + dy * f, pz = look.z + dz * f;
      const d2 = (px - t.x) ** 2 + (py - cy) ** 2 * 0.55 + (pz - t.z) ** 2;
      if (d2 > R * R) { if (f < closest) closest = f; break; }
    }
  }
  if (closest >= 1) return want;
  // never jam the camera into the golfer's back
  const f = Math.max(0.28, closest);
  return { x: look.x + dx * f, y: look.y + dy * f, z: look.z + dz * f };
}

export function fitMapCamera(cam, hole, aspect) {
  const b = hole.bounds;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const spanX = (b.maxX - b.minX) * 0.51, spanZ = (b.maxZ - b.minZ) * 0.51;
  let hw = spanX, hh = spanZ;
  if (hw / hh < aspect) hw = hh * aspect; else hh = hw / aspect;
  cam.left = -hw; cam.right = hw; cam.top = hh; cam.bottom = -hh;
  cam.near = 0.5; cam.far = 2000;
  cam.position.set(cx, 600, cz);
  cam.up.set(0, 0, 1);
  cam.lookAt(cx, 0, cz);
  cam.updateProjectionMatrix();
}

export { EYE };
