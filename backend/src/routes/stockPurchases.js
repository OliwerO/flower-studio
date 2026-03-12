import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';

const router = Router();
router.use(authorize('stock-purchases'));

// POST /api/stock-purchases — record a new supplier delivery.
// Batch tracking: if the existing item still has stock (qty > 0), creates a
// NEW stock record for the new batch instead of merging. This prevents mixing
// old and new flowers and preserves accurate cost per batch.
// Body: { stockItemId, supplierName, quantityPurchased, pricePerUnit, sellPricePerUnit, notes }
router.post('/', async (req, res, next) => {
  try {
    const { stockItemId, supplierName, quantityPurchased, pricePerUnit, sellPricePerUnit, notes } = req.body;
    const today = new Date().toISOString().split('T')[0];

    let finalItemId = stockItemId;

    // Batch logic: if existing item has remaining stock, create a new batch record
    if (stockItemId) {
      const stockItem = await db.getById(TABLES.STOCK, stockItemId);
      const existingQty = stockItem['Current Quantity'] || 0;

      if (existingQty > 0) {
        // Old batch still has stock — create a NEW record for the new batch
        const batchLabel = `${today.slice(5).replace('-', '/')}`;
        const newBatch = await db.create(TABLES.STOCK, {
          'Display Name':       `${stockItem['Display Name']} (${batchLabel})`,
          'Purchase Name':      stockItem['Purchase Name'] || stockItem['Display Name'],
          Category:             stockItem.Category || 'Other',
          'Current Quantity':   quantityPurchased,
          'Current Cost Price': pricePerUnit,
          'Current Sell Price': sellPricePerUnit || stockItem['Current Sell Price'] || 0,
          Supplier:             supplierName || stockItem.Supplier || '',
          Unit:                 stockItem.Unit || 'Stems',
          'Reorder Threshold':  stockItem['Reorder Threshold'] || 0,
          Active:               true,
          'Last Restocked':     today,
        });
        finalItemId = newBatch.id;
        console.log(`[STOCK] New batch created: ${newBatch['Display Name']} (old qty: ${existingQty})`);
      } else {
        // Old batch is empty — reuse the same record
        const stockUpdate = {
          'Current Quantity':   quantityPurchased,
          'Current Cost Price': pricePerUnit,
          'Last Restocked':     today,
        };
        if (sellPricePerUnit) stockUpdate['Current Sell Price'] = sellPricePerUnit;
        await db.update(TABLES.STOCK, stockItemId, stockUpdate);
      }
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
