// createBouquetDemand — single source of truth for adding a NEW DEMAND line to a
// bouquet, used by every order-editing surface that lists stock inline
// (OrderCard, OrderDetailPage, dashboard OrderDetailPanel) plus, conceptually,
// the grouped editors.
//
// Behaviour (confirmed with the owner):
//   - Reuse an existing Variety when one already exists (in stock OR out of
//     stock) so a flower record is NEVER duplicated. When the owner set a price
//     (> 0) it is PATCHed onto that Variety's Demand Entry (the undated row) and
//     used for the line, so the sell price feeds the bouquet total.
//   - A brand-new flower is created at qty 0 carrying its price.
//   - Blank/0 prices leave the reused record's price untouched (the legacy
//     add-at-current-price behaviour) — no accidental overwrite.
//
// Returns { stockItem, line } — `stockItem` is the created/updated record (merge
// it into the caller's stock list so later reads see it); `line` is the ready-to
// append bouquet line (same shape every surface already uses).
//
// Pitfall #9: a brand-new flower must carry a non-null Type — typeName falls back
// to the display name when the caller has no 4-tuple.
import { findAllMatchingVariety } from '../hooks/useOrderEditing.js';
import parseBatchName from './parseBatchName.js';

export async function createBouquetDemand({
  apiClient,
  stockItems = [],
  displayName,
  variety = {},
  costPrice = 0,
  sellPrice = 0,
  quantity = 1,
  supplier,   // optional — only used when creating a brand-new flower
  lotSize,    // optional — only used when creating a brand-new flower
}) {
  const name = (displayName || '').trim();
  if (!name) throw new Error('createBouquetDemand: displayName is required');
  const qty  = Math.max(1, Number(quantity) || 1);
  const cost = Number(costPrice) || 0;
  const sell = Number(sellPrice) || 0;

  const existing = findAllMatchingVariety(stockItems, name);
  if (existing.length) {
    // Prefer the undated Demand Entry; else the first matching row.
    const target = existing.find(s => parseBatchName(s['Display Name'] || '').batch === null) || existing[0];
    let item = target;
    const body = {};
    if (sell > 0) body['Current Sell Price'] = sell;
    if (cost > 0) body['Current Cost Price'] = cost;
    if (Object.keys(body).length) {
      try {
        const res = await apiClient.patch(`/stock/${target.id}`, body);
        item = { ...target, ...res.data };
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

  // Brand-new flower → create the Variety (qty 0) carrying its price.
  const res = await apiClient.post('/stock', {
    displayName: name,
    typeName: (variety.type_name ?? variety.typeName ?? name),
    colour:   variety.colour ?? null,
    sizeCm:   variety.size_cm ?? variety.sizeCm ?? null,
    cultivar: variety.cultivar ?? null,
    costPrice: cost,
    sellPrice: sell,
    quantity: 0,
    ...(supplier != null && String(supplier).trim() !== '' ? { supplier: String(supplier).trim() } : {}),
    ...(Number(lotSize) > 0 ? { lotSize: Number(lotSize) } : {}),
  });
  return {
    stockItem: res.data,
    line: {
      id: null,
      stockItemId: res.data.id,
      flowerName: res.data['Display Name'],
      quantity: qty,
      _originalQty: 0,
      costPricePerUnit: cost,
      sellPricePerUnit: sell,
    },
  };
}
