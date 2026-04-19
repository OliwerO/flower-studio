import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';
import { pickAllowed } from '../utils/fields.js';
import { listByIds } from '../utils/batchQuery.js';

const router = Router();
router.use(authorize('customers'));

// Field-name aliases: the Airtable schema uses verbose names for a few fields,
// but the frontend code reads/writes short aliases for ergonomics. We translate
// at the API boundary so the rest of the stack stays simple.
const CUSTOMERS_FIELD_ALIASES = {
  'Segment':           'Segment (client)',
  'Key person 1':      'Key person 1 (Name + Contact details)',
  'Key person 2':      'Key person 2 (Name + Contact details)',
  'Connected people':  'Connected people (TO SORT into Key 1 & Key 2 person)',
};

// PATCH allowlist uses REAL Airtable field names (not aliases).
// Remap aliases → real names BEFORE pickAllowed runs (see remapAliasesToReal below).
// Omitted vs old allowlist: "Notes / Preferences", "WhatsApp Contact", "Default
// Delivery Address" — these don't exist in the live Customers table (caught by the
// startup schema guard). Prior PATCHes to them silently no-op'd.
const CUSTOMERS_PATCH_ALLOWED = [
  'Name', 'Nickname', 'Phone', 'Email', 'Link', 'Language',
  'Home address', 'Sex / Business', 'Segment (client)',
  'Found us from',
  'Connected people (TO SORT into Key 1 & Key 2 person)',
  'Key person 1 (Name + Contact details)',
  'Key person 2 (Name + Contact details)',
  'Key person 1 (important DATE)', 'Key person 2 (important DATE)',
  'Communication method', 'Order Source',
];

// For incoming request bodies: if the client sent { Segment: "Rare" },
// translate to { "Segment (client)": "Rare" } so the write lands on the real field.
function remapAliasesToReal(body) {
  const out = { ...body };
  for (const [alias, real] of Object.entries(CUSTOMERS_FIELD_ALIASES)) {
    if (alias in out) {
      out[real] = out[alias];
      delete out[alias];
    }
  }
  return out;
}

// For outgoing GET responses: expose both the real field and the short alias
// so the frontend can read c.Segment without caring about the Airtable name.
function addResponseAliases(customer) {
  for (const [alias, real] of Object.entries(CUSTOMERS_FIELD_ALIASES)) {
    if (real in customer && !(alias in customer)) {
      customer[alias] = customer[real];
    }
  }
  return customer;
}

// Legacy Oder Numbers follow the convention YYYYMM-<code>-<DD><Mmm>-<seq>,
// e.g. "202304-WS-Bouquets-15Apr-1". On old records (2023 era) the dedicated
// Order Delivery Date / Order date fields are often empty, so the Oder Number
// IS the authoritative date. This parser returns an ISO YYYY-MM-DD string.
// Returns null if the convention doesn't match (newer records use date fields).
const LEGACY_ODER_DATE_RE = /^(\d{4})(\d{2})-.*-(\d{1,2})[A-Za-z]{3}-\d+$/;
function parseLegacyOderDate(oderNumber) {
  if (!oderNumber || typeof oderNumber !== 'string') return null;
  const m = LEGACY_ODER_DATE_RE.exec(oderNumber);
  if (!m) return null;
  const [, year, month, day] = m;
  return `${year}-${month}-${day.padStart(2, '0')}`;
}

function legacyOrderDate(o) {
  return o['Order Delivery Date'] || o['Order date'] || parseLegacyOderDate(o['Oder Number']);
}

// 60-second in-process cache of customer-level aggregates (last order,
// order count, total spend) computed over legacy + app orders combined.
// Why cache: GET /customers fires on every dashboard mount; recomputing
// the join each time would cost ~28 Airtable requests and ~6 seconds.
const AGG_TTL_MS = 60 * 1000;
let aggCache = { data: null, computedAt: 0 };

async function getAggregateMap() {
  if (aggCache.data && Date.now() - aggCache.computedAt < AGG_TTL_MS) {
    return aggCache.data;
  }

  // We trust the customer's linked-record fields (auto-populated by Airtable
  // from nickname matches during owner entry) rather than re-deriving via
  // text match. Orders (list) is a formula returning legacy-order IDs;
  // App Orders is the native linked-record array.
  //
  // Note: 'Final Price' and 'Sell Total' are computed in code (see dashboard.js,
  // orders.js) — they aren't stored Airtable fields in this base. For the
  // aggregate spend we use Price Override as the best available approximation.
  const [legacyOrders, appOrders, customers] = await Promise.all([
    db.list(TABLES.LEGACY_ORDERS, {
      fields: ['Oder Number', 'Order Delivery Date', 'Order date', 'Price (with Delivery)'],
    }),
    db.list(TABLES.ORDERS, {
      fields: ['Order Date', 'Price Override'],
    }),
    db.list(TABLES.CUSTOMERS, {
      fields: ['Orders (list)', 'App Orders'],
    }),
  ]);

  const legacyById = Object.fromEntries(legacyOrders.map(o => [o.id, o]));
  const appById = Object.fromEntries(appOrders.map(o => [o.id, o]));

  const agg = {};
  for (const c of customers) {
    let lastOrderDate = null;
    let orderCount = 0;
    let totalSpend = 0;

    for (const lid of (c['Orders (list)'] || [])) {
      const o = legacyById[lid];
      if (!o) continue;
      const date = legacyOrderDate(o);
      const amount = Number(o['Price (with Delivery)'] || 0);
      orderCount += 1;
      totalSpend += amount;
      if (date && (!lastOrderDate || date > lastOrderDate)) lastOrderDate = date;
    }
    for (const aid of (c['App Orders'] || [])) {
      const o = appById[aid];
      if (!o) continue;
      const date = o['Order Date'];
      const amount = Number(o['Price Override'] || 0);
      orderCount += 1;
      totalSpend += amount;
      if (date && (!lastOrderDate || date > lastOrderDate)) lastOrderDate = date;
    }

    if (orderCount > 0) agg[c.id] = { lastOrderDate, orderCount, totalSpend };
  }

  aggCache = { data: agg, computedAt: Date.now() };
  return agg;
}

