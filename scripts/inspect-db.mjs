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
const info = await client.query('select current_database() as db, current_user as user');
console.log('connected', info.rows[0]);

const tables = await client.query(`
  select table_schema, table_name
  from information_schema.tables
  where table_schema not in ('pg_catalog', 'information_schema')
  order by 1, 2
`);
console.log('tables', tables.rows);

for (const row of tables.rows) {
  const cols = await client.query(
    `select column_name, data_type
     from information_schema.columns
     where table_schema = $1 and table_name = $2
     order by ordinal_position`,
    [row.table_schema, row.table_name],
  );
  console.log(`${row.table_schema}.${row.table_name}`, cols.rows);
}

await client.end();
