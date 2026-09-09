import React from 'react';
// Tiny chain badge: colored dot + short label. Hidden when the fund is on one chain only (nothing to tell apart).
export default function ChainTag({ chain, short, color, name, always = false, config }) {
  const many = always || (config?.chains?.length || 1) > 1;
  if (!chain || !many) return null;
  return <span className="chain-tag" title={name || chain} style={{ '--c': color || '#888' }}><i />{short || chain}</span>;
}
