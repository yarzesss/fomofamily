-- fomo family — schema. Paste this whole file into Supabase → SQL Editor → Run.
-- Safe to re-run: every statement is idempotent.
-- Design: the browser can only READ (anon key). All writes go through the server
-- with the service-role key, after the wallet has proven ownership by signature.

-- ---------- chat ----------
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  wallet_address text not null check (char_length(wallet_address) between 32 and 44),
  body text not null check (char_length(body) between 1 and 220),
  kind text not null default 'user' check (kind in ('user', 'system')),
  created_at timestamptz not null default now()
);
alter table public.messages add column if not exists kind text not null default 'user';
create index if not exists messages_created_at_idx on public.messages (created_at desc);
alter table public.messages replica identity full; -- so realtime DELETE events carry the id

create table if not exists public.profiles (
  wallet_address text primary key check (char_length(wallet_address) between 32 and 44),
  display_name text not null check (display_name ~ '^[A-Za-z0-9_.]{2,20}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists profiles_name_lower_idx on public.profiles (lower(display_name));

-- every wallet that ever signed in (for the "members" counter)
create table if not exists public.members (
  wallet_address text primary key,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

-- ---------- treasury history (written by the server every refresh) ----------
create table if not exists public.treasury_snapshots (
  at timestamptz primary key default now(),
  total_usd double precision not null,
  sol_price double precision,
  positions jsonb
);

-- ---------- Row Level Security: anon = read only on chat tables, nothing else ----------
alter table public.messages enable row level security;
alter table public.profiles enable row level security;
alter table public.members enable row level security;
alter table public.treasury_snapshots enable row level security;

drop policy if exists "messages: public read" on public.messages;
create policy "messages: public read" on public.messages for select to anon, authenticated using (true);

drop policy if exists "profiles: public read" on public.profiles;
create policy "profiles: public read" on public.profiles for select to anon, authenticated using (true);
-- members / treasury_snapshots: no anon policies at all → only the service role can touch them.

-- ---------- Realtime ----------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'profiles') then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;
