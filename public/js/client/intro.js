/* =========================================================================
   intro.js — the shot that opens the game
   -------------------------------------------------------------------------
   Two and a half seconds of golf before the menu: a ball rolls in from the
   left, gets struck, flies, lands on a green and settles near the flag, and
   the UI fades up over the top of it. It is the first thing anybody sees and
   it is the whole pitch — this is a golf game, it is pretty, and somebody
   cared about it.

   WHY THIS IS A 2D CANVAS AND NOT THE THREE.JS SCENE.

   The obvious move is to reuse the real renderer, and it is the wrong one.
   The intro has to run BEFORE the course is built, on the slowest machine
   that will ever load the page, at a moment when a stutter reads as "this is
   broken" rather than "this is loading. Three.js is 600 KB of parse plus a
   terrain build plus a shader compile, and all of that lands in exactly the
   window where nothing may drop a frame. A 2D canvas with no assets starts
   on the first frame and cannot fail in a way that costs us the player.

   So everything here is drawn: the sky is a gradient, the ball is a radial
   gradient with a real dimple lattice and a real Fresnel rim, the grass is
   noise, the flag is a five-segment cloth with wind in it. Nothing is
   loaded, so nothing can be missing.

   THREE RULES THAT ARE NOT NEGOTIABLE.

     - It is skippable. Escape, a click, a tap, any key. A player who has
       seen it once and wants to get to the golf must never be made to sit
       through it, and the caller only plays it once a session anyway.
     - It respects prefers-reduced-motion by cutting straight to the last
       frame. Motion this large is a genuine accessibility problem for some
       people and a preference switch is not a suggestion.
     - It is delta-timed, not frame-counted. On a 144 Hz monitor a
       frame-counted animation runs at two and a half times speed, and the
       machines most likely to have a 144 Hz monitor are the ones where that
       looks worst.
   ========================================================================= */

/* The whole thing in milliseconds. Phases are cumulative boundaries rather
   than durations so that reading the timeline does not require adding up. */
const T_ROLL   = 620;    // ball rolls in from the left
const T_FLIGHT = 1780;   // struck, in the air
const T_LAND   = 2140;   // bounce, check, roll out
const T_REVEAL = 2760;   // camera settles on the flag, UI comes up
const TOTAL    = T_REVEAL;

/* World space: x runs left to right in arbitrary units, y is HEIGHT ABOVE THE
   GROUND and points up — the opposite of screen y, converted once in `project`
   so no drawing code has to remember to negate anything. */
const LAUNCH_X = 470;
const LAND_X   = 1560;
const REST_X   = 1712;
const FLAG_X   = 1790;
/* High enough that the ball is against open sky at the top of the arc. At
   330 the apex landed among the canopies of the far treeline and a white
   ball on a dark green backdrop is a ball nobody can follow. */
const APEX     = 395;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
/* Smoothstep. Used for every camera move — a linear pan is the single
   loudest tell that something was animated by a programmer. */
const ease = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const easeOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

/* ---------------------------------------------------------------- dimples --
   Precomputed once: a hex lattice on the unit disc. Each dimple carries its
   position on the disc and, from that, the sphere normal — which is what
   makes them shade correctly and squash towards the limb instead of looking
   like polka dots painted on a circle. */
const DIMPLES = (() => {
  const out = [];
  const step = 0.235;
  for (let row = -5; row <= 5; row++) {
    const v = row * step * 0.87;
    for (let col = -5; col <= 5; col++) {
      const u = col * step + (row & 1 ? step * 0.5 : 0);
      const d2 = u * u + v * v;
      if (d2 > 0.86) continue;                  // leave the limb clean
      out.push({ u, v, r: 0.088 });
    }
  }
  return out;
})();

