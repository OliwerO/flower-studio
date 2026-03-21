// Intake route — receives pasted text from the florist app and returns
// a structured order draft. Like a receiving dock that inspects incoming
// material, identifies it, and routes it to the right workstation.

import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';
import { sanitizeFormulaValue } from '../utils/sanitize.js';
import { parseRawText, parseFlowwowEmail, matchStockItems } from '../services/intake-parser.js';
import { PAYMENT_STATUS } from '../constants/statuses.js';

const router = Router();
router.use(authorize('orders')); // florist or owner can use this

// POST /api/intake/parse
// Body: { text: "...", type: "flowwow" | "general" }
// Returns a draft shaped for the florist order form
router.post('/parse', async (req, res, next) => {
  try {
    const { text, type } = req.body;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'Text is required' });
    }

    if (text.length > 10000) {
      return res.status(400).json({ error: 'Text too long (max 10,000 characters)' });
    }

    // 1. Fetch active stock — single Airtable call, used for matching
    const stockItems = await db.list(TABLES.STOCK, {
      filterByFormula: '{Active} = TRUE()',
      fields: ['Display Name', 'Category', 'Current Quantity', 'Current Cost Price', 'Current Sell Price'],
    });

    // 2. Parse text based on type
    const parsed = type === 'flowwow'
      ? await parseFlowwowEmail(text.trim(), stockItems)
      : await parseRawText(text.trim(), stockItems);

    // 3. Match extracted items to stock
    const orderLines = await matchStockItems(parsed.items || [], stockItems);

    // 4. Try to find existing customer by phone, instagram, or name
    const warnings = [];
    let suggestedMatch = null;

    const searchFields = [
      parsed.customer?.phone,
      parsed.customer?.instagram,
      parsed.customer?.email,
      parsed.customer?.name,
    ].filter(Boolean);

    for (const query of searchFields) {
      if (!query || query.length < 2) continue;
      try {
        const q = sanitizeFormulaValue(query);
        const matches = await db.list(TABLES.CUSTOMERS, {
          filterByFormula: `OR(
            SEARCH(LOWER('${q}'), LOWER({Name})),
            SEARCH(LOWER('${q}'), LOWER({Nickname})),
            SEARCH('${q}', {Phone}),
            SEARCH(LOWER('${q}'), LOWER({Link})),
            SEARCH(LOWER('${q}'), LOWER({Email}))
          )`,
          maxRecords: 3,
          fields: ['Name', 'Nickname', 'Phone', 'Link', 'Email', 'Segment', 'Language'],
        });
        if (matches.length > 0) {
          suggestedMatch = {
            id: matches[0].id,
            name: matches[0].Name || matches[0].Nickname || '',
            phone: matches[0].Phone || '',
            segment: matches[0].Segment || '',
          };
          break;
        }
      } catch (err) {
        console.error('[INTAKE] Customer search failed for:', query, err.message);
      }
    }

    // 5. Build warnings for the florist
    for (const line of orderLines) {
      if (line.confidence === 'none') {
        warnings.push(`Не удалось найти "${line.flowerName}" в складе`);
      } else if (line.confidence === 'low') {
        warnings.push(`"${line.flowerName}" — проверьте соответствие`);
      }
    }

    if (suggestedMatch?.segment === 'DO NOT CONTACT') {
      warnings.unshift('⚠ Клиент помечен как "НЕ КОНТАКТИРОВАТЬ"');
    }

    // 6. Return draft shaped for the form
    res.json({
      customer: {
        name: parsed.customer?.name || null,
        phone: parsed.customer?.phone || null,
        email: parsed.customer?.email || null,
        instagram: parsed.customer?.instagram || null,
        suggestedMatchId: suggestedMatch?.id || null,
        suggestedMatchName: suggestedMatch?.name || null,
        suggestedMatchSegment: suggestedMatch?.segment || null,
      },
      customerRequest: parsed.originalRequest || '',
      orderLines,
      delivery: parsed.delivery || {},
      source: type === 'flowwow' ? 'Flowwow' : null,
      paymentStatus: type === 'flowwow' ? PAYMENT_STATUS.PAID : null,
      deliveryFee: parsed.deliveryFee ?? null,
      totalPrice: parsed.totalPrice ?? null,
      flowwowOrderId: parsed.flowwowOrderId ?? null,
      notes: parsed.notes || '',
      warnings,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
