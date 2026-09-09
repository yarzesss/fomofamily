import React from 'react';
import { usd, pct, cls } from '../lib/format.js';
import Img from './Img.jsx';

export default function BottomBar({ positions, treasury, config }) {
  const items = positions.filter(p => p.priced && !p.stable);
  const list = items.length ? [...items, ...items] : [];
  return (
    <footer className="bottom">
      <div className="ticker">
        {list.length ? (
          <div className="track" style={{ animationDuration: `${Math.max(40, items.length * 8)}s` }}>
            {list.map((p, i) => (
              <span className="tick" key={i}>
                <Img src={p.image} fallback={p.symbol.slice(0, 1)} size={14} />
                <span className="sym">{p.symbol}</span>
                <span className="px">{usd(p.priceUsd)}</span>
                <span className={cls(p.change24)}><span className="arrow">{p.change24 >= 0 ? '▲' : '▼'}</span>{pct(Math.abs(p.change24 ?? 0)).replace('+', '')}</span>
              </span>
            ))}
          </div>
        ) : <span className="t3">waiting for treasury data…</span>}
      </div>
      <span className={`status ${treasury?.ok ? '' : 'bad'}`}><i />{treasury?.ok ? 'Live' : 'Reconnecting'}</span>
      <nav className="links">
        {config.xUrl && <a href={config.xUrl} target="_blank" rel="noreferrer">X</a>}
        {config.telegramUrl && <a href={config.telegramUrl} target="_blank" rel="noreferrer">Telegram</a>}
        {config.stonkUrl && <a href={config.stonkUrl} target="_blank" rel="noreferrer">stonk.fun</a>}
        {treasury?.wallets?.length ? treasury.wallets.map(w => <a key={w.chain} href={w.explorerUrl} target="_blank" rel="noreferrer" title={w.address}>{treasury.wallets.length > 1 ? w.name : 'Treasury'}</a>)
          : treasury?.wallet && <a href={`https://solscan.io/account/${treasury.wallet}`} target="_blank" rel="noreferrer">Treasury</a>}
      </nav>
    </footer>
  );
}
