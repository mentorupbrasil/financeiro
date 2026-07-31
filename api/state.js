import { neon } from '@neondatabase/serverless';

const PIN = process.env.APP_PIN || '0707';

function readPin(req) {
  const header = req.headers.authorization || '';
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  return String(req.headers['x-app-pin'] || req.query?.pin || '').trim();
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-App-Pin');
}

function sql() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurada no servidor.');
  return neon(process.env.DATABASE_URL);
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (readPin(req) !== PIN) return res.status(401).json({ error: 'PIN inválido.' });

  try {
    const db = sql();

    if (req.method === 'GET') {
      const rows = await db`
        select state, updated_at
        from public.respira_state
        where id = 'default'
        limit 1
      `;
      if (!rows.length) return res.status(200).json({ state: null, updatedAt: null });
      return res.status(200).json({
        state: rows[0].state,
        updatedAt: rows[0].updated_at,
      });
    }

    if (req.method === 'PUT') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      if (!body.state || typeof body.state !== 'object') {
        return res.status(400).json({ error: 'Envie { state: {...} }.' });
      }
      const rows = await db`
        insert into public.respira_state (id, state, updated_at)
        values ('default', ${JSON.stringify(body.state)}::jsonb, now())
        on conflict (id) do update
          set state = excluded.state,
              updated_at = now()
        returning updated_at
      `;
      return res.status(200).json({ ok: true, updatedAt: rows[0].updated_at });
    }

    return res.status(405).json({ error: 'Método não permitido.' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || 'Erro no banco.' });
  }
}
