import React, { useCallback, useEffect, useState } from 'react';
import { PrivyProvider, usePrivy, useWallets } from '@privy-io/react-auth';
import { useRestore, useSignIn } from './session.jsx';

// ---------- Privy ----------
function PrivyBridge({ onSession }) {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const [token, setToken] = useState(null);
  const [admin, setAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // an external wallet holds the tokens, so prefer it over an embedded one
  const wallet = wallets.find(w => w.walletClientType !== 'privy') || wallets[0] || null;
  const address = wallet?.address?.toLowerCase() || null;

  useRestore(address, setToken, setAdmin);
  const signIn = useSignIn({ address, getProvider: () => wallet.getEthereumProvider(), setToken, setAdmin, setBusy, setError });

  const connect = useCallback(async () => {
    setError(null);
    try { await login(); } catch (e) { setError(e.message); }
  }, [login]);

  const signOut = useCallback(async () => {
    localStorage.removeItem(KEY); setToken(null); setAdmin(false);
    try { await logout(); } catch {}
  }, [logout]);

  const value = { address, connected: Boolean(address), hasWallet: true, ready: ready && (!authenticated || wallets.length > 0), token, admin, busy, error, connect, signIn, signOut };
  useEffect(() => { onSession(value); }, [address, token, admin, busy, error, ready, authenticated, wallets.length]);
  return null;
}


// Mounted lazily: the Privy bundle is big, so it loads in its own chunk while
// the rest of the site is already on screen.
export default function PrivyStack({ appId, chain, onSession }) {
  const viemChain = chain && {
    id: chain.chainId,
    name: chain.name,
    network: chain.id,
    nativeCurrency: { name: chain.native, symbol: chain.native, decimals: 18 },
    rpcUrls: { default: { http: [chain.rpc] }, public: { http: [chain.rpc] } },
    blockExplorers: chain.explorerBase ? { default: { name: 'Explorer', url: chain.explorerBase } } : undefined,
  };
  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: { theme: 'dark', accentColor: '#516af6', logo: '/logo.png', walletChainType: 'ethereum-only' },
        loginMethods: ['wallet', 'email'],
        embeddedWallets: { createOnLogin: 'users-without-wallets' },
        ...(viemChain ? { defaultChain: viemChain, supportedChains: [viemChain] } : {}),
      }}
    >
      <PrivyBridge onSession={onSession} />
    </PrivyProvider>
  );
}
