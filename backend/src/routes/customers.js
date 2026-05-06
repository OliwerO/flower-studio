// Thin HTTP controller for customer endpoints. All Airtable-specific logic
// (field-name aliases, allowlists, aggregate caching, legacy/app order joins)
// lives in customerRepo. Insights stays here because it's a cross-entity
// computation that reads customers + orders and produces derived analytics —
// not a single-entity persistence concern.

import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import { db as pgDb } from '../db/index.js';
import { orders } from '../db/schema.js';
import { isNull, desc } from 'drizzle-orm';
import * as customerRepo from '../repos/customerRepo.js';

const router = Router();
router.use(authorize('customers'));

// GET /api/customers
// Without ?search: all customers (~1094 rows), each enriched with
// _agg: { lastOrderDate, orderCount, totalSpend }.
// With ?search=X: OR-of-SEARCH across Name/Nickname/Phone/Link/Email so the
// legacy Customer tab's server-side search keeps working.
router.get('/', async (req, res, next) => {
  try {
    const customers = await customerRepo.list({ search: req.query.search });
    res.json(customers);
  } catch (err) {
    next(err);
  }
});

// GET /api/customers/insights — segment distribution, churn risk, top spenders.
// Must be defined BEFORE /:id to avoid route collision.
// Kept in the route because it joins customers + orders + computes RFM —
// that's analytics, not a single-entity persistence operation.
router.get('/insights', async (req, res, next) => {
  try {
    const customers = await customerRepo.list({ withAggregates: false });

    // Segment distribution (uses the alias the repo already applied)
    const segments = {};
    for (const c of customers) {
      const seg = c.Segment || 'Unassigned';
      segments[seg] = (segments[seg] || 0) + 1;
    }

    // Churn risk: customers with 2+ orders whose last order was >60 days ago.
    // Fetch recent orders to build a lastOrderDate map per customer.
    const recentOrders = await pgDb.select({
      customerId: orders.customerId,
      orderDate:  orders.orderDate,
    }).from(orders)
      .where(isNull(orders.deletedAt))
      .orderBy(desc(orders.orderDate))
      .limit(500);

    const lastOrderByCustomer = {};
    for (const o of recentOrders) {
      const cid = o.customerId;
      if (cid && !lastOrderByCustomer[cid]) {
        lastOrderByCustomer[cid] = o.orderDate;
      }
    }

    const now = Date.now();
    const sixtyDaysMs = 60 * 86400000;

    const churnRisk = customers
      .filter(c => {
        if ((c._agg?.orderCount || 0) < 2) return false;
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
          'App Total Spend': c._agg?.totalSpend || 0,
          'App Order Count': c._agg?.orderCount || 0,
          lastOrderDate: lastDate || null,
          daysSinceLastOrder: daysSince,
        };
      })
      .sort((a, b) => (b['App Total Spend'] || 0) - (a['App Total Spend'] || 0))
      .slice(0, 20);

    const totalRevenueAtRisk = churnRisk.reduce((sum, c) => sum + (c['App Total Spend'] || 0), 0);

    const topCustomers = customers
      .filter(c => (c._agg?.totalSpend || 0) > 0)
      .sort((a, b) => (b._agg?.totalSpend || 0) - (a._agg?.totalSpend || 0))
      .slice(0, 10);

    const segmentRevenue = {};
    for (const c of customers) {
      const seg = c.Segment || 'Unassigned';
      segmentRevenue[seg] = (segmentRevenue[seg] || 0) + (c._agg?.totalSpend || 0);
    }

    const acquisitionBySource = {};
    for (const c of customers) {
      const src = c['Communication method'] || c.Source || 'Unknown';
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
          if (sorted[0] === sorted[len - 1]) return 3;
          const rank = sorted.filter(s => s <= v).length / len;
          const score = Math.ceil(rank * 5) || 1;
          return lowerIsBetter ? 6 - score : score;
        });
      }

      const recencyValues = scoredCustomers.map(c => {
        const lastDate = lastOrderByCustomer[c.id];
        return lastDate ? (now - new Date(lastDate).getTime()) / 86400000 : 999;
      });
      const frequencyValues = scoredCustomers.map(c => c._agg?.orderCount || 0);
      const monetaryValues = scoredCustomers.map(c => c._agg?.totalSpend || 0);

      const rScores = quintileScore(recencyValues, true);
      const fScores = quintileScore(frequencyValues, false);
      const mScores = quintileScore(monetaryValues, false);

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
        const spend = c._agg?.totalSpend || 0;
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

    // Auto-compute segment based on order count — read-only hint for the UI,
    // doesn't overwrite manual segments like "DO NOT CONTACT".
    for (const c of customers) {
      const count = c._agg?.orderCount || 0;
      c.computedSegment = count >= 10 ? 'Constant' : count >= 2 ? 'Rare' : count >= 1 ? 'New' : null;
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

// GET /api/customers/:id/orders — merged legacy + app order history.
router.get('/:id/orders', async (req, res, next) => {
  try {
    const merged = await customerRepo.listOrders(req.params.id);
    res.json(merged);
  } catch (err) {
    next(err);
  }
});

// GET /api/customers/:id
router.get('/:id', async (req, res, next) => {
  try {
    const customer = await customerRepo.getById(req.params.id);
    res.json(customer);
  } catch (err) {
    next(err);
  }
});

// POST /api/customers
router.post('/', async (req, res, next) => {
  try {
    const { Name, Nickname, Phone } = req.body;
    if (!Name && !Nickname) {
      return res.status(400).json({ error: 'Name or Nickname is required.' });
    }
    if (Phone && typeof Phone !== 'string') {
      return res.status(400).json({ error: 'Phone must be a string if provided.' });
    }
    const customer = await customerRepo.create(req.body);
    res.status(201).json(customer);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/customers/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const customer = await customerRepo.update(req.params.id, req.body);
    res.json(customer);
  } catch (err) {
    // The repo throws { statusCode: 400 } when no allowed fields survive.
    // Surface that with the right HTTP status instead of a generic 500.
    if (err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

export default router;
