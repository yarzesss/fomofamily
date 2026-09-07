# fomo family

Live treasury site: charts of every coin the family bought (centre), wallet-verified chat with automatic trade alerts (left), portfolio straight from chain with net-worth history and allocation ring (right). fomo-style intro, ticker, toasts and live counters.

## Stack

Vite + React (no TypeScript) · Express server · Solana wallet-adapter (Phantom, Solflare + any Wallet-Standard wallet) · Supabase (chat + realtime) · DexScreener (prices + embedded charts) · Solana RPC / Helius (balances, activity).

**Everything is configured at runtime** from environment variables. Change a variable in Railway → the service restarts → done. No rebuild needed.

## 1. Supabase (5 min)

1. Create a project at supabase.com.
2. SQL Editor → paste `db/001-schema.sql` → Run. Then paste `db/002-family.sql` → Run.
3. Project Settings → API: copy **Project URL**, **anon public** key, **service_role** key.

Security model: the browser only *reads* with the anon key (RLS blocks writes). Posting goes through the server, which first checks an ed25519 signature from the wallet. Nobody can post as a wallet they don't control, and nobody can rename other people.

## 2. Railway (5 min)

1. New project → Deploy from GitHub repo (this repo). Railway detects Node, runs `npm ci && npm run build`, starts `npm start`.
2. Variables → add:

| Variable | Required | What |
| --- | --- | --- |
| `TREASURY_WALLET` | yes | Solana address of the treasury. Test: `GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE` |
| `HELIUS_API_KEY` | recommended | Free key from dev.helius.xyz. Without it the public RPC is used (rate-limited, may fail on big wallets) and "recent moves" is plain signatures instead of parsed swaps. |
| `SUPABASE_URL` | for chat | Project URL |
| `SUPABASE_ANON_KEY` | for chat | anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | for chat | service_role key (server only, never sent to the browser) |
| `SESSION_SECRET` | recommended | any long random string; otherwise chat sign-ins reset on every restart |
| `PROJECT_NAME`, `TAGLINE` | no | branding (`fomo family`, `where the family never misses out.`) |
| `TOKEN_MINT`, `TOKEN_TICKER` | no | the family token — shows the CA with copy button |
| `STONK_URL` | no | "buy on stonk.fun" button |
| `X_URL`, `TELEGRAM_URL` | no | header links |
| `TREASURY_START_USD` | no | starting capital → shows "since start" PnL |
| `COST_BASIS_JSON` | no | `{"<mint>": usd_invested}` → per-position PnL |
| `WATCH_MINTS` | no | comma-separated mints to always chart, even before buying |
| `ANNOUNCEMENT` | no | pinned message at the top of the chat |
| `ADMIN_WALLETS` | no | comma-separated wallets allowed to delete messages |
| `TRADE_ALERTS` | no | `true` (default): when the treasury swaps, post "🟢 the fund bought …" into the chat + toast (needs Helius) |
| `CHAT_HOLDERS_ONLY`, `MIN_TOKEN_BALANCE` | no | `true` = only holders of `TOKEN_MINT` can chat |
| `MIN_POSITION_USD`, `MAX_POSITIONS`, `TREASURY_REFRESH_SECONDS` | no | dust filter (default $1), list cap (24), refresh (45s) |
| `RPC_URL` | no | any custom Solana RPC (overrides Helius) |
| `FAMILY_MIN_PCT`, `FAMILY_MAX` | no | family = top `FAMILY_MAX` (15) holders with ≥ `FAMILY_MIN_PCT` (1%) of `TOKEN_MINT` supply; only they see chat, propose and vote |
| `FAMILY_EXCLUDE` | no | pool/LP/team wallets to ignore in the holder ranking |
| `LAUNCH_AT` | no | ISO launch time; default = pair creation of `TOKEN_MINT`. Round 1 opens `VOTE_FIRST_DELAY_MIN` (20) after launch for `VOTE_FIRST_DURATION_MIN` (20); then every `VOTE_INTERVAL_MIN` (120). Pass = ≥ `VOTE_PASS_PCT` (75) yes of votes cast, min `VOTE_MIN_VOTES` (5). Rounds close early when everyone voted. |

3. Settings → Networking → Generate domain. Open it.

## Design parity with fomo.family

Layout, colours, radii, type sizes and component styles mirror fomo's web app 1:1 (tokens in `src/styles.css`). The chart is a TradingView `lightweight-charts` candlestick panel fed by GeckoTerminal OHLCV (`/api/ohlcv`), styled like theirs.

**Font:** fomo uses *Aeonik* (commercial, CoType Foundry). If you own a licence, put `Aeonik-Regular.woff2`, `Aeonik-Medium.woff2`, `Aeonik-Bold.woff2` into `public/fonts/` — they load automatically. Without them the site falls back to Manrope.

## Local dev

```
npm install
cp .env.example .env   # fill in
npm run dev            # server :3000 + vite :5173 (proxying /api)
```

## API

`GET /api/config` public runtime config · `GET /api/treasury` positions, totals, 24h · `GET /api/activity` recent txs · `GET /api/ohlcv?pool=<pair>&tf=1m|5m|15m|1h|4h|1d` candles · `GET /api/history?range=1h|24h|7d|30d` net-worth snapshots · `GET /api/stats` members · `POST /api/auth/nonce` `POST /api/auth/verify` wallet sign-in · `POST /api/chat` `DELETE /api/chat/:id` (admins) `POST /api/profile` (Bearer token) · `GET /api/health`.

## Files

```
server/index.js      express, routes, static
server/config.js     env → config (runtime)
server/treasury.js   RPC balances, DexScreener prices, activity, history snapshots, trade alerts
server/auth.js       nonce, signature check, session tokens
server/chat.js       supabase writes (service role), validation, rate limit
src/App.jsx          layout, providers, polling
src/components/      Intro, Sky, Header, Ticker, Chat, Charts, Portfolio, NetWorthChart, AllocationRing, Toasts, Img
src/lib/             api, hooks (poll / count-up / flash), format, session
db/001-schema.sql    tables + RLS + realtime
```
