import React, { useMemo, useState } from 'react';
import { usePoll } from '../lib/hooks.js';
import { usd, pct, cls } from '../lib/format.js';


// Net-worth line, drawn from server snapshots. Area fill + last-point pulse.
export default function NetWorthChart({ range = '24h' }) {
  const { data } = usePoll(`/api/history?range=${range}`, 60000);
  const pts = data?.points || [];
  const [hover, setHover] = useState(null);

  const geo = useMemo(() => {
    const W = 340, H = 84, P = 4;
    if (pts.length < 2) return null;
    const xs = pts.map(p => p.at), ys = pts.map(p => p.totalUsd);
    const x0 = xs[0], x1 = xs[xs.length - 1];
    let y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (y1 - y0 < y1 * 0.002) { const pad = y1 * 0.002 || 1; y0 -= pad; y1 += pad; }
    const X = t => P + ((t - x0) / Math.max(1, x1 - x0)) * (W - 2 * P);
    const Y = v => H - P - ((v - y0) / (y1 - y0)) * (H - 2 * P);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.at).toFixed(1)},${Y(p.totalUsd).toFixed(1)}`).join(' ');
    const area = `${d} L${X(x1).toFixed(1)},${H} L${X(x0).toFixed(1)},${H} Z`;
    const up = ys[ys.length - 1] >= ys[0];
    return { W, H, d, area, up, X, Y, first: ys[0], last: ys[ys.length - 1] };
  }, [pts]);

  const delta = geo ? geo.last - geo.first : null;
  const deltaPct = geo && geo.first ? (delta / geo.first) * 100 : null;
  const color = geo ? (geo.up ? 'var(--up)' : 'var(--down)') : 'var(--dim)';

  const onMove = e => {
    if (!geo) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * geo.W;
    let best = null, bd = Infinity;
    for (const p of pts) { const dx = Math.abs(geo.X(p.at) - x); if (dx < bd) { bd = dx; best = p; } }
    setHover(best);
  };

  return (
    <div className="nw-chart">
      <svg viewBox={geo ? `0 0 ${geo.W} ${geo.H}` : '0 0 340 84'} preserveAspectRatio="none" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="nwfill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.35" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {geo ? (
          <>
            <path d={geo.area} fill="url(#nwfill)" />
            <path d={geo.d} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            {hover && <>
              <line x1={geo.X(hover.at)} x2={geo.X(hover.at)} y1="0" y2={geo.H} stroke="rgba(255,255,255,.18)" vectorEffect="non-scaling-stroke" />
              <circle cx={geo.X(hover.at)} cy={geo.Y(hover.totalUsd)} r="3" fill={color} />
            </>}
            <circle className="pulse" cx={geo.X(pts[pts.length - 1].at)} cy={geo.Y(geo.last)} r="3" fill={color} />
          </>
        ) : (
          <line x1="0" x2="340" y1="42" y2="42" stroke="var(--line-2)" strokeDasharray="3 4" />
        )}
      </svg>
      <div className="nw-hover mono">
        {hover ? `${usd(hover.totalUsd)} · ${new Date(hover.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ' '}
      </div>
    </div>
  );
}
