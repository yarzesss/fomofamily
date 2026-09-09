import React from 'react';
import { usd } from '../lib/format.js';

const COLORS = ['#516af6', '#fd5dd3', '#21c95e', '#ffbf17', '#ff622e', '#8fd3ff', '#b28dff', '#6ee7b7', '#f9a8d4', '#fcd34d'];

// Allocation donut: top positions by value, rest grouped as "other".
export default function AllocationRing({ positions, total }) {
  if (!positions?.length || !total) {
    return <div className="alloc-empty">The ring fills in once the treasury holds its first position.</div>;
  }
  const held = positions.filter(p => !p.watch && p.valueUsd > 0).slice(0, 8);
  const rest = total - held.reduce((s, p) => s + p.valueUsd, 0);
  const slices = [...held.map((p, i) => ({ label: p.symbol, v: p.valueUsd, c: COLORS[i % COLORS.length] })), ...(rest > 0.5 ? [{ label: 'other', v: rest, c: '#3a3950' }] : [])];
  const R = 34, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="alloc">
      <svg viewBox="0 0 84 84" width="84" height="84">
        {slices.map((s, i) => {
          const len = (s.v / total) * C;
          const el = (
            <circle key={i} cx="42" cy="42" r={R} fill="none" stroke={s.c} strokeWidth="9"
              strokeDasharray={`${Math.max(0, len - 1.5)} ${C}`} strokeDashoffset={-acc} transform="rotate(-90 42 42)"
              style={{ transition: 'stroke-dasharray .8s var(--ease), stroke-dashoffset .8s var(--ease)' }} />
          );
          acc += len;
          return el;
        })}
        <text x="42" y="46" textAnchor="middle" fill="var(--dim)" fontSize="9" fontFamily="var(--mono)">{slices.length} bags</text>
      </svg>
      <div className="alloc-legend">
        {slices.map((s, i) => (
          <div key={i}><i style={{ background: s.c }} /><span>{s.label}</span><b className="mono">{((s.v / total) * 100).toFixed(1)}%</b></div>
        ))}
      </div>
    </div>
  );
}
