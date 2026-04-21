import crypto from 'node:crypto';
import { Router } from 'express';
import { processWixOrder } from '../services/wix.js';
import { authenticate, authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';

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
  // Log top-level keys + data keys for debugging payload structure
  const topKeys = Object.keys(payload || {});
  const dataKeys = payload?.data ? Object.keys(payload.data) : [];
  console.log(`[WEBHOOK] Wix payload received — top: [${topKeys.join(',')}], data: [${dataKeys.join(',')}]`);
  // Note: full payload NOT logged — may contain customer PII (name, phone, address, payment).

  // Process async — errors are caught and logged inside processWixOrder
  processWixOrder(payload).catch(err => {
    console.error('[WEBHOOK] Wix processing error:', err);
  });
});

// GET /api/webhook/log — owner-only endpoint for viewing webhook history.
// Like a receiving dock log book — shows all packages received, processed, or rejected.
router.get('/log', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    if (!TABLES.WEBHOOK_LOG) {
      return res.json([]);
    }
    const logs = await db.list(TABLES.WEBHOOK_LOG, {
      sort: [{ field: 'Timestamp', direction: 'desc' }],
      maxRecords: 100,
    });
    res.json(logs);
  } catch (err) {
    next(err);
  }
});

// GET /api/webhook/wix-order/:id — admin-only passthrough to Wix's eCommerce
// API. Fetches an order by ID so we can see the exact payload shape Wix
// sends, without needing to intercept a live webhook. Used to debug orders
// that came in before diagnostic logging was deployed.
// Tries the eCommerce v3 Orders endpoint first, then falls back to the older
// Stores v2 Orders endpoint. Returns whichever responds 200.
router.get('/wix-order/:id', authenticate, authorize('admin'), async (req, res) => {
  const apiKey = process.env.WIX_API_KEY;
  const siteId = process.env.WIX_SITE_ID;
  if (!apiKey || !siteId) {
    return res.status(500).json({ error: 'Wix API credentials not configured.' });
  }
  const headers = {
    Authorization: apiKey,
    'wix-site-id': siteId,
    'Content-Type': 'application/json',
  };
  const endpoints = [
    `https://www.wixapis.com/ecom/v1/orders/${encodeURIComponent(req.params.id)}`,
    `https://www.wixapis.com/stores/v2/orders/${encodeURIComponent(req.params.id)}`,
  ];
  const attempts = [];
  for (const url of endpoints) {
    try {
      const r = await fetch(url, { method: 'GET', headers });
      const text = await r.text();
      attempts.push({ url, status: r.status, ok: r.ok });
      if (r.ok) {
        try {
          return res.json({ source: url, order: JSON.parse(text) });
        } catch {
          return res.json({ source: url, raw: text });
        }
      }
    } catch (err) {
      attempts.push({ url, error: err.message });
    }
  }
  return res.status(502).json({ error: 'All Wix endpoints failed', attempts });
});

export default router;
