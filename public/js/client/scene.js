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

const GRID_STEP = 1.8;          // metres between terrain vertices.  2.6 read
                                // as polygonal on every mound; 1.8 is the
                                // point where silhouettes become curves.
const _fwd = new THREE.Vector3();
// per-frame scratch: the cloud drift and effect loops run every frame of the
// whole round, so they must not allocate — reuse these instead
const _m4 = new THREE.Matrix4();
const _scl = new THREE.Vector3();

/* Three real budgets. `scenery` scales the decorative instancing, `water`
   drops the fine chop, and pixelRatio is the one that decides whether a weak
   machine is playable at all — a retina display asks for four times the
   fragments, and capping it is worth more than every other lever combined. */
export const QUALITY = {
  low:    { pixelRatio: 1,   shadows: false, shadowMap: 0,    scenery: 0.35, water: 0 },
  medium: { pixelRatio: 1.5, shadows: true,  shadowMap: 1024, scenery: 0.75, water: 1 },
  high:   { pixelRatio: 2,   shadows: true,  shadowMap: 2048, scenery: 1.0,  water: 1 }
};

/* The earned ball finishes. A finish is how the ball catches the light, not
   what colour it is — the colour is the player's own and picking one should
   never take that away from them. So each of these only moves the specular
   terms, which is also why they cost nothing: no textures, no new material,
   four numbers on the one that already exists. */
const BALL_FINISH = {
  matte:  { shininess: 4,   specular: 0x0d0d0d, emissive: 0x000000 },
  pearl:  { shininess: 90,  specular: 0x9fa8c0, emissive: 0x0a0c14 },
  chrome: { shininess: 220, specular: 0xdddddd, emissive: 0x000000 },
  prism:  { shininess: 180, specular: 0xc8a8ff, emissive: 0x140a1e }
};
const BALL_PLAIN = { shininess: 60, specular: 0x555555, emissive: 0x000000 };

