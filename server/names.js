/* =========================================================================
   names.js — one name, one golfer
   -------------------------------------------------------------------------
   Names in this game have been free-for-all: type anything, no uniqueness,
   no reservation. Three players called Owen on one leaderboard is not a
   leaderboard, and "Golfer" at number one was the same problem wearing a
   different hat.

   So a name is CLAIMED. The registry maps a folded form to a pid, the claim
   is checked before it is granted, and it is released when the owner changes
   it. Everything is keyed on the same durable pid the profile, friends list
   and career already use — see friends.js for why that needs no sign-up.

   FOUR DECISIONS.

   Case- and shape-insensitive matching. "Owen", "owen", "0wen" and "O w e n"
   are the same claim, because a leaderboard people cannot read apart is a
   leaderboard with no uniqueness in practice. Folding is deliberately
   aggressive: strip everything but letters and digits, lowercase, and map
   the digits that stand in for letters.

   EXISTING NAMES ARE GRANDFATHERED. Thousands of players already have one,
   some of them duplicates, and taking a name off somebody who has had it for
   a year to satisfy a rule introduced today is the worst possible trade. A
   duplicate stands until its owner changes it; only NEW claims are checked.

   The first change is free and then it costs, which is the whole rename
   economy. Not to make money — this game has no money — but because a name
   that can be changed hourly is not an identity, and impersonation is the
   thing uniqueness was supposed to prevent.

   AND THE HISTORY IS KEPT. Somebody who renames away from "Owen" cannot use
   that to pretend they were never them; the profile shows what they were
   called and when it changed.
   ========================================================================= */

import { loadBlob, saveBlob } from './store.js';

const KEY = 'names';

/* folded -> { pid, at } */
let byName = new Map();
/* pid -> { name, folded, changes, lastChange, history:[{name, until}] } */
let byPid = new Map();

export const MIN_LEN = 3;
export const MAX_LEN = 20;
export const RENAME_COST = 500;                 // coins, after the first change
export const RENAME_COOLDOWN_MS = 30 * 24 * 3600 * 1000;

/* Reserved words. Not a profanity filter — that is a losing game and a
   separate problem — but the handful of names that would let somebody
   impersonate the game itself or a moderator, which is the one lie a name
   can tell that the player cannot check. */
const RESERVED = new Set([
  'admin', 'administrator', 'moderator', 'mod', 'staff', 'support',
  'official', 'system', 'server', 'bot', 'null', 'undefined', 'anonymous',
  'linksandlegends', 'linkslegends', 'developer', 'dev', 'owner', 'root',
  'golfer', 'guest', 'player', 'unknown', 'deleted', 'banned'
]);

/* CONFUSABLES, collapsed to one canonical character each.

   Not just digit-to-letter: the letters confuse each other too. Mapping only
   1 -> i left "8ramb1e" free while "Bramble" was taken, because the l in
   Bramble stayed an l and the 1 became an i. Every member of a confusable
   set has to land on the SAME character, whichever way round it was typed.

   This deliberately collapses some genuinely different names — "Bell" and
   "8e11" fold together — and that is the trade being made: two names nobody
   can tell apart on a leaderboard are one name for this purpose. */
const CONFUSE = {
  '0': 'o', 'o': 'o',
  '1': 'i', 'l': 'i', 'i': 'i', 'j': 'i',
  '3': 'e', 'e': 'e',
  '4': 'a', 'a': 'a',
  '5': 's', 's': 's',
  '7': 't', 't': 't',
  '8': 'b', 'b': 'b',
  '6': 'g', 'g': 'g',
  '2': 'z', 'z': 'z',
  '9': 'g'
};

/** The comparison form of a name. Two names that fold the same are one name. */
export function fold(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD').replace(/\p{M}/gu, '')          // strip accents
    .replace(/[^a-z0-9]/g, '')                            // and everything else
    .replace(/[a-z0-9]/g, c => CONFUSE[c] || c);
}

export async function loadNames() {
  const raw = await loadBlob(KEY, {}) || {};
  byName = new Map();
  byPid = new Map();
  for (const [pid, e] of Object.entries(raw.players || {})) {
    if (!e || typeof e.name !== 'string') continue;
    const rec = {
      name: e.name,
      folded: e.folded || fold(e.name),
      changes: Number(e.changes) || 0,
      lastChange: Number(e.lastChange) || 0,
      history: Array.isArray(e.history) ? e.history.slice(-10) : []
    };
    byPid.set(pid, rec);
    /* First claim wins on load. Two profiles can hold the same folded name
       from before uniqueness existed; the registry points at one of them and
       the other keeps its name until it changes. */
    if (!byName.has(rec.folded)) byName.set(rec.folded, { pid, at: rec.lastChange });
  }
  console.log(`  names: ${byPid.size} claimed`);
}

function persist() {
  const players = {};
  for (const [pid, r] of byPid) {
    players[pid] = {
      name: r.name, folded: r.folded, changes: r.changes,
      lastChange: r.lastChange, history: r.history.slice(-10)
    };
  }
  saveBlob(KEY, { players });
}

/* ------------------------------------------------------------ validation ---
   Returns null when the name is fine, or the reason it is not. The reason is
   shown to the player as they type, so every one of them says what to do
   rather than what went wrong. */
