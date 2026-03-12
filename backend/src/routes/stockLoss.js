// Stock Loss routes — log waste events (wilted, damaged, overstock, etc.).
// Like a defect register on the factory floor: track what was scrapped and why.

import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';

const router = Router();
router.use(authorize('orders')); // florists + owner can log waste

const VALID_REASONS = ['Wilted', 'Damaged', 'Overstock', 'Other'];

// GET /api/stock-loss?from=2026-01-01&to=2026-03-31
// Enriches each entry with flower name + supplier from the linked Stock record.
router.get('/', async (req, res, next) => {
  try {
    if (!TABLES.STOCK_LOSS_LOG) return res.json([]);

    const filters = [];
    if (req.query.from) filters.push(`NOT(IS_BEFORE({Date}, '${req.query.from}'))`);
    if (req.query.to) filters.push(`NOT(IS_AFTER({Date}, '${req.query.to}'))`);

    const records = await db.list(TABLES.STOCK_LOSS_LOG, {
      filterByFormula: filters.length ? `AND(${filters.join(',')})` : '',
      sort: [{ field: 'Date', direction: 'desc' }],
    });

    // Collect unique stock item IDs to batch-fetch names + suppliers
    const stockIds = [...new Set(records.flatMap(r => r['Stock Item'] || []))];
    const stockMap = {};
    for (let i = 0; i < stockIds.length; i += 100) {
      const batch = stockIds.slice(i, i + 100);
      const items = await db.list(TABLES.STOCK, {
        filterByFormula: `OR(${batch.map(id => `RECORD_ID() = "${id}"`).join(',')})`,
        fields: ['Display Name', 'Purchase Name', 'Supplier', 'Current Cost Price'],
      });
      for (const item of items) stockMap[item.id] = item;
    }

    // Enrich each loss entry
    const enriched = records.map(r => {
      const stockId = r['Stock Item']?.[0];
      const stock = stockMap[stockId];
      return {
        ...r,
        flowerName: stock?.['Display Name'] || stock?.['Purchase Name'] || '—',
        supplier: stock?.Supplier || '—',
        costPrice: stock?.['Current Cost Price'] || 0,
      };
    });

    res.json(enriched);
  } catch (err) {
    next(err);
  }
});

// POST /api/stock-loss — log a waste event
// Body: { date, stockItemId, quantity, reason, notes }
router.post('/', async (req, res, next) => {
  try {
    if (!TABLES.STOCK_LOSS_LOG) {
      return res.status(400).json({ error: 'Stock Loss Log table not configured' });
    }
    const { date, stockItemId, quantity, reason, notes } = req.body;
    if (!quantity || !reason) {
      return res.status(400).json({ error: 'quantity and reason are required' });
    }
    if (!VALID_REASONS.includes(reason)) {
      return res.status(400).json({ error: `reason must be one of: ${VALID_REASONS.join(', ')}` });
    }

    const fields = {
      Date: date || new Date().toISOString().split('T')[0],
      Quantity: Number(quantity),
      Reason: reason,
      Notes: notes || '',
    };
    if (stockItemId) fields['Stock Item'] = [stockItemId];

    const record = await db.create(TABLES.STOCK_LOSS_LOG, fields);

    // Deduct from stock if linked
    if (stockItemId) {
      await db.atomicStockAdjust(stockItemId, -Number(quantity));
    }

    res.status(201).json(record);
  } catch (err) {
    next(err);
  }
});

export default router;
