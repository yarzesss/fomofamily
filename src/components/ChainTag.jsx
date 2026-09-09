import React from 'react';
// Tiny chain badge: colored dot + short label. Hidden when the fund is on one chain only (nothing to tell apart).
export default function ChainTag({ chain, short, color, name, symbol, always = false, config }) {
  const many = always || (config?.chains?.length || 1) > 1;
  // A native coin already says where it lives (SOL on Solana, MON on Monad) —
  // the badge would just repeat the ticker, so only tokens get one.
  const repeats = symbol && short && symbol.replace(/^\$/, '').toUpperCase() === short.toUpperCase();
  if (!chain || !many || repeats) return null;
  return <span className="chain-tag" title={name || chain} style={{ '--c': color || '#888' }}><i />{short || chain}</span>;
}
