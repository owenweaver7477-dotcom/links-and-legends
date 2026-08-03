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
  { name: 'Sky',      hex: '#4a9bd4' },
  { name: 'Black',    hex: '#1d2024' },
  { name: 'Sand',     hex: '#d9c9a3' },
  { name: 'Teal',     hex: '#2b8a86' },
  { name: 'Cherry',   hex: '#e35d7b' }
];

export const SHIRTS = [
  { name: 'White',    hex: '#eef1ec' },
  { name: 'Powder',   hex: '#7fb6dd' },
  { name: 'Coral',    hex: '#e8735a' },
  { name: 'Moss',     hex: '#5c8a4a' },
  { name: 'Mustard',  hex: '#d9a731' },
  { name: 'Charcoal', hex: '#3a4048' },
  { name: 'Lilac',    hex: '#a98cd8' },
  { name: 'Rose',     hex: '#dd7fa4' },
  { name: 'Emerald',  hex: '#2f9e6a' },
  { name: 'Cobalt',   hex: '#3560c4' },
  { name: 'Burgundy', hex: '#7d2f42' },
  { name: 'Sky',      hex: '#a8dced' },
  { name: 'Tangerine',hex: '#f08a3c' },
  { name: 'Ink',      hex: '#232833' }
];

/* A proper range rather than five steps: the previous list jumped from
   porcelain to ebony in five, which left most people unable to find
   themselves on it. */
export const SKINS = [
  { name: 'Alabaster', hex: '#f7ddc8' },
  { name: 'Porcelain', hex: '#f0cdb4' },
  { name: 'Ivory',     hex: '#e8bd9c' },
  { name: 'Sand',      hex: '#dda87e' },
  { name: 'Honey',     hex: '#cd9264' },
  { name: 'Bronze',    hex: '#b57a4e' },
  { name: 'Chestnut',  hex: '#96603c' },
  { name: 'Umber',     hex: '#7a4a2c' },
  { name: 'Cocoa',     hex: '#603a26' },
  { name: 'Ebony',     hex: '#4d2f1e' },
  { name: 'Onyx',      hex: '#3a2318' }
];

export const TROUSERS = [
  { name: 'Stone',   hex: '#cfc6b4' },
  { name: 'Navy',    hex: '#33415e' },
  { name: 'Charcoal',hex: '#3b4046' },
  { name: 'Olive',   hex: '#5f6444' },
  { name: 'Rust',    hex: '#9c5a35' },
  { name: 'White',   hex: '#e9e6dc' },
  { name: 'Pink',    hex: '#dba0ad' },
  { name: 'Mint',    hex: '#9dc9ae' },
  { name: 'Plaid',   hex: '#8a6b4a' },
  { name: 'Black',   hex: '#24272c' }
];

/* -------------------------------------------------------------- styles ---
   Everything below is SHAPE rather than colour, and every one of them is
   built out of the same boxes the golfer is already made of — no meshes are
   downloaded, no textures exist, and adding a style costs nothing but the
   handful of vertices it draws.  That is what keeps a wardrobe this size
   inside the build budget.

   `id` is what travels on the wire and gets stored; the label is local. */
export const HAT_STYLES = [
  { id: 'cap',    name: 'Cap' },
  { id: 'visor',  name: 'Visor' },
  { id: 'bucket', name: 'Bucket' },
  { id: 'beanie', name: 'Beanie' },
  { id: 'flat',   name: 'Flat cap' },
  { id: 'none',   name: 'Bare head' }
];

export const HAIR_STYLES = [
  { id: 'short',    name: 'Short' },
  { id: 'buzz',     name: 'Buzz' },
  { id: 'swept',    name: 'Swept' },
  { id: 'ponytail', name: 'Ponytail' },
  { id: 'bun',      name: 'Bun' },
  { id: 'afro',     name: 'Afro' },
  { id: 'long',     name: 'Long' },
  { id: 'bald',     name: 'Bald' }
];

export const HAIR_COLORS = [
  { name: 'Black',    hex: '#241c18' },
  { name: 'Espresso', hex: '#3d2a1e' },
  { name: 'Chestnut', hex: '#6b4327' },
  { name: 'Auburn',   hex: '#8f4326' },
  { name: 'Ginger',   hex: '#c4622a' },
  { name: 'Sand',     hex: '#c9a066' },
  { name: 'Blonde',   hex: '#e3c884' },
  { name: 'Platinum', hex: '#e8e2d2' },
  { name: 'Grey',     hex: '#a8a49c' },
  { name: 'Silver',   hex: '#d6d8da' }
];

/* -------------------------------------------------------------- builds ---
   Body shape, as its own slot.  Everyone was one figure with square
   shoulders, which is a poor showing for a game where you look at your
   golfer from behind for an entire round.

   Named for the SILHOUETTE rather than for a gender: a player picks the shape
   they want to see, and that is a shorter list of decisions and a kinder one.

   The numbers are multipliers on the base rig, and one thing is deliberately
   NOT among them — the shoulders. The club hangs off the right arm, and the
   stance is solved from a MEASURED reach of 0.698 m forward and 0.526 m to
   the side (CLUB_REACH_FWD / CLUB_REACH_SIDE in main.js). Move the shoulder
   anchor and the club stops landing on the ball, which is a bug that took a
   long time to find the first time. So every build shares an identical
   shoulder position, arm length and club mount; the difference is all in the
   torso, hips and leg proportion, which is plenty to read at distance. */
