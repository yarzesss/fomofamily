import React, { createContext, lazy, Suspense, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const PrivyStack = lazy(() => import('./privy-session.jsx'));

// Sign-in. Privy runs the wallet flow (external wallet, email, socials); we
// still prove ownership ourselves — the server hands out a nonce, the wallet
// signs it, and only a valid signature opens a session. Signing costs nothing
// and sends no transaction.
//
// Without PRIVY_APP_ID the site falls back to the injected wallet directly, so
// it keeps working before the Privy app is created.

export const Ctx = createContext(null);
const KEY = 'fomo.session';

// Shared bit: nonce → signature → session token.
export function useSignIn({ address, getProvider, setToken, setAdmin, setBusy, setError }) {
  return useCallback(async () => {
    if (!address) { setError('connect a wallet first'); return; }
    setBusy(true); setError(null);
    try {
      const { nonce, message } = await api('/api/auth/nonce', { body: { wallet: address } });
      const p = await getProvider();
      const signature = await p.request({ method: 'personal_sign', params: [message, address] });
      const { token: t, admin: a } = await api('/api/auth/verify', { body: { wallet: address, nonce, signature } });
      localStorage.setItem(KEY, JSON.stringify({ wallet: address.toLowerCase(), token: t, admin: a }));
      setToken(t); setAdmin(Boolean(a));
    } catch (e) {
      setError(/4001|reject|denied|cancel/i.test(e?.message || '') ? 'signature cancelled' : e.message);
    } finally {
      setBusy(false);
    }
  }, [address, getProvider]);
}

// Restores a saved session for the connected wallet.
export function useRestore(address, setToken, setAdmin) {
  useEffect(() => {
    if (!address) { setToken(null); return; }
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved?.wallet === address.toLowerCase() && saved.token) {
        api('/api/me', { token: saved.token })
          .then(() => { setToken(saved.token); setAdmin(Boolean(saved.admin)); })
          .catch(() => setToken(null));
        return;
      }
    } catch {}
    setToken(null);
  }, [address]);
}

// ---------- fallback: injected wallet, no Privy app configured ----------
function InjectedSession({ children }) {
  const provider = typeof window !== 'undefined' ? window.ethereum : null;
  const [address, setAddress] = useState(null);
  const [token, setToken] = useState(null);
  const [admin, setAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!provider) return;
    provider.request({ method: 'eth_accounts' }).then(a => setAddress(a?.[0]?.toLowerCase() || null)).catch(() => {});
    const onAccounts = a => { setAddress(a?.[0]?.toLowerCase() || null); setToken(null); };
    provider.on?.('accountsChanged', onAccounts);
    return () => provider.removeListener?.('accountsChanged', onAccounts);
  }, []);

  useRestore(address, setToken, setAdmin);
  const signIn = useSignIn({ address, getProvider: async () => provider, setToken, setAdmin, setBusy, setError });

  const connect = useCallback(async () => {
    if (!provider) { setError('no wallet found — install MetaMask or Rabby'); return; }
    setBusy(true); setError(null);
    try {
      const accs = await provider.request({ method: 'eth_requestAccounts' });
      setAddress(accs?.[0]?.toLowerCase() || null);
    } catch (e) {
      setError(/4001|reject/i.test(e?.message || '') ? 'connection cancelled' : e.message);
    } finally { setBusy(false); }
  }, [provider]);

  const signOut = useCallback(() => { localStorage.removeItem(KEY); setToken(null); setAdmin(false); }, []);

  const value = { address, connected: Boolean(address), hasWallet: Boolean(provider), ready: true, token, admin, busy, error, connect, signIn, signOut };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// A bad or expired Privy app id throws while rendering their provider. Without
// this the whole page would go blank, so we catch it and fall back to the
// injected wallet — the site stays usable either way.
class PrivyBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e) { console.warn('[session] Privy unavailable, using the injected wallet instead:', e?.message); }
  render() {
    return this.state.failed ? <InjectedSession>{this.props.children}</InjectedSession> : this.props.children;
  }
}

export function SessionProvider({ children, appId, chain }) {
  // main.jsx flips this when Privy fails to start, so a broken app id degrades
  // to the injected wallet instead of a blank page.
  let broken = false;
  try { broken = Boolean(sessionStorage.getItem('fomo.privyOff')); } catch {}

  if (!appId || broken) return <InjectedSession>{children}</InjectedSession>;
  // Nothing renders until Privy is in: the intro screen is still covering the
  // page at that point, so this is invisible and avoids a double mount.
  return (
    <PrivyBoundary>
      <Suspense fallback={null}>
        <PrivyStack appId={appId} chain={chain}>{children}</PrivyStack>
      </Suspense>
    </PrivyBoundary>
  );
}

export const useSession = () => useContext(Ctx);
