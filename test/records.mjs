/* =========================================================================
   records.mjs — a board is only worth having if it cannot be gamed
   -------------------------------------------------------------------------
   Three rules do all the work, and all three are easy to lose in a
   refactor:

     1. only a round the SERVER simulated can set a record
     2. only a COMPLETE round can set one
     3. only rounds on the SAME difficulty compete with each other

   Without rule 2, the cheapest exploit in the game is to tee off, hole a
   fluke 2, quit, and own that hole forever. Without rule 3, a Casual-mode
   score with the aim line drawn and the putt read for you sits on the same
   board as a Tournament round played blind — which is a board that means
   nothing, because the "record" is really "whoever picked the easiest mode."
   ========================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { submitRound, recordsFor, allRecords, _reset } from '../server/records.js';
import { io } from 'socket.io-client';

const card = (strokes, par = 4) => strokes.map(s => ({ strokes: s, par }));
const NINE = n => card(new Array(9).fill(n));

test('a complete round sets the round and hole records', () => {
  _reset();
  const beat = submitRound('parkland', 'standard', 'Ann', 'a1', NINE(4), 1000);
  assert.equal(beat.round, true);
  assert.equal(beat.holes.length, 9, 'every hole was previously unclaimed');

  const r = recordsFor('parkland', 'standard');
  assert.equal(r.round.total, 36);
  assert.equal(r.round.name, 'Ann');
  assert.equal(r.holes.length, 9);
  assert.equal(r.holes[0].strokes, 4);
});

test('a partial round sets nothing at all', () => {
  _reset();
  // the exploit: tee off, hole a fluke 2, walk away
  const beat = submitRound('parkland', 'standard', 'Cheat', 'c1', card([2]), 1000);
  assert.equal(beat.round, false);
  assert.equal(beat.holes.length, 0);
  const r = recordsFor('parkland', 'standard');
  assert.equal(r.round, null, 'a one-hole round took the course record');
  assert.equal(r.holes[0], null, 'a one-hole round took a hole record');

  // eight holes is still not a round
  assert.equal(submitRound('parkland', 'standard', 'Cheat', 'c1', card(new Array(8).fill(2))).round, false);
});

test('a better round takes the record; a worse one does not', () => {
  _reset();
  submitRound('parkland', 'standard', 'Ann', 'a1', NINE(4), 1000);
  assert.equal(submitRound('parkland', 'standard', 'Ben', 'b1', NINE(5), 2000).round, false,
    'a worse round took the record');
  assert.equal(recordsFor('parkland', 'standard').round.name, 'Ann');

  assert.equal(submitRound('parkland', 'standard', 'Cara', 'c2', NINE(3), 3000).round, true);
  assert.equal(recordsFor('parkland', 'standard').round.name, 'Cara');
  assert.equal(recordsFor('parkland', 'standard').round.total, 27);
});

test('a tie does not take the record — first there keeps it', () => {
  _reset();
  submitRound('parkland', 'standard', 'Ann', 'a1', NINE(4), 1000);
  const beat = submitRound('parkland', 'standard', 'Ben', 'b1', NINE(4), 2000);
  assert.equal(beat.round, false, 'an equal score took the round record');
  assert.equal(beat.holes.length, 0, 'equal scores took hole records');
  assert.equal(recordsFor('parkland', 'standard').round.name, 'Ann');
});

test('hole records are tracked per hole, not just overall', () => {
  _reset();
  submitRound('parkland', 'standard', 'Ann', 'a1', NINE(4), 1000);
  // a WORSE round overall, but a 2 on the third hole
  const mixed = [5, 5, 2, 5, 5, 5, 5, 5, 5];
  const beat = submitRound('parkland', 'standard', 'Ben', 'b1', card(mixed), 2000);
  assert.equal(beat.round, false, 'the worse total must not take the round record');
  assert.deepEqual(beat.holes, [2], 'but the 2 on the third hole is a record');

  const r = recordsFor('parkland', 'standard');
  assert.equal(r.round.name, 'Ann');
  assert.equal(r.holes[2].name, 'Ben');
  assert.equal(r.holes[2].strokes, 2);
  assert.equal(r.holes[0].name, 'Ann', 'the other holes are untouched');
});

test('courses keep separate boards', () => {
  _reset();
  submitRound('parkland', 'standard', 'Ann', 'a1', NINE(3), 1000);
  submitRound('links', 'standard', 'Ben', 'b1', NINE(5), 1000);
  assert.equal(recordsFor('parkland', 'standard').round.name, 'Ann');
  assert.equal(recordsFor('links', 'standard').round.name, 'Ben');
  /* allRecords hands back the WHOLE board per course — every difficulty's
     round record and nine hole records, plus the derived course record —
     because the hole records are the ones an ordinary player can
     realistically get their name on, and the clubhouse needs them to show
     anything worth chasing. */
  const all = allRecords();
  assert.equal(all.parkland.standard.round.total, 27);
  assert.equal(all.links.standard.round.total, 45);
  assert.equal(all.parkland.standard.holes.length, 9);
  assert.equal(all.parkland.standard.holes[0].name, 'Ann');
  assert.equal(all.links.standard.holes[8].strokes, 5);
});

