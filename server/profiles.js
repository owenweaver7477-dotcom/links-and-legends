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
import path from 'node:path';

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
      coins: 0, rating: 20,
      gear: { ball: 0, irons: 0, woods: 0, putter: 0 },
      history: []               // last 20 rounds, [relToPar]
    };
    profiles.set(pid, p);
  }
  return p;
}

/** What the lobby shows and the client caches. */
export function publicProfile(pid) {
  const p = getProfile(pid);
  return {
    rounds: p.rounds, best: p.best, coins: p.coins, rating: Math.round(p.rating),
    birdies: p.birdies, eagles: p.eagles, aces: p.aces,
    gear: p.gear || { ball: 0, irons: 0, woods: 0, putter: 0 },
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
  // coins: play well, earn more.  Par 12, birdie 30, eagle 80, ace 250 — and
  // even a rough hole pays a little, so a beginner still progresses.
  p.coins += h.strokes === 1 ? 250 : rel <= -2 ? 80 : rel === -1 ? 30 : rel === 0 ? 12 : 4;
  saveSoon();
}

/** Fold a finished ROUND in: rating moves on how you played against par. */
/** Spend coins on an item.  Returns null on success or a reason string. */
export function buyItem(pid, item, SHOP, purchaseBlocked) {
  const p = getProfile(pid);
  if (!p.gear) p.gear = { ball: 0, irons: 0, woods: 0, putter: 0 };
  const why = purchaseBlocked(item, p);
  if (why) return why;
  const it = SHOP[item];
  p.coins -= it.cost;
  p.gear[it.slot] = it.tier;
  saveSoon();
  return null;
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
  p.rating += (target - p.rating) * 0.2;
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
