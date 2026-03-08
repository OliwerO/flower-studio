import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';
import { sanitizeFormulaValue } from '../utils/sanitize.js';

const router = Router();
router.use(authorize('customers'));

// GET /api/customers?search=anna
// Searches across Name, Nickname, Phone, Instagram (Link), Email
router.get('/', async (req, res, next) => {
  try {
    const { search } = req.query;

    let filterByFormula = '';
    if (search) {
      const q = sanitizeFormulaValue(search);
      filterByFormula = `OR(
        SEARCH(LOWER('${q}'), LOWER({Name})),
        SEARCH(LOWER('${q}'), LOWER({Nickname})),
        SEARCH('${q}', {Phone}),
        SEARCH(LOWER('${q}'), LOWER({Link})),
        SEARCH(LOWER('${q}'), LOWER({Email}))
      )`;
    }

    const customers = await db.list(TABLES.CUSTOMERS, {
      filterByFormula,
      sort: [{ field: 'Name', direction: 'asc' }],
      maxRecords: 50,
    });

    res.json(customers);
  } catch (err) {
    next(err);
  }
});

// GET /api/customers/insights — segment distribution, churn risk, top spenders
// Must be defined BEFORE /:id to avoid route collision.
router.get('/insights', async (req, res, next) => {
  try {
    // Fetch all customers — don't filter by field names since some fields
    // may not exist yet in the dev base (e.g. Segment, App Order Count)
    const customers = await db.list(TABLES.CUSTOMERS, {
      sort: [{ field: 'Name', direction: 'asc' }],
    });

    // Segment distribution
    const segments = {};
    for (const c of customers) {
      const seg = c.Segment || 'Unassigned';
      segments[seg] = (segments[seg] || 0) + 1;
    }

    // Churn risk: customers with 2+ orders whose last order was >60 days ago.
    // Fetch recent orders to build a lastOrderDate map per customer.
    const recentOrders = await db.list(TABLES.ORDERS, {
      sort: [{ field: 'Order Date', direction: 'desc' }],
      fields: ['Customer', 'Order Date'],
      maxRecords: 500,
    });

    const lastOrderByCustomer = {};
    for (const o of recentOrders) {
      const cid = o.Customer?.[0];
      if (cid && !lastOrderByCustomer[cid]) {
        lastOrderByCustomer[cid] = o['Order Date'];
      }
    }

    const now = Date.now();
    const sixtyDaysMs = 60 * 86400000;

    const churnRisk = customers
      .filter(c => {
        if ((c['App Order Count'] || 0) < 2) return false;
        if (c.Segment === 'DO NOT CONTACT') return false;
        const lastDate = lastOrderByCustomer[c.id];
        if (!lastDate) return true; // has order count but no recent order found in query window
        return (now - new Date(lastDate).getTime()) > sixtyDaysMs;
      })
      .map(c => {
        const lastDate = lastOrderByCustomer[c.id];
        const daysSince = lastDate
          ? Math.floor((now - new Date(lastDate).getTime()) / 86400000)
          : 999;
        return {
          id: c.id,
          Name: c.Name,
          Nickname: c.Nickname,
          Segment: c.Segment,
          'App Total Spend': c['App Total Spend'] || 0,
          'App Order Count': c['App Order Count'] || 0,
          lastOrderDate: lastDate || null,
          daysSinceLastOrder: daysSince,
        };
      })
      .sort((a, b) => (b['App Total Spend'] || 0) - (a['App Total Spend'] || 0))
      .slice(0, 20);

    // Top 10 customers by total spend
    const topCustomers = customers
      .filter(c => (c['App Total Spend'] || 0) > 0)
      .sort((a, b) => (b['App Total Spend'] || 0) - (a['App Total Spend'] || 0))
      .slice(0, 10);

    res.json({ segments, churnRisk, topCustomers });
  } catch (err) {
    next(err);
  }
});

// GET /api/customers/:id
router.get('/:id', async (req, res, next) => {
  try {
    const customer = await db.getById(TABLES.CUSTOMERS, req.params.id);
    res.json(customer);
  } catch (err) {
    next(err);
  }
});

// POST /api/customers
router.post('/', async (req, res, next) => {
  try {
    const customer = await db.create(TABLES.CUSTOMERS, req.body);
    res.status(201).json(customer);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/customers/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const customer = await db.update(TABLES.CUSTOMERS, req.params.id, req.body);
    res.json(customer);
  } catch (err) {
    next(err);
  }
});

export default router;
