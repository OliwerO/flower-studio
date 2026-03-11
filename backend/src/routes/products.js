// Product management routes — owner-only endpoints for managing
// the Product Config table and triggering Wix sync.
// Like a production control panel: the owner can sync the supplier catalog,
// review new items, and adjust prices before they go live.

import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import { runSync } from '../services/wixProductSync.js';
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';

const router = Router();

// All product routes require owner access
router.use(authorize('admin'));

// ── POST /api/products/sync — trigger Wix ↔ Airtable sync ──
// Like pressing "refresh supplier catalog" — pulls new products from Wix,
// pushes our prices back. Returns a summary of what changed.
router.post('/sync', async (req, res, next) => {
  try {
    if (!process.env.WIX_API_KEY || !process.env.WIX_SITE_ID) {
      return res.status(400).json({
        error: 'Wix API credentials not configured. Set WIX_API_KEY and WIX_SITE_ID.',
      });
    }

    const stats = await runSync();
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/products — list all Product Config rows ──
router.get('/', async (req, res, next) => {
  try {
    const rows = await db.list(TABLES.PRODUCT_CONFIG, {
      sort: [
        { field: 'Product Name', direction: 'asc' },
        { field: 'Sort Order', direction: 'asc' },
      ],
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/products/:id — update a Product Config row ──
// Owner can edit: Price, Lead Time Days, Active, Visible in Wix,
// Category, Key Flower, Product Type, Min Stems, Available From/To
const EDITABLE_FIELDS = [
  'Price', 'Lead Time Days', 'Active', 'Visible in Wix',
  'Category', 'Key Flower', 'Product Type', 'Min Stems',
  'Sort Order', 'Available From', 'Available To',
];

router.patch('/:id', async (req, res, next) => {
  try {
    const updates = {};
    for (const key of Object.keys(req.body)) {
      if (EDITABLE_FIELDS.includes(key)) {
        updates[key] = req.body[key];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update.' });
    }

    const updated = await db.update(TABLES.PRODUCT_CONFIG, req.params.id, updates);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/products/sync-log — recent sync history ──
router.get('/sync-log', async (req, res, next) => {
  try {
    const logs = await db.list(TABLES.SYNC_LOG, {
      sort: [{ field: 'Timestamp', direction: 'desc' }],
      maxRecords: 20,
    });
    res.json(logs);
  } catch (err) {
    next(err);
  }
});

export default router;
