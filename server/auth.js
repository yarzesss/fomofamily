// Wallet sign-in. The browser asks for a nonce, signs a human-readable message
// with the wallet, and the server verifies the ed25519 signature. Only then
// does it hand out a session token. Nobody can post as a wallet they don't own.

import crypto from 'node:crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { cfg } from './config.js';

const nonces = new Map(); // nonce -> { wallet, at }
const NONCE_TTL = 5 * 60_000;
const SESSION_TTL = 30 * 24 * 3600_000;

export function isPubkey(s) {
  try { return typeof s === 'string' && bs58.decode(s).length === 32; } catch { return false; }
}

export function issueNonce(wallet) {
  const nonce = crypto.randomBytes(16).toString('hex');
  nonces.set(nonce, { wallet, at: Date.now() });
  for (const [k, v] of nonces) if (v.at < Date.now() - NONCE_TTL) nonces.delete(k);
  return nonce;
}

export const loginMessage = (wallet, nonce) =>
  `${cfg.projectName}\n\nsign in to the family chat.\nthis costs nothing and sends no transaction.\n\nwallet: ${wallet}\nnonce: ${nonce}`;

export function verifyLogin(wallet, nonce, signatureB58) {
  const n = nonces.get(nonce);
  if (!n || n.wallet !== wallet || n.at < Date.now() - NONCE_TTL) return false;
  nonces.delete(nonce);
  try {
    const sig = bs58.decode(signatureB58);
    const ok = nacl.sign.detached.verify(Buffer.from(loginMessage(wallet, nonce), 'utf8'), sig, bs58.decode(wallet));
    return ok;
  } catch {
    return false;
  }
}

const b64 = s => Buffer.from(s).toString('base64url');
const sign = s => crypto.createHmac('sha256', cfg.sessionSecret).update(s).digest('base64url');

export function issueToken(wallet) {
  const payload = b64(JSON.stringify({ w: wallet, exp: Date.now() + SESSION_TTL }));
  return `${payload}.${sign(payload)}`;
}

export function readToken(token) {
  if (typeof token !== 'string') return null;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;
  const expect = sign(payload);
  if (mac.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  try {
    const { w, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!isPubkey(w) || exp < Date.now()) return null;
    return w;
  } catch {
    return null;
  }
}

export function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const wallet = readToken(h.startsWith('Bearer ') ? h.slice(7) : '');
  if (!wallet) return res.status(401).json({ error: 'sign in with your wallet first' });
  req.wallet = wallet;
  next();
}
