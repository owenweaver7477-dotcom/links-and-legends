/* =========================================================================
   profiles.js — who you are across rounds
   -------------------------------------------------------------------------
   A tiny JSON-file store: one profile per player id, loaded at boot, written
   back (debounced) whenever something changes.  No database to install, and
   the file survives server restarts.  On ephemeral hosts (free-tier PaaS)
   the file lives as long as the instance does — an honest limitation noted
   in the README rather than hidden.

   The SERVER computes every stat from shots it simulated itself, so a
   profile is a record of what actually happened, not what a client claimed.
   ========================================================================= */

import { holeCoins, roundCoins, holeXp, roundXp, levelFromXp } from '../public/js/shared/economy.js';
import { openStore, touch, saveSoon as storeSaveSoon } from './store.js';
import { handicapIndex, differential, ratingTier } from '../public/js/shared/handicap.js';
import { normaliseSkin } from '../public/js/shared/clubskins.js';
import { normaliseDifficulty, earnRate } from '../public/js/shared/difficulty.js';

/* Enough for the first Forged irons or a caddie, so the shop is usable the
   moment a player opens it rather than after several rounds. */
export const STARTING_COINS = 900;


const profiles = new Map();

/** Bring the store up. Async now — the database has to connect. */
export async function loadProfiles() {
  await openStore(profiles);
}

/* Every mutation funnels through here, which is what lets the store write
   only the profiles that actually changed instead of the whole world. The
   pid is worked out by identity: a profile object IS its row. */
let lastTouched = null;
function saveSoon() {
  if (lastTouched) touch(lastTouched);
  storeSaveSoon(profiles);
}
/** Called by getProfile so saveSoon knows whose row to mark. */
function marking(pid) { lastTouched = pid; }

export function getProfile(pid) {
  marking(pid);
  let p = profiles.get(pid);
  if (!p) {
    p = {
      rounds: 0, holes: 0, strokes: 0, putts: 0,
      fairways: 0, fairwayChances: 0, gir: 0,
      birdies: 0, eagles: 0, aces: 0,
      best: null,               // best round relative to par
      /* A welcome purse.  Starting at zero meant every button in the shop
         was disabled on a new player's first visit — nothing to click, no way
         to see that upgrades do anything, and no reason to believe the shop
         worked at all.  This buys the first real upgrade immediately, which
         is the moment the whole progression makes sense. */
      coins: STARTING_COINS, rating: 20, xp: 0,
      gear: { ball: 0, irons: 0, woods: 0, putter: 0, cart: 0 },
      crew: { ace: 0, bruiser: 0, steady: 0, roller: 0, pitstop: 0, lucky: 0, gale: 0, grit: 0 },
      clubTier: 0, refine: 0, cleared: [],
      clubSkin: 'stock',        // earned finish, never bought — see clubskins.js
      stars: {},                // courseId -> full rounds finished there

      history: []               // last 20 rounds, [relToPar]
    };
    profiles.set(pid, p);
  }
  /* Pay the welcome purse ONCE, to existing players as well as new ones.
     Seeding it only in the default above would have missed everybody who
     already had a profile — including every player stuck at zero coins with a
     shop full of dead buttons, which is the exact complaint. The flag, not
     the balance, is what makes it one-time: a player who has legitimately
     spent down to nothing is not topped up again. */
  if (!p.welcomed) {
    p.welcomed = true;
    if ((p.coins || 0) < STARTING_COINS) p.coins = STARTING_COINS;
    saveSoon();
  }
  return p;
}

/**
 * Seed a profile the server has never seen from the player's own backup.
 *
 * The server is authoritative while it is running, but its file sits on an
 * ephemeral disk: a free-tier deploy wipes it, and without this every player
 * would silently lose their career.  The client keeps a snapshot in the
 * platform's save store, and this restores it — but ONLY for a pid with no
 * record here, and only through a clamp.  An existing career can never be
 * raised by a client, so this cannot become a way to mint coins: the worst a
 * forged snapshot achieves is starting a NEW player part-way up, which costs
 * nothing real and is bounded well below what a real player accumulates.
 *
 * Returns true if it actually seeded.
 */
