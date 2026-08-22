/* =========================================================================
   telemetry.js — the event taxonomy §0.3 asks for, with nowhere to send it
   -------------------------------------------------------------------------
   §0.3 recommends ByteBrew because it answers exactly the questions this
   roadmap needs answered — funnel drop-off, retention cohorts, performance
   by GPU, content drop-off by hole, economy flow. Wiring a real analytics
   SDK means an account and an API key, which is the same category of
   action as §0.2's hosting changes: something the person running this
   game has to do themselves, not something to reach for here.

   What CAN be done without that account is the harder, more permanent
   half of the work: deciding what the events ARE and firing every one of
   them at the right moment, so that plugging in a backend later is a
   one-function change — everything below `track()` itself never has to
   move again. `track()` is a safe no-op today: it keeps a small in-memory
   buffer (inspectable from the console) and prints behind `?debug=1`, so
   the shape of what would be sent is verifiable right now, before
   anything is listening.

   TO WIRE A REAL BACKEND: replace the body of `track()` with the SDK's
   own call (e.g. `window.ByteBrew?.NewCustomEvent(event, props)`), or
   route it into CrazyGames' own SDK if that ever grows one. Nothing else
   in this file, or any of its call sites elsewhere, needs to change.
   ========================================================================= */

const DEBUG = (() => {
  try { return new URLSearchParams(location.search).get('debug') === '1'; }
  catch { return false; }
})();

const buffer = [];
const MAX_BUFFER = 200;

/** The one seam. Everything else in this file is naming, not plumbing. */
export function track(event, props = {}) {
  const row = { event, at: Date.now(), ...props };
  buffer.push(row);
  if (buffer.length > MAX_BUFFER) buffer.shift();
  if (DEBUG) console.debug('[telemetry]', event, props);
}

/** For a debug console, or a future in-game "what have we sent" panel. */
export function recentEvents() { return buffer.slice(); }

/* ─────────────────────────────────────────────────────────────── funnel ──
   page load → assets ready → menu → tee → hole 1 complete → round complete
   Drop-off between any two of these is the whole point of tracking them
   separately rather than as one "started playing" event. */
export const funnel = {
  pageLoad: () => track('funnel_page_load'),
  assetsReady: () => track('funnel_assets_ready'),
  menu: () => track('funnel_menu'),
  tee: (courseId) => track('funnel_tee', { courseId }),
  hole1Complete: (courseId) => track('funnel_hole1_complete', { courseId }),
  roundComplete: (courseId, strokes) => track('funnel_round_complete', { courseId, strokes })
};

/* ──────────────────────────────────────────────────────────── retention ──
   D1/D3/D7/D30 return, bucketed from a locally-stored last-seen date — no
   account needed for this half, since it is purely "have we seen this
   browser before, and how long ago". Call once per session, early. */
export function trackReturn() {
  let last = null, first = null;
  try {
    first = localStorage.getItem('lg_first_seen');
    last = localStorage.getItem('lg_last_seen');
  } catch { /* private mode: no history to read, nothing to track */ return; }
  const now = Date.now();
  if (!first) {
    try { localStorage.setItem('lg_first_seen', String(now)); } catch { /* ignore */ }
    track('retention_new_player');
  } else if (last) {
    const days = Math.floor((now - Number(last)) / 86400000);
    if (days >= 1) {
      const bucket = days === 1 ? 'd1' : days <= 3 ? 'd3' : days <= 7 ? 'd7' : days <= 30 ? 'd30' : 'd30plus';
      track('retention_return', { days, bucket });
    }
  }
  try { localStorage.setItem('lg_last_seen', String(now)); } catch { /* ignore */ }
}

/* ────────────────────────────────────────────────────────── performance ──
   fps distribution keyed by GPU renderer string, load time, worst-frame —
   the last of those is exactly what §1.8's overlay now also tracks; this
   is the same number, just reported instead of only displayed. */
export function trackPerf(props) { track('perf_sample', props); }

/* ──────────────────────────────────────────────────────────── content ──── */
export function trackHoleOutcome(holeNumber, completed, courseId) {
  track(completed ? 'hole_complete' : 'hole_dropoff', { hole: holeNumber, courseId });
}

/* ──────────────────────────────────────────────────────────── economy ──── */
export function trackCoins(delta, reason) { track('coins_earned', { delta, reason }); }
