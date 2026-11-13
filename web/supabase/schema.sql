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
--   * Hunt photos (Storage bucket "hunt-photos", private): seen like hunts (ground members), added/deleted by their owner.
--   * Admins (11-13, John) see every ground and are treated as a member of each (its stands, marks, everyone's hunts,
--     photos) and can read everyone's shots; they still edit only their own hunts, and only a ground's owner renames,
--     changes members or deletes it.
--   * A sit in progress (user_docs 'active_hunt') can be watched read-only by every approved user, whatever ground it's
--     on (More → Who's hunting), along with the photos on it. Nobody can change someone else's sit.

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
  select public.is_approved() and exists (select 1 from public.grounds g where g.id = gid
    and (g.owner = public.me() or public.me() = any (g.members) or public.is_admin())) $$;
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

-- read by checking the row itself: a brand-new ground isn't in the table yet, and "insert or update" (upsert)
-- must also pass the read rule — is_member(id) looked the ground up and blocked creating grounds (fixed 11-04)
create policy "grounds read"   on public.grounds for select to authenticated
  using (public.is_approved() and (owner = public.me() or public.me() = any (members) or public.is_admin()));
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
create policy "shots admin read" on public.shots  for select to authenticated using (public.is_admin());
create policy "docs own"      on public.user_docs for all to authenticated using (public.is_approved() and owner = public.me()) with check (owner = public.me());
-- "Who's hunting" (11-13, John): any approved user can watch (not change) anyone's sit in progress, on any ground
create policy "docs live sit" on public.user_docs for select to authenticated
  using (name = 'active_hunt' and public.is_approved());
create policy "punch admins"  on public.punchlist for all to authenticated using (public.is_admin()) with check (public.is_admin());

revoke execute on function public.is_member(text), public.is_approved(), public.is_admin(), public.leave_ground(text) from anon;

-- ---------------------------------------------------------------- hunt photos (Storage bucket "hunt-photos", private)
-- Files are <ground id or 'none'>/<owner email>/<photo id>.jpg (+ _t.jpg thumbnail). Like hunts: members of that ground
-- can see them; only their owner (an approved user) adds or deletes them. JPEG only, 5 MB max (the app sends ~300 KB).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('hunt-photos', 'hunt-photos', false, 5242880, array['image/jpeg'])
  on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg'];
drop policy if exists "hunt photos read" on storage.objects;
drop policy if exists "hunt photos add" on storage.objects;
drop policy if exists "hunt photos delete" on storage.objects;
-- also: a photo on someone's sit in progress (listed in their active_hunt doc), for Who's hunting
create or replace function public.on_live_sit(obj text) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_approved() and exists (select 1 from public.user_docs d where d.name = 'active_hunt'
    and d.owner = (storage.foldername(obj))[2]
    and d.data -> 'photos' @> jsonb_build_array(jsonb_build_object('path', regexp_replace(obj, '_t\.jpg$', '.jpg')))) $$;
revoke execute on function public.on_live_sit(text) from anon;
create policy "hunt photos read" on storage.objects for select to authenticated using (
  bucket_id = 'hunt-photos' and (public.is_member((storage.foldername(name))[1])
    or (public.is_approved() and (storage.foldername(name))[2] = public.me())
    or public.on_live_sit(name)));
create policy "hunt photos add" on storage.objects for insert to authenticated with check (
  bucket_id = 'hunt-photos' and public.is_approved() and (storage.foldername(name))[2] = public.me()
  and ((storage.foldername(name))[1] = 'none' or public.is_member((storage.foldername(name))[1])));
create policy "hunt photos delete" on storage.objects for delete to authenticated using (
  bucket_id = 'hunt-photos' and public.is_approved() and (storage.foldername(name))[2] = public.me());
