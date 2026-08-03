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

/* Two lists, because one matching rule cannot serve both.

   WORD stems must BE the token (allowing ordinary suffixes). Substring
   matching on these is the Scunthorpe problem, and it is not hypothetical —
   the first version of this file masked "Scunthorpe", and would equally have
   masked anyone from there trying to say where they live.

   ANY stems are matched anywhere in the token, because they have no innocent
   substring use and are exactly the words that get a game pulled. */
const STEMS_WORD = [
  'fuck', 'shit', 'cunt', 'bitch', 'bastard', 'wank', 'dick', 'cock',
  'pussy', 'slut', 'whore', 'rape', 'kys', 'retard'
];
const STEMS_ANY = ['nigg', 'fagg'];

/* Ordinary things people put on the end of a word. Without these the list
   catches "fuck" and misses "fucking", which is not a filter. */
/* Anchored at BOTH ends. Anchored only at the end, the optional group
   matches empty anywhere and the test is always true — which is how the
   first version masked "shiitake", "cocktail", "cockpit" and "Wankel". */
const SUFFIX = /^(?:s|es|ed|er|ers|ing|in|y|ies|head|heads|face|faces|hole|holes|off|wit|wits)$/;

/* Evasions get normalised away before matching: f.u.c.k, fuuuuck, ƒuck. */
const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };

function normalise(word, collapse) {
  let n = word
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')      // strip accents
    .replace(/[^a-z0-9@$!]/g, '')                            // drop punctuation
    .replace(/[0134578@$!]/g, c => LEET[c] || c);            // undo leetspeak
  // Two collapses, because neither alone is right: 'fuuuuuck' needs runs
  // taken down to ONE to reach 'fuck', but 'shitt' only needs doubling
  // removed and 'cool' must not become 'col' in the doubled form.
  return collapse === 'one' ? n.replace(/(.)\1+/g, '$1') : n.replace(/(.)\1{2,}/g, '$1$1');
}

function hits(n) {
  if (n.length < 3) return false;
  if (STEMS_ANY.some(s => n.includes(s))) return true;
  return STEMS_WORD.some(s => {
    if (!n.startsWith(s)) return false;
    const rest = n.slice(s.length);
    return rest === '' || SUFFIX.test(rest);
  });
}

/** Does this token contain a blocked stem, once the evasions are undone? */
function blocked(token) {
  return hits(normalise(token, 'double')) || hits(normalise(token, 'one'));
}

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

/** Mask blocked words, keeping the sentence readable. */
export function filter(text) {
  let hits = 0;
  const out = String(text).split(' ').map(tok => {
    if (!blocked(tok)) return tok;
    hits++;
    // keep the shape so the sentence still reads, but not the word
    return '*'.repeat(Math.max(3, Math.min(tok.length, 8)));
  }).join(' ');
  return { text: out, hits };
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
