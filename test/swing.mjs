/* =========================================================================
   swing.mjs — what the player sees must be what the player gets
   -------------------------------------------------------------------------
   Two reported bugs, both about the swing lying to you:

     "hitting the ball within the target zone still sends it flying way over"
     "slice is triggering even on good, accurate shots"

   Neither is a physics problem.  Both are the controller committing a
   different number from the one the meter was showing at the moment of
   release, so this file drives SwingController exactly as a pointer does and
   asserts that the committed shot matches the displayed one.
   ========================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SwingController, SWING, BACKSWING_PX,
         barTempo, lieTempo, pureBand } from '../public/js/client/swing.js';

/** Drag through a list of [x,y] samples, as a real pointer stream would. */
function drag(sw, samples) {
  sw.enabled = true;
  const [x0, y0] = samples[0];
  sw.pointerDown(x0, y0);
  for (const [x, y] of samples.slice(1)) sw.pointerMove(x, y);
  return sw.meter();          // what the player is looking at as they release
}

/** Stop the strike marker exactly at `sweep` and play the shot. */
function strikeAt(sw, sweep) {
  sw.pointerUp();
  sw.sweep = sweep;
  return sw.commit();
}

/* ---------------------------------------------------------------- power --- */

test('pulling PAST the target and easing back commits what the meter shows', () => {
  const sw = new SwingController();
  sw.setLie('fairway');

  // The player wants 70%. They overshoot to 100%, see the meter is too hot,
  // and ease back up to 70% before letting go — which is the single most
  // natural correction there is, and the whole point of a drag meter.
  const shown = drag(sw, [
    [500, 100],
    [500, 100 + BACKSWING_PX * 0.50],
    [500, 100 + BACKSWING_PX * 1.00],   // overshoot
    [500, 100 + BACKSWING_PX * 0.85],
    [500, 100 + BACKSWING_PX * 0.70]    // settled on target, and released here
  ]);

  assert.ok(Math.abs(shown.power - 0.70) < 0.02,
    `meter should read 0.70 at release, read ${shown.power.toFixed(3)}`);

  const shot = strikeAt(sw, 0);
  assert.ok(Math.abs(shot.power - 0.70) < 0.02,
    `committed ${shot.power.toFixed(3)} but the meter said ${shown.power.toFixed(3)} ` +
    `— a 70% shot is played at full power, which is why it sails the green`);
});

test('a 70% swing goes roughly 70% as far as a full one', () => {
  const play = frac => {
    const sw = new SwingController();
    sw.setLie('fairway');
    drag(sw, [[500, 100], [500, 100 + BACKSWING_PX * frac]]);
    return strikeAt(sw, 0).power;
  };
  // power is linear into ball speed, so the committed number IS the contract
  assert.ok(Math.abs(play(0.70) - 0.70) < 0.02);
  assert.ok(Math.abs(play(0.45) - 0.45) < 0.02);
  assert.ok(Math.abs(play(1.00) - 1.00) < 0.02);
});

test('a flick past full does not silently become an overswing', () => {
  const sw = new SwingController();
  sw.setLie('fairway');
  // brushed past 100% on the way down, settled at 95%
  drag(sw, [
    [500, 100],
    [500, 100 + BACKSWING_PX * 1.10],
    [500, 100 + BACKSWING_PX * 0.95]
  ]);
  const shot = strikeAt(sw, 0);
  assert.ok(shot.power <= 1.0 + 1e-6,
    `committed ${shot.power.toFixed(3)}: an overswing penalty for a swing the ` +
    `player pulled back from`);
});

/* ---------------------------------------------------------------- shape --- */

test('a flush strike is straight, even if the drag wandered a little', () => {
  const sw = new SwingController();
  sw.setLie('fairway');
  // A human drag is never a perfect vertical line. 12px of sideways drift
  // over a 190px pull is a straight swing by any reasonable reading.
  drag(sw, [
    [500, 100],
    [503, 100 + BACKSWING_PX * 0.35],
    [508, 100 + BACKSWING_PX * 0.70],
    [512, 100 + BACKSWING_PX * 1.00]
  ]);
  const shot = strikeAt(sw, 0);          // dead centre of the accuracy bar
  assert.equal(shot.pure, true, 'centre of the bar must count as pure');
  assert.equal(shot.faceDeg, 0,
    `perfect timing produced ${shot.faceDeg.toFixed(2)}° of face — the ball ` +
    `curves on a shot the player struck perfectly`);
});

test('shape comes from the accuracy bar and nothing else', () => {
  const mk = samples => {
    const sw = new SwingController();
    sw.setLie('fairway');
    drag(sw, samples);
    return sw;
  };
  // Two very different drag paths, same strike: the shot must be identical.
  const straight = strikeAt(mk([[500, 100], [500, 100 + BACKSWING_PX]]), 0.55);
  const wandered = strikeAt(mk([[500, 100], [540, 100 + BACKSWING_PX]]), 0.55);
  assert.equal(straight.faceDeg, wandered.faceDeg,
    'the path of the drag must not change the shot; only the strike does');
});

test('missing the bar right slices, missing left hooks, and it scales', () => {
  const play = sweep => {
    const sw = new SwingController();
    sw.setLie('fairway');
    drag(sw, [[500, 100], [500, 100 + BACKSWING_PX]]);
    return strikeAt(sw, sweep);
  };
  const right = play(0.8), left = play(-0.8), small = play(0.45);

  assert.ok(right.faceDeg > 0, 'stopping right of centre must open the face');
  assert.ok(left.faceDeg < 0, 'stopping left of centre must shut it');
  assert.ok(Math.abs(right.faceDeg + left.faceDeg) < 1e-9, 'and be symmetric');
  assert.ok(Math.abs(small.faceDeg) < Math.abs(right.faceDeg),
    'a near miss must curve less than a bad one');
  assert.equal(small.pure, false, '0.45 is outside the fairway band');
});

