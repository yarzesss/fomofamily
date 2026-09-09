import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usd, pct, cls } from '../lib/format.js';
import { useCountUp, useFlash } from '../lib/hooks.js';
import { accent } from '../lib/format.js';

// "family orbit": every bag is a planet circling the treasury core.
// planet size = share of the portfolio, orbital speed = 24h volatility.
export default function Orbit({ treasury, selected, onSelect }) {
  const t = treasury;
  const total = useCountUp(t?.totalUsd ?? null);
  const flash = useFlash(t?.totalUsd);
  const [hover, setHover] = useState(null);
  const ref = useRef(null);
  const angles = useRef(new Map());
  const [, tick] = useState(0);

  const planets = useMemo(() => {
    if (!t?.positions) return [];
    return t.positions.filter(p => !p.watch && p.valueUsd > 0).slice(0, 9).map((p, i) => {
      const share = p.valueUsd / (t.totalUsd || 1);
      const vol = Math.min(1, Math.abs(p.change24 ?? 0) / 20);
      return {
        ...p,
        share,
        r: 5 + Math.sqrt(share) * 18,               // planet radius
        orbit: 86 + i * 13,                          // orbit radius
        speed: (0.12 + vol * 0.5) * (i % 2 ? 1 : -1), // rad/s, alternate direction
        color: accent(p.symbol),
      };
    });
  }, [t?.positions, t?.totalUsd]);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf, last = performance.now();
    const step = now => {
      const dt = reduce ? 0 : (now - last) / 1000; last = now;
      for (const p of planets) angles.current.set(p.mint, (angles.current.get(p.mint) ?? (p.orbit * 0.7)) + p.speed * dt);
      tick(n => n + 1);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [planets]);

  const S = 380, C = S / 2;
  const mood = t ? moodFor(t.change24Pct) : null;

  return (
    <div className="orbit-wrap" ref={ref}>
      <svg className="orbit" viewBox={`0 0 ${S} 230`} preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id="core" cx="50%" cy="50%">
            <stop offset="0" stopColor="#516af6" stopOpacity="0.9" />
            <stop offset="0.6" stopColor="#516af6" stopOpacity="0.15" />
            <stop offset="1" stopColor="#516af6" stopOpacity="0" />
          </radialGradient>
          <filter id="glow"><feGaussianBlur stdDeviation="2.5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <g transform={`translate(${C} 112)`}>
          {planets.map(p => (
            <ellipse key={p.mint} rx={p.orbit} ry={p.orbit * 0.4} fill="none" stroke="rgba(234,237,255,0.08)" strokeWidth="1" strokeDasharray={p.mint === selected ? '3 3' : undefined} />
          ))}
          <circle r="70" fill="url(#core)" />
          <ellipse rx="78" ry="30" fill="rgba(6,5,16,0.75)" />
          {[...planets].sort((a, b) => Math.sin(angles.current.get(a.mint) || 0) - Math.sin(angles.current.get(b.mint) || 0)).map(p => {
            const a = angles.current.get(p.mint) || 0;
            const x = Math.cos(a) * p.orbit, y = Math.sin(a) * p.orbit * 0.4;
            const depth = 0.6 + 0.4 * ((Math.sin(a) + 1) / 2); // closer = bigger/brighter
            const r = p.r * depth;
            const on = hover?.mint === p.mint || selected === p.mint;
            return (
              <g key={p.mint} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`} style={{ cursor: p.pairAddress ? 'pointer' : 'default' }}
                onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)} onClick={() => p.pairAddress && onSelect?.(p.mint)}>
                <circle r={r + 4} fill={p.color} opacity={on ? 0.35 : 0.12} filter="url(#glow)" />
                <circle r={r} fill={p.color} opacity={0.35 + depth * 0.6} />
                {p.image && <clipPath id={`c${p.mint.slice(0, 6)}`}><circle r={r} /></clipPath>}
                {p.image && <image href={p.image} x={-r} y={-r} width={r * 2} height={r * 2} clipPath={`url(#c${p.mint.slice(0, 6)})`} opacity={0.5 + depth * 0.5} />}
                {r > 9 && !p.image && <text textAnchor="middle" dy="3" fontSize={Math.max(6, r * 0.7)} fill="#fff" fontFamily="var(--mono)" fontWeight="600">{p.symbol.slice(0, 3)}</text>}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="orbit-core">
        <div className="eyebrow">net worth</div>
        <div className={`amount ${flash}`}>{t ? usd(total) : '—'}</div>
        <div className={`mood ${cls(t?.change24Pct)}`}>{t ? `${pct(t.change24Pct)} 24h · ${mood}` : 'reading the chain…'}</div>
      </div>
      <div className="orbit-tip mono">
        {hover ? `${hover.symbol} · ${usd(hover.valueUsd)} · ${(hover.share * 100).toFixed(1)}% · ${pct(hover.change24)} 24h` : planets.length ? `${planets.length} bags in orbit · click a planet for its chart` : 'no bags yet — the family has not bought anything'}
      </div>
    </div>
  );
}

export function moodFor(p) {
  if (p == null) return '';
  if (p >= 10) return "we're so back.";
  if (p >= 3) return 'cooking.';
  if (p > -3) return 'crabbing.';
  if (p > -10) return 'cope mode.';
  return "it's over. (jk)";
}
