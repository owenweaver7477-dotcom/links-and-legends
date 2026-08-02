/* =========================================================================
   hud.js — every bit of DOM. No game logic lives here.
   ========================================================================= */

import { CARRY, CLUBS, CLUB_BY_KEY, BAG_SIZE, DEFAULT_BAG } from '../shared/clubs.js';
import { HOLES_PER_COURSE, BALL_COLORS } from '../shared/biomes.js';
import { CAPS, SHIRTS, SKINS, TROUSERS, HAIR_COLORS, SHOES,
         HAT_STYLES, HAIR_STYLES, ACCESSORIES } from '../shared/avatars.js';
import { SHOP, purchaseBlocked } from '../shared/gear.js';
import { CADDIES, CADDIE_MAX, caddieCost, CLUB_TIERS, REFINE_COSTS } from '../shared/crew.js';
import { toYards, clamp } from '../shared/rng.js';
import { ShotSim, makeFlatRange } from '../shared/ballistics.js';

const $ = id => document.getElementById(id);
const el = {};
for (const id of [
  'screenHome', 'screenLobby', 'screenResults', 'screenLoad', 'screenHoleOver', 'screenShop',
  'btnClubhouse', 'btnShopBack', 'homeCoins',
  'homeErr', 'inpName', 'inpCode', 'loadMsg',
  'lobbyCode', 'lobbyLink', 'lobbyPlayers', 'lobbyCount', 'lobbyNote', 'btnStart', 'courseList',
  'hCourse', 'hNum', 'hPar', 'hMeta', 'dYds', 'dLie', 'dElev',
  'wArrow', 'wSpeed', 'wDesc',
  'boardRows', 'boardRoom', 'turnbar', 'tbText', 'tbDot',
  'playbar', 'clubName', 'clubCarry', 'clubUp', 'clubDown', 'mFill', 'mFaceDot', 'mLabel', 'aimTxt', 'mPct',
  'shotinfo', 'toasts', 'mapwrap', 'mapc', 'minic', 'miniPanel',
  'hoTitle', 'hoSub', 'hoTable', 'hoNote', 'btnNext',
  'teeList', 'ballColours', 'bagList', 'bagCount', 'btnBagReset', 'optMetres',
  'cartKmh', 'dialFill', 'dialNeedle', 'cartDamage', 'cartDamageTxt', 'mFace', 'touchPad',
  'coinHud', 'coinHudN',
  'rosterPanel', 'rosterList', 'labelLayer', 'walkbar', 'walkText', 'lookPicker', 'optQuality', 'perfHud', 'careerBox', 'shopList', 'coinBal',
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
HUD.quality = 'quality';
try { HUD.quality = localStorage.getItem('lg_quality') || 'quality'; } catch { /* private mode */ }
HUD.setQuality = q => {
  HUD.quality = q === 'quality' ? 'quality' : 'perf';
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
  el.screenHome.hidden = which !== 'home';
  el.screenLobby.hidden = which !== 'lobby';
  el.screenResults.hidden = which !== 'results';
  el.screenHoleOver.hidden = which !== 'holeover';
  el.screenLoad.hidden = which !== 'load';
  el.screenShop.hidden = which !== 'shop';
  // `null` means the round itself is on screen.  The body class gates every
  // piece of in-round chrome, so the transparent title screen never shows
  // the backdrop hole's own scorecard and minimap through itself.
  document.body.classList.toggle('playing', which == null);
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
HUD.setWind = (wind, viewHeading) => {
  const mph = wind.speed * 2.23694;
  el.wSpeed.textContent = Math.round(mph);
  el.wDesc.textContent = BEAUFORT(wind.speed);
  // show the wind relative to the way the player is facing
  const rel = wind.dir - (viewHeading || 0);
  el.wArrow.setAttribute('transform', `rotate(${(rel * 180 / Math.PI).toFixed(1)} 30 30)`);
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
    const pct = (1 - (m.band ?? 0.2)) * 50;
    el.mFace.querySelector('.m-face-zone').style.cssText = `left:${pct}%;right:${pct}%`;
  }
  const dotPct = striking ? 50 + clamp(m.sweep, -1, 1) * 48
    : clamp(50 + m.face * 4.4, 2, 98);
  el.mFaceDot.style.left = `calc(${dotPct}% - 2px)`;
  el.mFaceDot.classList.toggle('sweeping', striking);

  if (!enabled) { el.mLabel.textContent = 'Waiting…'; el.mLabel.classList.remove('hot'); return; }
  if (m.state === 'back') {
    /* The pull-back chooses a SHAPE — a deliberate draw or fade.  It is not a
       hook or a slice, because those are strike ERRORS and no strike has
       happened yet: the accuracy phase has not even started.  Calling it a
       hook here was reporting a result out of order, and it read as the game
       punishing a shot the player had not taken. */
    const sh = m.shape || 0, a = Math.abs(sh);
    el.mLabel.textContent = m.power > 1 ? 'Overswinging — accuracy is going'
      : a < 1.5 ? 'Let go to lock the power'
      : 'Shaping a ' + (sh > 0 ? 'fade ' : 'draw ') + a.toFixed(0) + '°';
    el.mLabel.classList.toggle('hot', m.power > 1);
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
HUD.renderCourses = (courses, selected, isHost, onPick) => {
  el.courseList.innerHTML = '';
  for (const c of courses) {
    const b = document.createElement('button');
    b.className = 'ccard' + (c.id === selected ? ' on' : '') + (isHost ? '' : ' locked');
    b.innerHTML = `<div class="c-art art-${c.id}"></div>
      <b>${c.name}</b><span class="cr">${c.region}</span>
      <div class="cd">${c.blurb}</div>
      <div class="cstat">${HOLES_PER_COURSE} holes · par ${c.par} · ${c.yards} yds</div>`;
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

HUD.renderBag = (bag, onToggle) => {
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
    el.bagList.appendChild(b);
  }
};

/* The wardrobe, in the order a player thinks about it: who they are, then
   what they are wearing, then the details.  `swatch` groups are colours;
   `style` groups are shapes and show their name instead. */
const LOOK_GROUPS = [
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
HUD.renderCareer = (prof) => {
  const box = el.careerBox;
  if (!box) return;
  if (!prof || !prof.rounds) {
    box.innerHTML = '<p class="career-empty">Your first round starts your career — stats, a skill rating and coins live here.</p>';
    return;
  }
  const rel = v => v == null ? '—' : v > 0 ? '+' + v : v === 0 ? 'E' : String(v);
  const cell = (v, l) => `<div class="cstatc"><b>${v}</b><span>${l}</span></div>`;
  box.innerHTML =
    cell(prof.rating, 'rating') +
    cell('🪙 ' + prof.coins, 'coins') +
    cell(prof.rounds, 'rounds') +
    cell(rel(prof.best), 'best') +
    cell(prof.birdies + (prof.eagles ? ' / ' + prof.eagles : ''), prof.eagles ? 'birdies / eagles' : 'birdies') +
    cell(prof.fairwayPct == null ? '—' : prof.fairwayPct + '%', 'fairways') +
    cell(prof.girPct == null ? '—' : prof.girPct + '%', 'greens in reg') +
    cell(prof.avgPutts == null ? '—' : prof.avgPutts, 'putts / hole');
};

/**
 * The shop, two tabs: the Caddie Crew (personified stats, levelled 1-10)
 * and the Pro Shop (the club-tier ladder, refinements, and balls).
 */
let shopTab = 'crew';

/* ─────────────── what your money has actually bought ─────────────── */
const CLUB_LOOK_ICON = { wood: '🪵', rust: '🔩', steel: '⚙️', carbon: '🖤', tour: '🏅', titanium: '💠', signature: '👑' };

/* What the equipment is worth in YARDS, measured rather than asserted.
   The stat bars below are honest but abstract — a player who has just spent
   1,200 coins wants to see a number move, and "Accuracy 62%" does not tell
   them whether anything happened.  This flies the real simulation on a flat
   range with the gear they own and with nothing, and reports the difference,
   so the shop and the course cannot disagree.

   Cached: it is a dozen full flight integrations, and the shop re-renders on
   every purchase. */
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

function buildPayoff(prof) {
  const wrap = document.createElement('div');
  wrap.className = 'payoff';
  const crew = prof?.crew || {};
  const tier = prof?.clubTier ?? 0;
  const refine = prof?.refine ?? 0;
  const set = CLUB_TIERS[Math.max(0, Math.min(6, tier))];

  // the four things a player actually feels, each 0..1
  const lvl = k => (crew[k] || 0) / CADDIE_MAX;
  const bars = [
    ['Power',       Math.min(1, (tier / 6) * 0.6 + lvl('bruiser') * 0.4), '💪'],
    ['Accuracy',    Math.min(1, lvl('ace') * 0.6 + (tier / 6) * 0.4),     '🎯'],
    ['Forgiveness', Math.min(1, (set.faceDamp / 0.33) * 0.7 + lvl('steady') * 0.3), '🛡️'],
    ['Short game',  Math.min(1, lvl('roller') * 0.7 + lvl('lucky') * 0.3), '⛳'],
    ['Cart',        lvl('pitstop'),                                        '🛺']
  ];

  wrap.innerHTML = `
    <div class="po-set">
      <span class="po-icon">${CLUB_LOOK_ICON[set.look] || '🏌️'}</span>
      <div class="po-settxt">
        <b>${escapeHtml(set.name)}</b>
        <span>Tier ${tier + 1}/7${refine ? ' · Refinement ' + ['I', 'II', 'III'][refine - 1] : ''}</span>
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
        <span class="po-name">${ico} ${name}</span>
        <span class="po-track"><i style="width:${Math.round(v * 100)}%"></i></span>
        <span class="po-pct">${Math.round(v * 100)}%</span>
      </div>`).join('')}</div>`;
  return wrap;
}

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
  for (const [id, label] of [['crew', '⛳ Caddie Crew'], ['pro', '🏌️ Pro Shop']]) {
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

  if (shopTab === 'crew') {
    const crew = prof?.crew || {};
    for (const [key, c] of Object.entries(CADDIES)) {
      const lvl = crew[key] || 0;
      const cost = caddieCost(lvl);
      const card = document.createElement('div');
      card.className = 'shopcard caddie' + (lvl >= CADDIE_MAX ? ' owned' : '');
      const pips = Array.from({ length: CADDIE_MAX }, (_, i) =>
        `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
      card.innerHTML = `
        <div class="cad-head"><span class="cad-face">${c.emoji}</span>
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
        btn.textContent = (lvl ? 'Level up · ' : 'Hire · ') + '🪙 ' + cost;
        btn.disabled = !can;
        if (!can) btn.title = 'Costs ' + cost + ' coins — you have ' + coins;
        else btn.addEventListener('click', () => onBuy('caddie:' + key));
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
    curCard.innerHTML = `<b>${cur.name}</b><span class="sc-blurb">${cur.blurb}</span>
      <span class="cad-now">Tier ${tier + 1}/7${refine ? ' · Refinement ' + ['I','II','III'][refine - 1] : ''}</span>`;
    if (refine < 3) {
      const rc = REFINE_COSTS(tier)[refine];
      const rb = document.createElement('button');
      rb.className = 'btn' + (coins >= rc ? ' primary' : '');
      rb.textContent = 'Refine ' + ['I','II','III'][refine] + ' · 🪙 ' + rc;
      rb.disabled = coins < rc;
      if (coins >= rc) rb.addEventListener('click', () => onBuy('club:refine'));
      curCard.appendChild(rb);
    }
    grid.appendChild(curCard);

    if (tier < 6) {
      const nxt = CLUB_TIERS[tier + 1];
      const nc = document.createElement('div');
      nc.className = 'shopcard';
      nc.innerHTML = `<b>${nxt.name}</b><span class="sc-blurb">${nxt.blurb}</span>
        <span class="cad-now">Refinements reset on upgrade — a new set starts raw</span>`;
      const nb = document.createElement('button');
      nb.className = 'btn' + (coins >= nxt.cost ? ' primary' : '');
      nb.textContent = 'Upgrade set · 🪙 ' + nxt.cost;
      nb.disabled = coins < nxt.cost;
      if (coins >= nxt.cost) nb.addEventListener('click', () => onBuy('club:tier'));
      nc.appendChild(nb);
      grid.appendChild(nc);
    }

    // the legacy ball and cart lines still live here
    const gear = prof?.gear || {};
    for (const [key, it] of Object.entries(SHOP)) {
      if (it.slot === 'irons' || it.slot === 'woods' || it.slot === 'putter') continue;
      const owned = (gear[it.slot] || 0) >= it.tier;
      const blocked = prof ? purchaseBlocked(key, { coins, gear }) : 'Join first.';
      const card = document.createElement('div');
      card.className = 'shopcard' + (owned ? ' owned' : '');
      card.innerHTML = `<b>${it.name}</b><span class="sc-blurb">${it.blurb}</span>`;
      const btn = document.createElement('button');
      btn.className = 'btn' + (owned ? '' : blocked ? '' : ' primary');
      btn.textContent = owned ? 'In the bag ✓' : '🪙 ' + it.cost;
      btn.disabled = owned || !!blocked;
      if (!owned && !blocked) btn.addEventListener('click', () => onBuy(key));
      card.appendChild(btn);
      grid.appendChild(card);
    }
  }
};

HUD.renderLook = (look, onPick) => {
  el.lookPicker.innerHTML = '';
  for (const grp of LOOK_GROUPS) {
    const g = document.createElement('div');
    g.className = 'lookgrp' + (grp.kind === 'style' ? ' style' : '');
    const h = document.createElement('h5'); h.textContent = grp.title;
    const row = document.createElement('div'); row.className = 'lookrow';
    for (const c of grp.list) {
      const b = document.createElement('button');
      b.type = 'button';
      if (grp.kind === 'style') {
        // a shape has no colour to show, so it says what it is
        b.className = 'lookpill' + (look[grp.key] === c.id ? ' on' : '');
        b.textContent = c.name;
        b.addEventListener('click', () => onPick(grp.key, c.id));
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
      <span class="vp ${rel < 0 ? 'under' : rel > 0 ? 'over' : ''}">${scoreName(rel)}</span>`;
    el.hoTable.appendChild(div);
  });
  const isHost = room.hostPid === myPid;
  el.btnNext.disabled = !isHost;
  el.btnNext.textContent = room.holeIndex >= HOLES_PER_COURSE - 1 ? 'See the card' : 'Next hole';
  el.hoNote.textContent = isHost ? 'or wait — it moves on by itself' : 'Waiting for the host…';
};

function scoreName(rel) {
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
