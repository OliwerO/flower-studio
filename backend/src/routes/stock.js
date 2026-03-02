import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';

const router = Router();
router.use(authorize('stock'));

// GET /api/stock?category=Roses&activeOnly=true
router.get('/', async (req, res, next) => {
  try {
    const { category } = req.query;
    const filters = ['{Active} = TRUE()'];

    if (category) filters.push(`{Category} = '${category}'`);

    const stock = await db.list(TABLES.STOCK, {
      filterByFormula: `AND(${filters.join(', ')})`,
      sort: [
        { field: 'Category', direction: 'asc' },
        { field: 'Display Name', direction: 'asc' },
      ],
    });

    res.json(stock);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/stock/:id — update prices, threshold, etc.
router.patch('/:id', async (req, res, next) => {
  try {
    const item = await db.update(TABLES.STOCK, req.params.id, req.body);
    res.json(item);
  } catch (err) {
    next(err);
  }
});

// POST /api/stock/:id/adjust — increment or decrement quantity with +/- delta
// Body: { delta: 5 } or { delta: -3 }
router.post('/:id/adjust', async (req, res, next) => {
  try {
    const { delta } = req.body;

    if (typeof delta !== 'number') {
      return res.status(400).json({ error: 'delta must be a number (positive or negative).' });
    }

    const item = await db.getById(TABLES.STOCK, req.params.id);
    const newQty = (item['Current Quantity'] || 0) + delta;

    const updated = await db.update(TABLES.STOCK, req.params.id, {
      'Current Quantity': newQty,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
