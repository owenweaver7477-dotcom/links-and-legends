/* =========================================================================
   shopview.js — the thing you are buying, turning
   -------------------------------------------------------------------------
   The pro shop was a list of names and prices. A driver and a putter were
   two rows of text that differed only in the words, so the only way to find
   out what four thousand coins bought was to spend them.

   This puts the item on a turntable beside the list, in the same renderer
   everything else uses. Clubs are built from the avatar's own club geometry,
   so what turns here is exactly what appears in your golfer's hands — a
   preview built from different parts than the game uses is a promise the
   game then has to keep.

   ITS OWN RENDERER, DELIBERATELY. The main scene is 224,000 triangles of
   golf course; borrowing it would mean either tearing the hole down to show
   a putter or rendering both. This is a 260-pixel canvas with a handful of
   boxes in it, so a second WebGL context is cheaper than either — and it can
   be created lazily, when the shop is first opened, and thrown away with it.
   ========================================================================= */

import * as THREE from '../../vendor/three.module.js';
import { CLUBS, CLUB_BY_KEY } from '../shared/clubs.js';
import { decalTexture } from './decals.js';
import { DECALS } from '../shared/wardrobe.js';
import { skinById } from '../shared/clubskins.js';

/* ONE RENDERER PER CANVAS. The shop and the bag are two different canvases
   on two different panes, and a single module-level renderer bound to
   whichever was asked for last meant opening the bag left the shop's
   turntable frozen on its final frame — and vice versa. Keyed by the canvas
   element, so each keeps its own scene, camera and spin. */
const views = new Map();
let raf = 0;

function build(canvas) {
  let R = views.get(canvas);
  if (R) return R;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 0.75, 0.05, 40);
  camera.position.set(0, 0.15, 2.1);
  camera.lookAt(0, 0, 0);

  /* Three lights, and the rim is the one that matters: a chrome club head
     against a dark background with only a key light on it reads as a grey
     shape. The rim separates it from the backdrop, which is the whole job. */
  scene.add(new THREE.HemisphereLight(0xbcd6e8, 0x1a2620, 1.05));
  const key = new THREE.DirectionalLight(0xfff4e0, 1.5);
  key.position.set(2, 3, 2.5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fd0ff, 0.9);
  rim.position.set(-2.5, 1.2, -2);
  scene.add(rim);

  const stage = new THREE.Group();
  scene.add(stage);

  R = { renderer, scene, camera, stage, canvas, spin: 0, current: null };
  views.set(canvas, R);
  return R;
}

const M = (hex, shiny = 0) => shiny
  ? new THREE.MeshPhongMaterial({ color: new THREE.Color(hex), shininess: 40 + shiny * 90,
                                  specular: new THREE.Color(0xffffff) })
  : new THREE.MeshLambertMaterial({ color: new THREE.Color(hex) });

const box = (mat, w, h, d, x, y, z) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
  m.scale.set(w, h, d); m.position.set(x, y, z);
  return m;
};

/* -------------------------------------------------------------- clubs ---
   Built from the same proportions the avatar's club uses, scaled up. A
   preview that is a different object from the one in your hands is a
   preview of something the game does not have. */
/* Real head volumes, in cc. A driver is 460 by rule and a 7 wood is about
   135, which is a 1.5x difference in every linear dimension — and the shop
   drew all four woods at one size, so the only thing separating a £4,000
   driver from a 7 wood was the word. Cube root, because volume is cubic. */
const WOOD_CC = { DR: 460, W3: 175, W5: 155, W7: 135 };

/** A rounded head — a squashed sphere, not a box. */
function blob(mat, w, h, d, x, y, z) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 14), mat);
  m.scale.set(w, h, d); m.position.set(x, y, z);
  return m;
}

/** A disc/rod — hosels, ferrules, grip taper. */
function rod(mat, rTop, rBot, h, x, y, z) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, 1, 16), mat);
  m.scale.y = h; m.position.set(x, y, z);
  return m;
}

