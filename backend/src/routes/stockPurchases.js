import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';

const router = Router();
router.use(authorize('stock-purchases'));

// POST /api/stock-purchases — record a new supplier delivery.
// Always creates a NEW dated batch record so each delivery is tracked separately.
// Body: { stockItemId, supplierName, quantityPurchased, pricePerUnit, sellPricePerUnit, notes }
const DATE_BATCH_RE = /^(.+?)\s*\(\d{1,2}\.\w{3,4}\.?\)$/;
router.post('/', async (req, res, next) => {
  try {
    const { stockItemId, supplierName, quantityPurchased, pricePerUnit, sellPricePerUnit, notes } = req.body;
    const today = new Date().toISOString().split('T')[0];

    let finalItemId = stockItemId;

    // Batch logic: always create a new dated batch so every delivery is traceable.
    // If the original record has negative qty (pre-sold demand), absorb the deficit
    // into the new batch and zero out the original.
    if (stockItemId) {
      const stockItem = await db.getById(TABLES.STOCK, stockItemId);
      const existingQty = Number(stockItem['Current Quantity']) || 0;

      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const d = new Date(today);
      const batchLabel = `${d.getDate()}.${months[d.getMonth()]}.`;

      // Strip any existing date suffix to avoid double-dating
      const rawName = stockItem['Display Name'] || '';
      const baseName = (rawName.match(DATE_BATCH_RE)?.[1] || rawName).trim();

      // Absorb negative deficit from original
      let batchQty = quantityPurchased;
      if (existingQty < 0) {
        batchQty = quantityPurchased + existingQty; // e.g. 25 + (-7) = 18
        if (batchQty < 0) batchQty = 0;
        // Zero out the original so the negative display disappears
        await db.update(TABLES.STOCK, stockItemId, { 'Current Quantity': 0 });
      }

      const newBatch = await db.create(TABLES.STOCK, {
        'Display Name':       `${baseName} (${batchLabel})`,
        'Purchase Name':      stockItem['Purchase Name'] || baseName,
        Category:             stockItem.Category || 'Other',
        'Current Quantity':   batchQty,
        'Current Cost Price': pricePerUnit,
        'Current Sell Price': sellPricePerUnit || stockItem['Current Sell Price'] || 0,
        Supplier:             supplierName || stockItem.Supplier || '',
        Unit:                 stockItem.Unit || 'Stems',
        'Reorder Threshold':  stockItem['Reorder Threshold'] || 0,
        Active:               true,
        'Last Restocked':     today,
      });
      finalItemId = newBatch.id;
      console.log(`[STOCK] New batch created: ${newBatch['Display Name']} (prev qty on original: ${existingQty})`);

      // Keep template record's prices current
      const templateUpdate = { 'Current Cost Price': pricePerUnit, 'Last Restocked': today };
      if (sellPricePerUnit) templateUpdate['Current Sell Price'] = sellPricePerUnit;
      await db.update(TABLES.STOCK, stockItemId, templateUpdate);
    }

    // Create the purchase record linked to the actual batch
    const purchase = await db.create(TABLES.STOCK_PURCHASES, {
      'Purchase Date':      today,
      Supplier:             supplierName || '',
      ...(finalItemId ? { Flower: [finalItemId] } : {}),
      'Quantity Purchased': quantityPurchased,
      'Price Per Unit':     pricePerUnit,
      Notes:                notes || '',
    });

    res.status(201).json({ ...purchase, batchItemId: finalItemId });
  } catch (err) {
    next(err);
  }
});

export default router;
