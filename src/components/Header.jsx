import React, { useEffect, useRef } from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { usd, pct, cls } from '../lib/format.js';
import { useLocalState } from '../lib/hooks.js';
import { useSession } from '../lib/session.jsx';

const SearchIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
const SoundOn = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" /></svg>;
const SoundOff = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="m23 9-6 6M17 9l6 6" /></svg>;

export default function Header({ config, treasury, query, onQuery }) {
  const [sound, setSound] = useLocalState('fomo.sound', false);
  const session = useSession();
  const ref = useRef(null);
  const [w1, w2 = ''] = (config.projectName || 'fomo family').split(' ');

  useEffect(() => {
    const onKey = e => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); ref.current?.focus(); }
      if (e.key === 'Escape') { onQuery(''); ref.current?.blur(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onQuery]);

  return (
    <header className="top">
      <a className="brand" href="/" title={config.projectName}>
        <img className="logo" src="/logo.png" alt={config.projectName} />
      </a>
      <div className="grow" />
      <label className="search">
        <SearchIcon />
        <input ref={ref} value={query} onChange={e => onQuery(e.target.value)} placeholder="Search the fund's tokens..." />
        {query ? <button className="kbd" onClick={() => onQuery('')}>esc</button> : <span className="kbd">/</span>}
      </label>
      {treasury?.ok && (
        <div className="stat-cell" title="treasury net worth">
          <span className="v">{usd(treasury.totalUsd, { compact: true })} <span className="t3">fund</span></span>
          <span className={`k ${cls(treasury.change24Pct)}`} style={{ color: undefined }}>{pct(treasury.change24Pct)} 24h</span>
        </div>
      )}
      {config.stonkUrl && <a className="pill primary" href={config.stonkUrl} target="_blank" rel="noreferrer">Buy {config.tokenTicker}</a>}
      <button className={`iconbtn ${sound ? 'on' : ''}`} onClick={() => setSound(v => !v)} title={sound ? 'trade sounds on' : 'trade sounds off'}>
        {sound ? <SoundOn /> : <SoundOff />}
      </button>
      <WalletMultiButton>{session.connected ? undefined : 'Connect wallet'}</WalletMultiButton>
    </header>
  );
}
