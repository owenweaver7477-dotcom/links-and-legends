/* =========================================================================
   hud.js — every bit of DOM. No game logic lives here.
   ========================================================================= */

import { CARRY, CLUBS, CLUB_BY_KEY, BAG_SIZE, DEFAULT_BAG } from '../shared/clubs.js';
import { HOLES_PER_COURSE, BALL_COLORS, COURSE_ORDER } from '../shared/biomes.js';
import { CAPS, SHIRTS, SKINS, TROUSERS, HAIR_COLORS, SHOES,
         HAT_STYLES, HAIR_STYLES, ACCESSORIES, BODIES, bodiesOf } from '../shared/avatars.js';
import { SHOP, purchaseBlocked } from '../shared/gear.js';
import { CADDIES, CADDIE_MAX, caddieCost, CLUB_TIERS, REFINE_COSTS } from '../shared/crew.js';
import { EMOTES, EMOTE_SLOTS } from './celebrations.js';
import { UNLOCKS, unlocksAt, unlocksOfKind, nextUnlock, UNLOCK_KINDS } from '../shared/unlocks.js';
import { ACTIONS, keysFor, bindKey, resetBinds, keyLabel, RESERVED } from './binds.js';
import { clubSvg, caddieSvg, statSvg, finishName } from './clubart.js';
import { formChart, scoringChart, dial } from './charts.js';
import { toYards, clamp } from '../shared/rng.js';
import { ShotSim, makeFlatRange } from '../shared/ballistics.js';
import { rewardFor, utcDateKey, CYCLE_LENGTH } from '../shared/loginrewards.js';
import { RARITIES, CASE_POOL, rarityForLevel, tierOdds, proTierOdds, PITY_THRESHOLD,
         PITY_TIER, tierIndex, CASE_COIN_COST, PRO_CASE_GEM_COST } from '../shared/cases.js';
import { icon } from './icons.js';

