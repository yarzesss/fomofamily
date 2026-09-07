-- fomo family — voting / family upgrade. Paste into Supabase → SQL Editor → Run (safe to re-run).
-- After this file the browser never talks to Supabase directly: all reads go through the server,
-- which checks family membership first. So anon read policies are removed.

create table if not exists public.rounds (
  id bigint generated always as identity primary key,
  number int not null unique,
  opens_at timestamptz not null,
  closes_at timestamptz not null,          -- scheduled close
  closed_at timestamptz,                   -- actual close (early close when everyone voted)
  eligible int not null default 0,         -- family size at open
  created_at timestamptz not null default now()
);

create table if not exists public.proposals (
  id bigint generated always as identity primary key,
  round_id bigint references public.rounds(id),
  created_by text not null,
  token_mint text not null check (char_length(token_mint) between 32 and 44),
  symbol text,
  name text,
  image text,
  pair_address text,
  thesis text not null check (char_length(thesis) between 1 and 500),
  treasury_pct numeric not null check (treasury_pct >= 0.5 and treasury_pct <= 25),
  status text not null default 'open' check (status in ('open', 'passed', 'rejected', 'bought')),
  yes int not null default 0,
  no int not null default 0,
  decided_at timestamptz,
  -- filled in automatically when the treasury buys after a pass
  buy_tx text,
  buy_amount double precision,
  buy_sol double precision,
  buy_usd double precision,
  buy_price double precision,
  bought_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists proposals_round_idx on public.proposals (round_id);
create index if not exists proposals_status_idx on public.proposals (status);

create table if not exists public.votes (
  id bigint generated always as identity primary key,
  proposal_id bigint not null references public.proposals(id) on delete cascade,
  wallet_address text not null,
  choice text not null check (choice in ('yes', 'no')),
  created_at timestamptz not null default now(),
  unique (proposal_id, wallet_address)
);

alter table public.rounds enable row level security;
alter table public.proposals enable row level security;
alter table public.votes enable row level security;

-- lock the chat tables down to the service role only (server-gated reads)
drop policy if exists "messages: public read" on public.messages;
drop policy if exists "profiles: public read" on public.profiles;
