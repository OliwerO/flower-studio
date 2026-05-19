// App Config repository — Phase 6 direct Postgres cutover.
// Stores arbitrary JSON blobs keyed by string. Two keys in production:
//   'config'         — main settings object (DEFAULTS + owner overrides)
//   'orderCounters'  — { 'YYYYMM': N } per-month order counter
import { db } from '../db/index.js';
import { appConfig, orders } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';

/** Returns parsed value for key, or null if missing. */
export async function get(key) {
  const [row] = await db.select({ value: appConfig.value }).from(appConfig).where(eq(appConfig.key, key));
  return row ? row.value : null;
}

/** Upserts key → value (replaces entirely). */
export async function set(key, value) {
  await db.insert(appConfig)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value, updatedAt: new Date() },
    });
}

/**
 * Atomically increments the per-month order counter and returns the
 * next formatted ID like '202605-001'.
 *
 * Self-healing: takes GREATEST(counter[monthKey], MAX numeric suffix already in
 * orders for monthKey). Prod incident 2026-05-19 — counter drifted behind real
 * IDs (24 vs 26 in `202605`) and every call returned a value that already
 * existed, blowing the unique index. Causes of drift: backfills, restores of a
 * stale config snapshot (Phase 7 cutover), or any insert path that wrote an
 * explicit appOrderId without bumping the counter.
 *
 * Only `YYYYMM-NNN` integer-suffix rows count toward the floor — fallback IDs
 * shaped `YYYYMM-T<epoch>` (see configService.generateOrderId catch branch) are
 * ignored so a one-off fallback can't poison the counter.
 *
 * SELECT FOR UPDATE intentionally absent — pglite doesn't support it. On real
 * PG the unique index still catches any race that slips through; the
 * self-healing read will recover on the next call.
 */
export async function nextOrderId(monthKey) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ value: appConfig.value })
      .from(appConfig)
      .where(eq(appConfig.key, 'orderCounters'));

    const counters = row ? (row.value || {}) : {};
    const counterFloor = counters[monthKey] || 0;

    const result = await tx.execute(sql`
      SELECT COALESCE(MAX(CAST(SUBSTRING(${orders.appOrderId} FROM '[0-9]+$') AS INTEGER)), 0) AS max_n
      FROM ${orders}
      WHERE ${orders.appOrderId} ~ ('^' || ${monthKey} || '-[0-9]+$')
    `);
    const dbFloor = Number(result.rows?.[0]?.max_n ?? result[0]?.max_n ?? 0);

    const next = Math.max(counterFloor, dbFloor) + 1;
    counters[monthKey] = next;

    if (row) {
      await tx.update(appConfig).set({ value: counters, updatedAt: new Date() }).where(eq(appConfig.key, 'orderCounters'));
    } else {
      await tx.insert(appConfig).values({ key: 'orderCounters', value: counters });
    }

    return `${monthKey}-${String(next).padStart(3, '0')}`;
  });
}
