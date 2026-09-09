// EVM treasury reader (Monad, Robinhood Chain, …). Plain JSON-RPC, no SDK:
//  - native balance + ERC-20 balances
//  - token discovery from ERC-20 Transfer logs to/from the treasury
//  - activity: every tx that moved tokens in/out, classified as SWAP / IN / OUT
//    from balance deltas (works whatever router fomo uses under the hood)
//
// Discovery is incremental: we scan Transfer logs from `startBlock` once, then
// only new blocks on every refresh. The set of known tokens is kept in memory
// (and re-scanned from EVM_SCAN_BLOCKS back on restart).

import { chainOf } from './chains.js';
import { evmTokenBalances } from './holders.js';

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const SEL_BALANCE_OF = '0x70a08231';
const SEL_DECIMALS = '0x313ce567';
const SEL_SYMBOL = '0x95d89b41';
const SEL_NAME = '0x06fdde03';
const SCAN_BACK = Number(process.env.EVM_SCAN_BLOCKS || 20_000);  // how far back to look on first run
const CHUNK = Number(process.env.EVM_LOG_CHUNK || 2_000);         // blocks per eth_getLogs call
const MIN_CHUNK = 100;                                            // shrink to this when a node refuses the range
const MAX_CHUNKS_PER_TICK = Number(process.env.EVM_CHUNKS_PER_TICK || 6); // keep one refresh gentle on public RPCs
const MIN_GAP_MS = Number(process.env.EVM_MIN_GAP_MS || 120);     // spacing between calls to the same chain
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Public RPCs rate-limit hard (Robinhood answers 429 when hammered), so every
// call to a chain is queued behind the previous one with a small gap, and a
// 429 / 5xx is retried twice with backoff before it counts as a failure.
const gate = new Map(); // chain -> { queue, last }
const chunkSize = new Map(); // chain -> blocks per eth_getLogs, shrunk when a node says the range is too big
const warned = new Map(); // chain|msg -> last logged, so a failing node does not flood the logs
let rpcId = 0;

function warnOnce(key, msg, everyMs = 300_000) {
  if (warned.get(key) > Date.now() - everyMs) return;
  warned.set(key, Date.now());
  console.warn(msg);
}

