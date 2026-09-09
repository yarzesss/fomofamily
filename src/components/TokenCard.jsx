import React, { useContext, useState } from 'react';
import { usd, pct, cls, short } from '../lib/format.js';
import Img from './Img.jsx';
import { ConfigContext } from '../App.jsx';

// The family token's own card. Before launch it is a placeholder; the moment
// TOKEN_MINT is set in the Railway variables it fills with live market data,
// the chart tab appears and the family gate / voting rounds switch on.
export default function TokenCard({ positions }) {
  const config = useContext(ConfigContext);
  const [copied, setCopied] = useState(false);
  const ticker = config.tokenTicker || '$FOMO';
  const tok = config.tokenLive ? (positions || []).find(p => p.familyToken) : null;
  const buyUrl = config.stonkUrl || tok?.dexUrl || null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(config.tokenMint); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch {}
  };

  return (
    <div className="rcard token-card">
      <div className="about-head">
        <Img src={tok?.image} fallback={ticker.replace('$', '').slice(0, 2)} size={40} />
        <div>
          <div className="t">{ticker}{!config.tokenLive && <span className="badge dev">Soon</span>}</div>
          <div className="d">{config.tokenLive ? (tok?.name || 'the family token') : 'the family token'}</div>
        </div>
        <div className="grow" />
        {config.tokenLive && tok?.priceUsd ? (
          <div className="px">
            <div className="v">{usd(tok.priceUsd)}</div>
            <div className={`k ${cls(tok.change24)}`}>{tok.change24 == null ? '' : pct(tok.change24)}</div>
          </div>
        ) : null}
      </div>

      {config.tokenLive ? (
        <>
          <div className="kv"><span className="k">Market cap</span><span className="line" /><span className="v">{tok?.marketCap ? usd(tok.marketCap, { compact: true }) : '—'}</span></div>
          <div className="kv"><span className="k">Liquidity</span><span className="line" /><span className="v">{tok?.liquidity ? usd(tok.liquidity, { compact: true }) : '—'}</span></div>
          <div className="kv"><span className="k">Family</span><span className="line" /><span className="v">top {config.family?.max ?? 20} holders</span></div>
          <div className="kv">
            <span className="k">Contract</span><span className="line" />
            <button className="v ca" onClick={copy} title="Copy contract address">{copied ? 'Copied' : short(config.tokenMint, 6)}</button>
          </div>
          {buyUrl && <a className="cta primary" href={buyUrl} target="_blank" rel="noreferrer">Buy {ticker}</a>}
        </>
      ) : (
        <>
          <p className="soon">{config.tokenLaunchNote}</p>
          <div className="links">
            {config.xUrl && <a className="chip soft" href={config.xUrl} target="_blank" rel="noreferrer">X ↗</a>}
            {config.fomoUrl && <a className="chip soft" href={config.fomoUrl} target="_blank" rel="noreferrer">fomo ↗</a>}
            {config.telegramUrl && <a className="chip soft" href={config.telegramUrl} target="_blank" rel="noreferrer">Telegram ↗</a>}
          </div>
        </>
      )}
    </div>
  );
}
