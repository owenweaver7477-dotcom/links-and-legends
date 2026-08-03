# Links & Legends — the next six prompts

Feed these to Claude Code **one at a time, in order**. Each is self-contained,
each ends in a shippable state, and later ones depend on earlier ones. Don't
paste all six at once — you'll get shallow work on all of them instead of
finished work on each.

Two things to settle before Prompt 1, because they change what's possible:

- **Storage.** Course records, friends and online presence cannot live in
  `data/profiles.json` on Render's free tier — that disk is wiped on every
  deploy. You need a real database (Supabase and Neon both have free Postgres
  tiers). Prompt 4 assumes one exists. Everything before it does not.
- **Chat moderation.** CrazyGames will not approve open text chat between
  strangers without filtering. Prompt 5 covers this, but if you'd rather not
  own that risk, cut free-text chat and keep the quick-phrase wheel.

---

## Prompt 1 — Carts, getting to your ball, and water

> Four things, all about how it feels to move around a hole.
>
> **Carts.** Raise the base cart speed. It's currently `BASE_SPEED_KMH = 24`
> in `public/js/shared/cart.js` with a 1.3× boost ceiling. Take the base to
> 32 km/h and keep the boost multiplier, so a fully upgraded cart tops out
> around 42. Re-run `test/cart.mjs` — it asserts on these numbers and will
> tell you exactly what else moves. Check the cart still handles: at higher
> speed the steering and the collision response both need to still feel
> controlled, not skittish.
>
> **The F key — getting to your ball.** F is the go-to-your-ball key
> (`jogToMyBall()` in `public/js/client/main.js`, which calls
> `walker.goTo(spot.x, spot.z, SPRINT_SPEED)`). It currently travels at
> `SPRINT_SPEED`, 8.4 m/s, and on a long hole that is a tedious wait with
> nothing to do. Make it genuinely fast — this is a convenience action, not a
> skill test, and nobody should be watching their golfer trudge 200 metres.
>
> Pick a speed that makes a full-drive walk feel brief rather than absent,
> and say what you chose. Keep it clearly distinct from the Shift free-sprint,
> which stays exactly as it is — F is the fast automatic route to the ball,
> Shift is manual running under the player's own control. Make sure the
> camera keeps up cleanly at the higher speed and doesn't judder or clip
> through trees, and that arriving still lands the golfer correctly on the
> address spot.
>
> **Cart collisions.** These look bad and I want them properly fixed. Go and
> read the current collision response in `public/js/client/cart3d.js` before
> changing anything, and tell me what's wrong with it. What I want to see:
> a cart that hits a tree stops or deflects with real weight rather than
> sliding or jittering; glancing blows that scrape and turn the cart instead
> of stopping it dead; some visible reaction — a lurch, a bounce, the body
> rocking on its suspension; and no clipping through solid things at the new
> higher speed. Cart-to-cart collisions should shove both carts believably
> rather than one passing through the other. Check it still behaves when two
> players collide over the network, where each client owns its own cart.
>
> **Water.** Water is wrong and I want it properly fixed — both how it looks
> and how it plays. Go and look at the current implementation in
> `public/js/client/scene.js` (the grid + Fresnel shader) and the water
> penalty path in `public/js/shared/ballistics.js`. Tell me what you find
> before you change it. I want: convincing motion and depth rather than a
> flat blue plane, a visible entry splash, and a drop procedure that always
> leaves a playable next shot.
>
> Test as you go. Show me screenshots of the water before and after.

---

## Prompt 2 — The swing: power drives the accuracy bar

