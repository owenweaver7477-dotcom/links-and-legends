/* =========================================================================
   radial.js — one gesture instead of one button per thing
   -------------------------------------------------------------------------
   Everything you can do that is not hitting the ball lives on a different
   key: E for emotes, B for a shove, C for the cart, T for chat, F to jog up.
   That is fine once you know it and it is invisible until you do, which is
   why the touchpad on a phone grew to a labelled grid of buttons covering
   the bottom of the screen — the only way to make the actions discoverable
   was to draw all of them all the time.

   A radial is the answer to both. Hold one thing down and every action
   appears around your thumb; flick toward one and let go. It is one gesture
   to learn, it works identically with a mouse and a finger, and it costs no
   screen space at all when it is closed.

   WHY ANGLE AND NOT HIT-TESTING. The selection is whichever wedge your
   direction falls in, computed from the angle alone, with a dead zone in
   the middle for "changed my mind". That means a flick works even when it
   travels far past the ring — which is what a fast gesture actually does,
   and what makes hit-testing the drawn buttons feel broken on a phone.
   ========================================================================= */

const DEAD_ZONE = 26;        // px: inside this, nothing is selected

let root = null, items = [], open = false, chosen = -1;
let cx = 0, cy = 0, onPick = null, pointer = null;

function build() {
  if (root) return root;
  root = document.createElement('div');
  root.className = 'radial';
  root.hidden = true;
  document.body.appendChild(root);
  return root;
}

/** Wedge index for a point, or -1 inside the dead zone. */
function pick(x, y) {
  const dx = x - cx, dy = y - cy;
  if (Math.hypot(dx, dy) < DEAD_ZONE) return -1;
  /* Screen y grows downward, so the angle is negated to make "up" the top
     of the wheel. Rotated by half a wedge so the FIRST item sits centred at
     the top rather than straddling it. */
  const a = Math.atan2(-dy, dx);
  const step = (Math.PI * 2) / items.length;
  let k = Math.round((Math.PI / 2 - a) / step);
  k = ((k % items.length) + items.length) % items.length;
  return k;
}

function paint() {
  for (let i = 0; i < items.length; i++) {
    root.children[i]?.classList.toggle('on', i === chosen);
  }
  root.dataset.label = chosen >= 0 ? (items[chosen].name || '') : '';
}

/**
 * Open the wheel at a point.
 *
 * @param list  [{ id, icon, name, locked, sub }]
 * @param at    { x, y } screen point — usually where the finger went down
 * @param pick  called with the chosen id, or nothing if cancelled
 */
export function openRadial(list, at, cb) {
  const usable = (list || []).slice(0, 10);
  if (!usable.length) return;
  items = usable;
  onPick = cb;
  chosen = -1;
  const r = build();

  /* Keep the whole wheel on screen. Opening at the edge — which is exactly
     where a right thumb lives on a phone — would otherwise put half the
     actions past the bezel. */
  const RAD = 96, PAD = RAD + 30;
  cx = Math.min(window.innerWidth - PAD, Math.max(PAD, at?.x ?? window.innerWidth / 2));
  cy = Math.min(window.innerHeight - PAD, Math.max(PAD, at?.y ?? window.innerHeight / 2));
  r.style.left = cx + 'px';
  r.style.top = cy + 'px';

  r.innerHTML = '';
  const step = (Math.PI * 2) / items.length;
  items.forEach((it, i) => {
    const a = Math.PI / 2 - i * step;          // first item at the top
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rad-item' + (it.locked ? ' locked' : '');
    b.style.transform =
      `translate(-50%,-50%) translate(${Math.cos(a) * RAD}px, ${-Math.sin(a) * RAD}px)`;
    b.innerHTML = `<span class="rad-ico">${it.icon || '•'}</span>`;
    b.title = it.locked ? `${it.name} — ${it.sub || 'locked'}` : (it.name || '');
    r.appendChild(b);
  });

  r.hidden = false;
  open = true;
  requestAnimationFrame(() => r.classList.add('in'));
  paint();
}