test('a course nobody has played reads as unclaimed, not as broken', () => {
  _reset();
  const r = recordsFor('never-played', 'standard');
  assert.equal(r.round, null);
  assert.equal(r.holes.length, 9);
  assert.ok(r.holes.every(h => h === null));
  assert.deepEqual(allRecords(), {});
});

test('malformed submissions are refused rather than stored', () => {
  _reset();
  const junk = [
    [null, 'standard', 'x', 'p', NINE(4)],
    ['parkland', 'standard', 'x', 'p', null],
    ['parkland', 'standard', 'x', 'p', 'nonsense'],
    ['parkland', 'standard', 'x', 'p', card([0, 4, 4, 4, 4, 4, 4, 4, 4])],
    ['parkland', 'standard', 'x', 'p', [{ strokes: 4 }, ...card(new Array(8).fill(4))]],
    ['parkland', 'standard', 'x', 'p', new Array(9).fill(null)],
    // not a records-eligible difficulty at all — the gate a caller is
    // supposed to check before ever reaching here
    ['parkland', 'casual', 'x', 'p', NINE(4)],
    ['parkland', 'made-up-mode', 'x', 'p', NINE(4)],
    ['parkland', undefined, 'x', 'p', NINE(4)]
  ];
  for (const args of junk) {
    const beat = submitRound(...args);
    assert.equal(beat.round, false, `accepted ${JSON.stringify(args[4])?.slice(0, 40)}`);
  }
  assert.equal(recordsFor('parkland', 'standard').round, null, 'junk reached the board');
});

test('difficulties keep separate boards — an easy score never beats a hard one', () => {
  _reset();
  // Tournament: the hard mode, played first, with the worse score
  submitRound('parkland', 'tournament', 'Tour', 't1', NINE(5), 1000);
  // Standard: an easier mode, a much better score
  submitRound('parkland', 'standard', 'Easy', 'e1', NINE(3), 2000);

  // neither board touched the other
  assert.equal(recordsFor('parkland', 'tournament').round.name, 'Tour');
  assert.equal(recordsFor('parkland', 'tournament').round.total, 45);
  assert.equal(recordsFor('parkland', 'standard').round.name, 'Easy');
  assert.equal(recordsFor('parkland', 'standard').round.total, 27);

  // the derived course record is still the numerically best round overall —
  // "the best anyone has ever carded here", whichever difficulty that was
  const all = recordsFor('parkland');
  assert.equal(all.courseRecord.difficulty, 'standard');
  assert.equal(all.courseRecord.round.name, 'Easy');
});

test('a tied total between difficulties credits the harder one as the course record', () => {
  _reset();
  submitRound('parkland', 'standard', 'Easy', 'e1', NINE(4), 1000);
  submitRound('parkland', 'tournament', 'Tour', 't1', NINE(4), 2000);
  const cr = recordsFor('parkland').courseRecord;
  assert.equal(cr.round.total, 36);
  assert.equal(cr.difficulty, 'tournament',
    'the same score with less help drawn on screen should win the tie');
});

