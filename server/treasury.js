// Reads the treasury wallet straight from Solana and prices every position
// through DexScreener. Everything is cached in memory and refreshed in the
// background so the API answers instantly.

import { cfg } from './config.js';
import { chatDb, postSystem } from './chat.js';
import { CHAINS, chainOf, SOL_MINT } from './chains.js';
import { readEvmWallet, evmActivity } from './evm.js';

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

// ---------- prices (DexScreener, no key, 300 req/min; GeckoTerminal as fallback) ----------
const priceCache = new Map(); // "chain:address" -> { at, data }
const PRICE_TTL = 60_000;
const pkey = (chain, addr) => `${chain}:${chain === 'solana' ? addr : addr.toLowerCase()}`;
// DexScreener chain id for a chain we know, or the chain string itself (e.g. 'ethereum' for WETH price ref)
const dexId = chain => chainOf(chain)?.dex || chain;
const geckoId = chain => chainOf(chain)?.gecko || chain;

function bestPair(pairs, chain) {
  // Prefer the pool with the deepest liquidity on the right chain.
  return pairs
    .filter(p => p.chainId === dexId(chain))
    .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
}

// GeckoTerminal token lookup — used when DexScreener does not index the chain yet.
async function geckoPrice(chain, addr) {
  const res = await fetch(`${process.env.OHLCV_API_BASE || 'https://api.geckoterminal.com'}/api/v2/networks/${geckoId(chain)}/tokens/${addr}?include=top_pools`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`geckoterminal token HTTP ${res.status}`);
  const json = await res.json();
  const a = json.data?.attributes; if (!a) return null;
  const pool = (json.included || []).find(x => x.type === 'pool');
  const pa = pool?.attributes || {};
  const poolAddr = pool?.id ? pool.id.split('_').slice(1).join('_') : null;
  return {
    symbol: a.symbol, name: a.name, priceUsd: Number(a.price_usd) || 0,
    change: { m5: pa.price_change_percentage?.m5 != null ? Number(pa.price_change_percentage.m5) : null, h1: pa.price_change_percentage?.h1 != null ? Number(pa.price_change_percentage.h1) : null, h6: pa.price_change_percentage?.h6 != null ? Number(pa.price_change_percentage.h6) : null, h24: pa.price_change_percentage?.h24 != null ? Number(pa.price_change_percentage.h24) : null },
    volume24: a.volume_usd?.h24 != null ? Number(a.volume_usd.h24) : null, liquidity: pa.reserve_in_usd != null ? Number(pa.reserve_in_usd) : null,
    pairAddress: poolAddr, dexId: pool?.relationships?.dex?.data?.id || null, url: poolAddr ? `https://www.geckoterminal.com/${geckoId(chain)}/pools/${poolAddr}` : null,
    image: a.image_url && !/missing/.test(a.image_url) ? a.image_url : null,
    txns24: pa.transactions?.h24 ? { buys: pa.transactions.h24.buys, sells: pa.transactions.h24.sells } : null,
    marketCap: a.market_cap_usd != null ? Number(a.market_cap_usd) : null, fdv: a.fdv_usd != null ? Number(a.fdv_usd) : null,
    pairCreatedAt: pa.pool_created_at ? Date.parse(pa.pool_created_at) : null, quoteSymbol: null, socials: [], websites: [],
  };
}

// tokens: [{ chain, address }] → { "chain:address": data|null }
export async function priceTokens(tokens) {
  const now = Date.now();
  const byChain = new Map();
  for (const t of tokens) {
    const k = pkey(t.chain, t.address);
    if (priceCache.get(k)?.at > now - PRICE_TTL) continue;
    (byChain.get(t.chain) || byChain.set(t.chain, new Set()).get(t.chain)).add(t.address);
  }
  for (const [chain, set] of byChain) {
    const need = [...set];
    for (let i = 0; i < need.length; i += 30) {
      const batch = need.slice(i, i + 30);
      try {
        const res = await fetch(`${process.env.PRICE_API_BASE || 'https://api.dexscreener.com'}/tokens/v1/${dexId(chain)}/${batch.join(',')}`);
        if (!res.ok) throw new Error(`dexscreener ${dexId(chain)} HTTP ${res.status}`);
        const pairs = await res.json();
        const byMint = {};
        for (const p of Array.isArray(pairs) ? pairs : []) (byMint[chain === 'solana' ? p.baseToken?.address : p.baseToken?.address?.toLowerCase()] ||= []).push(p);
        for (const m of batch) {
          const p = byMint[chain === 'solana' ? m : m.toLowerCase()] ? bestPair(byMint[chain === 'solana' ? m : m.toLowerCase()], chain) : null;
          if (!p) {
            // not on DexScreener (yet) → try GeckoTerminal
            let g = null;
            try { g = await geckoPrice(chain, m); } catch (e) { console.warn('[price:gecko]', chain, e.message); }
            priceCache.set(pkey(chain, m), { at: g ? now : now - PRICE_TTL + 20_000, data: g });
            continue;
          }
          priceCache.set(pkey(chain, m), {
            at: now,
            data: {
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
          },
          });
        }
      } catch (e) {
        console.warn('[price]', e.message);
        for (const m of batch) if (!priceCache.has(pkey(chain, m))) priceCache.set(pkey(chain, m), { at: now - PRICE_TTL + 10_000, data: null });
      }
    }
  }
  const out = {};
  for (const t of tokens) out[pkey(t.chain, t.address)] = priceCache.get(pkey(t.chain, t.address))?.data || null;
  return out;
}
// Solana-only convenience (family.js etc.)
export async function priceMints(mints) {
  const r = await priceTokens(mints.map(m => ({ chain: 'solana', address: m })));
  const out = {}; for (const m of mints) out[m] = r[pkey('solana', m)] || null; return out;
}
export const priceOf = (chain, addr) => priceCache.get(pkey(chain, addr))?.data || null;

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
let snapshot = { ok: false, updatedAt: 0, error: 'not loaded yet', positions: [], totalUsd: 0, solPrice: 0, nativePrices: {}, wallets: [] };
let refreshing = null;

