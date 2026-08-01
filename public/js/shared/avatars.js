/* =========================================================================
   avatars.js — who you are on the course
   -------------------------------------------------------------------------
   Appearance is a handful of colour choices, validated here so the server can
   reject anything odd without knowing how the model is built.  Shared by both
   sides; no DOM, no Three.js.
   ========================================================================= */

export const CAPS = [
  { name: 'White',    hex: '#f2f4f0' },
  { name: 'Navy',     hex: '#2b3f6b' },
  { name: 'Scarlet',  hex: '#c8382f' },
  { name: 'Forest',   hex: '#28603a' },
  { name: 'Sunflow',  hex: '#e8b93c' },
  { name: 'Slate',    hex: '#4a5560' },
  { name: 'Plum',     hex: '#6b3d78' },
  { name: 'Sky',      hex: '#4a9bd4' }
];

export const SHIRTS = [
  { name: 'White',    hex: '#eef1ec' },
  { name: 'Powder',   hex: '#7fb6dd' },
  { name: 'Coral',    hex: '#e8735a' },
  { name: 'Moss',     hex: '#5c8a4a' },
  { name: 'Mustard',  hex: '#d9a731' },
  { name: 'Charcoal', hex: '#3a4048' },
  { name: 'Lilac',    hex: '#a98cd8' },
  { name: 'Rose',     hex: '#dd7fa4' }
];

export const SKINS = [
  { name: 'Porcelain', hex: '#f0cdb4' },
  { name: 'Sand',      hex: '#dda87e' },
  { name: 'Bronze',    hex: '#b57a4e' },
  { name: 'Umber',     hex: '#7a4a2c' },
  { name: 'Ebony',     hex: '#4d2f1e' }
];

export const TROUSERS = [
  { name: 'Stone',   hex: '#cfc6b4' },
  { name: 'Navy',    hex: '#33415e' },
  { name: 'Charcoal',hex: '#3b4046' },
  { name: 'Olive',   hex: '#5f6444' },
  { name: 'Rust',    hex: '#9c5a35' }
];

const pick = (list, hex, i) => (list.find(c => c.hex === hex) || list[i % list.length]).hex;

/** Coerce whatever a client sent into a legal look. */
export function normaliseLook(look, seedIndex = 0) {
  const l = look && typeof look === 'object' ? look : {};
  return {
    cap: pick(CAPS, l.cap, seedIndex),
    shirt: pick(SHIRTS, l.shirt, seedIndex + 2),
    skin: pick(SKINS, l.skin, seedIndex),
    trousers: pick(TROUSERS, l.trousers, seedIndex + 1)
  };
}

/** How close you have to be to the ball before you may play it. */
export const SHOT_RADIUS = 4.0;          // metres.  1.5 was too tight to walk
                                        // into comfortably; 4 picks the club up
                                        // when you have genuinely arrived, and
                                        // the Cancel control is the way out.
/* Human speeds, and they matter more than they look.
   These were 4.6 and 9.2 m/s — 16 and 33 km/h, the second faster than the
   world 100 m record — which is why a 400 metre hole felt like nothing and
   the yardages read as decoration.  A brisk walk is 1.8 m/s and a jog with a
   bag is about 4.  Now a drive genuinely leaves you a walk, the cart is worth
   taking, and the numbers on the HUD mean something. */
export const WALK_SPEED = 3.1;           // m/s — a purposeful walk
export const SPRINT_SPEED = 8.4;         // m/s — a real sprint, holding Shift
export const AVATAR_HEIGHT = 1.78;       // metres, head to heel
export const EYE_HEIGHT = 1.62;
