// Sync Log repository — append-only log of Wix product sync runs.
import { db } from '../db/index.js';
import { syncLog } from '../db/schema.js';
import { desc } from 'drizzle-orm';

export async function logSync({ status, newProducts, updated, deactivated, priceSyncs, stockSyncs, errorMessage }) {
  await db.insert(syncLog).values({
    timestamp:    new Date(),
    status,
    newProducts:  newProducts  || 0,
    updated:      updated      || 0,
    deactivated:  deactivated  || 0,
    priceSyncs:   priceSyncs   || 0,
    stockSyncs:   stockSyncs   || 0,
    errorMessage: errorMessage || '',
  });
}

export async function listRecent(limit = 20) {
  const rows = await db.select().from(syncLog).orderBy(desc(syncLog.timestamp)).limit(limit);
  return rows.map(r => ({
    id:              r.id,
    Timestamp:       r.timestamp,
    Status:          r.status,
    'New Products':  r.newProducts,
    Updated:         r.updated,
    Deactivated:     r.deactivated,
    'Price Syncs':   r.priceSyncs,
    'Stock Syncs':   r.stockSyncs,
    'Error Message': r.errorMessage,
  }));
}
