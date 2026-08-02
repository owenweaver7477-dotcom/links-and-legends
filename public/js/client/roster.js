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
      r.dot.style.background = p.color;
      r.name.textContent = p.name + (p.pid === myPid ? '' : '');
      r.row.classList.toggle('me', p.pid === myPid);
      r.row.classList.toggle('gone', !p.connected);

      const lbl = this.labels.get(p.pid);
      lbl.textContent = p.name;
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
}
