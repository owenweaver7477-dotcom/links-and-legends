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
import { CLIPS, EMOTE_CLIPS, SHOVE_CLIPS, POSE_KEYS, blankPose } from './celebrations.js';
import { CLUB_BY_KEY } from '../shared/clubs.js';

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

const H = AVATAR_HEIGHT;          // 1.78 m
const SEATED_LEG = 0.62;          // knee-less legs, tucked into the footwell
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
    this.body.add(part(this.mats.shirt, W * B.chest, H * 0.140, D * B.depth, 0, H * 0.7200, 0));
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
    const limb = (mat, w, len, x, y, endMat, endLen) => {
      const g = new THREE.Group();
      g.position.set(x, y, 0);
      g.add(part(mat, w, len, w, 0, -len / 2, 0));
      if (endMat) g.add(part(endMat, w * 1.05, endLen, w * 1.5, 0, -len - endLen / 2, 0.02));
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
    // legs are free to change: nothing is mounted to them
    const lw = 0.145 * B.limb, lx = 0.105 * B.hipSpread, ll = H * 0.42 * B.legLen;
    this.legL = limb(this.mats.trousers, lw, ll, lx, H * 0.47, this.mats.shoe, H * 0.05);
    this.legR = limb(this.mats.trousers, lw, ll, -lx, H * 0.47, this.mats.shoe, H * 0.05);
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
    this.club.add(this.clubGrip, this.clubShaft, this.clubHead);
    this.club.visible = false;
    this.armR.add(this.club);
    this.clubKey = null;
    this.clubTierIdx = -1;
    this.setClub('I7', 0);

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
    }

    // accessories.  Glasses sit just proud of the face decal.
    const acc = look.accessory || 'none';
    if (acc === 'glasses' || acc === 'shades') {
      const lens = acc === 'shades' ? this.mats.lens : this.mats.chromeLens ||
        (this.mats.chromeLens = this.mats.lens);
      this.accessory.add(part(lens, 0.072, H * 0.020, 0.012, 0.052, H * 0.0705, 0.117));
      this.accessory.add(part(lens, 0.072, H * 0.020, 0.012, -0.052, H * 0.0705, 0.117));
      this.accessory.add(part(lens, 0.036, H * 0.005, 0.010, 0, H * 0.0705, 0.117));
    }
  }

  /**
   * Reshape the club in hand to match the club being played.  No meshes are
   * created or destroyed — the grip, shaft and two head boxes are rescaled
   * and re-tilted, so switching from driver to putter costs nothing and can
   * never pop assets in or out.
   */
  setClub(key, tier = 0) {
    if (key === this.clubKey && tier === this.clubTierIdx) return;
    const c = CLUB_BY_KEY[key];
    if (!c) return;
    this.clubKey = key;

    // The set's visual identity: rope-gripped wood up to the holographic
    // Signature finish.  Two materials repainted — no new meshes.
    if (tier !== this.clubTierIdx) {
      this.clubTierIdx = tier;
      const looks = [
        { shaft: 0x8a6a42, head: 0x6e5432, glow: 0 },          // wooden
        { shaft: 0x7a6a5c, head: 0x8a5a42, glow: 0 },          // rusty iron
        { shaft: 0xc9ccd2, head: 0x3a3d42, glow: 0 },          // polished steel
        { shaft: 0x2e3136, head: 0x1d1f24, glow: 0 },          // carbon
        { shaft: 0xe8eaee, head: 0x22242a, glow: 0 },          // tour pro
        { shaft: 0xb8c4cc, head: 0x4a5058, glow: 0x27424e },   // titanium glow
        { shaft: 0xd8c8f0, head: 0x2a2438, glow: 0x51286e }    // signature holo
      ];
      const L = looks[Math.max(0, Math.min(6, tier))];
      this.mats.chrome.color.setHex(L.shaft);
      this.mats.headDark.color.setHex(L.head);
      this.mats.chrome.emissive.setHex(L.glow);
      this.mats.headDark.emissive.setHex(L.glow);
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
      // hips and shoulders: the turn away is modest, the turn through is full
      P.yaw = -0.15 - 0.78 * b + 1.35 * f;
      // arms: lift going back, sweep low through impact, wrap high to finish
      const armBack = -0.60 - 1.72 * b;
      const armThru = -0.60 + f * (f < 0.4 ? 2.2 : 2.2 + (f - 0.4) * 1.4);
      P.armLx = b > 0 ? armBack : armThru;
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
      // wrists: hinge going back, release through, rehinge over the shoulder
      this.club.rotation.x = 0.25 - 1.15 * b + wristLag
        + (f > 0.55 ? (f - 0.55) * 1.6 : f * 0.5);
      if (g.yawLock != null) this._yaw = g.yawLock;
    } else {
      this.club.rotation.x = 0.25;
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
