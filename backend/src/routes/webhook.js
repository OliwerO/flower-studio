import { Router } from 'express';

const router = Router();

// POST /api/webhook/wix — placeholder for Phase 4
// Responds 200 immediately (Wix retries on failure). Processing is async.
router.post('/wix', (req, res) => {
  res.sendStatus(200); // acknowledge immediately — never make Wix wait

  const payload = req.body;
  console.log('[WEBHOOK] Wix order received:', JSON.stringify(payload, null, 2));

  // Full implementation in Phase 4:
  // - Deduplicate by Wix Order ID
  // - Match or create customer
  // - Create App Order + Order Lines + Delivery
  // - Trigger SSE notification
});

export default router;
