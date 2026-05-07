// Webhook Log repository — append-only event log for incoming Wix webhooks.
import { db } from '../db/index.js';
import { webhookLog } from '../db/schema.js';

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
