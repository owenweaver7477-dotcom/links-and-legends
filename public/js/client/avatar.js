/* =========================================================================
   avatar.js — the blocky golfer
   -------------------------------------------------------------------------
   A stylised low-poly humanoid: thirteen boxes and a blob shadow, so fourteen
   draw calls, all sharing ONE BoxGeometry and one material per colour.  The
   walk cycle is pure trigonometry on the limb rotations — no skinning, no
   animation mixer, nothing that costs frame time.  Celebrations blend over the
   same joints, so a birdie fist-pump adds no geometry at all.
   ========================================================================= */

import * as THREE from '../../vendor/three.module.js';
import { AVATAR_HEIGHT, BODIES, clubDecalFor } from '../shared/avatars.js';
import { UNLOCKS } from '../shared/unlocks.js';
import { CLIPS, EMOTE_CLIPS, SHOVE_CLIPS, POSE_KEYS, blankPose } from './celebrations.js';
import { CLUB_BY_KEY } from '../shared/clubs.js';
import { FABRICS, GLOVES, WATCHES, CUTS, SHOE_TYPES, DECAL_SLOTS } from '../shared/wardrobe.js';
import { makeLife, blankLayer, breathe, footPlant, walkKnees, swingLayers } from './anim.js';
import { shirtMaterial, decalMaterial, decalHalo } from './decals.js';
import { shaftDecalTexture } from './shaftdecals.js';
import { setById, rarityRank, STARTER_SET } from '../shared/clubsets.js';

/* One unit box, reused by every part of every avatar.
   `userData.shared` is what stops GolfScene.dispose() from freeing these on
   every hole change — it walks the scene graph and disposes anything without
   the flag, which would tear the geometry out from under every live avatar. */
const shared = g => { g.userData.shared = true; return g; };

/* THE ONE GEOMETRY EVERY AVATAR PART IS MADE OF, and it is no longer a
   cube. A chamfer of six percent on each axis, which is small enough that
   nothing changes shape and large enough that every silhouette in the game
   softens at once — a torso, a cap brim, a shoe, a club head.

   Why this is worth 44 triangles instead of 12. A hard 90-degree edge has
   one normal on each side and nothing between them, so it takes the light
   in exactly two steps: it is the single strongest "made of boxes" signal
   there is, and it is why these figures read as placeholder art however
   well they are lit. A chamfer puts a third, angled face on every edge that
   catches a highlight along its length, and that thin bright line is what
   the eye reads as a manufactured object rather than a primitive.

   PROPORTIONAL, deliberately. Parts are scaled hard on one axis — a club
   shaft is 0.020 x 0.80 x 0.020 — so a chamfer in unit space becomes a
   different absolute size per axis. That is the behaviour worth having: a
   1.2 mm chamfer on the shaft (invisible, correctly) and a 2.4 cm one on the
   torso (visible, correctly), from one number.

   Still procedural, still one shared geometry, still no download. Eight
   golfers cost about 5,000 triangles against the hole's 143,000. */
const CHAMFER = 0.06;

function chamferedBox(b = CHAMFER) {
  const i = 0.5 - b;          // where a face stops and the bevel begins
  const o = 0.5;              // the outer extent, unchanged
  const pos = [], idx = [];
  const V = (x, y, z) => { pos.push(x, y, z); return pos.length / 3 - 1; };
  const quad = (a, c, d, e) => idx.push(a, c, d, a, d, e);

  /* Eight corner points per octant: the cube's corner cut back to three
     points, one per axis. Indexed by sign so the loops below can find them. */
  const corner = {};
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    corner[`${sx}${sy}${sz}`] = {
      x: V(sx * o, sy * i, sz * i),
      y: V(sx * i, sy * o, sz * i),
      z: V(sx * i, sy * i, sz * o)
    };
  }
  const C = (sx, sy, sz) => corner[`${sx}${sy}${sz}`];

  /* The six faces, each an inset square of four corner points. Winding is
     per-face so every one points outward. */
  const faces = [
    ['x', 1,  [[1,-1,-1],[1,-1,1],[1,1,1],[1,1,-1]]],
    ['x', -1, [[-1,-1,1],[-1,-1,-1],[-1,1,-1],[-1,1,1]]],
    ['y', 1,  [[-1,1,1],[1,1,1],[1,1,-1],[-1,1,-1]]],
    ['y', -1, [[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1]]],
    ['z', 1,  [[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]],
    ['z', -1, [[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]]]
  ];
  for (const [axis, , pts] of faces) {
    const [a, c, d, e] = pts.map(p => C(p[0], p[1], p[2])[axis]);
    quad(a, c, d, e);
  }

  /* The twelve edge bevels. Each joins two face-points on one corner to the
     two on its neighbour along the shared axis. */
  const edges = [
    // edges running along Z: vary sx, sy
    ...[[1,1],[1,-1],[-1,-1],[-1,1]].map(([sx, sy]) => ['z', sx, sy]),
    // along X: vary sy, sz
    ...[[1,1],[1,-1],[-1,-1],[-1,1]].map(([sy, sz]) => ['x', sy, sz]),
    // along Y: vary sz, sx
    ...[[1,1],[1,-1],[-1,-1],[-1,1]].map(([sz, sx]) => ['y', sz, sx])
  ];
  for (const [along, s1, s2] of edges) {
    let a, b2, c, d;
    if (along === 'z') {
      a = C(s1, s2, -1).x; b2 = C(s1, s2, -1).y;
      c = C(s1, s2, 1).y;  d = C(s1, s2, 1).x;
    } else if (along === 'x') {
      a = C(-1, s1, s2).y; b2 = C(-1, s1, s2).z;
      c = C(1, s1, s2).z;  d = C(1, s1, s2).y;
    } else {
      a = C(s2, -1, s1).z; b2 = C(s2, -1, s1).x;
      c = C(s2, 1, s1).x;  d = C(s2, 1, s1).z;
    }
    quad(a, b2, c, d);
    quad(d, c, b2, a);        // both windings: an edge strip is seen from
                              // either side depending on the octant, and two
                              // triangles is cheaper than working out which
  }

  /* The eight corner triangles, both windings for the same reason. */
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const c = C(sx, sy, sz);
    idx.push(c.x, c.y, c.z, c.z, c.y, c.x);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

let _box = null;
const box = () => (_box || (_box = shared(chamferedBox())));
/* The contact patch: small and dark, not big and soft. A soft circle the
   width of the figure is a fake shadow, and there is a real one now. */
/* ══════════════════════════════════════════════════ WHERE THE HANDS ARE ══
   THE GEOMETRY THAT MADE THIS IMPOSSIBLE. The club hung off the trail
   SHOULDER, 0.355H below it. The shoulders are 0.262 either side of centre
   and an arm reaches 0.30H — so that grip was 0.76 from the lead shoulder
   against a 0.53 reach. No pose could put the lead hand on it, which is why
   every golfer in this game has swung one-handed with the other arm keeping
   time somewhere near the chest.

   Two spheres of radius 0.53 centred 0.52 apart intersect in a lens, and
   the lowest point of that lens is sqrt(0.53² - 0.262²) = 0.465 below the
   shoulder line, ON THE CENTRELINE. That is the only place two hands on
   this rig can meet. So the club hangs from there now — from a `hands`
   group between the shoulders rather than off one of them — and both arms
   are solved onto it.

   GRIP_RISE is what the grip moved up by, and every shaft grows by exactly
   that much below, so the head still meets the ball. */
const GRIP_DROP = AVATAR_HEIGHT * 0.247;    // 0.44 — inside both arms' reach
const GRIP_RISE = AVATAR_HEIGHT * 0.108;    // 0.355H - 0.247H, given back to the shaft

const CONTACT_SCALE = 0.62;
const CONTACT_OPACITY = 0.55;

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
  _blobTex.userData.shared = true;   // scene.dispose() must never free this
  return _blobTex;
}

/* The carts draw the same blob shadow.  Sharing the function rather than the
   texture keeps it lazy — nothing is rasterised until something needs one. */
export { blobTexture as sharedBlobTexture, blobGeo as sharedBlobGeo };

/* One face for the whole field: two eyes and the hint of a smile, drawn once
   and shared.  It rides a tiny plane just in front of the head, so the box
   UV problem (a cube texture repeats on every side) never comes up. */
let _faceTex = null, _faceGeo = null, _faceMat = null;
let _decalGeo = null;      // one plane, shared by every decal in the game
function faceParts() {
  if (!_faceMat) {
    const S = 64;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,0)'; g.fillRect(0, 0, S, S);
    g.fillStyle = '#1d2126';
    g.beginPath(); g.ellipse(20, 26, 4.6, 6.2, 0, 0, 7); g.fill();
    g.beginPath(); g.ellipse(44, 26, 4.6, 6.2, 0, 0, 7); g.fill();
    g.strokeStyle = 'rgba(20,24,28,.85)'; g.lineWidth = 2.6; g.lineCap = 'round';
    g.beginPath(); g.arc(32, 36, 9, Math.PI * 0.22, Math.PI * 0.78); g.stroke();
    _faceTex = new THREE.CanvasTexture(c);
    _faceTex.userData.shared = true;
    _faceGeo = shared(new THREE.PlaneGeometry(1, 1));
    _faceMat = new THREE.MeshBasicMaterial({ map: _faceTex, transparent: true, depthWrite: false });
    _faceMat.userData = { shared: true };
  }
  return { geo: _faceGeo, mat: _faceMat };
}

