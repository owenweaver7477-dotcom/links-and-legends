/* =========================================================================
   ballfinish.js — how an earned ball catches the light
   -------------------------------------------------------------------------
   Shared, because it is read in two places that must agree: the ball in
   flight (scene.js) and the ball on the shop turntable (shopview.js). They
   did not agree before — the shop drew every finish as the same shiny white
   sphere, so the one screen where somebody decides whether a finish is
   worth having was the one screen that could not show them the difference.

   ROUGHNESS AND METALNESS, not shininess and specular. These were Phong
   numbers, and Phong's highlight is a maths trick standing in for a
   reflection: it puts a white dot where a light is and knows nothing about
   what is actually around the ball. So "Chrome" was a ball with a big white
   dot on it, which is not what chrome looks like — chrome looks like the
   sky and the grass, bent.

   With an environment map (scene.js's _buildEnvironment for the course,
   shopview.js's studioEnv for the shop) these reflect something real, so
   chrome goes silver-blue on a clear morning and warm grey at dusk without
   anything here knowing what time it is. That is also why `metal` carries
   most of the difference between the finishes: a metal takes its colour
   FROM its reflection and a dielectric like matte plastic does not.

   `clear` is a clearcoat — the lacquer over the paint on a real ball, and
   what makes pearl and opal read as deep rather than merely shiny.

   A finish is how the ball catches the light, NOT a replacement for the
   player's own colour, so `tint` nudges that colour toward the finish's
   character rather than overriding it. Two players who both picked white
   still read as "different finish", not "their colour choice got taken
   away". matte has no tint at all: a flat finish should not look
   recoloured, just less shiny.
   ========================================================================= */

export const BALL_FINISH = {
  matte:  { rough: 0.86, metal: 0.00 },
  pearl:  { rough: 0.26, metal: 0.10, clear: 1.0, clearRough: 0.14,
            emissive: 0x0a0810, tint: '#f0e6f0' },
  chrome: { rough: 0.06, metal: 1.00, tint: '#e8ecf0' },
  opal:   { rough: 0.20, metal: 0.18, clear: 1.0, clearRough: 0.08,
            emissive: 0x140b10, tint: '#f4d8ec' },
  prism:  { rough: 0.10, metal: 0.62, clear: 1.0, clearRough: 0.05,
            emissive: 0x120a1c, tint: '#d8e8ff' },
  lava:   { rough: 0.52, metal: 0.20, emissive: 0x2e0b05, tint: '#ff6b3d' }
};

/** What an unrecognised or unset finish looks like: a normal golf ball. */
export const BALL_PLAIN = { rough: 0.42, metal: 0.04 };

export const ballFinish = id => BALL_FINISH[id] || BALL_PLAIN;

/**
 * Apply a finish to a MeshPhysicalMaterial, in place.
 *
 * `THREE` is passed in rather than imported so this file stays free of the
 * renderer — it is a table with a setter on it, and both callers already
 * have three loaded.
 */
export function applyBallFinish(THREE, mat, id, color) {
  const f = ballFinish(id);
  mat.roughness = f.rough;
  mat.metalness = f.metal;
  mat.clearcoat = f.clear || 0;
  mat.clearcoatRoughness = f.clearRough ?? 0;
  mat.emissive.setHex(f.emissive || 0x000000);
  /* A metal ball takes its colour from what it reflects, so a stronger
     environment on the shiny finishes is the difference between "chrome"
     and "light grey". Matte gets less than one: a matte ball picking up the
     sky as brightly as a mirror does is the whole reason flat finishes
     looked wrong before. */
  mat.envMapIntensity = 0.45 + (1 - f.rough) * 1.15;
  /* Re-set from `color` first rather than trusting whatever is already on
     the material, so the lerp below is idempotent regardless of call order
     and a second call can never nudge the tint further than the first. */
  if (color) mat.color.set(color);
  if (f.tint) mat.color.lerp(new THREE.Color(f.tint), 0.22);
  mat.needsUpdate = true;
}

/** The ball's own material. Physical rather than Standard because four of
 *  the six finishes want a clearcoat, and swapping the material class per
 *  finish would mean rebuilding the mesh every time somebody changed one.
 *  Physical with clearcoat 0 costs what Standard does. */
export function makeBallMaterial(THREE, color) {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color), roughness: BALL_PLAIN.rough,
    metalness: BALL_PLAIN.metal, envMapIntensity: 1.0
  });
}
