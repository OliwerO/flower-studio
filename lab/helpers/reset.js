// lab/helpers/reset.js
//
// Sub-second reset: drops the lab DB and clones it from lab_template.
// Pre-condition: lab_template exists (run rebuild-template.js once).
// Pre-condition: no open connections to `lab` (caller should pool.end()
// any active pool before calling resetLabDb).

import { adminPool } from './db.js';

const TEMPLATE_DB = 'lab_template';
const TARGET_DB = 'lab';

export async function resetLabDb() {
  const admin = adminPool();
  try {
    // Kick off any stale connections to the target DB.
    await admin.query(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = '${TARGET_DB}' AND pid <> pg_backend_pid()
    `);
    await admin.query(`DROP DATABASE IF EXISTS ${TARGET_DB}`);
    await admin.query(`CREATE DATABASE ${TARGET_DB} TEMPLATE ${TEMPLATE_DB} OWNER lab`);
  } finally {
    await admin.end();
  }
}
