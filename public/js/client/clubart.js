/* =========================================================================
   clubart.js — the Pro Shop's artwork
   -------------------------------------------------------------------------
   The club sets were represented by emoji (🪵 🔩 ⚙️ 🖤 🏅 💠 👑) and the
   caddies still are. Emoji are a placeholder that looks like a decision:
   they render differently on every platform, they carry none of the game's
   own look, and a shop full of them reads as unfinished no matter how good
   the numbers underneath are.

   These are drawn instead. Inline SVG, so:
     - nothing is downloaded, and the 23 MB budget is untouched
     - it is crisp at any size and on any display
     - the palette is the game's, and a tier's finish is the finish its
       CLUB IN HAND actually has (see setClub() in avatar.js — the shaft and
       head colours below are the same hex values the 3D club is painted)

   That last point is the one that matters. The picture in the shop is the
   club you will be holding, not a generic icon standing in for it.
   ========================================================================= */

/* The seven finishes, matched to avatar.js `looks` so the shop and the
   course agree about what you bought. */
/* Cheapest first, so the art knows which tier it is drawing. */
const ORDER = ['wood', 'rust', 'steel', 'carbon', 'tour', 'titanium', 'signature'];

const FINISH = {
  wood:      { shaft: '#8a6a42', head: '#6e5432', grip: '#5a4630', glow: null,      name: 'rope-bound hickory' },
  rust:      { shaft: '#7a6a5c', head: '#8a5a42', grip: '#3f3a34', glow: null,      name: 'pitted iron' },
  steel:     { shaft: '#c9ccd2', head: '#3a3d42', grip: '#23262b', glow: null,      name: 'polished steel' },
  carbon:    { shaft: '#2e3136', head: '#1d1f24', grip: '#15171a', glow: null,      name: 'carbon weave' },
  tour:      { shaft: '#e8eaee', head: '#22242a', grip: '#1a1c20', glow: null,      name: 'tour chrome' },
  titanium:  { shaft: '#b8c4cc', head: '#4a5058', grip: '#2a2f35', glow: '#27424e', name: 'titanium' },
  signature: { shaft: '#d8c8f0', head: '#2a2438', grip: '#1d1828', glow: '#51286e', name: 'signature holo' }
};

/**
 * A driver, drawn side-on. One shape, seven finishes — because that is the
 * truth of the ladder: the same club, made better, not seven different clubs.
 *
 * @param look  a CLUB_TIERS `look` key
 * @param size  pixel box; the art is authored on a 64x64 grid and scales
 */
