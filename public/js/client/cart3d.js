/* =========================================================================
   cart3d.js — what a golf cart looks like
   -------------------------------------------------------------------------
   Every box in the cart is merged into ONE BufferGeometry at module load and
   shared by every cart on the course.  Relative shading (tyres dark, panels
   shaded) is baked into vertex colours; the player's colour arrives via
   material.color, which multiplies it.  So one geometry for every cart, and

       bodywork 1 + livery 1 + steered front wheels 1 + blob 1  =  4 draw calls

   A cart with a LIVERY DECAL costs a fifth, and only that cart: the panels
   it is painted on are their own tiny geometry (three quads) with their own
   material, built once at module load and shared, and the mesh is only added
   when a player actually has one equipped.

   for a whole cart, against fourteen for a golfer.  Eight carts on screen cost
   about two avatars.
   ========================================================================= */

import * as THREE from '../../vendor/three.module.js';
import { sharedBlobTexture, sharedBlobGeo } from './avatar.js';
import { cartDecalTexture } from './cartdecals.js';
import { UNLOCKS } from '../shared/unlocks.js';
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

/* ----------------------------------------------------------- livery decal ---
   Where a cart livery is actually painted. Not the merged soup above: that
   geometry carries no UVs, and adding them for the benefit of three faces
   would cost every cart on the course the attribute whether or not it wears
   one. Three quads, floated a few millimetres proud of the panel underneath
   so there is nothing for the depth buffer to argue about.

   The three surfaces are chosen by what a cart actually shows. The FLANKS
   are what you see of somebody else's cart for the whole time it is near
   you, and they are the only part of this shape long enough to carry a
   directional pattern. The NOSE is what the driver sees over their own
   bonnet, and it happens to be almost exactly the 4:1 the art is drawn at
   (TRACK by 0.26). The roof is the obvious fourth candidate and is not
   here: it is 23:1 along its edge and hidden from every camera angle the
   game actually uses from above.

   `u` runs nose to tail on both flanks rather than left to right, so a
   pattern with a direction in it points forward on both sides — which is
   how a livery is painted on a real vehicle, and it mirrors rather than
   running backwards down one side. */
const DECAL_PANELS = [
  { face: 'x+', x: T2 + 0.075, y: RIDE + 0.20, z: 0.80, len: 2.00, hgt: 0.38 },
  { face: 'x-', x: -(T2 + 0.075), y: RIDE + 0.20, z: 0.80, len: 2.00, hgt: 0.38 },
  { face: 'z+', x: 0, y: RIDE + 0.26, z: FRONT + 0.301, len: TRACK - 0.04, hgt: 0.26 }
];