// read one treasury address → { native, tokens:[{mint, amount, decimals, symbol?, name?}] }
async function readAny(w) {
  if (w.chain === 'solana') { const r = await readWallet(w.address); return { native: r.sol, tokens: r.tokens }; }
  return readEvmWallet(w.chain, w.address);
}

// Last good read per address. Public RPCs hiccup (429, timeouts); when that
// happens we keep showing the previous balances marked `stale` instead of
// dropping a whole chain out of the fund.
const lastGood = new Map(); // "chain:address" -> { at, data }

export async function refreshTreasury() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      if (!cfg.treasuryWallets.length) throw new Error('TREASURY_WALLETS not set');
      const results = await Promise.allSettled(cfg.treasuryWallets.map(readAny));
      const wallets = cfg.treasuryWallets.map((w, i) => {
        const k = `${w.chain}:${w.address}`;
        if (results[i].status === 'fulfilled') { lastGood.set(k, { at: Date.now(), data: results[i].value }); return { ...w, ok: true, stale: false, error: null, data: results[i].value }; }
        const cached = lastGood.get(k);
        return { ...w, ok: Boolean(cached), stale: Boolean(cached), error: results[i].reason?.message || 'read failed', staleSince: cached?.at || null, data: cached?.data || null };
      });
      for (const w of wallets) if (w.error) console.warn(`[treasury:${w.chain}]`, w.error, w.stale ? '(showing last good read)' : '');
      if (!wallets.some(w => w.ok)) throw new Error(wallets.map(w => w.error).join('; '));

      // everything we need a price for: native refs + every held token + watch mints (solana)
      const want = [];
      const chains = [...new Set(wallets.map(w => w.chain))].map(chainOf);
      for (const c of chains) want.push(c.nativePriceRef);
      if (!chains.some(c => c.id === 'solana')) want.push(CHAINS.solana.nativePriceRef); // SOL price is still the display unit
      for (const w of wallets) if (w.ok) for (const t of w.data.tokens) want.push({ chain: w.chain, address: t.mint });
      for (const w of cfg.watchTokens) want.push({ chain: w.chain, address: w.address });
      const prices = await priceTokens(want);
      const nativePrices = {};
      for (const c of chains) nativePrices[c.id] = prices[pkey(c.nativePriceRef.chain, c.nativePriceRef.address)]?.priceUsd || 0;
      const solPrice = prices[pkey('solana', SOL_MINT)]?.priceUsd || nativePrices.solana || 0;

      const rows = [];
      for (const w of wallets) {
        if (!w.ok) continue;
        const c = chainOf(w.chain);
        const nref = prices[pkey(c.nativePriceRef.chain, c.nativePriceRef.address)];
        rows.push(makeRow({ mint: c.native.address || `native:${c.id}`, amount: w.data.native, native: true, chain: c.id, symbol: c.native.symbol, name: c.native.name }, nref, solPrice));
        for (const t of w.data.tokens) {
          if (c.kind === 'evm' && c.native.address && t.mint.toLowerCase() === c.native.address.toLowerCase()) { // wrapped native → fold into native row
            const nat = rows.find(r => r.chain === c.id && r.native); if (nat) { nat.amount += t.amount; nat.valueUsd = nat.amount * nat.priceUsd; nat.valueSol = solPrice ? nat.valueUsd / solPrice : 0; }
            continue;
          }
          rows.push(makeRow({ ...t, chain: c.id }, prices[pkey(c.id, t.mint)], solPrice));
        }
      }
      for (const w of cfg.watchTokens) {
        const held = rows.find(r => r.mint === w.address);
        if (held) { held.familyToken = held.familyToken || w.familyToken; continue; }
        rows.push(makeRow({ mint: w.address, amount: 0, watch: true, chain: w.chain, familyToken: w.familyToken }, prices[pkey(w.chain, w.address)], solPrice));
      }

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
        wallets: wallets.map(w => ({ chain: w.chain, address: w.address, ok: w.ok, stale: Boolean(w.stale), staleSince: w.staleSince || null, error: w.error, name: chainOf(w.chain).name, short: chainOf(w.chain).short, color: chainOf(w.chain).color, native: chainOf(w.chain).native.symbol, explorerUrl: chainOf(w.chain).explorer.account(w.address), explorerName: chainOf(w.chain).explorer.name })),
        nativePrices,
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

