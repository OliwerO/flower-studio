// lab/scripts/rebuild-template.js
//
// Rebuilds the `lab_template` Postgres database from a named scenario.
// Invoked when the schema changes or a scenario is updated.
// Idempotent — drops existing template first.
//
// Usage:
//   npm run lab:template:rebuild
//   npm run lab:template:rebuild -- --scenario=stock-overhaul

import { execSync } from 'child_process';
import { adminPool, labPool } from '../helpers/db.js';
import { seedFixture } from '../helpers/seed.js';
import { scenarios } from '../scenarios/index.js';

const args = process.argv.slice(2);
const scenarioArg = args.find(a => a.startsWith('--scenario='));
const name = scenarioArg ? scenarioArg.split('=')[1] : 'baseline';

const builder = scenarios[name];
if (!builder) {
  console.error(`Unknown scenario: ${name}`);
  process.exit(1);
}

const TEMPLATE_DB = 'lab_template';

const admin = adminPool();
try {
  // Disconnect anything using the template or lab DB, then drop+create it.
  await admin.query(`
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname IN ('${TEMPLATE_DB}', 'lab') AND pid <> pg_backend_pid()
  `);
  // If template was previously marked datistemplate=true, must un-template before drop.
  await admin.query(`UPDATE pg_database SET datistemplate = false WHERE datname = '${TEMPLATE_DB}'`);
  await admin.query(`DROP DATABASE IF EXISTS ${TEMPLATE_DB}`);
  await admin.query(`CREATE DATABASE ${TEMPLATE_DB} OWNER lab`);
} finally {
  await admin.end();
}

console.log(`[LAB] Created empty ${TEMPLATE_DB}. Applying migrations...`);
execSync(`DATABASE_URL=postgres://lab:lab@localhost:5433/${TEMPLATE_DB} PGSSL_DISABLE=true node backend/src/db/migrate.js`, {
  stdio: 'inherit',
});

console.log(`[LAB] Seeding "${name}" into template...`);
const pool = labPool(TEMPLATE_DB);
try {
  await seedFixture(pool, builder());
} finally {
  await pool.end();
}

// Mark template as a template (forbids ordinary connections; allows TEMPLATE clone).
const admin2 = adminPool();
try {
  await admin2.query(`UPDATE pg_database SET datistemplate = true WHERE datname = '${TEMPLATE_DB}'`);
} finally {
  await admin2.end();
}

console.log(`[LAB] Template "${TEMPLATE_DB}" rebuilt with scenario "${name}".`);
