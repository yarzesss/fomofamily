import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cfg, publicConfig } from './config.js';
import { startTreasuryLoop, getTreasury, getActivity, getHistory, refreshTreasury, tokenBalance, getOhlcv } from './treasury.js';
import { isPubkey, issueNonce, loginMessage, verifyLogin, issueToken, requireAuth } from './auth.js';
import { postMessage, setName, recentMessages, deleteMessage, touchMember, memberCount, startChatRealtime, addClient, onlineCount, allNames } from './chat.js';
import { readToken } from './auth.js';
import { refreshFamily, getFamily, isMember, walletPct, currentRound, createProposal, castVote, listProposals, myVotes, boughtMints, startFamilyLoop } from './family.js';

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
  const snap = getTreasury();
  // which tokens show up in the chart bar: SOL + tokens the family voted in (all of them when no family token yet)
  const voted = await boughtMints(); // always: SOL + family-voted tokens only
  res.json({ ...snap, votedMints: voted });
});
app.get('/api/activity', (req, res) => res.json(getActivity()));
app.get('/api/history', (req, res) => {
  const ranges = { '1h': 3600_000, '24h': 86400_000, '7d': 7 * 86400_000, '30d': 30 * 86400_000 };
  res.json(getHistory(ranges[req.query.range] || ranges['24h']));
});
app.get('/api/ohlcv', async (req, res) => {
  const pool = String(req.query.pool || '');
  const chain = String(req.query.chain || 'solana');
  if (!/^([1-9A-HJ-NP-Za-km-z]{32,44}|0x[0-9a-fA-F]{40})$/.test(pool) || !/^[a-z]+$/.test(chain)) return res.status(400).json({ error: 'bad pool' });
  try { res.json(await getOhlcv(pool, String(req.query.tf || '15m'), chain)); }
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

// ---- family gate ----
// With TOKEN_MINT set, chat/votes are for family members only. Without it (pre-launch / test) every signed-in wallet is let in.
function requireFamily(req, res, next) {
  if (cfg.tokenMint && !isMember(req.wallet)) return res.status(403).json({ error: 'family only', code: 'not_family' });
  next();
}

app.get('/api/family', async (req, res) => {
  const h = req.headers.authorization || '';
  const wallet = readToken(h.startsWith('Bearer ') ? h.slice(7) : '');
  const fam = getFamily();
  const { schedule, round, isOpen, closesAt } = await currentRound();
  let me = null;
  if (wallet) {
    const m = fam.members.find(x => x.wallet === wallet);
    me = { wallet, member: isMember(wallet), admin: cfg.adminWallets.includes(wallet), rank: m?.rank || null, pct: m?.pct ?? null };
  }
  res.json({
    enabled: Boolean(cfg.tokenMint),
    supply: fam.supply, updatedAt: fam.updatedAt, error: fam.error,
    members: fam.members, me,
    launchAt: schedule ? (schedule.opensAt - cfg.voteFirstDelayMs) : null,
    round: schedule ? { number: schedule.number, phase: isOpen ? 'open' : schedule.phase === 'pre' ? 'pre' : 'closed', opensAt: schedule.opensAt, closesAt, nextOpensAt: schedule.nextOpensAt || null, eligible: round?.eligible ?? fam.members.length, closedAt: round?.closed_at || null } : null,
    serverTime: Date.now(),
  });
});

// a signed-in non-member can ask for a live balance check (e.g. right after buying)
app.get('/api/family/me', requireAuth, async (req, res) => {
  try {
    await refreshFamily();
    const pct = cfg.tokenMint ? await walletPct(req.wallet) : null;
    res.json({ member: cfg.tokenMint ? isMember(req.wallet) : true, pct, minPct: cfg.familyMinPct, max: cfg.familyMax });
  } catch (e) { res.status(503).json({ error: e.message }); }
});

// ---- chat (family only) ----
app.get('/api/chat', requireAuth, requireFamily, async (req, res) => {
  res.json({ messages: await recentMessages(120), names: await allNames(), online: onlineCount() });
});
app.get('/api/chat/stream', (req, res) => {
  const wallet = readToken(String(req.query.token || ''));
  if (!wallet || (cfg.tokenMint && !isMember(wallet))) return res.status(403).end();
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  addClient(res, wallet);
});
app.post('/api/chat', rateLimit(40, 60_000), requireAuth, requireFamily, async (req, res) => {
  try { res.json(await postMessage(req.wallet, req.body?.body)); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
app.delete('/api/chat/:id', requireAuth, async (req, res) => {
  try { res.json(await deleteMessage(req.wallet, req.params.id)); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
app.post('/api/profile', rateLimit(10, 60_000), requireAuth, requireFamily, async (req, res) => {
  try { res.json(await setName(req.wallet, req.body?.name)); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// ---- voting ----
app.get('/api/proposals', async (req, res) => {
  const h = req.headers.authorization || '';
  const wallet = readToken(h.startsWith('Bearer ') ? h.slice(7) : '');
  const list = await listProposals(req.query.status ? String(req.query.status) : undefined);
  const mine = wallet ? await myVotes(wallet, list.map(p => p.id)) : {};
  res.json({ proposals: list.map(p => ({ ...p, myVote: mine[p.id] || null })), names: await allNames() });
});
app.post('/api/proposals', rateLimit(10, 60_000), requireAuth, requireFamily, async (req, res) => {
  try { res.json(await createProposal(req.wallet, req.body)); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
app.post('/api/vote', rateLimit(60, 60_000), requireAuth, requireFamily, async (req, res) => {
  try { res.json(await castVote(req.wallet, req.body?.proposal_id, req.body?.choice)); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
app.get('/api/theses', async (req, res) => res.json({ theses: await listProposals('passed,bought'), names: await allNames() }));

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
  res.send(indexHtml.replaceAll('content="/og.png"', `content="${origin}/og.png"`).replaceAll('Fomo Family Office — never miss out', `${cfg.projectName} — never miss out`));
});

app.listen(cfg.port, () => {
  console.log(`[fomo family office] listening on :${cfg.port}  rpc=${cfg.rpcUrl.replace(/api-key=.*/, 'api-key=***')}`);
  startTreasuryLoop();
  startChatRealtime();
  startFamilyLoop();
});
