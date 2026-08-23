/* =========================================================================
   roster.js — who is where
   -------------------------------------------------------------------------
   Two things: the compact list in the top-right (name, distance to the hole,
   a bearing needle pointing at each player relative to where you are facing),
   and the floating name labels above each avatar's head.

   Labels are plain DOM positioned from projected world coordinates, which is
   far cheaper than sprites and stays crisp at any resolution.
   ========================================================================= */

import * as THREE from '../../vendor/three.module.js';
import { HUD } from './hud.js';
import { UNLOCKS } from '../shared/unlocks.js';
import { icon } from './icons.js';

/* A level title, if they have one equipped. Shown as its own small tag
   rather than glued to the name, so a title can never be mistaken for part
   of what somebody called themselves. */
const titleOf = look => (look?.title
  ? UNLOCKS.find(u => u.kind === 'title' && u.id === look.title)?.name || ''
  : '');

/* A course-record badge. Holding one is the hardest thing in the game to do
   and it was invisible to everybody you played with — which is most of the
   point of holding it. A trophy and a count, beside the name, everywhere the
   name appears. */
const badgeText = b => !b ? ''
  : (b.courses ? icon('trophy', { size: 12 }) + (b.courses > 1 ? b.courses : '') : '') +
    (b.holes ? icon('flag', { size: 12 }) + (b.holes > 1 ? b.holes : '') : '');

const _v = new THREE.Vector3();

export class Roster {
  constructor(listEl, labelLayerEl) {
    this.listEl = listEl;
    this.layer = labelLayerEl;
    this.rows = new Map();        // pid -> {row, name, dist, needle}
    this.labels = new Map();      // pid -> div
  }

  /** Rebuild rows when the player list itself changes. */
  sync(players, myPid) {
    const seen = new Set();
    for (const p of players) {
      if (p.spectator) continue;
      seen.add(p.pid);
      if (!this.rows.has(p.pid)) {
        const row = document.createElement('div');
        row.className = 'rrow-live';
        row.innerHTML =
          '<span class="rdot"></span>' +
          '<span class="rname"></span>' +
          '<span class="rdist"></span>' +
          '<svg class="rneedle" viewBox="0 0 20 20"><path d="M10 3 L14 15 L10 12.6 L6 15 Z"/></svg>';
        this.listEl.appendChild(row);
        this.rows.set(p.pid, {
          row,
          dot: row.querySelector('.rdot'),
          name: row.querySelector('.rname'),
          dist: row.querySelector('.rdist'),
          needle: row.querySelector('.rneedle')
        });
      }
      if (!this.labels.has(p.pid)) {
        const el = document.createElement('div');
        el.className = 'namelabel';
        this.layer.appendChild(el);
        this.labels.set(p.pid, el);
      }
      const r = this.rows.get(p.pid);
      const title = titleOf(p.look);
      r.dot.style.background = p.color;
      const bt2 = badgeText(p.badge);
      // the badge is trusted markup (our own SVG + a count); the name is
      // not, so this is innerHTML with the name run through escapeHtml
      // rather than one blind textContent assignment
      r.name.innerHTML = (bt2 ? bt2 + ' ' : '') + HUD.escapeHtml(p.name);
      r.name.title = title ? p.name + ' — ' + title : p.name;
      r.row.classList.toggle('me', p.pid === myPid);
      r.row.classList.toggle('gone', !p.connected);

      const lbl = this.labels.get(p.pid);
      lbl.textContent = '';
      const bt = badgeText(p.badge);
      if (bt) {
        const bd = document.createElement('span');
        bd.className = 'nl-badge'; bd.innerHTML = bt;   // trusted: our own icon markup + a count, never player text
        bd.title = (p.badge.courses ? p.badge.courses + ' course record' +
          (p.badge.courses > 1 ? 's' : '') : '') +
          (p.badge.courses && p.badge.holes ? ', ' : '') +
          (p.badge.holes ? p.badge.holes + ' hole record' +
            (p.badge.holes > 1 ? 's' : '') : '');
        lbl.appendChild(bd);
      }
      const nm = document.createElement('span');
      nm.className = 'nl-name'; nm.textContent = p.name;
      lbl.appendChild(nm);
      if (title) {
        const tg = document.createElement('span');
        tg.className = 'nl-title'; tg.textContent = title;
        lbl.appendChild(tg);
      }
      lbl.style.setProperty('--c', p.color);
      lbl.classList.toggle('self', p.pid === myPid);
    }
    for (const [pid, r] of this.rows) {
      if (seen.has(pid)) continue;
      r.row.remove(); this.rows.delete(pid);
      this.labels.get(pid)?.remove(); this.labels.delete(pid);
    }
  }

