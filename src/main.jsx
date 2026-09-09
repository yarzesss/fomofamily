import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import { privyState } from './lib/privy-off.js';

const root = createRoot(document.getElementById('root'));
const render = () => root.render(<React.StrictMode><App /></React.StrictMode>);
render();

// A bad or expired Privy app id throws while their provider mounts, which tears
// down the whole React root. Remember that, re-render without Privy (the site
// falls back to the injected wallet) and keep the page usable.
window.addEventListener('error', e => {
  const msg = e?.message || '';
  if (/privy/i.test(msg) && !privyState.off) {
    console.warn('[session] Privy failed to start, falling back to the injected wallet:', msg);
    privyState.off = true;
    render();
  }
});