const CLAMP = {
  coins: 400000, rating: 98, clubTier: 6, refine: 3, rounds: 2000, crewLevel: 10,
  xp: 4000000
};
const num = (v, max, dflt = 0) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : dflt;
};

/**
 * Has this profile got anything worth protecting?  A profile that exists but
 * has never played and never bought anything is indistinguishable from a
 * blank one, so restoring over it loses nothing.
 */
function untouched(p) {
  if (!p) return true;
  if ((p.rounds || 0) > 0 || (p.holes || 0) > 0 || (p.xp || 0) > 0) return false;
  if ((p.clubTier || 0) > 0 || (p.refine || 0) > 0) return false;
  if (p.gear && Object.values(p.gear).some(v => (v || 0) > 0)) return false;
  if (p.crew && Object.values(p.crew).some(v => (v || 0) > 0)) return false;
  return (p.coins || 0) <= STARTING_COINS;      // the welcome purse only
}

export function seedProfile(pid, snap) {
  if (!pid || !snap) return false;
  /* This used to refuse whenever a profile already EXISTED, which sounds
     safe and was the whole reset bug: the profile gets created the moment
     anything asks for it — joining a room, the welcome purse, a stats read —
     and on a host that has just wiped its disk that happens before the
     client's restore snapshot arrives. Restore was then blocked forever and
     the player's coins, clubs and crew were gone for good.

     What actually matters is whether there is progress to protect, not
     whether a record exists.  A blank profile is safe to restore over; one
     with a single round played is not, and still wins. */
  if (profiles.has(pid) && !untouched(profiles.get(pid))) return false;
  let d = snap;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return false; } }
  if (!d || typeof d !== 'object' || d.v !== 1) return false;

  const p = getProfile(pid);                 // creates the blank profile
  p.coins = num(d.coins, CLAMP.coins);
  /* XP too, or a wiped host takes every emote a player has unlocked with it —
     the same failure coins already had, and the reason this list is checked. */
  p.xp = num(d.xp, CLAMP.xp);
  p.rating = Math.max(2, num(d.rating, CLAMP.rating, 20));
  p.clubTier = num(d.clubTier, CLAMP.clubTier);
  p.refine = num(d.refine, CLAMP.refine);
  p.rounds = num(d.rounds, CLAMP.rounds);
  if (Number.isFinite(Number(d.best))) p.best = Number(d.best);
  if (d.crew && typeof d.crew === 'object') {
    for (const k of Object.keys(p.crew)) p.crew[k] = num(d.crew[k], CLAMP.crewLevel);
  }
  if (d.gear && typeof d.gear === 'object') {
    for (const k of Object.keys(p.gear)) p.gear[k] = num(d.gear[k], 3);
  }
  if (d.stars && typeof d.stars === 'object') {
    p.stars = {};
    for (const [c, n] of Object.entries(d.stars)) {
      if (typeof c === 'string' && c.length <= 24) p.stars[c] = num(n, 500);
    }
  }
  saveSoon();
  return true;
}

/**
 * Remember what this player calls themselves.
 *
 * The name lives on the ROOM player until a round ends, which is fine right
 * up until a friends list has to show somebody who is offline — at which
 * point the only copy of their name has gone with the room and every friend
 * in the list reads "Golfer". Stored on the profile, alongside everything
 * else that has to outlive a session.
 */
export function rememberName(pid, name) {
  const n = String(name || '').trim().slice(0, 14);
  if (!pid || !n) return;
  const p = getProfile(pid);
  if (p.name === n) return;                   // no write, no save, no churn
  p.name = n;
  saveSoon();
}

/** Every differential we can compute from a history, oldest first. */
export function differentialsOf(p) {
  return (p.history || [])
    .filter(h => h && typeof h === 'object' && Number.isFinite(h.g) && Number.isFinite(h.r))
    .map(h => differential(h.g, h.r, h.s));
}

/** The handicap index, or null while the sample is too thin to mean one. */
export const indexOf = p => handicapIndex(differentialsOf(p));

/** Per-course form with its tier, for the board and the profile panel. */
function courseForm(p) {
  const out = {};
  for (const [id, e] of Object.entries(p.byCourse || {})) {
    if (!e || !e.n) continue;
    const vs = Math.round(e.vs * 10) / 10;
    out[id] = { n: e.n, vs, best: e.best, tier: ratingTier(vs)?.id || null };
  }
  return out;
}

