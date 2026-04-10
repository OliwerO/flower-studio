import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';
import { sanitizeFormulaValue } from '../utils/sanitize.js';
import { pickAllowed } from '../utils/fields.js';
import { listByIds } from '../utils/batchQuery.js';
import { ORDER_STATUS, PO_STATUS, LOSS_REASON } from '../constants/statuses.js';

const router = Router();
router.use(authorize('stock'));

const STOCK_PATCH_ALLOWED = [
  'Display Name', 'Purchase Name', 'Category', 'Current Quantity', 'Unit',
  'Current Cost Price', 'Current Sell Price', 'Supplier', 'Reorder Threshold',
  'Active', 'Supplier Notes', 'Dead/Unsold Stems', 'Lot Size', 'Farmer',
  'Last Restocked',
];

// GET /api/stock?category=Roses&includeEmpty=true
// By default hides items with qty=0 (old depleted batches). Pass includeEmpty=true to see all.
router.get('/', async (req, res, next) => {
  try {
    const { category, includeEmpty } = req.query;
    const filters = ['{Active} = TRUE()'];

    if (includeEmpty !== 'true') filters.push('{Current Quantity} > 0');
    if (category) filters.push(`{Category} = '${sanitizeFormulaValue(category)}'`);

    const stock = await db.list(TABLES.STOCK, {
      filterByFormula: `AND(${filters.join(', ')})`,
      sort: [
        { field: 'Category', direction: 'asc' },
        { field: 'Display Name', direction: 'asc' },
      ],
    });

    res.json(stock);
  } catch (err) {
    next(err);
  }
});

// GET /api/stock/velocity — days of supply per stock item based on last 30 days of sales
// IMPORTANT: defined before /:id routes so "velocity" isn't interpreted as an ID param.
router.get('/velocity', async (req, res, next) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];

    // Fetch non-cancelled orders in the last 30 days
    const recentOrders = await db.list(TABLES.ORDERS, {
      filterByFormula: `AND(NOT(IS_BEFORE({Order Date}, '${thirtyDaysAgo}')), NOT(IS_AFTER({Order Date}, '${today}')), {Status} != '${ORDER_STATUS.CANCELLED}')`,
      fields: ['Order Lines'],
    });

    const lineIds = recentOrders.flatMap(o => o['Order Lines'] || []);

    // Batch-fetch order lines (100 per request — Airtable formula length limit)
    const lines = [];
    for (let i = 0; i < lineIds.length; i += 100) {
      const batch = lineIds.slice(i, i + 100);
      if (batch.length === 0) continue;
      const recs = await db.list(TABLES.ORDER_LINES, {
        filterByFormula: `OR(${batch.map(id => `RECORD_ID() = "${id}"`).join(',')})`,
        fields: ['Stock Item', 'Quantity'],
        maxRecords: 100,
      });
      lines.push(...recs);
    }

    // Sum qty sold per stock item over the 30-day window
    const qtySoldByStock = {};
    for (const line of lines) {
      const stockId = line['Stock Item']?.[0];
      if (stockId) {
        qtySoldByStock[stockId] = (qtySoldByStock[stockId] || 0) + (line.Quantity || 0);
      }
    }

    // Build velocity map: stockId → { qtySold30d, avgDailyUsage }
    // daysOfSupply is left to the frontend — it needs current qty from the stock list
    const velocity = {};
    for (const [stockId, qtySold] of Object.entries(qtySoldByStock)) {
      const avgDaily = qtySold / 30;
      velocity[stockId] = {
        qtySold30d: qtySold,
        avgDailyUsage: Math.round(avgDaily * 10) / 10,
      };
    }

    res.json(velocity);
  } catch (err) {
    next(err);
  }
});

