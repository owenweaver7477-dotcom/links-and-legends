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
import { AVATAR_HEIGHT, BODIES } from '../shared/avatars.js';
import { UNLOCKS } from '../shared/unlocks.js';
import { CLIPS, EMOTE_CLIPS, SHOVE_CLIPS, POSE_KEYS, blankPose } from './celebrations.js';
import { CLUB_BY_KEY } from '../shared/clubs.js';
import { FABRICS, GLOVES, WATCHES, CUTS, SHOE_TYPES, DECAL_SLOTS } from '../shared/wardrobe.js';
import { makeLife, blankLayer, breathe, footPlant, walkKnees, swingLayers } from './anim.js';
import { shirtMaterial, decalMaterial, decalHalo } from './decals.js';
import { shaftDecalTexture } from './shaftdecals.js';

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
    // hips -> waist -> chest, spanning the same H*0.47 .. H*0.79 as before
    this.body.add(part(this.mats.trousers, W * B.hips, H * 0.075, D * B.depth, 0, H * 0.5075, 0));
    this.body.add(part(this.mats.shirt, W * B.waist, H * 0.105, D * 0.95 * B.depth, 0, H * 0.5975, 0));
    // kept, because breathing scales it and nothing else in the rig moves
    // when a golfer is standing still
    this.chest = part(this.mats.shirt, W * B.chest, H * 0.140, D * B.depth, 0, H * 0.7200, 0);
    /* part() SIZES A UNIT CUBE THROUGH ITS SCALE, so the breathing must
       multiply that base rather than set a scale of its own. Setting it
       replaced a 0.42 x 0.25 x 0.24 chest with a one-metre cube — a golfer
       with a slab for a torso, which is exactly what appeared on screen. */
    this._chestBase = this.chest.scale.clone();
    this.body.add(this.chest);
    if (B.bust > 0) {
      // sits proud of the chest front, so it reads in silhouette rather than
      // only head-on; two boxes rather than one so it is not a shelf
      const bw = W * B.chest * 0.34, by = H * 0.700, bz = D * B.depth * 0.5;
      this.body.add(part(this.mats.shirt, bw, H * B.bust, D * 0.34 * B.depth, bw * 0.52, by, bz));
      this.body.add(part(this.mats.shirt, bw, H * B.bust, D * 0.34 * B.depth, -bw * 0.52, by, bz));
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
    this.body.add(this.head);

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
    this.body.add(this.armL, this.armR, this.legL, this.legR);

    /* Worn accessories that hang off the body rather than the head.  Built
       after the limbs, because the glove goes ON one of them. */
    this.worn = new THREE.Group();
    this.body.add(this.worn);
    this.buildWorn(look);

    /* --- the club: grip, shaft and an interchangeable head ---------------
       The same five boxes serve every club in the bag; setClub() reshapes
       them, so a driver, a 7 iron and the putter are the same draw calls
       with different proportions.  Visible only while addressing or
       swinging, so the cost is nothing for anyone just walking about. */
    this.mats.chrome = M('#c9ccd2');
    this.mats.headDark = M('#3a3d42');
    this.club = new THREE.Group();
    this.club.position.set(0, -(H * 0.355), 0.02);      // the right hand
    this.club.rotation.x = 0.25;                        // shaft leans toward the ball
    this.clubGrip = part(this.mats.shoe, 0.034, 0.16, 0.034, 0, -0.06, 0);
    this.clubShaft = part(this.mats.chrome, 0.020, 0.80, 0.020, 0, -0.54, 0);
    this.clubHead = new THREE.Group();
    this.clubFace = part(this.mats.chrome, 0.05, 0.07, 0.03, 0, 0, 0.02);
    this.clubSole = part(this.mats.headDark, 0.05, 0.03, 0.10, 0, -0.04, 0.05);
    this.clubHead.add(this.clubFace, this.clubSole);
    /* The decal: a band round the shaft, in the colour the level unlocked.
       Levels buy identity and nothing else in this game, so a reward you
       cannot see is not a reward — and the shaft is the one part of the kit
       that is in shot for the whole swing, at every camera angle, on every
       club in the bag. One box, hidden when nothing is equipped. */
    this.clubDecal = part(M('#8fe07a'), 0.024, 0.10, 0.024, 0, -0.22, 0);
    this.clubDecal.visible = false;
    this.club.add(this.clubGrip, this.clubShaft, this.clubHead, this.clubDecal);
    this.setDecal(look.decal);
    this.club.visible = false;
    this.armR.add(this.club);
    this.clubKey = null;
    this.clubTierIdx = -1;
    this.setClub('I7', 0);

    /* Its own phase, its own breath rate, its own fidget timer. Eight
       players breathing in unison is worse than eight not breathing. */
    this.life = makeLife(Math.random());
    this._layer = blankLayer();
    this._dressWardrobe(look, M);

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
      this.body.add(part(this.mats.shirt, 0.250, H * 0.022, 0.190, 0, neckY, 0));
    } else if (look.neck === 'scarf') {
      const nm = mine(look.shirt2 || '#7d2f42');
      this.body.add(part(nm, 0.238, H * 0.030, 0.200, 0, neckY, 0));
      this.body.add(part(nm, 0.070, H * 0.090, 0.036, 0.060, neckY - H * 0.055, 0.098));
    } else if (look.neck === 'buff') {
      this.body.add(part(mine(look.shirt2 || '#3a4048'), 0.236, H * 0.060, 0.206, 0, neckY + H * 0.010, 0));
    } else if (look.neck === 'chain') {
      const cm = mine('#e8c15a');
      this.body.add(part(cm, 0.150, H * 0.010, 0.014, 0, neckY - H * 0.012, 0.106));
      this.body.add(part(cm, 0.030, H * 0.028, 0.018, 0, neckY - H * 0.035, 0.108));
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
    this.clubDecal.visible = !!u;
    if (!u) return;
    const color = u.color || '#8fe07a';
    // A real pattern per design, not a flat tint every design shared —
    // shaftDecalTexture returns null for an id it doesn't recognise, which
    // just leaves the band a plain rectangle in its own colour, same as
    // the flat-tint behaviour this replaces.
    this.clubDecal.material.color.set(color);
    this.clubDecal.material.map = shaftDecalTexture(id, color);
    this.clubDecal.material.needsUpdate = true;
  }

  setClub(key, tier = 0) {
    if (key === this.clubKey && tier === this.clubTierIdx) return;
    const c = CLUB_BY_KEY[key];
    if (!c) return;
    this.clubKey = key;

    // The set's visual identity: rope-gripped wood up to the holographic
    // Signature finish.  Two materials repainted — no new meshes.
    if (tier !== this.clubTierIdx) {
      this.clubTierIdx = tier;
      /* The club you are actually holding for a whole round. The top three
         sets cost 26k, 58k and 120k coins, and until now the only thing that
         bought was a different hex value — no sheen, no glow, nothing you
         could see at the distance you play from. `shine` drives specular
         highlight, so a Tour Pro catches the sun and a Wooden Starter Set
         does not. */
      const looks = [
        { shaft: 0x8a6a42, head: 0x6e5432, glow: 0,        shine: 0 },    // wooden
        { shaft: 0x7a6a5c, head: 0x8a5a42, glow: 0,        shine: 0.08 }, // rusty iron
        { shaft: 0xc9ccd2, head: 0x3a3d42, glow: 0,        shine: 0.35 }, // polished steel
        { shaft: 0x2e3136, head: 0x1d1f24, glow: 0,        shine: 0.22 }, // carbon
        { shaft: 0xf2f5f8, head: 0x22242a, glow: 0x141821, shine: 0.72 }, // tour pro
        { shaft: 0xcdd9e2, head: 0x4a5058, glow: 0x2f5060, shine: 0.88 }, // titanium
        { shaft: 0xe6d8ff, head: 0x2a2438, glow: 0x6a34a0, shine: 1.0 }   // signature
      ];
      const L = looks[Math.max(0, Math.min(6, tier))];
      this.mats.chrome.color.setHex(L.shaft);
      this.mats.headDark.color.setHex(L.head);
      this.mats.chrome.emissive.setHex(L.glow);
      this.mats.headDark.emissive.setHex(L.glow);
      /* Lambert has no specular, so a shiny set needs a material that does.
         Swapped rather than tweaked, and only once per tier change. */
      if (L.shine > 0.3 && !this.mats.chrome.isMeshPhongMaterial) {
        const up = m => {
          const n = new THREE.MeshPhongMaterial({ color: m.color, emissive: m.emissive });
          m.dispose(); return n;
        };
        this.mats.chrome = up(this.mats.chrome);
        this.mats.headDark = up(this.mats.headDark);
        this.clubShaft.material = this.mats.chrome;
        this._retintClub();
      }
      if (this.mats.chrome.isMeshPhongMaterial) {
        this.mats.chrome.shininess = 30 + L.shine * 170;
        this.mats.chrome.specular.setRGB(L.shine, L.shine, L.shine);
        this.mats.headDark.shininess = 20 + L.shine * 120;
        this.mats.headDark.specular.setRGB(L.shine * 0.8, L.shine * 0.8, L.shine * 0.85);
      }
    }

    // shaft length: drivers are long, wedges short, the putter shortest
    const len = c.putter ? 0.62 : c.type === 'wood' ? 0.92 : c.type === 'hybrid' ? 0.84
      : 0.82 - (c.loft - 18) * 0.0032;
    this.clubShaft.scale.y = len;
    this.clubShaft.position.y = -0.14 - len / 2;
    this.clubHead.position.y = -0.14 - len;

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
    this.club.visible = !!g;
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

      // hips and shoulders: the turn away is modest, the turn through is full
      P.yaw = -0.15 - 0.78 * b + 1.35 * f;
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
      // wrists: hinge going back, release through, rehinge over the shoulder
      this.club.rotation.x = 0.25 - 1.15 * b + wristLag
        + (f > 0.55 ? (f - 0.55) * 1.6 : f * 0.5);
      // the hands themselves, hinging with the club rather than staying
      // rigid on the forearm while it does all the work
      this.wristL.rotation.x = this.wristR.rotation.x = this.club.rotation.x;
      if (g.yawLock != null) this._yaw = g.yawLock;
    } else {
      this.club.rotation.x = 0.25;
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
    this.body.rotation.x = P.bodyRx + L.bodyRx;     // so the blob stays on the ground
    this.body.rotation.z = P.bodyRz + L.bodyRz;
    /* TWIST vs YAW.
       The arms and the legs are both children of `body`, so turning body.y
       turns the whole figure — a pivot on the spot, which is all the rig
       could ever do. Counter-rotating the legs by the same angle holds the
       feet where they are and lets the shoulders turn against the hips,
       which is what every throw, swing and slap is actually made of. */
    this.body.rotation.y = this._yaw + P.yaw + P.twist + L.twist;
    if (P.twist || L.twist) {
      this.legL.rotation.y = -(P.twist + L.twist);
      this.legR.rotation.y = -(P.twist + L.twist);
    } else if (this.legL.rotation.y) {
      this.legL.rotation.y = 0; this.legR.rotation.y = 0;
    }
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
