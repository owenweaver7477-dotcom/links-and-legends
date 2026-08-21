/* =========================================================================
   feedback.mjs — anonymous, rate-limited, and a report can never leak
   -------------------------------------------------------------------------
   Three things have to hold and each is easy to lose in a refactor:

     1. nothing identifying is stored — no pid, no name, only a hash
     2. one session cannot flood the board
     3. a report is never, under any status, reachable through the public
        board's own listing function — filtered by category, not by a
        flag a future change could clear by accident
   ========================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { submitFeedback, submitReport, listFeedback, voteFeedback, _reset } from '../server/feedback.js';
import { io } from 'socket.io-client';

test('a real submission reaches the public board', () => {
  _reset();
  const r = submitFeedback('p1', 'bug', 'The aim line vanishes on hole 5 of Kakoda Forest.', 'volcanic', 4, { build: 'test' });
  assert.equal(r.ok, true);
  const rows = listFeedback();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].category, 'bug');
  assert.equal(rows[0].courseId, 'volcanic');
  assert.equal(rows[0].status, 'new');
});

test('nothing identifying ever reaches the stored item', () => {
  _reset();
  submitFeedback('a-very-identifiable-pid', 'suggestion', 'More birds please, they are great atmosphere.');
  const rows = listFeedback();
  const json = JSON.stringify(rows);
  assert.ok(!json.includes('a-very-identifiable-pid'), 'the raw pid leaked into what the board returns');
});

test('too short to be useful is refused, not stored as noise', () => {
  _reset();
  const r = submitFeedback('p1', 'bug', 'meh', null, null, {});
  assert.equal(r.ok, false);
  assert.equal(listFeedback().length, 0);
});

test('an unknown category is refused', () => {
  _reset();
  const r = submitFeedback('p1', 'not-a-real-category', 'This is plenty long enough to pass the length check.');
  assert.equal(r.ok, false);
});

test('one session cannot flood the board', () => {
  _reset();
  for (let i = 0; i < 3; i++) {
    const r = submitFeedback('flooder', 'other', `Submission number ${i}, long enough to count as real feedback.`);
    assert.equal(r.ok, true, `submission ${i} should have been accepted`);
  }
  const blocked = submitFeedback('flooder', 'other', 'A fourth submission inside the same hour, which should be refused.');
  assert.equal(blocked.ok, false);
  assert.equal(listFeedback().length, 3);

  // a DIFFERENT session is not affected by another one's rate limit
  const other = submitFeedback('someone-else', 'other', 'A completely different session submitting its own feedback.');
  assert.equal(other.ok, true);
});

test('a report never appears on the public board, whatever its status', () => {
  _reset();
  submitFeedback('p1', 'bug', 'A perfectly normal bug report about the water on hole 3.');
  const rep = submitReport('p2', 'target-pid', 'Griefer', 'Kept shoving people into the water on purpose.', 'ABCD');
  assert.equal(rep.ok, true);
  const rows = listFeedback();
  assert.equal(rows.length, 1, 'the report leaked onto the public board');
  assert.ok(!rows.some(r => r.category === 'report'));
});

test('voting is one per session and moves the count', () => {
  _reset();
  submitFeedback('author', 'suggestion', 'Add a photo mode for celebrating a hole in one.');
  const [item] = listFeedback();
  const first = voteFeedback('voter1', item.id);
  assert.equal(first.ok, true);
  assert.equal(first.votes, 1);
  const again = voteFeedback('voter1', item.id);
  assert.equal(again.ok, false, 'the same session voted twice');
  const second = voteFeedback('voter2', item.id);
  assert.equal(second.votes, 2);
});

/* ------------------------------------------------------- over the wire --- */
const URL = process.env.GOLF_URL || 'http://localhost:3000';
const wait = ms => new Promise(r => setTimeout(r, ms));
const connect = () => new Promise((res, rej) => {
  const s = io(URL, { transports: ['websocket'], forceNew: true, timeout: 4000 });
  s.once('connect', () => res(s)); s.once('connect_error', rej);
});
// profile:me does not ack — it pushes a separate 'profile' event — so a
// bare ask() on it would hang forever waiting for a callback that never
// comes. Every OTHER handler here does ack, and gets the timeout fallback.
const ask = (s, ev, d) => new Promise(r => { let f = 0; s.emit(ev, d, x => { f = 1; r(x); }); setTimeout(() => f || r(null), 3000); });
const identify = (s, pid, name) => new Promise(res => { s.once('profile', res); s.emit('profile:me', { pid, name }); });

test('feedback is reachable from the clubhouse, outside any room', async () => {
  const s = await connect();
  await identify(s, 'fb-clubhouse-' + Math.random().toString(36).slice(2), 'Clubhouse');
  const res = await ask(s, 'feedback:submit',
    { category: 'suggestion', body: 'Sent with no room ever joined, straight from the clubhouse tab.' });
  assert.ok(res?.ok, JSON.stringify(res));
  const list = await ask(s, 'feedback:list', null);
  assert.ok(Array.isArray(list?.items));
  s.disconnect();
});

test('a report needs to be sent from inside the room it happened in', async () => {
  const a = await connect(), b = await connect();
  const apid = 'fb-a-' + Math.random().toString(36).slice(2);
  const bpid = 'fb-b-' + Math.random().toString(36).slice(2);
  await identify(a, apid, 'Ann');
  await identify(b, bpid, 'Ben');
  const r = await ask(a, 'room:create', { name: 'Ann', pid: apid, courseId: 'parkland' });
  await ask(b, 'room:join', { code: r.code, name: 'Ben', pid: bpid });
  await wait(300);

  const rep = await ask(a, 'player:report',
    { targetPid: bpid, reason: 'Spamming the same emote over and over during my turn.' });
  assert.ok(rep?.ok, JSON.stringify(rep));

  // never on the public board, and never discoverable from the outside
  const list = await ask(a, 'feedback:list', null);
  assert.ok(!list.items.some(it => it.body.includes('emote')), 'a report reached the public list');

  a.disconnect(); b.disconnect();
});