function buildClub(key, tier = 0, skinId = 'stock') {
  const club = CLUB_BY_KEY[key] || CLUBS[0];
  const g = new THREE.Group();

  /* Tiers are the SET — what you bought, and what it does. A skin is the
     finish over the top, earned rather than bought, and it changes nothing
     but the colour. Where a skin says nothing the tier's own look shows
     through, which is why 'stock' is null rather than a colour. */
  const sk = skinById(skinId);
  const shaftCol = sk.shaft || ['#c9ccd2', '#d8dbe0', '#8f9298', '#2e3136'][tier] || '#c9ccd2';
  const headCol = sk.head || ['#c9ccd2', '#e2e5ea', '#5a5f66', '#22252a'][tier] || '#c9ccd2';
  const gripCol = sk.grip || ['#2b2b2f', '#2b2b2f', '#1c1c20', '#101014'][tier] || '#2b2b2f';
  const shine = sk.sheen ?? (0.6 + tier * 0.1);

  /* SHAFT LENGTH IS A CLUB'S MOST VISIBLE PROPERTY and the preview did not
     have it: every club stood exactly 1.5 units of shaft tall, so a driver
     and a lob wedge were the same object with a different lump on the end.
     A real driver is 45 inches and a lob wedge 35 — a fifth shorter, which
     you can see across a room. Woods are long, the putter shortest, and
     irons shorten steadily as the loft climbs. */
  const shaftLen = club.putter ? 1.06
    : club.type === 'wood' ? 1.62 - (club.loft - 10.5) * 0.008
    : club.type === 'hybrid' ? 1.44
    : 1.42 - (club.loft - 18) * 0.0065;
  const gripLen = club.putter ? 0.50 : 0.40;
  const top = shaftLen / 2;

  /* A tapered grip, not a straight box — every real grip is fatter at the
     butt, and the putter's is flat-topped and thicker still. */
  g.add(rod(M(gripCol), club.putter ? 0.045 : 0.040, 0.030,
            gripLen, 0, top + gripLen / 2 - 0.02, 0));
  g.add(rod(M(shaftCol, shine), 0.017, 0.024, shaftLen, 0, 0, 0));

  const headY = -top;
  const head = new THREE.Group();
  head.position.set(0, headY, 0);

  /* The ferrule: the little black collar where the shaft enters the head.
     It is two millimetres of a real club and its absence is why these read
     as shapes stuck on sticks rather than as clubs. Not on woods, which
     have none. */
  if (!club.putter && club.type !== 'wood') {
    g.add(rod(M('#15171a'), 0.026, 0.030, 0.05, 0, headY + 0.055, 0));
  }

  if (club.putter) {
    /* A MALLET, built like one. The old putter was two boxes and a red
       tick, which is the least detailed club in the bag being the one you
       use most — roughly half of all strokes in a round are putts. */
    head.add(box(M(headCol, 0.85), 0.30, 0.075, 0.10, 0, 0, 0.015));   // the blade
    // the flange: the weight hanging out the back, and what makes it a mallet
    head.add(blob(M(headCol, 0.7), 0.29, 0.062, 0.20, 0, -0.004, 0.15));
    head.add(box(M('#0f1114'), 0.30, 0.016, 0.19, 0, -0.036, 0.15));   // sole plate
    // a milled face insert, inset rather than painted on
    head.add(box(M('#8a8f96', 0.25), 0.26, 0.056, 0.012, 0, 0, -0.038));
    // TWO parallel alignment lines, which is how you actually aim a mallet
    head.add(box(M('#e8eaee'), 0.014, 0.008, 0.20, -0.045, 0.038, 0.14));
    head.add(box(M('#e8eaee'), 0.014, 0.008, 0.20, 0.045, 0.038, 0.14));
    head.add(box(M('#c8382f'), 0.055, 0.009, 0.045, 0, 0.039, 0.225));  // the sightdot
    // a plumber's-neck hosel, offset forward — the shaft does not meet a
    // putter head in the middle, and that offset is the whole design
    head.add(rod(M(shaftCol, shine), 0.016, 0.016, 0.10, 0, 0.075, -0.02));
    head.add(box(M(shaftCol, shine), 0.030, 0.020, 0.055, 0, 0.030, -0.038));

  } else if (club.type === 'wood') {
    /* Sized from real head volume, so the driver towers over the 7 wood the
       way it does in a bag. */
    const s = Math.cbrt((WOOD_CC[key] ?? 150) / 460);
    const w = 0.34 * s, h = 0.21 * s, d = 0.30 * s;
    head.add(blob(M(headCol, 0.9), w, h, d, 0, 0, d * 0.28));           // the crown
    head.add(box(M('#15171a'), w * 0.92, 0.022, d * 0.88, 0, -h * 0.42, d * 0.28));
    // the face, with its own insert — a driver face is a visible plate
    head.add(box(M(headCol, 1), w * 0.80, h * 0.66, 0.020, 0, 0.004, -d * 0.30));
    head.add(box(M('#7d838b', 0.4), w * 0.62, h * 0.46, 0.010, 0, 0.004, -d * 0.335));
    // scoring lines across the face, which woods do have
    for (let i = 0; i < 4; i++) {
      head.add(box(M('#4a4f56'), w * 0.54, 0.005, 0.006,
                   0, h * 0.16 - i * h * 0.11, -d * 0.345));
    }

  } else if (club.type === 'hybrid') {
    /* Deliberately BETWEEN the two, because that is what a hybrid is: a
       wood's rounded sole with an iron's shallow face. Drawing it as a
       small wood — which the old code did, sharing the branch — threw away
       the only reason the club exists. */
    /* Hybrids run 19° to 25° and the heads shrink across that range the way
       the woods do — the first pass hard-coded one size, which made the 3,
       4 and 5 hybrid the same object. Caught by the shape test, not by me. */
    const u = Math.min(1, Math.max(0, (club.loft - 19) / 6));   // 0 at H3, 1 at H5
    const hw = 0.245 - u * 0.030, hh = 0.148 + u * 0.014, hd = 0.180 - u * 0.022;
    head.add(blob(M(headCol, 0.85), hw, hh, hd, 0, 0, hd * 0.26));
    head.add(box(M('#15171a'), hw * 0.9, 0.020, hd * 0.86, 0, -hh * 0.42, hd * 0.26));
    head.add(box(M(headCol, 0.9), hw * 0.9, hh * 0.76, 0.018, 0, 0.005, -hd * 0.24));
    for (let i = 0; i < 5; i++) {
      head.add(box(M('#5a6068'), hw * 0.7, 0.005, 0.006,
                   0, hh * 0.21 - i * hh * 0.105, -hd * 0.30));
    }
    head.add(rod(M(headCol, 0.8), 0.020, 0.024, 0.07, hw * 0.35, hh * 0.37, 0));

  } else {
    /* IRONS AND WEDGES, and they are not the same club. A 3 iron is a long
       thin cavity-backed blade; a lob wedge is a short deep slab with a
       wide bounce sole and grooves to the top edge. `t` runs 0 at the 2
       iron to 1 at the flop, and every dimension below rides it — so the
       set forms a visible progression instead of twelve copies. */
    const t = Math.min(1, Math.max(0, (club.loft - 18) / 46));
    const wedge = club.type === 'wedge';
    const w = 0.30 - t * 0.055;              // blades shorten as loft climbs
    const h = 0.135 + t * 0.055;             // and get deeper
    const faceD = 0.030 + t * 0.016;

    head.add(box(M(headCol, 0.75), w, h, faceD, 0, 0, 0));

    /* The back tells you which club it is. Long irons are cavity-backed for
       forgiveness — a rim with a hollow — and short irons and wedges are
       muscle-backs, solid with the weight behind the middle of the face. */
    if (!wedge && t < 0.45) {
      head.add(box(M(headCol, 0.6), w * 0.94, h * 0.20, 0.030, 0, h * 0.36, faceD * 0.8));
      head.add(box(M(headCol, 0.6), w * 0.94, h * 0.16, 0.030, 0, -h * 0.30, faceD * 0.8));
      head.add(box(M(headCol, 0.6), w * 0.10, h * 0.86, 0.030, -w * 0.42, 0, faceD * 0.8));
      head.add(box(M(headCol, 0.6), w * 0.10, h * 0.86, 0.030, w * 0.42, 0, faceD * 0.8));
      head.add(box(M('#101216'), w * 0.78, h * 0.52, 0.012, 0, 0, faceD * 0.72));
    } else {
      head.add(blob(M(headCol, 0.6), w * 0.72, h * 0.52, 0.055, 0, -h * 0.12, faceD * 0.75));
    }

    /* The sole, and its width is the bounce. A wedge's is visibly thick —
       it is the part that stops the club digging — and a 3 iron's is a thin
       edge. Same box, very different number. */
    const sole = wedge ? 0.030 + t * 0.030 : 0.018;
    head.add(box(M('#15171a'), w, sole, faceD + 0.030 + t * 0.030,
                 0, -h / 2 + sole / 2, faceD * 0.25));

    /* Grooves. A wedge has them across the whole face and an iron only over
       the hitting area, and there are more of them the more loft there is —
       which is exactly the detail that was one hard-coded 5 for every club
       from the 2 iron to the flop. */
    const n = wedge ? 11 : 6 + Math.round(t * 3);
    const span = h * (wedge ? 0.74 : 0.56);
    for (let i = 0; i < n; i++) {
      head.add(box(M('#8a8f96'), w * (wedge ? 0.86 : 0.74), 0.005, 0.006,
                   0, span / 2 - (i * span) / (n - 1), -faceD / 2 - 0.003));
    }

    // the hosel, angled in from the heel the way a real iron's is
    const hos = rod(M(headCol, 0.7), 0.019, 0.023, 0.09, w * 0.44, h * 0.42, 0);
    hos.rotation.z = 0.22;
    head.add(hos);
  }

  /* Loft is real: the face lies back by the club's own number, so a wedge
     visibly points at the sky and a driver does not. */
  head.rotation.x = (club.loft || 10) * Math.PI / 180 * 0.55;
  g.add(head);

  /* A glow on the feat finishes. They are the only things in the game that
     cannot be bought or ground out, so they are allowed to announce
     themselves. */
  if (sk.glow) {
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.30, 14, 10),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(sk.glow), transparent: true,
                                    opacity: 0.16, depthWrite: false }));
    halo.position.y = headY;      // follows the head, which now moves per club
    g.add(halo);
  }
  /* FRAME ON THE HEAD. A club is nine parts shaft, so framing the whole
     object fits a metre and a half of tube on screen and leaves the head —
     the only part that differs between two clubs, and the only part anybody
     is buying — about ten pixels tall. Every shop in the world photographs
     a club by filling the frame with the head and letting the shaft run out
     of shot, and for the same reason.

     Tilted, too: a club stood straight up is a pole. Leaning it puts the
     sole, the face and the topline all in one view. */
  g.rotation.z = 0.30;
  g.userData.focus = head;
  return g;
}