const ZERO = blankLayer();       // for the paths that have no layer
const H = AVATAR_HEIGHT;          // 1.78 m
const SEATED_LEG = 0.62;          // knee-less legs, tucked into the footwell
const part = (mat, w, h, d, x, y, z) => {
  const m = new THREE.Mesh(box(), mat);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  return m;
};

/** A hex colour darkened (negative amount) or lightened (positive) by a
 *  fraction — the cheap way to get a matching cuff or clasp shade for a
 *  worn item without adding a second colour field to every wardrobe
 *  entry that might one day want a trim detail. */
const shadeHex = (hex, amount) => {
  const c = new THREE.Color(hex);
  if (amount < 0) c.multiplyScalar(1 + amount);
  else c.lerp(new THREE.Color(0xffffff), amount);
  return '#' + c.getHexString();
};

/* ─────────────────────────────────────────────────── two-bone arm IK ──
   Scratch objects, module level: this runs on every avatar on every frame
   and allocating four vectors and two quaternions per call is the kind of
   thing that shows up as garbage-collection stutter with eight golfers on
   screen.  */
const _ikTarget = new THREE.Vector3();
const _ikDir = new THREE.Vector3();
const _ikDown = new THREE.Vector3(0, -1, 0);
const _ikQ = new THREE.Quaternion();
const _ikBend = new THREE.Quaternion();
const _ikX = new THREE.Vector3(1, 0, 0);

/**
 * Point a two-segment limb so its far end lands on `target`, given in the
 * limb's own parent space.
 *
 * WHY THIS EXISTS. Both arms were driven by one number — `P.armLx =
 * P.armRx` — so they swept two parallel arcs 52 cm apart for the whole
 * swing. The club hangs off the right arm, which meant the LEFT hand spent
 * every swing about half a metre from the grip it is supposed to be
 * holding. On a rig made of boxes that reads as a golfer swinging
 * one-handed with the other arm keeping time.
 *
 * The maths is the standard two-link solve, and it is short because the two
 * segments are the same length. With links of a = L/2 and an elbow folded
 * by β, the hand sits at distance 2a·cos(β/2) from the shoulder and at an
 * angle of β/2 off the upper arm — so aim the shoulder at the target, back
 * it off by half the fold, and fold the elbow by the rest.
 *
 * @param limb   the shoulder group (must expose `.joint`, from limb())
 * @param len    the limb's full reach
 * @param target the point to reach, in the limb's PARENT space
 */
