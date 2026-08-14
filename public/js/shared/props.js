/* =========================================================================
   props.js — the things a golf course has that are not golf
   -------------------------------------------------------------------------
   Eight courses of grass, sand, water and trees, and not one object that a
   person put there. A real course is covered in small human furniture — a
   halfway hut, a rain shelter, a ball washer by the tee, a bench where the
   walk is long, a marker post at the corner of a dogleg, a toilet block
   nobody photographs and everybody notices when it is missing. They are what
   make a course read as a PLACE rather than as terrain.

   Placed here rather than in the renderer for the reason everything else is:
   they are deterministic hole data, built from the seed, so the server and
   every client agree about where the hut is — and the physics can make them
   solid without a second table to keep in step.

   THE RULE THAT MATTERS: nothing here may ever be in play. Every prop sits
   outside the fairway corridor, clear of the tee, clear of the green. A
   bench you can carom off is a hazard nobody designed, and a shelter between
   you and the flag is a hole with a building in it. They dress the walk, not
   the shot.
   ========================================================================= */

import { routeAt, routeTangent } from './coursegen.js';

/* Each kind: how wide it is (for the solid test and for keeping them apart),
   and how tall, so the renderer does not need a second table. */
export const PROP_KINDS = {
  hut:     { r: 2.6, h: 3.1, solid: true,  name: 'Halfway hut' },
  shelter: { r: 2.1, h: 2.7, solid: true,  name: 'Rain shelter' },
  toilet:  { r: 1.0, h: 2.4, solid: true,  name: 'Toilet block' },
  bench:   { r: 0.9, h: 0.9, solid: false, name: 'Bench' },
  washer:  { r: 0.4, h: 1.0, solid: false, name: 'Ball washer' },
  sign:    { r: 0.3, h: 1.6, solid: false, name: 'Marker post' },
  bin:     { r: 0.4, h: 0.9, solid: false, name: 'Bin' },
  crate:   { r: 0.7, h: 0.8, solid: false, name: 'Range crate' }
};

/**
 * Furnish one hole.
 *
 * @param rk        the hole's seeded rng kit — MUST be the shared one, or the
 *                  props would come out different on the server and the client
 * @param dense     dist2route, so nothing lands in the playing corridor
 * @returns [{ kind, x, z, rot }]
 */
export function placeProps(rk, hole, bio, dense) {
  const out = [];
  const halfW = hole.fairwayWidth * 0.5;
  /* Everything sits at least this far off the centreline. The rough belongs
     to the golf; the furniture lives beyond it. */
  const CLEAR = halfW + hole.roughWidth + 4;
  const tees = Object.values(hole.tees || { back: hole.tee });

  const ok = (x, z, r) => {
    if (dense(x, z) < CLEAR + r) return false;
    for (const t of tees) if (Math.hypot(x - t.x, z - t.z) < 9 + r) return false;
    if (Math.hypot(x - hole.green.x, z - hole.green.z) < hole.green.r + 9 + r) return false;
    for (const w of hole.waters) {
      if (Math.hypot(x - w.x, z - w.z) < Math.max(w.rx, w.rz) + 3 + r) return false;
    }
    for (const p of out) {
      if (Math.hypot(x - p.x, z - p.z) < PROP_KINDS[p.kind].r + r + 4) return false;
    }
    return true;
  };

  /** Try to drop a prop beside the route at arc-length s, on either side. */
  const beside = (kind, s, want) => {
    const r = PROP_KINDS[kind].r;
    const p = routeAt(hole.route, hole.cum, s);
    const t = routeTangent(hole.route, hole.cum, s);
    for (let i = 0; i < 8; i++) {
      const side = i % 2 ? 1 : -1;
      const off = (want + i * 2.5) * side;
      const x = p[0] + (-t[1]) * off, z = p[1] + (t[0]) * off;
      if (!ok(x, z, r)) continue;
      // face the fairway: the door of a shelter looks at the golf
      out.push({ kind, x, z, rot: Math.atan2(-(-t[1]) * side, -(t[0]) * side) });
      return true;
    }
    return false;
  };

  /* ---- the tee furniture: a washer and a bin beside the back tee -------
     BEHIND the markers, which is where a real one stands and the only place
     that is out of play by construction — the ball leaves the tee going
     forward, so nothing level with or behind it can ever be struck.

     The first version threw darts in a ring 6-15 m from the tee and demanded
     they clear the fairway. On any hole with a corridor wider than about 29 m
     — which is most of them — every candidate was inside the fairway and the
     hole got no furniture at all. Six of nine holes on every course were bare
     at the tee and nobody noticed because the two that weren't looked fine. */
  const teeSpot = (hole.tees && hole.tees.back) || tees[0] || hole.tee;
  {
    /* Which way is the hole? NOT the spline tangent at the tee — on the
       hand-drawn opener the first two control points run back over the tee
       and the tangent there points 100 degrees off the way the hole actually
       plays, which put the bin seven metres out in front of the markers.
       Take the bearing to a point 40 m down the route instead: far enough to
       wash out any wiggle at the start, near enough to still be this hole. */
    const sTee = dense(teeSpot.x, teeSpot.z, true).s || 0;
    const far = routeAt(hole.route, hole.cum, Math.min(sTee + 40, hole.total));
    const fx = far[0] - teeSpot.x, fz = far[1] - teeSpot.z;
    const fl = Math.hypot(fx, fz) || 1;
    const t = [fx / fl, fz / fl];
    const side = rk.raw() < 0.5 ? 1 : -1;      // washer left or right of the pad
    const put = (kind, lat, back) => {
      const x = teeSpot.x + (-t[1]) * lat - t[0] * back;
      const z = teeSpot.z + (t[0]) * lat - t[1] * back;
      out.push({ kind, x, z, rot: Math.atan2(t[0], t[1]) + rk.f(-0.3, 0.3) });
    };
    put('washer', 5.2 * side, 2.4);
    put('bin', 6.4 * -side, 3.6);
  }

  /* ---- a marker post at the corner, where the hole actually turns ------- */
  beside('sign', hole.total * rk.f(0.42, 0.58), CLEAR + 2);
  beside('sign', hole.total * rk.f(0.72, 0.90), CLEAR + 2);

  /* ---- a bench, and a second one if the walk is genuinely long --------- */
  beside('bench', hole.total * rk.f(0.25, 0.55), CLEAR + 3);
  if (hole.total > 400) beside('bench', hole.total * rk.f(0.60, 0.85), CLEAR + 3);

  /* ---- and the buildings ----------------------------------------------
     Not on every hole: a shelter on all nine is a housing estate. The
     halfway hut goes near the middle of the round because that is what
     halfway means, and the toilet block goes with it. */
  if (hole.number === 5) {
    beside('hut', hole.total * rk.f(0.06, 0.16), CLEAR + 7);
    beside('toilet', hole.total * rk.f(0.06, 0.16), CLEAR + 9);
  }
  if (hole.number === 2 || hole.number === 7) {
    beside('shelter', hole.total * rk.f(0.35, 0.65), CLEAR + 5);
  }
  if (bio.id === 'sandbelt' || bio.id === 'links') {
    // a couple of crates of range balls, which is what these places look like
    beside('crate', hole.total * rk.f(0.15, 0.85), CLEAR + 4);
  }

  return out;
}

/** Props the ball and the walker must not pass through. */
export const solidProps = hole =>
  (hole.props || []).filter(p => PROP_KINDS[p.kind]?.solid);