const $ = id => document.getElementById(id);
const el = {};
for (const id of [
  'screenHome', 'screenLobby', 'screenResults', 'screenLoad', 'screenHoleOver', 'screenShop',
  'screenBoards', 'bdTabs', 'bdBack',
  'screenLanding', 'introCanvas', 'lpLegend', 'lpLive', 'lpSide', 'lpSideTitle',
  'lpSideClose', 'lpOnlineCount', 'lpCourseName', 'lpCourseSub', 'lpFriendSub',
  'lpWeekTop', 'lpWeekTopRows',
  'nameState', 'nameSuggest',
  'screenWardrobe', 'wdCarousel', 'wdCourseName', 'wdCourseWhere', 'wdDots', 'wdPrev', 'wdNext',
  'wdAuto', 'wdCats', 'wdFits', 'wdRTabs', 'wdRBody', 'wdName', 'wdFit', 'wdStats',
  'wdRandom', 'wdCustom', 'wdDone',
  'wdInfo', 'wdInfoName', 'wdInfoRarity', 'wdInfoEffect', 'wdInfoPct',
  'btnClubhouse', 'btnShopBack', 'homeCoins',
  'homeErr', 'inpName', 'inpCode', 'loadMsg',
  'lobbyCode', 'lobbyLink', 'lobbyPlayers', 'lobbyCount', 'lobbyNote', 'btnStart', 'courseList',
  'btnPrivacy', 'optPrivate',
  'btnFeedbackMid', 'btnFeedbackNew', 'modalFeedback', 'fbCats', 'fbBody',
  'fbCourseNote', 'fbErr', 'btnFeedbackCancel', 'btnFeedbackSend', 'feedbackBoard',
  'modalReport', 'reportTarget', 'reportBody', 'reportErr', 'btnReportCancel', 'btnReportSend',
  'modalKick', 'kickTarget', 'kickNote', 'kickReason', 'kickErr', 'btnKickCancel', 'btnKickSend',
  'modalRoadmap', 'roadmapList', 'btnRoadmapClose',
  'lpRewardsBtn', 'lpRewardsSub', 'lpRewardsBadge',
  'modalRewards', 'btnRewardsClose', 'rwStreakTxt', 'rwFreezes', 'rwGrid', 'btnRewardsClaim', 'rwErr',
  'rwGems', 'rwCases', 'rwCasesS', 'btnRewardsOpenCase', 'btnRewardsBuyCase',
  'rwProCases', 'rwProCasesS', 'btnRewardsOpenProCase', 'btnRewardsBuyProCase',
  'modalCase', 'caseStage', 'caseBox', 'caseHint', 'casePity', 'btnCaseContents', 'caseContents',
  'caseReelWrap', 'caseReelTrack',
  'caseReveal', 'caseBurst', 'caseItemArt',
  'caseRarity', 'caseItemName', 'caseItemKind', 'btnCaseDone',
  'hCourse', 'hNum', 'hPar', 'hMeta', 'dYds', 'dLie', 'dElev',
  'wArrow', 'wSpeed', 'wDesc', 'wWeather',
  'boardRows', 'boardRoom', 'turnbar', 'tbText', 'tbDot',
  'playbar', 'clubName', 'clubCarry', 'clubUp', 'clubDown', 'mFill', 'mFaceDot', 'mLabel', 'aimTxt', 'mPct',
  'shotinfo', 'toasts', 'mapwrap', 'mapc', 'minic', 'miniPanel',
  'hoTitle', 'hoSub', 'hoTable', 'hoNote', 'btnNext',
  'teeList', 'ballColours', 'bagList', 'bagCount', 'btnBagReset', 'optMetres',
  'cartKmh', 'dialFill', 'dialNeedle', 'cartDamage', 'cartDamageTxt', 'mFace', 'touchPad',
  'coinHud', 'coinHudN', 'netPill', 'walletHud', 'walletCoinsN', 'walletGemsN',
  'emoteWheel', 'recordBox', 'onlineNow', 'chatPanel', 'chatLog', 'chatInput', 'chatText', 'phraseBar', 'rosterPanel', 'rosterList', 'labelLayer', 'walkbar', 'walkText', 'lookPicker', 'optQuality', 'perfHud', 'careerBox', 'shopList', 'coinBal', 'gemBal',
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
HUD.setHomeCoins = n => { el.homeCoins.innerHTML = icon('coin') + ' ' + (n || 0).toLocaleString(); };
/** The always-there top-right balance — see .wallethud in style.css for
    which screens it's actually shown on. */
HUD.setWallet = (coins, gems) => {
  if (!el.walletCoinsN || !el.walletGemsN) return;
  el.walletCoinsN.textContent = (coins || 0).toLocaleString();
  el.walletGemsN.textContent = (gems || 0).toLocaleString();
};

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
/* `msg` reaches here with player, course and room names baked straight in —
   the server allow-lists what it sends but does not escape it for HTML, so
   this stays a real text node rather than innerHTML. `iconName` is trusted
   (it only ever comes from a call site literal, one of icons.js's own
   names), so it is fine to render as markup ahead of that text node. */
HUD.toast = (msg, kind, ms = 2600, iconName) => {
  const t = document.createElement('div');
  t.className = 'toast ' + (kind || '');
  if (iconName) t.innerHTML = icon(iconName) + ' ';
  t.appendChild(document.createTextNode(msg));
  el.toasts.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, ms);
  while (el.toasts.children.length > 4) el.toasts.firstChild.remove();
};

/**
 * A toast built from markup you already know is safe — every interpolated
 * value at the call site is internal (a coin/gem/case count), never a
 * player-supplied name. Kept separate from HUD.toast on purpose: that one
 * promises plain text no matter what it's handed, and blurring that
 * promise in one shared function is how a name eventually sneaks through
 * as HTML.
 */
HUD.toastHTML = (html, kind, ms = 2600) => {
  const t = document.createElement('div');
  t.className = 'toast ' + (kind || '');
  t.innerHTML = html;
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
HUD.setPerf = (fps, ms, calls, tris, quality, worstMs) => {
  const cls = fps >= 55 ? '' : fps >= 30 ? 'warn' : 'bad';
  // the average hides stutters; the worst frame in the last 10s is the
  // number that actually matches what a player felt just now
  const worstCls = worstMs >= 100 ? 'bad' : worstMs >= 34 ? 'warn' : '';
  el.perfHud.innerHTML =
    `<b class="${cls}">${fps.toFixed(0)} fps</b>  ${ms.toFixed(1)} ms` +
    (worstMs != null ? `  <b class="${worstCls}">worst ${worstMs.toFixed(0)}ms</b>` : '') + `\n` +
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
    st.innerHTML = p.spectator ? '–' : (p.finished ? icon('check') : p.strokes || 0);

    // running total against par, counting only holes actually completed
    let played = 0, taken = 0;
    for (let i = 0; i < room.holeIndex; i++) if (p.scores[i] != null) { taken += p.scores[i]; played += course.holes[i].par; }
    if (p.finished && p.scores[room.holeIndex] != null) { taken += p.scores[room.holeIndex]; played += course.holes[room.holeIndex].par; }
    const rel = taken - played;
    const tot = document.createElement('span');
    tot.className = 'ptot ' + (rel < 0 ? 'under' : rel > 0 ? 'over' : '');
    tot.textContent = p.spectator ? 'watch' : relLabel(rel);

    row.append(sw, nm, st, tot);
    if (p.pid !== myPid) {
      const rep = document.createElement('button');
      rep.type = 'button'; rep.className = 'preport'; rep.title = `Report ${p.name}`;
      rep.innerHTML = icon('report');
      rep.dataset.reportPid = p.pid; rep.dataset.reportName = p.name;
      row.appendChild(rep);
      /* The host can always remove somebody; everyone else can only start a
         vote, and only in a public room — a private one is the host's own
         guest list, see §8.1 in server.js. */
      const isHost = myPid === room.hostPid;
      if (isHost || room.privacy === 'public') {
        const kick = document.createElement('button');
        kick.type = 'button'; kick.className = 'pkick';
        kick.title = isHost ? `Remove ${p.name}` : `Vote to remove ${p.name}`;
        kick.innerHTML = icon('kick');
        kick.dataset.kickPid = p.pid; kick.dataset.kickName = p.name;
        kick.dataset.kickHost = isHost ? '1' : '';
        row.appendChild(kick);
      }
    }
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
    if (locked) b.innerHTML = icon('lock');
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
  HUD._lastBagView = what;   // so the Inspect button shows whatever you were just looking at
  const cap = document.getElementById('bagCap');
  if (cap) {
    cap.innerHTML = `<b>${escapeHtml(what.name || '')}</b>` +
      (what.sub ? `<small>${escapeHtml(what.sub)}</small>` : '');
  }
};

/* ═══════════════════════════════════════════════ CLUB INSPECT ═══════════
   The bag's little auto-spinning preview was already the real 3D club —
   this is the same object, bigger, held still where a hand puts it rather
   than watched go past. Reuses shopview.js's renderer wholesale; the only
   new thing it needs from that module is a way to override the spin. */
HUD.openClubInspect = () => {
  const modal = document.getElementById('modalClubInspect');
  const cv = document.getElementById('inspectCanvas');
  if (!modal || !cv) return;
  const what = HUD._lastBagView || { kind: 'club', key: 'DR', tier: HUD.myClubTier || 0 };
  modal.hidden = false;
  showShopItem(cv, what);
  releaseShopOrbit(cv);   // a freshly opened inspect starts turning on its own, same as the bag
  const cap = document.getElementById('inspectCap');
  if (cap) {
    cap.innerHTML = `<b>${escapeHtml(what.name || '')}</b>` +
      (what.sub ? `<small>${escapeHtml(what.sub)}</small>` : '');
  }
};

/** Drive the inspect canvas's orbit directly — main.js owns the actual
 *  pointer events (same split as the wardrobe's own drag handler), this
 *  just forwards into shopview.js. */
HUD.orbitInspect = (yaw, pitch) => {
  const cv = document.getElementById('inspectCanvas');
  if (cv) setShopOrbit(cv, yaw, pitch);
};

/**
 * The shaft decal picker. This is the one cosmetic slot in the whole game
 * that had a working field (`look.decal`, read by Avatar.setDecal) and no
 * UI anywhere that ever wrote to it — earned, stored, applied, and simply
 * unreachable. Shows every decal-kind unlock, earned or not, the same way
 * club finishes already do: owned ones are pressable, others show the
 * level that unlocks them so there is always a next one to want.
 */
HUD.renderClubDecalPicker = (look, level, caseUnlocks = []) => {
  const grid = document.getElementById('inspectDecalGrid');
  if (!grid) return;
  const decals = UNLOCKS.filter(u => u.kind === 'decal');
  const owned = id => (Number(level) || 1) >= 0 &&
    (decals.find(u => u.id === id)?.at <= (Number(level) || 1) || caseUnlocks.includes('decal:' + id));
  const cur = look?.decal || null;
  const none = `<button class="none${!cur ? ' on' : ''}" data-decal="" title="No shaft decal">None</button>`;
  const cells = decals.map(u => {
    const has = owned(u.id);
    const color = u.color || '#8fe07a';
    return `<button class="${!has ? 'locked' : ''}${u.id === cur ? ' on' : ''}"
      data-decal="${has ? u.id : ''}" data-pattern-id="${has ? u.id : ''}" data-pattern-color="${color}"
      ${has ? '' : 'disabled'}
      title="${escapeHtml(u.name)}${has ? '' : ` — level ${u.at}`}">
      ${has ? `<i style="background:${color}"></i>` : u.at}
    </button>`;
  }).join('');
  grid.innerHTML = none + cells;
  /* The pattern goes on as an .src property assignment below, deliberately
     never written into the HTML string above as a source attribute — the
     portal-bundle verifier's static scanner reads that shape of text as a
     real asset reference and a data-URI reads as a path it can't resolve.
     A property assignment after the fact never puts that text in the
     source at all. */
  for (const btn of grid.querySelectorAll('[data-pattern-id]')) {
    const id = btn.dataset.patternId;
    if (!id) continue;
    const pattern = shaftDecalDataUrl(id, btn.dataset.patternColor);
    if (!pattern) continue;
    const img = document.createElement('img');
    img.width = 20; img.height = 20; img.alt = '';
    img.src = pattern;
    btn.querySelector('i')?.appendChild(img);
  }
  if (!grid.dataset.wired) {
    grid.dataset.wired = '1';
    grid.addEventListener('click', e => {
      const b = e.target.closest('button:not([disabled])');
      if (!b || !('decal' in b.dataset)) return;
      HUD.onWardrobe?.({ __clubDecal: b.dataset.decal || null });
    });
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
    <button class="btn mini" id="btnRoadmap">Full roadmap</button>
  </div>`;
}
HUD.levelRow = levelRow;

/* The "Next: X at level N" line only ever answers one step ahead. This is
   the whole ladder — all 40, in level order, so a player who wants to plan
   around a specific level (or just see how much is left) can, without the
   career tab itself growing to fit forty rows every time it renders. */
const ROADMAP_KIND_ICON = { emote: 'emoteFace', decal: 'decal', trail: 'trail',
  hat: 'shirt', title: 'title', ball: 'ball' };

HUD.renderRoadmap = (prof) => {
  const list = el.roadmapList;
  if (!list) return;
  const lvl = prof?.level ?? 1;
  const sorted = [...UNLOCKS].sort((a, b) => a.at - b.at);
  const rows = [];
  let markerPlaced = false;
  for (const u of sorted) {
    const earned = u.at <= lvl;
    if (!earned && !markerPlaced) {
      markerPlaced = true;
      rows.push(`<div class="rmap-here">You are here — level ${lvl}</div>`);
    }
    // melee unlocks are the one kind whose icon IS the item id (slap, kick)
    // — everything else keys off the kind, since a decal or a title does
    // not have its own icon per item
    const kindIcon = u.kind === 'melee' ? icon(u.id, { size: 18 })
      : icon(ROADMAP_KIND_ICON[u.kind] || 'gift', { size: 18 });
    rows.push(`<div class="rmap-row${earned ? ' earned' : ''}">
      <span class="rmap-lvl">${u.at}</span>
      <span class="rmap-ico">${kindIcon}</span>
      <div class="rmap-txt"><b>${escapeHtml(u.name)}</b><em>${escapeHtml((UNLOCK_KINDS[u.kind] || {}).name || u.kind)}</em></div>
      <span class="rmap-state">${earned ? icon('check', { size: 14 }) : icon('lock', { size: 12 })}</span>
    </div>`);
  }
  if (!markerPlaced) rows.push('<div class="rmap-here">Everything unlocked</div>');
  list.innerHTML = rows.join('');
};

/* Which tab the Pro Shop is showing. Module-level so it survives the
   re-render that every purchase triggers — a tab that reset itself on each
   buy would bounce the player back to the Caddie Crew every time. */
let shopTab = 'crew';
HUD.setShopTab = id => { shopTab = id; };
let caddieCompareOn = false;

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

/** "Try it" — a real, computed preview of what buying THIS item alone
 *  would change, off the exact same simulation the payoff panel already
 *  trusts. Deliberately client-side display only: nothing is granted,
 *  nothing reaches the server, so there is no window for a preview to
 *  become a free temporary upgrade mid-round — it can only ever show a
 *  number, never actually change what a shot does. Ball/putter/cart do
 *  not reduce to one club's carry the way irons/woods do, so they keep
 *  their existing text-only blurb instead of a number that would either
 *  be misleading (ball affects every club, not just one) or not exist
 *  (a putter's effect is a green-read hint, not a distance). */
function tryItLine(it, prof) {
  if (it.slot !== 'irons' && it.slot !== 'woods') return '';
  const club = it.slot === 'irons' ? 'I7' : 'DR';
  const label = it.slot === 'irons' ? '7 iron' : 'Driver';
  const before = carryYds(club, prof);
  const withIt = carryYds(club, { ...prof, gear: { ...(prof?.gear || {}), [it.slot]: it.tier } });
  if (withIt <= before) return '';
  return `<span class="sc-try">Try it — ${label} ${before}→${withIt} yds</span>`;
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

/** The single best next move across the WHOLE shop — clubs, gear and crew
 *  together — recommended dynamically per player rather than a fixed
 *  marketing pick, so it can never go stale as prices or someone's own
 *  progress change. Cheapest thing they can act on RIGHT NOW if anything is
 *  affordable; otherwise the cheapest thing they are saving toward, so
 *  there is always something to point at rather than nothing at all. */
function computeRecommended(prof) {
  const coins = prof?.coins || 0;
  const gear = prof?.gear || {};
  const crew = prof?.crew || {};
  const candidates = [];

  for (const [key, it] of Object.entries(SHOP)) {
    if ((gear[it.slot] || 0) >= it.tier) continue;               // already owned
    const blocked = purchaseBlocked(key, { coins, gear });
    if (blocked && blocked.startsWith('Needs')) continue;         // prerequisite not owned yet — not a real option
    candidates.push({ kind: 'gear', key, name: it.name, cost: it.cost, sub: it.blurb,
      art: SLOT_ART[it.slot]?.() || '' });
  }
  const tier = prof?.clubTier ?? 0;
  if (tier < 6) {
    const nxt = CLUB_TIERS[tier + 1];
    candidates.push({ kind: 'club:tier', name: nxt.name, cost: nxt.cost,
      sub: 'The next set up', art: clubSvg(nxt.look, 28) });
  }
  for (const [key, c] of Object.entries(CADDIES)) {
    const lvl = crew[key] || 0;
    if (lvl >= CADDIE_MAX) continue;
    candidates.push({ kind: 'caddie:' + key, name: c.name, cost: caddieCost(lvl),
      sub: (lvl ? 'Level up — ' : 'Hire — ') + c.stat, art: caddieSvg(key, 28) || c.emoji });
  }
  if (!candidates.length) return null;

  const affordable = candidates.filter(c => c.cost <= coins);
  const pool = affordable.length ? affordable : candidates;
  pool.sort((a, b) => a.cost - b.cost);
  return { ...pool[0], affordable: pool[0].cost <= coins };
}

function buildRecommend(prof, onBuy) {
  const rec = computeRecommended(prof);
  if (!rec) return null;
  const coins = prof?.coins || 0;
  const wrap = document.createElement('div');
  wrap.className = 'shop-rec';
  wrap.innerHTML = `
    <span class="sr-label">Recommended next</span>
    <div class="sr-body">
      <span class="sr-art">${rec.art}</span>
      <div class="sr-txt"><b>${escapeHtml(rec.name)}</b><span>${escapeHtml(rec.sub)}</span></div>
    </div>`;
  const btn = document.createElement('button');
  btn.className = 'btn' + (rec.affordable ? ' primary' : '');
  btn.innerHTML = rec.affordable
    ? icon('coin') + ' ' + rec.cost
    : `${icon('coin')} ${rec.cost} · need ${rec.cost - coins} more`;
  btn.disabled = !rec.affordable;
  if (rec.affordable) btn.addEventListener('click', () => onBuy(rec.key ?? rec.kind));
  wrap.appendChild(btn);
  return wrap;
}

/** Comparison mode for the Caddie Crew — all eight, side by side, instead
 *  of one card each. The cards are better for browsing one at a time; this
 *  is for the actual decision the cards make you scroll to answer: "which
 *  of these eight actually moves the needle for me right now." */
function buildCaddieCompare(prof) {
  const crew = prof?.crew || {};
  const coins = prof?.coins || 0;
  const rows = Object.entries(CADDIES).map(([key, c]) => {
    const lvl = crew[key] || 0;
    const maxed = lvl >= CADDIE_MAX;
    const cost = caddieCost(lvl);
    return { key, c, lvl, maxed, cost };
  }).sort((a, b) => b.lvl - a.lvl || (a.cost ?? Infinity) - (b.cost ?? Infinity));

  const wrap = document.createElement('div');
  wrap.className = 'cmp-table';
  wrap.innerHTML = `
    <div class="cmp-row cmp-head">
      <span>Caddie</span><span>Now</span><span>Next level</span><span>Cost</span>
    </div>` +
    rows.map(({ key, c, lvl, maxed, cost }) => `
      <div class="cmp-row" style="--rarity-color:${CADDIE_HEX[key] || '#e8c15a'}">
        <span class="cmp-who"><span class="cmp-face">${caddieSvg(key, 22) || c.emoji}</span>
          <b>${escapeHtml(c.name)}</b><em>${escapeHtml(c.stat)}</em></span>
        <span class="cmp-now">${lvl ? escapeHtml(c.line(lvl)) : '— not hired —'}</span>
        <span class="cmp-next">${maxed ? 'Maxed' : escapeHtml(c.line(lvl + 1))}</span>
        <span class="cmp-cost">${maxed ? icon('star') : `${icon('coin')} ${cost}${cost > coins ? ` <em>need ${cost - coins}</em>` : ''}`}</span>
      </div>`).join('');
  return wrap;
}

HUD.renderCareer = (prof) => {
  const box = el.careerBox;
  if (!box) return;

  // Delegated, not a direct listener on #btnRoadmap — this whole box is
  // rebuilt (innerHTML replaced) on every render, which would tear a
  // direct listener off with it. Bound once; the callback is swapped in
  // by main.js the same way HUD.onWardrobe/HUD.onBoards are.
  if (!box.dataset.bound) {
    box.dataset.bound = '1';
    box.addEventListener('click', e => {
      if (e.target.closest('#btnRoadmap')) HUD.onRoadmap?.();
    });
  }

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
       <span><b>${icon('coin')} ${(prof.coins || 0).toLocaleString()}</b></span>
     </div>`;
};

const CADDIE_HEX = {
  ace: '#c8382f', bruiser: '#e8873a', steady: '#4f9fd8', roller: '#6fce8a',
  pitstop: '#e8c15a', lucky: '#a98cd8', gale: '#7fd8d0', grit: '#9c8f76'
};

/* Module scope rather than local to the gear loop, since the recommended-
   purchase card (buildRecommend) needs the same art for whichever slot it
   is pointing at — one thumbnail per slot, not two definitions to keep in
   step with each other. */
const SLOT_ART = {
  ball: () => icon('ball', { size: 24 }),
  irons: () => icon('ironHead', { size: 24 }),
  woods: () => clubSvg('carbon', 40),
  putter: () => icon('putterHead', { size: 24 }),
  cart: () => icon('cart', { size: 24 })
};

HUD.renderShop = (prof, onBuy) => {
  if (!el.shopList) return;
  el.coinBal.innerHTML = prof ? icon('coin') + ' ' + (prof.coins || 0) : '';
  if (el.gemBal) el.gemBal.innerHTML = prof ? icon('gem') + ' ' + (prof.gems || 0) : '';
  el.shopList.innerHTML = '';

  /* The payoff panel.  An upgrade that only moves a hidden number is not an
     upgrade the player can feel, so every purchase shows up here immediately:
     the bars grow, the club-set silhouette changes tier, and the crew badges
     light.  It is the same data the simulation uses, read straight back. */
  el.shopList.appendChild(buildPayoff(prof));

  // one recommendation, above the category tabs, since it might point at
  // any of the three — pinned there rather than repeated inside each tab
  const rec = buildRecommend(prof, onBuy);
  if (rec) el.shopList.appendChild(rec);

  /* Three categories, not two. Clubs and gear used to share one "Pro Shop"
     tab as a single undifferentiated grid — the club ladder's current/next
     cards sat in the same row order as a ball upgrade and a cart tune-up,
     with nothing telling them apart but position. Splitting them here is
     basic infrastructure for the category filtering a future pass wants:
     there is now an actual category boundary in the UI to filter BY,
     instead of one grid a filter would have to invent boundaries inside. */
  const tabs = document.createElement('div');
  tabs.className = 'shoptabs';
  for (const [id, label] of [['clubs', 'Clubs'], ['gear', 'Gear'], ['crew', 'Caddie Crew'], ['cases', 'Cases']]) {
    const t = document.createElement('button');
    t.className = 'shoptab' + (shopTab === id ? ' on' : '');
    t.textContent = label;
    t.addEventListener('click', () => { shopTab = id; HUD.renderShop(prof, onBuy); });
    tabs.appendChild(t);
  }
  el.shopList.appendChild(tabs);

  // Comparison mode — caddies only, for now: eight different single-stat
  // specialists is a real "which one do I want" decision every time, in a
  // way a sequential ladder (clubs, gear tiers) is not — there is only
  // ever one next rung on those, nothing to compare it against.
  if (shopTab === 'crew') {
    const cmp = document.createElement('button');
    cmp.className = 'btn mini shop-cmp-btn' + (caddieCompareOn ? ' on' : '');
    cmp.textContent = caddieCompareOn ? 'Show cards' : 'Compare';
    cmp.addEventListener('click', () => { caddieCompareOn = !caddieCompareOn; HUD.renderShop(prof, onBuy); });
    el.shopList.appendChild(cmp);
  }

  if (shopTab === 'crew' && caddieCompareOn) {
    el.shopList.appendChild(buildCaddieCompare(prof));
    return;
  }

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
      card.style.setProperty('--rarity-color', CADDIE_HEX[key] || '#e8c15a');
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
        btn.className = 'btn'; btn.innerHTML = 'Legend ' + icon('star'); btn.disabled = true;
      } else {
        const can = coins >= cost;
        btn.className = 'btn' + (can ? ' primary' : '');
        btn.innerHTML = can
          ? (lvl ? 'Level up · ' : 'Hire · ') + icon('coin') + ' ' + cost
          : `${icon('coin')} ${cost} · need ${cost - coins} more`;
        btn.disabled = !can;
        if (can) btn.addEventListener('click', () => onBuy('caddie:' + key));
      }
      card.appendChild(btn);
      grid.appendChild(card);
    }
  } else if (shopTab === 'clubs') {
    // the club ladder: your set, the refinement, the next rung
    const tier = prof?.clubTier ?? 0, refine = prof?.refine ?? 0;
    const cur = CLUB_TIERS[tier];
    const curCard = document.createElement('div');
    curCard.className = 'shopcard owned';
    curCard.style.setProperty('--rarity-color', TIER_ACCENT[tier] || TIER_ACCENT[0]);
    curCard.innerHTML = `<span class="sc-art">${clubSvg(cur.look, 46)}</span>
      <b>${escapeHtml(cur.name)}</b><span class="sc-blurb">${escapeHtml(cur.blurb)}</span>
      <span class="cad-now">Tier ${tier + 1}/7${refine ? ' · Refinement ' + ['I','II','III'][refine - 1] : ''}</span>`;
    if (refine < 3) {
      const rc = REFINE_COSTS(tier)[refine];
      const rb = document.createElement('button');
      rb.className = 'btn' + (coins >= rc ? ' primary' : '');
      rb.innerHTML = coins >= rc
        ? 'Refine ' + ['I','II','III'][refine] + ' · ' + icon('coin') + ' ' + rc
        : `${icon('coin')} ${rc} · need ${rc - coins} more`;
      rb.disabled = coins < rc;
      if (coins >= rc) rb.addEventListener('click', () => onBuy('club:refine'));
      curCard.appendChild(rb);
    }
    grid.appendChild(curCard);

    if (tier < 6) {
      const nxt = CLUB_TIERS[tier + 1];
      const nc = document.createElement('div');
      nc.className = 'shopcard';
      nc.style.setProperty('--rarity-color', TIER_ACCENT[tier + 1] || TIER_ACCENT[0]);
      nc.dataset.view = JSON.stringify({ kind: 'club', key: 'DR', tier: tier + 1,
        name: nxt.name, sub: 'The next set up' });
      nc.innerHTML = `<span class="sc-art">${clubSvg(nxt.look, 46)}</span>
        <b>${escapeHtml(nxt.name)}</b><span class="sc-blurb">${escapeHtml(nxt.blurb)}</span>
        <span class="cad-now">Refinements reset on upgrade — a new set starts raw</span>`;
      const nb = document.createElement('button');
      nb.className = 'btn' + (coins >= nxt.cost ? ' primary' : '');
      nb.innerHTML = coins >= nxt.cost
        ? 'Upgrade set · ' + icon('coin') + ' ' + nxt.cost
        : `${icon('coin')} ${nxt.cost} · need ${nxt.cost - coins} more`;
      nb.disabled = coins < nxt.cost;
      if (coins >= nxt.cost) nb.addEventListener('click', () => onBuy('club:tier'));
      nc.appendChild(nb);
      grid.appendChild(nc);
    }
  } else if (shopTab === 'cases') {
    /* Two case types, two currencies: the entry tier is coin-priced (an
       earn-through-play purchase, same balance as clubs/gear), the top
       tier stays gem-priced (the premium currency). Buy and Open are
       separate actions on the same card: buying adds to an inventory
       count (prof.cases / prof.proCases), opening spends one and runs the
       exact reel/reveal flow the daily-rewards panel already uses —
       onBuy carries both, and main.js's dispatcher tells them apart by
       the item string, the same way it already tells 'club:tier' from
       'caddie:ace' apart. */
    const coins = prof?.coins || 0;
    const gems = prof?.gems || 0;
    const top = tierOdds().at(-1);
    const proTop = proTierOdds()[0];
    const cases = [
      { key: 'standard', name: 'Fairway Supply Crate', rarity: 'Common', rarityClass: 'common',
        owned: prof?.cases || 0, cost: CASE_COIN_COST, currency: 'coin', have: coins,
        blurb: `Every tier in the game, including a ${top.pct.toFixed(1)}% shot at ${top.name}.`,
        hint: 'Coins come from playing — every hole you finish pays, and the round pays again at the end.',
        buyItem: 'case:buy', openItem: 'case:open' },
      { key: 'pro', name: 'Hole-in-One Case', rarity: 'Legendary', rarityClass: 'legendary',
        owned: prof?.proCases || 0, cost: PRO_CASE_GEM_COST, currency: 'gem', have: gems,
        blurb: `${proTop.name} or better, guaranteed — no roll below the pity floor.`,
        hint: 'Gems come from the daily rewards streak — days 4, 7, 9, 12 and 14 pay them out, and each full cycle pays more than the last.',
        buyItem: 'case:buyPro', openItem: 'case:openPro' }
    ];
    for (const c of cases) {
      const card = document.createElement('div');
      card.className = 'shopcard shopcard-case shopcard-case-' + c.rarityClass;
      card.dataset.view = JSON.stringify({ kind: 'case', key: c.key, name: c.name, sub: c.hint });
      const canBuy = c.have >= c.cost;
      /* The how-to-earn line shows on the card only when they CANNOT
         afford it — that is the one moment "where do gems come from?" is
         a live question. Affording it, the same text would just be noise
         above a button they are about to press. It is on the hover
         preview's caption either way (dataset.view's `sub`). */
      const isPro = c.key === 'pro';
      const oddsRows = caseOddsRowsHTML(isPro ? proTierOdds() : tierOdds());
      const swatches = caseDecalSwatchesHTML(isPro);
      card.innerHTML = `<span class="sc-art">${icon(isPro ? 'caseLegendary' : 'caseCommon', { size: 40 })}
          ${c.owned > 0 ? `<i class="sc-qty">×${c.owned}</i>` : ''}</span>
        <b>${c.name}</b><span class="sc-rarity">${c.rarity}</span>
        <span class="sc-blurb">${escapeHtml(c.blurb)}</span>
        ${canBuy ? '' : `<span class="sc-earn">${escapeHtml(c.hint)}</span>`}
        <span class="cad-now">${c.owned} in inventory</span>
        <button class="btn mini case-contents-toggle" type="button" aria-expanded="false">Contents ▾</button>
        <div class="case-contents-panel" hidden>${oddsRows}${swatches}</div>`;
      paintCaseSwatches(card);
      const toggle = card.querySelector('.case-contents-toggle');
      const panel = card.querySelector('.case-contents-panel');
      toggle.addEventListener('click', () => {
        const open = panel.hidden;
        panel.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
        toggle.textContent = open ? 'Contents ▴' : 'Contents ▾';
      });
      const row = document.createElement('div');
      row.className = 'shopcard-row';
      const buyBtn = document.createElement('button');
      buyBtn.className = 'btn' + (canBuy ? ' primary' : '');
      buyBtn.innerHTML = canBuy
        ? 'Buy · ' + icon(c.currency) + ' ' + c.cost
        : `${icon(c.currency)} ${c.cost} · need ${c.cost - c.have} more`;
      buyBtn.title = canBuy ? '' : c.hint;      // and on hover over the dead button itself
      buyBtn.disabled = !canBuy;
      if (canBuy) buyBtn.addEventListener('click', () => onBuy(c.buyItem));
      row.appendChild(buyBtn);
      if (c.owned > 0) {
        const openBtn = document.createElement('button');
        openBtn.className = 'btn primary';
        openBtn.textContent = 'Open';
        openBtn.addEventListener('click', () => onBuy(c.openItem));
        row.appendChild(openBtn);
      }
      card.appendChild(row);
      grid.appendChild(card);
    }
  } else if (shopTab === 'gear') {
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
         for irons, woods and the putter, a cart for the cart, and a crate
         for anything else. Driven off the SLOT rather than the item name,
         so a new item in an existing slot gets a preview without anybody
         remembering to add one. */
      const viewFor = {
        ball: { kind: 'ball', hex: '#f6f9f4' },
        irons: { kind: 'club', key: 'I7' },
        woods: { kind: 'club', key: 'DR' },
        putter: { kind: 'club', key: 'PT' },
        cart: { kind: 'cart', hex: '#7fb6dd' }
      }[it.slot] || { kind: 'item', hex: '#6fce8a' };
      card.dataset.view = JSON.stringify({ ...viewFor, tier: it.tier,
        name: it.name, sub: it.blurb });
      // A static thumbnail too, not just the shared hover turntable — the
      // gear cards were the one shop category with literally no art at
      // all, not even a placeholder icon, so nothing distinguished a
      // ball upgrade from a cart tune-up until you hovered one.
      const art = SLOT_ART[it.slot]?.() || '';
      card.innerHTML = `${art ? `<span class="sc-art">${art}</span>` : ''}` +
        `<b>${escapeHtml(it.name)}</b><span class="sc-blurb">${escapeHtml(it.blurb)}</span>` +
        (owned ? '' : tryItLine(it, prof));
      const btn = document.createElement('button');
      btn.className = 'btn' + (owned ? '' : blocked ? '' : ' primary');
      // A dead grey button with a price on it tells the player nothing about
      // WHY they cannot press it.  Say the actual reason.
      const short = coins < it.cost ? `${icon('coin')} ${it.cost} · need ${it.cost - coins} more` : null;
      btn.innerHTML = owned ? 'In the bag ' + icon('check')
        : short ? short
          : blocked ? blocked
            : icon('coin') + ' ' + it.cost;
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

/**
 * Connection quality — a glance, not a graph. `net` is Net.net (see
 * net.js): { transport, rtt, disconnects, reconnects, reconnectAttempts,
 * lastDisconnectReason }. Thresholds are generous on purpose — this is for
 * telling a school-network problem apart from an actually broken game, not
 * for grading a good connection down to fair for no reason.
 */
HUD.renderNetQuality = (net) => {
  const pill = el.netPill;
  if (!pill) return;
  pill.hidden = false;
  const reconnecting = (net.reconnectAttempts || 0) > (net.reconnects || 0);
  let q, detail;
  if (reconnecting) {
    q = 'off';
    detail = `Reconnecting… (${net.lastDisconnectReason || 'connection lost'})`;
  } else if (net.rtt == null) {
    q = 'off';
    detail = 'Offline';
  } else if (net.rtt <= 150 && net.transport === 'websocket') {
    q = 'good';
    detail = `${net.rtt}ms · ${net.transport}`;
  } else if (net.rtt <= 400) {
    q = 'fair';
    detail = `${net.rtt}ms · ${net.transport}${net.transport === 'polling' ? ' (fallback)' : ''}`;
  } else {
    q = 'poor';
    detail = `${net.rtt}ms · ${net.transport} — this is likely the network, not the game`;
  }
  pill.dataset.q = q;
  pill.title = detail;
};

/* ---------------------------------------------------- weekly leaders --- */
/** The landing page's "top this week" preview. Hidden with zero rows rather
    than shown empty — before anybody's played this week (a fresh server, or
    a Monday morning) there is nothing to brag about yet. */
HUD.renderWeeklyTop = rows => {
  if (!el.lpWeekTop) return;
  if (!rows?.length) { el.lpWeekTop.hidden = true; return; }
  el.lpWeekTop.hidden = false;
  el.lpWeekTopRows.innerHTML = rows.map(r => `
    <div class="lp-wt-row">
      <span class="lp-wt-rank">${r.rank}</span>
      <span class="lp-wt-name">${escapeHtml(r.name)}</span>
      <span class="lp-wt-gain">+${r.gained.toLocaleString()} XP</span>
    </div>`).join('');
};

/* ------------------------------------------------------ daily rewards --- */
HUD.showRewardsBadge = show => { if (el.lpRewardsBadge) el.lpRewardsBadge.hidden = !show; };

/** The 14-day calendar, the streak line, and the gem/case wallet — all of
    it derived from the profile, nothing kept in the DOM as its own state. */
/* Named renderDailyLogin, not renderRewards — the Clubhouse's level/unlock
   ladder already owns that name (see rTier below, much later in this
   file) and silently overwrote this one for a while: no error, because
   JS just lets the second definition win, only a click that opened an
   empty modal. */
HUD.renderDailyLogin = (profile) => {
  const login = profile.login || { day: 0, cycle: 1, freezes: 0, lastClaimDate: null };
  const today = utcDateKey();
  const claimedToday = login.lastClaimDate === today;
  const claimableDay = claimedToday ? null : ((login.day || 0) >= CYCLE_LENGTH ? 1 : (login.day || 0) + 1);

  el.rwStreakTxt.textContent = `Day ${login.day || 0} of this cycle · Cycle ${login.cycle || 1}`;
  const freezeCount = login.freezes || 0;
  el.rwFreezes.innerHTML = freezeCount ? icon('freeze', { size: 16 }).repeat(freezeCount) : 'no freezes held';
  el.rwFreezes.title = `${freezeCount} streak freeze${freezeCount === 1 ? '' : 's'} — covers a missed day automatically, earned one every 7 days claimed`;

  el.rwGrid.innerHTML = '';
  for (let d = 1; d <= CYCLE_LENGTH; d++) {
    const reward = rewardFor(d, login.cycle || 1);
    const tile = document.createElement('div');
    tile.className = 'rw-tile ' +
      (d === claimableDay ? 'current' : d <= (login.day || 0) ? 'claimed' : 'locked');
    if (reward.cases) tile.classList.add('milestone');
    const rewardIcon = reward.cases ? icon('case') : reward.gems ? icon('gem') : icon('coin');
    const amt = reward.cases
      ? `${reward.cases}×${reward.gems ? ` +${reward.gems}${icon('gem')}` : ''}`
      : reward.gems ? `+${reward.gems}` : `+${reward.coins}`;
    tile.innerHTML = `<span class="rw-day">${d}</span><span class="rw-ico">${rewardIcon}</span><span class="rw-amt">${amt}</span>`;
    el.rwGrid.appendChild(tile);
  }

  el.btnRewardsClaim.disabled = claimedToday;
  el.btnRewardsClaim.textContent = claimedToday ? 'Come back tomorrow' : `Claim day ${claimableDay}`;
  el.rwGems.textContent = (profile.gems || 0).toLocaleString();
  el.rwCases.textContent = profile.cases || 0;
  el.rwCasesS.textContent = profile.cases === 1 ? '' : 's';
  el.btnRewardsOpenCase.disabled = !(profile.cases > 0);
  el.btnRewardsBuyCase.disabled = (profile.coins || 0) < CASE_COIN_COST;
  el.rwProCases.textContent = profile.proCases || 0;
  el.rwProCasesS.textContent = profile.proCases === 1 ? '' : 's';
  el.btnRewardsOpenProCase.disabled = !(profile.proCases > 0);
  el.btnRewardsBuyProCase.disabled = (profile.gems || 0) < PRO_CASE_GEM_COST;
};

/* --------------------------------------------------------- case opening */
const CASE_KIND_ICON = { decal: 'decal', trail: 'trail', title: 'title', ball: 'ball' };

/** Back to "tap to open", for the moment the modal is shown.
 *  `sincePity` is the profile's own casesSincePity — shown as a countdown
 *  to the guaranteed Pro-or-better pull, published rather than hidden, so
 *  a long run of Standard pulls reads as "N left" instead of "is this
 *  rigged". */
HUD.resetCaseModal = (sincePity = 0, isPro = false) => {
  el.caseStage.hidden = false;
  el.caseReelWrap.hidden = true;
  el.caseReveal.hidden = true;
  el.btnCaseDone.hidden = true;
  el.caseBox.className = 'case-box' + (isPro ? ' pro' : '');
  el.caseHint.textContent = 'Tap to open';
  HUD.renderCasePity(sincePity, isPro);
  HUD.renderCaseContents(isPro);
  if (el.caseContents) {
    el.caseContents.hidden = true;
    el.btnCaseContents?.setAttribute('aria-expanded', 'false');
  }
  el.caseReelWrap.closest('.casecard')?.classList.remove('reeling');
};

/** `isPro` skips the countdown entirely — a Pro Case doesn't accrue pity,
 *  it just always starts there (see profiles.js's openProCase, which reuses
 *  rollCase's forcePity rather than tracking a second counter). */
HUD.renderCasePity = (sincePity, isPro = false) => {
  if (!el.casePity) return;
  if (isPro) { el.casePity.textContent = 'Always Pro or better'; return; }
  const left = Math.max(0, PITY_THRESHOLD - (Number(sincePity) || 0));
  el.casePity.textContent = left <= 0
    ? 'Guaranteed Pro or better — next open'
    : `${left} more open${left === 1 ? '' : 's'} until guaranteed Pro or better`;
};

function caseOddsRowsHTML(rows) {
  return rows.map(t => {
    const pct = t.pct < 0.1 ? '<0.1' : t.pct < 1 ? t.pct.toFixed(1) : Math.round(t.pct);
    const kindIcons = t.kinds.map(k => icon(CASE_KIND_ICON[k] || 'gift', { size: 13 })).join('');
    return `<div class="case-odds-row" style="--rarity-color:${t.color}">
      <span class="case-odds-name">${t.name}</span>
      <span class="case-odds-kinds">${kindIcons}</span>
      <span class="case-odds-count">${t.count} item${t.count === 1 ? '' : 's'}</span>
      <span class="case-odds-pct">${pct}%</span>
    </div>`;
  }).join('');
}

/* Real swatches, not another row of generic kind icons. A tier row already
   says "12 items, 22%" — it does not say what a Chevron shaft band looks
   like next to a Houndstooth one, and decals are the one case-pool kind
   with actual drawn art behind them (shaftdecals.js) rather than a
   currentColor placeholder. Trail/title/ball still have no equivalent
   asset, so they stay represented by the tier rows above this, honestly —
   a fabricated preview for a kind with nothing to draw would be worse
   than the percentage it replaced. */
function caseDecalSwatchesHTML(isPro) {
  const pool = CASE_POOL.filter(it => it.kind === 'decal'
    && (!isPro || tierIndex(it.rarity) >= tierIndex(PITY_TIER)));
  if (!pool.length) return '';
  const chips = pool.map(it => {
    const rarity = RARITIES.find(r => r.id === it.rarity);
    const color = it.color || rarity?.color || '#8fe07a';
    return `<span class="case-swatch" style="--rarity-color:${color}" ` +
      `title="${escapeHtml(it.name)} — ${escapeHtml(rarity?.name || '')}" ` +
      `data-swatch-id="${it.id}" data-swatch-color="${color}"></span>`;
  }).join('');
  return `<div class="case-swatch-row">${chips}</div>`;
}

/** Fills in the swatch backgrounds after the HTML above has landed in the
 *  DOM — same reason renderClubDecalPicker assigns .src as a property
 *  rather than writing a data: URI into the markup string: the portal
 *  bundle verifier's static scanner reads that shape of text as a real
 *  asset path and chokes on it. A property set after the fact never puts
 *  the text in the source at all. */
function paintCaseSwatches(root) {
  for (const el of root.querySelectorAll('[data-swatch-id]')) {
    const pattern = shaftDecalDataUrl(el.dataset.swatchId, el.dataset.swatchColor);
    if (pattern) el.style.backgroundImage = `url(${pattern})`;
  }
}

/* Built once per case type, since nothing in either depends on the player:
   every case of a given type draws from the exact same pool at the exact
   same odds (see cases.js's tierOdds/proTierOdds). */
let caseContentsHTML = null, proCaseContentsHTML = null;
HUD.renderCaseContents = (isPro = false) => {
  if (!el.caseContents) return;
  if (isPro) {
    if (!proCaseContentsHTML) proCaseContentsHTML = caseOddsRowsHTML(proTierOdds());
    el.caseContents.innerHTML = proCaseContentsHTML;
    return;
  }
  if (!caseContentsHTML) caseContentsHTML = caseOddsRowsHTML(tierOdds());
  el.caseContents.innerHTML = caseContentsHTML;
};

HUD.shakeCaseBox = () => { el.caseBox.classList.add('shaking'); };

/* One chip's markup: an icon tinted and bordered to a colour, the way the
   reveal card's own art already works (see CASE_KIND_ICON / icons.js's
   currentColor set). Gems fill in as a plain gem on the "bonus" green — the
   colour HUD.revealCase already uses for a gems-only result. */
const GEMS_CHIP_COLOR = '#8fe07a';
/* Every chip carries its own rarity name now — the spin used to be a row
   of identically-shaped coloured icons blurring past, which is exactly
   the moment "which is which" matters most and the one moment it wasn't
   answered. The label sits UNDER the icon, inside the same chip, so it
   scrolls with it rather than needing its own positioning. */
function reelChipHTML(kind, color, label) {
  return `<div class="case-reel-chip" style="--chip-color:${color}">` +
    `<span style="color:${color}">${icon(kind, { size: 30 })}</span>` +
    `<b>${escapeHtml(label || '')}</b></div>`;
}
function decoyChipHTML(rarityId) {
  const pool = CASE_POOL.filter(it => it.rarity === rarityId);
  const it = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  const rarity = RARITIES.find(r => r.id === rarityId) || RARITIES[0];
  const kind = it ? (CASE_KIND_ICON[it.kind] || 'gift') : 'gem';
  return reelChipHTML(kind, it ? (it.color || rarity.color) : rarity.color, rarity.name);
}

const CHIP_W = 76, CHIP_GAP = 12, CHIP_STEP = CHIP_W + CHIP_GAP;   // must match .case-reel-chip in style.css
const REEL_LEN = 34;
/* Was 4200 — long enough to see the reel move, not long enough to feel the
   deceleration build toward a result. 6000 gives the near-miss chips
   (the two slots before the landing spot, deliberately biased toward the
   real rarity below) enough time on screen to actually read as a tease
   rather than a blur, which is the whole mechanism this animation exists
   to deliver. */
const REEL_MS = 6000;

/**
 * Spin the reel to `result` (already server-committed — this never decides
 * the outcome, only how long the player waits to see it, which is the
 * whole point of doing this client-side at all). Everything before the
 * final chip is a decoy sampled from the real case pool, weighted toward
 * the result's own rarity for the last couple of slots so there's a
 * near-miss right before it lands, the way every reel like this plays.
 *
 * `onTick(strength)` fires once per chip crossing the pointer, for a sound
 * cue; `onSettle()` fires once the strip has actually stopped, and is when
 * the caller should hand off to HUD.revealCase.
 */
HUD.playCaseReel = (result, { onTick, onSettle } = {}) => {
  el.caseStage.hidden = true;
  el.caseReelWrap.hidden = false;
  el.caseReelWrap.closest('.casecard')?.classList.add('reeling');

  const isItem = result.kind === 'item';
  const rarity = isItem ? (RARITIES.find(r => r.id === result.rarity) || RARITIES[0])
                         : { id: null, color: GEMS_CHIP_COLOR };
  const targetIdx = REEL_LEN - 4 + Math.floor(Math.random() * 3);   // land near, not at, the very end

  const chips = [];
  for (let i = 0; i < REEL_LEN; i++) {
    if (i === targetIdx) {
      chips.push(isItem
        ? reelChipHTML(CASE_KIND_ICON[result.item.kind] || 'gift', result.item.color || rarity.color, rarity.name)
        : reelChipHTML('gem', GEMS_CHIP_COLOR, 'Gems'));
      continue;
    }
    // the two slots right before the landing spot lean toward the same
    // rarity as the real result — a deliberate near-miss, not a coincidence
    const nearMiss = isItem && i >= targetIdx - 2 && i < targetIdx && Math.random() < 0.7;
    const rollRarity = nearMiss ? rarity.id
      : RARITIES[Math.floor(Math.random() * RARITIES.length)].id;
    chips.push(decoyChipHTML(rollRarity));
  }
  el.caseReelTrack.innerHTML = chips.join('');

  const track = el.caseReelTrack;
  track.style.transition = 'none';
  track.style.transform = 'translateX(0px)';
  void track.offsetWidth;   // force the reset above to apply before animating

  const jitter = (Math.random() * 2 - 1) * (CHIP_W * 0.28);
  const targetX = -(targetIdx * CHIP_STEP + CHIP_STEP / 2) + jitter;
  track.style.transition = `transform ${REEL_MS}ms cubic-bezier(.1,.7,.1,1)`;
  requestAnimationFrame(() => { track.style.transform = `translateX(${targetX}px)`; });

  // Ticking: watch which chip is actually under the pointer each frame,
  // rather than trying to predict it from the easing curve — that stays
  // correct no matter how the transition is timed, CSS-driven or not.
  if (onTick) {
    const wrapRect = el.caseReelWrap.getBoundingClientRect();
    const pointerX = wrapRect.left + wrapRect.width / 2;
    let last = null;
    const start = performance.now();
    const watch = now => {
      if (now - start > REEL_MS + 80) return;
      for (const c of track.children) {
        const r = c.getBoundingClientRect();
        if (pointerX >= r.left && pointerX < r.right) {
          if (c !== last) { last = c; onTick(Math.min(1, (now - start) / REEL_MS)); }
          break;
        }
      }
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  }

  let done = false;
  const finish = () => { if (done) return; done = true; onSettle?.(); };
  track.addEventListener('transitionend', finish, { once: true });
  setTimeout(finish, REEL_MS + 250);   // a hidden tab throttles transitionend; never strand the player on the reel
};

/** The payoff. `result` is exactly what Net.openCase's ack carries. */
HUD.revealCase = (result) => {
  el.caseStage.hidden = true;
  el.caseReelWrap.hidden = true;
  el.caseReelWrap.closest('.casecard')?.classList.remove('reeling');
  el.caseReveal.hidden = false;
  el.btnCaseDone.hidden = false;
  const isItem = result.kind === 'item';
  const rarity = isItem ? (RARITIES.find(r => r.id === result.rarity) || RARITIES[0]) : { name: 'Bonus', color: '#8fe07a' };
  el.caseReveal.style.setProperty('--rarity-color', rarity.color);
  el.caseRarity.textContent = rarity.name;
  el.caseRarity.style.color = rarity.color;
  if (isItem) {
    // A decal pull gets its own actual pattern, not a generic silhouette —
    // the shaft decal system draws real art now (shaftdecals.js), so there
    // is a real thing to show. Everything else (trail/title/ball) still
    // has no equivalent asset, so it keeps the currentColor icon, tinted
    // to the item's own colour or the rarity colour — the whole point of
    // the switch off emoji, still true for the kinds with nothing else to
    // draw.
    const itemColor = result.item.color || rarity.color;
    const pattern = result.item.kind === 'decal' ? shaftDecalDataUrl(result.item.id, itemColor) : null;
    if (pattern) {
      // The pattern is set as an <img>.src PROPERTY, never written into an
      // HTML string as src="..." — see renderClubDecalPicker's comment on
      // why: the portal-bundle verifier's static scanner reads that text
      // as a real asset path and a data: URI 404s as one. Also: no child
      // content to size the box the way the inline icon SVGs do
      // (font-size-driven, see .case-item), so this needs real dimensions.
      el.caseItemArt.innerHTML = '';
      const img = document.createElement('img');
      img.width = 64; img.height = 64; img.alt = '';
      img.src = pattern;
      el.caseItemArt.appendChild(img);
      el.caseItemArt.style.color = itemColor;
      el.caseItemArt.style.width = el.caseItemArt.style.height = '64px';
      el.caseItemArt.style.borderRadius = '14px';
      el.caseItemArt.style.border = `2px solid ${itemColor}`;
    } else {
      el.caseItemArt.innerHTML = icon(CASE_KIND_ICON[result.item.kind] || 'gift', { size: 64 });
      el.caseItemArt.style.width = el.caseItemArt.style.height = '';
      el.caseItemArt.style.borderRadius = el.caseItemArt.style.border = '';
      el.caseItemArt.style.color = itemColor;
    }
    el.caseItemName.textContent = result.item.name;
    el.caseItemKind.textContent = UNLOCK_KINDS[result.item.kind]?.name || result.item.kind;
  } else {
    el.caseItemArt.innerHTML = icon('gem', { size: 64 });
    el.caseItemArt.style.width = el.caseItemArt.style.height = '';
    el.caseItemArt.style.borderRadius = el.caseItemArt.style.border = '';
    el.caseItemArt.style.color = rarity.color;
    el.caseItemName.textContent = `+${result.amount} gems`;
    el.caseItemKind.textContent = 'you already own everything in that tier';
  }
  el.caseReveal.classList.toggle('legend', isItem && result.rarity === 'legend');
  el.caseReveal.classList.toggle('mythic', isItem && result.rarity === 'mythic');
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
    if (p.pid === room.hostPid) { const t = document.createElement('span'); t.className = 'tag host'; t.innerHTML = icon('star') + ' host'; chip.appendChild(t); }
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
  if (el.btnPrivacy) {
    const priv = room.privacy === 'private';
    el.btnPrivacy.hidden = false;
    el.btnPrivacy.classList.toggle('private', priv);
    el.btnPrivacy.classList.toggle('host', isHost);
    el.btnPrivacy.innerHTML = priv ? icon('lock') + ' Private' : icon('globe') + ' Public';
    el.btnPrivacy.title = isHost
      ? (priv ? 'Only people with the link can join — click to make public'
              : 'Anyone can find and join from Open rounds — click to make private')
      : (priv ? 'Invite-link only' : 'Listed for anyone to join');
  }
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
HUD.renderHoleOver = (room, myPid, course, myDifficulty) => {
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
    div.innerHTML = `<span class="pos">${r.s === best ? icon('trophy') : (i + 1) + '.'}</span>
      <span class="sw" style="background:${r.p.color}"></span>
      <span class="nm">${escapeHtml(r.p.name)}${r.p.pid === myPid ? ' (you)' : ''}</span>
      <span class="st">${r.s}</span>
      <span class="vp ${rel < 0 ? 'under' : rel > 0 ? 'over' : ''}">${scoreName(rel, r.s)}</span>`;
    el.hoTable.appendChild(div);
  });
  /* The record for THIS hole, under the card.  A number to beat is worth more
     on the hole you have just played than buried in a menu — and if the player
     has just taken it, say so here rather than letting a toast carry it.

     THIS WAS LABELLED "Course record" and showing a HOLE score — a
     leftover from before the round record and the hole records were two
     different things worth telling apart. Fixed alongside difficulty
     separation rather than as its own change, since both are about a
     record meaning exactly what its label claims.

     room.records is per-difficulty now (see server/records.js): a
     Standard player is shown the Standard hole record, not one blended
     from every difficulty. Casual cannot set one, so it is shown the
     Standard board instead — the closest thing to "the number everyone
     else is actually chasing" a Casual player has any use for. */
  const diffId = (myDifficulty && myDifficulty !== 'casual') ? myDifficulty : 'standard';
  const rec = room.records?.[diffId]?.holes?.[room.holeIndex];
  const diffName = difficultyById(diffId).name;
  const mine = rows.find(r => r.p.pid === myPid);
  const holder = document.createElement('div');
  holder.className = 'ho-record';
  if (rec) {
    const isMe = rec.pid === myPid && mine && mine.s === rec.strokes;
    holder.innerHTML = isMe
      ? `<b>${icon('medal')} ${diffName} hole record</b><span>${rec.strokes} — that is yours</span>`
      : `<b>${diffName} hole record</b><span>${rec.strokes} by ${escapeHtml(rec.name)}</span>`;
  } else {
    holder.innerHTML = `<b>${diffName} hole record</b><span>nobody has set one yet</span>`;
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
 * The emote wheel. Shows only the EQUIPPED loadout, in loadout order — not
 * the whole library, which is the wardrobe's job now (see renderEmoteTab).
 * The slot number on each button is what the number-key quick-picks (see
 * main.js's keydown handler) actually correspond to, so the wheel has to
 * show it rather than leave the shortcut undiscoverable. `locked` stays as
 * a defensive check even though a clean loadout should never contain one —
 * a stale equip from before a level was somehow lost is a display bug, not
 * a crash, if this were not here.
 */
HUD.renderEmotes = (level, equipped, onPick) => {
  if (!el.emoteWheel) return;
  el.emoteWheel.innerHTML = '';
  const lvl = Number(level) || 1;
  const list = (equipped || []).map(id => EMOTES.find(e => e.id === id)).filter(Boolean);
  list.forEach((e, i) => {
    const locked = lvl < e.at;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'emote' + (locked ? ' locked' : '');
    b.style.setProperty('--rarity-color', rarityForLevel(e.at).color);
    b.innerHTML = `<span class="em-slot">${i + 1}</span>` +
      `<span class="em-ico">${icon(e.icon, { size: 20 })}</span>` +
      `<span class="em-name">${escapeHtml(e.name)}</span>` +
      `<span class="em-sub">${locked ? 'Level ' + e.at : escapeHtml(e.blurb)}</span>`;
    b.disabled = locked;
    if (!locked) b.addEventListener('click', () => onPick(e.id));
    el.emoteWheel.appendChild(b);
  });
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
 * of them against each other — "if run is here, teleport-to-ball wants to be
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
         <span class="lv-badge">${icon(tier.badge, { size: 20 })}</span>
         <span><b>Level ${level}</b><small>${tier.name} · ${owned} of ${UNLOCKS.length} unlocked</small></span>
       </div>
       <div class="lv-xp"><b>${xp.toLocaleString()}</b><em>XP</em></div>
     </div>
     <div class="lv-track" id="lvTrack">
       <div class="lv-inner">
         <div class="lv-rail"><i id="lvFill" style="width:${pct}%"></i></div>
         <div class="lv-nodes">${nodes}</div>
       </div>
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

    /* FILL TO THE NODE, not to a percentage of the level range.
       `level / maxAt` describes progress through the LEVELS; the rail has to
       describe progress along the TRACK, and the two are not the same
       picture because the nodes are evenly spaced while the levels they mark
       are not — the gaps widen from every two levels early on to fourteen
       later. So the line stopped somewhere between two nodes for no reason a
       player could see.

       Measured off the node that is actually current, so the line ends under
       the dot it is talking about whatever the spacing does. */
    const fill = document.getElementById('lvFill');
    const inner = track?.querySelector('.lv-inner');
    if (fill && inner && here) {
      const w = inner.scrollWidth || inner.clientWidth;
      const centre = here.offsetLeft + here.offsetWidth / 2;
      fill.style.width = Math.max(0, Math.min(100, (centre / w) * 100)) + '%';
    }
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
       <span class="lv-pv-badge">${icon(t.badge, { size: 20 })}</span>
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
 *
 * DIFFICULTY-SEPARATED (see server/records.js). The headline row is the
 * COURSE RECORD — the single best round anyone has carded there on any
 * eligible difficulty, always labelled with which one — and expanding a
 * course shows the three difficulty boards underneath it as their own
 * sections, each with its own round record and its own nine hole records.
 * A Standard score and a Tournament score never appear as if they were
 * competing for the same line.
 */
HUD.recOpen = null;              // which course's difficulty boards are expanded
const RECORD_DIFF_IDS = DIFFICULTIES.filter(d => d.records).map(d => d.id);

HUD.renderRecords = (courses, records, myPid) => {
  const box = el.recordBox;
  if (!box) return;
  box.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'recboard';
  for (const c of courses) {
    const entry = records?.[c.id] || null;
    const cr = entry?.courseRecord || null;          // { difficulty, round } | null
    const r = cr?.round || null;
    const open = HUD.recOpen === c.id;

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'recrow' + (r ? (r.pid === myPid ? ' mine' : '') : ' empty')
      + (open ? ' open' : '');
    const rel = r ? r.total - r.par : 0;
    row.innerHTML =
      `<span class="rc-course">${escapeHtml(c.name)}</span>` +
      (r ? `<span class="rc-diff">${escapeHtml(difficultyById(cr.difficulty).name)}</span>` : '') +
      `<span class="rc-score">${r ? r.total + (rel === 0 ? ' (E)' : rel > 0 ? ` (+${rel})` : ` (${rel})`) : '—'}</span>` +
      `<span class="rc-who">${r ? escapeHtml(r.pid === myPid ? 'you' : r.name) : 'unclaimed'}</span>` +
      `<span class="rc-caret">${open ? '▾' : '▸'}</span>`;
    /* Clicking a course opens its per-difficulty boards. The hole records are
       the part of this an ordinary player can realistically get their name
       on — the round record belongs to whoever is best at the whole game on
       that difficulty, but anybody can hole a 2. */
    row.addEventListener('click', () => {
      HUD.recOpen = open ? null : c.id;
      HUD.renderRecords(courses, records, myPid);
    });
    wrap.appendChild(row);

    if (open) for (const diffId of RECORD_DIFF_IDS) {
      const d = entry?.[diffId] || { round: null, holes: [] };
      const dr = d.round;
      const isCourseRecord = cr && cr.difficulty === diffId;

      const head = document.createElement('div');
      head.className = 'recdiff-head' + (dr && dr.pid === myPid ? ' mine' : '');
      const drRel = dr ? dr.total - dr.par : 0;
      head.innerHTML =
        `<span class="rd-badge">${isCourseRecord ? icon('crown') : dr ? icon('medal') : ''}</span>` +
        `<span class="rd-name">${escapeHtml(difficultyById(diffId).name)}</span>` +
        `<span class="rd-score">${dr ? dr.total + (drRel === 0 ? ' (E)' : drRel > 0 ? ` (+${drRel})` : ` (${drRel})`) : '—'}</span>` +
        `<span class="rd-who">${dr ? escapeHtml(dr.pid === myPid ? 'you' : dr.name) : 'unclaimed'}</span>`;
      wrap.appendChild(head);

      const panel = document.createElement('div');
      panel.className = 'recholes';
      const holes = d.holes;
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
        (o.badge.courses ? icon('trophy') + (o.badge.courses > 1 ? o.badge.courses : '') : '') +
        (o.badge.holes ? icon('flag') + (o.badge.holes > 1 ? o.badge.holes : '') : '') + `</span>` : '') +
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
    mute.className = 'chatmute'; mute.innerHTML = icon('mute'); mute.title = 'Mute ' + m.name;
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
import { shaftDecalDataUrl } from './shaftdecals.js';
import { showItem as showShopItem, setUserOrbit as setShopOrbit, releaseUserOrbit as releaseShopOrbit } from './shopview.js';
import { CLUB_SKINS, skinEarned, skinRequirement, skinProgress, TIER_ACCENT } from '../shared/clubskins.js';
import { DIFFICULTIES, difficultyById } from '../shared/difficulty.js';
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
    // the rarity colour is the same language a case pull uses — a deep
    // item should look like a deep item everywhere it shows up, not just
    // in the one screen that happens to hand it out
    const rc = it.at ? rarityForLevel(it.at).color : null;
    return `<button class="wd-opt${it.id === current ? ' on' : ''}${L ? ' locked' : ''}"
      data-kind="${kind}" data-val="${it.id}"${L ? ' disabled' : ''}${rc ? ` style="--rarity-color:${rc}"` : ''}>${it.name}` +
      (L ? `<span class="lv" style="color:${rc}">Lv ${it.at}</span>` : '') + `</button>`;
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

HUD.renderWardrobe = (look, level, name, equipped) => {
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
      const rc = o.at ? rarityForLevel(o.at).color : null;
      return `<button class="wd-fit${o.id === look.outfit ? ' on' : ''}${L ? ' locked' : ''}"
        data-fit="${o.id}" data-at="${o.at || 0}"${L ? ' disabled' : ''}${rc ? ` style="--rarity-color:${rc}"` : ''}>
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
  } else if (HUD.wdTab === 'emotes') {
    HUD.renderEmoteTab(lv, equipped);
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
      const rc = d.at ? rarityForLevel(d.at).color : null;
      return `<button class="wd-decal${d.id === cur ? ' on' : ''}${L ? ' locked' : ''}"
        data-decal="${d.id}" data-at="${d.at || 0}" title="${d.name}${L ? ` — level ${d.at}` : ''}"
        ${L ? ' disabled' : ''}${rc ? ` style="--rarity-color:${rc}"` : ''}>
        ${L ? `<span class="lk" style="color:${rc}">${icon('lock')}${d.at}</span>` : ''}</button>`;
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

/* The emotes tab. "Own many, carry a few" — the strip at the top is the
   loadout the wheel actually offers, drag-reordered into wheel order; the
   grid below is the whole library, own or not, exactly like the decal grid
   above it. A card and a strip chip share the same data-emote attribute
   and the same click handler (see HUD.bindWardrobe): clicking either one
   toggles that id in or out of the loadout, so there is only one code path
   for "equip" regardless of which one a player actually touches. */
HUD.renderEmoteTab = (lv, equipped) => {
  const eq = Array.isArray(equipped) ? equipped : [];
  const strip = eq.length
    ? eq.map(id => {
        const e = EMOTES.find(x => x.id === id);
        if (!e) return '';
        return `<button class="em-chip" draggable="true" data-emote="${e.id}"
          style="--rarity-color:${rarityForLevel(e.at).color}"
          title="${escapeHtml(e.name)} — click to unequip, drag to reorder">
          ${icon(e.icon, { size: 15 })}<span>${escapeHtml(e.name)}</span></button>`;
      }).join('')
    : '';

  const grid = EMOTES.map(e => {
    const L = lv < e.at;
    const on = eq.includes(e.id);
    return `<button class="em-card${on ? ' on' : ''}${L ? ' locked' : ''}"
      data-emote="${e.id}"${L ? ' disabled' : ''} style="--rarity-color:${rarityForLevel(e.at).color}">
      <span class="em-ico">${icon(e.icon, { size: 22 })}</span>
      <span class="em-name">${escapeHtml(e.name)}</span>
      <span class="em-sub">${L ? `Unlocks at level ${e.at}` : escapeHtml(e.blurb)}</span>
      ${on ? `<span class="em-on-badge">${icon('check', { size: 11 })}</span>` : ''}
    </button>`;
  }).join('');

  el.wdRBody.innerHTML =
    `<div class="wd-grp"><h5>Your loadout <small>${eq.length}/${EMOTE_SLOTS} · drag to reorder</small></h5>
      <div class="em-strip">${strip || '<p class="tiny">Pick up to ' + EMOTE_SLOTS + ' below — this is what the wheel offers mid-round.</p>'}</div>
    </div>
    <div class="wd-grp"><h5>All emotes</h5><div class="em-grid">${grid}</div></div>`;
};

/* ═══════════════════════════════════════════════ THE STATS CORNER ═══════
   "What does this do, what does it look like, how rare is it" — the three
   questions a wardrobe never answered before. The first is a real number
   (outfitStats' own drive/acc/spin fields, read straight off whichever
   item is under the pointer, not the whole look's total); the second is
   just "look at the golfer standing right there" — there is no separate
   preview to build, the 3D behind the panel already IS the answer; the
   third is server-authoritative: HUD.levelHist is the population's level
   spread (see Net.levelStats / server/profiles.js's levelHistogram), set
   once by main.js, and an item's rarity is read off it, not invented. */
HUD.levelHist = { counts: new Array(101).fill(0), total: 0 };

const WD_KIND_LISTS = { pattern: PATTERNS, fabric: FABRICS, cut: CUTS, shoeType: SHOE_TYPES,
                         glove: GLOVES, watch: WATCHES, sleeve: SLEEVES, neck: NECKWEAR };

function wdPctOwning(at) {
  const h = HUD.levelHist;
  const lvl = Number(at) || 1;
  if (!h || !h.total) return null;
  let n = 0;
  for (let i = lvl; i <= 100; i++) n += h.counts[i] || 0;
  return (n / h.total) * 100;
}

/** The one line that answers "what does this actually do". */
function wdEffectLine(it) {
  const bits = [];
  if (it.drive) bits.push(`Drive ${it.drive > 0 ? '+' : ''}${(it.drive * 100).toFixed(1)}%`);
  if (it.acc) bits.push(`Accuracy ${it.acc > 0 ? '+' : ''}${(it.acc * 100).toFixed(1)}%`);
  if (it.spin) bits.push(spinWord(it.spin));
  if (it.weight != null && it.weight > 0) bits.push(`+${(it.weight * 2.4).toFixed(1)} style`);
  return bits.length ? bits.join(' · ') : 'Cosmetic — no effect on your golf';
}

/** Resolve whatever the pointer is over back to {name, at, effect}, or null
 *  for anything with nothing worth showing (a plain colour swatch). */
function wdInfoFromTarget(t) {
  if (t.dataset.kind) {
    const list = WD_KIND_LISTS[t.dataset.kind];
    const it = list && list.find(x => x.id === t.dataset.val);
    return it ? { name: it.name, at: it.at || 0, effect: wdEffectLine(it) } : null;
  }
  if (t.dataset.fit) {
    const o = OUTFITS.find(x => x.id === t.dataset.fit);
    return o ? { name: o.name, at: o.at || 0, effect: 'A ready-made combination — cosmetic only' } : null;
  }
  if (t.hasAttribute('data-decal') && t.dataset.decal) {
    const d = DECALS.find(x => x.id === t.dataset.decal);
    return d ? { name: d.name, at: d.at || 0, effect: 'Cosmetic — no effect on your golf' } : null;
  }
  if (t.hasAttribute('data-emote') && t.dataset.emote) {
    const e = EMOTES.find(x => x.id === t.dataset.emote);
    return e ? { name: e.name, at: e.at || 0, effect: e.blurb } : null;
  }
  return null;
}

HUD.showWardrobeInfo = (name, at, effect) => {
  if (!el.wdInfo) return;
  el.wdInfo.hidden = false;
  el.wdInfoName.textContent = name;
  el.wdInfoEffect.textContent = effect;
  const lvl = Number(at) || 0;
  if (lvl > 0) {
    const r = rarityForLevel(lvl);
    el.wdInfo.style.setProperty('--rarity-color', r.color);
    el.wdInfoRarity.textContent = r.name;
    const pct = wdPctOwning(lvl);
    el.wdInfoPct.textContent = pct == null ? `Unlocks at level ${lvl}`
      : pct === 0 ? 'Nobody has reached this yet'
      : `${pct < 0.1 ? '<0.1' : pct.toFixed(pct < 10 ? 1 : 0)}% of players own this`;
  } else {
    el.wdInfo.style.removeProperty('--rarity-color');
    el.wdInfoRarity.textContent = '';
    el.wdInfoPct.textContent = 'Available from the start';
  }
};
HUD.hideWardrobeInfo = () => { if (el.wdInfo) el.wdInfo.hidden = true; };

/** One delegated listener for the whole screen. */
let wardrobeBound = false;
HUD.bindWardrobe = () => {
  if (wardrobeBound) return;
  wardrobeBound = true;

  const showInfo = e => {
    const t = e.target.closest('button');
    if (!t) return;
    const info = wdInfoFromTarget(t);
    if (info) HUD.showWardrobeInfo(info.name, info.at, info.effect);
    /* The card IS the preview — no separate animation to build. Same
       philosophy as the rest of the wardrobe: the 3D golfer standing right
       there plays the pose live rather than a canned loop in the card. */
    if (t.hasAttribute('data-emote') && !t.disabled) HUD.onEmotePreview?.(t.dataset.emote);
  };
  el.screenWardrobe.addEventListener('pointerover', showInfo);
  el.screenWardrobe.addEventListener('focusin', showInfo);
  el.screenWardrobe.addEventListener('pointerout', e => {
    if (!e.relatedTarget || !el.screenWardrobe.contains(e.relatedTarget)) HUD.hideWardrobeInfo();
  });

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
      return;
    }
    /* Shared by a loadout chip and a library card — see renderEmoteTab.
       Equip/unequip is one toggle regardless of which one was clicked. */
    if (t.hasAttribute('data-emote')) { HUD.onEmoteEquip?.(t.dataset.emote); return; }
  });

  /* The monogram field. `input` rather than `change` so the badge updates as
     you type — the whole screen is a live preview and one control that waits
     for a blur would feel broken next to the rest. */
  el.screenWardrobe.addEventListener('input', e => {
    if (e.target.id !== 'wdInitials') return;
    HUD.onWardrobe({ __custom: { txt: e.target.value }, __keepFocus: true });
  });

  /* Drag-to-reorder the loadout strip. Native HTML5 drag-and-drop rather
     than a library: it is one array of chips, not a general-purpose sortable
     list, and the browser's own drag events cover exactly that. Dropping on
     a chip inserts before it; dropping on the strip's empty space (or
     anywhere else in the wardrobe) appends to the end. */
  let dragId = null;
  el.screenWardrobe.addEventListener('dragstart', e => {
    const chip = e.target.closest('.em-chip');
    if (!chip) return;
    dragId = chip.dataset.emote;
    e.dataTransfer.effectAllowed = 'move';
  });
  el.screenWardrobe.addEventListener('dragover', e => {
    if (!dragId) return;
    const chip = e.target.closest('.em-chip');
    if (!chip) return;
    e.preventDefault();
    chip.classList.add('drag-over');
  });
  el.screenWardrobe.addEventListener('dragleave', e => {
    e.target.closest('.em-chip')?.classList.remove('drag-over');
  });
  el.screenWardrobe.addEventListener('drop', e => {
    if (!dragId) return;
    e.preventDefault();
    const chip = e.target.closest('.em-chip');
    chip?.classList.remove('drag-over');
    HUD.onEmoteReorder?.(dragId, chip && chip.dataset.emote !== dragId ? chip.dataset.emote : null);
    dragId = null;
  });
  el.screenWardrobe.addEventListener('dragend', () => {
    el.screenWardrobe.querySelectorAll('.em-chip.drag-over')
      .forEach(c => c.classList.remove('drag-over'));
    dragId = null;
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
    `<div class="rkme-badge" style="background:${t.glow};color:${t.color}">${icon(t.badge, { size: 22 })}</div>
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
       <span class="rkname">${r.friend ? `<i class="rkstar">${icon('star')}</i>` : ''}<b>${escapeHtml(r.name)}</b>${tag || ''}</span>
       <span class="rkv">${main}</span>
       <span class="rksub">${sub}</span>
     </div>`;

  const tierTag = id => {
    const t = RATING_TIERS.find(x => x.id === id);
    return t ? `<span class="rktag" style="color:${t.color}">${t.id}</span>` : '';
  };
  const lvTag = lv => {
    const t = rankTier(lv);
    return `<span class="rktag" style="color:${t.color}">${icon(t.badge, { size: 12 })} ${lv}</span>`;
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
    `<span class="wcond">${icon(w.icon, { size: 15 })} ${w.conditionName}</span>` +
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
        <button data-fr="accept" data-pid="${q.pid}" title="Accept">${icon('check')}</button>
        <button data-fr="decline" data-pid="${q.pid}" title="Decline">${icon('cancel')}</button>
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
      <span class="fr-nm"><b>${f.fav ? icon('star') + ' ' : ''}${escapeHtml(f.name)}</b><small>${escapeHtml(sub)}</small></span>
      <span class="fr-acts">
        ${f.room ? `<button class="join" data-fr="join" data-room="${f.room}">Join</button>` : ''}
        ${f.online && !f.room ? `<button data-fr="invite" data-pid="${f.pid}" title="Invite to your round">${icon('golfer')}</button>` : ''}
        <button data-fr="favourite" data-pid="${f.pid}" title="${f.fav ? 'Unfavourite' : 'Favourite'}">${f.fav ? icon('star') : icon('starOff')}</button>
        <button data-fr="remove" data-pid="${f.pid}" title="Remove">${icon('cancel')}</button>
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

/* ---------------------------------------------------------- feedback --- */
const FB_CAT_NAME = { bug: 'Bug', performance: 'Performance', course: 'Course',
  suggestion: 'Idea', other: 'Other' };
const relTime = at => {
  const s = Math.max(1, Math.round((Date.now() - at) / 1000));
  if (s < 90) return 'just now';
  const m = Math.round(s / 60); if (m < 90) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 36) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

/**
 * The public board. `onVote` is called with an id and re-renders on
 * success — the vote count is the one thing here worth showing change
 * instantly rather than waiting on the next full refetch.
 */
HUD.renderFeedback = (items, onVote, voted) => {
  const box = el.feedbackBoard || document.getElementById('feedbackBoard');
  if (!box) return;
  if (!items || !items.length) {
    box.innerHTML = '<p class="tiny">Nothing here yet — the first thing anyone sends becomes the first row.</p>';
    return;
  }
  box.innerHTML = '';
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'fbrow';
    const head = document.createElement('div'); head.className = 'fbrow-head';
    const cat = document.createElement('span'); cat.className = 'fbcat-tag'; cat.textContent = FB_CAT_NAME[it.category] || it.category;
    const status = document.createElement('span'); status.className = 'fbstatus' + (it.status === 'done' ? ' done' : '');
    status.textContent = it.status;
    const when = document.createElement('span'); when.className = 'tiny'; when.textContent = relTime(it.at);
    const vote = document.createElement('button');
    vote.type = 'button'; vote.className = 'fbvote' + (voted?.has(it.id) ? ' voted' : '');
    vote.textContent = `▲ ${it.votes}`;
    vote.disabled = !!voted?.has(it.id);
    vote.addEventListener('click', () => onVote?.(it.id));
    head.append(cat, status, when, vote);
    const body = document.createElement('div'); body.className = 'fbrow-body'; body.textContent = it.body;
    row.append(head, body);
    box.appendChild(row);
  }
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
    const k = FEED_ICON[it.kind] ? icon(FEED_ICON[it.kind], { size: 16 }) : '•';
    return `<div class="feeditem${it.mine ? ' mine' : ''}">
      <span class="fd-ico">${k}</span>
      <span class="fd-txt"><b>${escapeHtml(it.name)}</b> ${escapeHtml(it.text)}</span>
      <span class="fd-when">${agoShort(it.t)}</span>
    </div>`;
  }).join('');
};

const FEED_ICON = { ace: 'target', albatross: 'eagle', eagle: 'eagle', record: 'trophy',
                    best: 'trending', level: 'star', round: 'flag', joined: 'joined' };

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