function decalGeo() {
  const pos = [], nrm = [], uv = [], idx = [];
  let base = 0;
  for (const p of DECAL_PANELS) {
    const a = p.len / 2, b = p.hgt / 2;
    let quad, n;
    if (p.face === 'x+') {
      n = [1, 0, 0];
      quad = [[p.x, p.y - b, p.z + a, 0, 1], [p.x, p.y - b, p.z - a, 1, 1],
              [p.x, p.y + b, p.z - a, 1, 0], [p.x, p.y + b, p.z + a, 0, 0]];
    } else if (p.face === 'x-') {
      n = [-1, 0, 0];
      quad = [[p.x, p.y - b, p.z - a, 1, 1], [p.x, p.y - b, p.z + a, 0, 1],
              [p.x, p.y + b, p.z + a, 0, 0], [p.x, p.y + b, p.z - a, 1, 0]];
    } else {
      n = [0, 0, 1];
      quad = [[p.x - a, p.y - b, p.z, 0, 1], [p.x + a, p.y - b, p.z, 1, 1],
              [p.x + a, p.y + b, p.z, 1, 0], [p.x - a, p.y + b, p.z, 0, 0]];
    }
    for (const v of quad) { pos.push(v[0], v[1], v[2]); nrm.push(...n); uv.push(v[3], v[4]); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    base += 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.userData.shared = true;
  return g;
}

let _chassisGeo = null, _frontGeo = null, _decalGeo = null;
const chassisGeo = () => (_chassisGeo || (_chassisGeo = boxSoup(CHASSIS_BOXES)));
const frontGeo = () => (_frontGeo || (_frontGeo = boxSoup(FRONT_BOXES)));
const sharedDecalGeo = () => (_decalGeo || (_decalGeo = decalGeo()));

/** Triangle count for one cart — used by the perf assertions. */
export const CART_TRIS = (CHASSIS_BOXES.length + FRONT_BOXES.length) * 12;

/** What a livery adds, for the same assertions. Six triangles. */
export const CART_DECAL_TRIS = DECAL_PANELS.length * 2;

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
  constructor(tint = '#2f6d3f', decal = null) {
    this.root = new THREE.Group();

    /* group 0: bodywork, the same on every cart.  group 1: the livery.

       Standard rather than Lambert so both take the scene environment
       (scene.js's _buildEnvironment). A cart is painted metal and glass
       under an open sky, and Lambert cannot show that at all — it has no
       specular term, so the bodywork was the same flat cream whether the
       sun was on it or behind a cloud. Roughness is high: this is a fleet
       cart that lives outdoors, not a show car. */
    this.bodyMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, roughness: 0.62, metalness: 0.14,
      envMapIntensity: 0.75
    });
    this.mat = new THREE.MeshStandardMaterial({
      color: liveryColor(tint), vertexColors: true, roughness: 0.48, metalness: 0.22,
      envMapIntensity: 0.85
    });
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

    /* CONTACT, not a shadow. Same split the avatar makes: the sun casts a
       real one now, and this is the dark patch under the tyres that a
       52-metre shadow map is far too coarse to resolve. Tightened from
       3.1 x 4.4 — it was sized as a fake shadow of the whole vehicle, which
       double-darkens the ground under the real one. */
    this.blob = new THREE.Mesh(sharedBlobGeo(), new THREE.MeshBasicMaterial({
      map: sharedBlobTexture(), transparent: true, depthWrite: false, opacity: 0.5
    }));
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.scale.set(2.2, 3.1, 1);
    this.blob.position.set(0, 0.02, 0.75);
    this.blob.renderOrder = 1;
    this.root.add(this.blob);            // on root, not tilt — stays on the ground

    /* And the cart casts. It never did: eight carts could be parked on a
       fairway in full sun with nothing on the grass under any of them. */
    this.chassis.castShadow = true;
    this.front.castShadow = true;

    /* The livery panels. Built lazily in setDecal so a cart with no decal —
       which is every cart below level 17 — costs exactly what it always did.
       On `tilt`, with the chassis, so the livery leans with the body rather
       than hanging in the air beside a cart that is up on two wheels. */
    this.decalMesh = null;
    this._decalId = undefined;
    this.setDecal(decal);

    // suspension state: visual only, and it must never feed back into motion
    this.pitch = 0; this.pitchV = 0;
    this._lastHit = 0;
    this.roll = 0; this.rollV = 0;
    this.heave = 0; this.heaveV = 0;
    this._lastSpeed = 0;
  }

  setTint(hex) { this.mat.color.copy(liveryColor(hex)); }

  /** Paint (or strip) the livery. Cheap to call every frame — it returns on
   *  the id it is already wearing, the way Avatar.setDecal does. */
  setDecal(id) {
    if (id === this._decalId) return;
    this._decalId = id;
    const u = id ? UNLOCKS.find(x => x.kind === 'cartdecal' && x.id === id) : null;
    const tex = u ? cartDecalTexture(u.id, u.color || '#ff6b4a') : null;
    if (!tex) {
      if (this.decalMesh) this.decalMesh.visible = false;
      return;
    }
    if (!this.decalMesh) {
      this.decalMesh = new THREE.Mesh(sharedDecalGeo(), new THREE.MeshStandardMaterial({
        map: tex, roughness: 0.44, metalness: 0.20, envMapIntensity: 0.9
      }));
      this.tilt.add(this.decalMesh);
    } else {
      this.decalMesh.material.map = tex;
      this.decalMesh.material.needsUpdate = true;
      this.decalMesh.visible = true;
    }
  }

  /**
   * Put the cart in the world and let the springs settle.
   *
   * @param body   anything with {x, z, heading, speed, steer} — the local
   *               CartBody, or an interpolated remote snapshot
   * @param groundY  terrain height under the rear axle
   * @param normal   terrain normal, for leaning into the hill
   */
  update(dt, body, groundY, normal) {
    /* `air` is the arcade launch (see cart.js): the chassis used to be
       welded to the terrain height, so the most a crash could do was rock
       the body on a cosmetic spring. */
    this.root.position.set(body.x, groundY + (body.air || 0), body.z);
    this.root.rotation.y = body.heading;
    this.front.rotation.y = -(body.steer || 0);

    // longitudinal and lateral acceleration drive the springs
    const accel = dt > 1e-4 ? clampN((body.speed - this._lastSpeed) / dt, -12, 12) : 0;
    this._lastSpeed = body.speed;
    const latA = clampN(body.speed * body.speed * Math.tan(body.steer || 0) / WHEELBASE, -9, 9);

    // squat under power, dive under braking, lean out of a corner
    const wantPitch = clampN(-0.020 * accel, -MAX_TILT, MAX_TILT);
    const wantRoll = clampN(-0.022 * latA, -MAX_TILT, MAX_TILT);

    /* The crunch.  `body.hit` spikes to 0..1 the frame something is struck
       and then decays, but nothing was ever done with it here — so a cart
       could slam into an oak and the chassis would not so much as twitch,
       which is most of why collisions looked fake.  The impact now kicks the
       suspension springs directly: the nose dives, the body rolls away from
       whatever it clipped, and the whole cart bounces on its springs. Kicking
       the VELOCITIES rather than setting an angle lets the existing spring do
       the settling, so it rocks and recovers instead of snapping. */
    const hit = body.hit || 0;
    const fresh = Math.max(0, hit - (this._lastHit || 0));
    this._lastHit = hit;
    if (fresh > 0.02) {
      this.pitchV -= fresh * 5.2;                       // nose pitches down
      this.heaveV -= fresh * 0.55;                      // and the body drops
      // roll away from the side that was clipped; impactYaw carries the sign
      const side = Math.sign(body.impactYaw || 0) || (Math.random() < 0.5 ? -1 : 1);
      this.rollV += side * fresh * 4.5;
    }

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
    /* And the roll the BODY is carrying, which is the real one.
       cart3d's spring is cosmetic: it leans in corners and rocks on impact
       and always comes back. body.tilt is physical — past TIP_OVER the cart
       is on its side and stays there — so it is added on top rather than
       replacing anything, and it is the number that puts the roof on the
       grass. Without this line the cart could go over in the simulation and
       carry on looking perfectly upright on screen. */
    const bodyTilt = body.tilt || 0;
    this.tilt.rotation.x = this.pitch + slopePitch;
    /* Nose up on the way out, down on the way in. Without it a launched
       cart is a box sliding along an invisible ramp — the pitch is what
       reads as flight. */
    if ((body.air || 0) > 0.02 || (body.vy || 0) > 0) {
      this.pitch += (clampN(-(body.vy || 0) * 0.10, -0.42, 0.42) - this.pitch)
                    * Math.min(1, dt * 6);
    }
    this.tilt.rotation.z = this.roll + slopeRoll + bodyTilt;
    // once it is over, the chassis rests on its side rather than hovering at
    // wheel height — drop it by roughly half the track
    this.tilt.position.y = this.heave - Math.min(0.34, Math.abs(bodyTilt) * 0.30);

    /* THE CONTACT PATCH ANSWERS TO THE SUSPENSION. It was pinned at a fixed
       size directly under the cart whatever the cart was doing, so a
       vehicle up on two wheels or launched off a bank kept a firm dark
       print on the ground it was nowhere near — which is the exact thing
       contact AO exists to say is not happening. */
    const lift = Math.max(0, this.heave) + Math.abs(bodyTilt) * 0.9 + (body.air || 0) * 1.2;
    const k = Math.max(0, 1 - lift * 1.6);
    this.blob.scale.set(2.2 * (0.55 + 0.45 * k), 3.1 * (0.55 + 0.45 * k), 1);
    this.blob.material.opacity = 0.5 * k;
    this.blob.visible = k > 0.02;
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
    /* The livery material is per-cart (its map is a shared cached texture,
       which is why only the material goes) — without this a course that
       cycles carts leaks one Lambert per cart that ever wore one. */
    this.decalMesh?.material.dispose();
    // geometries are shared singletons — leave them alone
  }
}

/** How fast the cart is going, as a rounded mph for the HUD. */
export const mph = speed => Math.round(Math.abs(speed) * 2.23694);
export { MAX_FWD };
