// Top holders of an ERC-20 on an EVM chain.
//
// Plain JSON-RPC has no "largest accounts" call, so we read them from the
// chain's Blockscout API (Robinhood Chain runs one). Contracts — pools, LP,
// routers, bridges — are dropped, so the family is people only.

import { chainOf } from './chains.js';
import { evmRpc } from './evm.js';

const SEL_TOTAL_SUPPLY = '0x18160ddd';
const SEL_DECIMALS = '0x313ce567';

async function api(chain, path) {
  const c = chainOf(chain);
  if (!c?.scanApi) throw new Error(`${chain}: no explorer API configured (set ${chain.toUpperCase()}_SCAN_API)`);
  const res = await fetch(`${c.scanApi}${path}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${chain} explorer: HTTP ${res.status}`);
  return res.json();
}

// → { supply, decimals, holders: [{ wallet, balance }] } sorted desc, contracts removed
export async function evmTokenHolders(chain, token, limit = 60) {
  const [info, page] = await Promise.all([
    api(chain, `/tokens/${token}`).catch(() => null),
    api(chain, `/tokens/${token}/holders`),
  ]);

  let decimals = Number(info?.decimals);
  if (!Number.isFinite(decimals)) {
    decimals = await evmRpc(chain, 'eth_call', [{ to: token, data: SEL_DECIMALS }, 'latest']).then(r => Number(BigInt(r))).catch(() => 18);
  }
  let supplyRaw = info?.total_supply;
  if (supplyRaw == null) {
    supplyRaw = await evmRpc(chain, 'eth_call', [{ to: token, data: SEL_TOTAL_SUPPLY }, 'latest']).then(r => BigInt(r).toString()).catch(() => '0');
  }
  const toNum = raw => Number(BigInt(raw)) / 10 ** decimals;

  const holders = (page.items || [])
    .filter(h => !h.address?.is_contract)                 // pools, routers, bridges are not family
    .map(h => ({ wallet: String(h.address?.hash || '').toLowerCase(), balance: toNum(h.value || '0') }))
    .filter(h => h.wallet && h.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, limit);

  return { supply: toNum(supplyRaw || '0'), decimals, holders };
}

// Every ERC-20 an address holds, straight from the explorer — one request
// instead of scanning the chain's whole log history.
export async function evmTokenBalances(chain, address) {
  const list = await api(chain, `/addresses/${address}/token-balances`);
  if (!Array.isArray(list)) return [];
  return list
    .filter(x => (x.token?.type || 'ERC-20') === 'ERC-20')
    .map(x => {
      const decimals = Number(x.token?.decimals ?? 18);
      const amount = Number(BigInt(x.value || '0')) / 10 ** (Number.isFinite(decimals) ? decimals : 18);
      return { mint: String(x.token?.address_hash || x.token?.address || '').toLowerCase(), amount, decimals, symbol: x.token?.symbol || '', name: x.token?.name || '' };
    })
    .filter(t => t.mint && t.amount > 0);
}

// One wallet's balance of an ERC-20 (used by the holders-only chat gate).
export async function evmTokenBalance(chain, token, wallet) {
  const data = '0x70a08231' + '000000000000000000000000' + wallet.toLowerCase().replace(/^0x/, '');
  const [raw, dec] = await Promise.all([
    evmRpc(chain, 'eth_call', [{ to: token, data }, 'latest']),
    evmRpc(chain, 'eth_call', [{ to: token, data: SEL_DECIMALS }, 'latest']).then(r => Number(BigInt(r))).catch(() => 18),
  ]);
  return Number(BigInt(raw)) / 10 ** dec;
}
