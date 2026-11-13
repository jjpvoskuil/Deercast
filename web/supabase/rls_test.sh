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
insert into public.grounds (id, name, owner, members) values ('g1', 'Lewis/Klein', 'john@x.com', array['john@x.com', 'matt@x.com']);
insert into storage.objects (bucket_id, name) values ('hunt-photos', 'g1/john@x.com/a.jpg'), ('hunt-photos', 'none/john@x.com/b.jpg'),
  ('hunt-photos', 'g1/matt@x.com/c.jpg'), ('other', 'g1/john@x.com/z.jpg');
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
check "owner sees own photos (ground + none), member's on shared ground" john@x.com "$S" "g1/john@x.com/a.jpg,g1/matt@x.com/c.jpg,none/john@x.com/b.jpg"
check "member sees ground photos, not owner's 'none' ones" matt@x.com "$S" "g1/john@x.com/a.jpg,g1/matt@x.com/c.jpg"
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
exit $FAILED
