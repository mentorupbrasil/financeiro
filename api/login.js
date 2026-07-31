import { getPin, setCors, createSessionCookie, readBody } from './_lib.js';

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  const pin = getPin();
  if (!pin) return res.status(500).json({ error: 'APP_PIN não configurado no servidor.' });

  const body = readBody(req);
  const provided = String(body.pin || '').trim();
  if (!provided || provided !== pin) {
    return res.status(401).json({ error: 'PIN incorreto.' });
  }

  res.setHeader('Set-Cookie', createSessionCookie());
  return res.status(200).json({ ok: true });
}
