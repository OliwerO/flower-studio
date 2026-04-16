// Compute which flowers a bouquet save would push into negative stock,
// cross-referenced with the premade-committed map so we can offer to
// dissolve premades that hold stems of each short flower.
//
// Inputs mirror what the bouquet-editor state carries:
//   editLines       - current line edits, each { id?, stockItemId, quantity, _originalQty? }
//   finalRemoved    - removed lines list already merged with partial reductions
//                     (each { stockItemId, quantity, action })
//   stockItems      - current stock records with { id, 'Display Name', 'Current Quantity' }
//   premadeMap      - GET /stock/premade-committed payload
//                     { stockId: { qty, bouquets: [{ bouquetId, name, qty }] } }
//
// Returns an array of shortfalls, one per stock item that would go negative
// AND has at least one premade that could cover part of it:
//   [{ stockId, name, shortage, available, need, bouquets }]

export function computePremadeShortfalls({ editLines, finalRemoved, stockItems, premadeMap }) {
  const netDeduction = {};
  for (const line of editLines) {
    if (!line.stockItemId) continue;
    // New lines deduct their full qty; existing lines only deduct the delta.
    const delta = line.id
      ? (Number(line.quantity) || 0) - (Number(line._originalQty) || 0)
      : (Number(line.quantity) || 0);
    if (delta <= 0) continue;
    netDeduction[line.stockItemId] = (netDeduction[line.stockItemId] || 0) + delta;
  }
  // "return" removals give stems back, offsetting the deduction for that stock.
  // "writeoff" does not — the stems are lost.
  for (const rem of finalRemoved || []) {
    if (rem.action !== 'return' || !rem.stockItemId) continue;
    netDeduction[rem.stockItemId] = (netDeduction[rem.stockItemId] || 0) - (Number(rem.quantity) || 0);
  }

  const shortfalls = [];
  for (const [stockId, deduction] of Object.entries(netDeduction)) {
    if (deduction <= 0) continue;
    const stockItem = (stockItems || []).find(s => s.id === stockId);
    const currentQty = Number(stockItem?.['Current Quantity']) || 0;
    const remaining = currentQty - deduction;
    if (remaining >= 0) continue;
    const bouquets = premadeMap?.[stockId]?.bouquets || [];
    if (bouquets.length === 0) continue;
    shortfalls.push({
      stockId,
      name: stockItem?.['Display Name'] || '?',
      shortage: -remaining,
      available: currentQty,
      need: deduction,
      bouquets,
    });
  }
  return shortfalls;
}
