import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as stockRepo from '../repos/stockRepo.js';
import * as stockPurchasesRepo from '../repos/stockPurchasesRepo.js';

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

    let finalItem = null; // the batch stock record (wire-format response from stockRepo)

    if (stockItemId) {
      const stockItem = await stockRepo.getById(stockItemId);
      const existingQty = Number(stockItem['Current Quantity']) || 0;

      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const d = new Date(today);
      const batchLabel = `${d.getDate()}.${months[d.getMonth()]}.`;

      const rawName = stockItem['Display Name'] || '';
      const baseName = (rawName.match(DATE_BATCH_RE)?.[1] || rawName).trim();

      let batchQty = quantityPurchased;
      if (existingQty < 0) {
        batchQty = quantityPurchased + existingQty; // absorb pre-sold deficit
        if (batchQty < 0) batchQty = 0;
        await stockRepo.update(stockItemId, { 'Current Quantity': 0 });
      }

      finalItem = await stockRepo.create({
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
      console.log(`[STOCK] New batch created: ${finalItem['Display Name']}`);

      const templateUpdate = { 'Current Cost Price': pricePerUnit, 'Last Restocked': today };
      if (sellPricePerUnit) templateUpdate['Current Sell Price'] = sellPricePerUnit;
      await stockRepo.update(stockItemId, templateUpdate);
    }

    const purchase = await stockPurchasesRepo.create({
      purchaseDate:      today,
      supplier:          supplierName || '',
      stockId:           finalItem?._pgId || null,
      stockAirtableId:   finalItem?.id?.startsWith('rec') ? finalItem.id : null,
      quantityPurchased,
      pricePerUnit,
      notes:             notes || '',
    });

    res.status(201).json({ ...purchase, batchItemId: finalItem?.id || null });
  } catch (err) {
    next(err);
  }
});

export default router;
