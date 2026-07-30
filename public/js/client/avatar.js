/* =========================================================================
   avatar.js — the blocky golfer
   -------------------------------------------------------------------------
   A stylised low-poly humanoid: thirteen boxes and a blob shadow, so fourteen
   draw calls, all sharing ONE BoxGeometry and one material per colour.  The
   walk cycle is pure trigonometry on the limb rotations — no skinning, no
   animation mixer, nothing that costs frame time.  Celebrations blend over the
   same joints, so a birdie fist-pump adds no geometry at all.
   ========================================================================= */

import * as THREE from '/vendor/three.module.js';
import { AVATAR_HEIGHT } from '../shared/avatars.js';
import { CLIPS, POSE_KEYS, blankPose } from './celebrations.js';

/* One unit box, reused by every part of every avatar.
   `userData.shared` is what stops GolfScene.dispose() from freeing these on
   every hole change — it walks the scene graph and disposes anything without
   the flag, which would tear the geometry out from under every live avatar. */
const shared = g => { g.userData.shared = true; return g; };

let _box = null;
const box = () => (_box || (_box = shared(new THREE.BoxGeometry(1, 1, 1))));
let _blob = null;
const blobGeo = () => (_blob || (_blob = shared(new THREE.CircleGeometry(0.42, 14))));
let _blobTex = null;

