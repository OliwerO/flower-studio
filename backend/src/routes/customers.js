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

    // Total revenue at risk from churning customers
    const totalRevenueAtRisk = churnRisk.reduce((sum, c) => sum + (c['App Total Spend'] || 0), 0);

    // Top 10 customers by total spend
    const topCustomers = customers
      .filter(c => (c['App Total Spend'] || 0) > 0)
      .sort((a, b) => (b['App Total Spend'] || 0) - (a['App Total Spend'] || 0))
      .slice(0, 10);

    // Revenue per segment — how much each segment contributes
    const segmentRevenue = {};
    for (const c of customers) {
      const seg = c.Segment || 'Unassigned';
      segmentRevenue[seg] = (segmentRevenue[seg] || 0) + (c['App Total Spend'] || 0);
    }

    // Acquisition source distribution — where customers come from
    const acquisitionBySource = {};
    for (const c of customers) {
      const src = c.Source || 'Unknown';
      acquisitionBySource[src] = (acquisitionBySource[src] || 0) + 1;
    }

    // RFM scoring — Recency / Frequency / Monetary health segmentation
    let rfmData = null;
    const scoredCustomers = customers.filter(c => lastOrderByCustomer[c.id]);

    if (scoredCustomers.length > 0) {
      // Quintile scoring (1-5, 5 is best)
      function quintileScore(values, lowerIsBetter = false) {
        const sorted = [...values].sort((a, b) => a - b);
        const len = sorted.length;
        return values.map(v => {
          // Handle edge case: all same values → everyone gets score 3
          if (sorted[0] === sorted[len - 1]) return 3;
          const rank = sorted.filter(s => s <= v).length / len;
          const score = Math.ceil(rank * 5) || 1;
          return lowerIsBetter ? 6 - score : score;
        });
      }

      // Calculate raw values
      const recencyValues = scoredCustomers.map(c => {
        const lastDate = lastOrderByCustomer[c.id];
        return lastDate ? (now - new Date(lastDate).getTime()) / 86400000 : 999;
      });
      const frequencyValues = scoredCustomers.map(c => c['App Order Count'] || 0);
      const monetaryValues = scoredCustomers.map(c => c['App Total Spend'] || 0);

      const rScores = quintileScore(recencyValues, true);  // fewer days ago = higher score
      const fScores = quintileScore(frequencyValues, false);
      const mScores = quintileScore(monetaryValues, false);

      // Map RFM scores to human-readable labels
      function rfmLabel(r, f, m) {
        if (r >= 4 && f >= 4 && m >= 4) return 'Champions';
        if (f >= 4 || (r >= 3 && f >= 3 && m >= 3)) return 'Loyal';
        if (r <= 2 && f >= 2 && m >= 3) return 'At Risk';
        if (r <= 2 && f <= 2) return 'Lost';
        if (f <= 1) return 'New';
        return 'Loyal';
      }

      const rfmSummary = { Champions: 0, Loyal: 0, 'At Risk': 0, Lost: 0, New: 0 };
      const rfmRevenue = { Champions: 0, Loyal: 0, 'At Risk': 0, Lost: 0, New: 0 };
      const rfmByCustomer = {};

      scoredCustomers.forEach((c, i) => {
        const label = rfmLabel(rScores[i], fScores[i], mScores[i]);
        const spend = c['App Total Spend'] || 0;
        rfmSummary[label]++;
        rfmRevenue[label] += spend;
        rfmByCustomer[c.id] = {
          r: rScores[i], f: fScores[i], m: mScores[i],
          label,
          spend,
        };
      });

      rfmData = { summary: rfmSummary, revenue: rfmRevenue, byCustomer: rfmByCustomer };
    }

    res.json({
      segments,
      segmentRevenue,
      churnRisk,
      totalRevenueAtRisk,
      topCustomers,
      lastOrderDates: lastOrderByCustomer,
      acquisitionBySource,
      rfm: rfmData,
    });
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
