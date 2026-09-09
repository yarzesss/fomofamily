import React, { useEffect, useRef } from 'react';
import { usd, pct, cls, short } from '../lib/format.js';
import { useLocalState } from '../lib/hooks.js';
import { useSession } from '../lib/session.jsx';

const SearchIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
const SoundOn = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" /></svg>;
const XIcon = () => <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.9 2H22l-6.8 7.8L23 22h-6.3l-4.9-6.4L6.2 22H3l7.3-8.3L2 2h6.4l4.4 5.9L18.9 2Zm-1.1 18h1.7L7.3 3.8H5.5L17.8 20Z" /></svg>;
const FomoIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="5" /><path d="M9.5 16.5V8H15M9.5 12.4h4" /></svg>;
const SoundOff = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="m23 9-6 6M17 9l6 6" /></svg>;

export default function Header({ config, treasury, query, onQuery }) {
  const [sound, setSound] = useLocalState('fomo.sound', false);
  const session = useSession();
  const ref = useRef(null);
  const [w1, ...rest] = (config.projectName || 'Fomo Family Office').split(' ');
  const w2 = rest.join(' ');

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
        <img className="logo" src="/logo.png" alt="" />
        <span className="word">{w1}{w2 && <> <em>{w2}</em></>}</span>
      </a>
      <span className="social">
      {config.xUrl && <a className="iconbtn" href={config.xUrl} target="_blank" rel="noreferrer" title="Follow on X"><XIcon /></a>}
      {config.fomoUrl && <a className="iconbtn" href={config.fomoUrl} target="_blank" rel="noreferrer" title="Our fomo profile"><FomoIcon /></a>}
      </span>
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
      {session.connected
        ? <button className="pill wallet" onClick={session.signOut} title={session.address}>{short(session.address, 4)}</button>
        : <button className="pill primary wallet" disabled={session.busy} onClick={session.connect}>{session.busy ? 'Check your wallet…' : 'Connect wallet'}</button>}
    </header>
  );
}
