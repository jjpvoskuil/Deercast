-- Deercast storage. Run once in Supabase → SQL Editor.
create table if not exists public.deercast_kv (
  name        text primary key,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

create or replace function public.deercast_touch() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

drop trigger if exists deercast_kv_touch on public.deercast_kv;
create trigger deercast_kv_touch before insert or update on public.deercast_kv
  for each row execute function public.deercast_touch();

-- Lock it down: RLS on, no policies → public/anon key gets nothing.
-- The app uses the server-side secret key (in Streamlit secrets), which bypasses RLS.
alter table public.deercast_kv enable row level security;
