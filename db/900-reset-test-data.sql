-- Fomo Family Office — wipe the test data before launch.
-- Supabase → SQL Editor → paste → Run. Restart the Railway service afterwards
-- so the server drops its in-memory copies (net-worth history, "since launch",
-- the seen-transactions set) and starts clean.
--
-- Run only the blocks you want. Nothing here touches the schema.

-- 1. Voting: proposals, votes, rounds. Votes and proposals are linked, so they
--    go together; identity counters restart at 1.
truncate table public.votes, public.proposals, public.rounds restart identity cascade;

-- 2. Chat: every message, both the ones people typed and the system ones
--    ("new proposal", "round open", "bought …").
truncate table public.messages restart identity;

--    To keep the system log and drop only what people typed, use this instead
--    of the line above:
-- delete from public.messages where kind = 'user';

-- 3. Net-worth history collected from the test treasury wallet. Clearing it
--    resets the fund chart and makes "since launch" start from the real fund.
truncate table public.treasury_snapshots restart identity;

-- 4. Display names and the member counter (test nicknames). Optional — people
--    just set their name again next time they sign in.
truncate table public.profiles, public.members restart identity;