export function nameProblem(raw) {
  const name = String(raw ?? '').trim();
  if (name.length < MIN_LEN) return `At least ${MIN_LEN} characters.`;
  if (name.length > MAX_LEN) return `At most ${MAX_LEN} characters.`;
  /* Letters of any script, digits, and a little punctuation. Names are
     rendered in other players' browsers, so nothing that could be markup
     gets in at all — this is the same allow-list the old cleanName used,
     kept because it was already right. */
  if (!/^[\p{L}\p{N}][\p{L}\p{N} '._-]*[\p{L}\p{N}]$/u.test(name)) {
    return 'Letters and numbers, and it has to start and end with one.';
  }
  if (/[ '._-]{2,}/.test(name)) return 'No two punctuation marks in a row.';
  const f = fold(name);
  if (f.length < MIN_LEN) return 'Needs more letters or numbers in it.';
  if (RESERVED.has(f)) return 'That name is reserved.';
  return null;
}

/** Is this name free — or already yours? */
export function isFree(raw, pid = null) {
  const f = fold(raw);
  const held = byName.get(f);
  return !held || held.pid === pid;
}

/**
 * Everything the "check as you type" box needs, in one answer.
 * Suggestions only when it is taken, and only ones that are actually free.
 */
export function checkName(raw, pid = null) {
  const problem = nameProblem(raw);
  if (problem) return { ok: false, reason: problem };
  if (isFree(raw, pid)) return { ok: true };
  const base = String(raw).trim().slice(0, MAX_LEN - 3);
  const suggestions = [];
  for (let i = 0; suggestions.length < 3 && i < 40; i++) {
    const t = i < 20 ? `${base}${2 + i}` : `${base}${(Math.random() * 900 + 99) | 0}`;
    if (!nameProblem(t) && isFree(t, pid)) suggestions.push(t);
  }
  return { ok: false, reason: 'Somebody already plays under that name.', suggestions };
}

/** What a change would cost this player, and whether they may make one. */
export function renameQuote(pid) {
  const r = byPid.get(pid);
  if (!r) return { first: true, cost: 0, waitMs: 0 };
  const since = Date.now() - (r.lastChange || 0);
  /* The first change is free and immediate; every one after costs coins and
     waits out a cooldown. A name that can be changed hourly is not an
     identity, and impersonation is the thing uniqueness was for. */
  if (r.changes === 0) return { first: true, cost: 0, waitMs: 0 };
  return {
    first: false,
    cost: RENAME_COST,
    waitMs: Math.max(0, RENAME_COOLDOWN_MS - since)
  };
}

/**
 * Claim a name.
 *
 * @param charge  called with the cost when one applies; must return true if
 *                the player could pay. Kept as a callback so this file never
 *                has to know what a coin is.
 */
export function claimName(pid, raw, charge = null) {
  const problem = nameProblem(raw);
  if (problem) return { error: problem };

  const name = String(raw).trim();
  const f = fold(name);
  const held = byName.get(f);
  if (held && held.pid !== pid) return { error: 'Somebody already plays under that name.' };

  const cur = byPid.get(pid);
  if (cur && cur.folded === f) {
    // same name, different capitalisation: free, always, and not a "change"
    cur.name = name;
    persist();
    return { ok: true, name, free: true };
  }

  const quote = renameQuote(pid);
  if (!quote.first) {
    if (quote.waitMs > 0) {
      const days = Math.ceil(quote.waitMs / 86400000);
      return { error: `You can change your name again in ${days} day${days === 1 ? '' : 's'}.` };
    }
    if (quote.cost > 0 && !(charge && charge(quote.cost))) {
      return { error: `A name change costs ${quote.cost} coins.` };
    }
  }

  if (cur) {
    byName.delete(cur.folded);                  // release the old one
    cur.history.push({ name: cur.name, until: Date.now() });
    if (cur.history.length > 10) cur.history.shift();
    cur.name = name; cur.folded = f;
    cur.changes++; cur.lastChange = Date.now();
  } else {
    byPid.set(pid, { name, folded: f, changes: 0, lastChange: Date.now(), history: [] });
  }
  byName.set(f, { pid, at: Date.now() });
  persist();
  return { ok: true, name, charged: quote.first ? 0 : quote.cost };
}

/**
 * Take a name for a player who has never claimed one, WITHOUT the rules.
 *
 * This is the grandfather path, and it exists because thousands of players
 * already have names — some of them duplicates — and taking one off somebody
 * who has had it for a year to satisfy a rule introduced today is the worst
 * trade available. A name already in use is kept and simply not registered
 * as exclusive; only new claims compete.
 */
export function adoptName(pid, raw) {
  if (!pid || byPid.has(pid)) return false;
  const name = String(raw || '').trim();
  if (!name || nameProblem(name)) return false;
  const f = fold(name);
  byPid.set(pid, { name, folded: f, changes: 0, lastChange: 0, history: [] });
  if (!byName.has(f)) byName.set(f, { pid, at: 0 });
  persist();
  return true;
}

export const nameOf = pid => byPid.get(pid)?.name || null;
export const nameHistory = pid => (byPid.get(pid)?.history || []).slice().reverse();
export const claimCount = () => byPid.size;
