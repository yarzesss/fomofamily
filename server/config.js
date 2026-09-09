// All configuration is read at RUNTIME from process.env (Railway "Variables").
// Nothing is baked into the client bundle at build time: the browser fetches
// /api/config on load, so changing a variable + restart is enough. No redeploy.

import crypto from 'node:crypto';
import { parseWallets, chainOf, publicChain, CHAINS } from './chains.js';

const env = (k, d = '') => (process.env[k] ?? d).toString().trim();

const heliusKey = env('HELIUS_API_KEY');

export const cfg = {
  port: Number(env('PORT', '3000')),

  // ---- public (sent to the browser) ----
  projectName: env('PROJECT_NAME', 'Fomo Family Office'),
  tagline: env('TAGLINE', 'where the family never misses out.'),
  // one or many treasury addresses: TREASURY_WALLETS="solana:ADDR,monad:0x..,robinhood:0x.." (TREASURY_WALLET = solana only, still works)
  treasuryWallets: parseWallets(env('TREASURY_WALLETS'), env('TREASURY_WALLET')),
  treasuryWallet: '', // filled below: the Solana treasury address ('' when none)
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
  // ---- family / voting ----
  familyMinPct: Number(env('FAMILY_MIN_PCT', '0')),          // % of supply to be in the family (0 = any holder in the top-N)
  familyMax: Number(env('FAMILY_MAX', '20')),                 // top-N holders
  familyExclude: env('FAMILY_EXCLUDE').split(',').map(s => s.trim()).filter(Boolean), // pools/LP/team wallets to ignore
  launchAt: env('LAUNCH_AT') ? Date.parse(env('LAUNCH_AT')) : null, // ISO time; default = pair creation time of TOKEN_MINT
  voteFirstDelayMs: Number(env('VOTE_FIRST_DELAY_MIN', '20')) * 60_000,
  voteFirstDurationMs: Number(env('VOTE_FIRST_DURATION_MIN', '20')) * 60_000,
  voteIntervalMs: Number(env('VOTE_INTERVAL_MIN', '120')) * 60_000,
  votePassRatio: Number(env('VOTE_PASS_PCT', '75')) / 100,
  voteMinVotes: Number(env('VOTE_MIN_VOTES', '5')),
  voteMaxPct: Number(env('VOTE_MAX_TREASURY_PCT', '5')),
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
cfg.treasuryWallet = cfg.treasuryWallets.find(w => w.chain === 'solana')?.address || '';
cfg.chains = [...new Set(cfg.treasuryWallets.map(w => w.chain))].map(id => chainOf(id));
if (!cfg.treasuryWallets.length) console.warn('[cfg] TREASURY_WALLETS / TREASURY_WALLET not set — portfolio will be empty.');
else console.log('[cfg] treasury:', cfg.treasuryWallets.map(w => `${w.chain}:${w.address}`).join(', '));
if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) console.warn('[cfg] SUPABASE_URL / SUPABASE_ANON_KEY not set — chat disabled.');
if (!cfg.supabaseServiceKey) console.warn('[cfg] SUPABASE_SERVICE_ROLE_KEY not set — posting to chat disabled.');

export const publicConfig = () => ({
  projectName: cfg.projectName,
  tagline: cfg.tagline,
  treasuryWallet: cfg.treasuryWallet,
  wallets: cfg.treasuryWallets.map(w => ({ ...w, explorerUrl: chainOf(w.chain).explorer.account(w.address) })),
  chains: (cfg.chains.length ? cfg.chains : [CHAINS.solana]).map(publicChain),
  tokenMint: cfg.tokenMint,
  tokenTicker: cfg.tokenTicker,
  stonkUrl: cfg.stonkUrl,
  xUrl: cfg.xUrl,
  telegramUrl: cfg.telegramUrl,
  chatEnabled: Boolean(cfg.supabaseUrl && cfg.supabaseServiceKey),
  chatPostEnabled: Boolean(cfg.supabaseUrl && cfg.supabaseServiceKey),
  chatHoldersOnly: cfg.chatHoldersOnly && Boolean(cfg.tokenMint),
  treasuryStartUsd: cfg.treasuryStartUsd,
  refreshMs: cfg.refreshMs,
  announcement: cfg.announcement,
  adminWallets: cfg.adminWallets,
  family: { minPct: cfg.familyMinPct, max: cfg.familyMax, passPct: cfg.votePassRatio * 100, minVotes: cfg.voteMinVotes, maxTreasuryPct: cfg.voteMaxPct, firstDelayMin: cfg.voteFirstDelayMs / 60000, intervalMin: cfg.voteIntervalMs / 60000 },
});
