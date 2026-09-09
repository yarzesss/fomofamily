import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

const root = createRoot(document.getElementById('root'));
const render = () => root.render(<React.StrictMode><App /></React.StrictMode>);
render();

// A bad or expired Privy app id throws while their provider mounts, which tears
// down the whole React root. Remember that, re-render without Privy (the site
// falls back to the injected wallet) and keep the page usable.
export const PRIVY_OFF = 'fomo.privyOff';
window.addEventListener('error', e => {
  const msg = e?.message || '';
  if (/privy/i.test(msg) && !sessionStorage.getItem(PRIVY_OFF)) {
    console.warn('[session] Privy failed to start, falling back to the injected wallet:', msg);
    try { sessionStorage.setItem(PRIVY_OFF, '1'); } catch {}
    render();
  }
});
