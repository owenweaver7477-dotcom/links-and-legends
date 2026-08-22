/* =========================================================================
   sound.js — the course, audible
   -------------------------------------------------------------------------
   Everything is SYNTHESIZED with WebAudio at the moment it plays — there are
   no audio files, nothing to download, nothing to license.  A club strike is
   a filtered noise burst whose brightness follows the club and whose weight
   follows the power; a splash is noise falling down a lowpass; the cart is a
   sawtooth idling under a filter.  Cheap, instant, and it makes the whole
   game feel inhabited.

   The context starts lazily on the first user gesture (browsers require it),
   and everything routes through one master gain so the mute toggle is one
   number.
   ========================================================================= */

let ctx = null;
let master = null;
let muted = false;
try { muted = localStorage.getItem('lg_muted') === '1'; } catch { /* private mode */ }

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = (muted || platformMuted) ? 0 : 0.8;
    master.connect(ctx.destination);
  }
  // resume() REJECTS if it is called before the browser has seen a gesture,
  // and an unhandled rejection every time a sound is attempted is exactly the
  // sort of console noise that gets a game rejected from a portal.
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export const Sound = {};

/* CrazyGames can mute a game from their own chrome, and their requirements
   say that must take priority over the game's own setting.  Keeping it as a
   separate flag means unmuting on their side restores whatever the player
   had chosen here, rather than clobbering it. */
let platformMuted = false;
Sound.setPlatformMute = on => {
  platformMuted = !!on;
  if (master) master.gain.value = (muted || platformMuted) ? 0 : 0.8;
};

Sound.muted = () => muted || platformMuted;
Sound.setMuted = on => {
  muted = !!on;
  try { localStorage.setItem('lg_muted', muted ? '1' : '0'); } catch { /* ignore */ }
  if (master) master.gain.value = (muted || platformMuted) ? 0 : 0.8;
};

/** One burst of shaped noise through a bandpass — the building block. */
function noiseBurst({ dur = 0.1, freq = 2000, q = 1, gain = 0.5, sweep = 0 }) {
  const c = ac(); if (!c || muted || platformMuted) return;
  const n = c.createBufferSource();
  const len = Math.max(1, (dur * c.sampleRate) | 0);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  n.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(60, freq + sweep), c.currentTime + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  n.connect(f); f.connect(g); g.connect(master);
  n.start();
}

/** A clean sine ping, for the good news. */
function ping(freq, dur = 0.3, gain = 0.25, delay = 0) {
  const c = ac(); if (!c || muted || platformMuted) return;
  const o = c.createOscillator();
  o.type = 'sine'; o.frequency.value = freq;
  const g = c.createGain();
  const t = c.currentTime + delay;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}

/* ------------------------------------------------------------------ shots */

/** The strike: a driver cracks, a wedge thumps, a putter clicks. */
Sound.strike = (club, power = 1) => {
  const p = Math.max(0.2, Math.min(1.2, power));
  if (club?.putter) {
    noiseBurst({ dur: 0.035, freq: 1400, q: 2.5, gain: 0.28 * p });
    return;
  }
  const wood = club?.type === 'wood' || club?.type === 'hybrid';
  // the crack: bright for a driver, duller as loft climbs
  noiseBurst({ dur: 0.05, freq: wood ? 3200 : 2400 - (club?.loft || 30) * 18, q: 1.2, gain: 0.5 * p });
  // the body of the hit
  noiseBurst({ dur: 0.08, freq: wood ? 520 : 420, q: 0.8, gain: 0.4 * p, sweep: -300 });
};

Sound.bounce = (surf, speed = 5) => {
  const s = Math.min(1, speed / 20);
  if (surf === 'sand') noiseBurst({ dur: 0.09, freq: 900, q: 0.7, gain: 0.22 * s, sweep: -400 });
  else noiseBurst({ dur: 0.05, freq: 700, q: 0.9, gain: 0.18 * s, sweep: -250 });
};

