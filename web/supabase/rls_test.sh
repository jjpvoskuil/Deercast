#!/usr/bin/env bash
# Check schema.sql's row-level security on a throwaway local PostgreSQL 16 (sandbox), with stand-ins for Supabase's
# auth.jwt() and storage schema. Usage: bash web/supabase/rls_test.sh   (prints PASS/FAIL per check)
set -euo pipefail
PG=/usr/lib/postgresql/16/bin
DIR=$(mktemp -d); chown postgres "$DIR"
HERE=$(cd "$(dirname "$0")" && pwd)
su postgres -c "$PG/initdb -D $DIR/db -A trust >/dev/null && $PG/pg_ctl -D $DIR/db -o '-p 54329 -k $DIR' -l $DIR/log start >/dev/null"
trap 'su postgres -c "$PG/pg_ctl -D $DIR/db stop -m fast >/dev/null"; rm -rf "$DIR"' EXIT
sleep 1
P="$PG/psql -h $DIR -p 54329 -U postgres -v ON_ERROR_STOP=1 -q"
su postgres -c "$P" <<'SQL'
create role anon; create role authenticated;
create schema auth; create schema storage;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('test.jwt', true), ''), '{}')::jsonb $$;
grant usage on schema auth, storage to authenticated, anon;
grant execute on function auth.jwt() to authenticated, anon;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id serial primary key, bucket_id text, name text);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
grant usage on sequence storage.objects_id_seq to authenticated;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant execute on function storage.foldername(text) to authenticated;
SQL
su postgres -c "$P -f $HERE/schema.sql" >/dev/null
su postgres -c "$P -f $HERE/schema.sql" >/dev/null   # re-runnable
su postgres -c "$P" <<'SQL'
insert into public.app_users values ('john@x.com', 'John', 'admin'), ('matt@x.com', 'Matt', 'member'), ('eve@x.com', 'Eve', 'member');
insert into public.grounds (id, name, owner, members) values ('g1', 'Lewis/Klein', 'john@x.com', array['john@x.com', 'matt@x.com']),
  ('g2', 'Luke''s farm', 'matt@x.com', '{}');
insert into public.stands values ('g2:s1', 'g2', '{}');
insert into public.hunts values ('matt@x.com:h1', 'g2', 'matt@x.com', '{}'), ('john@x.com:h2', 'g1', 'john@x.com', '{}');
insert into public.shots values ('matt@x.com:x1', 'g2', 'matt@x.com', '{}');
insert into public.user_docs values ('matt@x.com', 'active_hunt', '{"ground_id": "g1"}'), ('matt@x.com', 'gear', '{}'),
  ('eve@x.com', 'active_hunt', '{"ground_id": "g9"}');
insert into storage.objects (bucket_id, name) values ('hunt-photos', 'g1/john@x.com/a.jpg'), ('hunt-photos', 'none/john@x.com/b.jpg'),
  ('hunt-photos', 'g1/matt@x.com/c.jpg'), ('hunt-photos', 'g2/matt@x.com/m.jpg'), ('other', 'g1/john@x.com/z.jpg');
