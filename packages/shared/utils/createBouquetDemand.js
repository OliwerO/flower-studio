// createBouquetDemand — single source of truth for creating or deepening a
// flower DEMAND (with a price) on a bouquet line. Every order-editing surface
// that adds a flower to a bouquet funnels through here: the inline editors
// (florist OrderCard + OrderDetailPage, dashboard OrderDetailPanel), the
// grouped editors via `useOrderEditing.addNewFlower`/`createDemandEntry`
// (BouquetEditor / BouquetSection), and the NewOrder wizards' Step2Bouquet
// (florist + dashboard).
//
// Behaviour (confirmed with the owner; Y-model per ADR-0005/0006):
//   - Reuse an existing Variety's UNDATED Demand Entry when one exists (the
//     Y-model's aggregate-demand row) — in stock OR out of stock — so a flower
//     record is NEVER duplicated. When the owner set a price (> 0) it is
//     PATCHed onto that Demand Entry and used for the line, so the sell price
//     feeds the bouquet total. Blank/0 prices leave the record's price
//     untouched (the legacy add-at-current-price behaviour).
//   - When a Variety exists but has NO undated Demand Entry (only dated
//     Batches), create a fresh undated Demand Entry (qty 0) rather than
//     patching a Batch's price — a Batch is a dated, physical receipt; the
//     Demand Entry is the Y-model's undated aggregate-demand row. Its price
//     inherits from the most-recently-restocked Batch when the entered price
//     is blank/0.
//   - A brand-new flower (Variety doesn't exist at all) is created at qty 0
//     carrying its price (inherits nothing — there's no Batch to inherit from).
//   - lotSize is included in the POST only when `Number(lotSize) > 0`; omitted
//     otherwise (the backend defaults it).
//
// Two calling conventions for the flower's name + Variety 4-tuple attrs:
//   - displayName + variety ({type_name, colour, size_cm, cultivar}) — the
//     inline-editor convention. typeName ALWAYS falls back to the display
//     name so a brand-new flower never carries a null Type (pitfall #9);
//     colour/sizeCm/cultivar default to null when absent.
//   - varietyDraft — the useOrderEditing convention (pre-consolidation
//     call sites; kept for back-compat): a plain string (no 4-tuple info at
//     all — the POST omits typeName/colour/sizeCm/cultivar entirely), or an
//     object `{ baseName?, type_name?, colour?, size_cm?, cultivar? }` (only
//     the 4-tuple keys actually present on the draft are sent — no fallback
//     defaulting, so a caller that only knows the Type sends only the Type).
//     displayName is taken from `baseName` when given, else auto-computed via
//     `varietyDisplayName`.
//
// Returns { stockItem, line } — `stockItem` is the created/updated record
// (merge it into the caller's stock list so later reads see it); `line` is
// the ready-to-append bouquet line (same shape every surface already uses).
//
// Pitfall #9: a brand-new flower must carry a non-null Type — typeName falls
// back to the display name when the caller uses the `variety` convention.
import { findAllMatchingVariety } from './varietyLookup.js';
import parseBatchName from './parseBatchName.js';
import { varietyDisplayName } from './varietyKey.js';