/* The head geometry is the thing the shop exists to show, so it is worth
   asserting rather than eyeballing — twelve irons that differ by a number
   nobody checked is how they ended up identical in the first place. */
export const __buildClubForTest = (key, tier = 0, skin = 'stock') =>
  buildClub(key, tier, skin);

/* -------------------------------------------------------------- decals ---
   Shown on a flat plate rather than floating: a badge in mid-air is a
   texture, a badge on something is a thing you can own. */
function buildDecal(id) {
  const g = new THREE.Group();
  const d = DECALS.find(x => x.id === id);
  const tex = decalTexture(id, null);
  g.add(box(M('#e8eaee'), 1.05, 1.05, 0.06, 0, 0, 0));
  if (tex) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(0.92, 0.92),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    m.position.set(0, 0, 0.035);
    g.add(m);
    const back = m.clone();
    back.position.z = -0.035;
    back.rotation.y = Math.PI;
    g.add(back);
  }
  if (d?.glow) {
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(1.7, 1.7),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(d.c[0]), transparent: true,
                                    opacity: 0.16, depthWrite: false }));
    g.add(halo);
  }
  return g;
}

/** A ball, for the ball-finish upgrades. */
function buildBall(hex = '#f6f9f4') {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.44, 24, 18),
    new THREE.MeshPhongMaterial({ color: new THREE.Color(hex), shininess: 70,
                                  specular: new THREE.Color(0xffffff) })));
  return g;
}

