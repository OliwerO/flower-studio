// Wix webhook order processor — converts a Wix eCommerce payload into
// our internal order structure. Like an EDI translator between a supplier's
// system and your ERP: parse their format, map to your fields, create records.
//
// Webhook bodies from Wix are often partial or event-shaped. We rely on the
// authoritative order data by fetching /ecom/v1/orders/:id from Wix right
// after receiving the webhook — that's the canonical shape we parse against.

import * as db from './airtable.js';
import { TABLES } from '../config/airtable.js';
import { sanitizeFormulaValue } from '../utils/sanitize.js';
import { broadcast } from './notifications.js';
import { notifyNewOrder } from './telegram.js';
import { logWebhookEvent } from './webhookLog.js';
import { generateOrderId } from '../routes/settings.js';
import { DELIVERY_STATUS } from '../constants/statuses.js';

const WIX_API_URL = 'https://www.wixapis.com';

function wixHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': process.env.WIX_API_KEY || '',
    'wix-site-id': process.env.WIX_SITE_ID || '',
  };
}

/**
 * Fetch the canonical order from Wix eCommerce v3 API.
 * Returns the unwrapped order object (not { order: { ... } }).
 * Returns null if credentials missing, endpoint 404, or network error —
 * callers fall back to parsing the webhook payload.
 */
async function fetchWixOrderById(orderId) {
  if (!process.env.WIX_API_KEY || !process.env.WIX_SITE_ID) {
    console.warn('[WIX-API] Credentials missing — cannot fetch canonical order');
    return null;
  }
  try {
    const res = await fetch(
      `${WIX_API_URL}/ecom/v1/orders/${encodeURIComponent(orderId)}`,
      { method: 'GET', headers: wixHeaders() },
    );
    if (!res.ok) {
      console.warn(`[WIX-API] GET orders/${orderId} → ${res.status}`);
      return null;
    }
    const body = await res.json();
    return body?.order || body || null;
  } catch (err) {
    console.error(`[WIX-API] GET orders/${orderId} error:`, err.message);
    return null;
  }
}

// Wix eCommerce v3 stores prices as { amount: "195.00", formattedAmount: ... }
// where amount is a decimal STRING. Always parse defensively.
function moneyAmount(m) {
  if (!m) return 0;
  const raw = typeof m === 'string' ? m : m.amount;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

// Wix v3 localizable strings are { original, translated }. Some older
// payloads still send plain strings. Prefer the original (not translated),
// since the original is what the buyer saw at checkout.
function localizedText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  return v.original || v.translated || '';
}

/**
 * Process a Wix order payload asynchronously.
 * Called fire-and-forget after the webhook returns 200.
 *
 * Pipeline:
 * 1. Extract order ID from the webhook payload
 * 2. Dedup by Wix Order ID
 * 3. Fetch canonical order from Wix API (fall back to webhook payload)
 * 4. Match/create customer
 * 5. Create App Order + Order Lines + Delivery
 */
