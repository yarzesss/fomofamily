import React, { useContext, useState } from 'react';
import { usd, pct, cls, num, short } from '../lib/format.js';
import { useCountUp, useFlash, usePoll } from '../lib/hooks.js';
import Img from './Img.jsx';
import NetWorthChart from './NetWorthChart.jsx';
import AllocationRing from './AllocationRing.jsx';
import Orbit from './Orbit.jsx';
import TokenCard from './TokenCard.jsx';
import { ConfigContext } from '../App.jsx';

const Chg = ({ v }) => v == null ? <span className="t3">—</span> : <span className={cls(v)}><span className="arrow">{v >= 0 ? '▲' : '▼'}</span>{Math.abs(v).toFixed(2)}%</span>;

// Right column: "the fund" card (mirrors fomo's Buy/Sell card) + "About" card.
export default function Portfolio({ treasury, selected, onSelect, positions }) {
  const config = useContext(ConfigContext);
  const t = treasury;
  const total = useCountUp(t?.totalUsd ?? null);
  const flash = useFlash(t?.totalUsd);
  const [range, setRange] = useState('24h');
  const [view, setView] = useState('fund'); // fund | orbit
  const [tf, setTf] = useState('h24');
  const hist = usePoll('/api/history?range=1h', 120000);
  const startUsd = t?.startUsd || hist.data?.launch?.totalUsd || null;
  const pnlVsStart = startUsd && t ? t.totalUsd - startUsd : null;

  const cur = positions.find(p => p.mint === selected) || positions.find(p => p.pairAddress && !p.stable);
  const tfVal = cur ? { m5: cur.change5m, h1: cur.change1h, h6: cur.change6h ?? null, h24: cur.change24 }[tf] : null;
  const buys = cur?.txns24?.buys || 0, sells = cur?.txns24?.sells || 0, tx = buys + sells || 1;

  return (
    <aside className="right">
      <div className="rcard">
        <div className="seg">
          <button className={`${view === 'fund' ? 'on' : ''}`} onClick={() => setView('fund')}>Fund</button>
          <button className={`${view === 'orbit' ? 'on blue' : ''}`} onClick={() => setView('orbit')}>Orbit</button>
        </div>
        {view === 'fund' ? (
          <>
            <div className="amount-box">
              <span className="cur">$</span>
              <span className={`num ${flash}`}>{t ? usd(total).replace('$', '') : '—'}</span>
              <span className="hint">{t ? <><Chg v={t.change24Pct} /><div className="s12">24H</div></> : 'Net worth'}</span>
            </div>
            <div className="quick">
              {['1h', '24h', '7d', '30d'].map(r => <button key={r} className={r === range ? 'on' : ''} onClick={() => setRange(r)}>{r}</button>)}
            </div>
            <NetWorthChart range={range} />
            <div className="avail">
              <span>{t ? `${num(t.totalSol, 1)} SOL · ${usd(t.stableUsd, { compact: true })} stables` : '—'}</span>
              {pnlVsStart != null && <span className={cls(pnlVsStart)}>{usd(pnlVsStart)} since launch</span>}
            </div>
          </>
        ) : (
          <Orbit treasury={t} selected={selected} onSelect={onSelect} />
        )}
        {t?.wallets?.length > 1
          ? <div className="wallets">{t.wallets.map(w => <a key={w.chain} className="cta muted" href={w.explorerUrl} target="_blank" rel="noreferrer" title={`${w.address} on ${w.explorerName}`}><i className="dot" style={{ background: w.color }} />{w.name}{w.ok === false && ' · offline'}</a>)}</div>
          : <a className="cta muted" href={t?.wallets?.[0]?.explorerUrl || (t?.wallet ? `https://solscan.io/account/${t.wallet}` : '#')} target="_blank" rel="noreferrer">View treasury on {t?.wallets?.[0]?.explorerName || 'Solscan'}</a>}
      </div>

      <TokenCard positions={positions} />

      {cur && (
        <div className="rcard about">
          <div className="about-head">
            <Img src={cur.image} fallback={cur.symbol.slice(0, 2)} size={40} />
            <div><div className="t">About {cur.symbol}</div><div className="d">{cur.name}{cur.dexId ? ` · ${cur.dexId}` : ''}</div></div>
          </div>
          <div className="tf">
            {[['m5', '5M'], ['h1', '1H'], ['h6', '6H'], ['h24', '1D']].map(([k, l]) => (
              <button key={k} className={tf === k ? 'on' : ''} onClick={() => setTf(k)}>
                <span className="k">{l}</span>
                <span className="v"><Chg v={{ m5: cur.change5m, h1: cur.change1h, h6: cur.change6h ?? null, h24: cur.change24 }[k]} /></span>
              </button>
            ))}
          </div>
          <div className="bars">
            <div className="bar-row">
              <div className="lbls"><div>{num(buys, 0)}<span>buys</span></div><div>{num(sells, 0)}<span>sells</span></div></div>
              <div className="track"><i className="g" style={{ width: `${(buys / tx) * 100}%` }} /><i className="r" style={{ width: `${(sells / tx) * 100}%` }} /></div>
            </div>
            <div className="bar-row">
              <div className="lbls"><div>{usd(cur.volume24, { compact: true })}<span>vol. 24H</span></div><div>{usd(cur.liquidity, { compact: true })}<span>liquidity</span></div></div>
              <div className="track"><i className="g" style={{ width: `${Math.min(100, (cur.volume24 / ((cur.volume24 || 0) + (cur.liquidity || 1))) * 100)}%` }} /><i className="r" style={{ flex: 1 }} /></div>
            </div>
          </div>
          <div className="links">
            {cur.websites?.slice(0, 1).map((w, i) => <a key={i} className="chip soft" href={w.url} target="_blank" rel="noreferrer">Website</a>)}
            {cur.socials?.slice(0, 2).map((s, i) => <a key={i} className="chip soft" href={s.url} target="_blank" rel="noreferrer">{s.type[0].toUpperCase() + s.type.slice(1)}</a>)}
            <a className="chip soft" href={cur.dexUrl} target="_blank" rel="noreferrer">DexScreener ↗</a>
          </div>
          {cur.chainName && (t?.wallets?.length > 1) && <div className="kv"><span className="k">Chain</span><span className="line" /><span className="v"><i className="dot" style={{ background: cur.chainColor, display: 'inline-block', width: 8, height: 8, borderRadius: 4, marginRight: 6 }} />{cur.chainName}</span></div>}
          <div className="kv"><span className="k">We hold</span><span className="line" /><span className="v">{num(cur.amount)} {cur.symbol} · {usd(cur.valueUsd)}</span></div>
          <div className="kv"><span className="k">Of fund</span><span className="line" /><span className="v">{t?.totalUsd ? `${((cur.valueUsd / t.totalUsd) * 100).toFixed(2)}%` : '—'}</span></div>
          {cur.costUsd != null && <div className="kv"><span className="k">PnL</span><span className="line" /><span className={`v ${cls(cur.pnlUsd)}`}>{usd(cur.pnlUsd)} ({pct(cur.pnlPct)})</span></div>}
          <div className="kv"><span className="k">Market cap</span><span className="line" /><span className="v">{cur.marketCap ? usd(cur.marketCap, { compact: true }) : '—'}</span></div>
          {cur.hasContract !== false && <div className="kv"><span className="k">Contract address</span><span className="line" /><a className="v" href={cur.explorerUrl || '#'} target="_blank" rel="noreferrer">{short(cur.mint, 6)}</a></div>}
        </div>
      )}

      <div className="rcard about">
        <div className="section-title">Allocation<div className="grow" /><span className="s12 t2">{t?.positionCount || 0} bags</span></div>
        <AllocationRing positions={t?.positions} total={t?.totalUsd} />
        {t?.error && <div className="warn">{t.ok ? 'Showing last good snapshot · ' : ''}{t.error}</div>}
      </div>
    </aside>
  );
}
