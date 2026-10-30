-- Deercast web — database setup. Paste into Supabase → SQL Editor → New query → Run. Safe to run again.
-- Contains NO data. Who can see what is enforced here (row-level security), not in the web page.
--
-- Rules:
--   * Only emails in app_users are approved. Anyone else can finish Google sign-in but sees nothing.
--   * A hunting ground (and its stands, marks and everyone's hunts on it) is visible only to its owner and members.
--   * Read-only for now: there are no insert/update/delete policies, so the web page cannot change anything.

create table if not exists public.app_users (
  email text primary key,
  name  text,
  role  text not null default 'member'          -- 'admin' or 'member'
);

create table if not exists public.grounds (
  id      text primary key,
  name    text not null,
  owner   text not null,                         -- email
  members text[] not null default '{}',          -- emails
  home    jsonb,                                 -- {lat, lon, label, state, zip}
  created text
);

create table if not exists public.stands (
  id        text primary key,
  ground_id text not null references public.grounds(id) on delete cascade,
  data      jsonb not null                       -- same fields as stands.json
);

create table if not exists public.features (     -- bait/food, water, cover, bedding marks
  id        text primary key,
  ground_id text not null references public.grounds(id) on delete cascade,
  data      jsonb not null
);

create table if not exists public.hunts (
  id        text primary key,
  ground_id text references public.grounds(id) on delete cascade,
  owner     text not null,                       -- email of the hunter
  data      jsonb not null                       -- same fields as hunts.json (sightings inside)
);

-- The signed-in person's email (from Google, via Supabase Auth).
create or replace function public.me() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function public.is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_users where email = public.me())
$$;

create or replace function public.is_member(gid text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_approved() and exists (
    select 1 from public.grounds g
    where g.id = gid and (g.owner = public.me() or public.me() = any (g.members)))
$$;

alter table public.app_users enable row level security;
alter table public.grounds   enable row level security;
alter table public.stands    enable row level security;
alter table public.features  enable row level security;
alter table public.hunts     enable row level security;

drop policy if exists "see own approval"   on public.app_users;
drop policy if exists "members see ground" on public.grounds;
drop policy if exists "members see stands" on public.stands;
drop policy if exists "members see marks"  on public.features;
drop policy if exists "members see hunts"  on public.hunts;

create policy "see own approval"   on public.app_users for select to authenticated using (email = public.me());
create policy "members see ground" on public.grounds   for select to authenticated using (public.is_member(id));
create policy "members see stands" on public.stands    for select to authenticated using (public.is_member(ground_id));
create policy "members see marks"  on public.features  for select to authenticated using (public.is_member(ground_id));
create policy "members see hunts"  on public.hunts     for select to authenticated using (public.is_member(ground_id));

-- Signed-out visitors get nothing at all; signed-in people may only read (and RLS above filters the rows).
revoke all on public.app_users, public.grounds, public.stands, public.features, public.hunts from anon;
revoke all on public.app_users, public.grounds, public.stands, public.features, public.hunts from authenticated;
grant select on public.app_users, public.grounds, public.stands, public.features, public.hunts to authenticated;
revoke execute on function public.is_member(text), public.is_approved() from anon;
