// Premade bouquet HTTP routes. Thin controllers — business logic lives in
// services/premadeBouquetService.js. Auth: owner + florist (driver not allowed).

import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import { VALID_PAYMENT_STATUSES, PAYMENT_STATUS } from '../constants/statuses.js';
import { getDriverOfDay, getConfig, generateOrderId } from '../services/configService.js';
import {
  listPremadeBouquets,
  getPremadeBouquet,
  createPremadeBouquet,
  updatePremadeBouquet,
  editPremadeBouquetLines,
  returnPremadeBouquetToStock,
  matchPremadeBouquetToOrder,
} from '../services/premadeBouquetService.js';

const router = Router();
router.use(authorize('premade-bouquets'));

// GET /api/premade-bouquets — list all current premade bouquets
router.get('/', async (req, res, next) => {
  try {
    const bouquets = await listPremadeBouquets();
    res.json(bouquets);
  } catch (err) {
    next(err);
  }
});

// GET /api/premade-bouquets/:id — single bouquet with enriched lines
router.get('/:id', async (req, res, next) => {
  try {
    const bouquet = await getPremadeBouquet(req.params.id);
    res.json(bouquet);
  } catch (err) {
    next(err);
  }
});

// POST /api/premade-bouquets — create a new premade bouquet (deducts stock)
router.post('/', async (req, res, next) => {
  try {
    const { name, lines = [], priceOverride, notes } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required and must be a non-empty string.' });
    }
    if (!Array.isArray(lines)) {
      return res.status(400).json({ error: 'lines must be an array.' });
    }
    if (lines.length === 0) {
      return res.status(400).json({ error: 'At least one flower line is required.' });
    }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (typeof line.quantity !== 'number' || line.quantity <= 0) {
        return res.status(400).json({ error: `lines[${i}].quantity must be a positive number.` });
      }
    }
    if (priceOverride !== undefined && priceOverride !== null && (typeof priceOverride !== 'number' || priceOverride < 0)) {
      return res.status(400).json({ error: 'priceOverride must be a number >= 0 if provided.' });
    }

    try {
      const result = await createPremadeBouquet({
        name, lines, priceOverride, notes,
        createdBy: req.role === 'owner' ? 'Owner' : 'Florist',
      });
      res.status(201).json(result);
    } catch (creationErr) {
      if (creationErr.statusCode === 400) {
        return res.status(400).json({ error: creationErr.message });
      }
      return res.status(500).json({
        error: 'Premade bouquet creation failed. Partial records have been cleaned up.',
        detail: creationErr.message,
      });
    }
  } catch (err) {
    next(err);
  }
});

// PATCH /api/premade-bouquets/:id — update name, price override, or notes.
router.patch('/:id', async (req, res, next) => {
  try {
    const { name, priceOverride, notes } = req.body;
    const patch = {};
    if (name !== undefined) patch.name = name;
    if (priceOverride !== undefined) patch.priceOverride = priceOverride;
    if (notes !== undefined) patch.notes = notes;
    const bouquet = await updatePremadeBouquet(req.params.id, patch);
    res.json(bouquet);
  } catch (err) {
    next(err);
  }
});

// PUT /api/premade-bouquets/:id/lines — edit bouquet lines (add/remove/qty).
router.put('/:id/lines', async (req, res, next) => {
  try {
    const { lines = [], removedLines = [] } = req.body;
    try {
      const result = await editPremadeBouquetLines(req.params.id, { lines, removedLines });
      const bouquet = await getPremadeBouquet(req.params.id);
      res.json({ ...result, bouquet });
    } catch (editErr) {
      if (editErr.statusCode === 400) {
        return res.status(400).json({ error: editErr.message });
      }
      return res.status(500).json({ error: 'Failed to edit premade bouquet lines.', detail: editErr.message });
    }
  } catch (err) {
    next(err);
  }
});

// POST /api/premade-bouquets/:id/return-to-stock — return all flowers to
// inventory and delete the premade record. Also aliased as /dissolve for the
// "take from premade to fulfil an order" flow — same operation, different
// calling context.
router.post(['/:id/return-to-stock', '/:id/dissolve'], async (req, res, next) => {
  try {
    const result = await returnPremadeBouquetToStock(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/premade-bouquets/:id/match — match to a client, creating an order
// from the premade's lines. Body mirrors POST /api/orders except orderLines.
router.post('/:id/match', async (req, res, next) => {
  try {
    const {
      customer, customerRequest, source, communicationMethod, deliveryType,
      delivery, notes, paymentStatus, paymentMethod, priceOverride,
      requiredBy, cardText, deliveryTime,
      payment1Amount, payment1Method,
    } = req.body;

    if (!customer || typeof customer !== 'string') {
      return res.status(400).json({ error: 'customer (Airtable record ID) is required.' });
    }
    // Address optional on Delivery — see POST /orders for the rationale.
    // Required By is mandatory — see POST /orders for the rationale.
    const effectiveRequiredBy = requiredBy || delivery?.date;
    if (!effectiveRequiredBy || typeof effectiveRequiredBy !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveRequiredBy)) {
      return res.status(400).json({ error: 'requiredBy (delivery/pickup date, YYYY-MM-DD) is required.' });
    }
    if (paymentStatus && !VALID_PAYMENT_STATUSES.includes(paymentStatus)) {
      return res.status(400).json({ error: `paymentStatus must be one of: ${VALID_PAYMENT_STATUSES.join(', ')}` });
    }

    try {
      const result = await matchPremadeBouquetToOrder(req.params.id, {
        customer, customerRequest, source, communicationMethod, deliveryType,
        delivery, notes,
        paymentStatus: paymentStatus || PAYMENT_STATUS.UNPAID,
        paymentMethod, priceOverride, requiredBy, cardText, deliveryTime,
        payment1Amount, payment1Method,
        createdBy: req.role === 'owner' ? 'Owner' : 'Florist',
        isOwner: req.role === 'owner',
      }, { getConfig, getDriverOfDay, generateOrderId });
      res.status(201).json(result);
    } catch (matchErr) {
      if (matchErr.statusCode === 400) {
        return res.status(400).json({ error: matchErr.message });
      }
      return res.status(500).json({
        error: 'Failed to match premade bouquet to order.',
        detail: matchErr.message,
      });
    }
  } catch (err) {
    next(err);
  }
});

export default router;
