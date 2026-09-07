// Reads the treasury wallet straight from Solana and prices every position
// through DexScreener. Everything is cached in memory and refreshed in the
// background so the API answers instantly.

import { cfg } from './config.js';
import { chatDb, postSystem } from './chat.js';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEHdkAS6EPFLC1PHnBqCXEpPxuEb';
const STABLES = new Set([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
]);

let rpcId = 0;
export async function rpc(method, params) {
  const res = await fetch(cfg.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  if (!res.ok) throw new Error(`rpc ${method}: HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`rpc ${method}: ${json.error.message}`);
  return json.result;
}

// ---------- prices (DexScreener, no key, 300 req/min) ----------
const priceCache = new Map(); // mint -> { at, data }
const PRICE_TTL = 60_000;

function bestPair(pairs) {
  // Prefer the pool with the deepest liquidity, quoted in SOL/USDC.
  return pairs
    .filter(p => p.chainId === 'solana')
    .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
}

export async function priceMints(mints) {
  const now = Date.now();
  const need = [...new Set(mints)].filter(m => !(priceCache.get(m)?.at > now - PRICE_TTL));
  for (let i = 0; i < need.length; i += 30) {
    const batch = need.slice(i, i + 30);
    try {
      const res = await fetch(`${process.env.PRICE_API_BASE || 'https://api.dexscreener.com'}/tokens/v1/solana/${batch.join(',')}`);
      if (!res.ok) throw new Error(`dexscreener HTTP ${res.status}`);
      const pairs = await res.json();
      const byMint = {};
      for (const p of pairs) (byMint[p.baseToken?.address] ||= []).push(p);
      for (const m of batch) {
        const p = byMint[m] ? bestPair(byMint[m]) : null;
        priceCache.set(m, {
          at: now,
          data: p ? {
            symbol: p.baseToken.symbol,
            name: p.baseToken.name,
            priceUsd: Number(p.priceUsd) || 0,
            change: { m5: p.priceChange?.m5 ?? null, h1: p.priceChange?.h1 ?? null, h6: p.priceChange?.h6 ?? null, h24: p.priceChange?.h24 ?? null },
            volume24: p.volume?.h24 ?? null,
            liquidity: p.liquidity?.usd ?? null,
            pairAddress: p.pairAddress,
            dexId: p.dexId,
            url: p.url,
            image: p.info?.imageUrl || null,
            txns24: p.txns?.h24 || null,
            marketCap: p.marketCap ?? null,
            fdv: p.fdv ?? null,
            pairCreatedAt: p.pairCreatedAt ?? null,
            quoteSymbol: p.quoteToken?.symbol || null,
            socials: p.info?.socials || [],
            websites: p.info?.websites || [],
          } : null,
        });
      }
    } catch (e) {
      console.warn('[price]', e.message);
      for (const m of batch) if (!priceCache.has(m)) priceCache.set(m, { at: now - PRICE_TTL + 10_000, data: null });
    }
  }
  const out = {};
  for (const m of mints) out[m] = priceCache.get(m)?.data || null;
  return out;
}

// ---------- holdings ----------
async function tokenAccounts(owner, programId) {
  const r = await rpc('getTokenAccountsByOwner', [owner, { programId }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  return (r?.value || []).map(a => a.account.data.parsed.info).filter(i => i.tokenAmount?.uiAmount > 0)
    .map(i => ({ mint: i.mint, amount: i.tokenAmount.uiAmount, decimals: i.tokenAmount.decimals, program: programId }));
}

async function readWallet(owner) {
  const [lamports, a1, a2] = await Promise.all([
    rpc('getBalance', [owner, { commitment: 'confirmed' }]).then(r => r.value),
    tokenAccounts(owner, TOKEN_PROGRAM),
    tokenAccounts(owner, TOKEN_2022_PROGRAM).catch(() => []),
  ]);
  // merge duplicate mints (several token accounts for one mint)
  const merged = new Map();
  for (const t of [...a1, ...a2]) {
    const cur = merged.get(t.mint);
    merged.set(t.mint, cur ? { ...cur, amount: cur.amount + t.amount } : t);
  }
  return { sol: lamports / 1e9, tokens: [...merged.values()] };
}

// ---------- snapshot ----------
let snapshot = { ok: false, updatedAt: 0, error: 'not loaded yet', positions: [], totalUsd: 0, solPrice: 0 };
let refreshing = null;

export async function refreshTreasury() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      if (!cfg.treasuryWallet) throw new Error('TREASURY_WALLET not set');
      const wallet = await readWallet(cfg.treasuryWallet);
      const mints = [SOL_MINT, ...wallet.tokens.map(t => t.mint), ...cfg.watchMints];
      const prices = await priceMints(mints);
      const solPrice = prices[SOL_MINT]?.priceUsd || 0;

      const rows = [];
      // native SOL
      rows.push(makeRow({ mint: SOL_MINT, amount: wallet.sol, native: true }, prices[SOL_MINT], solPrice));
      for (const t of wallet.tokens) rows.push(makeRow(t, prices[t.mint], solPrice));
      for (const m of cfg.watchMints) if (!rows.some(r => r.mint === m)) rows.push(makeRow({ mint: m, amount: 0, watch: true }, prices[m], solPrice));

      const positions = rows
        .filter(r => r.watch || r.native || r.valueUsd >= cfg.minPositionUsd)
        .sort((a, b) => b.valueUsd - a.valueUsd)
        .slice(0, cfg.maxPositions);

      const totalUsd = rows.reduce((s, r) => s + r.valueUsd, 0);
      const stableUsd = rows.filter(r => STABLES.has(r.mint)).reduce((s, r) => s + r.valueUsd, 0);
      const totalUsdPrev = rows.reduce((s, r) => s + (r.change24 == null ? r.valueUsd : r.valueUsd / (1 + r.change24 / 100)), 0);
      const invested = Object.values(cfg.costBasis).reduce((s, v) => s + Number(v || 0), 0);

      snapshot = {
        ok: true,
        error: null,
        updatedAt: Date.now(),
        wallet: cfg.treasuryWallet,
        solPrice,
        totalUsd,
        totalSol: solPrice ? totalUsd / solPrice : 0,
        stableUsd,
        change24Usd: totalUsd - totalUsdPrev,
        change24Pct: totalUsdPrev ? ((totalUsd - totalUsdPrev) / totalUsdPrev) * 100 : 0,
        startUsd: cfg.treasuryStartUsd || null,
        investedUsd: invested || null,
        positionCount: rows.filter(r => r.valueUsd >= cfg.minPositionUsd).length,
        positions,
      };
      recordHistory(snapshot);
    } catch (e) {
      console.warn('[treasury]', e.message);
      snapshot = { ...snapshot, ok: snapshot.positions.length > 0, error: e.message, errorAt: Date.now() };
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

function makeRow(t, p, solPrice) {
  const priceUsd = p?.priceUsd || 0;
  const valueUsd = t.amount * priceUsd;
  const cost = cfg.costBasis[t.mint] != null ? Number(cfg.costBasis[t.mint]) : null;
  return {
    mint: t.mint,
    native: Boolean(t.native),
    stable: STABLES.has(t.mint),
    watch: Boolean(t.watch),
    symbol: p?.symbol || (t.native ? 'SOL' : t.mint.slice(0, 4) + '…' + t.mint.slice(-4)),
    name: p?.name || (t.native ? 'Solana' : 'Unknown token'),
    image: p?.image || null,
    amount: t.amount,
    priceUsd,
    valueUsd,
    valueSol: solPrice ? valueUsd / solPrice : 0,
    change5m: p?.change.m5 ?? null,
    change1h: p?.change.h1 ?? null,
    change6h: p?.change.h6 ?? null,
    change24: p?.change.h24 ?? null,
    volume24: p?.volume24 ?? null,
    liquidity: p?.liquidity ?? null,
    txns24: p?.txns24 ?? null,
    marketCap: p?.marketCap ?? null,
    fdv: p?.fdv ?? null,
    pairCreatedAt: p?.pairCreatedAt ?? null,
    quoteSymbol: p?.quoteSymbol || null,
    socials: p?.socials || [],
    websites: p?.websites || [],
    pairAddress: p?.pairAddress || null,
    dexId: p?.dexId || null,
    dexUrl: p?.url || null,
    costUsd: cost,
    pnlUsd: cost != null ? valueUsd - cost : null,
    pnlPct: cost ? ((valueUsd - cost) / cost) * 100 : null,
    priced: Boolean(p),
  };
}

export const getTreasury = () => snapshot;

// ---------- history (net-worth over time) ----------
// In-memory ring buffer always; persisted to Supabase when configured so the
// chart survives restarts and "since launch" is real.
const MEM_POINTS = 4000;
let history = []; // [{ at, totalUsd, solPrice, top: [{symbol, valueUsd}] }]
let historyLoaded = false;
let lastPersist = 0;

async function loadHistory() {
  const db = chatDb();
  if (!db) { historyLoaded = true; return; }
  try {
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    const { data, error } = await db.from('treasury_snapshots').select('at,total_usd,sol_price').gte('at', since).order('at', { ascending: true }).limit(20000);
    if (error) throw error;
    history = (data || []).map(r => ({ at: new Date(r.at).getTime(), totalUsd: r.total_usd, solPrice: r.sol_price }));
    const { data: first } = await db.from('treasury_snapshots').select('at,total_usd').order('at', { ascending: true }).limit(1);
    if (first?.[0]) launch = { at: new Date(first[0].at).getTime(), totalUsd: first[0].total_usd };
  } catch (e) {
    console.warn('[history] load failed:', e.message);
  }
  historyLoaded = true;
}
let launch = null; // first ever snapshot

function recordHistory(snap) {
  const point = { at: snap.updatedAt, totalUsd: snap.totalUsd, solPrice: snap.solPrice };
  history.push(point);
  if (history.length > MEM_POINTS) history.splice(0, history.length - MEM_POINTS);
  if (!launch) launch = { at: point.at, totalUsd: point.totalUsd };
  const db = chatDb();
  if (db && Date.now() - lastPersist > 60_000) {
    lastPersist = Date.now();
    db.from('treasury_snapshots').insert({
      at: new Date(point.at).toISOString(),
      total_usd: point.totalUsd,
      sol_price: point.solPrice,
      positions: snap.positions.slice(0, 12).map(p => ({ s: p.symbol, v: Math.round(p.valueUsd) })),
    }).then(({ error }) => error && console.warn('[history] insert failed:', error.message));
  }
}

// Downsample to at most `n` points over the requested window.
export function getHistory(rangeMs = 86400_000, n = 240) {
  const from = Date.now() - rangeMs;
  const pts = history.filter(p => p.at >= from);
  const step = Math.max(1, Math.ceil(pts.length / n));
  const out = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  return { launch, points: out, loaded: historyLoaded };
}

// ---------- trade alerts → chat ----------
let seenSigs = null; // null until the first activity load (don't alert on old history)
function describeTrade(tx) {
  // Helius gives e.g. "ABC swapped 3.4 SOL for 1,200,000 WIF"
  const d = tx.description || '';
  const m = d.match(/swapped\s+([\d.,]+)\s+(\S+)\s+for\s+([\d.,]+)\s+(\S+)/i);
  if (!m) return null;
  const [, a1, s1, a2, s2] = m;
  const isBuy = /^(SOL|USDC|USDT)$/i.test(s1);
  return isBuy ? `🟢 the fund bought ${a2} ${s2} for ${a1} ${s1}` : `🔴 the fund sold ${a1} ${s1} for ${a2} ${s2}`;
}
function maybeAlert(items) {
  if (!cfg.tradeAlerts) return;
  if (seenSigs === null) { seenSigs = new Set(items.map(i => i.signature)); return; }
  for (const tx of [...items].reverse()) {
    if (seenSigs.has(tx.signature)) continue;
    seenSigs.add(tx.signature);
    if (tx.type !== 'SWAP' || tx.error) continue;
    const text = describeTrade(tx);
    if (text) { postSystem(text); refreshTreasury(); }
  }
  if (seenSigs.size > 500) seenSigs = new Set(items.map(i => i.signature));
}

// ---------- activity (recent transactions) ----------
let activity = { updatedAt: 0, items: [] };
export async function refreshActivity() {
  if (!cfg.treasuryWallet) return;
  try {
    let items = [];
    if (cfg.heliusKey) {
      const res = await fetch(`https://api.helius.xyz/v0/addresses/${cfg.treasuryWallet}/transactions?api-key=${cfg.heliusKey}&limit=30`);
      if (!res.ok) throw new Error(`helius HTTP ${res.status}`);
      const txs = await res.json();
      items = txs.map(tx => ({
        signature: tx.signature,
        time: tx.timestamp * 1000,
        type: tx.type,
        source: tx.source,
        description: tx.description || '',
        fee: tx.fee / 1e9,
        error: tx.transactionError ? 'failed' : null,
      }));
    } else {
      const sigs = await rpc('getSignaturesForAddress', [cfg.treasuryWallet, { limit: 30 }]);
      items = sigs.map(s => ({
        signature: s.signature,
        time: (s.blockTime || 0) * 1000,
        type: s.memo ? 'MEMO' : 'TX',
        source: null,
        description: s.memo || '',
        error: s.err ? 'failed' : null,
      }));
    }
    activity = { updatedAt: Date.now(), items };
    if (cfg.heliusKey) maybeAlert(items);
  } catch (e) {
    console.warn('[activity]', e.message);
  }
}
export const getActivity = () => activity;

