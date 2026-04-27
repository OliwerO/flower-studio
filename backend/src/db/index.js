// Postgres + Drizzle singleton.
//
// Gated on DATABASE_URL — backend boots without Postgres until the
// per-entity cutover flips to PG (Phase 3+). Once flipped, the absence
// of DATABASE_URL becomes a startup error in the relevant code paths;
// here we stay tolerant and just log.
//
// Exposes:
//   - `pool`            raw pg Pool (for LISTEN/NOTIFY in future SSE work)
//   - `db`              drizzle handle (used by repos in Phase 3+)
//   - `isPostgresConfigured`  boolean — guards repo branches during shadow-write
//   - `connectPostgres()`     called once at boot to log the version
//   - `disconnectPostgres()`  for graceful shutdown

import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

const { Pool } = pg;

const url = process.env.DATABASE_URL;
export const isPostgresConfigured = Boolean(url);

// Railway Postgres terminates SSL at the proxy with a self-signed cert by
// default. Keep `rejectUnauthorized: false` unless the operator opts in via
// PGSSL_REJECT_UNAUTHORIZED=true (e.g. when they've pinned a trusted CA).
function buildSslConfig() {
  if (!url) return undefined;
  if (process.env.PGSSL_DISABLE === 'true') return false;
  return process.env.PGSSL_REJECT_UNAUTHORIZED === 'true'
    ? { rejectUnauthorized: true }
    : { rejectUnauthorized: false };
}

export const pool = isPostgresConfigured
  ? new Pool({
      connectionString: url,
      ssl: buildSslConfig(),
      max: 10,
      idleTimeoutMillis: 30_000,
    })
  : null;

export const db = pool ? drizzle(pool, { schema }) : null;

export async function connectPostgres() {
  if (!pool) {
    console.log('[PG] DATABASE_URL not set — Postgres disabled. Backend running on Airtable only.');
    return;
  }
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT version() AS v');
    console.log(`[PG] Connected: ${rows[0].v}`);
  } finally {
    client.release();
  }
}

export async function disconnectPostgres() {
  if (pool) await pool.end();
}
