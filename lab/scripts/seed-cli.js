// lab/scripts/seed-cli.js — `npm run lab:seed -- --scenario=baseline`
import { labPool } from '../helpers/db.js';
import { seedFixture } from '../helpers/seed.js';
import { scenarios } from '../scenarios/index.js';

const args = process.argv.slice(2);
const scenarioArg = args.find(a => a.startsWith('--scenario='));
const name = scenarioArg ? scenarioArg.split('=')[1] : 'baseline';

const builder = scenarios[name];
if (!builder) {
  console.error(`Unknown scenario: ${name}. Known: ${Object.keys(scenarios).join(', ')}`);
  process.exit(1);
}

const pool = labPool();
try {
  console.log(`[LAB] Seeding scenario "${name}"...`);
  const fx = builder();
  await seedFixture(pool, fx);
  console.log(`[LAB] Done. customers=${fx.customers.length} orders=${fx.orders.length} stock=${fx.stockItems.length}`);
} finally {
  await pool.end();
}