const STABLE_SYMBOLS = /^(USDC|USDT|USDC\.E|USDT0|DAI|AUSD|USD1)$/i;
function makeRow(t, p, solPrice) {
  const chain = chainOf(t.chain || 'solana');
  const priceUsd = p?.priceUsd || 0;
  const valueUsd = t.amount * priceUsd;
  const cost = cfg.costBasis[t.mint] != null ? Number(cfg.costBasis[t.mint]) : null;
  const symbol = t.native ? (t.symbol || chain.native.symbol) : (p?.symbol || t.symbol || t.mint.slice(0, 4) + '…' + t.mint.slice(-4));
  return {
    mint: t.mint,
    chain: chain.id,
    chainName: chain.name,
    chainShort: chain.short,
    chainColor: chain.color,
    nativeSymbol: chain.native.symbol,
    explorerUrl: t.mint.startsWith('native:') ? null : chain.explorer.token(t.mint),
    hasContract: !t.mint.startsWith('native:'),
    chartChain: t.native ? chain.nativePriceRef.chain : chain.id, // where the pair (and its candles) live
    native: Boolean(t.native),
    familyToken: Boolean(t.familyToken),
    stable: STABLES.has(t.mint) || STABLE_SYMBOLS.test(symbol),
    watch: Boolean(t.watch),
    symbol,
    name: t.native ? (t.name || chain.native.name) : (p?.name || t.name || 'Unknown token'),
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
  const isBuy = /^(SOL|WSOL|USDC|USDT|MON|WMON|ETH|WETH)$/i.test(s1);
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
  if (!cfg.treasuryWallets.length) return;
  try {
    let items = [];
    // EVM chains: already ingested during refreshTreasury (Transfer logs) — just collect
    for (const w of cfg.treasuryWallets) if (w.chain !== 'solana') items.push(...evmActivity(w.chain, w.address, 30));
    if (!cfg.treasuryWallet) {
      items.sort((a, b) => b.time - a.time);
      activity = { updatedAt: Date.now(), items };
      maybeAlert(items);
      return;
    }
    if (cfg.heliusKey) {
      const res = await fetch(`https://api.helius.xyz/v0/addresses/${cfg.treasuryWallet}/transactions?api-key=${cfg.heliusKey}&limit=30`);
      if (!res.ok) throw new Error(`helius HTTP ${res.status}`);
      const txs = await res.json();
      items.push(...txs.map(tx => ({
        signature: tx.signature,
        chain: 'solana',
        time: tx.timestamp * 1000,
        type: tx.type,
        source: tx.source,
        description: tx.description || '',
        fee: tx.fee / 1e9,
        error: tx.transactionError ? 'failed' : null,
        raw: { tokenTransfers: tx.tokenTransfers || [], nativeTransfers: tx.nativeTransfers || [] },
      })));
    } else {
      const sigs = await rpc('getSignaturesForAddress', [cfg.treasuryWallet, { limit: 30 }]);
      items.push(...sigs.map(s => ({
        signature: s.signature,
        chain: 'solana',
        time: (s.blockTime || 0) * 1000,
        type: s.memo ? 'MEMO' : 'TX',
        source: null,
        description: s.memo || '',
        error: s.err ? 'failed' : null,
      })));
    }
    items.sort((a, b) => b.time - a.time);
    activity = { updatedAt: Date.now(), items };
    maybeAlert(items);
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
export async function getOhlcv(pool, tf = '15m', chain = 'solana') {
  const [unit, agg] = TF[tf] || TF['15m'];
  const network = geckoId(chain);
  const key = `${network}:${pool}:${unit}:${agg}`;
  const hit = ohlcvCache.get(key);
  const ttl = unit === 'minute' ? 20_000 : 60_000;
  if (hit && hit.at > Date.now() - ttl) return hit.data;
  const res = await fetch(`${process.env.OHLCV_API_BASE || 'https://api.geckoterminal.com'}/api/v2/networks/${network}/pools/${pool}/ohlcv/${unit}?aggregate=${agg}&limit=1000&currency=usd`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`geckoterminal HTTP ${res.status}`);
  const json = await res.json();
  const list = (json.data?.attributes?.ohlcv_list || []).map(([t, o, h, l, c, v]) => ({ time: t, open: o, high: h, low: l, close: c, volume: v })).sort((a, b) => a.time - b.time);
  const data = { pool, tf, candles: list, base: json.meta?.base || null, quote: json.meta?.quote || null };
  ohlcvCache.set(key, { at: Date.now(), data });
  if (ohlcvCache.size > 200) ohlcvCache.delete(ohlcvCache.keys().next().value);
  return data;
}
