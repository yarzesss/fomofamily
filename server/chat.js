// Chat writes go through the server with the Supabase service-role key.
// The browser only ever reads (anon key + realtime). RLS blocks anon writes.

import { createClient } from '@supabase/supabase-js';
import { cfg } from './config.js';

let db = null;
export function chatDb() {
  if (!db && cfg.supabaseUrl && cfg.supabaseServiceKey) {
    db = createClient(cfg.supabaseUrl, cfg.supabaseServiceKey, { auth: { persistSession: false } });
  }
  return db;
}

const err = (msg, status) => Object.assign(new Error(msg), { status });

const lastPost = new Map(); // wallet -> ts
const MIN_INTERVAL = 1500;

export function cleanBody(s) {
  if (typeof s !== 'string') return null;
  const body = s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (body.length < 1 || body.length > 220) return null;
  return body;
}

export function cleanName(s) {
  if (typeof s !== 'string') return null;
  const name = s.trim();
  if (!/^[a-zA-Z0-9_\.]{2,20}$/.test(name)) return null;
  return name;
}

export async function postMessage(wallet, rawBody) {
  const supa = chatDb();
  if (!supa) throw err('chat is not configured', 503);
  const body = cleanBody(rawBody);
  if (!body) throw err('message must be 1–220 characters', 400);
  const now = Date.now();
  if ((lastPost.get(wallet) || 0) > now - MIN_INTERVAL) throw err('slow down', 429);
  lastPost.set(wallet, now);
  const { data, error } = await supa.from('messages').insert({ wallet_address: wallet, body, kind: 'user' }).select().single();
  if (error) throw err(error.message, 500);
  return data;
}

// System messages (trade alerts etc.) are posted "as" the treasury wallet.
export async function postSystem(rawBody) {
  const supa = chatDb();
  if (!supa || !cfg.treasuryWallet) return null;
  const body = cleanBody(rawBody);
  if (!body) return null;
  const { data, error } = await supa.from('messages').insert({ wallet_address: cfg.treasuryWallet, body, kind: 'system' }).select().single();
  if (error) { console.warn('[chat] system post failed:', error.message); return null; }
  return data;
}

export async function deleteMessage(wallet, id) {
  const supa = chatDb();
  if (!supa) throw err('chat is not configured', 503);
  if (!cfg.adminWallets.includes(wallet)) throw err('admins only', 403);
  const n = Number(id);
  if (!Number.isInteger(n)) throw err('bad id', 400);
  const { error } = await supa.from('messages').delete().eq('id', n);
  if (error) throw err(error.message, 500);
  return { ok: true, id: n };
}

export async function setName(wallet, rawName) {
  const supa = chatDb();
  if (!supa) throw err('chat is not configured', 503);
  const name = cleanName(rawName);
  if (!name) throw err('name: 2–20 letters, digits, _ or .', 400);
  const { data, error } = await supa
    .from('profiles')
    .upsert({ wallet_address: wallet, display_name: name, updated_at: new Date().toISOString() }, { onConflict: 'wallet_address' })
    .select()
    .single();
  if (error) {
    if (error.code === '23505') throw err('that name is taken', 409);
    throw err(error.message, 500);
  }
  return data;
}

export async function touchMember(wallet) {
  const supa = chatDb();
  if (!supa) return;
  const { error } = await supa.from('members').upsert({ wallet_address: wallet, last_seen: new Date().toISOString() }, { onConflict: 'wallet_address' });
  if (error) console.warn('[chat] member upsert failed:', error.message);
}

let memberCache = { at: 0, count: 0 };
export async function memberCount() {
  const supa = chatDb();
  if (!supa) return 0;
  if (memberCache.at > Date.now() - 30_000) return memberCache.count;
  const { count } = await supa.from('members').select('*', { count: 'exact', head: true });
  memberCache = { at: Date.now(), count: count || 0 };
  return memberCache.count;
}

export async function recentMessages(limit = 100) {
  const supa = chatDb();
  if (!supa) return [];
  const { data } = await supa.from('messages').select('*').order('created_at', { ascending: false }).limit(limit);
  return (data || []).reverse();
}
