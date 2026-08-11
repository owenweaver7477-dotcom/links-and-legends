/* =========================================================================
   scramble.js — the team format
   -------------------------------------------------------------------------
   A scramble is the only golf format that works with people of wildly
   different ability, which is exactly the situation this game is always in:
   everybody on a team tees off, the team takes the BEST of those balls, and
   everybody plays their next shot from that spot. Repeat until it drops. The
   team's score is the number of those rounds it took.

   That is why it is worth having. In stroke play a beginner playing with a
   good player has a bad time for an hour. In a scramble their one good drive
   out of nine is the shot the whole team uses, and they are the reason the
   team made birdie. It is the same golf and a completely different evening.

   WHY THIS IS ITS OWN FILE
   The stroke-play engine in server.js is correct and has been shaken out over
   a long time — turn order by distance from the hole, per-player strokes,
   per-player scores. Scramble does not modify any of it. It sits alongside:
   the room still runs a normal turn order and every player still takes a real
   shot with real physics. All this adds is (a) who is on which team, (b) after
   everyone in a team has played a shot, move them all to the best ball, and
   (c) score by team rather than by player.

   The result is that every existing rule — the stroke cap, out of bounds,
   penalties, the softlock guards, the record board — keeps working untouched,
   because underneath it is still just golfers hitting golf balls in turn.
   ========================================================================= */

/** The formats offered, and how many players each needs. */
export const FORMATS = [
  { id: 'stroke', name: 'Stroke play', teams: 0, per: 0,
    blurb: 'Everyone for themselves. The classic.' },
  { id: '2v2', name: '2 v 2 scramble', teams: 2, per: 2,
    blurb: 'Two a side. Both tee off, play the better ball.' },
  { id: '3v3', name: '3 v 3 scramble', teams: 2, per: 3,
    blurb: 'Three a side. Somebody always finds the fairway.' },
  { id: '4v4', name: '4 v 4 scramble', teams: 2, per: 4,
    blurb: 'Eight players, two teams, one ball each side.' }
];

export const formatById = id => FORMATS.find(f => f.id === id) || FORMATS[0];
export const isScramble = id => formatById(id).teams > 0;
/** How many players a format seats in total. */
export const seatsFor = id => { const f = formatById(id); return f.teams * f.per; };

export const TEAM_NAMES = ['Green', 'Gold'];
export const TEAM_COLORS = ['#4fc26a', '#ffd94a'];

/**
 * Put everyone on a team, balanced, keeping anyone already placed.
 *
 * Called on every join and every leave, so it has to be STABLE: a player who
 * already has a team keeps it, or the sides would reshuffle under people
 * mid-round every time somebody's connection blinked.
 */
export function assignTeams(room) {
  const f = formatById(room.format);
  if (!f.teams) { for (const p of room.players) p.team = null; return; }

  const counts = new Array(f.teams).fill(0);
  const unplaced = [];
  for (const p of room.players) {
    if (p.spectator) { p.team = null; continue; }
    if (Number.isInteger(p.team) && p.team >= 0 && p.team < f.teams) counts[p.team]++;
    else unplaced.push(p);
  }
  for (const p of unplaced) {
    // the emptiest side, ties to the lower index so it is deterministic
    let best = 0;
    for (let i = 1; i < f.teams; i++) if (counts[i] < counts[best]) best = i;
    p.team = best;
    counts[best]++;
  }
}

/** Everyone on a team who is still in the hole. */
export const teamMates = (room, team) =>
  room.players.filter(p => !p.spectator && p.team === team);

/**
 * Has every ACTIVE member of this team played the same number of shots?
 *
 * That is the condition for choosing a best ball: a scramble round of shots
 * is complete when nobody on the side is a stroke behind. Uses the max rather
 * than assuming they are level, because a player who holed out mid-round or
 * dropped mid-hole must not hold the side up forever.
 */
export function teamLevel(room, team) {
  const mates = teamMates(room, team).filter(p => p.connected && !p.finished);
  if (!mates.length) return null;
  const top = Math.max(...mates.map(p => p.strokes));
  return mates.every(p => p.strokes === top) ? top : null;
}

/**
 * The ball the team will play from next: nearest the hole wins.
 *
 * Nearest-the-pin rather than a vote. A vote is the right answer in a real
 * scramble — sometimes the second-nearest ball has the better angle — but it
 * is a modal dialog in the middle of a round for four people, and a format
 * that stops the game to hold a committee meeting is not a format anybody
 * plays twice. Nearest is right the overwhelming majority of the time and it
 * is instant.
 *
 * A ball that finished OUT OF BOUNDS or in the water has already been dropped
 * by the shot resolver, so by the time it gets here every candidate is
 * playable — there is no special case for it.
 */
export function bestBall(room, team, pin) {
  const mates = teamMates(room, team).filter(p => p.connected && !p.finished);
  if (!mates.length) return null;
  let best = null, bestD = Infinity;
  for (const p of mates) {
    const d = Math.hypot(p.x - pin.x, p.z - pin.z);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best ? { pid: best.pid, x: best.x, z: best.z, lie: best.lie, dist: bestD } : null;
}

/**
 * Move a whole team onto the chosen ball.
 *
 * Everyone's stroke count is already equal (teamLevel checked it), so this
 * only moves position and lie. The GOLFERS are moved too — walking eight
 * people to the same spot is the one bit of ritual a scramble cannot keep.
 */
export function gatherTeam(room, team, ball) {
  for (const p of teamMates(room, team)) {
    if (p.finished || !p.connected) continue;
    p.x = ball.x; p.z = ball.z; p.lie = ball.lie;
    p.ax = ball.x; p.az = ball.z;
    p.cart = null;                 // you do not stay in a cart through a gather
  }
}

/**
 * One team holed out, so everyone on it is done for this hole at that score.
 *
 * Without this the other members keep playing a ball that is already in the
 * cup, which is both nonsense and a way for a side to score twice.
 */
export function finishTeam(room, team, strokes, holeIndex) {
  for (const p of teamMates(room, team)) {
    p.finished = true;
    p.strokes = strokes;
    p.scores[holeIndex] = strokes;
  }
}

/** The team scorecard: one row per side, summed across the holes played. */
export function teamCard(room) {
  const f = formatById(room.format);
  if (!f.teams) return null;
  const out = [];
  for (let t = 0; t < f.teams; t++) {
    const mates = teamMates(room, t);
    // every member carries the same per-hole score, so one of them IS the row
    const src = mates[0];
    const scores = src ? src.scores.slice() : [];
    out.push({
      team: t, name: TEAM_NAMES[t], color: TEAM_COLORS[t],
      players: mates.map(p => ({ pid: p.pid, name: p.name, color: p.color })),
      scores,
      total: scores.reduce((a, v) => a + (v ?? 0), 0)
    });
  }
  return out;
}
