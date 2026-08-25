/* =========================================================================
   marketplace.js — listings, not live trades
   -------------------------------------------------------------------------
   Two players don't have to be online at the same moment for this to
   work: a seller lists an item for gems, anyone browsing later buys it.
   Safer than a live trade handshake (no risk of a party disconnecting
   mid-exchange) and simpler to make atomic — a listing is just a row a
   single transaction either fully applies or fully refuses.

   Global, not per-profile — a listing has to be browsable by everyone,
   the same reasoning friends.js's own header gives for why a friends
   graph doesn't live inside profiles.js either. Same shape: an in-memory
   Map, loaded once at boot, persisted as one blob via store.js's
   loadBlob/saveBlob rather than the per-row profiles table.

   THE ONE NON-OBVIOUS RISK. profiles.js's own saveSoon() only marks a
   single "last touched" pid (see its own comment) — fine for every
   existing writer in that file, all of which mutate one profile at a
   time. buyListing() here mutates TWO (buyer and seller) in one
   transaction. Calling the plain saveSoon() would only ever persist
   whichever one getProfile() happened to be called with last; the other
   party's gems/items would sit correctly changed in memory and then
   silently never reach disk. profiles.js exports saveProfiles(...pids)
   specifically for this — every function below that touches more than
   one profile calls it with every pid involved, explicitly.
   ========================================================================= */
import { loadBlob, saveBlob } from './store.js';
import { getProfile, saveProfiles } from './profiles.js';
import { CASE_POOL, marketValue, priceBounds } from '../public/js/shared/cases.js';
import { unlocksAt } from '../public/js/shared/unlocks.js';
import { levelFromXp } from '../public/js/shared/economy.js';

export { marketValue, priceBounds };

const KEY = 'marketplace';
const MAX_LISTINGS = 500;   // a hard ceiling, not a page size — see allListings

/* id -> { id, sellerPid, sellerName, kind, itemId, price, purity, listedAt } */
let listings = new Map();
let nextId = 1;

export async function loadMarketplace() {
  const raw = await loadBlob(KEY, {}) || {};
  listings = new Map();
  let maxId = 0;
  for (const row of Object.values(raw.listings || {})) {
    if (!row || typeof row.id !== 'number') continue;
    listings.set(row.id, row);
    if (row.id > maxId) maxId = row.id;
  }
  nextId = maxId + 1;
  console.log(`  marketplace: ${listings.size} active listing${listings.size === 1 ? '' : 's'}`);
}

function persist() {
  saveBlob(KEY, { listings: Object.fromEntries(listings) });
}

/* --------------------------------------------------------------- rules */
// NOT cases.js's own caseItemKey — that one takes a single item OBJECT
// (`u => u.kind + ':' + u.id`), and every call site below has a bare
// kind/id pair instead (a listing only stores itemId, not the whole
// CASE_POOL entry). Aliasing straight to caseItemKey here silently built
// the string "undefined:undefined" for every call — same VALUE for a
// matching kind+id either way, just the wrong arity to get there.
const itemKey = (kind, id) => kind + ':' + id;

/** Owned purely through a case — not something the player's own level
 *  also grants. Same rule sellUnlock (profiles.js) already enforces, same
 *  reason: listing/selling something you'd keep for free anyway through
 *  levelling is a free-money exploit, not a trade. */
function ownedPurelyByCase(p, kind, id) {
  const key = itemKey(kind, id);
  if (!(p.caseUnlocks || []).includes(key)) return false;
  const level = levelFromXp(p.xp || 0).level;
  return !unlocksAt(level).some(u => u.kind === kind && u.id === id);
}

function alreadyOwned(p, kind, id) {
  const level = levelFromXp(p.xp || 0).level;
  return unlocksAt(level).some(u => u.kind === kind && u.id === id)
    || (p.caseUnlocks || []).includes(itemKey(kind, id));
}

