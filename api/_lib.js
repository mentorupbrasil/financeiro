import { createHmac, timingSafeEqual } from 'crypto';
import { neon } from '@neondatabase/serverless';

const PIN = process.env.APP_PIN || '';
const SESSION_SECRET = process.env.SESSION_SECRET || PIN || 'respira-session';
const COOKIE = 'respira_session';
const MAX_AGE_SEC = 60 * 60 * 24 * 90;

export function sql() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurada no servidor.');
  return neon(process.env.DATABASE_URL);
}

export function getPin() {
  return PIN;
}

export function allowedOrigin(req) {
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  const candidates = [
    process.env.APP_ORIGIN,
    host ? `https://${host}` : '',
    'https://financeiro.gestorpro.sbs',
    'https://financeiro-puce-eight.vercel.app',
  ].filter(Boolean);
  if (!origin) return null;
  if (candidates.some((item) => origin === item || origin.endsWith('.vercel.app'))) return origin;
  return null;
}

export function setCors(req, res) {
  const origin = allowedOrigin(req);
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
}

function sign(payload) {
  return createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
}

export function createSessionCookie() {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SEC;
  const payload = String(exp);
  const token = `${payload}.${sign(payload)}`;
  const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE_SEC}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie() {
  const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (!key) continue;
    out[key] = rest.join('=');
  }
  return out;
}

export function readSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE];
  if (!token) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const expected = sign(payload);
  try {
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  } catch {
    return false;
  }
  const exp = Number(payload);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  return true;
}

export function requireSession(req, res) {
  if (!readSession(req)) {
    res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });
    return false;
  }
  return true;
}

export function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body || '{}'); }
    catch { return {}; }
  }
  return req.body;
}

export async function ensureSchema(db) {
  await db`
    create table if not exists public.respira_state (
      id text primary key default 'default',
      state jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      revision bigint not null default 1
    )
  `;
  await db`
    alter table public.respira_state
    add column if not exists revision bigint not null default 1
  `;
}

export { COOKIE, MAX_AGE_SEC };
