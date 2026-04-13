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
      fields: ['Status', 'Stock Order ID', 'Order Lines', 'Planned Date'],
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
        fields: ['Stock Item', 'Quantity Needed', 'Flower Name', 'Stock Orders', 'Lot Size', 'Cost Price', 'Sell Price', 'Supplier'],
      });
      allLines.push(...chunkLines);
    }

    // Build PO lookup
    const poMap = {};
    for (const po of pendingPOs) {
      poMap[po.id] = { id: po.id, number: po['Stock Order ID'] || '', status: po.Status, plannedDate: po['Planned Date'] || null };
    }

    // Collect unlinked flower names for batch resolution
    const unlinked = []; // { lineIdx, flowerName }
    for (let i = 0; i < allLines.length; i++) {
      if (!allLines[i]['Stock Item']?.[0] && allLines[i]['Flower Name']) {
        unlinked.push({ idx: i, name: allLines[i]['Flower Name'].trim() });
      }
    }

    // Resolve unlinked lines by matching Flower Name → Stock Item Display Name.
    // If no match found, auto-create a stock item with qty=0 so the flower
    // appears in the bouquet picker. Also link the PO line for future consistency.
    if (unlinked.length > 0) {
      const uniqueNames = [...new Set(unlinked.map(u => u.name))];
      const nameToId = {};
      for (const name of uniqueNames) {
        try {
          const safe = sanitizeFormulaValue(name);
          const matches = await db.list(TABLES.STOCK, {
            filterByFormula: `AND({Display Name} = '${safe}', {Active} = TRUE())`,
            fields: ['Display Name', 'Current Cost Price', 'Current Sell Price'],
            maxRecords: 1,
          });
          if (matches.length > 0) {
            nameToId[name] = matches[0].id;
            // Backfill missing prices on existing zero-qty items from PO line data
            const existing = matches[0];
            if (!existing['Current Cost Price'] && !existing['Current Sell Price']) {
              const poLine = allLines[unlinked.find(x => x.name === name)?.idx];
              if (poLine && (Number(poLine['Cost Price']) || Number(poLine['Sell Price']))) {
                db.update(TABLES.STOCK, existing.id, {
                  'Current Cost Price': Number(poLine['Cost Price']) || 0,
                  'Current Sell Price': Number(poLine['Sell Price']) || 0,
                  ...(poLine.Supplier ? { Supplier: poLine.Supplier } : {}),
                }).catch(() => {});
              }
            }
          } else {
            // Auto-create stock item so the flower shows up in pickers.
            // Pull cost/sell from the PO line that triggered this.
            const poLine = allLines[unlinked.find(x => x.name === name)?.idx];
            const created = await db.create(TABLES.STOCK, {
              'Display Name': name,
              'Purchase Name': name,
              'Current Quantity': 0,
              'Current Cost Price': Number(poLine?.['Cost Price']) || 0,
              'Current Sell Price': Number(poLine?.['Sell Price']) || 0,
              Supplier: poLine?.Supplier || '',
              Category: 'Other',
              Active: true,
            });
            nameToId[name] = created.id;
            console.log(`[STOCK] Auto-created "${name}" (${created.id}) from pending PO line`);
          }
        } catch { /* skip */ }
      }
      // Link resolved/created stock items back to PO lines (fire-and-forget)
      for (const u of unlinked) {
        if (nameToId[u.name]) {
          allLines[u.idx]._resolvedStockId = nameToId[u.name];
          const lineId = allLines[u.idx].id;
          if (lineId) {
            db.update(TABLES.STOCK_ORDER_LINES, lineId, { 'Stock Item': [nameToId[u.name]] }).catch(() => {});
          }
        }
      }
    }

    // Aggregate by stock item + backfill missing prices on linked stock items.
    const result = {};
    const backfilledIds = new Set();
    for (const line of allLines) {
      const stockId = line['Stock Item']?.[0] || line._resolvedStockId;
      if (!stockId) continue;
      const rawQty = Number(line['Quantity Needed']) || 0;
      if (rawQty <= 0) continue;
      const lotSize = Number(line['Lot Size']) || 0;
      const qty = lotSize > 1 && rawQty < lotSize
        ? rawQty * lotSize   // old format: qty is lot count
        : rawQty;            // new format: qty is already stems

      if (!result[stockId]) result[stockId] = { ordered: 0, plannedDate: null, pos: [], flowerName: '' };
      result[stockId].ordered += qty;
      // Keep the first non-empty flower name
      if (!result[stockId].flowerName && line['Flower Name']) {
        result[stockId].flowerName = line['Flower Name'];
      }

      const poId = line['Stock Orders']?.[0];
      const po = poId ? poMap[poId] : null;
      if (po) {
        result[stockId].pos.push({ id: po.id, number: po.number, quantity: qty, plannedDate: po.plannedDate });
        // Track earliest planned date across all POs for this item
        if (po.plannedDate && (!result[stockId].plannedDate || po.plannedDate < result[stockId].plannedDate)) {
          result[stockId].plannedDate = po.plannedDate;
        }
      }
    }

    // Backfill missing prices: find stock items in the result that have zero
    // cost AND zero sell, then update from PO line data. Only touches items
    // that were auto-created without prices — won't overwrite manual adjustments.
    const backfillCandidates = {};
    for (const line of allLines) {
      const stockId = line['Stock Item']?.[0] || line._resolvedStockId;
      if (!stockId || backfilledIds.has(stockId)) continue;
      const lineCost = Number(line['Cost Price']) || 0;
      const lineSell = Number(line['Sell Price']) || 0;
      if (lineCost > 0 || lineSell > 0) {
        backfillCandidates[stockId] = { cost: lineCost, sell: lineSell, supplier: line.Supplier || '' };
        backfilledIds.add(stockId);
      }
    }
    if (Object.keys(backfillCandidates).length > 0) {
      // Batch-fetch to check current prices before overwriting
      const ids = Object.keys(backfillCandidates);
      const CHUNK = 100;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        try {
          const items = await db.list(TABLES.STOCK, {
            filterByFormula: `OR(${chunk.map(id => `RECORD_ID() = "${id}"`).join(',')})`,
            fields: ['Current Cost Price', 'Current Sell Price'],
          });
          for (const item of items) {
            const hasCost = Number(item['Current Cost Price']) > 0;
            const hasSell = Number(item['Current Sell Price']) > 0;
            if (!hasCost || !hasSell) {
              const src = backfillCandidates[item.id];
              db.update(TABLES.STOCK, item.id, {
                ...(!hasCost && src.cost > 0 ? { 'Current Cost Price': src.cost } : {}),
                ...(!hasSell && src.sell > 0 ? { 'Current Sell Price': src.sell } : {}),
                ...(src.supplier ? { Supplier: src.supplier } : {}),
              }).catch(() => {});
            }
          }
        } catch { /* skip batch */ }
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
    const stockId = req.params.id;

    // 1. Order lines — filter by Flower Name (linked record IDs aren't searchable
    //    in Airtable formulas). Use exact Display Name only — not Purchase Name,
    //    which would match all batches of the same flower type.
    const safeName = sanitizeFormulaValue(displayName);
    const orderLines = await db.list(TABLES.ORDER_LINES, {
      filterByFormula: `{Flower Name} = '${safeName}'`,
      fields: ['Order', 'Flower Name', 'Quantity', 'Sell Price Per Unit', 'Cost Price Per Unit', 'Stock Item'],
    });
    // Keep only lines linked to THIS specific stock item — excludes unlinked lines
    // and lines from other batches that happen to share the same base name.
    const matchedLines = orderLines.filter(l => {
      const linkedId = l['Stock Item']?.[0];
      return linkedId === stockId;
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
        requiredBy: o?.['Required By'] || null,
        orderRecordId: orderId || '',
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

    // Only allow writing off flowers that physically exist.
    // Negative stock = demand signal (flowers on order), not physical inventory.
    const physicalStock = Math.max(0, currentQty);
    if (physicalStock === 0) {
      return res.status(400).json({ error: 'No physical stock to write off. Current quantity is zero or negative (flowers on order).' });
    }
    const actualWriteOff = Math.min(quantity, physicalStock);

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

// GET /api/stock/reconciliation — detect stock mismatches.
// Checks ALL non-terminal orders (including future ones). Only counts order
// lines where Stock Deferred is NOT true (these should have been deducted
// from stock at order creation). Compares expected deduction totals against
// actual stock qty to surface discrepancies.
router.get('/reconciliation', async (req, res, next) => {
  try {
    // Fetch active stock items
    const stockItems = await db.list(TABLES.STOCK, {
      filterByFormula: '{Active} = TRUE()',
      fields: ['Display Name', 'Current Quantity', 'Dead/Unsold Stems'],
    });

    // Fetch ALL non-terminal orders (no date filter — deferred flag is what matters)
    const orders = await db.list(TABLES.ORDERS, {
      filterByFormula: `AND({Status} != '${ORDER_STATUS.DELIVERED}', {Status} != '${ORDER_STATUS.PICKED_UP}', {Status} != '${ORDER_STATUS.CANCELLED}')`,
      fields: ['Order Lines', 'Customer', 'Required By', 'App Order ID', 'Status'],
      maxRecords: 1000,
    });

    const allLineIds = orders.flatMap(o => o['Order Lines'] || []);
    const allLines = allLineIds.length > 0
      ? await listByIds(TABLES.ORDER_LINES, allLineIds, {
          fields: ['Order', 'Stock Item', 'Quantity', 'Flower Name', 'Stock Deferred'],
        })
      : [];

    // Customer names for display
    const custIds = [...new Set(orders.flatMap(o => o.Customer || []))];
    const custs = custIds.length > 0
      ? await listByIds(TABLES.CUSTOMERS, custIds, { fields: ['Name', 'Nickname'] })
      : [];
    const custMap = {};
    for (const c of custs) custMap[c.id] = c;
    const orderMap = {};
    for (const o of orders) {
      const cid = o.Customer?.[0];
      orderMap[o.id] = {
        appOrderId: o['App Order ID'] || '',
        customerName: custMap[cid]?.Name || custMap[cid]?.Nickname || '',
        requiredBy: o['Required By'] || null,
        status: o.Status || '',
      };
    }

    // Only count NON-deferred lines — these had their stock deducted at creation
    const deductions = {};
    for (const line of allLines) {
      const stockId = line['Stock Item']?.[0];
      if (!stockId) continue;
      const qty = Number(line.Quantity || 0);
      if (qty <= 0) continue;
      const isDeferred = line['Stock Deferred'] === true || line['Stock Deferred'] === 'true';
      if (isDeferred) continue; // deferred lines did NOT deduct stock — skip

      if (!deductions[stockId]) deductions[stockId] = { expected: 0, orders: [] };
      deductions[stockId].expected += qty;
      const oid = line.Order?.[0];
      const oi = oid ? orderMap[oid] : null;
      if (oi) {
        deductions[stockId].orders.push({
          orderId: oid,
          appOrderId: oi.appOrderId,
          customerName: oi.customerName,
          requiredBy: oi.requiredBy,
          qty,
          status: oi.status,
          deferred: false,
        });
      }
    }

    // Also flag deferred lines that SHOULD have been deducted but weren't
    // (lines in the same order as non-deferred lines = inconsistency)
    for (const line of allLines) {
      const stockId = line['Stock Item']?.[0];
      if (!stockId) continue;
      const qty = Number(line.Quantity || 0);
      if (qty <= 0) continue;
      const isDeferred = line['Stock Deferred'] === true || line['Stock Deferred'] === 'true';
      if (!isDeferred) continue; // already counted above

      const oid = line.Order?.[0];
      const oi = oid ? orderMap[oid] : null;
      // Check if same order has non-deferred lines (mixed deferred = likely bug)
      const sameOrderNonDeferred = allLines.some(l =>
        l.Order?.[0] === oid && l.id !== line.id &&
        !(l['Stock Deferred'] === true || l['Stock Deferred'] === 'true')
      );
      if (sameOrderNonDeferred) {
        // This is suspicious: same order has both deferred and non-deferred lines
        if (!deductions[stockId]) deductions[stockId] = { expected: 0, orders: [] };
        deductions[stockId].expected += qty;
        if (oi) {
          deductions[stockId].orders.push({
            orderId: oid,
            appOrderId: oi.appOrderId,
            customerName: oi.customerName,
            requiredBy: oi.requiredBy,
            qty,
            status: oi.status,
            deferred: true,
            mixedDeferredFlag: true,
          });
        }
      }
    }

    // Build index of stock items
    const stockMap = {};
    for (const item of stockItems) stockMap[item.id] = item;

    // Report items where deductions exist — owner reviews and decides
    const items = [];
    for (const [stockId, d] of Object.entries(deductions)) {
      const item = stockMap[stockId];
      if (!item) continue;
      items.push({
        stockId,
        name: item['Display Name'] || '',
        currentQty: Number(item['Current Quantity'] || 0),
        deductionExpected: d.expected,
        orders: d.orders,
      });
    }

    res.json(items);
  } catch (err) {
    next(err);
  }
});

// POST /api/stock/reconciliation/apply — apply stock corrections in bulk
router.post('/reconciliation/apply', async (req, res, next) => {
  try {
    const adjustments = req.body;
    if (!Array.isArray(adjustments)) {
      return res.status(400).json({ error: 'Expected array of { stockId, adjustDelta }' });
    }
    const results = [];
    for (const { stockId, adjustDelta } of adjustments) {
      if (!stockId || typeof adjustDelta !== 'number' || adjustDelta === 0) continue;
      const result = await db.atomicStockAdjust(stockId, adjustDelta);
      results.push(result);
    }
    res.json({ applied: results.length, results });
  } catch (err) {
    next(err);
  }
});

export default router;
