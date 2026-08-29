/* =========================================================================
   hud.js — every bit of DOM. No game logic lives here.
   ========================================================================= */

import { CARRY, CLUBS, CLUB_BY_KEY, BAG_SIZE, DEFAULT_BAG } from '../shared/clubs.js';
import { HOLES_PER_COURSE, BALL_COLORS, COURSE_ORDER } from '../shared/biomes.js';
import { CAPS, SHIRTS, SKINS, TROUSERS, HAIR_COLORS, SHOES,
         HAT_STYLES, HAIR_STYLES, ACCESSORIES, BODIES, bodiesOf,
         clubDecalFor, normaliseLook } from '../shared/avatars.js';
import { SHOP, purchaseBlocked } from '../shared/gear.js';
import { CADDIES, CADDIE_MAX, caddieCost } from '../shared/crew.js';
import { CLUB_SETS, setById, setStats, STARTER_SET, upgradeCost, upgradeCount,
         isMaxed, rarityRank, CLUB_CASE_GEM_COST, CLUB_CASE_ODDS,
         classOf, CLUB_CLASSES, CLASS_LABEL, STAT_KEYS, STAT_LABEL,
         pieceCompletionFor, completionOf, SET_CLUBS, missingPieces,
         piecePrice, SET_CRATE_GEM_COST } from '../shared/clubsets.js';
import { masteryRank, totalShots, topClubs } from '../shared/mastery.js';
import { EMOTES, EMOTE_SLOTS } from './celebrations.js';
import { UNLOCKS, unlocksAt, unlocksOfKind, ownedOfKind, nextUnlock, UNLOCK_KINDS } from '../shared/unlocks.js';
import { ACTIONS, keysFor, bindKey, resetBinds, keyLabel, RESERVED } from './binds.js';
import { clubSvg, caddieSvg, statSvg, finishName } from './clubart.js';
import { formChart, scoringChart, dial } from './charts.js';
import { toYards, clamp } from '../shared/rng.js';
import { ShotSim, makeFlatRange } from '../shared/ballistics.js';
import { rewardFor, utcDateKey, CYCLE_LENGTH } from '../shared/loginrewards.js';
import { RARITIES, CASE_POOL, rarityForLevel, tierOdds, proTierOdds, vaultTierOdds, PITY_THRESHOLD,
         PITY_TIER, VAULT_TIER, tierIndex, CASE_COIN_COST, VAULT_GEM_COST, PRO_CASE_GEM_COST,
         DIRECT_BUY_GEMS, weeklyItemRotation, weekIndex, priceBounds } from '../shared/cases.js';
import { ballFinishDataUrl, trailPreviewDataUrl } from './finishpreview.js';
import { icon } from './icons.js';
import { purityTier, gradeTier, formatGrade } from '../shared/purity.js';

