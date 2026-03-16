// Product management routes — owner-only endpoints for managing
// the Product Config table and triggering Wix sync.
// Like a production control panel: the owner can sync the supplier catalog,
// review new items, and adjust prices before they go live.

import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import { runSync, runPull, runPush } from '../services/wixProductSync.js';
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';
import Anthropic from '@anthropic-ai/sdk';

const router = Router();

// All product routes require owner access
router.use(authorize('admin'));

// ── POST /api/products/sync — trigger Wix ↔ Airtable sync ──
// Like pressing "refresh supplier catalog" — pulls new products from Wix,
// pushes our prices back. Returns a summary of what changed.
function requireWixCreds(_req, res, next) {
  if (!process.env.WIX_API_KEY || !process.env.WIX_SITE_ID) {
    return res.status(400).json({
      error: 'Wix API credentials not configured. Set WIX_API_KEY and WIX_SITE_ID.',
    });
  }
  next();
}

// POST /api/products/pull — import from Wix → dashboard
router.post('/pull', requireWixCreds, async (req, res, next) => {
  try {
    const stats = await runPull();
    res.json(stats);
  } catch (err) { next(err); }
});

// POST /api/products/push — export from dashboard → Wix
router.post('/push', requireWixCreds, async (req, res, next) => {
  try {
    const stats = await runPush();
    res.json(stats);
  } catch (err) { next(err); }
});

// POST /api/products/sync — full bidirectional (legacy, still works)
router.post('/sync', requireWixCreds, async (req, res, next) => {
  try {
    const stats = await runSync();
    res.json(stats);
  } catch (err) { next(err); }
});

// ── POST /api/products/translate — translate text to 4 languages ──
// Like a multilingual label printer: feed it one text, get back 4 versions
// for the Wix storefront (EN/PL/RU/UK).
// IMPORTANT: must be defined BEFORE /:id route, otherwise Express matches
// "translate" as a record ID parameter.
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

router.post('/translate', async (req, res, next) => {
  try {
    if (!anthropic) {
      return res.status(400).json({ error: 'ANTHROPIC_API_KEY not configured.' });
    }
    const { text, type } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Translate the following flower shop ${type || 'text'} into 4 languages.
The store is a flower studio in Krakow, Poland. Keep the tone warm and professional.
For descriptions, keep them concise (1-2 sentences max).

Text to translate: "${text}"

Return ONLY valid JSON with this exact structure (no markdown fences):
{"en": "English translation", "pl": "Polish translation", "ru": "Russian translation", "uk": "Ukrainian translation"}`,
      }],
    });

    const raw = response.content[0].text.trim();
    const translations = JSON.parse(raw);
    res.json(translations);
  } catch (err) {
    console.error('[TRANSLATE] Error:', err.status, err.message, err.error?.message);
    res.status(err.status || 500).json({
      error: 'Translation failed',
      detail: err.message,
    });
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

export default router;
