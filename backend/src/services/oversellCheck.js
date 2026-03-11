// Oversell detection — checks if an order's line items exceed available stock.
// Like a post-checkout quality gate: the sale goes through, but if we promised
// more than we have, the owner gets an immediate alert to manage the situation.

import * as db from './airtable.js';
import { TABLES } from '../config/airtable.js';
import { sendAlert } from './telegram.js';

/**
 * Check order lines against stock for potential overselling.
 * Called after a Wix webhook creates an order.
 *
 * @param {string} orderId - App Order record ID
 * @param {Array} orderLines - Array of order line objects with Stock Item links
 * @param {string} customerName - For the alert message
 * @param {string} customerPhone - For the alert message
 */
export async function checkOversell(orderId, orderLines, customerName, customerPhone) {
  if (!orderLines || orderLines.length === 0) return;

  const warnings = [];

  for (const line of orderLines) {
    // Skip lines without a linked stock item
    const stockLinks = line['Stock Item'];
    if (!stockLinks || !Array.isArray(stockLinks) || stockLinks.length === 0) continue;

    const stockId = stockLinks[0];
    const qty = Number(line['Quantity'] || 0);
    if (qty === 0) continue;

    try {
      const stockItem = await db.getById(TABLES.STOCK, stockId);
      const available = Number(stockItem['Current Quantity'] || 0);
      const itemName = stockItem['Display Name'] || line['Flower Name'] || 'Unknown';

      if (available < qty) {
        warnings.push({
          itemName,
          requested: qty,
          available,
        });
      }
    } catch (err) {
      console.error(`[OVERSELL] Failed to check stock ${stockId}:`, err.message);
    }
  }

  if (warnings.length > 0) {
    const warningLines = warnings.map(w =>
      `- ${w.itemName}: need ${w.requested}, only ${w.available} in stock`
    ).join('\n');

    const message = [
      'OVERSELL ALERT',
      `Order: ${orderId}`,
      `Customer: ${customerName || 'Unknown'}${customerPhone ? ` (${customerPhone})` : ''}`,
      '',
      warningLines,
      '',
      'Please call the customer to discuss alternatives.',
    ].join('\n');

    await sendAlert(message);
    console.warn(`[OVERSELL] Alert sent for order ${orderId}:`, warnings);
  }

  return warnings;
}
