import crypto from 'node:crypto';
import { Router } from 'express';
import { processWixOrder } from '../services/wix.js';
import { authenticate, authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import * as orderRepo from '../repos/orderRepo.js';
import * as webhookLogRepo from '../repos/webhookLogRepo.js';
import { actorFromReq } from '../utils/actor.js';
import { TABLES } from '../config/airtable.js';
import { listByIds } from '../utils/batchQuery.js';
import { db as pgDb } from '../db/index.js';
import { feedbackReports } from '../db/schema.js';
import { eq, and, ne } from 'drizzle-orm';

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

  // timingSafeEqual throws on length mismatch — that path used to bubble
  // up to the 500 handler when an attacker (or a buggy test) sent a
  // short/garbage signature. A length check first turns that into a
  // clean 401 without leaking timing information about the secret length.
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSignature);
  const isValid = sigBuf.length === expBuf.length
    && crypto.timingSafeEqual(sigBuf, expBuf);

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
    const logs = await webhookLogRepo.listRecent(50);
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
    // 1. Find the App Order by Wix Order ID.
    // orderRepo.findByWixOrderId handles both airtable + postgres modes and
    // returns embedded _lines so we can skip a second Airtable roundtrip for
    // the safety check.
    const existing = await orderRepo.findByWixOrderId(wixOrderId);
    if (!existing) {
      return res.status(404).json({ error: `No App Order found with Wix Order ID ${wixOrderId}.` });
    }
    const lineIds = existing['Order Lines'] || [];
    const deliveryIds = existing['Deliveries'] || [];

    // 1b. SAFETY CHECK — refuse to delete anything that looks composed or
    //     touched. Two independent signals: status beyond 'New', or any line
    //     with a Stock Item link (Wix lines never get stock-linked by the
    //     parser, so presence of a link means the florist added real flowers).
    // In postgres mode _lines carries the full line objects; airtable mode
    // falls back to a separate fetch.
    if (!force) {
      const lineRecords = existing._lines
        || (lineIds.length > 0
          ? await listByIds(TABLES.ORDER_LINES, lineIds, { fields: ['Stock Item', 'Flower Name', 'Quantity'] })
          : []);
      const reasons = [];
      if (existing.Status && existing.Status !== 'New') {
        reasons.push(`Status is "${existing.Status}" (not 'New').`);
      }
      const composed = lineRecords.filter(l =>
        (Array.isArray(l['Stock Item']) && l['Stock Item'].length > 0) || l.stockItemId
      );
      if (composed.length > 0) {
        const names = composed.map(l => `${l.Quantity ?? l.quantity ?? '?'}× ${l['Flower Name'] ?? l.flowerName ?? '?'}`).join(', ');
        reasons.push(`${composed.length} line(s) have Stock Item links (composed bouquet): ${names}.`);
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

    // 2. Delete the order.
    // In postgres mode orderRepo.deleteOrder cascades to lines + delivery via
    // ON DELETE CASCADE — no individual record deletes needed. In airtable
    // mode we fall back to the original per-record path.
    if (orderRepo.getBackendMode() === 'postgres') {
      await orderRepo.deleteOrder(existing._pgId || existing.id, { actor: actorFromReq(req) });
    } else {
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
      await db.deleteRecord(TABLES.ORDERS, existing.id);
    }

    // 3. Re-run the canonical pipeline with a synthetic webhook payload —
    //    processWixOrder's dedup will miss (record just deleted) and fall
    //    through to the Wix API fetch + fresh create.
    await processWixOrder({ id: wixOrderId });

    // 4. Return the newly created App Order so the UI can refresh.
    const fresh = await orderRepo.findByWixOrderId(wixOrderId);
    return res.json({
      deleted: { orderId: existing.id, lineCount: lineIds.length, deliveryCount: deliveryIds.length },
      created: fresh || null,
      forced: force,
    });
  } catch (err) {
    console.error('[REPROCESS] failed:', err);
    return res.status(500).json({ error: err.message || 'Reprocess failed.' });
  }
});

// GitHub issues webhook — fires when a Report issue is closed.
// Notifies the reporter via Telegram feedback bot.
router.post('/github', async (req, res) => {
  const event = req.headers['x-github-event'];
  if (event !== 'issues') return res.json({ ok: true });

  const { action, issue } = req.body;
  if (action !== 'closed' || !issue?.number) return res.json({ ok: true });

  res.json({ ok: true }); // respond immediately — notification is async

  try {
    // Find a feedback_reports row for this issue number with a telegram_chat_id
    const [row] = await pgDb
      .select({ telegramChatId: feedbackReports.telegramChatId })
      .from(feedbackReports)
      .where(
        and(
          eq(feedbackReports.githubIssueNumber, issue.number),
          ne(feedbackReports.githubIssueNumber, 0), // exclude sentinel registration rows
        )
      )
      .limit(1);

    if (!row?.telegramChatId) return;

    const token = process.env.FEEDBACK_BOT_TOKEN;
    if (!token) return;

    const text = `✅ Ваш отчёт исправлен!\n\n«${issue.title}» (#${issue.number}) закрыт.\n${issue.html_url}`;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: row.telegramChatId, text }),
    });
  } catch (err) {
    console.error('[WEBHOOK] GitHub close notification error:', err.message);
  }
});

export default router;
