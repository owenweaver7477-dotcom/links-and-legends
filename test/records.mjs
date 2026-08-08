/* =========================================================================
   records.mjs — a board is only worth having if it cannot be gamed
   -------------------------------------------------------------------------
   Two rules do all the work, and both are easy to lose in a refactor:

     1. only a round the SERVER simulated can set a record
     2. only a COMPLETE round can set one

   Without the second, the cheapest exploit in the game is to tee off, hole a
   fluke 2, quit, and own that hole forever. Every assertion here is aimed at
   one of those two.
   ========================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { submitRound, recordsFor, allRecords, _reset } from '../server/records.js';
import { io } from 'socket.io-client';

const card = (strokes, par = 4) => strokes.map(s => ({ strokes: s, par }));
const NINE = n => card(new Array(9).fill(n));

test('a complete round sets the round and hole records', () => {
  _reset();
  const beat = submitRound('parkland', 'Ann', 'a1', NINE(4), 1000);
  assert.equal(beat.round, true);
  assert.equal(beat.holes.length, 9, 'every hole was previously unclaimed');

  const r = recordsFor('parkland');
  assert.equal(r.round.total, 36);
  assert.equal(r.round.name, 'Ann');
  assert.equal(r.holes.length, 9);
  assert.equal(r.holes[0].strokes, 4);
});

test('a partial round sets nothing at all', () => {
  _reset();
  // the exploit: tee off, hole a fluke 2, walk away
  const beat = submitRound('parkland', 'Cheat', 'c1', card([2]), 1000);
  assert.equal(beat.round, false);
  assert.equal(beat.holes.length, 0);
  const r = recordsFor('parkland');
  assert.equal(r.round, null, 'a one-hole round took the course record');
  assert.equal(r.holes[0], null, 'a one-hole round took a hole record');

  // eight holes is still not a round
  assert.equal(submitRound('parkland', 'Cheat', 'c1', card(new Array(8).fill(2))).round, false);
});

test('a better round takes the record; a worse one does not', () => {
  _reset();
  submitRound('parkland', 'Ann', 'a1', NINE(4), 1000);
  assert.equal(submitRound('parkland', 'Ben', 'b1', NINE(5), 2000).round, false,
    'a worse round took the record');
  assert.equal(recordsFor('parkland').round.name, 'Ann');

  assert.equal(submitRound('parkland', 'Cara', 'c2', NINE(3), 3000).round, true);
  assert.equal(recordsFor('parkland').round.name, 'Cara');
  assert.equal(recordsFor('parkland').round.total, 27);
});

test('a tie does not take the record — first there keeps it', () => {
  _reset();
  submitRound('parkland', 'Ann', 'a1', NINE(4), 1000);
  const beat = submitRound('parkland', 'Ben', 'b1', NINE(4), 2000);
  assert.equal(beat.round, false, 'an equal score took the round record');
  assert.equal(beat.holes.length, 0, 'equal scores took hole records');
  assert.equal(recordsFor('parkland').round.name, 'Ann');
});

test('hole records are tracked per hole, not just overall', () => {
  _reset();
  submitRound('parkland', 'Ann', 'a1', NINE(4), 1000);
  // a WORSE round overall, but a 2 on the third hole
  const mixed = [5, 5, 2, 5, 5, 5, 5, 5, 5];
  const beat = submitRound('parkland', 'Ben', 'b1', card(mixed), 2000);
  assert.equal(beat.round, false, 'the worse total must not take the round record');
  assert.deepEqual(beat.holes, [2], 'but the 2 on the third hole is a record');

  const r = recordsFor('parkland');
  assert.equal(r.round.name, 'Ann');
  assert.equal(r.holes[2].name, 'Ben');
  assert.equal(r.holes[2].strokes, 2);
  assert.equal(r.holes[0].name, 'Ann', 'the other holes are untouched');
});

test('courses keep separate boards', () => {
  _reset();
  submitRound('parkland', 'Ann', 'a1', NINE(3), 1000);
  submitRound('links', 'Ben', 'b1', NINE(5), 1000);
  assert.equal(recordsFor('parkland').round.name, 'Ann');
  assert.equal(recordsFor('links').round.name, 'Ben');
  /* allRecords now hands back the WHOLE board per course — the round record
     and the nine hole records — because the hole records are the ones an
     ordinary player can realistically get their name on, and the clubhouse
     needs them to show anything worth chasing. */
  const all = allRecords();
  assert.equal(all.parkland.round.total, 27);
  assert.equal(all.links.round.total, 45);
  assert.equal(all.parkland.holes.length, 9);
  assert.equal(all.parkland.holes[0].name, 'Ann');
  assert.equal(all.links.holes[8].strokes, 5);
});

