import { sql, setCors, requireSession, readBody, ensureSchema } from './_lib.js';

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!requireSession(req, res)) return;

  try {
    const db = sql();
    await ensureSchema(db);

    if (req.method === 'GET') {
      const rows = await db`
        select state, updated_at, revision
        from public.respira_state
        where id = 'default'
        limit 1
      `;
      if (!rows.length) {
        return res.status(200).json({ state: null, updatedAt: null, revision: 0 });
      }
      return res.status(200).json({
        state: rows[0].state,
        updatedAt: rows[0].updated_at,
        revision: Number(rows[0].revision) || 1,
      });
    }

    if (req.method === 'PUT') {
      const body = readBody(req);
      if (!body.state || typeof body.state !== 'object') {
        return res.status(400).json({ error: 'Envie { state, expectedRevision }.' });
      }
      const expected = Number(body.expectedRevision);
      if (!Number.isFinite(expected)) {
        return res.status(400).json({ error: 'expectedRevision obrigatório.' });
      }

      const current = await db`
        select revision from public.respira_state where id = 'default' limit 1
      `;

      if (!current.length) {
        if (expected !== 0) {
          return res.status(409).json({
            error: 'Conflito de revisão.',
            revision: 0,
            updatedAt: null,
          });
        }
        const inserted = await db`
          insert into public.respira_state (id, state, updated_at, revision)
          values ('default', ${JSON.stringify(body.state)}::jsonb, now(), 1)
          returning updated_at, revision
        `;
        return res.status(200).json({
          ok: true,
          updatedAt: inserted[0].updated_at,
          revision: Number(inserted[0].revision),
        });
      }

      const currentRevision = Number(current[0].revision) || 1;
      if (currentRevision !== expected) {
        const latest = await db`
          select state, updated_at, revision
          from public.respira_state
          where id = 'default'
          limit 1
        `;
        return res.status(409).json({
          error: 'Existe uma versão mais recente no Neon.',
          revision: Number(latest[0].revision),
          updatedAt: latest[0].updated_at,
          state: latest[0].state,
        });
      }

      const rows = await db`
        update public.respira_state
        set state = ${JSON.stringify(body.state)}::jsonb,
            updated_at = now(),
            revision = revision + 1
        where id = 'default' and revision = ${expected}
        returning updated_at, revision
      `;

      if (!rows.length) {
        return res.status(409).json({
          error: 'Existe uma versão mais recente no Neon.',
          revision: currentRevision,
        });
      }

      return res.status(200).json({
        ok: true,
        updatedAt: rows[0].updated_at,
        revision: Number(rows[0].revision),
      });
    }

    return res.status(405).json({ error: 'Método não permitido.' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || 'Erro no banco.' });
  }
}
