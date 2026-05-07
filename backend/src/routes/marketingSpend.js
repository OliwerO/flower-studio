// Marketing Spend routes — track ad spend per channel per month.
import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as repo from '../repos/marketingSpendRepo.js';

const router = Router();
router.use(authorize('admin'));

// GET /api/marketing-spend?from=2026-01&to=2026-03
router.get('/', async (req, res, next) => {
  try {
    const records = await repo.list({ from: req.query.from, to: req.query.to });
    res.json(records);
  } catch (err) { next(err); }
});

// POST /api/marketing-spend
router.post('/', async (req, res, next) => {
  try {
    const { month, channel, amount, notes } = req.body;
    if (!month || !channel || amount === undefined || amount === null)
      return res.status(400).json({ error: 'month, channel, and amount are required.' });
    if (typeof amount !== 'number' || amount < 0)
      return res.status(400).json({ error: 'amount must be a non-negative number.' });
    if (typeof channel !== 'string' || !channel.trim())
      return res.status(400).json({ error: 'channel must be a non-empty string.' });
    const record = await repo.create({ month, channel, amount, notes });
    res.status(201).json(record);
  } catch (err) { next(err); }
});

export default router;