/* -------------------------------------------------------------- caddie ---
   A caddie is a PERSON, and the shop was previewing one as a gold crate.
   You spend real coins levelling these up and the only thing on the
   turntable was a box, which tells you nothing and looks like a placeholder
   that shipped — because it was one.

   Deliberately simple, and deliberately not the full Avatar rig: this is a
   260-pixel canvas and importing the golfer here would drag a skeleton, an
   IK solver and a wardrobe into a preview of a bag carrier. */
function buildCaddie(hex = '#e8c15a') {
  const g = new THREE.Group();
  const skin = M('#c9a07a'), kit = M(hex, 0.3), dark = M('#26302a');
  g.add(blob(skin, 0.30, 0.34, 0.30, 0, 0.62, 0));            // head
  g.add(box(M('#1c2420'), 0.34, 0.10, 0.34, 0, 0.78, 0));     // cap
  g.add(box(M('#1c2420'), 0.34, 0.04, 0.20, 0, 0.74, -0.20)); // and its peak
  g.add(box(kit, 0.44, 0.46, 0.26, 0, 0.20, 0));              // torso
  g.add(box(skin, 0.11, 0.40, 0.11, -0.27, 0.18, 0));         // arms
  g.add(box(skin, 0.11, 0.40, 0.11, 0.27, 0.18, 0));
  g.add(box(dark, 0.16, 0.42, 0.16, -0.11, -0.24, 0));        // legs
  g.add(box(dark, 0.16, 0.42, 0.16, 0.11, -0.24, 0));

  /* The bag on their back, which is the whole job. Three club heads poking
     out of the top, because a bag with nothing in it is a holdall. */
  g.add(rod(M('#1f2a24'), 0.15, 0.17, 0.60, 0, 0.26, 0.22));
  for (let i = -1; i <= 1; i++) {
    g.add(rod(M('#c9ccd2', 0.6), 0.014, 0.014, 0.26, i * 0.07, 0.66, 0.22));
    g.add(box(M('#8a8f96', 0.5), 0.07, 0.05, 0.04, i * 0.07, 0.80, 0.22));
  }
  return g;
}

