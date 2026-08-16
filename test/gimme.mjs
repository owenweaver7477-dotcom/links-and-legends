/* =========================================================================
   gimme.mjs — a conceded putt is a putt
   -------------------------------------------------------------------------
   The gimme I added checked only that the ball had STOPPED on the green
   within the range, not that the shot had been played FROM the green. So it
   fired on any shot that finished near the cup — including a tee shot.

   Three separate complaints turned out to be that one missing condition:

     "the ball lands before the hole and it says it's in"
        the shot stopped two feet short, was conceded, and the hole ended
     "hole in ones don't count and it says birdie"
        the ace picked up the conceded stroke, becoming a 2, which on a
        par 3 is a birdie — so a hole in one was not merely unrecorded, it
        was arithmetically impossible on any hole where the ball came to
        rest rather than dropping
     "scramble is broken"
        a concession finishes a player without setting `holed`, so the side
        took the gather branch onto a ball that was already effectively in
        the cup, with one member finished and the rest still to play

   A gimme is what the other players give you when it is your turn to PUTT.
   The tap you are spared has to be a tap you were actually facing.
   ========================================================================= */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const src = await readFile(new URL('../server.js', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('const gim = difficultyById'),
                        src.indexOf('conceded = true') + 40);

test('a concession requires the shot to have come from the green', () => {
  /* `fromGreen` is the flag that says this stroke was a putt. Without it in
     the condition, a tee shot that stops near the cup is conceded. */
  assert.match(block, /if \(gim > 0 && fromGreen && result\.lie === 'green'\)/,
    'the gimme does not check that the stroke was a putt');
});

test('a concession still costs the stroke', () => {
  /* It saves the tap, not the shot. A gimme that did not count would be a
     free stroke for stopping close, which is a different game. */
  assert.match(block, /p\.strokes\+\+/, 'a conceded putt is not being counted');
});

test('Tournament concedes nothing', async () => {
  const { DIFFICULTIES } = await import('../public/js/shared/difficulty.js');
  const t = DIFFICULTIES.find(d => d.id === 'tournament');
  assert.equal(t.aids.gimme, 0, 'Tournament should make you hole everything out');
  /* And every other mode's range has to be short enough that it is a tap.
     A metre and a half is a putt somebody could miss. */
  for (const d of DIFFICULTIES) {
    assert.ok(d.aids.gimme <= 1.25, `${d.name} concedes from ${d.aids.gimme} m`);
  }
});

test('a scramble side is finished by a concession, exactly as by a hole-out', () => {
  const sc = src.slice(src.indexOf('Somebody on the side holed out'));
  assert.match(sc.slice(0, 900), /if \(result\.holed \|\| conceded\)/,
    'a conceded putt does not finish the side — the hole will hang');
});

test('an ace is named as one, not by its par-relative score', async () => {
  /* A hole in one on a par 3 is an eagle and on a par 4 an albatross, which
     are the right words for the number and the wrong words for the moment.
     It is the rarest thing in the game; it should say so. */
  const hud = await readFile(new URL('../public/js/client/hud.js', import.meta.url), 'utf8');
  const fn = hud.slice(hud.indexOf('function scoreName'), hud.indexOf('HUD.scoreName'));
  assert.match(fn, /strokes === 1/, 'scoreName cannot tell an ace from an eagle');
  assert.match(fn, /Hole in one/, 'nothing names a hole in one');
});
