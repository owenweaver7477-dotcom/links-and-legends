/* =========================================================================
   scramble.mjs — the team format
   -------------------------------------------------------------------------
   A scramble deliberately changes as little as possible: every player still
   takes a real shot ruled on by the same physics, in a turn order still
   decided by distance from the hole. Three things are new — who is on which
   side, moving a side onto its best ball, and scoring by team — and those
   three are what this file holds down.
   ========================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORMATS, formatById, isScramble, seatsFor, assignTeams, teamMates,
         teamLevel, bestBall, gatherTeam, finishTeam, teamCard,
         TEAM_NAMES } from '../public/js/shared/scramble.js';

const mkRoom = (format, n) => ({
  format,
  players: Array.from({ length: n }, (_, i) => ({
    pid: 'p' + i, name: 'P' + i, color: '#fff', spectator: false, connected: true,
    finished: false, strokes: 0, x: 0, z: 0, lie: 'tee', scores: new Array(9).fill(null)
  }))
});

test('the formats are coherent', () => {
  assert.equal(formatById('stroke').teams, 0);
  assert.ok(!isScramble('stroke'));
  for (const f of FORMATS.filter(f => f.teams)) {
    assert.ok(isScramble(f.id), `${f.id} should be a scramble`);
    assert.equal(seatsFor(f.id), f.teams * f.per);
    // the name has to say what it is: "3v3" seats 6
    const m = /^(\d)v(\d)$/.exec(f.id);
    if (m) assert.equal(seatsFor(f.id), Number(m[1]) + Number(m[2]));
  }
  // an unknown format is stroke play, never a crash
  assert.equal(formatById('nonsense').id, 'stroke');
  assert.equal(formatById(undefined).id, 'stroke');
});

test('teams come out even, and stay put once assigned', () => {
  for (const f of ['2v2', '3v3', '4v4']) {
    const room = mkRoom(f, seatsFor(f));
    assignTeams(room);
    const per = formatById(f).per;
    for (let t = 0; t < 2; t++) {
      assert.equal(teamMates(room, t).length, per, `${f} team ${t}`);
    }
    /* Stability matters more than balance here: this runs on every join and
       every leave, and a shuffle mid-round would move people between sides
       every time somebody's connection blinked. */
    const before = room.players.map(p => p.team);
    assignTeams(room);
    assert.deepEqual(room.players.map(p => p.team), before);
  }
});

test('an odd number of players still gets a playable split', () => {
  const room = mkRoom('3v3', 5);          // somebody left
  assignTeams(room);
  const sizes = [teamMates(room, 0).length, teamMates(room, 1).length];
  assert.equal(sizes[0] + sizes[1], 5);
  assert.ok(Math.abs(sizes[0] - sizes[1]) <= 1, 'sides differ by more than one');
});

test('stroke play puts nobody on a team', () => {
  const room = mkRoom('stroke', 4);
  assignTeams(room);
  assert.ok(room.players.every(p => p.team === null));
  assert.equal(teamCard(room), null);
});

test('a side is only level when everybody has played the same shots', () => {
  const room = mkRoom('2v2', 4);
  assignTeams(room);
  const [a, b] = teamMates(room, 0);
  assert.equal(teamLevel(room, 0), 0);        // nobody has swung
  a.strokes = 1;
  assert.equal(teamLevel(room, 0), null, 'one player ahead is not level');
  b.strokes = 1;
  assert.equal(teamLevel(room, 0), 1);
  /* A player who has holed out or dropped must not hold the side up for the
     rest of the hole. */
  a.finished = true;
  b.strokes = 2;
  assert.equal(teamLevel(room, 0), 2);
});

test('the best ball is the one nearest the hole', () => {
  const room = mkRoom('3v3', 6);
  assignTeams(room);
  const pin = { x: 0, z: 100 };
  const mates = teamMates(room, 0);
  mates[0].x = 0; mates[0].z = 40;            // 60 out
  mates[1].x = 0; mates[1].z = 88;            // 12 out  <-- this one
  mates[2].x = 30; mates[2].z = 70;           // ~42 out
  const ball = bestBall(room, 0, pin);
  assert.equal(ball.pid, mates[1].pid);
  assert.ok(Math.abs(ball.dist - 12) < 0.01);
});

test('gathering moves the whole side onto that ball', () => {
  const room = mkRoom('4v4', 8);
  assignTeams(room);
  const pin = { x: 0, z: 100 };
  const mates = teamMates(room, 0);
  mates.forEach((p, i) => { p.x = i * 10; p.z = 50 + i * 8; p.lie = 'rough'; });
  mates[3].lie = 'fairway';
  const ball = bestBall(room, 0, pin);
  gatherTeam(room, 0, ball);
  for (const p of mates) {
    assert.equal(p.x, ball.x); assert.equal(p.z, ball.z); assert.equal(p.lie, ball.lie);
    assert.equal(p.ax, ball.x, 'the golfer moves too, not just the ball');
  }
  // and the OTHER side is untouched
  assert.ok(teamMates(room, 1).every(p => p.x === 0 && p.z === 0));
});

test('one player holing out ends the hole for the whole side', () => {
  const room = mkRoom('2v2', 4);
  assignTeams(room);
  finishTeam(room, 0, 4, 2);
  for (const p of teamMates(room, 0)) {
    assert.ok(p.finished);
    assert.equal(p.strokes, 4);
    assert.equal(p.scores[2], 4, 'the score lands on the hole that was played');
  }
  assert.ok(teamMates(room, 1).every(p => !p.finished));
});

test('the card scores by team, not by player', () => {
  const room = mkRoom('2v2', 4);
  assignTeams(room);
  finishTeam(room, 0, 4, 0);
  finishTeam(room, 1, 5, 0);
  finishTeam(room, 0, 3, 1);
  finishTeam(room, 1, 4, 1);
  const card = teamCard(room);
  assert.equal(card.length, 2);
  assert.equal(card[0].name, TEAM_NAMES[0]);
  assert.equal(card[0].total, 7);
  assert.equal(card[1].total, 9);
  assert.equal(card[0].players.length, 2, 'the card names who is on the side');
});
