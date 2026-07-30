# ⛳ Links & Legends

Online multiplayer golf in the browser, played from behind the ball. Five
courses of nine holes each, up to eight players, turn-based stroke play over a
shared link.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/owenweaver7477-dotcom/links-and-legends)

**Play it now:** click the button. Render reads `render.yaml`, builds it, and
gives you a permanent `https://` link on the free tier — no laptop left running,
no commands, just send the link to whoever you want to play with.

Or run it yourself:

```bash
npm install && npm start
```

Then open <http://localhost:3000>. The server binds `0.0.0.0` and honours
`process.env.PORT`, so the same command works locally, behind a tunnel, or on
any host that runs a long-lived Node process.

---

## The courses

| Course | Where | What defines it |
|---|---|---|
| **Claude National** | Georgia, USA | Tree-lined parkland, generous fairways, water in play, fast greens |
| **Cairnmoor Links** | Ayrshire, Scotland | Wind, choppy dunes, deep pot bunkers, no trees to hide behind |
| **Red Mesa** | Arizona, USA | Target golf — narrow corridors, desert waste either side, saguaros |
| **Hochkar Alpine** | Tyrol, Austria | Big elevation change through dense spruce; read the slope |
| **Palmera Cay** | Quintana Roo, Mexico | Water on most holes, palms, soft greens that hold |

All par 36, 3300–3430 yards. Hole 1 of Claude National is the
hand-drawn top-down map this project started from, converted to metres and kept
faithful — same dogleg, same ponds, same greenside bunker.

**Every hole is generated from a seed**, deterministically, by code both the
server and the browser run. Nothing about the course ever crosses the network:
each client builds byte-identical terrain, trees and hazards from the course id
and hole number alone.

---

## Playing

You have a golfer on the course, and you walk them to the ball.

- **Walk** with `W A S D` — relative to where the camera is looking, so `W` is
  always "away from me". Hold `Shift` to run. `F` jogs you to your own ball if
  you cannot be bothered.
- **Take a cart** with `C`. `W`/`S` are the pedals, `A`/`D` steer, `Space` is the
  handbrake, and `C` again gets you out. It tops out at 49 mph — heavy off the line, quick once rolling —, so it genuinely
  beats running, and it will not go on a green or into a bunker — the same
  places you would be shouted at for taking a real one. Hills matter: it slows
  going up and runs away from you coming down.
- **Offer someone a lift** with `G` while driving. The nearest player gets a
  message; they walk over and press `C` to drop into the passenger seat.
- **You cannot play a shot from a cart.** Get out first. The server enforces it.
- Trees are solid and you do not wade into water; rough and sand slow you down.
- **You can only play a shot from within 2.6 m of your ball.** Walk away and the
  club leaves your hands — the swing controls hide and a prompt tells you how far
  you have to go. The server enforces the same radius, so it is not a client-side
  courtesy.
- `V` switches between third person (the default, for walking) and first person.
  Standing over the ball drops you into first person on its own.

Once you are at the ball, you are standing behind it looking down the hole.

- **Aim** with `←`/`→` — TAP for a surgical nudge, HOLD and the sweep winds up
  from fine to fast, `Shift` pins it ultra-fine for putts. The arrows switch
  from walking to aiming as soon as you are over the ball. Right-drag looks
  around freely, the whole way round.
- **Club**: `Q`/`E` or the mouse wheel. One is picked for you from the lie and
  the yardage; override it whenever you like.
- **Swing**: press the left button and **drag down** to take the club back, then
  **drag back up and release** to strike. Letting go at the top of the backswing
  still plays the shot — dead straight, with none of the shaping the
  through-stroke gives you — so a swing is never simply lost.
  - How far you drag down is power. Past 100% you are overswinging, and accuracy
    goes with it.
  - How far you drift **sideways** as you come back through the ball is your
    strike. Dead straight is pure; off to one side opens or closes the face and
    the ball fades or draws. The meter shows it live.
- **The white mark on the power meter is your caddie**: it is the exact power
  that finishes this shot at the flag, in this wind, from this lie, computed by
  running the real simulation. Match it and you are pin high.