/** Track a moving pointer while the wheel is open. */
export function moveRadial(x, y) {
  if (!open) return;
  const k = pick(x, y);
  if (k !== chosen) { chosen = k; paint(); }
}

/** Let go: fire whatever is selected. */
export function closeRadial(fire = true) {
  if (!open) return null;
  open = false;
  const it = fire && chosen >= 0 ? items[chosen] : null;
  root.classList.remove('in');
  setTimeout(() => { if (root && !open) root.hidden = true; }, 160);
  /* A locked item is shown rather than hidden — a slot you can see is a
     reason to play another round and a missing one is not — but choosing it
     does nothing except say what it needs. */
  if (it && it.locked) { onPick?.(null, it); return null; }
  if (it) onPick?.(it.id, it);
  return it?.id ?? null;
}

export const radialOpen = () => open;

/**
 * Wire a hold-to-open gesture onto an element.
 *
 * Works for mouse and touch through pointer events, which is the whole
 * reason this is one code path rather than two — a wheel that behaved
 * differently under a finger would be a wheel that only ever got tested
 * with a mouse.
 */
/**
 * @param buttons  which mouse buttons arm the hold. Defaults to the left/
 *   primary button, which is right for a UI control; the course itself
 *   passes [1, 2] so that holding the RIGHT button opens the wheel and the
 *   left button is left alone for the swing. Touch reports button 0 for
 *   every contact, so a touch always arms regardless of this list.
 */
export function bindRadial(el, listFn, cb, { holdMs = 180, buttons = null,
                                             mouseOnly = false } = {}) {
  if (!el) return;
  let timer = 0, startX = 0, startY = 0, armed = false;

  const down = e => {
    const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
    /* NEVER ON TOUCH, for the binding that covers the course itself.
       A backswing IS a press-and-hold-drag — that is the entire gesture —
       so arming a 220 ms hold on the same surface meant that on any
       touchscreen, starting a swing opened this menu instead and
       `setPointerCapture` took the pointer away from the swing. The club
       could not be taken back at all.

       Touch already has its own way in: the More button on the touchpad,
       which is bound separately and does not pass this flag. A phone loses
       nothing; it just does not get a gesture that collides with the only
       gesture that matters. */
    if (touch && mouseOnly) return;
    if (!touch && buttons && !buttons.includes(e.button)) return;
    if (!touch && !buttons && e.button != null && e.button > 1) return;
    startX = e.clientX; startY = e.clientY;
    armed = true;
    pointer = e.pointerId;
    /* A HOLD, not a tap: the same control can still do its normal job on a
       quick press, so adding the wheel does not cost the button it lives on. */
    timer = setTimeout(() => {
      if (!armed) return;
      openRadial(listFn(), { x: startX, y: startY }, cb);
      try { el.setPointerCapture?.(pointer); } catch { /* not captureable */ }
    }, holdMs);
  };
  /* A HOLD IS STATIONARY; A DRAG IS A DRAG. Without this, right-dragging to
     look around the hole also armed the wheel, and 220 ms later it opened
     in the middle of the camera move — so on a mouse you could not look
     around at all without the menu appearing over the top of it.

     Sixteen pixels of slop, because nobody holds a mouse perfectly still,
     and cancelling on the first jitter would make the gesture feel broken
     in the other direction. */
  const CANCEL_AT = 16;
  const move = e => {
    if (armed && !open &&
        Math.hypot(e.clientX - startX, e.clientY - startY) > CANCEL_AT) {
      clearTimeout(timer);
      armed = false;
      return;
    }
    if (open) { moveRadial(e.clientX, e.clientY); e.preventDefault(); }
  };
  const up = () => {
    clearTimeout(timer);
    armed = false;
    if (open) closeRadial(true);
  };

  el.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', () => { clearTimeout(timer); armed = false; closeRadial(false); });
}
