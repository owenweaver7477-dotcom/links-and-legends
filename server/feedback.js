/* =========================================================================
   feedback.js — the board that tells you what to fix next
   -------------------------------------------------------------------------
   No sign-up means no support ticket system and no way to email a player
   back — the only channel a problem can travel from a player's screen to
   the person who can fix it is one built into the game itself. This is
   that channel: anonymous, rate-limited, and carrying enough technical
   context that "the game is laggy" arrives as something you can actually
   act on rather than something you have to go ask about.

   ANONYMITY, PROPERLY. No name, no pid, no account link is ever stored or
   shown — only a SALTED HASH of the session id, kept for exactly two
   things: rate limiting (so one player cannot flood the board) and dedupe.
   The salt is a random value picked once at boot and never persisted, so
   the hash cannot be reversed even by someone with full access to the
   store — it exists to compare two submissions, never to identify one.

   REPORTS SHARE THIS BACKEND, NEVER THE PUBLIC BOARD. A report names
   another player, which the public feedback board must never do — so a
   report is stored the identical way (rate-limited, hashed, technical
   context attached) but is filtered out of listFeedback() by category,
   not by status, so there is no status a report could accidentally be
   given that would let it leak onto the public board.

   NO WORD-LIST PROFANITY FILTER. chat.js already explains why this
   project does not ship one — removed deliberately after the moderation
   risk it creates was raised, kept out on purpose rather than missing by
   accident. What runs here instead is the same thing that protects chat:
   clean() strips control characters and anything URL-shaped, so this
   cannot become a phishing channel or a way to break the board's layout,
   and every submission keeps a `status` an owner can act on after the
   fact. There is no authenticated moderator role in this game yet, so
   nothing here can currently SET status to anything but "new" — that is
   a real gap, not a hidden feature, and it is written down as one.
   ========================================================================= */
import crypto from 'node:crypto';
import { loadBlob, saveBlob } from './store.js';
import { clean } from './chat.js';

const KEY = 'feedback';
const MAX_BODY = 500;
const MIN_BODY = 10;
const MAX_PER_HOUR = 3;
const HOUR_MS = 60 * 60 * 1000;

const CATEGORIES = new Set(['bug', 'performance', 'course', 'suggestion', 'other']);
// Status values a human could eventually move a submission through: new,
// triaged, planned, done, hidden. Nothing in this file can currently set
// anything but 'new' — see the header.

/* One salt, picked at boot, never written to disk. A hash made with it
   cannot be un-hashed back to a pid even by someone holding the whole
   store, which is the actual point — this is not encryption standing in
   for a secret, it is a one-way comparison the salt makes irreversible. */
const SALT = crypto.randomBytes(16).toString('hex');
const hashOf = pid => crypto.createHash('sha256').update(SALT + '|' + String(pid || '')).digest('hex').slice(0, 24);

/* { items: [ { id, at, category, body, courseId, hole, votes, voters,
                status, sessionHash, report: {targetPid,targetName} | null,
                context } ] } */
let board = { items: [] };

/** Called once at boot, same as loadRecords — everything after this is sync. */
export async function loadFeedback() {
  board = await loadBlob(KEY, { items: [] }) || { items: [] };
  if (!Array.isArray(board.items)) board.items = [];
}
const saveSoon = () => saveBlob(KEY, board);

/** Has this session already used up its hourly allowance? */
function rateLimited(hash, now) {
  const recent = board.items.filter(it => it.sessionHash === hash && now - it.at < HOUR_MS);
  return recent.length >= MAX_PER_HOUR;
}

/**
 * A minimal, honest slice of what a bug report actually needs — device and
 * build context the player would otherwise have to describe by hand, and
 * usually can't. Anything the client did not send is simply absent rather
 * than guessed at.
 */