- `M` for the hole map, `R` to reset the view, `Esc` to abandon a swing, `P` for
  the frame-rate meter.

**When a putt drops.** A birdie gets a fist pump, an eagle both arms up and a
hop, and an ace or an albatross a full turn with the cap coming off. Triple
bogey or worse gets a slow shake of the head. Par, bogey and double get nothing
at all, deliberately: they are the three most common scores in golf, and
reacting to them would make a birdie feel like nothing. Every client plays
everyone's reaction, and the hole summary now waits for it to finish instead of
dropping a black card over the top.

**The minimap** (top left) shows the whole hole at a glance — fairway, water,
sand, the tree masses, every ball and the pin, plus a dashed line to where
your current club and aim would actually finish. Check it before every tee
shot to see what to avoid.

**Knowing who is who.** The roster in the top right lists everyone with their
distance to the hole, live. Players you can see on screen get their name floating
above their head; players you cannot get a compass needle pointing at them, so
you always know where the group is. Whoever is up next is highlighted.

### Setting up your round

In the lobby you pick the **course**, the **tees**, **how your golfer looks**,
your **ball colour** and the **fourteen clubs** you carry, plus yards or metres
and the graphics setting.

Your golfer is a blocky low-poly figure you dress from swatches: **cap** (8),
**shirt** (8), **skin** (5) and **trousers** (5). Changes show up on everyone
else's screen immediately and stick for the whole session. The cap carries a
small flash in your ball colour, so you can tell people apart from behind.

Three tee sets per hole, cut back along the centreline: **Championship** (the
full card, and the default), **Members** (about 8% shorter) and **Forward**
(about 17% shorter). Hole 1 of Claude National plays 547 / 503 / 454.

Whoever is **furthest from the hole plays next**, as in real golf. On the tee it
falls to whoever is winning. When everyone has holed out you get the hole's
scorecard, then it moves on; after nine you get the full card with birdies and
bogeys marked.

### Playing with friends on other networks

Create a room and send the link from the lobby — it carries the room code, so
anyone opening it drops straight in. **The room code on the scorecard is a
button too**, so you can still pull somebody in after you have teed off; they
watch until the next hole, then join the card. The lobby says plainly whether
the link you are about to send actually reaches anyone or only works on your
own machine.

Getting that link reachable depends on how far away they are.

**Same wifi.** Your LAN address is enough; the server prints it on startup.

**Anywhere else, right now.** One command opens a public HTTPS tunnel:

```bash
npm run share
```

It starts the server if it is not already running, prints a link anyone in the
world can open, and closes the tunnel on Ctrl-C. It uses `cloudflared` if you have
it — real WebSockets, no interstitial — and falls back to localtunnel via npx
otherwise. For the good one: `brew install cloudflared`. The catch is that your
laptop has to stay awake and running.

**Anywhere else, permanently.** Deploy it. Config for the usual hosts ships with
the repo, all on free tiers:

| Host | How |
|---|---|
| Render | push to GitHub, then New → Blueprint → pick the repo (`render.yaml`) |
| Fly.io | `fly launch --no-deploy` then `fly deploy` (`fly.toml` + `Dockerfile`) |
| Railway | point it at the repo; it reads `Procfile` |
| Docker | `docker build -t golf . && docker run -p 3000:3000 golf` |

The server binds `0.0.0.0`, honours `$PORT` and trusts `X-Forwarded-*`, so it works
behind any of those unchanged. It needs real WebSockets, so **not** a serverless
or edge platform.

---

## The golf

The ball is 45.9 g and 42.7 mm across and flies because it is spinning. Backspin
generates lift through the Magnus effect — the reason a wedge climbs steeply and
a driver bores forward. That is modelled directly: drag and lift coefficients as
functions of the spin ratio, wind as a moving air mass, then the bounce and the
run-out when it lands.

**Twenty clubs plus a putter, and you carry fourteen** — the same limit the
rules impose, so the bag is a real decision. The overlaps are the point: a 7
wood, a 2 iron, a 3 iron and a 3 hybrid all go about 210 yards and fly
completely differently.

