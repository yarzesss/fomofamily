import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useSession } from './session.jsx';

const Ctx = createContext(null);

// Family state: members, my membership, current voting round + a ticking clock.
export function FamilyProvider({ children }) {
  const session = useSession();
  const [data, setData] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [offset, setOffset] = useState(0); // server clock - client clock

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/family', { headers: session.token ? { authorization: `Bearer ${session.token}` } : {} });
      const json = await res.json();
      setData(json);
      if (json.serverTime) setOffset(json.serverTime - Date.now());
    } catch {}
  }, [session.token]);

  useEffect(() => { load(); const id = setInterval(load, 20000); return () => clearInterval(id); }, [load]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);

  // re-check membership on demand (after a buy)
  const recheck = useCallback(async () => {
    if (!session.token) return null;
    const res = await fetch('/api/family/me', { headers: { authorization: `Bearer ${session.token}` } });
    const json = await res.json();
    await load();
    return json;
  }, [session.token, load]);

  const serverNow = now + offset;
  const round = data?.round || null;
  let countdown = null; // { label, ms }
  if (round) {
    if (round.phase === 'pre' || round.phase === 'closed') {
      const t = round.phase === 'pre' ? round.opensAt : round.nextOpensAt;
      if (t) countdown = { label: `Round ${round.phase === 'pre' ? round.number : round.number + 1} opens in`, ms: Math.max(0, t - serverNow), open: false };
    } else {
      countdown = { label: `Round ${round.number} closes in`, ms: Math.max(0, round.closesAt - serverNow), open: true };
    }
  }
  const isMember = data?.me ? data.me.member : false;

  return <Ctx.Provider value={{ ...(data || {}), loaded: Boolean(data), isMember, round, countdown, serverNow, reload: load, recheck }}>{children}</Ctx.Provider>;
}

export const useFamily = () => useContext(Ctx);

export const fmtCountdown = ms => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};