/** A body check: short, low, no tail. */
Sound.thud = () => {
  const c = ac(); if (!c || muted || platformMuted) return;
  const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
  o.type = 'triangle';
  o.frequency.setValueAtTime(150, c.currentTime);
  o.frequency.exponentialRampToValueAtTime(52, c.currentTime + 0.13);
  f.type = 'lowpass'; f.frequency.value = 420;
  g.gain.setValueAtTime(0.22, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.19);
  o.connect(f); f.connect(g); g.connect(master);
  o.start(); o.stop(c.currentTime + 0.2);
};

Sound.splash = () => {
  noiseBurst({ dur: 0.30, freq: 1200, q: 0.6, gain: 0.5, sweep: -900 });
  noiseBurst({ dur: 0.55, freq: 500, q: 0.5, gain: 0.3, sweep: -350 });
};

Sound.holed = () => {
  // the rattle of the cup, then the good news
  noiseBurst({ dur: 0.08, freq: 1800, q: 3, gain: 0.3 });
  ping(880, 0.22, 0.2, 0.05);
  ping(1318, 0.3, 0.18, 0.13);
};

Sound.celebrate = tier => {
  if (tier >= 3) { ping(660, 0.2, 0.22); ping(880, 0.2, 0.22, 0.1); ping(1108, 0.25, 0.22, 0.2); ping(1318, 0.45, 0.25, 0.3); }
  else if (tier === 2) { ping(784, 0.2, 0.2); ping(1175, 0.35, 0.2, 0.12); }
  else if (tier === 1) ping(988, 0.3, 0.18);
};

Sound.crash = () => noiseBurst({ dur: 0.16, freq: 300, q: 0.6, gain: 0.5, sweep: -150 });

/* -------------------------------------------------------------- §6 cases */
/** The shake, right when the box is tapped — a short rattly burst rising
    in pitch, so the anticipation has a sound before the reveal does. */
Sound.chestOpen = () => {
  noiseBurst({ dur: 0.09, freq: 900, q: 4, gain: 0.22, sweep: 250 });
  noiseBurst({ dur: 0.09, freq: 900, q: 4, gain: 0.18, sweep: 250, delay: 0.12 });
};

/** The reel winding up — a rising whoosh right as the strip starts moving,
    so the spin has a sound of its own before the first tick lands. */
Sound.reelStart = () => {
  noiseBurst({ dur: 0.5, freq: 260, q: 0.6, gain: 0.26, sweep: 950 });
};

/** The reel — one soft tick per chip crossing the pointer. Short and quiet
    on purpose: it fires dozens of times a second at the start of the spin,
    and a tick loud enough to notice on its own would be a drill by the
    time the reel has slowed down.

    `strength` is 0..1, how close the reel is to actually landing (the
    caller already knows this — see HUD.playCaseReel's own elapsed-time
    tracking) — ticks get very slightly higher and louder as it slows, the
    same way a real wheel's clicks close in on each other and firm up right
    before it stops, rather than every one of the sixty-odd ticks sounding
    identical regardless of where the strip actually is. */
Sound.reelTick = (strength = 0) => noiseBurst({
  dur: 0.025 + strength * 0.02, freq: 1500 + strength * 900,
  q: 8, gain: 0.09 + strength * 0.10
});

/** The reveal. Reuses the same rising-arpeggio idea as Sound.celebrate,
    just keyed by rarity instead of a hole-score tier — one extra, higher
    note per tier up, and Legend gets a small shimmer on top so a big pull
    is audibly different from a good one, not just differently coloured.
    Mythic goes one further again — it is the one pull in a thousand, and
    the sound has to say so before the player has even read the card. */
const CASE_RARITY_TIER = { standard: 0, tour: 1, pro: 2, legend: 3, mythic: 4, gems: 0 };

/** The thunk the strip lands with, a beat before Sound.reward's arpeggio —
    the resolution of the tension the ticks built, scaled the same way: a
    heavier, slightly deeper impact the rarer the pull, with a thin sparkle
    riding on top of it for Legend and Mythic so the good ones do not just
    land, they land AND shimmer. */
