/* =========================================================================
   shotcard.js — what actually happened to that shot
   -------------------------------------------------------------------------
   The game told you where the ball ended up and nothing about how it got
   there. "In the rough" is a result; it is not information you can do
   anything with, because it does not distinguish the drive that was struck
   perfectly and blown offline by a crosswind from the one you came over the
   top of. Both end up in the same rough, and only one of them means you
   should change something.

   Everything here is read back off the simulation that was just run — the
   apex, the carry, the roll, the distance from the line you aimed at, and
   the face and attack angles the swing actually produced. None of it is new
   physics and none of it is a guess: the numbers were all computed to fly
   the ball and then thrown away.

   WHY IT DOES NOT APPEAR ON EVERY SHOT. A card after all of them is a card
   nobody reads, and after a two-foot tap-in it is faintly insulting. It
   shows for full shots, and it fades on its own — reading it must never be
   something you have to finish before playing on.
   ========================================================================= */

import { CLUB_BY_KEY } from '../shared/clubs.js';

/* Below this, it was a chip or a putt and there is nothing to analyse. */
const MIN_INTERESTING_M = 28;

let box = null, hideTimer = 0;

function ensure() {
  if (box) return box;
  box = document.createElement('div');
  box.className = 'shotcard';
  box.hidden = true;
  document.body.appendChild(box);
  /* Dismissable, because it sits over the course and somebody who wants to
     look at their ball should not have to wait out an animation. */
  box.addEventListener('click', hide);
  return box;
}

export function hide() {
  clearTimeout(hideTimer);
  if (box) { box.classList.remove('in'); hideTimer = setTimeout(() => { if (box) box.hidden = true; }, 260); }
}

/**
 * How far off the aim line the ball finished, positive to the RIGHT.
 *
 * The whole shot is measured against the line the player aimed at, not
 * against the pin: a shot pushed twelve yards right of a target you
 * deliberately aimed left of is a straight shot, and calling it a miss
 * would be the analysis lying about what the swing did.
 *
 * Coordinate convention, which has bitten this codebase before: forward is
 * (sin h, cos h) and world +x is the player's LEFT. So the rightward axis
 * is the negated perpendicular, and the sign flip at the end is not a fudge.
 */
function offline(lie, end, aim) {
  const fx = Math.sin(aim), fz = Math.cos(aim);
  const dx = end.x - lie.x, dz = end.z - lie.z;
  const cross = dx * fz - dz * fx;      // + is toward world +x, i.e. the left
  return -cross;
}

/**
 * Show the card for a finished shot.
 *
 * @param sim    the ShotSim that was just animated
 * @param opts   { clubKey, aim, dist (fn m->display), unit, surface, holed }
 */
export function showShot(sim, opts = {}) {
  if (!sim || !sim.lie) return;
  const club = CLUB_BY_KEY[opts.clubKey];
  const end = sim.p;
  const total = Math.hypot(end.x - sim.lie.x, end.z - sim.lie.z);
  if (club?.putter || total < MIN_INTERESTING_M) return hide();

  const d = opts.dist || (m => m);
  const u = opts.unit || 'm';
  const n = m => Math.round(d(m));

  /* Carry is where it first landed; the rest is roll. On a shot that never
     got airborne the sim leaves carry at 0, and reporting "0 carry, 180
     roll" for a thinned iron is technically true and reads as a bug — so an
     unset carry is shown as the whole distance instead. */
  const carry = sim.carry > 0 ? sim.carry : total;
  const roll = Math.max(0, total - carry);
  const off = offline(sim.lie, end, opts.aim ?? 0);
  const apex = Math.max(0, sim.apex - sim.path[0].y);

  /* The swing itself. `faceDeg` is where the face pointed relative to the
     aim and `attackDeg` is thin-versus-fat; together they are the reason
     the ball did what it did, and they are the only part of this a player
     can actually change. */
  const face = opts.faceDeg || 0;
  const attack = opts.attackDeg || 0;
  const shape = Math.abs(face) < 0.8 ? 'straight'
    : face > 0 ? (face > 3 ? 'big slice' : 'fade')
    : (face < -3 ? 'big hook' : 'draw');
  const strike = Math.abs(attack) < 0.8 ? 'flush'
    : attack > 0 ? (attack > 2.5 ? 'fat' : 'heavy')
    : (attack < -2.5 ? 'thin' : 'clean');

  const sideWord = Math.abs(off) < 3 ? 'on line'
    : `${n(Math.abs(off))} ${u} ${off > 0 ? 'right' : 'left'}`;

  const b = ensure();
  b.innerHTML =
    `<div class="sc-top"><b>${club?.label || 'Shot'}</b>` +
      `<span class="sc-tot">${n(total)} <i>${u}</i></span></div>` +
    `<div class="sc-grid">` +
      `<span><i>Carry</i><b>${n(carry)}</b></span>` +
      `<span><i>Roll</i><b>${n(roll)}</b></span>` +
      `<span><i>Apex</i><b>${n(apex)}</b></span>` +
      `<span><i>Line</i><b>${sideWord}</b></span>` +
    `</div>` +
    `<div class="sc-tags"><em class="sc-${shape.split(' ').pop()}">${shape}</em>` +
      `<em class="sc-${strike}">${strike}</em>` +
      (opts.surface ? `<em class="sc-lie">${opts.surface}</em>` : '') + `</div>`;

  b.hidden = false;
  // a frame's gap so the transition has a state to move away from
  requestAnimationFrame(() => b.classList.add('in'));
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hide, opts.holed ? 2600 : 5200);
}

/** Turned off entirely — Tournament mode shows you nothing. */
export function disable() { hide(); }