test('a course nobody has played reads as unclaimed, not as broken', () => {
  _reset();
  const r = recordsFor('never-played');
  assert.equal(r.round, null);
  assert.equal(r.holes.length, 9);
  assert.ok(r.holes.every(h => h === null));
  assert.deepEqual(allRecords(), {});
});

test('malformed submissions are refused rather than stored', () => {
  _reset();
  const junk = [
    [null, 'x', 'p', NINE(4)],
    ['parkland', 'x', 'p', null],
    ['parkland', 'x', 'p', 'nonsense'],
    ['parkland', 'x', 'p', card([0, 4, 4, 4, 4, 4, 4, 4, 4])],
    ['parkland', 'x', 'p', [{ strokes: 4 }, ...card(new Array(8).fill(4))]],
    ['parkland', 'x', 'p', new Array(9).fill(null)]
  ];
  for (const args of junk) {
    const beat = submitRound(...args);
    assert.equal(beat.round, false, `accepted ${JSON.stringify(args[3])?.slice(0, 40)}`);
  }
  assert.equal(recordsFor('parkland').round, null, 'junk reached the board');
});

/* ------------------------------------------------------- over the wire --- */

const URL = 'http://localhost:3000';
const wait = ms => new Promise(r => setTimeout(r, ms));
const connect = () => new Promise((res, rej) => {
  const s = io(URL, { transports: ['websocket'], forceNew: true, timeout: 4000 });
  s.once('connect', () => res(s)); s.once('connect_error', rej);
});
const ask = (s, ev, d) => new Promise(r => s.emit(ev, d, r));

test('the board is reachable from the clubhouse, outside any room', async () => {
  const s = await connect();
  const res = await ask(s, 'records:all', null);
  assert.ok(res && typeof res.records === 'object',
    'the clubhouse must be able to ask for records without joining a room');
  s.disconnect();
});

test('the room state carries the board for the course being played', async () => {
  const s = await connect();
  let state = null;
  s.on('room:state', st => { state = st; });
  const { ok } = await ask(s, 'room:create', { name: 'Rec', pid: 'rec-' + Math.random().toString(36).slice(2), courseId: 'parkland' });
  assert.ok(ok);
  await wait(400);
  assert.ok(state, 'no room state arrived');
  assert.ok(state.records, 'the hole card cannot show a record it was never sent');
  assert.ok(Array.isArray(state.records.holes));
  s.disconnect();
});

test('presence says who is online and what they are doing', async () => {
  const a = await connect(), b = await connect();
  const me = 'pa-' + Math.random().toString(36).slice(2);
  const r = await ask(a, 'room:create', { name: 'Ann', pid: me, courseId: 'parkland' });
  await ask(b, 'room:join', { code: r.code, name: 'Ben', pid: 'pb-' + Math.random().toString(36).slice(2) });
  await wait(400);

  const lobby = await ask(a, 'presence:who', null);
  const ann = lobby.online.find(o => o.pid === me);
  assert.ok(ann, 'a connected player must appear in presence');
  assert.match(ann.doing, /lobby/i, `doing was "${ann.doing}"`);
  assert.equal(ann.joinable, true, 'an open lobby must be joinable');

  a.emit('game:start');
  await wait(900);
  const playing = await ask(a, 'presence:who', null);
  const now = playing.online.find(o => o.pid === me);
  assert.match(now.doing, /on the/i, `once playing, doing was "${now.doing}"`);
  assert.equal(now.joinable, false, 'a round in progress is not joinable');

  a.disconnect(); b.disconnect();
});

test('a player who drops leaves presence', async () => {
  const a = await connect();
  const me = 'gone-' + Math.random().toString(36).slice(2);
  await ask(a, 'room:create', { name: 'Gone', pid: me, courseId: 'parkland' });
  await wait(300);
  const b = await connect();
  assert.ok((await ask(b, 'presence:who', null)).online.some(o => o.pid === me));

  a.disconnect();
  await wait(600);
  assert.ok(!(await ask(b, 'presence:who', null)).online.some(o => o.pid === me),
    'a disconnected player is still shown as online');
  b.disconnect();
});