/** What the lobby shows and the client caches. */
export function publicProfile(pid) {
  const p = getProfile(pid);
  return {
    rounds: p.rounds, best: p.best, coins: p.coins, rating: Math.round(p.rating),
    xp: p.xp || 0, ...levelFromXp(p.xp || 0),
    birdies: p.birdies, eagles: p.eagles, aces: p.aces,
    gear: p.gear || { ball: 0, irons: 0, woods: 0, putter: 0 },
    crew: p.crew || { ace: 0, bruiser: 0, steady: 0, roller: 0, pitstop: 0, lucky: 0, gale: 0, grit: 0 },
    clubTier: p.clubTier ?? 0, refine: p.refine ?? 0, cleared: (p.cleared || []).length,
    clubSkin: p.clubSkin || 'stock',
    /* What they look like, so a browser with an empty localStorage — a new
       device, a cleared store, a private window — gets the golfer back
       rather than the default one. */
    look: p.look || null,
    ballColor: p.ballColor || null,
    bag: p.bag || null,
    difficulty: normaliseDifficulty(p.difficulty),
    earnRate: earnRate(p.difficulty),
    /* Records held, because a club finish is gated on it and the client
       cannot count them — the board lives on the server. */
    records: p.recordsHeld || 0,
    stars: p.stars || {},
    pro: Object.entries(p.stars || {}).filter(([, n]) => n >= STARS_FOR_PRO).map(([c]) => c),
    /* Both numbers, because they answer different questions. `rating` is
       ours and moves every round; `index` is the handicap a golfer would
       recognise, and is null until three rounds have a course on them. */
    handicap: handicapFor(p.rating),
    index: indexOf(p),
    byCourse: courseForm(p),
    avgPutts: p.holes ? +(p.putts / p.holes).toFixed(2) : null,
    fairwayPct: p.fairwayChances ? Math.round(p.fairways / p.fairwayChances * 100) : null,
    girPct: p.holes ? Math.round(p.gir / p.holes * 100) : null,
    history: p.history.slice(-20)
  };
}

/**
 * Fold one finished hole into a player's profile.
 * @param holeStats { strokes, par, putts, fairwayHit (bool|null), gir (bool) }
 */
export function recordHole(pid, h) {
  const p = getProfile(pid);
  p.holes++;
  p.strokes += h.strokes;
  p.putts += h.putts;
  if (h.fairwayHit !== null) { p.fairwayChances++; if (h.fairwayHit) p.fairways++; }
  if (h.gir) p.gir++;
  const rel = h.strokes - h.par;
  if (h.strokes === 1) p.aces++;
  else if (rel === -2) p.eagles++;
  else if (rel === -1) p.birdies++;
  // the economy document's per-hole payout, shared with the test suite
  p.coins += holeCoins(h.strokes, h.par);
  p.xp = (p.xp || 0) + holeXp(h.strokes, h.par);
  saveSoon();
}

/** Fold a finished ROUND in: rating moves on how you played against par. */
/** Spend coins on an item.  Returns null on success or a reason string. */
export function buyItem(pid, item, SHOP, purchaseBlocked, crewPurchase) {
  const p = getProfile(pid);
  if (!p.gear) p.gear = { ball: 0, irons: 0, woods: 0, putter: 0 };
  if (!p.crew) p.crew = { ace: 0, bruiser: 0, steady: 0, roller: 0, pitstop: 0, lucky: 0, gale: 0, grit: 0 };
  if (p.clubTier == null) { p.clubTier = 0; p.refine = 0; }

  // the Caddie Crew and the club ladder go through the shared till
  if (String(item).includes(':')) {
    const res = crewPurchase(item, p);
    if (res.blocked) return res.blocked;
    p.coins -= res.cost;
    if (!Number.isFinite(p.coins)) { p.coins = 0; return 'No such item.'; }
    res.apply(p);
    saveSoon();
    return null;
  }

  const why = purchaseBlocked(item, p);
  if (why) return why;
  // own-property only — a prototype-chain key would charge undefined coins
  const it = Object.hasOwn(SHOP, item) ? SHOP[item] : null;
  if (!it) return 'No such item.';
  p.coins -= it.cost;
  if (!Number.isFinite(p.coins)) { p.coins = 0; return 'No such item.'; }
  p.gear[it.slot] = it.tier;
  saveSoon();
  return null;
}

