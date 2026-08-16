/* =========================================================================
   radial.mjs — the wheel must never eat the swing
   -------------------------------------------------------------------------
   The radial menu opens on a press-and-hold. A golf backswing is a
   press-and-hold-and-drag. Bound to the same surface, the second one becomes
   the first: hold to take the club back, and 220 ms later the menu opens and
   `setPointerCapture` takes the pointer away from the swing.

   On a mouse this never showed, because the course binding only arms on the
   right and middle buttons and the swing is the left one. On touch there are
   no buttons to tell them apart, so every touch armed it — and the club
   could not be taken back AT ALL on any phone or tablet.

   I shipped that. It survived because the browser I test in reports mouse
   pointers, so every check I ran took the desktop path.

   These drive bindRadial with synthetic pointer events of each type and
   assert on what it does, which is the only way to test a gesture without
   a finger.
   ========================================================================= */

import assert from 'node:assert/strict';
import test from 'node:test';

/* A DOM small enough to hold a listener and a pointer id. jsdom would be a
   dependency for four methods. */
function fakeEl() {
  const on = {};
  return {
    on,
    addEventListener: (k, fn) => { (on[k] ||= []).push(fn); },
    setPointerCapture: () => { fakeEl.captured = true; },
    fire: (k, e) => (on[k] || []).forEach(fn => fn(e))
  };
}

function harness() {
  globalThis.window = {
    innerWidth: 1200, innerHeight: 800,
    addEventListener: () => {}, removeEventListener: () => {}
  };
  globalThis.requestAnimationFrame = fn => fn();
  const made = [];
  globalThis.document = {
    createElement: () => {
      const n = { style: {}, dataset: {}, classList: { add(){}, remove(){}, toggle(){} },
                  children: [], appendChild(c) { this.children.push(c); },
                  addEventListener(){}, set innerHTML(_) { this.children.length = 0; } };
      made.push(n);
      return n;
    },
    body: { appendChild(){} }
  };
  return made;
}

const press = (type, button = 0) => ({
  pointerType: type, button, pointerId: 1, clientX: 400, clientY: 300,
  preventDefault() {}
});

async function opensAfterHold(opts, ev) {
  harness();
  const { bindRadial, radialOpen, closeRadial } = await import(
    '../public/js/client/radial.js?' + Math.random());
  const el = fakeEl();
  bindRadial(el, () => [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], () => {},
             { holdMs: 5, ...opts });
  el.fire('pointerdown', ev);
  await new Promise(r => setTimeout(r, 30));
  const open = radialOpen();
  closeRadial(false);
  return open;
}

test('a touch on the course does NOT open the wheel', async () => {
  /* The bug, stated as a test. A touch here is somebody starting a swing. */
  assert.equal(await opensAfterHold({ buttons: [1, 2], mouseOnly: true }, press('touch')), false,
    'a touch armed the wheel — the backswing would be stolen');
});

test('a pen counts as touch for this, because it is a drag too', async () => {
  assert.equal(await opensAfterHold({ buttons: [1, 2], mouseOnly: true }, press('pen')), false);
});

test('the right mouse button still opens it on the course', async () => {
  assert.equal(await opensAfterHold({ buttons: [1, 2], mouseOnly: true }, press('mouse', 2)), true,
    'the desktop gesture stopped working');
});

test('the left mouse button never opens it on the course', async () => {
  /* Left is the swing on a mouse as well. */
  assert.equal(await opensAfterHold({ buttons: [1, 2], mouseOnly: true }, press('mouse', 0)), false);
});

test('a touch DOES open it on a control that is not the course', async () => {
  /* The More button on the touchpad is bound without mouseOnly, and it has
     to keep working — it is the only way a phone reaches the wheel at all. */
  assert.equal(await opensAfterHold({}, press('touch')), true,
    'the phone lost its only route to the radial menu');
});