The bag was **calibrated, not guessed** — ball speeds were solved numerically so
each club's carry lands on a real launch-monitor number:

| | DR | 3W | 5W | 2i | 7W | 3i | 3H | 4i | 4H | 5i |
|---|---|---|---|---|---|---|---|---|---|---|
| carry | 268 | 243 | 226 | 218 | 215 | 211 | 210 | 204 | 199 | 191 |

| | 5H | 6i | 7i | 8i | 9i | PW | GW | SW | LW | Flop |
|---|---|---|---|---|---|---|---|---|---|---|
| carry | 188 | 179 | 166 | 153 | 140 | 128 | 114 | 96 | 77 | 63 |

(yards of carry, no wind, level lie — `npm test` re-checks every one)

Spin is what separates them on landing: a lob wedge checks up inside four
yards, a driver runs sixteen. Firm links turf runs more; soft tropical greens
hold.

**Surfaces matter.** Rolling resistance is tuned so a putt decelerates at about
0.64 m/s² on a green — a 3 m/s putt runs seven metres, which is right. Rough is
nearly ten times draggier than a green, a bunker thirty times, and both cost you
clubhead speed and nearly all your spin, so you cannot flight it out of trouble.

**Putting** comes out where real golf does. For a careful player — aim within
1.5°, pace within 5% — the measured hole-out rate is 100% from a metre, 86% from
three, 42% from five and nothing at all from twelve. Greens have real contour, so
pace and line both matter, and a putt hit too hard catches the lip and spins away.

---

## How the multiplayer works

The server is authoritative for everything, and because the course generator and
the flight model are shared, pure, deterministic modules, **the server simulates
every shot itself** — about 2 ms. It never takes a client's word for anything.

1. You release the swing; the client sends `{club, power, aim, faceAngle, attack}`.
2. The server checks it really is your turn, substitutes **its own** ball
   position, runs the simulation, applies the strokes, and broadcasts the shot
   along with the outcome.
3. Every client replays that identical shot purely to animate it, and snaps to
   the server's answer at the end.

Nothing a client sends can put a ball anywhere the server did not put it. The
walk-to-your-ball radius is checked the same way: the server tracks where your
golfer is standing and refuses a swing taken from across the fairway.

**Walking** rides on a separate, much lighter channel. Your position goes out at
10 Hz on `players:pos` — just `{x, z, rot, moving}` — instead of riding the full
room snapshot. Other clients never teleport those to the screen: each remote
golfer keeps a target and eases toward it every frame
(`k = 1 - exp(-9·dt)`), so at 10 packets a second you still see a smooth walk at
whatever frame rate the machine is running. The walk animation is driven by the
resulting *observed* speed, so remote players' legs move at the speed they are
actually travelling.

---

## Performance

Everything is built for the low end: instanced trees (one draw call per species
part, not per tree), blob shadows rather than a shadow map, no post-processing at
all, 256–512 px canvas textures, shared geometry across every avatar, and terrain
built once per hole and left alone. A hole in play costs about **46–52 draw calls
and 101 k triangles**, which is the number that actually matters on integrated
graphics.

A cart costs **4 draw calls and 278 triangles**: the whole vehicle is one merged
geometry shared by every cart, with the bodywork and the player's livery as two
material groups, and it adds no textures at all because it borrows the avatars'
blob shadow. Eight carts on screen cost about what two golfers do — the avatars
are the expensive things here, at fourteen draw calls each.

**Graphics** in the lobby defaults to *Performance* — blob shadows only. Switch it
to *Quality* for a real sun shadow map if the machine can take it.

One honest caveat: I could not measure a true frame rate in this environment. A
headless browser pane never composites, so `gl.finish()` returns instantly and
reports thousands of fps — a meaningless number — and the GPU here is an Apple
M4, not the Intel UHD the budget is aimed at. So rather than claim a measured
60 fps, the structural budget above is what was verified, and **`P` toggles a
live fps/frame-time/draw-call overlay** so you can check the real figure on the
laptop you actually play on.

