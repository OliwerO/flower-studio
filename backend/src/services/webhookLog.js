// Webhook event logger — persists every incoming webhook to Postgres webhook_log table.
import { logEvent } from '../repos/webhookLogRepo.js';

export async function logWebhookEvent({ status, wixOrderId, appOrderId, errorMessage, rawPayload }) {
  void rawPayload; // not persisted — too large; Railway logs capture it via console.log in wix.js
  await logEvent({ status, wixOrderId, appOrderId, errorMessage });
}
