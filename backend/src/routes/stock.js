import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import * as stockRepo from '../repos/stockRepo.js';
import { TABLES } from '../config/airtable.js';
import { sanitizeFormulaValue } from '../utils/sanitize.js';
import { listByIds } from '../utils/batchQuery.js';
import { actorFromReq } from '../utils/actor.js';
import { ORDER_STATUS, PO_STATUS, LOSS_REASON } from '../constants/statuses.js';

const router = Router();
router.use(authorize('stock'));

// Stock-table allowlist now lives on stockRepo.STOCK_WRITE_ALLOWED — the repo
// applies it to every create/update so no caller can bypass it. The export is
// imported here only for any future read-side validation.

// GET /api/stock?category=Roses&includeEmpty=true&includeInactive=true
// Defaults hide qty=0 (old depleted batches) and Active=false rows.
//  - includeEmpty=true   → also return rows with qty ≤ 0 (e.g. negative stock
//                          already owed to customers)
//  - includeInactive=true → also return rows that have been manually deactivated
//                          in Airtable (the bouquet picker needs this so it can
//                          surface stale-but-still-demanded records and prevent
//                          duplicate-row creation when the owner re-types a name)
router.get('/', async (req, res, next) => {
  try {
    const { category, includeEmpty, includeInactive } = req.query;
    const filters = [];

    if (includeInactive !== 'true') filters.push('{Active} = TRUE()');
    if (includeEmpty !== 'true') filters.push('{Current Quantity} > 0');
    if (category) filters.push(`{Category} = '${sanitizeFormulaValue(category)}'`);

    const stock = await stockRepo.list({
      // When no filters are active we must pass an empty string — Airtable
      // rejects `AND()` with zero clauses. This only happens if the caller
      // opts into both includeEmpty and includeInactive.
      filterByFormula: filters.length ? `AND(${filters.join(', ')})` : '',
      sort: [
        { field: 'Category', direction: 'asc' },
        { field: 'Display Name', direction: 'asc' },
      ],
      // PG-mode equivalent — used when STOCK_BACKEND=postgres flips on.
      pg: {
        includeInactive: includeInactive === 'true',
        includeEmpty:    includeEmpty === 'true',
        category:        category || undefined,
      },
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

// GET /api/stock/premade-committed — stems locked in active premade bouquets.
// Returns { stockId: { qty: N, bouquets: [{ bouquetId, name, qty }] } }
// Premade bouquets deduct stock at creation, so Current Quantity already
// reflects them. This endpoint exposes WHICH premades hold them so the UI
// can show "X available · Y in premades" and offer the dissolve flow when
// an order needs more stems than are freely available.
router.get('/premade-committed', async (req, res, next) => {
  try {
    if (!TABLES.PREMADE_BOUQUETS || !TABLES.PREMADE_BOUQUET_LINES) {
      return res.json({});
    }
    const bouquets = await db.list(TABLES.PREMADE_BOUQUETS, {
      fields: ['Name', 'Lines'],
      maxRecords: 500,
    });
    const allLineIds = bouquets.flatMap(b => b['Lines'] || []);
    const allLines = allLineIds.length > 0
      ? await listByIds(TABLES.PREMADE_BOUQUET_LINES, allLineIds, {
          fields: ['Premade Bouquets', 'Stock Item', 'Quantity', 'Flower Name'],
        })
      : [];
    const bouquetMap = {};
    for (const b of bouquets) bouquetMap[b.id] = b;

    const committed = {};
    for (const line of allLines) {
      const stockId = line['Stock Item']?.[0];
      if (!stockId) continue;
      const qty = Number(line.Quantity || 0);
      if (qty <= 0) continue;
      const bouquetId = line['Premade Bouquets']?.[0];
      const bouquet = bouquetId ? bouquetMap[bouquetId] : null;
      if (!bouquet) continue;
      if (!committed[stockId]) committed[stockId] = { qty: 0, bouquets: [] };
      committed[stockId].qty += qty;
      committed[stockId].bouquets.push({
        bouquetId,
        name: bouquet.Name || '?',
        qty,
      });
    }
    res.json(committed);
  } catch (err) {
    next(err);
  }
});

// GET /api/stock/committed — informational breakdown of which orders consume
// each stock item, for the tap-to-expand detail view on the stock panel.
// Returns demand for future-dated non-terminal orders.
//
// IMPORTANT: stock is deducted from `Current Quantity` at order creation
// (orderService.js → atomicStockAdjust). The `committed` number this endpoint
// returns is the SAME demand, viewed from the other side — it is already
// baked into Current Quantity. The frontend must NOT subtract committed from
// qty: that would double-count. See root CLAUDE.md "Known Pitfalls" #7 and
// packages/shared/utils/stockMath.js.
// Returns { stockId: { committed: N, orders: [{ orderId, appOrderId, customerName, requiredBy, qty }] } }
router.get('/committed', async (req, res, next) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const orders = await db.list(TABLES.ORDERS, {
      filterByFormula: `AND({Status} != '${ORDER_STATUS.DELIVERED}', {Status} != '${ORDER_STATUS.PICKED_UP}', {Status} != '${ORDER_STATUS.CANCELLED}', IS_AFTER({Required By}, '${today}'))`,
      fields: ['Order Lines', 'Customer', 'Required By', 'App Order ID', 'Status'],
      maxRecords: 500,
    });

    const allLineIds = orders.flatMap(o => o['Order Lines'] || []);
    const allLines = await listByIds(TABLES.ORDER_LINES, allLineIds, {
      fields: ['Order', 'Stock Item', 'Quantity', 'Flower Name'],
      maxRecords: 2000,
    });

    const uniqueCustomerIds = [...new Set(orders.flatMap(o => o.Customer || []))];
    const allCustomers = await listByIds(TABLES.CUSTOMERS, uniqueCustomerIds, {
      fields: ['Name', 'Nickname'],
    });
    const customerMap = {};
    for (const c of allCustomers) customerMap[c.id] = c;

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
          status: orderInfo.status,
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
// for all non-Complete, non-Cancelled POs — flowers are still incoming or being evaluated.
// Used by bouquet builders so florists can see what's coming and plan accordingly.
router.get('/pending-po', async (req, res, next) => {
  try {
    const pendingPOs = await db.list(TABLES.STOCK_ORDERS, {
      filterByFormula: `OR({Status} = '${PO_STATUS.DRAFT}', {Status} = '${PO_STATUS.SENT}', {Status} = '${PO_STATUS.SHOPPING}', {Status} = '${PO_STATUS.REVIEWING}', {Status} = '${PO_STATUS.EVALUATING}', {Status} = '${PO_STATUS.EVAL_ERROR}')`,
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
          const matches = await stockRepo.list({
            filterByFormula: `AND({Display Name} = '${safe}', {Active} = TRUE())`,
            fields: ['Display Name', 'Current Cost Price', 'Current Sell Price'],
            maxRecords: 1,
            pg: { active: true, includeEmpty: true, displayName: name },
          });
          if (matches.length > 0) {
            nameToId[name] = matches[0].id;
            // Backfill missing prices on existing zero-qty items from PO line data
            const existing = matches[0];
            if (!existing['Current Cost Price'] && !existing['Current Sell Price']) {
              const poLine = allLines[unlinked.find(x => x.name === name)?.idx];
              if (poLine && (Number(poLine['Cost Price']) || Number(poLine['Sell Price']))) {
                stockRepo.update(existing.id, {
                  'Current Cost Price': Number(poLine['Cost Price']) || 0,
                  'Current Sell Price': Number(poLine['Sell Price']) || 0,
                  ...(poLine.Supplier ? { Supplier: poLine.Supplier } : {}),
                }, { actor: actorFromReq(req) }).catch(err =>
                  console.error(`[STOCK] Price backfill failed for ${existing.id}:`, err.message)
                );
              }
            }
          } else {
            // Auto-create stock item so the flower shows up in pickers.
            // Pull cost/sell from the PO line that triggered this.
            const poLine = allLines[unlinked.find(x => x.name === name)?.idx];
            const created = await stockRepo.create({
              'Display Name': name,
              'Purchase Name': name,
              'Current Quantity': 0,
              'Current Cost Price': Number(poLine?.['Cost Price']) || 0,
              'Current Sell Price': Number(poLine?.['Sell Price']) || 0,
              Supplier: poLine?.Supplier || '',
              Category: 'Other',
              Active: true,
            }, { actor: actorFromReq(req) });
            nameToId[name] = created.id;
            console.log(`[STOCK] Auto-created "${name}" (${created.id}) from pending PO line`);
          }
        } catch { /* skip */ }
      }
      // Link resolved/created stock items back to PO lines (fire-and-forget)
      // Stays on direct db.update — this writes to STOCK_ORDER_LINES, not the
      // stock table itself, so it isn't part of the Phase 3 cutover.
      for (const u of unlinked) {
        if (nameToId[u.name]) {
          allLines[u.idx]._resolvedStockId = nameToId[u.name];
          const lineId = allLines[u.idx].id;
          if (lineId) {
            db.update(TABLES.STOCK_ORDER_LINES, lineId, { 'Stock Item': [nameToId[u.name]] }).catch(err =>
              console.error(`[STOCK] Failed to link PO line ${lineId} to stock ${nameToId[u.name]}:`, err.message)
            );
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
      // Keep the first non-empty flower name.
      // Airtable may return an array if Flower Name is a lookup field —
      // normalise to a plain string so the frontend never receives an array.
      if (!result[stockId].flowerName && line['Flower Name']) {
        const raw = line['Flower Name'];
        result[stockId].flowerName = Array.isArray(raw) ? (raw[0] || '') : String(raw);
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
          const items = await stockRepo.listByIds(chunk, {
            fields: ['Current Cost Price', 'Current Sell Price'],
          });
          for (const item of items) {
            const hasCost = Number(item['Current Cost Price']) > 0;
            const hasSell = Number(item['Current Sell Price']) > 0;
            if (!hasCost || !hasSell) {
              const src = backfillCandidates[item.id];
              stockRepo.update(item.id, {
                ...(!hasCost && src.cost > 0 ? { 'Current Cost Price': src.cost } : {}),
                ...(!hasSell && src.sell > 0 ? { 'Current Sell Price': src.sell } : {}),
                ...(src.supplier ? { Supplier: src.supplier } : {}),
              }, { actor: actorFromReq(req) }).catch(err =>
                console.error(`[STOCK] Batch backfill failed for ${item.id}:`, err.message)
              );
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

    const item = await stockRepo.create(fields, { actor: actorFromReq(req) });
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

// GET /api/stock/:id/usage — trace where flowers went: orders that used this stock item,
// write-offs, PO receipts, and stems locked in active premade bouquets.
//
// Goal: sum(trail.quantity) should equal the Stock row's Current Quantity, for
// every row, always. If it doesn't, something changed qty without emitting an
// event here — that's a data-integrity gap to investigate. See root CLAUDE.md
// pitfall #7 + packages/shared/utils/stockMath.js for the model.
//
// Event types:
//   - 'order'     — order line consuming stems (negative qty)
//   - 'writeoff'  — stock loss log entry (negative qty)
//   - 'purchase'  — stock purchase or PO receipt (positive qty)
//   - 'premade'   — stems currently locked in an active premade bouquet
//                   (negative qty; dated null because premade lines have no
//                   creation timestamp in Airtable today — they show at the
//                   top of the chronological list as "ongoing").
router.get('/:id/usage', async (req, res, next) => {
  try {
    const stockItem = await stockRepo.getById(req.params.id);
    const displayName = stockItem['Display Name'] || '';
    const stockId = req.params.id;

    // Aggregate across sibling batches sharing the same base flower name.
    // receiveIntoStock creates a new dated batch record for each receive,
    // and order lines stay linked to whichever record existed at creation —
    // so an order's usage and a PO's receipt often live on different stock
    // records even though they refer to the same physical flower. The trace
    // should show the full picture for the flower, not just this one record.
    const dateBatchRe = /^(.+?)\s*\(\d{1,2}\.\w{3,4}\.?\)$/;
    const baseName = (displayName.match(dateBatchRe)?.[1] || displayName).trim();
    const safeBase = sanitizeFormulaValue(baseName);
    // Find all sibling stock records: the base record itself, plus any
    // "<base> (dd.Mmm.)" dated batches.
    let siblingStocks = [];
    try {
      siblingStocks = await stockRepo.list({
        filterByFormula: `OR({Display Name} = '${safeBase}', FIND('${safeBase} (', {Display Name} & '') = 1)`,
        fields: ['Display Name', 'Current Quantity'],
        // PG-mode: no formula equivalent — caller filters on returned rows.
        // Return all active stock for the base name; JS filter below handles the variant match.
        pg: { active: true, includeEmpty: true },
      });
    } catch {
      siblingStocks = [stockItem];
    }
    // Ensure the requested record is always in the set (in case the formula
    // misses due to whitespace/punctuation differences).
    if (!siblingStocks.some(s => s.id === stockId)) siblingStocks.push(stockItem);
    const siblingIds = new Set(siblingStocks.map(s => s.id));
    const siblingNames = siblingStocks.map(s => s['Display Name']).filter(Boolean);

    // 1. Order lines — walk from the Orders side.
    //
    // Previous implementation filtered Order Lines by `Flower Name` text
    // matching the sibling Display Names. That's fragile: if any past order
    // was created with a subtly different Flower Name (legacy casing, extra
    // whitespace, a rename after the line was stamped, a flower whose stock
    // row was since renamed/deleted), the line is invisible to the trace
    // even though its Stock Item link DID deduct qty via atomicStockAdjust.
    //
    // The Stock Item link is the authoritative relationship; `Flower Name` is
    // just a display snapshot taken at creation time. So we fetch recent
    // orders (past year + anything with no Order Date), pull their line IDs,
    // then JS-filter lines whose Stock Item resolves to one of the siblings.
    //
    // Trade-off: two round-trips (Orders, Order Lines) instead of one, and
    // a larger result set. For a small shop (<2000 orders/year) both queries
    // return in well under a second via the rate-limited queue.
    const orderCutoff = new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0];
    const recentOrders = await db.list(TABLES.ORDERS, {
      filterByFormula: `OR({Order Date} = '', NOT(IS_BEFORE({Order Date}, '${orderCutoff}')))`,
      fields: ['Order Lines', 'App Order ID', 'Customer', 'Status', 'Required By', 'Order Date'],
      maxRecords: 2000,
    });
    const allLineIds = recentOrders.flatMap(o => o['Order Lines'] || []);
    const allLines = allLineIds.length > 0
      ? await listByIds(TABLES.ORDER_LINES, allLineIds, {
          fields: ['Order', 'Flower Name', 'Quantity', 'Sell Price Per Unit', 'Cost Price Per Unit', 'Stock Item'],
        })
      : [];
    // Keep only lines whose Stock Item link resolves to one of our siblings.
    // Orphan lines (no link) don't affect qty (atomicStockAdjust needs a
    // stock ID), so dropping them is harmless.
    const matchedLines = allLines.filter(l => siblingIds.has(l['Stock Item']?.[0]));

    // Build the order map from the orders we already fetched — no second
    // round-trip needed.
    const orderMap = {};
    for (const o of recentOrders) orderMap[o.id] = o;

    // Fetch only the customers whose orders actually matched this stock —
    // otherwise we'd pull every customer from the past year.
    const matchedOrderIds = new Set(matchedLines.flatMap(l => l.Order || []));
    const customerIds = [...new Set(
      recentOrders
        .filter(o => matchedOrderIds.has(o.id))
        .flatMap(o => o.Customer || [])
    )];
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
          .filter(l => siblingIds.has(l['Stock Item']?.[0]))
          .map(l => ({
            type: 'writeoff',
            date: l.Date || null,
            reason: l.Reason || '',
            notes: l.Notes || '',
            quantity: -(l.Quantity || 0),
          }));
      } catch { /* table may not exist */ }
    }

    // 3. Purchase records — fetch and filter by Flower link in JS.
    // Purchases created by the PO evaluate flow carry a Notes marker like
    // "PO #recXXX L#recYYY primary". Parse it out and resolve the PO's
    // display ID (e.g. "PO-20260415-1") so the trace shows a human reference
    // instead of raw Airtable record IDs.
    let usagePurchases = [];
    try {
      const allPurchases = await db.list(TABLES.STOCK_PURCHASES, {
        filterByFormula: `{Supplier} != ''`,
        sort: [{ field: 'Purchase Date', direction: 'desc' }],
        maxRecords: 500,
      });
      const linePurchases = allPurchases.filter(p => siblingIds.has(p.Flower?.[0]));

      // Parse PO marker from Notes; batch-fetch the parent POs to resolve
      // Stock Order ID. The marker is a stable format produced by the
      // evaluate endpoint; we leave Notes unchanged for idempotency.
      const poMarkerRe = /PO #(rec[A-Za-z0-9]+)\s+L#(rec[A-Za-z0-9]+)\s+(primary|substitute|alt)/;
      const poIdSet = new Set();
      for (const p of linePurchases) {
        const m = p.Notes?.match(poMarkerRe);
        if (m) poIdSet.add(m[1]);
      }
      const poMap = {};
      if (poIdSet.size > 0) {
        try {
          const poRecs = await listByIds(TABLES.STOCK_ORDERS, [...poIdSet], {
            fields: ['Stock Order ID'],
          });
          for (const po of poRecs) poMap[po.id] = po['Stock Order ID'] || '';
        } catch { /* best effort — fall back to raw Notes */ }
      }

      usagePurchases = linePurchases.map(p => {
        const m = p.Notes?.match(poMarkerRe);
        const poRecordId = m?.[1] || null;
        const poDisplayId = poRecordId ? (poMap[poRecordId] || '') : '';
        const variant = m?.[3] || ''; // primary | substitute | alt
        return {
          type: 'purchase',
          date: p['Purchase Date'] || null,
          quantity: +(p['Quantity Purchased'] || 0),
          supplier: p.Supplier || '',
          costPerUnit: p['Price Per Unit'] || 0,
          notes: p.Notes || '',
          poDisplayId,
          variant,
        };
      });
    } catch { /* table may not exist */ }

    // 4. Active premade bouquet lines — stems physically locked in a premade
    // that hasn't been sold/dissolved yet. These were deducted from qty when
    // the premade was created; the trace must surface them or the arithmetic
    // won't reconcile. Dissolved/consumed premades don't appear (the line
    // record is deleted and the stems either flowed into an order or were
    // returned to stock via a reverse atomicStockAdjust — both of which are
    // already represented in the 'order' and 'purchase' trails respectively).
    let usagePremades = [];
    if (TABLES.PREMADE_BOUQUETS && TABLES.PREMADE_BOUQUET_LINES) {
      try {
        const bouquets = await db.list(TABLES.PREMADE_BOUQUETS, {
          fields: ['Name', 'Lines'],
          maxRecords: 500,
        });
        const allLineIds = bouquets.flatMap(b => b['Lines'] || []);
        const allLines = allLineIds.length > 0
          ? await listByIds(TABLES.PREMADE_BOUQUET_LINES, allLineIds, {
              fields: ['Premade Bouquets', 'Stock Item', 'Quantity', 'Flower Name'],
            })
          : [];
        const bouquetMap = {};
        for (const b of bouquets) bouquetMap[b.id] = b;
        usagePremades = allLines
          .filter(l => siblingIds.has(l['Stock Item']?.[0]))
          .map(l => {
            const bouquetId = l['Premade Bouquets']?.[0];
            const bouquet = bouquetId ? bouquetMap[bouquetId] : null;
            return {
              type: 'premade',
              date: null, // no timestamp on premade lines in Airtable
              quantity: -(Number(l.Quantity) || 0),
              bouquetId: bouquetId || '',
              bouquetName: bouquet?.Name || '?',
              flowerName: l['Flower Name'] || displayName,
            };
          });
      } catch { /* premade tables may not exist in some envs */ }
    }

    // Combine and sort chronologically (newest first).
    // Premade entries have null date — they sort to the top as "ongoing".
    const trail = [...usageOrders, ...usageLosses, ...usagePurchases, ...usagePremades]
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
// When Cost/Sell price changes, cascade to matching Premade Bouquet Lines so
// premade bouquet totals reflect the new price. Delivered/Active orders keep
// their snapshot prices unchanged — those are customer commitments.
router.patch('/:id', async (req, res, next) => {
  try {
    // The repo applies the allowlist (STOCK_WRITE_ALLOWED) — passing the
    // raw body is safe; disallowed keys are silently dropped.
    const item = await stockRepo.update(req.params.id, req.body, { actor: actorFromReq(req) });
    const safeFields = req.body; // for the cascade checks below

    // Sync threshold across batches of the same base flower
    if ('Reorder Threshold' in safeFields && item['Purchase Name']) {
      const baseName = item['Purchase Name'];
      const siblings = await stockRepo.list({
        filterByFormula: `AND({Purchase Name} = '${sanitizeFormulaValue(baseName)}', RECORD_ID() != '${req.params.id}')`,
        fields: ['Reorder Threshold'],
        pg: { active: true, includeEmpty: true },
      });
      for (const sib of siblings) {
        if (sib.id === req.params.id) continue;  // PG-mode safety: filter formula not applied
        if (sib['Reorder Threshold'] !== safeFields['Reorder Threshold']) {
          await stockRepo.update(sib.id, {
            'Reorder Threshold': safeFields['Reorder Threshold'],
          }, { actor: actorFromReq(req) });
        }
      }
    }

    // Cascade price changes to Premade Bouquet Lines that reference this stock
    // item. Can't filterByFormula against a linked-record field (Airtable
    // returns display names via ARRAYJOIN — see CLAUDE.md pitfalls), so list
    // all lines and filter in memory. Volume is small (<500 lines in practice).
    const costChanged = 'Current Cost Price' in safeFields;
    const sellChanged = 'Current Sell Price' in safeFields;
    if ((costChanged || sellChanged) && TABLES.PREMADE_BOUQUET_LINES) {
      const allPremadeLines = await db.list(TABLES.PREMADE_BOUQUET_LINES, {
        fields: ['Stock Item', 'Cost Price Per Unit', 'Sell Price Per Unit'],
        maxRecords: 500,
      });
      const matching = allPremadeLines.filter(
        l => Array.isArray(l['Stock Item']) && l['Stock Item'][0] === req.params.id,
      );
      for (const line of matching) {
        const patch = {};
        if (costChanged) patch['Cost Price Per Unit'] = Number(safeFields['Current Cost Price']) || 0;
        if (sellChanged) patch['Sell Price Per Unit'] = Number(safeFields['Current Sell Price']) || 0;
        await db.update(TABLES.PREMADE_BOUQUET_LINES, line.id, patch);
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

    const item = await stockRepo.getById(req.params.id);
    const currentQty = item['Current Quantity'] || 0;
    const newQty = currentQty + delta;

    if (newQty < 0) {
      console.warn(`[STOCK] Negative stock: ${req.params.id} going to ${newQty} (current: ${currentQty}, delta: ${delta})`);
    }

    const updated = await stockRepo.update(req.params.id, {
      'Current Quantity': newQty,
    }, { actor: actorFromReq(req) });

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

    const item = await stockRepo.getById(req.params.id);
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

    const updated = await stockRepo.update(req.params.id, fields, { actor: actorFromReq(req) });

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

// GET /api/stock/reconciliation — list substitute pairs that still have
// unswapped bouquet lines. Backed by the `Substitute For` link written by
// findOrCreateSubstituteStock (PO evaluation → substitute receive flow).
//
// Response shape:
//   { items: [{ originalStockId, originalName, originalQty,
//               substitutes: [{ stockId, name, availableQty }],
//               affectedLines: [{ lineId, orderId, appOrderId, customerName,
//                                 requiredBy, orderStatus, quantity, suggestedSwapQty }] }] }
//
// An "item" is one original flower the owner has a substitute for, plus the
// non-terminal order lines still pointing at that original. The owner picks a
// substitute (usually there is one; sometimes multiple if the same original was
// substituted more than once) and hits Swap per affected line. When every line
// has been swapped off, the original stops appearing here.
router.get('/reconciliation', async (req, res, next) => {
  try {
    // 1. Fetch all active stock — need `Substitute For` to find substitutes and
    //    `Current Quantity` for both the original (shown, may be negative) and
    //    the substitute (shown, must cover the swap qty).
    const stockItems = await stockRepo.list({
      filterByFormula: '{Active} = TRUE()',
      fields: ['Display Name', 'Current Quantity', 'Substitute For'],
      pg: { active: true, includeEmpty: true },
    });

    // Index: originalStockId → [substituteStockId, ...]
    // Airtable's `Substitute For` is a linked-record array of stock IDs.
    const substitutesByOriginal = {};
    const stockMap = {};
    for (const item of stockItems) {
      stockMap[item.id] = item;
      const originals = Array.isArray(item['Substitute For']) ? item['Substitute For'] : [];
      for (const origId of originals) {
        if (!substitutesByOriginal[origId]) substitutesByOriginal[origId] = [];
        substitutesByOriginal[origId].push(item.id);
      }
    }
    const originalIds = Object.keys(substitutesByOriginal);
    if (originalIds.length === 0) return res.json({ items: [] });

    // 2. Originals may be deactivated after substitution — fetch by ID so we
    //    can still show the card regardless of Active status.
    const originals = await stockRepo.listByIds(originalIds, {
      fields: ['Display Name', 'Current Quantity'],
    });
    const originalMap = {};
    for (const o of originals) originalMap[o.id] = o;

    // 3. Non-terminal orders + lines — find which lines still reference an
    //    original so the owner knows which orders need swapping.
    const orders = await db.list(TABLES.ORDERS, {
      filterByFormula: `AND({Status} != '${ORDER_STATUS.DELIVERED}', {Status} != '${ORDER_STATUS.PICKED_UP}', {Status} != '${ORDER_STATUS.CANCELLED}')`,
      fields: ['Order Lines', 'Customer', 'Required By', 'App Order ID', 'Status'],
      maxRecords: 1000,
    });
    const allLineIds = orders.flatMap(o => o['Order Lines'] || []);
    const allLines = allLineIds.length > 0
      ? await listByIds(TABLES.ORDER_LINES, allLineIds, {
          fields: ['Order', 'Stock Item', 'Quantity', 'Flower Name'],
        })
      : [];

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

    // Bucket affected lines by original stockId. Skip qty=0 lines (already
    // swapped or zeroed out — no work left).
    const linesByOriginal = {};
    const originalIdSet = new Set(originalIds);
    for (const line of allLines) {
      const stockId = line['Stock Item']?.[0];
      if (!stockId || !originalIdSet.has(stockId)) continue;
      const qty = Number(line.Quantity || 0);
      if (qty <= 0) continue;
      const oid = line.Order?.[0];
      const oi = oid ? orderMap[oid] : null;
      if (!oi) continue;
      if (!linesByOriginal[stockId]) linesByOriginal[stockId] = [];
      linesByOriginal[stockId].push({
        lineId: line.id,
        orderId: oid,
        appOrderId: oi.appOrderId,
        customerName: oi.customerName,
        requiredBy: oi.requiredBy,
        orderStatus: oi.status,
        quantity: qty,
        suggestedSwapQty: qty,
      });
    }

    // 4. Build response: only include originals that still have affected lines.
    //    Fully-reconciled pairs disappear so the UI stays focused on work left.
    const items = [];
    for (const origId of originalIds) {
      const affectedLines = linesByOriginal[origId];
      if (!affectedLines || affectedLines.length === 0) continue;
      const original = originalMap[origId];
      if (!original) continue;

      const subIds = substitutesByOriginal[origId] || [];
      const substitutes = subIds
        .map(sid => {
          const s = stockMap[sid];
          if (!s) return null;
          return {
            stockId: sid,
            name: s['Display Name'] || '',
            availableQty: Number(s['Current Quantity'] || 0),
          };
        })
        .filter(Boolean);

      // FIFO by delivery date — earliest first, owner reconciles in delivery order.
      affectedLines.sort((a, b) =>
        (a.requiredBy || '').localeCompare(b.requiredBy || '')
      );

      items.push({
        originalStockId: origId,
        originalName: original['Display Name'] || '',
        originalQty: Number(original['Current Quantity'] || 0),
        substitutes,
        affectedLines,
      });
    }

    // Most-affected originals first — owner tackles the biggest impact pairs first.
    items.sort((a, b) => b.affectedLines.length - a.affectedLines.length);

    res.json({ items });
  } catch (err) {
    next(err);
  }
});

export default router;
