/* =========================================================================
   crazygames.js — the portal adapter
   -------------------------------------------------------------------------
   Everything CrazyGames-specific lives behind this one module, and every
   entry point is safe to call when the SDK is absent.  That matters: the
   same build runs on crazygames.com, on our own Render URL, and on
   localhost, and only the first of those has an SDK.  Nothing here may ever
   be load-bearing — if the script is blocked, the game must still play.

   What it covers, in the order CrazyGames QA looks for it:

     loading   loadingStart/Stop around boot, so the portal knows when the
               download has finished and gameplay can begin.
     gameplay  gameplayStart when a round begins, gameplayStop whenever we
               leave it for a menu.  Their ad timing depends on these.
     audio     settings.muteAudio takes PRIORITY over our own mute, per their
               requirements, and we subscribe to changes.
     data      the Data module, which persists across devices for a logged-in
               CrazyGames user and falls back to localStorage for a guest.
     invite    inviteLink/getInviteParam, which is how a multiplayer room code
               is meant to travel on the portal (a ?room= query string does
               not survive their iframe).
   ========================================================================= */

const SDK = () => (typeof window !== 'undefined' ? window.CrazyGames?.SDK : null);

export const CG = {
  ready: false,       // init resolved (successfully or not)
  present: false,     // a real SDK answered
  muted: false        // the PLATFORM's mute, which overrides ours
};

let onMuteChange = null;

/* The SDK ignores every call made before init() resolves, and the portal
   measures loading from as early as it can — so init starts the instant this
   module is imported, not when the game gets around to asking.  Everything
   else queues behind it.  The SDK script tag is a classic script, so it has
   already run by the time this module (which is deferred) evaluates. */
const booted = (async () => {
  const sdk = SDK();
  if (!sdk?.init) { CG.ready = true; return CG; }
  try {
    // A hung portal must not hang the game, hence the race.
    await Promise.race([sdk.init(), new Promise(r => setTimeout(r, 4000))]);
    CG.present = true;
  } catch { /* not on the portal, or it failed: play on regardless */ }
  CG.ready = true;
  return CG;
})();

/** Run something against the SDK once it is up; never throws, never blocks. */
const after = fn => { booted.then(() => { try { fn(SDK()); } catch { /* no SDK */ } }); };

/**
 * Attach the platform-mute bridge and wait for init.  Init itself is already
 * in flight (above); this is where the game finds out how it went.
 */
export async function initCG({ onMute } = {}) {
  onMuteChange = onMute || null;
  await booted;
  try {
    const sdk = SDK();
    CG.muted = !!sdk?.game?.settings?.muteAudio;
    sdk?.game?.addSettingsChangeListener?.(s => {
      CG.muted = !!s?.muteAudio;
      onMuteChange?.(CG.muted);
    });
  } catch { /* no SDK */ }
  return CG;
}

/* ------------------------------------------------------------- lifecycle */
export const loadingStart = () => after(sdk => sdk?.game?.loadingStart?.());
export const loadingStop  = () => after(sdk => sdk?.game?.loadingStop?.());

/* Their ad scheduling keys off these, so they must bracket real play only —
   not menus, not the clubhouse, not the results card. */
let playing = false;
export function gameplayStart() {
  if (playing) return;
  playing = true;
  after(sdk => sdk?.game?.gameplayStart?.());
}
export function gameplayStop() {
  if (!playing) return;
  playing = false;
  after(sdk => sdk?.game?.gameplayStop?.());
}

/** A genuinely good moment — the portal plays its own celebration. */
export const happytime = () => after(sdk => sdk?.game?.happytime?.());

/* ------------------------------------------------------------- invites ---
   On the portal a shared ?room=CODE query string does not reach the game:
   the page is inside their iframe and they own the address bar.  inviteLink
   is the supported channel, so the room code rides in their parameters and
   we read it back with getInviteParam. */
export function inviteLink(code) {
  try {
    const l = SDK()?.game?.inviteLink?.({ room: code });
    if (l) return l;
  } catch { /* fall through to our own URL */ }
  return (globalThis.location?.origin || '') + '/?room=' + code;
}

export function invitedRoom() {
  try {
    const v = SDK()?.game?.getInviteParam?.('room');
    if (v) return String(v).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  } catch { /* no SDK */ }
  return null;
}

/* ---------------------------------------------------------------- data ---
   The Data module is synchronous and string-valued.  For a logged-in
   CrazyGames user it follows them between devices; for a guest it is backed
   by localStorage — which is also exactly our fallback when there is no SDK
   at all, so one code path covers every case. */
export function storeGet(key) {
  try {
    const v = SDK()?.data?.getItem?.(key);
    if (v != null) return v;
  } catch { /* fall through */ }
  try { return localStorage.getItem(key); } catch { return null; }
}

export function storeSet(key, value) {
  const v = String(value);
  let stored = false;
  try { SDK()?.data?.setItem?.(key, v); stored = true; } catch { /* fall through */ }
  // Mirror to localStorage as well: if the player later signs in to
  // CrazyGames, or plays the same build off-portal, their progress is
  // already where the other path looks for it.
  try { localStorage.setItem(key, v); } catch { /* private mode */ }
  return stored;
}
