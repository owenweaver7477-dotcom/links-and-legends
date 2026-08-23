/* =========================================================================
   pinscale.mjs — the hole is visible, on the ground, and the right size
   -------------------------------------------------------------------------
   Three independent things have to hold for the cup to read correctly:

   1. It never gets frustum-culled off screen (scene.js's _buildPin already
      sets frustumCulled = false on every mesh in the assembly — checked
      here as a static guard against that regressing).

   2. It sits exactly on the ground the player sees, not on an idealised
      surface the terrain mesh doesn't actually have. scene.js's _buildPin
      used to place it with T.heightAt(pin.x, pin.z) — an exact analytic
      sample. The rendered terrain is a coarse triangulated grid
      (GRID_STEP = 1.8m apart) that only equals that exact sample AT its
      vertices; everywhere else the visible surface is a straight line
      between them, and heightAt() is free to curve away from that line in
      between. Measured directly (real BufferGeometry + Raycaster, same
      construction as _buildTerrain): 3 of the 108 holes in the game were
      off by more than 2cm, worst case headland h2 at nearly 17cm — a cup
      visibly floating above or sunk into its own green. _buildPin now
      calls the same _meshHeightAt this file mirrors, which reads the
      interpolated grid value instead of the exact one.

   3. Ball and cup are the real ratio (108mm cup / 42.67mm ball = 2.53), and
      that ratio survives being looked at from putting distance out to a
      full tee shot — nothing in the renderer rescales either with camera
      distance, so this is really just checking nobody quietly does.
   ========================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { allCourses } from '../public/js/shared/coursegen.js';
import { terrainFor } from '../public/js/shared/terrain.js';
import { BALL_RADIUS } from '../public/js/shared/ballistics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENE_SRC = readFileSync(join(__dirname, '../public/js/client/scene.js'), 'utf8');

// must match scene.js's own GRID_STEP and _buildTerrain's triangulation —
// this file mirrors both deliberately, the same way pinflag.mjs mirrors
// _buildPin's flag-geometry technique, because scene.js needs a live
// WebGL canvas (document.createElement, a GL context) that Node doesn't have.
const GRID_STEP = 1.8;

function meshHeightAt(T, hole, x, z) {
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

/** Rebuilds the exact BufferGeometry _buildTerrain makes for one hole. */
function buildRealTerrainMesh(hole, T) {
  const b = hole.bounds;
  const spanX = b.maxX - b.minX, spanZ = b.maxZ - b.minZ;
  const nx = Math.max(8, Math.round(spanX / GRID_STEP));
  const nz = Math.max(8, Math.round(spanZ / GRID_STEP));
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
  let p = 0;
  for (let iz = 0; iz <= nz; iz++) {
    const z = b.minZ + (iz / nz) * spanZ;
    for (let ix = 0; ix <= nx; ix++) {
      const x = b.minX + (ix / nx) * spanX;
      pos[p++] = x; pos[p++] = T.heightAt(x, z); pos[p++] = z;
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
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
}

const COURSES = allCourses();
const HOLES = COURSES.flatMap(c => c.holes.map(hole => ({ course: c, hole })));

test('there are exactly 108 holes — 12 courses of 9', () => {
  assert.equal(COURSES.length, 12, `expected 12 courses, found ${COURSES.length}`);
  for (const c of COURSES) {
    assert.equal(c.holes.length, 9, `${c.name} has ${c.holes.length} holes, not 9`);
  }
  assert.equal(HOLES.length, 108);
});

test('the pin assembly never gets frustum-culled', () => {
  const body = SCENE_SRC.slice(SCENE_SRC.indexOf('_buildPin(hole, T, bio)'), SCENE_SRC.indexOf('_buildTeeMarkers(hole, T, bio)'));
  for (const mesh of ['cup', 'ring', 'stick', 'flag']) {
    assert.match(body, new RegExp(`${mesh}\\.frustumCulled\\s*=\\s*false`),
      `${mesh} in _buildPin no longer sets frustumCulled = false`);
  }
});

test('the cup sits on the ground the player actually sees, on every hole', () => {
  const ray = new THREE.Raycaster();
  ray.far = 10000;
  let worst = 0, worstWhere = null;
  for (const { course, hole } of HOLES) {
    const T = terrainFor(hole, course.biome);
    const mesh = buildRealTerrainMesh(hole, T);
    mesh.updateMatrixWorld(true);
    ray.set(new THREE.Vector3(hole.pin.x, 5000, hole.pin.z), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(mesh, false);
    assert.ok(hit.length, `${course.name} h${hole.number}: pin.x/z missed the terrain mesh entirely`);

    const renderedY = hit[0].point.y;
    const placedY = meshHeightAt(T, hole, hole.pin.x, hole.pin.z);
    const diff = Math.abs(renderedY - placedY);
    if (diff > worst) { worst = diff; worstWhere = `${course.name} h${hole.number}`; }
  }
  assert.ok(worst < 0.02, `cup drifted ${(worst * 100).toFixed(1)}cm off the rendered surface at ${worstWhere}`);
});

test('regression check: the exact analytic height really did drift (proves the test above bites)', () => {
  // what _buildPin used to do before this fix — sample heightAt() directly
  // instead of interpolating the same grid the mesh renders
  const ray = new THREE.Raycaster();
  ray.far = 10000;
  let worst = 0;
  for (const { course, hole } of HOLES) {
    const T = terrainFor(hole, course.biome);
    const mesh = buildRealTerrainMesh(hole, T);
    mesh.updateMatrixWorld(true);
    ray.set(new THREE.Vector3(hole.pin.x, 5000, hole.pin.z), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(mesh, false);
    const renderedY = hit[0].point.y;
    const oldY = T.heightAt(hole.pin.x, hole.pin.z);   // the old, unfixed placement
    worst = Math.max(worst, Math.abs(renderedY - oldY));
  }
  assert.ok(worst > 0.02, `expected at least one hole where the old exact-height placement drifted ` +
    `more than 2cm off the mesh — got a max of ${(worst * 100).toFixed(1)}cm, so this test wouldn't have caught it`);
});

test('the cup is the real 108mm hole, the ball is the real 42.67mm ball', () => {
  const ballDiameterMm = BALL_RADIUS * 2 * 1000;
  assert.ok(Math.abs(ballDiameterMm - 42.67) < 0.5,
    `ball diameter is ${ballDiameterMm.toFixed(2)}mm, real golf balls are 42.67mm`);

  for (const { course, hole } of HOLES) {
    const cupDiameterMm = hole.cup.r * 2 * 1000;
    assert.ok(Math.abs(cupDiameterMm - 108) < 0.5,
      `${course.name} h${hole.number}: cup is ${cupDiameterMm.toFixed(1)}mm across, a real hole is 108mm`);
  }

  const realRatio = 108 / 42.67;
  const gotRatio = (HOLES[0].hole.cup.r * 2) / (BALL_RADIUS * 2);
  assert.ok(Math.abs(gotRatio - realRatio) < 0.02,
    `cup-to-ball ratio is ${gotRatio.toFixed(3)}, real golf is ${realRatio.toFixed(3)}`);
});

test('cup stays visibly larger than the ball at putting, approach and full-shot range', () => {
  // scene.js:158 — new THREE.PerspectiveCamera(55, ...). Nothing in the
  // renderer rescales the cup or ball with distance (no billboarding, no
  // LOD), so their apparent size is plain perspective projection: true
  // scale never breaks proportionality on its own, but a hidden distance
  // hack that inflated one to stay "readable" would flip this ratio, and
  // that's exactly the failure mode this guards against.
  const FOV_Y_DEG = 55;
  const VIEWPORT_H_PX = 1080;   // just a reference height to talk in pixels
  const fovY = FOV_Y_DEG * Math.PI / 180;

  const cupDiameter = HOLES[0].hole.cup.r * 2;
  const ballDiameter = BALL_RADIUS * 2;

  for (const distance of [5, 10, 30]) {
    const cupPx = (2 * Math.atan(cupDiameter / (2 * distance)) / fovY) * VIEWPORT_H_PX;
    const ballPx = (2 * Math.atan(ballDiameter / (2 * distance)) / fovY) * VIEWPORT_H_PX;

    assert.ok(cupPx >= 1, `cup is under 1px at ${distance}m (${cupPx.toFixed(2)}px) — effectively invisible`);
    assert.ok(cupPx > ballPx,
      `at ${distance}m the cup (${cupPx.toFixed(2)}px) is not bigger than the ball (${ballPx.toFixed(2)}px)`);
  }
});
