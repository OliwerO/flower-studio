import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as stockRepo from '../repos/stockRepo.js';
import * as orderRepo from '../repos/orderRepo.js';
import * as customerRepo from '../repos/customerRepo.js';
import * as stockLossRepo from '../repos/stockLossRepo.js';
import * as stockPurchasesRepo from '../repos/stockPurchasesRepo.js';
import * as stockOrderRepo from '../repos/stockOrderRepo.js';
import * as premadeBouquetRepo from '../repos/premadeBouquetRepo.js';
import { sanitizeFormulaValue } from '../utils/sanitize.js';
import { actorFromReq } from '../utils/actor.js';
import { ORDER_STATUS, PO_STATUS, LOSS_REASON } from '../constants/statuses.js';
import { getStockYModelEnabled } from '../services/configService.js';

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

    // ── Y-model grouped path (issue #289) ──
    // When STOCK_Y_MODEL is enabled AND caller passes ?grouped=true, return
    // Variety-grouped aggregation: { groups: [{ key, type_name, colour,
    // size_cm, cultivar, rows: StockItem[], reservedForPremades }] }.
    // All other query params are ignored on this path — the grouped query
    // fetches all Y-model rows and applies its own includeEmpty logic.
    if (getStockYModelEnabled() && req.query.grouped === 'true') {
      const groups = await stockRepo.listGroupedByVariety({
        includeEmpty: includeEmpty === 'true',
      });
      return res.json({ groups });
    }

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

    const lines = await orderRepo.getLinesForVelocity(thirtyDaysAgo, today);

    // Sum qty sold per stock item over the 30-day window
    const qtySoldByStock = {};
    for (const line of lines) {
      const id = line.stockItemId;
      if (!id) continue;
      qtySoldByStock[id] = (qtySoldByStock[id] || 0) + Number(line.quantity || 0);
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
    // Y-model: aggregate directly from premade_bouquet_lines per Stock Item id.
    // Same response shape as legacy { stockId: { qty: N, bouquets: [] } }.
    if (getStockYModelEnabled()) {
      const allStock = await stockRepo.list({ pg: { includeInactive: true, includeEmpty: true } });
      const allStockIds = allStock.map(s => s._pgId).filter(Boolean);
      const details = await stockRepo.getPremadeReservationDetails(allStockIds);
      const committed = {};
      for (const [stockId, { totalQty, bouquets }] of details) {
        if (totalQty > 0) committed[stockId] = { qty: totalQty, bouquets };
      }
      return res.json(committed);
    }

    const bouquets = await premadeBouquetRepo.list();
    // Keyed by whatever Stock Item ID the line carries (may be a phantom rec
    // ID from premade lines created in Airtable against a post-cutover UUID
    // stock item — Airtable can't store UUIDs in linked fields).
    const rawCommitted = {};
    for (const bouquet of bouquets) {
      const lines = await premadeBouquetRepo.getLinesByBouquetId(bouquet._pgId);
      for (const line of lines) {
        const stockId = line['Stock Item']?.[0];
        if (!stockId) continue;
        const qty = Number(line.Quantity || 0);
        if (qty <= 0) continue;
        if (!rawCommitted[stockId]) {
          rawCommitted[stockId] = { qty: 0, bouquets: [], _flowerName: line['Flower Name'] || '' };
        }
        rawCommitted[stockId].qty += qty;
        rawCommitted[stockId].bouquets.push({ bouquetId: bouquet.id, name: bouquet.Name || '?', qty });
      }
    }

    // Resolve each Stock Item ID to the PG stock ID the frontend uses. For
    // phantom recXXX that don't resolve, fall back to matching by flower name.
    const allStock = await stockRepo.list({ pg: { includeInactive: true, includeEmpty: true } });
    const stockById   = new Map(allStock.map(s => [s.id, s]));
    const stockByName = new Map(allStock.map(s => [(s['Display Name'] || '').toLowerCase(), s]));

    const committed = {};
    for (const [atId, entry] of Object.entries(rawCommitted)) {
      const { _flowerName, ...data } = entry;
      const pgId = stockById.has(atId)
        ? atId
        : stockByName.get((_flowerName || '').toLowerCase())?.id;
      if (!pgId) continue;
      if (!committed[pgId]) committed[pgId] = { qty: 0, bouquets: [] };
      committed[pgId].qty += data.qty;
      committed[pgId].bouquets.push(...data.bouquets);
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

    const activeOrders = await orderRepo.list({
      pg: {
        excludeStatuses: [ORDER_STATUS.DELIVERED, ORDER_STATUS.PICKED_UP, ORDER_STATUS.CANCELLED],
        requiredByFrom: today,
      },
    });

    const uniqueCustomerIds = [...new Set(activeOrders.flatMap(o => o.Customer || []))];
    const allCustomers = uniqueCustomerIds.length > 0 ? await customerRepo.findMany(uniqueCustomerIds) : [];
    const customerMap = {};
    for (const c of allCustomers) {
      customerMap[c.id] = c;
      if (c.airtableId) customerMap[c.airtableId] = c;
    }

    const committed = {};
    for (const order of activeOrders) {
      const custId = order.Customer?.[0];
      const customerName = customerMap[custId]?.Name || customerMap[custId]?.Nickname || '';
      for (const line of (order._lines || [])) {
        const stockId = line['Stock Item']?.[0];
        if (!stockId) continue;
        const qty = Number(line.Quantity || 0);
        if (qty <= 0) continue;
        if (!committed[stockId]) committed[stockId] = { committed: 0, orders: [] };
        committed[stockId].committed += qty;
        committed[stockId].orders.push({
          orderId: order.id,
          appOrderId: order['App Order ID'] || '',
          customerName,
          requiredBy: order['Required By'] || null,
          status: order.Status || 'New',
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
    const pendingStatuses = [
      PO_STATUS.DRAFT, PO_STATUS.SENT, PO_STATUS.SHOPPING,
      PO_STATUS.REVIEWING, PO_STATUS.EVALUATING, PO_STATUS.EVAL_ERROR,
    ];

    // List all pending POs across statuses (small N — typically <30).
    const allPendingPOs = [];
    for (const s of pendingStatuses) {
      const pos = await stockOrderRepo.list({ status: s });
      allPendingPOs.push(...pos);
    }
    if (allPendingPOs.length === 0) return res.json({});

    const poIds = allPendingPOs.map(po => po._pgId).filter(Boolean);
    const linesByPo = await stockOrderRepo.getLinesForPos(poIds);
    const allLines = [];
    for (const po of allPendingPOs) {
      const ls = linesByPo.get(po._pgId) || [];
      for (const l of ls) allLines.push({ ...l, _poPgId: po._pgId });
    }

    const poMap = {};
    for (const po of allPendingPOs) {
      poMap[po._pgId] = {
        id: po.id, number: po['Stock Order ID'] || '',
        status: po.Status, plannedDate: po['Planned Date'] || null,
      };
    }

    // Auto-resolve unlinked lines (Flower Name → Stock Item).
    const unlinked = allLines
      .map((l, idx) => ({ idx, line: l }))
      .filter(({ line }) => !line['Stock Item']?.[0] && line['Flower Name']);

    const nameToId = {};
    if (unlinked.length > 0) {
      const uniqueNames = [...new Set(unlinked.map(u => u.line['Flower Name'].trim()))];
      for (const name of uniqueNames) {
        try {
          const matches = await stockRepo.list({
            pg: { active: true, includeEmpty: true, displayName: name },
            maxRecords: 1,
          });
          if (matches.length > 0) {
            nameToId[name] = matches[0].id;
            // Backfill missing prices on existing zero-qty items from PO line data.
            const existing = matches[0];
            if (!existing['Current Cost Price'] && !existing['Current Sell Price']) {
              const samplePoLine = unlinked.find(x => x.line['Flower Name']?.trim() === name)?.line;
              if (samplePoLine && (Number(samplePoLine['Cost Price']) || Number(samplePoLine['Sell Price']))) {
                stockRepo.update(existing.id, {
                  'Current Cost Price': Number(samplePoLine['Cost Price']) || 0,
                  'Current Sell Price': Number(samplePoLine['Sell Price']) || 0,
                  ...(samplePoLine.Supplier ? { Supplier: samplePoLine.Supplier } : {}),
                }, { actor: actorFromReq(req) }).catch(err =>
                  console.error(`[STOCK] Price backfill failed for ${existing.id}:`, err.message));
              }
            }
          } else {
            // Auto-create stock item so the flower shows up in pickers.
            const samplePoLine = unlinked.find(x => x.line['Flower Name']?.trim() === name)?.line;
            const created = await stockRepo.create({
              'Display Name':       name,
              'Purchase Name':      name,
              'Current Quantity':   0,
              'Current Cost Price': Number(samplePoLine?.['Cost Price']) || 0,
              'Current Sell Price': Number(samplePoLine?.['Sell Price']) || 0,
              Supplier:             samplePoLine?.Supplier || '',
              Category:             'Other',
              Active:               true,
            }, { actor: actorFromReq(req) });
            nameToId[name] = created.id;
            console.log(`[STOCK] Auto-created "${name}" (${created.id}) from pending PO line`);
          }
        } catch { /* skip */ }
      }
      // Persist the auto-link via stockOrderRepo (was direct Airtable update).
      for (const u of unlinked) {
        const stockId = nameToId[u.line['Flower Name'].trim()];
        if (stockId && u.line.id) {
          allLines[u.idx]._resolvedStockId = stockId;
          stockOrderRepo.updateLine(u.line.id, { 'Stock Item': [stockId] }).catch(err =>
            console.error(`[STOCK] Failed to link PO line ${u.line.id} to stock ${stockId}:`, err.message));
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

      if (!result[stockId]) result[stockId] = { ordered: 0, plannedDate: null, pos: [], flowerName: '', sell: 0, cost: 0 };
      result[stockId].ordered += qty;
      if (!result[stockId].flowerName && line['Flower Name']) {
        result[stockId].flowerName = String(line['Flower Name']);
      }

      const poInfo = poMap[line._poPgId];
      if (poInfo) {
        // Carry the line's own price so bouquet builders can price a not-yet-arrived
        // flower off its pending PO rather than the stock card's last-received sell (#377).
        result[stockId].pos.push({
          id: poInfo.id, number: poInfo.number, quantity: qty, plannedDate: poInfo.plannedDate,
          sell: Number(line['Sell Price']) || 0, cost: Number(line['Cost Price']) || 0,
        });
        if (poInfo.plannedDate && (!result[stockId].plannedDate || poInfo.plannedDate < result[stockId].plannedDate)) {
          result[stockId].plannedDate = poInfo.plannedDate;
        }
      }
    }

    // Per stock item, expose the sell/cost of the soonest-arriving priced PO
    // (fall back to the first priced line). This is the price the owner just set
    // in the pending Stock Order — what a bouquet should use until the PO is
    // evaluated and the stock card's Current Sell Price catches up (#377).
    for (const entry of Object.values(result)) {
      const priced = entry.pos.filter(p => p.sell > 0);
      if (priced.length === 0) continue;
      priced.sort((a, b) => String(a.plannedDate || '9999-12-31').localeCompare(String(b.plannedDate || '9999-12-31')));
      entry.sell = priced[0].sell;
      entry.cost = priced[0].cost;
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
                console.error(`[STOCK] Batch backfill failed for ${item.id}:`, err.message));
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
// Body: { displayName, category, quantity, costPrice, sellPrice?, supplier?, unit?,
//         typeName?, colour?, sizeCm?, cultivar? }
// The 4-tuple Variety attrs (typeName/colour/sizeCm/cultivar) are optional pass-through
// fields added for issue #287. sizeCm is coerced to integer or null; empty strings for
// string attrs normalise to null. No further validation beyond coercion.
router.post('/', async (req, res, next) => {
  try {
    const {
      displayName, category, quantity, costPrice, sellPrice, supplier, unit, lotSize, farmer,
      // Stock Y-model 4-tuple Variety attrs (camelCase wire → Airtable-style field names)
      typeName, colour, sizeCm, cultivar,
    } = req.body;
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

    // 4-tuple Variety attrs — always pass so responseToPg can normalise them
    // (empty strings → null handled inside responseToPg / stockRepo).
    if (typeName  !== undefined) fields['Type']    = typeName;
    if (colour    !== undefined) fields['Colour']  = colour;
    if (sizeCm    !== undefined) fields['Size']    = sizeCm;
    if (cultivar  !== undefined) fields['Cultivar'] = cultivar;

    const item = await stockRepo.create(fields, { actor: actorFromReq(req) });
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

// ── Variety backfill endpoints (issue #292) ──
// All four require Owner role. Florist gets 403.

// GET /api/stock/needs-backfill?includeBackfilled=true
// Returns { rows, total, remaining }.
//   rows      — stock items with type_name IS NULL (default) or all rows when
//               includeBackfilled=true. Sorted by display_name.
//   total     — count of all non-deleted stock rows.
//   remaining — count still needing backfill (type_name IS NULL).
// Used by the status banner ("N of M still need backfill").
router.get('/needs-backfill', authorize('stock', ['owner']), async (req, res, next) => {
  try {
    const includeBackfilled = req.query.includeBackfilled === 'true';
    const [rows, allRows] = await Promise.all([
      stockRepo.findByTypeNameNull({ includeBackfilled }),
      stockRepo.findByTypeNameNull({ includeBackfilled: true }),
    ]);
    const total     = allRows.length;
    const remaining = allRows.filter(r => r['Type'] == null).length;
    res.json({ rows, total, remaining });
  } catch (err) {
    next(err);
  }
});

// GET /api/stock/distinct/:column
// Returns a sorted array of distinct non-null values for one of the four
// Variety columns. Used by autocomplete inputs. Allowed columns:
// typeName, colour, sizeCm, cultivar.
router.get('/distinct/:column', authorize('stock', ['owner']), async (req, res, next) => {
  try {
    const values = await stockRepo.distinctValues(req.params.column);
    res.json(values);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/stock/variety-attrs/bulk
// Body: { ids: string[], attrs: { typeName, colour?, sizeCm?, cultivar? } }
// Applies attrs to all ids in a single transaction.
// Returns { updated: [...varietyResponse] }.
// NOTE: Must be defined BEFORE router.patch('/:id', ...) and BEFORE the
// router.patch('/:id/variety-attrs', ...) below — Express matches in
// definition order, and "variety-attrs" would otherwise be treated as :id.
router.patch('/variety-attrs/bulk', authorize('stock', ['owner']), async (req, res, next) => {
  try {
    const { ids, attrs } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }
    const updated = await stockRepo.bulkUpdateVarietyAttrs(ids, attrs, { actor: actorFromReq(req) });
    res.json({ updated });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/stock/:id/variety-attrs
// Body: { typeName: string (required), colour?: string, sizeCm?: number, cultivar?: string }
// Returns the updated row in the varietyResponse shape.
// NOTE: This route MUST appear before router.patch('/:id', ...) so ":id"
// does not capture the literal "variety-attrs" string. The route is defined
// here with the literal path suffix "/variety-attrs".
router.patch('/:id/variety-attrs', authorize('stock', ['owner']), async (req, res, next) => {
  try {
    const { typeName, colour, sizeCm, cultivar } = req.body;
    const item = await stockRepo.updateVarietyAttrs(req.params.id, {
      typeName, colour, sizeCm, cultivar,
    }, { actor: actorFromReq(req) });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

// GET /api/stock/varieties/:key/usage — per-Variety trace (T5.2, PRD #324).
//
// :key is the URL-encoded pipe-separated 4-tuple "Type|Colour|SizeCm|Cultivar"
// (same serialization as _varietyKey() / the shared varietyKey util; empty
// segment = NULL).
//
// IMPORTANT: this route is registered BEFORE /:id/usage so the literal
// segment "varieties" is not captured as the `:id` parameter.
//
// Returns: { variety: { key, type_name, colour, size_cm, cultivar },
//            events: TrailEvent[], unaccountedStems: number }
router.get('/varieties/:key/usage', async (req, res, next) => {
  try {
    const key = decodeURIComponent(req.params.key);
    const result = await stockRepo.getUsageByVarietyKey(key);
    return res.json(result);
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

    // ── Y-model exact-ID path (issue #289, ADR-0007) ──
    // Each Batch is an addressable identity; no sibling aggregation.
    if (getStockYModelEnabled()) {
      const trail = await stockRepo.getUsageByExactId(stockItem._pgId || stockId);
      return res.json({
        stockItem: { id: stockItem.id, displayName, currentQty: stockItem['Current Quantity'] || 0 },
        trail,
      });
    }

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
      const allForName = await stockRepo.list({
        filterByFormula: `OR({Display Name} = '${safeBase}', FIND('${safeBase} (', {Display Name} & '') = 1)`,
        fields: ['Display Name', 'Current Quantity'],
        pg: { active: true, includeEmpty: true },
      });
      // PG mode returns all active stock (no formula support) — filter JS-side
      // for the exact base name or "<base> (" dated-batch prefix.
      siblingStocks = allForName.filter(s => {
        const n = s['Display Name'] || '';
        return n === baseName || n.startsWith(baseName + ' (');
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
    const recentOrders = await orderRepo.list({
      pg: { dateFrom: orderCutoff },
    }).catch(err => { console.error('[STOCK] usage orderRepo.list failed:', err.message); return []; });

    // Filter _lines to those whose Stock Item resolves to one of our siblings
    const matchedLines = [];
    const orderMap = {};
    for (const o of recentOrders) {
      orderMap[o.id] = o;
      for (const line of (o._lines || [])) {
        if (siblingIds.has(line['Stock Item']?.[0])) {
          matchedLines.push({ ...line, _orderId: o.id });
        }
      }
    }

    const matchedOrderIds = new Set(matchedLines.map(l => l._orderId));
    const customerIds = [...new Set(
      recentOrders.filter(o => matchedOrderIds.has(o.id)).flatMap(o => o.Customer || [])
    )];
    const custList = customerIds.length > 0 ? await customerRepo.findMany(customerIds) : [];
    const customerMap = {};
    for (const c of custList) {
      customerMap[c.id] = c;
      if (c.airtableId) customerMap[c.airtableId] = c;
    }

    const usageOrders = matchedLines.map(l => {
      const orderId = l._orderId;
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
    try {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];
      const allLosses = await stockLossRepo.list({ from: ninetyDaysAgo });
      usageLosses = allLosses
        .filter(l => siblingIds.has(l['Stock Item']?.[0]))
        .map(l => ({
          type: 'writeoff',
          date: l.Date || null,
          reason: l.Reason || '',
          notes: l.Notes || '',
          quantity: -(l.Quantity || 0),
        }));
    } catch (err) {
      console.error('stock usage: loss log fetch failed', err);
    }

    // 3. Purchase records — Postgres. Purchases created by the PO evaluate
    // flow carry a Notes marker. ADR-0003: the format changed in Phase 7 from
    // "PO #recXXX L#recYYY primary" (Airtable era) to "PO #PO-20260508-1 L#<uuid>
    // primary" (PG era — embeds the human-readable PO number directly).
    // The regex matches both; resolution branches on whether the PO ref looks
    // like a recXXX (lookup needed) or a PO-NNNNNNNN-N string (use directly).
    let usagePurchases = [];
    try {
      const allPurchases = await stockPurchasesRepo.list({});
      const linePurchases = allPurchases.filter(p => siblingIds.has(p.Flower?.[0]));

      const poMarkerRe = /PO #([A-Za-z0-9_\-]+)\s+L#([A-Za-z0-9_\-]+)\s+(primary|substitute|alt)/;
      const poRefSet = new Set();
      for (const p of linePurchases) {
        const m = p.Notes?.match(poMarkerRe);
        if (m && m[1].startsWith('rec')) poRefSet.add(m[1]);
      }
      const poMap = {};
      if (poRefSet.size > 0) {
        try {
          const poRecs = await stockOrderRepo.listByIds([...poRefSet]);
          for (const po of poRecs) poMap[po.id] = po['Stock Order ID'] || '';
        } catch { /* best effort — fall back to raw Notes */ }
      }

      usagePurchases = linePurchases.map(p => {
        const m = p.Notes?.match(poMarkerRe);
        const poRef = m?.[1] || null;
        const poDisplayId = poRef
          ? (poRef.startsWith('rec') ? (poMap[poRef] || '') : poRef)
          : '';
        const variant = m?.[3] || '';
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
    } catch { /* best effort */ }

    // 4. Active premade bouquet lines — stems physically locked in a premade
    // that hasn't been sold/dissolved yet. These were deducted from qty when
    // the premade was created; the trace must surface them or the arithmetic
    // won't reconcile. Dissolved/consumed premades don't appear (the line
    // record is deleted and the stems either flowed into an order or were
    // returned to stock via a reverse atomicStockAdjust — both of which are
    // already represented in the 'order' and 'purchase' trails respectively).
    let usagePremades = [];
    try {
      const allBouquets = await premadeBouquetRepo.list();
      for (const bouquet of allBouquets) {
        const lines = await premadeBouquetRepo.getLinesByBouquetId(bouquet._pgId);
        for (const l of lines) {
          if (!siblingIds.has(l['Stock Item']?.[0])) continue;
          usagePremades.push({
            type: 'premade',
            date: null,
            quantity: -(Number(l.Quantity) || 0),
            bouquetId: bouquet.id,
            bouquetName: bouquet.Name || '?',
            flowerName: l['Flower Name'] || displayName,
          });
        }
      }
    } catch { /* best effort */ }

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
    // item. Direct FK query via repo — no linked-record formula gymnastics.
    const costChanged = 'Current Cost Price' in safeFields;
    const sellChanged = 'Current Sell Price' in safeFields;
    if (costChanged || sellChanged) {
      try {
        const matchingLines = await premadeBouquetRepo.getLinesByStockId(req.params.id);
        for (const line of matchingLines) {
          const patch = {};
          if (costChanged) patch['Cost Price Per Unit'] = Number(safeFields['Current Cost Price']) || 0;
          if (sellChanged) patch['Sell Price Per Unit'] = Number(safeFields['Current Sell Price']) || 0;
          await premadeBouquetRepo.updateLine(line.id, patch);
        }
      } catch (err) {
        console.error('[STOCK] premade price-sync failed:', err.message);
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

    // Also log to Stock Loss Log table (Postgres) for analytics breakdown
    if (actualWriteOff > 0) {
      const lossReason = (reason === LOSS_REASON.WILTED || reason === LOSS_REASON.DAMAGED || reason === LOSS_REASON.ARRIVED_BROKEN) ? reason : LOSS_REASON.OTHER;

      // Resolve the PG UUID for this stock item — stockRepo.getById returns
      // an Airtable-shaped object with _pgId carrying the Postgres UUID.
      const pgStockId = item._pgId || null;

      stockLossRepo.create({
        date:     new Date().toISOString().split('T')[0],
        stockId:  pgStockId,
        quantity: actualWriteOff,
        reason:   lossReason,
        notes:    reason && reason !== lossReason ? reason : '',
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
    const activeOrders = await orderRepo.list({
      pg: { excludeStatuses: [ORDER_STATUS.DELIVERED, ORDER_STATUS.PICKED_UP, ORDER_STATUS.CANCELLED] },
    }).catch(err => { console.error('[STOCK] substitute-swap orderRepo.list failed:', err.message); return []; });

    const custIds = [...new Set(activeOrders.flatMap(o => o.Customer || []))];
    const custs = custIds.length > 0 ? await customerRepo.findMany(custIds) : [];
    const custMap = {};
    for (const c of custs) {
      custMap[c.id] = c;
      if (c.airtableId) custMap[c.airtableId] = c;
    }

    const orderMap = {};
    for (const o of activeOrders) {
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
    for (const order of activeOrders) {
      for (const line of (order._lines || [])) {
        const stockId = line['Stock Item']?.[0];
        if (!stockId || !originalIdSet.has(stockId)) continue;
        const qty = Number(line.Quantity || 0);
        if (qty <= 0) continue;
        const oi = orderMap[order.id];
        if (!oi) continue;
        if (!linesByOriginal[stockId]) linesByOriginal[stockId] = [];
        linesByOriginal[stockId].push({
          lineId: line.id,
          orderId: order.id,
          appOrderId: oi.appOrderId,
          customerName: oi.customerName,
          requiredBy: oi.requiredBy,
          orderStatus: oi.status,
          quantity: qty,
          suggestedSwapQty: qty,
        });
      }
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
