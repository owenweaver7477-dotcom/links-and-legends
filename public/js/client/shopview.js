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

  g.add(box(M(gripCol), 0.075, 0.42, 0.075, 0, 0.62, 0));
  g.add(box(M(shaftCol, shine), 0.042, 1.5, 0.042, 0, -0.12, 0));

  const head = new THREE.Group();
  head.position.set(0, -0.90, 0);
  if (club.putter) {
    head.add(box(M(headCol, 0.8), 0.34, 0.09, 0.12, 0, 0, 0.03));
    head.add(box(M('#c8382f'), 0.03, 0.10, 0.02, 0, 0.005, -0.03));   // the sightline
  } else if (club.type === 'wood' || club.type === 'hybrid') {
    head.add(box(M(headCol, 0.9), 0.30, 0.20, 0.26, 0, -0.02, 0.08));
    head.add(box(M('#1a1c20'), 0.28, 0.02, 0.24, 0, -0.12, 0.08));    // the sole
  } else {
    // an iron: a blade with a visible set of grooves
    head.add(box(M(headCol, 0.75), 0.26, 0.16, 0.055, 0, 0, 0.03));
    head.add(box(M('#1a1c20'), 0.26, 0.03, 0.075, 0, -0.08, 0.035));
    for (let i = 0; i < 5; i++) {
      head.add(box(M('#8a8f96'), 0.20, 0.006, 0.012, 0, 0.045 - i * 0.022, 0.058));
    }
  }
  /* Loft is real: the face lies back by the club's own number, so a wedge
     visibly points at the sky and a driver does not. */
  head.rotation.x = -(club.loft || 10) * Math.PI / 180 * 0.55;
  g.add(head);

  /* A glow on the feat finishes. They are the only things in the game that
     cannot be bought or ground out, so they are allowed to announce
     themselves. */
  if (sk.glow) {
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.30, 14, 10),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(sk.glow), transparent: true,
                                    opacity: 0.16, depthWrite: false }));
    halo.position.y = -0.90;
    g.add(halo);
  }
  g.scale.setScalar(0.86);
  return g;
}

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
  const bb = new THREE.Box3().setFromObject(obj);
  const size = bb.getSize(new THREE.Vector3());
  const mid = bb.getCenter(new THREE.Vector3());
  obj.position.y -= mid.y;                       // sit it on the turntable centre
  const reach = Math.max(size.y, Math.hypot(size.x, size.z)) * 0.5;
  const fovR = r.camera.fov * Math.PI / 180;
  const dist = (reach * 1.55) / Math.tan(fovR / 2);
  r.camera.position.set(0, reach * 0.22, dist);
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
