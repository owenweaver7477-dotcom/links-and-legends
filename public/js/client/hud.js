/* =========================================================================
   hud.js — every bit of DOM. No game logic lives here.
   ========================================================================= */

import { CARRY, CLUBS, CLUB_BY_KEY, BAG_SIZE, DEFAULT_BAG } from '../shared/clubs.js';
import { HOLES_PER_COURSE, BALL_COLORS, COURSE_ORDER } from '../shared/biomes.js';
import { CAPS, SHIRTS, SKINS, TROUSERS, HAIR_COLORS, SHOES,
         HAT_STYLES, HAIR_STYLES, ACCESSORIES, BODIES, bodiesOf } from '../shared/avatars.js';
import { SHOP, purchaseBlocked } from '../shared/gear.js';
import { CADDIES, CADDIE_MAX, caddieCost, CLUB_TIERS, REFINE_COSTS } from '../shared/crew.js';
import { EMOTES } from './celebrations.js';
import { UNLOCKS, unlocksAt, unlocksOfKind, nextUnlock, UNLOCK_KINDS } from '../shared/unlocks.js';
import { ACTIONS, keysFor, bindKey, resetBinds, keyLabel, RESERVED } from './binds.js';
import { clubSvg, caddieSvg, statSvg, finishName } from './clubart.js';
import { formChart, scoringChart, dial } from './charts.js';
import { toYards, clamp } from '../shared/rng.js';
import { ShotSim, makeFlatRange } from '../shared/ballistics.js';

const $ = id => document.getElementById(id);
const el = {};
for (const id of [
  'screenHome', 'screenLobby', 'screenResults', 'screenLoad', 'screenHoleOver', 'screenShop',
  'screenBoards', 'bdTabs', 'bdBack',
  'screenLanding', 'introCanvas', 'lpLegend', 'lpLive', 'lpSide', 'lpSideTitle',
  'lpSideClose', 'lpOnlineCount', 'lpCourseName', 'lpCourseSub', 'lpFriendSub',
  'nameState', 'nameSuggest',
  'screenWardrobe', 'wdCarousel', 'wdCourseName', 'wdCourseWhere', 'wdDots', 'wdPrev', 'wdNext',
  'wdAuto', 'wdCats', 'wdFits', 'wdRTabs', 'wdRBody', 'wdName', 'wdFit', 'wdStats',
  'wdRandom', 'wdCustom', 'wdDone',
  'btnClubhouse', 'btnShopBack', 'homeCoins',
  'homeErr', 'inpName', 'inpCode', 'loadMsg',
  'lobbyCode', 'lobbyLink', 'lobbyPlayers', 'lobbyCount', 'lobbyNote', 'btnStart', 'courseList',
  'hCourse', 'hNum', 'hPar', 'hMeta', 'dYds', 'dLie', 'dElev',
  'wArrow', 'wSpeed', 'wDesc', 'wWeather',
  'boardRows', 'boardRoom', 'turnbar', 'tbText', 'tbDot',
  'playbar', 'clubName', 'clubCarry', 'clubUp', 'clubDown', 'mFill', 'mFaceDot', 'mLabel', 'aimTxt', 'mPct',
  'shotinfo', 'toasts', 'mapwrap', 'mapc', 'minic', 'miniPanel',
  'hoTitle', 'hoSub', 'hoTable', 'hoNote', 'btnNext',
  'teeList', 'ballColours', 'bagList', 'bagCount', 'btnBagReset', 'optMetres',
  'cartKmh', 'dialFill', 'dialNeedle', 'cartDamage', 'cartDamageTxt', 'mFace', 'touchPad',
  'coinHud', 'coinHudN',
  'emoteWheel', 'recordBox', 'onlineNow', 'chatPanel', 'chatLog', 'chatInput', 'chatText', 'phraseBar', 'rosterPanel', 'rosterList', 'labelLayer', 'walkbar', 'walkText', 'lookPicker', 'optQuality', 'perfHud', 'careerBox', 'shopList', 'coinBal',
  'cartbar', 'cartSeat', 'cartWho', 'cartMph', 'shareHint',
  'resTitle', 'resSub', 'fullCard', 'resNote', 'btnAgain', 'btnBackLobby'
]) el[id] = $(id);

export const HUD = { el };

/* ------------------------------------------------------------------ units */
HUD.metric = false;
try { HUD.metric = localStorage.getItem('lg_metric') === '1'; } catch { /* private mode */ }
/* Sun shadows ON by default.  This defaulted to the blob-shadow path, which
   was the cautious choice before there was any measurement — a full course
   now renders in about 0.2 ms of frame CPU with 51 draw calls, so the machine
   that cannot afford a shadow map is the exception rather than the rule.  The
   auto-downgrade in main.js watches real frame times and eases back to blobs
   once, saying so, if this turns out to be wrong on a given machine. */
HUD.quality = 'medium';
try {
  const saved = localStorage.getItem('lg_quality');
  // 'perf' and 'quality' were the old two-way setting; map them onto the new
  // three so nobody's saved preference turns into an invalid tier.
  HUD.quality = saved === 'perf' ? 'low' : saved === 'quality' ? 'high'
    : ['low', 'medium', 'high'].includes(saved) ? saved : 'medium';
} catch { /* private mode */ }
HUD.setQuality = q => {
  HUD.quality = ['low', 'medium', 'high'].includes(q) ? q : 'medium';
  try { localStorage.setItem('lg_quality', HUD.quality); } catch { /* ignore */ }
};

HUD.setMetric = on => {
  HUD.metric = !!on;
  try { localStorage.setItem('lg_metric', on ? '1' : '0'); } catch { /* ignore */ }
};
/** metres -> the player's chosen unit */
const dist = m => (HUD.metric ? m : m / 0.9144);
HUD.unit = () => (HUD.metric ? 'm' : 'yds');
HUD.dist = dist;

/* ---------------------------------------------------------------- screens */
HUD.show = which => {
  /* 'home' and 'landing' are the SAME SCREEN now. The old home screen was a
     column of eleven controls beside a course picker beside a character
     editor, and the landing page it sat behind was better at being a front
     door than it was — so the front door became the whole thing, and every
     control that earned its place moved onto it.

     `screenHome` still exists in the DOM, hidden, because the wardrobe and
     the clubhouse both render into the character panel inside it by id.
     Showing it is never right. */
  const landing = which === 'landing' || which === 'home';
  el.screenBoards.hidden = which !== 'boards';
  el.screenLanding.hidden = !landing;
  el.screenWardrobe.hidden = which !== 'wardrobe';
  el.screenHome.hidden = true;
  el.screenLobby.hidden = which !== 'lobby';
  el.screenResults.hidden = which !== 'results';
  el.screenHoleOver.hidden = which !== 'holeover';
  el.screenLoad.hidden = which !== 'load';
  el.screenShop.hidden = which !== 'shop';
  // `null` means the round itself is on screen.  The body class gates every
  // piece of in-round chrome, so the transparent title screen never shows
  // the backdrop hole's own scorecard and minimap through itself.
  document.body.classList.toggle('playing', which == null);
  document.body.classList.toggle('landed', landing);
};
HUD.loading = msg => { el.loadMsg.textContent = msg; };
HUD.setHomeCoins = n => { el.homeCoins.textContent = '🪙 ' + (n || 0).toLocaleString(); };

/** The in-round balance.  Bumps when it goes UP, so a payout is felt. */
let lastCoins = null;
HUD.setCoins = n => {
  const v = n || 0;
  el.coinHudN.textContent = v.toLocaleString();
  if (lastCoins != null && v > lastCoins) {
    el.coinHud.classList.remove('bump');
    void el.coinHud.offsetWidth;
    el.coinHud.classList.add('bump');
  }
  lastCoins = v;
};
HUD.homeError = msg => { el.homeErr.textContent = msg || ''; };

/* ----------------------------------------------------------------- toasts */
HUD.toast = (msg, kind, ms = 2600) => {
  const t = document.createElement('div');
  t.className = 'toast ' + (kind || '');
  t.textContent = msg;
  el.toasts.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, ms);
  while (el.toasts.children.length > 4) el.toasts.firstChild.remove();
};

/** The big centre-screen call-out after a shot. */
HUD.flash = (big, small, color, tier = 0) => {
  // player names reach this; the server allow-lists them, escape here too
  el.shotinfo.innerHTML = escapeHtml(big) + (small ? `<small>${escapeHtml(small)}</small>` : '');
  el.shotinfo.style.color = color || '#fff';
  el.shotinfo.classList.remove('show', 'tier2', 'tier3');
  // an eagle and an ace deserve to look different from a par
  if (tier >= 3) el.shotinfo.classList.add('tier3');
  else if (tier === 2) el.shotinfo.classList.add('tier2');
  void el.shotinfo.offsetWidth;                    // restart the animation
  el.shotinfo.classList.add('show');
};

/* ------------------------------------------------------------------- hole */
HUD.setHole = (course, hole, teeSet = 'back') => {
  el.hCourse.textContent = course.name;
  el.hNum.textContent = 'Hole ' + hole.number;
  el.hPar.textContent = 'Par ' + hole.par;
  const yds = (hole.teeYards && hole.teeYards[teeSet]) ?? hole.yards;
  const shown = HUD.metric ? Math.round(yds * 0.9144) : yds;
  el.hMeta.textContent = `${shown} ${HUD.unit()} · ${hole.name}`;
};

HUD.setDistance = (metres, lieLabel, elevM) => {
  el.dYds.textContent = metres == null ? '—' : Math.round(dist(metres));
  const unitEl = el.dYds.nextElementSibling;
  if (unitEl) unitEl.textContent = HUD.unit() + ' to pin';
  el.dLie.textContent = lieLabel || '—';
  if (elevM == null || Math.abs(elevM) < 0.6) el.dElev.textContent = 'level';
  else el.dElev.textContent = (elevM > 0 ? '↑ ' : '↓ ')
    + (HUD.metric ? Math.abs(elevM).toFixed(1) + ' m' : Math.abs(Math.round(toYards(elevM) * 3)) + ' ft');
};

const BEAUFORT = s => s < 1 ? 'calm' : s < 3.5 ? 'light' : s < 7 ? 'breezy' : s < 11 ? 'blustery' : s < 16 ? 'strong' : 'howling';
/* 'exact' quotes the number; 'rough' gives you the word and no digits.
   Set from the difficulty, defaulting to exact so nothing that never sets
   it changes behaviour. */
let windDetail = 'exact';
HUD.setWindDetail = mode => { windDetail = mode === 'rough' ? 'rough' : 'exact'; };

HUD.setWind = (wind, viewHeading) => {
  HUD._lastWindMs = wind.speed;
  const mph = wind.speed * 2.23694;
  /* On Pro and above you get the arrow and a word for it. The arrow stays,
     because a wind you cannot see the DIRECTION of is not a harder read, it
     is a coin toss — and the flags and the trees show it anyway. What goes
     is the precision: judging "blustery" is a skill, subtracting 9 mph is
     arithmetic. */
  el.wSpeed.textContent = windDetail === 'rough' ? '' : Math.round(mph);
  el.wSpeed.parentElement?.classList.toggle('rough', windDetail === 'rough');

  /* MIRRORED, and it had been all along. The arrow is rotated by
     `wind.dir - viewHeading`, and SVG rotates CLOCKWISE for a positive
     angle — but in this coordinate frame (forward = sin h, cos h) the
     player's right is reached by DECREASING the heading. So a wind thirty
     degrees to the player's left was drawn thirty degrees to their right,
     on every crosswind, on every hole.

     The aim readout already carries a comment about needing exactly this
     negation for exactly this reason; the wind rose never got it. Anybody
     who trusted the arrow and aimed off it was aiming into the wind twice.

     Negated here rather than at the call site so there is one place that
     knows, next to the reason. */
  const rel = wind.dir - (viewHeading || 0);
  el.wArrow.setAttribute('transform', `rotate(${(-rel * 180 / Math.PI).toFixed(1)} 30 30)`);

  /* AND SAY IT IN WORDS. An arrow answers "which way" and leaves "so what"
     to the player; a crosswind that costs you nothing and a headwind that
     costs two clubs look identical on a compass rose. The component along
     the shot is the number that actually matters, so it is the one written
     down. */
  const along = Math.cos(rel);                    // +1 behind you, -1 into you
  const across = Math.sin(rel);
  const strength = wind.speed;
  let word;
  if (strength < 1) word = 'calm';
  else if (Math.abs(along) > 0.55) word = along > 0 ? 'helping' : 'into you';
  /* Verified against the simulation rather than reasoned about, because the
     sign conventions in this frame have caught me twice already: a wind at
     rel=+90° moves the ball 39 m LEFT, and a wind that pushes the ball left
     is one blowing right-to-left. Golfers name a crosswind by where it comes
     FROM, which is the opposite end from where it is going. */
  else word = across > 0 ? 'right to left' : 'left to right';
  el.wDesc.textContent = strength < 1 ? 'calm' : `${BEAUFORT(wind.speed)} · ${word}`;
};

/* ------------------------------------------------------------------- club */
HUD.setClub = (club, lieId, mult = 1, ends = null) => {
  el.clubName.textContent = club.label;
  // grey the arrow you cannot take any further, rather than letting it click
  // and do nothing — the bag has a longest and a shortest club
  if (ends) {
    el.clubDown.disabled = !!ends.longest;
    el.clubUp.disabled = !!ends.shortest;
  }
  if (club.putter) {
    el.clubCarry.textContent = 'on the green';
  } else {
    // mult is the player's equipment factor — an upgraded bag genuinely
    // carries further, and this label must not quote the stock number
    const c = (CARRY[club.key] || 0) * mult;
    el.clubCarry.textContent = Math.round(dist(c)) + ' ' + HUD.unit();
  }
};
HUD.setAim = deg => { el.aimTxt.textContent = (deg > 0 ? '+' : '') + deg.toFixed(1) + '°'; };

/* ------------------------------------------------------------------ meter */
/* How much of the bar's half-width the sweep covers. Slightly under 50 so
   the marker's own width stays inside the track — and used for BOTH the
   marker and the band it has to stop in, which is the whole point of it
   being a named number rather than two literals in two places. */
const SWEEP_SCALE = 48;
/** Where a perfectly-paced shot sits on the meter, or null if out of range. */
HUD.setTargetPower = (p) => {
  const mk = document.getElementById('mMark');
  if (p == null) { mk.style.display = 'none'; return; }
  mk.style.display = '';
  mk.style.left = (clamp(p, 0, 1.12) / 1.12 * 100) + '%';
};

const LIE_WORDS = {
  sand: 'Sand — slow bar, and the sand eats the ball',
  rough: 'Light rough — the bar is quicker',
  deep: 'Heavy rough — the bar is a blur',
  waste: 'Waste — the bar is a blur',
  green: 'On the green — a steady stroke'
};

