import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

// EVM wallet session. We talk to the injected provider directly (MetaMask,
// Rabby, Phantom's EVM side, OKX …) — connect, then sign a plain message.
// Signing costs nothing and sends no transaction.

const Ctx = createContext(null);
const KEY = 'fomo.session';

export const provider = () => (typeof window !== 'undefined' ? window.ethereum : null);

export function SessionProvider({ children, chain }) {
  const [address, setAddress] = useState(null);
  const [token, setToken] = useState(null);
  const [admin, setAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // pick up an already-authorised account without prompting
  useEffect(() => {
    const p = provider();
    if (!p) return;
    p.request({ method: 'eth_accounts' }).then(a => setAddress(a?.[0]?.toLowerCase() || null)).catch(() => {});
    const onAccounts = a => { setAddress(a?.[0]?.toLowerCase() || null); setToken(null); };
    p.on?.('accountsChanged', onAccounts);
    return () => p.removeListener?.('accountsChanged', onAccounts);
  }, []);

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

  const connect = useCallback(async () => {
    const p = provider();
    if (!p) { setError('no wallet found — install MetaMask or Rabby'); return; }
    setBusy(true); setError(null);
    try {
      const accs = await p.request({ method: 'eth_requestAccounts' });
      setAddress(accs?.[0]?.toLowerCase() || null);
    } catch (e) {
      setError(/4001|reject/i.test(e?.message || '') ? 'connection cancelled' : e.message);
    } finally { setBusy(false); }
  }, []);

  // ask the wallet to switch to the family token's chain (adds it if unknown)
  const switchChain = useCallback(async () => {
    const p = provider();
    if (!p || !chain?.chainId) return;
    const hexId = '0x' + Number(chain.chainId).toString(16);
    try {
      await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] });
    } catch (e) {
      if (e?.code !== 4902) return;
      try {
        await p.request({ method: 'wallet_addEthereumChain', params: [{
          chainId: hexId, chainName: chain.name, nativeCurrency: { name: chain.native, symbol: chain.native, decimals: 18 },
          rpcUrls: [chain.rpc].filter(Boolean), blockExplorerUrls: [chain.explorerBase].filter(Boolean),
        }] });
      } catch {}
    }
  }, [chain]);

  const signIn = useCallback(async () => {
    const p = provider();
    if (!p || !address) { setError('connect a wallet first'); return; }
    setBusy(true); setError(null);
    try {
      const { nonce, message } = await api('/api/auth/nonce', { body: { wallet: address } });
      const signature = await p.request({ method: 'personal_sign', params: [message, address] });
      const { token: t, admin: a } = await api('/api/auth/verify', { body: { wallet: address, nonce, signature } });
      localStorage.setItem(KEY, JSON.stringify({ wallet: address, token: t, admin: a }));
      setToken(t); setAdmin(Boolean(a));
    } catch (e) {
      setError(/4001|reject|denied/i.test(e?.message || '') ? 'signature cancelled' : e.message);
    } finally {
      setBusy(false);
    }
  }, [address]);

  const signOut = useCallback(() => { localStorage.removeItem(KEY); setToken(null); setAdmin(false); }, []);

  return (
    <Ctx.Provider value={{ address, connected: Boolean(address), hasWallet: Boolean(provider()), token, admin, busy, error, connect, switchChain, signIn, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export const useSession = () => useContext(Ctx);