/** A generic crate, for anything with no model of its own. */
function buildGeneric(hex = '#6fce8a') {
  const g = new THREE.Group();
  g.add(box(M(hex, 0.4), 0.9, 0.9, 0.9, 0, 0, 0));
  g.add(box(M('#0f1a14'), 0.94, 0.10, 0.94, 0, 0.42, 0));
  return g;
}

/**
 * Show one item.
 * @param what { kind: 'club'|'decal'|'ball'|'item', key, tier, hex, name, sub }
 */
export function showItem(canvas, what) {
  if (!canvas) return;
  const r = build(canvas);
  const sig = JSON.stringify(what);
  if (sig === r.current) return;             // same item: keep it spinning
  r.current = sig;

  // clear the stage, freeing only what this module made
  for (const c of [...r.stage.children]) {
    r.stage.remove(c);
    c.traverse(o => {
      if (o.isMesh) {
        o.geometry.dispose();
        // decal textures are shared and cached — never free those
        if (!o.material.map) o.material.dispose();
      }
    });
  }

  let obj;
  if (what?.kind === 'club') obj = buildClub(what.key || 'DR', what.tier || 0, what.skin || 'stock');
  else if (what?.kind === 'decal') obj = buildDecal(what.key);
  else if (what?.kind === 'ball') obj = buildBall(what.hex);
  else if (what?.kind === 'caddie') obj = buildCaddie(what.hex);
  else obj = buildGeneric(what?.hex);
  r.stage.add(obj);

  /* FRAME IT FROM ITS OWN BOUNDS rather than from a fixed camera distance.
     A club is 1.9 units tall and a badge is 1.05; one camera position
     cannot suit both, and the first pass put the camera close enough that a
     driver ran off the top and the bottom and all you saw was a length of
     shaft. Measuring means a new item type frames itself without anybody
     choosing a number for it.

     Measured on the UNROTATED object, then padded — the stage turns, and a
     box that exactly fits face-on clips its own corners a quarter turn
     later. */
  r.stage.rotation.set(0, 0, 0);
  /* An item can nominate the part worth looking at (clubs do — see the note
     in buildClub). Framing on that instead of on the whole object is the
     difference between a picture of a club head and a picture of a shaft. */
  const focus = obj.userData?.focus || obj;
  const bb = new THREE.Box3().setFromObject(focus);
  const size = bb.getSize(new THREE.Vector3());
  const mid = bb.getCenter(new THREE.Vector3());
  /* Put the focus ON the spin axis, both ways. Y alone was enough while the
     whole object was framed and symmetrical; a club head hangs off the end
     of a leaning shaft, so leaving X be would swing it around the turntable
     instead of turning it on the spot. */
  obj.position.y -= mid.y;
  obj.position.x -= mid.x;
  const reach = Math.max(size.y, Math.hypot(size.x, size.z)) * 0.5;
  const fovR = r.camera.fov * Math.PI / 180;
  const dist = (reach * 2.0) / Math.tan(fovR / 2);
  r.camera.position.set(0, reach * 0.30, dist);
  r.camera.lookAt(0, 0, 0);
  r.camera.updateProjectionMatrix();

  r.spin = 0;
  start();
}

