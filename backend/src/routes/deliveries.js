import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';
import { sanitizeFormulaValue } from '../utils/sanitize.js';

const router = Router();
router.use(authorize('deliveries'));

const DELIVERIES_PATCH_ALLOWED = [
  'Delivery Address', 'Recipient Name', 'Recipient Phone',
  'Delivery Date', 'Delivery Time', 'Assigned Driver', 'Status',
  'Driver Payment Status', 'Driver Notes', 'Delivered At', 'Delivery Fee',
  'Delivery Result',
];

// SYNC: must match RESULTS in apps/delivery/src/components/DeliveryResultPicker.jsx
const VALID_DELIVERY_RESULTS = ['Success', 'Not Home', 'Wrong Address', 'Refused', 'Incomplete'];

function pickAllowed(body, allowedFields) {
  const filtered = {};
  for (const key of allowedFields) {
    if (key in body) filtered[key] = body[key];
  }
  return filtered;
}

// GET /api/deliveries?date=2025-01-15&status=Pending&driver=Timur
router.get('/', async (req, res, next) => {
  try {
    const { date, status, driver } = req.query;
    const filters = [];

    // Show deliveries for the requested date OR deliveries with no date set
    // (no-date deliveries would be invisible otherwise — like lost packages without a label)
    if (date)   filters.push(`OR(DATESTR({Delivery Date}) = '${sanitizeFormulaValue(date)}', {Delivery Date} = BLANK())`);
    if (status) filters.push(`{Status} = '${sanitizeFormulaValue(status)}'`);
    if (driver) filters.push(`{Assigned Driver} = '${sanitizeFormulaValue(driver)}'`);

    const deliveries = await db.list(TABLES.DELIVERIES, {
      filterByFormula: filters.length ? `AND(${filters.join(', ')})` : '',
      sort: [{ field: 'Delivery Date', direction: 'asc' }],
    });

    // Enrich with customer name + phone from linked orders → customers.
    // Like checking the original purchase order to find who placed it.
    const orderIds = [...new Set(deliveries.flatMap(d => d['Linked Order'] || []))];
    if (orderIds.length > 0) {
      const orders = await db.list(TABLES.ORDERS, {
        filterByFormula: `OR(${orderIds.map(id => `RECORD_ID() = "${id}"`).join(',')})`,
        fields: ['Customer', 'Customer Request', 'Payment Status', 'Notes Translated', 'Greeting Card Text'],
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
      const orderMap = {};
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
          if (!d['Greeting Card Text']) {
            d['Greeting Card Text'] = order['Greeting Card Text'] || '';
          }
        }
      }
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
    if (fields.Status === 'Out for Delivery' || fields.Status === 'Delivered') {
      if (req.driverName) {
        fields['Assigned Driver'] = req.driverName;
      }
    }

    // Cascade delivery status changes to the linked order.
    // Like updating the master production board when the shipping dept changes status.
    if (fields.Status === 'Out for Delivery' || fields.Status === 'Delivered') {
      if (fields.Status === 'Delivered') {
        fields['Delivered At'] = new Date().toISOString();
      }

      // Update the linked order status to match
      const delivery = await db.getById(TABLES.DELIVERIES, req.params.id);
      if (delivery['Linked Order']?.length) {
        await db.update(TABLES.ORDERS, delivery['Linked Order'][0], {
          Status: fields.Status,
        });
      }
    }

    const updated = await db.update(TABLES.DELIVERIES, req.params.id, fields);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