/**
 * The end-of-round settlement: the flat round bonus, the streak bonus and
 * the one-time first-clear reward.  Per-hole coins were paid as they
 * happened, so only the EXTRAS are added here.
 * @param holeScores [{strokes, par}]
 */
/**
 * A star per completed course, and Pro status at five.
 *
 * Coins are already banked hole by hole (see recordHole), so this is only the
 * end-of-round settlement: the extras, the star, and the standing that comes
 * with playing the same course until you know it.
 */
export const STARS_FOR_PRO = 5;

/** Your handicap on a course, from your rating: scratch at 90, 28 at the bottom. */
export function handicapFor(rating) {
  const r = Math.max(2, Math.min(98, rating || 20));
  return Math.max(0, Math.round((90 - r) * 0.38));
}

/**
 * @param earn  the difficulty multiplier. Playing without the aim line and
 *   the putt read is harder, so it pays more; playing on Casual pays less.
 *   Applied to the round BONUS only — the per-hole coins were already banked
 *   as they were played, and clawing those back at the end would mean the
 *   counter went down when you finished a round.
 */
export function settleRound(pid, courseId, holeScores, earn = 1) {
  const p = getProfile(pid);
  const full = holeScores.length >= 9;
  const firstClear = courseId && !(p.cleared || []).includes(courseId) && full;
  const rc = roundCoins(holeScores, firstClear);
  const rate = Number.isFinite(earn) && earn > 0 ? earn : 1;
  if (rate !== 1) {
    rc.total = Math.round(rc.total * rate);
    rc.earnRate = rate;
  }
  p.coins += rc.total - rc.holes;                  // holes already paid live

  /* XP: the holes already paid as they were played (recordHole), so this is
     the completion bonus only — same split as the coins.  The level BEFORE
     and AFTER go back with the settlement so the results screen can make a
     moment of it rather than a number quietly changing. */
  const before = levelFromXp(p.xp || 0).level;
  const holeXpPaid = holeScores.reduce((a, h) => a + holeXp(h.strokes, h.par), 0);
  rc.xp = Math.round((roundXp(holeScores) - holeXpPaid) * rate);
  p.xp = (p.xp || 0) + rc.xp;
  const after = levelFromXp(p.xp).level;
  rc.level = after;
  rc.leveledUp = after > before ? { from: before, to: after } : null;
  if (firstClear) { p.cleared = p.cleared || []; p.cleared.push(courseId); }

  // one star for going round the whole thing, however you scored
  if (full && courseId) {
    p.stars = p.stars || {};
    p.stars[courseId] = (p.stars[courseId] || 0) + 1;
    rc.stars = p.stars[courseId];
    rc.becamePro = rc.stars === STARS_FOR_PRO;
  }
  saveSoon();
  return rc;
}

