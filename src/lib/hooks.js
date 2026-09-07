import { useEffect, useRef, useState } from 'react';

// Polls an endpoint on an interval; keeps the last good value on error.
export function usePoll(path, ms, enabled = true) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(path);
        const json = await res.json();
        if (alive) { setData(json); setError(null); }
      } catch (e) {
        if (alive) setError(e.message);
      }
    };
    load();
    const id = setInterval(load, ms);
    const onVis = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [path, ms, enabled]);
  return { data, error };
}

// Smoothly animates a number towards its target (fomo-style ticking counters).
export function useCountUp(target, duration = 900) {
  const [value, setValue] = useState(target ?? 0);
  const fromRef = useRef(target ?? 0);
  useEffect(() => {
    if (target == null) return;
    const from = fromRef.current;
    const to = target;
    if (from === to) return;
    const start = performance.now();
    let raf;
    const step = now => {
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - t, 3);
      const v = from + (to - from) * e;
      setValue(v);
      if (t < 1) raf = requestAnimationFrame(step);
      else fromRef.current = to;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

// Returns 'flash-up' / 'flash-down' for ~1s whenever the value moves.
export function useFlash(value) {
  const prev = useRef(value);
  const [flash, setFlash] = useState('');
  useEffect(() => {
    if (value == null || prev.current == null) { prev.current = value; return; }
    if (value !== prev.current) {
      setFlash(value > prev.current ? 'flash-up' : 'flash-down');
      prev.current = value;
      const id = setTimeout(() => setFlash(''), 1200);
      return () => clearTimeout(id);
    }
  }, [value]);
  return flash;
}

export function useLocalState(key, initial) {
  const [v, setV] = useState(() => {
    try { const s = localStorage.getItem(key); return s == null ? initial : JSON.parse(s); } catch { return initial; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }, [key, v]);
  return [v, setV];
}
