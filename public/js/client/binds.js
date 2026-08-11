/* =========================================================================
   binds.js — which key does what
   -------------------------------------------------------------------------
   Every action in the game used to be a literal in a chain of comparisons:
   `if (k === 'b')`, `if (k === 'q')`, and so on down a hundred lines. That is
   fine right up until somebody plays on an AZERTY keyboard, or is left-handed
   on the arrow keys, or simply cannot reach B and the mouse at once — and
   then it is not fine at all, because there is nothing they can do about it.

   So keys are DATA now. One table of actions with a default each, an override
   layer the player owns, and a single lookup from a pressed key to the thing
   it does. The dispatch in main.js asks "what action is this key" instead of
   "is this key B".

   Two rules that matter:

     - An action may hold more than one key, because W and Up Arrow are the
       same intent and always have been.
     - Rebinding an action to a key that is already taken REMOVES it from the
       other action rather than quietly creating a key that does two things.
       A conflict a player cannot see is worse than a rebind they have to
       redo.
   ========================================================================= */

/* The order here is the order the settings panel lists them, so it is grouped
   the way a player thinks about the game rather than alphabetically. */
export const ACTIONS = [
  { id: 'walkFwd',   group: 'Moving',   name: 'Walk forward',    keys: ['w', 'arrowup'] },
  { id: 'walkBack',  group: 'Moving',   name: 'Walk back',       keys: ['s', 'arrowdown'] },
  { id: 'walkLeft',  group: 'Moving',   name: 'Walk left',       keys: ['a', 'arrowleft'] },
  { id: 'walkRight', group: 'Moving',   name: 'Walk right',      keys: ['d', 'arrowright'] },
  { id: 'run',       group: 'Moving',   name: 'Run',             keys: ['shift'] },
  { id: 'toBall',    group: 'Moving',   name: 'Jog to your ball', keys: ['f'] },
  { id: 'cart',      group: 'Moving',   name: 'Get in / out of the cart', keys: ['c'] },
  { id: 'hail',      group: 'Moving',   name: 'Offer a lift',    keys: ['g'] },

  { id: 'clubDown',  group: 'The shot', name: 'Club down',       keys: ['q'] },
  { id: 'clubUp',    group: 'The shot', name: 'Club up',         keys: ['e'] },
  { id: 'strike',    group: 'The shot', name: 'Strike / re-frame', keys: [' '] },
  { id: 'cancel',    group: 'The shot', name: 'Cancel the shot', keys: ['escape'] },
  { id: 'reAim',     group: 'The shot', name: 'Re-aim at the pin', keys: ['r'] },

  { id: 'view',      group: 'Camera',   name: 'Change view',     keys: ['v'] },
  { id: 'cam1',      group: 'Camera',   name: 'Camera 1 — behind',  keys: ['1'] },
  { id: 'cam2',      group: 'Camera',   name: 'Camera 2 — high',    keys: ['2'] },
  { id: 'cam3',      group: 'Camera',   name: 'Camera 3 — side on', keys: ['3'] },
  { id: 'cam4',      group: 'Camera',   name: 'Camera 4 — first person', keys: ['4'] },
  { id: 'map',       group: 'Camera',   name: 'Hole map',        keys: ['m'] },

  { id: 'melee',     group: 'Social',   name: 'Melee',           keys: ['b'] },
  { id: 'meleeNext', group: 'Social',   name: 'Switch melee',    keys: ['n'] },
  { id: 'emote',     group: 'Social',   name: 'Emote wheel',     keys: ['t'] },
  { id: 'chat',      group: 'Social',   name: 'Chat',            keys: ['enter'] },
  { id: 'perf',      group: 'Social',   name: 'Frame counter',   keys: ['p'] }
];

const STORE = 'lg_binds';
const defaults = () => Object.fromEntries(ACTIONS.map(a => [a.id, a.keys.slice()]));

let binds = defaults();
let lookup = new Map();

/** Rebuild the key -> action index. Called after every change. */
function reindex() {
  lookup = new Map();
  for (const [id, keys] of Object.entries(binds)) {
    for (const k of keys) lookup.set(k, id);
  }
}

export function loadBinds() {
  binds = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved && typeof saved === 'object') {
      for (const a of ACTIONS) {
        /* Only ids we still ship, and only arrays of strings. A saved file
           from an older build that names an action which no longer exists
           must not resurrect it, and one that names none of them must not
           leave the player with no controls at all. */
        const v = saved[a.id];
        if (Array.isArray(v) && v.every(k => typeof k === 'string') && v.length) {
          binds[a.id] = v.slice(0, 3);
        }
      }
    }
  } catch { /* private mode, or corrupt — defaults are fine */ }
  reindex();
  return binds;
}

function save() {
  try { localStorage.setItem(STORE, JSON.stringify(binds)); } catch { /* private mode */ }
}

/** What does this key do? Returns an action id, or null. */
export const actionFor = key => lookup.get(String(key).toLowerCase()) || null;
/** Is this key bound to that action? The form the dispatch actually wants. */
export const isAct = (key, id) => actionFor(key) === id;
/** The keys currently on an action. */
export const keysFor = id => (binds[id] || []).slice();

/**
 * Bind a key to an action, taking it off whatever had it.
 *
 * Returns the action it was stolen from, so the panel can say so — a silent
 * steal leaves the player wondering why something else stopped working.
 */
export function bindKey(id, key, slot = 0) {
  const k = String(key).toLowerCase();
  if (!binds[id]) return null;
  let stolenFrom = null;
  for (const [other, keys] of Object.entries(binds)) {
    const at = keys.indexOf(k);
    if (at < 0) continue;
    if (other === id && at === slot) return null;      // no change
    keys.splice(at, 1);
    if (other !== id) stolenFrom = other;
    // an action must never end up with nothing on it
    if (!keys.length && other !== id) {
      keys.push(...ACTIONS.find(a => a.id === other).keys.filter(x => x !== k));
    }
  }
  const list = binds[id];
  if (slot < list.length) list[slot] = k; else list.push(k);
  binds[id] = list.filter(Boolean).slice(0, 3);
  if (!binds[id].length) binds[id] = [k];
  reindex(); save();
  return stolenFrom;
}

export function resetBinds() {
  binds = defaults();
  reindex(); save();
  return binds;
}

/** Has the player changed anything? Drives the "reset" button's state. */
export const bindsAreDefault = () => {
  const d = defaults();
  return ACTIONS.every(a => (binds[a.id] || []).join(',') === d[a.id].join(','));
};

/** A key as a player would recognise it on a keycap. */
export function keyLabel(k) {
  if (k === ' ') return 'Space';
  if (k === 'arrowup') return '↑';
  if (k === 'arrowdown') return '↓';
  if (k === 'arrowleft') return '←';
  if (k === 'arrowright') return '→';
  if (k === 'escape') return 'Esc';
  if (k === 'enter') return 'Enter';
  if (k === 'shift') return 'Shift';
  if (k === 'control') return 'Ctrl';
  if (k === 'tab') return 'Tab';
  return k.length === 1 ? k.toUpperCase() : k;
}

/* Keys the game will not let you bind, because taking them would cost the
   player the ability to undo it — or the browser's own behaviour. */
export const RESERVED = new Set(['f5', 'f11', 'f12', 'meta', 'alt', 'control', 'contextmenu']);

loadBinds();
