/* =========================================================================
   telemetry.mjs — the event taxonomy fires what it says, and only once
   -------------------------------------------------------------------------
   §0.3. No backend exists to check against yet — track() is a documented
   no-op until somebody wires ByteBrew in — so what's worth proving here is
   the part that's pure logic and easy to get subtly wrong: the D1/D3/D7/D30
   retention bucketing. It reads two localStorage dates and has to tell a
   same-session reload (say nothing) apart from a next-day return (say
   something, with the right bucket) apart from a first-ever visit (say a
   different thing entirely) — three branches, and an early draft of this
   file had a dead expression in the middle of exactly that branch that
   happened to still produce the right answer for a brand-new visitor while
   quietly being nonsense. Caught by hand in the browser, not by a test —
   this exists so the next version of that mistake doesn't get the same
   free pass.

   All of it lives in one outer test with sequential t.test() subtests,
   not several top-level test() calls. Node runs sibling top-level tests
   CONCURRENTLY by default, and every subtest here shares two pieces of
   mutable module state on purpose — the fake localStorage and telemetry.js's
   own in-memory event buffer — so run concurrently they interleave and
   contaminate each other's results. A first draft of this file did exactly
   that and failed three separate tests for three different fake reasons,
   none of which were the code being wrong.

   localStorage does not exist in plain Node, so this stubs a minimal
   in-memory one before importing the module — telemetry.js reads it
   through a bare `localStorage` reference (browser global scope), which
   resolves the same way against a global set here.
   ========================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';

function fakeStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    clear: () => m.clear()
  };
}
globalThis.localStorage = fakeStorage();

const { track, recentEvents, trackReturn, funnel, trackHoleOutcome, trackCoins } = await import('../public/js/client/telemetry.js');

/* A length snapshot, not a Date.now() watermark: these calls run fast
   enough, back to back, that two of them can land in the same millisecond
   — a `>= mark` timestamp filter then can't tell "no new event" apart from
   "a new event that happens to share a millisecond with the old one", and
   silently counts the old one twice. Counting from a fixed array length
   has no resolution to lose. */
const since = mark => recentEvents().slice(mark).map(e => e.event);
const mark = () => recentEvents().length;

test('telemetry — funnel, retention, and the buffer cap', async (t) => {
  await t.test('a brand-new visitor is counted once, as new — not as a return', () => {
    globalThis.localStorage.clear();
    const m = mark();
    trackReturn();
    assert.deepEqual(since(m), ['retention_new_player']);
    assert.ok(localStorage.getItem('lg_first_seen'), 'first-seen was never stamped');
    assert.ok(localStorage.getItem('lg_last_seen'), 'last-seen was never stamped');
  });

  await t.test('a same-session reload says nothing — it is not a return visit', () => {
    globalThis.localStorage.clear();
    trackReturn();                          // first visit, stamps both dates
    const m = mark();
    trackReturn();                          // "reload a second later"
    assert.deepEqual(since(m), [], 'a same-day reload fired a retention event');
  });

  await t.test('a visit the next day is bucketed d1, and moves last-seen forward', () => {
    globalThis.localStorage.clear();
    const dayMs = 86400000;
    const yesterday = Date.now() - dayMs * 1.5;
    localStorage.setItem('lg_first_seen', String(yesterday));
    localStorage.setItem('lg_last_seen', String(yesterday));
    const m = mark();
    trackReturn();
    const rows = recentEvents().slice(m);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].event, 'retention_return');
    assert.equal(rows[0].bucket, 'd1', `a day and a half since the last visit should read as the d1 bucket, got ${rows[0].bucket}`);
    // last-seen moves forward so the NEXT call measures from today, not
    // from the original first-seen date forever
    const newLast = Number(localStorage.getItem('lg_last_seen'));
    assert.ok(newLast > yesterday, 'last-seen was never advanced');
  });

  await t.test('a visit several days later is bucketed d3, not d1', () => {
    globalThis.localStorage.clear();
    const dayMs = 86400000;
    const twoDaysAgo = Date.now() - dayMs * 2;
    localStorage.setItem('lg_first_seen', String(twoDaysAgo));
    localStorage.setItem('lg_last_seen', String(twoDaysAgo));
    const m = mark();
    trackReturn();
    const rows = recentEvents().slice(m);
    assert.equal(rows[0].bucket, 'd3', `two days since the last visit should read as the d3 bucket, got ${rows[0].bucket}`);
  });

  await t.test('the funnel, hole outcome, and coin helpers name what actually happened', () => {
    globalThis.localStorage.clear();
    const m = mark();
    funnel.pageLoad();
    funnel.tee('parkland');
    trackHoleOutcome(1, true, 'parkland');
    trackHoleOutcome(3, false, 'parkland');   // abandoned, not completed
    trackCoins(150, 'round_payout');
    const rows = recentEvents().slice(m);
    assert.deepEqual(rows.map(r => r.event),
      ['funnel_page_load', 'funnel_tee', 'hole_complete', 'hole_dropoff', 'coins_earned']);
    assert.equal(rows[1].courseId, 'parkland');
    assert.equal(rows[2].hole, 1);
    assert.equal(rows[3].hole, 3);
    assert.equal(rows[4].delta, 150);
  });

  await t.test('the buffer never grows without bound', () => {
    for (let i = 0; i < 500; i++) track('flood_test', { i });
    assert.ok(recentEvents().length <= 200, `buffer grew to ${recentEvents().length}, expected a cap`);
  });
});
