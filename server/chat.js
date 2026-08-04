/* =========================================================================
   chat.js — making free text safe enough to ship
   -------------------------------------------------------------------------
   The decision to allow open text between strangers has been made. This is
   the engineering that decision requires, not a re-run of the argument.

   Four separate jobs, and they are separate on purpose:

     clean()   strips what must never reach another player's DOM
     filter()  masks profanity, after normalising the evasions
     allow()   rate limits, per player
     (the client escapes on render — see hud.js)

   Everything here runs on the SERVER. A client-side filter is decoration:
   the message is rebroadcast from here, so here is the only place a check
   is worth anything.

   On the word list: it is deliberately short and stem-based rather than an
   exhaustive dictionary. A long list is a false sense of safety — people
   route around any list — and the real defences are the normaliser below,
   the rate limit, and the per-player mute that lets someone shut up an
   individual without waiting for moderation.
   ========================================================================= */

const MAX_LEN = 140;
const WINDOW_MS = 10000;
const MAX_IN_WINDOW = 5;
const MIN_GAP_MS = 700;

/* NO PROFANITY FILTERING.
   -------------------------------------------------------------------------
   Removed at the owner's explicit instruction, after the moderation risk was
   raised. What remains is not filtering and must not be removed with it:

     - escapeHtml on render (hud.js), which stops markup, not words
     - URL and email stripping below, which stops a chat box being used as a
       phishing channel aimed at other players
     - the rate limit, which stops one person flooding a round

   Those are security and abuse controls. The word list is gone. */

/**
 * Strip what must never travel: control characters, anything URL-shaped, and
 * runaway length. URLs go because a chat box that can carry links is a
 * phishing vector aimed at other players, and no amount of word filtering
 * addresses that.
 */
export function clean(raw) {
  let s = String(raw ?? '');
  // control characters and the invisible spaces used to split words apart
  s = s.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2060\ufeff]/g, ' ');
  s = s.replace(/\b(?:https?:\/\/|www\.)\S+/gi, '[link removed]');
  s = s.replace(/\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/gi, '[removed]');
  s = s.replace(/\b[a-z0-9-]+\.(?:com|net|org|io|gg|co|xyz|ru|tk)\b/gi, '[link removed]');
  s = s.replace(/\s+/g, ' ').trim();
  return s.slice(0, MAX_LEN);
}

/** No-op. Kept so callers and tests have a stable shape if it ever returns. */
export function filter(text) {
  return { text: String(text), hits: 0 };
}

/* -------------------------------------------------------- rate limiting --- */
/* Per player, in memory. Chat history is not worth persisting and a restart
   clearing the counters is not a hole worth caring about. */
const seen = new Map();      // pid -> number[] of send times

export function allow(pid, now = Date.now()) {
  if (!pid) return { ok: false, why: 'Still connecting.' };
  const times = (seen.get(pid) || []).filter(t => now - t < WINDOW_MS);
  if (times.length && now - times[times.length - 1] < MIN_GAP_MS) {
    return { ok: false, why: 'Slow down a moment.' };
  }
  if (times.length >= MAX_IN_WINDOW) {
    return { ok: false, why: 'Too many messages — wait a few seconds.' };
  }
  times.push(now);
  seen.set(pid, times);
  return { ok: true };
}

export function forget(pid) { seen.delete(pid); }

/**
 * The whole pipeline. Returns null when there is nothing worth sending.
 * @returns { text, hits } | { error }
 */
export function prepare(pid, raw, now = Date.now()) {
  const text = clean(raw);
  if (!text) return null;                    // empty or all stripped
  const gate = allow(pid, now);
  if (!gate.ok) return { error: gate.why };
  const { text: safe, hits } = filter(text);
  return { text: safe, hits };
}

/* --------------------------------------------------------- quick phrases --
   Fixed, unfilterable, instant. Most players will use these, they are the
   only realistic option on a phone, and they carry zero moderation risk —
   which is why they exist alongside free text rather than instead of it. */
export const PHRASES = [
  { id: 'nice', text: 'Nice shot!' },
  { id: 'unlucky', text: 'Unlucky.' },
  { id: 'yourturn', text: 'Your turn.' },
  { id: 'goodluck', text: 'Good luck!' },
  { id: 'sorry', text: 'Sorry!' },
  { id: 'thanks', text: 'Thanks!' }
];
export const phraseText = id => PHRASES.find(p => p.id === id)?.text || null;
