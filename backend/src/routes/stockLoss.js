// Stock Loss routes — log waste events (wilted, damaged, overstock, etc.).
import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as stockLossRepo from '../repos/stockLossRepo.js';
import * as stockRepo from '../repos/stockRepo.js';
import { actorFromReq } from '../utils/actor.js';
import { VALID_LOSS_REASONS } from '../constants/statuses.js';

const router = Router();
router.use(authorize('orders')); // florists + owner can log waste

const VALID_REASONS = VALID_LOSS_REASONS;

// GET /api/stock-loss?from=2026-01-01&to=2026-03-31
router.get('/', async (req, res, next) => {
  try {
    const records = await stockLossRepo.list({ from: req.query.from, to: req.query.to });
    res.json(records);
  } catch (err) { next(err); }
});

// POST /api/stock-loss
router.post('/', async (req, res, next) => {
  try {
    const { date, stockItemId, quantity, reason, notes } = req.body;
    if (!quantity || !reason)
      return res.status(400).json({ error: 'quantity and reason are required' });
    if (!VALID_REASONS.includes(reason))
      return res.status(400).json({ error: `reason must be one of: ${VALID_REASONS.join(', ')}` });

    // Resolve PG UUID for stock FK — stockRepo.getById handles both recXXX and UUID
    let pgStockId = null;
    if (stockItemId) {
      const stockItem = await stockRepo.getById(stockItemId);
      pgStockId = stockItem?._pgId || null;
    }

    const record = await stockLossRepo.create({
      date, stockId: pgStockId, quantity, reason, notes,
    });

    if (stockItemId) {
      await stockRepo.adjustQuantity(stockItemId, -Number(quantity), { actor: actorFromReq(req) });
    }

    res.status(201).json(record);
  } catch (err) { next(err); }
});

// PATCH /api/stock-loss/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const { quantity, reason, notes, date } = req.body;
    if (reason != null && !VALID_REASONS.includes(reason))
      return res.status(400).json({ error: `reason must be one of: ${VALID_REASONS.join(', ')}` });

    const current = await stockLossRepo.getById(req.params.id);
    if (!current) return res.status(404).json({ error: 'Not found' });

    const oldQty  = Number(current.quantity || 0);
    const newQty  = quantity != null ? Number(quantity) : oldQty;
    const delta   = oldQty - newQty; // positive = reduced loss → restore stock
    const stockId = current.stockId;

    if (delta !== 0 && stockId) {
      await stockRepo.adjustQuantity(stockId, delta, { actor: actorFromReq(req) });
      const stockItem   = await stockRepo.getById(stockId);
      const currentDead = Number(stockItem['Dead/Unsold Stems'] || 0);
      await stockRepo.update(stockId, {
        'Dead/Unsold Stems': Math.max(0, currentDead - delta),
      }, { actor: actorFromReq(req) });
    }

    const updated = await stockLossRepo.update(req.params.id, { quantity, reason, notes, date });
    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /api/stock-loss/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const current = await stockLossRepo.getById(req.params.id);
    if (!current) return res.status(404).json({ error: 'Not found' });

    const qty     = Number(current.quantity || 0);
    const stockId = current.stockId;

    if (stockId && qty > 0) {
      await stockRepo.adjustQuantity(stockId, +qty, { actor: actorFromReq(req) });
      const stockItem   = await stockRepo.getById(stockId);
      const currentDead = Number(stockItem['Dead/Unsold Stems'] || 0);
      await stockRepo.update(stockId, {
        'Dead/Unsold Stems': Math.max(0, currentDead - qty),
      }, { actor: actorFromReq(req) });
    }

    await stockLossRepo.remove(req.params.id);
    res.json({ id: req.params.id, deleted: true });
  } catch (err) { next(err); }
});

export default router;