It also holds up when things go wrong: a round is never torn down because
connections blipped — it parks exactly as it is and resumes when someone
reconnects, with the scorecard intact. Refreshing rejoins your own seat.
Disconnected players are skipped rather than blocking the turn, and joining
mid-round puts you in as a spectator until the next hole.

---

## Tests

```bash
npm test                 # the golf: carries, putting, all 45 holes, invariants
npm run test:server      # hostile names, malformed swings, spoofing, flooding
npm run test:resilience  # disconnects, rejoins, host migration, spectators
npm run test:cart        # steering signs, slopes, tunnelling, celebration clips
npm run test:round       # 8 bots play a full nine — npm run test:round links 8
```

The last three need the server running (`npm start`) in another terminal.
`npm test` needs nothing — it drives the shared physics directly.

## Layout

```
server.js                       Express + Socket.IO; authoritative, simulates every shot
share.mjs                       npm run share — opens a public tunnel
Dockerfile · render.yaml · fly.toml · Procfile
public/
  index.html · css/style.css
  vendor/three.module.js        vendored, no CDN
  js/shared/                    ← run by BOTH the server and the browser
    rng.js                      seeded PRNG + value noise; the root of all determinism
    biomes.js                   the five courses: terrain, hazards, palette, wind
    coursegen.js                builds all 45 holes from seeds
    terrain.js                  heightAt() and surfaceAt() — one authority for the ground
    clubs.js                    the bag
    ballistics.js               3D flight, bounce, roll, and the caddie's power number
    avatars.js                  appearance palettes, walk speeds, the 2.6 m shot radius
    cart.js                     cart kinematics, slopes, per-surface driving
  js/client/
    scene.js                    Three.js world: terrain, water, instanced trees, sky
    surfacemap.js               paints the ground texture from the same hole data
    avatar.js                   the blocky golfer: shared boxes, trig walk cycle, blob shadow
    walker.js                   WASD movement, collision against trees and water
    roster.js                   live player list, floating name tags, off-screen compasses
    carts.js                    owning the local cart, easing the remote ones, seating
    cart3d.js                   the cart mesh: one merged geometry, four draw calls
    celebrations.js             what a golfer does when the putt drops
    cameras.js  swing.js  hud.js  net.js  main.js
test/
    physics.mjs  cart.mjs  server-hardening.mjs  resilience.mjs  round.mjs
```

### Extending it

Courses are data. Add an entry to `BIOMES` in
[`biomes.js`](public/js/shared/biomes.js) — relief, tree species, hazard
tendencies, palette, wind — and add its id to `COURSE_ORDER`; the generator,
renderer and physics all pick it up with no other changes. Par, hole lengths,
green speed and firmness are per-biome knobs in the same file.

---

## Two things worth knowing

**Hole 1 is guarded by the sentinels.** The original hairpin dogleg was
cuttable — 541 yards around the corner but only 220 straight at the pin, and
with real ball flight a drive over the trees left a wedge in. Two walls of
old-growth oaks (14–23 m, two to three times the height of the surrounding
forest) now stand on the inside of the corner, tall enough to catch a driver
while it is still climbing. Verified in simulation: a driver, 3 wood or 5 iron
aimed at the pin all finish ~180 m short in the trees, and the honest line
around the dogleg is untouched.

**Difficulty.** Simulated rounds by a competent bot come in around level par to
+10 on every course, which is where a decent amateur field lands. `skill` in the
soak test and the `windBase` / `treeDensity` / `relief` knobs per biome are the
levers if you want it harder or gentler.

**Debug handles.** The bottom of [`main.js`](public/js/client/main.js) hangs
`__G`, `__scene`, `__rig`, `__swing`, `__walker` and `__frame` off `window` so a
headless harness can drive the loop and inspect state — that is how the walking,
interpolation and roster behaviour in this repo were verified. Nothing there can
alter a score, because the server simulates every shot from its own ball
positions, but somebody at a console could skip the walk to their ball. Delete
those four lines if you are ever playing for money.