// ---------- holder check (optional chat gate) ----------
export async function tokenBalance(owner, mint) {
  const r = await rpc('getTokenAccountsByOwner', [owner, { mint }, { encoding: 'jsonParsed' }]);
  return (r?.value || []).reduce((s, a) => s + (a.account.data.parsed.info.tokenAmount.uiAmount || 0), 0);
}

export function startTreasuryLoop() {
  loadHistory();
  const tick = async () => {
    await refreshTreasury();
    await refreshActivity();
  };
  tick();
  setInterval(tick, cfg.refreshMs);
}

// ---------- OHLCV (GeckoTerminal, free, no key) ----------
const ohlcvCache = new Map(); // key -> { at, data }
const TF = {
  '1m': ['minute', 1], '5m': ['minute', 5], '15m': ['minute', 15],
  '1h': ['hour', 1], '4h': ['hour', 4], '1d': ['day', 1],
};
export async function getOhlcv(pool, tf = '15m') {
  const [unit, agg] = TF[tf] || TF['15m'];
  const key = `${pool}:${unit}:${agg}`;
  const hit = ohlcvCache.get(key);
  const ttl = unit === 'minute' ? 20_000 : 60_000;
  if (hit && hit.at > Date.now() - ttl) return hit.data;
  const res = await fetch(`${process.env.OHLCV_API_BASE || 'https://api.geckoterminal.com'}/api/v2/networks/solana/pools/${pool}/ohlcv/${unit}?aggregate=${agg}&limit=1000&currency=usd`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`geckoterminal HTTP ${res.status}`);
  const json = await res.json();
  const list = (json.data?.attributes?.ohlcv_list || []).map(([t, o, h, l, c, v]) => ({ time: t, open: o, high: h, low: l, close: c, volume: v })).sort((a, b) => a.time - b.time);
  const data = { pool, tf, candles: list, base: json.meta?.base || null, quote: json.meta?.quote || null };
  ohlcvCache.set(key, { at: Date.now(), data });
  if (ohlcvCache.size > 200) ohlcvCache.delete(ohlcvCache.keys().next().value);
  return data;
}
