// Stock Order (Purchase Order) business logic — receive-into-stock,
// substitute stock creation, and PO evaluation. Extracted from
// routes/stockOrders.js (W2 slice, behavior-preserving) so the route file
// stays a thin controller and this logic is independently testable.
//
// Every comment below carries incident history from the route file it was
// copied from — do not strip them on future edits.

import * as stockRepo from '../repos/stockRepo.js';
import * as stockLossRepo from '../repos/stockLossRepo.js';
import * as stockPurchasesRepo from '../repos/stockPurchasesRepo.js';
import * as stockOrderRepo from '../repos/stockOrderRepo.js';
import * as orderService from '../services/orderService.js';
import { broadcast } from '../services/notifications.js';
import { sanitizeFormulaValue } from '../utils/sanitize.js';
import { PO_STATUS, PO_LINE_STATUS, LOSS_REASON } from '../constants/statuses.js';
import { getConfig } from '../services/configService.js';

// Resolve a flower name to an Airtable-safe stock item ID.
// Uses stockRepo (Postgres) not Airtable — the stock table is frozen in AT.
// Returns the Airtable recXXX if the item was backfilled, or null for
// PG-only items (no recXXX means passing the UUID to AT's linked field
// would auto-create a ghost record with the UUID as Display Name).
// Auto-creates a Postgres stock card if none found, so the item appears
// in the bouquet picker immediately after the PO is saved.
export async function resolveOrCreateStockItem(flowerName, { costPrice = 0, sellPrice = 0, supplier = '' } = {}) {
  const name = flowerName.trim();
  const matches = await stockRepo.list({
    maxRecords: 1,
    pg: { displayName: name, active: true, includeEmpty: true },
  });
  if (matches.length > 0) {
    return matches[0].id.startsWith('rec') ? matches[0].id : matches[0]._pgId || matches[0].id;
  }
  const newItem = await stockRepo.create({
    'Display Name':       name,
    'Purchase Name':      name,
    'Current Quantity':   0,
    'Current Cost Price': Number(costPrice) || 0,
    'Current Sell Price': Number(sellPrice) || 0,
    Supplier:             supplier || '',
    Category:             'Other',
    Active:               true,
  });
  console.log(`[STOCK-ORDER] Auto-created stock item "${name}" (${newItem.id}) from PO line`);
  return newItem.id.startsWith('rec') ? newItem.id : newItem._pgId || newItem.id;
}

// Idempotency helper — returns true if a STOCK_PURCHASES row with this exact
// notes marker already exists. Caller constructs the marker (see ADR-0003 for
// format). Used on retry after a partial failure to skip double-credit.
async function purchaseAlreadyRecorded(marker) {
  try {
    return await stockPurchasesRepo.noteMarkerExists(marker);
  } catch (e) {
    console.error('[STOCK-ORDER] Idempotency check failed:', e.message);
    return false; // fail-open — better to risk a warning than block a retry
  }
}

// Idempotency helper — returns true if a stock_loss_log row with this exact
// notes marker already exists (ADR-0003 write-off extension). Fail-open on
// error, mirroring purchaseAlreadyRecorded — a check failure should not block
// a retry, it should just risk a re-attempt (which is still safer than a
// crash).
async function writeOffAlreadyRecorded(marker) {
  try {
    return await stockLossRepo.noteMarkerExists(marker);
  } catch (e) {
    console.error('[STOCK-ORDER] Write-off idempotency check failed:', e.message);
    return false; // fail-open — better to risk a duplicate than block a retry
  }
}