export function recordRound(pid, relToPar, holesPlayed, card = null) {
  if (!holesPlayed) return;
  const p = getProfile(pid);
  p.rounds++;
  if (p.best === null || relToPar < p.best) p.best = relToPar;
  /* History used to be a bare number per round, which is all the rating
     needed. A handicap needs more: the differential is (score − rating) ×
     113 ÷ slope, so the entry has to remember WHICH course and what it was
     rated when you played it. Old numeric entries are left alone and read
     back as `{rel}` with no course — they still feed the rating, they just
     cannot produce a differential, which is the honest outcome for a round
     nobody recorded the venue of. */
  p.history.push(card
    ? { rel: relToPar, c: card.courseId, r: card.rating, s: card.slope,
        g: card.gross, h: holesPlayed }
    : relToPar);
  if (p.history.length > 20) p.history.shift();

  /* Per-course form, for the tier boards. Kept as a running mean rather
     than a list because it is only ever read as an average, and eight
     courses times twenty rounds of stored cards is a profile that grows
     without bound for a number that does not need them. */
  if (card?.courseId && Number.isFinite(card.gross) && Number.isFinite(card.rating)) {
    p.byCourse = p.byCourse || {};
    const e = p.byCourse[card.courseId] || { n: 0, vs: 0, best: null };
    const vs = card.gross - card.rating;
    e.vs = (e.vs * e.n + vs) / (e.n + 1);
    e.n++;
    if (e.best === null || relToPar < e.best) e.best = relToPar;
    p.byCourse[card.courseId] = e;
  }
  // Rating: exponential pull toward a scratch-anchored target.  Level par
  // for nine holes reads as ~70; +9 as ~35; -5 as ~90.  Moves a fifth of the
  // way each round, so one great day is progress and one bad day is not ruin.
  const perHole = relToPar / holesPlayed;
  const target = Math.max(2, Math.min(98, 70 - perHole * 63));

  /* Asymmetric, so a rating is harder to HOLD than to reach.
     A single pull rate meant a high rating cost nothing to keep: play badly
     once and you drift down a quarter of the way, play well once and you are
     straight back. Now a bad round pulls you down faster than a good one
     lifts you, which makes a high number a claim about consistency rather
     than about your best day. Gaining is slower the higher you already are —
     at 90 you are moving a tenth of the way per round. */
  const up = target > p.rating;
  const stretch = Math.max(0, (p.rating - 55) / 45);          // 0 at 55, 1 at 100
  const rate = up ? 0.22 * (1 - stretch * 0.55) : 0.30;
  p.rating += (target - p.rating) * rate;
  saveSoon();
  return publicProfile(pid);
}

/** Ball colours that have to be earned.  Checked server-side on pick. */
export const LOCKED_COLORS = {
  '#ffd94a': { rating: 45, name: 'Tour Gold' },
  '#e8f4ff': { rating: 70, name: 'Pearl' }
};
export function colorAllowed(pid, hex) {
  const lock = LOCKED_COLORS[hex?.toLowerCase?.()];
  if (!lock) return true;
  return getProfile(pid).rating >= lock.rating;
}

/* =========================================================================
   THE WORLD RANKING
   -------------------------------------------------------------------------
   Every career in the store, ordered by rating. The board only means
   anything if the number on it is hard to hold, and it is — a bad round
   pulls you down faster than a good one lifts you, and gaining slows the
   higher you already are.

   Two guards, both about honesty rather than performance:

     A MINIMUM NUMBER OF ROUNDS. A player who shoots one lucky 32 and stops
     would otherwise sit above people who have played four hundred. A rating
     is a claim about consistency, so it has to have been tested.

     NO BOTS. The soak tests and the demo golfers live in the same store as
     real players, and a leaderboard full of them is worse than no
     leaderboard.
   ========================================================================= */
const RANKED_MIN_ROUNDS = 5;
/* Ids the test suite invents. It has its own server and its own data
   directory now, so nothing new arrives here — but three years of runs went
   into the live store before that, and a board is not the place to discover
   one was missed. Cheap, and it can only ever exclude. */
const TEST_PID = /^(bot\d|scr\d|demo|shop[-_]|host[-_]|rec-|leave_|persist|atk\d|test[A-Z]|P[AB]$|softlock|xp[-_]|res[-_]|restore-|seed[-_]|Rec-)/;
const isBot = pid => TEST_PID.test(String(pid));

/**
 * Is this profile a person we can name on a board?
 *
 * "Golfer" sitting at number one in the world was the visible half of a
 * bigger problem: the socket tests connected to whatever was on port 3000,
 * which in development is the live server, so every fake player they
 * invented became a real profile. Those are gone now and the tests have
 * their own server — but the rule stays, because a row nobody can identify
 * is not a ranking, it is a gap with a number next to it.
 *
 * A name is the bar. Anybody who has played five rounds has been asked for
 * one; anybody who never gave one is not who the board is for.
 */
const rankable = (pid, p) => !isBot(pid) && !!(p.name && p.name.trim());

/* ═══════════════════════════════════════════════ THE RANKING BOARDS ═══
   Four ladders, and they exist because one ladder answers one question. A
   rating board rewards the player who has been here longest; a handicap
   board rewards the best golfer; a weekly board gives somebody who started
   on Monday something they can win. A game with a single leaderboard has a
   top ten that never changes, which is a top ten nobody looks at twice.

   Every board here shares two rules. Bots never appear on one — a ladder
   with a bot in the top five is a ladder that is telling you it is empty.
   And nothing is ranked before it means something: five rounds for the
   rating boards, three carded rounds for the handicap. */

