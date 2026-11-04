-- Deercast — database setup (v2: the app reads AND writes). Paste into Supabase → SQL Editor → Run. Safe to re-run.
-- Contains NO data. Who can see or change what is enforced here (row-level security), not in the web page.
--
-- Rules:
--   * Only emails in app_users are approved. Anyone else can finish Google sign-in but sees and saves nothing.
--   * Admins (role 'admin') manage app_users and the development punch list.
--   * A hunting ground is visible to its owner and members. Members share its stands and marks (all can edit);
--     only the owner renames it, changes members or deletes it; a member can leave.
--   * Hunts: members of a ground see everyone's hunts on it (shared sightings, best-stand history);
--     each person creates/edits/deletes only their own. Gear, active hunt and shots are personal.

create table if not exists public.app_users (email text primary key, name text, role text not null default 'member');
create table if not exists public.grounds (id text primary key, name text not null, owner text not null,
  members text[] not null default '{}', home jsonb, created text);
create table if not exists public.stands (id text primary key, ground_id text not null references public.grounds(id) on delete cascade, data jsonb not null);
create table if not exists public.features (id text primary key, ground_id text not null references public.grounds(id) on delete cascade, data jsonb not null);
create table if not exists public.hunts (id text primary key, ground_id text references public.grounds(id) on delete cascade, owner text not null, data jsonb not null);
create table if not exists public.shots (id text primary key, ground_id text references public.grounds(id) on delete set null, owner text not null, data jsonb not null);
create table if not exists public.user_docs (owner text not null, name text not null, data jsonb not null, primary key (owner, name));
create table if not exists public.punchlist (id text primary key, data jsonb not null);

-- deleting a ground keeps everyone's hunt logs and shots (they just lose the ground link)
alter table public.hunts drop constraint if exists hunts_ground_id_fkey;
alter table public.hunts add constraint hunts_ground_id_fkey foreign key (ground_id) references public.grounds(id) on delete set null;

create or replace function public.me() returns text language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;
create or replace function public.is_approved() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_users where email = public.me()) $$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_users where email = public.me() and role = 'admin') $$;
create or replace function public.is_member(gid text) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_approved() and exists (select 1 from public.grounds g where g.id = gid and (g.owner = public.me() or public.me() = any (g.members))) $$;
create or replace function public.leave_ground(gid text) returns void language sql security definer set search_path = public as $$
  update public.grounds set members = array_remove(members, public.me()) where id = gid and owner <> public.me() and public.is_approved() $$;

do $$ declare t text; begin
  foreach t in array array['app_users','grounds','stands','features','hunts','shots','user_docs','punchlist'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- drop every existing policy on these tables, then create the current set
do $$ declare p record; begin
  for p in select policyname, tablename from pg_policies where schemaname = 'public'
    and tablename in ('app_users','grounds','stands','features','hunts','shots','user_docs','punchlist') loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

create policy "users read"   on public.app_users for select to authenticated using (email = public.me() or public.is_approved());
create policy "users admin"  on public.app_users for all    to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "grounds read"   on public.grounds for select to authenticated using (public.is_member(id));
create policy "grounds create" on public.grounds for insert to authenticated with check (public.is_approved() and owner = public.me());
create policy "grounds owner"  on public.grounds for update to authenticated using (public.is_approved() and owner = public.me()) with check (owner = public.me());
create policy "grounds delete" on public.grounds for delete to authenticated using (public.is_approved() and owner = public.me());

create policy "stands members"   on public.stands   for all to authenticated using (public.is_member(ground_id)) with check (public.is_member(ground_id));
create policy "features members" on public.features for all to authenticated using (public.is_member(ground_id)) with check (public.is_member(ground_id));

create policy "hunts read"  on public.hunts for select to authenticated using (public.is_member(ground_id) or (public.is_approved() and owner = public.me()));
create policy "hunts write" on public.hunts for insert to authenticated with check (public.is_approved() and owner = public.me() and (ground_id is null or public.is_member(ground_id)));
create policy "hunts edit"  on public.hunts for update to authenticated using (public.is_approved() and owner = public.me()) with check (owner = public.me() and (ground_id is null or public.is_member(ground_id)));
create policy "hunts del"   on public.hunts for delete to authenticated using (public.is_approved() and owner = public.me());

create policy "shots own"     on public.shots     for all to authenticated using (public.is_approved() and owner = public.me()) with check (owner = public.me());
create policy "docs own"      on public.user_docs for all to authenticated using (public.is_approved() and owner = public.me()) with check (owner = public.me());
create policy "punch admins"  on public.punchlist for all to authenticated using (public.is_admin()) with check (public.is_admin());

revoke execute on function public.is_member(text), public.is_approved(), public.is_admin(), public.leave_ground(text) from anon;
