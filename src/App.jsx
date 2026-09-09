import React, { useEffect, useState } from 'react';
import Intro from './components/Intro.jsx';
import Header from './components/Header.jsx';
import BottomBar from './components/BottomBar.jsx';
import Chat from './components/Chat.jsx';
import Charts from './components/Charts.jsx';
import Portfolio from './components/Portfolio.jsx';
import { usePoll } from './lib/hooks.js';
import { SessionProvider } from './lib/session.jsx';
import { FamilyProvider } from './lib/family.jsx';
import Toasts from './components/Toasts.jsx';

export const ConfigContext = React.createContext(null);

export default function App() {
  const [config, setConfig] = useState(null);
  const [introDone, setIntroDone] = useState(false);
  const [view, setView] = useState('charts'); // mobile view: chat | charts | fund
  const [selected, setSelected] = useState(null); // selected mint for the chart
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(setConfig).catch(() => setConfig({}));
  }, []);

  const treasury = usePoll('/api/treasury', config?.refreshMs || 45000, Boolean(config));
  const activity = usePoll('/api/activity', 60000, Boolean(config));

  const positions = treasury.data?.positions || [];
  useEffect(() => {
    if (!selected && positions.length) {
      const voted = treasury.data?.votedMints || [];
      const ok = p => p.pairAddress && !p.stable && (voted.includes(p.mint) || p.native);
      const first = positions.find(p => ok(p) && !p.native) || positions.find(ok);
      if (first) setSelected(first.mint);
    }
  }, [positions, selected]);

  const ready = Boolean(config) && introDone;

  return (
    <ConfigContext.Provider value={config || {}}>
      <SessionProvider chain={config?.tokenChainInfo}>
            <FamilyProvider>
              <Toasts />
              <Intro
                name={config?.projectName || 'Fomo Family Office'}
                tagline={config?.tagline}
                loaded={Boolean(config) && Boolean(treasury.data)}
                onDone={() => setIntroDone(true)}
              />
              <div className={`app ${ready ? 'ready' : ''}`}>
                <Header config={config || {}} treasury={treasury.data} query={query} onQuery={setQuery} />
                <div className={`main view-${view}`}>
                  <Chat activity={activity.data} />
                  <Charts positions={positions} selected={selected} onSelect={setSelected} query={query} total={treasury.data?.totalUsd} projectName={config?.projectName} votedMints={treasury.data?.votedMints ?? null} tokenTicker={config?.tokenTicker} config={config} />
                  <Portfolio treasury={treasury.data} positions={positions} selected={selected} onSelect={m => { setSelected(m); setView('charts'); }} />
                </div>
                <BottomBar positions={positions} treasury={treasury.data} config={config || {}} />
                <nav className="mnav">
                  {[['chat', 'Chat'], ['charts', 'Charts'], ['fund', 'Fund']].map(([k, l]) => (
                    <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}<i /></button>
                  ))}
                </nav>
              </div>
            </FamilyProvider>
      </SessionProvider>
    </ConfigContext.Provider>
  );
}
