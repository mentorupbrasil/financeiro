import { neon } from '@neondatabase/serverless';

const db = neon(process.env.DATABASE_URL);
await db`
  alter table public.respira_state
  add column if not exists revision bigint not null default 1
`;
const rows = await db`select id, revision, updated_at from public.respira_state`;
console.log(rows);
