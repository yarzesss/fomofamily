-- Fomo Family Office — multichain treasury (Solana + Monad + Robinhood Chain).
-- Paste into Supabase → SQL Editor → Run (safe to re-run).

-- proposals can now target a token on any supported chain
alter table public.proposals add column if not exists chain text not null default 'solana';
alter table public.proposals add column if not exists buy_native_symbol text;   -- 'SOL' | 'MON' | 'ETH' — what buy_sol is denominated in
alter table public.proposals drop constraint if exists proposals_token_mint_check;
alter table public.proposals add constraint proposals_token_mint_check check (char_length(token_mint) between 32 and 44);
create index if not exists proposals_chain_mint_idx on public.proposals (chain, token_mint);