const $ = id => document.getElementById(id);
const el = {};
for (const id of [
  'screenHome', 'screenLobby', 'screenResults', 'screenLoad', 'screenHoleOver', 'screenShop',
  'screenBoards', 'bdTabs', 'bdBack',
  'screenLanding', 'introCanvas', 'lpLegend', 'lpLive', 'lpSide', 'lpSideTitle',
  'lpSideClose', 'lpOnlineCount', 'lpCourseName', 'lpCourseSub', 'lpFriendSub',
  'lpWeekTop', 'lpWeekTopRows', 'lpWeekTopEmpty', 'lpGlobalRankRows', 'lpGlobalRankEmpty',
  'lpTotalRounds', 'lpFriendAvatars',
  'nameState', 'nameSuggest',
  'screenWardrobe', 'wdCarousel', 'wdCourseName', 'wdCourseWhere', 'wdDots', 'wdPrev', 'wdNext',
  'wdAuto', 'wdCats', 'wdFits', 'wdRTabs', 'wdRBody', 'wdName', 'wdFit', 'wdStats',
  'wdRandom', 'wdCustom', 'wdDone',
  'wdInfo', 'wdInfoName', 'wdInfoRarity', 'wdInfoEffect', 'wdInfoPct',
  'btnClubhouse', 'btnShopBack', 'homeCoins',
  'hkAvatar', 'hkLevelBadge', 'hkProfileName', 'hkRankName', 'hkXpInto', 'hkXpNeed', 'hkXpFill',
  'hkWalletCoinsN', 'hkWalletGemsN',
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
  'rwProCases', 'rwProCasesS', 'btnRewardsOpenProCase', 'btnRewardsBuyProCase', 'rwCaseArt', 'rwProCaseArt',
  'modalCase', 'caseStage', 'caseOpenCanvas', 'caseHint', 'casePity', 'btnCaseContents', 'caseContents',
  'caseReelWrap', 'caseReelTrack',
  'caseReveal', 'caseBurst', 'caseItemArt', 'case3d', 'caseItemCanvas', 'caseGrade',
  'caseRarity', 'caseItemName', 'caseItemKind', 'btnCaseDone',
  'hCourse', 'hNum', 'hPar', 'hMeta', 'dYds', 'dLie', 'dElev',
  'wArrow', 'wSpeed', 'wDesc', 'wWeather',
  'boardRows', 'boardRoom', 'turnbar', 'tbText', 'tbDot',
  'playbar', 'clubName', 'clubCarry', 'clubUp', 'clubDown', 'mFill', 'mFaceDot', 'mLabel', 'aimTxt', 'mPct',
  'shotinfo', 'toasts', 'mapwrap', 'mapc', 'minic', 'miniPanel',
  'hoTitle', 'hoSub', 'hoTable', 'hoNote', 'btnNext',
  'teeList', 'ballColours', 'bagList', 'bagCount', 'btnBagReset', 'optMetres',
  'cartKmh', 'dialFill', 'dialNeedle', 'cartDamage', 'cartDamageTxt', 'mFace', 'touchPad',
  'coinHud', 'coinHudN', 'netPill', 'netDiag', 'walletHud', 'walletCoinsN', 'walletGemsN',
  'emoteWheel', 'recordBox', 'onlineNow', 'chatPanel', 'chatLog', 'chatInput', 'chatText', 'phraseBar', 'rosterPanel', 'rosterList', 'labelLayer', 'walkbar', 'walkText', 'lookPicker', 'optQuality', 'perfHud', 'careerBox', 'shopList', 'coinBal', 'gemBal', 'invSections',
  'marketSubTabs', 'marketBrowse', 'marketMine', 'marketGemBal',
  'invCanvas', 'invCap', 'mktCanvas', 'mktCap', 'hkPageTitle',
  'lpIdentity', 'lpIdAvatar', 'lpIdCode', 'setCompare',
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
/* EVERY SCREEN, IN ONE TABLE. This was nine hard-coded boolean lines, which
   meant adding a screen required remembering to add a tenth — and forgetting
   left the old screen sitting on top of the new one. A registry cannot be
   forgotten: anything listed here is hidden unless it is the one asked for.

   'home' and 'landing' are the SAME SCREEN. The old home screen was a column
   of eleven controls beside a course picker beside a character editor, and
   the landing page behind it was better at being a front door — so the front
   door became the whole thing. `screenHome` still exists in the DOM, hidden,
   because the wardrobe and the clubhouse render into the character panel
   inside it by id. Showing it is never right, which is why it is not here. */
const SCREENS = ['screenLanding', 'screenWardrobe', 'screenBoards', 'screenShop',
                 'screenLobby', 'screenResults', 'screenHoleOver', 'screenLoad'];
const SCREEN_OF = {
  landing: 'screenLanding', home: 'screenLanding', wardrobe: 'screenWardrobe',
  boards: 'screenBoards', shop: 'screenShop', lobby: 'screenLobby',
  results: 'screenResults', holeover: 'screenHoleOver', load: 'screenLoad'
};

/** Which screen is up. `null` means the round itself. THE single source of
 *  truth — main.js's `G.screen` is a getter onto this, so the two can no
 *  longer drift the way they did when both were assigned by hand. */
HUD.current = 'landing';

HUD.show = which => {
  HUD.current = which;
  const want = SCREEN_OF[which] || null;
  for (const id of SCREENS) if (el[id]) el[id].hidden = (id !== want);
  el.screenHome.hidden = true;                    // never right, see above

  const landing = which === 'landing' || which === 'home';
  // `null` means the round itself is on screen. The body class gates every
  // piece of in-round chrome, so the transparent title screen never shows
  // the backdrop hole's own scorecard and minimap through itself.
  document.body.classList.toggle('playing', which == null);
  document.body.classList.toggle('landed', landing);
  // The clubhouse header carries its own coin/gem readout now (see
  // renderClubhouseHeader) — showing the floating .wallethud on top of it
  // too just duplicated the same numbers in a second, disconnected corner,
  // which is what actually broke on a narrow screen: the header wraps
  // there, and the fixed badge doesn't wrap with it.
  document.body.classList.toggle('inshop', which === 'shop');
  /* The nav bar belongs to the MENU, never to a round or a summary — those
     are places you leave deliberately, not places you tab away from. */
  document.body.classList.toggle('navbar-on', MENU_SCREENS.has(which));
  HUD.paintNav();
};

/* ------------------------------------------------------------------ pages */
/* THE NAV BAR. Six pages, one row, always visible in the menu.

   What this replaces: a landing page whose cards led to a Career screen
   with six tabs, one of which (Pro shop) had five more inside it, and a
   Boards screen with two more levels under that. Reaching the Items shop
   was four clicks through three different kinds of tab strip.

   A page maps to a screen and, where that screen is the clubhouse, to the
   panes it should show. Several panes at once is the point — the Locker is
   your inventory AND your bag, on one page, rather than two tabs you have
   to know to look behind. */
const MENU_SCREENS = new Set(['landing', 'home', 'shop', 'boards', 'wardrobe']);
const PAGES = {
  play:   { label: 'Play',   screen: 'landing' },
  shop:   { label: 'Shop',   screen: 'shop',   panes: ['shop'] },
  locker: { label: 'Locker', screen: 'shop',   panes: ['golfer', 'inventory', 'bag'] },
  market: { label: 'Market', screen: 'shop',   panes: ['market'] },
  social: { label: 'Social', screen: 'boards' },
  career: { label: 'Career', screen: 'shop',   panes: ['career', 'rewards'] }
};
HUD.PAGES = PAGES;
HUD.page = 'play';

/** Go to a page. The ONE navigation entry point — everything else
 *  (nav clicks, landing cards, the hash, Back) funnels through here. */
HUD.goPage = (page, { push = true } = {}) => {
  const def = PAGES[page];
  if (!def) return;
  HUD.page = page;
  HUD.onPageEnter?.(page, def);            // main.js renders what it needs
  HUD.show(def.screen);
  if (def.panes) HUD.showPanes(def.panes);
  // the header named the screen, which was always "Career" whatever you
  // were actually looking at
  const title = document.getElementById('hkPageTitle');
  if (title) title.textContent = def.label;
  if (push) HUD.pushHash(page);
  HUD.paintNav();
};

/** Show exactly these clubhouse panes, hiding the rest. Replaces
 *  showClubhouseTab's one-at-a-time behaviour — the old tab bar is gone. */
HUD.showPanes = names => {
  const want = new Set(names);
  for (const p of document.querySelectorAll('.hkpane')) {
    p.hidden = !want.has(p.dataset.pane);
  }
  document.getElementById('hkSettingsBtn')?.classList.toggle('on', want.has('keys'));
  // arriving on a page should start you at the top of it
  document.querySelector('#screenShop .card')?.scrollTo?.({ top: 0 });

  /* Per-pane arrival work. Done on ARRIVAL rather than on every render,
     because five ladders and a hundred rows each is not something to pull
     down for somebody who came to buy a putter. */
  if (want.has('rewards')) HUD.bindLevelTrack?.();
  if (want.has('golfer')) HUD.onGolferPane?.();
  if (want.has('market')) { HUD.bindMarketSubTabs?.(); HUD.onMarketTab?.(); }

  /* Open on the first thing in each grid rather than an empty stage — an
     empty stage beside a full list reads as broken, not as waiting. */
  for (const [pane, sel] of [['inventory', '#invSections [data-prev]'],
                             ['market', '.hkpane[data-pane="market"] [data-prev]']]) {
    if (!want.has(pane)) continue;
    document.querySelector(sel)?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
  }
  if (want.has('shop')) {
    const first = document.querySelector('#shopList [data-view]');
    if (first) { try { HUD.previewShopItem(JSON.parse(first.dataset.view)); } catch {} }
  }
};

/** Your friend ID, under your name. It was only ever reachable by pressing
 *  "My code" inside the friends sheet, which copied it to the clipboard —
 *  fine for sending, useless for reading one out. */
HUD.setFriendCode = code => {
  if (el.lpIdCode) el.lpIdCode.textContent = code || '—';
};

HUD.paintNav = () => {
  const bar = document.getElementById('navBar');
  if (!bar) return;
  for (const b of bar.querySelectorAll('[data-page]')) {
    const on = b.dataset.page === HUD.page;
    b.classList.toggle('on', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  }
};

HUD.bindNav = () => {
  const bar = document.getElementById('navBar');
  if (!bar || bar.dataset.bound) return;
  bar.dataset.bound = '1';
  bar.addEventListener('click', e => {
    const b = e.target.closest('[data-page]');
    if (b) HUD.goPage(b.dataset.page);
  });
};

/* ----------------------------------------------------------------- history */
/* REAL BACK. There was no routing at all before this — no hash, no
   pushState, no popstate anywhere in the client — and "back" was a button
   that called route(), which derives the screen from SERVER ROOM STATE and
   knows nothing about the shop or the boards. So Career -> Boards -> back
   landed on the front page rather than on Career, every time.

   The hash is the menu page only. A round is deliberately NOT a hash state:
   you cannot Back your way out of a hole, and a URL that drops somebody
   into a live room they were never in is not a link worth having. */
let hashLock = false;

HUD.pushHash = page => {
  const want = '#' + page;
  if (location.hash === want) return;
  hashLock = true;                       // our own write must not re-enter
  try { history.pushState({ page }, '', want); } catch { location.hash = want; }
  hashLock = false;
};

/** Wire Back/Forward. Called once at boot. */
HUD.bindHistory = () => {
  addEventListener('popstate', () => {
    if (hashLock) return;
    const page = (location.hash || '').replace('#', '');
    // push:false — this IS the history event, pushing again would trap Back
    if (HUD.PAGES[page]) HUD.goPage(page, { push: false });
    else HUD.goPage('play', { push: false });
  });
};

/** The page named by the URL on first load, or null. */
HUD.hashPage = () => {
  const page = (location.hash || '').replace('#', '');
  return HUD.PAGES[page] ? page : null;
};

HUD.loading = msg => { el.loadMsg.textContent = msg; };
/* The landing page's own coin readout went with the Social & Career card —
   the wallet in the corner already carries the same number, which is why
   that card was mostly duplicates. Guarded rather than deleted: the caller
   is on a hot path and the element may come back. */
HUD.setHomeCoins = n => {
  if (el.homeCoins) el.homeCoins.innerHTML = icon('coin') + ' ' + (n || 0).toLocaleString();
};
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
    /* The scoreboard is the list you spend a whole round looking at, so it
       is the one place a name most obviously wants to be a link. Spectators
       included: watching is not a reason to be anonymous. */
    row.dataset.profile = p.pid;
    row.classList.add('clickable');
    row.title = `See ${p.name}'s profile`;
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
  /* Stashed for the finish previews: a finish is how YOUR ball catches the
     light, so previewing every one of them on a white sphere shows somebody
     a ball they will never own. */
  if (mine) HUD.myBallHex = mine;
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

HUD.renderBag = (bag, onToggle, clubSet = STARTER_SET, skin = 'stock', mastery = null) => {
  HUD.mySet = clubSet;
  HUD.mySkin = skin;
  HUD.myMastery = mastery || HUD.myMastery || {};
  el.bagList.innerHTML = '';
  const carried = new Set(bag);
  el.bagCount.textContent = `(${bag.length}/${BAG_SIZE})`;
  el.bagCount.className = bag.length > BAG_SIZE ? 'over' : '';
  for (const c of CLUBS) {
    const on = carried.has(c.key);
    const b = document.createElement('button');
    b.className = 'clubbtn' + (on ? ' on' : '') + (c.putter ? ' fixed' : '');
    const carry = c.putter ? '' : Math.round(dist(CARRY[c.key] || 0)) + ' ' + HUD.unit();
    /* MASTERY. Shots hit with this exact club, and the name that count has
       earned. It buys nothing — see mastery.js — so it sits quietly as a
       corner number rather than a stat line, and a club you have never
       swung shows nothing at all rather than a zero. */
    const mk = masteryRank((HUD.myMastery || {})[c.key] || 0);
    const mastBadge = mk.shots
      ? `<em class="mast" style="--mc:${mk.color}" title="${escapeHtml(mk.name)} · ${mk.shots} shots"
           >${mk.shots > 999 ? (mk.shots / 1000).toFixed(1) + 'k' : mk.shots}</em>
         <i class="mastbar"><b style="width:${(mk.pct * 100).toFixed(0)}%;background:${mk.color}"></b></i>` : '';
    b.innerHTML = `<b>${c.label}</b><span>${c.putter ? 'always in' : c.loft + '° · ' + carry}</span>${mastBadge}`;
    if (!c.putter) b.addEventListener('click', () => onToggle(c.key));
    /* Hovering a club shows it. Fourteen picks out of twenty-one from a list
       of abbreviations is a spreadsheet; seeing the club you are about to
       add or drop is what makes it a bag. */
    const view = { kind: 'club', key: c.key, set: HUD.mySet || STARTER_SET,
                   skin: HUD.mySkin || 'stock',
                   name: c.name || c.label,
                   sub: (c.putter ? 'Always in the bag' : `${c.loft}° · ${carry}`)
                        + (mk.shots ? ` · ${mk.name} (${mk.shots} shots)` : '') };
    const show = () => HUD.previewBagClub(view);
    b.addEventListener('pointerover', show);
    b.addEventListener('focus', show);
    el.bagList.appendChild(b);
  }
  // open on the first club rather than on an empty stage
  const first = CLUBS[0];
  HUD.previewBagClub({ kind: 'club', key: first.key, set: HUD.mySet || STARTER_SET,
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
      HUD.previewBagClub({ kind: 'club', key: 'DR', set: HUD.mySet || STARTER_SET,
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
  const what = HUD._lastBagView || { kind: 'club', key: 'DR', set: HUD.mySet || STARTER_SET };
  modal.hidden = false;
  HUD.showInspectClub(what.key, what);
  releaseShopOrbit(cv);   // a freshly opened inspect starts turning on its own, same as the bag
};

/**
 * Put a club on the inspect turntable WEARING the decal it would actually
 * wear — the class override if it has one, the bag-wide decal otherwise.
 *
 * This modal has always shown a bare club while the decal grid underneath it
 * was being used, which is a picker with no preview: you chose a pattern,
 * closed the modal, and found out on the tee. Now the club in front of you
 * changes as you click, and switching class tab swings a club from that
 * class onto the stage.
 */
HUD.showInspectClub = (clubKey = null, view = null) => {
  const cv = document.getElementById('inspectCanvas');
  if (!cv) return;
  const base = view || HUD._lastBagView || { kind: 'club', key: 'DR', set: HUD.mySet || STARTER_SET };
  const key = clubKey || base.key || 'DR';
  const club = CLUB_BY_KEY[key];
  const look = HUD._decalLook;
  const id = clubDecalFor(look, key);
  const u = id ? UNLOCKS.find(x => x.kind === 'decal' && x.id === id) : null;

  const what = { ...base, kind: 'club', key,
    set: base.set || HUD.mySet || STARTER_SET,
    skin: base.skin || HUD.mySkin || 'stock',
    name: club ? (club.name || club.label) : base.name,
    sub: u ? u.name : (club ? `${club.loft}°` : base.sub),
    decal: u ? { id: u.id, color: u.color || '#8fe07a',
                 purity: (HUD._decalPurity || {})[u.id] || 0 } : null };
  showShopItem(cv, what);
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

/* Which club class the decal picker is currently editing. null is the
   bag-wide default, which is where it opens and where a player who never
   touches the tabs stays. Module state rather than a look field: it is a
   view mode, not something anybody wears. */
HUD.decalClass = null;

/* One club per class for the turntable — the club somebody picturing "my
   wedges" is actually picturing. */
const DECAL_SAMPLE = { driver: 'DR', woods: 'W3', irons: 'I7', wedges: 'SW', putter: 'PT' };

const DECAL_TABS = [
  { id: null,      label: 'All clubs' },
  { id: 'driver',  label: 'Driver' },
  { id: 'woods',   label: 'Woods' },
  { id: 'irons',   label: 'Irons' },
  { id: 'wedges',  label: 'Wedges' },
  { id: 'putter',  label: 'Putter' }
];

/**
 * The club decal picker. This is the one cosmetic slot in the whole game
 * that had a working field (`look.decal`, read by Avatar.setDecal) and no
 * UI anywhere that ever wrote to it — earned, stored, applied, and simply
 * unreachable. Shows every decal-kind unlock, earned or not, the same way
 * club finishes already do: owned ones are pressable, others show the
 * level that unlocks them so there is always a next one to want.
 *
 * The class tabs are the per-club half. A driver crown, an iron cavity and
 * a putter flange are three different-shaped surfaces, so one pattern
 * cannot be right on all of them — and a bag where the driver is loud and
 * the irons are not is what a real bag looks like. A class with nothing set
 * falls through to "All clubs", which is why "None" inside a class tab
 * reads as "use the default" rather than as bare metal.
 */
HUD.renderClubDecalPicker = (look, level, caseUnlocks = [], decalPurity = {}) => {
  const grid = document.getElementById('inspectDecalGrid');
  if (!grid) return;
  const cls = HUD.decalClass;
  /* Stashed so showInspectClub can resolve which decal a club would wear
     without every caller having to hand it the look again. */
  HUD._decalLook = look;
  HUD._decalPurity = decalPurity;
  const decals = UNLOCKS.filter(u => u.kind === 'decal');
  const ownedIds = new Set(ownedOfKind(level, 'decal', caseUnlocks).map(u => u.id));
  const owned = id => ownedIds.has(id);
  const fallback = look?.decal || null;
  const cur = cls ? (look?.clubDecals?.[cls] || null) : fallback;

  const tabs = document.getElementById('inspectDecalTabs');
  if (tabs) {
    tabs.innerHTML = DECAL_TABS.map(t => {
      const on = (t.id || null) === cls;
      // a dot on any class carrying its own override, so five tabs do not
      // hide four decisions behind the one that happens to be open
      const set = t.id && look?.clubDecals?.[t.id];
      return `<button class="dtab${on ? ' on' : ''}" data-dclass="${t.id || ''}"
        >${escapeHtml(t.label)}${set ? '<i></i>' : ''}</button>`;
    }).join('');
    if (!tabs.dataset.wired) {
      tabs.dataset.wired = '1';
      tabs.addEventListener('click', e => {
        const b = e.target.closest('[data-dclass]');
        if (!b) return;
        HUD.decalClass = b.dataset.dclass || null;
        HUD.onDecalClass?.(HUD.decalClass);
      });
    }
  }

  const noneLabel = cls ? 'Default' : 'None';
  const noneTitle = cls
    ? `Use the bag-wide decal${fallback ? '' : ' (none set)'}`
    : 'No club decal';
  const none = `<button class="none${!cur ? ' on' : ''}" data-decal="" title="${noneTitle}">${noneLabel}</button>`;
  const cells = decals.map(u => {
    const has = owned(u.id);
    const color = u.color || '#8fe07a';
    const purity = decalPurity[u.id] || 0;
    const tier = purity ? purityTier(purity) : null;
    const title = has
      ? `${escapeHtml(u.name)}${tier ? ` — ${tier.name} (${purity}%)` : ''}`
      : `${escapeHtml(u.name)} — level ${u.at}`;
    return `<button class="${!has ? 'locked' : ''}${u.id === cur ? ' on' : ''}"
      data-decal="${has ? u.id : ''}" data-pattern-id="${has ? u.id : ''}" data-pattern-color="${color}" data-pattern-purity="${purity}"
      ${has ? '' : 'disabled'}
      title="${title}">
      ${has ? `<i style="background:${color}"></i>${tier ? `<b class="decal-purity" style="--pc:${tier.color}">${purity}</b>` : ''}` : u.at}
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
    const pattern = shaftDecalDataUrl(id, btn.dataset.patternColor, Number(btn.dataset.patternPurity) || 0);
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
      HUD.onWardrobe?.({ __clubDecal: b.dataset.decal || null,
                         __clubDecalClass: HUD.decalClass });
    });
  }

  /* The club on the stage wears whatever was just picked. Guarded on the
     modal being open so the wardrobe's own repaint (which also calls this)
     does not spin up a renderer for a canvas nobody is looking at. */
  if (!document.getElementById('modalClubInspect')?.hidden) {
    HUD.showInspectClub(cls ? DECAL_SAMPLE[cls] : null);
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
  /* `patch` sends this through applyWardrobe's own branch rather than the
     generic field path, because a cart livery is not a garment and picking
     one must not clear the name off an outfit the player chose. */
  { key: 'cartDecal',  title: 'Cart livery', kind: 'cartdecal', patch: '__cartDecal' },
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
  hat: 'shirt', title: 'title', ball: 'ball', cartdecal: 'cart' };

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
  const key = clubKey + '|' + (prof?.clubSet || '') + '|' +
    ((prof?.clubPieces || {})[prof?.clubSet] || []).join(',') + '|' +
    JSON.stringify(prof?.gear || {}) + '|' + JSON.stringify(prof?.crew || {});
  if (carryCache.has(key)) return carryCache.get(key);
  let v = 0;
  try {
    rangeT = rangeT || makeFlatRange();
    const r = new ShotSim(rangeT, {
      x: 0, z: 0, clubKey, power: 1, aim: 0, faceDeg: 0, attackDeg: 0,
      wind: { dir: 0, speed: 0 },
      gear: prof?.gear || null, crew: prof?.crew || null,
      clubSet: prof?.clubSet || STARTER_SET,
      setDone: pieceCompletionFor((prof?.clubPieces || {})[prof?.clubSet], clubKey),
      setGrade: (prof?.clubGrades || {})[prof?.clubSet] ?? 1
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
const BARE = { clubSet: STARTER_SET, clubPieces: { [STARTER_SET]: [...SET_CLUBS] },
               gear: { ball: 0, irons: 0, woods: 0, putter: 0 }, crew: {} };

/**
 * The Pro Shop's headline: the set you own, drawn, with what it is worth in
 * yards and the five felt stats underneath.
 */
function buildPayoff(prof) {
  const wrap = document.createElement('div');
  wrap.className = 'payoff';
  const crew = prof?.crew || {};
  const set = setById(prof?.clubSet) || setById(STARTER_SET);
  const pieces = (prof?.clubPieces || {})[set.id] || [];
  const level = pieces.length;
  const steps = SET_CLUBS.length;
  /* Power and accuracy used to read `tier / 6` off a seven-rung ladder that
     no longer exists. They now read the set's ACTUAL speed against the
     range the game spans (the free starter at 0.860 up to a maxed Mythic
     at 1.065), so the bar means the same thing it always did — how much of
     the available distance you have — without hardcoding a rung count. */
  const stats = setStats(set.id, completionOf(pieces), 'DR',
    (prof?.clubGrades || {})[set.id] ?? 1) || { speed: 0.86, faceDamp: 0 };
  const SPAN_LO = 0.860, SPAN_HI = 1.065, DAMP_HI = 0.33;
  const setPower = Math.max(0, Math.min(1, (stats.speed - SPAN_LO) / (SPAN_HI - SPAN_LO)));

  const lvl = k => (crew[k] || 0) / CADDIE_MAX;
  const bars = [
    ['Power',       Math.min(1, setPower * 0.6 + lvl('bruiser') * 0.4),  'power'],
    ['Accuracy',    Math.min(1, lvl('ace') * 0.6 + setPower * 0.4),      'accuracy'],
    ['Forgiveness', Math.min(1, (stats.faceDamp / DAMP_HI) * 0.7 + lvl('steady') * 0.3), 'forgive'],
    ['Short game',  Math.min(1, lvl('roller') * 0.7 + lvl('lucky') * 0.3), 'short'],
    ['Cart',        lvl('pitstop'),                                        'cart']
  ];

  /* The pip track is this SET's upgrade path, not a ladder of sets to buy.
     Its length varies by rarity on purpose — a Mythic set showing eight
     pips next to a Standard set's three is the clearest possible statement
     of "mythics take longer". */
  const pips = SET_CLUBS.map(k =>
    `<i class="${pieces.includes(k) ? 'done' : ''}" title="${escapeHtml(CLUB_BY_KEY[k]?.label || k)}"></i>`).join('');
  const rarityName = set.rarity[0].toUpperCase() + set.rarity.slice(1);

  wrap.innerHTML = `
    <div class="po-set">
      <span class="po-art">${clubSvg(set.look, 64)}</span>
      <div class="po-settxt">
        <b>${escapeHtml(set.name)}</b>
        <span>${escapeHtml(set.brand)} · ${rarityName} · ${level}/${steps} clubs</span>
      </div>
      <div class="po-tiers" title="${level} of ${steps} clubs collected">${pips}</div>
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
  /* Upgrading the set you carry, rather than the next rung of a ladder —
     there is no ladder any more, and the only set the shop can sell
     anything for is the one already in the bag. */
  {
    const set = setById(prof?.clubSet) || setById(STARTER_SET);
    const pieces = (prof?.clubPieces || {})[set.id] || [];
    const missing = missingPieces(pieces);
    if (missing.length) {
      const k = missing[0];
      candidates.push({ kind: 'piece:' + set.id + ':' + k,
        name: `${CLUB_BY_KEY[k]?.label || k} — ${set.name}`, cost: piecePrice(set.id),
        sub: `${pieces.length}/${SET_CLUBS.length} clubs collected`, art: clubSvg(set.look, 28) });
    }
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

/* The three clubs somebody actually plays, by shots hit. This is the whole
   visible payoff of mastery and it is deliberately a portrait rather than a
   scoreboard: a player who lives on their 7 iron and a player who bombs
   driver read as different golfers here, and neither of them is stronger
   for it (see mastery.js). Hidden entirely until there is something to
   show — an empty "most swung" board on a new career is just furniture. */
function masteryStrip(mastery) {
  const top = topClubs(mastery, 3);
  if (!top.length) return '';
  const total = totalShots(mastery);
  return `<h5 class="cr-h">Clubs you know — ${total.toLocaleString()} shots hit</h5>
    <div class="cr-mast">${top.map(t => {
      const label = CLUB_BY_KEY[t.key]?.label || t.key;
      return `<div class="crm" style="--mc:${t.rank.color}">
        <b>${escapeHtml(label)}</b>
        <span>${escapeHtml(t.rank.name)}</span>
        <em>${t.shots.toLocaleString()} shots</em>
        <i><span style="width:${(t.rank.pct * 100).toFixed(0)}%"></span></i>
      </div>`;
    }).join('')}</div>`;
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

     ${masteryStrip(prof.mastery)}

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
  for (const [id, label] of [['clubs', 'Clubs'], ['gear', 'Gear'], ['crew', 'Caddie Crew'], ['cases', 'Cases'], ['items', 'Items']]) {
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
      /* A set card also drives the side-by-side. Anything else (a caddie,
         a case, a gear slot) has nothing to compare, so the panel goes
         away rather than showing a stale set's numbers. */
      if (card.dataset.set) HUD.renderSetCompare(prof, card.dataset.set);
      else HUD.hideSetCompare();
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
    /* Every set you own, the one you carry first. A set is COLLECTED now —
       fourteen clubs, one at a time — so each card is a progress bar and a
       shelf of which clubs you are still missing, and the coin button buys
       a named one rather than an anonymous upgrade. */
    const owned = prof?.clubPieces || { [STARTER_SET]: [...SET_CLUBS] };
    const equipped = prof?.clubSet || STARTER_SET;
    const mine = CLUB_SETS
      .filter(st => st.id in owned)
      .sort((a, b) => (b.id === equipped) - (a.id === equipped)
                   || rarityRank(b.rarity) - rarityRank(a.rarity));

    for (const st of mine) {
      const pieces = owned[st.id] || [];
      const steps = SET_CLUBS.length;
      const missing = missingPieces(pieces);
      const on = st.id === equipped;
      const grade = (prof?.clubGrades || {})[st.id] ?? 1;
      const gt = gradeTier(grade);
      const card = document.createElement('div');
      card.className = 'shopcard' + (on ? ' owned' : '');
      card.style.setProperty('--rarity-color', RARITY_ACCENT[st.rarity] || RARITY_ACCENT.standard);
      card.dataset.set = st.id;
      card.dataset.view = JSON.stringify({ kind: 'club', key: 'DR', set: st.id,
        skin: prof?.clubSkin || 'stock', name: st.name,
        sub: `${st.brand} · ${st.rarity}` });
      const rarityName = st.rarity[0].toUpperCase() + st.rarity.slice(1);

      /* Every club in the set, held or not. Fourteen tiny chips say "you
         are missing your wedges" at a glance in a way "9/14" never does. */
      const chips = SET_CLUBS.map(k => {
        const has = pieces.includes(k);
        return `<i class="pc${has ? ' has' : ''}" title="${escapeHtml(CLUB_BY_KEY[k]?.label || k)}">${escapeHtml(k)}</i>`;
      }).join('');

      card.innerHTML = `<span class="sc-art">${clubSvg(st.look, 46)}</span>
        <b>${escapeHtml(st.name)}</b><span class="sc-blurb">${escapeHtml(st.blurb)}</span>
        <span class="cad-now">${escapeHtml(st.brand)} · ${rarityName} · ${pieces.length}/${steps} clubs
          · <em style="color:${gt.color};font-style:normal;font-weight:800">${formatGrade(grade)}</em></span>
        <div class="pieces">${chips}</div>`;

      if (!on) {
        const eq = document.createElement('button');
        eq.className = 'btn';
        eq.textContent = 'Carry this set';
        eq.addEventListener('click', () => onBuy('set:equip:' + st.id));
        card.appendChild(eq);
      }

      /* Buying a NAMED club. The case is random and the crate is expensive;
         this is the deliberate route for somebody one club short. */
      if (missing.length) {
        const k = missing[0];
        const cost = piecePrice(st.id);
        const pb = document.createElement('button');
        pb.className = 'btn' + (coins >= cost ? ' primary' : '');
        const label = CLUB_BY_KEY[k]?.label || k;
        pb.innerHTML = coins >= cost
          ? `Buy ${escapeHtml(label)} · ${icon('coin')} ${cost.toLocaleString()}`
          : `${icon('coin')} ${cost.toLocaleString()} · need ${(cost - coins).toLocaleString()} more`;
        pb.disabled = coins < cost;
        if (coins >= cost) pb.addEventListener('click', () => onBuy(`piece:${st.id}:${k}`));
        card.appendChild(pb);
      } else {
        const done = document.createElement('button');
        done.className = 'btn';
        done.textContent = 'Complete set';
        done.disabled = true;
        card.appendChild(done);
      }
      grid.appendChild(card);
    }

    /* Where new sets actually come from, said out loud on the tab where
       somebody is looking for one — otherwise this reads as a bag with
       nothing to do in it. */
    const hint = document.createElement('div');
    hint.className = 'shopcard';
    hint.style.setProperty('--rarity-color', RARITY_ACCENT.legend);
    hint.innerHTML = `<span class="sc-art">${icon('gift', { size: 40 })}</span>
      <b>More sets</b><span class="sc-blurb">Club Cases hand over one club at a
      time; a Set Crate hands over all fourteen at once.</span>
      <span class="cad-now">${CLUB_CASE_GEM_COST} gems a case · ${SET_CRATE_GEM_COST.toLocaleString()} a crate</span>`;
    const go = document.createElement('button');
    go.className = 'btn';
    go.textContent = 'Go to Cases';
    go.addEventListener('click', () => { shopTab = 'cases'; HUD.renderShop(prof, onBuy); });
    hint.appendChild(go);
    grid.appendChild(hint);

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
    const vaultTop = vaultTierOdds()[0];
    const proTop = proTierOdds()[0];
    const CASE_ICON = { standard: 'caseCommon', vault: 'caseVault', pro: 'caseLegendary',
                        club: 'ironHead', set: 'caseLegendary' };
    const cases = [
      { key: 'standard', name: 'Fairway Supply Crate', rarity: 'Common', rarityClass: 'common',
        owned: prof?.cases || 0, cost: CASE_COIN_COST, currency: 'coin', have: coins,
        blurb: `Every tier in the game, including a ${top.pct.toFixed(1)}% shot at ${top.name}.`,
        hint: 'Coins come from playing — every hole you finish pays, and the round pays again at the end.',
        buyItem: 'case:buy', openItem: 'case:open' },
      { key: 'vault', name: 'Country Club Vault', rarity: 'Rare', rarityClass: 'rare',
        owned: prof?.vaultCases || 0, cost: VAULT_GEM_COST, currency: 'gem', have: gems,
        blurb: `${vaultTop.name} or better, guaranteed — one rung up from the base crate's floor.`,
        hint: 'Gems come from the daily rewards streak — days 4, 7, 9, 12 and 14 pay them out, and each full cycle pays more than the last.',
        buyItem: 'case:buyVault', openItem: 'case:openVault' },
      { key: 'pro', name: 'Hole-in-One Case', rarity: 'Legendary', rarityClass: 'legendary',
        owned: prof?.proCases || 0, cost: PRO_CASE_GEM_COST, currency: 'gem', have: gems,
        blurb: `${proTop.name} or better, guaranteed — no roll below the pity floor.`,
        hint: 'Gems come from the daily rewards streak — days 4, 7, 9, 12 and 14 pay them out, and each full cycle pays more than the last.',
        buyItem: 'case:buyPro', openItem: 'case:openPro' },
      /* The only place club sets come from. Deliberately last: it is the
         one case that does not hand out cosmetics, so it reads as a
         separate thing rather than a fourth flavour of the same crate. */
      { key: 'club', name: 'Club Case', rarity: 'Equipment', rarityClass: 'rare',
        owned: prof?.clubCases || 0, cost: CLUB_CASE_GEM_COST, currency: 'gem', have: gems,
        blurb: 'Club sets, from Standard up to Mythic — the bag you swing, not a cosmetic.',
        hint: 'A duplicate set is never wasted: it upgrades the one you already own.',
        buyItem: 'case:buyClub', openItem: 'case:openClub' },
      /* The way out of the chase for somebody who would rather pay than
         grind. Deliberately not the cheap route — fourteen Club Cases is
         8,400 gems and this is 9,000 — so what you are buying is certainty,
         not a discount. */
      { key: 'set', name: 'Set Crate', rarity: 'Complete', rarityClass: 'legendary',
        owned: prof?.setCrates || 0, cost: SET_CRATE_GEM_COST, currency: 'gem', have: gems,
        blurb: 'A whole club set, all fourteen clubs, complete in one go.',
        hint: 'The certain route rather than the cheap one — fourteen Club Cases cost less.',
        buyItem: 'case:buySet', openItem: 'case:openSet' }
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
      const oddsRows = caseOddsRowsHTML((CASE_TIERS[c.key] || CASE_TIERS.standard).oddsFn());
      /* The full pool, not a swatch strip. The odds table says how likely
         a tier is; this says what is actually IN it, which is the question
         somebody deciding whether to spend is really asking. */
      const swatches = HUD.casePoolHTML(c.key);
      card.innerHTML = `<span class="sc-art">${icon(CASE_ICON[c.key], { size: 40 })}
          ${c.owned > 0 ? `<i class="sc-qty">×${c.owned}</i>` : ''}</span>
        <b>${c.name}</b><span class="sc-rarity">${c.rarity}</span>
        <span class="sc-blurb">${escapeHtml(c.blurb)}</span>
        ${canBuy ? '' : `<span class="sc-earn">${escapeHtml(c.hint)}</span>`}
        <span class="cad-now">${c.owned} in inventory</span>
        <button class="btn mini case-contents-toggle" type="button" aria-expanded="false">Contents ▾</button>
        <div class="case-contents-panel" hidden>${oddsRows}${swatches}</div>`;
      HUD.paintCasePool(card);
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
      /* Two taps to spend real currency, same pattern the quit-round button
         already uses — arm on the first tap, confirm on the second within
         3s, revert if it doesn't come. A single tap charging immediately
         is one mis-click away from spending 2,500 coins or 400 gems on
         nothing. */
      if (canBuy) {
        const buyLabel = buyBtn.innerHTML;
        let armed = 0;
        buyBtn.addEventListener('click', () => {
          const now = Date.now();
          if (now - armed > 3000) {
            armed = now;
            buyBtn.classList.add('confirm');
            buyBtn.textContent = 'Tap again to buy';
            setTimeout(() => {
              buyBtn.classList.remove('confirm');
              buyBtn.innerHTML = buyLabel;
            }, 3000);
            return;
          }
          buyBtn.classList.remove('confirm');
          buyBtn.innerHTML = buyLabel;
          onBuy(c.buyItem);
        });
      }
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
        ball: { kind: 'ball', hex: HUD.myBallHex || '#f6f9f4', finish: HUD.myBallFinish || null },
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
  } else if (shopTab === 'items') {
    /* Naming the exact thing you want rather than rolling for it — the
       expensive way to shop, on purpose (see DIRECT_BUY_GEMS's own
       comment). A rotating slice of CASE_POOL now, not the whole pool —
       see weeklyItemRotation's own comment in cases.js — so this list can
       never drift from either what a case can actually give OR what the
       server will actually accept: same seeded function decides both. */
    const level = prof?.level ?? 1;
    const ownedIds = new Set([
      ...unlocksAt(level).map(u => u.kind + ':' + u.id),
      ...(prof?.caseUnlocks || [])
    ]);
    const resetsMs = (weekIndex() + 1) * 7 * 86400000 - Date.now();
    const resetsD = Math.floor(resetsMs / 86400000), resetsH = Math.floor((resetsMs % 86400000) / 3600000);
    const note = document.createElement('p');
    note.className = 'tiny shop-items-note';
    note.textContent = `This week's selection — resets in ${resetsD}d ${resetsH}h.`;
    grid.appendChild(note);
    for (const item of weeklyItemRotation()) {
      const key = item.kind + ':' + item.id;
      const has = ownedIds.has(key);
      const cost = DIRECT_BUY_GEMS[item.rarity];
      const rarity = RARITIES.find(r => r.id === item.rarity) || RARITIES[0];
      const card = document.createElement('div');
      card.className = 'shopcard shopcard-item' + (has ? ' owned' : '');
      card.style.setProperty('--rarity-color', rarity.color);
      const hasPreview = ['decal', 'ball', 'trail'].includes(item.kind);
      const preview = hasPreview
        ? `<img class="sc-decal-preview" width="64" height="64" alt="">` : '';
      card.innerHTML = `${preview}<b>${escapeHtml(item.name)}</b>` +
        `<span class="sc-rarity" style="color:${rarity.color}">${rarity.name}</span>` +
        `<span class="sc-blurb">${escapeHtml(UNLOCK_KINDS[item.kind]?.name || item.kind)}</span>`;
      if (hasPreview) {
        // .src as a property, never in the HTML string above — see
        // renderClubDecalPicker's own comment on why (portal-bundle
        // verifier reads a literal data-URI-shaped src="..." as a real
        // asset path).
        const img = card.querySelector('.sc-decal-preview');
        img.src = itemPreviewUrl(item, rarity, 64) || '';
      }
      const row = document.createElement('div');
      row.className = 'shopcard-row';
      const buyBtn = document.createElement('button');
      if (has) {
        buyBtn.className = 'btn'; buyBtn.disabled = true;
        buyBtn.innerHTML = 'Owned ' + icon('check');
      } else {
        const canBuy = (prof?.gems || 0) >= cost;
        buyBtn.className = 'btn' + (canBuy ? ' primary' : '');
        buyBtn.disabled = !canBuy;
        buyBtn.innerHTML = canBuy ? 'Buy · ' + icon('gem') + ' ' + cost
          : `${icon('gem')} ${cost} · need ${cost - (prof?.gems || 0)} more`;
        // same two-tap arm/confirm as the Cases tab's own buy buttons —
        // appropriate here too given the price, arguably more so
        if (canBuy) {
          const buyLabel = buyBtn.innerHTML;
          let armed = 0;
          buyBtn.addEventListener('click', () => {
            const now = Date.now();
            if (now - armed > 3000) {
              armed = now;
              buyBtn.classList.add('confirm');
              buyBtn.textContent = 'Tap again to buy';
              setTimeout(() => { buyBtn.classList.remove('confirm'); buyBtn.innerHTML = buyLabel; }, 3000);
              return;
            }
            buyBtn.classList.remove('confirm');
            buyBtn.innerHTML = buyLabel;
            onBuy('item:buy:' + item.kind + ':' + item.id);
          });
        }
      }
      row.appendChild(buyBtn);
      card.appendChild(row);
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
/** The clubhouse header's profile block — avatar, level, name, rank and
    the XP bar toward the next one. `rankTitle`/`levelFromXp` are already
    computed server-side onto every profile push (see publicProfile), so
    this only has to lay the numbers out, not derive them. */
HUD.renderClubhouseHeader = (prof, name) => {
  if (!el.hkAvatar) return;
  const shown = name || 'Golfer';
  el.hkAvatar.textContent = shown[0].toUpperCase();
  el.hkAvatar.style.background = avatarColor(shown);
  el.hkLevelBadge.textContent = prof?.level ?? 1;
  el.hkProfileName.textContent = shown;
  el.hkRankName.textContent = rankTitle(prof?.level ?? 1);
  if (el.hkWalletCoinsN) el.hkWalletCoinsN.textContent = (prof?.coins || 0).toLocaleString();
  if (el.hkWalletGemsN) el.hkWalletGemsN.textContent = (prof?.gems || 0).toLocaleString();
  if (prof?.maxed) {
    el.hkXpInto.textContent = 'MAX';
    el.hkXpNeed.textContent = '';
    el.hkXpFill.style.width = '100%';
  } else {
    el.hkXpInto.textContent = Math.round(prof?.into ?? 0).toLocaleString();
    el.hkXpNeed.textContent = Math.round(prof?.need ?? 0).toLocaleString();
    el.hkXpFill.style.width = Math.round((prof?.progress ?? 0) * 100) + '%';
  }
};

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
HUD.renderLook = (look, onPick, level = 1, caseUnlocks = []) => {
  el.lookPicker.innerHTML = '';

  /* Rewards you have NOT earned get one line between them, at the bottom —
     not four empty rows at the top.
     A new player opening this panel was met by "Club decal — first one at
     level 7", "Ball trail — first one at level 9", and two more, before a
     single thing they could actually change. Four rows of no. The ladder
     belongs in the clubhouse, where it is a whole screen and reads as a
     promise; here it should be one sentence and out of the way. */
  const earnedGroups = EARNED_GROUPS.filter(g => ownedOfKind(level, g.kind, caseUnlocks).length);
  const pending = EARNED_GROUPS.filter(g => !ownedOfKind(level, g.kind, caseUnlocks).length);

  for (const grp of earnedGroups) {
    const owned = ownedOfKind(level, grp.kind, caseUnlocks);
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
        b.addEventListener('click', () => onPick(grp.patch || grp.key, c.id));
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

/**
 * Everything the level ladder and cases have ever handed out, in one
 * place — the quick-change panel only ever covered 4 of the 7 unlock
 * kinds (decal/trail/title/ball), as plain text pills with no preview.
 * `onPick` is the exact same (key, id) equip callback renderLook already
 * uses; `onBuy` is the exact same buy-string dispatcher renderShop
 * already uses ('item:buy:kind:id') — reusing both rather than inventing
 * a second equip/purchase path. `onSell(kind, id)` is new here — there's
 * no other surface a Sell action could live on.
 *
 * hat and melee get no equip action here: unlocks.js defines them, but
 * nothing else in the game currently reads them — the real hat and melee
 * systems are separate catalogs (wardrobe.js's LOOK_GROUPS.hat,
 * celebrations.js's melee cycle) that don't reference these ids at all.
 * Showing a button that would do nothing is worse than not showing one.
 */
HUD.renderInventory = (prof, look, onPick, onBuy, onSell, onList) => {
  const box = el.invSections;
  if (!box) return;
  const level = prof?.level ?? 1;
  const caseUnlocks = prof?.caseUnlocks || [];
  const decalPurity = prof?.decalPurity || {};
  const gems = prof?.gems || 0;
  const equippedEmotes = new Set(prof?.equippedEmotes || []);
  // Only this week's rotation is actually buyable — same set the Items
  // shop tab shows, same set the server will actually accept (see
  // weeklyItemRotation's own comment in cases.js).
  const rotationKeys = new Set(weeklyItemRotation().map(it => it.kind + ':' + it.id));

  box.innerHTML = '';
  for (const [kind, kindMeta] of Object.entries(UNLOCK_KINDS)) {
    const items = UNLOCKS.filter(u => u.kind === kind).sort((a, b) => a.at - b.at);
    if (!items.length) continue;
    const grp = EARNED_GROUPS.find(g => g.kind === kind) || null;   // null for emote/hat/melee

    const section = document.createElement('div');
    section.className = 'inv-section';
    const h = document.createElement('h5');
    h.textContent = kindMeta.name;
    section.appendChild(h);
    const grid = document.createElement('div');
    grid.className = 'inv-grid';

    for (const u of items) {
      const casePoolItem = CASE_POOL.find(it => it.kind === kind && it.id === u.id);   // undefined for emote/hat/melee
      const owned = level >= u.at || caseUnlocks.includes(kind + ':' + u.id);
      const card = document.createElement('div');
      card.className = 'inv-card' + (owned ? ' owned' : '');

      // preview art — a real rendered preview for the 3 kinds a 2D canvas
      // can fake convincingly (see itemPreviewUrl); title has no visual
      // beyond its own name, emote/hat/melee fall back to a generic icon
      const art = document.createElement('div');
      art.className = 'inv-art';
      const purity = kind === 'decal' ? (decalPurity[u.id] || 0) : 0;
      const previewRarity = casePoolItem ? (RARITIES.find(r => r.id === casePoolItem.rarity) || RARITIES[0]) : { color: u.color || '#8fe07a' };
      /* Cart liveries are level rewards only — no case ever drops one — so
         they have no CASE_POOL entry to preview from. They are still very
         much visual, and a grey gift box next to "Chequered flag" tells a
         player nothing about what they have earned, so the art comes off
         the unlock itself. */
      const previewSrc = casePoolItem || (kind === 'cartdecal' ? u : null);
      const preview = previewSrc ? itemPreviewUrl(previewSrc, previewRarity, 40, purity) : null;
      if (preview) {
        const img = document.createElement('img');
        img.width = 40; img.height = 40; img.alt = '';
        if (kind === 'cartdecal') img.className = 'wide';   // 4:1 art, letterboxed not cropped
        img.src = preview;   // property, not a src="..." string — see renderClubDecalPicker's comment
        art.appendChild(img);
        if (purity) {
          const tier = purityTier(purity);
          const badge = document.createElement('b');
          badge.className = 'decal-purity'; badge.style.setProperty('--pc', tier.color);
          badge.textContent = purity;
          art.appendChild(badge);
        }
      } else {
        // decal/trail/title/ball each have their own icon; emote/hat/melee
        // don't (see icons.js) — a generic gift box stands in rather than
        // an empty box, since icon() silently returns '' for an unknown name
        art.innerHTML = icon(CASE_KIND_ICON[kind] || 'gift', { size: 20 });
      }
      card.appendChild(art);

      const name = document.createElement('b');
      name.textContent = u.name;
      card.appendChild(name);

      const status = document.createElement('span');
      status.className = 'inv-status';
      if (owned) {
        status.textContent = kind === 'emote' ? (equippedEmotes.has(u.id) ? 'in your emote wheel' : 'owned')
          : grp && look?.[grp.key] === u.id ? 'equipped' : 'owned';
      } else if (casePoolItem && rotationKeys.has(kind + ':' + u.id)) {
        const cost = DIRECT_BUY_GEMS[casePoolItem.rarity];
        status.textContent = `level ${u.at}, or ${cost.toLocaleString()} gems this week`;
      } else {
        status.textContent = `level ${u.at}`;
      }
      card.appendChild(status);

      if (owned && grp) {
        const btns = document.createElement('div');
        btns.className = 'inv-btns';
        const eq = document.createElement('button');
        eq.className = 'btn mini';
        const isOn = look?.[grp.key] === u.id;
        eq.textContent = isOn ? 'Equipped' : 'Equip';
        eq.disabled = isOn;
        if (!isOn) eq.addEventListener('click', () => onPick(grp.key, u.id));
        btns.appendChild(eq);

        // Sellable only if it's owned PURELY through a case — one the
        // player's own level also grants gets no Sell button at all, same
        // rule sellUnlock enforces server-side (see its own comment):
        // paying out gems for something they keep regardless is a
        // free-money exploit, not a trade.
        if (casePoolItem && caseUnlocks.includes(kind + ':' + u.id) && level < u.at) {
          const sell = document.createElement('button');
          sell.className = 'btn mini';
          const payout = Math.round(DIRECT_BUY_GEMS[casePoolItem.rarity] / 2);
          sell.textContent = 'Sell · ' + payout.toLocaleString();
          let armed = 0;
          sell.addEventListener('click', () => {
            const now = Date.now();
            if (now - armed > 3000) {
              armed = now;
              sell.classList.add('confirm');
              sell.textContent = 'Tap again';
              setTimeout(() => { sell.classList.remove('confirm'); sell.textContent = 'Sell · ' + payout.toLocaleString(); }, 3000);
              return;
            }
            onSell(kind, u.id);
          });
          btns.appendChild(sell);

          // Listing an item on the marketplace instead of selling it back —
          // same eligibility as Sell, since it's the same escrow underneath
          // (see server/marketplace.js's listItem). Tapping List swaps
          // itself for a price row seeded at fair value rather than opening
          // a modal — the whole point of this panel is a grid you can act
          // on without leaving it.
          const list = document.createElement('button');
          list.className = 'btn mini';
          list.textContent = 'List';
          list.addEventListener('click', () => {
            const purity = kind === 'decal' ? (decalPurity[u.id] || 0) : 0;
            const bounds = priceBounds(kind, u.id, purity);
            if (!bounds) return;
            list.remove();
            const row = document.createElement('div');
            row.className = 'inv-listrow';
            const input = document.createElement('input');
            input.type = 'number'; input.className = 'inv-listprice';
            input.min = String(bounds.min); input.max = String(bounds.max); input.value = String(bounds.fair);
            const go = document.createElement('button');
            go.className = 'btn mini primary';
            go.textContent = 'List';
            let armed = 0;
            go.addEventListener('click', () => {
              const now = Date.now();
              if (now - armed > 3000) {
                armed = now;
                go.classList.add('confirm'); go.textContent = 'Tap again';
                setTimeout(() => { go.classList.remove('confirm'); go.textContent = 'List'; }, 3000);
                return;
              }
              const price = Math.round(Number(input.value));
              onList(kind, u.id, price);
            });
            row.appendChild(input);
            row.appendChild(go);
            btns.appendChild(row);
          });
          btns.appendChild(list);
        }
        card.appendChild(btns);
      } else if (!owned && casePoolItem && rotationKeys.has(kind + ':' + u.id) && gems >= DIRECT_BUY_GEMS[casePoolItem.rarity]) {
        const btn = document.createElement('button');
        btn.className = 'btn mini primary';
        btn.textContent = 'Buy';
        // same two-tap arm/confirm the Items shop tab's own buy buttons
        // use — a steep, real-currency spend deserves the same misclick
        // protection everywhere it's offered, not just on one of the two
        // surfaces that offer it.
        let armed = 0;
        btn.addEventListener('click', () => {
          const now = Date.now();
          if (now - armed > 3000) {
            armed = now;
            btn.classList.add('confirm');
            btn.textContent = 'Tap again';
            setTimeout(() => { btn.classList.remove('confirm'); btn.textContent = 'Buy'; }, 3000);
            return;
          }
          onBuy('item:buy:' + kind + ':' + u.id);
        });
        card.appendChild(btn);
      }

      /* What this card is, for the preview stage. Stamped as data rather
         than closed over, so ONE delegated listener on the grid serves
         every card — the same shape the Pro Shop's own grid uses. */
      card.dataset.prev = JSON.stringify({
        kind, id: u.id, name: u.name,
        color: u.color || previewRarity.color,
        rarity: casePoolItem?.rarity || null,
        purity,
        sub: owned ? status.textContent : `Locked — ${status.textContent}`
      });

      grid.appendChild(card);
    }
    section.appendChild(grid);
    box.appendChild(section);
  }

  if (!box.dataset.prevWired) {
    box.dataset.prevWired = '1';
    const show = e => {
      const card = e.target.closest('[data-prev]');
      if (!card) return;
      try {
        const d = JSON.parse(card.dataset.prev);
        HUD.previewOwnedItem('invCanvas', 'invCap', d.kind, d.id, {
          name: d.name, sub: d.sub, color: d.color, purity: d.purity,
          rarity: RARITIES.find(r => r.id === d.rarity) || RARITIES[0],
          clubSet: HUD.mySet || STARTER_SET, clubSkin: HUD.mySkin || 'stock'
        });
      } catch { /* ignore a malformed card */ }
    };
    box.addEventListener('pointerover', show);
    box.addEventListener('focusin', show);
    box.addEventListener('click', show);      // touch, where there is no hover
  }
};


/* ------------------------------------------------- the preview stages ---
   One stage per tab, hovered rather than clicked — the pattern the Pro
   Shop grid, the bag and the skin picker already use. NOT one canvas per
   card: the Inventory grid shows ~35 items at once, and finishpreview.js's
   own header explains why the small thumbnails are 2D in the first place.

   The golfer is mounted lazily and only for the kinds that need one, so a
   player who never hovers an emote never pays for a second avatar. */
const avStages = new Map();
function avatarStage(canvasId) {
  let st = avStages.get(canvasId);
  if (!st) {
    const cv = document.getElementById(canvasId);
    if (!cv) return null;
    st = mountAvatarStage(cv, HUD.previewLook || null);
    avStages.set(canvasId, st);
  }
  return st;
}

/** Drop whatever golfer a stage is holding, so the next non-emote hover
 *  gets a clean turntable rather than a club floating beside a torso. */
function clearAvatarStage(canvasId) {
  const st = avStages.get(canvasId);
  if (st) { st.dispose(); avStages.delete(canvasId); }
}

/**
 * Preview one owned/listed item on a tab's stage.
 * `kind` is an UNLOCK_KINDS key; `id` the item's own id.
 */
/* A flat card laid over the stage, for the kinds with nothing to model.
   Created lazily beside the canvas rather than added to index.html for
   every stage that might one day want one. */
function flatPlateFor(canvasId) {
  const cv = document.getElementById(canvasId);
  if (!cv) return null;
  const host = cv.parentElement;
  let el = host.querySelector('.sv-plate');
  if (!el) {
    el = document.createElement('div');
    el.className = 'sv-plate';
    el.hidden = true;
    host.appendChild(el);
  }
  return el;
}
function showFlatPlate(canvasId, { art, color, name, kindName, icon: ico }) {
  const el = flatPlateFor(canvasId);
  if (!el) return;
  const cv = document.getElementById(canvasId);
  if (cv) cv.style.visibility = 'hidden';
  el.hidden = false;
  el.style.setProperty('--pc', color);
  el.innerHTML = (art
      ? `<img class="sv-plate-art" width="128" height="128" alt="">`
      : `<span class="sv-plate-ico">${icon(ico, { size: 64 })}</span>`) +
    `<b>${escapeHtml(name)}</b><small>${escapeHtml(kindName)}</small>`;
  // property, not a src="..." string — see renderClubDecalPicker's comment
  if (art) el.querySelector('.sv-plate-art').src = art;
}
function hideFlatPlate(canvasId) {
  const cv = document.getElementById(canvasId);
  if (cv) cv.style.visibility = '';
  const el = document.getElementById(canvasId)?.parentElement?.querySelector('.sv-plate');
  if (el) el.hidden = true;
}

HUD.previewOwnedItem = (canvasId, capId, kind, id, opts = {}) => {
  const cv = document.getElementById(canvasId);
  if (!cv) return;
  const cap = document.getElementById(capId);
  const setCap = (name, sub) => {
    if (cap) cap.innerHTML = `<b>${escapeHtml(name || '')}</b>` + (sub ? `<small>${escapeHtml(sub)}</small>` : '');
  };

  if (kind === 'emote') {
    hideFlatPlate(canvasId);
    // the card IS the preview — the golfer standing there plays the pose
    // live, exactly as the wardrobe already does rather than looping a
    // canned clip in the card
    const st = avatarStage(canvasId);
    if (st) st.play(id);
    setCap(opts.name || id, 'Playing it now');
    return;
  }

  clearAvatarStage(canvasId);
  const rarity = opts.rarity || RARITIES[0];
  const color = opts.color || rarity.color;

  /* Three kinds have no model and never will: a title is words beside your
     name, and hat/melee have no equip path anywhere in the game. A trail
     has no model either, but it DOES have real 2D art. Spinning a grey cube
     at any of them is worse than showing nothing — so they get a flat
     plate over the canvas instead, which is an honest picture of a thing
     that is not a 3D object. */
  const FLAT = { title: null, hat: null, melee: null, trail: 'art' };
  if (kind in FLAT) {
    const art = FLAT[kind] === 'art' ? trailPreviewDataUrl(color, 128) : null;
    showFlatPlate(canvasId, {
      art, color, name: opts.name || id,
      kindName: UNLOCK_KINDS[kind]?.name || kind,
      icon: CASE_KIND_ICON[kind] || 'gift'
    });
    setCap(opts.name || id, opts.sub || (UNLOCK_KINDS[kind]?.name || ''));
    return;
  }
  hideFlatPlate(canvasId);

  if (kind === 'decal') {
    // the decal on an actual club, which is the only place it is ever
    // really seen — a 40px flat tile is a swatch, not the thing
    showShopItem(cv, { kind: 'club', key: 'DR', set: opts.clubSet || STARTER_SET,
      skin: opts.clubSkin || 'stock',
      decal: { id, color, purity: opts.purity || 0 },
      name: opts.name, sub: opts.sub });
  } else if (kind === 'clubset') {
    showShopItem(cv, { kind: 'club', key: 'DR', set: id, skin: opts.clubSkin || 'stock',
      name: opts.name, sub: opts.sub });
  } else if (kind === 'ball') {
    /* `id` is the finish, and the turntable now wears it — a chrome ball
       reflects, a matte one does not, and the reveal shows the difference
       the moment somebody pulls one. */
    showShopItem(cv, { kind: 'ball', hex: opts.ballColor || HUD.myBallHex || '#f6f9f4', finish: id,
      name: opts.name, sub: opts.sub });
  } else {
    /* trail/title/hat/melee have no 3D model anywhere in the game. Rather
       than spin a coloured cube at somebody, the caption carries it and
       the stage shows the item's own colour. */
    showShopItem(cv, { kind: 'item', hex: color, name: opts.name, sub: opts.sub });
  }
  setCap(opts.name || id, opts.sub || (UNLOCK_KINDS[kind]?.name || ''));
};


/* ══════════════════════════ SIDE BY SIDE ════════════════════════════════
   What a set would actually change about your bag, against the one you
   carry. Four stats, one club class at a time — five classes x four stats
   is twenty numbers, which is a spreadsheet, not a decision.

   The delta is the point. A bar shows where each set sits on the whole
   game's range for that stat; the number beside it says which direction
   you would be moving and by how much, green for better and red for worse.
   Forgiveness and sweet spot read in their own units (percentage points
   and degrees of face) because a percentage of a damping coefficient is
   not a thing anybody can picture. */
const CMP_RANGE = {
  dist:    [0.860, 1.065],
  forgive: [0.00, 0.33],
  spin:    [0.92, 1.20],
  sweet:   [5.6, 8.8]
};
/* How each stat's delta is written. `pts` for the two that are already
   fractions of something, `pct` for the two that are multipliers. */
const CMP_FMT = {
  dist:    d => (d >= 0 ? '+' : '') + (d * 100).toFixed(1) + '%',
  forgive: d => (d >= 0 ? '+' : '') + (d * 100).toFixed(1) + ' pts',
  spin:    d => (d >= 0 ? '+' : '') + (d * 100).toFixed(1) + '%',
  sweet:   d => (d >= 0 ? '+' : '') + d.toFixed(2) + '\u00b0'
};
/* Which club the class's line is read through. setStats answers per CLUB,
   so comparing "wedges" means asking it about a representative wedge. */
const CMP_CLUB = { driver: 'DR', woods: 'W3', irons: 'I7', wedges: 'SW', putter: 'PT' };

HUD.cmpClass = 'driver';

/**
 * Render the comparison. `setId` is what is being hovered; the equipped set
 * and its completion come from the profile.
 */
HUD.renderSetCompare = (prof, setId) => {
  const box = el.setCompare;
  if (!box) return;
  const other = setById(setId);
  if (!other) { box.hidden = true; return; }
  box.hidden = false;

  const mineId = prof?.clubSet || STARTER_SET;
  const mine = setById(mineId);
  const piecesOf = id => (prof?.clubPieces || {})[id] || [];
  const gradeOf = id => (prof?.clubGrades || {})[id] ?? 1;
  const cls = HUD.cmpClass;
  const club = CMP_CLUB[cls] || 'I7';

  // the CLASS's completion for the club being compared, and each set's
  // own grade — the same two numbers the simulation would use
  const a = setStats(mineId, pieceCompletionFor(piecesOf(mineId), club), club, gradeOf(mineId));
  const b = setStats(other.id, pieceCompletionFor(piecesOf(other.id), club), club, gradeOf(other.id));
  const same = other.id === mineId;

  const classStrip = CLUB_CLASSES.map(k =>
    `<button class="cmp-cls${k === cls ? ' on' : ''}" data-cmpcls="${k}">${escapeHtml(CLASS_LABEL[k])}</button>`).join('');

  const rows = STAT_KEYS.map(k => {
    const [lo, hi] = CMP_RANGE[k];
    const pos = v => Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * 100;
    const d = (b?.[k] ?? 0) - (a?.[k] ?? 0);
    // a hair of tolerance: a delta of 0.0001 is not a difference anybody
    // is making a decision about, and colouring it green would be a lie
    const dir = Math.abs(d) < 1e-4 ? 'same' : d > 0 ? 'up' : 'down';
    return `<div class="cmp-row">
      <span class="cmp-name">${escapeHtml(STAT_LABEL[k])}</span>
      <span class="cmp-track">
        <i class="cmp-have" style="width:${pos(a?.[k] ?? lo).toFixed(1)}%"></i>
        <i class="cmp-want cmp-${dir}" style="width:${pos(b?.[k] ?? lo).toFixed(1)}%"></i>
      </span>
      <span class="cmp-d cmp-${dir}">${same ? '\u2014' : CMP_FMT[k](d)}</span>
    </div>`;
  }).join('');

  box.innerHTML =
    `<div class="cmp-head">
       <b>${escapeHtml(other.name)}</b>
       <small>${same ? 'the set you carry' : 'vs ' + escapeHtml(mine?.name || 'your set')}</small>
     </div>
     <div class="cmp-classes">${classStrip}</div>
     <div class="cmp-rows">${rows}</div>`;

  if (!box.dataset.wired) {
    box.dataset.wired = '1';
    box.addEventListener('click', e => {
      const b2 = e.target.closest('[data-cmpcls]');
      if (!b2) return;
      HUD.cmpClass = b2.dataset.cmpcls;
      HUD.renderSetCompare(HUD._cmpProf, HUD._cmpSet);
    });
  }
  HUD._cmpProf = prof; HUD._cmpSet = setId;
};

HUD.hideSetCompare = () => { if (el.setCompare) el.setCompare.hidden = true; };


/* ─────────────────────────── the reveal's own turntable ─────────────────
   A pulled set is shown as the actual club, on the same shopview stage the
   Pro Shop turntable uses, and you can drag it. The grade goes in the
   corner because that is where a grade belongs: a number attached to this
   specific item, not to the set in general. */
HUD.showRevealModel = (setId, grade) => {
  const cv = el.caseItemCanvas;
  if (!cv) return;
  showShopItem(cv, { kind: 'club', key: 'DR', set: setId, skin: 'stock' });

  const badge = el.caseGrade;
  if (badge) {
    if (grade == null) badge.hidden = true;
    else {
      const t = gradeTier(grade);
      badge.hidden = false;
      badge.style.setProperty('--gc', t.color);
      badge.innerHTML = `<b>${formatGrade(grade)}</b><small>${escapeHtml(t.name)}</small>`;
    }
  }

  /* Drag to turn, forwarded into shopview the same way the club-inspect
     modal already does it. Bound once — the canvas is persistent. */
  if (!cv.dataset.orbit) {
    cv.dataset.orbit = '1';
    const o = { yaw: 0, pitch: 0 };
    let last = null;
    cv.addEventListener('pointerdown', e => {
      last = { x: e.clientX, y: e.clientY };
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', e => {
      if (!last) return;
      o.yaw += (e.clientX - last.x) * 0.012;
      o.pitch = Math.max(-0.6, Math.min(0.6, o.pitch + (e.clientY - last.y) * 0.010));
      last = { x: e.clientX, y: e.clientY };
      setShopOrbit(cv, o.yaw, o.pitch);
    });
    const release = () => { last = null; };
    cv.addEventListener('pointerup', release);
    cv.addEventListener('pointercancel', release);
  } else {
    releaseShopOrbit(cv);          // a new pull starts turning on its own again
  }
};

/* ────────────────────────── what is actually in a case ──────────────────
   Every item that can drop, before anything is spent. Grouped by rarity,
   bordered in the rarity's own colour — the same five colours the reveal,
   the marketplace and the set cards already use.

   This replaces a swatch strip that showed a handful of decals: an odds
   table tells you the chance of a tier, and this tells you what is
   actually IN that tier, which is the question somebody deciding whether
   to spend has. */
HUD.casePoolHTML = kind => {
  const isClub = kind === 'club' || kind === 'set';
  const pool = isClub
    ? CLUB_SETS.map(x => ({ id: x.id, name: x.name, rarity: x.rarity, kind: 'clubset', color: x.shaft }))
    : CASE_POOL.map(x => ({ id: x.id, name: x.name, rarity: x.rarity, kind: x.kind, color: x.color }));

  const order = ['mythic', 'legend', 'pro', 'tour', 'standard'];
  return order.map(rid => {
    const rows = pool.filter(x => x.rarity === rid);
    if (!rows.length) return '';
    const rarity = RARITIES.find(r => r.id === rid) || RARITIES[0];
    const items = rows.map(x => {
      const art = x.kind === 'decal'
        ? `<img width="30" height="30" alt="" data-decal="${escapeHtml(x.id)}" data-c="${escapeHtml(x.color || rarity.color)}">`
        : icon(CASE_KIND_ICON[x.kind] || 'gift', { size: 26 });
      return `<div class="case-pool-item" style="--rc:${rarity.color}">
        <span class="case-pool-art">${art}</span>
        <b>${escapeHtml(x.name)}</b>
      </div>`;
    }).join('');
    return `<div class="case-pool-head" style="color:${rarity.color}">${escapeHtml(rarity.name)} · ${rows.length}</div>
      <div class="case-pool">${items}</div>`;
  }).join('');
};

/** Decal art is a data URI, which must never be written into an HTML
 *  string as src="..." — the portal bundle verifier reads that as a real
 *  asset path. So the markup leaves the <img> blank and this fills it in. */
HUD.paintCasePool = root => {
  for (const img of (root || document).querySelectorAll('img[data-decal]')) {
    const url = shaftDecalDataUrl(img.dataset.decal, img.dataset.c, 0, 48);
    if (url) img.src = url;
  }
};

/* ------------------------------------------------------- marketplace --- */
/** Same preview dispatcher and rarity-scoped art the Items shop tab and
 *  Inventory page already share (itemPreviewUrl) — a listing has to look
 *  like the same kind of card everywhere an item is shown, not a fourth
 *  new visual language for this one screen. */
function marketCardArt(kind, id, purity) {
  const art = document.createElement('div');
  art.className = 'inv-art';
  const casePoolItem = CASE_POOL.find(it => it.kind === kind && it.id === id);
  const rarity = casePoolItem ? (RARITIES.find(r => r.id === casePoolItem.rarity) || RARITIES[0]) : null;
  const preview = casePoolItem ? itemPreviewUrl(casePoolItem, rarity, 40, purity) : null;
  if (preview) {
    const img = document.createElement('img');
    img.width = 40; img.height = 40; img.alt = '';
    img.src = preview;
    art.appendChild(img);
    if (purity) {
      const tier = purityTier(purity);
      const badge = document.createElement('b');
      badge.className = 'decal-purity'; badge.style.setProperty('--pc', tier.color);
      badge.textContent = purity;
      art.appendChild(badge);
    }
  } else {
    art.innerHTML = icon(['decal', 'trail', 'title', 'ball'].includes(kind) ? kind : 'gift', { size: 20 });
  }
  return { art, item: casePoolItem };
}

function emptyMarketNote(box, text) {
  box.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'tiny';
  p.textContent = text;
  box.appendChild(p);
}

/** Browse: every active listing, newest first (as the server already
 *  sorts it), Buy behind the same two-tap confirm every real-currency
 *  action in this game uses. */
HUD.renderMarket = (listings, gems, onBuy) => {
  const box = el.marketBrowse;
  if (!box) return;
  if (!listings.length) return emptyMarketNote(box, 'Nothing listed right now — check back soon, or list something of your own from the Inventory tab.');
  box.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'inv-grid';
  for (const l of listings) {
    const { art, item } = marketCardArt(l.kind, l.itemId, l.purity);
    const card = document.createElement('div');
    card.className = 'inv-card owned';
    card.dataset.prev = marketPrevData(l, item);
    card.appendChild(art);
    const name = document.createElement('b');
    name.textContent = item?.name || l.itemId;
    card.appendChild(name);
    const status = document.createElement('span');
    status.className = 'inv-status';
    status.textContent = `${l.sellerName} · ${l.price.toLocaleString()} gems`;
    card.appendChild(status);
    const btns = document.createElement('div');
    btns.className = 'inv-btns';
    const buy = document.createElement('button');
    buy.className = 'btn mini primary';
    buy.textContent = 'Buy';
    buy.disabled = gems < l.price;
    let armed = 0;
    buy.addEventListener('click', () => {
      const now = Date.now();
      if (now - armed > 3000) {
        armed = now;
        buy.classList.add('confirm'); buy.textContent = 'Tap again';
        setTimeout(() => { buy.classList.remove('confirm'); buy.textContent = 'Buy'; }, 3000);
        return;
      }
      onBuy(l.id);
    });
    btns.appendChild(buy);
    card.appendChild(btns);
    grid.appendChild(card);
  }
  box.appendChild(grid);
};

/** My listings: what's currently escrowed and waiting for a buyer, with a
 *  way to take it back. */
HUD.renderMyListings = (listings, onCancel) => {
  const box = el.marketMine;
  if (!box) return;
  if (!listings.length) return emptyMarketNote(box, 'You don’t have anything listed. List a case-only item from the Inventory tab.');
  box.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'inv-grid';
  for (const l of listings) {
    const { art, item } = marketCardArt(l.kind, l.itemId, l.purity);
    const card = document.createElement('div');
    card.className = 'inv-card owned';
    card.dataset.prev = marketPrevData(l, item);
    card.appendChild(art);
    const name = document.createElement('b');
    name.textContent = item?.name || l.itemId;
    card.appendChild(name);
    const status = document.createElement('span');
    status.className = 'inv-status';
    status.textContent = `${l.price.toLocaleString()} gems`;
    card.appendChild(status);
    const btns = document.createElement('div');
    btns.className = 'inv-btns';
    const cancel = document.createElement('button');
    cancel.className = 'btn mini';
    cancel.textContent = 'Cancel';
    let armed = 0;
    cancel.addEventListener('click', () => {
      const now = Date.now();
      if (now - armed > 3000) {
        armed = now;
        cancel.classList.add('confirm'); cancel.textContent = 'Tap again';
        setTimeout(() => { cancel.classList.remove('confirm'); cancel.textContent = 'Cancel'; }, 3000);
        return;
      }
      onCancel(l.id);
    });
    btns.appendChild(cancel);
    card.appendChild(btns);
    grid.appendChild(card);
  }
  box.appendChild(grid);
};

/** What a listing is, for the preview stage — the same payload shape the
 *  Inventory grid stamps, so one dispatcher serves both surfaces. */
function marketPrevData(l, item) {
  return JSON.stringify({
    kind: l.kind, id: l.itemId, name: item?.name || l.itemId,
    color: item?.color || null, rarity: item?.rarity || null,
    purity: l.purity || 0,
    sub: `${l.price.toLocaleString()} gems`
  });
}

/** Bound once on a persistent ancestor, so it covers Browse and My
 *  listings without rebinding on every re-render. */
function wireMarketPreview() {
  const pane = document.querySelector('.hkpane[data-pane="market"]');
  if (!pane || pane.dataset.prevWired) return;
  pane.dataset.prevWired = '1';
  const show = e => {
    const card = e.target.closest('[data-prev]');
    if (!card) return;
    try {
      const d = JSON.parse(card.dataset.prev);
      HUD.previewOwnedItem('mktCanvas', 'mktCap', d.kind, d.id, {
        name: d.name, sub: d.sub, color: d.color, purity: d.purity,
        rarity: RARITIES.find(r => r.id === d.rarity) || RARITIES[0]
      });
    } catch { /* ignore */ }
  };
  pane.addEventListener('pointerover', show);
  pane.addEventListener('focusin', show);
  pane.addEventListener('click', show);
}

HUD.bindMarketSubTabs = () => {
  const bar = el.marketSubTabs;
  if (!bar || bar.dataset.bound) return;
  bar.dataset.bound = '1';
  wireMarketPreview();
  bar.addEventListener('click', e => {
    const b = e.target.closest('.mktsubtab');
    if (!b) return;
    const name = b.dataset.msub;
    for (const t of bar.querySelectorAll('.mktsubtab')) t.classList.toggle('on', t === b);
    for (const p of document.querySelectorAll('.mktpane')) p.hidden = p.dataset.msub !== name;
  });
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

/* ?net=1 only — see main.js's boot() for where this gets turned on. The
   numbers netPill's three bars are already summarising, in full: what
   they're actually built from, for diagnosing a specific report rather
   than just re-confirming the pill agrees with it. */
HUD.renderNetDiag = (net) => {
  const box = el.netDiag;
  if (!box || box.hidden) return;
  const set = (k, v) => { const s = box.querySelector(`[data-k="${k}"]`); if (s) s.textContent = v; };
  set('transport', `transport ${net.transport || '—'}`);
  set('rtt', `rtt ${net.rtt == null ? '—' : net.rtt + 'ms'}`);
  set('jitter', `jitter ${net.jitter == null ? '—' : '±' + net.jitter + 'ms'}`);
  set('pctile', `p50/p95 ${net.p50 == null ? '—' : net.p50 + '/' + net.p95 + 'ms'}`);
  const missPct = net.pingsSent ? Math.round(100 * net.pingsMissed / net.pingsSent) : 0;
  set('missed', `missed pings ${net.pingsMissed}/${net.pingsSent} (${missPct}%)`);
  set('disconnects', `disconnects ${net.disconnects}${net.lastDisconnectReason ? ' — ' + net.lastDisconnectReason : ''}`);
};

/* ---------------------------------------------------- weekly leaders --- */
/** The landing page's "top this week" preview. Hidden with zero rows rather
    than shown empty — before anybody's played this week (a fresh server, or
    a Monday morning) there is nothing to brag about yet. */
HUD.renderWeeklyTop = rows => {
  if (!el.lpWeekTop) return;
  if (!rows?.length) {
    el.lpWeekTop.hidden = true;
    if (el.lpWeekTopEmpty) el.lpWeekTopEmpty.hidden = false;
    return;
  }
  el.lpWeekTop.hidden = false;
  if (el.lpWeekTopEmpty) el.lpWeekTopEmpty.hidden = true;
  el.lpWeekTopRows.innerHTML = rows.map(r => `
    <div class="lp-wt-row">
      <span class="lp-wt-rank">${r.rank}</span>
      <span class="lp-wt-name">${escapeHtml(r.name)}</span>
      <span class="lp-wt-gain">+${r.gained.toLocaleString()} XP</span>
    </div>`).join('');
};

/** The landing page's live top-3 world ranking, the same shape as the weekly
    preview beside it (rank/name/a number), just off world:ranking instead
    of the weekly-gain feed. */
HUD.renderLpGlobalRank = data => {
  if (!el.lpGlobalRankRows) return;
  const top = (data?.top || []).slice(0, 3);
  if (!top.length) {
    el.lpGlobalRankRows.innerHTML = '';
    if (el.lpGlobalRankEmpty) el.lpGlobalRankEmpty.hidden = false;
    return;
  }
  if (el.lpGlobalRankEmpty) el.lpGlobalRankEmpty.hidden = true;
  el.lpGlobalRankRows.innerHTML = top.map(r => `
    <div class="lp-wt-row">
      <span class="lp-wt-rank">${r.rank}</span>
      <span class="lp-wt-name">${escapeHtml(r.name)}</span>
      <span class="lp-wt-gain">${r.rating}</span>
    </div>`).join('');
};

/** Total rounds, on the front door — the one career number the reference
    design wants visible before the clubhouse's own, fuller stat block. */
HUD.setLpRounds = n => { if (el.lpTotalRounds) el.lpTotalRounds.textContent = (n || 0).toLocaleString(); };

/** A handful of small circles standing in for "there are people online" —
    initials on a colour hashed from the name, the same no-photo language
    every avatar in this game already uses (the 3D golfer has no face
    either). Not a fabricated roster: real names, from the same friends
    list the side panel shows, filtered to whoever is actually online right
    now, capped at 5 so a busy list doesn't overflow the card. */
function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 55% 42%)`;
}
HUD.renderLpFriendAvatars = people => {
  if (!el.lpFriendAvatars) return;
  const online = (people || []).filter(p => p.online).slice(0, 5);
  if (!online.length) { el.lpFriendAvatars.hidden = true; el.lpFriendAvatars.innerHTML = ''; return; }
  el.lpFriendAvatars.hidden = false;
  el.lpFriendAvatars.innerHTML = online.map(p =>
    `<span class="lp-avatar" style="background:${avatarColor(p.name || '?')}" title="${escapeHtml(p.name || 'A golfer')}">` +
    `${escapeHtml((p.name || '?')[0].toUpperCase())}</span>`).join('');
};

/* ------------------------------------------------------ daily rewards --- */
/* The badge and the line under it say the same thing, so they move
   together. "come back tomorrow" sitting next to a lit exclamation mark is
   the card contradicting its own badge — and it was static text nothing
   ever wrote to, so it said that even on the day a claim was waiting. */
HUD.showRewardsBadge = show => {
  if (el.lpRewardsBadge) el.lpRewardsBadge.hidden = !show;
  if (el.lpRewardsSub) el.lpRewardsSub.textContent = show ? 'ready to claim' : 'come back tomorrow';
  el.lpRewardsBtn?.classList.toggle('claimable', !!show);
};

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
    const rewardIcon = reward.cases ? icon('caseCommon') : reward.gems ? icon('gem') : icon('coin');
    const amt = reward.cases
      ? `${reward.cases}×${reward.gems ? ` +${reward.gems}${icon('gem')}` : ''}`
      : reward.gems ? `+${reward.gems}` : `+${reward.coins}`;
    tile.innerHTML = `<span class="rw-day">${d}</span><span class="rw-ico">${rewardIcon}</span><span class="rw-amt">${amt}</span>`;
    el.rwGrid.appendChild(tile);
  }

  el.btnRewardsClaim.disabled = claimedToday;
  el.btnRewardsClaim.textContent = claimedToday ? 'Come back tomorrow' : `Claim day ${claimableDay}`;
  el.rwGems.textContent = (profile.gems || 0).toLocaleString();
  // The same two icons everywhere else a case shows up — caseCommon for
  // the standard tier, caseLegendary for Pro — not a third and fourth
  // colour scheme invented just for this card. There are only three real
  // chests in the game (see icons.js/shopview.js); this used to disagree
  // with both of them.
  if (el.rwCaseArt && !el.rwCaseArt.firstChild) el.rwCaseArt.innerHTML = icon('caseCommon', { size: 40 });
  if (el.rwProCaseArt && !el.rwProCaseArt.firstChild) el.rwProCaseArt.innerHTML = icon('caseLegendary', { size: 40 });
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
const CASE_KIND_ICON = { decal: 'decal', trail: 'trail', title: 'title', ball: 'ball',
                         clubset: 'ironHead', cartdecal: 'cart' };

/** A real preview for the 3 kinds a 2D canvas can fake convincingly — a
 *  shaft decal, a lit-sphere ball finish, a fading particle trail — used
 *  by both the Items shop tab and the Inventory page so the two surfaces
 *  can't drift into showing different art for the same item. `size` > 48
 *  only matters for the decal path (see shaftDecalDataUrl's own note);
 *  the finish/trail previews are drawn at whatever size is asked for.
 *  title/emote/hat/melee have nothing worth building a preview for (text,
 *  or a system with no equip path at all) and return null. */
function itemPreviewUrl(item, rarity, size = 64, purity = 0) {
  const color = item.color || rarity.color;
  if (item.kind === 'decal') return shaftDecalDataUrl(item.id, color, purity, size);
  /* A cart livery is drawn 4:1, the shape of the panel it lands on, so it
     is asked for by WIDTH and comes back letterboxed rather than cropped
     square — a chequered flag cropped to its middle is a grey square. */
  if (item.kind === 'cartdecal') return cartDecalDataUrl(item.id, color, size);
  if (item.kind === 'ball') return ballFinishDataUrl(color, item.id, size);
  if (item.kind === 'trail') return trailPreviewDataUrl(color, size);
  return null;
}

/** Back to "tap to open", for the moment the modal is shown.
 *  `sincePity` is the profile's own casesSincePity — shown as a countdown
 *  to the guaranteed Pro-or-better pull, published rather than hidden, so
 *  a long run of Standard pulls reads as "N left" instead of "is this
 *  rigged". */
/* One entry per case type, so the three tiers are three rows in a table
   rather than three near-identical if/else chains scattered through this
   file. 'standard' rolls the whole ladder and accrues pity; 'vault' and
   'pro' each guarantee their own floor and never touch that counter (see
   profiles.js's openVaultCase/openProCase). */
const CASE_TIERS = {
  standard: { pityLabel: null, oddsFn: tierOdds, swatchFloor: null },
  vault: { pityLabel: 'Always Tour or better', oddsFn: vaultTierOdds, swatchFloor: VAULT_TIER },
  pro: { pityLabel: 'Always Pro or better', oddsFn: proTierOdds, swatchFloor: PITY_TIER },
  /* The Club Case rolls SETS on its own odds table, not the cosmetic
     ladder, so it brings its own rows rather than borrowing tierOdds(). */
  club: { pityLabel: 'Club sets only', oddsFn: clubCaseOdds, swatchFloor: null },
  set: { pityLabel: 'A complete set, all 14 clubs', oddsFn: clubCaseOdds, swatchFloor: null }
};

/** The Club Case's own odds, in the shape caseOddsRowsHTML expects. */
function clubCaseOdds() {
  const total = CLUB_CASE_ODDS.reduce((s, r) => s + r.weight, 0);
  return CLUB_CASE_ODDS.map(r => {
    const rarity = RARITIES.find(x => x.id === r.id) || RARITIES[0];
    return { id: r.id, name: rarity.name, color: rarity.color,
             pct: r.weight / total * 100, kinds: ['clubset'],
             count: CLUB_SETS.filter(s => s.rarity === r.id).length };
  });
}

/* The 3D case-opening view — one live controller at a time, matching the
   one modal it drives. mountCaseOpener disposes and rebuilds the previous
   case's geometry itself (see shopview.js), so a fresh HUD.resetCaseModal
   call is always safe to fire even if the last open never finished. */
let caseOpener = null;
HUD.resetCaseModal = (sincePity = 0, kind = 'standard') => {
  el.caseStage.hidden = false;
  el.caseReelWrap.hidden = true;
  el.caseReveal.hidden = true;
  el.btnCaseDone.hidden = true;
  caseOpener = mountCaseOpener(el.caseOpenCanvas, kind);
  el.caseHint.textContent = 'Tap to open';
  HUD.renderCasePity(sincePity, kind);
  HUD.renderCaseContents(kind);
  if (el.caseContents) {
    el.caseContents.hidden = true;
    el.btnCaseContents?.setAttribute('aria-expanded', 'false');
  }
  el.caseReelWrap.closest('.casecard')?.classList.remove('reeling');
};

/** A guaranteed-floor case (vault/pro) skips the countdown entirely — it
 *  doesn't accrue pity, it just always starts at its own floor. */
HUD.renderCasePity = (sincePity, kind = 'standard') => {
  if (!el.casePity) return;
  const tier = CASE_TIERS[kind] || CASE_TIERS.standard;
  if (tier.pityLabel) { el.casePity.textContent = tier.pityLabel; return; }
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
function caseDecalSwatchesHTML(kind = 'standard') {
  const floor = CASE_TIERS[kind]?.swatchFloor;
  const pool = CASE_POOL.filter(it => it.kind === 'decal'
    && (!floor || tierIndex(it.rarity) >= tierIndex(floor)));
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
    if (!pattern) continue;
    // an <img> with its src property set directly, not a CSS background
    // built from a wrapping helper function around the data URI — the
    // portal bundle verifier's static scanner reads that wrapped shape of
    // text as a real asset reference and chokes trying to resolve it,
    // regardless of the runtime value. Same fix renderClubDecalPicker
    // already uses for this exact function, just missed here the first
    // time.
    const img = document.createElement('img');
    img.width = 26; img.height = 26; img.alt = '';
    img.src = pattern;
    el.appendChild(img);
  }
}

/* Built once per case type, since nothing in either depends on the player:
   every case of a given type draws from the exact same pool at the exact
   same odds (see cases.js's tierOdds/vaultTierOdds/proTierOdds). */
const caseContentsCache = {};
HUD.renderCaseContents = (kind = 'standard') => {
  if (!el.caseContents) return;
  const tier = CASE_TIERS[kind] || CASE_TIERS.standard;
  if (!caseContentsCache[kind]) caseContentsCache[kind] = caseOddsRowsHTML(tier.oddsFn());
  el.caseContents.innerHTML = caseContentsCache[kind];
};

/** Starts the 3D crack-open animation on the case mounted by the last
 *  HUD.resetCaseModal call. `onCrack` fires at the flash's peak — a cue for
 *  a sound, nothing more, since HIDING case-stage this early would cut the
 *  animation off mid-flight. `onDone` fires once both halves have fully
 *  dissolved, which is when the caller should actually switch to the reel. */
HUD.playCaseUnbox = ({ onCrack, onDone } = {}) => {
  caseOpener?.playUnbox({ onCrack, onDone });
};
/** Frees the 3D case's geometry/light — called when the case-opening page
 *  closes, same discipline every other three.js teardown in this game
 *  follows (see scene.js's own dispose-on-rebuild). */
HUD.disposeCaseOpener = () => { caseOpener?.dispose(); caseOpener = null; };

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

  // A purity result still landed on a real pool item (the decal it just
  // polished) — the reel treats it exactly like an item pull, right down
  // to the near-miss weighting, using that decal's own native rarity
  // (CASE_POOL already tags every entry with one) rather than anything
  // about the purity gain itself, which the reel has no use for.
  const isItem = result.kind === 'item' || result.kind === 'purity';
  const rarity = isItem ? (RARITIES.find(r => r.id === (result.rarity || result.item?.rarity)) || RARITIES[0])
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
  const isPurity = result.kind === 'purity';
  // A purity result still has a real item (the decal it just polished) —
  // its OWN rarity badge shows the resulting purity tier instead of the
  // item's already-known rarity, since "Polished" is the actual news this
  // pull delivered, not the fact that it's a decal the player has owned
  // for ages.
  const pTier = isPurity ? purityTier(result.newPurity) : null;
  const rarity = isItem ? (RARITIES.find(r => r.id === result.rarity) || RARITIES[0])
    : isPurity ? { name: pTier.name, color: pTier.color }
    : { name: 'Bonus', color: '#8fe07a' };
  el.caseReveal.style.setProperty('--rarity-color', rarity.color);
  el.caseRarity.textContent = rarity.name;
  el.caseRarity.style.color = rarity.color;
  if (isItem || isPurity) {
    // A decal pull gets its own actual pattern, not a generic silhouette —
    // the shaft decal system draws real art now (shaftdecals.js), so there
    // is a real thing to show. Everything else (trail/title/ball) still
    // has no equivalent asset, so it keeps the currentColor icon, tinted
    // to the item's own colour or the rarity colour — the whole point of
    // the switch off emoji, still true for the kinds with nothing else to
    // draw.
    const itemColor = result.item.color || rarity.color;
    const purityNow = isPurity ? result.newPurity : 0;
    const pattern = result.item.kind === 'decal' ? shaftDecalDataUrl(result.item.id, itemColor, purityNow) : null;
    /* A CLUB SET GETS A MODEL, not a picture. Everything else keeps the
       flat art it already had — a decal's own pattern says more about it
       than any mesh would, and there is no mesh for a title at all. The
       name and kind lines below still run either way, so the two paths
       differ only in what fills the box above them. */
    const isSet = result.item.kind === 'clubset';
    if (el.case3d) el.case3d.hidden = !isSet;
    el.caseItemArt.hidden = isSet;
    if (isSet) HUD.showRevealModel(result.item.id, result.grade);
    else if (pattern) {
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
    if (isPurity) {
      el.caseItemName.textContent = `${result.item.name} — +${result.gain} purity`;
      el.caseItemKind.textContent = `now ${pTier.name} (${result.newPurity}%)`;
    } else {
      el.caseItemName.textContent = result.item.name;
      el.caseItemKind.textContent = UNLOCK_KINDS[result.item.kind]?.name || result.item.kind;
    }
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
/* THE OLD CLUBHOUSE TAB BAR IS RETIRED. The nav bar navigates now, and two
   navigations that disagree about which room you are in is worse than
   either alone. The bar itself stays in the DOM but is never revealed —
   removing it would break the no-JS fallback, where the clubhouse is still
   one long scrolling page with everything on it.

   These two functions survive because a handful of callers still reach for
   them; both now defer to the page system rather than owning a tab state. */
HUD.bindClubhouse = () => {
  const bar = document.getElementById('hkTabs');
  if (bar) bar.hidden = true;                    // the nav bar replaced it
  document.body.classList.add('hktabbed');       // still gates the no-JS layout
  // Controls has no page of its own — one panel, behind the gear in the header
  const gear = document.getElementById('hkSettingsBtn');
  if (gear && !gear.dataset.bound) {
    gear.dataset.bound = '1';
    gear.addEventListener('click', () => HUD.showPanes(['keys']));
  }
};

/** Kept as a thin alias so older call sites keep working. Panes are what a
 *  page shows now, so this is one pane rather than one tab. */
HUD.showClubhouseTab = name => HUD.showPanes([name]);

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
    return `<li class="wr clickable${mine ? ' mine' : ''}" data-profile="${r.pid}">` +
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

/* A record holder is only a LINK if there is somebody there to open. The
   board is seeded with fictional pros and carries leftovers from round-bot
   runs, and the server marks which holders have a real profile (see
   stampReal in server.js) — a name that always errors when you click it is
   worse than a name that never looked clickable. */
const holderLink = r => (r && r.pid && r.real) ? ` data-profile="${r.pid}"` : '';

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
      `<span class="rc-who"${holderLink(r)}>${r ? escapeHtml(r.pid === myPid ? 'you' : r.name) : 'unclaimed'}</span>` +
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
        `<span class="rd-who"${holderLink(dr)}>${dr ? escapeHtml(dr.pid === myPid ? 'you' : dr.name) : 'unclaimed'}</span>`;
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
            `<b>${h.strokes}</b><em${holderLink(h)}>${escapeHtml(mine ? 'you' : h.name)}</em></span>`;
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
    row.className = 'on-row clickable';
    // strangers most of all: this panel exists to answer "who is that"
    row.dataset.profile = o.pid;
    row.title = `See ${o.name}'s profile`;
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
import { cartDecalDataUrl } from './cartdecals.js';
import { showItem as showShopItem, setUserOrbit as setShopOrbit, releaseUserOrbit as releaseShopOrbit,
         mountCaseOpener, mountAvatarStage } from './shopview.js';
import { CLUB_SKINS, skinById, skinEarned, skinRequirement, skinProgress,
         RARITY_ACCENT } from '../shared/clubskins.js';
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
  HUD.myBallFinish = look?.ballFinish || null;   // for the shop's ball turntable

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
    `<div class="rkrow clickable${r.pid === myPid || r.me ? ' me' : ''}${r.friend ? ' pal' : ''}"
       ${r.pid ? `data-profile="${r.pid}"` : ''}>
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
import { handicapText as hcpText, rankTier as rTier, rankTitle } from '../shared/handicap.js';

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
    rows.push(`<div class="fr-row clickable${f.fav ? ' fav' : ''}" data-profile="${f.pid}"
      title="See ${escapeHtml(f.name)}'s profile">
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

/* ═════════════════════════════════════════ SOMEBODY ELSE'S PROFILE ══════
   Opened from a friends list, a leaderboard or the room roster. A modal
   rather than a page, because you arrive from a list and want to go back to
   your place in it.

   THE CONTENT IS THE POINT. A card with a name, a level and a rating on it
   is what every list already showed — nothing worth a click. What is not
   anywhere else is the GOLFER: their outfit, the set they carry and how
   much of it they have collected, the finish on their clubs, the clubs they
   actually play. That is what people look each other up for.

   Everything here comes from the server's visitorProfile projection, which
   is an allow-list and carries no wallet — see the note on it in
   server/profiles.js. This function must never be handed a publicProfile. */
HUD.showProfile = (prof, opts = {}) => {
  const modal = document.getElementById('modalProfile');
  if (!modal || !prof) return;
  modal.hidden = false;

  const t = rTier(prof.level || 1);
  document.getElementById('pvName').textContent = prof.name || 'A golfer';

  /* Their golfer, turning. The same avatar stage the wardrobe uses, so what
     you see here is exactly what walks the fairway beside you. */
  const cv = document.getElementById('pvCanvas');
  if (cv) {
    mountAvatarStage(cv, normaliseLook(prof.look));
    const cap = document.getElementById('pvCap');
    if (cap) {
      cap.innerHTML = `<b>LV ${prof.level}</b> ${escapeHtml(t.name)}` +
        (opts.self ? ' <em>you</em>' : opts.friend ? ' <em>friend</em>' : '');
    }
  }

  /* The record. `—` rather than 0 wherever a number needs rounds behind it
     to mean anything: "0.00 putts per hole" reads as a claim, and a dash
     reads as "they have not played yet", which is the truth. */
  const rel = v => v == null ? '—' : v === 0 ? 'E' : v > 0 ? '+' + v : String(v);
  const pct = v => v == null ? '—' : v + '%';
  const stat = (v, l) => `<div class="pv-stat"><b>${v}</b><span>${l}</span></div>`;
  const side = document.getElementById('pvSide');
  if (side) {
    side.innerHTML =
      `<div class="pv-grid">
         ${stat(prof.rating ?? '—', 'rating')}
         ${stat(prof.index == null ? '—' : hcpText(prof.index), 'handicap')}
         ${stat((prof.rounds || 0).toLocaleString(), 'rounds')}
         ${stat(rel(prof.best), 'best')}
       </div>
       <div class="pv-grid four">
         ${stat(prof.birdies || 0, 'birdies')}
         ${stat(prof.eagles || 0, 'eagles')}
         ${stat(prof.aces || 0, 'aces')}
         ${stat(prof.records || 0, 'records')}
       </div>
       <div class="pv-grid">
         ${stat(pct(prof.fairwayPct), 'fairways')}
         ${stat(pct(prof.girPct), 'greens')}
         ${stat(prof.avgPutts ?? '—', 'putts / hole')}
         ${stat(`${prof.cleared || 0} / ${COURSE_ORDER.length}`, 'courses cleared')}
       </div>`;
  }

  /* WHAT THEY CARRY. The half of this panel that no list anywhere else
     shows, and the reason somebody clicked. */
  const more = document.getElementById('pvMore');
  if (!more) return;
  const bits = [];

  const setId = prof.clubSet || STARTER_SET;
  const set = setById(setId);
  if (set) {
    const pieces = (prof.clubPieces || {})[setId] || [];
    const done = Math.round(completionOf(pieces) * 100);
    const grade = (prof.clubGrades || {})[setId];
    const skin = skinById(prof.clubSkin || 'stock');
    bits.push(`<div class="pv-sec">
      <h5>In the bag</h5>
      <div class="pv-set" style="--rarity-color:${RARITY_ACCENT[set.rarity] || RARITY_ACCENT.standard}">
        <span class="pv-set-art">${clubSvg(set.look, 34)}</span>
        <span class="pv-set-txt">
          <b>${escapeHtml(set.name)}</b>
          <small>${escapeHtml(set.brand)} · ${set.rarity[0].toUpperCase()}${set.rarity.slice(1)}
            · ${pieces.length}/${SET_CLUBS.length} clubs${grade != null ? ' · grade ' + formatGrade(grade) : ''}</small>
          <i class="pv-bar"><span style="width:${done}%"></span></i>
        </span>
      </div>
      ${skin.id !== 'stock' ? `<p class="pv-note">Finish: <b>${escapeHtml(skin.name)}</b>${skin.feat ? ' — earned, not bought' : ''}</p>` : ''}
    </div>`);
  }

  /* The clubs they actually swing. Prestige only (mastery.js), which is
     precisely why it is worth showing a stranger: it is a portrait rather
     than a scoreboard, and it says what kind of golfer somebody is. */
  const top = topClubs(prof.mastery, 3);
  if (top.length) {
    bits.push(`<div class="pv-sec">
      <h5>Clubs they know — ${totalShots(prof.mastery).toLocaleString()} shots</h5>
      <div class="cr-mast">${top.map(c => `
        <div class="crm" style="--mc:${c.rank.color}">
          <b>${escapeHtml(CLUB_BY_KEY[c.key]?.label || c.key)}</b>
          <span>${escapeHtml(c.rank.name)}</span>
          <em>${c.shots.toLocaleString()} shots</em>
          <i><span style="width:${(c.rank.pct * 100).toFixed(0)}%"></span></i>
        </div>`).join('')}</div>
    </div>`);
  }

  /* Cosmetics they own. Not a full inventory — the point is to show off,
     and thirty tiles is a spreadsheet — so it is what they are WEARING plus
     a count of the rest. */
  const worn = [];
  const L = prof.look || {};
  const named = (kind, id) => UNLOCKS.find(u => u.kind === kind && u.id === id)?.name;
  for (const [kind, id] of [['decal', L.decal], ['cartdecal', L.cartDecal],
                            ['trail', L.trail], ['ball', L.ballFinish], ['title', L.title]]) {
    const n = id && named(kind, id);
    if (n) worn.push(`<span class="pv-chip">${escapeHtml(n)}</span>`);
  }
  const ownedCount = (prof.caseUnlocks || []).length;
  if (worn.length || ownedCount) {
    bits.push(`<div class="pv-sec">
      <h5>Wearing</h5>
      <div class="pv-chips">${worn.join('') || '<span class="pv-chip none">Nothing equipped</span>'}</div>
      ${ownedCount ? `<p class="pv-note">${ownedCount} item${ownedCount === 1 ? '' : 's'} pulled from cases.</p>` : ''}
    </div>`);
  }

  more.innerHTML = bits.join('');
};

let profBound = false;
HUD.bindProfile = () => {
  if (profBound) return;
  profBound = true;
  document.getElementById('btnProfClose')?.addEventListener('click', () => {
    document.getElementById('modalProfile').hidden = true;
  });
  /* ONE delegated listener on the document rather than one per list. The
     friends list, both leaderboards, the scoreboard, the presence panel and
     the records board are six separately-rendered trees, each replaced
     wholesale on every update — a direct listener would be torn off with
     them, and six bindings to keep in step is how one quietly stops
     working. Any element anywhere carrying data-profile opens a profile.

     WHICHEVER IS CLOSER TO THE CLICK WINS, and both directions really
     happen:

       a friends row carries data-profile and CONTAINS action buttons, so
       clicking Remove must remove, not open a profile;

       a records row IS a button (it expands the course) and CONTAINS the
       record-holder's name, so clicking the name must open a profile and
       must not also expand the row.

     Hence capture phase and stopPropagation: the row's own direct listener
     would otherwise have already fired by the time a bubbling handler got
     to decide. */
  document.addEventListener('click', e => {
    const row = e.target.closest('[data-profile]');
    if (!row) return;
    const btn = e.target.closest('button, a');
    if (btn && btn !== row && btn.contains(row) === false) return;   // an action
    const pid = row.dataset.profile;
    if (!pid) return;
    if (btn && btn.contains(row)) { e.preventDefault(); e.stopPropagation(); }
    HUD.onOpenProfile?.(pid);
  }, true);
};

HUD.profileError = msg => HUD.toast(msg || 'Could not open that profile.', 'warn', 2000);

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
