/* =========================================================================
   scene.js — the 3D world
   -------------------------------------------------------------------------
   Builds a hole into a Three.js scene: terrain mesh sampled from the same
   heightAt() the physics uses, the painted surface texture, water surfaces,
   instanced trees, flagstick and cup, and the player balls.
   ========================================================================= */

import * as THREE from '/vendor/three.module.js';
import { buildSurfaceTexture } from './surfacemap.js';
import { mulberry32, clamp, lerp, fbm, smoothstep } from '../shared/rng.js';
import { BALL_RADIUS } from '../shared/ballistics.js';
import { sharedBlobTexture } from './avatar.js';

const GRID_STEP = 1.8;          // metres between terrain vertices.  2.6 read
                                // as polygonal on every mound; 1.8 is the
                                // point where silhouettes become curves.
const _fwd = new THREE.Vector3();

export class GolfScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    // Shadow maps are the single most expensive thing here — a whole extra
    // pass over every caster — so they are OFF by default.  Avatars and balls
    // carry blob shadows instead, which cost one transparent quad each.
    // 'quality' turns the real sun shadow on for machines that can take it.
    this.quality = 'perf';
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;

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
   * Switch the graphics budget.  Only touches the shadow pass; geometry and
   * textures are already sized for the low end.
   */
  setQuality(q) {
    const on = q === 'quality';
    this.quality = q;
    this.renderer.shadowMap.enabled = on;
    this.renderer.shadowMap.autoUpdate = on;
    this.renderer.shadowMap.needsUpdate = true;
    if (this.sun) this.sun.castShadow = on;
    if (this.terrainMesh) this.terrainMesh.receiveShadow = on;
    // materials must be recompiled when the shadow path changes
    this.scene.traverse(o => { if (o.material) {
      const m = Array.isArray(o.material) ? o.material : [o.material];
      for (const mm of m) mm.needsUpdate = true;
    } });
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
    const skyTop = new THREE.Color(P.sky[0]);
    const skyBot = new THREE.Color(P.sky[1]);

    /* ---- atmosphere ---- */
    this.scene.fog = new THREE.Fog(new THREE.Color(P.fog), 210, 1150);
    this.scene.background = skyBot.clone();

    const hemi = new THREE.HemisphereLight(skyTop.clone(), new THREE.Color(P.rough), bio.ambient);
    g.add(hemi);

    const sunDir = dirFromAngles(bio.sunElev, bio.sunAzim);
    const sun = new THREE.DirectionalLight(new THREE.Color(P.sun), 1.55);
    sun.position.set(sunDir.x * 600, sunDir.y * 600, sunDir.z * 600);
    sun.castShadow = this.quality === 'quality';
    sun.shadow.mapSize.set(1536, 1536);
    const SH = 70;                       // metres of shadow coverage around the camera
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

    /* ---- flag, cup, tee markers ---- */
    g.add(this._buildPin(hole, terrain, bio));
    g.add(this._buildTeeMarkers(hole, terrain, bio));

    /* ---- aiming aids ---- */
    this.aimLine = this._buildAimLine();
    g.add(this.aimLine);
    this.traceLine = this._buildTrace();
    g.add(this.traceLine);

    this.fx = new EffectPool(g);
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
    mesh.receiveShadow = this.quality === 'quality';
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
    const RINGS = 10, SEGS = 128, SPREAD = 7.5, OVERLAP = 0.97;
    const pos = [], idx = [];

    // a point on the terrain's boundary rectangle at perimeter fraction t
    const boundary = (t) => {
      const u = (t % 1) * 4;
      if (u < 1) return [lerp(b.minX, b.maxX, u), b.minZ];
      if (u < 2) return [b.maxX, lerp(b.minZ, b.maxZ, u - 1)];
      if (u < 3) return [lerp(b.maxX, b.minX, u - 2), b.maxZ];
      return [b.minX, lerp(b.maxZ, b.minZ, u - 3)];
    };

    for (let r = 0; r <= RINGS; r++) {
      const t = r / RINGS;
      // start just INSIDE the terrain and a little below it: overlapping
      // guarantees no gap at the join, and the terrain hides the step
      const scale = lerp(OVERLAP, SPREAD, t * t);
      for (let s = 0; s <= SEGS; s++) {
        const [ex, ez] = boundary(s / SEGS);
        const x = cx + (ex - cx) * scale, z = cz + (ez - cz) * scale;
        const edge = T.heightAt(ex, ez);                       // exact rim height
        const far = fbm(x * 0.0016, z * 0.0016, hole.terrainSeed ^ 0x99, 3) * bio.relief * 3.2 - bio.relief * 0.6;
        // sink the ring a touch as it leaves the rim so the seam tucks under
        pos.push(x, lerp(edge - 0.6, far, smoothstep(0.02, 0.5, t)), z);
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
    geo.setIndex(idx);
    geo.computeVertexNormals();

    const col = new THREE.Color(bio.palette.deep);
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: col }));
    mesh.renderOrder = -0.5;
    grp.add(mesh);
    return grp;
  }

  /* ------------------------------------------------------------ water --- */
  _buildWater(w, level, bio) {
    const geo = new THREE.CircleGeometry(1, 56);
    const col = new THREE.Color(bio.palette.water);
    const mat = new THREE.MeshPhongMaterial({
      color: col, transparent: true, opacity: 0.86,
      shininess: 140, specular: new THREE.Color(0xbfe9ff),
      side: THREE.DoubleSide
    });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = { value: 0 };
      mat.userData.sh = sh;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime; varying vec2 vRip;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vRip = position.xy;
          // two octaves of gentle swell: ~3 m wavelength riding an ~8 m one,
          // peaks a little under a decimetre — water, not geometry
          transformed.z += sin(position.x*2.1 + uTime*1.4)*0.05
                         + sin(position.y*1.6 - uTime*0.9)*0.05
                         + sin((position.x+position.y)*0.75 + uTime*0.6)*0.035;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uTime; varying vec2 vRip;`)
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
          float r = sin(vRip.x*26.0 + uTime*2.2) * sin(vRip.y*21.0 - uTime*1.7);
          gl_FragColor.rgb += vec3(0.06,0.09,0.10) * smoothstep(0.55, 1.0, r);
          // depth read: dark middle, paler shallows, a breathing foam line at the bank
          float rad = length(vRip);
          gl_FragColor.rgb *= mix(0.72, 1.18, smoothstep(0.15, 1.0, rad));
          float foam = smoothstep(0.965, 0.995, rad + sin(atan(vRip.y, vRip.x)*9.0 + uTime*0.8)*0.006);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.92, 0.97, 0.98), foam * 0.55);`);
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
      alpine:   { amp: 300, jag: 0.9, clip: 1.0, col: '#5a6b78', snow: true },
      desert:   { amp: 130, jag: 0.5, clip: 0.55, col: '#8a5844', snow: false },
      links:    { amp: 55,  jag: 0.55, clip: 1.0, col: '#5d6b52', snow: false },
      parkland: { amp: 95,  jag: 0.35, clip: 1.0, col: '#3d5a40', snow: false },
      tropical: { amp: 70,  jag: 0.45, clip: 0.85, col: '#3f6b55', snow: false }
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
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const a = t * Math.PI * 2;
      const r = baseR * (1 + prof((t + 0.37) % 1) * 0.25);
      let h = Math.min(prof(t), ch.clip) * ch.amp + 8;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      pos.push(x, -6, z);  col.push(dark.r, dark.g, dark.b);
      pos.push(x, h, z);
      // snowline on the alpine ridge
      const top = ch.snow && h > ch.amp * 0.62 ? snowC : base;
      col.push(top.r, top.g, top.b);
    }
    for (let i = 0; i < N; i++) {
      const a = i * 2, c = a + 1, d = a + 2, e = a + 3;
      idx.push(a, d, c, c, d, e);
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
    const count = Math.round(10 * density);
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

    // What grows where.  [kind, colours, count, sizes, surfaces]
    const P = {
      parkland: {
        bush: { c: ['#2e6b33', '#39793b'], n: 95, s: [0.7, 1.5] },
        bloom: { c: ['#e86fa4', '#f2f2ee', '#d4548a'], per: 4 },
        tuft: { c: ['#4d8a3d', '#5f9c48'], n: 250, s: [0.35, 0.7] },
        rock: { c: ['#8d8a82'], n: 10, s: [0.4, 0.9] },
        reed: { c: ['#5d8f4a'], ring: 26 }
      },
      links: {
        bush: { c: ['#6d6b3f', '#7c7a48'], n: 46, s: [0.5, 1.1] },     // heather-gorse scrub
        bloom: { c: ['#b088c9', '#caa3de'], per: 3 },                  // heather purple
        tuft: { c: ['#a89c58', '#8f8f4e', '#b3a763'], n: 360, s: [0.4, 0.9] },  // marram
        rock: { c: ['#7d7f82', '#6e7073'], n: 26, s: [0.5, 1.4] },
        reed: { c: ['#9a915a'], ring: 20 }
      },
      desert: {
        bush: { c: ['#5d7042', '#6c7f4a'], n: 34, s: [0.5, 1.0] },     // sage scrub
        bloom: { c: ['#e8c25a'], per: 2 },                             // brittlebush yellow
        tuft: { c: ['#98915c', '#a89a62'], n: 140, s: [0.35, 0.8] },   // dry bunchgrass
        rock: { c: ['#a4674a', '#8f5a41', '#b0755a'], n: 44, s: [0.6, 2.0] },  // red rock
        reed: null                                                     // nothing grows by nothing
      },
      alpine: {
        bush: { c: ['#2f5e35', '#3a6b3e'], n: 52, s: [0.5, 1.1] },
        bloom: { c: ['#f2f0e6', '#e8c25a', '#7f9fd4'], per: 3 },       // wildflowers
        tuft: { c: ['#43803c', '#549147'], n: 280, s: [0.35, 0.75] },
        rock: { c: ['#8f9296', '#7b7f84'], n: 38, s: [0.6, 2.2] },     // granite
        reed: { c: ['#4d7a45'], ring: 18 }
      },
      tropical: {
        bush: { c: ['#1f7a3d', '#2a8a46'], n: 64, s: [0.7, 1.5] },
        bloom: { c: ['#e8452f', '#f2803d', '#e8377f'], per: 4 },       // hibiscus
        tuft: { c: ['#2f9448', '#3aa653'], n: 270, s: [0.4, 0.9] },
        rock: { c: ['#b3a48c', '#c2b49b'], n: 16, s: [0.4, 1.0] },     // coral stone
        reed: { c: ['#3f8a4a'], ring: 30 }
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
      inst.castShadow = this.quality === 'quality';
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
      const parts = treeParts(species, bio);
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
    const mat = new THREE.LineDashedMaterial({
      color: 0xffffff, dashSize: 1.6, gapSize: 1.1, transparent: true, opacity: 0.55, depthTest: false
    });
    const l = new THREE.Line(geo, mat);
    l.renderOrder = 5;
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

  setAimLine(points) {
    const l = this.aimLine;
    if (!points || points.length < 2) { l.visible = false; return; }
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
    if (this.sun && this.sunDir && this.quality === 'quality') {
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
      const m4 = new THREE.Matrix4();
      for (const d of drift) {
        d.baseX += dx * d.speed * dt;
        d.z += dz * d.speed * dt;
        if (d.baseX > cx + span) d.baseX -= span * 2;
        if (d.baseX < cx - span) d.baseX += span * 2;
        m4.makeRotationY(d.ry);
        m4.scale(new THREE.Vector3(d.sx, d.sy, d.sz));
        m4.setPosition(d.baseX, d.y, d.z);
        this.clouds.setMatrixAt(d.i, m4);
      }
      this.clouds.instanceMatrix.needsUpdate = true;
    }
    if (this.fx) this.fx.update(dt);
  }

  render(camera) { this.renderer.render(this.scene, camera || this.camera); }
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
function treeParts(species, bio) {
  const P = bio.palette;
  const trunkMat = () => new THREE.MeshLambertMaterial({ color: new THREE.Color(P.trunk) });
  const leafMat = (hex, opts = {}) => new THREE.MeshLambertMaterial(
    Object.assign({ color: new THREE.Color(hex), flatShading: true }, opts));

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
    const colors = { splash: 0xd6f0fb, sand: 0xf0e2b8, grass: 0x4e8a3c, leaves: 0x3f7a37 };
    const geo = new THREE.SphereGeometry(kind === 'splash' ? 0.09 : 0.06, 5, 4);
    const mat = new THREE.MeshBasicMaterial({ color: colors[kind] || 0xffffff, transparent: true });
    const inst = new THREE.InstancedMesh(geo, mat, n);
    inst.frustumCulled = false;
    const parts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + i * 0.7;
      const sp = kind === 'splash' ? 2.2 + (i % 5) * 0.9 : 1.4 + (i % 4) * 0.6;
      parts.push({
        x, y, z,
        vx: Math.cos(a) * sp * 0.6, vy: 2.2 + (i % 6) * 0.5, vz: Math.sin(a) * sp * 0.6
      });
    }
    this.parent.add(inst);
    this.items.push({ inst, parts, life: 1.15, age: 0, mat });
  }
  update(dt) {
    const m4 = new THREE.Matrix4();
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
      it.mat.opacity = 1 - k;
      for (let j = 0; j < it.parts.length; j++) {
        const p = it.parts[j];
        p.vy -= 9.8 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        m4.makeTranslation(p.x, p.y, p.z);
        it.inst.setMatrixAt(j, m4);
      }
      it.inst.instanceMatrix.needsUpdate = true;
    }
  }
}
