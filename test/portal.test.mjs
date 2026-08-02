/* =========================================================================
   portal.test.mjs — the CrazyGames contract
   -------------------------------------------------------------------------
   These are the things their QA actually checks, and every one of them was
   broken at some point:

     - init() is called, and it is called BEFORE anything else.  The SDK
       silently drops calls made before init resolves, which is how a build
       that "integrates the SDK" still reports SDK not detected.
     - loadingStart/Stop bracket the boot.
     - gameplayStart/Stop bracket real play only, and do not double-fire.
     - platform mute overrides the game's own setting.
     - the Data module is used for saves, with a localStorage mirror.
     - none of it is load-bearing: with no SDK at all, everything still works.
   ========================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const calls = [];

/* A stand-in for the portal.  game is a STABLE object — an earlier version of
   this mock returned a fresh one per access, exactly as the real SDK does,
   and the spies were invisible because of it. */
function mockSDK({ muteAudio = false } = {}) {
  let listener = null;
  const game = {
    settings: { muteAudio },
    loadingStart: () => calls.push('loadingStart'),
    loadingStop: () => calls.push('loadingStop'),
    gameplayStart: () => calls.push('gameplayStart'),
    gameplayStop: () => calls.push('gameplayStop'),
    happytime: () => calls.push('happytime'),
    addSettingsChangeListener: fn => { listener = fn; },
    inviteLink: p => 'https://crazygames.com/g/x?room=' + p.room,
    getInviteParam: k => (k === 'room' ? 'ab3d9' : null)
  };
  const store = new Map();
  return {
    sdk: {
      init: async () => { calls.push('init'); },
      game,
      data: {
        getItem: k => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { calls.push('data.set'); store.set(k, v); }
      }
    },
    fireMute: v => { game.settings.muteAudio = v; listener?.({ muteAudio: v }); }
  };
}

/* The module caches its boot promise at import, so each scenario needs a
   fresh copy — hence the cache-busting query. */
let n = 0;
const freshImport = () => import(`../public/js/client/crazygames.js?t=${++n}`);

const memoryLocalStorage = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

test('init runs before any other SDK call, even one made at import time', async () => {
  calls.length = 0;
  const { sdk } = mockSDK();
  globalThis.window = { CrazyGames: { SDK: sdk } };
  globalThis.localStorage = memoryLocalStorage();

  const CGmod = await freshImport();
  CGmod.loadingStart();            // fired immediately, as main.js does
  await CGmod.initCG({});
  CGmod.loadingStop();
  await new Promise(r => setTimeout(r, 0));

  assert.equal(calls[0], 'init', `init must come first, got: ${calls.join(' > ')}`);
  assert.deepEqual(calls, ['init', 'loadingStart', 'loadingStop']);
  assert.equal(CGmod.CG.present, true, 'a real SDK answered, so present must be true');
});

test('gameplayStart/Stop bracket play and never double-fire', async () => {
  calls.length = 0;
  const { sdk } = mockSDK();
  globalThis.window = { CrazyGames: { SDK: sdk } };
  globalThis.localStorage = memoryLocalStorage();

  const CGmod = await freshImport();
  await CGmod.initCG({});

  CGmod.gameplayStart();
  CGmod.gameplayStart();           // a second round-start must be ignored
  CGmod.happytime();
  CGmod.gameplayStop();
  CGmod.gameplayStop();            // leaving twice must be ignored
  await new Promise(r => setTimeout(r, 0));

  assert.deepEqual(calls.filter(c => c !== 'init'),
    ['gameplayStart', 'happytime', 'gameplayStop']);
});

test('platform mute is read at init and tracked on change', async () => {
  calls.length = 0;
  const m = mockSDK({ muteAudio: true });
  globalThis.window = { CrazyGames: { SDK: m.sdk } };
  globalThis.localStorage = memoryLocalStorage();

  const CGmod = await freshImport();
  const seen = [];
  await CGmod.initCG({ onMute: v => seen.push(v) });

  assert.equal(CGmod.CG.muted, true, 'muted at start must be picked up at init');
  m.fireMute(false);
  assert.deepEqual(seen, [false]);
  assert.equal(CGmod.CG.muted, false);
});

test('saves go through the Data module and are mirrored to localStorage', async () => {
  calls.length = 0;
  const { sdk } = mockSDK();
  globalThis.window = { CrazyGames: { SDK: sdk } };
  const ls = memoryLocalStorage();
  globalThis.localStorage = ls;

  const CGmod = await freshImport();
  await CGmod.initCG({});

  CGmod.storeSet('lg_pid', 'p-123');
  assert.ok(calls.includes('data.set'), 'must write through the Data module');
  assert.equal(CGmod.storeGet('lg_pid'), 'p-123');
  assert.equal(ls.getItem('lg_pid'), 'p-123', 'and mirror it locally');

  // The Data module wins when the two disagree: it is the cross-device copy.
  ls.setItem('lg_pid', 'stale');
  assert.equal(CGmod.storeGet('lg_pid'), 'p-123');
});

test('an invited room code is read back from the portal', async () => {
  const { sdk } = mockSDK();
  globalThis.window = { CrazyGames: { SDK: sdk } };
  globalThis.localStorage = memoryLocalStorage();

  const CGmod = await freshImport();
  await CGmod.initCG({});

  assert.equal(CGmod.inviteLink('QZ7K1'), 'https://crazygames.com/g/x?room=QZ7K1');
  assert.equal(CGmod.invitedRoom(), 'AB3D9', 'normalised to our 5-char upper form');
});

test('with no SDK at all, nothing throws and saves still persist', async () => {
  globalThis.window = {};                  // off-portal: no CrazyGames object
  const ls = memoryLocalStorage();
  globalThis.localStorage = ls;

  const CGmod = await freshImport();
  CGmod.loadingStart();
  await CGmod.initCG({ onMute: () => { throw new Error('must not fire'); } });
  CGmod.loadingStop();
  CGmod.gameplayStart();
  CGmod.happytime();
  CGmod.gameplayStop();
  CGmod.storeSet('lg_save', '{"coins":40}');
  await new Promise(r => setTimeout(r, 0));

  assert.equal(CGmod.CG.present, false);
  assert.equal(CGmod.CG.ready, true, 'must still resolve, or boot would hang');
  assert.equal(CGmod.CG.muted, false);
  assert.equal(CGmod.storeGet('lg_save'), '{"coins":40}', 'localStorage carries it');
  assert.equal(CGmod.invitedRoom(), null);
  assert.ok(CGmod.inviteLink('QZ7K1').includes('room=QZ7K1'));
});

test('a portal that never resolves init does not hang the game', async () => {
  globalThis.window = { CrazyGames: { SDK: { init: () => new Promise(() => {}) } } };
  globalThis.localStorage = memoryLocalStorage();

  const CGmod = await freshImport();
  const t0 = Date.now();
  await CGmod.initCG({});
  const waited = Date.now() - t0;

  assert.equal(CGmod.CG.ready, true);
  assert.ok(waited < 6000, `gave up after ${waited}ms; must not wait forever`);
});