export function playIntro(canvas, opts = {}) {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return Promise.resolve();

  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  return new Promise(resolve => {
    let raf = 0, t = 0, last = 0, done = false;
    let W = 0, H = 0, S = 1;                    // css size and the world scale
    const particles = [];
    const trail = [];                           // ring of past ball positions
    let spawned = false;

    /* ------------------------------------------------------------ sizing --
       The animation is composed for a 16:9 stage and then FITTED, rather
       than laid out from the real viewport — otherwise the ball lands off
       the bottom of a phone and the flag is off the right of an ultrawide.
       One scale factor, computed here, and every draw call goes through
       `project`. */
    function size() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      /* Four fallbacks deep because a zero here is not hypothetical: a canvas
         measured before layout, in a background tab, or mid-rotation on a
         phone reports 0, and `Math.max(1, 0 * dpr)` is a 1x1 canvas — which
         is not a crash, it is two and a half seconds of blank screen as the
         player's first impression. The frame loop re-measures until this
         comes back sane. */
      W = canvas.clientWidth || window.innerWidth || document.documentElement.clientWidth || 960;
      H = canvas.clientHeight || window.innerHeight || document.documentElement.clientHeight || 540;
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // fit 1000 world units of width, but never so small the ball vanishes
      S = Math.max(W / 1180, H / 660);
    }
    size();
    window.addEventListener('resize', size);

    /* ---------------------------------------------------------- the shot --
       Ball position at time `t`, in world units, plus the spin that drives
       the dimple lattice. Written as one function of time rather than an
       integrated simulation so that seeking — which is what skipping and
       reduced-motion both do — lands on exactly the same frame every time. */
    function ballAt(ms) {
      if (ms < T_ROLL) {
        // rolling in: decelerating, with two small hops off the turf
        const k = ms / T_ROLL;
        const x = lerp(-120, LAUNCH_X, easeOut(k) * 0.86 + k * 0.14);
        const hop = Math.max(0, Math.sin(k * Math.PI * 3.4)) * 13 * (1 - k);
        return { x, y: hop, spin: x * 0.055, v: 1 };
      }
      if (ms < T_FLIGHT) {
        // the flight: a parabola from LAUNCH_X to LAND_X
        const k = (ms - T_ROLL) / (T_FLIGHT - T_ROLL);
        const x = lerp(LAUNCH_X, LAND_X, k);
        const y = APEX * 4 * k * (1 - k);       // peaks at k = 0.5
        return { x, y, spin: LAUNCH_X * 0.055 + k * 26, v: 1 - k * 0.35 };
      }
      if (ms < T_LAND) {
        // two decaying bounces and a roll-out
        const k = (ms - T_FLIGHT) / (T_LAND - T_FLIGHT);
        const x = lerp(LAND_X, REST_X, easeOut(k));
        const b = Math.abs(Math.sin(k * Math.PI * 2.2)) * 44 * Math.pow(1 - k, 2.1);
        return { x, y: b, spin: LAUNCH_X * 0.055 + 26 + k * 7, v: 0.5 * (1 - k) };
      }
      return { x: REST_X, y: 0, spin: LAUNCH_X * 0.055 + 33, v: 0 };
    }

    /* The camera. Follows the ball through the shot and then drifts right to
       put the flag in frame — which is the reveal: the last thing you see
       before the menu is where the ball finished relative to the hole. */
    function camAt(ms) {
      const b = ballAt(ms);
      if (ms < T_ROLL) return { x: b.x + 190, y: 118, z: 1.06 };
      if (ms < T_FLIGHT) {
        const k = (ms - T_ROLL) / (T_FLIGHT - T_ROLL);
        // pull back as it climbs so the whole arc is legible
        return { x: b.x + lerp(190, 40, ease(k)), y: lerp(118, 250, ease(k)),
                 z: lerp(1.06, 0.90, ease(Math.min(1, k * 1.4))) };
      }
      if (ms < T_LAND) {
        const k = (ms - T_FLIGHT) / (T_LAND - T_FLIGHT);
        return { x: lerp(LAND_X + 40, REST_X + 70, ease(k)), y: lerp(250, 120, ease(k)),
                 z: lerp(0.90, 1.02, ease(k)) };
      }
      const k = ease((ms - T_LAND) / (T_REVEAL - T_LAND));
      return { x: lerp(REST_X + 70, (REST_X + FLAG_X) / 2 + 34, k),
               y: lerp(120, 132, k), z: lerp(1.02, 1.20, k) };
    }

    let cam = { x: 0, y: 0, z: 1 };

    /* THE TWO LINES THAT SET THE COMPOSITION.

       `groundY` is where the ball touches down; `horizonY` is where the land
       meets the sky. The first version had them as the same line, which is
       what you get if you forget that a side-on view still needs somewhere
       for the ground to recede TO — the ball rolled along the horizon and
       the entire bottom half of the frame was one flat green rectangle.

       Separating them buys the whole middle distance: haze, a treeline, a
       bunker, the green sitting in front of it all. The gap between them
       scales with the zoom so pulling back during the flight widens the
       land rather than sliding it up the screen. */
    let groundY = 0, horizonY = 0;
    function lines() {
      groundY = H * 0.80 - cam.y * 0.34 * S * cam.z;
      horizonY = groundY - 176 * S * cam.z;
    }
    const project = (wx, wy) => [
      W * 0.5 + (wx - cam.x) * S * cam.z,
      groundY - wy * S * cam.z
    ];

    /* ------------------------------------------------------------- sky ---- */
    function drawSky() {
      const g = ctx.createLinearGradient(0, 0, 0, horizonY + 10);
      g.addColorStop(0, '#2f6fb8');
      g.addColorStop(0.38, '#6aa7dd');
      g.addColorStop(0.74, '#a8ceea');
      g.addColorStop(1, '#dceaf0');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, horizonY + 12);

      // the sun, low and to the left, which is where the ball's light comes from
      const [sx] = project(cam.x - 560, 0);
      const sy = horizonY - 210 * S * cam.z;
      const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, 300 * S);
      sg.addColorStop(0, 'rgba(255,251,230,0.9)');
      sg.addColorStop(0.3, 'rgba(255,246,208,0.26)');
      sg.addColorStop(1, 'rgba(255,246,208,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(0, 0, W, horizonY + 12);
    }

    /* Clouds at three parallax depths. The parallax is the entire point:
       during the flight the camera climbs, and without something at a
       different depth to slide against, a climbing camera over a gradient is
       indistinguishable from a still image. */
    const CLOUDS = [
      { x: -260, y: 300, s: 1.5, d: 0.30 }, { x: 240, y: 392, s: 2.1, d: 0.22 },
      { x: 760, y: 268, s: 1.3, d: 0.38 }, { x: 1180, y: 372, s: 1.8, d: 0.26 },
      { x: 1640, y: 300, s: 1.5, d: 0.34 }, { x: 2050, y: 388, s: 2.0, d: 0.20 },
      { x: 2460, y: 320, s: 1.6, d: 0.30 }
    ];
    function drawClouds() {
      for (const c of CLOUDS) {
        const px = W * 0.5 + (c.x - cam.x * c.d) * S * cam.z;
        const py = horizonY - (c.y - cam.y * c.d * 0.3) * S * cam.z;
        const r = 34 * c.s * S * cam.z;
        if (px < -r * 4 || px > W + r * 4 || py > horizonY) continue;
        // a soft underside rather than a flat white blob
        const cg = ctx.createLinearGradient(0, py - r * 0.7, 0, py + r * 0.7);
        cg.addColorStop(0, 'rgba(255,255,255,0.94)');
        cg.addColorStop(1, 'rgba(214,230,242,0.72)');
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.ellipse(px, py, r * 1.9, r * 0.6, 0, 0, Math.PI * 2);
        ctx.ellipse(px - r * 0.95, py + r * 0.12, r * 1.05, r * 0.44, 0, 0, Math.PI * 2);
        ctx.ellipse(px + r * 1.0, py + r * 0.16, r * 0.92, r * 0.38, 0, 0, Math.PI * 2);
        ctx.ellipse(px + r * 0.15, py - r * 0.34, r * 0.86, r * 0.42, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    /* ---------------------------------------------------------- the land -- */

    /* A deterministic wobble. Math.random in a draw call means the hills
       crawl about between frames, which is the classic tell. */
    const wob = (i, k) => Math.sin(i * 12.9898 + k * 78.233) * 43758.5453 % 1;

    /** Far hills: soft, hazy, barely there. Depth, not detail. */
    function drawHills() {
      const base = horizonY + 1;
      /* SAMPLED as a polyline across the screen rather than built from a
         chain of quadratic segments. The first version advanced by one hill
         per iteration but drew control points spanning two, so consecutive
         segments overlapped and the ridge came out as a set of ribbons
         streaking across the sky. A height function sampled every few pixels
         cannot do that. */
      for (const L of [{ d: 0.08, a: 72, f: 0.0016, c: 'rgba(132,170,176,0.38)' },
                       { d: 0.14, a: 50, f: 0.0027, c: 'rgba(102,146,134,0.46)' }]) {
        ctx.fillStyle = L.c;
        ctx.beginPath();
        ctx.moveTo(-4, base);
        for (let px = -4; px <= W + 4; px += 7) {
          const wx = (px - W * 0.5) / (S * cam.z) + cam.x * L.d;
          const h = (0.55 + 0.45 * Math.sin(wx * L.f) * Math.sin(wx * L.f * 0.41 + 1.7)) * L.a;
          ctx.lineTo(px, base - h * S * cam.z);
        }
        ctx.lineTo(W + 4, base);
        ctx.closePath();
        ctx.fill();
      }
    }

    /* The treeline. Two bands, and they are LOBBED canopies rather than the
       row of triangles this started as — a triangle silhouette on a horizon
       reads as a mountain range, not as trees, and that one detail was doing
       more than anything else to make the whole shot look cheap. */
    function drawTrees(depth, colour, scale, tint) {
      const base = horizonY + 2;
      ctx.fillStyle = colour;
      for (let i = -6; i < 80; i++) {
        /* Clumped, not evenly spaced: an even row of identical trees is a
           hedge, and a hedge on the horizon is the other half of what made
           the first pass look cheap. The wobble moves each one and the gap
           test opens the occasional clearing. */
        if (Math.abs(wob(i, depth + 5)) < 0.14) continue;
        const px = W * 0.5 + (i * 44 + wob(i, depth) * 34 - cam.x * depth) * S * cam.z;
        if (px < -60 || px > W + 60) continue;
        const h = (20 + Math.abs(wob(i, depth + 1)) * 28) * scale * S * cam.z;
        const w = h * (0.42 + Math.abs(wob(i, depth + 2)) * 0.22);
        ctx.beginPath();
        // trunk, then three overlapping lobes for the canopy
        ctx.rect(px - w * 0.09, base - h * 0.42, w * 0.18, h * 0.44);
        ctx.ellipse(px, base - h * 0.72, w * 0.72, h * 0.36, 0, 0, Math.PI * 2);
        ctx.ellipse(px - w * 0.5, base - h * 0.55, w * 0.5, h * 0.27, 0, 0, Math.PI * 2);
        ctx.ellipse(px + w * 0.52, base - h * 0.57, w * 0.46, h * 0.25, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      if (tint) {   // sun catching the tops from the left
        ctx.fillStyle = tint;
        for (let i = -6; i < 80; i++) {
          if (Math.abs(wob(i, depth + 5)) < 0.14) continue;
          const px = W * 0.5 + (i * 44 + wob(i, depth) * 34 - cam.x * depth) * S * cam.z;
          if (px < -60 || px > W + 60) continue;
          const h = (20 + Math.abs(wob(i, depth + 1)) * 28) * scale * S * cam.z;
          const w = h * 0.42;
          ctx.beginPath();
          ctx.ellipse(px - w * 0.34, base - h * 0.84, w * 0.44, h * 0.16, -0.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    /* The ground, in receding bands: haze at the horizon, then rough, then
       the fairway the ball is actually on, with the mowing stripes in WORLD
       x so they slide past correctly. A stripe pattern locked to the screen
       is what makes a side-scroller feel like a treadmill. */
    function drawGround() {
      const g = ctx.createLinearGradient(0, horizonY, 0, H);
      g.addColorStop(0, '#7ba86a');          // hazed, far away
      g.addColorStop(0.16, '#5e9a52');
      g.addColorStop(0.46, '#4e8c45');
      g.addColorStop(1, '#39733a');
      ctx.fillStyle = g;
      ctx.fillRect(0, horizonY, W, H - horizonY);

      // aerial haze sitting on the horizon, which is what gives it distance
      const hz = ctx.createLinearGradient(0, horizonY - 6 * S * cam.z, 0, horizonY + 46 * S * cam.z);
      hz.addColorStop(0, 'rgba(214,232,238,0.55)');
      hz.addColorStop(1, 'rgba(214,232,238,0)');
      ctx.fillStyle = hz;
      ctx.fillRect(0, horizonY - 8 * S * cam.z, W, 56 * S * cam.z);

      // the fairway: a lighter band the play happens on
      const fy = groundY - 46 * S * cam.z;
      const fg = ctx.createLinearGradient(0, fy, 0, H);
      fg.addColorStop(0, 'rgba(126,186,98,0.30)');
      fg.addColorStop(0.3, 'rgba(126,186,98,0.42)');
      fg.addColorStop(1, 'rgba(108,170,84,0.30)');
      ctx.fillStyle = fg;
      ctx.fillRect(0, fy, W, H - fy);

      const period = 104;
      const start = Math.floor((cam.x - 1000) / period) * period;
      for (let wx = start; wx < cam.x + 1500; wx += period * 2) {
        const [a] = project(wx, 0);
        const [b] = project(wx + period, 0);
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(a, fy, b - a, H - fy);
      }

      // a cart path, because a course has one and it gives the eye a line
      const py = groundY - 62 * S * cam.z;
      ctx.fillStyle = 'rgba(206,198,176,0.30)';
      ctx.fillRect(0, py, W, 5 * S * cam.z);

      // two bunkers short of the green: the only real landmarks out there
      for (const bx of [LAND_X - 250, FLAG_X + 190]) {
        const [px2] = project(bx, 0);
        const byy = groundY - 14 * S * cam.z;
        const rx = 84 * S * cam.z, ry = 15 * S * cam.z;
        ctx.fillStyle = 'rgba(46,74,44,0.30)';
        ctx.beginPath(); ctx.ellipse(px2, byy + 2 * S * cam.z, rx * 1.03, ry * 1.1, 0, 0, Math.PI * 2); ctx.fill();
        const sg2 = ctx.createLinearGradient(0, byy - ry, 0, byy + ry);
        sg2.addColorStop(0, '#e8dcb4');
        sg2.addColorStop(1, '#cbb98c');
        ctx.fillStyle = sg2;
        ctx.beginPath(); ctx.ellipse(px2, byy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
      }

      // the green: the ball finishes on it, so it has an edge and a fringe
      const [gx] = project((REST_X + FLAG_X) / 2 - 20, 0);
      const gy2 = groundY - 4 * S * cam.z;
      const rx = 300 * S * cam.z, ry = 52 * S * cam.z;
      ctx.fillStyle = 'rgba(88,146,74,0.55)';        // fringe
      ctx.beginPath(); ctx.ellipse(gx, gy2, rx * 1.07, ry * 1.16, 0, 0, Math.PI * 2); ctx.fill();
      const gg = ctx.createRadialGradient(gx - rx * 0.2, gy2 - ry * 0.5, 4, gx, gy2, rx);
      gg.addColorStop(0, '#9ad882');
      gg.addColorStop(0.55, '#82c86c');
      gg.addColorStop(1, '#6cb35a');
      ctx.fillStyle = gg;
      ctx.beginPath(); ctx.ellipse(gx, gy2, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
      // a putting-surface sheen so it does not read as flat paint
      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      ctx.beginPath(); ctx.ellipse(gx - rx * 0.24, gy2 - ry * 0.3, rx * 0.5, ry * 0.34, -0.06, 0, Math.PI * 2); ctx.fill();
    }

    /* Foreground rough along the bottom edge. Every golf photograph is taken
       through something — a bank, a bunker lip, a stand of rough — and
       without it the bottom fifth of this frame was a plain green rectangle
       with nothing in it. Darker and softer than the fairway, so it reads as
       near and out of focus rather than as another mown surface. */
    function drawForeground() {
      const y0 = H - 74 * S * cam.z;
      const fg = ctx.createLinearGradient(0, y0, 0, H);
      fg.addColorStop(0, 'rgba(24,52,32,0)');
      fg.addColorStop(0.45, 'rgba(24,52,32,0.42)');
      fg.addColorStop(1, 'rgba(16,38,24,0.78)');
      ctx.fillStyle = fg;
      ctx.fillRect(0, y0, W, H - y0);

      // tufts along the very bottom, drifting with the camera so the
      // foreground parallaxes fastest — which is what makes it read as near
      /* Broad overlapping mounds, not a row of spikes. Narrow tufts at even
         spacing came out as a sawtooth border along the bottom of the frame,
         which read as a decorative edge rather than as grass in front of the
         camera. Wide and overlapping, they merge into one undulating bank. */
      ctx.fillStyle = 'rgba(22,48,28,0.6)';
      ctx.beginPath();
      ctx.moveTo(-20, H + 4);
      for (let i = -4; i < 70; i++) {
        const px = W * 0.5 + (i * 46 + wob(i, 9) * 30 - cam.x * 1.25) * S * cam.z;
        if (px < -140 || px > W + 140) continue;
        const h = (12 + Math.abs(wob(i, 11)) * 30) * S * cam.z;
        const w = (30 + Math.abs(wob(i, 12)) * 26) * S * cam.z;
        ctx.moveTo(px - w, H + 4);
        ctx.bezierCurveTo(px - w * 0.55, H - h * 0.5, px - w * 0.28, H - h,
                          px + wob(i, 13) * w * 0.3, H - h);
        ctx.bezierCurveTo(px + w * 0.34, H - h, px + w * 0.6, H - h * 0.45, px + w, H + 4);
      }
      ctx.fill();
    }

    /* ---------------------------------------------------------- the flag --
       Pole plus a cloth of five segments. Each segment lags the one before
       it and the amplitude grows towards the free end, which is what a flag
       actually does — the fixed edge cannot move and the tip moves most.
       Driven by time and a second slower wave so the breeze is not a metronome. */
    function drawFlag(ms) {
      const [px, py] = project(FLAG_X, 0);
      const poleH = 132 * S * cam.z;
      const top = py - poleH;

      ctx.strokeStyle = 'rgba(30,40,34,0.28)';
      ctx.lineWidth = Math.max(1, 2.4 * S * cam.z);
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, top); ctx.stroke();
      ctx.strokeStyle = '#f2f2ee';
      ctx.lineWidth = Math.max(1, 1.9 * S * cam.z);
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, top); ctx.stroke();

      const seg = 5, len = 46 * S * cam.z, hgt = 27 * S * cam.z;
      const wind = ms * 0.006;
      const pts = [];
      for (let i = 0; i <= seg; i++) {
        const k = i / seg;
        const sway = Math.sin(wind - k * 2.3) * 7 * S * cam.z * k * k
                   + Math.sin(wind * 0.43 - k * 1.1) * 4 * S * cam.z * k;
        pts.push([px + len * k, top + 3 * S * cam.z + sway]);
      }
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i <= seg; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      for (let i = seg; i >= 0; i--) ctx.lineTo(pts[i][0], pts[i][1] + hgt);
      ctx.closePath();
      const fg = ctx.createLinearGradient(px, 0, px + len, 0);
      fg.addColorStop(0, '#d8362f');
      fg.addColorStop(1, '#b8241f');
      ctx.fillStyle = fg;
      ctx.fill();
    }

    /* ---------------------------------------------------------- the ball --
       The bit that has to be right, because it is at the centre of the frame
       for the whole two and a half seconds and it is the only object the eye
       is tracking.

         body      radial gradient, light from the upper left
         dimples   the real lattice, each shaded by its own sphere normal and
                   squashed towards the limb by foreshortening
         specular  a small hot ellipse where the light hits
         fresnel   a rim of sky colour, because grazing angles reflect more —
                   this is the single thing that stops it reading as a flat
                   white disc against a blue sky
    */
    function drawBall(x, y, r, spin, alpha = 1) {
      ctx.save();
      ctx.globalAlpha = alpha;

      const body = ctx.createRadialGradient(x - r * 0.36, y - r * 0.42, r * 0.04, x, y, r * 1.04);
      body.addColorStop(0, '#ffffff');
      body.addColorStop(0.42, '#f4f6f0');
      body.addColorStop(0.8, '#cfd5c9');
      body.addColorStop(1, '#98a294');
      ctx.fillStyle = body;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();

      // dimples, only when the ball is big enough for them to be anything but noise
      if (r > 7) {
        ctx.save();
        ctx.beginPath(); ctx.arc(x, y, r * 0.985, 0, Math.PI * 2); ctx.clip();
        const cs = Math.cos(spin), sn = Math.sin(spin);
        for (const d of DIMPLES) {
          // roll the lattice about the axis into the screen
          const u = d.u * cs - d.v * sn, v = d.u * sn + d.v * cs;
          const d2 = u * u + v * v;
          if (d2 > 0.93) continue;
          const nz = Math.sqrt(1 - d2);            // sphere normal, z towards viewer
          // lit by the same upper-left key as the body gradient
          const lit = clamp(u * -0.45 + v * -0.5 + nz * 0.74, 0, 1);
          ctx.fillStyle = `rgba(${(150 + lit * 70) | 0},${(158 + lit * 72) | 0},${(146 + lit * 70) | 0},${0.42 * nz + 0.1})`;
          ctx.beginPath();
          ctx.ellipse(x + u * r, y + v * r, d.r * r * nz, d.r * r * nz * 0.94, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // specular
      const sp = ctx.createRadialGradient(x - r * 0.4, y - r * 0.46, 0, x - r * 0.4, y - r * 0.46, r * 0.46);
      sp.addColorStop(0, 'rgba(255,255,255,0.95)');
      sp.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sp;
      ctx.beginPath(); ctx.arc(x - r * 0.4, y - r * 0.46, r * 0.46, 0, Math.PI * 2); ctx.fill();

      // Fresnel rim
      const fr = ctx.createRadialGradient(x, y, r * 0.62, x, y, r);
      fr.addColorStop(0, 'rgba(180,214,240,0)');
      fr.addColorStop(0.82, 'rgba(180,214,240,0.16)');
      fr.addColorStop(1, 'rgba(214,236,255,0.62)');
      ctx.fillStyle = fr;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();

      ctx.restore();
    }

    /* -------------------------------------------------------- particles --- */
    function spawnImpact(wx) {
      for (let i = 0; i < 34; i++) {
        const a = -Math.PI * (0.15 + Math.random() * 0.7);
        const sp = 90 + Math.random() * 300;
        particles.push({
          x: wx, y: 2, vx: Math.cos(a) * sp * 0.7 + 60, vy: -Math.sin(a) * sp,
          life: 0.42 + Math.random() * 0.4, age: 0,
          grass: Math.random() < 0.62, r: 1.4 + Math.random() * 2.6
        });
      }
      // and the dust puff, which is what actually sells the impact
      for (let i = 0; i < 7; i++) {
        particles.push({
          x: wx + (Math.random() - 0.5) * 26, y: 4 + Math.random() * 10,
          vx: 20 + Math.random() * 60, vy: -12 - Math.random() * 26,
          life: 0.5 + Math.random() * 0.35, age: 0, puff: true,
          r: 11 + Math.random() * 16
        });
      }
    }

    function stepParticles(dt) {
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.age += dt;
        if (p.age >= p.life) { particles.splice(i, 1); continue; }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += (p.puff ? 40 : 900) * dt;        // dust floats, divots fall
        if (!p.puff && p.y < 0) { p.y = 0; p.vy *= -0.32; p.vx *= 0.6; }
        if (p.puff) { p.r += 26 * dt; p.vx *= 0.97; }
      }
    }

    function drawParticles() {
      for (const p of particles) {
        const k = 1 - p.age / p.life;
        const [px, py] = project(p.x, p.y);
        if (p.puff) {
          ctx.fillStyle = `rgba(214,220,196,${0.20 * k})`;
          ctx.beginPath();
          ctx.arc(px, py, p.r * S * cam.z, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = p.grass
            ? `rgba(${(78 + k * 40) | 0},${(132 + k * 40) | 0},68,${k})`
            : `rgba(150,132,96,${k * 0.9})`;
          const s = p.r * S * cam.z;
          ctx.fillRect(px - s * 0.5, py - s * 0.5, s, s * (p.grass ? 1.7 : 1));
        }
      }
    }

    /* ------------------------------------------------------------- frame -- */
    function draw(ms) {
      cam = camAt(ms);
      lines();                 // MUST be before anything projects: both the
      const b = ballAt(ms);    // horizon and the ground line move with the camera

      drawSky();
      drawClouds();
      drawHills();
      // far band first, then the near one, so the near trees overlap them
      drawTrees(0.44, 'rgba(52,86,58,0.62)', 0.72, null);
      drawTrees(0.66, '#2f5738', 1, 'rgba(126,178,104,0.34)');
      drawGround();

      drawForeground();

      /* The pitch mark. It was a brown divot, which is what a ball leaves in
         a FAIRWAY — this one lands on the green, and a mud-coloured gouge on
         a putting surface reads as a blemish on the render rather than as
         golf. Bruised turf: darker green, small, soft. */
      if (ms > T_FLIGHT) {
        const [dx, dy] = project(LAND_X, 0);
        const k = clamp((ms - T_FLIGHT) / 420, 0, 1);
        ctx.fillStyle = `rgba(74,116,60,${0.42 * k})`;
        ctx.beginPath();
        ctx.ellipse(dx, dy - 2 * S * cam.z, 9 * S * cam.z, 3.2 * S * cam.z, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      drawFlag(ms);
      drawParticles();

      const [bx, by] = project(b.x, b.y);
      const r = 17 * S * cam.z;

      // contact shadow: tight and dark on the deck, wide and faint in the air
      const lift = clamp(b.y / 160, 0, 1);
      const [sx, sy] = project(b.x + b.y * 0.16, 0);
      ctx.fillStyle = `rgba(28,48,30,${0.34 * (1 - lift * 0.78)})`;
      ctx.beginPath();
      ctx.ellipse(sx, sy, r * (1 + lift * 1.5), r * 0.34 * (1 + lift * 0.7), 0, 0, Math.PI * 2);
      ctx.fill();

      /* Motion blur. A trail of ghosts at falling alpha, which is what a
         camera with a real shutter would give you — and the reason it is a
         trail of BALLS rather than a smeared line is that at this size the
         eye can still resolve the shape, and a line reads as a mistake. */
      for (let i = 0; i < trail.length; i++) {
        const g = trail[i];
        const k = (i + 1) / (trail.length + 1);
        if (g.v < 0.12) continue;
        const [gx, gy] = project(g.x, g.y);
        drawBall(gx, gy, r * (0.86 + k * 0.14), g.spin, k * 0.3 * g.v);
      }

      drawBall(bx, by, r, b.spin);

      // A vignette, which is doing real work: it darkens the corners where
      // the fitted stage runs out on an odd aspect ratio.
      const vg = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.34,
                                          W * 0.5, H * 0.5, Math.max(W, H) * 0.78);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(6,18,28,0.35)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    }

    /* -------------------------------------------------------------- loop -- */
    function finish() {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', size);
      window.removeEventListener('keydown', onKey, true);
      canvas.removeEventListener('pointerdown', finish);
      resolve();
    }

    function onKey(e) {
      // any key at all — a player reaching for the keyboard during an intro
      // is a player asking for it to stop
      if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter' || e.code) finish();
    }

    let wall = 0;
    function frame(now) {
      if (done) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      /* Two clocks, and they are both needed.

         `t` is the animation clock and it advances by a CLAMPED dt, so a
         dropped frame slows the shot down instead of teleporting the ball
         across the screen. `wall` is real time, and it exists because that
         clamp has a cost: on a machine hitching badly enough, a 2.8 s intro
         stretches without limit, and there is no number of seconds of
         animation a player owes us before they are allowed to see the menu.
         Past four and a half seconds it cuts to the end, whatever it was
         doing. */
      wall += last ? (now - last) : 0;
      last = now;
      if (wall > 4500) { draw(TOTAL); finish(); return; }
      t += dt * 1000;
      // if we were measured before layout existed, take the size again
      if (W < 2 || H < 2) size();

      if (!spawned && t >= T_FLIGHT) { spawned = true; spawnImpact(LAND_X); opts.onImpact?.(); }
      if (t >= T_ROLL && t - dt * 1000 < T_ROLL) opts.onStrike?.();

      stepParticles(dt);

      const b = ballAt(t);
      trail.push({ x: b.x, y: b.y, spin: b.spin, v: b.v });
      while (trail.length > 7) trail.shift();

      draw(Math.min(t, TOTAL));

      if (t >= TOTAL) { finish(); return; }
      raf = requestAnimationFrame(frame);
    }

    window.addEventListener('keydown', onKey, true);
    canvas.addEventListener('pointerdown', finish);

    if (reduced) {
      // one frame of the finished picture, held briefly so it does not flash
      draw(TOTAL);
      setTimeout(finish, 420);
      return;
    }
    raf = requestAnimationFrame(frame);
  });
}
