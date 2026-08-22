/* =========================================================================
   icons.js — every UI icon in the game, drawn rather than borrowed
   -------------------------------------------------------------------------
   The HUD used to lean on system emoji for coins, gems, cases, rarity
   badges and status glyphs. That is a font, not art: the same 🪙 renders as
   a different drawing on every OS, some platforms fall back to a mono
   outline glyph, and none of it was ever drawn to sit next to this game's
   own geometric, low-poly look.

   These are small flat SVGs instead — the same shape on every device,
   coloured to the palette the rest of the game already uses (the gold of
   `.ch-coins`/`.coinbal`, the rarity colours in shared/cases.js), sized to
   drop inline wherever a template string used to hold an emoji character.
   Nothing is loaded: like every other asset in this game, an icon is a
   handful of coordinates, not a file.
   ========================================================================= */

/* Each entry is the INNER markup of a 0 0 24 24 viewBox — icon() wraps it.
   Colour is baked in for icons with a fixed identity (a coin is always
   gold), and left as currentColor for neutral status glyphs that should
   pick up whatever colour their surrounding text already has. */
const ICONS = {
  coin: `
    <circle cx="12" cy="12" r="9.5" fill="#ffd76b" stroke="#a9822f" stroke-width="1.4"/>
    <circle cx="12" cy="12" r="6.2" fill="none" stroke="#a9822f" stroke-width="1.1" opacity=".55"/>
    <circle cx="12" cy="12" r="1.8" fill="#a9822f" opacity=".55"/>
  `,
  gem: `
    <path d="M12 2 20 8 12 22 4 8Z" fill="#57b8e6"/>
    <path d="M12 2 20 8 12 8Z" fill="#a6e6ff"/>
    <path d="M12 2 4 8 12 8Z" fill="#8fdfff"/>
    <path d="M4 8 12 8 12 22Z" fill="#4a9fce"/>
    <path d="M20 8 12 8 12 22Z" fill="#3f8dbb"/>
  `,
  // the loot case itself — a small chest, not a shipping box
  case: `
    <path d="M3 11q0-6 9-6t9 6" fill="#a9723c" stroke="#5c3a1a" stroke-width="1.1" stroke-linejoin="round"/>
    <rect x="3" y="11" width="18" height="9" rx="2" fill="#8a5a2e" stroke="#5c3a1a" stroke-width="1.1"/>
    <rect x="9.6" y="13" width="4.8" height="4.4" rx="1" fill="#ffd76b" stroke="#5c3a1a" stroke-width=".8"/>
  `,
  /* The next five (gift, decal, trail, title, ball) are the CASE-REVEAL set:
     drawn in currentColor rather than baked-in colours, on purpose. The
     reveal already tints el.caseItemArt to the pulled item's own colour or
     its rarity colour (style.color = result.item.color || rarity.color) —
     that line was always a no-op against a colour emoji, which cannot be
     recoloured at all. A currentColor silhouette is what actually lets one
     shape become "this decal, in its colour" or "this trail, in gold for a
     legendary pull" instead of the same fixed glyph every time. Shading
     inside each shape is done with opacity on the same colour, never a
     second hardcoded one, so it still reads correctly whatever it's tinted. */

  // fallback reward icon: a wrapped gift, for whatever a case-kind lookup misses
  gift: `
    <rect x="4" y="10" width="16" height="11" rx="1.5" fill="currentColor"/>
    <rect x="4" y="7" width="16" height="4" rx="1" fill="currentColor" opacity=".82"/>
    <rect x="11" y="7" width="2" height="14" fill="#000" opacity=".16"/>
    <path d="M12 7c-1-3-5-3-5 0M12 7c1-3 5-3 5 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  `,
  // a sticker with a dog-eared corner, for the decal cosmetic slot
  decal: `
    <path d="M5 3h10l6 6v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" fill="currentColor"/>
    <path d="M15 3v6h6Z" fill="currentColor" opacity=".45"/>
  `,
  // a comet: the flight-trail cosmetic
  trail: `
    <path d="M4 18c4-1 7-4 8-9" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none" opacity=".4"/>
    <path d="M7.5 15.5c3-1 5-3 6-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" opacity=".7"/>
    <circle cx="17" cy="6" r="3" fill="currentColor"/>
  `,
  // ribbon medal, for a claimed title
  title: `
    <path d="M8 2 4 9l4 2 2-4Z" fill="currentColor" opacity=".7"/>
    <path d="M16 2l4 7-4 2-2-4Z" fill="currentColor" opacity=".7"/>
    <circle cx="12" cy="14" r="7" fill="currentColor"/>
    <circle cx="12" cy="14" r="3.4" fill="#000" opacity=".16"/>
  `,
  // a plain golf ball, for the ball-cosmetic slot
  ball: `
    <circle cx="12" cy="12" r="9" fill="currentColor"/>
    <circle cx="9" cy="9" r=".9" fill="#000" opacity=".16"/>
    <circle cx="13.4" cy="8" r=".9" fill="#000" opacity=".16"/>
    <circle cx="16" cy="11.6" r=".9" fill="#000" opacity=".16"/>
    <circle cx="9" cy="13.4" r=".9" fill="#000" opacity=".16"/>
    <circle cx="13" cy="15.4" r=".9" fill="#000" opacity=".16"/>
  `,
  trophy: `
    <path d="M7 4h10v3a5 5 0 0 1-10 0V4Z" fill="#ffd76b" stroke="#a9822f" stroke-width="1"/>
    <path d="M7 5H4a3 3 0 0 0 3 3M17 5h3a3 3 0 0 1-3 3" fill="none" stroke="#a9822f" stroke-width="1.3" stroke-linecap="round"/>
    <rect x="10" y="13" width="4" height="4" fill="#a9822f"/>
    <rect x="7" y="19" width="10" height="2" rx="1" fill="#a9822f"/>
  `,
  crown: `
    <path d="M4 18h16l1-9-5 4-4-6-4 6-5-4 1 9Z" fill="#ffd76b" stroke="#a9822f" stroke-width="1.2" stroke-linejoin="round"/>
    <rect x="4" y="18" width="16" height="2.5" rx="1" fill="#a9822f"/>
  `,
  star: `
    <path d="M12 2 14.9 8.6 22 9.3 16.6 14.1 18.2 21.1 12 17.4 5.8 21.1 7.4 14.1 2 9.3 9.1 8.6Z"
          fill="#ffd76b" stroke="#a9822f" stroke-width="1"/>
  `,
  // the same star, hollow — an un-favourited toggle rather than a rating
  starOff: `
    <path d="M12 2 14.9 8.6 22 9.3 16.6 14.1 18.2 21.1 12 17.4 5.8 21.1 7.4 14.1 2 9.3 9.1 8.6Z"
          fill="none" stroke="currentColor" stroke-width="1.3" opacity=".7"/>
  `,
  golfer: `
    <circle cx="9" cy="5" r="2.4" fill="currentColor"/>
    <path d="M9 7.5v6l-3 7M9 13.5l5 2M12 9l7-2" fill="none" stroke="currentColor"
          stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  `,
  // a ball found the water
  droplet: `
    <path d="M12 2c4 5 7 9 7 12a7 7 0 0 1-14 0c0-3 3-7 7-12Z" fill="#5ab8ff"/>
    <path d="M8.5 14a3.5 3.5 0 0 0 2 3" stroke="#bfe6ff" stroke-width="1.4" stroke-linecap="round" fill="none" opacity=".8"/>
  `,
  flag: `
    <line x1="6" y1="21" x2="6" y2="4" stroke="#5c3a1a" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M6 4 17 8 6 12Z" fill="#e8443a"/>
    <ellipse cx="6" cy="21" rx="4.5" ry="1.4" fill="#6f8f5c" opacity=".55"/>
  `,
  lock: `
    <rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor" opacity=".85"/>
    <path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2" opacity=".85"/>
    <circle cx="12" cy="15.6" r="1.5" fill="var(--icon-lock-pin, #23261f)"/>
  `,
  check: `
    <path d="M4 12.5 9 17.5 20 6" fill="none" stroke="currentColor" stroke-width="2.6"
          stroke-linecap="round" stroke-linejoin="round"/>
  `,
  cancel: `
    <path d="M5 5 19 19M19 5 5 19" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
  `,
  warning: `
    <path d="M12 3 2 20h20Z" fill="#ffb14a" stroke="#c9832e" stroke-width="1" stroke-linejoin="round"/>
    <rect x="11" y="9.5" width="2" height="5.5" rx="1" fill="#3a2a12"/>
    <circle cx="12" cy="17" r="1.1" fill="#3a2a12"/>
  `,
  // activity feed: a hole-in-one
  target: `
    <circle cx="12" cy="12" r="9" fill="#e8443a"/>
    <circle cx="12" cy="12" r="6" fill="#f4f6f2"/>
    <circle cx="12" cy="12" r="3" fill="#e8443a"/>
  `,
  // activity feed: eagle / albatross — a pair of swept wings, not a literal bird
  eagle: `
    <path d="M2 13c4-6 8-6 10-2 2-4 6-4 10 2-4-2-7-1-10 3-3-4-6-5-10-3Z" fill="#8fa88a"/>
  `,
  // activity feed: a new personal best
  trending: `
    <path d="M3 17 9 11 13 15 21 6" fill="none" stroke="#8fe07a" stroke-width="2.2"
          stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M15 6h6v6" fill="none" stroke="#8fe07a" stroke-width="2.2"
          stroke-linecap="round" stroke-linejoin="round"/>
  `,
  // activity feed: a player joined
  joined: `
    <circle cx="12" cy="7" r="4" fill="#8fb0ff"/>
    <path d="M4 21c0-5 4-8 8-8s8 3 8 8Z" fill="#8fb0ff"/>
  `,
  // report-player pennant
  report: `
    <path d="M5 3v18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M5 4 18 7 5 11Z" fill="currentColor" opacity=".85"/>
  `,
  // vote/remove — the universal no-entry circle
  kick: `
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.2"/>
    <line x1="5.5" y1="12" x2="18.5" y2="12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
  `,
  // muted speaker
  mute: `
    <path d="M4 9v6h4l6 4V5l-6 4Z" fill="currentColor"/>
    <path d="M16.5 9.5l4 5M20.5 9.5l-4 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  `,
  // a public room
  globe: `
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/>
    <ellipse cx="12" cy="12" rx="4" ry="9" fill="none" stroke="currentColor" stroke-width="1.3"/>
    <line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" stroke-width="1.3"/>
    <path d="M5 7.5c2 1.4 12 1.4 14 0M5 16.5c2-1.4 12-1.4 14 0" stroke="currentColor" stroke-width="1.1" fill="none"/>
  `
};
ICONS.medal = ICONS.title;   // 🏅 and 🎖️ were the same idea wearing two names

/**
 * An inline SVG for one of the names above, sized to sit inline with text
 * (default 1em-ish at the caller's font size — pass `size` in px when a
 * spot needs a fixed size instead, e.g. a big case-reveal icon).
 *
 * Returns '' for an unknown name so a bad lookup fails quietly into blank
 * space rather than throwing mid-render, matching how the emoji it
 * replaces would have just shown a tofu box.
 */
export function icon(name, { size = 14, cls = '' } = {}) {
  const body = ICONS[name];
  if (!body) return '';
  return `<svg class="gicon${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" width="${size}" height="${size}" ` +
    `style="vertical-align:-0.15em" aria-hidden="true" focusable="false">${body}</svg>`;
}

export const ICON_NAMES = Object.keys(ICONS);
