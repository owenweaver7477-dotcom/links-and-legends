/* =========================================================================
   activity.js — what your friends have been doing, and how you stand
   -------------------------------------------------------------------------
   Two things that look separate and are the same data seen twice.

   THE FEED is what happened recently: somebody had an ace, somebody beat
   their best round, somebody came back after a fortnight. Without it the
   friends list is a column of names with a green dot, which tells you who
   is online and nothing about whether it is worth saying hello.

   HEAD TO HEAD is the same events aggregated per pair: you have played
   Sam eleven times and won four. A game where you can play the same person
   every evening for a month and never be told that is throwing away the
   only story it has.

   WHY IT IS ALL IN MEMORY, WITH A CAP. This is the least important data in
   the game — losing it costs a paragraph of history, not a player's clubs —
   and it is by far the highest-churn. So it is a bounded ring per player
   that never touches the disk, and if the process restarts, the feed starts
   again from empty. Head-to-head records DO persist, because "we are 6-5"
   is a thing people remember and would notice losing; they live on the
   profile, which is already saved.

   NOTHING IS PUBLIC. A feed entry is only ever shown to somebody who is
   already a mutual friend of the player it is about, and the check happens
   at read time rather than write time — friendships are made and broken
   after events happen, and an entry written while you were friends should
   not still be readable once somebody has unfriended or blocked you.
   ========================================================================= */

import { areFriends, hasBlocked, friendsOf } from './friends.js';

/* Per player, newest last. Small on purpose: nobody scrolls a feed this
   far, and an unbounded one on a busy server is a slow memory leak with a
   friendly name. */
const MAX_PER_PLAYER = 40;
const feeds = new Map();      // pid -> [{ t, kind, text, meta }]

/* How long an entry is worth showing. A feed that surfaces a birdie from
   three weeks ago is not telling you what is happening, it is telling you
   nothing has. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** The kinds, and how each one reads. Order is roughly "worth interrupting". */
export const FEED_KINDS = {
  ace:      { icon: '🎯', weight: 100 },
  albatross:{ icon: '🦅', weight: 90 },
  eagle:    { icon: '🦅', weight: 60 },
  record:   { icon: '🏆', weight: 80 },
  best:     { icon: '📈', weight: 50 },
  level:    { icon: '⭐', weight: 30 },
  round:    { icon: '⛳', weight: 10 },
  joined:   { icon: '👋', weight: 20 }
};

const ring = pid => {
  let r = feeds.get(pid);
  if (!r) feeds.set(pid, r = []);
  return r;
};

/**
 * Record something a player did.
 *
 * @param pid   who did it
 * @param kind  a key of FEED_KINDS
 * @param text  already-rendered, past tense, no name — the reader's own
 *              view prepends the name, so the same entry reads correctly
 *              whether it is "you" or "Sam"
 */
export function push(pid, kind, text, meta = null) {
  if (!pid || !FEED_KINDS[kind] || !text) return;
  const r = ring(pid);
  r.push({ t: Date.now(), kind, text: String(text).slice(0, 120), meta });
  if (r.length > MAX_PER_PLAYER) r.splice(0, r.length - MAX_PER_PLAYER);
}

/**
 * The feed one player should see: their friends' entries and their own,
 * newest first.
 *
 * The friendship check is HERE rather than at write time on purpose. An
 * entry written last week while you were friends must stop being visible
 * the moment somebody unfriends or blocks — filtering on the way in would
 * leave it readable forever.
 */
export function feedFor(pid, { limit = 30, nameOf } = {}) {
  if (!pid) return [];
  const cutoff = Date.now() - MAX_AGE_MS;
  const out = [];
  const sources = [pid, ...friendsOf(pid)];

  for (const src of sources) {
    if (src !== pid) {
      // both directions, so a block from either side hides the entry
      if (!areFriends(pid, src)) continue;
      if (hasBlocked(pid, src) || hasBlocked(src, pid)) continue;
    }
    for (const e of ring(src)) {
      if (e.t < cutoff) continue;
      out.push({
        t: e.t, kind: e.kind, text: e.text, meta: e.meta,
        pid: src, mine: src === pid,
        name: src === pid ? 'You' : (nameOf?.(src) || 'A friend')
      });
    }
  }
  out.sort((a, b) => b.t - a.t);
  return out.slice(0, limit);
}

/** Drop everything about a player — used when a profile is wiped. */
export function forget(pid) { feeds.delete(pid); }

/* ═════════════════════════════════════════════════ HEAD TO HEAD ═══════
   Stored on the profile as `h2h: { [otherPid]: { w, l, d, last, name } }`,
   so it is saved with everything else and needs no store of its own.

   ONLY COMPLETED ROUNDS COUNT, and only rounds where both players actually
   finished. Half the reason to keep a record like this is arguing about it,
   and a record that counts the time somebody's wifi died is a record that
   loses the argument. */

/** One finished round between everybody who was in it. */
export function recordHeadToHead(results, profileOf) {
  /* `results` is [{ pid, name, total, finished }]. Every pair in the room
     gets a result against every other pair — a four-ball is six separate
     head-to-heads, which is what it feels like to play one. */
  const done = results.filter(r => r.finished && Number.isFinite(r.total));
  if (done.length < 2) return;

  for (const a of done) {
    const pa = profileOf(a.pid);
    if (!pa) continue;
    if (!pa.h2h || typeof pa.h2h !== 'object') pa.h2h = {};
    for (const b of done) {
      if (a.pid === b.pid) continue;
      const rec = pa.h2h[b.pid] || { w: 0, l: 0, d: 0, last: 0, name: b.name };
      if (a.total < b.total) rec.w++;
      else if (a.total > b.total) rec.l++;
      else rec.d++;
      rec.last = Date.now();
      rec.name = b.name || rec.name;          // names change; the record does not
      pa.h2h[b.pid] = rec;
    }
    /* Bounded, because a popular player would otherwise accumulate a row
       per stranger forever. Keep the most recently played. */
    const keys = Object.keys(pa.h2h);
    if (keys.length > 60) {
      keys.sort((x, y) => (pa.h2h[y].last || 0) - (pa.h2h[x].last || 0));
      const trimmed = {};
      for (const k of keys.slice(0, 60)) trimmed[k] = pa.h2h[k];
      pa.h2h = trimmed;
    }
  }
}

/** One player's record against everybody, most recently played first. */
export function headToHeadFor(p, limit = 20) {
  const h = p?.h2h;
  if (!h || typeof h !== 'object') return [];
  return Object.entries(h)
    .map(([pid, r]) => ({
      pid, name: r.name || 'Player',
      w: r.w | 0, l: r.l | 0, d: r.d | 0,
      played: (r.w | 0) + (r.l | 0) + (r.d | 0),
      last: r.last || 0
    }))
    .filter(r => r.played > 0)
    .sort((a, b) => b.last - a.last)
    .slice(0, limit);
}

/** The record between exactly two players, from the first one's side. */
export function recordAgainst(p, otherPid) {
  const r = p?.h2h?.[otherPid];
  if (!r) return null;
  const played = (r.w | 0) + (r.l | 0) + (r.d | 0);
  return played ? { w: r.w | 0, l: r.l | 0, d: r.d | 0, played,
                    name: r.name || 'Player' } : null;
}
