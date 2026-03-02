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
