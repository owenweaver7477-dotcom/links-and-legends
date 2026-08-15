/* =========================================================================
   friends.mjs — a social graph is a privacy surface before it is a feature
   -------------------------------------------------------------------------
   Everything here is somebody's relationship with somebody else, which makes
   the failure modes different from the rest of this codebase. A wrong course
   rating is embarrassing; a friends list that leaks who blocked whom, or
   lets a stranger enumerate players, or accepts a request from somebody who
   was blocked, is a different kind of wrong.

   Four properties, and all four are load-bearing:

     - Friendship is SYMMETRIC. Both sides or neither, always, through every
       path including the one where two people ask each other at once.
     - Blocking is ONE-WAY AND SILENT. The blocked party is never told, and
       "your request was sent" is what they see.
     - Removal is COMPLETE. No dangling edge, no orphaned favourite.
     - Codes are UNGUESSABLE and unique.
   ========================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadFriends, friendCode, pidForCode, requestFriend, acceptFriend,
  declineFriend, removeFriend, blockPlayer, unblockPlayer, toggleFavourite,
  friendState, areFriends, hasBlocked, friendsOf, pendingFor
} from '../server/friends.js';

await loadFriends();

/* Unique ids per run so the tests never collide with each other or with a
   real data file that happens to be sitting on this disk. */
let n = 0;
const who = () => `t${Date.now().toString(36)}_${n++}`;

test('a code is minted once and points back to its owner', () => {
  const a = who();
  const c1 = friendCode(a);
  const c2 = friendCode(a);
  assert.equal(c1, c2, 'a second ask minted a second code');
  assert.equal(pidForCode(c1), a);
  assert.equal(c1.length, 8);
  // no I, L, O or U: the characters people mistype off a screenshot
  assert.ok(!/[ILOU]/.test(c1), `code "${c1}" contains a confusable letter`);
  assert.match(c1, /^[0-9A-Z]{8}$/);
  // and it is case- and punctuation-insensitive coming back in
  assert.equal(pidForCode(c1.toLowerCase()), a);
  assert.equal(pidForCode(c1.slice(0, 4) + '-' + c1.slice(4)), a);
  assert.equal(pidForCode('nonsense'), null);
  assert.equal(pidForCode(null), null);
});

test('codes do not collide', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const c = friendCode(who());
    assert.ok(!seen.has(c), `duplicate code ${c}`);
    seen.add(c);
  }
});

test('a friendship is symmetric or it does not exist', () => {
  const a = who(), b = who();
  const r = requestFriend(a, friendCode(b));
  assert.ok(r.ok && r.sent);
  // one-sided until accepted
  assert.equal(areFriends(a, b), false);
  assert.equal(areFriends(b, a), false);
  assert.equal(pendingFor(b).length, 1);
  assert.equal(pendingFor(a).length, 0);

  assert.ok(acceptFriend(b, a).ok);
  assert.equal(areFriends(a, b), true);
  assert.equal(areFriends(b, a), true);
  assert.equal(pendingFor(b).length, 0);
});

test('two people asking each other at once become friends, not deadlocked', () => {
  /* The obvious bug: A requests B, B requests A, and now each is sitting in
     the other's pending list waiting for an acceptance neither will send. */
  const a = who(), b = who();
  requestFriend(a, friendCode(b));
  const back = requestFriend(b, friendCode(a));
  assert.ok(back.ok, back.error);
  assert.equal(areFriends(a, b), true, 'mutual requests did not resolve');
  assert.equal(pendingFor(a).length, 0);
  assert.equal(pendingFor(b).length, 0);
});

test('you cannot friend yourself, or friend twice', () => {
  const a = who();
  assert.ok(requestFriend(a, friendCode(a)).error);
  const b = who();
  requestFriend(a, friendCode(b));
  acceptFriend(b, a);
  assert.ok(requestFriend(a, friendCode(b)).error, 'a second request was allowed');
});