// GET /api/stock/committed — aggregate committed (deferred) quantities from future orders per stock item.
// Only counts lines from orders where Required By > today (future orders use deferred stock — no deduction at creation).
// Returns { stockId: { committed: N, orders: [{ orderId, appOrderId, customerName, requiredBy, qty }] } }
// Used to show "effective stock" = Current Quantity - committed demand from future orders.
router.get('/committed', async (req, res, next) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    // Fetch non-terminal orders with Required By in the future.
    // Future orders use deferred stock (not deducted from inventory at creation time).
    // Today's orders use non-deferred stock (already deducted), so they're excluded.
    const orders = await db.list(TABLES.ORDERS, {
      filterByFormula: `AND({Status} != '${ORDER_STATUS.DELIVERED}', {Status} != '${ORDER_STATUS.PICKED_UP}', {Status} != '${ORDER_STATUS.CANCELLED}', IS_AFTER({Required By}, '${today}'))`,
      fields: ['Order Lines', 'Customer', 'Required By', 'App Order ID', 'Status'],
      maxRecords: 500,
    });

    // Bulk-fetch all order lines
    const allLineIds = orders.flatMap(o => o['Order Lines'] || []);
    const allLines = await listByIds(TABLES.ORDER_LINES, allLineIds, {
      fields: ['Order', 'Stock Item', 'Quantity', 'Flower Name'],
      maxRecords: 2000,
    });

    // Bulk-fetch customers for display names
    const uniqueCustomerIds = [...new Set(orders.flatMap(o => o.Customer || []))];
    const allCustomers = await listByIds(TABLES.CUSTOMERS, uniqueCustomerIds, {
      fields: ['Name', 'Nickname'],
    });
    const customerMap = {};
    for (const c of allCustomers) customerMap[c.id] = c;

    // Index orders by ID for enrichment
    const orderMap = {};
    for (const o of orders) {
      const custId = o.Customer?.[0];
      orderMap[o.id] = {
        appOrderId: o['App Order ID'] || '',
        customerName: customerMap[custId]?.Name || customerMap[custId]?.Nickname || '',
        requiredBy: o['Required By'] || null,
        status: o.Status || 'New',
      };
    }

    // Aggregate committed quantities per stock item
    const committed = {};
    for (const line of allLines) {
      const stockId = line['Stock Item']?.[0];
      if (!stockId) continue;
      const qty = Number(line.Quantity || 0);
      if (qty <= 0) continue;

      if (!committed[stockId]) committed[stockId] = { committed: 0, orders: [] };
      committed[stockId].committed += qty;

      const orderId = line.Order?.[0];
      const orderInfo = orderId ? orderMap[orderId] : null;
      if (orderInfo) {
        committed[stockId].orders.push({
          orderId,
          appOrderId: orderInfo.appOrderId,
          customerName: orderInfo.customerName,
          requiredBy: orderInfo.requiredBy,
          qty,
        });
      }
    }

    res.json(committed);
  } catch (err) {
    next(err);
  }
});

