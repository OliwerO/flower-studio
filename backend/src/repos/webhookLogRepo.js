// Webhook Log repository — append-only event log for incoming Wix webhooks.
import { db } from '../db/index.js';
import { webhookLog } from '../db/schema.js';
import { desc } from 'drizzle-orm';

export async function listRecent(limit = 20) {
  const rows = await db.select().from(webhookLog).orderBy(desc(webhookLog.timestamp)).limit(limit);
  return rows.map(r => ({
    id:             r.id,
    Timestamp:      r.timestamp,
    'Wix Order ID': r.wixOrderId,
    Status:         r.status,
    'App Order ID': r.appOrderId || '',
    Error:          r.error || '',
  }));
}

export async function logEvent({ status, wixOrderId, appOrderId, errorMessage }) {
  try {
    await db.insert(webhookLog).values({
      wixOrderId:  wixOrderId || 'unknown',
      status,
      timestamp:   new Date(),
      appOrderId:  appOrderId || null,
      error:       errorMessage ? errorMessage.slice(0, 2000) : null,
    });
  } catch (err) {
    console.error('[WEBHOOK_LOG] Failed to insert PG row:', err.message);
  }
}
