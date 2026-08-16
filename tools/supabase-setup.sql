-- ===========================================================================
--  supabase-setup.sql — run once in the Supabase SQL editor
-- ---------------------------------------------------------------------------
--  STRICTLY SPEAKING THIS IS OPTIONAL. The server creates both tables itself
--  with CREATE TABLE IF NOT EXISTS the first time it connects, so setting
--  DATABASE_URL and letting it boot is enough to make the game save.
--
--  Running this first does two things that the server cannot do for itself:
--
--    1. It creates the tables BEFORE the first player arrives, so the very
--       first boot is not also a schema migration.
--
--    2. It turns on row level security. This is the part that matters, and
--       it is a Supabase-specific concern rather than a Postgres one:
--       Supabase automatically publishes every table in the `public` schema
--       through its REST API. A table with no RLS is readable and writable
--       by anyone holding the project's anon key — and an anon key is not a
--       secret, it is designed to ship inside client applications.
--
--       This game never gives Supabase's key to a browser: only the game
--       server connects, using the connection string. So nothing is exposed
--       today. But "nothing is exposed because of how we happen to use it"
--       is a weaker position than "nothing is exposed because the database
--       refuses", and the difference costs two lines.
--
--  WHY ENABLING RLS DOES NOT LOCK OUT THE GAME. Row level security is not
--  enforced against a table's OWNER unless you also FORCE it. The server
--  connects as `postgres`, which owns these tables, so it keeps full access.
--  The anon and authenticated roles the REST API uses are not the owner, and
--  with no policies defined they can do nothing at all. That asymmetry is
--  the whole trick, and it is why there are no CREATE POLICY lines below:
--  the absence of a policy IS the policy.
--
--  Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
--  Careers: one row per player. `pid` is the id the client generates for
--  itself — there are no accounts and no sign-up, which is the point.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  pid        text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
--  Everything that is one shared document rather than one row per player:
--  the course records board, the friend graph, the claimed-name registry.
--  Keyed by name, so a new board needs no migration.
-- ---------------------------------------------------------------------------
create table if not exists public.blobs (
  key        text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
--  Shut the public API out of both. No policies follow deliberately: with
--  RLS on and nothing granted, anon and authenticated can read nothing and
--  write nothing, while the owning role the server connects as is unaffected.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.blobs    enable row level security;


-- ---------------------------------------------------------------------------
--  Confirm it. Both tables should come back with rls_enabled = true.
-- ---------------------------------------------------------------------------
select
  tablename                          as table_name,
  rowsecurity                        as rls_enabled,
  (select count(*) from pg_policies p
    where p.schemaname = t.schemaname
      and p.tablename  = t.tablename) as policies
from pg_tables t
where schemaname = 'public'
  and tablename in ('profiles', 'blobs')
order by tablename;