> A real change to how the swing works, and it interacts with systems you've
> already tuned — so read `public/js/client/swing.js` and `test/swing.mjs`
> first and flag any conflict before you start.
>
> **Power should drive the accuracy bar's speed.** Right now the bar's tempo
> comes only from the lie (`LIE_TEMPO`). I want the power you selected to
> matter too: a full-blooded driver should give you a bar that's genuinely
> hard to stop, and a soft wedge should be calm. Layer this on top of the lie
> rather than replacing it.
>
> **The target band should shrink with the lie.** `PURE_BAND` already varies
> by surface — fairway is widest at 0.26. Make rough and sand meaningfully
> tighter so a bad lie is punished through precision, not just distance.
>
> Careful with sand: it's currently the SLOWEST bar in the game on purpose —
> easy to time, brutal to escape. Keep that trade. Sand should be a slow bar
> with a small target, which is a different kind of hard.
>
> Rebalance so the game is still winnable. A par round should be achievable
> for a decent player with mid-tier gear. Use the `Ctrl+Shift+D` shot
> telemetry to tune this by reading numbers rather than guessing, and show me
> a before/after table of hole-out rates or scoring averages across a few
> simulated rounds.

---

## Prompt 3 — Body types, emotes, and a level to earn them

> **Body types.** The golfer is one build today and everyone looks male. Add
> body shape as a proper customiser slot with a clearly different feminine
> option — the silhouette has to read as different from across the fairway,
> not just up close.
>
> Concretely, the feminine build wants: a bust, narrower shoulders, a defined
> waist with wider hips, and slightly shorter overall height with
> proportionally longer legs. The masculine build keeps the current squarer
> shoulders and straighter torso. Keep both tasteful and proportionate — this
> is a stylised low-poly game, so the goal is a silhouette that reads
> instantly at distance, not anatomy. Consider a third, heavier build too, so
> it's a range of body shapes rather than a binary.
>
> Build it the same procedural way as everything else — see the box-based
> construction and `buildHeadwear` in `public/js/client/avatar.js`, and the
> slot system in `public/js/shared/avatars.js`. No new assets.
>
> Then check every animation still works on every build, because the rig
> changes underneath them: the swing, the walk cycle, the address stance
> (that solve is sensitive — `addressSpot()` and `ADDRESS_YAW_BIAS` in
> `main.js` were hard-won, so verify the club still meets the ball), and the
> seated cart pose. Shirts and trousers must fit each build without clipping.
>
> This goes through `normaliseLook`, stays backward compatible with saved
> looks, and gets covered in `test/wardrobe.mjs`.
>
> **Five emotes, unlocked by level.** Add an emote wheel on a key, with
> exactly five emotes to start: a wave, a fist pump, a club twirl, a shrug,
> and a slow clap. Reuse the animation approach in
> `public/js/client/celebrations.js`, and replicate them to other players
> over the existing socket channels so everyone sees them.
>
> **An XP and level system**, which is what gates the emotes. XP is awarded
> for finishing a hole and again, more substantially, for finishing a full
> round — with better golf worth more, the same shape as the coin payout in
> `public/js/shared/economy.js`. Levels unlock the emotes one at a time, so
> there is a reason to keep playing beyond coins.
>
> Design the curve so the first emote arrives quickly — within a round or two
> — and the fifth is a genuine grind. Show me the XP-per-level table and
> roughly how many rounds each unlock takes. Show level and an XP bar in the
> clubhouse and on the results screen, and make levelling up an actual moment
> on screen rather than a number quietly changing.
>
> XP lives on the server profile beside coins, and must survive a reconnect
> and a wiped server the same way coins do — see `seedProfile` and the
> snapshot in `renderClubhouse`, and add XP and level to both.
>
> Keep it all procedural. The build is 1.31 MB with no texture or mesh assets,
> and that is what keeps it inside CrazyGames' budget. Don't introduce any.

## Prompt 4 — Persistence, course records, and presence