/** Best golfers, by handicap index. Lower is better, so this sorts up. */
export function handicapRanking(limit = 100) {
  const rows = [];
  for (const [pid, p] of profiles) {
    if (!rankable(pid, p)) continue;
    const idx = indexOf(p);
    if (idx === null) continue;                 // fewer than three carded rounds
    rows.push({
      pid, name: p.name,
      index: idx,
      level: levelFromXp(p.xp || 0).level,
      rounds: p.rounds || 0,
      best: p.best ?? null
    });
  }
  rows.sort((a, b) => a.index - b.index || b.rounds - a.rounds);
  return rows.slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }));
}

/** Where one player sits on the handicap board, and how big the field is. */
export function handicapPlace(pid) {
  const me = profiles.get(pid);
  const mine = me ? indexOf(me) : null;
  if (mine === null) return { place: null, of: 0, index: null };
  let place = 1, of = 0;
  for (const [id, p] of profiles) {
    if (!rankable(id, p)) continue;
    const idx = indexOf(p);
    if (idx === null) continue;
    of++;
    if (idx < mine || (idx === mine && (p.rounds || 0) > (me.rounds || 0))) place++;
  }
  return { place, of, index: mine };
}

/** The level ladder. Separate from rating: time played, not skill. */
export function levelRanking(limit = 100) {
  const rows = [];
  for (const [pid, p] of profiles) {
    if (!rankable(pid, p)) continue;
    const lv = levelFromXp(p.xp || 0);
    if (lv.level < 2) continue;                 // level 1 is everybody
    rows.push({ pid, name: p.name, level: lv.level, xp: p.xp || 0,
                rounds: p.rounds || 0 });
  }
  rows.sort((a, b) => b.xp - a.xp);
  return rows.slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }));
}

/* ---- the two boards that reset -----------------------------------------
   A weekly and a seasonal ladder need a baseline: how much XP you had when
   the period started. Stored on the profile rather than computed from a log
   because there is no log — the game keeps totals, not events.

   `stampPeriods` is called on every profile read, so a player who has not
   been seen since last season gets rolled over the moment they come back
   rather than appearing at the top of a board with a whole season of XP
   counted as this week's. */
const WEEK_MS = 7 * 24 * 3600 * 1000;
/** Which week we are in, counted from a fixed Monday so every server agrees. */
const EPOCH_MON = Date.UTC(2024, 0, 1);         // a Monday
export const weekIndex = (t = Date.now()) => Math.floor((t - EPOCH_MON) / WEEK_MS);
export const seasonIndex = (t = Date.now()) => {
  const d = new Date(t);
  return d.getUTCFullYear() * 4 + Math.floor(d.getUTCMonth() / 3);
};

export function stampPeriods(p) {
  const w = weekIndex(), s = seasonIndex();
  if (p.wkIdx !== w) { p.wkIdx = w; p.wkBase = p.xp || 0; }
  if (p.snIdx !== s) { p.snIdx = s; p.snBase = p.xp || 0; }
  return p;
}

function periodBoard(baseKey, limit) {
  const rows = [];
  for (const [pid, p] of profiles) {
    if (!rankable(pid, p)) continue;
    stampPeriods(p);
    const gained = (p.xp || 0) - (p[baseKey] || 0);
    if (gained <= 0) continue;
    rows.push({ pid, name: p.name, gained,
                level: levelFromXp(p.xp || 0).level });
  }
  rows.sort((a, b) => b.gained - a.gained);
  return rows.slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }));
}

/** Fastest XP this week. Resets Monday. */
export const weeklyGainers = (limit = 50) => periodBoard('wkBase', limit);
/** Fastest XP this quarter. */
export const seasonBoard = (limit = 100) => periodBoard('snBase', limit);

/**
 * Best average-versus-rating on one course. The tier board.
 *
 * Ranked on FORM rather than on a single round, which is the difference
 * between this and the course records: the record board is who once went
 * lowest, this is who plays the place well.
 */