// GET /api/customers
// Returns ALL customers (~1094 rows, ~30KB gzipped), each enriched with
// _agg: { lastOrderDate, orderCount, totalSpend } computed over legacy + app
// orders combined. Universal search and filtering happen client-side against
// this one payload (see Customer Tab v2.0 plan).
router.get('/', async (req, res, next) => {
  try {
    const [customers, aggMap] = await Promise.all([
      db.list(TABLES.CUSTOMERS, {
        sort: [{ field: 'Name', direction: 'asc' }],
      }),
      getAggregateMap(),
    ]);

    for (const c of customers) {
      addResponseAliases(c);
      c._agg = aggMap[c.id] || { lastOrderDate: null, orderCount: 0, totalSpend: 0 };
    }

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

    // Normalize aliases so c.Segment etc. are populated from the real Airtable field.
    for (const c of customers) addResponseAliases(c);

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

    // Auto-compute segment based on order count (doesn't overwrite manual segments like "DO NOT CONTACT").
    // Like an automatic quality classification gate: the label is computed from metrics, not from manual input.
    for (const c of customers) {
      const count = c['App Order Count'] || 0;
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

// GET /api/customers/:id/orders — merged legacy + app order history for one customer.
// Legacy orders (pre-app era, 2023-11 → 2026-03) link via the customer's Orders/Orders 2/Orders 3
// linked-record arrays. App orders link via App Orders linked array.
// Response is sorted date-desc and normalized to one schema the UI timeline can render directly.
router.get('/:id/orders', async (req, res, next) => {
  try {
    const customer = await db.getById(TABLES.CUSTOMERS, req.params.id);

    // Orders (list) is a formula that returns legacy-order record IDs —
    // the authoritative linkage (auto-populated by Airtable when the owner
    // types a matching Nickname on a legacy order).
    const legacyIds = customer['Orders (list)'] || [];
    const appIds = customer['App Orders'] || [];

    const [legacyOrders, appOrders] = await Promise.all([
      listByIds(TABLES.LEGACY_ORDERS, legacyIds, {
        // 'Oder Number' is misspelled in the live base (sic). If the owner ever
        // renames it to 'Order Number', add it here too — the normalizer below
        // already checks both names via ||.
        fields: [
          'Oder Number',
          'Flowers+Details of order',
          'Order Reason',
          'Order Delivery Date',
          'Order date',
          'Price (with Delivery)',
        ],
      }),
      listByIds(TABLES.ORDERS, appIds, {
        // Bouquet Summary / Final Price / Sell Total are computed in code, not
        // Airtable fields in this base. Timeline shows Price Override as a
        // lower-bound amount and description falls back to Customer Request.
        fields: [
          'Order Date', 'Customer Request',
          'Price Override', 'Status', 'Order Lines',
        ],
      }),
    ]);

    const normalizedLegacy = legacyOrders.map(o => ({
      id: o.id,
      source: 'legacy',
      // Falls back to parsing the Oder Number string when dedicated date
      // fields are empty (common on pre-2024 records).
      date: legacyOrderDate(o),
      description: [
        o['Oder Number'],
        o['Flowers+Details of order'],
        o['Order Reason'],
      ].filter(Boolean).join(' — '),
      // 0 means "price not recorded" on pre-app records — the frontend
      // should check raw['Price (with Delivery)'] to distinguish from 0 zł.
      amount: Number(o['Price (with Delivery)'] || 0),
      status: null,
      link: null,
      lines: null,
      raw: o,
    }));

    const normalizedApp = appOrders.map(o => ({
      id: o.id,
      source: 'app',
      date: o['Order Date'] || null,
      description: o['Customer Request'] || '',
      amount: Number(o['Price Override'] || 0),
      status: o.Status || null,
      link: `/orders/${o.id}`,
      lines: o['Order Lines'] || null,
      raw: o,
    }));

    // Sort date-desc; null dates (data quality holes) sink to the bottom.
    const merged = [...normalizedLegacy, ...normalizedApp].sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return b.date.localeCompare(a.date);
    });

    res.json(merged);
  } catch (err) {
    next(err);
  }
});

// GET /api/customers/:id
router.get('/:id', async (req, res, next) => {
  try {
    const customer = await db.getById(TABLES.CUSTOMERS, req.params.id);
    addResponseAliases(customer);
    // Auto-compute segment from order count (read-only suggestion, not written to Airtable)
    const count = customer['App Order Count'] || 0;
    customer.computedSegment = count >= 10 ? 'Constant' : count >= 2 ? 'Rare' : count >= 1 ? 'New' : null;
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

    const remapped = remapAliasesToReal(req.body);
    const safeFields = pickAllowed(remapped, CUSTOMERS_PATCH_ALLOWED);
    const customer = await db.create(TABLES.CUSTOMERS, safeFields);
    addResponseAliases(customer);
    res.status(201).json(customer);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/customers/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const remapped = remapAliasesToReal(req.body);
    const safeFields = pickAllowed(remapped, CUSTOMERS_PATCH_ALLOWED);
    if (Object.keys(safeFields).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update.' });
    }
    const customer = await db.update(TABLES.CUSTOMERS, req.params.id, safeFields);
    addResponseAliases(customer);
    res.json(customer);
  } catch (err) {
    next(err);
  }
});

export default router;