> **Read this first: this needs a real database.** Progress currently lives
> in `data/profiles.json`, on a disk Render wipes on every deploy. There's a
> snapshot-restore fallback (`seedProfile`) that saved us, but leaderboards
> and a friends list can't be rebuilt from one player's device. Set up
> Postgres (Supabase or Neon free tier), migrate profiles onto it, and keep
> the snapshot restore as a belt-and-braces fallback. Tell me the migration
> plan before you run it — I don't want existing careers lost.
>
> **Course records.** A global leaderboard per course: best round, best score
> on each individual hole, and who holds it. Show them in the clubhouse and
> on the hole summary ("course record here: 2, by Sam"). Records must only
> come from completed rounds the server itself simulated, so they can't be
> forged.
>
> **Friends and presence.** A friends list with online/offline status and
> what they're doing ("on the 4th at Red Mesa"), plus join-a-friend's-round
> straight from the list.
>
> Flag the platform limitation honestly: on CrazyGames, guests have no
> persistent account, so a friends list keyed to a device is fragile. Look at
> what the CrazyGames SDK's user module actually offers (`crazygames.js` in
> this repo already wraps the Data module and invite links) and tell me what
> is genuinely achievable for a signed-in CrazyGames user versus a guest,
> before building it.

---

## Prompt 5 — Talking to each other, and shoving each other

> Two social features, both with a risk I want you to take seriously rather
> than build past.
>
> **Text chat.** In-round chat. But CrazyGames will not approve open text
> between strangers without moderation, so: profanity filtering, rate
> limiting, a mute-player control, and no links. Server-side filtering, not
> client-side, since the client can't be trusted. Also add a quick-phrase
> wheel ("nice shot", "unlucky", "your turn") because most players will use
> that and it's zero risk.
>
> If you think free-text chat is more risk than it's worth for a portal
> launch, say so and make the case — I'd rather hear that now than after a
> rejection.
>
> **Melee / pushing.** I want to be able to shove another player's character.
> Think hard about griefing before you build it: on a public portal you're
> shoving strangers, and if a shove can knock someone off a green or delay
> their shot, it will be used to ruin rounds. Propose a design that keeps the
> fun and removes the weapon — options worth considering are making it purely
> cosmetic with no positional effect on the shot, or restricting it to
> private rooms with friends, or an opt-in toggle per room. Recommend one,
> explain the reasoning, then build it.
>
> Both features need to work over the existing Socket.IO channels and survive
> the reconnect storms that `test/softlock.mjs` covers.

---

## Prompt 6 — Make it look like a real product

> This one is about craft, and it's the one that decides whether the game
> looks worth playing. Take your time.
>
> **The Pro Shop needs rebuilding.** It currently looks generic and the club
> sets are represented by emoji (🪵 🔩 ⚙️ 🖤 🏅 💠 👑 in
> `CLUB_LOOK_ICON`, `public/js/client/hud.js`). That reads as a placeholder,
> because it is one. Replace every emoji with real artwork. My strong
> suggestion: inline SVG illustrations of the actual clubs, or live WebGL
> thumbnails rendered from the club models the game already has — both are
> crisp, both are tiny, and neither adds a download. Do not add PNGs.
>
> Redesign the whole shop layout around a clear progression: what I own, what
> I'm working toward, what it costs, and what it does in yards. The "+68 vs
> stock" carry readout should be the hero of the screen, not a footnote.
>
> **Animation pass.** The swing, the walk, the cart, the celebrations — go
> through all of them and raise the quality. Weight and follow-through on the
> swing, a walk cycle that doesn't glide, a proper flinch when a cart hits
> something. Reference how real golf swings sequence: hips, then torso, then
> arms, then club.
>
> **Graphics quality settings.** The quality toggle (`optQuality`) doesn't do
> enough. Make Low genuinely lighter for weak laptops and High genuinely
> better — shadow resolution, draw distance, tree density, water detail.
> Measure the frame time at each setting and show me the numbers.
>
> Screenshots throughout. If something looks bad, say so and fix it rather
> than shipping it.

---

## What I'd cut or defer

- **Free-text chat** is the single biggest risk to portal approval for the
  smallest gain. The quick-phrase wheel gets you 80% of the social feel at
  none of the moderation cost.
- **A true friends system** is fighting the platform. CrazyGames guests have
  no durable identity. Invite links already work and are the supported path.
- **Melee with real physical effect** will be used to grief. Cosmetic-only,
  or friends-rooms-only.