export const BODIES = [
  { id: 'straight', name: 'Straight',
    chest: 1.00, waist: 0.95, hips: 0.98, bust: 0,
    hipSpread: 1.00, legLen: 1.00, limb: 1.00, depth: 1.00 },
  { id: 'curved', name: 'Curved',
    // narrower through the shoulders, a real waist, wider hips, and legs
    // that take up more of the same overall height
    chest: 0.88, waist: 0.76, hips: 1.04, bust: 0.075,
    hipSpread: 1.16, legLen: 1.06, limb: 0.92, depth: 0.94 },
  { id: 'broad', name: 'Broad',
    chest: 1.12, waist: 1.14, hips: 1.10, bust: 0,
    hipSpread: 1.06, legLen: 0.96, limb: 1.14, depth: 1.16 },
  { id: 'slight', name: 'Slight',
    chest: 0.90, waist: 0.84, hips: 0.88, bust: 0,
    hipSpread: 0.94, legLen: 1.03, limb: 0.88, depth: 0.90 }
];

export const ACCESSORIES = [
  { id: 'none',    name: 'None' },
  { id: 'glasses', name: 'Glasses' },
  { id: 'shades',  name: 'Shades' },
  { id: 'towel',   name: 'Towel' },
  { id: 'glove',   name: 'Glove' }
];

export const SHOES = [
  { name: 'Black',  hex: '#2b2b2f' },
  { name: 'White',  hex: '#e6e6e0' },
  { name: 'Tan',    hex: '#a97c4d' },
  { name: 'Red',    hex: '#b8382f' },
  { name: 'Navy',   hex: '#2c3a5c' },
  { name: 'Green',  hex: '#3a6b45' }
];

const pick = (list, hex, i) => (list.find(c => c.hex === hex) || list[i % list.length]).hex;
const pickId = (list, id, i) => (list.find(c => c.id === id) || list[i % list.length]).id;

/**
 * Coerce whatever a client sent into a legal look.  Anything unrecognised
 * falls back to a seeded default rather than being rejected, so an older
 * client that only knows the original four colours still produces a complete,
 * valid golfer — and a new field appearing here never invalidates a look
 * already saved against a player.
 */
export function normaliseLook(look, seedIndex = 0) {
  const l = look && typeof look === 'object' ? look : {};
  return {
    cap: pick(CAPS, l.cap, seedIndex),
    shirt: pick(SHIRTS, l.shirt, seedIndex + 2),
    skin: pick(SKINS, l.skin, seedIndex),
    trousers: pick(TROUSERS, l.trousers, seedIndex + 1),
    hat: pickId(HAT_STYLES, l.hat, 0),
    hair: pickId(HAIR_STYLES, l.hair, seedIndex + 1),
    hairColor: pick(HAIR_COLORS, l.hairColor, seedIndex),
    accessory: pickId(ACCESSORIES, l.accessory, 0),
    body: pickId(BODIES, l.body, 0),
    shoes: pick(SHOES, l.shoes, 0)
  };
}

/** A complete random outfit, for the dice button. */
export function randomLook() {
  const any = a => a[(Math.random() * a.length) | 0];
  return normaliseLook({
    cap: any(CAPS).hex, shirt: any(SHIRTS).hex, skin: any(SKINS).hex,
    trousers: any(TROUSERS).hex, hat: any(HAT_STYLES).id,
    hair: any(HAIR_STYLES).id, hairColor: any(HAIR_COLORS).hex,
    accessory: any(ACCESSORIES).id, shoes: any(SHOES).hex,
    body: any(BODIES).id
  });
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

/* F — "get me to my ball".  This is a convenience action, not a skill test:
   nobody wants to watch their golfer cover 200 metres at jogging pace with
   nothing to do, and it used to run at SPRINT_SPEED, which made a good drive
   a twenty-four second wait.

   Scaled by DISTANCE rather than run at a flat speed, so the trip takes about
   the same short time whether the ball is thirty metres away or two hundred.
   A flat speed can't do that — fast enough for a long drive is a teleport
   across a chip. Floored at the sprint so it is never slower than running
   yourself, capped so it stays a run rather than a blur. The walk cycle
   already flattens its stride above 10 m/s, so it still reads as sprinting. */
export const BALL_DASH_SECONDS = 3.0;    // the trip we aim for, at any distance
export const BALL_DASH_MAX = 26;         // m/s ceiling — 94 km/h.  Past about
                                         // this the golfer stops reading as a
                                         // sprinting person and starts looking
                                         // fired from a cannon; this is the
                                         // one number to raise if the walk
                                         // still feels long.

/** How fast to cover `dist` metres when the player presses F. */
export const ballDashSpeed = dist =>
  Math.max(SPRINT_SPEED, Math.min(BALL_DASH_MAX, dist / BALL_DASH_SECONDS));
export const AVATAR_HEIGHT = 1.78;       // metres, head to heel
export const EYE_HEIGHT = 1.62;
