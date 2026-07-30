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
    master.gain.value = muted ? 0 : 0.8;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export const Sound = {};

Sound.muted = () => muted;
Sound.setMuted = on => {
  muted = !!on;
  try { localStorage.setItem('lg_muted', muted ? '1' : '0'); } catch { /* ignore */ }
  if (master) master.gain.value = muted ? 0 : 0.8;
};

/** One burst of shaped noise through a bandpass — the building block. */
function noiseBurst({ dur = 0.1, freq = 2000, q = 1, gain = 0.5, sweep = 0 }) {
  const c = ac(); if (!c || muted) return;
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
  const c = ac(); if (!c || muted) return;
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
  const s = Math.abs(speed);
  cartOsc.frequency.value = 42 + s * 6.5;
  cartFilter.frequency.value = 220 + s * 40;
  cartGain.gain.value = muted ? 0 : Math.min(0.10, 0.03 + s * 0.006);
};
