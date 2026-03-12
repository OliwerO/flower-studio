// Wix webhook order processor — converts a Wix eCommerce payload into
// our internal order structure. Like an EDI translator between a supplier's
// system and your ERP: parse their format, map to your fields, create records.

import * as db from './airtable.js';
import { TABLES } from '../config/airtable.js';
import { sanitizeFormulaValue } from '../utils/sanitize.js';
import { broadcast } from './notifications.js';
import { notifyNewOrder } from './telegram.js';
import { logWebhookEvent } from './webhookLog.js';


/**
 * Process a Wix order payload asynchronously.
 * Called fire-and-forget after the webhook returns 200.
 *
 * Pipeline:
 * 1. Parse Wix payload → extract customer, items, shipping
 * 2. Dedup by Wix Order ID
 * 3. Match/create customer
 * 4. Create App Order + Order Lines + Delivery
 */
export async function processWixOrder(payload) {
  const log = (step, msg) => console.log(`[WIX] ${step}: ${msg}`);

  try {
    // 1. Parse — Wix sends different payload shapes depending on the event.
    //    We handle the common "order created" format.
    const wixOrder = payload?.data?.order || payload?.order || payload;
    const wixOrderId = wixOrder?.id || wixOrder?.number?.toString() || '';

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

    // 3. Extract customer info from Wix payload
    const buyer = wixOrder.buyerInfo || wixOrder.buyer || {};
    const shipping = wixOrder.shippingInfo || wixOrder.shipping || {};
    const shippingContact = shipping.shipmentDetails?.address?.contactDetails
      || shipping.destination?.contactDetails
      || shipping.contact
      || {};
    const billingContact = wixOrder.billingInfo?.contactDetails
      || wixOrder.billingInfo?.address?.contactDetails
      || {};

    const customerName = buyer.firstName && buyer.lastName
      ? `${buyer.firstName} ${buyer.lastName}`
      : buyer.name || shippingContact.firstName
        ? `${shippingContact.firstName || ''} ${shippingContact.lastName || ''}`.trim()
        : billingContact.firstName
          ? `${billingContact.firstName || ''} ${billingContact.lastName || ''}`.trim()
          : 'Wix Customer';

    const customerEmail = buyer.email || '';
    const customerPhone = buyer.phone
      || shippingContact.phone
      || billingContact.phone
      || '';

    log('3-CUSTOMER', `Name: ${customerName}, Email: ${customerEmail}, Phone: ${customerPhone}`);

    // 4. Match or create customer
    let customerId = null;
    if (customerPhone || customerEmail) {
      const searchFilters = [];
      if (customerPhone) {
        // Search by phone — strip spaces for flexible matching
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
        log('4-MATCH', `Found existing customer: ${matches[0].Name || matches[0].id}`);
      }
    }

    if (!customerId) {
      const newCustomer = await db.create(TABLES.CUSTOMERS, {
        Name: customerName,
        Phone: customerPhone || '',
        Email: customerEmail || '',
        Source: 'Wix',
      });
      customerId = newCustomer.id;
      log('4-CREATE', `New customer created: ${newCustomer.id}`);
    }

    // 5. Parse line items from Wix
    const lineItems = wixOrder.lineItems || wixOrder.line_items || [];
    const customerRequest = lineItems
      .map(li => {
        const name = li.name || li.productName || li.catalogReference?.catalogItemName || 'Item';
        const qty = li.quantity || 1;
        return `${qty}× ${name}`;
      })
      .join(', ') || 'Wix order';

    log('5-ITEMS', `${lineItems.length} line items: ${customerRequest}`);

    // 6. Determine delivery info
    const shippingAddress = shipping.shipmentDetails?.address
      || shipping.destination?.address
      || shipping.address
      || null;

    const hasDelivery = !!shippingAddress;
    const deliveryAddress = shippingAddress
      ? [
          shippingAddress.streetAddress?.value || shippingAddress.addressLine1 || shippingAddress.street || '',
          shippingAddress.city || '',
          shippingAddress.postalCode || '',
        ].filter(Boolean).join(', ')
      : '';

    const recipientName = shippingContact.firstName
      ? `${shippingContact.firstName || ''} ${shippingContact.lastName || ''}`.trim()
      : customerName;
    const recipientPhone = shippingContact.phone || customerPhone;

    // 7. Get order total
    const totalPrice = Number(wixOrder.priceSummary?.total?.amount)
      || Number(wixOrder.totals?.total)
      || Number(wixOrder.total?.amount)
      || 0;

    // 8. Create the App Order
    const order = await db.create(TABLES.ORDERS, {
      Customer: [customerId],
      'Customer Request': customerRequest,
      Source: 'Wix',
      'Delivery Type': hasDelivery ? 'Delivery' : 'Pickup',
      'Order Date': new Date().toISOString().split('T')[0],
      'Notes Original': `Wix Order #${wixOrderId}`,
      'Greeting Card Text': '',
      'Payment Status': 'Paid',
      'Payment Method': 'Wix Online',
      'Price Override': totalPrice > 0 ? totalPrice : null,
      Status: 'New',
      'Created By': 'Wix Webhook',
      'Wix Order ID': wixOrderId,
    });
    log('6-ORDER', `Created order: ${order.id}`);

    // 9. Create order lines — attempt fuzzy match to stock items
    // First, fetch all active stock for matching
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
      // Exact match
      if (stockByName[name]) return stockByName[name];
      // Partial match — stock name is contained in product name or vice versa
      for (const [key, item] of Object.entries(stockByName)) {
        if (name.includes(key) || key.includes(name)) return item;
      }
      return null;
    }

    for (const li of lineItems) {
      const productName = li.name || li.productName || li.catalogReference?.catalogItemName || 'Wix Item';
      const qty = li.quantity || 1;
      const unitPrice = Number(li.price?.amount) || Number(li.priceData?.price) || 0;

      const matched = fuzzyMatchStock(productName);

      const lineFields = {
        Order: [order.id],
        'Flower Name': productName,
        Quantity: qty,
        'Cost Price Per Unit': matched ? Number(matched['Current Cost Price'] || 0) : 0,
        'Sell Price Per Unit': matched ? Number(matched['Current Sell Price'] || 0) : unitPrice,
      };

      if (matched) {
        lineFields['Stock Item'] = [matched.id];
      }

      await db.create(TABLES.ORDER_LINES, lineFields);

      // No stock deduction for Wix orders — Wix "bouquets" don't map to
      // individual flower stock items. The florist opens the order later and
      // manually composes the real bouquet from actual stock.
      if (matched) {
        log('7-STOCK', `Matched "${productName}" to stock "${matched['Display Name']}" (no deduction — florist composes manually)`);
      } else {
        log('7-STOCK', `No stock match for "${productName}" — text-only line`);
      }
    }

    // 10. Create delivery record if shipping address present
    if (hasDelivery) {
      await db.create(TABLES.DELIVERIES, {
        'Linked Order': [order.id],
        'Delivery Address': deliveryAddress,
        'Recipient Name': recipientName,
        'Recipient Phone': recipientPhone,
        'Delivery Date': shipping.deliveryDate
          || shipping.shipmentDetails?.deliveryDate
          || shipping.expectedDeliveryDate
          || wixOrder.fulfillments?.[0]?.expectedDeliveryDate
          || new Date().toISOString().split('T')[0],
        'Delivery Time': '',
        'Delivery Fee': 0, // studio adjusts later
        Status: 'Pending',
      });
      log('8-DELIVERY', `Delivery created → ${deliveryAddress}`);
    }

    // Note: translation feature was removed (commit c04a8b8).
    // Wix buyer notes are stored as-is in Notes Original.

    log('DONE', `Order ${order.id} created successfully from Wix #${wixOrderId}`);
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
      deliveryType: shipping ? 'Delivery' : 'Pickup',
      price: order['Final Price'] || order['Sell Price Total'] || null,
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
