/* =========================================================================
   friends.js — a friends list without a sign-up
   -------------------------------------------------------------------------
   I said this needed accounts. It does not, and the reason is worth writing
   down because it is the whole design.

   Every player already has a durable id — `lg_pid`, kept in the portal's
   data store or in localStorage — and every coin, level, unlock, wardrobe
   choice and course record in this game is already keyed on it. A friends
   graph on the same key is exactly as durable as the level a player has
   spent two thousand rounds earning. If the id survives, friends survive
   with it; if it does not, they have lost their level too and a friends list
   is the least of it.

   So: no email, no password, no sign-up on a front page that advertises not
   having one.

   HOW YOU FIND SOMEBODY. A friend code, not a name search. Names in this
   game are neither unique nor reserved — two players called Owen is normal —
   so a search by name cannot identify anybody, and a directory of every
   player who has ever played is a privacy problem nobody asked for. A code
   is short, it is yours, you give it to somebody you actually know, and it
   cannot be enumerated: eight characters from a 31-letter alphabet is 850
   billion, and the server rate-limits redemption anyway.

   WHAT IS STORED. Edges, both directions, and a blocklist. Nothing else —
   no messages, no history of who looked at whom. A friendship is one entry
   in each of two sets.
   ========================================================================= */

import { loadBlob, saveBlob } from './store.js';

/* Crockford-ish: no I, L, O or U. The first three because they are the
   characters people mistype off a screenshot, and U because a random
   generator that can produce a four-letter word will eventually produce one
   somebody has to read out. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LEN = 8;

/* pid -> { code, friends:Set, blocked:Set, reqIn:Map, reqOut:Set, fav:Set } */
let graph = new Map();
/* code -> pid, so a redemption is a lookup rather than a scan of everybody */
let byCode = new Map();
const KEY = 'friends';

const MAX_FRIENDS = 200;
const MAX_PENDING = 50;
/* A request expires rather than sitting in a list forever. Somebody who
   asked three months ago and never came back is not a pending decision. */
const REQ_TTL_MS = 14 * 24 * 3600 * 1000;

export async function loadFriends() {
  const raw = await loadBlob(KEY, {}) || {};
  graph = new Map();
  byCode = new Map();
  for (const [pid, e] of Object.entries(raw.players || {})) {
    const rec = {
      code: typeof e.code === 'string' ? e.code : null,
      friends: new Set(Array.isArray(e.friends) ? e.friends : []),
      blocked: new Set(Array.isArray(e.blocked) ? e.blocked : []),
      fav: new Set(Array.isArray(e.fav) ? e.fav : []),
      reqIn: new Map(Object.entries(e.reqIn || {})),
      reqOut: new Set(Array.isArray(e.reqOut) ? e.reqOut : [])
    };
    graph.set(pid, rec);
    if (rec.code) byCode.set(rec.code, pid);
  }
  console.log(`  friends: ${graph.size} players, ` +
    `${[...graph.values()].reduce((a, r) => a + r.friends.size, 0) / 2 | 0} friendships`);
  return graph;
}

function persist() {
  const players = {};
  for (const [pid, r] of graph) {
    // never write an empty record: a player who once opened the panel and
    // did nothing should not grow the file forever
    if (!r.friends.size && !r.blocked.size && !r.reqIn.size && !r.reqOut.size && !r.code) continue;
    players[pid] = {
      code: r.code,
      friends: [...r.friends], blocked: [...r.blocked], fav: [...r.fav],
      reqIn: Object.fromEntries(r.reqIn), reqOut: [...r.reqOut]
    };
  }
  saveBlob(KEY, { players });
}

function rec(pid) {
  let r = graph.get(pid);
  if (!r) {
    r = { code: null, friends: new Set(), blocked: new Set(), fav: new Set(),
          reqIn: new Map(), reqOut: new Set() };
    graph.set(pid, r);
  }
  // sweep expired requests on read: there is no cron here, and a list that
  // is only ever correct when something writes to it is not correct
  const now = Date.now();
  for (const [from, req] of r.reqIn) {
    if (now - (req.at || 0) > REQ_TTL_MS) r.reqIn.delete(from);
  }
  return r;
}

/** This player's code, minted on first ask. */
export function friendCode(pid) {
  const r = rec(pid);
  if (r.code) return r.code;
  for (let tries = 0; tries < 40; tries++) {
    let c = '';
    for (let i = 0; i < CODE_LEN; i++) {
      c += ALPHABET[(Math.random() * ALPHABET.length) | 0];
    }
    if (byCode.has(c)) continue;
    r.code = c;
    byCode.set(c, pid);
    persist();
    return c;
  }
  return null;                    // 850 billion codes; this cannot happen
}

