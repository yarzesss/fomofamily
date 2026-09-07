import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';
import { api } from './api.js';

const Ctx = createContext(null);
const KEY = 'fomo.session';

export function SessionProvider({ children }) {
  const { publicKey, signMessage, connected } = useWallet();
  const address = publicKey?.toBase58() || null;
  const [token, setToken] = useState(null);
  const [admin, setAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // restore a saved session for this wallet
  useEffect(() => {
    setError(null);
    if (!address) { setToken(null); return; }
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved?.wallet === address && saved.token) {
        api('/api/me', { token: saved.token }).then(() => { setToken(saved.token); setAdmin(Boolean(saved.admin)); }).catch(() => setToken(null));
        return;
      }
    } catch {}
    setToken(null);
  }, [address]);

  const signIn = useCallback(async () => {
    if (!address || !signMessage) { setError('this wallet cannot sign messages'); return; }
    setBusy(true); setError(null);
    try {
      const { nonce, message } = await api('/api/auth/nonce', { body: { wallet: address } });
      const sig = await signMessage(new TextEncoder().encode(message));
      const { token: t, admin: a } = await api('/api/auth/verify', { body: { wallet: address, nonce, signature: bs58.encode(sig) } });
      localStorage.setItem(KEY, JSON.stringify({ wallet: address, token: t, admin: a }));
      setToken(t); setAdmin(Boolean(a));
    } catch (e) {
      setError(e.message?.includes('User rejected') ? 'signature cancelled' : e.message);
    } finally {
      setBusy(false);
    }
  }, [address, signMessage]);

  const signOut = useCallback(() => { localStorage.removeItem(KEY); setToken(null); setAdmin(false); }, []);

  return <Ctx.Provider value={{ address, connected, token, admin, busy, error, signIn, signOut }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
