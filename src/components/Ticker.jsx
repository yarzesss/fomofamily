import React from 'react';
import { usd, pct, cls } from '../lib/format.js';
import Img from './Img.jsx';

export default function Ticker({ positions }) {
  const items = positions.filter(p => p.priced);
  if (!items.length) return <div className="ticker"><div className="track" style={{ animation: 'none' }}><span className="tick dim">waiting for treasury data…</span></div></div>;
  const list = [...items, ...items]; // duplicated for a seamless loop
  return (
    <div className="ticker">
      <div className="track" style={{ animationDuration: `${Math.max(30, items.length * 6)}s` }}>
        {list.map((p, i) => (
          <span className="tick" key={i}>
            <Img src={p.image} fallback={p.symbol.slice(0, 1)} size={16} />
            <span className="sym">{p.symbol}</span>
            <span className="px">{usd(p.priceUsd)}</span>
            <span className={`chg ${cls(p.change24)}`}>{pct(p.change24)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
