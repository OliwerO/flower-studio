import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';

const router = Router();
router.use(authorize('deliveries'));

// GET /api/deliveries?date=2025-01-15&status=Pending&driver=Timur
router.get('/', async (req, res, next) => {
  try {
    const { date, status, driver } = req.query;
    const filters = [];

    if (date)   filters.push(`DATESTR({Delivery Date}) = '${date}'`);
    if (status) filters.push(`{Status} = '${status}'`);
    if (driver) filters.push(`{Assigned Driver} = '${driver}'`);

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
        fields: ['Customer', 'Customer Request'],
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
    const fields = { ...req.body };

    // When a driver changes status, stamp their name on the delivery.
    // Like signing a work order — whoever completes it gets credited.
    if (fields.Status === 'Out for Delivery' || fields.Status === 'Delivered') {
      if (req.driverName) {
        fields['Assigned Driver'] = req.driverName;
      }
    }

    // When marking delivered, also stamp the timestamp and update the linked order
    if (fields.Status === 'Delivered') {
      fields['Delivered At'] = new Date().toISOString();

      // Update the linked order status too
      const delivery = await db.getById(TABLES.DELIVERIES, req.params.id);
      if (delivery['Linked Order']?.length) {
        await db.update(TABLES.ORDERS, delivery['Linked Order'][0], {
          Status: 'Delivered',
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
