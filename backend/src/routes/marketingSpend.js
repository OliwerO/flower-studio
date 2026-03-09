// Marketing Spend routes — track ad spend per channel per month.
// Like a cost-center ledger: how much goes into each sales channel.

import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';

const router = Router();
router.use(authorize('admin'));

// GET /api/marketing-spend?from=2026-01&to=2026-03
// Returns all marketing spend records in the date range.
router.get('/', async (req, res, next) => {
  try {
    if (!TABLES.MARKETING_SPEND) return res.json([]);

    const filters = [];
    if (req.query.from) filters.push(`NOT(IS_BEFORE({Month}, '${req.query.from}-01'))`);
    if (req.query.to) filters.push(`NOT(IS_AFTER({Month}, '${req.query.to}-28'))`);

    const records = await db.list(TABLES.MARKETING_SPEND, {
      filterByFormula: filters.length ? `AND(${filters.join(',')})` : '',
      sort: [{ field: 'Month', direction: 'desc' }],
    });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

// POST /api/marketing-spend — add a spend entry
// Body: { month: "2026-03-01", channel: "Instagram", amount: 500, notes: "" }
router.post('/', async (req, res, next) => {
  try {
    if (!TABLES.MARKETING_SPEND) {
      return res.status(400).json({ error: 'Marketing Spend table not configured' });
    }
    const { month, channel, amount, notes } = req.body;
    if (!month || !channel || amount == null) {
      return res.status(400).json({ error: 'month, channel, and amount are required' });
    }
    const record = await db.create(TABLES.MARKETING_SPEND, {
      Month: month,
      Channel: channel,
      Amount: Number(amount),
      Notes: notes || '',
    });
    res.status(201).json(record);
  } catch (err) {
    next(err);
  }
});

export default router;
