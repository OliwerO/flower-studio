import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import * as orderRepo from '../repos/orderRepo.js';
import * as productRepo from '../repos/productRepo.js';
import { actorFromReq } from '../utils/actor.js';
import { TABLES } from '../config/airtable.js';
import { sanitizeFormulaValue } from '../utils/sanitize.js';
import { pickAllowed } from '../utils/fields.js';
import { DELIVERY_STATUS, VALID_DELIVERY_RESULTS } from '../constants/statuses.js';
import { sendDeliveryCompleteAlert } from '../services/orderService.js';

const router = Router();
router.use(authorize('deliveries'));

const DELIVERIES_PATCH_ALLOWED = [
  'Delivery Address', 'Recipient Name', 'Recipient Phone',
  'Delivery Date', 'Delivery Time', 'Assigned Driver', 'Status',
  'Driver Payment Status', 'Driver Notes', 'Driver Instructions',
  'Delivered At', 'Delivery Fee',
  'Delivery Result', 'Delivery Method', 'Driver Payout', 'Taxi Cost',
];

// GET /api/deliveries?date=2025-01-15&from=2025-01-15&status=Pending&driver=Piotr
// Either pass `date` for a single day, or `from` (and optionally `to`) for a range.
// `from` alone means "from this date onward", which is what the driver app uses to
// see today + every future-assigned delivery.
router.get('/', async (req, res, next) => {
  try {
    const { date, from, to, status, driver } = req.query;
    const filters = [];

    if (date) {
      // Single day OR deliveries with no date set (would otherwise be invisible).
      filters.push(`OR(DATESTR({Delivery Date}) = '${sanitizeFormulaValue(date)}', {Delivery Date} = BLANK())`);
    } else if (from) {
      // Range mode: drivers want today + future, no upper bound by default.
      const fromSafe = sanitizeFormulaValue(from);
      if (to) {
        const toSafe = sanitizeFormulaValue(to);
        filters.push(`AND(DATESTR({Delivery Date}) >= '${fromSafe}', DATESTR({Delivery Date}) <= '${toSafe}')`);
      } else {
        filters.push(`OR(DATESTR({Delivery Date}) >= '${fromSafe}', {Delivery Date} = BLANK())`);
      }
    }
    if (status) filters.push(`{Status} = '${sanitizeFormulaValue(status)}'`);
    if (driver) filters.push(`{Assigned Driver} = '${sanitizeFormulaValue(driver)}'`);

    const pgFilter = {};
    if (date)   pgFilter.date = date;
    else if (from) {
      pgFilter.from = from;
      if (to) pgFilter.to = to;
    }
    if (status) pgFilter.status = status;
    if (driver) pgFilter.driver = driver;

    const deliveries = await orderRepo.listDeliveries({
      filterByFormula: filters.length ? `AND(${filters.join(', ')})` : '',
      sort: [{ field: 'Delivery Date', direction: 'asc' }],
      pg: pgFilter,
    });

    // Enrich with customer name + phone from linked orders → customers.
    // Like checking the original purchase order to find who placed it.
    const orderIds = [...new Set(deliveries.flatMap(d => d['Linked Order'] || []))];
    let orderMap = {};
    if (orderIds.length > 0) {
      // Pull 'Wix Product ID' alongside the other order fields so we can
      // batch-look-up bouquet thumbnails in a single round-trip below.
      const orders = await orderRepo.listByIds(orderIds, {
        fields: ['Customer', 'Customer Request', 'Payment Status', 'Notes Translated', 'Greeting Card Text', 'App Order ID', 'Wix Product ID'],
      });
      const customerIds = [...new Set(orders.flatMap(o => o.Customer || []))];
      const customers = customerIds.length > 0
        ? await db.list(TABLES.CUSTOMERS, {
            filterByFormula: `OR(${customerIds.map(id => `RECORD_ID() = "${id}"`).join(',')})`,
            fields: ['Name', 'Nickname', 'Phone'],
          })
        : [];

      const custMap = {};
      for (const c of customers) custMap[c.id] = c;
      for (const o of orders) orderMap[o.id] = o;

      for (const d of deliveries) {
        const orderId = d['Linked Order']?.[0];
        const order = orderMap[orderId];
        const custId = order?.Customer?.[0];
        const cust = custMap[custId];
        if (cust) {
          d['Customer Name'] = cust.Name || cust.Nickname || '';
          d['Customer Phone'] = cust.Phone || '';
        }
        if (order) {
          d['Order Contents'] = order['Customer Request'] || '';
          d['Payment Status'] = order['Payment Status'] || '';
          d['Special Instructions'] = order['Notes Translated'] || '';
          d['App Order ID'] = order['App Order ID'] || '';
          if (!d['Greeting Card Text']) {
            d['Greeting Card Text'] = order['Greeting Card Text'] || '';
          }
        }
      }
    }

    // Batch-load bouquet image URLs for distinct Wix products across all
    // linked orders so the driver app can render thumbnails without N+1.
    const distinctProductIds = [...new Set(
      Object.values(orderMap).map(o => o['Wix Product ID']).filter(Boolean)
    )];
    let imageMap = new Map();
    if (distinctProductIds.length > 0) {
      try {
        imageMap = await productRepo.getImagesBatch(distinctProductIds);
      } catch (err) {
        console.error('[deliveries] getImagesBatch failed for list:', err.message);
      }
    }
    for (const d of deliveries) {
      const orderId = d['Linked Order']?.[0];
      const productId = orderMap[orderId]?.['Wix Product ID'];
      d.bouquetImageUrl = (productId && imageMap.get(productId)) || '';
      // Stash the originating Wix product ID alongside the resolved URL so the
      // delivery app can patch matching rows in-place when an SSE
      // `product_image_changed` event fires (no full reload required).
      d.wixProductId = productId || '';
    }

    res.json(deliveries);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/deliveries/:id — mark delivered, assign driver, add note, etc.
router.patch('/:id', async (req, res, next) => {
  try {
    const fields = pickAllowed(req.body, DELIVERIES_PATCH_ALLOWED);

    // Validate Delivery Result if provided
    if (fields['Delivery Result'] && !VALID_DELIVERY_RESULTS.includes(fields['Delivery Result'])) {
      return res.status(400).json({
        error: `Delivery Result must be one of: ${VALID_DELIVERY_RESULTS.join(', ')}`,
      });
    }

    // When a driver changes status, stamp their name on the delivery.
    // Like signing a work order — whoever completes it gets credited.
    if (fields.Status === DELIVERY_STATUS.OUT_FOR_DELIVERY || fields.Status === DELIVERY_STATUS.DELIVERED) {
      if (req.driverName) {
        fields['Assigned Driver'] = req.driverName;
      }
    }

    // Stamp Delivered At before the cascade so order + delivery agree.
    if (fields.Status === DELIVERY_STATUS.DELIVERED) {
      fields['Delivered At'] = new Date().toISOString();
    }

    // updateDelivery handles the delivery → order status cascade
    // transactionally in postgres mode (and as a follow-up update in
    // airtable mode). The Telegram alert stays out-of-band.
    const { delivery: updated, linkedOrderId } = await orderRepo.updateDelivery(
      req.params.id, fields, { actor: actorFromReq(req) },
    );

    if (linkedOrderId && fields.Status === DELIVERY_STATUS.DELIVERED) {
      sendDeliveryCompleteAlert(linkedOrderId).catch(err =>
        console.error('[TELEGRAM] delivery-complete alert failed:', err.message),
      );
    }
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
