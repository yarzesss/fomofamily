import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { ConfigContext } from '../App.jsx';
import { useSession } from '../lib/session.jsx';
import { api } from '../lib/api.js';
import { short, hhmm, walletColor, ago } from '../lib/format.js';
import { toast } from './Toasts.jsx';
import { usePoll } from '../lib/hooks.js';

// Left card: "Chat | Moves" — mirrors fomo's Alerts/Tokens panel.
export default function Chat({ activity }) {
  const config = useContext(ConfigContext);
  const session = useSession();
  const [tab, setTab] = useState('chat');
  const [filter, setFilter] = useState('all'); // chat: all | alerts ; moves: all | buys | sells
  const [messages, setMessages] = useState([]);
  const [names, setNames] = useState({});
  const [online, setOnline] = useState(0);
  const [text, setText] = useState('');
  const [err, setErr] = useState(null);
  const [sending, setSending] = useState(false);
  const [editName, setEditName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const listRef = useRef(null);
  const stats = usePoll('/api/stats', 60000, Boolean(config.chatEnabled));
  const loadedAt = useRef(Date.now());
  const stick = useRef(true);

  const supa = useMemo(
    () => (config.chatEnabled ? createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { persistSession: false } }) : null),
    [config.chatEnabled, config.supabaseUrl, config.supabaseAnonKey]
  );

  useEffect(() => {
    if (!supa) return;
    let alive = true;
    (async () => {
      const [{ data: msgs }, { data: profs }] = await Promise.all([
        supa.from('messages').select('*').order('created_at', { ascending: false }).limit(120),
        supa.from('profiles').select('wallet_address,display_name'),
      ]);
      if (!alive) return;
      setMessages((msgs || []).reverse());
      setNames(Object.fromEntries((profs || []).map(p => [p.wallet_address, p.display_name])));
    })();
    const ch = supa
      .channel('family')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: m }) => {
        setMessages(prev => (prev.some(x => x.id === m.id) ? prev : [...prev.slice(-300), m]));
        if (m.kind === 'system' && Date.now() - loadedAt.current > 3000) toast(m.body, /bought/.test(m.body) ? 'up' : 'down');
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, ({ old }) => old?.id && setMessages(prev => prev.filter(x => x.id !== old.id)))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, ({ new: p }) => p?.wallet_address && setNames(prev => ({ ...prev, [p.wallet_address]: p.display_name })))
      .on('presence', { event: 'sync' }, () => setOnline(Object.keys(ch.presenceState()).length))
      .subscribe(status => { if (status === 'SUBSCRIBED') ch.track({ at: Date.now() }); });
    return () => { alive = false; supa.removeChannel(ch); };
  }, [supa]);

  useEffect(() => { const el = listRef.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [messages, tab]);
  const onScroll = () => { const el = listRef.current; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; };

  const send = async e => {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true); setErr(null);
    try {
      const m = await api('/api/chat', { body: { body }, token: session.token });
      setMessages(prev => (prev.some(x => x.id === m.id) ? prev : [...prev, m]));
      setText(''); stick.current = true;
    } catch (e2) { setErr(e2.message); if (/sign in/i.test(e2.message)) session.signOut(); }
    finally { setSending(false); }
  };
  const saveName = async e => {
    e.preventDefault(); setErr(null);
    try { const p = await api('/api/profile', { body: { name: nameInput }, token: session.token }); setNames(prev => ({ ...prev, [p.wallet_address]: p.display_name })); setEditName(false); }
    catch (e2) { setErr(e2.message); }
  };
  const remove = async id => {
    try { await api(`/api/chat/${id}`, { method: 'DELETE', token: session.token }); setMessages(prev => prev.filter(x => x.id !== id)); }
    catch (e2) { setErr(e2.message); }
  };

  const label = w => names[w] || short(w);
  const myName = session.address ? names[session.address] : null;
  const shown = filter === 'alerts' ? messages.filter(m => m.kind === 'system') : messages;
  const moves = (activity?.items || []).filter(a => filter === 'all' || (filter === 'buys' ? /bought|buy/i.test(a.description) : /sold|sell/i.test(a.description)));

  return (
    <section className="card chat">
      <div className="card-tabs">
        <button className={tab === 'chat' ? 'on' : ''} onClick={() => { setTab('chat'); setFilter('all'); }}>Chat</button>
        <button className={tab === 'moves' ? 'on' : ''} onClick={() => { setTab('moves'); setFilter('all'); }}>Moves <span className="cnt">({activity?.items?.length || 0})</span></button>
        <div className="grow" />
        {supa && <span className="online"><i />{online}{stats.data?.members ? ` · ${stats.data.members} members` : ''}</span>}
      </div>

      {tab === 'chat' ? (
        <>
          <div className="chips">
            <button className={`chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>All</button>
            <button className={`chip ${filter === 'alerts' ? 'on' : ''}`} onClick={() => setFilter('alerts')}>Fund alerts</button>
          </div>
          {config.announcement && <div className="announce"><b>Pinned</b>{config.announcement}</div>}
          <div className="card-body chat-list" ref={listRef} onScroll={onScroll}>
            {!supa && <div className="empty"><b>Chat is warming up</b>Supabase is not configured yet.</div>}
            {supa && shown.length === 0 && <div className="empty"><b>Nobody here yet</b>Be the first legend to say gm.</div>}
            {shown.map(m => m.kind === 'system' ? (
              <div className="sysmsg" key={m.id}>
                <span className={`badge ${/bought/.test(m.body) ? 'buy' : 'sell'}`}>{/bought/.test(m.body) ? 'Buy' : 'Sell'}</span>
                <span>{m.body.replace(/^[^\w]+/, '')}</span>
                <span className="time">{hhmm(m.created_at)}</span>
              </div>
            ) : (
              <div className="msg" key={m.id}>
                <span className="avatar" style={{ background: walletColor(m.wallet_address) }}>{label(m.wallet_address).slice(0, 2)}</span>
                <div>
                  <div className="who">
                    <span className={`name ${m.wallet_address === session.address ? 'me' : ''}`}>{label(m.wallet_address)}</span>
                    <span className="time">{hhmm(m.created_at)}</span>
                    {session.admin && <button className="del" title="delete" onClick={() => remove(m.id)}>×</button>}
                  </div>
                  <div className="body">{m.body}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="chat-foot">
            {session.connected && !session.token && (
              <div className="gate">
                <p><b style={{ color: 'var(--text-primary)' }}>{myName || short(session.address)}</b> — sign a message to unlock chat. Free, no transaction.</p>
                <button className="btn primary" disabled={session.busy} onClick={session.signIn}>{session.busy ? 'Check your wallet…' : 'Sign in to chat'}</button>
                {session.error && <p style={{ color: 'var(--red)' }}>{session.error}</p>}
              </div>
            )}
            {session.token && (
              <div className="me-row">
                <span className="avatar" style={{ background: walletColor(session.address) }}>{(myName || session.address).slice(0, 2)}</span>
                <div><div className="nm">{myName || short(session.address, 6)}</div><div className="ad">{myName ? short(session.address, 6) : 'No name yet'}</div></div>
                <div style={{ flex: 1 }} />
                <button className="chip" onClick={() => { setNameInput(myName || ''); setEditName(v => !v); }}>{myName ? 'Rename' : 'Set name'}</button>
              </div>
            )}
            {editName && session.token && (
              <form className="name-form" onSubmit={saveName}>
                <input autoFocus maxLength={20} placeholder="Your name (2–20 chars)" value={nameInput} onChange={e => setNameInput(e.target.value)} />
                <button type="submit">Save</button>
              </form>
            )}
            <form className="composer" onSubmit={send}>
              <input maxLength={220} placeholder={session.token ? 'Say something…' : session.connected ? 'Sign in to chat' : 'Connect wallet to chat'} value={text}
                disabled={!session.token || !config.chatPostEnabled} onChange={e => setText(e.target.value)} />
              <button type="submit" disabled={!session.token || !text.trim() || sending || !config.chatPostEnabled}>Send</button>
            </form>
            <div className="chat-hint">
              <span className={err ? 'err' : ''}>{err || (config.chatHoldersOnly ? `Holders of ${config.tokenTicker} only` : 'Wallet-verified · 220 chars')}</span>
              {session.token && <button onClick={session.signOut}>Sign out</button>}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="chips">
            {['all', 'buys', 'sells'].map(f => <button key={f} className={`chip ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)}</button>)}
          </div>
          <div className="card-body">
            {moves.length === 0 && <div className="empty"><b>No moves yet</b>Treasury transactions show up here.</div>}
            {moves.map(a => {
              const d = a.description || '';
              const kind = a.type === 'SWAP' ? (/bought|buy/i.test(d) ? 'buy' : /sold|sell/i.test(d) ? 'sell' : 'swap') : '';
              return (
                <a className="act" key={a.signature} href={`https://solscan.io/tx/${a.signature}`} target="_blank" rel="noreferrer" title={d}>
                  {kind === 'buy' || kind === 'sell' ? <span className={`badge ${kind}`}>{kind === 'buy' ? 'Buy' : 'Sell'}</span> : <span className="badge dev">{a.type === 'TX' ? 'Tx' : a.type.toLowerCase()}</span>}
                  <span className="d">{d || `Transaction ${short(a.signature, 6)}`}</span>
                  <span className="t">{ago(a.time)}</span>
                </a>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
