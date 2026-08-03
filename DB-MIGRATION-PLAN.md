# Moving off the JSON file — the plan, before it runs

Prompt 4 asked for the migration plan first. This is it. **Nothing here has
been run.** Course records and presence shipped without it; friends and
durable careers need it.

---

## 1. The finding that changes the shape of this

I went and read what the CrazyGames SDK actually offers before designing
anything, and one line in their own account-integration guide matters more
than the rest:

> Avoid relying solely on local data to identify Guests across sessions as
> multiple users might share the same device.

**That is exactly what this game does today.** Every career — coins, XP,
clubs, crew, unlocked emotes — hangs off `lg_pid`, a random id we generate
and keep in the CrazyGames Data module. CrazyGames are telling us not to
trust it, and they are right: two people on one laptop share one career, and
one person clearing their data loses theirs. That is not a bug I introduced;
it is the foundation the whole progression sits on, and it does not survive
contact with a real audience.

So the identity work is not a nice-to-have that unlocks friends. It is the
fix for a problem you already have.

### What the SDK gives us

| | Guest | Signed-in CrazyGames user |
|---|---|---|
| Stable id across sessions | ❌ none | ✅ `userId` from `getUserToken()` |
| Server can *verify* who they are | ❌ | ✅ JWT, verified on our backend |
| Survives clearing browser data | ❌ | ✅ |
| Survives moving device | ❌ | ✅ |
| Friends list possible | ❌ | ✅ |

The flow is: `isUserAccountAvailable` → `showAuthPrompt()` → `getUserToken()`
→ our server verifies the JWT → we get a `userId` we can trust.

**One gap I could not close from the public docs:** the JWKS endpoint / public
key for verifying that JWT is not published. Their docs say to verify it
server-side but do not say against what. That needs an email to CrazyGames
before the auth path can be finished, and it is worth sending now because it
will sit in someone's inbox for a few days.

---

## 2. What I cannot do, and need you for

**I cannot create the database.** Supabase and Neon both need an account
signed up with your email and a password, and creating accounts or handling
credentials is off-limits for me. So:

- You create a free Postgres project (Neon or Supabase — either is fine; Neon
  is slightly simpler for a single connection string).
- You put the connection string in Render as `DATABASE_URL`.
- I do everything else.

Pick whichever you like; nothing below depends on which.

---

## 3. The migration, step by step

The rule throughout: **no step deletes anything, and every step is reversible
until the last one.**

### Step 1 — a storage seam, with no behaviour change
Introduce `server/store.js` with the handful of operations profiles actually
need (`load`, `get`, `put`, `all`). The existing JSON file becomes one
implementation of it. Ship it, run the suite, confirm the game behaves
identically. Nothing has moved yet.

### Step 2 — the Postgres implementation
A second implementation behind the same seam, chosen at boot:

```
DATABASE_URL set   -> Postgres
DATABASE_URL unset -> the JSON file, exactly as today
```

Local development and the test suite keep using the file, so nothing about
your workflow changes and the tests stay fast and offline.

### Step 3 — copy, do not move
`npm run migrate:db` reads `data/profiles.json` and writes every profile into
Postgres. It is idempotent — safe to run twice — and it **never deletes the
JSON file**. After it runs, both stores hold the same data.

### Step 4 — switch, and watch
Set `DATABASE_URL` on Render. The next deploy reads from Postgres. The JSON
file is still sitting there untouched; if anything looks wrong, unset the
variable and you are back on it within one deploy.

### Step 5 — only once you are happy
Retire the file path. Keep the device snapshot restore either way — it is
belt-and-braces and it has already saved a career once.

### What could go wrong, and what catches it
- **Profiles lost in the copy.** The migration prints a count in and a count
  out and refuses to finish if they disagree.
- **Postgres unreachable at boot.** The server falls back to the file and
  logs loudly rather than starting with an empty world and quietly handing
  everyone a fresh career.
- **Two servers, one database.** Fine — that is the point — but the in-memory
  profile cache needs a short TTL or a second instance serves stale coins.

---

## 4. Friends: what is honestly achievable

**For a signed-in CrazyGames user:** a real friends list. Durable ids on both
sides, so "Owen added Sam" still means something next week, on another
device. Presence and join-a-friend already work and would simply key off the
verified id instead of the local one.

**For a guest:** not a friends list, and I would rather say so than ship
something that quietly forgets people. What a guest *can* have is what is
already live — see who is on the course now, and join them — plus the invite
link, which is the path CrazyGames actually supports for playing with someone
you know.

My recommendation: gate the friends list behind sign-in and make that a
feature rather than a wall — "sign in to keep your career on any device and
add friends" is a genuinely good offer, and it fixes the shared-device
problem at the same time.

---

## 5. What I would like from you

1. **Create the Postgres project** and give me `DATABASE_URL` in Render.
2. **Email CrazyGames** for the JWT verification details (JWKS endpoint or
   public key) — it is the only thing blocking verified identity.
3. **Tell me whether to gate friends behind sign-in**, or to skip friends for
   now and go straight to Prompt 5.

I can start Step 1 immediately without any of the above — the storage seam is
useful on its own and changes nothing until a `DATABASE_URL` appears.