HUD.setMeter = (m, enabled) => {
  const pct = clamp(m.power, 0, 1.12) / 1.12 * 100;
  el.mFill.style.width = pct + '%';
  // the number, riding the end of the bar — power is the whole game here
  const live = enabled && (m.state === 'back' || m.state === 'accuracy');
  el.mPct.textContent = live ? Math.round(m.power * 100) + '%' : '';
  el.mPct.style.left = Math.min(pct, 86) + '%';

  // The strike bar.  While you are dragging it shows the shape you are
  // setting; once the power is locked it becomes the sweeping marker you
  // have to stop, and the whole bar lights up to say it is live.
  const striking = m.state === 'accuracy';
  el.mFace.classList.toggle('live', striking);
  // the green zone IS the forgiving band, so what you see is what forgives
  if (striking) {
    /* On Pro and above the zone is not drawn. It still exists and still
       forgives — hiding the target makes the strike a matter of feel, and
       removing it would make it a coin flip. */
    const zone = el.mFace.querySelector('.m-face-zone');
    const mark = m.showBand !== false;
    zone.hidden = !mark;
    if (mark) {
      /* THE SAME SCALE THE MARKER USES. The zone was drawn across ±50% of
         the bar while the marker travels across ±48% — it is inset so a
         four-pixel dot stays inside the track — so the two disagreed by up
         to four per cent of the width. The dot reached the painted edge of
         the green slightly before the strike actually left the band, which
         means a player stopping it just inside the green could be judged
         to have missed.

         Small, and precisely the kind of small that feels like the game
         cheating. Both now measure the same way, so what is judged is what
         is drawn. */
      const pct = 50 - (m.band ?? 0.2) * SWEEP_SCALE;
      zone.style.cssText = `left:${pct}%;right:${pct}%`;
    }
  }
  const dotPct = striking ? 50 + clamp(m.sweep, -1, 1) * SWEEP_SCALE
    : clamp(50 + m.face * 4.4, 2, 98);
  el.mFaceDot.style.left = `calc(${dotPct}% - 2px)`;
  el.mFaceDot.classList.toggle('sweeping', striking);

  if (!enabled) { el.mLabel.textContent = 'Waiting…'; el.mLabel.classList.remove('hot'); return; }
  if (m.state === 'back') {
    /* Tell the player what their POWER is about to cost them, while they can
       still do something about it.  The bar's speed now rises with the swing,
       so the honest thing to show mid-drag is how hard the strike is going to
       be to time — otherwise the mechanic is invisible and just feels like
       full swings randomly going wrong.

       (This used to describe a draw or fade shaped by the angle of the drag.
       That shaping was removed when the strike bar became the only thing that
       bends the ball, and the label has been quietly dead ever since.) */
    const t = m.tempo || 0, calm = m.calmTempo || 0, fast = m.fastTempo || t;
    const heat = fast > calm ? clamp((t - calm) / (fast - calm), 0, 1) : 0;
    el.mLabel.textContent = m.power > 1 ? 'Overswinging — accuracy is going'
      : m.power < 0.12 ? 'Drag down to take the club back'
      : heat > 0.75 ? 'Full swing — the strike bar will be quick'
      : heat > 0.35 ? 'Three quarters — a steady bar'
      : 'Smooth — the bar will be slow and kind';
    el.mLabel.classList.toggle('hot', m.power > 1 || heat > 0.75);
  } else if (striking) {
    el.mLabel.textContent = 'CLICK to strike — stop it in the middle';
    el.mLabel.classList.add('hot');
  } else {
    el.mLabel.textContent = LIE_WORDS[m.lie] || 'Drag down to take the club back';
    el.mLabel.classList.remove('hot');
  }
};
HUD.showPlaybar = on => el.playbar.classList.toggle('show', !!on);

/** The touch pad belongs to a live round, not to the menus over the top. */
HUD.showTouchPad = on => { el.touchPad.hidden = !on; };

/* ------------------------------------------------------------- perf HUD */
HUD.showPerf = on => { el.perfHud.hidden = !on; };
HUD.perfVisible = () => !el.perfHud.hidden;
HUD.setPerf = (fps, ms, calls, tris, quality) => {
  const cls = fps >= 55 ? '' : fps >= 30 ? 'warn' : 'bad';
  el.perfHud.innerHTML =
    `<b class="${cls}">${fps.toFixed(0)} fps</b>  ${ms.toFixed(1)} ms\n` +
    `${calls} draws · ${(tris/1000).toFixed(0)}k tris\n` +
    `graphics: ${quality}`;
};

/* ------------------------------------------------------------------- turn */
HUD.setTurn = (text, mine, color) => {
  el.tbText.textContent = text;
  el.turnbar.classList.toggle('mine', !!mine);
  el.tbDot.style.background = color || '#8fe07a';
  el.tbDot.style.color = color || '#8fe07a';
};

/* -------------------------------------------------------------- scorecard */
function relLabel(v) { return v === 0 ? 'E' : v > 0 ? '+' + v : String(v); }

HUD.renderBoard = (room, myPid, course) => {
  el.boardRoom.textContent = room.code;
  el.boardRows.innerHTML = '';
  const parSoFar = course.holes.slice(0, room.holeIndex + 1).reduce((s, h) => s + h.par, 0);

  /* In a scramble the SIDE is the competitor and the individual scores are
     meaningless — every member of a team carries the same number. So the
     card leads with two team rows, and the players underneath are grouped
     beneath their own side rather than listed in join order, which is the
     only arrangement that lets you see at a glance who you are playing with
     and who you are playing against. */
  if (room.teams && room.teams.length) {
    for (const t of room.teams) {
      const mine = t.players.some(x => x.pid === myPid);
      const row = document.createElement('div');
      row.className = 'trow' + (mine ? ' mine' : '');
      const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = t.color;
      const nm = document.createElement('span'); nm.className = 'pname';
      nm.textContent = t.name;
      const who = document.createElement('small');
      who.textContent = t.players.map(x => x.name).join(', ');
      nm.appendChild(who);
      let played = 0, taken = 0;
      for (let i = 0; i < room.holeIndex; i++) {
        if (t.scores[i] != null) { taken += t.scores[i]; played += course.holes[i].par; }
      }
      const rel = taken - played;
      const tot = document.createElement('span'); tot.className = 'ptotal';
      tot.textContent = played ? (rel === 0 ? 'E' : rel > 0 ? '+' + rel : String(rel)) : '—';
      row.append(sw, nm, tot);
      el.boardRows.appendChild(row);
    }
  }

  for (const p of room.players) {
    const row = document.createElement('div');
    row.className = 'prow' + (p.pid === room.turnPid ? ' turn' : '') + (!p.connected ? ' gone' : '');
    const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = p.color;
    const nm = document.createElement('span'); nm.className = 'pname'; nm.textContent = p.name;
    if (p.pid === myPid) { const y = document.createElement('span'); y.className = 'you'; y.textContent = 'YOU'; nm.appendChild(y); }
    const st = document.createElement('span'); st.className = 'pstroke';
    st.textContent = p.spectator ? '–' : (p.finished ? '✓' : p.strokes || 0);

    // running total against par, counting only holes actually completed
    let played = 0, taken = 0;
    for (let i = 0; i < room.holeIndex; i++) if (p.scores[i] != null) { taken += p.scores[i]; played += course.holes[i].par; }
    if (p.finished && p.scores[room.holeIndex] != null) { taken += p.scores[room.holeIndex]; played += course.holes[room.holeIndex].par; }
    const rel = taken - played;
    const tot = document.createElement('span');
    tot.className = 'ptot ' + (rel < 0 ? 'under' : rel > 0 ? 'over' : '');
    tot.textContent = p.spectator ? 'watch' : relLabel(rel);

    row.append(sw, nm, st, tot);
    el.boardRows.appendChild(row);
  }
};

/* ----------------------------------------------------------------- lobby */
/* Slope bands, named. A number between 55 and 155 means something precise
   to a golfer with a handicap and nothing at all to somebody picking their
   first course, so the picker shows both — the word for choosing, the
   number for anyone who wants it. Boundaries are the ones the WHS itself
   treats as notable: 113 is average by definition, and 130 upward is where
   a course starts being described as a championship test. */
const SLOPE_BANDS = [
  { max: 104, name: 'Gentle',     cls: 'd1' },
  { max: 117, name: 'Easy',       cls: 'd2' },
  { max: 126, name: 'Average',    cls: 'd3' },
  { max: 136, name: 'Hard',       cls: 'd4' },
  { max: 999, name: 'Punishing',  cls: 'd5' }
];
const bandFor = slope => SLOPE_BANDS.find(b => slope <= b.max) || SLOPE_BANDS[4];
/** Shared with the landing page's picker, so both name a slope the same. */
HUD.slopeBand = bandFor;

HUD.renderCourses = (courses, selected, isHost, onPick, ratings = null) => {
  el.courseList.innerHTML = '';
  for (const c of courses) {
    const r = ratings?.[c.id] || null;
    const band = r ? bandFor(r.slope) : null;
    const b = document.createElement('button');
    b.className = 'ccard' + (c.id === selected ? ' on' : '') + (isHost ? '' : ' locked');
    b.innerHTML = `<div class="c-art art-${c.id}"></div>
      ${band ? `<span class="cdiff ${band.cls}" title="slope ${r.slope} · rating ${r.rating}">
        <i></i>${band.name}</span>` : ''}
      <b>${c.name}</b><span class="cr">${c.region}</span>
      <div class="cd">${c.blurb}</div>
      <div class="cstat">${HOLES_PER_COURSE} holes · par ${c.par} · ${c.yards} yds${
        r ? ` · <span title="course rating / slope">${r.rating} / ${r.slope}</span>` : ''}</div>`;
    if (isHost) b.addEventListener('click', () => onPick(c.id));
    el.courseList.appendChild(b);
  }
};

const TEE_LABEL = { back: 'Championship', regular: 'Members', forward: 'Forward' };
HUD.renderTees = (hole, selected, isHost, onPick) => {
  el.teeList.innerHTML = '';
  for (const key of ['back', 'regular', 'forward']) {
    const yds = hole?.teeYards?.[key];
    const b = document.createElement('button');
    b.className = 'teebtn' + (key === selected ? ' on' : '') + (isHost ? '' : ' locked');
    const shown = yds == null ? '—' : (HUD.metric ? Math.round(yds * 0.9144) : yds);
    b.innerHTML = `<b>${TEE_LABEL[key]}</b><span>hole 1 · ${shown} ${HUD.unit()}</span>`;
    if (isHost) b.addEventListener('click', () => onPick(key));
    el.teeList.appendChild(b);
  }
};

HUD.renderColours = (room, myPid, onPick, rating = 0) => {
  el.ballColours.innerHTML = '';
  const mine = room.players.find(p => p.pid === myPid)?.color;
  for (const c of BALL_COLORS) {
    const taken = room.players.some(p => p.pid !== myPid && p.color === c.hex);
    const locked = !!c.lockRating && rating < c.lockRating;
    const b = document.createElement('button');
    b.className = 'swbtn' + (c.hex === mine ? ' on' : '') + (taken ? ' taken' : '') + (locked ? ' locked' : '');
    b.style.background = c.hex;
    b.title = locked ? c.name + ' — unlocks at rating ' + c.lockRating
      : taken ? c.name + ' (taken)' : c.name;
    if (locked) b.textContent = '🔒';
    if (!taken && !locked) b.addEventListener('click', () => onPick(c.hex));
    el.ballColours.appendChild(b);
  }
};

HUD.renderBag = (bag, onToggle, clubTier = 0, skin = 'stock') => {
  HUD.myClubTier = clubTier;
  HUD.mySkin = skin;
  el.bagList.innerHTML = '';
  const carried = new Set(bag);
  el.bagCount.textContent = `(${bag.length}/${BAG_SIZE})`;
  el.bagCount.className = bag.length > BAG_SIZE ? 'over' : '';
  for (const c of CLUBS) {
    const on = carried.has(c.key);
    const b = document.createElement('button');
    b.className = 'clubbtn' + (on ? ' on' : '') + (c.putter ? ' fixed' : '');
    const carry = c.putter ? '' : Math.round(dist(CARRY[c.key] || 0)) + ' ' + HUD.unit();
    b.innerHTML = `<b>${c.label}</b><span>${c.putter ? 'always in' : c.loft + '° · ' + carry}</span>`;
    if (!c.putter) b.addEventListener('click', () => onToggle(c.key));
    /* Hovering a club shows it. Fourteen picks out of twenty-one from a list
       of abbreviations is a spreadsheet; seeing the club you are about to
       add or drop is what makes it a bag. */
    const view = { kind: 'club', key: c.key, tier: HUD.myClubTier || 0,
                   skin: HUD.mySkin || 'stock',
                   name: c.name || c.label,
                   sub: c.putter ? 'Always in the bag' : `${c.loft}° · ${carry}` };
    const show = () => HUD.previewBagClub(view);
    b.addEventListener('pointerover', show);
    b.addEventListener('focus', show);
    el.bagList.appendChild(b);
  }
  // open on the first club rather than on an empty stage
  const first = CLUBS[0];
  HUD.previewBagClub({ kind: 'club', key: first.key, tier: HUD.myClubTier || 0,
    name: first.name || first.label, sub: `${first.loft}° · stock` });
};

/* ═══════════════════════════════════════════════ CLUB FINISHES ══════════
   Earned, never bought, and they change nothing about the ball — which is
   exactly why an ace can hand one out. A locked finish shows the thing to
   go and DO, with how close you are, because "Level 44" is a target and
   "34/44" is a reason to play another round. */
HUD.renderClubSkins = (prof, onPick) => {
  const box = document.getElementById('skinList');
  if (!box) return;
  const cur = prof?.clubSkin || 'stock';
  box.innerHTML = CLUB_SKINS.map(sk => {
    const got = skinEarned(sk, prof);
    const pr = skinProgress(sk, prof);
    const swatch = sk.shaft || '#c9ccd2';
    return `<button class="skin${got ? '' : ' locked'}${sk.id === cur ? ' on' : ''}
        ${sk.feat ? ' feat' : ''}" data-skin="${sk.id}"${got ? '' : ' disabled'}
        style="--c:${swatch}">
      <span class="skin-sw"><i style="background:${sk.shaft || '#c9ccd2'}"></i><i
        style="background:${sk.head || '#e2e5ea'}"></i><i
        style="background:${sk.grip || '#2b2b2f'}"></i></span>
      <span class="skin-txt">
        <b>${escapeHtml(sk.name)}${sk.feat ? ' <em>feat</em>' : ''}</b>
        <small>${got ? escapeHtml(sk.blurb) : escapeHtml(skinRequirement(sk))}</small>
        ${!got && pr && pr.want > 1
          ? `<span class="skin-bar"><i style="width:${pr.pct * 100}%"></i></span>
             <span class="skin-prog">${pr.have} of ${pr.want}</span>` : ''}
      </span>
    </button>`;
  }).join('');
  if (!box.dataset.wired) {
    box.dataset.wired = '1';
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-skin]');
      if (b && !b.disabled) onPick(b.dataset.skin);
    });
    const hover = e => {
      const b = e.target.closest('[data-skin]');
      if (!b) return;
      const sk = CLUB_SKINS.find(x => x.id === b.dataset.skin);
      HUD.previewBagClub({ kind: 'club', key: 'DR', tier: HUD.myClubTier || 0,
        skin: sk.id, name: sk.name, sub: sk.blurb });
    };
    box.addEventListener('pointerover', hover);
  }
};

/** The bag's own turntable — same renderer as the shop, different canvas. */
HUD.previewBagClub = what => {
  const cv = document.getElementById('bagCanvas');
  if (!cv || !what) return;
  showShopItem(cv, what);
  const cap = document.getElementById('bagCap');
  if (cap) {
    cap.innerHTML = `<b>${escapeHtml(what.name || '')}</b>` +
      (what.sub ? `<small>${escapeHtml(what.sub)}</small>` : '');
  }
};

/* The wardrobe, in the order a player thinks about it: who they are, then
   what they are wearing, then the details.  `swatch` groups are colours;
   `style` groups are shapes and show their name instead. */