Sound.reelLand = (rarity) => {
  const tier = CASE_RARITY_TIER[rarity] ?? 0;
  noiseBurst({ dur: 0.16, freq: 180 - tier * 12, q: 1.1, gain: 0.32 + tier * 0.05, sweep: -70 });
  if (tier >= 3) noiseBurst({ dur: 0.32, freq: 1700, q: 3, gain: 0.14, sweep: 500 });
};

Sound.reward = (rarity) => {
  const tier = CASE_RARITY_TIER[rarity] ?? 0;
  ping(660, 0.18, 0.22);
  if (tier >= 1) ping(880, 0.2, 0.22, 0.1);
  if (tier >= 2) ping(1108, 0.22, 0.22, 0.2);
  if (tier >= 3) {
    ping(1318, 0.3, 0.25, 0.3);
    ping(1760, 0.35, 0.16, 0.36);
    ping(2217, 0.4, 0.1, 0.42);
  }
  if (tier >= 4) {
    ping(2637, 0.42, 0.14, 0.5);
    ping(3136, 0.5, 0.1, 0.58);
  }
};

/** The cart giving up: a low thump, then a long ragged tail. */
Sound.explode = () => {
  noiseBurst({ dur: 0.5, freq: 110, q: 0.4, gain: 0.75, sweep: -70 });
  noiseBurst({ dur: 1.3, freq: 380, q: 0.25, gain: 0.4, sweep: -320 });
};

/* ------------------------------------------------------------------- cart */
let cartOsc = null, cartGain = null, cartFilter = null;

/** The cart hum: on while driving, pitch riding the speed. */
Sound.cart = (speed) => {
  if (speed == null) {                      // switch the motor off
    // This is called EVERY frame on foot, so if the motor is already off it
    // must be a no-op: touching the dead gain node 60 times a second would
    // pile automation events onto the audio thread forever (and creating the
    // AudioContext from the frame loop for silence would be absurd).
    if (!cartOsc) return;
    const c = ac(); if (!c) return;
    if (cartGain) { cartGain.gain.linearRampToValueAtTime(0, c.currentTime + 0.2); }
    const o = cartOsc; setTimeout(() => {
      try { o.stop(); } catch { /* done */ }
    }, 300);
    cartOsc = null; cartGain = null; cartFilter = null;
    return;
  }
  const c = ac(); if (!c) return;
  if (!cartOsc) {
    cartOsc = c.createOscillator();
    cartOsc.type = 'sawtooth';
    cartFilter = c.createBiquadFilter();
    cartFilter.type = 'lowpass'; cartFilter.frequency.value = 240; cartFilter.Q.value = 0.6;
    cartGain = c.createGain(); cartGain.gain.value = 0;
    cartOsc.connect(cartFilter); cartFilter.connect(cartGain); cartGain.connect(master);
    cartOsc.start();
  }
  /* This runs every rendered frame while driving — 60 to 144 times a
     second — against a physics speed that itself changes in discrete
     jumps (collision response, the governor, engine braking). Setting
     `.value` directly is an instantaneous step, so that many steps a
     second reads as a grainy, zippering buzz instead of a hum, and it
     got audibly worse once the cart's top speed and cornering grip went
     up — the same physics jumps now swing a wider frequency/gain range.
     setTargetAtTime glides toward each new value instead of jumping to
     it, which is inaudible for a single call but smooths the whole
     stream into one continuous engine note. */
  const s = Math.abs(speed);
  const now = c.currentTime, k = 0.06;
  cartOsc.frequency.setTargetAtTime(42 + s * 6.5, now, k);
  cartFilter.frequency.setTargetAtTime(220 + s * 40, now, k);
  cartGain.gain.setTargetAtTime((muted || platformMuted) ? 0 : Math.min(0.10, 0.03 + s * 0.006), now, k);
};