// GET /api/stock/pending-po — aggregate quantities from pending purchase orders per stock item.
// Returns { stockItemId: { ordered: N, pos: [{ id, number, quantity }] } }
// for POs in Draft, Sent, or Shopping status (flowers not yet received into stock).
// Used by bouquet builders so florists can see what's coming and plan accordingly.
router.get('/pending-po', async (req, res, next) => {
  try {
    const pendingPOs = await db.list(TABLES.STOCK_ORDERS, {
      filterByFormula: `OR({Status} = '${PO_STATUS.DRAFT}', {Status} = '${PO_STATUS.SENT}', {Status} = '${PO_STATUS.SHOPPING}')`,
      fields: ['Status', 'Stock Order ID', 'Order Lines'],
    });

    if (pendingPOs.length === 0) return res.json({});

    const allLineIds = pendingPOs.flatMap(po => po['Order Lines'] || []);
    if (allLineIds.length === 0) return res.json({});

    // Batch-fetch PO lines (Airtable formula length limit)
    const allLines = [];
    const CHUNK = 100;
    for (let i = 0; i < allLineIds.length; i += CHUNK) {
      const chunk = allLineIds.slice(i, i + CHUNK);
      const chunkLines = await db.list(TABLES.STOCK_ORDER_LINES, {
        filterByFormula: `OR(${chunk.map(id => `RECORD_ID() = "${id}"`).join(',')})`,
        fields: ['Stock Item', 'Quantity Needed', 'Flower Name', 'Stock Orders', 'Lot Size'],
      });
      allLines.push(...chunkLines);
    }

    // Build PO lookup
    const poMap = {};
    for (const po of pendingPOs) {
      poMap[po.id] = { id: po.id, number: po['Stock Order ID'] || '', status: po.Status };
    }

    // Collect unlinked flower names for batch resolution
    const unlinked = []; // { lineIdx, flowerName }
    for (let i = 0; i < allLines.length; i++) {
      if (!allLines[i]['Stock Item']?.[0] && allLines[i]['Flower Name']) {
        unlinked.push({ idx: i, name: allLines[i]['Flower Name'].trim() });
      }
    }

    // Resolve unlinked lines by matching Flower Name → Stock Item Display Name
    if (unlinked.length > 0) {
      const uniqueNames = [...new Set(unlinked.map(u => u.name))];
      const nameToId = {};
      for (const name of uniqueNames) {
        try {
          const safe = sanitizeFormulaValue(name);
          const matches = await db.list(TABLES.STOCK, {
            filterByFormula: `AND({Display Name} = '${safe}', {Active} = TRUE())`,
            fields: ['Display Name'],
            maxRecords: 1,
          });
          if (matches.length > 0) nameToId[name] = matches[0].id;
        } catch { /* skip */ }
      }
      for (const u of unlinked) {
        if (nameToId[u.name]) {
          allLines[u.idx]._resolvedStockId = nameToId[u.name];
        }
      }
    }

    // Aggregate by stock item — Quantity Needed stores actual stems
    // (qty × lotSize for new POs, or already lot-adjusted for auto-generated).
    // For backward compat with old lines where qty was entered as lots,
    // detect and adjust: if qty < lotSize, it's probably lots → multiply.
    const result = {};
    for (const line of allLines) {
      const stockId = line['Stock Item']?.[0] || line._resolvedStockId;
      if (!stockId) continue;
      const rawQty = Number(line['Quantity Needed']) || 0;
      if (rawQty <= 0) continue;
      const lotSize = Number(line['Lot Size']) || 0;
      const qty = lotSize > 1 && rawQty < lotSize
        ? rawQty * lotSize   // old format: qty is lot count
        : rawQty;            // new format: qty is already stems

      if (!result[stockId]) result[stockId] = { ordered: 0, pos: [] };
      result[stockId].ordered += qty;

      const poId = line['Stock Orders']?.[0];
      const po = poId ? poMap[poId] : null;
      if (po) {
        result[stockId].pos.push({ id: po.id, number: po.number, quantity: qty });
      }
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/stock — create a new stock item (florist quick-add during spontaneous delivery)
// Body: { displayName, category, quantity, costPrice, sellPrice?, supplier?, unit? }
router.post('/', async (req, res, next) => {
  try {
    const { displayName, category, quantity, costPrice, sellPrice, supplier, unit, lotSize, farmer } = req.body;
    if (!displayName) return res.status(400).json({ error: 'displayName is required' });

    const fields = {
      'Display Name':       displayName,
      'Purchase Name':      displayName,
      Category:             category || 'Other',
      'Current Quantity':   Number(quantity) || 0,
      'Current Cost Price': Number(costPrice) || 0,
      Active:               true,
    };
    if (sellPrice)  fields['Current Sell Price'] = Number(sellPrice);
    if (supplier)   fields['Supplier'] = supplier;
    if (unit)       fields['Unit'] = unit;
    if (lotSize)    fields['Lot Size'] = Number(lotSize);
    if (farmer)     fields['Farmer'] = farmer;

    const item = await db.create(TABLES.STOCK, fields);
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

// GET /api/stock/:id/usage — trace where flowers went: orders that used this stock item,
// write-offs, and PO receipts. Returns a chronological audit trail.
router.get('/:id/usage', async (req, res, next) => {
  try {
    const stockItem = await db.getById(TABLES.STOCK, req.params.id);
    const displayName = stockItem['Display Name'] || '';
    const purchaseName = stockItem['Purchase Name'] || displayName;
    const stockId = req.params.id;

    // 1. Order lines — filter by Flower Name (linked record IDs aren't searchable
    //    in Airtable formulas). Match both exact Display Name and Purchase Name.
    const safeName = sanitizeFormulaValue(displayName);
    const safePurchase = purchaseName !== displayName ? sanitizeFormulaValue(purchaseName) : null;
    const nameFilter = safePurchase
      ? `OR({Flower Name} = '${safeName}', {Flower Name} = '${safePurchase}')`
      : `{Flower Name} = '${safeName}'`;
    const orderLines = await db.list(TABLES.ORDER_LINES, {
      filterByFormula: nameFilter,
      fields: ['Order', 'Flower Name', 'Quantity', 'Sell Price Per Unit', 'Cost Price Per Unit', 'Stock Item'],
    });
    // Verify Stock Item link matches (avoids false positives from same-name flowers)
    const matchedLines = orderLines.filter(l => {
      const linkedId = l['Stock Item']?.[0];
      return linkedId === stockId || !linkedId; // include unlinked lines by name match
    });

    // Fetch parent orders for context
    const orderIds = [...new Set(matchedLines.flatMap(l => l.Order || []))];
    const orders = orderIds.length > 0
      ? await listByIds(TABLES.ORDERS, orderIds, {
          fields: ['App Order ID', 'Customer', 'Status', 'Required By', 'Order Date'],
        })
      : [];
    const orderMap = {};
    for (const o of orders) orderMap[o.id] = o;

    const customerIds = [...new Set(orders.flatMap(o => o.Customer || []))];
    const customers = customerIds.length > 0
      ? await listByIds(TABLES.CUSTOMERS, customerIds, { fields: ['Name', 'Nickname'] })
      : [];
    const customerMap = {};
    for (const c of customers) customerMap[c.id] = c;

    const usageOrders = matchedLines.map(l => {
      const orderId = l.Order?.[0];
      const o = orderId ? orderMap[orderId] : null;
      const custId = o?.Customer?.[0];
      const cust = custId ? customerMap[custId] : null;
      return {
        type: 'order',
        date: o?.['Order Date'] || o?.['Required By'] || null,
        orderId: o?.['App Order ID'] || orderId || '',
        customer: cust?.Name || cust?.Nickname || '',
        status: o?.Status || '',
        quantity: -(l.Quantity || 0),
        flowerName: l['Flower Name'] || displayName,
      };
    });

    // 2. Loss log — fetch recent entries and filter by Stock Item link in JS
    let usageLosses = [];
    if (TABLES.STOCK_LOSS_LOG) {
      try {
        const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];
        const allLosses = await db.list(TABLES.STOCK_LOSS_LOG, {
          filterByFormula: `NOT(IS_BEFORE({Date}, '${ninetyDaysAgo}'))`,
          sort: [{ field: 'Date', direction: 'desc' }],
        });
        usageLosses = allLosses
          .filter(l => l['Stock Item']?.[0] === stockId)
          .map(l => ({
            type: 'writeoff',
            date: l.Date || null,
            reason: l.Reason || '',
            notes: l.Notes || '',
            quantity: -(l.Quantity || 0),
          }));
      } catch { /* table may not exist */ }
    }

    // 3. Purchase records — fetch and filter by Flower link in JS
    let usagePurchases = [];
    try {
      const allPurchases = await db.list(TABLES.STOCK_PURCHASES, {
        filterByFormula: `{Supplier} != ''`,
        sort: [{ field: 'Purchase Date', direction: 'desc' }],
        maxRecords: 500,
      });
      usagePurchases = allPurchases
        .filter(p => p.Flower?.[0] === stockId)
        .map(p => ({
          type: 'purchase',
          date: p['Purchase Date'] || null,
          quantity: +(p['Quantity Purchased'] || 0),
          supplier: p.Supplier || '',
          costPerUnit: p['Price Per Unit'] || 0,
          notes: p.Notes || '',
        }));
    } catch { /* table may not exist */ }

    // Combine and sort chronologically (newest first)
    const trail = [...usageOrders, ...usageLosses, ...usagePurchases]
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    res.json({
      stockItem: { id: stockItem.id, displayName, currentQty: stockItem['Current Quantity'] || 0 },
      trail,
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/stock/:id — update prices, threshold, etc.
// When Reorder Threshold changes, sync it across all batches of the same flower
// (matched by Purchase Name) so the threshold applies uniformly.
router.patch('/:id', async (req, res, next) => {
  try {
    const safeFields = pickAllowed(req.body, STOCK_PATCH_ALLOWED);
    const item = await db.update(TABLES.STOCK, req.params.id, safeFields);

    // Sync threshold across batches of the same base flower
    if ('Reorder Threshold' in safeFields && item['Purchase Name']) {
      const baseName = item['Purchase Name'];
      const siblings = await db.list(TABLES.STOCK, {
        filterByFormula: `AND({Purchase Name} = '${sanitizeFormulaValue(baseName)}', RECORD_ID() != '${req.params.id}')`,
        fields: ['Reorder Threshold'],
      });
      for (const sib of siblings) {
        if (sib['Reorder Threshold'] !== safeFields['Reorder Threshold']) {
          await db.update(TABLES.STOCK, sib.id, {
            'Reorder Threshold': safeFields['Reorder Threshold'],
          });
        }
      }
    }

    res.json(item);
  } catch (err) {
    next(err);
  }
});

// POST /api/stock/:id/adjust — increment or decrement quantity with +/- delta
// Body: { delta: 5 } or { delta: -3 }
router.post('/:id/adjust', async (req, res, next) => {
  try {
    const { delta } = req.body;

    if (typeof delta !== 'number') {
      return res.status(400).json({ error: 'delta must be a number (positive or negative).' });
    }

    const item = await db.getById(TABLES.STOCK, req.params.id);
    const currentQty = item['Current Quantity'] || 0;
    const newQty = currentQty + delta;

    if (newQty < 0) {
      console.warn(`[STOCK] Negative stock: ${req.params.id} going to ${newQty} (current: ${currentQty}, delta: ${delta})`);
    }

    const updated = await db.update(TABLES.STOCK, req.params.id, {
      'Current Quantity': newQty,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/stock/:id/write-off — record spoiled/dead stems
// Decrements Current Quantity and adds to Dead/Unsold Stems counter.
// Body: { quantity: 5, reason?: "wilted" }
router.post('/:id/write-off', async (req, res, next) => {
  try {
    const { quantity, reason } = req.body;

    if (typeof quantity !== 'number' || quantity <= 0) {
      return res.status(400).json({ error: 'quantity must be a positive number.' });
    }

    const item = await db.getById(TABLES.STOCK, req.params.id);
    const currentQty = item['Current Quantity'] || 0;
    const currentDead = item['Dead/Unsold Stems'] || 0;

    // Allow full write-off even if it results in negative stock.
    // Negative stock is intentional — signals demand gap for future orders.
    const actualWriteOff = quantity;

    // Build update fields
    const fields = {
      'Current Quantity':   currentQty - actualWriteOff,
      'Dead/Unsold Stems':  currentDead + actualWriteOff,
    };

    // Append write-off reason to Supplier Notes with timestamp
    if (reason && reason.trim()) {
      const today = new Date().toISOString().slice(0, 10);
      const entry = `[WRITE-OFF ${today}] ${actualWriteOff} stems — ${reason.trim()}`;
      const existing = item['Supplier Notes'] || '';
      fields['Supplier Notes'] = existing ? `${existing}\n${entry}` : entry;
    }

    const updated = await db.update(TABLES.STOCK, req.params.id, fields);

    // Also log to Stock Loss Log table for analytics breakdown
    if (TABLES.STOCK_LOSS_LOG && actualWriteOff > 0) {
      const lossReason = (reason === LOSS_REASON.WILTED || reason === LOSS_REASON.DAMAGED || reason === LOSS_REASON.ARRIVED_BROKEN) ? reason : LOSS_REASON.OTHER;

      // Auto-calculate Days Survived for wilted flowers:
      // how many days the flower lasted from last restock to write-off date
      let daysSurvived = null;
      if (reason === LOSS_REASON.WILTED && item['Last Restocked']) {
        const restocked = new Date(item['Last Restocked']);
        const now = new Date();
        daysSurvived = Math.round((now.getTime() - restocked.getTime()) / 86400000);
        if (daysSurvived < 0) daysSurvived = null; // sanity check
      }

      db.create(TABLES.STOCK_LOSS_LOG, {
        Date: new Date().toISOString().split('T')[0],
        'Stock Item': [req.params.id],
        Quantity: actualWriteOff,
        Reason: lossReason,
        Notes: reason && reason !== lossReason ? reason : '',
        'Days Survived': daysSurvived,
      }).catch(err => console.error('[STOCK] Failed to log to Stock Loss Log:', err.message));
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