export const pidForCode = code =>
  byCode.get(String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '')) || null;

export const areFriends = (a, b) => !!graph.get(a)?.friends.has(b);
export const hasBlocked = (a, b) => !!graph.get(a)?.blocked.has(b);
export const friendsOf = pid => [...rec(pid).friends];
export const favouritesOf = pid => [...rec(pid).fav];

/**
 * Ask somebody to be friends.
 * Returns { ok } or { error }. Deliberately vague on failure in one case:
 * a blocked requester is told the request was sent, because "you have been
 * blocked" is information the blocker did not agree to share.
 */
export function requestFriend(from, toCode, note = '') {
  const to = pidForCode(toCode);
  if (!to) return { error: 'No player with that code.' };
  if (to === from) return { error: 'That is your own code.' };

  const a = rec(from), b = rec(to);
  if (a.friends.has(to)) return { error: 'You are already friends.' };
  if (a.blocked.has(to)) return { error: 'You have blocked that player.' };
  if (a.friends.size >= MAX_FRIENDS) return { error: 'Your friends list is full.' };

  /* Blocked by them: accept it silently. The request goes nowhere and they
     are told nothing, which is what blocking is for. */
  if (b.blocked.has(from)) return { ok: true, sent: true };

  /* They already asked YOU — so this is an acceptance, not a request. Doing
     it any other way leaves two people each waiting on the other. */
  if (a.reqIn.has(to)) return acceptFriend(from, to);

  if (b.reqIn.size >= MAX_PENDING) return { error: 'That player has too many pending requests.' };
  b.reqIn.set(from, { at: Date.now(), note: String(note || '').slice(0, 50) });
  a.reqOut.add(to);
  persist();
  return { ok: true, sent: true, to };
}

export function acceptFriend(pid, fromPid) {
  const a = rec(pid), b = rec(fromPid);
  if (!a.reqIn.has(fromPid)) return { error: 'That request is no longer there.' };
  a.reqIn.delete(fromPid);
  b.reqOut.delete(pid);
  if (a.friends.size >= MAX_FRIENDS) return { error: 'Your friends list is full.' };
  a.friends.add(fromPid);
  b.friends.add(pid);
  persist();
  return { ok: true, pid: fromPid };
}

export function declineFriend(pid, fromPid, block = false) {
  const a = rec(pid);
  a.reqIn.delete(fromPid);
  rec(fromPid).reqOut.delete(pid);
  if (block) return blockPlayer(pid, fromPid);
  persist();
  return { ok: true };
}

export function removeFriend(pid, other) {
  rec(pid).friends.delete(other);
  rec(pid).fav.delete(other);
  rec(other).friends.delete(pid);
  rec(other).fav.delete(pid);
  persist();
  return { ok: true };
}

export function blockPlayer(pid, other) {
  const a = rec(pid);
  a.blocked.add(other);
  a.friends.delete(other);
  a.fav.delete(other);
  a.reqIn.delete(other);
  a.reqOut.delete(other);
  const b = rec(other);
  b.friends.delete(pid);
  b.fav.delete(pid);
  b.reqIn.delete(pid);
  b.reqOut.delete(pid);
  persist();
  return { ok: true };
}

export function unblockPlayer(pid, other) {
  rec(pid).blocked.delete(other);
  persist();
  return { ok: true };
}

export function toggleFavourite(pid, other) {
  const a = rec(pid);
  if (!a.friends.has(other)) return { error: 'Not a friend.' };
  if (a.fav.has(other)) a.fav.delete(other); else a.fav.add(other);
  persist();
  return { ok: true, fav: a.fav.has(other) };
}

/** Pending requests, with the age the panel shows. */
export function pendingFor(pid) {
  const r = rec(pid);
  return [...r.reqIn.entries()].map(([from, q]) => ({
    pid: from, at: q.at, note: q.note || '', ago: Date.now() - q.at
  })).sort((a, b) => b.at - a.at);
}

/** Everything one player's panel needs, in one object. */
export function friendState(pid) {
  const r = rec(pid);
  return {
    code: friendCode(pid),
    friends: [...r.friends],
    favourites: [...r.fav],
    blocked: [...r.blocked],
    pending: pendingFor(pid),
    sent: [...r.reqOut]
  };
}
