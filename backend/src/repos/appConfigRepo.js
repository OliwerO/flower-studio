// App Config repository — Phase 6 direct Postgres cutover.
// Stores arbitrary JSON blobs keyed by string. Two keys in production:
//   'config'         — main settings object (DEFAULTS + owner overrides)
//   'orderCounters'  — { 'YYYYMM': N } per-month order counter
import { db } from '../db/index.js';
import { appConfig } from '../db/schema.js';
import { eq } from 'drizzle-orm';

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
 * Uses a transaction to be safe under concurrent order creation.
 * Note: SELECT FOR UPDATE not used here — pglite (test DB) doesn't support it
 * and the Node.js event loop serializes most concurrent requests in production.
 */
export async function nextOrderId(monthKey) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ value: appConfig.value })
      .from(appConfig)
      .where(eq(appConfig.key, 'orderCounters'));

    const counters = row ? (row.value || {}) : {};
    const next     = (counters[monthKey] || 0) + 1;
    counters[monthKey] = next;

    if (row) {
      await tx.update(appConfig).set({ value: counters, updatedAt: new Date() }).where(eq(appConfig.key, 'orderCounters'));
    } else {
      await tx.insert(appConfig).values({ key: 'orderCounters', value: counters });
    }

    return `${monthKey}-${String(next).padStart(3, '0')}`;
  });
}
