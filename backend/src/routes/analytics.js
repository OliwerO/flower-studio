import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import { computeAnalytics } from '../services/analyticsService.js';

const router = Router();
router.use(authorize('analytics'));

// GET /api/analytics?from=2025-01-01&to=2025-01-31
// Financial KPIs for the given period. Computation lives in analyticsService.computeAnalytics
// so the assistant finance tool calls the same code and their numbers always match.
router.get('/', async (req, res, next) => {
  try {
    const { from, to } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: 'from and to date params are required.' });
    }

    const report = await computeAnalytics({ from, to });
    res.json(report);
  } catch (err) {
    next(err);
  }
});

export default router;
