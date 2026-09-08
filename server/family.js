// The family: top holders of the family token, voting rounds, proposals, buy detection.

import { cfg } from './config.js';
import { rpc, priceMints, getTreasury, getActivity } from './treasury.js';
import { chatDb, postSystem, broadcast } from './chat.js';

const KNOWN_POOL_AUTHORITIES = new Set([
  '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', // raydium amm authority
  'GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL', // raydium cpmm authority
  'HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8', // raydium clmm? (best effort)
  '39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg', // pump.fun amm
  'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM', // pump.fun fee
]);

// ---------- holders / family ----------
let family = { updatedAt: 0, supply: 0, decimals: 0, members: [], error: null };
let refreshingFamily = null;

export async function refreshFamily() {
  if (!cfg.tokenMint) return family;
  if (refreshingFamily) return refreshingFamily;
  refreshingFamily = (async () => {
    try {
      const [supplyRes, largest] = await Promise.all([
        rpc('getTokenSupply', [cfg.tokenMint]),
        rpc('getTokenLargestAccounts', [cfg.tokenMint, { commitment: 'confirmed' }]),
      ]);
      const supply = Number(supplyRes.value.uiAmount || 0);
      const accounts = (largest.value || []).filter(a => Number(a.uiAmount) > 0);
      // token account -> owner wallet
      const infos = accounts.length ? await rpc('getMultipleAccounts', [accounts.map(a => a.address), { encoding: 'jsonParsed' }]) : { value: [] };
      const exclude = new Set([cfg.treasuryWallet, ...cfg.familyExclude, ...KNOWN_POOL_AUTHORITIES]);
      const pairs = new Set((getTreasury().positions || []).map(p => p.pairAddress).filter(Boolean));
      const byOwner = new Map();
      accounts.forEach((a, i) => {
        const owner = infos.value?.[i]?.data?.parsed?.info?.owner;
        const ownerProgram = infos.value?.[i]?.owner;
        if (!owner || exclude.has(owner) || pairs.has(owner)) return;
        if (ownerProgram && ownerProgram !== 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' && ownerProgram !== 'TokenzQdBNbLqP5VEHdkAS6EPFLC1PHnBqCXEpPxuEb') return;
        byOwner.set(owner, (byOwner.get(owner) || 0) + Number(a.uiAmount));
      });
      // owners that are programs/PDAs (off-curve) are pools, not people — drop them
      const owners = [...byOwner.keys()];
      const ownerInfos = owners.length ? await rpc('getMultipleAccounts', [owners, { encoding: 'base64' }]) : { value: [] };
      const members = owners
        .map((w, i) => ({ wallet: w, balance: byOwner.get(w), pct: supply ? (byOwner.get(w) / supply) * 100 : 0, isProgramOwned: Boolean(ownerInfos.value?.[i]) && ownerInfos.value[i].owner !== '11111111111111111111111111111111' }))
        .filter(m => !m.isProgramOwned && (cfg.familyMinPct <= 0 || m.pct >= cfg.familyMinPct))
        .sort((a, b) => b.balance - a.balance)
        .slice(0, cfg.familyMax)
        .map((m, i) => ({ rank: i + 1, wallet: m.wallet, balance: m.balance, pct: m.pct }));
      family = { updatedAt: Date.now(), supply, members, error: null };
    } catch (e) {
      console.warn('[family]', e.message);
      family = { ...family, error: e.message };
    } finally {
      refreshingFamily = null;
    }
  })();
  return refreshingFamily;
}

export const getFamily = () => family;
// no family token configured yet (pre-launch / test mode) → every signed-in wallet counts as family
// admins (ADMIN_WALLETS) are always in, regardless of holdings
export const isMember = wallet => !cfg.tokenMint || cfg.adminWallets.includes(wallet) || family.members.some(m => m.wallet === wallet);

// live balance check for one wallet (used on sign-in so a fresh buyer isn't stuck waiting 60s)
export async function walletPct(wallet) {
  if (!cfg.tokenMint || !family.supply) return 0;
  const r = await rpc('getTokenAccountsByOwner', [wallet, { mint: cfg.tokenMint }, { encoding: 'jsonParsed' }]);
  const bal = (r?.value || []).reduce((s, a) => s + (a.account.data.parsed.info.tokenAmount.uiAmount || 0), 0);
  return (bal / family.supply) * 100;
}

// ---------- schedule ----------
// round 1 opens LAUNCH + firstDelay and lasts firstDuration; round n>1 opens every `interval` after round 1 and lasts until the next one.
export function launchAt() {
  if (cfg.launchAt) return cfg.launchAt;
  const tok = (getTreasury().positions || []).find(p => p.mint === cfg.tokenMint);
  return tok?.pairCreatedAt || null;
}
export function scheduleAt(now = Date.now()) {
  const L = launchAt();
  if (!L) return null;
  const first = L + cfg.voteFirstDelayMs;
  if (now < first) return { phase: 'pre', number: 1, opensAt: first, closesAt: first + cfg.voteFirstDurationMs };
  const n = 1 + Math.floor((now - first) / cfg.voteIntervalMs);
  const opensAt = first + (n - 1) * cfg.voteIntervalMs;
  const closesAt = n === 1 ? first + cfg.voteFirstDurationMs : opensAt + cfg.voteIntervalMs;
  return { phase: now < closesAt ? 'open' : 'gap', number: n, opensAt, closesAt, nextOpensAt: first + n * cfg.voteIntervalMs };
}

// ---------- rounds (persisted so early-close sticks) ----------
async function ensureRound(sched) {
  const db = chatDb();
  if (!db || !sched || sched.phase === 'pre') return null;
  const { data } = await db.from('rounds').select('*').eq('number', sched.number).maybeSingle();
  if (data) return data;
  const { data: created, error } = await db.from('rounds').insert({ number: sched.number, opens_at: new Date(sched.opensAt).toISOString(), closes_at: new Date(sched.closesAt).toISOString(), eligible: family.members.length }).select().single();
  if (error) { const { data: again } = await db.from('rounds').select('*').eq('number', sched.number).maybeSingle(); return again; }
  postSystem(`🗳️ Round ${sched.number} is open — the family is voting.`);
  return created;
}

export async function currentRound() {
  const sched = scheduleAt();
  if (!sched) return { schedule: null, round: null };
  const round = await ensureRound(sched);
  const closed = round?.closed_at ? new Date(round.closed_at).getTime() : null;
  const isOpen = sched.phase === 'open' && !closed;
  return { schedule: sched, round, isOpen, closesAt: closed || sched.closesAt };
}

// ---------- proposals & votes ----------
const err = (m, s) => Object.assign(new Error(m), { status: s });
const isMint = s => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s || '');

