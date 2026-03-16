// Webhook event logger — persists every incoming webhook to Airtable's Webhook Log table.
// Like a goods-receiving register: every delivery gets logged regardless of outcome.

import * as db from './airtable.js';
import { TABLES } from '../config/airtable.js';

/**
 * Log a webhook event to the Webhook Log table.
 * @param {'Success'|'Failed'|'Duplicate'} status
 * @param {string} wixOrderId
 * @param {string|null} appOrderId - linked App Order record ID (if created)
 * @param {string} [errorMessage] - error details if failed
 * @param {object} [rawPayload] - full webhook payload for debugging
 */
export async function logWebhookEvent({ status, wixOrderId, appOrderId, errorMessage, rawPayload }) {
  try {
    if (!TABLES.WEBHOOK_LOG) {
      console.warn('[WEBHOOK_LOG] Table ID not configured — skipping log');
      return;
    }

    // Use only fields that are safe with typecast:true (auto-creates missing fields).
    // Keep it simple — Wix Order ID + Status + timestamp + optional details.
    const fields = {
      'Wix Order ID': wixOrderId || 'unknown',
      Status: status,
      Timestamp: new Date().toISOString(),
    };

    if (appOrderId) {
      fields['App Order ID'] = appOrderId; // text, not link — avoids field type mismatch
    }
    if (errorMessage) {
      fields['Error'] = errorMessage.slice(0, 1000);
    }

    await db.create(TABLES.WEBHOOK_LOG, fields);
  } catch (err) {
    // Never let logging failure break the webhook flow
    console.error('[WEBHOOK_LOG] Failed to log event:', err.message);
  }
}