function applyBallFinish(mat, id, _color) {
  const f = BALL_FINISH[id] || BALL_PLAIN;
  mat.shininess = f.shininess;
  mat.specular.setHex(f.specular);
  mat.emissive.setHex(f.emissive);
  mat.needsUpdate = true;
}

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
    // Shadow maps are the single most expensive thing here — a whole extra
    // pass over every caster — so they are OFF by default.  Avatars and balls
    // carry blob shadows instead, which cost one transparent quad each.
    // 'quality' turns the real sun shadow on for machines that can take it.
    this.quality = 'medium';
    this.q = QUALITY.medium;
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;

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
    this.scene.traverse(o => {
      if (o.material) {
        const m = Array.isArray(o.material) ? o.material : [o.material];
        for (const mm of m) mm.needsUpdate = true;
      }
      if (o.isInstancedMesh && o.userData.decor) o.castShadow = Q.shadows;
    });
    this.resize();
    return wasScenery !== undefined && wasScenery !== Q.scenery;   // rebuild?
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

    g.add(this._buildSky(skyTop, skyBot, P.sun, bio));

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

    const tex = new THREE.CanvasTexture(buildSurfaceTexture(hole, bio));
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
      const stem = new THREE.CylinderGeometry(0.13, 0.2, 0.95, 5);
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

    const box = (mat, w, h, d, x, y, z, ry = 0) => {
      const m = new THREE.Mesh(cached(`pbox${w}_${h}_${d}`,
        () => new THREE.BoxGeometry(w, h, d)), mat);
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
      g.add(n);
    }
    return g;
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
    const m = new THREE.Mesh(geo, mat);
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
    const tuftGeo = cached('fol-tuft', () => new THREE.ConeGeometry(1, 1, 7));
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
      const parts = normaliseCanopy(species, treeParts(species, bio));
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
  _buildPin(hole, T, bio) {
    const grp = new THREE.Group();
    const y = T.heightAt(hole.pin.x, hole.pin.z);

    // the cup: a dark cylinder sunk into the green, plus a white liner ring
    const cupGeo = new THREE.CylinderGeometry(hole.cup.r, hole.cup.r, 0.32, 20, 1, true);
    const cup = new THREE.Mesh(cupGeo, new THREE.MeshBasicMaterial({ color: 0x0a0f07, side: THREE.BackSide }));
    cup.position.set(hole.cup.x, y - 0.16 + 0.005, hole.cup.z);
    grp.add(cup);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(hole.cup.r * 0.92, hole.cup.r * 1.06, 24),
      new THREE.MeshBasicMaterial({ color: 0xeef4ea, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(hole.cup.x, y + 0.012, hole.cup.z);
    grp.add(ring);

    // flagstick
    const stick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, 2.13, 8),
      new THREE.MeshLambertMaterial({ color: 0xf2f2ee })
    );
    stick.position.set(hole.pin.x, y + 1.065, hole.pin.z);
    stick.castShadow = true;
    grp.add(stick);

    // flag — a small plane we ripple in update()
    const flagGeo = new THREE.PlaneGeometry(0.52, 0.34, 12, 4);
    const flagMat = new THREE.MeshLambertMaterial({ color: 0xe8443a, side: THREE.DoubleSide });
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.set(hole.pin.x + 0.26, y + 1.92, hole.pin.z);
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
    const geo = new THREE.CylinderGeometry(0.085, 0.10, 0.11, 10);
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
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(1200 * 3), 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 });
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

  /* ------------------------------------------------------------ balls --- */
  syncBalls(players) {
    const seen = new Set();
    for (const p of players) {
      seen.add(p.pid);
      let b = this.balls.get(p.pid);
      if (!b) {
        const geo = new THREE.SphereGeometry(BALL_RADIUS, 18, 14);
        const mat = new THREE.MeshPhongMaterial({ color: new THREE.Color(p.color), shininess: 60, specular: 0x555555 });
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
      applyBallFinish(b.mesh.material, p.look?.ballFinish, p.color);
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
    const d = this.camera.position.distanceTo(b.mesh.position);
    const grow = 2.4 * Math.max(1, Math.pow(d / 22, 0.72));
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

  update(dt) {
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
    for (const w of this._water) {
      const sh = w.userData.mat.userData.sh;
      if (sh) sh.uniforms.uTime.value = this.t;
    }
    if (this.flag) {
      // ripple the flag and let it stream with the wind
      const g = this.flag.geometry;
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const fx = (x + 0.26) / 0.52;
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

function treeParts(species, bio) {
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
          geo: cached('skirt' + i, () => new THREE.ConeGeometry(r, h, 9)),
          mat: leafMat(col), off: [0, y, 0], scale: [1, 1, 1], color: new THREE.Color(col)
        };
      };
      const parts = [
        { geo: cached('conitrunk', () => new THREE.CylinderGeometry(0.022, 0.062, 1, 7)), mat: trunkMat(),
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
        { geo: cached('cedtrunk', () => new THREE.CylinderGeometry(0.012, 0.026, 1, 7)), mat: trunkMat(),
          off: [0, 0.5, 0], scale: [1, 1, 1], color: new THREE.Color(P.trunk) }
      ];
      for (let i = 0; i < 6; i++) {
        const t = i / 5;
        const r = 0.30 * (1 - t * 0.62);
        const hh = 0.26 * (1 - t * 0.30);
        const y = 0.26 + t * 0.70;
        const col = lightenHex(dark, t * 0.26);
        parts.push({
          geo: cached('cedskirt' + i, () => new THREE.ConeGeometry(r, hh, 8)),
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
        { geo: cached('euctrunk', () => new THREE.CylinderGeometry(0.026, 0.058, 1, 7)), mat: trunkMat(),
          off: [0, 0.5, 0], scale: [1, 1, 1], color: new THREE.Color(P.trunk) },
        { geo: cached('eucbranch', () => { const g = new THREE.CylinderGeometry(0.012, 0.028, 0.30, 5); g.translate(0, 0.15, 0); g.rotateZ(0.62); return g; }),
          mat: trunkMat(), off: [0, 0.70, 0], scale: [1, 1, 1], color: new THREE.Color(P.trunk) },
        { geo: cached('eucbranch2', () => { const g = new THREE.CylinderGeometry(0.012, 0.026, 0.26, 5); g.translate(0, 0.13, 0); g.rotateZ(-0.7); return g; }),
          mat: trunkMat(), off: [0, 0.76, 0], scale: [1, 1, 1], color: new THREE.Color(P.trunk) },
        { geo: cached('euclobeA', () => new THREE.IcosahedronGeometry(0.26, 1)), mat: leafMat(leaf),
          off: [0, 0.90, 0], scale: [1.1, 0.62, 1.1], color: new THREE.Color(leaf) },
        { geo: cached('euclobeB', () => new THREE.IcosahedronGeometry(0.17, 1)), mat: leafMat(lightenHex(leaf, 0.14)),
          off: [0.19, 0.83, 0.06], scale: [1, 0.66, 1], color: new THREE.Color(lightenHex(leaf, 0.14)) },
        { geo: cached('euclobeC', () => new THREE.IcosahedronGeometry(0.15, 1)), mat: leafMat(darkenHex(leaf, 0.12)),
          off: [-0.17, 0.86, -0.08], scale: [1, 0.66, 1], color: new THREE.Color(darkenHex(leaf, 0.12)) }
      ];
    }

    case 'palm': {
      const frond = '#4f9440';
      const parts = [
        { geo: cached('palmtrunk', () => {
            // a gently leaning trunk built from stacked segments
            const g = new THREE.CylinderGeometry(0.026, 0.055, 1, 9, 6);
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
          geo: cached('frond', () => {
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
        { geo: cached('bush', () => new THREE.IcosahedronGeometry(0.5, 1)), mat: leafMat(c),
          off: [0, 0.40, 0], scale: [1.15, 0.78, 1.15], color: new THREE.Color(c) },
        { geo: cached('bush2', () => new THREE.IcosahedronGeometry(0.34, 1)), mat: leafMat('#8a8b34'),
          off: [0.24, 0.52, 0.10], scale: [1, 0.8, 1], color: new THREE.Color('#8a8b34') },
        { geo: cached('bush3', () => new THREE.IcosahedronGeometry(0.28, 1)), mat: leafMat(darkenHex(c, 0.16)),
          off: [-0.22, 0.44, -0.14], scale: [1, 0.82, 1], color: new THREE.Color(darkenHex(c, 0.16)) },
        // the gorse flower that makes a links course yellow in spring
        { geo: cached('bushf', () => new THREE.IcosahedronGeometry(0.17, 0)), mat: leafMat('#d8c73c'),
          off: [0.05, 0.62, 0.16], scale: [1, 0.7, 1], color: new THREE.Color('#d8c73c') }
      ];
    }
    case 'saguaro': {
      const c = '#4b6b3d';
      const ribbed = (rt, rb, h, seg) => {
        const g = new THREE.CylinderGeometry(rt, rb, h, seg);
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
        { geo: cached('sagbody', () => ribbed(0.085, 0.10, 1, 12)), mat: leafMat(c),
          off: [0, 0.5, 0], scale: [1, 1, 1], color: new THREE.Color(c) },
        { geo: cached('sagcap', () => cap(0.085)), mat: leafMat(c),
          off: [0, 1.0, 0], scale: [1, 1, 1], color: new THREE.Color(c) },
        // right arm: out, then up
        { geo: cached('sagout', () => ribbed(0.055, 0.055, 0.20, 10)), mat: leafMat(c),
          off: [0.11, 0.62, 0], scale: [1, 1, 1], color: new THREE.Color(c), tiltZ: Math.PI / 2 },
        { geo: cached('sagup', () => ribbed(0.05, 0.055, 0.34, 10)), mat: leafMat(c),
          off: [0.20, 0.79, 0], scale: [1, 1, 1], color: new THREE.Color(c) },
        { geo: cached('sagupcap', () => cap(0.05)), mat: leafMat(c),
          off: [0.20, 0.96, 0], scale: [1, 1, 1], color: new THREE.Color(c) },
        // left arm, a little lower
        { geo: cached('sagout2', () => ribbed(0.05, 0.05, 0.17, 10)), mat: leafMat(c),
          off: [-0.10, 0.50, 0.02], scale: [1, 1, 1], color: new THREE.Color(c), tiltZ: Math.PI / 2 },
        { geo: cached('sagup2', () => ribbed(0.045, 0.05, 0.26, 10)), mat: leafMat(c),
          off: [-0.18, 0.63, 0.02], scale: [1, 1, 1], color: new THREE.Color(c) },
        { geo: cached('sagupcap2', () => cap(0.045)), mat: leafMat(c),
          off: [-0.18, 0.76, 0.02], scale: [1, 1, 1], color: new THREE.Color(c) }
      ];
    }
    case 'palo': {
      const c = '#7f9350';
      return [
        { geo: cached('cyl8', () => new THREE.CylinderGeometry(0.035, 0.055, 1, 6)), mat: trunkMat(),
          off: [0, 0.5, 0], scale: [1, 1, 1], color: new THREE.Color('#8d9a5e') },
        { geo: cached('ico1', () => new THREE.IcosahedronGeometry(0.42, 0)), mat: leafMat(c),
          off: [0, 0.92, 0], scale: [1, 0.62, 1], color: new THREE.Color(c) }
      ];
    }
    case 'maple': case 'oak': default: {
      const c = species === 'maple' ? '#5c8f3a' : '#43762f';
      // a tapered trunk, two lifted branches, and five overlapping canopy lobes
      return [
        { geo: cached('btrunk', () => new THREE.CylinderGeometry(0.028, 0.075, 1, 8)), mat: trunkMat(),
          off: [0, 0.5, 0], scale: [1, 1, 1], color: new THREE.Color(P.trunk) },
        { geo: cached('branchL', () => { const g = new THREE.CylinderGeometry(0.014, 0.032, 0.34, 5); g.translate(0, 0.17, 0); g.rotateZ(0.75); return g; }),
          mat: trunkMat(), off: [0, 0.50, 0], scale: [1, 1, 1], color: new THREE.Color(P.trunk) },
        { geo: cached('branchR', () => { const g = new THREE.CylinderGeometry(0.014, 0.032, 0.34, 5); g.translate(0, 0.17, 0); g.rotateZ(-0.8); return g; }),
          mat: trunkMat(), off: [0, 0.46, 0], scale: [1, 1, 1], color: new THREE.Color(P.trunk) },
        { geo: cached('lobeA', () => new THREE.IcosahedronGeometry(0.40, 1)), mat: leafMat(c),
          off: [0, 0.82, 0], scale: [1.05, 0.88, 1.05], color: new THREE.Color(c) },
        { geo: cached('lobeB', () => new THREE.IcosahedronGeometry(0.29, 1)), mat: leafMat(lightenHex(c, 0.16)),
          off: [0.20, 0.96, 0.10], scale: [1, 0.88, 1], color: new THREE.Color(lightenHex(c, 0.16)) },
        { geo: cached('lobeC', () => new THREE.IcosahedronGeometry(0.26, 1)), mat: leafMat(darkenHex(c, 0.14)),
          off: [-0.22, 0.74, -0.10], scale: [1, 0.9, 1], color: new THREE.Color(darkenHex(c, 0.14)) },
        { geo: cached('lobeD', () => new THREE.IcosahedronGeometry(0.23, 1)), mat: leafMat(lightenHex(c, 0.07)),
          off: [0.06, 0.68, -0.24], scale: [1, 0.9, 1], color: new THREE.Color(lightenHex(c, 0.07)) },
        { geo: cached('lobeE', () => new THREE.IcosahedronGeometry(0.21, 1)), mat: leafMat(darkenHex(c, 0.06)),
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
  burst(kind, x, y, z, n = 18) {
    const colors = {
      splash: 0xd6f0fb, sand: 0xf0e2b8, grass: 0x4e8a3c, leaves: 0x3f7a37,
      fire: 0xffa33a, smoke: 0x4a4a4a
    };
    // smoke drifts up and hangs; fire and debris are thrown and fall
    const rises = kind === 'smoke';
    const size = kind === 'splash' ? 0.09 : kind === 'smoke' ? 0.30 : kind === 'fire' ? 0.13 : 0.06;
    const geo = new THREE.SphereGeometry(size, 5, 4);
    const mat = new THREE.MeshBasicMaterial({
      color: colors[kind] || 0xffffff, transparent: true,
      opacity: rises ? 0.55 : 1, depthWrite: false
    });
    const inst = new THREE.InstancedMesh(geo, mat, n);
    inst.frustumCulled = false;
    const parts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + i * 0.7;
      const sp = kind === 'splash' ? 2.2 + (i % 5) * 0.9
        : kind === 'fire' ? 3.0 + (i % 5) * 1.2
          : rises ? 0.5 + (i % 4) * 0.25 : 1.4 + (i % 4) * 0.6;
      parts.push({
        x, y, z,
        vx: Math.cos(a) * sp * 0.6,
        vy: rises ? 1.1 + (i % 5) * 0.3 : (kind === 'fire' ? 3.4 : 2.2) + (i % 6) * 0.5,
        vz: Math.sin(a) * sp * 0.6
      });
    }
    this.parent.add(inst);
    this.items.push({
      inst, parts, life: rises ? 2.6 : kind === 'fire' ? 1.5 : 1.15,
      age: 0, mat, gravity: rises ? -0.4 : 9.8, grow: rises ? 1.7 : 1,
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
        it.inst.geometry.dispose(); it.mat.dispose();
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