export async function createBouquetDemand({
  apiClient,
  stockItems = [],
  displayName,
  variety = {},
  varietyDraft,
  costPrice = 0,
  sellPrice = 0,
  quantity = 1,
  supplier,   // optional — only used when creating a brand-new Demand Entry
  lotSize,    // optional — only used when creating a brand-new Demand Entry; sent only when > 0
}) {
  // ── Resolve the flower name + how to build the Variety 4-tuple on create ──
  let name;
  let tupleMode; // 'fallback' | 'presence' | 'none'
  let tupleFields = null;

  if (varietyDraft !== undefined) {
    if (typeof varietyDraft === 'string') {
      name = varietyDraft.trim();
      tupleMode = 'none';
    } else {
      const { baseName, type_name, colour, size_cm, cultivar } = varietyDraft;
      name = (baseName || varietyDisplayName({ type_name, colour, size_cm, cultivar }) || '').trim();
      tupleMode = 'presence';
      tupleFields = { type_name, colour, size_cm, cultivar };
    }
  } else {
    name = (displayName || '').trim();
    tupleMode = 'fallback';
  }
  if (!name) throw new Error('createBouquetDemand: displayName is required');

  const qty  = Math.max(1, Number(quantity) || 1);
  const cost = Number(costPrice) || 0;
  const sell = Number(sellPrice) || 0;

  const existing = findAllMatchingVariety(stockItems, name);
  const demandEntry = existing.find(s => parseBatchName(s['Display Name'] || '').batch === null);

  if (demandEntry) {
    // Reuse the undated Demand Entry — the Y-model's aggregate-demand row
    // (ADR-0005/0006). Never patch a dated Batch's price.
    let item = demandEntry;
    const body = {};
    if (sell > 0) body['Current Sell Price'] = sell;
    if (cost > 0) body['Current Cost Price'] = cost;
    if (Object.keys(body).length) {
      try {
        const res = await apiClient.patch(`/stock/${demandEntry.id}`, body);
        item = { ...demandEntry, ...res.data };
      } catch {
        // Persist failed — still add the line at the entered price so the
        // bouquet total is right; the record keeps its old price.
      }
    }
    return {
      stockItem: item,
      line: {
        id: null,
        stockItemId: item.id,
        flowerName: item['Display Name'],
        quantity: qty,
        _originalQty: 0,
        costPricePerUnit: cost > 0 ? cost : (Number(item['Current Cost Price']) || 0),
        sellPricePerUnit: sell > 0 ? sell : (Number(item['Current Sell Price']) || 0),
      },
    };
  }

  // No undated Demand Entry — either the Variety doesn't exist at all, or it
  // has only dated Batches. Either way, create a fresh undated Demand Entry
  // (qty 0); when dated Batches exist, inherit price from the most-recently-
  // restocked one (blank/0 entered price only — never patch the Batch itself).
  const batches = existing.filter(s => parseBatchName(s['Display Name'] || '').batch !== null);
  const mostRecentBatch = batches.reduce((best, s) => {
    if (!best) return s;
    const d = new Date(s['Last Restocked'] || 0);
    return d > new Date(best['Last Restocked'] || 0) ? s : best;
  }, null);
  const finalCost = cost > 0 ? cost : (Number(mostRecentBatch?.['Current Cost Price']) || 0);
  const finalSell = sell > 0 ? sell : (Number(mostRecentBatch?.['Current Sell Price']) || 0);

  const postBody = {
    displayName: name,
    quantity: 0,
    costPrice: finalCost,
    sellPrice: finalSell,
  };

  if (tupleMode === 'fallback') {
    // Pitfall #9: typeName always carries a value (falls back to the display
    // name) so a brand-new flower never lands with a null Type.
    postBody.typeName = variety.type_name ?? variety.typeName ?? name;
    postBody.colour   = variety.colour ?? null;
    postBody.sizeCm   = variety.size_cm ?? variety.sizeCm ?? null;
    postBody.cultivar = variety.cultivar ?? null;
  } else if (tupleMode === 'presence') {
    const { type_name, colour, size_cm, cultivar } = tupleFields;
    if (type_name !== undefined) postBody.typeName = type_name;
    if (colour    !== undefined) postBody.colour   = colour;
    if (size_cm   !== undefined) postBody.sizeCm   = size_cm;
    if (cultivar  !== undefined) postBody.cultivar = cultivar;
  }
  // tupleMode === 'none' → omit the 4-tuple entirely (varietyDraft string, back-compat).

  if (supplier != null && String(supplier).trim() !== '') postBody.supplier = String(supplier).trim();
  if (Number(lotSize) > 0) postBody.lotSize = Number(lotSize);

  const res = await apiClient.post('/stock', postBody);
  return {
    stockItem: res.data,
    line: {
      id: null,
      stockItemId: res.data.id,
      flowerName: res.data['Display Name'],
      quantity: qty,
      _originalQty: 0,
      costPricePerUnit: finalCost,
      sellPricePerUnit: finalSell,
    },
  };
}
