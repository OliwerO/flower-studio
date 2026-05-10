// lab/tests/api/migrate-stock-y-model.test.js
//
// Integration tests for backend/scripts/migrate-stock-y-model.js.
// Boots lab Postgres template, runs the script via spawnSync, asserts
// post-state. Each phase has its own describe block.

import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';
import { resetLabDb } from '../../helpers/reset.js';
import { labPool } from '../../helpers/db.js';

const SCRIPT = path.resolve(process.cwd(), '../backend/scripts/migrate-stock-y-model.js');
const LAB_DSN = 'postgres://lab:lab@localhost:5433/lab';

function runScript(args = []) {
  return spawnSync('node', [SCRIPT, ...args], {
    env: { ...process.env, APPROVE: 'yes', DATABASE_URL: LAB_DSN, PGSSL_DISABLE: 'true' },
    encoding: 'utf8',
  });
}

describe('migrate-stock-y-model — pre-condition', () => {
  beforeEach(async () => { await resetLabDb(); });

  it('aborts when any stock row has type_name IS NULL', async () => {
    const pool = labPool();
    try {
      await pool.query(
        `INSERT INTO stock (display_name, current_quantity, type_name) VALUES ('test', 0, NULL)`
      );
      const res = runScript(['--dry-run']);
      expect(res.status).toBe(1);
      expect(res.stderr).toMatch(/type_name IS NULL/);
      expect(res.stderr).toMatch(/#292/);
    } finally {
      await pool.end();
    }
  }, 30_000);

  it('passes pre-condition when all rows have type_name', async () => {
    const res = runScript(['--dry-run']);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/DRY RUN/);
  }, 30_000);
});