function reachTo(limb, len, target) {
  _ikDir.copy(target).sub(limb.position);
  const d = _ikDir.length();
  if (d < 1e-4) return;
  _ikDir.divideScalar(d);

  // how far the elbow has to fold to bring the hand in to `d`
  const bend = 2 * Math.acos(Math.min(1, Math.max(0, d / len)));

  _ikQ.setFromUnitVectors(_ikDown, _ikDir);          // aim the whole arm
  _ikBend.setFromAxisAngle(_ikX, -bend / 2);         // then back off half the fold
  limb.quaternion.copy(_ikQ).multiply(_ikBend);
  limb.joint.rotation.set(bend, 0, 0);
  /* The elbow clamp in _apply is `Math.min(0, …)`, which folds the arm the
     other way — this one is solved, not authored, so it writes the joint
     directly and _apply leaves a solved arm alone. */
}

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
      cap: M(look.cap),
      /* The shirt is the one garment worth a real material: it is the
         biggest surface on the golfer and the only one a player looks at
         from two metres on the wardrobe screen. Pattern comes from a
         procedurally drawn tile, sheen decides lambert versus phong. */
      shirt: shirtMaterial(look.shirt, look.pattern, look.shirt2 || '#232833',
        (FABRICS.find(f => f.id === look.fabric) || FABRICS[0]).sheen),
      skin: M(look.skin), trousers: M(look.trousers),
      shoe: M(look.shoes || '#2b2b2f'), accent: M(ballColor),
      hair: M(look.hairColor || '#241c18'), lens: M('#20262e')
    };

    /* --- torso and head ------------------------------------------------ */
    /* The torso used to be a single box, which can only ever be a rectangle —
       there is nowhere for a waist to be.  It is three stacked segments now,
       so hips, waist and chest can each have their own width and the
       silhouette actually reads as a body shape from behind, which is the
       view you spend a whole round looking at.

       proportions: legs to 0.46H, torso to 0.80H, head on top */
    const B = BODIES.find(b => b.id === (look.body || 'straight')) || BODIES[0];
    this.build = B;
    const W = 0.42, D = 0.24;                    // the base rig's torso
    this.body = new THREE.Group();

    /* ═══════════════════════════════════ THERE IS A PELVIS NOW ══════════
       The rig had one group holding the hip box, the waist, the chest, the
       head and all four limbs. Turning the shoulders therefore turned the
       LEGS too, so the code faked separation by counter-rotating both legs
       by the same angle — which holds the feet still but leaves the hip box
       itself rotating with the chest. A golfer's pelvis and shoulders were
       welded together, and every swing, slap and barge in the game was one
       rigid twist with the feet screwed on backwards to hide it.

       Three groups now, nested the way a body is:

         body   the figure — facing, lean, and the hop that lifts it
          └ hips    the pelvis. The legs hang off THIS, so they follow it.
             └ torso   waist, chest, head, arms — turns AGAINST the pelvis

       `P.yaw` drives the hips and `P.twist` the torso, which composes to
       exactly the shoulder angle the old code produced and gives the legs
       exactly the angle the counter-rotation gave them. Every clip written
       against the old rig plays identically. What changes is the pelvis,
       which now turns with the legs instead of with the chest — and the
       separation between hips and shoulders becomes a real thing the swing
       can open up rather than a number with nowhere to go. */
    this.hips = new THREE.Group();
    this.torso = new THREE.Group();
    this.body.add(this.hips);
    this.hips.add(this.torso);

    // hips -> waist -> chest, spanning the same H*0.47 .. H*0.79 as before
    this.hips.add(part(this.mats.trousers, W * B.hips, H * 0.075, D * B.depth, 0, H * 0.5075, 0));
    this.torso.add(part(this.mats.shirt, W * B.waist, H * 0.105, D * 0.95 * B.depth, 0, H * 0.5975, 0));
    // kept, because breathing scales it and nothing else in the rig moves
    // when a golfer is standing still
    this.chest = part(this.mats.shirt, W * B.chest, H * 0.140, D * B.depth, 0, H * 0.7200, 0);
    /* part() SIZES A UNIT CUBE THROUGH ITS SCALE, so the breathing must
       multiply that base rather than set a scale of its own. Setting it
       replaced a 0.42 x 0.25 x 0.24 chest with a one-metre cube — a golfer
       with a slab for a torso, which is exactly what appeared on screen. */
    this._chestBase = this.chest.scale.clone();
    this.torso.add(this.chest);
    if (B.bust > 0) {
      // sits proud of the chest front, so it reads in silhouette rather than
      // only head-on; two boxes rather than one so it is not a shelf
      const bw = W * B.chest * 0.34, by = H * 0.700, bz = D * B.depth * 0.5;
      this.torso.add(part(this.mats.shirt, bw, H * B.bust, D * 0.34 * B.depth, bw * 0.52, by, bz));
      this.torso.add(part(this.mats.shirt, bw, H * B.bust, D * 0.34 * B.depth, -bw * 0.52, by, bz));
    }

    // The head and hat hang off pivots at the neck so a celebration can nod,
    // shake and doff the cap.  Groups cost nothing — they are never submitted
    // to the renderer — but the children have to be rebased onto the pivot,
    // hence the H*0.7925 subtracted from each original height.
    const NECK = H * 0.7925;
    this.head = new THREE.Group();
    this.head.position.set(0, NECK, 0);
    this.head.add(part(this.mats.skin, 0.225, H * 0.125, 0.225, 0, H * 0.0625, 0));
    // the face: a shared decal floating a hair in front of the head box
    const fp = faceParts();
    const face = new THREE.Mesh(fp.geo, fp.mat);
    face.scale.set(0.20, 0.20, 1);
    face.position.set(0, H * 0.0625, 0.1135);
    this.head.add(face);
    /* Hair, then headwear over it — both built from the same boxes as the
       rest of the golfer.  Nothing is loaded: a hairstyle is three or four
       scaled cubes, which is why a wardrobe this size adds no bytes at all to
       the build.  Kept on the `hat` pivot so a celebration can still doff it. */
    this.hair = new THREE.Group();
    this.head.add(this.hair);
    this.hat = new THREE.Group();
    this.head.add(this.hat);
    this.accessory = new THREE.Group();
    this.head.add(this.accessory);
    this.buildHeadwear(look);
    this.torso.add(this.head);

    /* --- limbs, pivoted at the shoulder / hip so they can swing --------- */
    /* A limb is TWO segments with a joint between them.

       It was one box from shoulder to hand and one from hip to foot, which
       is why every walk in this game has been a scissor and every swing a
       pair of straight sticks: a limb with no elbow cannot bend, so the only
       animation available was rotating the whole thing about its root.

       The joint group hangs at the halfway point and carries the lower
       segment and the extremity, so rotating it bends the limb exactly where
       a knee or an elbow is. The outer group still rotates from the hip or
       shoulder and every existing clip that sets armLx or legRx keeps
       working untouched — this only ADDS somewhere to bend. */
    const limb = (mat, w, len, x, y, endMat, endLen) => {
      const g = new THREE.Group();
      g.position.set(x, y, 0);
      const half = len / 2;
      g.add(part(mat, w, half, w, 0, -half / 2, 0));      // thigh / upper arm
      const joint = new THREE.Group();
      joint.position.set(0, -half, 0);
      joint.add(part(mat, w * 0.94, half, w * 0.94, 0, -half / 2, 0));
      /* The end (foot or hand) hangs off its own pivot at the bottom of the
         shin/forearm rather than being fixed to the knee/elbow directly.
         A shoe that is rigidly bolted to the shin cannot roll through a
         step — it stays a flat plank from heel-strike to toe-off, which is
         exactly the kind of thing that reads as a figure skating rather than
         walking. On legs this is driven below (see walkKnees' ankle curve
         and footPlant's slope tilt); on arms it is left at rest, so the club
         — parented straight onto armR, not onto this pivot — lands exactly
         where it always did. */
      const end = new THREE.Group();
      end.position.set(0, -half, 0);
      if (endMat) end.add(part(endMat, w * 1.05, endLen, w * 1.5, 0, -endLen / 2, 0.02));
      joint.add(end);
      g.add(joint);
      g.joint = joint;                                    // the knee or elbow
      g.end = end;                                         // the ankle or wrist
      return g;
    };
    /* Mind the sign — this is why the golfer was left-handed.
       A rotation about Y by heading h maps local +x to (cos h, -sin h), which
       in this project's frame is the avatar's LEFT (see test/cart.mjs, where
       left(h) = (cos h, -sin h)).  So a limb authored at local +x renders on
       the LEFT, and the club — parented to armR — hung off the wrong side,
       reaching across the golfer instead of down to the ball.  The limbs are
       now placed so their names match the side they actually appear on. */
    /* ARMS ARE THE SAME ON EVERY BUILD, and deliberately so.  The club is
       parented to armR and the stance is solved from a measured reach; change
       the shoulder anchor or the arm length here and the club stops landing
       on the ball on every build but one.  Only the sleeve thickness varies. */
    const aw = 0.115 * (0.94 + 0.06 * B.limb);
    this.armL = limb(this.mats.shirt, aw, H * 0.30, 0.262, H * 0.775, this.mats.skin, H * 0.06);
    this.armR = limb(this.mats.shirt, aw, H * 0.30, -0.262, H * 0.775, this.mats.skin, H * 0.06);
    this.elbowL = this.armL.joint; this.elbowR = this.armR.joint;
    this._armLen = H * 0.30;     // what the IK solver reaches with
    /* The hand block at the end of each arm — built by the same limb()
       helper the legs use, which is why it exists at all, but left
       unrotated until now: the club is parented straight to armR (see
       limb()'s own comment on why), so spinning this pivot was never
       going to move it. It DOES move the hand itself, which the swing
       below now drives in lockstep with the club's own wrist-hinge
       rotation — both hands are on the same grip in a real swing, so
       they hinge together, not independently. */
    this.wristL = this.armL.end; this.wristR = this.armR.end;
    // legs are free to change: nothing is mounted to them
    const lw = 0.145 * B.limb, lx = 0.105 * B.hipSpread, ll = H * 0.42 * B.legLen;
    this.legL = limb(this.mats.trousers, lw, ll, lx, H * 0.47, this.mats.shoe, H * 0.05);
    this.legR = limb(this.mats.trousers, lw, ll, -lx, H * 0.47, this.mats.shoe, H * 0.05);
    this.kneeL = this.legL.joint; this.kneeR = this.legR.joint;
    this.ankleL = this.legL.end; this.ankleR = this.legR.end;
    // the rest position of the knee group, which the foot IK offsets FROM
    this._legHalf = ll / 2;
    /* Arms on the torso, legs on the pelvis. That one line is the whole
       difference between a body that turns and a body that twists. */
    this.torso.add(this.armL, this.armR);
    this.hips.add(this.legL, this.legR);

    /* Worn accessories that hang off the body rather than the head.  Built
       after the limbs, because the glove goes ON one of them. */
    this.worn = new THREE.Group();
    this.torso.add(this.worn);
    this.buildWorn(look);

    /* --- the club: grip, shaft and an interchangeable head ---------------
       The same five boxes serve every club in the bag; setClub() reshapes
       them, so a driver, a 7 iron and the putter are the same draw calls
       with different proportions. Hidden only while actually walking (see
       the visibility line in update()) — a standing golfer, on the tee or
       in a preview panel, shows it the whole time, since that's the only
       moment anyone is actually looking to check their own decal. */
    this.mats.chrome = M('#c9ccd2');
    this.mats.headDark = M('#3a3d42');
    this.club = new THREE.Group();
    this.club.position.set(0, -GRIP_DROP, 0.02);       // in both hands
    this.club.rotation.x = 0.25;                        // shaft leans toward the ball
    this.clubGrip = part(this.mats.shoe, 0.034, 0.16, 0.034, 0, -0.06, 0);
    this.clubShaft = part(this.mats.chrome, 0.020, 0.80, 0.020, 0, -0.54, 0);
    this.clubHead = new THREE.Group();
    this.clubFace = part(this.mats.chrome, 0.05, 0.07, 0.03, 0, 0, 0.02);
    this.clubSole = part(this.mats.headDark, 0.05, 0.03, 0.10, 0, -0.04, 0.05);
    this.clubHead.add(this.clubFace, this.clubSole);
    /* The decal. It used to be a BAND — one 10cm box round the shaft — and
       at the distance this game is played from, that is a smudge you have to
       be told about. It is now the whole club: a sleeve over the full length
       of the shaft, and a plate on the head shaped to whatever club is in
       hand (see _shapeDecal). Two meshes with their own material, rather
       than a map on mats.chrome, because that material is shared with the
       club face and the putter hosel and mapping it would paint the pattern
       onto parts of the club that are not the finish.

       Levels buy identity and nothing else in this game, so a reward you
       cannot see is not a reward. Both meshes are hidden when nothing is
       equipped, which is the state every new player is in. */
    this.clubDecal = part(M('#8fe07a'), 0.023, 0.80, 0.023, 0, -0.54, 0);
    this.clubDecalHead = part(M('#8fe07a'), 0.05, 0.02, 0.06, 0, 0, 0.02);
    this.clubDecal.visible = this.clubDecalHead.visible = false;
    this.clubHead.add(this.clubDecalHead);
    this.club.add(this.clubGrip, this.clubShaft, this.clubHead, this.clubDecal);
    this.setDecal(clubDecalFor(look, 'I7'));   // setClub below refines this per club
    this.club.visible = false;
    /* THE HANDS, between the shoulders — see GRIP_DROP. A group of its own
       rather than a parent-swap onto the torso, because the hands SWING:
       this rotates with the arms through the arc, and the club rides it, so
       the grip is always at a point both arms can be solved onto. */
    this.hands = new THREE.Group();
    this.hands.position.set(0, H * 0.775, 0);        // the shoulder line, centred
    this.torso.add(this.hands);
    this.hands.add(this.club);
    this.clubKey = null;
    this.clubSetId = null;
    this.setClub('I7', STARTER_SET);

    /* Its own phase, its own breath rate, its own fidget timer. Eight
       players breathing in unison is worse than eight not breathing. */
    this.life = makeLife(Math.random());
    this._layer = blankLayer();
    this._dressWardrobe(look, M);

    this.root.add(this.body);

    /* --- CONTACT, which is two things now -------------------------------
       A shadow map at 52 metres of coverage resolves a golfer to a few
       texels: it is the right tool for "this figure is standing in the
       sun" and the wrong one for "these shoes are touching that grass".
       The second is what makes something look placed rather than pasted,
       and it is the only ambient occlusion this scene has.

       So the disc stayed, and stopped pretending to be a shadow. It is a
       tight dark patch right under the feet — half the width it used to
       be, because a big soft circle IS a fake shadow and now competes with
       the real one — and it shrinks and fades as the figure leaves the
       ground, which is the whole reason contact AO is a separate thing
       from a shadow in the first place. */
    this.blob = new THREE.Mesh(blobGeo(), new THREE.MeshBasicMaterial({
      map: blobTexture(), transparent: true, depthWrite: false, opacity: CONTACT_OPACITY
    }));
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.scale.set(CONTACT_SCALE, CONTACT_SCALE, 1);
    this.blob.renderOrder = 1;
    this.root.add(this.blob);

    /* And the figure casts a REAL one. It never did — every avatar in this
       game has been lit from a sun that could not see it, which is why they
       read as decals on the fairway however good the light was. The scene
       turns this off wholesale on the low tier (see setQuality), so this is
       a request rather than a demand. */
    this._castShadows();

    this.phase = 0;
    this.speed = 0;
    this.swingAmp = 0;          // eased, so limbs settle instead of snapping
    this.seated = false;
    this.cel = null;            // { name, t, dur, in, out } while celebrating
    this.golf = null;           // { k, strikeT, yawLock } while addressing/swinging
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
    /* Emotes ride the exact same player as the celebrations — same pose
       contract, same blend in and out, same thirteen boxes.  A chosen emote
       and an earned celebration are the same kind of thing to the renderer,
       so there is one code path and one place for it to go wrong. */
    const c = CLIPS[name] || EMOTE_CLIPS[name] || SHOVE_CLIPS[name];
    /* Melee needs both hands. A barge or a slap with a driver still held in
       front of you is a golfer shoving somebody while carrying a club, and
       on this rig — where the club hangs between the shoulders and the arms
       swing independently — it reads as the club being flung about rather
       than held. It goes away for the length of the clip. */
    this._melee = !!SHOVE_CLIPS[name];
    if (!c || this.seated) return 0;      // never celebrate from a cart seat
    this.cel = { name, t: 0, dur: c.dur, in: c.in, out: c.out, clip: c };
    return c.dur;
  }
  get celebrating() { return !!this.cel; }
  cancelCelebration() { this.cel = null; }

  /** Glove and towel — the two accessories that are not on the head. */
  buildWorn(look) {
    const g = this.worn;
    while (g.children.length) g.remove(g.children[0]);
    const acc = look.accessory || 'none';
    if (acc === 'glove') {
      // over the LEAD hand, which for a right-hander is the left
      this.mats.glove = this.mats.glove || this.mats.cap;
      g.add(part(this.mats.glove, 0.126, H * 0.062, 0.126, 0.262, H * 0.445, 0));
    } else if (acc === 'towel') {
      // tucked at the belt, and it reads clearly from behind
      g.add(part(this.mats.cap, 0.075, H * 0.085, 0.022, 0.165, H * 0.505, -0.115));
    }
  }

  /** Re-point the club meshes at the current materials (used after a swap). */
  _retintClub() {
    const c = this.mats.chrome, d = this.mats.headDark;
    if (this.clubShaft) this.clubShaft.material = c;
    // the face and sole swap between the two depending on club type, so
    // setClub's own assignment below re-resolves them on the next call
    this.clubKey = null;
  }

  /* ------------------------------------------------------- head styling ---
     Rebuilds hair, hat and accessory from a look.  Cheap enough to call on
     every change (the customiser previews live), and the only allocation is a
     handful of boxes sharing materials that already exist. */
  /* Every mesh on the figure casts. Its own method because the headwear is
     REBUILT whenever the look changes (hair, hat, accessory are torn down
     and remade), and a part added after the constructor would otherwise be
     the one thing on the golfer with no shadow — which reads as a hat
     floating rather than as an oversight. */
  _castShadows() {
    this.root.traverse(o => {
      // not the contact patch: a shadow caster that is itself a shadow
      // stamps a second dark disc into the map under the first
      if (o.isMesh && o !== this.blob) o.castShadow = true;
    });
  }

  buildHeadwear(look) {
    const clear = g => { while (g.children.length) g.remove(g.children[0]); };
    clear(this.hair); clear(this.hat); clear(this.accessory);

    const hairMat = this.mats.hair, capMat = this.mats.cap;
    const style = look.hair || 'short';
    const hat = look.hat || 'cap';
    // A beanie or a bucket swallows the top of the head, so the crown of the
    // hair is skipped under them — otherwise it pokes through the hat.
    const covered = hat === 'beanie' || hat === 'bucket';

    if (style !== 'bald') {
      const W = 0.238, TOP = H * 0.1215;
      if (!covered) this.hair.add(part(hairMat, W, H * 0.022, W, 0, TOP, 0));
      // the back of the head, which reads from behind while walking
      if (style !== 'buzz') this.hair.add(part(hairMat, W, H * 0.055, 0.03, 0, H * 0.075, -0.112));
      if (style === 'swept') this.hair.add(part(hairMat, W * 0.9, H * 0.018, 0.10, 0.02, TOP + H * 0.008, 0.055));
      if (style === 'ponytail') {
        this.hair.add(part(hairMat, 0.055, H * 0.10, 0.055, 0, H * 0.045, -0.145));
      } else if (style === 'bun') {
        this.hair.add(part(hairMat, 0.10, H * 0.045, 0.09, 0, H * 0.125, -0.125));
      } else if (style === 'afro') {
        this.hair.add(part(hairMat, 0.30, H * 0.085, 0.30, 0, H * 0.105, -0.006));
      } else if (style === 'long') {
        this.hair.add(part(hairMat, W + 0.012, H * 0.115, 0.045, 0, H * 0.045, -0.118));
        this.hair.add(part(hairMat, 0.035, H * 0.10, 0.16, 0.115, H * 0.055, -0.02));
        this.hair.add(part(hairMat, 0.035, H * 0.10, 0.16, -0.115, H * 0.055, -0.02));
      }
    }

    // headwear.  The ball-coloured flash stays on anything with a front, so a
    // player is still identifiable from across the fairway.
    if (hat === 'cap') {
      this.hat.add(part(capMat, 0.24, H * 0.05, 0.24, 0, H * 0.1355, 0));
      this.hat.add(part(capMat, 0.22, H * 0.016, 0.12, 0, H * 0.1195, 0.16));
      this.hat.add(part(this.mats.accent, 0.06, H * 0.024, 0.014, 0, H * 0.1355, 0.122));
    } else if (hat === 'visor') {
      this.hat.add(part(capMat, 0.245, H * 0.020, 0.245, 0, H * 0.1235, 0));
      this.hat.add(part(capMat, 0.22, H * 0.014, 0.13, 0, H * 0.1185, 0.165));
      this.hat.add(part(this.mats.accent, 0.05, H * 0.016, 0.013, 0, H * 0.1235, 0.126));
    } else if (hat === 'bucket') {
      this.hat.add(part(capMat, 0.245, H * 0.052, 0.245, 0, H * 0.1330, 0));
      this.hat.add(part(capMat, 0.34, H * 0.014, 0.34, 0, H * 0.1090, 0));
    } else if (hat === 'beanie') {
      this.hat.add(part(capMat, 0.245, H * 0.062, 0.245, 0, H * 0.1300, 0));
      this.hat.add(part(this.mats.accent, 0.252, H * 0.014, 0.252, 0, H * 0.1010, 0));
    } else if (hat === 'flat') {
      this.hat.add(part(capMat, 0.242, H * 0.030, 0.240, 0, H * 0.1270, -0.012));
      this.hat.add(part(capMat, 0.20, H * 0.012, 0.10, 0, H * 0.1160, 0.150));
    } else if (hat === 'wide') {
      /* The wide brim. This was in the level table as a reward at 23 and
         did not exist as a hat, so reaching level 23 gave you a line in the
         clubhouse and nothing on your head. A low crown and a brim that
         goes all the way round, which is the one silhouette none of the
         others have. */
      this.hat.add(part(capMat, 0.235, H * 0.044, 0.235, 0, H * 0.1315, 0));
      this.hat.add(part(capMat, 0.44, H * 0.011, 0.44, 0, H * 0.1105, 0));
      this.hat.add(part(this.mats.accent, 0.245, H * 0.011, 0.245, 0, H * 0.1175, 0));
    }

    // accessories.  Glasses sit just proud of the face decal.
    const acc = look.accessory || 'none';
    if (acc === 'glasses' || acc === 'shades') {
      const lens = acc === 'shades' ? this.mats.lens : this.mats.chromeLens ||
        (this.mats.chromeLens = this.mats.lens);
      this.accessory.add(part(lens, 0.072, H * 0.020, 0.012, 0.052, H * 0.0705, 0.117));
      this.accessory.add(part(lens, 0.072, H * 0.020, 0.012, -0.052, H * 0.0705, 0.117));
      this.accessory.add(part(lens, 0.036, H * 0.005, 0.010, 0, H * 0.0705, 0.117));
      /* Temple arms. A front-only lens pair with nothing running back to
         the ear reads as safety goggles floated in front of a face, not
         glasses — the arms are what a real pair actually hangs from, and
         their absence was the single most "unfinished" thing on the
         accessory list. One thin bar per side, running from each lens's
         outer edge back along the head toward ear height. */
      const armLen = H * 0.062, armY = H * 0.0705;
      this.accessory.add(part(lens, 0.014, H * 0.010, armLen, 0.101, armY, 0.117 - armLen / 2 + H * 0.006));
      this.accessory.add(part(lens, 0.014, H * 0.010, armLen, -0.101, armY, 0.117 - armLen / 2 + H * 0.006));
    }
    /* Whatever was just rebuilt has to cast too — see _castShadows. */
    this._castShadows();
  }

  /**
   * Reshape the club in hand to match the club being played.  No meshes are
   * created or destroyed — the grip, shaft and two head boxes are rescaled
   * and re-tilted, so switching from driver to putter costs nothing and can
   * never pop assets in or out.
   */
  /**
   * The earned club decal. A colour, not a texture: the whole unlock table is
   * procedural on purpose (see unlocks.js), so a hundred levels of rewards
   * add nothing to the download.
   */
  /* ═══════════════════════════════════════════════════ THE WARDROBE ═══
     Gloves, a watch, arm sleeves, neckwear, the shoe shape, the trouser cut
     and every placed decal — added after the rig exists rather than woven
     through it, so a golfer wearing none of this is exactly the golfer the
     game had before and costs exactly what it did.

     Everything is boxes and one plane per decal. That is not a limitation
     being worked around, it is the art style: the whole game is boxes, and a
     smooth imported mesh on a blocky golfer would look like a mistake. */
  _dressWardrobe(look, M) {
    if (!look) return;
    this.wardrobeMats = [];
    const mine = hex => { const m = M(hex); this.wardrobeMats.push(m); return m; };

    /* ---- gloves. One hand, the lead hand, which is how golf works. ------ */
    const gl = GLOVES.find(g => g.id === look.glove);
    if (gl && gl.id !== 'none' && gl.hex) {
      const gm = mine(gl.hex);
      // over the lead hand: left for a right-handed swing
      this.armL.add(part(gm, 0.132, H * 0.070, 0.132, 0, -H * 0.300, 0));
      // a cuff ring at the wrist, a shade darker — without it the glove was
      // one flat colour merging straight into the bare forearm above it,
      // so the whole hand read as a single undifferentiated block
      this.armL.add(part(mine(shadeHex(gl.hex, -0.22)), 0.140, H * 0.014, 0.140, 0, -H * 0.268, 0));
      if (gl.id === 'winter') {
        this.armR.add(part(gm, 0.132, H * 0.070, 0.132, 0, -H * 0.300, 0));
        this.armR.add(part(mine(shadeHex(gl.hex, -0.22)), 0.140, H * 0.014, 0.140, 0, -H * 0.268, 0));
      }
    }

    /* ---- the watch, on the trail wrist so the glove does not cover it --- */
    const wa = WATCHES.find(w => w.id === look.watch);
    if (wa && wa.id !== 'none' && wa.hex) {
      const wm = mine(wa.hex);
      this.armR.add(part(wm, 0.108, H * 0.020, 0.108, 0, -H * 0.258, 0));
      // a face, proud of the band, so it catches light rather than reading
      // as a stripe painted on the arm
      this.armR.add(part(mine(wa.id === 'sport' ? '#4a9bd4' : '#f2f4f0'),
        0.052, H * 0.012, 0.030, 0, -H * 0.258, 0.056));
      // the clasp — a small darker tab on the underside, the one detail
      // that told a watch band apart from a plain painted-on bracelet
      this.armR.add(part(mine(shadeHex(wa.hex, -0.35)), 0.026, H * 0.008, 0.020, 0, -H * 0.258, -0.058));
    }

    /* ---- arm sleeves ---------------------------------------------------- */
    if (look.sleeve && look.sleeve !== 'none') {
      const sm = mine(look.shirt2 || '#232833');
      const arms = look.sleeve === 'both' ? [this.armL, this.armR]
                 : look.sleeve === 'left' ? [this.armL] : [this.armR];
      for (const a of arms) {
        a.add(part(sm, 0.148, H * 0.150, 0.148, 0, -H * 0.150, 0));
      }
    }

    /* ---- neckwear ------------------------------------------------------- */
    const neckY = H * 0.800;
    if (look.neck === 'collar') {
      this.torso.add(part(this.mats.shirt, 0.250, H * 0.022, 0.190, 0, neckY, 0));
    } else if (look.neck === 'scarf') {
      const nm = mine(look.shirt2 || '#7d2f42');
      this.torso.add(part(nm, 0.238, H * 0.030, 0.200, 0, neckY, 0));
      this.torso.add(part(nm, 0.070, H * 0.090, 0.036, 0.060, neckY - H * 0.055, 0.098));
    } else if (look.neck === 'buff') {
      this.torso.add(part(mine(look.shirt2 || '#3a4048'), 0.236, H * 0.060, 0.206, 0, neckY + H * 0.010, 0));
    } else if (look.neck === 'chain') {
      const cm = mine('#e8c15a');
      this.torso.add(part(cm, 0.150, H * 0.010, 0.014, 0, neckY - H * 0.012, 0.106));
      this.torso.add(part(cm, 0.030, H * 0.028, 0.018, 0, neckY - H * 0.035, 0.108));
    }

    /* ---- the trouser cut. Shorts and plus fours change where the leg
       stops being cloth and starts being skin, which is the whole point of
       choosing them and reads instantly in silhouette. ------------------- */
    const cut = CUTS.find(c => c.id === look.cut);
    if (cut && (cut.id === 'short' || cut.id === 'skort' || cut.id === 'knicker')) {
      const skin = this.mats.skin;
      const legTop = cut.id === 'knicker' ? H * 0.300 : H * 0.380;
      const w = cut.id === 'knicker' ? 0.128 : 0.120;
      for (const leg of [this.legL, this.legR]) {
        leg.add(part(skin, w, legTop, w, 0, -H * 0.235 + legTop * 0.5 - H * 0.06, 0));
      }
      if (cut.id === 'knicker') {
        // the sock, which is the half of plus fours people actually picture
        const sock = mine(look.shirt2 || '#e9e6dc');
        for (const leg of [this.legL, this.legR]) {
          leg.add(part(sock, 0.134, H * 0.130, 0.134, 0, -H * 0.190, 0));
        }
      }
    }

    /* ---- shoe shape ----------------------------------------------------- */
    const st = SHOE_TYPES.find(t => t.id === look.shoeType);
    if (st && st.id === 'boot') {
      for (const leg of [this.legL, this.legR]) {
        leg.add(part(this.mats.shoe, 0.150, H * 0.080, 0.150, 0, -H * 0.215, 0));
      }
    } else if (st && (st.id === 'spike' || st.id === 'soft')) {
      // a sole plate that overhangs, so spiked shoes read as chunkier
      for (const leg of [this.legL, this.legR]) {
        leg.add(part(mine('#1a1c1f'), 0.156, H * 0.014, 0.190, 0, -H * 0.268, 0.012));
      }
    }

    /* ---- decals --------------------------------------------------------- */
    this._placeDecals(look);
  }

  /**
   * One plane per filled slot, parented to whatever body part it sits on so
   * it swings, walks and celebrates with the golfer rather than floating
   * where the golfer used to be.
   */
  _placeDecals(look) {
    const map = look.decals;
    if (!map) return;
    this.decalMeshes = [];
    if (!_decalGeo) _decalGeo = shared(new THREE.PlaneGeometry(1, 1));

    /* Position, rotation and parent for each slot. `z`/`x` push the plane
       just proud of the surface it sits on — polygonOffset in the material
       handles the depth fight, this handles the geometry one. */
    const WHERE = {
      chest: { p: 'body', pos: [0, H * 0.735, 0.126], rot: [0, 0, 0] },
      back:  { p: 'body', pos: [0, H * 0.760, -0.126], rot: [0, Math.PI, 0] },
      armL:  { p: 'armL', pos: [0.078, -H * 0.115, 0], rot: [0, Math.PI / 2, 0] },
      armR:  { p: 'armR', pos: [-0.078, -H * 0.115, 0], rot: [0, -Math.PI / 2, 0] },
      hatF:  { p: 'hat',  pos: [0, H * 0.118, 0.116], rot: [0, 0, 0] },
      hatB:  { p: 'hat',  pos: [0, H * 0.118, -0.116], rot: [0, Math.PI, 0] },
      shoeL: { p: 'legL', pos: [0.080, -H * 0.240, 0.010], rot: [0, Math.PI / 2, 0] },
      shoeR: { p: 'legR', pos: [-0.080, -H * 0.240, 0.010], rot: [0, -Math.PI / 2, 0] },
      legL:  { p: 'legL', pos: [0.072, -H * 0.090, 0], rot: [0, Math.PI / 2, 0] },
      legR:  { p: 'legR', pos: [-0.072, -H * 0.090, 0], rot: [0, -Math.PI / 2, 0] }
    };

    for (const slot of DECAL_SLOTS) {
      const id = map[slot.id];
      if (!id) continue;
      const w = WHERE[slot.id];
      const parent = w && this[w.p];
      /* No hat means no cap-front slot, and silently skipping is right:
         a player who takes their hat off should not lose the badge, they
         should get it back when they put one on. */
      if (!parent) continue;
      const mat = decalMaterial(id, look.custom);
      if (!mat) continue;
      const m = new THREE.Mesh(_decalGeo, mat);
      m.scale.set(slot.size, slot.size, 1);
      m.position.set(...w.pos);
      m.rotation.set(...w.rot);
      m.renderOrder = 1;
      parent.add(m);
      this.decalMeshes.push(m);

      /* A glowing badge gets an actual light in the air around it, not just
         a brighter surface — see decals.js's decalHalo for why the material
         alone can't do this. Both this and the badge plane have depthWrite
         off, so it is renderOrder alone that keeps the halo behind the
         badge, not the z position (a fixed offset would need a different
         sign per slot depending on which way that slot's plane faces). A
         sprite always faces the camera, so no rotation is needed. */
      const halo = decalHalo(id);
      if (halo) {
        const s = new THREE.Sprite(halo);
        s.scale.set(slot.size * 2.2, slot.size * 2.2, 1);
        s.position.set(...w.pos);
        s.renderOrder = 0;
        parent.add(s);
        this.decalMeshes.push(s);
      }
    }
  }

  setDecal(id) {
    if (id === this._decalId) return;
    this._decalId = id;
    const u = id ? UNLOCKS.find(x => x.kind === 'decal' && x.id === id) : null;
    if (!this.clubDecal) return;
    this.clubDecal.visible = this.clubDecalHead.visible = !!u;
    if (!u) return;
    const color = u.color || '#8fe07a';
    // A real pattern per design, not a flat tint every design shared —
    // shaftDecalTexture returns null for an id it doesn't recognise, which
    // just leaves the sleeve a plain rectangle in its own colour, same as
    // the flat-tint behaviour this replaces.
    const tex = shaftDecalTexture(id, color);
    for (const m of [this.clubDecal, this.clubDecalHead]) {
      m.material.color.set(color);
      m.material.map = tex;
      m.material.needsUpdate = true;
    }
  }

  /* The head plate, shaped to the club in hand. A driver crown, an iron
     cavity back and a putter flange are three different surfaces and a
     pattern sized for one reads as a sticker on the others — which is the
     whole reason the per-class decal slots exist (avatars.js's clubDecals).
     Sized from the head meshes setClub has just laid out, so this needs no
     second table of dimensions to keep in step with that one. */
  _shapeDecal(c) {
    const d = this.clubDecalHead;
    if (!d) return;
    const f = this.clubFace.scale, so = this.clubSole.scale;
    if (c.putter) {
      // the flange top: the flat you look down at over the ball
      d.scale.set(so.x * 0.86, 0.008, so.z * 0.80);
      d.position.set(0, this.clubSole.position.y + so.y * 0.6, this.clubSole.position.z);
    } else if (c.type === 'wood' || c.type === 'hybrid') {
      // the crown: the top of the head, and the only part of a driver
      // anybody looks at while standing over it
      d.scale.set(f.x * 0.80, 0.008, f.z * 0.86);
      d.position.set(0, this.clubFace.position.y + f.y * 0.55, this.clubFace.position.z);
    } else {
      // the cavity back: a blade shows its finish from BEHIND, not on top
      d.scale.set(0.006, f.y * 0.70, f.z * 0.74);
      d.position.set(-(f.x * 0.62), this.clubFace.position.y, this.clubFace.position.z);
    }
  }

  setClub(key, setId = STARTER_SET) {
    /* The decal is resolved BEFORE the early return, because a player who
       runs a loud driver and quiet irons changes finish on every club change
       even when the set has not moved — and this method's own early-out is
       keyed on the set and the club, not on the decal. */
    this.setDecal(clubDecalFor(this.look, key));
    if (key === this.clubKey && setId === this.clubSetId) return;
    const c = CLUB_BY_KEY[key];
    if (!c) return;
    this.clubKey = key;

    // The set's visual identity — two materials repainted, no new meshes.
    if (setId !== this.clubSetId) {
      this.clubSetId = setId;
      /* The club you are actually holding for a whole round. Colours come
         from the set table itself (clubsets.js) rather than a look-up array
         here, so a new branded set is visually distinct the moment it is
         added and there is no second list to keep in step.

         `shine` is still derived rather than authored: it tracks RARITY, so
         a Mythic set catches the sun and the free starter does not. That is
         the one visual cue that reads at the distance you actually play
         from, which is why it is worth computing rather than eyeballing. */
      const set = setById(setId) || setById(STARTER_SET);
      const hex = s => parseInt(String(s || '#c9ccd2').slice(1), 16);
      const rank = Math.max(0, rarityRank(set?.rarity));
      const L = {
        shaft: hex(set?.shaft),
        head: hex(set?.head),
        // only the top two rarities glow, same as the old top-two sets did
        glow: rank >= 3 ? hex(set?.head) : 0,
        shine: rank * 0.25
      };
      this.mats.chrome.color.setHex(L.shaft);
      this.mats.headDark.color.setHex(L.head);
      this.mats.chrome.emissive.setHex(L.glow);
      this.mats.headDark.emissive.setHex(L.glow);
      /* A shiny set needs a material that can BE shiny, and Lambert cannot.
         Swapped rather than tweaked, and only once per set change.

         Standard rather than the Phong this used to reach for. A club head
         is metal, and Phong's highlight is a white dot placed where a light
         is — it does not know the sky is above it or the fairway below, so
         a "polished" set came out pale rather than reflective. On Standard
         it samples the scene environment (see scene.js's _buildEnvironment),
         which is generated from the sky this hole is actually under. */
      if (L.shine > 0.3 && !this.mats.chrome.isMeshStandardMaterial) {
        const up = m => {
          const n = new THREE.MeshStandardMaterial({ color: m.color, emissive: m.emissive });
          m.dispose(); return n;
        };
        this.mats.chrome = up(this.mats.chrome);
        this.mats.headDark = up(this.mats.headDark);
        this.clubShaft.material = this.mats.chrome;
        this._retintClub();
      }
      if (this.mats.chrome.isMeshStandardMaterial) {
        /* Rarity reads as POLISH: a Mythic shaft is a mirror and the free
           starter set is brushed. Metalness is held high on both because a
           golf club is metal either way — what a cheap one lacks is the
           finish, not the material. */
        this.mats.chrome.roughness = 0.55 - L.shine * 0.46;
        this.mats.chrome.metalness = 0.72 + L.shine * 0.28;
        this.mats.chrome.envMapIntensity = 0.7 + L.shine * 0.9;
        this.mats.headDark.roughness = 0.62 - L.shine * 0.44;
        this.mats.headDark.metalness = 0.66 + L.shine * 0.30;
        this.mats.headDark.envMapIntensity = 0.6 + L.shine * 0.8;
      }
    }

    // shaft length: drivers are long, wedges short, the putter shortest
    /* GRIP_RISE: the club's grip moved UP to the hand (see the constructor),
       so every shaft is longer by exactly that much and the head lands
       precisely where it always did. One constant, three uses, no drift. */
    const len = (c.putter ? 0.62 : c.type === 'wood' ? 0.92 : c.type === 'hybrid' ? 0.84
      : 0.82 - (c.loft - 18) * 0.0032) + GRIP_RISE;
    this.clubShaft.scale.y = len;
    this.clubShaft.position.y = -0.14 - len / 2;
    this.clubHead.position.y = -0.14 - len;
    /* The decal sleeve is the shaft, a hair proud of it — so a decal is the
       club's FINISH rather than a ring somewhere down it. It has to track
       the shaft on every club change, because a driver's shaft is half as
       long again as a putter's. */
    this.clubDecal.scale.set(0.023, len, 0.023);   // a hair proud of the 0.020 shaft
    this.clubDecal.position.y = this.clubShaft.position.y;

    const H2 = this.clubHead;
    if (c.putter) {
      // a flat bar, square to the ball, no loft to speak of
      this.clubFace.scale.set(0.030, 0.030, 0.11);
      this.clubFace.position.set(0, -0.012, 0.045);
      this.clubFace.material = this.mats.headDark;
      this.clubSole.scale.set(0.026, 0.014, 0.09);
      this.clubSole.position.set(0, -0.030, 0.045);
      H2.rotation.x = -0.03;
    } else if (c.type === 'wood') {
      // the big rounded head; biggest for the driver, shrinking to the 7 wood
      const s = c.key === 'DR' ? 1.0 : c.key === 'W3' ? 0.86 : 0.78;
      this.clubFace.scale.set(0.085 * s, 0.062 * s, 0.070 * s);
      this.clubFace.position.set(0, -0.020, 0.045);
      this.clubFace.material = this.mats.headDark;
      this.clubSole.scale.set(0.080 * s, 0.018, 0.062 * s);
      this.clubSole.position.set(0, -0.052 * s, 0.045);
      this.clubSole.material = this.mats.chrome;
      H2.rotation.x = -c.loft * Math.PI / 180 * 0.35;
    } else if (c.type === 'hybrid') {
      this.clubFace.scale.set(0.060, 0.050, 0.048);
      this.clubFace.position.set(0, -0.018, 0.040);
      this.clubFace.material = this.mats.headDark;
      this.clubSole.scale.set(0.055, 0.015, 0.045);
      this.clubSole.position.set(0, -0.045, 0.040);
      this.clubSole.material = this.mats.chrome;
      H2.rotation.x = -c.loft * Math.PI / 180 * 0.4;
    } else {
      // irons and wedges: a blade whose face visibly lies back with the loft,
      // growing slightly shorter and deeper from the long irons to the lob
      const t = Math.min(1, Math.max(0, (c.loft - 18) / 46));    // 0 long iron -> 1 lob
      this.clubFace.scale.set(0.020 + t * 0.008, 0.075 - t * 0.012, 0.085 + t * 0.010);
      this.clubFace.position.set(0, -0.024, 0.048);
      this.clubFace.material = this.mats.chrome;
      this.clubSole.scale.set(0.022, 0.016, 0.080);
      this.clubSole.position.set(0, -0.058 + t * 0.006, 0.050);
      this.clubSole.material = this.mats.headDark;
      // the whole blade lies back: at address a lob wedge SHOWS its 58 degrees
      H2.rotation.x = -c.loft * Math.PI / 180 * 0.55;
    }

    this._shapeDecal(c);
  }

  /* ---------------------------------------------------------- the swing */

  /**
   * Take up the address: side-on to the target line, club down behind the
   * ball.  `yaw` is the facing (aim + 90°); pass null to leave the stance.
   */
  setAddress(on, yaw = null) {
    if (!on) {
      if (this.golf && this.golf.strikeT == null) this.golf = null;
      return;
    }
    if (this.golf && this.golf.strikeT != null) return;   // mid-strike: leave it
    if (!this.golf) this.golf = { k: 0, strikeT: null, yawLock: yaw };
    else this.golf.yawLock = yaw;
  }

  /** How far back the club is, 0..1 — driven live from the power meter. */
  setBackswing(k) {
    if (this.golf && this.golf.strikeT == null) this.golf.k = Math.max(0, Math.min(1, k));
  }

  /**
   * Swing through the ball.  Runs on its own timing and ends back at address
   * (or standing, if the address was released meanwhile).  Every client calls
   * this when a shot event arrives, so the whole room sees the stroke.
   */
  strike(aimYaw = null) {
    if (this.seated) return 0;
    const from = this.golf?.k ?? 0.85;
    this.golf = {
      k: from, strikeT: 0,
      // right-handed stance: the target sits off the LEFT shoulder (see main.js)
      yawLock: aimYaw != null ? aimYaw - Math.PI / 2 : this.golf?.yawLock ?? null
    };
    return 0.8;
  }

  /**
   * Sit the golfer in a cart.  A hard override rather than a blend: the seat
   * pose is static, and the blob is hidden because the cart casts its own.
   */
  setSeated(on) {
    this.seated = !!on;
    if (this.seated) { this.cel = null; this.golf = null; this.club.visible = false; }
    else {
      this.legL.scale.y = 1; this.legR.scale.y = 1;         // stand back up
      this.body.rotation.x = 0; this.body.rotation.z = 0;   // and straighten up
    }
    this.blob.visible = !this.seated;
  }

  /**
   * Lean with the cart.  A rider whose body ignores the suspension reads as
   * cargo; taking a share of the chassis pitch and roll — less than all of it,
   * because a person braces — is what sells them as a passenger.
   */
  setRideTilt(pitch, roll) {
    this._ridePitch = pitch;
    this._rideRoll = roll;
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
    this._swinging = false;      // set again below if a swing clip is running
    this._swingLay = null;
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
    /* Shoulders counter-rotate against the hips through the stride — the
       same twist/counter-twist the swing already uses (see _apply), just
       small enough here to read as a walk rather than a golf turn. Without
       it the whole body pivots as one rigid slab from the waist up, which
       is the single most robotic thing about a walk cycle: a person's
       chest and hips are almost never square to each other while moving. */
    P.twist = s * swing * 0.10;
    P.headRx = 0; P.headRy = 0; P.hatY = 0; P.hatRx = 0;

    /* --------------------------------------------------------- the swing */
    // Address, backswing and strike write over the walk pose at full weight
    // while the golfer is standing still.  A celebration still wins below —
    // holing out mid-follow-through should cut straight to the arms-up.
    const g = this.golf;
    // Was `!!g` alone — visible only for the swing itself, which meant a
    // standing, idle golfer (waiting on the tee, shown off in the "Your
    // Golfer" panel, anywhere a player would actually look to check their
    // own decal) never showed the club at all. The decal comment right
    // above this class's club setup already says the point: "a reward you
    // cannot see is not a reward." Still hidden while WALKING specifically
    // — that pose was never built with a held club in mind, and this find
    // only asked for it to show while standing still.
    this.club.visible = (!!g || !moving) && !(this._melee && this.cel);
    if (g && !moving) {
      // The swing is described by one phase value φ:
      //   -1..0  backswing (φ = -k, straight off the power meter)
      //    0..1  strike: hip-led downswing, impact, extension, high finish
      // Each joint reads φ through its own curve, which is what makes it
      // read as a body swinging rather than a hinge opening: the hips lead,
      // the shoulders follow, the wrists release last, and the head stays
      // down until well after the ball has gone.
      let phi, wristLag = 0;
      if (g.strikeT == null) {
        phi = -g.k;
      } else {
        g.strikeT += dt;
        const t = g.strikeT;
        const DOWN = 0.10, THRU = 0.16, HOLD = 0.62, SETTLE = 0.95;
        if (t < DOWN) {                        // top -> impact, accelerating hard
          const u = (t / DOWN) ** 2;
          phi = -g.k + (0.12 + g.k) * u;       // arrives just past the ball
          wristLag = -0.5 * (1 - u) * g.k;     // wrists release into impact
        } else if (t < THRU) {                 // extension through the ball
          phi = 0.12 + ((t - DOWN) / (THRU - DOWN)) * 0.55;
        } else if (t < HOLD) {                 // ride up into the finish
          const u = (t - THRU) / (HOLD - THRU), e = 1 - (1 - u) * (1 - u);
          phi = 0.67 + e * 0.33;
        } else if (t < SETTLE) {               // hold the pose, then settle
          const u = (t - HOLD) / (SETTLE - HOLD), e = u * u * (3 - 2 * u);
          phi = 1 - e;                         // back down to address
        } else {
          this.golf = { k: 0, strikeT: null, yawLock: g.yawLock };
          phi = 0;
        }
      }

      const b = Math.max(0, -phi);             // how far back
      const f = Math.max(0, phi);              // how far through

      /* The kinematic sequence: hips, then torso, then arms, then club.
         Everything used to run off one number, so the whole body arrived at
         once and the swing read as a single rigid rotation — which is the
         thing that most makes an animated golfer look like a puppet.

         The body now LEADS the arms through the downswing by a fraction of
         the motion, so the turn opens first and the arms are dragged into
         impact behind it. The lag closes to nothing by the finish, because a
         real swing does end square rather than permanently offset. */
      const lag = 0.16 * Math.max(0, 1 - f * 1.6);
      const phiArm = phi - (phi > -0.05 ? lag : 0);
      const bA = Math.max(0, -phiArm), fA = Math.max(0, phiArm);

      /* HIPS AND SHOULDERS ARE TWO CURVES NOW, because there is a pelvis to
         hang the difference off (see the rig). A golfer at the top has the
         shoulders round about ninety degrees and the hips about forty-five;
         the difference IS the coil, and until the pelvis existed the rig
         could only express it as nine degrees of `twist` bolted onto one
         rigid turn.

         And the pelvis LEADS coming down. That is the single most
         recognisable thing about a real swing — the hips open toward the
         target while the shoulders are still closed — and it is the thing
         one rotation cannot show at all. The exponents are what do it:
         the hips open on a curve that rises fast and the shoulders on one
         that rises late, so the separation flips sign through the
         downswing and both land square at the finish. */
      const shoulderTurn = -0.15 - 1.30 * b + 1.45 * Math.pow(f, 1.30);
      const hipTurn      = -0.15 - 0.62 * b + 1.32 * Math.pow(f, 0.70);
      P.yaw = hipTurn;
      P.twist = (P.twist || 0) + (shoulderTurn - hipTurn);
      // arms: lift going back, sweep low through impact, wrap high to finish
      const armBack = -0.60 - 1.72 * bA;
      const armThru = -0.60 + fA * (fA < 0.4 ? 2.2 : 2.2 + (fA - 0.4) * 1.4);
      P.armLx = bA > 0 ? armBack : armThru;
      P.armRx = P.armLx;
      // the trailing elbow folds going back; both arms fold over the finish
      P.armLz = 0.16 + 0.30 * b + 0.42 * Math.max(0, f - 0.55);
      P.armRz = -0.16 - 0.14 * b - 0.42 * Math.max(0, f - 0.55);
      // spine: tilted over the ball, rising to upright at the finish
      P.bodyRx = 0.16 - 0.14 * Math.max(0, f - 0.5) * 2;
      // weight: onto the trail foot going back, hard onto the lead foot through
      P.bodyRz = 0.05 * b - 0.09 * f;
      P.legLx = -0.06 - 0.10 * f;
      P.legRx = 0.06 + 0.28 * f;               // trail heel comes up
      // eyes on the ball until the ball is long gone
      P.headRx = 0.32 - Math.max(0, f - 0.6) * 1.05;
      P.headRy = 0.18 * b - 0.30 * Math.max(0, f - 0.6);
      P.bodyY = -0.02 * b;                     // sits into the backswing a touch
      /* The three things a pendulum does not do: shift its weight, coil the
         shoulders past the hips, and lag the club before releasing it.
         Layered rather than folded into the numbers above, so the clip keeps
         owning the TIMING and this only shapes what happens at each beat. */
      this._swinging = true;
      this._swingLay = { f: bA > 0 ? bA : fA, back: bA > 0 };
      /* THE HANDS RIDE THE ARMS. They used to be the trail shoulder itself,
         so the club swung on a 0.63 m radius about one shoulder rather than
         on the arms' own arc from between them. This is the arc, and both
         arms are solved onto its end (see _gripHands). */
      this.hands.rotation.x = P.armLx;
      this.hands.rotation.z = (P.armLz + P.armRz) * 0.5;
      // wrists: hinge going back, release through, rehinge over the shoulder
      this.club.rotation.x = 0.25 - 1.15 * b + wristLag
        + (f > 0.55 ? (f - 0.55) * 1.6 : f * 0.5);
      // the hands themselves, hinging with the club rather than staying
      // rigid on the forearm while it does all the work
      this.wristL.rotation.x = this.wristR.rotation.x = this.club.rotation.x;
      if (g.yawLock != null) this._yaw = g.yawLock;
    } else {
      /* NOT SWINGING. The club rides the hands, and the hands used to snap
         straight to whatever the arms were doing — so a slap or a barge,
         which throws an arm to -1.7 radians, swung the club through a
         horizontal arc like a spear. Eased toward a carried rest pose
         instead: the club stays in front of the golfer through a clip
         rather than whipping about with one arm.

         Damped rather than pinned, because a walking golfer's club SHOULD
         swing gently with the stride, and this is the same value that does
         it — it just no longer follows a melee. */
      this.club.rotation.x = 0.25;
      const rest = -0.15 + Math.max(-0.55, Math.min(0.15, (P.armRx || 0) * 0.22));
      this.hands.rotation.x += (rest - this.hands.rotation.x) * Math.min(1, dt * 9);
      this.hands.rotation.z = 0;
      this.wristL.rotation.x = this.wristR.rotation.x = 0.25;
    }

    if (this.cel) {
      const cel = this.cel;
      cel.t += dt;
      if (cel.t >= cel.dur) {
        this.cel = null;                       // weight is 0 here anyway
      } else {
        const k = cel.t / cel.dur;
        const C = blankPose(this._clip);
        (cel.clip || CLIPS[cel.name]).pose(C, k);
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

    /* ---- the always-on layers ------------------------------------------
       Added LAST, over whatever the clip or the walk produced, and never
       instead of them. Breathing, wind lean and idle fidgets have no start
       and no end, so they cannot be clips; the feet have to be last because
       they answer a question — where is the ground — that nothing above them
       knows the answer to. */
    const L = blankLayer(this._layer);        // ZEROED every frame — see anim.js
    breathe(L, this.life, dt, {
      moving, swinging: !!this._swinging, seated: this.seated,
      wind: this._wind || 0, windDir: this._windDir || 0, facing: this._yaw
    });
    walkKnees(L, this.life, speed);
    if (this._swingLay) swingLayers(L, this._swingLay.f, this._swingLay.back);
    if (this._terrain) {
      footPlant(L, this.life, dt, {
        T: this._terrain,
        x: this.root.position.x, z: this.root.position.z,
        facing: this._yaw, moving, ground: this.root.position.y
      });
    }

    this._apply(P, L);
    /* THE LEAD HAND GOES ONTO THE GRIP, after the pose rather than as part
       of it: the arm has to be solved against where the trail hand actually
       ENDED UP, and that is not known until the whole pose is applied.
       Only while swinging — a walking golfer's arms swing free. */
    if (this._swinging) this._gripHands();
  }

  /** The terrain to stand on. Set once per hole by the scene. */
  setTerrain(T) { this._terrain = T; }
  /** Wind, for the lean. Speed in m/s and a bearing in radians. */
  setWind(speed, dir) { this._wind = speed; this._windDir = dir; }

  /**
   * Write a pose onto the rig. The only place joints are touched.
   *
   * `L` is the always-on layer — breathing, wind, idles, foot placement —
   * added here rather than merged into P, because P is a persistent buffer
   * that clips assign into. Adding a layer into it compounds every frame.
   */
  _apply(P, L = ZERO) {
    this.legL.rotation.x = P.legLx;
    this.legR.rotation.x = P.legRx;
    this.legL.rotation.z = P.legLz + L.legLz;
    this.legR.rotation.z = P.legRz + L.legRz;
    this.armL.rotation.x = P.armLx + L.armLx;
    this.armR.rotation.x = P.armRx + L.armRx;
    this.armL.rotation.z = P.armLz + L.armLz;
    this.armR.rotation.z = P.armRz + L.armRz;
    this.armL.rotation.y = P.armLy;
    this.armR.rotation.y = P.armRy;
    this.body.position.y = P.bodyY + L.bodyY;      // the hop lifts the body, not the root,
                                                   // so the contact patch stays on the ground
    /* The SPINE lean, on the torso rather than on the whole figure. Tilting
       `body` tilted the legs with it, so a golfer bent over the ball had
       both feet pivoting off the turf — the lean was a figure toppling
       rather than a spine bending. The pelvis takes a third of it, which is
       what actually happens: you hinge mostly at the hips, and a little at
       the pelvis itself. */
    this.torso.rotation.x = (P.bodyRx + L.bodyRx) * 0.7;
    this.torso.rotation.z = (P.bodyRz + L.bodyRz) * 0.7;
    this.hips.rotation.x = (P.bodyRx + L.bodyRx) * 0.3;
    this.hips.rotation.z = (P.bodyRz + L.bodyRz) * 0.3;
    /* TWIST vs YAW, through a real pelvis.
       `yaw` turns the HIPS and `twist` turns the TORSO against them, which
       composes to the same shoulder angle the rig produced before and gives
       the legs the same angle the old leg counter-rotation gave them — so
       every clip plays identically. The difference is the hip box, which
       used to rotate with the chest and now rotates with the legs, where a
       pelvis belongs. That is what every throw, swing and slap is actually
       made of. */
    this.body.rotation.y = this._yaw;
    this.hips.rotation.y = P.yaw;
    this.torso.rotation.y = P.twist + L.twist;
    /* Knees and elbows. Clamped to one direction only, because a knee that
       bends forward is the single most unsettling thing a character rig can
       do and a clip written before these existed has no idea it must not. */
    this.kneeL.rotation.x = Math.max(0, (P.kneeL || 0) + L.kneeL);
    this.kneeR.rotation.x = Math.max(0, (P.kneeR || 0) + L.kneeR);
    this.elbowL.rotation.x = Math.min(0, (P.elbowL || 0) + L.elbowL);
    this.elbowR.rotation.x = Math.min(0, (P.elbowR || 0) + L.elbowR);
    /* The ankle — unlike the knee, it genuinely bends both ways (toe up
       swinging through, toe down pushing off), so it is not one-way
       clamped the way the knee and elbow are. */
    this.ankleL.rotation.x = (P.ankleL || 0) + L.ankleL;
    this.ankleR.rotation.x = (P.ankleR || 0) + L.ankleR;
    /* Foot placement, from the terrain under each shoe. `footL/R` lifts the
       ankle and `footLx/Rx` tilts it to the slope — without both, a golfer
       standing across a hill has one foot buried and the other in the air. */
    this.kneeL.position.y = this._legHalf * -1 + L.footL;
    this.kneeR.position.y = this._legHalf * -1 + L.footR;
    this.head.rotation.x = P.headRx + L.headRx;
    this.head.rotation.y = P.headRy + L.headRy;
    this.head.rotation.z = (P.headRz || 0) + L.headRz;
    this.hat.position.y = P.hatY;
    this.hat.rotation.x = P.hatRx;
    // breathing: the chest rises, and it is the only thing that ever moves
    // when a golfer is doing nothing at all
    if (this.chest) {
      const b = this._chestBase;
      this.chest.scale.set(b.x * (1 + L.breath * 0.03), b.y, b.z * (1 + L.breath * 0.05));
    }
  }

  /**
   * Put the lead hand on the grip.
   *
   * Both arms were driven by one number (`P.armLx = P.armRx`), so they swept
   * two parallel arcs 52 cm apart for the whole swing — and the club hangs
   * off the trail arm, so the lead hand spent every swing about half a metre
   * from the grip it is supposed to be holding. On a rig made of boxes that
   * reads as a golfer swinging one-handed with the other arm keeping time.
   *
   * Solved rather than authored, because the answer depends on where the
   * trail hand ended up, which depends on the whole pose.
   */
  _gripHands() {
    const armL = this.armL, armR = this.armR, club = this.club;
    if (!club || !armL || !armR) return;

    /* THE GRIP, in the torso's space — the arms' shared parent, and
       therefore the space the solver wants. The club hangs off the trail
       shoulder, so where its grip actually IS depends on how that arm is
       posed; asking the club rather than assuming a point is what keeps
       this correct through the whole arc.

       updateMatrixWorld is deliberately not called: the renderer does it
       once per frame for the entire scene, and forcing it per avatar would
       be hundreds of matrix updates to save one frame of latency on a hand.
       Composing the two local matrices instead is exact and costs nothing. */
    const hands = this.hands;
    club.updateMatrix(); hands.updateMatrix();
    _ikTarget.set(0, 0, 0)
      .applyMatrix4(club.matrix)      // grip origin -> hands space
      .applyMatrix4(hands.matrix);    // -> torso space

    /* BOTH arms. This is only possible because the club hangs off `hands`
       rather than off one of them — solving an arm that carries its own
       target moves the target, and the two chase each other forever. With
       the grip on the centreline both solve cleanly onto the same point,
       which is what two hands on one club is. */
    reachTo(armL, this._armLen, _ikTarget);
    reachTo(armR, this._armLen, _ikTarget);
  }

  /** Static seat pose: knees up, hands forward on the wheel or the rail. */
  _applySeated() {
    const P = blankPose(this._pose);
    // There is no knee joint, and a straight 0.84 m leg cannot fit the 0.6 m
    // between the cushion and the dash at any angle: point it forward and it
    // spears the bonnet, point it down and it goes through the floor.  So the
    // leg is SHORTENED while seated — the shin reads as tucked into the
    // footwell, which is exactly what a knee does.
    P.legLx = -1.32; P.legRx = -1.32;      // shins level, feet on the floor pan
    P.armLx = -1.30; P.armRx = -1.30;      // hands forward to the wheel
    P.armLz = 0.12; P.armRz = -0.12;
    P.bodyY = -0.24;                       // the torso drops onto the cushion
    this._apply(P);
    /* Divided by the build's leg length so every golfer tucks the SAME
       absolute shin into the footwell.  A flat scale would let the
       longer-legged builds spear the bonnet, since the seat is a fixed size
       and their legs are not. */
    const tuck = SEATED_LEG / (this.build?.legLen || 1);
    this.legL.scale.y = tuck;
    this.legR.scale.y = tuck;
    // a braced passenger takes roughly two thirds of the chassis movement
    this.body.rotation.x = (this._ridePitch || 0) * 0.65;
    this.body.rotation.z = (this._rideRoll || 0) * 0.65;
    this.phase = 0;
    this.swingAmp = 0;
  }

  /** Face the avatar toward a point, easing rather than snapping.
   *
   *  Through `_yaw`, which is where facing actually lives: `_apply` writes
   *  body.rotation.y from it on every frame, so anything that set the
   *  rotation directly was overwritten before it could be seen. */
  faceToward(x, z, dt, rate = 9) {
    const want = Math.atan2(x - this.root.position.x, z - this.root.position.z);
    let d = want - this._yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this._yaw += d * Math.min(1, dt * rate);
    this.body.rotation.y = this._yaw;
  }

  get heading() { return this._yaw; }
  set heading(v) { this._yaw = v; this.body.rotation.y = v; }

  setVisible(v) { this.root.visible = v; }

  dispose() {
    for (const m of Object.values(this.mats)) m.dispose();
    /* The wardrobe's own materials are this avatar's and must go with it;
       decal materials are SHARED across every player wearing that badge and
       must not. Freeing a shared one blanks the badge on everybody else. */
    for (const m of (this.wardrobeMats || [])) m.dispose();
    this.blob.material.dispose();
    // geometries and anything flagged shared are singletons — leave them
  }
}

/** Free the shared geometry/texture (only on teardown). */
export function disposeAvatarAssets() {
  _box?.dispose(); _box = null;
  _blob?.dispose(); _blob = null;
  _blobTex?.dispose(); _blobTex = null;
}
