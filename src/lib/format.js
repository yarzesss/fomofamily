export const short = (a, n = 4) => (a ? `${a.slice(0, n)}…${a.slice(-n)}` : '');

export function usd(v, opts = {}) {
  if (v == null || Number.isNaN(v)) return '—';
  const abs = Math.abs(v);
  if (opts.compact && abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (opts.compact && abs >= 10_000) return `$${(v / 1_000).toFixed(1)}K`;
  if (abs >= 1000) return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (abs >= 1) return `$${v.toFixed(2)}`;
  if (abs === 0) return '$0';
  // tiny prices: show significant digits, e.g. $0.0000123
  const digits = Math.min(10, Math.max(4, 2 - Math.floor(Math.log10(abs))));
  return `$${v.toFixed(digits)}`;
}

export function num(v, max = 2) {
  if (v == null) return '—';
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(v / 1e6).toFixed(2)}M`;
  if (abs >= 10_000) return `${(v / 1e3).toFixed(1)}K`;
  return v.toLocaleString('en-US', { maximumFractionDigits: max });
}

export const pct = v => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);
export const cls = v => (v == null || v === 0 ? 'flat' : v > 0 ? 'up' : 'down');

export function ago(ts) {
  if (!ts) return '';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export const hhmm = iso => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// deterministic pastel-ish colour per wallet
export function walletColor(w) {
  let h = 0;
  for (let i = 0; i < w.length; i++) h = (h * 31 + w.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 70% 55%)`;
}

// brand-ish accent colour per token symbol (stable across sessions)
const ACCENTS = ['#516af6', '#fd5dd3', '#21c95e', '#ffbf17', '#ff622e', '#8fd3ff', '#b28dff', '#6ee7b7', '#f9a8d4', '#fcd34d', '#7dd3fc', '#c4b5fd'];
export function accent(sym = '') {
  if (/^SOL$/i.test(sym)) return '#9945ff';
  if (/USDC|USDT/i.test(sym)) return '#2775ca';
  let h = 7;
  for (let i = 0; i < sym.length; i++) h = (h * 33 + sym.charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}

// deterministic avatar per wallet (10 fomo-eyes variants)
export function avatarFor(w = '') {
  let h = 5381;
  for (let i = 0; i < w.length; i++) h = ((h * 33) ^ w.charCodeAt(i)) >>> 0;
  return `/avatars/${(h % 16) + 1}.png`;
}
