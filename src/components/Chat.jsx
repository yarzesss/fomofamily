import React, { useContext, useEffect, useRef, useState } from 'react';
import { ConfigContext } from '../App.jsx';
import { useSession } from '../lib/session.jsx';
import { useFamily, fmtCountdown } from '../lib/family.jsx';
import { api } from '../lib/api.js';
import { short, hhmm, walletColor, ago, num, usd } from '../lib/format.js';
import { toast } from './Toasts.jsx';
import Img from './Img.jsx';
import Avatar from './Avatar.jsx';

// Left card: Chat | Votes | Family — family members only (≥ FAMILY_MIN_PCT of supply, top FAMILY_MAX).
export default function Chat({ activity }) {
  const config = useContext(ConfigContext);
  const session = useSession();
  const fam = useFamily();
  const [tab, setTab] = useState('chat');
  const gated = config.chatEnabled && session.token && !fam.isMember && fam.enabled;

  return (
    <section className="card chat">
      <div className="card-tabs">
        <button className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>Chat</button>
        <button className={tab === 'votes' ? 'on' : ''} onClick={() => setTab('votes')}>Votes{fam.countdown?.open && <span className="dot-live" />}</button>
        <button className={tab === 'family' ? 'on' : ''} onClick={() => setTab('family')}>Family <span className="cnt">({fam.members?.length || 0})</span></button>
        <div className="grow" />
        {fam.countdown && <span className="s12 t2 mono">{fmtCountdown(fam.countdown.ms)}</span>}
      </div>
      {!session.token ? <ConnectGate /> : gated ? <NotFamily /> : tab === 'chat' ? <ChatTab /> : tab === 'votes' ? <VotesTab /> : <FamilyTab />}
    </section>
  );
}

function ConnectGate() {
  const session = useSession();
  const config = useContext(ConfigContext);
  return (
    <div className="card-body">
      <div className="gate-box">
        <div className="gate-title">The family room</div>
        <p>Chat, proposals and voting are for the family — holders of at least {config.family?.minPct ?? 1}% of {config.tokenTicker} supply (top {config.family?.max ?? 15}).</p>
        {session.connected
          ? <><button className="btn primary wide" disabled={session.busy} onClick={session.signIn}>{session.busy ? 'Check your wallet…' : 'Sign in with wallet'}</button>{session.error && <p style={{ color: 'var(--red)' }}>{session.error}</p>}</>
          : <p className="t3">Connect your wallet (top right) to enter.</p>}
      </div>
    </div>
  );
}

function NotFamily() {
  const config = useContext(ConfigContext);
  const fam = useFamily();
  const [pct, setPct] = useState(null);
  const [busy, setBusy] = useState(false);
  const check = async () => { setBusy(true); try { const r = await fam.recheck(); setPct(r?.pct ?? null); } finally { setBusy(false); } };
  useEffect(() => { check(); }, []); // eslint-disable-line
  const minPct = config.family?.minPct ?? 1;
  return (
    <div className="card-body">
      <div className="gate-box">
        <div className="gate-title">You're not in the family yet</div>
        <p>You need at least <b>{minPct}%</b> of {config.tokenTicker} supply to join discussions and vote. Only the top {config.family?.max ?? 15} holders are in.</p>
        <div className="gate-stat">
          <span className="t2">Your share</span>
          <span className="mono">{pct == null ? '—' : `${pct.toFixed(3)}%`}</span>
        </div>
        <div className="gate-stat">
          <span className="t2">Needed</span>
          <span className="mono">{minPct}%{fam.supply ? ` · ${num((fam.supply * minPct) / 100, 0)} ${config.tokenTicker}` : ''}</span>
        </div>
        {config.stonkUrl && <a className="btn primary wide" href={config.stonkUrl} target="_blank" rel="noreferrer">Buy {config.tokenTicker}</a>}
        <button className="btn ghost wide" disabled={busy} onClick={check}>{busy ? 'Checking…' : 'I bought — check again'}</button>
      </div>
    </div>
  );
}

