import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';

const router = Router();
router.use(authorize('stock-purchases'));

// POST /api/stock-purchases — record a new supplier delivery
// Body: { stockItemId, supplierName, quantityPurchased, pricePerUnit, notes }
router.post('/', async (req, res, next) => {
  try {
    const { stockItemId, supplierName, quantityPurchased, pricePerUnit, notes } = req.body;

    // Create the purchase record
    const purchase = await db.create(TABLES.STOCK_PURCHASES, {
      'Purchase Date':      new Date().toISOString().split('T')[0],
      Supplier:             supplierName,
      Flower:               stockItemId ? [stockItemId] : [],
      'Quantity Purchased': quantityPurchased,
      'Price Per Unit':     pricePerUnit,
      Notes:                notes || '',
    });

    // Update stock: increment quantity, update cost price, set last restocked date
    if (stockItemId) {
      const stockItem = await db.getById(TABLES.STOCK, stockItemId);
      const newQty = (stockItem['Current Quantity'] || 0) + quantityPurchased;

      await db.update(TABLES.STOCK, stockItemId, {
        'Current Quantity':   newQty,
        'Current Cost Price': pricePerUnit,
        'Last Restocked':     new Date().toISOString().split('T')[0],
      });
    }

    res.status(201).json(purchase);
  } catch (err) {
    next(err);
  }
});

export default router;
