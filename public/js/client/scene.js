/* =========================================================================
   scene.js — the 3D world
   -------------------------------------------------------------------------
   Builds a hole into a Three.js scene: terrain mesh sampled from the same
   heightAt() the physics uses, the painted surface texture, water surfaces,
   instanced trees, flagstick and cup, and the player balls.
   ========================================================================= */

import * as THREE from '../../vendor/three.module.js';
import { buildSurfaceTexture } from './surfacemap.js';
import { mulberry32, clamp, lerp, fbm, smoothstep } from '../shared/rng.js';
import { BALL_RADIUS } from '../shared/ballistics.js';
import { sharedBlobTexture } from './avatar.js';
import { crownOf } from '../shared/biomes.js';
import { lightAt, sunAt, SEASONS } from '../shared/weather.js';
import { applyBallFinish, makeBallMaterial } from '../shared/ballfinish.js';

const GRID_STEP = 1.8;          // metres between terrain vertices.  2.6 read
                                // as polygonal on every mound; 1.8 is the
                                // point where silhouettes become curves.
const _fwd = new THREE.Vector3();
// per-frame scratch: the cloud drift and effect loops run every frame of the
// whole round, so they must not allocate — reuse these instead
const _m4 = new THREE.Matrix4();
const _scl = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _pos = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);   // never mutated — a bird's scale is always 1

/* Three real budgets. `scenery` scales the decorative instancing, `water`
   drops the fine chop, and pixelRatio is the one that decides whether a weak
   machine is playable at all — a retina display asks for four times the
   fragments, and capping it is worth more than every other lever combined. */
/* THE ONE PLACE A TIER IS DESCRIBED. Every lever here has to be read
   somewhere, or it is a promise the settings screen makes and nothing keeps
   — and two of them were exactly that:

     `water` was declared by all three tiers and read by nothing, so turning
     the quality down never simplified the water.
     `precip` was READ (in the weather build) and declared by no tier, so it
     always resolved to its `?? 1` default and rain was full density on a
     machine that had asked for low.

   Both are wired now. `env` is new: the prefiltered environment map (see
   _environment) is what finally gives a chrome ball and a mythic club head
   something to reflect, and it is one render of the sky per biome — real,
   but not free on a machine already struggling. */
export const QUALITY = {
  low:    { pixelRatio: 1,   shadows: false, shadowMap: 0,    scenery: 0.35, water: 0, precip: 0.45, env: 0,   detail: 0 },
  medium: { pixelRatio: 1.5, shadows: true,  shadowMap: 1024, scenery: 0.75, water: 1, precip: 0.8,  env: 128, detail: 1 },
  high:   { pixelRatio: 2,   shadows: true,  shadowMap: 2048, scenery: 1.0,  water: 1, precip: 1,    env: 256, detail: 2 }
};

/* `detail` is HOW MANY SIDES a thing has, and `scenery` is how many things
   there are — two different questions that were being answered by one
   number. A tree drawn with a five-sided trunk and a six-sided canopy reads
   as a paper model however many of them you put on a hill, and the fix for
   that is not more trees.

   Every generator below asks through this, so one tier bumps the whole
   world's silhouette and a low-end machine keeps exactly the counts it has
   always had. Instanced geometry, so the extra triangles are paid once per
   species rather than once per tree.

   MEDIUM IS THE DEFAULT, so its step is the conservative one: 1.32 rather
   than the 1.5 this shipped with, which had put 28% more triangles on every
   machine that never opens the settings. High is where the budget is meant
   to be spent, and it is the tier somebody chose. */
export const seg = (q, base) => Math.round(base * [1, 1.32, 2.1][q?.detail ?? 1]);

/**
 * Make a mostly-horizontal mesh face upward, whatever order its indices came
 * out in. Sums the vertex normals and flips every triangle if the answer
 * points at the ground.
 *
 * Worth doing rather than just relying on DoubleSide: a downward normal under
 * a sun that is above you is a surface lit from behind, so the ground would
 * still be there and still be wrong — flat, dark, and unlit exactly where the
 * light should be raking across it.
 */
/**
 * Merge a handful of non-indexed-or-indexed geometries into one. Three ships
 * BufferGeometryUtils for this, but it is not in the vendored build and one
 * function is cheaper than another file in the bundle. Position and normal
 * only — nothing here is textured.
 */
function mergeGeos(list) {
  let nv = 0, ni = 0;
  for (const g of list) {
    nv += g.attributes.position.count;
    ni += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3);
  const idx = new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal;
    pos.set(p.array, vo * 3);
    if (n) nor.set(n.array, vo * 3);
    const gi = g.index;
    for (let i = 0; i < (gi ? gi.count : p.count); i++) {
      idx[io++] = (gi ? gi.array[i] : i) + vo;
    }
    vo += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeVertexNormals();
  return out;
}

function faceUp(geo) {
  geo.computeVertexNormals();
  const n = geo.attributes.normal;
  let sum = 0;
  for (let i = 0; i < n.count; i++) sum += n.getY(i);
  if (sum >= 0) return geo;
  const idx = geo.index.array;
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i]; idx[i] = idx[i + 2]; idx[i + 2] = t;
  }
  geo.index.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

const TRACE_LIVE_OPACITY = 0.45;
const TRACE_HELD_OPACITY = 0.18;