export async function processWixOrder(payload) {
  const log = (step, msg) => console.log(`[WIX] ${step}: ${msg}`);

  try {
    // 1. Extract the order ID from the webhook payload. Shape varies
    //    (Automations vs native Webhooks vs test tools), so try several.
    const webhookOrder = payload?.data?.order || payload?.data || payload?.order || payload || {};
    const wixOrderId = webhookOrder?.id || webhookOrder?.orderId || webhookOrder?.number?.toString() || webhookOrder?.cartId || '';

    if (!wixOrderId) {
      log('SKIP', 'No Wix Order ID found in payload');
      return;
    }
    log('1-PARSE', `Wix Order ID: ${wixOrderId}`);

    // 2. Dedup — check if we already processed this order
    const existing = await db.list(TABLES.ORDERS, {
      filterByFormula: `{Wix Order ID} = '${sanitizeFormulaValue(wixOrderId)}'`,
      maxRecords: 1,
    });
    if (existing.length > 0) {
      log('2-DEDUP', `Already exists as ${existing[0].id} — skipping`);
      await logWebhookEvent({ status: 'Duplicate', wixOrderId, appOrderId: existing[0].id });
      return;
    }
    log('2-DEDUP', 'New order — processing');

    // 3. Fetch the canonical order from Wix. This is the source of truth —
    //    webhooks often send partial/event-shaped bodies. If the fetch fails,
    //    we fall back to the webhook payload (best-effort).
    const canonical = await fetchWixOrderById(wixOrderId);
    const wixOrder = canonical || webhookOrder;
    if (canonical) {
      log('3-FETCH', `Canonical order loaded (number: ${wixOrder.number || '?'})`);
    } else {
      log('3-FETCH', 'Canonical fetch failed — parsing webhook payload instead');
    }

    // 4. Extract customer info. v3 shape:
    //    buyerInfo: { contactId, email, visitorId }       — no name/phone here
    //    shippingInfo.shipmentDetails.address.contactDetails: { firstName, lastName, phone }
    //    billingInfo.contactDetails: { firstName, lastName, phone }
    const buyer = wixOrder.buyerInfo || wixOrder.buyer || {};
    const shipping = wixOrder.shippingInfo || wixOrder.shipping || {};
    const shippingAddress = shipping.shipmentDetails?.address
      || shipping.destination?.address
      || shipping.address
      || null;
    const shippingContact = shippingAddress?.contactDetails
      || shipping.shipmentDetails?.address?.contactDetails
      || shipping.destination?.contactDetails
      || shipping.contact
      || {};
    const billingContact = wixOrder.billingInfo?.contactDetails
      || wixOrder.billingInfo?.address?.contactDetails
      || {};

    // Prefer shipping contact (that's the recipient + buyer for delivery orders).
    // Billing as fallback. Buyer's email is on buyerInfo directly.
    const firstName = shippingContact.firstName || billingContact.firstName || '';
    const lastName  = shippingContact.lastName  || billingContact.lastName  || '';
    const customerName = `${firstName} ${lastName}`.trim() || buyer.name || 'Wix Customer';
    const customerEmail = buyer.email || billingContact.email || '';
    const customerPhone = shippingContact.phone || billingContact.phone || buyer.phone || '';

    log('4-CUSTOMER', `Name: ${customerName}, Email: ${customerEmail}, Phone: ${customerPhone}`);

    // 5. Match or create customer
    let customerId = null;
    if (customerPhone || customerEmail) {
      const searchFilters = [];
      if (customerPhone) {
        const cleanPhone = sanitizeFormulaValue(customerPhone.replace(/\s/g, ''));
        searchFilters.push(`SEARCH('${cleanPhone}', SUBSTITUTE({Phone}, ' ', ''))`);
      }
      if (customerEmail) {
        searchFilters.push(`SEARCH(LOWER('${sanitizeFormulaValue(customerEmail)}'), LOWER({Email}))`);
      }
      const matches = await db.list(TABLES.CUSTOMERS, {
        filterByFormula: `OR(${searchFilters.join(',')})`,
        maxRecords: 1,
      });
      if (matches.length > 0) {
        customerId = matches[0].id;
        log('5-MATCH', `Found existing customer: ${matches[0].Name || matches[0].id}`);
      }
    }
    if (!customerId) {
      const newCustomer = await db.create(TABLES.CUSTOMERS, {
        Name: customerName,
        Phone: customerPhone || '',
        Email: customerEmail || '',
        'Communication method': 'Wix',
      });
      customerId = newCustomer.id;
      log('5-CREATE', `New customer created: ${newCustomer.id}`);
    }

    // 6. Parse line items. v3 shape:
    //    li.productName.original            → display name
    //    li.catalogReference.catalogItemId  → Wix product ID (for stock match)
    //    li.quantity                        → qty
    //    li.price.amount                    → unit price (STRING)
    //    li.totalPriceBeforeTax.amount      → line total (STRING)
    //    li.descriptionLines                → size/variant options, text lines
    const lineItems = wixOrder.lineItems || wixOrder.line_items || [];
    const customerRequest = lineItems
      .map(li => {
        const name = localizedText(li.productName) || li.name || 'Item';
        const qty = li.quantity || 1;
        return `${qty}× ${name}`;
      })
      .join(', ') || 'Wix order';
    log('6-ITEMS', `${lineItems.length} line items: ${customerRequest}`);

    // 7. Delivery address (human-readable single string). v3 fields:
    //    address.addressLine (primary), addressLine2 (secondary), city, postalCode
    const deliveryAddress = shippingAddress
      ? [
          shippingAddress.addressLine
            || shippingAddress.streetAddress?.value
            || shippingAddress.addressLine1
            || shippingAddress.street
            || '',
          shippingAddress.addressLine2 || '',
          shippingAddress.city || '',
          shippingAddress.postalCode || '',
        ].filter(Boolean).join(', ')
      : '';
    const recipientName = `${firstName} ${lastName}`.trim() || customerName;
    const recipientPhone = customerPhone;

    // 8. Totals + shipping fee. v3 shape: priceSummary.totalPrice + shipping.
    //    Fall back to older field names for other payload shapes.
    const totalPrice = moneyAmount(wixOrder.priceSummary?.totalPrice)
      || moneyAmount(wixOrder.priceSummary?.total)
      || moneyAmount(wixOrder.totals?.total)
      || moneyAmount(wixOrder.total);
    const shippingFee = moneyAmount(wixOrder.priceSummary?.shipping)
      || moneyAmount(wixOrder.shippingInfo?.shippingFee)
      || 0;

    // Payment method — v3 doesn't inline this on the order; it's on a separate
    // transactions resource. Leave as a placeholder that the owner can edit
    // once seen. Better than guessing wrong. (If you want this populated
    // accurately, we'd add a second API call to /ecom/v1/orders/:id/transactions.)
    const paymentMethodLabel = 'Wix Online';

    // 9. Delivery date — Wix may or may not set this, depending on shipping
    //    method configuration. Try a few known paths; fall back to today.
    const deliveryDate = shipping.deliveryTime?.rangeStartTime
      || shipping.deliveryTime?.deliveryDate
      || shipping.shipmentDetails?.deliveryDate
      || shipping.deliveryDate
      || shipping.expectedDeliveryDate
      || wixOrder.fulfillments?.[0]?.expectedDeliveryDate
      || null;
    // Normalise to YYYY-MM-DD. Wix may send ISO timestamp or date-only string.
    const deliveryDateIso = deliveryDate
      ? String(deliveryDate).slice(0, 10)
      : new Date().toISOString().split('T')[0];

    // 10. Create the App Order. Wix is delivery-only today — hard-code the type.
    //     Price Override carries the total the buyer paid (flowers + shipping)
    //     so the dashboard shows exactly what Wix charged.
    const appOrderId = await generateOrderId();
    const humanOrderNumber = wixOrder.number || wixOrderId;
    const order = await db.create(TABLES.ORDERS, {
      Customer: [customerId],
      'Customer Request': customerRequest,
      Source: 'Wix',
      'Delivery Type': 'Delivery',
      'Order Date': new Date().toISOString().split('T')[0],
      'Required By': deliveryDateIso,
      'Notes Original': `Wix Order #${humanOrderNumber}`,
      'Greeting Card Text': '',
      'Payment Status': wixOrder.paymentStatus === 'NOT_PAID' ? 'Unpaid' : 'Paid',
      'Payment Method': paymentMethodLabel,
      'Price Override': totalPrice > 0 ? totalPrice : null,
      'App Order ID': appOrderId,
      Status: 'New',
      'Created By': 'Wix Webhook',
      'Wix Order ID': wixOrderId,
    });
    log('10-ORDER', `Created order: ${order.id}`);

    // 11. Create order lines. Fuzzy-match to stock by name so the bouquet
    //     editor can pull live cost/sell for those flowers; Wix "product"
    //     names rarely match the florist's actual stock cards 1:1, so most
    //     lines will land as text-only — florist composes manually later.
    const stock = await db.list(TABLES.STOCK, {
      filterByFormula: '{Active} = TRUE()',
      fields: ['Display Name', 'Current Quantity', 'Current Cost Price', 'Current Sell Price'],
    });
    const stockByName = {};
    for (const s of stock) {
      stockByName[(s['Display Name'] || '').toLowerCase()] = s;
    }
    function fuzzyMatchStock(productName) {
      const name = (productName || '').toLowerCase();
      if (stockByName[name]) return stockByName[name];
      for (const [key, item] of Object.entries(stockByName)) {
        if (name.includes(key) || key.includes(name)) return item;
      }
      return null;
    }

    const createdLines = [];
    for (const li of lineItems) {
      const productName = localizedText(li.productName) || li.name || 'Wix Item';
      const qty = li.quantity || 1;
      const unitPrice = moneyAmount(li.price)
        || moneyAmount(li.lineItemPrice)
        || moneyAmount(li.priceBeforeDiscounts)
        || moneyAmount(li.priceData?.price);
      const matched = fuzzyMatchStock(productName);

      const lineFields = {
        Order: [order.id],
        'Flower Name': productName,
        Quantity: qty,
        'Cost Price Per Unit': matched ? Number(matched['Current Cost Price'] || 0) : 0,
        'Sell Price Per Unit': matched ? Number(matched['Current Sell Price'] || 0) : unitPrice,
      };
      if (matched) lineFields['Stock Item'] = [matched.id];

      const createdLine = await db.create(TABLES.ORDER_LINES, lineFields);
      createdLines.push(createdLine);

      // No stock deduction for Wix orders — Wix "bouquets" don't map to
      // individual flower stock items. The florist opens the order later and
      // manually composes the real bouquet from actual stock.
      log('11-LINE', matched
        ? `"${productName}" matched stock "${matched['Display Name']}"`
        : `"${productName}" (no stock match — text-only)`);
    }

    // 12. Always create the delivery record (Wix is delivery-only today).
    //     If address or contact info is missing, the florist fills it in
    //     later; leaving the delivery sub-record absent would break driver
    //     assignment and the list enrichment pipeline.
    await db.create(TABLES.DELIVERIES, {
      'Linked Order': [order.id],
      'Delivery Address': deliveryAddress,
      'Recipient Name': recipientName,
      'Recipient Phone': recipientPhone,
      'Delivery Date': deliveryDateIso,
      'Delivery Time': '',
      'Delivery Fee': shippingFee,
      Status: DELIVERY_STATUS.PENDING,
    });
    log('12-DELIVERY', `Delivery created → ${deliveryAddress || '(empty — florist to fill)'}`);

    log('DONE', `Order ${order.id} created from Wix #${humanOrderNumber}`);
    await logWebhookEvent({ status: 'Success', wixOrderId, appOrderId: order.id });

    // Broadcast to all connected SSE clients (florist app, dashboard)
    broadcast({
      type: 'new_order',
      orderId: order.id,
      customerName,
      source: 'Wix',
      request: customerRequest,
    });

    // Telegram notification to owner + florists
    notifyNewOrder({
      source: 'Wix',
      customerName,
      request: customerRequest,
      deliveryType: 'Delivery',
      price: totalPrice || null,
    }).catch(err => console.error('[TELEGRAM] Wix notification error:', err.message));

    return order;
  } catch (err) {
    console.error('[WIX] Processing failed:', err);
    await logWebhookEvent({
      status: 'Failed',
      wixOrderId: payload?.data?.order?.id || payload?.order?.id || payload?.id || 'unknown',
      errorMessage: err.message,
      rawPayload: payload,
    });
  }
}