test('the fairway band is genuinely forgiving', () => {
  const sw = new SwingController();
  sw.setLie('fairway');
  drag(sw, [[500, 100], [500, 100 + BACKSWING_PX]]);
  const shot = strikeAt(sw, 0.24);       // inside the 0.26 fairway band
  assert.equal(shot.pure, true);
  assert.equal(shot.faceDeg, 0, 'inside the band means genuinely straight');
});

/* ----------------------------------------------------------------- read --- */

test('the debug readout reports what was actually committed', () => {
  const sw = new SwingController();
  sw.setLie('rough');
  drag(sw, [[500, 100], [500, 100 + BACKSWING_PX * 1.0], [500, 100 + BACKSWING_PX * 0.62]]);
  const shot = strikeAt(sw, -0.5);
  const d = sw.debug();

  assert.ok(Math.abs(d.powerPct - 62) < 2, `powerPct ${d.powerPct}`);
  assert.equal(d.lie, 'rough');
  assert.ok(d.accuracyPct >= 0 && d.accuracyPct <= 100);
  assert.equal(d.shape, 'hook', `left of centre is a hook, got ${d.shape}`);
  assert.ok(Math.abs(d.faceDeg - shot.faceDeg) < 1e-9);
});

/* ----------------------------------------------------------- the bar ---- */

test('how hard you swing sets how fast the bar runs', () => {
  const soft = barTempo('fairway', 0.25);
  const full = barTempo('fairway', 1.0);
  assert.ok(full > soft * 1.4,
    `a full swing must be meaningfully harder to time than a touch shot ` +
    `(${soft.toFixed(2)} vs ${full.toFixed(2)} sweeps/s)`);
  // and it must be monotonic, or the meter would be lying about the trade
  let prev = 0;
  for (const p of [0.1, 0.3, 0.5, 0.7, 0.9, 1.0]) {
    const t = barTempo('fairway', p);
    assert.ok(t > prev, `tempo fell going from below ${p} power`);
    prev = t;
  }
});

test('the lie still sets the character of the bar, at every power', () => {
  for (const p of [0.3, 0.7, 1.0]) {
    assert.ok(barTempo('sand', p) < barTempo('green', p),
      'sand must stay the slowest bar on the course');
    assert.ok(barTempo('deep', p) > barTempo('fairway', p),
      'heavy rough must stay quicker than the fairway');
    assert.ok(barTempo('tee', p) < barTempo('fairway', p),
      'the tee must stay calmer than a fairway shot');
  }
});

test('a full swing off the tee is still calmer than the old fairway bar', () => {
  /* The tee was deliberately slowed because a twitchy opening stroke on every
     hole was the game's difficulty spike.  Multiplying tempo by power could
     quietly undo that, so it is pinned. */
  assert.ok(barTempo('tee', 1.0) < 1.05,
    `a full driver reads ${barTempo('tee', 1.0).toFixed(2)}, at or past the ` +
    `old fairway pace — the opening tee shot is twitchy again`);
});

test('no lie at any power becomes an unreadable blur', () => {
  for (const lie of Object.keys({ tee: 1, fairway: 1, rough: 1, deep: 1, waste: 1, sand: 1, green: 1, fringe: 1 })) {
    for (const p of [0.5, 1.0, 1.12]) {
      assert.ok(barTempo(lie, p) <= 1.45 + 1e-9,
        `${lie} at ${p} power runs at ${barTempo(lie, p).toFixed(2)} sweeps/s — ` +
        `past the ceiling the strike is a coin toss, not a skill`);
    }
  }
});

test('a bad lie is punished through precision, not just distance', () => {
  assert.ok(pureBand('rough') < pureBand('fairway') * 0.6,
    'the rough must offer a meaningfully smaller target than the fairway');
  assert.ok(pureBand('sand') < pureBand('fairway') * 0.6,
    'so must sand');
  assert.ok(pureBand('deep') < pureBand('rough'),
    'and heavy rough must be tighter still');
});

test('sand keeps its trade: the slowest bar, the smallest target', () => {
  assert.ok(barTempo('sand', 1) < barTempo('tee', 1),
    'sand must be slow to time');
  assert.ok(pureBand('sand') <= pureBand('rough'),
    'but must not be easy to hit');
});

test('the controller actually uses the power-aware tempo', () => {
  const play = frac => {
    const sw = new SwingController();
    sw.setLie('fairway');
    sw.enabled = true;
    sw.pointerDown(500, 100);
    sw.pointerMove(500, 100 + BACKSWING_PX * frac);
    sw.pointerUp();
    return sw.tempo;
  };
  assert.ok(play(1.0) > play(0.3) * 1.4,
    'a full swing must hand the player a faster bar than a soft one');
});

test('the meter previews the bar you are about to get', () => {
  const sw = new SwingController();
  sw.setLie('fairway');
  sw.enabled = true;
  sw.pointerDown(500, 100);
  sw.pointerMove(500, 100 + BACKSWING_PX * 0.3);
  const soft = sw.meter().tempo;
  sw.pointerMove(500, 100 + BACKSWING_PX * 1.0);
  const full = sw.meter().tempo;
  assert.ok(full > soft,
    'mid-drag the meter must show the tempo rising, or the trade is invisible');
});
