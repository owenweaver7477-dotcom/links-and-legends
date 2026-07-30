/* =========================================================================
   carts.js — owning the carts on this client
   -------------------------------------------------------------------------
   One local cart you actually drive, plus a mesh for every cart somebody else
   is driving.  Remote carts are eased toward their last reported pose exactly
   the way remote golfers are, so a 10 Hz feed still reads as smooth driving.

   The one rule worth stating: BOTH occupants of a cart are placed from the
   DRIVER'S cart transform.  A passenger never reports their own position, and
   is never run through the per-player ease, because two independent smoothers
   on one rigid body make the rider visibly slide out of the seat on every
   corner.  One transform, one source of truth.
   ========================================================================= */

import { CartBody, nearestDrivable, BOARD_RADIUS, CART_TTL_MS, SEATS }
  from '../shared/cart.js';
import { Cart3D } from './cart3d.js';

const EASE_POS = 14;      // 1/s — tighter than a walker: a cart covers ground
const EASE_TILT = 8;

const shortestArc = (from, to) => {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

export class CartManager {
  /**
   * @param group  the persistent actor group — NOT the per-hole group, or
   *               every cart is orphaned the moment the hole turns over
   */
  constructor(group) {
    this.group = group;
    this.body = null;          // CartBody while we are driving
    this.seat = null;          // 'driver' | 'passenger' | null
    this.rider = null;         // pid riding with us, if we are driving
    this.driver = null;        // pid whose cart we are riding in
    this.meshes = new Map();   // pid -> Cart3D  (keyed on the DRIVER's pid)
    this.remote = new Map();   // pid -> eased pose from the network
    this.riders = new Map();   // passenger pid -> { driver, seenAt }
    this.myPid = null;
    this.input = { throttle: 0, steer: 0, handbrake: false };
    this.sinking = null;       // seconds under water, once you have driven in
    this._lastDry = null;
    this.hitFlash = 0;
  }

  get driving() { return this.seat === 'driver'; }
  get riding() { return this.seat === 'passenger'; }
  get inCart() { return this.seat !== null; }

  /* --------------------------------------------------------------- local */

  /**
   * Board a cart, or spawn one.  Returns a short reason string on failure so
   * the caller can toast it.
   */
  board(terrain, hole, x, z, heading, players) {
    if (this.inCart) return 'already';

    // somebody else's cart within reach, with a free passenger seat?
    for (const [pid, r] of this.remote) {
      if (r.rider) continue;
      const seat = this._seatPos(r, 'passenger');
      if (Math.hypot(seat.x - x, seat.z - z) <= BOARD_RADIUS + 1.4) {
        this.seat = 'passenger';
        this.driver = pid;
        return null;
      }
    }

    const spot = nearestDrivable(terrain, x, z);
    if (!spot) return 'nowhere';
    this.body = new CartBody(spot.x, spot.z, heading);
    this.seat = 'driver';
    this.rider = null;
    this.driver = null;
    return null;
  }

  /** Get out.  Returns where the golfer should be standing afterwards. */
  eject(terrain) {
    if (!this.inCart) return null;
    let at = null;
    if (this.driving && this.body) {
      const s = this.body.seat('driver');
      // step out to the driver's side, not into the cart
      const sinH = Math.sin(this.body.heading), cosH = Math.cos(this.body.heading);
      at = { x: s.x - cosH * 1.15, z: s.z + sinH * 1.15, heading: this.body.heading };
      this.body = null;
    } else if (this.riding) {
      const r = this.remote.get(this.driver);
      const s = r ? this._seatPos(r, 'passenger') : null;
      if (s) at = { x: s.x + 1.15, z: s.z, heading: r.heading };
    }
    this.seat = null; this.rider = null; this.driver = null;
    this.input.throttle = 0; this.input.steer = 0; this.input.handbrake = false;
    return at;
  }

  clearInput() {
    this.input.throttle = 0; this.input.steer = 0; this.input.handbrake = false;
  }

  /** Read the walker's key set, so blur-clearing is shared and free. */
  readKeys(keys) {
    let thr = 0, str = 0;
    if (keys.has('w') || keys.has('arrowup')) thr += 1;
    if (keys.has('s') || keys.has('arrowdown')) thr -= 1;
    if (keys.has('a') || keys.has('arrowleft')) str -= 1;
    if (keys.has('d') || keys.has('arrowright')) str += 1;
    this.input.throttle = thr;
    this.input.steer = str;
    this.input.handbrake = keys.has(' ');
  }

  /** Drive the local cart.  Returns true if we moved something. */
  step(dt, terrain, hole) {
    if (!this.driving || !this.body) return false;

    // Already going down: the only thing driving does now is nothing.
    if (this.sinking != null) {
      this.sinking += dt;
      return true;
    }

    this.body.step(dt, this.input, terrain, hole);

    // You drove it into the lake.  The cart settles, you swim for the bank,
    // and the cart is gone — C at the shore buys a fresh one for free.
    if (terrain.waterAt(this.body.x, this.body.z) !== null && Math.hypot(
      this.body.x - (this._lastDry?.x ?? this.body.x),
      this.body.z - (this._lastDry?.z ?? this.body.z)) > 1.2) {
      this.sinking = 0;
      this.clearInput();
      return true;
    }
    if (terrain.waterAt(this.body.x, this.body.z) === null) {
      this._lastDry = { x: this.body.x, z: this.body.z };
    }

    // Cart-to-cart, with momentum meaning something.  Each client owns only
    // its OWN cart, so the collision is resolved one-sidedly against the
    // other cart's reported pose — but WEIGHTED by who was moving: get
    // T-boned while parked and you are shunted hard along their travel;
    // ram a parked cart and you barely notice it, they do.  Both clients
    // run this rule, so the pair converges on a believable exchange.
    const b = this.body;
    for (const [, r] of this.remote) {
      const dx = b.x - r.x, dz = b.z - r.z;
      const d2 = dx * dx + dz * dz;
      const R = 2.4;                              // generous: a hit should FEEL like one
      if (d2 < R * R && d2 > 1e-9) {
        const d = Math.sqrt(d2);
        const nx = dx / d, nz = dz / d;           // away from them, toward me
        const mine = Math.abs(b.speed);
        const theirs = Math.abs(r.speed || 0);
        // KINETIC weighting — momentum squared — so whoever brings the speed
        // utterly dominates the exchange: a 20 m/s cart against a 5 m/s cart
        // holds 94% of the collision, not 80%.  The fast cart ploughs
        // through; the slow one is launched.
        const w = (theirs * theirs) / (mine * mine + theirs * theirs + 0.001);

        // The DOMINANT cart barely yields position; the light one is fully
        // expelled from the overlap.  Each client only ever moves its own
        // cart, and both apply this same rule, so on both screens it is the
        // lighter cart that gives way.
        const yieldFrac = 0.2 + 0.8 * w;
        const gap = R - d;
        b.x += nx * gap * yieldFrac;
        b.z += nz * gap * yieldFrac;

        // their velocity along the collision line becomes a shove on me,
        // scaled by their share of the momentum
        const rvx = Math.sin(r.heading) * (r.speed || 0);
        const rvz = Math.cos(r.heading) * (r.speed || 0);
        const shove = (rvx * nx + rvz * nz);      // + = they are driving into me
        const bvx = Math.sin(b.heading) * b.speed + Math.max(0.8, shove) * nx * w * 1.8;
        const bvz = Math.cos(b.heading) * b.speed + Math.max(0.8, shove) * nz * w * 1.8;
        const newSpeed = Math.hypot(bvx, bvz);
        if (newSpeed > 0.3) {
          b.heading = Math.atan2(bvx, bvz);
          b.speed = Math.min(newSpeed, 24) * (1 - 0.3 * (1 - w));    // rammer bleeds a little
        } else {
          b.speed *= -0.2;
        }
        const impact = Math.max(mine, theirs);
        if (impact > 1.5) this.hitFlash = Math.max(this.hitFlash, Math.min(1, impact / 9));
      }
    }

    if (this.body.hit > this.hitFlash) this.hitFlash = this.body.hit;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 2.2);
    return true;
  }

  /* -------------------------------------------------------------- remote */

  /** A cart pose arrived from the network. */
  feed(pid, cart, now) {
    // A passenger reports only who they are riding with — never a pose, which
    // is the whole point.  Record the pairing so this client can seat them
    // from the driver's transform, including when the driver is us.
    if (cart && cart.s === 'p' && cart.o) {
      this.riders.set(pid, { driver: cart.o, seenAt: now });
      this.remote.delete(pid);
      if (cart.o === this.myPid) this.rider = pid;
      return;
    }
    this.riders.delete(pid);
    if (this.rider === pid) this.rider = null;

    if (!cart || cart.s !== 'd') {
      // If that vanished cart is the one WE are riding, get out with it —
      // otherwise the passenger sits frozen in a ghost seat forever (the TTL
      // sweep in reap() can never fire: the entry is already gone).
      if (this.driver === pid) { this.seat = null; this.driver = null; }
      const m = this.meshes.get(pid);
      if (m) { this.group.remove(m.root); m.dispose(); this.meshes.delete(pid); }
      this.remote.delete(pid);
      return;
    }
    let r = this.remote.get(pid);
    if (!r) {
      r = {
        x: cart.x, z: cart.z, heading: cart.h, speed: cart.v || 0, steer: 0,
        tx: cart.x, tz: cart.z, theading: cart.h, rider: cart.r || null, seenAt: now
      };
      this.remote.set(pid, r);
    }
    r.tx = cart.x; r.tz = cart.z; r.theading = cart.h;
    r.speed = cart.v || 0;
    r.rider = cart.r || null;
    r.seenAt = now;
  }

  /** Forget carts nobody has reported for a while — the same TTL the server uses. */
  reap(now) {
    for (const [pid, r] of this.riders) {
      if (now - r.seenAt > CART_TTL_MS) {
        this.riders.delete(pid);
        if (this.rider === pid) this.rider = null;
      }
    }
    for (const [pid, r] of this.remote) {
      if (now - r.seenAt > CART_TTL_MS) {
        this.remote.delete(pid);
        const m = this.meshes.get(pid);
        if (m) { this.group.remove(m.root); m.dispose(); this.meshes.delete(pid); }
        if (this.driver === pid) { this.seat = null; this.driver = null; }
      }
    }
  }

  /**
   * The sink, resolved: after a beat underwater the driver is put back on
   * the last dry ground and the cart is destroyed.  Returns the spot to
   * stand on (or null while still afloat / not sinking).
   */
  resolveSink(dt) {
    if (this.sinking == null) return null;
    if (this.sinking < 1.1) return null;          // still going under
    const at = this._lastDry || { x: this.body?.x || 0, z: this.body?.z || 0 };
    this.sinking = null;
    this.body = null;
    this.seat = null; this.rider = null; this.driver = null;
    const mine = this.meshes.get(this.myPid);
    if (mine) { this.group.remove(mine.root); mine.dispose(); this.meshes.delete(this.myPid); }
    return { x: at.x, z: at.z };
  }

  /** Where a seat is on a remote cart. */
  _seatPos(r, which) {
    const s = SEATS[which] || SEATS.driver;
    const sinH = Math.sin(r.heading), cosH = Math.cos(r.heading);
    return {
      x: r.x + sinH * s.z + cosH * s.x,
      z: r.z + cosH * s.z - sinH * s.x,
      y: s.y
    };
  }

  /**
   * Seat position for any player, or null if they are on foot.
   * `myPid` is placed from our own body; everyone else from the driver's.
   */
  seatFor(pid, myPid) {
    if (pid === myPid) {
      if (this.driving && this.body) return { ...this.body.seat('driver'), heading: this.body.heading };
      if (this.riding) {
        const r = this.remote.get(this.driver);
        return r ? { ...this._seatPos(r, 'passenger'), heading: r.heading } : null;
      }
      return null;
    }
    // are they driving a cart we know about?
    const own = this.remote.get(pid);
    if (own) return { ...this._seatPos(own, 'driver'), heading: own.heading };
    // are they riding?  in our cart, or in somebody else's
    const ride = this.riders.get(pid);
    if (ride) {
      if (ride.driver === myPid && this.driving && this.body) {
        return { ...this.body.seat('passenger'), heading: this.body.heading };
      }
      const host = this.remote.get(ride.driver);
      if (host) return { ...this._seatPos(host, 'passenger'), heading: host.heading };
    }
    return null;
  }

  /* ------------------------------------------------------------ rendering */

  /**
   * Ease every remote cart toward its target and refresh the meshes.
   * `tintOf(pid)` supplies the player's colour.
   */
  render(dt, terrain, myPid, tintOf, now) {
    this.myPid = myPid;
    this.reap(now);

    const kp = 1 - Math.exp(-EASE_POS * dt);
    for (const [pid, r] of this.remote) {
      r.x += (r.tx - r.x) * kp;
      r.z += (r.tz - r.z) * kp;
      r.heading += shortestArc(r.heading, r.theading) * kp;
      this._mesh(pid, tintOf(pid)).update(dt, r, terrain.heightAt(r.x, r.z),
        terrain.normalAt(r.x, r.z, 1.15));
    }

    if (this.driving && this.body) {
      const b = this.body;
      const m = this._mesh(myPid, tintOf(myPid));
      const sinkDepth = this.sinking != null ? Math.min(1.6, this.sinking * 1.5) : 0;
      m.update(dt, b, terrain.heightAt(b.x, b.z) - sinkDepth, terrain.normalAt(b.x, b.z, 1.15));
      if (this.sinking != null) m.tilt.rotation.x = Math.min(0.5, this.sinking * 0.6);
    } else {
      const mine = this.meshes.get(myPid);
      if (mine && !this.remote.has(myPid)) {
        this.group.remove(mine.root); mine.dispose(); this.meshes.delete(myPid);
      }
    }
  }

  _mesh(pid, tint) {
    let m = this.meshes.get(pid);
    if (!m) {
      m = new Cart3D(tint);
      this.group.add(m.root);
      this.meshes.set(pid, m);
    } else if (tint) m.setTint(tint);
    return m;
  }

  /** What to put on the wire this tick, or null when we are on foot. */
  wire() {
    if (this.driving && this.body) {
      const b = this.body;
      const r2 = v => Math.round(v * 100) / 100;
      return { s: 'd', x: r2(b.x), z: r2(b.z), h: r2(b.heading), v: r2(b.speed), r: this.rider || null };
    }
    if (this.riding) return { s: 'p', o: this.driver };
    return null;
  }

  /** Drop everything — used when the hole changes or the round restarts. */
  clear() {
    for (const [, m] of this.meshes) { this.group.remove(m.root); m.dispose(); }
    this.meshes.clear();
    this.remote.clear();
    this.riders.clear();
    this.body = null; this.seat = null; this.rider = null; this.driver = null;
    this.sinking = null;
    this.clearInput();
  }
}
