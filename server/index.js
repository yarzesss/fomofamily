import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cfg, publicConfig } from './config.js';
import { startTreasuryLoop, getTreasury, getActivity, getHistory, refreshTreasury, tokenBalance, getOhlcv } from './treasury.js';
import { isPubkey, issueNonce, loginMessage, verifyLogin, issueToken, requireAuth } from './auth.js';
import { postMessage, setName, recentMessages, deleteMessage, touchMember, memberCount } from './chat.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

app.set('trust proxy', 1); // Railway sits behind a proxy
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Tiny per-IP rate limiter for the write endpoints (no dependency needed).
const buckets = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const b = buckets.get(key) || { n: 0, reset: now + windowMs };
    if (now > b.reset) { b.n = 0; b.reset = now + windowMs; }
    b.n++;
    buckets.set(key, b);
    if (buckets.size > 10000) buckets.clear();
    if (b.n > max) return res.status(429).json({ error: 'too many requests, chill' });
    next();
  };
}

// ---- public runtime config ----
app.get('/api/config', (req, res) => res.json(publicConfig()));

// ---- treasury ----
app.get('/api/treasury', async (req, res) => {
  const t = getTreasury();
  if (!t.updatedAt) await refreshTreasury();
  res.json(getTreasury());
});
app.get('/api/activity', (req, res) => res.json(getActivity()));
app.get('/api/history', (req, res) => {
  const ranges = { '1h': 3600_000, '24h': 86400_000, '7d': 7 * 86400_000, '30d': 30 * 86400_000 };
  res.json(getHistory(ranges[req.query.range] || ranges['24h']));
});
app.get('/api/ohlcv', async (req, res) => {
  const pool = String(req.query.pool || '');
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(pool)) return res.status(400).json({ error: 'bad pool' });
  try { res.json(await getOhlcv(pool, String(req.query.tf || '15m'))); }
  catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/stats', async (req, res) => res.json({ members: await memberCount() }));

// ---- wallet sign-in ----
app.post('/api/auth/nonce', rateLimit(30, 60_000), (req, res) => {
  const { wallet } = req.body || {};
  if (!isPubkey(wallet)) return res.status(400).json({ error: 'bad wallet' });
  const nonce = issueNonce(wallet);
  res.json({ nonce, message: loginMessage(wallet, nonce) });
});

app.post('/api/auth/verify', rateLimit(20, 60_000), async (req, res) => {
  const { wallet, nonce, signature } = req.body || {};
  if (!isPubkey(wallet) || typeof nonce !== 'string' || typeof signature !== 'string') return res.status(400).json({ error: 'bad request' });
  if (!verifyLogin(wallet, nonce, signature)) return res.status(401).json({ error: 'signature check failed' });
  if (cfg.chatHoldersOnly && cfg.tokenMint) {
    try {
      const bal = await tokenBalance(wallet, cfg.tokenMint);
      if (bal < Math.max(cfg.minTokenBalance, 1e-9)) return res.status(403).json({ error: `holders only — you need ${cfg.tokenTicker} to chat` });
    } catch (e) {
      return res.status(503).json({ error: 'could not verify your balance, try again' });
    }
  }
  touchMember(wallet);
  res.json({ token: issueToken(wallet), wallet, admin: cfg.adminWallets.includes(wallet) });
});

app.get('/api/me', requireAuth, (req, res) => res.json({ wallet: req.wallet }));

// ---- chat ----
app.get('/api/chat', async (req, res) => res.json(await recentMessages(100)));
app.post('/api/chat', rateLimit(40, 60_000), requireAuth, async (req, res) => {
  try {
    res.json(await postMessage(req.wallet, req.body?.body));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});
app.delete('/api/chat/:id', requireAuth, async (req, res) => {
  try {
    res.json(await deleteMessage(req.wallet, req.params.id));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});
app.post('/api/profile', rateLimit(10, 60_000), requireAuth, async (req, res) => {
  try {
    res.json(await setName(req.wallet, req.body?.name));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true, treasury: getTreasury().ok, updatedAt: getTreasury().updatedAt }));

// ---- static client ----
const dist = path.join(__dirname, '..', 'dist');
app.use(express.static(dist, { maxAge: '1h', index: false }));
// index.html with absolute OG image URL (crawlers ignore relative og:image)
app.get(/^(?!\/api\/).*/, (req, res) => {
  let indexHtml;
  try { indexHtml = fs.readFileSync(path.join(dist, 'index.html'), 'utf8'); } catch { return res.status(503).send('build missing — run npm run build'); }
  const origin = `${req.protocol}://${req.get('host')}`;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.send(indexHtml.replaceAll('content="/og.png"', `content="${origin}/og.png"`).replaceAll('fomo family — never miss out', `${cfg.projectName} — never miss out`));
});

app.listen(cfg.port, () => {
  console.log(`[fomo family] listening on :${cfg.port}  rpc=${cfg.rpcUrl.replace(/api-key=.*/, 'api-key=***')}`);
  startTreasuryLoop();
});
