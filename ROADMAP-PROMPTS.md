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

## Prompt 1 — Movement, carts, and the sprint that got lost

> Three movement changes, plus a bug.
>
> **Carts.** Raise the base cart speed. It's currently `BASE_SPEED_KMH = 24`
> in `public/js/shared/cart.js` with a 1.3× boost ceiling. Take the base to
> 32 km/h and keep the boost multiplier, so a fully upgraded cart tops out
> around 42. Re-run `test/cart.mjs` — it asserts on these numbers and will
> tell you exactly what else moves. Check the cart still handles: at higher
> speed the steering and the collision response both need to still feel
> controlled, not skittish.
>
> **Sprint.** There are two speeds today, `WALK_SPEED` and `SPRINT_SPEED`, in
> `public/js/shared/avatars.js`, and Shift is the run key. I want a third,
> faster tier bound to **F** — a real dash, clearly quicker than Shift-run,
> for crossing a fairway. Shift stays exactly as it is. Decide whether F is a
> hold or a toggle and say which you chose and why. If it needs a cost or a
> cooldown to stop it replacing the cart entirely, add one and explain it.
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

## Prompt 3 — The wardrobe: women, body types, and emotes

> **Women.** The golfer is currently one body type. Add a proper body-shape
> choice to the customiser — at minimum a feminine build alongside the
> current one, built the same procedural way the rest of the avatar is (see
> `buildHeadwear` in `public/js/client/avatar.js` and the slot system in
> `public/js/shared/avatars.js`). Different proportions, not just a different
> shirt. Make sure the swing animation, the address stance and the seated
> cart pose all still work on the new build — the address solve is sensitive,
> so check it.
>
> This must go through `normaliseLook`, stay backward compatible with looks
> people already have saved, and be covered in `test/wardrobe.mjs`.
>
> **Emotes.** Add an emote wheel, bound to a key, with the emotes bought from
> the Pro Shop for coins. There's already a celebration system in
> `public/js/client/celebrations.js` — reuse its animation approach. Emotes
> must replicate to other players over the existing socket channels. Six to
> eight to start: a wave, a club twirl, a shrug, a fist pump, a slow clap,
> a bow.
>
> Keep it all procedural. The build is 1.31 MB and there are no texture or
> mesh assets in this project — that's what keeps it inside CrazyGames'
> budget. Don't introduce any.

---

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
