import React, { useEffect, useState } from 'react';
import { usd, pct, cls, num, short, ago } from '../lib/format.js';
import Img from './Img.jsx';
import Candles from './Candles.jsx';
import Avatar from './Avatar.jsx';
import ChainTag from './ChainTag.jsx';

const Chg = ({ v }) => v == null ? <span className="t3">—</span> : <span className={cls(v)}><span className="arrow">{v >= 0 ? '▲' : '▼'}</span>{Math.abs(v).toFixed(2)}%</span>;

export default function Charts({ positions, selected, onSelect, query, total, projectName, votedMints, tokenTicker, config }) {
  // chart bar: native coins (SOL / MON / ETH) + tokens the family voted in
  const allowed = new Set(votedMints || []);
  const chartable = positions.filter(p => p.pairAddress && !p.stable && (p.native || p.familyToken || allowed.has(p.mint)));
  const [thesesData, setThesesData] = useState({ theses: [], names: {} });
  const theses = thesesData.theses; const names = thesesData.names;
  useEffect(() => { const load = () => fetch('/api/theses').then(r => r.json()).then(setThesesData).catch(() => {}); load(); const id = setInterval(load, 30000); return () => clearInterval(id); }, []);
  const cur = chartable.find(p => p.mint === selected) || chartable[0];
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState('holdings');

  const q = (query || '').trim().toLowerCase();
  const rows = positions.filter(p => !p.watch && (!q || p.symbol.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || p.mint.toLowerCase().includes(q)));
  const copy = async () => { try { await navigator.clipboard.writeText(cur.mint); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch {} };
  const age = cur?.pairCreatedAt ? ago(cur.pairCreatedAt) : null;

  return (
    <section className="centre">
      {!cur ? (
        <div className="chart-wrap"><div className="loading">{positions.length ? 'Nothing to chart yet — the family hasn\'t voted a token in.' : 'Waiting for the treasury wallet…'}</div></div>
      ) : (
        <>
          <div className="tok-head">
            <div className="ident">
              <Img src={cur.image} fallback={cur.symbol.slice(0, 2)} size={40} />
              <div>
                <div className="l1">{cur.symbol}<ChainTag chain={cur.chain} short={cur.chainShort} color={cur.chainColor} name={cur.chainName} config={config} />{cur.familyToken && <span className="badge buy">Our token</span>}{cur.watch && !cur.familyToken && <span className="badge dev">Watching</span>}</div>
                <div className="l2">
                  <span>{cur.name}</span>
                  {age && <><span className="divider-v" /><span>{age}</span></>}
                  {cur.hasContract !== false && <><span className="divider-v" />
                  <button className="ca" onClick={copy} title="Copy contract address">{copied ? 'Copied' : short(cur.mint, 6)}</button></>}
                </div>
              </div>
            </div>
            <div className="grow" />
            <div className="tabs">
              {chartable.map(p => (
                <button key={p.mint} className={p.mint === cur.mint ? 'on' : ''} onClick={() => onSelect(p.mint)}>
                  <Img src={p.image} fallback={p.symbol.slice(0, 1)} size={16} />{p.symbol}
                </button>
              ))}
            </div>
          </div>

          <div className="tiles">
            <div className="tile big"><div className="k">Market cap</div><div className="v">{cur.marketCap ? usd(cur.marketCap, { compact: true }) : '—'}</div></div>
            <div className="tile"><div className="k">Price</div><div className="v">{usd(cur.priceUsd)}</div></div>
            <div className="tile"><div className="k">24H change</div><div className="v"><Chg v={cur.change24} /></div></div>
            <div className="tile"><div className="k">Liquidity</div><div className="v">{usd(cur.liquidity, { compact: true })}</div></div>
            <div className="tile"><div className="k">Volume 24H</div><div className="v">{usd(cur.volume24, { compact: true })}</div></div>
            <div className="tile"><div className="k">We hold</div><div className="v">{cur.watch ? '—' : usd(cur.valueUsd, { compact: true })}</div></div>
            <div className="tile"><div className="k">Of fund</div><div className="v">{total ? `${((cur.valueUsd / total) * 100).toFixed(2)}%` : '—'}</div></div>
          </div>

          <div className="chart-wrap">
            <Candles token={cur} projectName={projectName} markers={theses.filter(t => t.token_mint === cur.mint && t.status === 'bought' && t.bought_at).map(t => ({
              id: t.id, time: Math.floor(new Date(t.bought_at).getTime() / 1000), price: t.buy_price, wallet: t.created_by, name: names[t.created_by] || short(t.created_by), thesis: t.thesis,
              text: `Bought ${num(t.buy_amount)} ${t.symbol || ''} for ${t.buy_sol?.toFixed(t.buy_sol < 1 ? 4 : 2)} ${t.buy_native_symbol || 'SOL'} (${usd(t.buy_usd)})`, at: t.bought_at,
            }))} />
          </div>

          <div className="table-card">
            <div className="card-tabs" style={{ borderRadius: '8px 8px 0 0', height: 40, padding: '0 8px 0 12px' }}>
              <button className={tab === 'holdings' ? 'on' : ''} onClick={() => setTab('holdings')}>Holdings <span className="cnt">({rows.length})</span></button>
              <span className="divider-v" />
              <button className={tab === 'theses' ? 'on' : ''} onClick={() => setTab('theses')}>Thesis <span className="cnt">({theses.length})</span></button>
              <span className="divider-v" />
              <button className={tab === 'about' ? 'on' : ''} onClick={() => setTab('about')}>About {cur.symbol}</button>
              <div className="grow" />
              {q && <span className="s12 t2">filtered by “{q}”</span>}
            </div>
            {tab === 'holdings' ? (
              <>
                <div className="table-head"><span>Token</span><span>Position</span><span>Value</span><span>24H</span><span>Of fund</span></div>
                {rows.map(p => (
                  <button key={p.mint} className={`table-row ${p.mint === cur.mint ? 'on' : ''}`} onClick={() => p.pairAddress && !p.stable && onSelect(p.mint)}>
                    <span className="who"><Img src={p.image} fallback={p.symbol.slice(0, 2)} size={24} /><span>{p.symbol}<ChainTag chain={p.chain} short={p.chainShort} color={p.chainColor} name={p.chainName} config={config} /><div className="sub">{usd(p.priceUsd)}</div></span></span>
                    <span className="num">{num(p.amount)}</span>
                    <span className="num">{usd(p.valueUsd)}{p.pnlUsd != null && <div className={`sub ${cls(p.pnlUsd)}`}>{usd(p.pnlUsd)} pnl</div>}</span>
                    <span><Chg v={p.change24} /></span>
                    <span className="num">{total ? `${((p.valueUsd / total) * 100).toFixed(2)}%` : '—'}</span>
                  </button>
                ))}
                {rows.length === 0 && <div className="empty">Nothing matches.</div>}
              </>
            ) : tab === 'theses' ? (
              <>
                <div className="table-head"><span>Token</span><span>Bought</span><span>Spent</span><span>Entry</span><span>Now</span></div>
                {theses.map(t => {
                  const pos = positions.find(p => p.mint === t.token_mint);
                  const pnl = t.buy_usd != null && pos ? ((pos.priceUsd * (t.buy_amount || 0)) - t.buy_usd) : null;
                  return (
                    <button key={t.id} className={`table-row ${t.token_mint === cur.mint ? 'on' : ''}`} onClick={() => pos?.pairAddress && onSelect(t.token_mint)} title={t.thesis}>
                      <span className="who"><Img src={t.image || pos?.image} fallback={(t.symbol || '?').slice(0, 2)} size={24} /><span>{t.symbol || short(t.token_mint, 4)}<div className="sub"><Avatar wallet={t.created_by} size={12} /> {names[t.created_by] || short(t.created_by)} · {t.yes}/{t.yes + t.no} yes</div></span></span>
                      <span className="num">{t.status === 'bought' ? num(t.buy_amount) : <span className="badge buy">Awaiting buy</span>}</span>
                      <span className="num">{t.buy_usd != null ? <>{usd(t.buy_usd)}<div className="sub">{t.buy_sol?.toFixed(t.buy_sol < 1 ? 4 : 2)} {t.buy_native_symbol || 'SOL'}</div></> : '—'}</span>
                      <span className="num">{t.buy_price != null ? usd(t.buy_price) : '—'}</span>
                      <span className="num">{pnl != null ? <span className={cls(pnl)}>{usd(pnl)}</span> : '—'}</span>
                    </button>
                  );
                })}
                {theses.length === 0 && <div className="empty"><b>No thesis yet</b>Tokens the family votes in show up here with what we bought.</div>}
              </>
            ) : (
              <div style={{ padding: 12 }}>
                <div className="kv"><span className="k">Name</span><span className="line" /><span className="v">{cur.name}</span></div>
                <div className="kv"><span className="k">DEX</span><span className="line" /><span className="v">{cur.dexId} · {cur.symbol}/{cur.quoteSymbol || cur.nativeSymbol || 'SOL'}</span></div>
                <div className="kv"><span className="k">Pair</span><span className="line" /><a className="v" href={cur.dexUrl} target="_blank" rel="noreferrer">{short(cur.pairAddress, 6)} ↗</a></div>
                {cur.hasContract !== false && <div className="kv"><span className="k">Contract</span><span className="line" /><a className="v" href={cur.explorerUrl || '#'} target="_blank" rel="noreferrer">{short(cur.mint, 6)} ↗</a></div>}
                <div className="kv"><span className="k">FDV</span><span className="line" /><span className="v">{cur.fdv ? usd(cur.fdv, { compact: true }) : '—'}</span></div>
                <div className="kv"><span className="k">Txns 24H</span><span className="line" /><span className="v">{cur.txns24 ? `${num(cur.txns24.buys, 0)} buys · ${num(cur.txns24.sells, 0)} sells` : '—'}</span></div>
                {(cur.websites?.length || cur.socials?.length) ? (
                  <div className="links" style={{ padding: 0 }}>
                    {cur.websites?.map((w, i) => <a key={i} className="chip soft" href={w.url} target="_blank" rel="noreferrer">{w.label || 'Website'}</a>)}
                    {cur.socials?.map((s, i) => <a key={i} className="chip soft" href={s.url} target="_blank" rel="noreferrer">{s.type}</a>)}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
