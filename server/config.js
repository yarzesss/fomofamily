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
  // 'fomo family' was the old default — treat it as unset so the rebrand shows
  // up without having to edit the Railway variable.
  projectName: (v => (/^fomo\s*family$/i.test(v) ? 'Fomo Family Office' : v))(env('PROJECT_NAME', 'Fomo Family Office')),
  tagline: env('TAGLINE', 'where the family never misses out.'),
  // one or many treasury addresses: TREASURY_WALLETS="solana:ADDR,monad:0x..,robinhood:0x.." (TREASURY_WALLET = solana only, still works)
  treasuryWallets: parseWallets(env('TREASURY_WALLETS'), env('TREASURY_WALLET')),
  treasuryWallet: '', // filled below: the Solana treasury address ('' when none)
  // ---- the family token ----
  // Set TOKEN_MINT once the token is live: the whole site switches on (token
  // card + chart, family = top holders, voting rounds, holders-only chat).
  tokenMint: env('TOKEN_MINT'),
  tokenChain: (env('TOKEN_CHAIN', 'solana') || 'solana').toLowerCase(),
  tokenTicker: env('TOKEN_TICKER', '$FOMO'),
  tokenLaunchNote: env('TOKEN_LAUNCH_NOTE', 'Not launched yet. Follow X for the moment it goes live.'),
  stonkUrl: env('STONK_URL'),                  // stonk.fun / launchpad page (optional)
  xUrl: env('X_URL', 'https://x.com/FomoFamOffice'),
  fomoUrl: env('FOMO_URL', 'https://fomo.family/profile/FamOffice'),
  telegramUrl: env('TELEGRAM_URL'),
  privyAppId: env('PRIVY_APP_ID'),
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
// TOKEN_CHAIN must match the shape of TOKEN_MINT. A base58 mint with
// TOKEN_CHAIN=robinhood (or the reverse) would silently kill the token card,
// its chart and the family, so we correct it here and say so in the log.
if (cfg.tokenMint && !chainOf(cfg.tokenChain)?.isAddress(cfg.tokenMint)) {
  const guess = Object.values(CHAINS).find(c => c.isAddress(cfg.tokenMint));
  if (guess) {
    console.warn(`[cfg] TOKEN_MINT looks like a ${guess.name} address but TOKEN_CHAIN="${cfg.tokenChain}" — using ${guess.id}. Fix TOKEN_CHAIN to silence this.`);
    cfg.tokenChain = guess.id;
  } else {
    console.warn(`[cfg] TOKEN_MINT is not a valid address for any supported chain — the token stays off.`);
    cfg.tokenMint = '';
  }
}
// EVM addresses are stored lowercase everywhere so nothing depends on casing
if (cfg.tokenMint && chainOf(cfg.tokenChain)?.kind === 'evm') cfg.tokenMint = cfg.tokenMint.toLowerCase();
cfg.treasuryWallet = cfg.treasuryWallets.find(w => w.chain === 'solana')?.address || '';
// Tokens that are always priced and charted even when the treasury holds none —
// the family token first, then anything in WATCH_MINTS.
cfg.watchTokens = [
  ...(cfg.tokenMint ? [{ chain: cfg.tokenChain, address: cfg.tokenMint, familyToken: true }] : []),
  ...cfg.watchMints.map(a => ({ chain: 'solana', address: a, familyToken: false })),
].filter((t, i, a) => a.findIndex(x => x.address === t.address) === i);
if (cfg.tokenMint) console.log(`[cfg] family token ${cfg.tokenTicker} on ${cfg.tokenChain}: ${cfg.tokenMint}`);
else console.log('[cfg] TOKEN_MINT not set — pre-launch mode (no family gate, no rounds).');
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
  privyAppId: cfg.privyAppId,
  tokenChain: cfg.tokenChain,
  tokenChainInfo: (c => c && c.kind === 'evm' ? { id: c.id, name: c.name, chainId: c.chainId, native: c.native.symbol, rpc: c.rpc, explorerBase: c.explorer.account('').replace(/\/address\/$/, '') } : null)(chainOf(cfg.tokenChain)),
  tokenTicker: cfg.tokenTicker,
  tokenLive: Boolean(cfg.tokenMint),
  tokenLaunchNote: cfg.tokenLaunchNote,
  stonkUrl: cfg.stonkUrl,
  xUrl: cfg.xUrl,
  fomoUrl: cfg.fomoUrl,
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