export async function createProposal(wallet, body) {
  const db = chatDb();
  if (!db) throw err('voting is not configured', 503);
  if (!isMember(wallet)) throw err('family only', 403);
  const mint = String(body?.token_mint || '').trim();
  const thesis = String(body?.thesis || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const pctv = Number(body?.treasury_pct);
  if (!isMint(mint)) throw err('bad token address', 400);
  if (thesis.length < 1 || thesis.length > 500) throw err('thesis: 1–500 characters', 400);
  if (!(pctv >= 0.5 && pctv <= cfg.voteMaxPct)) throw err(`treasury %: 0.5–${cfg.voteMaxPct}`, 400);
  const { round, isOpen, schedule } = await currentRound();
  if (!schedule && cfg.tokenMint) throw err('voting opens after launch', 400); // test mode: proposals allowed any time
  const { data: dup } = await db.from('proposals').select('id').eq('token_mint', mint).in('status', ['open', 'passed']).limit(1);
  if (dup?.length) throw err('this token is already proposed', 409);
  const meta = (await priceMints([mint]))[mint];
  const { data, error } = await db.from('proposals').insert({
    round_id: isOpen ? round?.id : null, created_by: wallet, token_mint: mint,
    symbol: meta?.symbol || null, name: meta?.name || null, image: meta?.image || null, pair_address: meta?.pairAddress || null,
    thesis, treasury_pct: pctv,
  }).select().single();
  if (error) throw err(error.message, 500);
  broadcast({ type: 'proposals' });
  postSystem(`💡 New proposal: ${data.symbol || mint.slice(0, 6)} for ${pctv}% of the treasury.`);
  return data;
}

export async function castVote(wallet, proposalId, choice) {
  const db = chatDb();
  if (!db) throw err('voting is not configured', 503);
  if (!isMember(wallet)) throw err('family only', 403);
  if (!['yes', 'no'].includes(choice)) throw err('choice must be yes/no', 400);
  const { round, isOpen } = await currentRound();
  if (!isOpen || !round) throw err('voting is closed right now', 400);
  const { data: p } = await db.from('proposals').select('*').eq('id', Number(proposalId)).maybeSingle();
  if (!p || p.status !== 'open') throw err('proposal not open', 400);
  if (p.round_id == null) await db.from('proposals').update({ round_id: round.id }).eq('id', p.id);
  else if (p.round_id !== round.id) throw err('proposal belongs to another round', 400);
  const { error } = await db.from('votes').insert({ proposal_id: p.id, wallet_address: wallet, choice });
  if (error) { if (error.code === '23505') throw err('you already voted', 409); throw err(error.message, 500); }
  await recount(p.id);
  broadcast({ type: 'proposals' });
  await maybeEarlyClose(round);
  return { ok: true };
}

async function recount(id) {
  const db = chatDb();
  const { data: v } = await db.from('votes').select('choice').eq('proposal_id', id);
  const yes = (v || []).filter(x => x.choice === 'yes').length, no = (v || []).length - yes;
  await db.from('proposals').update({ yes, no }).eq('id', id);
  return { yes, no };
}

async function maybeEarlyClose(round) {
  const db = chatDb();
  const { data: props } = await db.from('proposals').select('id').eq('round_id', round.id).eq('status', 'open');
  if (!props?.length) return;
  const eligible = family.members.map(m => m.wallet);
  if (!eligible.length) return; // test mode: no fixed electorate, close by time only
  const { data: votes } = await db.from('votes').select('proposal_id,wallet_address').in('proposal_id', props.map(p => p.id));
  const complete = props.every(p => eligible.every(w => (votes || []).some(v => v.proposal_id === p.id && v.wallet_address === w)));
  if (complete) await closeRound(round, 'everyone voted');
}

async function closeRound(round, why) {
  const db = chatDb();
  if (round.closed_at) return;
  const { data: locked } = await db.from('rounds').update({ closed_at: new Date().toISOString() }).eq('id', round.id).is('closed_at', null).select();
  if (!locked?.length) return; // someone else closed it
  const { data: props } = await db.from('proposals').select('*').eq('round_id', round.id).eq('status', 'open');
  const minVotes = Math.min(cfg.voteMinVotes, Math.max(1, round.eligible || family.members.length));
  for (const p of props || []) {
    const total = p.yes + p.no;
    const passed = total >= minVotes && p.yes / total >= cfg.votePassRatio;
    await db.from('proposals').update({ status: passed ? 'passed' : 'rejected', decided_at: new Date().toISOString() }).eq('id', p.id);
    broadcast({ type: 'proposals' });
    postSystem(passed
      ? `✅ ${p.symbol || p.token_mint.slice(0, 6)} passed — ${p.yes}/${total} yes (${Math.round((p.yes / total) * 100)}%). Buying ${p.treasury_pct}% of the treasury.`
      : `❌ ${p.symbol || p.token_mint.slice(0, 6)} rejected — ${p.yes}/${total} yes.`);
  }
  console.log(`[vote] round ${round.number} closed (${why}), ${props?.length || 0} proposals decided`);
}

// scheduled close: called by the loop
async function tickRounds() {
  const db = chatDb();
  if (!db || !cfg.tokenMint) return;
  const { round, schedule } = await currentRound();
  if (!schedule) return;
  const { data: stale } = await db.from('rounds').select('*').is('closed_at', null).lt('closes_at', new Date().toISOString());
  for (const r of stale || []) await closeRound(r, 'time');
  // proposals created between rounds attach to the round that just opened
  if (round && !round.closed_at) await db.from('proposals').update({ round_id: round.id }).is('round_id', null).eq('status', 'open');
}

// ---------- buy detection: passed proposal + treasury swap → bought ----------
async function tickBuys() {
  const db = chatDb();
  if (!db || !cfg.heliusKey) return;
  const { data: passed } = await db.from('proposals').select('*').eq('status', 'passed');
  if (!passed?.length) return;
  const items = getActivity().items || [];
  const treasury = getTreasury();
  for (const p of passed) {
    const since = new Date(p.decided_at || p.created_at).getTime();
    const tx = items.find(t => t.type === 'SWAP' && t.time >= since && !t.error && t.raw?.tokenTransfers?.some(tt => tt.mint === p.token_mint && tt.toUserAccount === cfg.treasuryWallet));
    if (!tx) continue;
    const got = tx.raw.tokenTransfers.filter(tt => tt.mint === p.token_mint && tt.toUserAccount === cfg.treasuryWallet).reduce((s, tt) => s + Number(tt.tokenAmount || 0), 0);
    const solOut = (tx.raw.nativeTransfers || []).filter(n => n.fromUserAccount === cfg.treasuryWallet).reduce((s, n) => s + Number(n.amount || 0), 0) / 1e9
      + (tx.raw.tokenTransfers || []).filter(tt => tt.mint === 'So11111111111111111111111111111111111111112' && tt.fromUserAccount === cfg.treasuryWallet).reduce((s, tt) => s + Number(tt.tokenAmount || 0), 0);
    const usd = solOut * (treasury.solPrice || 0);
    await db.from('proposals').update({
      status: 'bought', buy_tx: tx.signature, buy_amount: got, buy_sol: solOut, buy_usd: usd, buy_price: got ? usd / got : null, bought_at: new Date(tx.time).toISOString(),
    }).eq('id', p.id);
    postSystem(`🟢 Bought ${p.symbol || p.token_mint.slice(0, 6)}: ${got.toLocaleString('en-US', { maximumFractionDigits: 0 })} for ${solOut.toFixed(2)} SOL (~$${Math.round(usd).toLocaleString('en-US')}).`);
  }
}

export async function listProposals(status) {
  const db = chatDb();
  if (!db) return [];
  let q = db.from('proposals').select('*').order('created_at', { ascending: false }).limit(100);
  if (status) q = q.in('status', status.split(','));
  const { data } = await q;
  return data || [];
}

export async function myVotes(wallet, ids) {
  const db = chatDb();
  if (!db || !ids.length) return {};
  const { data } = await db.from('votes').select('proposal_id,choice').eq('wallet_address', wallet).in('proposal_id', ids);
  return Object.fromEntries((data || []).map(v => [v.proposal_id, v.choice]));
}

export async function boughtMints() {
  const db = chatDb();
  if (!db) return [];
  const { data } = await db.from('proposals').select('token_mint').in('status', ['bought', 'passed']);
  return (data || []).map(p => p.token_mint);
}

export function startFamilyLoop() {
  const tick = async () => {
    try { await refreshFamily(); await tickRounds(); await tickBuys(); } catch (e) { console.warn('[family loop]', e.message); }
  };
  setTimeout(tick, 5000);
  setInterval(tick, 30_000);
}
