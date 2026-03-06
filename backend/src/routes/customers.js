import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';

const router = Router();
router.use(authorize('customers'));

// GET /api/customers?search=anna
// Searches across Name, Nickname, Phone, Instagram (Link), Email
router.get('/', async (req, res, next) => {
  try {
    const { search } = req.query;

    let filterByFormula = '';
    if (search) {
      const q = search.replace(/'/g, "\\'"); // escape single quotes for formula
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

    // Churn risk: customers with 2+ orders who haven't ordered recently.
    // Since we don't have "last order date" field easily, we flag customers
    // with 2+ orders but rely on the frontend to show them for review.
    const churnRisk = customers
      .filter(c => (c['App Order Count'] || 0) >= 2 && c.Segment !== 'DO NOT CONTACT')
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