export function clubSvg(look, size = 56) {
  const f = FINISH[look] || FINISH.wood;
  const id = 'cg' + look;
  const tier = ORDER.indexOf(look);
  const premium = tier >= 4;          // Tour Pro and up

  /* The top three sets have to LOOK like what they cost. Same silhouette —
     it is still a driver — but the finish gets treatment the cheap ones do
     not have: a milled face, a crown badge, a rim light, and for the last
     two an actual glow. A player who has saved 120,000 coins should be able
     to tell at a glance, and previously the only difference between the
     Wooden Starter Set and the Signature Set was a hex value. */
  const glow = f.glow
    ? `<ellipse cx="20" cy="50" rx="17" ry="10" fill="${f.glow}" opacity=".7" filter="url(#b${id})"/>`
    : '';
  const defs = `
    <defs>
      <linearGradient id="s${id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${f.shaft}" stop-opacity="1"/>
        <stop offset=".45" stop-color="#ffffff" stop-opacity="${premium ? '.62' : '.38'}"/>
        <stop offset="1" stop-color="${f.shaft}" stop-opacity="1"/>
      </linearGradient>
      <linearGradient id="h${id}" x1="0" y1="0" x2=".6" y2="1">
        <stop offset="0" stop-color="#ffffff" stop-opacity="${premium ? '.46' : '.30'}"/>
        <stop offset=".5" stop-color="${f.head}"/>
        <stop offset="1" stop-color="#000000" stop-opacity=".35"/>
      </linearGradient>
      ${f.glow ? `<filter id="b${id}" x="-70%" y="-70%" width="240%" height="240%">
        <feGaussianBlur stdDeviation="4.5"/></filter>` : ''}
      ${premium ? `<pattern id="m${id}" width="2.2" height="2.2" patternUnits="userSpaceOnUse">
        <rect width="2.2" height="1.1" fill="#fff" opacity=".10"/></pattern>` : ''}
    </defs>`;

  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}"
      role="img" aria-label="${f.name} driver" class="clubart">
    ${defs}
    ${glow}
    <!-- grip -->
    <rect x="41" y="6" width="6.4" height="17" rx="3.2" fill="${f.grip}"/>
    <rect x="42.6" y="8" width="1.5" height="13" rx="0.7" fill="#fff" opacity=".13"/>
    ${premium ? `<rect x="41" y="6" width="6.4" height="3.2" rx="1.6" fill="${f.shaft}" opacity=".85"/>` : ''}
    <!-- shaft -->
    <path d="M44.2 22 L23.5 47.5" stroke="url(#s${id})" stroke-width="${premium ? 3.4 : 3.1}"
          stroke-linecap="round" fill="none"/>
    ${premium ? `<path d="M44.2 22 L23.5 47.5" stroke="#fff" stroke-width=".7"
          stroke-linecap="round" fill="none" opacity=".35"/>` : ''}
    <!-- head: a driver's rounded crown, sole flattened to the ground line -->
    <path d="M25.5 44.2 C18 42.5 10.5 45.4 9.2 50.2 C8.2 54 12 56.6 17.6 56.6
             C24.4 56.6 29.4 53.6 30.2 49.4 Z" fill="url(#h${id})"/>
    <!-- the face, catching the light -->
    <path d="M25.9 44.6 C22.6 45.6 20.6 47.6 20.1 50.4 C19.7 52.8 21.2 54.4 23.6 54.6
             C26.9 54.9 29.4 52.6 29.9 49.4 Z" fill="#fff" opacity="${premium ? '.22' : '.16'}"/>
    ${premium ? `<path d="M25.9 44.6 C22.6 45.6 20.6 47.6 20.1 50.4 C19.7 52.8 21.2 54.4 23.6 54.6
             C26.9 54.9 29.4 52.6 29.9 49.4 Z" fill="url(#m${id})"/>` : ''}
    ${premium ? `<path d="M25.5 44.2 C18 42.5 10.5 45.4 9.2 50.2"
          stroke="#fff" stroke-width="1.1" fill="none" opacity=".42"/>` : ''}
    ${tier >= 5 ? `<circle cx="17" cy="48.4" r="2.1" fill="${f.glow || '#fff'}" opacity=".9"/>
       <circle cx="17" cy="48.4" r="2.1" fill="none" stroke="#fff" stroke-width=".5" opacity=".7"/>` : ''}
    <!-- sole line, so it reads as sitting on the turf rather than floating -->
    <ellipse cx="19.6" cy="57" rx="11" ry="1.7" fill="#000" opacity=".26"/>
  </svg>`;
}

/**
 * The caddies. Same reasoning as the clubs: a flat, drawn badge in the
 * game's palette rather than a platform emoji. One shape per speciality, so
 * they are told apart at a glance rather than read.
 */
const CADDIE_ART = {
  ace: { c: '#ff6b52', d: 'M32 12 A20 20 0 1 1 31.9 12 M32 22 A10 10 0 1 1 31.9 22', r: true },
  bruiser: { c: '#ffb03a', d: 'M18 38 L26 20 L32 32 L38 20 L46 38 Z' },
  steady: { c: '#6fd0e0', d: 'M32 14 C22 24 22 40 32 50 C42 40 42 24 32 14 Z' },
  roller: { c: '#8fe07a', d: 'M14 44 C22 30 42 30 50 44 M32 44 m-5 0 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0' },
  pitstop: { c: '#c77dff', d: 'M16 20 H48 V32 H16 Z M20 32 V46 M44 32 V46' },
  lucky: { c: '#4ce0b3', d: 'M32 46 C20 38 18 24 26 20 C30 18 32 22 32 26 C32 22 34 18 38 20 C46 24 44 38 32 46 Z' },
  gale: { c: '#a9c9ff', d: 'M12 24 H40 A6 6 0 1 0 34 18 M12 34 H48 A6 6 0 1 1 42 40 M12 44 H34' },
  grit: { c: '#e8b93c', d: 'M32 12 L50 20 V34 C50 44 42 50 32 54 C22 50 14 44 14 34 V20 Z' }
};

export function caddieSvg(key, size = 34) {
  const a = CADDIE_ART[key];
  if (!a) return '';
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" class="caddieart"
      role="img" aria-hidden="true">
    <circle cx="32" cy="32" r="30" fill="${a.c}" opacity=".14"/>
    <path d="${a.d}" fill="${a.r ? 'none' : a.c}" stroke="${a.c}"
          stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round"
          ${a.r ? '' : 'fill-opacity=".22"'}/>
  </svg>`;
}

export const finishName = look => (FINISH[look] || FINISH.wood).name;

/* The five stat bars, drawn. Same reasoning as everything else here — 💪 and
   🛡️ render as three different things on three different machines, and one
   of them (🛡️) was arriving as two characters and breaking the alignment. */
const STAT_ART = {
  power:   { c: '#ff8a3d', d: 'M34 8 L14 36 H30 L26 56 L48 26 H32 Z' },
  accuracy:{ c: '#ff6b52', d: 'M32 8 A24 24 0 1 1 31.9 8 M32 20 A12 12 0 1 1 31.9 20 M32 30 A2 2 0 1 1 31.9 30' },
  forgive: { c: '#6fd0e0', d: 'M32 8 L52 16 V32 C52 44 43 52 32 56 C21 52 12 44 12 32 V16 Z' },
  short:   { c: '#8fe07a', d: 'M26 54 V14 L46 20 L26 26 M18 54 H38' },
  cart:    { c: '#c77dff', d: 'M12 22 H40 L48 32 H52 V42 H12 Z M20 42 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 M38 42 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0' }
};

export function statSvg(key, size = 15) {
  const a = STAT_ART[key];
  if (!a) return '';
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" class="statart"
      role="img" aria-hidden="true"><path d="${a.d}" fill="none" stroke="${a.c}"
      stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
