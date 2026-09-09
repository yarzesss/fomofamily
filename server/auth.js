// Wallet sign-in. The browser asks for a nonce, signs a human-readable message
// with the wallet, and the server verifies the signature. Only then does it
// hand out a session token. Nobody can post as a wallet they don't own.
//
// The family token lives on an EVM chain (Robinhood Chain), so members sign in
// with an EVM wallet and their address IS their identity everywhere on the site.

import crypto from 'node:crypto';
import { verifyMessage, isAddress, getAddress } from 'viem';
import { cfg } from './config.js';

const nonces = new Map(); // nonce -> { wallet, at }
const NONCE_TTL = 5 * 60_000;
const SESSION_TTL = 30 * 24 * 3600_000;

// An address is stored lowercase everywhere (DB rows, family list, admin list)
// so comparisons never depend on checksum casing.
export const normalize = a => (typeof a === 'string' && isAddress(a) ? a.toLowerCase() : null);
export const isPubkey = a => Boolean(normalize(a));

export function issueNonce(wallet) {
  const nonce = crypto.randomBytes(16).toString('hex');
  nonces.set(nonce, { wallet: normalize(wallet), at: Date.now() });
  for (const [k, v] of nonces) if (v.at < Date.now() - NONCE_TTL) nonces.delete(k);
  return nonce;
}

export const loginMessage = (wallet, nonce) =>
  `${cfg.projectName}\n\nsign in to the family chat.\nthis costs nothing and sends no transaction.\n\nwallet: ${getAddress(wallet)}\nnonce: ${nonce}`;

export async function verifyLogin(wallet, nonce, signature) {
  const w = normalize(wallet);
  const n = nonces.get(nonce);
  if (!w || !n || n.wallet !== w || n.at < Date.now() - NONCE_TTL) return false;
  nonces.delete(nonce);
  try {
    return await verifyMessage({ address: getAddress(w), message: loginMessage(w, nonce), signature });
  } catch {
    return false;
  }
}

const b64 = s => Buffer.from(s).toString('base64url');
const sign = s => crypto.createHmac('sha256', cfg.sessionSecret).update(s).digest('base64url');

export function issueToken(wallet) {
  const payload = b64(JSON.stringify({ w: normalize(wallet), exp: Date.now() + SESSION_TTL }));
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
    return normalize(w);
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
