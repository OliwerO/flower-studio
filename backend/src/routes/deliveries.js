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

    if (date)   filters.push(`{Delivery Date} = '${date}'`);
    if (status) filters.push(`{Status} = '${status}'`);
    if (driver) filters.push(`{Assigned Driver} = '${driver}'`);

    const deliveries = await db.list(TABLES.DELIVERIES, {
      filterByFormula: filters.length ? `AND(${filters.join(', ')})` : '',
      sort: [{ field: 'Delivery Date', direction: 'asc' }],
    });

    res.json(deliveries);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/deliveries/:id — mark delivered, assign driver, add note, etc.
router.patch('/:id', async (req, res, next) => {
  try {
    const fields = { ...req.body };

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