/* ═══════════════════════════════════════════════════════════ AMBIENCE ═══
   The course you are looking at while you decide whether to play. Wind in
   the trees, the odd bird, and a pad chord underneath so a silent menu does
   not read as a page that failed to load.

   Synthesized like everything else here — no files. The wind is filtered
   noise on a loop with a slowly wandering cutoff, which is what wind IS;
   sampling it would cost a download and still loop audibly.

   Idempotent on purpose: the frame loop calls this every frame with whether
   the player is on a menu, so it must be free to call when nothing changes. */
let ambOn = false;
let ambNodes = null;
let birdTimer = 0;

/** One bird: two or three quick pitched notes, never the same twice. */
function chirp() {
  const c = ac(); if (!c || muted || platformMuted || !ambOn) return;
  const base = 1900 + Math.random() * 1500;
  const n = 2 + ((Math.random() * 2) | 0);
  for (let i = 0; i < n; i++) {
    const o = c.createOscillator();
    o.type = 'sine';
    const t = c.currentTime + i * (0.055 + Math.random() * 0.05);
    const f = base * (1 + (Math.random() - 0.4) * 0.3);
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * (1.25 + Math.random() * 0.4), t + 0.045);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.035, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.075);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.12);
  }
}

Sound.ambience = on => {
  on = !!on;
  if (on === ambOn) return;                    // free to call every frame
  ambOn = on;

  if (!on) {
    if (ambNodes) {
      const c = ctx, n = ambNodes;
      ambNodes = null;
      try {
        n.gain.gain.linearRampToValueAtTime(0, c.currentTime + 0.6);
        setTimeout(() => { try { n.src.stop(); n.pad.forEach(o => o.stop()); } catch { /* done */ } }, 800);
      } catch { /* context gone */ }
    }
    clearInterval(birdTimer); birdTimer = 0;
    return;
  }

  const c = ac(); if (!c) { ambOn = false; return; }

  /* Two seconds of noise on loop. Short enough to build instantly, long
     enough that the loop point is inaudible under a wandering filter. */
  const len = c.sampleRate * 2;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let lastV = 0;
  for (let i = 0; i < len; i++) {
    // brown-ish noise: white, integrated. Wind has no top end.
    lastV = (lastV + (Math.random() * 2 - 1) * 0.06) * 0.985;
    d[i] = lastV;
  }
  // crossfade the seam so the loop does not click
  const fade = 2000;
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    d[i] = d[i] * k + d[len - fade + i] * (1 - k);
  }

  const src = c.createBufferSource();
  src.buffer = buf; src.loop = true;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 480; lp.Q.value = 0.4;
  // the gust: cutoff wanders, so the wind rises and falls
  const lfo = c.createOscillator();
  lfo.type = 'sine'; lfo.frequency.value = 0.055;
  const lfoAmt = c.createGain(); lfoAmt.gain.value = 240;
  lfo.connect(lfoAmt); lfoAmt.connect(lp.frequency);

  const gain = c.createGain();
  gain.gain.setValueAtTime(0, c.currentTime);
  gain.gain.linearRampToValueAtTime(0.16, c.currentTime + 2.2);

  src.connect(lp); lp.connect(gain); gain.connect(master);
  src.start(); lfo.start();

  /* A pad: root, fifth, major third, detuned a few cents apart so it beats
     slowly instead of sitting there. Very quiet — it should be noticed only
     when it stops. */
  const pad = [];
  for (const f of [98, 147, 246.9, 196.5]) {
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.004);
    const g = c.createGain();
    g.gain.setValueAtTime(0, c.currentTime);
    g.gain.linearRampToValueAtTime(0.011, c.currentTime + 3.5);
    o.connect(g); g.connect(gain);
    o.start();
    pad.push(o);
  }

  ambNodes = { src, gain, pad: [...pad, lfo] };
  clearInterval(birdTimer);
  birdTimer = setInterval(() => { if (Math.random() < 0.45) chirp(); }, 2600);
};
