// Chain registry. The treasury can live on several chains at once (a fomo
// account = one Solana address + one EVM smart-wallet address shared by every
// EVM network). Everything chain-specific — RPC, explorer links, native token,
// DexScreener / GeckoTerminal ids — lives here so the rest of the server can
// stay chain-agnostic.

const env = (k, d = '') => (process.env[k] ?? d).toString().trim();

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
const WETH_ETHEREUM = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

export const CHAINS = {
  solana: {
    id: 'solana', kind: 'solana', name: 'Solana', short: 'SOL', color: '#9945ff',
    native: { symbol: 'SOL', name: 'Solana', address: SOL_MINT, decimals: 9 },
    // where to look up the native token's USD price on DexScreener
    nativePriceRef: { chain: 'solana', address: SOL_MINT },
    dex: 'solana', gecko: 'solana',
    explorer: {
      account: a => `https://solscan.io/account/${a}`,
      token: t => `https://solscan.io/token/${t}`,
      tx: s => `https://solscan.io/tx/${s}`,
      name: 'Solscan',
    },
    isAddress: s => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s || ''),
  },
  monad: {
    id: 'monad', kind: 'evm', name: 'Monad', short: 'MON', color: '#836ef9', chainId: 143,
    rpc: env('MONAD_RPC', 'https://rpc.monad.xyz'),
    native: { symbol: 'MON', name: 'Monad', address: env('MONAD_WRAPPED', '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A'), decimals: 18 },
    nativePriceRef: { chain: 'monad', address: env('MONAD_WRAPPED', '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A') },
    dex: env('MONAD_DEX_ID', 'monad'), gecko: env('MONAD_GECKO_ID', 'monad'),
    explorer: {
      account: a => `https://monadvision.com/address/${a}`,
      token: t => `https://monadvision.com/token/${t}`,
      tx: h => `https://monadvision.com/tx/${h}`,
      name: 'MonadVision',
    },
    isAddress: s => /^0x[0-9a-fA-F]{40}$/.test(s || ''),
  },
  robinhood: {
    id: 'robinhood', kind: 'evm', name: 'Robinhood Chain', short: 'RH', color: '#00c805', chainId: 4663,
    rpc: env('ROBINHOOD_RPC', 'https://rpc.mainnet.chain.robinhood.com'),
    // gas + quote asset on Robinhood Chain is ETH; price it via WETH on Ethereum
    native: { symbol: 'ETH', name: 'Ether', address: env('ROBINHOOD_WRAPPED', ''), decimals: 18 },
    nativePriceRef: { chain: 'ethereum', address: WETH_ETHEREUM },
    dex: env('ROBINHOOD_DEX_ID', 'robinhood'), gecko: env('ROBINHOOD_GECKO_ID', 'robinhood'),
    explorer: {
      account: a => `https://robinhoodchain.blockscout.com/address/${a}`,
      token: t => `https://robinhoodchain.blockscout.com/token/${t}`,
      tx: h => `https://robinhoodchain.blockscout.com/tx/${h}`,
      name: 'Blockscout',
    },
    isAddress: s => /^0x[0-9a-fA-F]{40}$/.test(s || ''),
  },
};

export const chainOf = id => CHAINS[String(id || '').toLowerCase()] || null;
export const isEvm = id => chainOf(id)?.kind === 'evm';

// "solana:ADDR,monad:0x..,robinhood:0x.." → [{ chain, address }]
export function parseWallets(spec, legacySolana = '') {
  const out = [];
  for (const part of String(spec || '').split(',').map(s => s.trim()).filter(Boolean)) {
    const i = part.indexOf(':');
    const chain = i > 0 ? part.slice(0, i).toLowerCase() : 'solana';
    const address = i > 0 ? part.slice(i + 1).trim() : part;
    const c = chainOf(chain);
    if (!c) { console.warn(`[cfg] unknown chain "${chain}" in TREASURY_WALLETS — skipped`); continue; }
    if (!c.isAddress(address)) { console.warn(`[cfg] bad ${chain} address "${address}" — skipped`); continue; }
    out.push({ chain: c.id, address: c.kind === 'evm' ? address.toLowerCase() : address });
  }
  if (!out.length && legacySolana) out.push({ chain: 'solana', address: legacySolana });
  return out;
}

// public shape (sent to the browser)
export const publicChain = c => ({ id: c.id, name: c.name, short: c.short, color: c.color, native: c.native.symbol, explorer: c.explorer.name });