function ChatTab() {
  const config = useContext(ConfigContext);
  const session = useSession();
  const fam = useFamily();
  const [messages, setMessages] = useState([]);
  const [names, setNames] = useState({});
  const [online, setOnline] = useState(0);
  const [text, setText] = useState('');
  const [err, setErr] = useState(null);
  const [sending, setSending] = useState(false);
  const [editName, setEditName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const listRef = useRef(null);
  const stick = useRef(true);
  const loadedAt = useRef(Date.now());

  useEffect(() => {
    if (!config.chatEnabled || !session.token) return;
    let es;
    api('/api/chat', { token: session.token }).then(r => { setMessages(r.messages); setNames(r.names); setOnline(r.online); }).catch(e => setErr(e.message));
    es = new EventSource(`/api/chat/stream?token=${encodeURIComponent(session.token)}`);
    es.onmessage = e => {
      const evt = JSON.parse(e.data);
      if (evt.type === 'message') {
        setMessages(prev => (prev.some(x => x.id === evt.message.id) ? prev : [...prev.slice(-300), evt.message]));
        if (evt.message.kind === 'system' && Date.now() - loadedAt.current > 3000) toast(evt.message.body, /bought|passed|🟢/.test(evt.message.body) ? 'up' : /rejected|sold|🔴|❌/.test(evt.message.body) ? 'down' : '');
      } else if (evt.type === 'delete') setMessages(prev => prev.filter(x => x.id !== evt.id));
      else if (evt.type === 'name') setNames(prev => ({ ...prev, [evt.wallet]: evt.name }));
      else if (evt.type === 'presence' || evt.type === 'hello') setOnline(evt.online);
      else if (evt.type === 'proposals') fam.reload();
    };
    return () => es?.close();
  }, [config.chatEnabled, session.token]); // eslint-disable-line

  useEffect(() => { const el = listRef.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [messages]);
  const onScroll = () => { const el = listRef.current; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; };

  const send = async e => {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true); setErr(null);
    try { const m = await api('/api/chat', { body: { body }, token: session.token }); setMessages(prev => (prev.some(x => x.id === m.id) ? prev : [...prev, m])); setText(''); stick.current = true; }
    catch (e2) { setErr(e2.message); if (/sign in/i.test(e2.message)) session.signOut(); }
    finally { setSending(false); }
  };
  const saveName = async e => {
    e.preventDefault(); setErr(null);
    try { const p = await api('/api/profile', { body: { name: nameInput }, token: session.token }); setNames(prev => ({ ...prev, [p.wallet_address]: p.display_name })); setEditName(false); }
    catch (e2) { setErr(e2.message); }
  };
  const remove = async id => { try { await api(`/api/chat/${id}`, { method: 'DELETE', token: session.token }); setMessages(prev => prev.filter(x => x.id !== id)); } catch (e2) { setErr(e2.message); } };
  const label = w => names[w] || short(w);
  const myName = names[session.address];

  return (
    <>
      {config.announcement && <div className="announce"><b>Pinned</b>{config.announcement}</div>}
      <div className="card-body chat-list" ref={listRef} onScroll={onScroll}>
        {!config.chatEnabled && <div className="empty"><b>Chat is warming up</b>Supabase is not configured yet.</div>}
        {config.chatEnabled && messages.length === 0 && <div className="empty"><b>Nobody here yet</b>Be the first to say gm.</div>}
        {messages.map(m => m.kind === 'system' ? (
          <div className="sysmsg" key={m.id}><span>{m.body}</span><span className="time">{hhmm(m.created_at)}</span></div>
        ) : (
          <div className="msg" key={m.id}>
            <Avatar wallet={m.wallet_address} />
            <div>
              <div className="who">
                <span className={`name ${m.wallet_address === session.address ? 'me' : ''}`}>{label(m.wallet_address)}</span>
                {fam.members?.find(x => x.wallet === m.wallet_address) && <span className="badge dev">#{fam.members.find(x => x.wallet === m.wallet_address).rank}</span>}
                <span className="time">{hhmm(m.created_at)}</span>
                {session.admin && <button className="del" title="delete" onClick={() => remove(m.id)}>×</button>}
              </div>
              <div className="body">{m.body}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="chat-foot">
        <div className="me-row">
          <Avatar wallet={session.address} />
          <div><div className="nm">{myName || short(session.address, 6)}</div><div className="ad">{online} online · {fam.me?.rank ? `family #${fam.me.rank}` : 'family'}</div></div>
          <div style={{ flex: 1 }} />
          <button className="chip" onClick={() => { setNameInput(myName || ''); setEditName(v => !v); }}>{myName ? 'Rename' : 'Set name'}</button>
        </div>
        {editName && (
          <form className="name-form" onSubmit={saveName}>
            <input autoFocus maxLength={20} placeholder="Your name (2–20 chars)" value={nameInput} onChange={e => setNameInput(e.target.value)} />
            <button type="submit">Save</button>
          </form>
        )}
        <form className="composer" onSubmit={send}>
          <input maxLength={220} placeholder="Say something…" value={text} disabled={!config.chatPostEnabled} onChange={e => setText(e.target.value)} />
          <button type="submit" disabled={!text.trim() || sending || !config.chatPostEnabled}>Send</button>
        </form>
        <div className="chat-hint"><span className={err ? 'err' : ''}>{err || 'Family only · wallet-verified'}</span><button onClick={session.signOut}>Sign out</button></div>
      </div>
    </>
  );
}

function VotesTab() {
  const config = useContext(ConfigContext);
  const session = useSession();
  const fam = useFamily();
  const [data, setData] = useState({ proposals: [], names: {} });
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ token_mint: '', thesis: '', treasury_pct: 2 });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => { try { setData(await api('/api/proposals', { token: session.token })); } catch {} };
  useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, [session.token]); // eslint-disable-line

  const propose = async e => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api('/api/proposals', { body: form, token: session.token }); setShow(false); setForm({ token_mint: '', thesis: '', treasury_pct: 2 }); load(); }
    catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  const vote = async (id, choice) => {
    setErr(null);
    try { await api('/api/vote', { body: { proposal_id: id, choice }, token: session.token }); load(); fam.reload(); }
    catch (e2) { setErr(e2.message); }
  };

  const open = data.proposals.filter(p => p.status === 'open');
  const done = data.proposals.filter(p => p.status !== 'open');
  const cd = fam.countdown;

  return (
    <>
      <div className="round-box">
        {!fam.enabled ? <><div className="t">Voting opens at launch</div><div className="d">Set the family token to start rounds.</div></>
          : cd ? <><div className="t">{cd.label}</div><div className={`big mono ${cd.open ? 'up' : ''}`}>{fmtCountdown(cd.ms)}</div>
              <div className="d">{cd.open ? `Round ${fam.round.number} · ${fam.round.eligible} eligible · closes early when everyone has voted` : `Every ${config.family?.intervalMin / 60}h · ${config.family?.passPct}% yes to pass`}</div></>
          : <><div className="t">Waiting for launch time</div><div className="d">Rounds start {config.family?.firstDelayMin} min after launch.</div></>}
      </div>
      <div className="chips">
        <button className="chip on" onClick={() => setShow(v => !v)}>{show ? 'Close' : '+ Propose a token'}</button>
        <span className="s12 t3" style={{ alignSelf: 'center' }}>{open.length} open · {done.length} decided</span>
      </div>
      {show && (
        <form className="propose" onSubmit={propose}>
          <input placeholder="Token mint address" value={form.token_mint} onChange={e => setForm({ ...form, token_mint: e.target.value })} />
          <textarea placeholder="Thesis — why the family should buy this (max 500)" maxLength={500} value={form.thesis} onChange={e => setForm({ ...form, thesis: e.target.value })} />
          <div className="row2">
            <label>Treasury % <input type="number" min="0.5" max={config.family?.maxTreasuryPct || 10} step="0.5" value={form.treasury_pct} onChange={e => setForm({ ...form, treasury_pct: e.target.value })} /></label>
            <button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Submit'}</button>
          </div>
          {err && <div className="s12" style={{ color: 'var(--red)' }}>{err}</div>}
        </form>
      )}
      {!show && err && <div className="warn">{err}</div>}
      <div className="card-body">
        {open.length === 0 && <div className="empty"><b>No open proposals</b>Propose a token for the next round.</div>}
        {open.map(p => <Proposal key={p.id} p={p} names={data.names} canVote={Boolean(cd?.open)} onVote={vote} />)}
        {done.length > 0 && <div className="section-title t2">Decided</div>}
        {done.map(p => <Proposal key={p.id} p={p} names={data.names} canVote={false} />)}
      </div>
    </>
  );
}

function Proposal({ p, names, canVote, onVote }) {
  const total = p.yes + p.no;
  const yesPct = total ? (p.yes / total) * 100 : 0;
  const st = p.status;
  return (
    <div className={`prop ${st}`}>
      <div className="prop-head">
        <span className="stack"><Img src={p.image} fallback={(p.symbol || '?').slice(0, 2)} size={28} /><Avatar wallet={p.created_by} size={16} className="mini" /></span>
        <div className="grow">
          <div className="l1">{p.symbol || short(p.token_mint, 4)} <span className="t2">· {p.treasury_pct}% of treasury</span></div>
          <div className="l2">by {names[p.created_by] || short(p.created_by)} · {ago(new Date(p.created_at).getTime())} ago</div>
        </div>
        <span className={`badge ${st === 'open' ? 'dev' : st === 'rejected' ? 'sell' : 'buy'}`}>{st === 'bought' ? 'Bought' : st === 'passed' ? 'Passed' : st === 'rejected' ? 'Rejected' : 'Open'}</span>
      </div>
      <div className="prop-thesis">{p.thesis}</div>
      <div className="prop-bar"><i style={{ width: `${yesPct}%` }} /></div>
      <div className="prop-foot">
        <span className="s12"><b className="up">{p.yes} yes</b> · <b className="down">{p.no} no</b> · {total ? `${yesPct.toFixed(0)}%` : 'no votes yet'}</span>
        {st === 'open' && (p.myVote
          ? <span className="s12 t2">you voted {p.myVote}</span>
          : canVote
            ? <span className="vote-btns"><button className="btn green" onClick={() => onVote(p.id, 'yes')}>Yes</button><button className="btn ghost down" onClick={() => onVote(p.id, 'no')}>No</button></span>
            : <span className="s12 t3">voting closed</span>)}
        {st === 'bought' && p.buy_usd != null && <span className="s12 t2">{usd(p.buy_usd)} · {p.buy_sol?.toFixed(2)} SOL</span>}
      </div>
    </div>
  );
}

function FamilyTab() {
  const fam = useFamily();
  const session = useSession();
  const config = useContext(ConfigContext);
  return (
    <>
      <div className="chips"><span className="s12 t2" style={{ alignSelf: 'center' }}>Top {config.family?.max ?? 15} holders with ≥ {config.family?.minPct ?? 1}% of supply{fam.updatedAt ? ` · updated ${ago(fam.updatedAt)} ago` : ''}</span></div>
      <div className="card-body">
        {!fam.enabled && <div className="empty"><b>No family token yet</b>Members appear here after launch.</div>}
        {fam.error && <div className="warn">{fam.error}</div>}
        {(fam.members || []).map(m => (
          <div className="row" key={m.wallet}>
            <Avatar wallet={m.wallet} size={36} />
            <div><div className="l1">{short(m.wallet, 5)}{m.wallet === session.address && <span className="badge dev">you</span>}</div><div className="l2">{num(m.balance)} {config.tokenTicker}</div></div>
            <div className="r"><div className="v">{m.pct.toFixed(2)}%</div><div className="c t2">of supply</div></div>
          </div>
        ))}
        {fam.enabled && fam.members?.length === 0 && <div className="empty"><b>Family is empty</b>Nobody holds {config.family?.minPct ?? 1}% yet.</div>}
      </div>
    </>
  );
}