// Find an existing Stock record by exact Display Name, or create a new one
// for a substitute flower that doesn't exist in the catalog yet.
//
// Used by the PO evaluation flow when the driver brought a substitute that
// needs to be received into inventory as its own stock item (not merged into
// the original that was ordered). Category, unit, and reorder threshold are
// copied from the originally-ordered stock item so the substitute has
// sensible defaults without requiring the florist to fill a form.
//
// Sell price uses the global targetMarkup setting: sellPrice = costPerStem * markup.
export async function findOrCreateSubstituteStock(altFlowerName, altSupplier, costPerStem, originalStockItem, originalStockId, today, varietyAttrs = null) {
  const trimmedName = (altFlowerName || '').trim();
  if (!trimmedName) {
    throw new Error('Cannot receive substitute with empty flower name');
  }

  // Try to find an existing Stock record with the exact same display name.
  // Sanitize quotes to avoid breaking the Airtable filter formula.
  const safe = sanitizeFormulaValue(trimmedName);
  const existing = await stockRepo.list({
    filterByFormula: `{Display Name} = '${safe}'`,
    pg: { displayName: trimmedName, includeInactive: true, includeEmpty: true },
    maxRecords: 1,
  });
  if (existing.length > 0) {
    const found = existing[0];
    // Phase B: stack multiple originals onto one substitute card. If this
    // substitute was previously created for a different original flower,
    // append the current originalStockId so the reconciliation query can
    // find all affected originals from the substitute side.
    if (originalStockId) {
      const currentLinks = Array.isArray(found['Substitute For']) ? found['Substitute For'] : [];
      if (!currentLinks.includes(originalStockId)) {
        await stockRepo.update(found.id, {
          'Substitute For': [...currentLinks, originalStockId],
        });
      }
    }
    return found.id;
  }

  // Not found → create a brand-new stock card for the substitute.
  // Copy category/unit/threshold from the original item so the substitute
  // inherits sensible defaults. Cost = actual per-stem paid, sell = cost * markup.
  const markup = Number(getConfig('targetMarkup')) || 1;
  const sellPerStem = Math.round(costPerStem * markup * 100) / 100;

  // C13: a substitute is a DIFFERENT flower from the original (free-text Alt
  // Flower Name), so its Variety identity is whatever the florist classified it
  // as during evaluation — NOT the original's attrs (that would mislabel a Peony
  // substitute as the Rose it replaced). Write the captured attrs when present;
  // otherwise leave the card attr-less (legacy behaviour). A classified
  // substitute is then visible in listGroupedByVariety; an unclassified one
  // stays ungrouped until the owner edits it.
  const aSize = Number(varietyAttrs?.Size);
  const created = await stockRepo.create({
    'Display Name':       trimmedName,
    'Purchase Name':      trimmedName,
    Category:             originalStockItem?.Category || 'Other',
    'Current Quantity':   0, // receiveIntoStock will adjust upward
    'Current Cost Price': costPerStem,
    'Current Sell Price': sellPerStem,
    Supplier:             altSupplier || '',
    Unit:                 originalStockItem?.Unit || 'Stems',
    'Reorder Threshold':  originalStockItem?.['Reorder Threshold'] || 0,
    Active:               true,
    'Last Restocked':     today,
    ...(originalStockId ? { 'Substitute For': [originalStockId] } : {}),
    ...(varietyAttrs?.Type     ? { Type:     String(varietyAttrs.Type).trim() }     : {}),
    ...(varietyAttrs?.Colour   ? { Colour:   String(varietyAttrs.Colour).trim() }   : {}),
    ...(Number.isFinite(aSize) && aSize > 0 ? { Size: aSize } : {}),
    ...(varietyAttrs?.Cultivar ? { Cultivar: String(varietyAttrs.Cultivar).trim() } : {}),
  });
  console.log(`[STOCK-ORDER] Created substitute stock card "${trimmedName}" (${created.id}) — cost ${costPerStem} zł, sell ${sellPerStem} zł`);
  return created.id;
}