test('blocking is one-way, silent, and removes the friendship', () => {
  const a = who(), b = who();
  requestFriend(a, friendCode(b));
  acceptFriend(b, a);
  assert.equal(areFriends(a, b), true);

  blockPlayer(a, b);
  assert.equal(areFriends(a, b), false, 'blocking left the edge on one side');
  assert.equal(areFriends(b, a), false, 'blocking left the edge on the other side');
  assert.equal(hasBlocked(a, b), true);
  assert.equal(hasBlocked(b, a), false, 'blocking was mutual — it must not be');

  /* And the blocked party is TOLD NOTHING. A request from them reports
     success and goes nowhere: "you have been blocked" is information the
     blocker did not agree to share. */
  const r = requestFriend(b, friendCode(a));
  assert.ok(r.ok && r.sent, 'a blocked requester was given an error that reveals the block');
  assert.equal(pendingFor(a).length, 0, 'a blocked request reached the blocker');

  // and their own list does not leak it either
  const st = friendState(b);
  assert.ok(!st.blocked.includes(a), "the blocked party's state names the blocker");
});

test('unblocking restores nothing but the ability to ask', () => {
  const a = who(), b = who();
  requestFriend(a, friendCode(b));
  acceptFriend(b, a);
  blockPlayer(a, b);
  unblockPlayer(a, b);
  assert.equal(hasBlocked(a, b), false);
  assert.equal(areFriends(a, b), false, 'unblocking silently restored a friendship');
  assert.ok(requestFriend(b, friendCode(a)).ok);
  assert.equal(pendingFor(a).length, 1, 'the request still did not get through');
});

test('removing a friend leaves nothing behind on either side', () => {
  const a = who(), b = who();
  requestFriend(a, friendCode(b));
  acceptFriend(b, a);
  toggleFavourite(a, b);
  assert.ok(friendState(a).favourites.includes(b));

  removeFriend(a, b);
  assert.equal(areFriends(a, b), false);
  assert.equal(areFriends(b, a), false);
  assert.ok(!friendState(a).favourites.includes(b), 'a favourite outlived the friendship');
  assert.ok(!friendsOf(a).includes(b));
  assert.ok(!friendsOf(b).includes(a));
});

test('declining removes the request and can block in one step', () => {
  const a = who(), b = who();
  requestFriend(a, friendCode(b));
  declineFriend(b, a);
  assert.equal(pendingFor(b).length, 0);
  assert.equal(areFriends(a, b), false);
  assert.equal(hasBlocked(b, a), false, 'a plain decline blocked somebody');

  const c = who();
  requestFriend(c, friendCode(b));
  declineFriend(b, c, true);
  assert.equal(hasBlocked(b, c), true, 'decline-and-block did not block');
});

test('a favourite has to be a friend first', () => {
  const a = who(), b = who();
  assert.ok(toggleFavourite(a, b).error, 'favourited a stranger');
  requestFriend(a, friendCode(b));
  acceptFriend(b, a);
  assert.equal(toggleFavourite(a, b).fav, true);
  assert.equal(toggleFavourite(a, b).fav, false, 'the toggle does not toggle');
});

test('an accept cannot be forged', () => {
  /* acceptFriend takes whoever the caller names, so the guard has to be the
     pending list itself — otherwise a crafted socket message makes anybody
     your friend without them ever asking. */
  const a = who(), b = who();
  const r = acceptFriend(a, b);
  assert.ok(r.error, 'accepted a request that was never sent');
  assert.equal(areFriends(a, b), false);
});

test('the state a client receives never names who blocked them', () => {
  const a = who(), b = who();
  blockPlayer(a, b);
  const theirs = friendState(b);
  assert.ok(!theirs.blocked.includes(a));
  assert.ok(!theirs.friends.includes(a));
  assert.ok(!theirs.pending.some(q => q.pid === a));
  // the blocker's own state does list it — that is their list to see
  assert.ok(friendState(a).blocked.includes(b));
});