SQL
check() { # name, email, sql, expected
  local got
  got=$(su postgres -c "$P -tA" <<SQL 2>&1 | tail -1
set role authenticated; set test.jwt = '{"email": "$2"}';
$3
SQL
) || true
  if [[ "$got" == "$4" ]]; then echo "PASS  $1"; else echo "FAIL  $1 — got '$got', expected '$4'"; FAILED=1; fi
}
FAILED=0
S="select string_agg(name, ',' order by name) from storage.objects;"
check "admin sees own photos (ground + none), member's on shared ground, other grounds'" john@x.com "$S" "g1/john@x.com/a.jpg,g1/matt@x.com/c.jpg,g2/matt@x.com/m.jpg,none/john@x.com/b.jpg"
check "member sees ground photos, not owner's 'none' ones" matt@x.com "$S" "g1/john@x.com/a.jpg,g1/matt@x.com/c.jpg,g2/matt@x.com/m.jpg"
check "approved non-member sees nothing" eve@x.com "$S" ""
check "unapproved sees nothing" stranger@x.com "$S" ""
check "add own photo on own ground" matt@x.com "insert into storage.objects (bucket_id, name) values ('hunt-photos', 'g1/matt@x.com/d.jpg'); select 'ok';" "ok"
check "add own photo, no ground" eve@x.com "insert into storage.objects (bucket_id, name) values ('hunt-photos', 'none/eve@x.com/e.jpg'); select 'ok';" "ok"
check "can't add as someone else" matt@x.com "insert into storage.objects (bucket_id, name) values ('hunt-photos', 'g1/john@x.com/f.jpg'); select 'ok';" 'ERROR:  new row violates row-level security policy for table "objects"'
check "can't add to a ground you're not on" eve@x.com "insert into storage.objects (bucket_id, name) values ('hunt-photos', 'g1/eve@x.com/g.jpg'); select 'ok';" 'ERROR:  new row violates row-level security policy for table "objects"'
check "unapproved can't add" stranger@x.com "insert into storage.objects (bucket_id, name) values ('hunt-photos', 'none/stranger@x.com/h.jpg'); select 'ok';" 'ERROR:  new row violates row-level security policy for table "objects"'
check "member can't delete owner's photo" matt@x.com "delete from storage.objects where name = 'g1/john@x.com/a.jpg'; select count(*) from storage.objects where name = 'g1/john@x.com/a.jpg';" "1"
check "owner deletes own photo" john@x.com "delete from storage.objects where name = 'g1/john@x.com/a.jpg'; select count(*) from storage.objects where name = 'g1/john@x.com/a.jpg';" "0"
check "bucket is private, JPEG only" john@x.com "reset role; select public::text || ',' || array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'hunt-photos';" "false,image/jpeg"
G="select string_agg(id, ',' order by id) from public.grounds;"
check "admin sees every ground" john@x.com "$G" "g1,g2"
check "member sees only own grounds" matt@x.com "$G" "g1,g2"
check "non-member sees no grounds" eve@x.com "$G" ""
check "admin sees another ground's stands" john@x.com "select count(*) from public.stands where ground_id = 'g2';" "1"
check "non-member can't see stands" eve@x.com "select count(*) from public.stands where ground_id = 'g2';" "0"
check "admin sees everyone's hunts" john@x.com "select string_agg(id, ',' order by id) from public.hunts;" "john@x.com:h2,matt@x.com:h1"
check "member sees only hunts on their grounds" eve@x.com "select count(*) from public.hunts;" "0"
check "admin reads others' shots" john@x.com "select count(*) from public.shots;" "1"
check "member can't read others' shots" eve@x.com "select count(*) from public.shots;" "0"
check "admin can't edit someone else's hunt" john@x.com "update public.hunts set data = '{\"x\":1}' where id = 'matt@x.com:h1'; reset role; select data::text from public.hunts where id = 'matt@x.com:h1';" "{}"
check "admin can't change someone else's shot" john@x.com "delete from public.shots; reset role; select count(*) from public.shots;" "1"
check "admin can't rename someone else's ground" john@x.com "update public.grounds set name = 'x' where id = 'g2'; reset role; select name from public.grounds where id = 'g2';" "Luke's farm"
check "admin can log own hunt on another ground" john@x.com "insert into public.hunts values ('john@x.com:h3', 'g2', 'john@x.com', '{}'); select 'ok';" "ok"
L="select string_agg(owner || '/' || name, ',' order by owner, name) from public.user_docs;"
check "member sees a ground-mate's live sit, not their gear" john@x.com "$L" "matt@x.com/active_hunt"
check "live sit on a ground you're not on stays private" eve@x.com "$L" "eve@x.com/active_hunt"
check "can't change someone's live sit" john@x.com "update public.user_docs set data = '{}' where owner = 'matt@x.com'; reset role; select data ->> 'ground_id' from public.user_docs where owner = 'matt@x.com' and name = 'active_hunt';" "g1"
exit $FAILED
