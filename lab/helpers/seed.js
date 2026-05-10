// lab/helpers/seed.js
//
// Insert a fixture (returned by a scenario builder) into Postgres.
// Inserts in FK order:
//   customers → stock → premade_bouquets → orders → order_lines
//   → premade_bouquet_lines → deliveries
// Uses a single transaction so partial seeds don't leave the DB inconsistent.
//
// premadeBouquets and premadeBouquetLines are optional keys — older scenarios
// without them seed fine (defaults to empty arrays).

export async function seedFixture(pool, fixture) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await insertMany(client, 'customers', fixture.customers ?? []);
    await insertMany(client, 'stock', fixture.stockItems ?? []);
    await insertMany(client, 'premade_bouquets', fixture.premadeBouquets ?? []);
    await insertMany(client, 'orders', fixture.orders ?? []);
    await insertMany(client, 'order_lines', fixture.orderLines ?? []);
    await insertMany(client, 'premade_bouquet_lines', fixture.premadeBouquetLines ?? []);
    await insertMany(client, 'deliveries', fixture.deliveries ?? []);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function insertMany(client, table, rows) {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  const colList = columns.map(quoteIdent).join(', ');
  const placeholders = rows.map((_, i) =>
    '(' + columns.map((_, j) => `$${i * columns.length + j + 1}`).join(', ') + ')'
  ).join(', ');
  const values = rows.flatMap(r => columns.map(c => r[c]));
  await client.query(`INSERT INTO ${quoteIdent(table)} (${colList}) VALUES ${placeholders}`, values);
}

function quoteIdent(s) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw new Error(`Unsafe identifier: ${s}`);
  return `"${s}"`;
}