/* ------------------------------------------------------------ mutators */
export function listItem(pid, kind, id, price, sellerName) {
  const item = CASE_POOL.find(it => it.kind === kind && it.id === id);
  if (!item) return { ok: false, error: 'No such item.' };
  if (listings.size >= MAX_LISTINGS) return { ok: false, error: 'The marketplace is full right now — try again shortly.' };

  const p = getProfile(pid);
  if (!ownedPurelyByCase(p, kind, id)) {
    return { ok: false, error: 'You don’t own that — or your own level already grants it, so there’s nothing to list.' };
  }
  const purity = kind === 'decal' ? (p.decalPurity?.[id] || 0) : 0;
  const bounds = priceBounds(kind, id, purity);
  const askPrice = Math.round(Number(price));
  if (!Number.isFinite(askPrice) || askPrice < bounds.min || askPrice > bounds.max) {
    return { ok: false, error: `Price must be between ${bounds.min} and ${bounds.max} gems.` };
  }

  // Escrow: gone from the seller's own inventory the instant it's listed,
  // so they can't also equip it, sell it, or list it a second time while
  // this listing is live.
  p.caseUnlocks = p.caseUnlocks.filter(k => k !== itemKey(kind, id));
  saveProfiles(pid);

  const listing = {
    id: nextId++, sellerPid: pid, sellerName: String(sellerName || 'Golfer').slice(0, 24),
    kind, itemId: id, price: askPrice, purity, listedAt: Date.now()
  };
  listings.set(listing.id, listing);
  persist();
  return { ok: true, listing };
}

export function cancelListing(pid, listingId) {
  const listing = listings.get(Number(listingId));
  if (!listing) return { ok: false, error: 'That listing is gone.' };
  if (listing.sellerPid !== pid) return { ok: false, error: 'That isn’t your listing.' };

  const p = getProfile(pid);
  p.caseUnlocks = [...(p.caseUnlocks || []), itemKey(listing.kind, listing.itemId)];
  if (listing.kind === 'decal' && listing.purity) {
    p.decalPurity = { ...(p.decalPurity || {}), [listing.itemId]: listing.purity };
  }
  saveProfiles(pid);

  listings.delete(listing.id);
  persist();
  return { ok: true };
}

export function buyListing(pid, listingId) {
  const listing = listings.get(Number(listingId));
  if (!listing) return { ok: false, error: 'That listing is gone — somebody else may have just bought it.' };
  if (listing.sellerPid === pid) return { ok: false, error: 'You can’t buy your own listing.' };

  const buyer = getProfile(pid);
  if (alreadyOwned(buyer, listing.kind, listing.itemId)) {
    return { ok: false, error: 'You already own that.' };
  }
  if ((buyer.gems || 0) < listing.price) {
    return { ok: false, error: `Not enough gems (need ${listing.price}).` };
  }

  // Everything from here to saveProfiles is synchronous — no `await`
  // anywhere in between — so Node's own single-threaded run-to-completion
  // guarantee is what makes this atomic: two buyers racing the same
  // listing both re-check `listings.get(listingId)` in their own call,
  // but only the first one to actually run this far still finds it,
  // because the delete below happens before either request's handler
  // can yield back to the event loop.
  listings.delete(listing.id);
  const seller = getProfile(listing.sellerPid);
  buyer.gems -= listing.price;
  seller.gems = (seller.gems || 0) + listing.price;
  buyer.caseUnlocks = [...(buyer.caseUnlocks || []), itemKey(listing.kind, listing.itemId)];
  if (listing.kind === 'decal' && listing.purity) {
    buyer.decalPurity = { ...(buyer.decalPurity || {}), [listing.itemId]: listing.purity };
  }
  saveProfiles(pid, listing.sellerPid);
  persist();
  return { ok: true, item: CASE_POOL.find(it => it.kind === listing.kind && it.id === listing.itemId), price: listing.price };
}

/* ------------------------------------------------------------- reading */
export function myListings(pid) {
  return [...listings.values()].filter(l => l.sellerPid === pid).sort((a, b) => b.listedAt - a.listedAt);
}

export function allListings() {
  return [...listings.values()].sort((a, b) => b.listedAt - a.listedAt).slice(0, 100);
}
