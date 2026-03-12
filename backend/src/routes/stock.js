import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';
import { sanitizeFormulaValue } from '../utils/sanitize.js';

const router = Router();
router.use(authorize('stock'));

const STOCK_PATCH_ALLOWED = [
  'Display Name', 'Purchase Name', 'Category', 'Current Quantity', 'Unit',
  'Current Cost Price', 'Current Sell Price', 'Supplier', 'Reorder Threshold',
  'Active', 'Supplier Notes', 'Dead/Unsold Stems', 'Lot Size',
];

function pickAllowed(body, allowedFields) {
  const filtered = {};
  for (const key of allowedFields) {
    if (key in body) filtered[key] = body[key];
  }
  return filtered;
}

// GET /api/stock?category=Roses&includeEmpty=true
// By default hides items with qty=0 (old depleted batches). Pass includeEmpty=true to see all.
router.get('/', async (req, res, next) => {
  try {
    const { category, includeEmpty } = req.query;
    const filters = ['{Active} = TRUE()'];

    if (includeEmpty !== 'true') filters.push('{Current Quantity} > 0');
    if (category) filters.push(`{Category} = '${sanitizeFormulaValue(category)}'`);

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

// GET /api/stock/velocity — days of supply per stock item based on last 30 days of sales
// IMPORTANT: defined before /:id routes so "velocity" isn't interpreted as an ID param.
router.get('/velocity', async (req, res, next) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];

    // Fetch non-cancelled orders in the last 30 days
    const recentOrders = await db.list(TABLES.ORDERS, {
      filterByFormula: `AND(NOT(IS_BEFORE({Order Date}, '${thirtyDaysAgo}')), NOT(IS_AFTER({Order Date}, '${today}')), {Status} != 'Cancelled')`,
      fields: ['Order Lines'],
    });

    const lineIds = recentOrders.flatMap(o => o['Order Lines'] || []);

    // Batch-fetch order lines (100 per request — Airtable formula length limit)
    const lines = [];
    for (let i = 0; i < lineIds.length; i += 100) {
      const batch = lineIds.slice(i, i + 100);
      if (batch.length === 0) continue;
      const recs = await db.list(TABLES.ORDER_LINES, {
        filterByFormula: `OR(${batch.map(id => `RECORD_ID() = "${id}"`).join(',')})`,
        fields: ['Stock Item', 'Quantity'],
        maxRecords: 100,
      });
      lines.push(...recs);
    }

    // Sum qty sold per stock item over the 30-day window
    const qtySoldByStock = {};
    for (const line of lines) {
      const stockId = line['Stock Item']?.[0];
      if (stockId) {
        qtySoldByStock[stockId] = (qtySoldByStock[stockId] || 0) + (line.Quantity || 0);
      }
    }

    // Build velocity map: stockId → { qtySold30d, avgDailyUsage }
    // daysOfSupply is left to the frontend — it needs current qty from the stock list
    const velocity = {};
    for (const [stockId, qtySold] of Object.entries(qtySoldByStock)) {
      const avgDaily = qtySold / 30;
      velocity[stockId] = {
        qtySold30d: qtySold,
        avgDailyUsage: Math.round(avgDaily * 10) / 10,
      };
    }

    res.json(velocity);
  } catch (err) {
    next(err);
  }
});

// POST /api/stock — create a new stock item (florist quick-add during spontaneous delivery)
// Body: { displayName, category, quantity, costPrice, sellPrice?, supplier?, unit? }
router.post('/', async (req, res, next) => {
  try {
    const { displayName, category, quantity, costPrice, sellPrice, supplier, unit } = req.body;
    if (!displayName) return res.status(400).json({ error: 'displayName is required' });

    const fields = {
      'Display Name':       displayName,
      'Purchase Name':      displayName,
      Category:             category || 'Other',
      'Current Quantity':   Number(quantity) || 0,
      'Current Cost Price': Number(costPrice) || 0,
      Active:               true,
    };
    if (sellPrice)  fields['Current Sell Price'] = Number(sellPrice);
    if (supplier)   fields['Supplier'] = supplier;
    if (unit)       fields['Unit'] = unit;

    const item = await db.create(TABLES.STOCK, fields);
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/stock/:id — update prices, threshold, etc.
// When Reorder Threshold changes, sync it across all batches of the same flower
// (matched by Purchase Name) so the threshold applies uniformly.
router.patch('/:id', async (req, res, next) => {
  try {
    const safeFields = pickAllowed(req.body, STOCK_PATCH_ALLOWED);
    const item = await db.update(TABLES.STOCK, req.params.id, safeFields);

    // Sync threshold across batches of the same base flower
    if ('Reorder Threshold' in safeFields && item['Purchase Name']) {
      const baseName = item['Purchase Name'];
      const siblings = await db.list(TABLES.STOCK, {
        filterByFormula: `AND({Purchase Name} = '${sanitizeFormulaValue(baseName)}', RECORD_ID() != '${req.params.id}')`,
        fields: ['Reorder Threshold'],
      });
      for (const sib of siblings) {
        if (sib['Reorder Threshold'] !== safeFields['Reorder Threshold']) {
          await db.update(TABLES.STOCK, sib.id, {
            'Reorder Threshold': safeFields['Reorder Threshold'],
          });
        }
      }
    }

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
    const currentQty = item['Current Quantity'] || 0;
    const newQty = currentQty + delta;

    if (newQty < 0) {
      console.warn(`[STOCK] Negative stock: ${req.params.id} going to ${newQty} (current: ${currentQty}, delta: ${delta})`);
    }

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

    // Build update fields
    const fields = {
      'Current Quantity':   currentQty - actualWriteOff,
      'Dead/Unsold Stems':  currentDead + actualWriteOff,
    };

    // Append write-off reason to Supplier Notes with timestamp
    if (reason && reason.trim()) {
      const today = new Date().toISOString().slice(0, 10);
      const entry = `[WRITE-OFF ${today}] ${actualWriteOff} stems — ${reason.trim()}`;
      const existing = item['Supplier Notes'] || '';
      fields['Supplier Notes'] = existing ? `${existing}\n${entry}` : entry;
    }

    const updated = await db.update(TABLES.STOCK, req.params.id, fields);

    // Also log to Stock Loss Log table for analytics breakdown
    if (TABLES.STOCK_LOSS_LOG && actualWriteOff > 0) {
      const lossReason = (reason === 'Wilted' || reason === 'Damaged') ? reason : 'Other';
      db.create(TABLES.STOCK_LOSS_LOG, {
        Date: new Date().toISOString().split('T')[0],
        'Stock Item': [req.params.id],
        Quantity: actualWriteOff,
        Reason: lossReason,
        Notes: reason && reason !== lossReason ? reason : '',
      }).catch(err => console.error('[STOCK] Failed to log to Stock Loss Log:', err.message));
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
