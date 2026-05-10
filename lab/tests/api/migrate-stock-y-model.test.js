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

describe('migrate-stock-y-model — Phase 1: aggregate split', () => {
  beforeEach(async () => { await resetLabDb(); });

  it('splits one aggregate DE into per-Required-By dated DEs', async () => {
    const pool = labPool();
    try {
      // Pre: find the aggregate DE by display_name + date IS NULL.
      const pre = await pool.query(
        `SELECT id FROM stock WHERE display_name = 'Peony Pink 60cm' AND date IS NULL AND current_quantity = -8`
      );
      expect(pre.rows.length).toBe(1);
      const aggId = pre.rows[0].id;

      const res = runScript();
      expect(res.status).toBe(0);

      // Post: aggregate gone.
      const gone = await pool.query(`SELECT id FROM stock WHERE id = $1`, [aggId]);
      expect(gone.rows.length).toBe(0);

      // Post: 2 dated DEs, one per date, with correct qty.
      const dated = await pool.query(
        `SELECT date::text, current_quantity, type_name, colour, size_cm
         FROM stock WHERE type_name = 'Peony' AND colour = 'Pink' AND size_cm = 60
                    AND current_quantity < 0 AND date IS NOT NULL
         ORDER BY date ASC`
      );
      expect(dated.rows).toEqual([
        { date: '2026-06-01', current_quantity: -5, type_name: 'Peony', colour: 'Pink', size_cm: 60 },
        { date: '2026-06-03', current_quantity: -3, type_name: 'Peony', colour: 'Pink', size_cm: 60 },
      ]);

      // Post: order_lines repointed to the new dated DEs.
      const lines = await pool.query(
        `SELECT ol.stock_item_id, s.date::text
         FROM order_lines ol JOIN stock s ON s.id::text = ol.stock_item_id
         WHERE ol.flower_name = 'Peony Pink 60cm'
         ORDER BY ol.quantity DESC`
      );
      expect(lines.rows.length).toBe(2);
      expect(lines.rows[0].date).toBe('2026-06-01');
      expect(lines.rows[1].date).toBe('2026-06-03');
    } finally {
      await pool.end();
    }
  }, 60_000);
});

describe('migrate-stock-y-model — Phase 2: orphan negative → today', () => {
  beforeEach(async () => { await resetLabDb(); });

  it('converts orphan aggregate DE to today-dated DE with preserved variety', async () => {
    const pool = labPool();
    const today = new Date().toISOString().slice(0, 10);
    try {
      // Pre: orphan row exists with date IS NULL.
      const pre = await pool.query(
        `SELECT id FROM stock WHERE display_name = 'Tulip Yellow 40cm' AND date IS NULL`
      );
      expect(pre.rows.length).toBe(1);

      const res = runScript();
      expect(res.status).toBe(0);

      // Post: row now has date = today, qty and variety preserved.
      const post = await pool.query(
        `SELECT date::text, current_quantity, type_name, colour, size_cm
         FROM stock WHERE type_name = 'Tulip' AND colour = 'Yellow' AND size_cm = 40
                    AND current_quantity < 0`
      );
      expect(post.rows.length).toBe(1);
      expect(post.rows[0]).toMatchObject({
        date: today, current_quantity: -4, type_name: 'Tulip', colour: 'Yellow', size_cm: 40,
      });

      // Original aggregate gone (no row with date IS NULL for this variety).
      const gone = await pool.query(
        `SELECT id FROM stock WHERE display_name = 'Tulip Yellow 40cm' AND date IS NULL`
      );
      expect(gone.rows.length).toBe(0);
    } finally {
      await pool.end();
    }
  }, 60_000);
});