// Receive accepted flowers into stock as a SEPARATE dated batch.
// Always creates a new Stock record with a date suffix (e.g. "Hydrangea (15.Apr.)")
// so the florist can track when each lot arrived and manage FIFO.
//
// If the original stock record has negative qty (pre-sold demand), the deficit
// is absorbed into the new batch (received - deficit) and the original is
// zeroed out. This way order-line links stay valid and the florist doesn't see
// a confusing negative number next to fresh flowers.
//
// Variety attrs (Type/Colour/Size/Cultivar) flow from the PO line context
// onto the new dated Batch, and backfill the orig Stock Item when it has
// no Variety identity yet (PRD #324 line 150 — issue #327). Without this,
// the new Batch is invisible in /stock?grouped=true (Y-model) and FEFO
// routing cannot compute its Variety key.
//
// Returns the new batch's stock item ID.
const DATE_BATCH_RE = /^(.+?)\s*\(\d{1,2}\.\w{3,4}\.?\)$/;
export async function receiveIntoStock(stockItemId, qty, costPrice, sellPrice, supplier, today, varietyAttrs = null) {
  const stockItem = await stockRepo.getById(stockItemId);
  const existingQty = Number(stockItem['Current Quantity']) || 0;

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const d = new Date(today);
  const batchLabel = `${d.getDate()}.${months[d.getMonth()]}.`;

  // Strip any existing date suffix to avoid "Rose (14.Apr.) (15.Apr.)" names
  const rawName = stockItem['Display Name'] || '';
  const baseName = (rawName.match(DATE_BATCH_RE)?.[1] || rawName).trim();

  // Effective Variety attrs: prefer values passed from the PO line, fall back
  // to whatever the orig Stock Item already carries. The new Batch needs them
  // so Y-model grouping + FEFO routing work; the orig Demand Entry needs them
  // backfilled so it stays visible as the absorption audit marker (ADR-0002).
  const effectiveAttrs = {
    Type:     varietyAttrs?.Type     ?? stockItem['Type']     ?? null,
    Colour:   varietyAttrs?.Colour   ?? stockItem['Colour']   ?? null,
    Size:     varietyAttrs?.Size     ?? stockItem['Size']     ?? null,
    Cultivar: varietyAttrs?.Cultivar ?? stockItem['Cultivar'] ?? null,
  };

  // When the original record has negative qty (pre-sold stems), absorb
  // the deficit into this new batch and zero out the original.
  let batchQty = qty;
  if (existingQty < 0) {
    batchQty = qty + existingQty; // e.g. 25 + (-5) = 20
    if (batchQty < 0) batchQty = 0; // edge: received less than deficit
    await stockRepo.adjustQuantity(stockItemId, -existingQty); // zero it out
  }

  const newBatch = await stockRepo.create({
    'Display Name':       `${baseName} (${batchLabel})`,
    'Purchase Name':      stockItem['Purchase Name'] || baseName,
    Category:             stockItem.Category || 'Other',
    'Current Quantity':   batchQty,
    'Current Cost Price': costPrice || stockItem['Current Cost Price'] || 0,
    'Current Sell Price': sellPrice || stockItem['Current Sell Price'] || 0,
    Supplier:             supplier || stockItem.Supplier || '',
    Unit:                 stockItem.Unit || 'Stems',
    'Reorder Threshold':  stockItem['Reorder Threshold'] || 0,
    Active:               true,
    'Last Restocked':     today,
    Type:                 effectiveAttrs.Type,
    Colour:               effectiveAttrs.Colour,
    Size:                 effectiveAttrs.Size,
    Cultivar:             effectiveAttrs.Cultivar,
  });

  // Update prices on the original record too so the "template" stays current.
  // Backfill Variety attrs onto orig when it currently has none and the PO
  // line supplied them — restores the orig DE as a visible audit marker.
  const templateUpdate = {
    'Current Cost Price': costPrice || stockItem['Current Cost Price'],
    'Current Sell Price': sellPrice || stockItem['Current Sell Price'],
    'Last Restocked':     today,
  };
  const origHasNoVarietyAttrs =
    stockItem['Type']     == null &&
    stockItem['Colour']   == null &&
    stockItem['Size']     == null &&
    stockItem['Cultivar'] == null;
  const lineCarriesAttrs =
    varietyAttrs &&
    (varietyAttrs.Type != null || varietyAttrs.Colour != null ||
     varietyAttrs.Size != null || varietyAttrs.Cultivar != null);
  if (origHasNoVarietyAttrs && lineCarriesAttrs) {
    templateUpdate.Type     = effectiveAttrs.Type;
    templateUpdate.Colour   = effectiveAttrs.Colour;
    templateUpdate.Size     = effectiveAttrs.Size;
    templateUpdate.Cultivar = effectiveAttrs.Cultivar;
    console.log(`[STOCK-ORDER] Backfilled Variety attrs on orig "${stockItem['Display Name']}" (${stockItemId})`);
  }
  await stockRepo.update(stockItemId, templateUpdate);

  return newBatch.id;
}

