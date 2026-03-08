import { Router } from 'express';
import { processWixOrder } from '../services/wix.js';

const router = Router();

// POST /api/webhook/wix — receives Wix eCommerce order events.
// Responds 200 immediately (Wix retries up to 12× on failure).
// Processing happens async — fire-and-forget after the response.
// Like a receiving dock: sign for the package instantly,
// then unpack and process it in the warehouse.
router.post('/wix', (req, res) => {
  res.sendStatus(200); // acknowledge immediately — never make Wix wait

  const payload = req.body;
  console.log('[WEBHOOK] Wix order received:', JSON.stringify(payload, null, 2).slice(0, 500));

  // Process async — errors are caught and logged inside processWixOrder
  processWixOrder(payload).catch(err => {
    console.error('[WEBHOOK] Wix processing error:', err);
  });
});

export default router;
