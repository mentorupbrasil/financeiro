import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL missing');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
const { rows } = await client.query(`select state from public.respira_state where id = 'default'`);

if (!rows.length || !rows[0].state) {
  console.log(JSON.stringify({ ok: true, message: 'nenhum estado na nuvem' }));
  await client.end();
  process.exit(0);
}

const state = rows[0].state;
let bills = 0;
let incomes = 0;

for (const month of Object.values(state.months || {})) {
  bills += (month.bills || []).length;
  incomes += (month.incomes || []).length;
  month.bills = [];
  month.incomes = [];
}

state.updatedAt = new Date().toISOString();

await client.query(
  `update public.respira_state
   set state = $1::jsonb, updated_at = now()
   where id = 'default'`,
  [JSON.stringify(state)],
);

console.log(JSON.stringify({
  ok: true,
  clearedBills: bills,
  clearedIncomes: incomes,
  months: Object.keys(state.months || {}),
}));

await client.end();
