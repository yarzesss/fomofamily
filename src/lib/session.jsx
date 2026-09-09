import React, { createContext, lazy, Suspense, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';
import { privyState } from './privy-off.js';

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

// ---------- injected wallet: backs the session until (or unless) Privy loads ----------
function useInjectedSession() {
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

  return { address, connected: Boolean(address), hasWallet: Boolean(provider), ready: true, token, admin, busy, error, connect, signIn, signOut };
}

export function SessionProvider({ children, appId, chain }) {
  const injected = useInjectedSession();
  const [privy, setPrivy] = useState(null);
  // Privy takes over as soon as its chunk is in; until then the injected wallet
  // backs the session, so the page never waits on a megabyte of JavaScript.
  const usePrivyStack = Boolean(appId) && !privyState.off;

  return (
    <Ctx.Provider value={privy || injected}>
      {usePrivyStack && (
        <Suspense fallback={null}>
          <PrivyStack appId={appId} chain={chain} onSession={setPrivy} />
        </Suspense>
      )}
      {children}
    </Ctx.Provider>
  );
}

export const useSession = () => useContext(Ctx);
