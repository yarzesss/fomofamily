import React, { useEffect, useRef, useState } from 'react';
import { createChart, CrosshairMode } from 'lightweight-charts';
import { usd, num } from '../lib/format.js';

const TFS = ['1m', '5m', '15m', '1h', '4h', '1d'];
const GREEN = '#21c95e', RED = '#ff622e';

// Candlestick chart styled like fomo's TradingView panel. Data: /api/ohlcv (GeckoTerminal).
export default function Candles({ token, projectName = 'fomo family' }) {
  const box = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const volRef = useRef(null);
  const maRef = useRef(null);
  const [tf, setTf] = useState('15m');
  const [mode, setMode] = useState('price'); // price | mcap
  const [ma, setMa] = useState(false);
  const [scale, setScale] = useState('linear');
  const [status, setStatus] = useState('loading');
  const [legend, setLegend] = useState(null);
  const dataRef = useRef([]);

  const mcapRatio = token?.marketCap && token?.priceUsd ? token.marketCap / token.priceUsd : null;
  const fmt = v => (mode === 'mcap' ? usd(v, { compact: true }) : usd(v));

  // create chart once
  useEffect(() => {
    const el = box.current;
    const chart = createChart(el, {
      layout: { background: { color: '#12111a' }, textColor: '#9899a3', fontFamily: getComputedStyle(document.body).fontFamily, fontSize: 11 },
      grid: { vertLines: { color: 'rgba(203,208,235,0.05)' }, horzLines: { color: 'rgba(203,208,235,0.05)' } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: 'rgba(203,208,235,0.3)', labelBackgroundColor: '#161522' }, horzLine: { color: 'rgba(203,208,235,0.3)', labelBackgroundColor: '#161522' } },
      rightPriceScale: { borderColor: 'rgba(203,208,235,0.1)', scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale: { borderColor: 'rgba(203,208,235,0.1)', timeVisible: true, secondsVisible: false, rightOffset: 4 },
      handleScroll: true, handleScale: true, autoSize: true,
      localization: { locale: 'en-US' },
    });
    const series = chart.addCandlestickSeries({ upColor: GREEN, downColor: RED, borderUpColor: GREEN, borderDownColor: RED, wickUpColor: GREEN, wickDownColor: RED, priceLineColor: '#516af6' });
    const vol = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    const line = chart.addLineSeries({ color: '#516af6', lineWidth: 1, visible: false, priceLineVisible: false, lastValueVisible: false });
    chartRef.current = chart; seriesRef.current = series; volRef.current = vol; maRef.current = line;
    chart.subscribeCrosshairMove(p => {
      const d = p.seriesData?.get(series);
      if (d) setLegend({ ...d, volume: p.seriesData?.get(vol)?.value });
      else setLegend(dataRef.current[dataRef.current.length - 1] || null);
    });
    return () => chart.remove();
  }, []);

  // load data
  useEffect(() => {
    if (!token?.pairAddress) return;
    let alive = true;
    setStatus('loading');
    const load = async () => {
      try {
        const res = await fetch(`/api/ohlcv?pool=${token.pairAddress}&tf=${tf}`);
        const json = await res.json();
        if (!alive) return;
        if (!res.ok || !json.candles?.length) { setStatus('empty'); return; }
        const k = mode === 'mcap' && mcapRatio ? mcapRatio : 1;
        const candles = json.candles.map(c => ({ time: c.time, open: c.open * k, high: c.high * k, low: c.low * k, close: c.close * k, volume: c.volume }));
        dataRef.current = candles;
        const s = seriesRef.current, v = volRef.current;
        const price = candles[candles.length - 1].close;
        const precision = price >= 100 ? 2 : price >= 1 ? 4 : Math.min(10, Math.max(4, 2 - Math.floor(Math.log10(price || 1))));
        s.applyOptions({ priceFormat: mode === 'mcap' ? { type: 'custom', formatter: x => usd(x, { compact: true }) } : { type: 'price', precision, minMove: Math.pow(10, -precision) } });
        s.setData(candles);
        v.setData(candles.map(c => ({ time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(33,201,94,0.35)' : 'rgba(255,98,46,0.35)' })));
        const win = 20, maPts = candles.map((c, i) => i < win - 1 ? null : { time: c.time, value: candles.slice(i - win + 1, i + 1).reduce((a, x) => a + x.close, 0) / win }).filter(Boolean);
        maRef.current.setData(maPts);
        chartRef.current.timeScale().fitContent();
        setLegend(candles[candles.length - 1]);
        setStatus('ok');
      } catch { if (alive) setStatus('empty'); }
    };
    load();
    const id = setInterval(load, tf === '1m' ? 15000 : 30000);
    return () => { alive = false; clearInterval(id); };
  }, [token?.pairAddress, tf, mode, mcapRatio]);

  useEffect(() => { maRef.current?.applyOptions({ visible: ma }); }, [ma]);
  useEffect(() => { chartRef.current?.priceScale('right').applyOptions({ mode: scale === 'log' ? 1 : 0 }); }, [scale]);

  const up = legend ? legend.close >= legend.open : true;
  const chg = legend ? ((legend.close - legend.open) / legend.open) * 100 : 0;

  return (
    <div className="tv">
      <div className="tv-bar">
        {TFS.map(t => <button key={t} className={t === tf ? 'on' : ''} onClick={() => setTf(t)}>{t.toUpperCase()}</button>)}
        <span className="divider-v" />
        <button className={ma ? 'on' : ''} onClick={() => setMa(v => !v)}>Indicators</button>
        <span className="divider-v" />
        <button className={mode === 'price' ? 'on' : ''} onClick={() => setMode('price')}>Price</button>
        <span className="t3">/</span>
        <button className={mode === 'mcap' ? 'on' : ''} onClick={() => mcapRatio && setMode('mcap')} disabled={!mcapRatio}>MCap</button>
        <div className="grow" />
        <button className={scale === 'log' ? 'on' : ''} onClick={() => setScale(s => (s === 'log' ? 'linear' : 'log'))}>log</button>
        <button onClick={() => chartRef.current?.timeScale().fitContent()}>auto</button>
        {token?.dexUrl && <a href={token.dexUrl} target="_blank" rel="noreferrer" title="Open on DexScreener">↗</a>}
      </div>
      <div className="tv-legend">
        <span className="nm">{token?.symbol} · {tf} · {projectName}</span>
        {legend && (
          <span className={up ? 'up' : 'down'}>
            <span className="t2">O</span>{fmt(legend.open)} <span className="t2">H</span>{fmt(legend.high)} <span className="t2">L</span>{fmt(legend.low)} <span className="t2">C</span>{fmt(legend.close)}
            <span> {chg >= 0 ? '+' : ''}{chg.toFixed(2)}%</span>
            {legend.volume != null && <span className="t2"> · Vol {num(legend.volume, 0)}</span>}
          </span>
        )}
      </div>
      <div className="tv-canvas" ref={box} />
      {status !== 'ok' && (
        <div className="tv-status">
          {status === 'loading' ? 'Loading chart…' : <>No candle data for this pair yet. {token?.dexUrl && <a href={token.dexUrl} target="_blank" rel="noreferrer">Open on DexScreener ↗</a>}</>}
        </div>
      )}
    </div>
  );
}