test('hole records also stay on their own difficulty', () => {
  _reset();
  submitRound('parkland', 'standard', 'Easy', 'e1', card([2, 4, 4, 4, 4, 4, 4, 4, 4]), 1000);
  submitRound('parkland', 'tournament', 'Tour', 't1', NINE(3), 2000);
  // the standard 2 on hole 1 must not appear on the tournament board or vice versa
  assert.equal(recordsFor('parkland', 'standard').holes[0].strokes, 2);
  assert.equal(recordsFor('parkland', 'tournament').holes[0].strokes, 3);
});

/* ------------------------------------------------------- over the wire --- */

/* Point the socket tests at a server on another port with GOLF_URL, so a
   run can verify a FRESH server without killing the one you are playing on.
   Server-side changes need a restart to take effect, and testing against a
   process that booted before the change is how a fix gets signed off twice
   and shipped never. */
const URL = process.env.GOLF_URL || 'http://localhost:3000';
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
  // no difficulty argument: every record-eligible board, plus the derived
  // course record — the shape a client picks its own difficulty's slice from
  assert.ok(Array.isArray(state.records.standard?.holes));
  assert.ok(Array.isArray(state.records.pro?.holes));
  assert.ok(Array.isArray(state.records.tournament?.holes));
  assert.equal(state.records.courseRecord, null, 'a fresh course has no record yet');
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

test('a private room is unlisted but still joinable by code', async () => {
  const a = await connect(), stranger = await connect();
  const me = 'priv-' + Math.random().toString(36).slice(2);
  const r = await ask(a, 'room:create',
    { name: 'Priv', pid: me, courseId: 'parkland', privacy: 'private' });
  assert.ok(r.ok);
  assert.equal(r.state.privacy, 'private', 'the creator sees their own room as private');
  await wait(300);

  const open = await ask(stranger, 'rooms:open', null);
  assert.ok(!open.rooms.some(x => x.code === r.code), 'a private room appeared in Open rounds');

  const presence = await ask(stranger, 'presence:who', null);
  assert.ok(!presence.online.some(o => o.pid === me), 'a private host appeared in presence');

  const quick = await ask(stranger, 'rooms:quick', { format: 'stroke', region: 'any' });
  assert.notEqual(quick?.code, r.code, 'quick match auto-joined a private room');

  // unlisted is not the same as unreachable — the whole point is that the
  // link the host shares still works
  const joined = await ask(stranger, 'room:join',
    { code: r.code, name: 'Stranger', pid: 'strangep-' + Math.random().toString(36).slice(2) });
  assert.ok(joined.ok, 'the invite link stopped working once the room went private');

  a.disconnect(); stranger.disconnect();
});

test('only the host can change a room\'s privacy, and only in the lobby', async () => {
  const host = await connect(), guest = await connect();
  const hostPid = 'ph-' + Math.random().toString(36).slice(2);
  let state = null;
  host.on('room:state', s => { state = s; });
  const r = await ask(host, 'room:create', { name: 'H', pid: hostPid, courseId: 'parkland' });
  assert.equal(r.state.privacy, 'public', 'public is the default, unchanged from before this existed');
  await ask(guest, 'room:join', { code: r.code, name: 'G', pid: 'pg-' + Math.random().toString(36).slice(2) });
  await wait(300);

  guest.emit('room:privacy', { privacy: 'private' });
  await wait(300);
  assert.equal(state.privacy, 'public', 'a non-host flipped the room private');

  host.emit('room:privacy', { privacy: 'private' });
  await wait(300);
  assert.equal(state.privacy, 'private', 'the host could not make their own room private');

  host.emit('game:start');
  await wait(600);
  host.emit('room:privacy', { privacy: 'public' });
  await wait(300);
  assert.equal(state.privacy, 'private', 'privacy changed mid-round, after the lobby closed');

  host.disconnect(); guest.disconnect();
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