function frame() {
  raf = requestAnimationFrame(frame);
  /* Every live turntable, not just the last one asked for. Both are cheap —
     a dozen boxes each — and skipping the hidden one would mean tracking
     which pane is open, which is a second source of truth about something
     the DOM already knows. */
  for (const R of views.values()) {
    const c = R.canvas;
    if (!c.isConnected || !c.clientWidth) continue;   // its pane is closed
    const w = c.clientWidth, h = c.clientHeight || 240;
    if (c.width !== w || c.height !== h) {
      R.renderer.setSize(w, h, false);
      R.camera.aspect = w / h;
      R.camera.updateProjectionMatrix();
    }
    R.spin += 0.012;
    R.stage.rotation.y = R.spin;
    /* A slight nod as well as the turn. A pure Y spin is a lazy susan; the
       tilt is what lets you see the sole of a club and the face of a badge
       in the same revolution. */
    R.stage.rotation.x = Math.sin(R.spin * 0.6) * 0.16;
    R.renderer.render(R.scene, R.camera);
  }
}

export function start() { if (!raf) raf = requestAnimationFrame(frame); }
export function stop() { cancelAnimationFrame(raf); raf = 0; }

/** Free the whole thing — the shop is closed. */
export function disposeShopView() {
  stop();
  for (const R of views.values()) {
    R.scene.traverse(o => {
      if (o.isMesh) { o.geometry.dispose(); if (!o.material.map) o.material.dispose(); }
    });
    R.renderer.dispose();
  }
  views.clear();
}
