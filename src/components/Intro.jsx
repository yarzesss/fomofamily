import React, { useEffect, useState } from 'react';

const STEPS = [
  ['waking the family', 0.3],
  ['reading the treasury wallet', 0.8],
  ['pulling live prices', 1.3],
  ['syncing the chart', 1.8],
  ['opening the chat', 2.2],
];

export default function Intro({ name = 'fomo family', tagline, loaded, onDone }) {
  const [out, setOut] = useState(false);
  const [minTime, setMinTime] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const id = setTimeout(() => setMinTime(true), reduce ? 200 : 3000);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (out) return;
    const finish = () => { setOut(true); window.dispatchEvent(new Event('warp')); setTimeout(onDone, 350); };
    if (minTime && loaded) finish();
    const cap = setTimeout(finish, 7000);
    return () => clearTimeout(cap);
  }, [minTime, loaded, out, onDone]);

  const [a, b = ''] = name.split(' ');
  const letters = s => s.split('').map((ch, i) => <span key={i} style={{ animationDelay: `${0.05 * i}s` }}>{ch}</span>);

  return (
    <div className={`intro ${out ? 'out' : ''}`} onClick={() => { if (!out) { setOut(true); window.dispatchEvent(new Event('warp')); setTimeout(onDone, 350); } }}>
      <div className="inner">
        <img className="intro-logo" src="/logo.png" alt={name} />
        <div className="sub">{tagline || 'where the family never misses out.'}</div>
        <div className="lines">
          {STEPS.map(([label, delay], i) => (
            <div key={i} style={{ animationDelay: `${delay}s` }}>
              <span>{label}</span>
              <span className="ok">{i === STEPS.length - 1 && !loaded ? '…' : 'ok'}</span>
            </div>
          ))}
        </div>
        <div className="bar"><i /></div>
      </div>
      <div className="skip">click anywhere to skip</div>
    </div>
  );
}
