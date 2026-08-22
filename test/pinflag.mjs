/* =========================================================================
   pinflag.mjs — the flag stays on the pole at every wind angle
   -------------------------------------------------------------------------
   The reported symptom was "flag not attached to the pole". The actual bug
   (scene.js's _buildPin) was a flag mesh positioned 0.26m off the pole with
   its geometry centred on its own visual middle, then rotated by
   `flag.rotation.y = windDir + PI/2` every frame — which spins a mesh
   around its OWN LOCAL ORIGIN, not around the pole. At wind = 0 the two
   happen to coincide and it looks fine; at any other wind angle the
   pole-attached edge swings away from the pole, which is exactly what
   "detached" looks like and exactly why it wasn't caught by eye alone.

   The fix translates the geometry so the mesh's local origin IS the
   pole-attached edge, so rotating the mesh rotates it around the pole. This
   test rebuilds that exact technique with real three.js transforms (no
   WebGL needed — Object3D math runs fine headless) and checks the
   invariant directly: for a full sweep of wind directions, the edge that
   is supposed to be pinned to the pole stays there, in world space, after
   the same rotation the renderer applies every frame.
   ========================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlaneGeometry, Mesh, MeshBasicMaterial, Vector3 } from 'three';

const POLE = new Vector3(1234.5, 67.8, -910.1);   // arbitrary, not near any origin special-case
const EPS = 1e-6;

function buildFlag() {
  // exactly what scene.js's _buildPin does: a 0.52 x 0.34 plane, translated
  // so local x runs [0, 0.52] instead of [-0.26, 0.26], positioned at the
  // pole with no offset.
  const geo = new PlaneGeometry(0.52, 0.34, 12, 4);
  geo.translate(0.26, 0, 0);
  const flag = new Mesh(geo, new MeshBasicMaterial());
  flag.position.copy(POLE);
  return flag;
}

test('the pole-attached edge stays at the pole across every wind direction', () => {
  const flag = buildFlag();
  const edgeLocal = new Vector3(0, 0, 0);   // the edge meant to sit on the pole

  for (const windDir of [0, 0.3, 1, Math.PI / 2, 2, Math.PI, -1.5, -Math.PI, 5.9]) {
    flag.rotation.y = windDir + Math.PI / 2;
    flag.updateMatrixWorld(true);
    const worldEdge = edgeLocal.clone().applyMatrix4(flag.matrixWorld);
    const dist = worldEdge.distanceTo(POLE);
    assert.ok(dist < EPS, `wind ${windDir}: pole-edge drifted ${dist}m from the pole`);
  }
});

test('the free edge actually swings — this is a rotating flag, not a frozen one', () => {
  const flag = buildFlag();
  const freeLocal = new Vector3(0.52, 0, 0);   // the far edge, meant to swing

  flag.rotation.y = 0 + Math.PI / 2;
  flag.updateMatrixWorld(true);
  const a = freeLocal.clone().applyMatrix4(flag.matrixWorld);

  flag.rotation.y = Math.PI / 2 + Math.PI / 2;
  flag.updateMatrixWorld(true);
  const b = freeLocal.clone().applyMatrix4(flag.matrixWorld);

  assert.ok(a.distanceTo(b) > 0.4, 'the free edge barely moved between two very different wind directions');
});

test('regression check: the pre-fix construction really did detach (proves this test bites)', () => {
  // the ORIGINAL construction: an untranslated, centre-origin plane offset
  // 0.26m from the pole, rotated the same way. If this stayed passing, the
  // test above would not actually be testing anything.
  const geo = new PlaneGeometry(0.52, 0.34, 12, 4);   // no translate — old code
  const flag = new Mesh(geo, new MeshBasicMaterial());
  flag.position.set(POLE.x + 0.26, POLE.y, POLE.z);   // old offset position

  const edgeLocal = new Vector3(-0.26, 0, 0);          // old pole-attached edge
  flag.rotation.y = 1 + Math.PI / 2;                   // any non-zero wind
  flag.updateMatrixWorld(true);
  const worldEdge = edgeLocal.clone().applyMatrix4(flag.matrixWorld);

  assert.ok(worldEdge.distanceTo(POLE) > 0.1, 'expected the old construction to drift off the pole');
});