export function courseBoard(courseId, limit = 50) {
  const rows = [];
  for (const [pid, p] of profiles) {
    if (!rankable(pid, p)) continue;
    const e = p.byCourse?.[courseId];
    if (!e || e.n < 2) continue;                // one round is not form
    const vs = Math.round(e.vs * 10) / 10;
    rows.push({ pid, name: p.name, vs, rounds: e.n,
                best: e.best ?? null, tier: ratingTier(vs)?.id || null });
  }
  rows.sort((a, b) => a.vs - b.vs || b.rounds - a.rounds);
  return rows.slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }));
}

export function worldRanking(limit = 50) {
  const rows = [];
  for (const [pid, p] of profiles) {
    if (!rankable(pid, p) || (p.rounds || 0) < RANKED_MIN_ROUNDS) continue;
    rows.push({
      pid, name: p.name,
      rating: Math.round(p.rating || 0),
      level: levelFromXp(p.xp || 0).level,
      rounds: p.rounds || 0,
      best: p.best ?? null
    });
  }
  rows.sort((a, b) => b.rating - a.rating || b.rounds - a.rounds);
  return rows.slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }));
}

/** Where one player sits in that list, even when they are not in the top N. */
export function worldPlace(pid) {
  const me = profiles.get(pid);
  if (!me) return null;
  if ((me.rounds || 0) < RANKED_MIN_ROUNDS) {
    return { ranked: false, need: RANKED_MIN_ROUNDS - (me.rounds || 0) };
  }
  /* THE SAME FILTER THE LIST USES. This counted with `isBot` alone while
     worldRanking counted with `rankable`, which also requires a name — so
     the field size included players who can never appear in the list below
     it, and `ahead` counted them too. That is how you end up ranked 14th of
     60 on a board showing nine people: both numbers were real, they were
     just answering a different question from the one the list answers. */
  let ahead = 0, total = 0;
  for (const [id, p] of profiles) {
    if (!rankable(id, p) || (p.rounds || 0) < RANKED_MIN_ROUNDS) continue;
    total++;
    if ((p.rating || 0) > (me.rating || 0)) ahead++;
  }
  return { ranked: true, rank: ahead + 1, of: total, rating: Math.round(me.rating || 0) };
}

/**
 * Choose a club finish. Validated against what this profile has actually
 * done — the client picks, the server decides, the same way every other
 * earned cosmetic works.
 */
/* ═══════════════════════════════════════════ WHAT YOU LOOK LIKE ═══════
   Appearance, ball colour and bag used to live ONLY on the room player.
   That object is created when you join a room and thrown away when the room
   dies, so every one of them reset to a default the next time you played —
   which is exactly "the appearance goes back to default". The wardrobe
   saved nothing because there was nowhere for it to save to.

   They belong on the profile with everything else that survives a round.
   The room player is now a COPY made at join time, and the copy is what
   gets broadcast and clamped; this is the original. */

export function setLook(pid, look) {
  const p = getProfile(pid);
  p.look = look || null;
  saveSoon();
  return p.look;
}

export function setBallColor(pid, hex, name) {
  const p = getProfile(pid);
  p.ballColor = hex || null;
  p.ballColorName = name || null;
  saveSoon();
}

export function setBag(pid, bag) {
  const p = getProfile(pid);
  p.bag = Array.isArray(bag) ? bag : null;
  saveSoon();
}

/** Everything a room player should start life wearing. Null means "default". */
export const kitOf = pid => {
  const p = profiles.get(pid);
  return p ? { look: p.look || null, bag: p.bag || null,
               color: p.ballColor || null, colorName: p.ballColorName || null } : null;
};

/**
 * The difficulty a player has chosen. Lives on the profile rather than in
 * the room, because it is a setting about how somebody likes to play and
 * not a property of one game — and because it has to survive the round it
 * was chosen in, or the coin multiplier would reset every time.
 */
export function setDifficulty(pid, id) {
  const p = getProfile(pid);
  p.difficulty = normaliseDifficulty(id);
  saveSoon();
  return p.difficulty;
}

export const difficultyOf = pid =>
  normaliseDifficulty(profiles.get(pid)?.difficulty);

export function setClubSkin(pid, id) {
  const p = getProfile(pid);
  const pub = publicProfile(pid);
  const ok = normaliseSkin(id, pub);
  p.clubSkin = ok;
  saveSoon();
  return ok;
}
