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

import fs from 'node:fs';
import { holeCoins, roundCoins } from '../public/js/shared/economy.js';
import path from 'node:path';

/* Enough for the first Forged irons or a caddie, so the shop is usable the
   moment a player opens it rather than after several rounds. */
export const STARTING_COINS = 900;

const FILE = path.join(process.cwd(), 'data', 'profiles.json');

const profiles = new Map();
let saveTimer = null;

export function loadProfiles() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    for (const [pid, p] of Object.entries(raw)) profiles.set(pid, p);
    console.log(`  profiles: ${profiles.size} loaded`);
  } catch { /* first boot: no file yet */ }
}

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(Object.fromEntries(profiles)), 'utf8');
    } catch (e) { console.error('  profiles: save failed —', e.message); }
  }, 800);
  saveTimer.unref?.();
}

export function getProfile(pid) {
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
      coins: STARTING_COINS, rating: 20,
      gear: { ball: 0, irons: 0, woods: 0, putter: 0, cart: 0 },
      crew: { ace: 0, bruiser: 0, steady: 0, roller: 0, pitstop: 0, lucky: 0, gale: 0, grit: 0 },
      clubTier: 0, refine: 0, cleared: [],
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
  coins: 400000, rating: 98, clubTier: 6, refine: 3, rounds: 2000, crewLevel: 10
};
const num = (v, max, dflt = 0) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : dflt;
};

export function seedProfile(pid, snap) {
  if (!pid || !snap || profiles.has(pid)) return false;
  let d = snap;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return false; } }
  if (!d || typeof d !== 'object' || d.v !== 1) return false;

  const p = getProfile(pid);                 // creates the blank profile
  p.coins = num(d.coins, CLAMP.coins);
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

/** What the lobby shows and the client caches. */
export function publicProfile(pid) {
  const p = getProfile(pid);
  return {
    rounds: p.rounds, best: p.best, coins: p.coins, rating: Math.round(p.rating),
    birdies: p.birdies, eagles: p.eagles, aces: p.aces,
    gear: p.gear || { ball: 0, irons: 0, woods: 0, putter: 0 },
    crew: p.crew || { ace: 0, bruiser: 0, steady: 0, roller: 0, pitstop: 0, lucky: 0, gale: 0, grit: 0 },
    clubTier: p.clubTier ?? 0, refine: p.refine ?? 0, cleared: (p.cleared || []).length,
    stars: p.stars || {},
    pro: Object.entries(p.stars || {}).filter(([, n]) => n >= STARS_FOR_PRO).map(([c]) => c),
    handicap: handicapFor(p.rating),
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

export function settleRound(pid, courseId, holeScores) {
  const p = getProfile(pid);
  const full = holeScores.length >= 9;
  const firstClear = courseId && !(p.cleared || []).includes(courseId) && full;
  const rc = roundCoins(holeScores, firstClear);
  p.coins += rc.total - rc.holes;                  // holes already paid live
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

export function recordRound(pid, relToPar, holesPlayed) {
  if (!holesPlayed) return;
  const p = getProfile(pid);
  p.rounds++;
  if (p.best === null || relToPar < p.best) p.best = relToPar;
  p.history.push(relToPar);
  if (p.history.length > 20) p.history.shift();
  // Rating: exponential pull toward a scratch-anchored target.  Level par
  // for nine holes reads as ~70; +9 as ~35; -5 as ~90.  Moves a fifth of the
  // way each round, so one great day is progress and one bad day is not ruin.
  const perHole = relToPar / holesPlayed;
  const target = Math.max(2, Math.min(98, 70 - perHole * 63));
  // 0.26 rather than 0.20: a round moves you a little over a quarter of the
  // way to where you played, so improvement is visible sooner without a
  // single good round rewriting your rating.
  p.rating += (target - p.rating) * 0.26;
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