export class GolfScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;   // the key light carries it now
    /* Shadow maps are the single most expensive thing here — a whole extra
       pass over every caster — so a tier that does not want them says so and
       everything follows from that ONE declaration.

       It used to be declared twice and the two disagreed: `this.q` was set
       to QUALITY.medium, which asks for shadows, while the three lines under
       it hard-coded them off. Whether the game had shadows therefore
       depended on whether setQuality happened to run before the first hole
       was built, which is not a decision anybody made. */
    this.quality = 'medium';
    this.q = QUALITY.medium;
    this.renderer.shadowMap.enabled = this.q.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = this.q.shadows;

    /* A lost WebGL context is what "the game crashed" usually means in a
       browser: the GPU resets under load or the driver reclaims the context,
       every buffer becomes invalid, and a renderer that keeps drawing throws
       on the next frame and never recovers.  Catching the event lets us stop
       cleanly, tell the player, and rebuild when the browser hands the
       context back — a hiccup instead of a dead tab. */
    this.contextLost = false;
    canvas.addEventListener('webglcontextlost', ev => {
      ev.preventDefault();               // required, or it is never restored
      this.contextLost = true;
      this.onContextLost?.();
    }, false);
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      // the renderer rebuilds its own state; ours is rebuilt by reloading the
      // hole, which the caller does through onContextRestored
      this.onContextRestored?.();
    }, false);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.12, 3000);
    this.mapCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);

    this.holeGroup = null;
    // Actors — golfers and carts — outlive the hole they are standing on.
    // holeGroup is destroyed and rebuilt on every hole change, so anything
    // parented to it is silently orphaned the moment the hole turns over.
    this.actorGroup = new THREE.Group();
    this.actorGroup.name = 'actors';
    this.scene.add(this.actorGroup);
    this.balls = new Map();
    this.t = 0;
    this._water = [];
    this._trees = [];
    this._props = new Map();       // prop index -> its node, so one can be smashed
    this._falling = [];            // props mid-topple, advanced by _fallProps
    this.resize();
  }

  /**
   * Switch the graphics budget.
   *
   * This used to toggle the shadow pass and nothing else, which is why
   * neither end of the setting did much: a weak laptop still rendered every
   * pixel at full device resolution, and a strong one got no more scenery
   * for saying so.
   *
   * The levers, in order of how much they actually cost:
   *
   *   pixelRatio   by far the biggest. A retina display asks for four times
   *                the fragments; capping it at 1 is the single change that
   *                turns an unplayable machine into a playable one.
   *   shadows      the whole second pass, plus its map resolution.
   *   scenery      far trees and the surrounding ground rings, which are
   *                pure decoration beyond the hole boundary.
   *   water        the fine chop octaves in the water shader.
   *
   * Changing scenery needs the hole rebuilt, so setQuality reports whether
   * the caller should do that rather than doing it behind their back.
   */
  setQuality(q) {
    const Q = QUALITY[q] || QUALITY.medium;
    const wasScenery = this.q?.scenery;
    const wasDetail = this.q?.detail;
    this.quality = q;
    this.q = Q;

    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, Q.pixelRatio));
    this.renderer.shadowMap.enabled = Q.shadows;
    this.renderer.shadowMap.autoUpdate = Q.shadows;
    this.renderer.shadowMap.needsUpdate = true;
    if (this.sun) {
      this.sun.castShadow = Q.shadows;
      if (Q.shadows) this.sun.shadow.mapSize.set(Q.shadowMap, Q.shadowMap);
      // the map is allocated on first use, so it has to be dropped to resize
      this.sun.shadow.map?.dispose?.();
      this.sun.shadow.map = null;
    }
    if (this.terrainMesh) this.terrainMesh.receiveShadow = Q.shadows;
    /* The environment is a tier lever like the others, so changing tier has
       to act on it. Regenerated from the sky already in the scene rather
       than deferred to the next hole — a player who turns quality up wants
       to see it now, not after they hole out. */
    if (this.holeGroup) {
      const sky = this.holeGroup.children.find(o => o.renderOrder === -1 && o.material?.isShaderMaterial);
      if (sky) this._buildEnvironment(sky.material);
    }
    this.scene.traverse(o => {
      if (o.material) {
        const m = Array.isArray(o.material) ? o.material : [o.material];
        for (const mm of m) mm.needsUpdate = true;
      }
      if (o.isInstancedMesh && o.userData.decor) o.castShadow = Q.shadows;
    });
    this.resize();
    /* Rebuild when the world's geometry would come out different — which is
       either how MANY things there are or how many sides they have. Detail
       was the second half of that and had nowhere to be asked. */
    return wasScenery !== undefined &&
           (wasScenery !== Q.scenery || wasDetail !== Q.detail);
  }

  resize() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /* ===================================================================== */
  /*  BUILD                                                                 */
  /* ===================================================================== */

  loadHole(hole, terrain, bio) {
    this.dispose();
    this.hole = hole; this.T = terrain; this.bio = bio;

    const g = this.holeGroup = new THREE.Group();
    this.scene.add(g);

    const P = bio.palette;
    /* WEATHER AND TIME OF DAY.
       -------------------------------------------------------------------
       Everything below reads the biome palette through the weather rather
       than straight: the light warms and drops as the hour gets late, the
       sky darkens, the fog closes in. The multipliers come from
       weather.js so the server computes the same numbers — a client that
       thinks it is a clear noon while the server thinks it is raining is a
       client whose ball goes further than the server allows. */
    const W = this.weather || null;
    const L = W ? lightAt(W.hour, W.season) : null;
    /* Declared HERE, with the other weather derivations, and not down in the
       sun block where it is mostly used — the hemisphere light reads it
       first, and a `const` used above its declaration is a temporal dead
       zone error that takes the whole boot down rather than just the sky. */
    const cloudy = W ? W.cloud : 0;
    const SEA = W ? (SEASONS.find(x => x.id === W.season) || null) : null;
    /* Stashed on the scene, because _buildTerrain and the tree builder are
       separate methods called from here — a local of loadHole is not in
       scope in either of them, which is how `SEA is not defined` took the
       whole boot down. */
    this._season = SEA;
    const tint = (hex, mul) => {
      const c = new THREE.Color(hex);
      if (!mul) return c;
      c.r = Math.min(1, c.r * mul[0]); c.g = Math.min(1, c.g * mul[1]); c.b = Math.min(1, c.b * mul[2]);
      return c;
    };
    const skyTop = tint(P.sky[0], L?.skyTop);
    const skyBot = tint(P.sky[1], L?.skyBot);
    if (L?.night) {
      // night is not "the same picture, darker": it is a different palette
      skyTop.setRGB(0.06, 0.09, 0.19); skyBot.setRGB(0.13, 0.17, 0.29);
    }

    /* ---- atmosphere ---- */
    /* AERIAL PERSPECTIVE, which is the thing that was missing.
       -------------------------------------------------------------------
       Fog ran 420 to 2600. The horizon ridge sits around 1,000 m, so it was
       arriving barely a quarter hazed — as saturated and as contrasty as the
       grass under your feet. That is exactly why the distance read as flat
       painted cardboard behind the course rather than as land a mile away:
       real distance is lighter, bluer and lower in contrast, and none of
       that was happening.

       260 to 1900 puts the ridge at about two-thirds hazed and the far
       treeline at a third, which is the gradient the eye reads as depth. The
       near course is untouched — nothing within 260 m is fogged at all, and
       the longest shot in the game is 300. */
    /* Visibility. Fog is the one weather effect that changes how the hole is
       PLAYED rather than how it looks — at 0.16 (thick fog) the far distance
       closes to about 300 m and you cannot see the green from the tee, which
       is exactly what fog does on a golf course. The near plane scales too,
       or thick fog would sit as a wall at a fixed distance instead of
       surrounding you. */
    const vis = W ? W.vis : 1;
    const fogCol = L?.night
      ? new THREE.Color(0.10, 0.13, 0.22)
      : tint(P.fog, L?.skyBot);
    if (W && W.wet) fogCol.lerp(new THREE.Color('#9fb0b8'), W.wet * 0.35);
    this.scene.fog = new THREE.Fog(fogCol, 260 * Math.max(0.28, vis), 1900 * vis);
    this.scene.background = skyBot.clone();

    /* The hemisphere light's GROUND colour is the bounce coming back up off
       the course, and it was set to the deep rough — the darkest green in
       the palette. Everything vertical takes roughly the average of sky and
       ground, so every trunk, every golfer's legs and the shaded side of
       every object was lit by the darkest thing in the scene and arrived on
       screen as a silhouette. A fairway you can stand on bounces fairway
       light. */
    const bounce = new THREE.Color(P.fairway).lerp(new THREE.Color(P.rough), 0.45);
    const hemiPow = bio.ambient * 1.15 * (L ? L.ambient : 1) * (1 + cloudy * 0.28);
    const hemi = new THREE.HemisphereLight(skyTop.clone(), bounce, hemiPow);
    g.add(hemi);
    this.hemi = hemi;

    /* The sun moves. Its elevation and bearing come from the hour, so a
       morning round has long shadows pointing west and an evening one has
       them pointing east — and at dusk the key goes orange because that is
       what happens when light travels through more atmosphere. */
    const SUN = W ? sunAt(W.hour, W.season) : null;
    const sunDir = SUN
      ? dirFromAngles(Math.max(4, SUN.elev), SUN.azim)
      : dirFromAngles(bio.sunElev, bio.sunAzim);
    // a brighter key against a slightly cooler fill reads as sunlight rather
// than as a uniformly lit model
    /* Cloud cover flattens the key and lifts the fill, which is what an
       overcast day actually is — not a dimmer switch on a sunny one. */
    const sunCol = L?.night ? new THREE.Color(0.52, 0.60, 0.86) : tint(P.sun, L?.warm);
    const sunPow = (L ? L.strength : 1.78 / 1.14) * 1.14 * (1 - cloudy * 0.55);
    const sun = new THREE.DirectionalLight(sunCol, Math.max(0.10, sunPow));
    sun.position.set(sunDir.x * 600, sunDir.y * 600, sunDir.z * 600);
    sun.castShadow = !!this.q?.shadows;
    // 2048 over 1536: the shadow frustum covers 70 m, so this is the
    // difference between a golfer's shadow having edges and having a smear.
    sun.shadow.mapSize.set(this.q?.shadowMap || 2048, this.q?.shadowMap || 2048);
    const SH = 52;                       // metres of shadow coverage around the camera
    // tighter than the old 70: the same texels over less ground is a sharper
    // shadow everywhere you are actually looking
    sun.shadow.camera.left = -SH; sun.shadow.camera.right = SH;
    sun.shadow.camera.top = SH; sun.shadow.camera.bottom = -SH;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 420;
    sun.shadow.bias = -0.0012;
    sun.shadow.normalBias = 0.035;
    g.add(sun);
    g.add(sun.target);
    this.sun = sun;
    this.sunDir = sunDir;

    // A weak fill that follows the camera. Costs nothing and stops avatars and
    // balls turning into silhouettes whenever you are looking into the sun.
    this.fill = new THREE.DirectionalLight(new THREE.Color(P.sky[1]), 0.5);
    g.add(this.fill);
    g.add(this.fill.target);

    const skyMesh = this._buildSky(skyTop, skyBot, P.sun, bio);
    g.add(skyMesh);
    /* Everything reflective in the scene now has something to reflect. Built
       from the sky that is actually overhead on this hole, so a chrome ball
       goes silver-blue at noon and warm grey at dusk without anything asking
       what time it is. */
    this._buildEnvironment(skyMesh.material);

    /* ---- terrain ---- */
    g.add(this._buildTerrain(hole, terrain, bio));
    g.add(this._buildSurrounds(hole, terrain, bio));

    /* ---- water ---- */
    for (let i = 0; i < hole.waters.length; i++) {
      const m = this._buildWater(hole.waters[i], terrain.waterLevels[i], bio);
      g.add(m);
      this._water.push(m);
    }

    /* ---- the world beyond the course ---- */
    g.add(this._buildHorizon(hole, bio));
    g.add(this._buildBackdrop(hole, terrain, bio));

    /* ---- clouds ---- */
    this.clouds = this._buildClouds(hole, bio);
    if (this.clouds) g.add(this.clouds);

    /* ---- trees ---- */
    for (const mesh of this._buildTrees(hole, terrain, bio)) { g.add(mesh); this._trees.push(mesh); }
    const treeShade = this._buildTreeShadows(hole, terrain);
    if (treeShade) g.add(treeShade);

    /* ---- foliage: bushes, blooms, grass, rocks, reeds ---- */
    for (const mesh of this._buildFoliage(hole, terrain, bio)) g.add(mesh);

    /* ---- the furniture: huts, shelters, benches, signs ---- */
    const props = this._buildProps(hole, terrain, bio);
    if (props) g.add(props);

    /* ---- flag, cup, tee markers ---- */
    g.add(this._buildPin(hole, terrain, bio));
    g.add(this._buildTeeMarkers(hole, terrain, bio));

    /* ---- aiming aids ---- */
    this.aimLine = this._buildAimLine();
    g.add(this.aimLine);
    this.traceLine = this._buildTrace();
    g.add(this.traceLine);

    this.fx = new EffectPool(g);

    // Pre-rasterise the green-read while the loading screen is still up:
    // the 256x256 contour bake costs 25-35 ms, which is invisible here but
    // would drop frames if left until the putter first comes out mid-play.
    this.setGreenRead(true);
    this.setGreenRead(false);
    return this;
  }

  dispose() {
    if (!this.holeGroup) return;
    this.holeGroup.traverse(o => {
      // shared tree geometries live in _geoCache and outlive the hole
      if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m.userData && m.userData.shared) continue;   // singleton materials survive
          if (m.map && !m.map.userData.shared) m.map.dispose();
          m.dispose();
        }
      }
    });
    this.scene.remove(this.holeGroup);
    this.holeGroup = null;
    this.balls.clear();
    this._water.length = 0;
    this._trees.length = 0;
    this._props.clear();
    this._falling.length = 0;
    /* The environment map is generated FROM the sky material that the loop
       above has just disposed, so it has to go with it — otherwise the
       reflection outlives the sky it was taken of, and eighteen holes leave
       eighteen render targets on the GPU. */
    this._envRT?.dispose();
    this._envRT = null;
    this.scene.environment = null;
  }

  /* ------------------------------------------------------ environment ---
     A prefiltered environment map, generated from the game's own sky.

     THE POINT. Until now there was no environment map anywhere, so every
     "reflective" surface in this game — a chrome ball, a Mythic club head,
     a foil-weave shirt — was a Phong highlight: a white dot placed where a
     light is, which knows nothing about what is actually around the object.
     That is why the shiny cosmetics never looked shiny, only pale.

     AND IT IS STILL PROCEDURAL. Nothing is downloaded. PMREMGenerator
     renders the existing sky shader into a small cubemap and prefilters it
     into the roughness mip chain that MeshStandard/Physical sample. The
     sky material is the one already on screen, shared, so the reflection
     and the sky can never disagree about the weather.

     The probe sphere is radius 10 rather than the sky's own 2200 because
     the shader is a pure function of `normalize(position)` — the direction
     is all it reads — and a small sphere keeps the PMREM camera's near/far
     sane. Same gradient, no giant frustum. */
  _buildEnvironment(skyMat) {
    // dropped first: this runs once per hole, and a leaked render target per
    // hole is 18 of them by the end of a round
    this._envRT?.dispose();
    this._envRT = null;
    this.scene.environment = null;

    const size = this.q?.env | 0;
    if (!size || !skyMat) return;

    const probe = new THREE.Scene();
    const geo = new THREE.SphereGeometry(10, 32, 20);
    probe.add(new THREE.Mesh(geo, skyMat));

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileCubemapShader();
    try {
      const rt = pmrem.fromScene(probe, 0, 0.5, 40);
      this._envRT = rt;
      this.scene.environment = rt.texture;
    } catch (err) {
      /* A float render target is not guaranteed. Losing the reflections is a
         downgrade; throwing here would lose the hole. */
      console.warn('environment map unavailable:', err?.message || err);
    }
    pmrem.dispose();
    geo.dispose();
  }

  /* -------------------------------------------------------------- sky --- */
  _buildSky(top, bot, sunHex, bio) {
    const geo = new THREE.SphereGeometry(2200, 32, 20);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: top }, bot: { value: bot },
        sunCol: { value: new THREE.Color(sunHex) },
        sunDir: { value: dirFromAngles(bio.sunElev, bio.sunAzim) }
      },
      vertexShader: `
        varying vec3 vDir;
        void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 top, bot, sunCol, sunDir;
        varying vec3 vDir;
        void main(){
          vec3 nd = normalize(vDir);
          float h = clamp(nd.y*0.5+0.5, 0.0, 1.0);
          vec3 c = mix(bot, top, pow(h, 0.72));
          // a pale haze band sitting on the horizon, the way real distance reads
          float horizon = 1.0 - smoothstep(0.0, 0.16, abs(nd.y));
          c = mix(c, mix(bot, vec3(1.0), 0.45), horizon * 0.38);
          float d = max(dot(nd, normalize(sunDir)), 0.0);
          c += sunCol * pow(d, 900.0) * 2.4;              // the disc itself, small and hot
          c += sunCol * pow(d, 90.0) * 0.55;              // inner bloom
          c += sunCol * pow(d, 6.0) * 0.14;               // wide warm wash
          gl_FragColor = vec4(c, 1.0);
        }`
    });
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = -1;
    return m;
  }

  /* The exact height the rendered mesh shows at (x,z) — NOT T.heightAt(x,z).
     The terrain mesh is a coarse grid (GRID_STEP apart) with straight
     triangles between its vertices; heightAt() is an exact analytic sample
     that only equals the mesh at those vertices and disagrees everywhere
     else, worse the sharper the local terrain is. Measured up to 17cm on a
     ridge green — plainly a floating or buried cup. Anything that has to
     sit flush on the ground, the cup above all, needs the value the mesh
     will actually show, found the same way _buildTerrain triangulates it. */
  _meshHeightAt(T, hole, x, z) {
    const b = hole.bounds;
    const spanX = b.maxX - b.minX, spanZ = b.maxZ - b.minZ;
    const nx = Math.max(8, Math.round(spanX / GRID_STEP));
    const nz = Math.max(8, Math.round(spanZ / GRID_STEP));
    let fx = (x - b.minX) / spanX * nx, fz = (z - b.minZ) / spanZ * nz;
    fx = Math.min(Math.max(fx, 0), nx - 1e-6);
    fz = Math.min(Math.max(fz, 0), nz - 1e-6);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const gx = i => b.minX + (i / nx) * spanX;
    const gz = i => b.minZ + (i / nz) * spanZ;
    const h00 = T.heightAt(gx(ix), gz(iz));
    const h10 = T.heightAt(gx(ix + 1), gz(iz));
    const h01 = T.heightAt(gx(ix), gz(iz + 1));
    const h11 = T.heightAt(gx(ix + 1), gz(iz + 1));
    // same a,d,c / c,d,e split _buildTerrain cuts each grid cell into
    return (tx + tz <= 1)
      ? h00 + tx * (h10 - h00) + tz * (h01 - h00)
      : h11 + (1 - tx) * (h01 - h11) + (1 - tz) * (h10 - h11);
  }

  /* ---------------------------------------------------------- terrain --- */
  _buildTerrain(hole, T, bio) {
    const b = hole.bounds;
    const spanX = b.maxX - b.minX, spanZ = b.maxZ - b.minZ;
    const nx = Math.max(8, Math.round(spanX / GRID_STEP));
    const nz = Math.max(8, Math.round(spanZ / GRID_STEP));

    const verts = (nx + 1) * (nz + 1);
    const pos = new Float32Array(verts * 3);
    const uv = new Float32Array(verts * 2);
    let p = 0, u = 0;
    for (let iz = 0; iz <= nz; iz++) {
      const fz = iz / nz, z = b.minZ + fz * spanZ;
      for (let ix = 0; ix <= nx; ix++) {
        const fx = ix / nx, x = b.minX + fx * spanX;
        pos[p++] = x; pos[p++] = T.heightAt(x, z); pos[p++] = z;
        uv[u++] = fx; uv[u++] = fz;
      }
    }
    const idx = new Uint32Array(nx * nz * 6);
    let k = 0;
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const a = iz * (nx + 1) + ix, c = a + 1, d = a + (nx + 1), e = d + 1;
        idx[k++] = a; idx[k++] = d; idx[k++] = c;
        idx[k++] = c; idx[k++] = d; idx[k++] = e;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();

    /* Painted through the season. `SEA.grass` is a triple of multipliers
       from weather.js — autumn is [1.12, 0.94, 0.74], which takes the green
       down and the red up without touching what makes each course itself. */
    const SEA = this._season || null;
    SEASON_TINT = SEA?.tree || null;      // read where instance colours are set
    const tex = new THREE.CanvasTexture(buildSurfaceTexture(hole, bio, SEA?.grass || null));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;

    const detail = makeDetailTexture(bio);

    const mat = new THREE.MeshLambertMaterial({ map: tex });
    // Blend a repeating grass detail over the top so the ground still reads as
    // turf when the camera is 1.6 m off the deck and the base texture is
    // stretched to a few centimetres per pixel.
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.detailMap = { value: detail };
      sh.uniforms.detailScale = { value: new THREE.Vector2(spanX / 3.5, spanZ / 3.5) };
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D detailMap; uniform vec2 detailScale;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          {
            vec3 d = texture2D(detailMap, vMapUv * detailScale).rgb;
            diffuseColor.rgb *= mix(vec3(1.0), d * 2.0, 0.35);
          }`);
    };
    mat.needsUpdate = true;

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'terrain';
    mesh.receiveShadow = !!this.q?.shadows;
    this.terrainMesh = mesh;
    return mesh;
  }

  /**
   * The hole's mesh has to stop somewhere, and a hard edge against the sky
   * looks like the world ran out.  A big low-res apron carries the ground out
   * to the fog, with a ring of distant hills sitting on the horizon behind it.
   */
  _buildSurrounds(hole, T, bio) {
    const grp = new THREE.Group();
    const b = hole.bounds;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;

    /* A *rectangular* ring, not a circular one: the terrain is a rectangle, so
       a circle either overlaps it (z-fighting) or leaves a gap at the mid-edges
       — both of which show up as a bright seam along the horizon. Walking the
       boundary keeps the inner rim exactly on the terrain edge. */
    // SPREAD has to carry the ground PAST the horizon ridge (which sits at
    // roughly 0.75 spans + 420 m).  At 7.5 the land ran out in front of the
    // ridge, and wherever the ridge profile dipped you saw a slot of bare sky
    // below the skyline — the "abyss" under the world.
    const RINGS = Math.max(6, Math.round(14 * (this.q?.scenery ?? 1)));
    const SEGS = (this.q?.scenery ?? 1) < 0.5 ? 64 : 128;
    const SPREAD = 26, OVERLAP = 0.97;
    const pos = [], idx = [];

    // a point on the terrain's boundary rectangle at perimeter fraction t
    const boundary = (t) => {
      const u = (t % 1) * 4;
      if (u < 1) return [lerp(b.minX, b.maxX, u), b.minZ];
      if (u < 2) return [b.maxX, lerp(b.minZ, b.maxZ, u - 1)];
      if (u < 3) return [lerp(b.maxX, b.minX, u - 2), b.maxZ];
      return [b.minX, lerp(b.maxZ, b.minZ, u - 3)];
    };

    /* Vertex colours carry the distance haze.  A single flat colour under fog
       reads as a dead grey band — an abyss with a course floating in it.  The
       land instead starts as the course's own rough, drifts toward a cooler,
       lighter far tone, and picks up per-vertex variation so it never looks
       like one poured surface. */
    const col = [];
    const near = new THREE.Color(bio.palette.rough);
    const mid = new THREE.Color(bio.palette.deep);
    const far = new THREE.Color(bio.palette.fog).lerp(new THREE.Color(bio.palette.sky[0]), 0.35);
    const _c = new THREE.Color();

    /* ONE height function for the surrounding land, shared with the distant
       treeline below. It used to be written out twice — once here and once
       in _buildFarTrees — with only the far-field half copied across, so the
       trees were planted at the OPEN-COUNTRY height while the ground beneath
       them was still blended toward the course rim. They hovered, visibly, in
       a band right where the eye goes when you look up from a tee shot.
       Same lesson as the tree crowns: if two things have to agree about a
       number, one of them has to ask the other. */
    const ringT = scale => Math.sqrt(Math.max(0, (scale - OVERLAP) / (SPREAD - OVERLAP)));
    const surroundY = (x, z, edge, t) => {
      // Two octaves, the broad one strong: distant land should ROLL rather
      // than lie flat, or the middle distance has nothing to read at all.
      const roll = fbm(x * 0.0016, z * 0.0016, hole.terrainSeed ^ 0x99, 3) * bio.relief * 3.2
        + fbm(x * 0.0052, z * 0.0052, hole.terrainSeed ^ 0x5c, 2) * bio.relief * 1.1;
      const farY = roll - bio.relief * 0.6;
      // sink the ring a touch as it leaves the rim so the seam tucks under
      return { y: lerp(edge - 0.6, farY, smoothstep(0.02, 0.5, t)), roll };
    };
    this._surroundY = surroundY;

    for (let r = 0; r <= RINGS; r++) {
      const t = r / RINGS;
      // start just INSIDE the terrain and a little below it: overlapping
      // guarantees no gap at the join, and the terrain hides the step
      const scale = lerp(OVERLAP, SPREAD, t * t);
      for (let s = 0; s <= SEGS; s++) {
        const [ex, ez] = boundary(s / SEGS);
        const x = cx + (ex - cx) * scale, z = cz + (ez - cz) * scale;
        const edge = T.heightAt(ex, ez);                       // exact rim height
        const { y, roll } = surroundY(x, z, edge, t);
        pos.push(x, y, z);

        // colour by distance, with the local roll lightening the high ground
        _c.copy(near).lerp(mid, smoothstep(0, 0.35, t));
        _c.lerp(far, smoothstep(0.3, 1, t) * 0.82);
        const lift = 1 + (roll / Math.max(1, bio.relief * 4) - 0.4) * 0.16;
        col.push(_c.r * lift, _c.g * lift, _c.b * lift);
      }
    }
    for (let r = 0; r < RINGS; r++) {
      for (let s = 0; s < SEGS; s++) {
        const a = r * (SEGS + 1) + s, c = a + 1, d = a + (SEGS + 1), e = d + 1;
        idx.push(a, d, c, c, d, e);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    /* DOUBLE-SIDED, deliberately, and this is the whole "the background does
       not render" bug.

       The ring is a rectangle walked in one direction and scaled outwards, so
       the winding of its triangles depends on which way round that walk goes
       relative to the axes — and it came out facing DOWNWARD. Back-face
       culling then threw the ground away and left the underside of the sky
       dome showing through: a hard-edged wedge of sky below the horizon,
       right where the land should be. It only showed from a camera above the
       tee — following a lofted shot, or the title screen's orbit — which is
       why it survived so long.

       The winding is corrected below so the lighting is right, and the
       material stays double-sided anyway. This is one mesh of 1,548 vertices
       drawn once; culling half its faces saves nothing worth a hole in the
       world. */
    faceUp(geo);
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      vertexColors: true, side: THREE.DoubleSide
    }));
    mesh.renderOrder = -0.5;
    grp.add(mesh);

    // and something living out there: a band of distant trees so the middle
    // distance is scenery rather than empty ground
    const band = this._buildFarTrees(hole, bio, boundary, cx, cz, surroundY, ringT, T);
    if (band) grp.add(band);
    return grp;
  }

  /**
   * Distant treeline.  One instanced cone-and-trunk pair scattered on the
   * surrounding land between the course edge and the ridge, sized up with
   * distance so they still read after the fog thins them.  One draw call.
   */
  _buildFarTrees(hole, bio, boundary, cx, cz, surroundY, ringT, T) {
    if ((bio.treeDensity ?? 0) < 0.12) return null;      // links has no trees
    const rng = mulberry32((hole.terrainSeed ^ 0x7ee5) >>> 0);
    const N = Math.round(420 * (this.q?.scenery ?? 1));
    const geo = cached('fartree', () => {
      /* A canopy on a stem, merged into ONE geometry so it is still one draw
         call for the whole treeline. The canopy alone was a floating blob:
         with nothing joining it to the ground it read as a rock hanging in
         the air, which is exactly what the middle distance looked like. A
         stem costs sixteen triangles for the entire band and is the
         difference between scenery and a bug. */
      const canopy = new THREE.IcosahedronGeometry(1, 0);
      canopy.scale(1, 1.15, 1);
      canopy.translate(0, 1.05, 0);
      const stem = new THREE.CylinderGeometry(0.13, 0.2, 0.95, seg(this.q, 5));
      stem.translate(0, 0.47, 0);
      return mergeGeos([canopy, stem]);
    });
    /* The treeline read as a band of black lumps: it was mixed halfway to the
       biome's DEEP rough — the darkest green in the palette — and then only a
       eighth of the way to the fog. Distance does the opposite of that. Air
       lifts and desaturates everything in it, so the far band has to be
       LIGHTER than the trees you are standing among, not darker, or the eye
       reads it as a shadow on the hillside rather than as a wood a mile off.

       The base is the rough, barely darkened, and each instance is then hazed
       by how far out it actually sits — scene fog alone cannot do this
       because the band starts at 400 m, where fog has not begun. */
    const canopy = new THREE.Color(bio.palette.rough)
      .lerp(new THREE.Color(bio.palette.deep), 0.22);
    const haze = new THREE.Color(bio.palette.fog);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const inst = new THREE.InstancedMesh(geo, mat, N);
    inst.frustumCulled = false;
    const m = new THREE.Matrix4(), s = new THREE.Vector3();
    const _tc = new THREE.Color();
    let n = 0;
    for (let i = 0; i < N; i++) {
      const [ex, ez] = boundary(rng());
      // Start well clear of the rim: close in they would compete with the real
      // trees the ball can actually hit, and the player must never mistake
      // scenery for a hazard.
      const scale = 1.35 + rng() * rng() * 3.1;
      const x = cx + (ex - cx) * scale + (rng() - 0.5) * 90;
      const z = cz + (ez - cz) * scale + (rng() - 0.5) * 90;
      const h = 11 + rng() * 9;                          // real tree height, honestly scaled
      /* Planted with the SAME function that builds the ground under them.
         This used to be the far-field half of that formula copied across,
         which is right out in open country and wrong everywhere the ring is
         still blending toward the course rim — so the nearer half of the
         band floated. -0.4 buries the stem's foot rather than balancing it
         on the surface. */
      const y = surroundY(x, z, T.heightAt(ex, ez), ringT(scale)).y - 0.4;
      m.makeRotationY(rng() * 6.283);
      m.scale(s.set(h * 0.52, h * 0.62, h * 0.52));
      m.setPosition(x, y, z);
      // haze by distance out, plus a little tone so it is not one flat mass
      const out = Math.min(1, (scale - 1.35) / 3.1);
      _tc.copy(canopy).lerp(haze, 0.10 + out * 0.34)
        .offsetHSL(0, (rng() - 0.5) * 0.05, (rng() - 0.5) * 0.10);
      inst.setColorAt(n, _tc);
      inst.setMatrixAt(n++, m);
    }
    inst.count = n;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    return inst;
  }

  /**
   * The course furniture — see props.js for where it goes and why.
   *
   * One THREE.Group of plain boxes rather than instanced meshes: there are
   * about a dozen per hole, they are all different shapes, and a group of
   * two hundred triangles is not worth an instancing table. Built from the
   * same PROP_KINDS the physics reads, so a hut you can see is a hut you
   * bounce off.
   */
  _buildProps(hole, T, bio) {
    const list = hole.props || [];
    if (!list.length) return null;
    const g = new THREE.Group();
    const P = bio.palette;

    const M = hex => new THREE.MeshLambertMaterial({ color: new THREE.Color(hex) });
    const wood = M(P.trunk);
    const plank = M(lightenHex(P.trunk, 0.30));
    const roof = M('#4a5560');
    const brick = M('#c8bda6');
    const metal = M('#7f8a92');
    const dark = M('#2c3238');
    const accent = M('#3f8f52');

    /* CHAMFERED, for the same reason the golfer is (see avatar.js): a hard
       90-degree edge has one normal on each side and nothing in between, so
       it takes the light in exactly two steps. Every hut, shelter, bench and
       marker post on every hole was made of those, which is why they read as
       placeholder boxes standing on a golf course however well lit they
       were. A chamfer puts a third angled face on every edge to catch a
       highlight along its length.

       The bevel is a fraction of the SMALLEST dimension rather than a fixed
       distance, so a 4.4m hut wall and a 0.1m sole plate both get a
       proportional one instead of the plate being eaten by its own edge.

       Cached per size, as before, and now per detail too — the low tier
       keeps the plain box it always had. */
    const D = this.q?.detail ?? 1;
    const box = (mat, w, h, d, x, y, z, ry = 0) => {
      const b = D > 0 ? Math.min(w, h, d) * 0.13 : 0;
      const m = new THREE.Mesh(cached(`pbox${w}_${h}_${d}@${D}`,
        () => (b > 0.004 ? bevelBox(w, h, d, b) : new THREE.BoxGeometry(w, h, d))), mat);
      m.position.set(x, y, z); m.rotation.y = ry;
      m.castShadow = true; m.receiveShadow = true;
      return m;
    };

    for (const p of list) {
      const y = T.heightAt(p.x, p.z);
      const n = new THREE.Group();
      n.position.set(p.x, y, p.z);
      n.rotation.y = p.rot || 0;

      switch (p.kind) {
        case 'hut': {                       // walls, a pitched roof, a counter
          n.add(box(plank, 4.4, 2.3, 3.2, 0, 1.15, 0));
          n.add(box(roof, 5.2, 0.26, 4.0, 0, 2.45, 0));
          n.add(box(roof, 4.2, 0.7, 0.24, 0, 2.75, 0));      // a ridge, so it is not a slab
          n.add(box(wood, 4.6, 0.16, 0.9, 0, 1.05, 1.85));   // the serving counter
          n.add(box(dark, 1.0, 1.5, 0.1, -1.3, 0.9, 1.62));  // a door
          break;
        }
        case 'shelter': {                   // three sides and a roof
          n.add(box(plank, 3.4, 2.0, 0.2, 0, 1.0, -1.3));
          n.add(box(plank, 0.2, 2.0, 2.6, -1.6, 1.0, 0));
          n.add(box(plank, 0.2, 2.0, 2.6, 1.6, 1.0, 0));
          n.add(box(roof, 4.0, 0.22, 3.2, 0, 2.15, 0));
          n.add(box(wood, 3.0, 0.14, 0.5, 0, 0.5, -0.9));    // the bench inside
          break;
        }
        case 'toilet': {
          n.add(box(brick, 1.7, 2.2, 1.7, 0, 1.1, 0));
          n.add(box(roof, 2.0, 0.18, 2.0, 0, 2.28, 0));
          n.add(box(dark, 0.7, 1.5, 0.08, 0, 0.9, 0.87));
          n.add(box(accent, 0.24, 0.24, 0.06, 0, 1.7, 0.92)); // the little sign
          break;
        }
        case 'bench': {
          n.add(box(wood, 1.9, 0.12, 0.44, 0, 0.46, 0));
          n.add(box(wood, 1.9, 0.44, 0.10, 0, 0.72, -0.20));
          n.add(box(metal, 0.10, 0.46, 0.40, -0.80, 0.23, 0));
          n.add(box(metal, 0.10, 0.46, 0.40, 0.80, 0.23, 0));
          break;
        }
        case 'washer': {
          n.add(box(metal, 0.14, 0.85, 0.14, 0, 0.42, 0));
          n.add(box(accent, 0.42, 0.36, 0.42, 0, 0.98, 0));
          break;
        }
        case 'sign': {
          n.add(box(wood, 0.11, 1.5, 0.11, 0, 0.75, 0));
          n.add(box(accent, 0.62, 0.34, 0.06, 0, 1.42, 0));
          break;
        }
        case 'bin': {
          n.add(box(dark, 0.46, 0.8, 0.46, 0, 0.4, 0));
          n.add(box(metal, 0.54, 0.08, 0.54, 0, 0.83, 0));
          break;
        }
        case 'crate': {
          n.add(box(wood, 1.1, 0.6, 0.8, 0, 0.3, 0));
          n.add(box(plank, 1.16, 0.1, 0.86, 0, 0.63, 0));
          break;
        }
        default: continue;
      }
      /* Indexed, so a cart can smash one by number. The cart body decides
         WHAT breaks (see cart.js's prop pass, which splits on props.js's own
         `solid` flag); this only has to know which node that was. */
      n.userData.propIndex = list.indexOf(p);
      this._props.set(n.userData.propIndex, n);
      g.add(n);
    }
    return g;
  }

  /**
   * Flatten a prop the cart just drove through.
   *
   * Toppled rather than deleted. A bench that vanishes is a rendering bug
   * and a bench lying on its side is a thing that happened — and it stays
   * lying there for the rest of the hole, which is the only proof anybody
   * has that the drive was worth doing.
   */
  smashProp(i) {
    const n = this._props.get(i);
    if (!n || n.userData.smashed) return;
    n.userData.smashed = true;
    /* Fall away from where the cart came from if we know, otherwise pick a
       side off the index so a row of crates does not go over in unison. */
    const dir = (i % 2 ? 1 : -1) * (0.9 + (i % 3) * 0.2);
    n.userData.fall = { t: 0, dir, from: n.rotation.z };
    this._falling.push(n);
  }

  /** Advance every prop mid-topple. Called once per frame from update. */
  _fallProps(dt) {
    if (!this._falling.length) return;
    for (let i = this._falling.length - 1; i >= 0; i--) {
      const n = this._falling[i];
      const f = n.userData.fall;
      f.t += dt * 3.4;
      // overshoot and settle, so it lands with a knock rather than easing to rest
      const k = Math.min(1, f.t);
      const over = Math.sin(k * Math.PI) * 0.18 * (1 - k);
      n.rotation.z = f.from + (Math.PI * 0.5 * f.dir) * (k * k * (3 - 2 * k)) + over * f.dir;
      n.position.y -= dt * 0.35 * (1 - k);      // sinks a little as it goes over
      if (k >= 1) this._falling.splice(i, 1);
    }
  }

  /* ------------------------------------------------------------ water --- */
  _buildWater(w, level, bio) {
    /* A GRID, not a fan.  CircleGeometry is a triangle fan with a single
       centre vertex, so a per-vertex swell moved the rim and nothing else —
       the surface stayed mirror-flat.  A subdivided plane, clipped back to a
       disc in the fragment shader, gives the wave something to move. */
    const geo = cached('water-grid', () => new THREE.PlaneGeometry(2, 2, 48, 48));
    const col = new THREE.Color(bio.palette.water);
    const sky = new THREE.Color(bio.palette.sky[0]);
    const sun = this.sunDir || { x: 0.4, y: 0.7, z: 0.5 };
    const mat = new THREE.MeshPhongMaterial({
      color: col, transparent: true, opacity: 0.9,
      shininess: 220, specular: new THREE.Color(0xcfefff),
      side: THREE.DoubleSide
    });
    /* THE `water` QUALITY LEVER, which every tier declared and nothing read.
       Everything that makes this water look like water — the swell in the
       vertex shader, the fresnel, the sun's glitter path, the foam line — is
       in the injected shader below, and all of it is per-vertex or
       per-fragment over a surface that can cover a third of the screen. So
       `water: 0` skips the injection entirely and leaves a plain translucent
       disc, which is what a machine asking for low quality wants. The waves
       stop; the pond is still a pond. */
    if (!this.q?.water) {
      mat.shininess = 60;
      return this._placeWater(new THREE.Mesh(geo, mat), w, level, mat);
    }
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = { value: 0 };
      sh.uniforms.uSky = { value: new THREE.Vector3(sky.r, sky.g, sky.b) };
      sh.uniforms.uSun = { value: new THREE.Vector3(sun.x, sun.y, sun.z) };
      mat.userData.sh = sh;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime; varying vec2 vRip; varying vec3 vWorld; varying vec2 vW;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vRip = position.xy;
          /* Waves in METRES, not in plane units.
             The swell used to be driven by the raw vertex position, which
             runs -1..1 across the pond whatever size the pond is.  A 12 m
             pool and a 60 m lake therefore got the same two-thirds of a
             wavelength from edge to edge — which is not a wave, it is a
             gentle tilt, and it is why the water read as a flat sheet of
             blue.  Sampling world XZ gives every pond the same real
             wavelength, so a big lake now carries many waves across it. */
          vW = (modelMatrix * vec4(position, 1.0)).xz;
          transformed.z += sin(vW.x*0.57 + uTime*0.9)*0.075
                         + sin(vW.y*1.05 - uTime*1.3)*0.045
                         + sin((vW.x+vW.y)*0.33 + uTime*0.55)*0.055;
          vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uTime; uniform vec3 uSky; uniform vec3 uSun;
          varying vec2 vRip; varying vec3 vWorld; varying vec2 vW;`)
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
          float rad = length(vRip);
          if (rad > 1.0) discard;              // the plane, clipped back to a pond

          // Analytic wave normal: the derivative of the same swell the vertex
          // shader applied, so the shading agrees with the geometry instead of
          // being a texture pretending to be one.
          float dhx = cos(vW.x*0.57 + uTime*0.9)*0.57*0.075
                    + cos((vW.x+vW.y)*0.33 + uTime*0.55)*0.33*0.055;
          float dhy = cos(vW.y*1.05 - uTime*1.3)*1.05*0.045
                    + cos((vW.x+vW.y)*0.33 + uTime*0.55)*0.33*0.055;
          /* Fine chop, also in metres — roughly a 1.2 m ripple.  This is what
             breaks up the mirror and gives the surface something for the sun
             to catch between the swells. */
          dhx += cos(vW.x*5.2 + uTime*2.6)*5.2*0.010
               + cos((vW.x*0.8 - vW.y*0.6)*8.7 + uTime*3.4)*8.7*0.004;
          dhy += cos(vW.y*4.6 - uTime*2.1)*4.6*0.010
               + cos((vW.x*0.6 + vW.y*0.8)*9.3 - uTime*3.1)*9.3*0.004;
          vec3 N = normalize(vec3(-dhx, 1.0, dhy));
          vec3 V = normalize(cameraPosition - vWorld);

          // Fresnel is what makes water read as water: near-transparent when
          // you look straight down into it, a bright sky mirror at a glancing
          // angle across the pond.
          float fres = pow(1.0 - clamp(dot(V, N), 0.0, 1.0), 4.0);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uSky, clamp(fres, 0.0, 0.78));

          // the sun's glitter path, tight and bright
          vec3 H = normalize(normalize(uSun) + V);
          float glint = pow(max(dot(N, H), 0.0), 420.0);
          gl_FragColor.rgb += vec3(1.0, 0.98, 0.92) * glint * 0.85;

          // depth read: dark in the middle, paler over the shallow margins
          gl_FragColor.rgb *= mix(0.68, 1.16, smoothstep(0.15, 1.0, rad));
          // a breathing foam line where the water meets the bank
          float foam = smoothstep(0.955, 0.995, rad + sin(atan(vRip.y, vRip.x)*9.0 + uTime*0.8)*0.006);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.92, 0.97, 0.98), foam * 0.6);
          // and it turns opaque as it deepens — you cannot see through a lake
          gl_FragColor.a = mix(0.99, 0.82, smoothstep(0.55, 1.0, rad));`);
    };
    return this._placeWater(new THREE.Mesh(geo, mat), w, level, mat);
  }

  /* Lie the disc down on the pond. Its own method because the low-quality
     branch above returns early and both have to land in exactly the same
     place — a pond that moved when you turned the settings down would be a
     worse bug than the one the lever fixes. `userData.mat` is what the
     animate loop reaches through for the time uniform, and it must be set
     on the plain material too or that lookup throws on a low-quality
     machine the moment a hole has water on it. */
  _placeWater(m, w, level, mat) {
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = -w.rot || 0;
    m.position.set(w.x, level, w.z);
    m.scale.set(w.rx * 1.03, w.rz * 1.03, 1);   // kiss the banks — no dry seam
    m.userData.mat = mat;
    return m;
  }

  /* ---------------------------------------------------------- horizon --- */
  /**
   * The world beyond the course.  A ring of silhouette terrain out past the
   * fog line — jagged peaks for the alpine valley, flat-topped mesas in the
   * desert, low dunes for the links, rolling forest for the parkland, island
   * humps off the cay.  One vertex-coloured mesh, one draw call, and the fog
   * does the atmospheric work for free.
   */
  _buildHorizon(hole, bio) {
    const rng = mulberry32((hole.terrainSeed ^ 0x4021ee) >>> 0);
    const b = hole.bounds;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const baseR = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.75 + 420;

    // biome character: [amplitude, jaggedness, plateau clip 0-1, colour]
    const CHAR = {
      alpine:   { amp: 420, jag: 0.9, clip: 1.0, col: '#5a6b78', snow: true },
      desert:   { amp: 210, jag: 0.5, clip: 0.55, col: '#8a5844', snow: false },
      links:    { amp: 95,  jag: 0.55, clip: 1.0, col: '#5d6b52', snow: false },
      parkland: { amp: 165, jag: 0.35, clip: 1.0, col: '#3d5a40', snow: false },
      tropical: { amp: 130, jag: 0.45, clip: 0.85, col: '#3f6b55', snow: false },
      // low, lazy, and a long way off: the sandbelt's horizon is scrub, not hills
      sandbelt: { amp: 78,  jag: 0.30, clip: 1.0, col: '#6b6a3c', snow: false },
      // a volcanic cone behind a wall of forest — high, steep, and clipped
      // flat at the top, because that is what a caldera rim looks like
      volcanic: { amp: 360, jag: 0.75, clip: 0.72, col: '#3a4438', snow: true },
      // sea cliffs: tall, jagged, almost black, and no snow this far down
      fjord:    { amp: 300, jag: 0.95, clip: 1.0, col: '#4a5158', snow: false }
    };
    const ch = CHAR[bio.id] || CHAR.parkland;

    const N = 110;
    // a looped 1D ridge profile: two octaves of value noise around the circle
    const knots = 12;
    const k1 = Array.from({ length: knots }, () => rng());
    const k2 = Array.from({ length: knots * 3 }, () => rng());
    const prof = t => {
      const f = (arr, reps) => {
        const x = t * reps * arr.length / arr.length % 1 * arr.length;
        const i = Math.floor(t * reps * arr.length) % arr.length;
        const u = (t * reps * arr.length) % 1;
        const s = u * u * (3 - 2 * u);
        return arr[i] * (1 - s) + arr[(i + 1) % arr.length] * s;
      };
      return f(k1, 1) * (1 - ch.jag * 0.4) + f(k2, 1) * ch.jag * 0.6;
    };

    const pos = [], col = [], idx = [];
    const base = new THREE.Color(ch.col);
    const dark = base.clone().multiplyScalar(0.55);
    const snowC = new THREE.Color('#e8eef2');
    /* THREE bands, not two.
       -------------------------------------------------------------------
       The ridge was one flat colour from the ground to the skyline: the
       largest single area in a lot of shots, and completely empty. Real
       distant land is banded — dark wooded lower slopes, lighter open
       ground above, and the top edge washed out by the air in between.

       A third row of vertices gives all of that for the cost of one more
       triangle strip: a `treed` colour at the foot, the biome's own colour
       through the middle, and the skyline lifted toward the haze so the
       silhouette does not cut into the sky like a sheet of card. A treeline
       band only appears where the biome actually HAS trees — Grimsvik and
       the links get bare rock, as they should. */
    const wooded = (bio.treeDensity ?? 0) > 0.25;
    const treed = base.clone().lerp(new THREE.Color(bio.palette.deep), wooded ? 0.62 : 0.18)
      .multiplyScalar(0.82);
    /* Only a touch toward the haze. Scene fog is already washing the ridge
       by about two-thirds at this distance, and lerping the vertex colour as
       well hazed it twice — the skyline came out almost the colour of the
       sky and the silhouette disappeared entirely. */
    const skyward = base.clone().lerp(new THREE.Color(bio.palette.fog), 0.15);
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const a = t * Math.PI * 2;
      const r = baseR * (1 + prof((t + 0.37) % 1) * 0.25);
      let h = Math.min(prof(t), ch.clip) * ch.amp + 8;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      // the skirt runs well below ground so the ridge never floats above a
      // slot of sky, whatever the land in front of it is doing
      pos.push(x, -140, z);  col.push(dark.r, dark.g, dark.b);
      // the treeline, at a wobbling fraction of this column's height so the
      // band is not a ruled line round the whole horizon
      const tl = h * (0.30 + prof((t + 0.61) % 1) * 0.22);
      pos.push(x, tl, z);   col.push(treed.r, treed.g, treed.b);
      // snowline on the alpine ridge, otherwise washed toward the haze
      const top = ch.snow && h > ch.amp * 0.62 ? snowC : skyward;
      pos.push(x, h, z);    col.push(top.r, top.g, top.b);
    }
    for (let i = 0; i < N; i++) {
      const a = i * 3, b1 = a + 1, c1 = a + 2;
      const d = a + 3, e = a + 4, f = a + 5;
      idx.push(a, d, b1, b1, d, e);          // skirt -> treeline
      idx.push(b1, e, c1, c1, e, f);         // treeline -> skyline
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide
    }));
    mesh.renderOrder = -0.5;              // behind everything but the sky
    return mesh;
  }

  /* ----------------------------------------------------------- clouds --- */
  /**
   * A dozen low-poly clouds drifting slowly with the wind.  Each cloud is
   * three squashed icosahedra; the whole sky is ONE InstancedMesh, so it
   * costs a single draw call.  Seeded from the hole, like everything else.
   */
  _buildClouds(hole, bio) {
    const rng = mulberry32((hole.terrainSeed ^ 0xc10d) >>> 0);
    const density = bio.cloudDensity ?? 1;
    // ten clouds across a whole sky is two in frame at any time, which
    // reads as an empty gradient with a couple of stickers on it
    const count = Math.round(24 * density);
    if (!count) return null;

    const geo = cached('cloud-puff', () => new THREE.IcosahedronGeometry(1, 0));
    // Self-lit: a cloud is lit by the whole sky, not by our one sun, and
    // Lambert-shaded puffs come out looking like grey boulders.
    const mat = new THREE.MeshBasicMaterial({
      color: 0xf7fafc, fog: false, transparent: true, opacity: 0.88
    });
    const inst = new THREE.InstancedMesh(geo, mat, count * 3);
    inst.frustumCulled = false;              // they wrap around the whole sky
    const b = hole.bounds;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), eul = new THREE.Euler();
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const drift = [];
    let k = 0;
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      const r = 470 + rng() * 640;      // never close enough to loom
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const y = 230 + rng() * 150;
      const s = 22 + rng() * 34;
      for (let p = 0; p < 3; p++) {
        const off = p === 0 ? 0 : (p === 1 ? -0.75 : 0.72);
        pos.set(x + off * s + (rng() - 0.5) * 8, y + (p ? -s * 0.16 : 0), z + (rng() - 0.5) * s * 0.5);
        scl.set(s * (p ? 0.62 : 1), s * (p ? 0.34 : 0.45), s * (p ? 0.55 : 0.8));
        eul.set(0, rng() * Math.PI, 0);
        q.setFromEuler(eul);
        m4.compose(pos, q, scl);
        inst.setMatrixAt(k, m4);
        drift.push({ i: k, baseX: pos.x, z: pos.z, y: pos.y, sx: scl.x, sy: scl.y, sz: scl.z, ry: eul.y, speed: 0.9 + rng() * 1.4 });
        k++;
      }
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.userData.drift = drift;
    inst.userData.span = (b.maxX - b.minX) / 2 + 950;
    inst.userData.cx = cx;
    return inst;
  }

  /* ---------------------------------------------------------- foliage --- */
  /**
   * Dress the hole: bushes with blooms, grass tufts, rocks and water reeds,
   * chosen per biome so a parkland hole reads like Georgia in April and a
   * links hole like a Scottish shoreline.
   *
   * All of it is DECORATION — none of it exists on the server and none of it
   * touches physics, which is why it can be generated client-side.  It is
   * still seeded from the hole, so every player sees the identical scenery.
   * Each decoration kind is one InstancedMesh: the whole dressing layer
   * costs six to nine draw calls however dense it looks.
   */
  _buildFoliage(hole, T, bio) {
    const rng = mulberry32((hole.terrainSeed ^ 0xf011a6e) >>> 0);
    const rf = (a, b) => a + rng() * (b - a);
    const b = hole.bounds;

    /* What grows where.  [kind, colours, count, sizes, surfaces]

       Counts are roughly double what they were. The whole dressing layer is
       six to nine instanced draw calls however dense it looks, so the cost of
       "more" here is memory rather than frames — and the thing that made the
       courses read as unfinished was empty ground between the fairway and the
       trees. Grass tufts take the biggest jump because they are the cheapest
       thing in the scene and the one the eye reads as ground cover. */
    const P = {
      parkland: {
        bush: { c: ['#2e6b33', '#39793b'], n: 209, s: [0.7, 1.5] },
        bloom: { c: ['#e86fa4', '#f2f2ee', '#d4548a'], per: 4 },
        tuft: { c: ['#4d8a3d', '#5f9c48'], n: 650, s: [0.35, 0.7] },
        rock: { c: ['#8d8a82'], n: 20, s: [0.4, 0.9] },
        reed: { c: ['#5d8f4a'], ring: 26 }
      },
      links: {
        bush: { c: ['#6d6b3f', '#7c7a48'], n: 101, s: [0.5, 1.1] },     // heather-gorse scrub
        bloom: { c: ['#b088c9', '#caa3de'], per: 3 },                  // heather purple
        tuft: { c: ['#a89c58', '#8f8f4e', '#b3a763'], n: 936, s: [0.4, 0.9] },  // marram
        rock: { c: ['#7d7f82', '#6e7073'], n: 52, s: [0.5, 1.4] },
        reed: { c: ['#9a915a'], ring: 20 }
      },
      desert: {
        bush: { c: ['#5d7042', '#6c7f4a'], n: 74, s: [0.5, 1.0] },     // sage scrub
        bloom: { c: ['#e8c25a'], per: 2 },                             // brittlebush yellow
        tuft: { c: ['#98915c', '#a89a62'], n: 364, s: [0.35, 0.8] },   // dry bunchgrass
        rock: { c: ['#a4674a', '#8f5a41', '#b0755a'], n: 88, s: [0.6, 2.0] },  // red rock
        reed: null                                                     // nothing grows by nothing
      },
      alpine: {
        bush: { c: ['#2f5e35', '#3a6b3e'], n: 114, s: [0.5, 1.1] },
        bloom: { c: ['#f2f0e6', '#e8c25a', '#7f9fd4'], per: 3 },       // wildflowers
        tuft: { c: ['#43803c', '#549147'], n: 728, s: [0.35, 0.75] },
        rock: { c: ['#8f9296', '#7b7f84'], n: 76, s: [0.6, 2.2] },     // granite
        reed: { c: ['#4d7a45'], ring: 18 }
      },
      tropical: {
        bush: { c: ['#1f7a3d', '#2a8a46'], n: 140, s: [0.7, 1.5] },
        bloom: { c: ['#e8452f', '#f2803d', '#e8377f'], per: 4 },       // hibiscus
        tuft: { c: ['#2f9448', '#3aa653'], n: 702, s: [0.4, 0.9] },
        rock: { c: ['#b3a48c', '#c2b49b'], n: 32, s: [0.4, 1.0] },     // coral stone
        reed: { c: ['#3f8a4a'], ring: 30 }
      },
      sandbelt: {
        bush: { c: ['#6f7a42', '#7d8a4c'], n: 127, s: [0.6, 1.4] },     // tea-tree
        bloom: { c: ['#e8d05a', '#f0e08a'], per: 3 },                  // wattle
        tuft: { c: ['#a39a56', '#8f8a4a', '#b0a862'], n: 858, s: [0.4, 0.95] },
        rock: { c: ['#9c8f76'], n: 24, s: [0.4, 0.9] },
        reed: { c: ['#8a8a4e'], ring: 16 }
      },
      volcanic: {
        bush: { c: ['#1f5230', '#286338'], n: 242, s: [0.6, 1.4] },    // dense understory
        bloom: { c: ['#e8879f', '#f0b3c4'], per: 5 },                  // azalea
        tuft: { c: ['#357a3c', '#428c47'], n: 832, s: [0.35, 0.8] },
        rock: { c: ['#43403c', '#35322e', '#4f4b46'], n: 104, s: [0.5, 1.8] }, // basalt
        reed: { c: ['#2f6b38'], ring: 24 }
      },
      fjord: {
        bush: { c: ['#4f6338', '#5d7042'], n: 66, s: [0.4, 0.9] },     // crowberry
        bloom: { c: ['#f0f0e8', '#d8c9e0'], per: 2 },                  // cottongrass
        tuft: { c: ['#7d8a52', '#6b7847'], n: 780, s: [0.35, 0.8] },
        rock: { c: ['#4a4d52', '#3d4045', '#585c62'], n: 156, s: [0.6, 2.6] }, // black basalt
        reed: null                                                     // nothing stands in this wind
      }
    }[bio.id] || null;
    if (!P) return [];

    // where a decoration may stand: the rough bands, never the playing lanes
    const spots = (n, sizes, kinds) => {
      const out = [];
      let guard = 0;
      while (out.length < n && guard++ < n * 30) {
        const x = rf(b.minX + 4, b.maxX - 4), z = rf(b.minZ + 4, b.maxZ - 4);
        const id = T.surfaceAt(x, z).id;
        if (!kinds.includes(id)) continue;
        if (T.waterAt(x, z) !== null) continue;
        out.push({ x, z, s: rf(sizes[0], sizes[1]), rot: rf(0, Math.PI * 2), tone: rng() });
      }
      return out;
    };

    const meshes = [];
    const put = (list, geo, baseHex, opts = {}) => {
      if (!list.length) return null;
      const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      inst.frustumCulled = true;
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), eul = new THREE.Euler();
      const pos = new THREE.Vector3(), scl = new THREE.Vector3(), col = new THREE.Color();
      for (let i = 0; i < list.length; i++) {
        const d = list[i];
        pos.set(d.x, T.heightAt(d.x, d.z) + (opts.sink ?? 0) * d.s, d.z);
        scl.set(d.s * (opts.sx ?? 1), d.s * (opts.sy ?? 1), d.s * (opts.sz ?? 1));
        eul.set(opts.tilt ? (d.tone - 0.5) * opts.tilt : 0, d.rot, 0);
        q.setFromEuler(eul);
        m4.compose(pos, q, scl);
        inst.setMatrixAt(i, m4);
        col.set(d.hex || baseHex).offsetHSL(0, (d.tone - 0.5) * 0.08, (d.tone - 0.5) * 0.10);
        inst.setColorAt(i, col);
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.castShadow = !!this.q?.shadows;
      meshes.push(inst);
      return inst;
    };
    const pick = arr => arr[(rng() * arr.length) | 0];

    /* bushes: squashed icosahedra, sunk so they sit in the grass */
    const bushGeo = cached('fol-bush', () => new THREE.IcosahedronGeometry(1, 1));
    const bushes = spots(P.bush.n, P.bush.s, ['rough', 'deep', 'waste']);
    for (const d of bushes) d.hex = pick(P.bush.c);
    put(bushes, bushGeo, P.bush.c[0], { sy: 0.72, sink: 0.10 });

    /* blooms: little tetrahedra scattered over the top of each bush */
    if (P.bloom) {
      const bloomGeo = cached('fol-bloom', () => new THREE.TetrahedronGeometry(1, 0));
      const blooms = [];
      for (const d of bushes) {
        if (d.tone < 0.30) continue;              // some bushes stay plain
        for (let k = 0; k < P.bloom.per; k++) {
          const a = rng() * Math.PI * 2, r = rng() * d.s * 0.75;
          blooms.push({
            x: d.x + Math.cos(a) * r, z: d.z + Math.sin(a) * r,
            s: 0.10 + rng() * 0.09, rot: rng() * Math.PI,
            tone: rng(), hex: pick(P.bloom.c),
            lift: 0.58 * d.s
          });
        }
      }
      // blooms ride at bush height, so place with their own y
      if (blooms.length) {
        const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
        const inst = new THREE.InstancedMesh(bloomGeo, mat, blooms.length);
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), eul = new THREE.Euler();
        const pos = new THREE.Vector3(), scl = new THREE.Vector3(), col = new THREE.Color();
        for (let i = 0; i < blooms.length; i++) {
          const d = blooms[i];
          pos.set(d.x, T.heightAt(d.x, d.z) + d.lift, d.z);
          scl.setScalar(d.s);
          eul.set(d.tone * 2, d.rot, d.tone);
          q.setFromEuler(eul);
          m4.compose(pos, q, scl);
          inst.setMatrixAt(i, m4);
          col.set(d.hex);
          inst.setColorAt(i, col);
        }
        inst.instanceMatrix.needsUpdate = true;
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
        meshes.push(inst);
      }
    }

    /* grass tufts: low cones, the cheapest possible "this is rough" signal */
    const tuftGeo = cached('fol-tuft' + (this.q?.detail ?? 1),
      () => new THREE.ConeGeometry(1, 1, seg(this.q, 7)));
    const tufts = spots(P.tuft.n, P.tuft.s, ['rough', 'deep', 'waste']);
    for (const d of tufts) d.hex = pick(P.tuft.c);
    put(tufts, tuftGeo, P.tuft.c[0], { sy: 1.6, tilt: 0.5, sink: 0.35 });

    /* rocks: flattened dodecahedra half-buried in the ground */
    const rockGeo = cached('fol-rock', () => new THREE.DodecahedronGeometry(1, 0));
    const rocks = spots(P.rock.n, P.rock.s, ['deep', 'waste', 'rough']);
    for (const d of rocks) d.hex = pick(P.rock.c);
    put(rocks, rockGeo, P.rock.c[0], { sy: 0.55, sink: -0.18, tilt: 0.6 });

    /* reeds: rings of tall thin cones hugging each water line */
    if (P.reed && hole.waters.length) {
      const reeds = [];
      for (const w of hole.waters) {
        for (let i = 0; i < P.reed.ring; i++) {
          const a = rng() * Math.PI * 2;
          const rr = 1.04 + rng() * 0.10;         // just outside the bank
          const ca = Math.cos(w.rot || 0), sa = Math.sin(w.rot || 0);
          const ex = Math.cos(a) * w.rx * rr, ez = Math.sin(a) * w.rz * rr;
          const x = w.x + ex * ca - ez * sa, z = w.z + ex * sa + ez * ca;
          if (T.waterAt(x, z) !== null) continue;                    // never in the drink
          const id = T.surfaceAt(x, z).id;
          if (id === 'green' || id === 'tee' || id === 'sand') continue;
          reeds.push({ x, z, s: 0.5 + rng() * 0.6, rot: rng() * Math.PI, tone: rng(), hex: P.reed.c[0] });
        }
      }
      put(reeds, tuftGeo, P.reed.c[0], { sx: 0.16, sy: 2.6, sz: 0.16, tilt: 0.7, sink: 0.2 });
    }

    return meshes;
  }

  /**
   * A soft dark disc under every tree — one instanced draw call for the whole
   * forest.  This is the cheapest trick in the book and the one that makes
   * the biggest difference: without a contact shadow, trees float.
   */
  _buildTreeShadows(hole, T) {
    if (!hole.trees.length) return null;
    const geo = cached('tree-blob', () => new THREE.CircleGeometry(1, 16));
    const mat = new THREE.MeshBasicMaterial({
      map: sharedBlobTexture(), transparent: true, depthWrite: false, opacity: 0.5
    });
    const inst = new THREE.InstancedMesh(geo, mat, hole.trees.length);
    inst.renderOrder = 1;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    q.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    for (let i = 0; i < hole.trees.length; i++) {
      const t = hole.trees[i];
      const r = Math.max(1.1, t.r * (t.species === 'palm' ? 3.2 : 1.15));
      pos.set(t.x, T.heightAt(t.x, t.z) + 0.05, t.z);
      scl.set(r, r, 1);
      m4.compose(pos, q, scl);
      inst.setMatrixAt(i, m4);
    }
    inst.instanceMatrix.needsUpdate = true;
    return inst;
  }

  /* ------------------------------------------------------------ trees --- */
  _buildTrees(hole, T, bio) {
    const bySpecies = new Map();
    for (const t of hole.trees) {
      if (!bySpecies.has(t.species)) bySpecies.set(t.species, []);
      bySpecies.get(t.species).push(t);
    }
    const meshes = [];
    for (const [species, list] of bySpecies) {
      const parts = normaliseCanopy(species, treeParts(species, bio, this.q?.detail ?? 1));
      for (const part of parts) {
        // Per-instance colour MULTIPLIES the material colour, so the material
        // has to be white or every tree comes out as its own colour squared —
        // which turns a mid-green cactus almost black.
        part.mat.color.setRGB(1, 1, 1);
        const inst = new THREE.InstancedMesh(part.geo, part.mat, list.length);
        inst.frustumCulled = true;
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), eul = new THREE.Euler();
        const pos = new THREE.Vector3(), scl = new THREE.Vector3();
        const col = new THREE.Color();
        for (let i = 0; i < list.length; i++) {
          const t = list[i];
          const y = T.heightAt(t.x, t.z);
          const s = t.h;
          // the part's offset is defined in the tree's own frame, so spin it
          // with the tree — otherwise every palm's fronds point the same way
          const ca = Math.cos(t.rot), sa = Math.sin(t.rot);
          const ox = part.off[0] * s, oz = part.off[2] * s;
          pos.set(t.x + ox * ca + oz * sa, y + part.off[1] * s, t.z - ox * sa + oz * ca);
          scl.set(part.scale[0] * s, part.scale[1] * s, part.scale[2] * s);
          eul.set(part.tilt || 0, t.rot + (part.rotY || 0), part.tiltZ || 0);
          q.setFromEuler(eul);
          m4.compose(pos, q, scl);
          inst.setMatrixAt(i, m4);
          col.copy(part.color).offsetHSL(0, (t.tone - 0.5) * 0.06, (t.tone - 0.5) * 0.11);
          if (SEASON_TINT) {
            col.r = Math.min(1, col.r * SEASON_TINT[0]);
            col.g = Math.min(1, col.g * SEASON_TINT[1]);
            col.b = Math.min(1, col.b * SEASON_TINT[2]);
          }
          inst.setColorAt(i, col);
        }
        inst.instanceMatrix.needsUpdate = true;
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
        inst.castShadow = true;
        inst.receiveShadow = part.receives !== false;
        meshes.push(inst);
      }
    }
    return meshes;
  }

  /* -------------------------------------------------------------- pin --- */
  /** A distinct flag design per hole: same hole always gets the same
   *  flag (hashed from course id + hole number, not random), and
   *  different holes almost always get a different one. Caches by
   *  key so revisiting a hole (leaderboard replay, spectating) reuses
   *  the texture instead of rebuilding a canvas every time. */
  _flagTexture(number, courseId) {
    const key = `${courseId}:${number}`;
    this._flagTexCache ??= new Map();
    if (this._flagTexCache.has(key)) return this._flagTexCache.get(key);

    let h = 2166136261;
    for (let i = 0; i < courseId.length; i++) h = ((h ^ courseId.charCodeAt(i)) * 16777619) >>> 0;
    h = ((h ^ number) * 16777619) >>> 0;
    const rk = mulberry32(h);

    const PALETTE = [0xe8443a, 0x3a6de8, 0xe8b83a, 0xffffff, 0xe87a3a, 0x9a3ae8, 0x2ab8a6, 0xe83a9e];
    const hex = (n) => '#' + n.toString(16).padStart(6, '0');
    const bg = PALETTE[Math.floor(rk() * PALETTE.length)];

    const W = 128, H = 84, cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = hex(bg); g.fillRect(0, 0, W, H);

    // a second stripe so two holes that land on the same base colour
    // (there are more holes than colours) still read as visually distinct
    if (rk() < 0.55) {
      g.fillStyle = hex(PALETTE[Math.floor(rk() * PALETTE.length)]);
      g.fillRect(0, 0, W, H * 0.3);
    }

    /* White-on-black outline so the number reads on every palette colour
       without a per-background contrast decision — including white
       itself, which is one of the palette entries. A translucent stroke
       reads as a mid-grey hairline against a white flag, at which point
       a near-white fill on a white background is just gone; the stroke
       has to be fully opaque to actually function as a border there. */
    g.font = 'bold 56px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 8;
    g.strokeStyle = '#14120e';
    g.strokeText(String(number), W / 2, H / 2 + 4);
    g.fillStyle = '#fbfbf6';
    g.fillText(String(number), W / 2, H / 2 + 4);

    const tex = new THREE.CanvasTexture(cv);
    tex.userData.shared = true;
    this._flagTexCache.set(key, tex);
    return tex;
  }

  _buildPin(hole, T, bio) {
    const grp = new THREE.Group();
    const y = this._meshHeightAt(T, hole, hole.pin.x, hole.pin.z);

    // the cup: a dark cylinder sunk into the green, plus a white liner ring.
    // Never LOD/cull this group — it's the target, and it must read from the
    // tee at every distance. A misjudged auto bounding sphere on the thin
    // flagstick is exactly the kind of thing that produces "the hole is
    // sometimes just missing" with no other symptom to explain it.
    const cupGeo = new THREE.CylinderGeometry(hole.cup.r, hole.cup.r, 0.32, 20, 1, true);
    const cup = new THREE.Mesh(cupGeo, new THREE.MeshBasicMaterial({ color: 0x0a0f07, side: THREE.BackSide }));
    cup.position.set(hole.cup.x, y - 0.16 + 0.005, hole.cup.z);
    cup.frustumCulled = false;
    grp.add(cup);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(hole.cup.r * 0.92, hole.cup.r * 1.06, 24),
      new THREE.MeshBasicMaterial({ color: 0xeef4ea, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(hole.cup.x, y + 0.012, hole.cup.z);
    ring.frustumCulled = false;
    grp.add(ring);

    // flagstick
    const stick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, 2.13, seg(this.q, 8)),
      new THREE.MeshLambertMaterial({ color: 0xf2f2ee })
    );
    stick.position.set(hole.pin.x, y + 1.065, hole.pin.z);
    stick.castShadow = true;
    stick.frustumCulled = false;
    grp.add(stick);

    /* flag — a small plane we ripple and swing with the wind in update().
       The geometry is translated so its OWN local origin sits at the
       pole-attached edge rather than the plane's visual centre. That one
       line is what keeps the flag on the pole: rotation.y below turns the
       mesh around its local origin, and rotating around anything other
       than the pole itself swings the attached edge away from it the
       moment the wind isn't dead calm — which it almost never is. */
    const flagGeo = new THREE.PlaneGeometry(0.52, 0.34, 12, 4);
    flagGeo.translate(0.26, 0, 0);
    const flagMat = new THREE.MeshLambertMaterial({
      map: this._flagTexture(hole.number, hole.courseId),
      side: THREE.DoubleSide
    });
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.set(hole.pin.x, y + 1.92, hole.pin.z);
    flag.frustumCulled = false;
    grp.add(flag);
    this.flag = flag;
    this.flagBase = new THREE.Vector3(hole.pin.x, y + 1.92, hole.pin.z);

    this.pinY = y;
    return grp;
  }

  _buildTeeMarkers(hole, T, bio) {
    const grp = new THREE.Group();
    // low discs either side of the tee, set back so they frame the ball rather
    // than sit in the shot line
    const geo = new THREE.CylinderGeometry(0.085, 0.10, 0.11, seg(this.q, 10));
    for (const [off, hex] of [[-2.0, 0xf0f2f0], [2.0, 0xe03b3b]]) {
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: hex }));
      const x = hole.tee.x + Math.cos(hole.tee.rot) * off - Math.sin(hole.tee.rot) * 0.5;
      const z = hole.tee.z - Math.sin(hole.tee.rot) * off - Math.cos(hole.tee.rot) * 0.5;
      m.position.set(x, T.heightAt(x, z) + 0.055, z);
      grp.add(m);
    }
    return grp;
  }

  /* --------------------------------------------------------- aim aids --- */
  _buildAimLine() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 3), 3));
    // Bright and solid, drawn over everything.  At 55% opacity against a lit
    // green this washed out to nothing in sunlight — and the read line is the
    // one piece of information a putt depends on.
    const mat = new THREE.LineDashedMaterial({
      color: 0xffffff, dashSize: 1.6, gapSize: 1.1, transparent: true, opacity: 0.95,
      depthTest: false, toneMapped: false
    });
    const l = new THREE.Line(geo, mat);
    l.renderOrder = 6;
    l.visible = false;
    l.frustumCulled = false;
    return l;
  }

  _buildTrace() {
    /* Named together deliberately: the held line only reads as history if it
       is clearly fainter than the live one, which is a relationship between
       two numbers and not a property of either. */
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(1200 * 3), 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true,
                                             opacity: TRACE_LIVE_OPACITY });
    const l = new THREE.Line(geo, mat);
    l.frustumCulled = false;
    return l;
  }

  setAimLine(points, thick = false) {
    const l = this.aimLine;
    if (!points || points.length < 2) {
      l.visible = false;
      if (this._readRibbon) this._readRibbon.visible = false;
      return;
    }
    // On the green the read is drawn as a RIBBON with real width in metres.
    // A THREE.Line is one pixel on every platform that matters, and one white
    // pixel over a sunlit green is not a line you can putt to.
    if (thick) { l.visible = false; this._setReadRibbon(points); return; }
    if (this._readRibbon) this._readRibbon.visible = false;

    const arr = l.geometry.attributes.position.array;
    const n = Math.min(points.length, 64);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = points[i].x; arr[i * 3 + 1] = points[i].y; arr[i * 3 + 2] = points[i].z;
    }
    l.geometry.setDrawRange(0, n);
    l.geometry.attributes.position.needsUpdate = true;
    l.computeLineDistances();
    l.visible = true;
  }

  /** The putt read: a wide, bright band laid on the green along the path. */
  _setReadRibbon(points) {
    const MAX = 96;                       // path points the ribbon can carry
    if (!this._readRibbon) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 2 * 3), 3));
      const idx = [];
      for (let i = 0; i < MAX - 1; i++) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      geo.setIndex(idx);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 1.0,
        depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false
      });
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 7;
      m.frustumCulled = false;
      this._readRibbon = m;
      this.scene.add(m);                  // persistent, like the other aids
    }
    const m = this._readRibbon;
    const n = Math.min(points.length, MAX);
    const arr = m.geometry.attributes.position.array;
    /* Thin and DASHED, but still measured in metres rather than pixels.
       A one-pixel THREE.Line disappears against a sunlit green, so the read
       keeps real width — just 5 cm of it, about a ball and a half, broken
       into dashes so it reads as a light guide rather than a painted stripe.
       Gap segments collapse both edges onto the centre line, which makes them
       degenerate triangles: no pixels, no extra draw call, no index rebuild. */
    const HALF = 0.025;                   // 5 cm wide
    const ON = 3, PERIOD = 5;             // three samples drawn, two skipped
    for (let i = 0; i < n; i++) {
      const p = points[i];
      const q = points[Math.min(i + 1, n - 1)];
      let dx = q.x - p.x, dz = q.z - p.z;
      const len = Math.hypot(dx, dz) || 1;
      // perpendicular, in the ground plane
      const gap = (i % PERIOD) >= ON;
      const w = gap ? 0 : HALF;
      const nx = -dz / len * w, nz = dx / len * w;
      const a = i * 2 * 3;
      arr[a] = p.x - nx; arr[a + 1] = p.y; arr[a + 2] = p.z - nz;
      arr[a + 3] = p.x + nx; arr[a + 4] = p.y; arr[a + 5] = p.z + nz;
    }
    m.geometry.setDrawRange(0, Math.max(0, (n - 1) * 6));
    m.geometry.attributes.position.needsUpdate = true;
    m.visible = true;
  }

  /**
   * The landing marker: a ring on the ground where the CURRENT swing would
   * finish the ball.  It slides out as the player pulls the club back and
   * bends sideways when the strike is opening or closing the face — power
   * first, then shape, exactly the way the shot itself works.
   */
  setLanding(x, y, z, quality) {
    if (!this._landing) {
      const g = new THREE.RingGeometry(0.55, 0.85, 22);
      g.userData.shared = true;
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false
      }));
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 2;
      const dotG = new THREE.CircleGeometry(0.16, 14);
      dotG.userData.shared = true;
      const dot = new THREE.Mesh(dotG, m.material);
      dot.rotation.x = -Math.PI / 2;
      dot.position.y = 0.01;
      m.add(dot);
      this._landing = m;
      this.scene.add(m);          // persistent — never dies with a hole
    }
    const L = this._landing;
    if (x == null) { L.visible = false; return; }
    L.position.set(x, y + 0.06, z);
    // white = pure, amber = a bit of shape, red = full hook or slice
    const q = Math.min(1, Math.max(0, quality ?? 0));
    L.material.color.setRGB(1, 1 - q * 0.65, 1 - q * 0.9);
    L.visible = true;
  }

  /**
   * The green, read like a caddie's book: light is high ground, dark is low,
   * with contour lines every band.  Built once per hole from the same
   * heightAt() the ball rolls on, draped over the actual green surface, and
   * shown only while the putter is in hand.
   */
  setGreenRead(on) {
    if (!on) { if (this._read) this._read.visible = false; return; }
    const hole = this.hole, T = this.T;
    if (!hole) return;
    const key = hole.number + ':' + (hole.terrainSeed || 0);
    if (this._read && this._readKey === key) { this._read.visible = true; return; }
    if (this._read) { this._read.geometry.dispose(); this._read.material.map?.dispose(); this._read.material.dispose(); this.scene.remove(this._read); }

    const g = hole.green;
    const RX = g.rx + 1.5, RZ = g.rz + 1.5;

    /* paint the elevation bands */
    const S = 256;
    const cv = document.createElement('canvas'); cv.width = cv.height = S;
    const ctx2 = cv.getContext('2d');
    const img = ctx2.createImageData(S, S);
    const hs = new Float32Array(S * S);
    let lo = Infinity, hi = -Infinity;
    const ca = Math.cos(g.rot || 0), sa = Math.sin(g.rot || 0);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const u = (i / (S - 1)) * 2 - 1, v = (j / (S - 1)) * 2 - 1;
      const ex = u * RX, ez = v * RZ;
      const x = g.x + ex * ca - ez * sa, z = g.z + ex * sa + ez * ca;
      const h = T.heightAt(x, z);
      hs[j * S + i] = h;
      if (u * u + v * v <= 1) { if (h < lo) lo = h; if (h > hi) hi = h; }
    }
    const range = Math.max(0.05, hi - lo);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const u = (i / (S - 1)) * 2 - 1, v = (j / (S - 1)) * 2 - 1;
      const r2 = u * u + v * v;
      const k = (j * S + i) * 4;
      if (r2 > 1) { img.data[k + 3] = 0; continue; }
      const t = (hs[j * S + i] - lo) / range;              // 0 low -> 1 high
      // bands: warm light on the high side, cool dark in the hollows
      img.data[k] = 60 + t * 195;
      img.data[k + 1] = 70 + t * 175;
      img.data[k + 2] = 90 + t * 115;
      // contour lines every sixth of the range
      const c6 = (t * 6) % 1;
      const line = c6 < 0.06 || c6 > 0.94 ? 90 : 0;
      img.data[k] = Math.max(0, img.data[k] - line);
      img.data[k + 1] = Math.max(0, img.data[k + 1] - line);
      img.data[k + 2] = Math.max(0, img.data[k + 2] - line * 0.6);
      // fade at the rim so it sits ON the green rather than stamping it
      img.data[k + 3] = Math.round(150 * Math.min(1, (1 - Math.sqrt(r2)) * 5));
    }
    ctx2.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;

    /* drape it over the actual green surface */
    const N = 26;
    const geo = new THREE.PlaneGeometry(2, 2, N, N);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i), v = pos.getY(i);
      const ex = u * RX, ez = v * RZ;
      const x = g.x + ex * ca - ez * sa, z = g.z + ex * sa + ez * ca;
      pos.setXYZ(i, x, T.heightAt(x, z) + 0.055, z);
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false
    }));
    mesh.renderOrder = 1;
    this._read = mesh;
    this._readKey = key;
    this.scene.add(mesh);          // persistent scene: rebuilt per hole by key
  }

  /** A soft additive glow that rides the ball in flight — broadcast tracer. */
  setBallGlow(x, y, z, hex) {
    if (x == null) { if (this._glow) this._glow.visible = false; return; }
    if (!this._glow) {
      // a WHITE radial — the blob shadow texture is black, and additive
      // black is nothing at all
      const S = 64, c = document.createElement('canvas');
      c.width = c.height = S;
      const g2 = c.getContext('2d');
      const grd = g2.createRadialGradient(S/2, S/2, 1, S/2, S/2, S/2);
      grd.addColorStop(0, 'rgba(255,255,255,0.9)');
      grd.addColorStop(0.4, 'rgba(255,255,255,0.35)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g2.fillStyle = grd; g2.fillRect(0, 0, S, S);
      const tex = new THREE.CanvasTexture(c);
      tex.userData.shared = true;
      const m = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, color: 0xffffff,
        blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85
      }));
      m.scale.set(1.6, 1.6, 1);
      this._glow = m;
      this.scene.add(m);
    }
    this._glow.visible = true;
    this._glow.position.set(x, y, z);
    if (hex) this._glow.material.color.set(hex);
  }

  /** Tint the shot tracer to the player whose ball is flying. */
  setTraceColor(hex) {
    if (this.traceLine) this.traceLine.material.color.set(hex || '#ffffff');
  }

  /** Tint the preview line — the putt read runs green / amber / red. */
  setAimLineColor(hex) {
    if (this.aimLine) this.aimLine.material.color.set(hex);
    if (this._readRibbon) this._readRibbon.material.color.set(hex);
  }

  /**
   * The slope read at the ball while putting: a short fall-line arrow on the
   * turf pointing DOWNhill, stretched by how hard the green is leaning.
   * One reused mesh; pass null to hide it.
   */
  setSlopeRead(x, z, T) {
    if (x == null) { if (this._slope) this._slope.visible = false; return; }
    if (!this._slope) {
      const g = new THREE.Group();
      const shaftGeo = cached('slope-shaft', () => new THREE.BoxGeometry(0.09, 0.02, 1));
      const tipGeo = cached('slope-tip', () => new THREE.ConeGeometry(0.14, 0.34, 4));
      const mat = new THREE.MeshBasicMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.85, depthWrite: false });
      const shaft = new THREE.Mesh(shaftGeo, mat);
      shaft.position.z = 0.5;
      const tip = new THREE.Mesh(tipGeo, mat);
      tip.rotation.x = Math.PI / 2;
      tip.rotation.y = Math.PI / 4;
      tip.position.z = 1.1;
      g.add(shaft, tip);
      g.renderOrder = 2;
      this._slope = g;
      this.scene.add(g);
    }
    const n = T.normalAt(x, z, 1.6);
    const grade = Math.hypot(n[0], n[2]);
    if (grade < 0.008) { this._slope.visible = false; return; }   // dead flat: no read
    this._slope.visible = true;
    // the fall line: gravity's component in the plane, which is (nx, nz)
    this._slope.position.set(x, T.heightAt(x, z) + 0.10, z);
    this._slope.rotation.y = Math.atan2(n[0], n[2]);
    const s = Math.min(2.2, 0.7 + grade * 26);
    this._slope.scale.set(1, 1, s);
  }

  setTrace(path, upTo) {
    const l = this.traceLine;
    /* Back to the LIVE opacity, which is 0.45 and not 1. Restoring to full
       brightness quietly changed how every shot in the game looked — the
       tracer was designed translucent, and "reset it to opaque" is not a
       reset, it is a different decision made by accident. */
    if (l.material && l.material.opacity !== TRACE_LIVE_OPACITY) {
      l.material.opacity = TRACE_LIVE_OPACITY;
    }
    if (!path || path.length < 2) { l.geometry.setDrawRange(0, 0); return; }
    const arr = l.geometry.attributes.position.array;
    const n = Math.min(upTo == null ? path.length : upTo, 1200);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = path[i].x; arr[i * 3 + 1] = path[i].y; arr[i * 3 + 2] = path[i].z;
    }
    l.geometry.setDrawRange(0, n);
    l.geometry.attributes.position.needsUpdate = true;
  }

  clearTrace() { this.traceLine.geometry.setDrawRange(0, 0); }

  /**
   * Leave the line where it is, dimmed, instead of wiping it.
   *
   * The trace is the most useful thing on the screen for working out what
   * the wind actually did to you, and it was being thrown away at the exact
   * moment it became readable — the ball stops and the evidence vanishes.
   * Dimmed rather than left bright so it reads as history and not as a live
   * aim line; the next shot overwrites it.
   */
  holdTrace() {
    const m = this.traceLine.material;
    if (!m) return;
    /* 0.18, not 0.42. The live tracer is already drawn at 0.45 — see
       _buildTrace — so "dimmed to 0.42" was indistinguishable from it, and
       the held line looked exactly like a live one that had stopped
       updating. It has to be clearly fainter to read as history. */
    m.opacity = TRACE_HELD_OPACITY;
  }

  /* ------------------------------------------------------------ balls --- */
  syncBalls(players) {
    const seen = new Set();
    for (const p of players) {
      seen.add(p.pid);
      let b = this.balls.get(p.pid);
      if (!b) {
        const geo = new THREE.SphereGeometry(BALL_RADIUS, seg(this.q, 18), seg(this.q, 14));
        const mat = makeBallMaterial(THREE, p.color);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        const shGeo = new THREE.CircleGeometry(BALL_RADIUS * 1.5, 12);
        const shadow = new THREE.Mesh(shGeo, new THREE.MeshBasicMaterial({
          color: 0x0a1408, transparent: true, opacity: 0.4, depthWrite: false
        }));
        shadow.rotation.x = -Math.PI / 2;
        this.holeGroup.add(mesh); this.holeGroup.add(shadow);
        b = { mesh, shadow };
        this.balls.set(p.pid, b);
      }
      b.mesh.material.color.set(p.color);
      applyBallFinish(THREE, b.mesh.material, p.look?.ballFinish, p.color);
      b.mesh.visible = !p.spectator;
      b.shadow.visible = !p.spectator;
    }
    for (const [pid, b] of this.balls) {
      if (seen.has(pid)) continue;
      this.holeGroup.remove(b.mesh); this.holeGroup.remove(b.shadow);
      b.mesh.geometry.dispose(); b.mesh.material.dispose();
      this.balls.delete(pid);
    }
  }

  setBall(pid, x, y, z) {
    const b = this.balls.get(pid);
    if (!b) return;
    b.mesh.position.set(x, y, z);

    // A 43 mm ball 200 m away is a fraction of a pixel.  Draw it oversized and
    // grow it further with distance so you can always actually follow the shot
    // — every golf game does this, and without it the ball simply vanishes.
    //
    // But the floor used to be a flat 2.4x with no exemption for close range,
    // so a ball sitting right next to the cup — exactly the moment true scale
    // matters most — was STILL drawn 2.4x true size. Against a regulation
    // 108mm cup that shrinks the real ~2.53x cup-to-ball ratio down to about
    // 1.05x on screen: the hole reads as barely bigger than the ball, which
    // is the "the holes are way too small" report. Tapered to true scale
    // (1x) within NEAR, ramping smoothly up to the old distance curve by
    // FAR, so a putt or a look at the pin shows the real geometry and a
    // shot from the fairway still gets the same visibility boost as before.
    const d = this.camera.position.distanceTo(b.mesh.position);
    const NEAR = 2, FAR = 10;
    const farGrow = 2.4 * Math.max(1, Math.pow(d / 22, 0.72));
    const grow = 1 + (farGrow - 1) * clamp((d - NEAR) / (FAR - NEAR), 0, 1);
    b.mesh.scale.setScalar(grow);
    // the sphere grows around its centre, which sits one true ball-radius off
    // the deck — without lifting it the drawn ball sinks into the turf and you
    // only see a dark sliver
    b.mesh.position.y = y + BALL_RADIUS * (grow - 1);

    // The sun casts a real shadow now, so the painted disc under the ball is
    // only useful in the air — where it shows the landing spot and the real
    // shadow may be outside the shadow map. On the ground it just made the
    // ball look like a dark blob, so fade it out.
    const gy = this.T.heightAt(x, z);
    const lift = clamp((y - gy) / 12, 0, 1);
    b.shadow.position.set(x, gy + 0.012, z);
    b.shadow.visible = lift > 0.02;
    b.shadow.material.opacity = 0.34 * Math.min(1, lift * 6) * (1 - lift * 0.55);
    b.shadow.scale.setScalar((1 + lift * 2.6) * 2.2);
  }

  ballObj(pid) { return this.balls.get(pid); }

  /* ------------------------------------------------------------ frame --- */
  /* ═════════════════════════════════════════════ PRECIPITATION ═══════
     Rain and snow, as one instanced particle box that FOLLOWS THE CAMERA.

     That last part is the whole trick. Weather over a 900-metre course
     would be a quarter of a million particles, almost all of them behind
     you or too far to see. A 26-metre box locked to the camera, with every
     particle wrapping to the other side when it falls out, is 1,400
     particles that look like weather everywhere you go — because you can
     only ever see the weather near you anyway.

     Rain is drawn as stretched vertical lines rather than dots, which is
     what a camera with a shutter records and what the eye expects; snow is
     drawn as points with a drift, because a snowflake has no motion blur at
     the speed it falls. */
  _buildPrecip(kind, strength) {
    this._killPrecip();
    if (!kind || strength <= 0) return;
    const rain = kind === 'rain';
    const N = Math.round((rain ? 1400 : 900) * strength * (this.q?.precip ?? 1));
    if (N < 20) return;

    const BOX = 26, HIGH = 18;
    const pos = new Float32Array(N * 3);
    const spd = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * BOX;
      pos[i * 3 + 1] = Math.random() * HIGH;
      pos[i * 3 + 2] = (Math.random() - 0.5) * BOX;
      spd[i] = rain ? 14 + Math.random() * 9 : 1.1 + Math.random() * 1.0;
    }
    const geo = new THREE.BufferGeometry();
    let mat, pts, seg = null;

    if (rain) {
      /* LINE SEGMENTS, not points. A raindrop crossing the frame in a
         sixtieth of a second is a streak to any camera and to the eye, and
         the first version drew it as a round dot — which reads as dust, or
         as snow, or as a rendering fault, but never as rain. Two vertices
         per drop, the lower one trailing by the fall distance of about one
         frame. */
      seg = new Float32Array(N * 6);
      for (let i = 0; i < N; i++) {
        const j = i * 6;
        seg[j] = pos[i * 3]; seg[j + 1] = pos[i * 3 + 1]; seg[j + 2] = pos[i * 3 + 2];
        seg[j + 3] = pos[i * 3]; seg[j + 4] = pos[i * 3 + 1] + spd[i] * 0.032; seg[j + 5] = pos[i * 3 + 2];
      }
      geo.setAttribute('position', new THREE.BufferAttribute(seg, 3));
      mat = new THREE.LineBasicMaterial({
        color: 0xc6d9e8, transparent: true, opacity: 0.5,
        depthWrite: false, fog: false
      });
      pts = new THREE.LineSegments(geo, mat);
    } else {
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      mat = new THREE.PointsMaterial({
        color: 0xffffff, size: 0.11, transparent: true, opacity: 0.85,
        depthWrite: false, sizeAttenuation: true,
        fog: false            // precipitation is BETWEEN you and the fog
      });
      pts = new THREE.Points(geo, mat);
    }
    pts.frustumCulled = false;    // it is always around the camera
    pts.renderOrder = 4;
    this.scene.add(pts);
    this._precip = { pts, geo, mat, pos, spd, seg, N, BOX, HIGH, rain };
  }

  _killPrecip() {
    if (!this._precip) return;
    this.scene.remove(this._precip.pts);
    this._precip.geo.dispose();
    this._precip.mat.dispose();
    this._precip = null;
  }

  _stepPrecip(dt) {
    const p = this._precip;
    if (!p) return;
    const c = this.camera.position;
    const { pos, spd, N, BOX, HIGH } = p;
    // wind pushes it sideways, which is what makes rain read as weather
    const wx = Math.sin(this.windDir || 0) * (p.rain ? 2.4 : 1.1);
    const wz = Math.cos(this.windDir || 0) * (p.rain ? 2.4 : 1.1);
    const sway = p.rain ? 0 : 0.5;
    for (let i = 0; i < N; i++) {
      const j = i * 3;
      pos[j + 1] -= spd[i] * dt;
      pos[j] += wx * dt + (sway ? Math.sin(this.t * 1.6 + i) * sway * dt : 0);
      pos[j + 2] += wz * dt;
      // wrap: out of the box on any axis and it comes back on the far side
      if (pos[j + 1] < -2) { pos[j + 1] = HIGH; }
      if (pos[j] > BOX / 2) pos[j] -= BOX; else if (pos[j] < -BOX / 2) pos[j] += BOX;
      if (pos[j + 2] > BOX / 2) pos[j + 2] -= BOX; else if (pos[j + 2] < -BOX / 2) pos[j + 2] += BOX;
    }
    /* Rain keeps a second vertex per drop, so the streak has to be written
       back as well as the head — and the trail LENGTH scales with fall
       speed, which is what makes heavy rain look heavier rather than just
       denser. */
    if (p.seg) {
      const seg = p.seg;
      for (let i = 0; i < N; i++) {
        const j = i * 6, k = i * 3;
        seg[j] = pos[k]; seg[j + 1] = pos[k + 1]; seg[j + 2] = pos[k + 2];
        seg[j + 3] = pos[k] - wx * 0.03;
        seg[j + 4] = pos[k + 1] + spd[i] * 0.034;
        seg[j + 5] = pos[k + 2] - wz * 0.03;
      }
    }
    p.geo.attributes.position.needsUpdate = true;
    // the box rides with the camera, snapped so particles do not slide
    p.pts.position.set(c.x, (this.T ? this.T.heightAt(c.x, c.z) : 0), c.z);
  }

  /* ═════════════════════════════════════════════════ FOOTPRINTS ═══════
     Where somebody has walked, for thirty seconds.

     A pool, not a growing list. A player walking a 500-metre hole leaves
     about seven hundred prints, and allocating a mesh for each one is a
     hundred allocations a minute for something that is invisible within
     half a minute. Sixty slots, reused oldest-first, and the whole system
     costs one instanced mesh.

     Depth-offset rather than lifted off the ground: a print floating a
     centimetre above the turf catches the light from underneath and reads
     as a sticker. */
  _initPrints() {
    if (this._prints) return;
    const N = 60;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x1c2a18, transparent: true, opacity: 0.30, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
    });
    const inst = new THREE.InstancedMesh(geo, mat, N);
    inst.frustumCulled = false;
    inst.count = N;
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // every slot starts collapsed to nothing rather than stacked at the origin
    const m4 = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < N; i++) inst.setMatrixAt(i, m4);
    inst.instanceMatrix.needsUpdate = true;
    this.scene.add(inst);
    this._prints = { inst, geo, mat, N, next: 0, born: new Float32Array(N) };
  }

  /** Stamp one footprint. Called by the walker on each footfall. */
  addPrint(x, z, facing = 0, size = 0.16) {
    if (!this.T) return;
    this._initPrints();
    const p = this._prints;
    const i = p.next; p.next = (p.next + 1) % p.N;
    p.born[i] = this.t;
    const m4 = new THREE.Matrix4();
    m4.compose(
      new THREE.Vector3(x, this.T.heightAt(x, z) + 0.006, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, facing, 0)),
      new THREE.Vector3(size, 1, size * 2.1));
    p.inst.setMatrixAt(i, m4);
    p.inst.instanceMatrix.needsUpdate = true;
  }

  _fadePrints() {
    const p = this._prints;
    if (!p) return;
    /* One opacity for the whole pool rather than per print: an instanced
       mesh shares its material, and sixty materials to fade sixty prints
       independently would cost more than the prints do. The oldest print
       decides, which means a fresh one arriving refreshes the set — close
       enough at 30% opacity that nobody has ever noticed. */
    let oldest = Infinity;
    for (let i = 0; i < p.N; i++) if (p.born[i] > 0) oldest = Math.min(oldest, p.born[i]);
    if (!Number.isFinite(oldest)) return;
    const age = this.t - oldest;
    p.mat.opacity = 0.30 * Math.max(0, 1 - age / 30);
  }

  /* ═══════════════════════════════════════════════ THE BACKDROP ═══════
     What is out there, beyond the golf.

     The surrounding land already rolls and there is a treeline on the
     horizon, and it was still empty — because rolling green ground with
     trees on it is the same in Iceland as it is in Arizona. Nothing said
     WHERE you were. Look up from a tee shot on any of the eight courses and
     the middle distance was interchangeable.

     So each biome gets landforms: mesas in the desert, peaks in the Alps, a
     volcano cone on Kyushu, dunes and sea on a links, cliffs on a fjord.
     Big, simple, and far away — these sit between 1.2 and 3 km out, well
     past anything playable, so they are silhouettes against the sky and
     nothing more. A silhouette is all the eye wants at that distance and it
     costs a few hundred triangles.

     Deterministic from the hole seed, so the mountain you played under
     yesterday is in the same place today, and so every client in a room
     sees the same skyline. */
  _buildBackdrop(hole, T, bio) {
    const g = new THREE.Group();
    g.name = 'backdrop';
    const spec = BACKDROPS[bio.id];
    if (!spec || (this.q?.scenery ?? 1) < 0.4) return g;

    const rnd = mulberry32((hole.terrainSeed ^ 0x8ACD) >>> 0);
    const b = hole.bounds;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const rim = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.5;
    /* Base height: the far surround settles around here, so a landform
       planted at 0 would float or sink depending on the biome's relief. */
    const baseY = -bio.relief * 0.6;

    const mat = (hex, op = 1) => {
      const m = new THREE.MeshLambertMaterial({
        color: new THREE.Color(hex), flatShading: true,
        transparent: op < 1, opacity: op
      });
      return m;
    };

    /* One cone or wedge. Low-poly on purpose: at two kilometres a
       twelve-sided mountain and a two-hundred-sided one are the same
       picture, and one of them is free. */
    const peak = (x, z, r, h, colour, sides = 7, tilt = 0) => {
      const geo = new THREE.ConeGeometry(r, h, seg(this.q, sides), 1);
      const m = new THREE.Mesh(geo, mat(colour));
      m.position.set(x, baseY + h * 0.5 - h * 0.12, z);
      m.rotation.y = rnd() * Math.PI * 2;
      if (tilt) m.rotation.z = (rnd() - 0.5) * tilt;
      return m;
    };
    /* A CLIFF, not a cube. This was a BoxGeometry — six flat faces, right
       angles, sitting on the skyline of the two seaside courses looking
       exactly like what it was. A sea cliff is a wedge: wider at the water
       than at the top, tilted, and layered in strata that catch the light
       differently. Three tapered slices with a little lean does that for
       about the same number of triangles a box costs. */
    const slab = (x, z, w, h, d, colour) => {
      const g = new THREE.Group();
      const lean = (rnd() - 0.5) * 0.14;
      const layers = 3;
      for (let i = 0; i < layers; i++) {
        const t0 = i / layers, t1 = (i + 1) / layers;
        // narrows as it rises, so the profile is a wedge rather than a wall
        const rl = (1 - t0 * 0.42), ru = (1 - t1 * 0.42);
        const seg = new THREE.Mesh(
          new THREE.CylinderGeometry(w * 0.5 * ru, w * 0.5 * rl, h / layers, 5, 1),
          mat(i === layers - 1 ? colour
              : spec.colours[(rnd() * spec.colours.length) | 0]));
        seg.position.y = baseY + h * (t0 + t1) * 0.5;
        seg.scale.z = d / w;                    // flatten it into a headland
        seg.rotation.y = rnd() * Math.PI * 2;
        g.add(seg);
      }
      g.position.set(x, 0, z);
      g.rotation.z = lean;
      return g;
    };

    for (let i = 0; i < spec.count; i++) {
      /* Spread around the whole horizon rather than clustered: a skyline
         with a gap in it is a skyline you notice the edge of. */
      const a = (i / spec.count) * Math.PI * 2 + (rnd() - 0.5) * 0.55;
      const dist = rim * (spec.near + rnd() * (spec.far - spec.near));
      const x = cx + Math.sin(a) * dist, z = cz + Math.cos(a) * dist;
      const scale = spec.size[0] + rnd() * (spec.size[1] - spec.size[0]);
      const colour = spec.colours[(rnd() * spec.colours.length) | 0];

      if (spec.kind === 'peak') {
        const m = peak(x, z, scale * 0.62, scale, colour, 7, 0.06);
        g.add(m);
        /* Snow on the tall ones. Not on all of them — a range where every
           summit is white reads as a Christmas card, and the snowline is a
           height, which is the point. */
        if (scale > spec.snowAbove) {
          const cap = peak(x, z, scale * 0.62 * 0.34, scale * 0.34, '#e8eef4', 7);
          cap.position.y = baseY + scale * 0.88 - scale * 0.12;
          g.add(cap);
        }
      } else if (spec.kind === 'mesa') {
        // flat-topped: a cone with its point cut off is a butte
        const geo = new THREE.CylinderGeometry(scale * 0.42, scale * 0.66, scale, seg(this.q, 6), 1);
        const m = new THREE.Mesh(geo, mat(colour));
        m.position.set(x, baseY + scale * 0.5, z);
        m.rotation.y = rnd() * Math.PI * 2;
        g.add(m);
      } else if (spec.kind === 'dune') {
        const geo = new THREE.SphereGeometry(scale, seg(this.q, 9), seg(this.q, 5), 0, Math.PI * 2, 0, Math.PI * 0.5);
        const m = new THREE.Mesh(geo, mat(colour));
        m.position.set(x, baseY - scale * 0.12, z);
        m.scale.set(1.6 + rnd() * 0.8, 0.34 + rnd() * 0.2, 1.2);
        m.rotation.y = rnd() * Math.PI * 2;
        g.add(m);
      } else {
        g.add(slab(x, z, scale * (1.2 + rnd()), scale, scale * 0.7, colour));
      }
    }

    /* ── THE TREELINE ─────────────────────────────────────────────────
       The gap this fills is the one you actually see. The hole has its own
       trees, the horizon has its landforms, and between them was bare
       ground running to the fog — several hundred metres of nothing, on
       every hole of every course. Landforms alone do not fix it: a distant
       hill reads as far away precisely because there is stuff in front of
       it, and with nothing in front the whole scene flattens.

       ONE INSTANCED MESH FOR THE LOT, and the geometry is a six-sided cone
       with a stump. At three hundred metres a tree is a dark shape with a
       silhouette; modelling it properly would cost a hundred times as much
       to draw exactly the same handful of pixels. The hole's own trees stay
       fully modelled — this only ever starts beyond the out-of-bounds line,
       so nothing you can hit is a cone.

       Density comes off the biome, so Cape Wrathe's headland stays bare and
       Claude National's parkland closes in. Deterministic from the hole
       seed like everything else out here, so every player in a room sees
       the same wood. */
    const density = bio.treeDensity ?? 0.4;
    /* `> 0.01`, not `> 0.02`: Iceland's 0.02 landed exactly on the old
       boundary and got nothing, which is the bare horizon this exists to
       fix arriving by rounding. A biome with any trees at all gets some. */
    if (density > 0.01 && (this.q?.scenery ?? 1) >= 0.4) {
      const N = Math.round(340 * Math.min(1, density * 1.35));
      const trunkGeo = new THREE.CylinderGeometry(0.9, 1.4, 6, seg(this.q, 5));
      trunkGeo.translate(0, 3, 0);
      const canopyGeo = new THREE.ConeGeometry(1, 1, seg(this.q, 6), 1);
      canopyGeo.translate(0, 0.5, 0);

      const P = bio.palette;
      const canopyMat = new THREE.MeshLambertMaterial({ flatShading: true });
      canopyMat.color.setRGB(1, 1, 1);          // per-instance colour multiplies
      const trunkMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(P.trunk) });

      const canopy = new THREE.InstancedMesh(canopyGeo, canopyMat, N);
      const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, N);
      canopy.frustumCulled = false;             // it rings the player
      trunks.frustumCulled = false;

      const m4 = new THREE.Matrix4();
      const pos = new THREE.Vector3(), scl = new THREE.Vector3();
      const q0 = new THREE.Quaternion();
      const col = new THREE.Color();
      /* Two greens off the biome's own palette, so a wood on the volcanic
         course is not the same colour as one on the meadow. */
      const shades = [P.rough, P.deep, P.fairway];

      let n = 0;
      for (let i = 0; i < N; i++) {
        const a = rnd() * Math.PI * 2;
        /* Starts outside the out-of-bounds box and runs to just short of
           the landforms. Squared distribution so more of them land near the
           front, where the band actually has to read as a wood rather than
           as a sprinkling. */
        const t = Math.sqrt(rnd());
        const dist = rim * (1.12 + t * (spec.near - 1.05));
        const x = cx + Math.sin(a) * dist, z = cz + Math.cos(a) * dist;

        // never inside the playable box, whatever the maths above says
        if (x > hole.ob.minX - 20 && x < hole.ob.maxX + 20 &&
            z > hole.ob.minZ - 20 && z < hole.ob.maxZ + 20) continue;

        const h = 9 + rnd() * 13;
        const y = baseY + (T?.heightAt ? 0 : 0);
        pos.set(x, y, z);
        scl.set(h * 0.44, h * 0.72, h * 0.44);
        m4.compose(pos.clone().setY(y + h * 0.42), q0, scl);
        canopy.setMatrixAt(n, m4);
        const c = shades[(rnd() * shades.length) | 0];
        col.set(c);
        /* Pushed toward the fog with distance so the far edge of the wood
           dissolves instead of ending in a hard line of dark green. */
        const fade = Math.min(1, (dist / rim - 1.1) / 2.2);
        col.lerp(new THREE.Color(P.fog || '#cadcea'), fade * 0.55);
        if (SEASON_TINT) {
          col.r = Math.min(1, col.r * SEASON_TINT[0]);
          col.g = Math.min(1, col.g * SEASON_TINT[1]);
          col.b = Math.min(1, col.b * SEASON_TINT[2]);
        }
        canopy.setColorAt(n, col);

        scl.set(h * 0.09, h * 0.10, h * 0.09);
        m4.compose(pos.clone().setY(y), q0, scl);
        trunks.setMatrixAt(n, m4);
        n++;
      }
      canopy.count = n;
      trunks.count = n;
      canopy.instanceMatrix.needsUpdate = true;
      trunks.instanceMatrix.needsUpdate = true;
      if (canopy.instanceColor) canopy.instanceColor.needsUpdate = true;
      if (n) { g.add(trunks); g.add(canopy); }
    }

    /* ── SCRUB ────────────────────────────────────────────────────────
       Bushes through the rough, between the fairway edge and the treeline.
       The ground out there was bare grass with full-size trees standing on
       it, which is the one thing a real course never looks like — there is
       always a scale below the trees, and without it the trees read as
       props on a lawn.

       Kept OUT of play by the same rule the props follow: nothing within the
       fairway corridor or near the green, so a bush is scenery and never a
       lie nobody designed. Two squashed spheres each, instanced, biome
       coloured. */
    const scrubN = Math.round(260 * Math.min(1, (bio.treeDensity ?? 0.4) * 1.6));
    if (scrubN > 8 && (this.q?.scenery ?? 1) >= 0.4) {
      const P = bio.palette;
      const bushGeo = new THREE.SphereGeometry(0.5, seg(this.q, 7), seg(this.q, 5));
      const bushMat = new THREE.MeshLambertMaterial({ flatShading: true });
      bushMat.color.setRGB(1, 1, 1);
      const bush = new THREE.InstancedMesh(bushGeo, bushMat, scrubN * 2);
      bush.frustumCulled = false;
      const m4 = new THREE.Matrix4(), q0 = new THREE.Quaternion();
      const pos = new THREE.Vector3(), scl = new THREE.Vector3();
      const col = new THREE.Color();
      const shades = [P.rough, P.deep, P.fairway];
      const corridor = (hole.fairwayWidth || 34) * 0.5 + 8;

      let k = 0;
      for (let i = 0; i < scrubN * 3 && k < scrubN * 2; i++) {
        const x = b.minX + rnd() * (b.maxX - b.minX);
        const z = b.minZ + rnd() * (b.maxZ - b.minZ);
        // never in the corridor, never on the green
        let near = Infinity;
        for (const p of hole.route) near = Math.min(near, Math.hypot(p[0] - x, p[1] - z));
        if (near < corridor) continue;
        if (Math.hypot(x - hole.green.x, z - hole.green.z) < hole.green.r + 14) continue;
        const y = T?.heightAt ? T.heightAt(x, z) : 0;
        const sz = 0.7 + rnd() * 1.5;
        col.set(shades[(rnd() * shades.length) | 0]);
        col.offsetHSL(0, 0, (rnd() - 0.5) * 0.06);
        if (SEASON_TINT) {
          col.r = Math.min(1, col.r * SEASON_TINT[0]);
          col.g = Math.min(1, col.g * SEASON_TINT[1]);
          col.b = Math.min(1, col.b * SEASON_TINT[2]);
        }
        for (let j = 0; j < 2; j++) {
          const ox = (rnd() - 0.5) * sz, oz = (rnd() - 0.5) * sz;
          pos.set(x + ox, y + sz * 0.30, z + oz);
          scl.set(sz * (1 + rnd() * 0.4), sz * (0.5 + rnd() * 0.3), sz * (1 + rnd() * 0.4));
          m4.compose(pos, q0, scl);
          bush.setMatrixAt(k, m4);
          bush.setColorAt(k, col);
          k++;
          if (k >= scrubN * 2) break;
        }
      }
      bush.count = k;
      bush.instanceMatrix.needsUpdate = true;
      if (bush.instanceColor) bush.instanceColor.needsUpdate = true;
      if (k) g.add(bush);
    }

    /* ── BIRDS ────────────────────────────────────────────────────────
       The one thing that separates a landscape from a photograph of one is
       that something in it is moving on its own. Everything else out here —
       trees, scrub, cliffs, the sea — is stationary by nature, so a course
       with a perfect skyline and nothing alive in it still reads as a model.

       Eight of them, circling wide and high on their own loops. Two
       triangles each, no flapping animation: at that distance a bird is a
       moving speck with a silhouette, and the wingbeat is implied by the
       slight roll as it turns. Cheap enough to leave on everywhere. */
    if ((this.q?.scenery ?? 1) >= 0.4) {
      const flockGeo = new THREE.ConeGeometry(0.9, 3.2, 3);
      flockGeo.rotateX(Math.PI / 2);
      const flock = new THREE.InstancedMesh(
        flockGeo, new THREE.MeshLambertMaterial({ color: 0x2f3a33, flatShading: true }), 8);
      flock.frustumCulled = false;
      flock.userData.birds = Array.from({ length: 8 }, () => ({
        cx: cx + (rnd() - 0.5) * rim, cz: cz + (rnd() - 0.5) * rim,
        r: rim * (0.35 + rnd() * 0.5),
        y: 55 + rnd() * 70,
        a: rnd() * Math.PI * 2,
        sp: (rnd() < 0.5 ? -1 : 1) * (0.06 + rnd() * 0.07)
      }));
      g.add(flock);
      this._flock = flock;
    } else this._flock = null;

    /* A sea, where there should be one. A flat plane far out and slightly
       below the land, so it reads as water meeting the horizon rather than
       as a blue field — the fog does the rest of the work. */
    if (spec.sea) {
      const seaGeo = new THREE.PlaneGeometry(rim * 90, rim * 90);
      seaGeo.rotateX(-Math.PI / 2);
      const sea = new THREE.Mesh(seaGeo, new THREE.MeshLambertMaterial({
        color: new THREE.Color(spec.sea), transparent: true, opacity: 0.92
      }));
      sea.position.set(cx, baseY - bio.relief * 1.5, cz);
      sea.renderOrder = -1;
      g.add(sea);
    }
    return g;
  }

  /** Called by main.js when a round's weather is known. */
  setWeather(w) {
    const changed = (w?.condition || null) !== (this.weather?.condition || null)
                 || (w?.hour ?? null) !== (this.weather?.hour ?? null);
    this.weather = w || null;
    if (!w) { this._killPrecip(); this._tuneAtmosphere(); return; }
    if (changed) {
      this._buildPrecip(w.snow > 0 ? 'snow' : w.rain > 0 ? 'rain' : null,
                        w.snow || w.rain || 0);
    }
    this._tuneAtmosphere();
  }

  /* Re-point the sky at the current weather WITHOUT rebuilding the hole.

     This exists because of an ordering fact that is not going to change: the
     hole is built when the course loads, and the weather arrives with the
     first state broadcast, which is later. Baking the atmosphere into
     loadHole alone meant every round was lit for a clear noon no matter what
     the sky was doing, and the fog, the sun colour and the light level all
     silently ignored the weather they had been given.

     Only the handful of properties that depend on it are touched — no
     geometry, no materials, no allocation — so this is safe to call whenever
     the weather changes and cheap enough not to think about. */
  _tuneAtmosphere() {
    if (!this.bio || !this.sun) return;
    const P = this.bio.palette;
    const W = this.weather;
    const L = W ? lightAt(W.hour, W.season) : null;
    const cloudy = W ? W.cloud : 0;
    const tint = (hex, mul) => {
      const c = new THREE.Color(hex);
      if (!mul) return c;
      c.r = Math.min(1, c.r * mul[0]); c.g = Math.min(1, c.g * mul[1]); c.b = Math.min(1, c.b * mul[2]);
      return c;
    };

    const skyBot = tint(P.sky[1], L?.skyBot);
    const skyTop = tint(P.sky[0], L?.skyTop);
    if (L?.night) { skyTop.setRGB(0.06, 0.09, 0.19); skyBot.setRGB(0.13, 0.17, 0.29); }
    this.scene.background = skyBot.clone();

    const vis = W ? W.vis : 1;
    const fogCol = L?.night ? new THREE.Color(0.10, 0.13, 0.22) : tint(P.fog, L?.skyBot);
    if (W?.wet) fogCol.lerp(new THREE.Color('#9fb0b8'), W.wet * 0.35);
    if (this.scene.fog) {
      this.scene.fog.color.copy(fogCol);
      this.scene.fog.near = 260 * Math.max(0.28, vis);
      this.scene.fog.far = 1900 * vis;
    }

    this.sun.color.copy(L?.night ? new THREE.Color(0.52, 0.60, 0.86) : tint(P.sun, L?.warm));
    this.sun.intensity = Math.max(0.10,
      (L ? L.strength : 1.78 / 1.14) * 1.14 * (1 - cloudy * 0.55));
    if (W) {
      const SUN = sunAt(W.hour, W.season);
      this.sunDir = dirFromAngles(Math.max(4, SUN.elev), SUN.azim);
    }
    if (this.hemi) {
      this.hemi.color.copy(skyTop);
      this.hemi.intensity = this.bio.ambient * 1.15 * (L ? L.ambient : 1) * (1 + cloudy * 0.28);
    }
    if (this.fill) this.fill.color.copy(skyBot);
  }

  /** Move the birds. One matrix each, eight of them — free. */
  _tickFlock(dt) {
    const f = this._flock;
    if (!f) return;
    const birds = f.userData.birds;
    for (let i = 0; i < birds.length; i++) {
      const b = birds[i];
      b.a += b.sp * dt;
      const x = b.cx + Math.cos(b.a) * b.r;
      const z = b.cz + Math.sin(b.a) * b.r;
      _pos.set(x, b.y + Math.sin(b.a * 3) * 2.5, z);
      /* Facing along the tangent of its own circle, banked into the turn —
         which is the whole of what makes it read as flying rather than as
         being dragged around a track. */
      _e.set(0, Math.atan2(-Math.sin(b.a) * b.sp, Math.cos(b.a) * b.sp) + Math.PI / 2,
            b.sp > 0 ? -0.35 : 0.35);
      _q.setFromEuler(_e);
      _m4.compose(_pos, _q, _one);
      f.setMatrixAt(i, _m4);
    }
    f.instanceMatrix.needsUpdate = true;
  }

  update(dt) {
    this._tickFlock(dt);
    this.t += dt;
    // slide the shadow frustum along with the camera so the visible ground is
    // always the part that has shadows on it
    if (this.fill) {
      // sit the fill at the camera and aim it where the camera is actually
      // looking, so whatever you are watching is never a pure silhouette
      const c = this.camera.position;
      this.camera.getWorldDirection(_fwd);
      this.fill.position.copy(c);
      this.fill.target.position.set(c.x + _fwd.x * 20, c.y + _fwd.y * 20 - 3, c.z + _fwd.z * 20);
      this.fill.target.updateMatrixWorld();
    }
    if (this.sun && this.sunDir && this.q?.shadows) {
      const c = this.camera.position;
      this.sun.target.position.set(c.x, this.T ? this.T.heightAt(c.x, c.z) : 0, c.z);
      this.sun.position.set(
        this.sun.target.position.x + this.sunDir.x * 220,
        this.sun.target.position.y + this.sunDir.y * 220,
        this.sun.target.position.z + this.sunDir.z * 220);
      this.sun.target.updateMatrixWorld();
    }
    this._fallProps(dt);
    for (const w of this._water) {
      const sh = w.userData.mat.userData.sh;
      if (sh) sh.uniforms.uTime.value = this.t;
    }
    if (this.flag) {
      // ripple the flag and let it stream with the wind. Geometry x is in
      // [0, 0.52] post-translate (see _buildPin) — 0 at the pole, 0.52 at
      // the free edge — so fx is already the 0..1 the ripple wants.
      const g = this.flag.geometry;
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const fx = pos.getX(i) / 0.52;
        pos.setZ(i, Math.sin(fx * 7 + this.t * 8) * 0.07 * fx);
      }
      pos.needsUpdate = true;
      if (this.windDir != null) this.flag.rotation.y = this.windDir + Math.PI / 2;
    }

    // clouds drift downwind, wrapping round when they leave the far side
    if (this.clouds) {
      const dx = Math.sin(this.windDir || 0.6), dz = Math.cos(this.windDir || 0.6);
      const drift = this.clouds.userData.drift;
      const span = this.clouds.userData.span, cx = this.clouds.userData.cx;
      for (const d of drift) {
        d.baseX += dx * d.speed * dt;
        d.z += dz * d.speed * dt;
        if (d.baseX > cx + span) d.baseX -= span * 2;
        if (d.baseX < cx - span) d.baseX += span * 2;
        _m4.makeRotationY(d.ry);
        _m4.scale(_scl.set(d.sx, d.sy, d.sz));
        _m4.setPosition(d.baseX, d.y, d.z);
        this.clouds.setMatrixAt(d.i, _m4);
      }
      this.clouds.instanceMatrix.needsUpdate = true;
    }
    this._stepPrecip(dt);
    this._fadePrints();
    if (this.fx) this.fx.update(dt);
  }

  /**
   * Draw, defensively.
   *
   * The webglcontextlost EVENT is delivered asynchronously, so between the
   * GPU actually going away and the flag being set there is a window of one
   * or more frames.  Draw in that window and three.js reads a null shader log
   * and throws "cannot read properties of null" — from inside the frame loop,
   * which kills the loop and takes the whole game with it.  gl.isContextLost()
   * is the synchronous truth, and the try/catch means that even an unforeseen
   * driver failure costs one frame instead of the session.
   */
  render(camera) {
    if (this.contextLost) return;
    const gl = this.renderer.getContext();
    if (gl.isContextLost && gl.isContextLost()) { this.contextLost = true; return; }
    try {
      this.renderer.render(this.scene, camera || this.camera);
    } catch (e) {
      if (gl.isContextLost && gl.isContextLost()) { this.contextLost = true; return; }
      this._renderFails = (this._renderFails || 0) + 1;
      if (this._renderFails <= 3) console.error('render failed —', e?.message || e);
    }
  }
}

/* ========================================================================= */
/*  TREES                                                                     */
/* ========================================================================= */

const _geoCache = new Map();
/**
 * A box with its twelve edges cut back — six inset faces, twelve edge
 * strips and eight corner triangles.
 *
 * Same shape and the same reasoning as the avatar's chamfered box, in the
 * other renderer: a hard edge takes the light in two steps and reads as a
 * primitive. `b` is the cut in world units, so the caller decides
 * proportionally and a thin sole plate is not eaten by its own bevel.
 *
 * 44 triangles against 12. Every prop on a hole together is a few hundred
 * against the hole's own 143,000, and they are cached per size.
 */
function bevelBox(w, h, d, b) {
  const x = w / 2, y = h / 2, z = d / 2;
  const xi = x - b, yi = y - b, zi = z - b;
  const pos = [], idx = [];
  const V = (a, c, e) => { pos.push(a, c, e); return pos.length / 3 - 1; };
  const quad = (a, c, e, f) => idx.push(a, c, e, a, e, f);

  const corner = {};
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    corner[`${sx}${sy}${sz}`] = {
      x: V(sx * x, sy * yi, sz * zi),
      y: V(sx * xi, sy * y, sz * zi),
      z: V(sx * xi, sy * yi, sz * z)
    };
  }
  const C = (a, c, e) => corner[`${a}${c}${e}`];

  for (const [axis, pts] of [
    ['x', [[1,-1,-1],[1,-1,1],[1,1,1],[1,1,-1]]],
    ['x', [[-1,-1,1],[-1,-1,-1],[-1,1,-1],[-1,1,1]]],
    ['y', [[-1,1,1],[1,1,1],[1,1,-1],[-1,1,-1]]],
    ['y', [[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1]]],
    ['z', [[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]],
    ['z', [[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]]]
  ]) {
    const [a, c, e, f] = pts.map(q => C(q[0], q[1], q[2])[axis]);
    quad(a, c, e, f);
  }

  /* The edge strips and corner triangles are written with BOTH windings —
     which octant an edge faces decides its outward side, and two triangles
     is cheaper than working out which. */
  const edges = [
    ...[[1,1],[1,-1],[-1,-1],[-1,1]].map(([a, c]) => ['z', a, c]),
    ...[[1,1],[1,-1],[-1,-1],[-1,1]].map(([a, c]) => ['x', a, c]),
    ...[[1,1],[1,-1],[-1,-1],[-1,1]].map(([a, c]) => ['y', a, c])
  ];
  for (const [along, s1, s2] of edges) {
    let a, c, e, f;
    if (along === 'z') {
      a = C(s1, s2, -1).x; c = C(s1, s2, -1).y; e = C(s1, s2, 1).y; f = C(s1, s2, 1).x;
    } else if (along === 'x') {
      a = C(-1, s1, s2).y; c = C(-1, s1, s2).z; e = C(1, s1, s2).z; f = C(1, s1, s2).y;
    } else {
      a = C(s2, -1, s1).z; c = C(s2, -1, s1).x; e = C(s2, 1, s1).x; f = C(s2, 1, s1).z;
    }
    quad(a, c, e, f); quad(f, e, c, a);
  }
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

function cached(key, make) {
  let g = _geoCache.get(key);
  if (!g) { g = make(); g.userData.shared = true; _geoCache.set(key, g); }
  return g;
}

/**
 * Each species is a handful of instanced primitives.  `off` and `scale` are
 * expressed as fractions of the tree's height so one geometry serves every
 * size, and the whole species draws in one call per part.
 */
/* =========================================================================
   Making the picture agree with the collider
   -------------------------------------------------------------------------
   A tree's canopy was drawn to whatever radius looked right and collided at
   a separate number in coursegen. They had drifted: a broadleaf's lobes
   reached 0.49 of its height and it collided at 0.34. From inside the
   corridor that is a ball flying clean through leaves, or — far worse, and
   what the player actually reported — a shot that visibly misses by metres
   being knocked straight down.

   So the drawn canopy is now MEASURED and scaled to reach exactly crownOf().
   Measured, not annotated, because a hand-written radius beside each lobe is
   the same drift with extra steps.

   Only species with a solid canopy are normalised. A palm's fronds spread
   far wider than anything that should stop a golf ball and they are supposed
   to; the same goes for a saguaro's arms. Those keep their art, and their
   collider is the small core it always was. */
const SOLID_CANOPY = new Set(['maple', 'oak', 'mangrove', 'palo', 'pine', 'fir', 'spruce', 'cedar', 'eucalypt']);

function normaliseCanopy(species, parts) {
  if (!SOLID_CANOPY.has(species)) return parts;
  const v = new THREE.Vector3(), sc = new THREE.Vector3();
  const q = new THREE.Quaternion(), eul = new THREE.Euler();
  let reach = 0;
  for (const p of parts) {
    if (!p.mat.userData?.leaf) continue;
    eul.set(p.tilt || 0, p.rotY || 0, p.tiltZ || 0);
    q.setFromEuler(eul);
    sc.set(p.scale[0], p.scale[1], p.scale[2]);
    const pos = p.geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      // the same order _buildTrees composes in: scale, rotate, then offset
      v.fromBufferAttribute(pos, i).multiply(sc).applyQuaternion(q);
      reach = Math.max(reach, Math.hypot(v.x + p.off[0], v.z + p.off[2]));
    }
  }
  if (!(reach > 0.01)) return parts;
  const k = crownOf(species) / reach;
  for (const p of parts) {
    if (!p.mat.userData?.leaf) continue;
    // width only — a tree that is scaled in every axis is a shorter tree,
    // and the height is what the collider's vertical extent is built from
    p.off = [p.off[0] * k, p.off[1], p.off[2] * k];
    p.scale = [p.scale[0] * k, p.scale[1], p.scale[2] * k];
  }
  return parts;
}

/* The season's foliage multiplier, set once per hole and read where the
   PER-INSTANCE colour is written.

   Not on the material, which is where it went first and where it does
   nothing: the instancing path sets every leaf material to white and carries
   the real colour per instance, so a tinted material is overwritten two
   lines later by setRGB(1,1,1). The tint has to ride the same channel the
   colour does. */
let SEASON_TINT = null;

/* What sits on each course's horizon. Distances are multiples of the hole's
   own radius, so a long hole gets its skyline further out and the sense of
   scale holds. `size` is in metres. */
export const BACKDROPS = {
  parkland: { kind: 'peak', count: 9,  near: 3.0, far: 6.5, size: [70, 150],
              snowAbove: 999, colours: ['#5d7a63', '#4e6b56', '#68866e'] },
  links:    { kind: 'dune', count: 14, near: 2.2, far: 5.0, size: [40, 95],
              snowAbove: 999, colours: ['#8f9a6a', '#9caa76', '#7d8a5e'],
              sea: '#3f6f88' },
  desert:   { kind: 'mesa', count: 11, near: 2.6, far: 6.0, size: [90, 220],
              snowAbove: 999, colours: ['#a4674a', '#8f5a41', '#b0755a', '#7d4c38'] },
  alpine:   { kind: 'peak', count: 12, near: 2.4, far: 6.5, size: [180, 420],
              snowAbove: 250, colours: ['#6b7784', '#5a6672', '#7b8794'] },
  tropical: { kind: 'peak', count: 7,  near: 3.2, far: 6.0, size: [80, 190],
              snowAbove: 999, colours: ['#3f7a52', '#356b46', '#4a8a5e'],
              sea: '#2f8aa8' },
  sandbelt: { kind: 'dune', count: 10, near: 3.0, far: 6.0, size: [50, 110],
              snowAbove: 999, colours: ['#8a8a56', '#7a7a4a', '#98986a'] },
  volcanic: { kind: 'peak', count: 6,  near: 2.8, far: 5.5, size: [200, 460],
              snowAbove: 340, colours: ['#4a4d52', '#3d4045', '#585c62'] },
  fjord:    { kind: 'cliff', count: 13, near: 2.0, far: 4.8, size: [120, 300],
              snowAbove: 999, colours: ['#4a4d52', '#3d4045', '#585c62', '#6a6e74'],
              sea: '#2f4f66' },

  /* EVERY BIOME NEEDS A ROW HERE. `_buildBackdrop` returns an empty group
     for anything it does not recognise, so a course added without one plays
     against a bare horizon — which is exactly the "half-arsed empty
     background" that got fixed once already, quietly reintroduced by adding
     four courses and not this table. There is a test for it now. */
  meadow:   { kind: 'peak', count: 8,  near: 3.4, far: 7.0, size: [50, 105],
              snowAbove: 999, colours: ['#6d8a63', '#5e7a56', '#7a976e'] },
  heath:    { kind: 'dune', count: 12, near: 2.6, far: 5.6, size: [55, 120],
              snowAbove: 999, colours: ['#7a6a72', '#6b5f68', '#8a7a80'] },
  veld:     { kind: 'mesa', count: 9,  near: 3.0, far: 6.4, size: [70, 170],
              snowAbove: 999, colours: ['#9a8a5e', '#87794f', '#a99a6c', '#7a6e46'] },
  /* Cliffs and open ocean — the sea is most of what you can see from it. */
  headland: { kind: 'cliff', count: 15, near: 1.9, far: 4.6, size: [90, 240],
              snowAbove: 999, colours: ['#5a5f56', '#4b5049', '#6b7166', '#3f443d'],
              sea: '#2b5f7e' }
};

/* `d` is the quality tier's `detail` (see QUALITY). treeParts is module
   level and has no scene to ask, so it is handed the number — and every
   cache key below carries it, or a tier change would hand back the
   geometry built for the previous one. */
function treeParts(species, bio, d = 1) {
  const S = base => Math.round(base * [1, 1.5, 2.2][d]);
  /* Subdivision is not a segment count: each step QUADRUPLES an
     icosahedron's triangles, so it gets one extra level at the top tier
     only rather than riding the same multiplier the sides do. A canopy lobe
     at subdivision 2 is 320 triangles against 80 — worth it once, on a
     machine that asked for it, and ruinous at every tier. */
  const SUB = lvl => lvl + (d >= 2 ? 1 : 0);
  const K = key => key + '@' + d;
  const P = bio.palette;
  const trunkMat = () => new THREE.MeshLambertMaterial({ color: new THREE.Color(P.trunk) });
  const leafMat = (hex, opts = {}) => {
    const m = new THREE.MeshLambertMaterial(
      Object.assign({ color: new THREE.Color(hex), flatShading: true }, opts));
    m.userData.leaf = true;      // so the canopy can be measured and normalised
    return m;
  };

  switch (species) {
    case 'pine': case 'spruce': case 'fir': {
      const dark = species === 'fir' ? '#2b5230' : '#2f5a2a';
      const skirt = (i, n) => {
        const t = i / (n - 1);
        const r = 0.36 * (1 - t * 0.78);
        const h = 0.30 * (1 - t * 0.42);
        const y = 0.34 + t * 0.62;
        const col = lightenHex(dark, t * 0.22);
        return {
          geo: cached(K('skirt' + i), () => new THREE.ConeGeometry(r, h, S(9))),
          mat: leafMat(col), off: [0, y, 0], scale: [1, 1, 1], color: new THREE.Color(col)
        };
      };
      const parts = [
        { geo: cached(K('conitrunk'), () => new THREE.CylinderGeometry(0.022, 0.062, 1, S(7))), mat: trunkMat(),
          off: [0, 0.5, 0], scale: [1, 1, 1], color: new THREE.Color(P.trunk) }
      ];
      for (let i = 0; i < 5; i++) parts.push(skirt(i, 5));
      return parts;
    }
    /* A cedar: a tall narrow spire, not a Christmas tree. Six shallow skirts
       that barely widen as they descend, so the corridor between two of them
       is a gap you can actually see a fairway through — which matters here
       more than anywhere, because Kurodake is the tightest course in the
       game and a wall of cones would make it unplayable rather than tight. */
    case 'cedar': {
      const dark = '#2a4a30';
      const parts = [
        /* Thin. A cedar's crown is only 0.16 of its height (CROWN in
           biomes.js) and the trunk has to read as slimmer than that, or a
           26 m tree ends up with a two-and-a-half-metre bole and looks like
           a terracotta pipe with a hat on. */
        { geo: cached(K('cedtrunk'), () => new THREE.CylinderGeometry(0.012, 0.026, 1, S(7))), mat: trunkMat(),
          off: [0, 0.5, 0], scale: [1, 1, 1], color: new THREE.Color(P.trunk) }
      ];
      for (let i = 0; i < 6; i++) {
        const t = i / 5;
        const r = 0.30 * (1 - t * 0.62);
        const hh = 0.26 * (1 - t * 0.30);
        const y = 0.26 + t * 0.70;
        const col = lightenHex(dark, t * 0.26);
        parts.push({
          geo: cached(K('cedskirt' + i), () => new THREE.ConeGeometry(r, hh, S(8))),
          mat: leafMat(col), off: [0, y, 0], scale: [1, 1, 1], color: new THREE.Color(col)
        });
      }
      return parts;
    }

    /* A eucalypt: a long pale trunk with almost nothing on it until the very
       top, where a thin open crown sits. The whole point of the sandbelt is
       that you can SEE — the trouble is the bunkering, not the trees — so
       this species is deliberately built to be looked past. */
    case 'eucalypt': {
      const leaf = '#7d9464';                       // blue-green, not forest green
      return [
        { geo: cached(K('euctrunk'), () => new THREE.CylinderGeometry(0.026, 0.058, 1, S(7))), mat: trunkMat(),
          off: [0, 0.5, 0], scale: [1, 1, 1], color: new THREE.Color(P.trunk) },
        { geo: cached(K('eucbranch'), () => { const g = new THREE.CylinderGeometry(0.012, 0.028, 0.30, S(5)); g.translate(0, 0.15, 0); g.rotateZ(0.62); return g; }),
          mat: trunkMat(), off: [0, 0.70, 0], scale: [1, 1, 1], color: new THREE.Color(P.trunk) },
        { geo: cached(K('eucbranch2'), () => { const g = new THREE.CylinderGeometry(0.012, 0.026, 0.26, S(5)); g.translate(0, 0.13, 0); g.rotateZ(-0.7); return g; }),
          mat: trunkMat(), off: [0, 0.76, 0], scale: [1, 1, 1], color: new THREE.Color(P.trunk) },
        { geo: cached(K('euclobeA'), () => new THREE.IcosahedronGeometry(0.26, SUB(1))), mat: leafMat(leaf),
          off: [0, 0.90, 0], scale: [1.1, 0.62, 1.1], color: new THREE.Color(leaf) },
        { geo: cached(K('euclobeB'), () => new THREE.IcosahedronGeometry(0.17, SUB(1))), mat: leafMat(lightenHex(leaf, 0.14)),
          off: [0.19, 0.83, 0.06], scale: [1, 0.66, 1], color: new THREE.Color(lightenHex(leaf, 0.14)) },
        { geo: cached(K('euclobeC'), () => new THREE.IcosahedronGeometry(0.15, SUB(1))), mat: leafMat(darkenHex(leaf, 0.12)),
          off: [-0.17, 0.86, -0.08], scale: [1, 0.66, 1], color: new THREE.Color(darkenHex(leaf, 0.12)) }
      ];
    }

    case 'palm': {
      const frond = '#4f9440';
      const parts = [
        { geo: cached(K('palmtrunk'), () => {
            // a gently leaning trunk built from stacked segments
            const g = new THREE.CylinderGeometry(0.026, 0.055, 1, S(9), 6);
            const pos = g.attributes.position;
            for (let i = 0; i < pos.count; i++) {
              const y = pos.getY(i) + 0.5;                    // 0..1 up the trunk
              pos.setX(i, pos.getX(i) + Math.sin(y * 1.5) * 0.10 * y);
            }
            g.computeVertexNormals();
            return g;
          }), mat: trunkMat(), off: [0, 0.5, 0], scale: [1, 1, 1], color: new THREE.Color(P.trunk) }
      ];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const droop = -0.28 - (i % 3) * 0.16;
        parts.push({
          geo: cached(K('frond'), () => {
            // a tapered, drooping blade rather than a flat rectangle
            const g = new THREE.PlaneGeometry(0.68, 0.20, 8, 1);
            const pos = g.attributes.position;
            for (let k = 0; k < pos.count; k++) {
              const t = (pos.getX(k) + 0.34) / 0.68;          // 0 at base, 1 at tip
              pos.setY(k, pos.getY(k) * (1 - t * 0.85));       // taper
              pos.setZ(k, -t * t * 0.22);                      // droop
            }
            g.translate(0.34, 0, 0);
            g.computeVertexNormals();
            return g;
          }),
          mat: leafMat(frond, { side: THREE.DoubleSide }),
          off: [Math.cos(a) * 0.13 + 0.10, 0.95, Math.sin(a) * 0.13],
          scale: [1, 1, 1], color: new THREE.Color(frond),
          rotY: a, tilt: droop
        });
      }
      return parts;
    }
    case 'gorse': {
      const c = '#5d6f2e';
      return [
        { geo: cached(K('bush'), () => new THREE.IcosahedronGeometry(0.5, SUB(1))), mat: leafMat(c),
          off: [0, 0.40, 0], scale: [1.15, 0.78, 1.15], color: new THREE.Color(c) },
        { geo: cached(K('bush2'), () => new THREE.IcosahedronGeometry(0.34, SUB(1))), mat: leafMat('#8a8b34'),
          off: [0.24, 0.52, 0.10], scale: [1, 0.8, 1], color: new THREE.Color('#8a8b34') },
        { geo: cached(K('bush3'), () => new THREE.IcosahedronGeometry(0.28, SUB(1))), mat: leafMat(darkenHex(c, 0.16)),
          off: [-0.22, 0.44, -0.14], scale: [1, 0.82, 1], color: new THREE.Color(darkenHex(c, 0.16)) },
        // the gorse flower that makes a links course yellow in spring
        { geo: cached(K('bushf'), () => new THREE.IcosahedronGeometry(0.17, SUB(0))), mat: leafMat('#d8c73c'),
          off: [0.05, 0.62, 0.16], scale: [1, 0.7, 1], color: new THREE.Color('#d8c73c') }
      ];
    }
    case 'saguaro': {
      const c = '#4b6b3d';
      const ribbed = (rt, rb, h, seg) => {
        const g = new THREE.CylinderGeometry(rt, rb, h, S(seg));
        const pos = g.attributes.position;                    // pinch alternate columns into ribs
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i), z = pos.getZ(i);
          const a = Math.atan2(z, x), r = Math.hypot(x, z);
          const rr = r * (1 + Math.cos(a * seg) * 0.10);
          pos.setX(i, Math.cos(a) * rr); pos.setZ(i, Math.sin(a) * rr);
        }
        g.computeVertexNormals();
        return g;
      };
      const cap = (r) => new THREE.SphereGeometry(r, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      return [
        { geo: cached(K('sagbody'), () => ribbed(0.085, 0.10, 1, 12)), mat: leafMat(c),
          off: [0, 0.5, 0], scale: [1, 1, 1], color: new THREE.Color(c) },
        { geo: cached(K('sagcap'), () => cap(0.085)), mat: leafMat(c),
          off: [0, 1.0, 0], scale: [1, 1, 1], color: new THREE.Color(c) },
        // right arm: out, then up
        { geo: cached(K('sagout'), () => ribbed(0.055, 0.055, 0.20, 10)), mat: leafMat(c),
          off: [0.11, 0.62, 0], scale: [1, 1, 1], color: new THREE.Color(c), tiltZ: Math.PI / 2 },
        { geo: cached(K('sagup'), () => ribbed(0.05, 0.055, 0.34, 10)), mat: leafMat(c),
          off: [0.20, 0.79, 0], scale: [1, 1, 1], color: new THREE.Color(c) },
        { geo: cached(K('sagupcap'), () => cap(0.05)), mat: leafMat(c),
          off: [0.20, 0.96, 0], scale: [1, 1, 1], color: new THREE.Color(c) },
        // left arm, a little lower
        { geo: cached(K('sagout2'), () => ribbed(0.05, 0.05, 0.17, 10)), mat: leafMat(c),
          off: [-0.10, 0.50, 0.02], scale: [1, 1, 1], color: new THREE.Color(c), tiltZ: Math.PI / 2 },
        { geo: cached(K('sagup2'), () => ribbed(0.045, 0.05, 0.26, 10)), mat: leafMat(c),
          off: [-0.18, 0.63, 0.02], scale: [1, 1, 1], color: new THREE.Color(c) },
        { geo: cached(K('sagupcap2'), () => cap(0.045)), mat: leafMat(c),
          off: [-0.18, 0.76, 0.02], scale: [1, 1, 1], color: new THREE.Color(c) }
      ];
    }
    case 'palo': {
      const c = '#7f9350';
      return [
        { geo: cached(K('cyl8'), () => new THREE.CylinderGeometry(0.035, 0.055, 1, S(6))), mat: trunkMat(),
          off: [0, 0.5, 0], scale: [1, 1, 1], color: new THREE.Color('#8d9a5e') },
        { geo: cached(K('ico1'), () => new THREE.IcosahedronGeometry(0.42, SUB(0))), mat: leafMat(c),
          off: [0, 0.92, 0], scale: [1, 0.62, 1], color: new THREE.Color(c) }
      ];
    }
    case 'maple': case 'oak': default: {
      const c = species === 'maple' ? '#5c8f3a' : '#43762f';
      // a tapered trunk, two lifted branches, and five overlapping canopy lobes
      return [
        { geo: cached(K('btrunk'), () => new THREE.CylinderGeometry(0.028, 0.075, 1, S(8))), mat: trunkMat(),
          off: [0, 0.5, 0], scale: [1, 1, 1], color: new THREE.Color(P.trunk) },
        { geo: cached(K('branchL'), () => { const g = new THREE.CylinderGeometry(0.014, 0.032, 0.34, S(5)); g.translate(0, 0.17, 0); g.rotateZ(0.75); return g; }),
          mat: trunkMat(), off: [0, 0.50, 0], scale: [1, 1, 1], color: new THREE.Color(P.trunk) },
        { geo: cached(K('branchR'), () => { const g = new THREE.CylinderGeometry(0.014, 0.032, 0.34, S(5)); g.translate(0, 0.17, 0); g.rotateZ(-0.8); return g; }),
          mat: trunkMat(), off: [0, 0.46, 0], scale: [1, 1, 1], color: new THREE.Color(P.trunk) },
        { geo: cached(K('lobeA'), () => new THREE.IcosahedronGeometry(0.40, SUB(1))), mat: leafMat(c),
          off: [0, 0.82, 0], scale: [1.05, 0.88, 1.05], color: new THREE.Color(c) },
        { geo: cached(K('lobeB'), () => new THREE.IcosahedronGeometry(0.29, SUB(1))), mat: leafMat(lightenHex(c, 0.16)),
          off: [0.20, 0.96, 0.10], scale: [1, 0.88, 1], color: new THREE.Color(lightenHex(c, 0.16)) },
        { geo: cached(K('lobeC'), () => new THREE.IcosahedronGeometry(0.26, SUB(1))), mat: leafMat(darkenHex(c, 0.14)),
          off: [-0.22, 0.74, -0.10], scale: [1, 0.9, 1], color: new THREE.Color(darkenHex(c, 0.14)) },
        { geo: cached(K('lobeD'), () => new THREE.IcosahedronGeometry(0.23, SUB(1))), mat: leafMat(lightenHex(c, 0.07)),
          off: [0.06, 0.68, -0.24], scale: [1, 0.9, 1], color: new THREE.Color(lightenHex(c, 0.07)) },
        { geo: cached(K('lobeE'), () => new THREE.IcosahedronGeometry(0.21, SUB(1))), mat: leafMat(darkenHex(c, 0.06)),
          off: [-0.10, 1.00, -0.06], scale: [1, 0.9, 1], color: new THREE.Color(darkenHex(c, 0.06)) }
      ];
    }
  }
}

function lightenHex(hex, a) {
  const c = new THREE.Color(hex); c.lerp(new THREE.Color(0xffffff), a); return '#' + c.getHexString();
}
function darkenHex(hex, a) {
  const c = new THREE.Color(hex); c.lerp(new THREE.Color(0x000000), a); return '#' + c.getHexString();
}

/* ========================================================================= */
/*  DETAIL TEXTURE                                                            */
/* ========================================================================= */
const _detailCache = new Map();
function makeDetailTexture(bio) {
  let t = _detailCache.get(bio.id);
  if (t) return t;
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const rnd = mulberry32(0x9e37 ^ S);
  g.fillStyle = '#808080';
  g.fillRect(0, 0, S, S);
  // little blades, so grass reads as grass at the player's eye level
  for (let i = 0; i < 5200; i++) {
    const x = rnd() * S, y = rnd() * S;
    const v = 96 + rnd() * 118;
    g.strokeStyle = `rgb(${v},${v},${v})`;
    g.lineWidth = 0.8 + rnd() * 0.7;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 3, y - 1.5 - rnd() * 3.5);
    g.stroke();
  }
  t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  _detailCache.set(bio.id, t);
  return t;
}

function dirFromAngles(elevDeg, azimDeg) {
  const e = elevDeg * Math.PI / 180, a = azimDeg * Math.PI / 180;
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).normalize();
}

/* ========================================================================= */
/*  EFFECTS — splashes, divots, sand puffs                                    */
/* ========================================================================= */
class EffectPool {
  constructor(parent) {
    this.parent = parent;
    this.items = [];
  }
  /**
   * @param colorOverride  for kinds without one fixed colour of their own —
   *   `trail` rides whatever cosmetic the shooter has equipped, `confetti`
   *   rides the reaction tier — rather than every celebration and every
   *   trail cosmetic looking the same shade of yellow.
   */
  burst(kind, x, y, z, n = 18, colorOverride = null) {
    const colors = {
      splash: 0xd6f0fb, sand: 0xf0e2b8, grass: 0x4e8a3c, leaves: 0x3f7a37,
      fire: 0xffa33a, smoke: 0x4a4a4a, trail: 0xffffff, confetti: 0xffd94a
    };
    // smoke drifts up and hangs; fire and debris are thrown and fall
    const rises = kind === 'smoke';
    const size = kind === 'splash' ? 0.09 : kind === 'smoke' ? 0.30 : kind === 'fire' ? 0.13
      : kind === 'trail' ? 0.045 : kind === 'confetti' ? 0.07 : 0.06;
    // Every burst of the same kind wants the identical sphere — cache it
    // like every other decoration in this file (see `cached`, above)
    // instead of paying for a fresh geometry + GPU upload on every splash,
    // divot and puff of cart smoke. The material still varies per burst
    // (colorOverride rides the shooter's own cosmetic) so it stays
    // per-instance, disposed in update() same as before.
    const geo = cached('burst-sphere-' + size, () => new THREE.SphereGeometry(size, 5, 4));
    const mat = new THREE.MeshBasicMaterial({
      color: colorOverride ?? (colors[kind] || 0xffffff), transparent: true,
      opacity: rises ? 0.55 : 1, depthWrite: false
    });
    const inst = new THREE.InstancedMesh(geo, mat, n);
    inst.frustumCulled = false;
    const parts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + i * 0.7;
      const sp = kind === 'splash' ? 2.2 + (i % 5) * 0.9
        : kind === 'fire' ? 3.0 + (i % 5) * 1.2
          : kind === 'trail' ? 0.35 + (i % 3) * 0.15
          : kind === 'confetti' ? 2.4 + (i % 5) * 1.0
          : rises ? 0.5 + (i % 4) * 0.25 : 1.4 + (i % 4) * 0.6;
      parts.push({
        x, y, z,
        vx: Math.cos(a) * sp * 0.6,
        vy: rises ? 1.1 + (i % 5) * 0.3
          : kind === 'fire' ? 3.4 + (i % 6) * 0.5
          : kind === 'trail' ? 0.15 + (i % 3) * 0.1
          : kind === 'confetti' ? 3.2 + (i % 6) * 0.7
          : 2.2 + (i % 6) * 0.5,
        vz: Math.sin(a) * sp * 0.6
      });
    }
    this.parent.add(inst);
    this.items.push({
      inst, parts,
      life: rises ? 2.6 : kind === 'fire' ? 1.5 : kind === 'trail' ? 0.5 : kind === 'confetti' ? 1.6 : 1.15,
      age: 0, mat, gravity: rises ? -0.4 : kind === 'trail' ? 2.5 : 9.8, grow: rises ? 1.7 : 1,
      baseOpacity: rises ? 0.55 : 1
    });
  }
  update(dt) {
    const m4 = _m4;                 // module scratch — no per-frame allocation
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      const k = it.age / it.life;
      if (k >= 1) {
        this.parent.remove(it.inst);
        if (!it.inst.geometry.userData.shared) it.inst.geometry.dispose();
        it.mat.dispose();
        this.items.splice(i, 1);
        continue;
      }
      it.mat.opacity = (it.baseOpacity ?? 1) * (1 - k);
      const s = 1 + (it.grow - 1) * k;          // smoke swells as it rises
      for (let j = 0; j < it.parts.length; j++) {
        const p = it.parts[j];
        p.vy -= it.gravity * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        m4.makeScale(s, s, s);
        m4.setPosition(p.x, p.y, p.z);
        it.inst.setMatrixAt(j, m4);
      }
      it.inst.instanceMatrix.needsUpdate = true;
    }
  }
}
