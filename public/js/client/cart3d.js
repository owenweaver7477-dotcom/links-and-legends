/* =========================================================================
   cart3d.js — what a golf cart looks like
   -------------------------------------------------------------------------
   Every box in the cart is merged into ONE BufferGeometry at module load and
   shared by every cart on the course.  Relative shading (tyres dark, panels
   shaded) is baked into vertex colours; the player's colour arrives via
   material.color, which multiplies it.  So one geometry for every cart, and

       bodywork 1 + livery 1 + steered front wheels 1 + blob 1  =  4 draw calls

   for a whole cart, against fourteen for a golfer.  Eight carts on screen cost
   about two avatars.
   ========================================================================= */

import * as THREE from '/vendor/three.module.js';
import { sharedBlobTexture, sharedBlobGeo } from './avatar.js';
import {
  WHEELBASE, TRACK, WHEEL_R, SEATS, MAX_FWD
} from '../shared/cart.js';

/* ------------------------------------------------------------------ boxes */
/* Unit-cube corners and the six faces, written out once so the merge below
   stays readable.  Normals are per-face, so the cart keeps its faceted look. */
const FACES = [
  { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
  { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
  { n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] }
];

/**
 * Merge a list of boxes into a single geometry.
 * Each box: { w,h,d, x,y,z, c:[r,g,b], ry?, tint? }
 *
 * Boxes are sorted into two draw groups: the bodywork, which is always the
 * same cream a real cart is, and the liveried parts — roof and seats — which
 * take the player's colour.  A single material could not do both, and a cart
 * tinted entirely by the player's ball colour comes out white for a white
 * ball, which is no use for telling anyone apart.
 */
function boxSoup(boxes) {
  const pos = [], nrm = [], col = [], idx = [];
  let base = 0;
  const ordered = [...boxes.filter(b => !b.tint), ...boxes.filter(b => b.tint)];
  const fixedCount = boxes.filter(b => !b.tint).length;
  for (const b of ordered) {
    const hw = b.w / 2, hh = b.h / 2, hd = b.d / 2;
    const ry = b.ry || 0, cs = Math.cos(ry), sn = Math.sin(ry);
    for (const f of FACES) {
      for (const v of f.v) {
        let px = v[0] * hw, py = v[1] * hh, pz = v[2] * hd;
        if (ry) { const t = px * cs + pz * sn; pz = -px * sn + pz * cs; px = t; }
        pos.push(px + b.x, py + b.y, pz + b.z);
        let nx = f.n[0], nz = f.n[2];
        if (ry) { const t = nx * cs + nz * sn; nz = -nx * sn + nz * cs; nx = t; }
        nrm.push(nx, f.n[1], nz);
        col.push(b.c[0], b.c[1], b.c[2]);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      base += 4;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  // group 0 = bodywork (fixed cream), group 1 = livery (player colour)
  g.addGroup(0, fixedCount * 36, 0);
  g.addGroup(fixedCount * 36, (ordered.length - fixedCount) * 36, 1);
  g.userData.shared = true;      // never disposed with a hole
  return g;
}

/* Tints. Values near 1 take the player's colour; darker values hold their own
   shade however bright the cart is painted. */
const PAINT = [0.93, 0.94, 0.91];   // cart cream — fixed, like a real one
const TRIM = [0.72, 0.74, 0.76];    // shaded panels
const DARK = [0.17, 0.18, 0.20];    // tyres, dashboard
const SEAT = [0.30, 0.32, 0.35];
const CHROME = [0.80, 0.82, 0.84];
const ROOF = [0.92, 0.93, 0.94];

/* Everything is authored about the REAR AXLE, matching CartBody's origin:
   +z forward, +x right, y up from the ground. */
const clampN = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const MAX_TILT = 0.13;            // rad ~7.5 deg: a cart, not a motorbike

const FRONT = WHEELBASE;
const T2 = TRACK / 2;
const RIDE = WHEEL_R;

const CHASSIS_BOXES = [
  // floor pan and sills
  { w: TRACK + 0.10, h: 0.10, d: 2.30, x: 0, y: RIDE + 0.05, z: 0.80, c: TRIM },
  { w: 0.10, h: 0.16, d: 2.10, x: -T2 - 0.02, y: RIDE + 0.16, z: 0.80, c: ROOF, tint: true },
  { w: 0.10, h: 0.16, d: 2.10, x: T2 + 0.02, y: RIDE + 0.16, z: 0.80, c: ROOF, tint: true },
  // bonnet and nose
  { w: TRACK, h: 0.30, d: 0.78, x: 0, y: RIDE + 0.26, z: FRONT - 0.10, c: PAINT },
  { w: TRACK - 0.06, h: 0.12, d: 0.16, x: 0, y: RIDE + 0.46, z: FRONT + 0.20, c: TRIM },
  // bench seat: base and a LOW back — the back must stop at shoulder-blade
  // height or the riders vanish behind it and the cart looks empty from behind
  { w: TRACK - 0.02, h: 0.14, d: 0.60, x: 0, y: RIDE + 0.20, z: 0.56, c: ROOF, tint: true },
  { w: TRACK - 0.02, h: 0.42, d: 0.13, x: 0, y: RIDE + 0.46, z: 0.22, c: ROOF, tint: true },
  // dash and steering column
  { w: TRACK - 0.14, h: 0.40, d: 0.10, x: 0, y: RIDE + 0.52, z: 1.16, c: DARK },
  { w: 0.05, h: 0.05, d: 0.30, x: -0.40, y: RIDE + 0.72, z: 1.02, c: CHROME },
  { w: 0.30, h: 0.05, d: 0.05, x: -0.40, y: RIDE + 0.84, z: 0.90, c: DARK },
  // roof posts — tall enough that a seated head (hat and all) clears the
  // canopy instead of poking through it
  { w: 0.06, h: 1.52, d: 0.06, x: -T2 + 0.04, y: RIDE + 0.96, z: 1.18, c: CHROME },
  { w: 0.06, h: 1.52, d: 0.06, x: T2 - 0.04, y: RIDE + 0.96, z: 1.18, c: CHROME },
  { w: 0.06, h: 1.52, d: 0.06, x: -T2 + 0.04, y: RIDE + 0.96, z: -0.16, c: CHROME },
  { w: 0.06, h: 1.52, d: 0.06, x: T2 - 0.04, y: RIDE + 0.96, z: -0.16, c: CHROME },
  // roof
  { w: TRACK + 0.16, h: 0.07, d: 1.62, x: 0, y: RIDE + 1.72, z: 0.52, c: ROOF, tint: true },
  // rear bag rack
  { w: TRACK - 0.10, h: 0.08, d: 0.44, x: 0, y: RIDE + 0.42, z: -0.34, c: TRIM },
  { w: 0.05, h: 0.34, d: 0.05, x: -T2 + 0.10, y: RIDE + 0.60, z: -0.50, c: CHROME },
  { w: 0.05, h: 0.34, d: 0.05, x: T2 - 0.10, y: RIDE + 0.60, z: -0.50, c: CHROME },
  // rear wheels (merged in — they never turn, only the front pair steers)
  { w: 0.16, h: WHEEL_R * 2, d: WHEEL_R * 2, x: -T2, y: RIDE, z: 0, c: DARK },
  { w: 0.16, h: WHEEL_R * 2, d: WHEEL_R * 2, x: T2, y: RIDE, z: 0, c: DARK }
];

/* The steered pair, authored about the FRONT AXLE CENTRE so the group can yaw
   in place — which is what actually reads as steering. */
const FRONT_BOXES = [
  { w: 0.16, h: WHEEL_R * 2, d: WHEEL_R * 2, x: -T2, y: 0, z: 0, c: DARK },
  { w: 0.16, h: WHEEL_R * 2, d: WHEEL_R * 2, x: T2, y: 0, z: 0, c: DARK }
];

let _chassisGeo = null, _frontGeo = null;
const chassisGeo = () => (_chassisGeo || (_chassisGeo = boxSoup(CHASSIS_BOXES)));
const frontGeo = () => (_frontGeo || (_frontGeo = boxSoup(FRONT_BOXES)));

/** Triangle count for one cart — used by the perf assertions. */
export const CART_TRIS = (CHASSIS_BOXES.length + FRONT_BOXES.length) * 12;

/* ========================================================================= */

/**
 * The livery colour for a player.
 *
 * Taken from their ball colour, but pushed into a band that is always legible
 * against grass and always distinguishable from the cream bodywork.  Without
 * this the player with the white ball gets a white cart, which tells you
 * nothing — and telling carts apart at distance is the whole point.
 */
export function liveryColor(hex) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return new THREE.Color().setHSL(hsl.h, Math.max(0.42, hsl.s), Math.min(0.46, Math.max(0.24, hsl.l)));
}

export class Cart3D {
  constructor(tint = '#2f6d3f') {
    this.root = new THREE.Group();

    // group 0: bodywork, the same on every cart.  group 1: the livery.
    this.bodyMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    this.mat = new THREE.MeshLambertMaterial({ color: liveryColor(tint), vertexColors: true });
    this.mats = [this.bodyMat, this.mat];

    // tilt carries the suspension; the chassis and wheels hang off it so the
    // blob shadow underneath stays flat on the ground
    this.tilt = new THREE.Group();
    this.root.add(this.tilt);

    this.chassis = new THREE.Mesh(chassisGeo(), this.mats);
    this.tilt.add(this.chassis);

    this.front = new THREE.Mesh(frontGeo(), this.bodyMat);
    this.front.position.set(0, RIDE, FRONT);
    this.tilt.add(this.front);

    this.blob = new THREE.Mesh(sharedBlobGeo(), new THREE.MeshBasicMaterial({
      map: sharedBlobTexture(), transparent: true, depthWrite: false, opacity: 0.7
    }));
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.scale.set(3.1, 4.4, 1);
    this.blob.position.set(0, 0.02, 0.75);
    this.blob.renderOrder = 1;
    this.root.add(this.blob);            // on root, not tilt — stays on the ground

    // suspension state: visual only, and it must never feed back into motion
    this.pitch = 0; this.pitchV = 0;
    this.roll = 0; this.rollV = 0;
    this.heave = 0; this.heaveV = 0;
    this._lastSpeed = 0;
  }

  setTint(hex) { this.mat.color.copy(liveryColor(hex)); }

  /**
   * Put the cart in the world and let the springs settle.
   *
   * @param body   anything with {x, z, heading, speed, steer} — the local
   *               CartBody, or an interpolated remote snapshot
   * @param groundY  terrain height under the rear axle
   * @param normal   terrain normal, for leaning into the hill
   */
  update(dt, body, groundY, normal) {
    this.root.position.set(body.x, groundY, body.z);
    this.root.rotation.y = body.heading;
    this.front.rotation.y = -(body.steer || 0);

    // longitudinal and lateral acceleration drive the springs
    const accel = dt > 1e-4 ? clampN((body.speed - this._lastSpeed) / dt, -12, 12) : 0;
    this._lastSpeed = body.speed;
    const latA = clampN(body.speed * body.speed * Math.tan(body.steer || 0) / WHEELBASE, -9, 9);

    // squat under power, dive under braking, lean out of a corner
    const wantPitch = clampN(-0.020 * accel, -MAX_TILT, MAX_TILT);
    const wantRoll = clampN(-0.022 * latA, -MAX_TILT, MAX_TILT);

    // Substep the springs at a fixed 60 Hz.  Integrating a stiff spring with
    // the raw frame dt is what tipped the cart on its side: at the 0.1 s dt
    // clamp, omega^2*dt reaches 10 and the thing diverges within two frames.
    let left = Math.min(dt, 0.25);
    while (left > 1e-5) {
      const h = Math.min(left, 1 / 60);
      left -= h;
      this.pitchV += (-81 * (this.pitch - wantPitch) - 2 * 0.85 * 9 * this.pitchV) * h;
      this.pitch += this.pitchV * h;
      this.rollV += (-100 * (this.roll - wantRoll) - 2 * 0.80 * 10 * this.rollV) * h;
      this.roll += this.rollV * h;
      this.heaveV += (-169 * this.heave - 2 * 0.55 * 13 * this.heaveV) * h;
      this.heave += this.heaveV * h;
    }
    // and belt-and-braces: a golf cart does not lean like a motorbike
    this.pitch = clampN(this.pitch, -MAX_TILT, MAX_TILT);
    this.roll = clampN(this.roll, -MAX_TILT, MAX_TILT);
    this.heave = clampN(this.heave, -0.10, 0.10);

    // sit the chassis on the slope as well, so a sidehill actually looks like one
    let slopePitch = 0, slopeRoll = 0;
    if (normal) {
      const s = Math.sin(body.heading), c = Math.cos(body.heading);
      const ny = normal[1] || 1;
      slopePitch = clampN(Math.atan2(normal[0] * s + normal[2] * c, ny), -0.30, 0.30);
      slopeRoll = -clampN(Math.atan2(normal[0] * c - normal[2] * s, ny), -0.30, 0.30);
    }
    this.tilt.rotation.x = this.pitch + slopePitch;
    this.tilt.rotation.z = this.roll + slopeRoll;
    this.tilt.position.y = this.heave;
  }

  /** Where a rider sits, in world space, including the body tilt. */
  seatWorld(which, body, groundY) {
    const s = SEATS[which] || SEATS.driver;
    const sinH = Math.sin(body.heading), cosH = Math.cos(body.heading);
    return {
      x: body.x + sinH * s.z + cosH * s.x,
      z: body.z + cosH * s.z - sinH * s.x,
      y: groundY + s.y + this.heave
    };
  }

  setVisible(v) { this.root.visible = v; }

  dispose() {
    this.mat.dispose();
    this.bodyMat.dispose();
    this.blob.material.dispose();
    // geometries are shared singletons — leave them alone
  }
}

/** How fast the cart is going, as a rounded mph for the HUD. */
export const mph = speed => Math.round(Math.abs(speed) * 2.23694);
export { MAX_FWD };