/** A soft round gradient, so the blob shadow has no hard edge. */
function blobTexture() {
  if (_blobTex) return _blobTex;
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 1, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(0.55, 'rgba(0,0,0,0.30)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  _blobTex = new THREE.CanvasTexture(c);
  return _blobTex;
}

/* The carts draw the same blob shadow.  Sharing the function rather than the
   texture keeps it lazy — nothing is rasterised until something needs one. */
export { blobTexture as sharedBlobTexture, blobGeo as sharedBlobGeo };

const H = AVATAR_HEIGHT;          // 1.78 m
const part = (mat, w, h, d, x, y, z) => {
  const m = new THREE.Mesh(box(), mat);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  return m;
};

export class Avatar {
  /**
   * @param {object} look  {cap, shirt, skin, trousers} hex strings
   * @param {string} ballColor  used for the little accent on the cap
   */
  constructor(look, ballColor = '#ffffff') {
    this.root = new THREE.Group();
    this.look = look;

    const M = hex => new THREE.MeshLambertMaterial({ color: new THREE.Color(hex) });
    this.mats = {
      cap: M(look.cap), shirt: M(look.shirt),
      skin: M(look.skin), trousers: M(look.trousers),
      shoe: M('#2b2b2f'), accent: M(ballColor)
    };

    /* --- torso and head ------------------------------------------------ */
    // proportions: legs to 0.46H, torso to 0.80H, head on top
    this.body = new THREE.Group();
    this.body.add(part(this.mats.shirt, 0.42, H * 0.32, 0.24, 0, H * 0.63, 0));

    // The head and hat hang off pivots at the neck so a celebration can nod,
    // shake and doff the cap.  Groups cost nothing — they are never submitted
    // to the renderer — but the children have to be rebased onto the pivot,
    // hence the H*0.7925 subtracted from each original height.
    const NECK = H * 0.7925;
    this.head = new THREE.Group();
    this.head.position.set(0, NECK, 0);
    this.head.add(part(this.mats.skin, 0.225, H * 0.125, 0.225, 0, H * 0.0625, 0));
    this.hat = new THREE.Group();
    // cap crown + peak, so you can read a player's colour from behind
    this.hat.add(part(this.mats.cap, 0.24, H * 0.05, 0.24, 0, H * 0.1355, 0));
    this.hat.add(part(this.mats.cap, 0.22, H * 0.016, 0.12, 0, H * 0.1195, 0.16));
    this.hat.add(part(this.mats.accent, 0.06, H * 0.024, 0.014, 0, H * 0.1355, 0.122));
    this.head.add(this.hat);
    this.body.add(this.head);

    /* --- limbs, pivoted at the shoulder / hip so they can swing --------- */
    const limb = (mat, w, len, x, y, endMat, endLen) => {
      const g = new THREE.Group();
      g.position.set(x, y, 0);
      g.add(part(mat, w, len, w, 0, -len / 2, 0));
      if (endMat) g.add(part(endMat, w * 1.05, endLen, w * 1.5, 0, -len - endLen / 2, 0.02));
      return g;
    };
    this.armL = limb(this.mats.shirt, 0.115, H * 0.30, -0.262, H * 0.775, this.mats.skin, H * 0.06);
    this.armR = limb(this.mats.shirt, 0.115, H * 0.30, 0.262, H * 0.775, this.mats.skin, H * 0.06);
    this.legL = limb(this.mats.trousers, 0.145, H * 0.42, -0.105, H * 0.47, this.mats.shoe, H * 0.05);
    this.legR = limb(this.mats.trousers, 0.145, H * 0.42, 0.105, H * 0.47, this.mats.shoe, H * 0.05);
    this.body.add(this.armL, this.armR, this.legL, this.legR);
    this.root.add(this.body);

    /* --- blob shadow: one textured disc, no shadow map ------------------ */
    this.blob = new THREE.Mesh(blobGeo(), new THREE.MeshBasicMaterial({
      map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.85
    }));
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.renderOrder = 1;
    this.root.add(this.blob);

    this.phase = 0;
    this.speed = 0;
    this.swingAmp = 0;          // eased, so limbs settle instead of snapping
    this.seated = false;
    this.cel = null;            // { name, t, dur, in, out } while celebrating
    this._yaw = 0;              // where place() wants the body to face
    // two reusable pose buffers: a celebration allocates nothing per frame
    this._pose = blankPose();
    this._clip = blankPose();
  }

  /** Place the avatar and face it along `heading` (radians, 0 = +Z). */
  place(x, groundY, z, heading) {
    this.root.position.set(x, groundY, z);
    this._yaw = heading;        // update() applies it, plus any clip spin
    this.blob.position.y = 0.02;
  }

  /* ------------------------------------------------------------ reactions */

  /**
   * Start a celebration.  Returns its duration in seconds, or 0 if there is
   * no such clip.  Restarting an already-running clip re-triggers it.
   */
  play(name) {
    const c = CLIPS[name];
    if (!c || this.seated) return 0;      // never celebrate from a cart seat
    this.cel = { name, t: 0, dur: c.dur, in: c.in, out: c.out };
    return c.dur;
  }
  get celebrating() { return !!this.cel; }
  cancelCelebration() { this.cel = null; }

  /**
   * Sit the golfer in a cart.  A hard override rather than a blend: the seat
   * pose is static, and the blob is hidden because the cart casts its own.
   */
  setSeated(on) {
    this.seated = !!on;
    if (this.seated) this.cel = null;
    this.blob.visible = !this.seated;
  }

  /**
   * Advance the walk cycle.  `speed` in m/s drives both the stride rate and
   * how far the limbs swing, so a jog reads differently from a stroll.
   *
   * Everything writes through one pose buffer and is applied exactly once at
   * the end.  That matters: the walk used to write the joints directly, so
   * anything layered on top of it was overwritten the following frame.
   */
  update(dt, speed) {
    this.speed = speed;
    const P = this._pose;

    if (this.seated) { this._applySeated(); return; }

    // A celebration is cancelled by real movement — the threshold sits well
    // above the 1.4 m/s floor updateAvatars() forces on a moving remote peer,
    // so interpolation jitter cannot cut someone's birdie short.
    if (this.cel && speed > 1.8) this.cel = null;

    const moving = speed > 0.15;
    // stride frequency rises with speed but flattens off, like a real gait
    this.phase += dt * (moving ? 2.1 + Math.min(speed, 10) * 0.62 : 0);

    // Ease the swing amplitude rather than zeroing it the instant you stop.
    // (The old code multiplied an already-zeroed rotation by a decay, so the
    // limbs snapped to attention; this is that fix.)
    const want = moving ? Math.min(0.62, 0.16 + speed * 0.055) : 0;
    this.swingAmp += (want - this.swingAmp) * Math.min(1, dt * 9);
    const swing = this.swingAmp;

    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);

    P.legLx = s * swing;
    P.legRx = -s * swing;
    P.armLx = -s * swing * 0.75;
    P.armRx = s * swing * 0.75;
    P.armLz = 0; P.armRz = 0;
    P.bodyY = Math.abs(c) * 0.035 * Math.min(1, speed / 4) * (swing > 0.001 ? 1 : 0);
    P.bodyRx = 0;
    P.bodyRz = s * swing * 0.056;        // 0.035 rad of sway at a full stride
    P.yaw = 0;
    P.headRx = 0; P.headRy = 0; P.hatY = 0; P.hatRx = 0;

    if (this.cel) {
      const cel = this.cel;
      cel.t += dt;
      if (cel.t >= cel.dur) {
        this.cel = null;                       // weight is 0 here anyway
      } else {
        const k = cel.t / cel.dur;
        const C = blankPose(this._clip);
        CLIPS[cel.name].pose(C, k);
        // Ramp in, ramp out.  w hits exactly 0 at the end, and because the
        // walk pose above is recomputed live every frame, the release lands
        // on the current stride with no pop — the blend-out IS the release.
        const w = Math.min(1, cel.t / cel.in) *
                  Math.min(1, (cel.dur - cel.t) / cel.out);
        for (let i = 0; i < POSE_KEYS.length; i++) {
          const key = POSE_KEYS[i];
          P[key] += (C[key] - P[key]) * w;
        }
      }
    }

    this._apply(P);
  }

  /** Write a pose onto the rig.  The only place joints are touched. */
  _apply(P) {
    this.legL.rotation.x = P.legLx;
    this.legR.rotation.x = P.legRx;
    this.armL.rotation.x = P.armLx;
    this.armR.rotation.x = P.armRx;
    this.armL.rotation.z = P.armLz;
    this.armR.rotation.z = P.armRz;
    this.body.position.y = P.bodyY;      // the hop lifts the body, not the root,
    this.body.rotation.x = P.bodyRx;     // so the blob stays on the ground
    this.body.rotation.z = P.bodyRz;
    this.body.rotation.y = this._yaw + P.yaw;
    this.head.rotation.x = P.headRx;
    this.head.rotation.y = P.headRy;
    this.hat.position.y = P.hatY;
    this.hat.rotation.x = P.hatRx;
  }

  /** Static seat pose: knees up, hands forward on the wheel or the rail. */
  _applySeated() {
    const P = blankPose(this._pose);
    P.legLx = -1.52; P.legRx = -1.52;      // thighs forward over the footwell
    P.armLx = -1.05; P.armRx = -1.05;      // hands out to the wheel
    P.armLz = 0.12; P.armRz = -0.12;
    P.bodyY = -0.30;                       // knees bend: the torso drops onto the cushion
    this._apply(P);
    this.phase = 0;
    this.swingAmp = 0;
  }

  /** Face the avatar toward a point, easing rather than snapping. */
  faceToward(x, z, dt, rate = 9) {
    const want = Math.atan2(x - this.root.position.x, z - this.root.position.z);
    let d = want - this.body.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.body.rotation.y += d * Math.min(1, dt * rate);
  }

  get heading() { return this.body.rotation.y; }
  set heading(v) { this.body.rotation.y = v; }

  setVisible(v) { this.root.visible = v; }

  dispose() {
    for (const m of Object.values(this.mats)) m.dispose();
    this.blob.material.dispose();
    // geometries are shared singletons — leave them alone
  }
}

/** Free the shared geometry/texture (only on teardown). */
export function disposeAvatarAssets() {
  _box?.dispose(); _box = null;
  _blob?.dispose(); _blob = null;
  _blobTex?.dispose(); _blobTex = null;
}