/* The level rewards, above the wardrobe proper: they are the thing a player
   came to this panel to look at once they have earned any. `kind` matches
   unlocks.js; `key` is the field in the look. */
const EARNED_GROUPS = [
  { key: 'decal',      title: 'Club decal',  kind: 'decal' },
  { key: 'trail',      title: 'Ball trail',  kind: 'trail' },
  { key: 'title',      title: 'Title',       kind: 'title' },
  { key: 'ballFinish', title: 'Ball finish', kind: 'ball'  }
];

const LOOK_GROUPS = [
  { key: 'body',      title: 'Build',       list: BODIES,      kind: 'build'  },
  { key: 'skin',      title: 'Skin',        list: SKINS,       kind: 'swatch' },
  { key: 'hair',      title: 'Hair',        list: HAIR_STYLES, kind: 'style'  },
  { key: 'hairColor', title: 'Hair colour', list: HAIR_COLORS, kind: 'swatch' },
  { key: 'hat',       title: 'Headwear',    list: HAT_STYLES,  kind: 'style'  },
  { key: 'cap',       title: 'Hat colour',  list: CAPS,        kind: 'swatch' },
  { key: 'shirt',     title: 'Shirt',       list: SHIRTS,      kind: 'swatch' },
  { key: 'trousers',  title: 'Trousers',    list: TROUSERS,    kind: 'swatch' },
  { key: 'shoes',     title: 'Shoes',       list: SHOES,       kind: 'swatch' },
  { key: 'accessory', title: 'Accessory',   list: ACCESSORIES, kind: 'style'  }
];
/**
 * Your career, from the server's book of record.  Nothing here is client
 * arithmetic on trust — every number came from shots the server simulated.
 */
/** The level badge and XP bar, as markup — used by the career and results. */
function levelRow(prof) {
  const lvl = prof?.level ?? 1;
  const into = Math.round(prof?.into ?? 0), need = Math.round(prof?.need ?? 1);
  const pct = Math.round((prof?.progress ?? 0) * 100);
  const next = nextUnlock(lvl);
  const owned = unlocksAt(lvl).length;
  return `<div class="lvlrow">
    <span class="lvlbadge">LV ${lvl}</span>
    <span class="lvlbar"><i style="width:${pct}%"></i></span>
    <span class="lvlnum">${prof?.maxed ? 'MAX' : into + ' / ' + need + ' XP'}</span>
  </div>
  <div class="lvlnext">
    <span>${owned} of ${UNLOCKS.length} unlocked</span>
    ${next ? `<span>Next: <b>${escapeHtml(next.name)}</b> ` +
      `<em>${escapeHtml((UNLOCK_KINDS[next.kind] || {}).name || next.kind)}</em> at level ${next.at}</span>`
      : '<span>Everything unlocked</span>'}
  </div>`;
}
HUD.levelRow = levelRow;

/* Which tab the Pro Shop is showing. Module-level so it survives the
   re-render that every purchase triggers — a tab that reset itself on each
   buy would bounce the player back to the Caddie Crew every time. */
let shopTab = 'crew';

/* What the equipment is worth in YARDS, measured rather than asserted. The
   stat bars are honest but abstract — "Accuracy 62%" does not tell a player
   who has just spent 1,200 coins whether anything happened. This flies the
   real simulation on a flat range with the gear they own and with nothing,
   and reports the difference, so the shop and the course cannot disagree.
   Cached per gear signature: it is a dozen flight integrations and the shop
   re-renders on every purchase. */
let rangeT = null;
const carryCache = new Map();
function carryYds(clubKey, prof) {
  const key = clubKey + '|' + (prof?.clubTier ?? 0) + '|' + (prof?.refine ?? 0) + '|' +
    JSON.stringify(prof?.gear || {}) + '|' + JSON.stringify(prof?.crew || {});
  if (carryCache.has(key)) return carryCache.get(key);
  let v = 0;
  try {
    rangeT = rangeT || makeFlatRange();
    const r = new ShotSim(rangeT, {
      x: 0, z: 0, clubKey, power: 1, aim: 0, faceDeg: 0, attackDeg: 0,
      wind: { dir: 0, speed: 0 },
      gear: prof?.gear || null, crew: prof?.crew || null,
      clubTier: prof?.clubTier ?? 0, refine: prof?.refine ?? 0
    }).runToEnd();
    v = Math.round(toYards(r.carry));
  } catch { v = 0; }
  carryCache.set(key, v);
  return v;
}

/** The same player with nothing bought — the honest baseline to compare to. */
const BARE = { clubTier: 0, refine: 0, gear: { ball: 0, irons: 0, woods: 0, putter: 0 }, crew: {} };

/**
 * The Pro Shop's headline: the set you own, drawn, with what it is worth in
 * yards and the five felt stats underneath.
 */
function buildPayoff(prof) {
  const wrap = document.createElement('div');
  wrap.className = 'payoff';
  const crew = prof?.crew || {};
  const tier = prof?.clubTier ?? 0;
  const refine = prof?.refine ?? 0;
  const set = CLUB_TIERS[Math.max(0, Math.min(6, tier))];

  const lvl = k => (crew[k] || 0) / CADDIE_MAX;
  const bars = [
    ['Power',       Math.min(1, (tier / 6) * 0.6 + lvl('bruiser') * 0.4), 'power'],
    ['Accuracy',    Math.min(1, lvl('ace') * 0.6 + (tier / 6) * 0.4),     'accuracy'],
    ['Forgiveness', Math.min(1, (set.faceDamp / 0.33) * 0.7 + lvl('steady') * 0.3), 'forgive'],
    ['Short game',  Math.min(1, lvl('roller') * 0.7 + lvl('lucky') * 0.3), 'short'],
    ['Cart',        lvl('pitstop'),                                        'cart']
  ];

  wrap.innerHTML = `
    <div class="po-set">
      <span class="po-art">${clubSvg(set.look, 64)}</span>
      <div class="po-settxt">
        <b>${escapeHtml(set.name)}</b>
        <span>Tier ${tier + 1}/7 · ${escapeHtml(finishName(set.look))}${refine ? ' · Refinement ' + ['I', 'II', 'III'][refine - 1] : ''}</span>
      </div>
      <div class="po-tiers">${CLUB_TIERS.map((t, i) =>
        `<i class="${i < tier ? 'done' : i === tier ? 'now' : ''}" title="${escapeHtml(t.name)}"></i>`).join('')}</div>
    </div>
    <div class="po-carry">${[['Driver', 'DR'], ['7 iron', 'I7'], ['Wedge', 'PW']].map(([label, k]) => {
      const now = carryYds(k, prof), base = carryYds(k, BARE), d = now - base;
      return `<div class="po-c">
        <span class="po-cl">${label}</span>
        <b>${now}<em>yds</em></b>
        <span class="po-cd${d > 0 ? ' up' : ''}">${d > 0 ? '+' + d + ' vs stock' : 'stock set'}</span>
      </div>`;
    }).join('')}</div>
    <div class="po-bars">${bars.map(([name, v, ico]) => `
      <div class="po-bar">
        <span class="po-name">${statSvg(ico)} ${name}</span>
        <span class="po-track"><i style="width:${Math.round(v * 100)}%"></i></span>
        <span class="po-pct">${Math.round(v * 100)}%</span>
      </div>`).join('')}</div>`;
  return wrap;
}

HUD.renderCareer = (prof) => {
  const box = el.careerBox;
  if (!box) return;

  /* Rebuilt as a card with a shape at the top of it rather than eight
     numbers in eight boxes. Numbers tell you what happened; the form line
     tells you whether you are getting better, which is the only thing
     anybody opens this screen to find out. */
  if (!prof || !prof.rounds) {
    box.innerHTML = levelRow(prof) +
      '<p class="career-empty">Your first round starts your career — form, ' +
      'scoring and a skill rating all live here.</p>';
    return;
  }

  const rel = v => v == null ? '—' : v > 0 ? '+' + v : v === 0 ? 'E' : String(v);
  const hcp = prof.handicap == null ? '—' : (prof.handicap > 0 ? '+' : '') + prof.handicap;

  box.innerHTML =
    levelRow(prof) +
    `<div class="cr-top">
       <div class="cr-rating">
         <span class="cr-num">${prof.rating}</span>
         <span class="cr-cap">rating</span>
       </div>
       <div class="cr-side">
         <div><b>${prof.rounds}</b><span>rounds</span></div>
         <div><b>${rel(prof.best)}</b><span>best</span></div>
         <div><b>${hcp}</b><span>handicap</span></div>
       </div>
     </div>

     <h5 class="cr-h">Form — last ${Math.min(20, (prof.history || []).length)} rounds</h5>
     ${formChart(prof.history)}

     <h5 class="cr-h">Where the strokes go</h5>
     ${scoringChart(prof)}

     <div class="cr-dials">
       ${dial(prof.fairwayPct ?? 0, 'fairways', prof.fairwayPct == null ? '—' : prof.fairwayPct + '%')}
       ${dial(prof.girPct ?? 0, 'greens in reg', prof.girPct == null ? '—' : prof.girPct + '%')}
       ${dial(prof.avgPutts == null ? 0 : Math.max(0, (2.4 - prof.avgPutts) / 1.2 * 100),
              'putts / hole', prof.avgPutts == null ? '—' : prof.avgPutts)}
     </div>

     <div class="cr-tally">
       <span><b>${prof.birdies || 0}</b> birdies</span>
       <span><b>${prof.eagles || 0}</b> eagles</span>
       <span><b>${prof.aces || 0}</b> aces</span>
       <span><b>🪙 ${(prof.coins || 0).toLocaleString()}</b></span>
     </div>`;
};

const CADDIE_HEX = {
  ace: '#c8382f', bruiser: '#e8873a', steady: '#4f9fd8', roller: '#6fce8a',
  pitstop: '#e8c15a', lucky: '#a98cd8', gale: '#7fd8d0', grit: '#9c8f76'
};

