import pg from 'pg';
import { normalizeState } from '../js/model.js';

const url = process.env.DATABASE_URL;
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
const { rows } = await client.query(`select state from public.respira_state where id = 'default'`);
if (!rows.length) {
  console.log('empty');
  await client.end();
  process.exit(0);
}
const state = normalizeState(rows[0].state);
state.updatedAt = new Date().toISOString();
await client.query(
  `update public.respira_state set state = $1::jsonb, updated_at = now() where id = 'default'`,
  [JSON.stringify(state)],
);
console.log(JSON.stringify({
  version: state.version,
  month: state.currentMonth,
  entries: state.months[state.currentMonth]?.entries?.length || 0,
  commitments: state.commitments.length,
}));
await client.end();
