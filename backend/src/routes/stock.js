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

// POST /api/stock — create a new stock item (florist quick-add during spontaneous delivery)
// Body: { displayName, category, quantity, costPrice }
router.post('/', async (req, res, next) => {
  try {
    const { displayName, category, quantity, costPrice } = req.body;
    if (!displayName) return res.status(400).json({ error: 'displayName is required' });

    const item = await db.create(TABLES.STOCK, {
      'Display Name':       displayName,
      'Purchase Name':      displayName,
      Category:             category || 'Other',
      'Current Quantity':   Number(quantity) || 0,
      'Current Cost Price': Number(costPrice) || 0,
      Active:               true,
    });
    res.status(201).json(item);
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

// POST /api/stock/:id/write-off — record spoiled/dead stems
// Decrements Current Quantity and adds to Dead/Unsold Stems counter.
// Body: { quantity: 5, reason?: "wilted" }
router.post('/:id/write-off', async (req, res, next) => {
  try {
    const { quantity, reason } = req.body;

    if (typeof quantity !== 'number' || quantity <= 0) {
      return res.status(400).json({ error: 'quantity must be a positive number.' });
    }

    const item = await db.getById(TABLES.STOCK, req.params.id);
    const currentQty = item['Current Quantity'] || 0;
    const currentDead = item['Dead/Unsold Stems'] || 0;

    // Can't write off more than available
    const actualWriteOff = Math.min(quantity, currentQty);

    const updated = await db.update(TABLES.STOCK, req.params.id, {
      'Current Quantity':   currentQty - actualWriteOff,
      'Dead/Unsold Stems':  currentDead + actualWriteOff,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
