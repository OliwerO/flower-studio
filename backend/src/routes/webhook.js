import crypto from 'node:crypto';
import { Router } from 'express';
import { processWixOrder } from '../services/wix.js';
import { authenticate, authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';
import { listByIds } from '../utils/batchQuery.js';

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

// POST /api/webhook/wix-order/:id/reprocess — admin-only. Deletes the
// existing App Order (+ its lines and delivery record) for the given Wix
// Order ID, then re-runs processWixOrder so the new parser populates every
// field from canonical Wix data. Use this when Wix won't re-fire a webhook
// and you need to correct orders that came in under an older buggy parser.
//
// SAFETY GATE: refuses to touch orders that look composed or edited —
// any Order Line with a Stock Item link OR any Status other than 'New'.
// Responds 409 with the reasons so the caller can see why it refused.
// If you *really* need to reprocess a composed order (accepting data loss),
// pass ?force=true.
router.post('/wix-order/:id/reprocess', authenticate, authorize('admin'), async (req, res) => {
  const wixOrderId = req.params.id;
  const force = req.query.force === 'true' || req.query.force === '1';
  try {
    // 1. Find the App Order row by Wix Order ID.
    const matches = await db.list(TABLES.ORDERS, {
      filterByFormula: `{Wix Order ID} = '${wixOrderId}'`,
      maxRecords: 1,
    });
    if (matches.length === 0) {
      return res.status(404).json({ error: `No App Order found with Wix Order ID ${wixOrderId}.` });
    }
    const existing = matches[0];
    const lineIds = existing['Order Lines'] || [];
    const deliveryIds = existing['Deliveries'] || [];

    // 1b. SAFETY CHECK — refuse to delete anything that looks composed or
    //     touched. Two independent signals: status beyond 'New', or any line
    //     with a Stock Item link (Wix lines never get stock-linked by the
    //     parser, so presence of a link means the florist added real flowers).
    if (!force) {
      const reasons = [];
      if (existing.Status && existing.Status !== 'New') {
        reasons.push(`Status is "${existing.Status}" (not 'New').`);
      }
      if (lineIds.length > 0) {
        const lineRecords = await listByIds(TABLES.ORDER_LINES, lineIds, {
          fields: ['Stock Item', 'Flower Name', 'Quantity'],
        });
        const composed = lineRecords.filter(l => Array.isArray(l['Stock Item']) && l['Stock Item'].length > 0);
        if (composed.length > 0) {
          const names = composed.map(l => `${l.Quantity || '?'}× ${l['Flower Name'] || '?'}`).join(', ');
          reasons.push(`${composed.length} line(s) have Stock Item links (composed bouquet): ${names}.`);
        }
      }
      if (reasons.length > 0) {
        return res.status(409).json({
          error: 'Reprocess refused — order appears composed or edited.',
          reasons,
          hint: 'Pass ?force=true if you truly want to delete and recreate (accepts data loss).',
          appOrderId: existing['App Order ID'] || existing.id,
        });
      }
    }

    // 2. Delete linked order lines and delivery records first so nothing
    //    orphans. Swallow per-record failures — the main goal is the
    //    App Order itself.
    for (const lineId of lineIds) {
      await db.deleteRecord(TABLES.ORDER_LINES, lineId).catch(err => {
        console.warn(`[REPROCESS] delete line ${lineId}:`, err.message);
      });
    }
    for (const delId of deliveryIds) {
      await db.deleteRecord(TABLES.DELIVERIES, delId).catch(err => {
        console.warn(`[REPROCESS] delete delivery ${delId}:`, err.message);
      });
    }

    // 3. Delete the App Order.
    await db.deleteRecord(TABLES.ORDERS, existing.id);

    // 4. Re-run the canonical pipeline with a synthetic webhook payload —
    //    processWixOrder's dedup will miss (record just deleted) and fall
    //    through to the Wix API fetch + fresh create.
    await processWixOrder({ id: wixOrderId });

    // 5. Return the newly created App Order so the UI can refresh.
    const created = await db.list(TABLES.ORDERS, {
      filterByFormula: `{Wix Order ID} = '${wixOrderId}'`,
      maxRecords: 1,
    });
    return res.json({
      deleted: { orderId: existing.id, lineCount: lineIds.length, deliveryCount: deliveryIds.length },
      created: created[0] || null,
      forced: force,
    });
  } catch (err) {
    console.error('[REPROCESS] failed:', err);
    return res.status(500).json({ error: err.message || 'Reprocess failed.' });
  }
});

export default router;