// Evaluate a Purchase Order — florist submits quality evaluation for each
// line: adjust stock, create purchase record, log write-offs.
//
// lines: [{ lineId, quantityAccepted, writeOffQty, writeOffReason,
//           altQuantityAccepted, altWriteOffQty, altWriteOffReason,
//           altType, altColour, altSize, altCultivar }]
//
// Returns a domain result the route maps to HTTP:
//   { outcome: 'conflict', status }               → 409, PO not in Evaluating/Eval Error
//   { outcome: 'partial', message, lineResults }   → 207, some lines failed
//   { outcome: 'complete', lineResults }           → 200, all lines processed
export async function evaluatePurchaseOrder(poId, lines) {
  // H1: Guard against double-evaluate — allow Evaluating (first attempt) or Eval Error (retry)
  const po = await stockOrderRepo.getById(poId);
  if (po.Status !== PO_STATUS.EVALUATING && po.Status !== PO_STATUS.EVAL_ERROR) {
    return { outcome: 'conflict', status: po.Status };
  }

  // poDisplayId is the human-readable PO number (PO-YYYYMMDD-N) — embedded
  // in the stock_purchases.notes idempotency marker per ADR-0003.
  const poDisplayId = po['Stock Order ID'] || po.id;

  // On first attempt use today's date. On Eval Error retry, reuse the date
  // from lines already processed in the first attempt so all stock entries
  // for this PO share the same receive date (the day flowers actually arrived).
  let evalDate = new Date().toISOString().split('T')[0];
  if (po.Status === PO_STATUS.EVAL_ERROR) {
    try {
      const prevDate = await stockPurchasesRepo.findDateByPoMarker(poDisplayId);
      if (prevDate) evalDate = prevDate;
    } catch { /* fall back to today */ }
  }
  const lineResults = []; // track per-line outcome for partial failure recovery

  for (const evalLine of (lines || [])) {
    try {
      const line = await stockOrderRepo.getLineById(evalLine.lineId);

      // Skip lines already processed on a previous attempt (idempotency guard)
      if (line['Eval Status'] === PO_LINE_STATUS.PROCESSED) {
        lineResults.push({ lineId: evalLine.lineId, status: 'skipped' });
        continue;
      }

      let stockItemId = line['Stock Item']?.[0];
      const costPrice = Number(line['Cost Price']) || 0;
      const sellPrice = Number(line['Sell Price']) || 0;
      const supplier = line.Supplier || '';

      let accepted = Number(evalLine.quantityAccepted) || 0;
      let writeOff = Number(evalLine.writeOffQty) || 0;

      // Double-book guard (prod incident 2026-07-06, PO-20260705-1).
      // Driver Status "Not Found" means NONE of the ORIGINAL flower arrived —
      // it was replaced by a substitute. The original must therefore never be
      // received into stock, no matter what quantityAccepted the UI submits
      // (the shopping screen could leave a stale Quantity Found on the line).
      // If some of the original DID arrive it should be "Partial", not
      // "Not Found". This is the authoritative server-side invariant; the
      // florist UI mirrors it but the guard here is what makes the phantom
      // structurally impossible. The substitute (alt*) is unaffected.
      if (line['Driver Status'] === 'Not Found' && (accepted > 0 || writeOff > 0)) {
        console.log(
          `[STOCK-ORDER] Line ${evalLine.lineId} is "Not Found" — skipping primary receive ` +
          `of ${accepted} (original "${line['Flower Name'] || ''}" was substituted, not delivered)`,
        );
        accepted = 0;
        writeOff = 0;
      }
      // Found = what was actually bought/paid for at market (Owner-entered
      // during Reviewing). This is the money-spend basis — the supplier
      // bills for it regardless of later write-off. Falls back to
      // accepted+writeOff if Quantity Found was never entered (legacy PO
      // rows created before the Reviewing step existed).
      const found = Number(line['Quantity Found']) || (accepted + writeOff);
      const altAcceptedPre = Number(evalLine.altQuantityAccepted) || 0;
      const altWriteOffPre = Number(evalLine.altWriteOffQty) || 0;

      // If the line carries a stale Airtable rec ID that was never backfilled
      // to PG, treat it as unlinked so auto-resolve can pick it up by name.
      if (stockItemId) {
        const exists = await stockRepo.getById(stockItemId).catch(() => null);
        if (!exists) {
          console.log(`[STOCK-ORDER] Stock item ${stockItemId} not found in PG — falling back to name resolution for "${line['Flower Name']}"`);
          stockItemId = null;
        }
      }

      // Variety attrs (4-tuple, ADR-0006) extracted once at the line scope —
      // used by the auto-resolve block AND threaded into receiveIntoStock so
      // the new dated Batch carries Variety identity (#327 / PRD #324 line 150).
      const flowerName   = String(line['Flower Name'] || '').trim();
      const lineType     = line['Type']    ? String(line['Type']).trim()    : null;
      const lineColour   = line['Colour']  ? String(line['Colour']).trim()  : null;
      const lineSizeCm   = line['Size'] != null && Number.isFinite(Number(line['Size'])) ? Number(line['Size']) : null;
      const lineCultivar = line['Cultivar'] ? String(line['Cultivar']).trim() : null;
      const lineVarietyAttrs = { Type: lineType, Colour: lineColour, Size: lineSizeCm, Cultivar: lineCultivar };

      // Auto-resolve: if PO line has no Stock Item, find or create one.
      // Y-model lines carry Variety attrs — use the 4-tuple for exact matching
      // before falling back to name.
      if (!stockItemId && (accepted > 0 || writeOff > 0)) {
        if (!flowerName && !lineType) {
          throw new Error(
            `Line "${evalLine.lineId}" has no Stock Item, no Flower Name, and no Variety attrs — cannot resolve.`,
          );
        }

        const markup = Number(getConfig('targetMarkup')) || 1;
        const autoSell = sellPrice || Math.round(costPrice * markup * 100) / 100;

        if (lineType) {
          // Y-model path: resolve by exact Variety 4-tuple.
          const matches = await stockRepo.list({
            pg: { typeName: lineType, colour: lineColour, sizeCm: lineSizeCm, cultivar: lineCultivar, includeEmpty: true },
            maxRecords: 1,
          });
          if (matches.length > 0) {
            stockItemId = matches[0].id;
            await stockOrderRepo.updateLine(evalLine.lineId, { 'Stock Item': [stockItemId] });
            console.log(`[STOCK-ORDER] Auto-linked Y-model variety "${lineType}" → stock item ${stockItemId}`);
          } else {
            const parts = [lineType];
            if (lineColour)  parts.push(lineColour);
            if (lineSizeCm != null) parts.push(`${lineSizeCm}cm`);
            if (lineCultivar) parts.push(lineCultivar);
            const displayName = flowerName || parts.join(' ');
            const created = await stockRepo.create({
              'Display Name':       displayName,
              'Purchase Name':      displayName,
              Type:                 lineType,
              Colour:               lineColour,
              Size:                 lineSizeCm,
              Cultivar:             lineCultivar,
              Category:             'Other',
              'Current Quantity':   0,
              'Current Cost Price': costPrice,
              'Current Sell Price': autoSell,
              Supplier:             supplier,
              Unit:                 'Stems',
              Active:               true,
            });
            stockItemId = created.id;
            await stockOrderRepo.updateLine(evalLine.lineId, { 'Stock Item': [stockItemId] });
            console.log(`[STOCK-ORDER] Created Y-model stock item for variety "${lineType}" (${stockItemId})`);
          }
        } else {
          // Legacy path: resolve by Flower Name.
          const matches = await stockRepo.list({
            pg: { displayName: flowerName, includeEmpty: true },
            maxRecords: 1,
          });
          if (matches.length > 0) {
            stockItemId = matches[0].id;
            await stockOrderRepo.updateLine(evalLine.lineId, { 'Stock Item': [stockItemId] });
            console.log(`[STOCK-ORDER] Auto-linked "${flowerName}" → stock item ${stockItemId}`);
          } else {
            const created = await stockRepo.create({
              'Display Name':       flowerName,
              'Purchase Name':      flowerName,
              Category:             'Other',
              'Current Quantity':   0,
              'Current Cost Price': costPrice,
              'Current Sell Price': autoSell,
              Supplier:             supplier,
              Unit:                 'Stems',
              Active:               true,
            });
            stockItemId = created.id;
            await stockOrderRepo.updateLine(evalLine.lineId, { 'Stock Item': [stockItemId] });
            console.log(`[STOCK-ORDER] Created & linked stock item for "${flowerName}" (${stockItemId})`);
          }
        }
      }

      // Substitute quantities without a stock item require at least an Alt
      // Flower Name so we know what substitute stock card to create.
      if (!stockItemId && (altAcceptedPre > 0 || altWriteOffPre > 0) && !line['Alt Flower Name']) {
        throw new Error(
          `Line "${line['Flower Name'] || evalLine.lineId}" has no linked Stock Item and no Alt Flower Name — ` +
          `link a Stock Item or add substitute details, then retry.`,
        );
      }

      // Primary receive — idempotency marker uses the human-readable PO
      // number per ADR-0003. line._pgId is the canonical UUID; fall back to
      // evalLine.lineId (recXXX or uuid) when _pgId isn't surfaced.
      if (stockItemId && accepted > 0) {
        const primaryMarker = `PO #${poDisplayId} L#${line._pgId || evalLine.lineId} primary`;
        const already = await purchaseAlreadyRecorded(primaryMarker);
        if (!already) {
          const finalItemId = await receiveIntoStock(stockItemId, accepted, costPrice, sellPrice, supplier, evalDate, lineVarietyAttrs);
          const batchItem = await stockRepo.getById(finalItemId).catch(() => null);
          await stockPurchasesRepo.create({
            purchaseDate:      evalDate,
            supplier,
            stockId:           batchItem?._pgId || null,
            stockAirtableId:   typeof finalItemId === 'string' && finalItemId.startsWith('rec') ? finalItemId : null,
            quantityPurchased: found,
            quantityAccepted:  accepted,
            pricePerUnit:      costPrice,
            notes:             primaryMarker,
          });
        } else {
          console.log(`[STOCK-ORDER] Skipping primary receive for line ${evalLine.lineId} — already recorded`);
        }
      }

      // Substitute supplier: Substitute becomes its own stock card (Phase A
      // substitution policy). Find-or-create a Stock record by exact Alt
      // Flower Name, receive the accepted qty there at the REAL per-stem
      // cost the driver paid (not the original planned cost). Sell price
      // derives from targetMarkup. Skip entirely if florist accepted 0 of
      // the Substitute (edge case 6).
      const altAccepted = Number(evalLine.altQuantityAccepted) || 0;
      const altWriteOff = Number(evalLine.altWriteOffQty) || 0;
      const altSupplier = line['Alt Supplier'] || '';
      const altFlowerName = line['Alt Flower Name'] || '';
      // C13 + #2: Variety attrs for the substitute. A substitute is its OWN flower
      // — NOT the original line's attrs. Prefer the florist's eval-time value, then
      // fall back to what the owner classified at shopping entry (persisted on the
      // line as 'Alt Type' etc). Threaded onto the new substitute card + its dated
      // Batch so a classified substitute is visible in the grouped Y-model view.
      const altType     = (evalLine.altType     ? String(evalLine.altType).trim()     : '') || (line['Alt Type']   || null);
      const altColour   = (evalLine.altColour   ? String(evalLine.altColour).trim()   : '') || (line['Alt Colour'] || null);
      const altSizeRaw  = evalLine.altSize != null ? evalLine.altSize : line['Alt Size'];
      const altSizeCm   = altSizeRaw != null && Number.isFinite(Number(altSizeRaw)) && Number(altSizeRaw) > 0 ? Number(altSizeRaw) : null;
      const altCultivar = (evalLine.altCultivar ? String(evalLine.altCultivar).trim() : '') || (line['Alt Cultivar'] || null);
      const altVarietyAttrs = { Type: altType, Colour: altColour, Size: altSizeCm, Cultivar: altCultivar };
      const altQtyFound = Number(line['Alt Quantity Found']) || 0;
      const altCostTotal = Number(line['Alt Cost']) || 0;
      // Per-stem cost = total paid / total delivered (not / accepted —
      // the sunk cost covers all stems whether we keep them or write off).
      const altCostPerStem = altQtyFound > 0 ? (altCostTotal / altQtyFound) : 0;

      let substituteStockId = null;
      if (altAccepted > 0 && altFlowerName) {
        const altMarker = `PO #${poDisplayId} L#${line._pgId || evalLine.lineId} alt`;
        const alreadyAlt = await purchaseAlreadyRecorded(altMarker);
        if (!alreadyAlt) {
          // Fetch the originally-ordered stock item once so the helper can
          // copy Category/Unit/Reorder Threshold as defaults. If the PO
          // line has no Stock Item link (e.g. new flower not yet in stock),
          // pass null — the helper uses sensible defaults.
          const originalStockItem = stockItemId
            ? await stockRepo.getById(stockItemId).catch(() => null)
            : null;
          substituteStockId = await findOrCreateSubstituteStock(
            altFlowerName, altSupplier, altCostPerStem, originalStockItem, stockItemId, evalDate, altVarietyAttrs,
          );
          const markup = Number(getConfig('targetMarkup')) || 1;
          const altSellPerStem = Math.round(altCostPerStem * markup * 100) / 100;
          const altFinalId = await receiveIntoStock(
            substituteStockId, altAccepted, altCostPerStem, altSellPerStem, altSupplier, evalDate, altVarietyAttrs,
          );
          substituteStockId = altFinalId; // may be a new batch id

          const altBatchItem = await stockRepo.getById(altFinalId).catch(() => null);
          await stockPurchasesRepo.create({
            purchaseDate:      evalDate,
            supplier:          altSupplier,
            stockId:           altBatchItem?._pgId || null,
            stockAirtableId:   typeof altFinalId === 'string' && altFinalId.startsWith('rec') ? altFinalId : null,
            quantityPurchased: altQtyFound,
            quantityAccepted:  altAccepted,
            pricePerUnit:      altCostPerStem,
            notes:             `${altMarker} - substitute for "${line['Flower Name'] || ''}"`,
          });
        } else {
          console.log(`[STOCK-ORDER] Skipping alt receive for line ${evalLine.lineId} — already recorded`);
        }
      }

      // Log write-offs per source (primary vs Substitute) via Postgres repo.
      // Primary write-offs land on the original stock item. Substitute
      // write-offs land on the substitute card (or on the original if we
      // never created a substitute because accepted = 0).
      //
      // ADR-0003 write-off extension: awaited + marker-gated, same idempotency
      // convention as receives. Placed BEFORE the "mark line PROCESSED" write
      // and INSIDE this line's try/catch, so a write-off failure now marks the
      // line 'error' → PO → Eval Error → retry re-attempts it. Previously this
      // was a fire-and-forget promise with no marker — a retry after partial
      // failure duplicated stock_loss_log rows, and a failure was silently
      // swallowed (console.error only, line still marked PROCESSED).
      if (stockItemId && writeOff > 0) {
        const reason = evalLine.writeOffReason || LOSS_REASON.DAMAGED;
        const primaryWriteOffMarker = `PO #${poDisplayId} L#${line._pgId || evalLine.lineId} primary writeoff`;
        const alreadyWrittenOff = await writeOffAlreadyRecorded(primaryWriteOffMarker);
        if (!alreadyWrittenOff) {
          const item = await stockRepo.getById(stockItemId);
          await stockLossRepo.create({
            date:     evalDate,
            stockId:  item._pgId || null,
            quantity: writeOff,
            reason:   [LOSS_REASON.WILTED, LOSS_REASON.DAMAGED, LOSS_REASON.ARRIVED_BROKEN].includes(reason) ? reason : LOSS_REASON.OTHER,
            notes:    `PO evaluation write-off (primary) — ${primaryWriteOffMarker}`,
          });
        } else {
          console.log(`[STOCK-ORDER] Skipping primary write-off for line ${evalLine.lineId} — already recorded`);
        }
      }
      if (altWriteOff > 0) {
        const altReason = evalLine.altWriteOffReason || LOSS_REASON.DAMAGED;
        // Prefer substitute card if one was created this session; otherwise
        // fall back to the original (rare — means altAccepted was 0 but
        // altWriteOff > 0, which only happens if the florist rejected everything).
        const writeOffTarget = substituteStockId || stockItemId;
        if (writeOffTarget) {
          const altWriteOffMarker = `PO #${poDisplayId} L#${line._pgId || evalLine.lineId} alt writeoff`;
          const alreadyAltWrittenOff = await writeOffAlreadyRecorded(altWriteOffMarker);
          if (!alreadyAltWrittenOff) {
            const item = await stockRepo.getById(writeOffTarget);
            await stockLossRepo.create({
              date:     evalDate,
              stockId:  item._pgId || null,
              quantity: altWriteOff,
              reason:   [LOSS_REASON.WILTED, LOSS_REASON.DAMAGED, LOSS_REASON.ARRIVED_BROKEN].includes(altReason) ? altReason : LOSS_REASON.OTHER,
              notes:    `PO evaluation write-off (substitute) — ${altWriteOffMarker}`,
            });
          } else {
            console.log(`[STOCK-ORDER] Skipping alt write-off for line ${evalLine.lineId} — already recorded`);
          }
        }
      }

      // Mark line as fully processed + save acceptance data (single write)
      await stockOrderRepo.updateLine(evalLine.lineId, {
        'Quantity Accepted': accepted,
        'Write Off Qty':     writeOff,
        'Eval Status':       PO_LINE_STATUS.PROCESSED,
      });

      lineResults.push({
        lineId:             evalLine.lineId,
        status:             'ok',
        substituteStockId:  substituteStockId || null,
        originalStockId:    stockItemId || null,
        originalFlowerName: line['Flower Name'] || '',
        receivedQty:        altAccepted || 0,
      });
    } catch (lineErr) {
      console.error(`[STOCK-ORDER] Evaluate line ${evalLine.lineId} failed:`, lineErr.message);
      lineResults.push({ lineId: evalLine.lineId, status: 'error', error: lineErr.message });
    }
  }

  const failed = lineResults.filter(r => r.status === 'error');
  if (failed.length > 0) {
    // Partial failure: mark PO with error state so owner can see and retry
    await stockOrderRepo.update(poId, { Status: PO_STATUS.EVAL_ERROR });
    return {
      outcome: 'partial',
      message: `${failed.length} of ${lineResults.length} lines failed. PO marked as "Eval Error" — retry will skip already-processed lines.`,
      lineResults,
    };
  }

  // All lines processed — mark PO as complete
  await stockOrderRepo.update(poId, { Status: PO_STATUS.COMPLETE });

  // Phase B: detect orders needing reconciliation after Substitution.
  // Delegated to orderService.findOrdersNeedingSubstitution (extracted in T5;
  // queries Postgres via orderRepo + customerRepo). Non-blocking — a failure
  // here must not affect the evaluate response.
  const substitutionsMade = lineResults
    .filter(r => r.status === 'ok' && r.substituteStockId && r.originalStockId)
    .map(r => ({
      originalStockId:    r.originalStockId,
      originalFlowerName: r.originalFlowerName,
      substituteStockId:  r.substituteStockId,
      receivedQty:        r.receivedQty,
    }));

  if (substitutionsMade.length > 0) {
    try {
      const enriched = await orderService.findOrdersNeedingSubstitution(substitutionsMade);
      for (const sub of enriched) {
        if (sub.affectedOrders.length > 0) {
          broadcast({
            type:               'substitute_reconciliation_needed',
            originalStockId:    sub.originalStockId,
            originalFlowerName: sub.originalFlowerName,
            substituteStockId:  sub.substituteStockId,
            affectedOrders:     sub.affectedOrders,
            substituteQty:      sub.receivedQty,
          });
        }
      }
    } catch (reconErr) {
      console.error('[STOCK-ORDER] Reconciliation detection failed (non-blocking):', reconErr.message);
    }
  }

  return { outcome: 'complete', lineResults };
}

// Exported for integration tests only. The receiveIntoStock helper is the
// seam where #327 (PRD #324 line 150) Variety attrs propagation is enforced.
// Direct callers exercise it via POST /stock-orders/:id/evaluate;
// tests assert its behaviour by calling this seam directly against pglite.
export const __testing = { receiveIntoStock, findOrCreateSubstituteStock };