function sanitiseContext(ctx) {
  if (!ctx || typeof ctx !== 'object') return {};
  const s = (v, max) => typeof v === 'string' ? v.slice(0, max) : undefined;
  const n = v => Number.isFinite(v) ? v : undefined;
  return {
    build: s(ctx.build, 40),
    gpu: s(ctx.gpu, 120),
    resolution: s(ctx.resolution, 20),
    orientation: s(ctx.orientation, 12),
    ua: s(ctx.ua, 200),
    preset: s(ctx.preset, 12),
    sessionLen: n(ctx.sessionLen),
    // §0.5 — the netgraph read at the moment of the report: what transport
    // was in use, the last measured RTT, and how many times this session's
    // socket has dropped and come back. Turns "the game is laggy" into
    // something with a shape.
    transport: s(ctx.transport, 12),
    rtt: n(ctx.rtt),
    disconnects: n(ctx.disconnects),
    reconnects: n(ctx.reconnects),
    lastDisconnectReason: s(ctx.lastDisconnectReason, 40)
  };
}

/**
 * Submit a piece of public feedback.
 * @returns { ok, error? }
 */
export function submitFeedback(pid, category, body, courseId, hole, context) {
  if (!CATEGORIES.has(category)) return { ok: false, error: 'Pick a category.' };
  const text = clean(body).slice(0, MAX_BODY);
  if (text.length < MIN_BODY) return { ok: false, error: 'A little more detail helps — a sentence or two.' };

  const hash = hashOf(pid);
  const now = Date.now();
  if (rateLimited(hash, now)) return { ok: false, error: 'A few of these already went in this hour — thank you, and try again later.' };

  board.items.push({
    id: crypto.randomUUID(), at: now, category, body: text,
    courseId: typeof courseId === 'string' ? courseId.slice(0, 24) : null,
    hole: Number.isInteger(hole) ? hole : null,
    votes: 0, voters: [hash], status: 'new', sessionHash: hash,
    report: null, context: sanitiseContext(context)
  });
  saveSoon();
  return { ok: true };
}

/**
 * Report a player. Same rate limit and the same backend as feedback, but
 * the category ('report') is what keeps it off the public board — see
 * listFeedback().
 */
export function submitReport(pid, targetPid, targetName, reason, roomCode, context) {
  const text = clean(reason).slice(0, MAX_BODY);
  if (text.length < MIN_BODY) return { ok: false, error: 'Say a bit more about what happened.' };
  if (!targetPid) return { ok: false, error: 'Nothing to report.' };

  const hash = hashOf(pid);
  const now = Date.now();
  if (rateLimited(hash, now)) return { ok: false, error: 'Slow down a moment.' };

  board.items.push({
    id: crypto.randomUUID(), at: now, category: 'report', body: text,
    courseId: typeof roomCode === 'string' ? roomCode.slice(0, 12) : null, hole: null,
    votes: 0, voters: [], status: 'new', sessionHash: hash,
    report: { targetPid: String(targetPid).slice(0, 40), targetName: String(targetName || '?').slice(0, 14) },
    context: sanitiseContext(context)
  });
  saveSoon();
  return { ok: true };
}

/**
 * The public board. Reports never appear here regardless of status —
 * filtered by CATEGORY, not by a flag that a future change to `status`
 * could accidentally clear.
 */
export function listFeedback({ sort = 'new' } = {}) {
  const visible = board.items.filter(it => it.category !== 'report' && it.status !== 'hidden');
  const rows = visible.map(it => ({
    id: it.id, at: it.at, category: it.category, body: it.body,
    courseId: it.courseId, hole: it.hole, votes: it.votes, status: it.status
  }));
  rows.sort(sort === 'votes' ? (a, b) => b.votes - a.votes || b.at - a.at : (a, b) => b.at - a.at);
  return rows;
}

/** One vote per session per item — enforced with the same hash everything else here uses. */
export function voteFeedback(pid, id) {
  const it = board.items.find(x => x.id === id && x.category !== 'report');
  if (!it) return { ok: false };
  const hash = hashOf(pid);
  if (it.voters.includes(hash)) return { ok: false, error: 'Already voted on this one.' };
  it.voters.push(hash);
  it.votes++;
  saveSoon();
  return { ok: true, votes: it.votes };
}

/** For tests: wipe the board without touching disk. */
export function _reset() { board = { items: [] }; }