export async function evmRpc(chain, method, params, attempt = 0) {
  const c = chainOf(chain);
  if (!gate.has(chain)) gate.set(chain, { queue: Promise.resolve(), last: 0 });
  const g = gate.get(chain);
  const run = g.queue.then(async () => {
    const wait = g.last + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    g.last = Date.now();
    return fetch(c.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
  });
  g.queue = run.then(() => {}, () => {});
  const res = await run;
  if (res.status === 429 || res.status >= 500) {
    if (attempt < 2) { await sleep(500 * (attempt + 1) + Math.random() * 250); return evmRpc(chain, method, params, attempt + 1); }
    const e = new Error(`${c.id} rpc ${method}: HTTP ${res.status}`); e.rateLimited = res.status === 429; throw e;
  }
  if (!res.ok) throw new Error(`${c.id} rpc ${method}: HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`${c.id} rpc ${method}: ${json.error.message}`);
  return json.result;
}

const hex = n => '0x' + BigInt(n).toString(16);
const pad32 = addr => '0x000000000000000000000000' + addr.toLowerCase().replace(/^0x/, '');
const topicToAddr = t => '0x' + t.slice(-40).toLowerCase();
const toNum = (raw, decimals) => Number(BigInt(raw)) / 10 ** decimals; // fine for display precision

function decodeString(data) {
  try {
    const d = data.replace(/^0x/, '');
    if (d.length <= 64) return Buffer.from(d, 'hex').toString('utf8').replace(/\0+$/, ''); // bytes32-style symbol
    const len = Number(BigInt('0x' + d.slice(64, 128)));
    return Buffer.from(d.slice(128, 128 + len * 2), 'hex').toString('utf8');
  } catch { return ''; }
}

async function call(chain, to, data) {
  return evmRpc(chain, 'eth_call', [{ to, data }, 'latest']);
}

// ---------- per-chain state ----------
const state = new Map(); // chain:address -> { tokens: Map<addr, meta>, scanned: number|null, txs: Map<hash, tx>, blockTime: Map<number, number> }
const key = (chain, address) => `${chain}:${address.toLowerCase()}`;
function st(chain, address) {
  const k = key(chain, address);
  if (!state.has(k)) state.set(k, { tokens: new Map(), scanned: null, txs: new Map(), blockTime: new Map() });
  return state.get(k);
}

async function tokenMeta(chain, addr) {
  const [dec, sym, name] = await Promise.all([
    call(chain, addr, SEL_DECIMALS).then(r => Number(BigInt(r))).catch(() => 18),
    call(chain, addr, SEL_SYMBOL).then(decodeString).catch(() => ''),
    call(chain, addr, SEL_NAME).then(decodeString).catch(() => ''),
  ]);
  return { address: addr, decimals: Number.isFinite(dec) && dec <= 36 ? dec : 18, symbol: sym || addr.slice(0, 6), name: name || 'Unknown token' };
}

async function blockTimestamp(s, chain, blockHex) {
  const n = Number(BigInt(blockHex));
  if (s.blockTime.has(n)) return s.blockTime.get(n);
  const b = await evmRpc(chain, 'eth_getBlockByNumber', [blockHex, false]);
  const t = Number(BigInt(b?.timestamp || 0)) * 1000;
  s.blockTime.set(n, t);
  if (s.blockTime.size > 2000) s.blockTime.delete(s.blockTime.keys().next().value);
  return t;
}

// Scan Transfer logs where the treasury is sender or receiver. Returns logs; updates s.scanned.
async function scanTransfers(chain, address) {
  const s = st(chain, address);
  const latest = Number(BigInt(await evmRpc(chain, 'eth_blockNumber', [])));
  let from = s.scanned == null ? Math.max(0, latest - SCAN_BACK) : s.scanned + 1;
  const me = pad32(address);
  const logs = [];
  let chunks = 0;
  while (from <= latest && chunks < MAX_CHUNKS_PER_TICK) {
    const size = chunkSize.get(chain) ?? CHUNK;
    const to = Math.min(latest, from + size - 1);
    let inn, out;
    try {
      [inn, out] = await Promise.all([
        evmRpc(chain, 'eth_getLogs', [{ fromBlock: hex(from), toBlock: hex(to), topics: [TRANSFER_TOPIC, null, me] }]),
        evmRpc(chain, 'eth_getLogs', [{ fromBlock: hex(from), toBlock: hex(to), topics: [TRANSFER_TOPIC, me] }]),
      ]);
    } catch (e) {
      const msg = e.message || '';
      if (e.rateLimited) { warnOnce(`${chain}:429`, `[evm:${chain}] rate limited — pausing the scan, will continue next tick`); break; }
      // 413 / "range too large" / "limit exceeded": ask for fewer blocks next time
      if (/\b413\b|too large|too many|range|limit/i.test(msg)) {
        const next = Math.max(MIN_CHUNK, Math.floor((chunkSize.get(chain) ?? CHUNK) / 2));
        if (next !== (chunkSize.get(chain) ?? CHUNK)) {
          chunkSize.set(chain, next);
          warnOnce(`${chain}:chunk:${next}`, `[evm:${chain}] node refused the block range — retrying with ${next}-block chunks`);
        } else {
          warnOnce(`${chain}:chunkfloor`, `[evm:${chain}] node refuses even ${next}-block ranges — history scan paused (balances still work)`);
        }
        break;
      }
      warnOnce(`${chain}:scan`, `[evm:${chain}] scan: ${msg}`);
      break;
    }
    logs.push(...inn, ...out);
    s.scanned = to;
    from = to + 1;
    chunks++;
  }
  return logs;
}

// ---------- public: holdings ----------
export async function readEvmWallet(chain, address) {
  const c = chainOf(chain);
  const s = st(chain, address);

  // Trade history still comes from Transfer logs (that is how a swap is spotted),
  // but it is best-effort: a node that refuses the range never blocks balances.
  try {
    const logs = await scanTransfers(chain, address);
    const seen = new Set(logs.map(l => l.address.toLowerCase()));
    for (const t of seen) if (!s.tokens.has(t)) s.tokens.set(t, await tokenMeta(chain, t));
    await ingestLogs(chain, address, logs);
  } catch (e) {
    warnOnce(`${chain}:scanfail`, `[evm:${chain}] scan: ${e.message}`);
  }

  const nativeRaw = await evmRpc(chain, 'eth_getBalance', [address, 'latest']);

  // Balances: one call to the chain's explorer when it has an API (Robinhood),
  // otherwise balanceOf for every token we have ever seen move (Monad).
  if (c.scanApi) {
    try {
      const tokens = await evmTokenBalances(chain, address);
      for (const t of tokens) if (!s.tokens.has(t.mint)) s.tokens.set(t.mint, { address: t.mint, decimals: t.decimals, symbol: t.symbol, name: t.name });
      return { native: toNum(nativeRaw, c.native.decimals), tokens };
    } catch (e) {
      warnOnce(`${chain}:explorer`, `[evm:${chain}] explorer balances: ${e.message} — falling back to balanceOf`);
    }
  }

  const tokens = [];
  await Promise.all([...s.tokens.values()].map(async m => {
    try {
      const raw = await call(chain, m.address, SEL_BALANCE_OF + pad32(address).slice(2));
      const amount = toNum(raw, m.decimals);
      if (amount > 0) tokens.push({ mint: m.address, amount, decimals: m.decimals, symbol: m.symbol, name: m.name });
    } catch {}
  }));
  return { native: toNum(nativeRaw, c.native.decimals), tokens };
}

// ---------- public: activity ----------
// Group transfer logs by tx, fetch native value, classify.
async function ingestLogs(chain, address, logs) {
  const s = st(chain, address);
  const me = address.toLowerCase();
  const byTx = new Map();
  for (const l of logs) (byTx.get(l.transactionHash) || byTx.set(l.transactionHash, []).get(l.transactionHash)).push(l);
  const hashes = [...byTx.keys()].filter(h => !s.txs.has(h)).slice(-60); // bound the work per tick
  for (const h of hashes) {
    const ls = byTx.get(h);
    try {
      const [tx, time] = await Promise.all([evmRpc(chain, 'eth_getTransactionByHash', [h]), blockTimestamp(s, chain, ls[0].blockNumber)]);
      const tokenTransfers = ls.map(l => {
        const meta = s.tokens.get(l.address.toLowerCase());
        const amount = toNum(l.data, meta?.decimals ?? 18);
        return { mint: l.address.toLowerCase(), symbol: meta?.symbol, tokenAmount: amount, fromUserAccount: topicToAddr(l.topics[1]), toUserAccount: topicToAddr(l.topics[2]) };
      });
      const nativeTransfers = [];
      const c = chainOf(chain);
      if (tx && tx.from?.toLowerCase() === me && BigInt(tx.value || 0) > 0n) nativeTransfers.push({ fromUserAccount: me, toUserAccount: (tx.to || '').toLowerCase(), amount: toNum(tx.value, c.native.decimals) });
      const inn = tokenTransfers.filter(t => t.toUserAccount === me);
      const out = tokenTransfers.filter(t => t.fromUserAccount === me);
      const spentNative = nativeTransfers.reduce((a, n) => a + n.amount, 0);
      let type = 'TRANSFER';
      if (inn.length && (out.length || spentNative > 0)) type = 'SWAP';
      else if (inn.length) type = 'IN';
      else if (out.length) type = 'OUT';
      const fmt = n => n.toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 6 : 2 });
      let description = '';
      if (type === 'SWAP') {
        const got = inn[0], gave = out[0];
        description = `${address.slice(0, 6)} swapped ${gave ? `${fmt(gave.tokenAmount)} ${gave.symbol || '?'}` : `${fmt(spentNative)} ${c.native.symbol}`} for ${fmt(got.tokenAmount)} ${got.symbol || '?'}`;
      } else if (type === 'IN') description = `received ${fmt(inn[0].tokenAmount)} ${inn[0].symbol || '?'}`;
      else if (type === 'OUT') description = `sent ${fmt(out[0].tokenAmount)} ${out[0].symbol || '?'}`;
      s.txs.set(h, { signature: h, chain, time, type, source: tx?.to?.toLowerCase() || null, description, fee: null, error: null, raw: { tokenTransfers, nativeTransfers } });
    } catch (e) {
      console.warn(`[evm:${chain}] tx ${h.slice(0, 10)}:`, e.message);
    }
  }
  if (s.txs.size > 400) for (const k of [...s.txs.keys()].slice(0, s.txs.size - 400)) s.txs.delete(k);
}

export function evmActivity(chain, address, limit = 30) {
  const s = st(chain, address);
  return [...s.txs.values()].sort((a, b) => b.time - a.time).slice(0, limit);
}

export function knownEvmTokens(chain, address) {
  return [...st(chain, address).tokens.values()];
}
