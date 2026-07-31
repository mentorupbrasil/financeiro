import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Defina DATABASE_URL');
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(__dirname, '..', 'schema.sql'), 'utf8');

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
await client.query(sql);
const check = await client.query('select id, updated_at from public.respira_state');
console.log('schema ok', check.rows);
await client.end();