HUD.renderShop = (prof, onBuy) => {
  if (!el.shopList) return;
  el.coinBal.textContent = prof ? '🪙 ' + (prof.coins || 0) : '';
  el.shopList.innerHTML = '';

  /* The payoff panel.  An upgrade that only moves a hidden number is not an
     upgrade the player can feel, so every purchase shows up here immediately:
     the bars grow, the club-set silhouette changes tier, and the crew badges
     light.  It is the same data the simulation uses, read straight back. */
  el.shopList.appendChild(buildPayoff(prof));

  const tabs = document.createElement('div');
  tabs.className = 'shoptabs';
  for (const [id, label] of [['crew', 'Caddie Crew'], ['pro', 'Pro Shop']]) {
    const t = document.createElement('button');
    t.className = 'shoptab' + (shopTab === id ? ' on' : '');
    t.textContent = label;
    t.addEventListener('click', () => { shopTab = id; HUD.renderShop(prof, onBuy); });
    tabs.appendChild(t);
  }
  el.shopList.appendChild(tabs);

  const grid = document.createElement('div');
  grid.className = 'shop';
  el.shopList.appendChild(grid);
  const coins = prof?.coins || 0;

  /* One delegated listener rather than one per card. The preview follows
     the pointer, so browsing the list IS browsing the models — there is no
     separate "preview" action to discover. */
  if (!grid.dataset.wired) {
    grid.dataset.wired = '1';
    const show = e => {
      const card = e.target.closest('[data-view]');
      if (!card) return;
      try { HUD.previewShopItem(JSON.parse(card.dataset.view)); } catch { /* ignore */ }
    };
    grid.addEventListener('pointerover', show);
    grid.addEventListener('focusin', show);
    grid.addEventListener('click', show);
  }

  if (shopTab === 'crew') {
    const crew = prof?.crew || {};
    for (const [key, c] of Object.entries(CADDIES)) {
      const lvl = crew[key] || 0;
      const cost = caddieCost(lvl);
      const card = document.createElement('div');
      card.className = 'shopcard caddie' + (lvl >= CADDIE_MAX ? ' owned' : '');
      /* A colour per caddie, so the six of them are six people on the
         turntable rather than one gold figure with different captions.
         Keyed off the caddie id, which is stable — the stat strings are
         display text and would take the previews with them if reworded. */
      card.dataset.view = JSON.stringify({ kind: 'caddie', hex: CADDIE_HEX[key] || '#e8c15a',
        name: c.name, sub: c.stat });
      const pips = Array.from({ length: CADDIE_MAX }, (_, i) =>
        `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
      card.innerHTML = `
        <div class="cad-head"><span class="cad-face">${caddieSvg(key, 34) || c.emoji}</span>
          <div><b>${c.name}</b><span class="cad-stat">${c.stat}${lvl >= CADDIE_MAX ? ' · LEGEND' : lvl ? ' · Lv ' + lvl : ''}</span></div>
        </div>
        <span class="sc-blurb">${c.blurb}</span>
        <div class="cad-pips">${pips}</div>
        ${lvl ? `<span class="cad-now">${c.line(lvl)}</span>` : ''}`;
      const btn = document.createElement('button');
      if (lvl >= CADDIE_MAX) {
        btn.className = 'btn'; btn.textContent = 'Legend ★'; btn.disabled = true;
      } else {
        const can = coins >= cost;
        btn.className = 'btn' + (can ? ' primary' : '');
        btn.textContent = can
          ? (lvl ? 'Level up · ' : 'Hire · ') + '🪙 ' + cost
          : `🪙 ${cost} · need ${cost - coins} more`;
        btn.disabled = !can;
        if (can) btn.addEventListener('click', () => onBuy('caddie:' + key));
      }
      card.appendChild(btn);
      grid.appendChild(card);
    }
  } else {
    // the club ladder: your set, the refinement, the next rung
    const tier = prof?.clubTier ?? 0, refine = prof?.refine ?? 0;
    const cur = CLUB_TIERS[tier];
    const curCard = document.createElement('div');
    curCard.className = 'shopcard owned';
    curCard.innerHTML = `<span class="sc-art">${clubSvg(cur.look, 46)}</span>
      <b>${escapeHtml(cur.name)}</b><span class="sc-blurb">${escapeHtml(cur.blurb)}</span>
      <span class="cad-now">Tier ${tier + 1}/7${refine ? ' · Refinement ' + ['I','II','III'][refine - 1] : ''}</span>`;
    if (refine < 3) {
      const rc = REFINE_COSTS(tier)[refine];
      const rb = document.createElement('button');
      rb.className = 'btn' + (coins >= rc ? ' primary' : '');
      rb.textContent = coins >= rc
        ? 'Refine ' + ['I','II','III'][refine] + ' · 🪙 ' + rc
        : `🪙 ${rc} · need ${rc - coins} more`;
      rb.disabled = coins < rc;
      if (coins >= rc) rb.addEventListener('click', () => onBuy('club:refine'));
      curCard.appendChild(rb);
    }
    grid.appendChild(curCard);

    if (tier < 6) {
      const nxt = CLUB_TIERS[tier + 1];
      const nc = document.createElement('div');
      nc.className = 'shopcard';
      nc.dataset.view = JSON.stringify({ kind: 'club', key: 'DR', tier: tier + 1,
        name: nxt.name, sub: 'The next set up' });
      nc.innerHTML = `<span class="sc-art">${clubSvg(nxt.look, 46)}</span>
        <b>${escapeHtml(nxt.name)}</b><span class="sc-blurb">${escapeHtml(nxt.blurb)}</span>
        <span class="cad-now">Refinements reset on upgrade — a new set starts raw</span>`;
      const nb = document.createElement('button');
      nb.className = 'btn' + (coins >= nxt.cost ? ' primary' : '');
      nb.textContent = coins >= nxt.cost
        ? 'Upgrade set · 🪙 ' + nxt.cost
        : `🪙 ${nxt.cost} · need ${nxt.cost - coins} more`;
      nb.disabled = coins < nxt.cost;
      if (coins >= nxt.cost) nb.addEventListener('click', () => onBuy('club:tier'));
      nc.appendChild(nb);
      grid.appendChild(nc);
    }

    /* EVERY item in the shop.  Three of the six — forged irons, carbon woods
       and the milled putter — used to be skipped here as "legacy", so they
       were unbuyable in the UI while still costing coins and changing the
       ball flight if bought over the wire.  If it is in SHOP it is for sale. */
    const gear = prof?.gear || {};
    for (const [key, it] of Object.entries(SHOP)) {
      const owned = (gear[it.slot] || 0) >= it.tier;
      const blocked = prof ? purchaseBlocked(key, { coins, gear }) : 'Join first.';
      const card = document.createElement('div');
      card.className = 'shopcard' + (owned ? ' owned' : '');
      /* Which model to turn: a ball for the ball upgrades, the matching club
         for irons, woods and the putter, and a crate for anything else.
         Driven off the SLOT rather than the item name, so a new item in an
         existing slot gets a preview without anybody remembering to add one. */
      const viewFor = {
        ball: { kind: 'ball', hex: '#f6f9f4' },
        irons: { kind: 'club', key: 'I7' },
        woods: { kind: 'club', key: 'DR' },
        putter: { kind: 'club', key: 'PT' },
        cart: { kind: 'item', hex: '#7fb6dd' }
      }[it.slot] || { kind: 'item', hex: '#6fce8a' };
      card.dataset.view = JSON.stringify({ ...viewFor, tier: it.tier,
        name: it.name, sub: it.blurb });
      card.innerHTML = `<b>${escapeHtml(it.name)}</b><span class="sc-blurb">${escapeHtml(it.blurb)}</span>`;
      const btn = document.createElement('button');
      btn.className = 'btn' + (owned ? '' : blocked ? '' : ' primary');
      // A dead grey button with a price on it tells the player nothing about
      // WHY they cannot press it.  Say the actual reason.
      const short = coins < it.cost ? `🪙 ${it.cost} · need ${it.cost - coins} more` : null;
      btn.textContent = owned ? 'In the bag ✓'
        : short ? short
          : blocked ? blocked
            : '🪙 ' + it.cost;
      btn.disabled = owned || !!blocked;
      if (!owned && !blocked) btn.addEventListener('click', () => onBuy(key));
      card.appendChild(btn);
      grid.appendChild(card);
    }
  }
};

/**
 * The character card on the front page: who you are, your level and your
 * rating, sitting beside the golfer on the tee.
 *
 * The rating in particular was only visible in the clubhouse, two clicks in.
 * It is the number that says how good you are and it is deliberately hard to
 * hold — a bad round pulls it down faster than a good one lifts it — so it
 * belongs in front of you, next to the player who earned it, not filed away
 * under statistics.
 */
HUD.renderCharacter = (prof, name) => {
  const box = document.getElementById('charCard');
  if (!box) return;
  const lvl = prof?.level ?? 1;
  const rating = prof?.rating;
  box.innerHTML =
    `<span class="cc-name"><b>${escapeHtml(name || 'Your golfer')}</b>` +
    `<small>${prof?.rounds ? prof.rounds + (prof.rounds === 1 ? ' round' : ' rounds') : 'no rounds yet'}</small></span>` +
    `<span class="cc-stat"><i>${lvl}</i><span>level</span></span>` +
    `<span class="cc-stat rating"><i>${rating == null ? '—' : Math.round(rating)}</i><span>rating</span></span>`;
};

/**
 * The wardrobe. Takes the level so the earned rows can be drawn at all —
 * decals, trails and titles are the whole point of a hundred levels, and
 * until now they were data with nowhere to equip them from, which is the
 * same as not existing.
 */
HUD.renderLook = (look, onPick, level = 1) => {
  el.lookPicker.innerHTML = '';

  /* Rewards you have NOT earned get one line between them, at the bottom —
     not four empty rows at the top.
     A new player opening this panel was met by "Club decal — first one at
     level 7", "Ball trail — first one at level 9", and two more, before a
     single thing they could actually change. Four rows of no. The ladder
     belongs in the clubhouse, where it is a whole screen and reads as a
     promise; here it should be one sentence and out of the way. */
  const earnedGroups = EARNED_GROUPS.filter(g => unlocksOfKind(level, g.kind).length);
  const pending = EARNED_GROUPS.filter(g => !unlocksOfKind(level, g.kind).length);

  for (const grp of earnedGroups) {
    const owned = unlocksOfKind(level, grp.kind);
    const g = document.createElement('div');
    g.className = 'lookgrp style earned';
    const h = document.createElement('h5'); h.textContent = grp.title;
    const row = document.createElement('div'); row.className = 'lookrow';

    {
      // "None" is always available: an earned cosmetic you cannot take off
      // is a punishment for levelling up
      for (const c of [{ id: null, name: 'None' }, ...owned]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'lookpill' + ((look[grp.key] || null) === c.id ? ' on' : '');
        b.textContent = c.name;
        if (c.color) b.style.setProperty('--pill', c.color);
        b.addEventListener('click', () => onPick(grp.key, c.id));
        row.appendChild(b);
      }
    }
    g.append(h, row);
    el.lookPicker.appendChild(g);
  }

  for (const grp of LOOK_GROUPS) {
    const g = document.createElement('div');
    g.className = 'lookgrp' + (grp.kind === 'style' || grp.kind === 'build' ? ' style' : '');
    const h = document.createElement('h5'); h.textContent = grp.title;

    /* Build is the one choice that gets said out loud. It used to be four
       silhouette names in a row — Straight, Curved, Broad, Slight — and
       players went looking for the word "female", did not find it, and
       decided the game had no women in it. The shapes were always there;
       nobody could find them. Two labelled rows, and they can. */
    if (grp.kind === 'build') {
      g.classList.add('buildgrp');
      g.appendChild(h);
      for (const [sex, label] of [['f', 'Female'], ['m', 'Male']]) {
        const sub = document.createElement('div'); sub.className = 'buildrow';
        const tag = document.createElement('span'); tag.className = 'buildsex';
        tag.textContent = label;
        const row = document.createElement('div'); row.className = 'lookrow';
        for (const c of bodiesOf(sex)) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'lookpill' + (look.body === c.id ? ' on' : '');
          b.textContent = c.name;
          b.setAttribute('aria-label', label + ' ' + c.name + ' build');
          b.addEventListener('click', () => onPick('body', c.id));
          row.appendChild(b);
        }
        sub.append(tag, row);
        g.appendChild(sub);
      }
      el.lookPicker.appendChild(g);
      continue;
    }

    const row = document.createElement('div'); row.className = 'lookrow';
    for (const c of grp.list) {
      const b = document.createElement('button');
      b.type = 'button';
      if (grp.kind === 'style') {
        /* Two hats carry a level (see HAT_STYLES). Shown locked with the
           level on them rather than hidden: a reward you cannot see is not
           a reward, and one that silently reverts to a cap when you pick it
           reads as a bug. */
        const locked = c.at && level < c.at;
        b.className = 'lookpill' + (look[grp.key] === c.id ? ' on' : '')
          + (locked ? ' locked' : '');
        b.textContent = locked ? `${c.name} · ${c.at}` : c.name;
        b.disabled = !!locked;
        if (locked) b.title = `${c.name} unlocks at level ${c.at}`;
        else b.addEventListener('click', () => onPick(grp.key, c.id));
      } else {
        b.className = 'lookbtn' + (look[grp.key] === c.hex ? ' on' : '');
        b.style.background = c.hex;
        b.title = c.name;
        b.setAttribute('aria-label', grp.title + ' ' + c.name);
        b.addEventListener('click', () => onPick(grp.key, c.hex));
      }
      row.appendChild(b);
    }
    g.append(h, row);
    el.lookPicker.appendChild(g);
  }

  if (pending.length) {
    const next = UNLOCKS.find(u => pending.some(p => p.kind === u.kind));
    const p = document.createElement('p');
    p.className = 'tiny lockline';
    p.textContent = next
      ? `${pending.map(g => g.title.toLowerCase()).join(', ')} — the first arrives at level ${next.at}.`
      : '';
    el.lookPicker.appendChild(p);
  }
};

/** The nudge telling you to go and stand by your ball. */
/**
 * The cart panel.  Pass null when the player is on foot.
 * @param c  { seat: 'Driving'|'Riding', mph: number, who: string }
 */
/* The speedometer arc: 12,64 -> 88,64 over the top is a 240-degree sweep of a
   40-unit radius, so the path is 2*pi*40*(240/360) long.  Needle angles run
   -120 to +120 degrees about the hub. */
const DIAL_LEN = 2 * Math.PI * 40 * (240 / 360);

HUD.setCart = c => {
  el.cartbar.classList.toggle('show', !!c);
  if (!c) return;
  el.cartSeat.textContent = c.seat;
  el.cartWho.textContent = c.who;
  el.cartKmh.textContent = String(Math.round(c.kmh));

  const f = clamp(c.kmh / (c.topKmh || 35), 0, 1);
  el.dialFill.style.strokeDasharray = `${(DIAL_LEN * f).toFixed(1)} ${DIAL_LEN.toFixed(1)}`;
  el.dialFill.classList.toggle('fast', f > 0.6 && f <= 0.92);
  el.dialFill.classList.toggle('flat-out', f > 0.92);
  el.dialNeedle.setAttribute('transform', `rotate(${(-120 + 240 * f).toFixed(1)} 50 54)`);

  // the damage light: a warning while it still drives, then a wreck alarm
  const dmg = c.damage || 0;
  el.cartDamage.hidden = dmg <= 0.45;
  el.cartDamage.classList.toggle('critical', dmg >= 0.85);
  if (dmg > 0.45) {
    el.cartDamageTxt.textContent = dmg >= 0.85
      ? 'ENGINE FAILING — get out' : 'Engine damage — take it easy';
  }
};

HUD.setWalkPrompt = (text) => {
  el.walkbar.classList.toggle('show', !!text);
  if (text) el.walkText.textContent = text;
};

/** The link to send someone.  Honours a tunnel or a deployed host as-is. */
HUD.inviteLink = code => location.origin + '/?room=' + code;

/** True when the link only works on this machine. */
HUD.linkIsLocal = () =>
  /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname) ||
  /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);

HUD.renderLobby = (room, myPid) => {
  el.lobbyCode.textContent = room.code;
  el.lobbyLink.value = HUD.inviteLink(room.code);
  el.lobbyPlayers.innerHTML = '';
  el.lobbyCount.textContent = `(${room.players.length}/${room.maxPlayers})`;
  for (const p of room.players) {
    const chip = document.createElement('div');
    chip.className = 'pchip';
    const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = p.color;
    const nm = document.createElement('span'); nm.textContent = p.name + (p.pid === myPid ? ' (you)' : '');
    chip.append(sw, nm);
    if (p.pid === room.hostPid) { const t = document.createElement('span'); t.className = 'tag host'; t.textContent = '★ host'; chip.appendChild(t); }
    el.lobbyPlayers.appendChild(chip);
  }
  // empty seats, so a lone host sees a lobby waiting for friends rather
  // than a finished list
  for (let i = room.players.length; i < Math.min(room.maxPlayers, 4); i++) {
    const seat = document.createElement('div');
    seat.className = 'pchip empty';
    seat.textContent = i === room.players.length ? 'Waiting for a friend…' : 'Open seat';
    el.lobbyPlayers.appendChild(seat);
  }
  const isHost = room.hostPid === myPid;
  const n = room.players.filter(p => p.connected).length;
  el.btnStart.disabled = !isHost || n < 1;
  el.btnStart.textContent = n === 1 ? 'Start (solo practice)' : 'Start round';
  el.shareHint.textContent = HUD.linkIsLocal()
    ? (/^(localhost|127\.|\[::1\])/.test(location.hostname)
        ? 'This link only works on this computer. Run  npm run share  for one anybody can open.'
        : 'This link works for anyone on your wifi. Run  npm run share  for one that works anywhere.')
    : 'Anyone can open this link.';
  el.shareHint.classList.toggle('warn', HUD.linkIsLocal());

  el.lobbyNote.textContent = isHost
    ? (n < 2 ? 'Send the link to a friend, or play the nine on your own.' : 'Everyone in? Play away.')
    : 'Waiting for the host…';
};

/* ------------------------------------------------------- hole-over screen */
HUD.renderHoleOver = (room, myPid, course) => {
  const h = course.holes[room.holeIndex];
  el.hoTitle.textContent = `Hole ${h.number} — ${h.name}`;
  el.hoSub.textContent = `Par ${h.par} · ${h.yards} yds`;
  el.hoTable.innerHTML = '';
  const rows = room.players.filter(p => !p.spectator)
    .map(p => ({ p, s: p.scores[room.holeIndex] ?? h.maxStrokes }))
    .sort((a, b) => a.s - b.s);
  const best = rows.length ? rows[0].s : 0;
  rows.forEach((r, i) => {
    const rel = r.s - h.par;
    const div = document.createElement('div');
    div.className = 'rrow' + (r.s === best ? ' win' : '');
    div.innerHTML = `<span class="pos">${r.s === best ? '🏆' : (i + 1) + '.'}</span>
      <span class="sw" style="background:${r.p.color}"></span>
      <span class="nm">${escapeHtml(r.p.name)}${r.p.pid === myPid ? ' (you)' : ''}</span>
      <span class="st">${r.s}</span>
      <span class="vp ${rel < 0 ? 'under' : rel > 0 ? 'over' : ''}">${scoreName(rel, r.s)}</span>`;
    el.hoTable.appendChild(div);
  });
  /* The record for THIS hole, under the card.  A number to beat is worth more
     on the hole you have just played than buried in a menu — and if the player
     has just taken it, say so here rather than letting a toast carry it. */
  const rec = room.records?.holes?.[room.holeIndex];
  const mine = rows.find(r => r.p.pid === myPid);
  const holder = document.createElement('div');
  holder.className = 'ho-record';
  if (rec) {
    const isMe = rec.pid === myPid && mine && mine.s === rec.strokes;
    holder.innerHTML = isMe
      ? `<b>🏆 Course record</b><span>${rec.strokes} — that is yours</span>`
      : `<b>Course record</b><span>${rec.strokes} by ${escapeHtml(rec.name)}</span>`;
  } else {
    holder.innerHTML = '<b>Course record</b><span>nobody has set one yet</span>';
  }
  el.hoTable.appendChild(holder);

  const isHost = room.hostPid === myPid;
  el.btnNext.disabled = !isHost;
  el.btnNext.textContent = room.holeIndex >= HOLES_PER_COURSE - 1 ? 'See the card' : 'Next hole';
  el.hoNote.textContent = isHost ? 'or wait — it moves on by itself' : 'Waiting for the host…';
};

/**
 * @param strokes  how many it took. Optional, and the reason this exists:
 *   a hole in one is not a name on the par-relative scale, it is its OWN
 *   thing. Called with only `rel` it announced an ace on a par 3 as "Eagle"
 *   and on a par 4 as "Albatross" — technically the right words for the
 *   score, and not what anybody says or wants to see when the ball goes in
 *   from the tee. It is the rarest thing in the game and it was the one
 *   moment the scoreboard would not name.
 */
function scoreName(rel, strokes = null) {
  if (strokes === 1) return 'Hole in one';
  if (rel <= -3) return 'Albatross';
  if (rel === -2) return 'Eagle';
  if (rel === -1) return 'Birdie';
  if (rel === 0) return 'Par';
  if (rel === 1) return 'Bogey';
  if (rel === 2) return 'Double';
  return '+' + rel;
}
HUD.scoreName = scoreName;

/* --------------------------------------------------------- full scorecard */
HUD.renderResults = (room, myPid, course) => {
  const players = room.players.filter(p => !p.spectator);
  const total = p => p.scores.reduce((s, v, i) => s + (v ?? course.holes[i].par + 2), 0);
  const sorted = players.slice().sort((a, b) => total(a) - total(b));
  const best = sorted.length ? total(sorted[0]) : 0;
  const winners = sorted.filter(p => total(p) === best);

  el.resTitle.textContent = course.name + ' — final';
  el.resSub.textContent = winners.length === 0 ? ''
    : winners.length > 1
      ? `Tied on ${best} — ${winners.map(w => w.name).join(' & ')}`
      : `${winners[0].name} wins with ${best} (${relLabel(best - course.par)})`;

  const t = el.fullCard;
  t.innerHTML = '';
  const head = t.insertRow();
  head.innerHTML = '<th class="nm">Player</th>' +
    course.holes.map(h => `<th>${h.number}</th>`).join('') + '<th class="tot">Tot</th><th class="tot">±</th>';
  const parRow = t.insertRow();
  parRow.className = 'parrow';
  parRow.innerHTML = '<td class="nm">Par</td>' +
    course.holes.map(h => `<td>${h.par}</td>`).join('') + `<td class="tot">${course.par}</td><td class="tot"></td>`;

  for (const p of sorted) {
    const tr = t.insertRow();
    const tot = total(p);
    const cells = course.holes.map((h, i) => {
      const v = p.scores[i];
      if (v == null) return '<td>–</td>';
      const rel = v - h.par;
      const cls = rel <= -2 ? 'eagle' : rel === -1 ? 'birdie' : rel === 1 ? 'bogey' : rel >= 2 ? 'dbl' : '';
      return `<td><span class="${cls}">${v}</span></td>`;
    }).join('');
    tr.innerHTML = `<td class="nm"><span class="sw" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${p.color};margin-right:6px"></span>${escapeHtml(p.name)}${p.pid === myPid ? ' (you)' : ''}</td>`
      + cells + `<td class="tot">${tot}</td><td class="tot">${relLabel(tot - course.par)}</td>`;
  }

  const isHost = room.hostPid === myPid;
  el.btnAgain.disabled = !isHost;
  el.btnBackLobby.disabled = !isHost;
  el.resNote.textContent = isHost ? '' : 'Waiting for the host…';
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
HUD.escapeHtml = escapeHtml;

/* ------------------------------------------------------------- emotes --- */
/**
 * The emote wheel.  Everything you have is pickable; everything you have not
 * is shown greyed with the level it needs, because a locked slot you can SEE
 * is a reason to play another round and a hidden one is not.
 */
HUD.renderEmotes = (level, onPick) => {
  if (!el.emoteWheel) return;
  el.emoteWheel.innerHTML = '';
  const lvl = Number(level) || 1;
  for (const e of EMOTES) {
    const locked = lvl < e.at;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'emote' + (locked ? ' locked' : '');
    b.innerHTML = `<span class="em-ico">${e.icon}</span>` +
      `<span class="em-name">${escapeHtml(e.name)}</span>` +
      `<span class="em-sub">${locked ? 'Level ' + e.at : escapeHtml(e.blurb)}</span>`;
    b.disabled = locked;
    if (!locked) b.addEventListener('click', () => onPick(e.id));
    el.emoteWheel.appendChild(b);
  }
};
HUD.showEmotes = on => { if (el.emoteWheel) el.emoteWheel.hidden = !on; };
HUD.emotesOpen = () => el.emoteWheel && !el.emoteWheel.hidden;

/* ------------------------------------------------------ clubhouse tabs --- */
/**
 * Which room of the clubhouse is open. Module-level, exactly like the shop's
 * own tab: every purchase re-renders the whole panel, and a tab that snaps
 * back to Career each time you buy something is worse than having no tabs.
 */
HUD.hkTab = 'career';
HUD.bindClubhouse = () => {
  const bar = document.getElementById('hkTabs');
  if (!bar || bar.dataset.bound) return;
  bar.dataset.bound = '1';
  bar.addEventListener('click', e => {
    const b = e.target.closest('.hktab');
    if (b) HUD.showClubhouseTab(b.dataset.tab);
  });
  /* The bar reveals itself, and the panes are hidden only from here. Until
     this line runs the clubhouse is one scrolling page with everything on
     it — which is a worse layout and a working one. */
  bar.hidden = false;
  document.body.classList.add('hktabbed');
  HUD.showClubhouseTab(HUD.hkTab);
};
HUD.showClubhouseTab = (name) => {
  HUD.hkTab = name;
  for (const b of document.querySelectorAll('.hktab')) {
    const on = b.dataset.tab === name;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  }
  for (const p of document.querySelectorAll('.hkpane')) {
    p.hidden = p.dataset.pane !== name;
  }
  // a tab switch should start you at the top of the room you just walked into
  document.querySelector('#screenShop .card')?.scrollTo?.({ top: 0 });
  /* The two tabs whose contents live on the server rather than in the
     profile the client already holds. Fetched on ARRIVAL rather than on
     open-the-clubhouse, because five ladders and a hundred rows each is not
     something to pull down for somebody who came to buy a putter. */
  if (name === 'ranks') HUD.onBoards?.(null);
  if (name === 'world') HUD.onWorldTab?.();
  if (name === 'rewards') HUD.bindLevelTrack?.();
  /* The turntable starts on the first thing in the list rather than empty —
     an empty stage next to a full list reads as broken, not as waiting. */
  if (name === 'shop') {
    const first = document.querySelector('#shopList [data-view]');
    if (first) { try { HUD.previewShopItem(JSON.parse(first.dataset.view)); } catch {} }
  }
};

/* ------------------------------------------------------------- the world --- */
/**
 * The ranking: the top of the game, and where you sit in it.
 *
 * A rating only means something if it is hard to hold — a bad round pulls
 * you down faster than a good one lifts you — so this is the one screen that
 * says what all that difficulty was for. Your own row is pinned even when
 * you are nowhere near the top, because "412th of 3,700" is a position and a
 * blank screen is not.
 */
HUD.renderWorld = (data, myPid) => {
  const box = document.getElementById('worldBox');
  if (!box) return;
  const top = data?.top || [];
  const me = data?.me || null;

  let head = '';
  if (me && me.ranked) {
    head = `<div class="wr-me"><span class="wr-rank">#${me.rank}</span>` +
      `<span class="wr-of">of ${me.of.toLocaleString()} ranked golfers</span>` +
      `<span class="wr-rate">${me.rating}</span></div>`;
  } else if (me) {
    head = `<div class="wr-me unranked"><b>${me.need} more ` +
      `${me.need === 1 ? 'round' : 'rounds'}</b>` +
      `<span class="wr-of">and you are on the board</span></div>`;
  }

  if (!top.length) {
    box.innerHTML = head + '<p class="tiny">Nobody has played enough rounds to ' +
      'be ranked yet. Five is all it takes.</p>';
    return;
  }
  const rows = top.map(r => {
    const mine = r.pid === myPid;
    const rel = r.best == null ? '—'
      : (r.best === 0 ? 'E' : r.best > 0 ? '+' + r.best : String(r.best));
    return `<li class="wr${mine ? ' mine' : ''}">` +
      `<span class="wr-n">${r.rank}</span>` +
      `<span class="wr-name">${escapeHtml(r.name)}${mine ? '<em>you</em>' : ''}</span>` +
      `<span class="wr-lvl">LV ${r.level}</span>` +
      `<span class="wr-best" title="best round">${escapeHtml(rel)}</span>` +
      `<span class="wr-rate">${r.rating}</span></li>`;
  }).join('');
  box.innerHTML = head + `<ol class="wrlist">${rows}</ol>`;
};

/* --------------------------------------------------------- the room list --- */
/**
 * Every open game, with what it is and who is in it.
 *
 * Rooms about to start come first and rooms mid-round are marked, because
 * joining one of those means watching until the next hole — which is fine,
 * and is not what somebody clicking a list expects unless it says so.
 */
HUD.renderRooms = (rooms, onJoin) => {
  const box = document.getElementById('roomList');
  if (!box) return;
  if (!rooms.length) {
    box.innerHTML = '<p class="tiny">No open games right now — ' +
      '"Find a game" will start one.</p>';
    return;
  }
  box.textContent = '';
  for (const r of rooms.slice(0, 12)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'roomrow' + (r.starting ? '' : ' mid');
    b.innerHTML =
      `<span class="rm-main"><b>${escapeHtml(r.course)}</b>` +
      `<small>${escapeHtml(r.formatName)} · ${escapeHtml(r.where)}</small></span>` +
      `<span class="rm-who">${r.players}/${r.max}` +
      (r.topRating ? `<em title="best rating in the room">${r.topRating}</em>` : '') +
      `</span>` +
      `<span class="rm-state">${r.starting ? 'starting' : 'hole ' + r.hole}</span>`;
    b.addEventListener('click', () => onJoin(r.code));
    box.appendChild(b);
  }
};

/* --------------------------------------------------------------- binds --- */
/**
 * The controls panel: every action, its keys, and a click-then-press rebind.
 *
 * Deliberately not a modal. A player rebinding controls is comparing several
 * of them against each other — "if run is here, jog-to-ball wants to be
 * there" — and a dialog that shows one action at a time makes that
 * impossible. The whole scheme is on screen and you edit it in place.
 */
let listening = null;             // { id, slot } while waiting for a key
HUD.renderBinds = () => {
  const box = document.getElementById('bindList');
  if (!box) return;
  box.textContent = '';

  let group = null;
  for (const a of ACTIONS) {
    if (a.group !== group) {
      group = a.group;
      const h = document.createElement('h5');
      h.className = 'bindgroup'; h.textContent = group;
      box.appendChild(h);
    }
    const row = document.createElement('div');
    row.className = 'bindrow';
    const nm = document.createElement('span');
    nm.className = 'bind-name'; nm.textContent = a.name;
    row.appendChild(nm);

    const keys = keysFor(a.id);
    // always offer one empty slot, so a second binding can be added
    const slots = Math.min(3, keys.length + 1);
    for (let i = 0; i < slots; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      const live = listening && listening.id === a.id && listening.slot === i;
      b.className = 'bindkey' + (live ? ' listening' : '') + (keys[i] ? '' : ' empty');
      b.textContent = live ? 'press a key…' : (keys[i] ? keyLabel(keys[i]) : '+');
      b.addEventListener('click', () => {
        listening = live ? null : { id: a.id, slot: i };
        HUD.renderBinds();
      });
      row.appendChild(b);
    }
    box.appendChild(row);
  }
};

/**
 * Take a keypress while the panel is listening.
 * @returns true if it was consumed, so the caller knows not to act on it
 */
HUD.bindsCapture = (ev) => {
  if (!listening) return false;
  const k = String(ev.key).toLowerCase();
  ev.preventDefault();
  if (k === 'escape') { listening = null; HUD.renderBinds(); return true; }
  if (RESERVED.has(k)) {
    HUD.toast(`${keyLabel(k)} belongs to the browser — pick another.`, 'warn', 2200);
    return true;
  }
  const stolen = bindKey(listening.id, k, listening.slot);
  if (stolen) {
    const from = ACTIONS.find(a => a.id === stolen);
    HUD.toast(`${keyLabel(k)} taken off "${from ? from.name : stolen}".`, 'info', 2400);
  }
  listening = null;
  HUD.renderBinds();
  return true;
};
HUD.bindsListening = () => !!listening;

/* ---------------------------------------------------------- the ladder --- */
/**
 * Every reward in the game, earned and unearned, in the order they arrive.
 *
 * Showing the LOCKED ones is the whole point. The career panel said "8 of 31
 * unlocked" and named the next one, which tells a player the ladder exists
 * without ever showing it to them — and a ladder you cannot see the top of
 * is not a reason to keep playing.
 */
/* ═══════════════════════════════════════════════ THE LEVEL TRACK ════════
   A hundred levels as a horizontal line you scroll along, rather than a
   vertical list of a hundred rows.

   The list answered "what have I got". The question people actually have is
   "what am I working towards", and a list is the wrong shape for it: your
   position in it is a scroll offset, the next reward is wherever your eye
   lands, and the distance between here and level 100 is not visible at all.

   A track shows all three at once. Where you are is a marker on a line, what
   is next is the node to the right of it, and how far there is to go is the
   length of the line. It opens scrolled to YOUR position rather than to
   level 1, because the interesting part of a hundred-level ladder is
   wherever you happen to be standing on it.
*/
HUD.renderRewards = (prof) => {
  const box = document.getElementById('rewardBox');
  if (!box) return;
  const level = prof?.level ?? 1;
  HUD.myLevel = level;
  const xp = prof?.xp ?? 0;
  const owned = UNLOCKS.filter(u => u.at <= level).length;
  const tier = rTier(level);

  /* One node per level that gives something, plus the five tier boundaries
     — a track with a hundred identical ticks on it is a ruler, not a
     progression. */
  const stops = new Map();
  for (const u of UNLOCKS) {
    if (!stops.has(u.at)) stops.set(u.at, { at: u.at, items: [] });
    stops.get(u.at).items.push(u);
  }
  for (const t of RANK_TIERS) {
    if (!stops.has(t.from)) stops.set(t.from, { at: t.from, items: [] });
    stops.get(t.from).tier = t;
  }
  const list = [...stops.values()].sort((a, b) => a.at - b.at);
  const maxAt = Math.max(100, list[list.length - 1].at);

  const nodes = list.map(s => {
    const got = s.at <= level;
    const here = s.at === level;
    const t = rTier(s.at);
    const label = s.items.length
      ? s.items.map(u => escapeHtml(u.name)).join(' · ')
      : (s.tier ? s.tier.name : '');
    const swatch = s.items.find(u => u.color)?.color || t.color;
    return `<button class="lv-node${got ? ' got' : ''}${here ? ' here' : ''}"
        data-lv="${s.at}" style="--c:${swatch}"
        title="Level ${s.at} — ${label}">
      <span class="lv-dot"></span>
      <span class="lv-n">${s.at}</span>
      <span class="lv-what">${label ? escapeHtml(label.slice(0, 22)) : ''}</span>
    </button>`;
  }).join('');

  const pct = Math.min(100, (level / maxAt) * 100);
  box.innerHTML =
    `<div class="lv-top">
       <div class="lv-me" style="--c:${tier.color}">
         <span class="lv-badge">${tier.badge}</span>
         <span><b>Level ${level}</b><small>${tier.name} · ${owned} of ${UNLOCKS.length} unlocked</small></span>
       </div>
       <div class="lv-xp"><b>${xp.toLocaleString()}</b><em>XP</em></div>
     </div>
     <div class="lv-track" id="lvTrack">
       <div class="lv-rail"><i style="width:${pct}%"></i></div>
       <div class="lv-nodes">${nodes}</div>
     </div>
     <div class="lv-preview" id="lvPreview"></div>
     <p class="tiny">Levels buy identity, never distance — nothing on this
       track makes the ball go further.</p>`;

  /* Open on YOUR level rather than on level 1. A hundred-level track that
     starts at the far left shows a new player nothing they can reach and a
     level-70 player nothing they have not already got. */
  /* setTimeout, not requestAnimationFrame. rAF does not run in a
     backgrounded tab, and a track that opens on level 1 for a level-70
     player because they alt-tabbed while it rendered is a track that
     silently forgot the one thing it is for. */
  setTimeout(() => {
    const track = document.getElementById('lvTrack');
    const here = track?.querySelector('.lv-node.here') || track?.querySelector('.lv-node:not(.got)');
    if (track && here) track.scrollLeft = here.offsetLeft - track.clientWidth / 2 + here.offsetWidth / 2;
  });
  HUD.showLevelPreview(level, level);
};

/** What one level on the track gives you, under the track. */
HUD.showLevelPreview = (at, myLevel) => {
  const box = document.getElementById('lvPreview');
  if (!box) return;
  const items = UNLOCKS.filter(u => u.at === at);
  const t = rTier(at);
  const mile = MILESTONES.find(m => m.at === at);
  const got = at <= myLevel;
  box.className = 'lv-preview' + (got ? ' got' : '');
  box.innerHTML =
    `<div class="lv-pv-head" style="--c:${t.color}">
       <span class="lv-pv-badge">${t.badge}</span>
       <span><b>Level ${at}</b><small>${t.name}${got ? ' · earned' : ' · locked'}</small></span>
     </div>` +
    (mile ? `<p class="lv-pv-mile"><b>${escapeHtml(mile.name)}</b> — ${escapeHtml(mile.gives)}</p>` : '') +
    (items.length
      ? `<div class="lv-pv-items">${items.map(u => {
          const kind = UNLOCK_KINDS[u.kind] || { name: u.kind };
          return `<div class="lv-pv-item">
            <span class="lv-pv-sw" style="background:${u.color || 'transparent'};
              ${u.color ? '' : 'border-style:dashed'}"></span>
            <span><b>${escapeHtml(u.name)}</b><small>${escapeHtml(kind.name)}</small></span>
          </div>`;
        }).join('')}</div>`
      : `<p class="tiny">A rank, rather than an item — ${escapeHtml(t.ranks)}.</p>`);
};

let lvBound = false;
HUD.bindLevelTrack = () => {
  if (lvBound) return;
  lvBound = true;
  document.getElementById('rewardBox')?.addEventListener('click', e => {
    const b = e.target.closest('[data-lv]');
    if (b) HUD.showLevelPreview(Number(b.dataset.lv), HUD.myLevel ?? 1);
  });
};


/* ------------------------------------------------------------ records --- */
/**
 * The course record board.  Every course is listed whether or not it has a
 * record yet, because an empty row reads as an invitation and a missing row
 * reads as a course that does not exist.
 */
HUD.recOpen = null;              // which course's hole board is expanded
HUD.renderRecords = (courses, records, myPid) => {
  const box = el.recordBox;
  if (!box) return;
  box.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'recboard';
  for (const c of courses) {
    const entry = records?.[c.id] || null;
    // the board is either the old {round} shape or the full {round, holes}
    const r = entry && entry.round !== undefined ? entry.round : entry;
    const holes = entry && entry.holes ? entry.holes : null;
    const open = HUD.recOpen === c.id;

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'recrow' + (r ? (r.pid === myPid ? ' mine' : '') : ' empty')
      + (open ? ' open' : '');
    const rel = r ? r.total - r.par : 0;
    row.innerHTML =
      `<span class="rc-course">${escapeHtml(c.name)}</span>` +
      `<span class="rc-score">${r ? r.total + (rel === 0 ? ' (E)' : rel > 0 ? ` (+${rel})` : ` (${rel})`) : '—'}</span>` +
      `<span class="rc-who">${r ? escapeHtml(r.pid === myPid ? 'you' : r.name) : 'unclaimed'}</span>` +
      `<span class="rc-caret">${open ? '▾' : '▸'}</span>`;
    /* Clicking a course opens its hole-by-hole board. The best score on each
       individual hole is the part of this board an ordinary player can
       realistically get their name on — the full-round record belongs to
       whoever is best at the whole game, but anybody can hole a 2. */
    row.addEventListener('click', () => {
      HUD.recOpen = open ? null : c.id;
      HUD.renderRecords(courses, records, myPid);
    });
    wrap.appendChild(row);

    if (open) {
      const panel = document.createElement('div');
      panel.className = 'recholes';
      if (!holes || !holes.some(Boolean)) {
        panel.innerHTML = '<span class="tiny">No hole records here yet — ' +
          'finish a round and every one of them is yours to take.</span>';
      } else {
        panel.innerHTML = holes.map((h, i) => {
          if (!h) return `<span class="rh empty"><i>${i + 1}</i><b>—</b></span>`;
          const mine = h.pid === myPid;
          return `<span class="rh${mine ? ' mine' : ''}"><i>${i + 1}</i>` +
            `<b>${h.strokes}</b><em>${escapeHtml(mine ? 'you' : h.name)}</em></span>`;
        }).join('');
      }
      wrap.appendChild(panel);
    }
  }
  box.appendChild(wrap);
};

/* ------------------------------------------------------------ presence --- */
/**
 * Who is on the course right now.  Hidden entirely when nobody else is on,
 * because an empty "0 players online" box on a new game is worse than no box.
 */
HUD.renderOnline = (list, myPid, onJoin) => {
  const box = el.onlineNow;
  const others = (list || []).filter(o => o.pid !== myPid);

  /* The landing page's one line of live data. It says something true either
     way — "eight courses, nine holes each" is not a placeholder, it is the
     thing a visitor wants to know when nobody happens to be on. What it must
     never say is "0 golfers online", which is the one fact that makes a
     multiplayer game look abandoned. */
  if (el.lpLive) {
    el.lpLive.textContent = others.length
      ? `${others.length} ${others.length === 1 ? 'golfer is' : 'golfers are'} on the course right now`
      : `${COURSE_ORDER.length} courses · nine holes each · play solo or with up to eight`;
  }

  if (!box) return;
  if (!others.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;

  const joinable = others.filter(o => o.joinable);
  box.innerHTML = `<div class="on-head"><span class="on-dot"></span>` +
    `<b>${others.length} ${others.length === 1 ? 'golfer' : 'golfers'} on the course</b></div>`;
  const rows = document.createElement('div');
  rows.className = 'on-list';
  for (const o of others.slice(0, 6)) {
    const row = document.createElement('div');
    row.className = 'on-row';
    /* Rating first, because it is the only number on this panel that tells
       you anything about the golf. A best round is shown when they have one
       — "-3" beside a name is an invitation and a warning at the same time. */
    const rel = o.best == null ? null
      : (o.best === 0 ? 'E' : o.best > 0 ? '+' + o.best : String(o.best));
    row.innerHTML =
      (o.rating != null ? `<span class="on-rate" title="skill rating">${o.rating}</span>` : '') +
      (o.badge ? `<span class="on-badge" title="holds course records">` +
        (o.badge.courses ? '🏆' + (o.badge.courses > 1 ? o.badge.courses : '') : '') +
        (o.badge.holes ? '⛳' + (o.badge.holes > 1 ? o.badge.holes : '') : '') + `</span>` : '') +
      `<span class="on-name">${escapeHtml(o.name)}` +
      (rel ? `<em title="their best round">best ${escapeHtml(rel)}</em>` : '') +
      `</span>` +
      `<span class="on-doing">${escapeHtml(o.doing)}</span>`;
    if (o.joinable) {
      const b = document.createElement('button');
      b.className = 'on-join'; b.type = 'button'; b.textContent = 'Join';
      b.addEventListener('click', () => onJoin(o.code));
      row.appendChild(b);
    } else if (o.watchable) {
      /* WATCHING WAS ALWAYS POSSIBLE. The server has seated late arrivals as
         spectators since rooms existed — there was simply no button, so the
         panel said "on the 4th" and offered nothing, and the answer to "can
         I watch my friend play" was no for a feature that worked. */
      const b = document.createElement('button');
      b.className = 'on-join watch'; b.type = 'button'; b.textContent = 'Watch';
      b.title = 'Join as a spectator — you play from the next hole';
      b.addEventListener('click', () => onJoin(o.code, true));
      row.appendChild(b);
    }
    rows.appendChild(row);
  }
  box.appendChild(rows);
  if (joinable.length === 0 && !others.some(o => o.watchable)) {
    const note = document.createElement('p');
    note.className = 'on-note';
    note.textContent = 'All mid-round — start your own and invite them.';
    box.appendChild(note);
  }
};

/* -------------------------------------------------------------- chat ----- */
/* Muting is per player, for this session, held on the CLIENT. That is the
   right place for it: it is a decision about what I want to see, it needs no
   server round trip, and it works instantly even if the person muted is
   mid-sentence. */
const muted = new Set();
HUD.isMuted = pid => muted.has(pid);
HUD.toggleMute = pid => { muted.has(pid) ? muted.delete(pid) : muted.add(pid); };

const MAX_LOG = 6;
HUD.chatMessage = (m, myPid) => {
  if (!el.chatLog || !m) return;
  if (muted.has(m.pid) && m.pid !== myPid) return;

  const div = document.createElement('div');
  div.className = 'chatmsg';
  /* escapeHtml on BOTH the name and the text. The server filters words, but
     escaping is what stops markup, and a chat box is the most obvious XSS
     surface in the game — the name is player-supplied too. */
  div.innerHTML = `<b style="color:${/^#[0-9a-f]{6}$/i.test(m.color || '') ? m.color : '#8fe07a'}">` +
    `${escapeHtml(m.name)}</b>${escapeHtml(m.text)}`;
  if (m.pid !== myPid) {
    const mute = document.createElement('span');
    mute.className = 'chatmute'; mute.textContent = '🔇'; mute.title = 'Mute ' + m.name;
    mute.addEventListener('click', () => {
      HUD.toggleMute(m.pid);
      HUD.toast(HUD.isMuted(m.pid) ? `Muted ${m.name}` : `Unmuted ${m.name}`, 'info', 1800);
      div.remove();
    });
    div.appendChild(mute);
  }
  el.chatLog.appendChild(div);
  while (el.chatLog.children.length > MAX_LOG) el.chatLog.firstChild.remove();

  // messages fade out on their own; a permanent log would cover the course
  setTimeout(() => { div.classList.add('fading'); setTimeout(() => div.remove(), 700); }, 11000);
};

HUD.renderPhrases = (phrases, onSay) => {
  if (!el.phraseBar) return;
  el.phraseBar.innerHTML = '';
  for (const p of phrases) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'phrasebtn'; b.textContent = p.text;
    b.addEventListener('click', () => onSay(p.id));
    el.phraseBar.appendChild(b);
  }
};

HUD.chatOpen = () => el.chatInput && !el.chatInput.hidden;
HUD.showChat = on => {
  if (!el.chatInput) return;
  el.chatInput.hidden = !on;
  if (on) { el.chatText.value = ''; el.chatText.focus(); }
  else el.chatText.blur();
};
HUD.chatValue = () => el.chatText?.value || '';
HUD.showChatPanel = on => { if (el.chatPanel) el.chatPanel.style.display = on ? '' : 'none'; };

/* ═══════════════════════════════════════════════════ THE WARDROBE ═══════
   Rendering only. Every control reports a PATCH — `{fabric:'tech'}` — and
   main.js decides what to do with it, which is what keeps this file free of
   any knowledge of the avatar, the scene or the profile.

   The one rule the whole panel is built around: nothing unearned is hidden.
   A locked outfit is shown greyed with the level on it, because a wardrobe
   whose locked half is invisible is a wardrobe that never gives anybody a
   reason to play another round. */
import {
  PATTERNS, FABRICS, CUTS, SHOE_TYPES, GLOVES, WATCHES, SLEEVES, NECKWEAR,
  OUTFITS, OUTFIT_CATS, DECALS, DECAL_CATS, DECAL_SLOTS, CUSTOM_SHAPES,
  outfitStats, spinWord, outfitById
} from '../shared/wardrobe.js';
import { decalTexture } from './decals.js';
import { showItem as showShopItem } from './shopview.js';
import { CLUB_SKINS, skinEarned, skinRequirement, skinProgress } from '../shared/clubskins.js';
import { DIFFICULTIES } from '../shared/difficulty.js';
import { weatherEffects, clockText } from '../shared/weather.js';

/** Set by main.js. Receives a partial look. */
HUD.onWardrobe = () => {};
HUD.wdCat = 'tour';
HUD.wdDetail = false;      // the piece-by-piece panel starts closed
HUD.wdTab = 'garment';

const lock = (it, level) => !!(it.at && level < it.at);

/** One row of choices. `list` items need `id` and `name`. */
function optRow(title, list, current, level, kind) {
  const opts = list.map(it => {
    const L = lock(it, level);
    return `<button class="wd-opt${it.id === current ? ' on' : ''}${L ? ' locked' : ''}"
      data-kind="${kind}" data-val="${it.id}"${L ? ' disabled' : ''}>${it.name}` +
      (L ? `<span class="lv">Lv ${it.at}</span>` : '') + `</button>`;
  }).join('');
  return `<div class="wd-grp"><h5>${title}</h5><div class="wd-opts">${opts}</div></div>`;
}

/** One row of colour swatches. */
function colRow(title, list, current, kind) {
  const sw = list.map(c =>
    `<button class="wd-col${c.hex === current ? ' on' : ''}" data-kind="${kind}"
      data-val="${c.hex}" style="background:${c.hex}" title="${c.name}"></button>`).join('');
  return `<div class="wd-grp"><h5>${title}</h5><div class="wd-cols">${sw}</div></div>`;
}

/* The stats bar on its own. It is separate because the monogram field
   updates the badge on every keystroke, and re-rendering the panel that
   contains the field a player is typing in sends the caret to the end of the
   value — which makes the field unusable. */
HUD.renderWardrobeStats = look => {
  if (!el.wdStats) return;
  const st = outfitStats(look);
  const pct = v => (v > 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
  const cls = v => (v > 0.0005 ? 'up' : v < -0.0005 ? 'down' : 'flat');
  /* Four numbers was three too many for a screen whose job is "does this
     look good". Drive is the one that changes the golf and style is the one
     that answers the question; accuracy and spin are on the detail panel,
     where somebody who cares about them already is. */
  el.wdStats.innerHTML =
    `<div class="wd-stat"><em>Drive</em><b class="${cls(st.drive)}">${pct(st.drive)}</b></div>` +
    `<div class="wd-stat"><em>Style</em><b class="up">${st.style.toFixed(1)}<small>/10</small></b>` +
      `<div class="wd-styleb"><i style="width:${st.style * 10}%"></i></div></div>` +
    (HUD.wdDetail
      ? `<div class="wd-stat"><em>Accuracy</em><b class="${cls(st.accuracy)}">${pct(st.accuracy)}</b></div>` +
        `<div class="wd-stat"><em>Spin</em><b class="${cls(st.spin)}">${spinWord(st.spin)}</b></div>`
      : '');
  el.wdStats.classList.toggle('four', !!HUD.wdDetail);
};

HUD.renderWardrobe = (look, level, name) => {
  if (!el.screenWardrobe) return;
  const lv = Number(level) || 1;

  /* ---- who this is, and what the outfit does ------------------------- */
  el.wdName.textContent = name || 'Your golfer';
  const fit = outfitById(look.outfit);
  el.wdFit.textContent = fit
    ? `${fit.name} · ${(OUTFIT_CATS.find(c => c.id === fit.cat) || {}).name || ''}`
    : 'Your own combination';

  HUD.renderWardrobeStats(look);

  /* ---- outfits, by category ------------------------------------------ */
  el.wdCats.innerHTML = OUTFIT_CATS.map(c =>
    `<button class="wd-cat${c.id === HUD.wdCat ? ' on' : ''}" data-cat="${c.id}">${c.name}</button>`
  ).join('');

  const cat = OUTFIT_CATS.find(c => c.id === HUD.wdCat) || OUTFIT_CATS[0];
  el.wdFits.innerHTML = OUTFITS
    .filter(o => o.cat === HUD.wdCat)
    .map(o => {
      const L = o.at > lv;
      return `<button class="wd-fit${o.id === look.outfit ? ' on' : ''}${L ? ' locked' : ''}"
        data-fit="${o.id}"${L ? ' disabled' : ''}>
        <span class="wd-sw"><i style="background:${o.o.shirt}"></i><i style="background:${o.o.trousers}"></i></span>
        <span><b>${o.name}</b><small>${L ? `Unlocks at level ${o.at}` : (o.o.fabric || '') + (o.o.cut ? ' · ' + o.o.cut : '')}</small></span>
      </button>`;
    }).join('');

  /* ---- the pieces ----------------------------------------------------- */
  const right = document.getElementById('wdRight');
  if (right) right.hidden = !HUD.wdDetail;
  if (!HUD.wdDetail) return;             // nothing below this is on screen
  el.wdRTabs.querySelectorAll('.wd-rtab').forEach(b =>
    b.classList.toggle('on', b.dataset.rt === HUD.wdTab));

  if (HUD.wdTab === 'garment') {
    el.wdRBody.innerHTML =
      colRow('Shirt', SHIRTS, look.shirt, 'shirt') +
      optRow('Pattern', PATTERNS, look.pattern, lv, 'pattern') +
      colRow('Second colour', SHIRTS, look.shirt2, 'shirt2') +
      optRow('Fabric', FABRICS, look.fabric, lv, 'fabric') +
      colRow('Trousers', TROUSERS, look.trousers, 'trousers') +
      optRow('Cut', CUTS, look.cut, lv, 'cut') +
      colRow('Shoes', SHOES, look.shoes, 'shoes') +
      optRow('Shoe type', SHOE_TYPES, look.shoeType, lv, 'shoeType');
  } else if (HUD.wdTab === 'extras') {
    el.wdRBody.innerHTML =
      optRow('Glove', GLOVES, look.glove, lv, 'glove') +
      optRow('Watch', WATCHES, look.watch, lv, 'watch') +
      optRow('Arm sleeves', SLEEVES, look.sleeve, lv, 'sleeve') +
      optRow('Neck', NECKWEAR, look.neck, lv, 'neck') +
      colRow('Cap colour', CAPS, look.cap, 'cap');
  } else {
    HUD.renderDecalTab(look, lv);
  }
};

/* The decal tab is its own function because it draws: every badge in the
   grid is the REAL generated texture on a small canvas, not an icon that
   approximates it. A picker that shows something other than what you get is
   the single most annoying thing a customisation screen can do. */
HUD.wdSlot = 'chest';
HUD.wdDecalCat = 'brand';

HUD.renderDecalTab = (look, lv) => {
  const slots = DECAL_SLOTS.map(sl => {
    const L = lock(sl, lv);
    const on = look.decals?.[sl.id];
    const d = on ? DECALS.find(x => x.id === on) : null;
    return `<button class="wd-slot${sl.id === HUD.wdSlot ? ' on' : ''}${L ? ' locked' : ''}"
      data-slot="${sl.id}"${L ? ' disabled' : ''}>${sl.name}
      <em>${L ? `Level ${sl.at}` : (d ? d.name : 'empty')}</em></button>`;
  }).join('');

  const cats = DECAL_CATS.map(c =>
    `<button class="wd-opt${c.id === HUD.wdDecalCat ? ' on' : ''}" data-dcat="${c.id}">${c.name}</button>`
  ).join('');

  const cur = look.decals?.[HUD.wdSlot] || null;
  const list = DECALS.filter(d => d.cat === HUD.wdDecalCat);
  const cells = `<button class="wd-decal${cur ? '' : ' on'}" data-decal="">
      <span class="lk">none</span></button>` +
    list.map(d => {
      const L = lock(d, lv);
      return `<button class="wd-decal${d.id === cur ? ' on' : ''}${L ? ' locked' : ''}"
        data-decal="${d.id}" title="${d.name}${L ? ` — level ${d.at}` : ''}"${L ? ' disabled' : ''}>
        ${L ? `<span class="lk">🔒${d.at}</span>` : ''}</button>`;
    }).join('');

  el.wdRBody.innerHTML =
    `<div class="wd-grp"><h5>Where</h5><div class="wd-slots">${slots}</div></div>` +
    `<div class="wd-grp"><h5>Kind</h5><div class="wd-opts">${cats}</div></div>` +
    `<div class="wd-grp"><h5>Badge</h5><div class="wd-decals">${cells}</div></div>` +
    (HUD.wdDecalCat === 'custom' ? customEditor(look) : '');

  /* Paint the real texture into each unlocked cell. Done after the innerHTML
     rather than as data: URLs inside it, because these are already-built
     canvases and re-encoding thirty of them to base64 on every re-render is
     work for nothing. */
  el.wdRBody.querySelectorAll('.wd-decal[data-decal]').forEach(btn => {
    const id = btn.dataset.decal;
    if (!id || btn.classList.contains('locked')) return;
    const tex = decalTexture(id, look.custom);
    if (!tex?.image) return;
    const c = document.createElement('canvas');
    c.width = c.height = 56;
    const g = c.getContext('2d');
    g.drawImage(tex.image, 0, 0, 56, 56);
    btn.appendChild(c);
  });
};

function customEditor(look) {
  const cu = look.custom || {};
  const shapes = CUSTOM_SHAPES.map(s =>
    `<button class="wd-opt${s.id === cu.shape ? ' on' : ''}" data-cshape="${s.id}">${s.name}</button>`).join('');
  const cols = a => SHIRTS.map(c =>
    `<button class="wd-col${c.hex === cu[a] ? ' on' : ''}" data-c${a}="${c.hex}"
      style="background:${c.hex}" title="${c.name}"></button>`).join('');
  return `<div class="wd-grp"><h5>Your design</h5><div class="wd-custom">
    <div class="wd-opts">${shapes}</div>
    <div class="wd-cols">${cols('a')}</div>
    <div class="wd-cols">${cols('b')}</div>
    <input type="text" id="wdInitials" maxlength="3" placeholder="ABC" value="${cu.txt || ''}"
      autocomplete="off" spellcheck="false">
    <p class="tiny">Up to three letters or numbers. Everyone in your round sees it.</p>
  </div></div>`;
}

/** One delegated listener for the whole screen. */
let wardrobeBound = false;
HUD.bindWardrobe = () => {
  if (wardrobeBound) return;
  wardrobeBound = true;

  el.screenWardrobe.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t || t.disabled) return;

    if (t.dataset.cat) { HUD.wdCat = t.dataset.cat; HUD.onWardrobe({}); return; }
    if (t.dataset.rt) { HUD.wdTab = t.dataset.rt; HUD.onWardrobe({}); return; }
    if (t.dataset.fit) { HUD.onWardrobe({ __outfit: t.dataset.fit }); return; }
    if (t.dataset.kind) { HUD.onWardrobe({ [t.dataset.kind]: t.dataset.val }); return; }
    if (t.dataset.slot) { HUD.wdSlot = t.dataset.slot; HUD.onWardrobe({}); return; }
    if (t.dataset.dcat) { HUD.wdDecalCat = t.dataset.dcat; HUD.onWardrobe({}); return; }
    if (t.dataset.cshape) { HUD.onWardrobe({ __custom: { shape: t.dataset.cshape } }); return; }
    if (t.dataset.ca) { HUD.onWardrobe({ __custom: { a: t.dataset.ca } }); return; }
    if (t.dataset.cb) { HUD.onWardrobe({ __custom: { b: t.dataset.cb } }); return; }
    if (t.hasAttribute('data-decal')) {
      HUD.onWardrobe({ __decal: { slot: HUD.wdSlot, id: t.dataset.decal || null } });
    }
  });

  /* The monogram field. `input` rather than `change` so the badge updates as
     you type — the whole screen is a live preview and one control that waits
     for a blur would feel broken next to the rest. */
  el.screenWardrobe.addEventListener('input', e => {
    if (e.target.id !== 'wdInitials') return;
    HUD.onWardrobe({ __custom: { txt: e.target.value }, __keepFocus: true });
  });
};

/* ═══════════════════════════════════════════════════ THE RANKINGS ═══════
   Five ladders behind one set of tabs, and your own standing above all of
   them — a leaderboard whose first job is to show you other people is a
   leaderboard nobody scrolls past the first screen of. */
import {
  RANK_TIERS, rankTier, handicapText, handicapBand, topPercent,
  RATING_TIERS, ratingTier, nextMilestone, MILESTONES
} from '../shared/handicap.js';

HUD.rkBoard = 'handicap';
HUD.rkCourse = null;
HUD.onBoards = () => {};

/** Your handicap, your tier, your place. The header above every board. */
HUD.renderRankMe = (profile, me, name) => {
  const box = document.getElementById('rankMe');
  if (!box) return;
  const lv = profile?.level ?? 1;
  const t = rankTier(lv);
  const idx = profile?.index ?? null;
  const place = me?.handicap?.place ?? null;
  const of = me?.handicap?.of ?? 0;
  const pct = topPercent(place, of);
  const next = nextMilestone(lv);

  /* The five-band ladder, lit as far as this level reaches. It is the one
     piece here that shows a player where they are GOING rather than where
     they are, which is the whole reason a tier system exists. */
  const bands = RANK_TIERS.map(b => {
    const done = lv >= b.to, into = lv >= b.from && lv <= b.to;
    const fill = done ? 1 : into ? (lv - b.from + 1) / (b.to - b.from + 1) : 0;
    return `<i style="background:linear-gradient(90deg,${b.color} ${fill * 100}%,rgba(255,255,255,.12) ${fill * 100}%)"></i>`;
  }).join('');

  box.className = 'rkme';
  box.innerHTML =
    `<div class="rkme-badge" style="background:${t.glow};color:${t.color}">${t.badge}</div>
     <div class="rkme-mid">
       <b>${name || 'Your golfer'} <span style="color:${t.color}">· ${t.name}</span></b>
       <span>Level ${lv} · ${t.ranks}</span>
       <div class="rktier">${bands}</div>
       ${place ? `<div class="rkme-place">Handicap rank <i>#${place.toLocaleString()}</i> of ${of.toLocaleString()}${pct ? ` · ${pct}` : ''}</div>`
                : `<div class="rkme-place">${next ? `Next: ${next.name} at level ${next.at} — ${next.gives}` : 'Hall of Fame'}</div>`}
     </div>
     <div class="rkme-hcp"><b>${handicapText(idx)}</b><em>handicap</em>
       <div class="rksub" style="max-width:150px">${handicapBand(idx)}</div></div>`;
};

/** One board. Every row shape is different, so each gets its own formatter. */
HUD.renderBoards = (data, myPid, courseNames) => {
  const body = document.getElementById('rankBody');
  const tabs = document.getElementById('rkbTabs');
  if (!body) return;
  tabs?.querySelectorAll('.rkbtab').forEach(b =>
    b.classList.toggle('on', b.dataset.board === HUD.rkBoard));

  /* A friend's row is marked twice: a star before the name and a tinted
     background. One or the other alone is too easy to miss in a hundred
     rows, which is the whole point of the feature — finding the two people
     you know in a list of strangers. */
  const row = (r, main, sub, tag) =>
    `<div class="rkrow${r.pid === myPid || r.me ? ' me' : ''}${r.friend ? ' pal' : ''}">
       <span class="rkn${r.rank <= 3 ? ' gold' : ''}">${r.rank}</span>
       <span class="rkname">${r.friend ? '<i class="rkstar">★</i>' : ''}<b>${escapeHtml(r.name)}</b>${tag || ''}</span>
       <span class="rkv">${main}</span>
       <span class="rksub">${sub}</span>
     </div>`;

  const tierTag = id => {
    const t = RATING_TIERS.find(x => x.id === id);
    return t ? `<span class="rktag" style="color:${t.color}">${t.id}</span>` : '';
  };
  const lvTag = lv => {
    const t = rankTier(lv);
    return `<span class="rktag" style="color:${t.color}">${t.badge} ${lv}</span>`;
  };

  let rows = [], head = '';
  if (HUD.rkBoard === 'handicap') {
    rows = (data.handicap || []).map(r =>
      row(r, handicapText(r.index), `${r.rounds} rounds`, lvTag(r.level)));
  } else if (HUD.rkBoard === 'level') {
    rows = (data.level || []).map(r =>
      row(r, 'Lv ' + r.level, `${r.xp.toLocaleString()} XP`, lvTag(r.level)));
  } else if (HUD.rkBoard === 'weekly') {
    head = `<p class="tiny">XP gained since Monday. Resets every week.</p>`;
    rows = (data.weekly || []).map(r =>
      row(r, '+' + r.gained.toLocaleString(), 'XP this week', lvTag(r.level)));
  } else if (HUD.rkBoard === 'season') {
    head = `<p class="tiny">XP gained this quarter. Resets in January, April, July and October.</p>`;
    rows = (data.season || []).map(r =>
      row(r, '+' + r.gained.toLocaleString(), 'XP this season', lvTag(r.level)));
  } else if (HUD.rkBoard === 'friends') {
    const rows2 = data.friendRows || [];
    head = rows2.length > 1
      ? `<p class="tiny">You and your friends, ranked by handicap. Anybody
         without three carded rounds sits at the bottom until they have one.</p>`
      : `<p class="tiny">Add a friend from the front page and you will both
         appear here.</p>`;
    rows = rows2.map(r =>
      row(r, handicapText(r.index), `Lv ${r.level} · ${r.rounds} rounds`,
          r.online ? '<span class="rktag" style="color:#6fce8a">online</span>' : ''));
  } else {
    const c = data.course || {};
    head =
      `<div class="rkcourses">${(courseNames || []).map(cn =>
        `<button class="rkc${cn.id === c.id ? ' on' : ''}" data-rkc="${cn.id}">${cn.name}</button>`).join('')}</div>` +
      `<div class="rkrate"><span>Course rating <b>${c.rating ?? '—'}</b></span>` +
      `<span>Slope <b>${c.slope ?? '—'}</b></span>` +
      `<span>Par <b>36</b></span></div>` +
      `<p class="tiny">Average score against the rating, over at least two rounds. ` +
      RATING_TIERS.map(t => `<b style="color:${t.color}">${t.id}</b> ${t.blurb}`).join(' · ') + `</p>`;
    rows = (c.rows || []).map(r =>
      row(r, (r.vs > 0 ? '+' : '') + r.vs.toFixed(1), `${r.rounds} rounds`, tierTag(r.tier)));
  }

  body.innerHTML = head + (rows.length ? rows.join('')
    : `<div class="rkempty">Nobody has qualified for this board yet.<br>
       <span class="tiny">Play a few rounds and you will be the first.</span></div>`);
};

let boardsBound = false;
HUD.bindBoards = () => {
  if (boardsBound) return;
  boardsBound = true;
  document.getElementById('rkbTabs')?.addEventListener('click', e => {
    const b = e.target.closest('.rkbtab');
    if (b) { HUD.rkBoard = b.dataset.board; HUD.onBoards(null); }
  });
  document.getElementById('rankBody')?.addEventListener('click', e => {
    const c = e.target.closest('[data-rkc]');
    if (c) { HUD.rkCourse = c.dataset.rkc; HUD.onBoards(c.dataset.rkc); }
  });
};

/* The weather, under the wind rose. Shown once when a round's weather
   arrives rather than every frame — it does not change within a round, and
   rewriting this every frame would be a DOM write per frame for a string
   that is the same string. */
HUD.setWeather = w => {
  if (!el.wWeather) return;
  if (!w) { el.wWeather.hidden = true; return; }
  el.wWeather.hidden = false;
  /* The wind the player is actually getting, so the chip cannot promise a
     gale next to a rose reading calm — see weatherEffects. Remembered from
     the last setWind, because the weather panel and the wind rose are drawn
     from two different calls. */
  const fx = weatherEffects(w, HUD._lastWindMs ?? null);
  el.wWeather.innerHTML =
    `<span class="wcond">${w.icon} ${w.conditionName}</span>` +
    `<span class="wclock">${clockText(w.hour)} · ${w.seasonName.toLowerCase()}</span>` +
    (fx.length ? `<div class="wfx">${fx.map(f =>
      `<i class="${f.good ? 'good' : 'bad'}">${f.label} ${f.value}</i>`).join('')}</div>` : '');
};

/* ═══════════════════════════════════════════════════ THE FRIENDS LIST ═══
   Requests at the top, then favourites, then whoever is online. Somebody
   waiting on an answer from you outranks everything else on the panel —
   they are the only row that needs a decision. */
import { handicapText as hcpText, rankTier as rTier } from '../shared/handicap.js';

HUD.onFriendAct = () => {};

const ago = ms => {
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  return `${Math.floor(h / 24)} day${Math.floor(h / 24) === 1 ? '' : 's'} ago`;
};

HUD.renderFriends = (state, people) => {
  const list = document.getElementById('frList');
  const badge = document.getElementById('frBadge');
  if (!list) return;

  const pending = state?.pending || [];
  if (badge) { badge.hidden = !pending.length; badge.textContent = pending.length; }

  const rows = [];

  // 1. requests waiting on you
  for (const q of pending) {
    rows.push(`<div class="fr-row req">
      <span class="fr-dot"></span>
      <span class="fr-nm"><b>${escapeHtml(q.name || 'A golfer')}</b>
        <small>wants to be friends · ${ago(q.ago)}${q.note ? ' · “' + escapeHtml(q.note) + '”' : ''}</small></span>
      <span class="fr-acts">
        <button data-fr="accept" data-pid="${q.pid}" title="Accept">✓</button>
        <button data-fr="decline" data-pid="${q.pid}" title="Decline">✕</button>
      </span></div>`);
  }

  // 2. the friends themselves
  for (const f of (people || [])) {
    const t = rTier(f.level || 1);
    const sub = f.online
      ? (f.where || 'In the menu')
      : `Level ${f.level} · ${t.name}${f.index != null ? ' · plays off ' + hcpText(f.index) : ''}`;
    rows.push(`<div class="fr-row${f.fav ? ' fav' : ''}">
      <span class="fr-dot${f.online ? ' on' : ''}"></span>
      <span class="fr-nm"><b>${f.fav ? '★ ' : ''}${escapeHtml(f.name)}</b><small>${escapeHtml(sub)}</small></span>
      <span class="fr-acts">
        ${f.room ? `<button class="join" data-fr="join" data-room="${f.room}">Join</button>` : ''}
        ${f.online && !f.room ? `<button data-fr="invite" data-pid="${f.pid}" title="Invite to your round">🏌️</button>` : ''}
        <button data-fr="favourite" data-pid="${f.pid}" title="${f.fav ? 'Unfavourite' : 'Favourite'}">${f.fav ? '★' : '☆'}</button>
        <button data-fr="remove" data-pid="${f.pid}" title="Remove">✕</button>
      </span></div>`);
  }

  list.innerHTML = rows.length ? rows.join('')
    : `<div class="fr-empty">No friends yet. Press <b>My code</b>, send it to
       somebody, and they can add you — or paste theirs above.
       <br>Your friends stay with your golfer; there is nothing to sign up for.</div>`;
};

let friendsBound = false;
HUD.bindFriends = () => {
  if (friendsBound) return;
  friendsBound = true;
  document.getElementById('frList')?.addEventListener('click', e => {
    const b = e.target.closest('[data-fr]');
    if (!b) return;
    HUD.onFriendAct(b.dataset.fr, { pid: b.dataset.pid, room: b.dataset.room });
  });
  document.getElementById('frAdd')?.addEventListener('click', () => {
    const inp = document.getElementById('frCode');
    HUD.onFriendAct('request', { code: inp.value });
  });
  document.getElementById('frCode')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('frAdd').click();
  });
  document.getElementById('frMyCode')?.addEventListener('click', () => {
    HUD.onFriendAct('mycode', {});
  });
};

HUD.friendError = msg => {
  const el2 = document.getElementById('frErr');
  if (el2) el2.textContent = msg || '';
};

/* ═══════════════════════════════════════════════════ INVITATIONS ════════
   A corner card, not a modal. An invitation that stops the game to demand
   an answer is one people learn to dread; this sits out of the way, says who
   and where, and goes when it is answered or when the round it points at
   starts without you. */
HUD.onInvite = () => {};

HUD.renderInvites = list => {
  const tray = document.getElementById('inviteTray');
  if (!tray) return;
  tray.innerHTML = (list || []).map(v => {
    const mins = Math.max(0, Math.round((v.expires - Date.now()) / 60000));
    return `<div class="invite">
      <b>${escapeHtml(v.fromName)} invited you</b>
      <small>${escapeHtml(v.courseName)} · ${escapeHtml(v.format)} · ${v.seats} players
        · expires in ${mins} min</small>
      ${v.note ? `<div class="inv-note">“${escapeHtml(v.note)}”</div>` : ''}
      <div class="inv-acts">
        <button class="yes" data-inv="${v.id}" data-yes="1">Join</button>
        <button data-inv="${v.id}">Not now</button>
      </div>
    </div>`;
  }).join('');
};

let invBound = false;
HUD.bindInvites = () => {
  if (invBound) return;
  invBound = true;
  document.getElementById('inviteTray')?.addEventListener('click', e => {
    const b = e.target.closest('[data-inv]');
    if (b) HUD.onInvite(b.dataset.inv, !!b.dataset.yes);
  });
};

/* The boards screen's own tabs. Separate from the clubhouse's, because they
   are separate screens now — sharing showClubhouseTab would have meant one
   of them hiding the other's panes. */
HUD.bdTab = 'ranks';
HUD.showBoardTab = name => {
  HUD.bdTab = name;
  for (const b of document.querySelectorAll('#bdTabs .hktab')) {
    const on = b.dataset.bd === name;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  }
  for (const p of document.querySelectorAll('.bdpane')) p.hidden = p.dataset.pane !== name;
  document.querySelector('#screenBoards .card')?.scrollTo?.({ top: 0 });
  if (name === 'ranks') HUD.onBoards?.(null);
  if (name === 'world') HUD.onWorldTab?.();
  if (name === 'records') HUD.onRecordsTab?.();
};

let bdBound = false;
HUD.bindBoardsScreen = () => {
  if (bdBound) return;
  bdBound = true;
  document.getElementById('bdTabs')?.addEventListener('click', e => {
    const b = e.target.closest('.hktab');
    if (b) HUD.showBoardTab(b.dataset.bd);
  });
};

/* The turntable beside the shop list. `kind` decides which model is built —
   see shopview.js. The caption is here rather than in the canvas because
   text in a WebGL canvas is a texture nobody can select or translate. */
HUD.previewShopItem = what => {
  const cv = document.getElementById('shopCanvas');
  if (!cv || !what) return;
  showShopItem(cv, what);
  const cap = document.getElementById('shopCap');
  if (cap) {
    cap.innerHTML = `<b>${escapeHtml(what.name || '')}</b>` +
      (what.sub ? `<small>${escapeHtml(what.sub)}</small>` : '');
  }
};

/* ═══════════════════════════════════════════════════ DIFFICULTY ═══════
   Not how hard the golf is — everybody in a room plays the same course in
   the same wind. This is how much of it the game reads for you, and the
   card says exactly what changes, because a mode named "Pro" that does not
   list what it takes away is a mode nobody picks. */
HUD.renderDifficulty = (current, onPick) => {
  const box = document.getElementById('diffRow');
  if (!box) return;
  const cur = current || 'standard';
  box.innerHTML = DIFFICULTIES.map(d => {
    const a = d.aids;
    /* What you LOSE, listed. The alternative is a blurb, and a blurb is
       how you end up with four modes nobody can tell apart. */
    const takes = [];
    if (a.line === 'none') takes.push('no aim line');
    else if (a.line === 'aim') takes.push('pointer only');
    else if (a.line === 'partial') takes.push('no run-out');
    if (a.putt === 'none') takes.push('read your own putts');
    if (!a.club) takes.push('pick your own club');
    if (a.power === 'blind') takes.push('unmarked meter');
    if (a.wind === 'rough') takes.push('wind by feel');
    if (!a.gimme) takes.push('hole everything out');
    return `<button class="diffcard${d.id === cur ? ' on' : ''}" data-diff="${d.id}">
      <b>${escapeHtml(d.name)}</b>
      <span class="diff-earn">${d.earn === 1 ? 'normal earnings'
        : (d.earn > 1 ? '+' : '') + Math.round((d.earn - 1) * 100) + '% coins & XP'}</span>
      <small>${escapeHtml(d.blurb)}</small>
      ${takes.length ? `<span class="diff-takes">${takes.map(escapeHtml).join(' · ')}</span>` : ''}
      ${d.records ? '' : '<span class="diff-warn">records not counted</span>'}
    </button>`;
  }).join('');
  const note = document.getElementById('diffNote');
  if (note) {
    note.textContent = 'Everyone in a room plays the identical course in the ' +
      'identical wind — this only changes how much of it is read for you.';
  }
  if (!box.dataset.wired) {
    box.dataset.wired = '1';
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-diff]');
      if (b) onPick(b.dataset.diff);
    });
  }
};

/* ══════════════════════════════════════════════════ THE FEED ═══════════
   Entries arrive nameless and past tense, so the same row reads correctly
   whether it is yours or a friend's — see activity.js. */
HUD.renderFeed = items => {
  const box = document.getElementById('feedList');
  const block = document.getElementById('feedBlock');
  if (!box || !block) return;
  if (!items?.length) { block.hidden = true; return; }
  block.hidden = false;
  box.innerHTML = items.map(it => {
    const k = FEED_ICON[it.kind] || '•';
    return `<div class="feeditem${it.mine ? ' mine' : ''}">
      <span class="fd-ico">${k}</span>
      <span class="fd-txt"><b>${escapeHtml(it.name)}</b> ${escapeHtml(it.text)}</span>
      <span class="fd-when">${agoShort(it.t)}</span>
    </div>`;
  }).join('');
};

const FEED_ICON = { ace: '🎯', albatross: '🦅', eagle: '🦅', record: '🏆',
                    best: '📈', level: '⭐', round: '⛳', joined: '👋' };

/* "4m", "2h", "3d" — short, because it is a column and not a sentence.
   Deliberately NOT the `ago` above: that one takes a duration and spells
   the words out for a friends-list row, this one takes a timestamp and has
   to fit in a gutter. Two names, because they are two different jobs. */
function agoShort(t) {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return Math.round(s / 60) + 'm';
  if (s < 86400) return Math.round(s / 3600) + 'h';
  return Math.round(s / 86400) + 'd';
}

/* ═══════════════════════════════════════════════ HEAD TO HEAD ═════════ */
HUD.renderH2H = rows => {
  const box = document.getElementById('h2hBox');
  if (!box) return;
  if (!rows?.length) {
    box.innerHTML = '<p class="tiny">Finish a round with somebody and your ' +
      'record against them starts here.</p>';
    return;
  }
  box.innerHTML = `<ol class="h2hlist">` + rows.map(r => {
    const pct = r.played ? Math.round((r.w / r.played) * 100) : 0;
    const lead = r.w > r.l ? 'up' : r.w < r.l ? 'down' : 'level';
    return `<li class="h2h ${lead}">
      <span class="h2-name">${escapeHtml(r.name)}</span>
      <span class="h2-bar"><i style="width:${pct}%"></i></span>
      <span class="h2-rec"><b>${r.w}</b>–<b>${r.l}</b>${r.d ? `–${r.d}` : ''}</span>
      <span class="h2-sub">${r.played} round${r.played === 1 ? '' : 's'}</span>
    </li>`;
  }).join('') + `</ol>`;
};

/* ══════════════════════════════════════ POST-ROUND COMPARISON ═════════
   A final score on its own is a number. Next to your average, your best and
   what you have done on this course before, it is a result. */
HUD.renderResultCompare = (myTotal, par, prof, courseId, opponents) => {
  const box = document.getElementById('resCmp');
  if (!box) return;
  if (!prof || !Number.isFinite(myTotal)) { box.hidden = true; return; }
  const rel = myTotal - par;
  const bits = [];

  /* Against your own best. `best` is relative to par and can legitimately
     be 0, so this checks for null rather than for falsy — a level-par best
     is not a missing one. */
  if (prof.best != null) {
    const d = rel - prof.best;
    bits.push({
      lbl: 'Your best', val: relLabel(prof.best),
      note: d < 0 ? 'beaten' : d === 0 ? 'matched' : `${d} off it`,
      good: d <= 0
    });
  }
  const form = prof.byCourse?.[courseId];
  if (form && form.n > 0) {
    /* `rel` is ALREADY relative to par, so the old `rel - par` subtracted it
       twice and the "better than usual" highlight was decided by a number
       roughly seventy strokes out — it was green on essentially every round
       at par-72 courses.

       `form.vs` is measured against the course RATING rather than par, so
       this is still not quite like for like; on these courses the two sit
       within a stroke of each other, and comparing the two honest baselines
       beats comparing one of them to nonsense. */
    bits.push({ lbl: 'Here, usually', val: (form.vs > 0 ? '+' : '') + form.vs.toFixed(1),
                note: `${form.n} round${form.n === 1 ? '' : 's'}`, good: rel < form.vs });
  }
  if (prof.index != null) bits.push({ lbl: 'Handicap', val: prof.index.toFixed(1), note: '', good: null });

  /* And against whoever you just played, which is the comparison anybody
     actually cares about. */
  for (const o of (opponents || []).slice(0, 3)) {
    const d = myTotal - o.total;
    bits.push({
      lbl: o.name, val: d === 0 ? 'tied' : `${d < 0 ? '-' : '+'}${Math.abs(d)}`,
      note: o.record ? `${o.record.w}–${o.record.l} all time` : 'first meeting',
      good: d <= 0
    });
  }
  if (!bits.length) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = bits.map(b =>
    `<div class="rc${b.good === true ? ' good' : b.good === false ? ' bad' : ''}">
      <i>${escapeHtml(b.lbl)}</i><b>${escapeHtml(String(b.val))}</b>
      ${b.note ? `<small>${escapeHtml(b.note)}</small>` : ''}
    </div>`).join('');
};
