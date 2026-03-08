import crypto from 'node:crypto';
import { Router } from 'express';
import { processWixOrder } from '../services/wix.js';

const router = Router();

/**
 * Verify Wix webhook HMAC-SHA256 signature.
 * Like checking a tamper-evident seal on a delivery — confirms the
 * package actually came from Wix and wasn't modified in transit.
 *
 * If WIX_WEBHOOK_SECRET is not configured, logs a warning and allows
 * the request through (for dev environments without secrets set up).
 */
function verifyWixSignature(req, res, next) {
  const secret = process.env.WIX_WEBHOOK_SECRET;

  if (!secret) {
    console.warn('[WEBHOOK] WIX_WEBHOOK_SECRET not set — skipping signature verification (dev only)');
    return next();
  }

  const signature = req.headers['x-wix-signature'];
  if (!signature) {
    console.error('[WEBHOOK] Missing x-wix-signature header');
    return res.status(401).json({ error: 'Missing webhook signature' });
  }

  // req.rawBody is set by the raw body middleware in index.js
  const rawBody = req.rawBody;
  if (!rawBody) {
    console.error('[WEBHOOK] No raw body available for signature verification');
    return res.status(401).json({ error: 'Cannot verify webhook signature' });
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');

  const isValid = crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature),
  );

  if (!isValid) {
    console.error('[WEBHOOK] Invalid Wix webhook signature');
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  next();
}

// POST /api/webhook/wix — receives Wix eCommerce order events.
// Responds 200 immediately (Wix retries up to 12x on failure).
// Processing happens async — fire-and-forget after the response.
// Like a receiving dock: sign for the package instantly,
// then unpack and process it in the warehouse.
router.post('/wix', verifyWixSignature, (req, res) => {
  res.sendStatus(200); // acknowledge immediately — never make Wix wait

  const payload = req.body;
  console.log('[WEBHOOK] Wix order received:', JSON.stringify(payload, null, 2).slice(0, 500));

  // Process async — errors are caught and logged inside processWixOrder
  processWixOrder(payload).catch(err => {
    console.error('[WEBHOOK] Wix processing error:', err);
  });
});

export default router;