  /**
   * Per-frame update.
   * @param players   room player list
   * @param avatars   Map pid -> Avatar (for head position)
   * @param pin       {x,z} of the flag
   * @param camera    THREE camera
   * @param camYaw    which way the camera is facing, so bearings are relative
   * @param myPid
   * @param turnPid
   */
  update(players, avatars, pin, camera, camYaw, myPid, turnPid) {
    const w = window.innerWidth, h = window.innerHeight;
    // Writing text into the DOM can force a layout, and with eight players
    // this ran forty style and text writes EVERY frame.  The yardages and the
    // turn highlight are read, not watched, so they update several times a
    // second; only the things that track the camera — the compass needles and
    // the floating labels — have to move every frame.
    const now = performance.now();
    const slow = now - (this._slowAt || 0) > 180;
    if (slow) this._slowAt = now;

    for (const p of players) {
      if (p.spectator) continue;
      const r = this.rows.get(p.pid);
      const av = avatars.get(p.pid);
      if (!r) continue;

      if (slow) {
        // distance from the PLAYER'S BALL to the hole — that is the number
        // that actually matters on a scorecard
        const d = Math.hypot(p.x - pin.x, p.z - pin.z);
        const txt = p.finished ? 'holed' : Math.round(HUD.dist(d)) + ' ' + HUD.unit();
        if (r.dist.textContent !== txt) r.dist.textContent = txt;
        r.row.classList.toggle('turn', p.pid === turnPid);
        r.row.classList.toggle('done', !!p.finished);
      }

      // bearing to that player's AVATAR, relative to where I am looking
      if (av) {
        const bearing = Math.atan2(av.root.position.x - camera.position.x,
                                   av.root.position.z - camera.position.z) - camYaw;
        const deg = (bearing * 180 / Math.PI).toFixed(0);
        if (r._deg !== deg) { r._deg = deg; r.needle.style.transform = `rotate(${deg}deg)`; }
        const op = p.pid === myPid ? '0.25' : '0.9';
        if (r._op !== op) { r._op = op; r.needle.style.opacity = op; }
      }

      /* --- floating name label ---------------------------------------- */
      const lbl = this.labels.get(p.pid);
      if (!lbl) continue;
      if (!av || !av.root.visible) { lbl.style.display = 'none'; continue; }

      _v.copy(av.root.position);
      _v.y += 2.05;                                  // just above the cap
      _v.project(camera);
      const behind = _v.z > 1;
      const onScreen = !behind && _v.x > -1.05 && _v.x < 1.05 && _v.y > -1.05 && _v.y < 1.05;
      const dist = camera.position.distanceTo(av.root.position);

      if (!onScreen || dist > 220 || (p.pid === myPid && dist < 3)) {
        lbl.style.display = 'none';
        continue;
      }
      lbl.style.display = '';
      lbl.style.left = ((_v.x * 0.5 + 0.5) * w).toFixed(1) + 'px';
      lbl.style.top = ((-_v.y * 0.5 + 0.5) * h).toFixed(1) + 'px';
      // fade with distance so a crowd on the green does not turn into soup
      lbl.style.opacity = String(Math.max(0.25, 1 - dist / 260));
      lbl.style.transform = `translate(-50%,-100%) scale(${(1 - Math.min(0.45, dist / 500)).toFixed(2)})`;
    }
  }

  /** A short particle burst above one avatar's head — the "reads as
   *  special" flair for a Legend/Mythic emote (see main.js's
   *  Net.on('emote', ...)). Spawned as a child of the SAME label div
   *  update() already tracks every frame, so it rides the avatar's correct
   *  screen position for free instead of needing its own projection math,
   *  and disappears with it if the label does. */
  burst(pid, color = '#ffd94a') {
    const lbl = this.labels.get(pid);
    if (!lbl) return;
    const b = document.createElement('span');
    b.className = 'emote-burst';
    b.style.setProperty('--burst-color', color);
    for (let i = 0; i < 8; i++) {
      const s = document.createElement('i');
      const a = (Math.PI * 2 * i) / 8;
      s.style.setProperty('--dx', (Math.cos(a) * 34).toFixed(1) + 'px');
      s.style.setProperty('--dy', (Math.sin(a) * 34).toFixed(1) + 'px');
      s.style.animationDelay = (i % 2 ? 0.04 : 0) + 's';
      b.appendChild(s);
    }
    lbl.appendChild(b);
    setTimeout(() => b.remove(), 900);
  }
}
