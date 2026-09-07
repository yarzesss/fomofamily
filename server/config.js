// All configuration is read at RUNTIME from process.env (Railway "Variables").
// Nothing is baked into the client bundle at build time: the browser fetches
// /api/config on load, so changing a variable + restart is enough. No redeploy.

import crypto from 'node:crypto';

const env = (k, d = '') => (process.env[k] ?? d).toString().trim();

const heliusKey = env('HELIUS_API_KEY');

export const cfg = {
  port: Number(env('PORT', '3000')),

  // ---- public (sent to the browser) ----
  projectName: env('PROJECT_NAME', 'fomo family'),
  tagline: env('TAGLINE', 'where the family never misses out.'),
  treasuryWallet: env('TREASURY_WALLET'),
  tokenMint: env('TOKEN_MINT'),                // the family's own token (optional)
  tokenTicker: env('TOKEN_TICKER', '$FOMO'),
  stonkUrl: env('STONK_URL'),                  // stonk.fun page (optional)
  xUrl: env('X_URL'),
  telegramUrl: env('TELEGRAM_URL'),
  supabaseUrl: env('SUPABASE_URL'),
  supabaseAnonKey: env('SUPABASE_ANON_KEY'),
  chatHoldersOnly: env('CHAT_HOLDERS_ONLY', 'false') === 'true',
  minTokenBalance: Number(env('MIN_TOKEN_BALANCE', '0')),
  treasuryStartUsd: Number(env('TREASURY_START_USD', '0')) || 0,
  // Optional manual cost basis: {"<mint>": <usd invested>} — used for PnL per position.
  costBasis: (() => {
    try { return JSON.parse(env('COST_BASIS_JSON', '{}')); } catch { return {}; }
  })(),
  // Extra mints to always show a chart for (comma separated), even if not held yet.
  watchMints: env('WATCH_MINTS').split(',').map(s => s.trim()).filter(Boolean),
  minPositionUsd: Number(env('MIN_POSITION_USD', '1')),
  announcement: env('ANNOUNCEMENT'),
  adminWallets: env('ADMIN_WALLETS').split(',').map(s => s.trim()).filter(Boolean),
  tradeAlerts: env('TRADE_ALERTS', 'true') !== 'false',
  maxPositions: Number(env('MAX_POSITIONS', '24')),

  // ---- server only ----
  heliusKey,
  rpcUrl: env('RPC_URL') || (heliusKey ? `https://mainnet.helius-rpc.com/?api-key=${heliusKey}` : 'https://api.mainnet-beta.solana.com'),
  supabaseServiceKey: env('SUPABASE_SERVICE_ROLE_KEY'),
  sessionSecret: env('SESSION_SECRET') || crypto.randomBytes(32).toString('hex'),
  refreshMs: Number(env('TREASURY_REFRESH_SECONDS', '45')) * 1000,
};

if (!process.env.SESSION_SECRET) {
  console.warn('[cfg] SESSION_SECRET not set — using a random one; chat sessions reset on every restart.');
}
if (!cfg.treasuryWallet) console.warn('[cfg] TREASURY_WALLET not set — portfolio will be empty.');
if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) console.warn('[cfg] SUPABASE_URL / SUPABASE_ANON_KEY not set — chat disabled.');
if (!cfg.supabaseServiceKey) console.warn('[cfg] SUPABASE_SERVICE_ROLE_KEY not set — posting to chat disabled.');

export const publicConfig = () => ({
  projectName: cfg.projectName,
  tagline: cfg.tagline,
  treasuryWallet: cfg.treasuryWallet,
  tokenMint: cfg.tokenMint,
  tokenTicker: cfg.tokenTicker,
  stonkUrl: cfg.stonkUrl,
  xUrl: cfg.xUrl,
  telegramUrl: cfg.telegramUrl,
  supabaseUrl: cfg.supabaseUrl,
  supabaseAnonKey: cfg.supabaseAnonKey,
  chatEnabled: Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey),
  chatPostEnabled: Boolean(cfg.supabaseUrl && cfg.supabaseServiceKey),
  chatHoldersOnly: cfg.chatHoldersOnly && Boolean(cfg.tokenMint),
  treasuryStartUsd: cfg.treasuryStartUsd,
  refreshMs: cfg.refreshMs,
  announcement: cfg.announcement,
  adminWallets: cfg.adminWallets,
});
