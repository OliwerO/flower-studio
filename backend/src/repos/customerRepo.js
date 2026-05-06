// Customer repository — Phase 5 Postgres implementation.
//
// Public API is identical to the Airtable version so routes and frontends
// need no changes. Wire format uses Airtable field names (Name, Phone, etc.)
// mapped from PG column names (name, phone, etc.) in _pgCustomerToResponse().
//
// Key person 1 / Key person 2 slots map to the first two key_people rows
// (ordered by created_at) for backward compat with KeyPersonChips.jsx.

import { db } from '../db/index.js';
import { customers, keyPeople, legacyOrders, orders } from '../db/schema.js';
import { eq, and, or, ilike, like, isNull, asc, desc, sql } from 'drizzle-orm';

// ── Field mapping: request body → PG column ──
const PATCH_MAP = {
  'Name':                 'name',
  'Nickname':             'nickname',
  'Phone':                'phone',
  'Email':                'email',
  'Link':                 'link',
  'Language':             'language',
  'Home address':         'homeAddress',
  'Sex / Business':       'sexBusiness',
  'Segment':              'segment',
  'Segment (client)':     'segment',
  'Found us from':        'foundUsFrom',
  'Communication method': 'communicationMethod',
  'Order Source':         'orderSource',
};

// Key person patches: field name → { slot (0|1), prop ('name'|'importantDate') }
const KP_PATCH_MAP = {
  'Key person 1':                          { slot: 0, prop: 'name' },
  'Key person 1 (Name + Contact details)': { slot: 0, prop: 'name' },
  'Key person 1 (important DATE)':         { slot: 0, prop: 'importantDate' },
  'Key person 2':                          { slot: 1, prop: 'name' },
  'Key person 2 (Name + Contact details)': { slot: 1, prop: 'name' },
  'Key person 2 (important DATE)':         { slot: 1, prop: 'importantDate' },
};

// ── Wire format ──
export function _pgCustomerToResponse(row, kps = [], agg = null) {
  const kp1 = kps[0] ?? null;
  const kp2 = kps[1] ?? null;
  const resp = {
    id:   row.id,
    Name: row.name,
    Nickname: row.nickname ?? null,
    Phone:    row.phone ?? null,
    Email:    row.email ?? null,
    Link:     row.link ?? null,
    Language: row.language ?? null,
    'Home address':         row.homeAddress ?? null,
    'Sex / Business':       row.sexBusiness ?? null,
    Segment:                row.segment ?? null,
    'Segment (client)':     row.segment ?? null,
    'Found us from':        row.foundUsFrom ?? null,
    'Communication method': row.communicationMethod ?? null,
    'Order Source':         row.orderSource ?? null,
    'Key person 1':                          kp1?.name ?? null,
    'Key person 1 (Name + Contact details)': kp1?.name ?? null,
    'Key person 1 (important DATE)':         kp1?.importantDate ?? null,
    'Key person 2':                          kp2?.name ?? null,
    'Key person 2 (Name + Contact details)': kp2?.name ?? null,
    'Key person 2 (important DATE)':         kp2?.importantDate ?? null,
    _keyPeople: kps,
  };
  if (agg != null) resp._agg = agg;
  return resp;
}

// ── Aggregate cache ──
const AGG_TTL_MS = 60 * 1000;
let aggCache = { data: null, computedAt: 0 };

export function _resetAggregateCache() {
  aggCache = { data: null, computedAt: 0 };
}

async function computeAggregateMap() {
  const rows = await db.select({
    customerId:    sql`customer_id`,
    lastOrderDate: sql`MAX(order_date)::text`,
    orderCount:    sql`COUNT(*)`,
    totalSpend:    sql`SUM(amount)`,
  }).from(
    sql`(
      SELECT customer_id, order_date, COALESCE(price_override, 0) AS amount
      FROM ${orders}
      WHERE deleted_at IS NULL
      UNION ALL
      SELECT customer_id::text, order_date, COALESCE(amount, 0) AS amount
      FROM ${legacyOrders}
    ) combined`,
  ).groupBy(sql`customer_id`);

  const map = {};
  for (const r of rows) {
    map[r.customerId] = {
      lastOrderDate: r.lastOrderDate || null,
      orderCount:    Number(r.orderCount),
      totalSpend:    Number(r.totalSpend || 0),
    };
  }
  return map;
}

const EMPTY_AGG = { lastOrderDate: null, orderCount: 0, totalSpend: 0 };

export async function getAggregateMap() {
  if (aggCache.data && Date.now() - aggCache.computedAt < AGG_TTL_MS) {
    return aggCache.data;
  }
  const data = await computeAggregateMap();
  aggCache = { data, computedAt: Date.now() };
  return data;
}

// ── Public API ──

export async function list({ search, withAggregates = true } = {}) {
  const filters = [isNull(customers.deletedAt)];
  if (search) {
    filters.push(or(
      ilike(customers.name,     `%${search}%`),
      ilike(customers.nickname, `%${search}%`),
      like(customers.phone,     `%${search}%`),
      ilike(customers.link,     `%${search}%`),
      ilike(customers.email,    `%${search}%`),
    ));
  }

  const [rows, aggMap] = await Promise.all([
    db.select().from(customers).where(and(...filters)).orderBy(asc(customers.name)),
    withAggregates ? getAggregateMap() : Promise.resolve({}),
  ]);

  return rows.map(row => _pgCustomerToResponse(
    row,
    [],
    withAggregates ? (aggMap[row.id] ?? EMPTY_AGG) : null,
  ));
}

export async function getById(id) {
  const rows = await db.select().from(customers)
    .where(and(eq(customers.id, id), isNull(customers.deletedAt)));
  if (rows.length === 0) {
    const err = new Error('Customer not found.');
    err.statusCode = 404;
    throw err;
  }
  const row = rows[0];

  const [kps, countRows] = await Promise.all([
    db.select().from(keyPeople)
      .where(and(eq(keyPeople.customerId, id), isNull(keyPeople.deletedAt)))
      .orderBy(asc(keyPeople.createdAt))
      .limit(2),
    db.select({ count: sql`COUNT(*)` }).from(orders)
      .where(and(eq(orders.customerId, id), isNull(orders.deletedAt))),
  ]);

  const orderCount = Number(countRows[0]?.count || 0);
  const computedSegment =
    orderCount >= 10 ? 'Constant' :
    orderCount >= 2  ? 'Rare' :
    orderCount >= 1  ? 'New' : null;

  const customer = _pgCustomerToResponse(row, kps);
  customer.computedSegment = computedSegment;
  return customer;
}

export async function create(fields) {
  if (!fields.Name && !fields.Nickname) {
    const err = new Error('Name or Nickname is required.');
    err.statusCode = 400;
    throw err;
  }

  const colValues = {};
  for (const [airtableField, pgCol] of Object.entries(PATCH_MAP)) {
    if (airtableField in fields) colValues[pgCol] = fields[airtableField] ?? null;
  }

  const [inserted] = await db.insert(customers).values(colValues).returning();
  const kps = await db.select().from(keyPeople)
    .where(and(eq(keyPeople.customerId, inserted.id), isNull(keyPeople.deletedAt)))
    .orderBy(asc(keyPeople.createdAt)).limit(2);
  return _pgCustomerToResponse(inserted, kps);
}

export async function update(id, fields) {
  const colValues = {};
  const kpChanges = {};

  for (const [field, value] of Object.entries(fields)) {
    if (field in PATCH_MAP) {
      colValues[PATCH_MAP[field]] = value ?? null;
    } else if (field in KP_PATCH_MAP) {
      const { slot, prop } = KP_PATCH_MAP[field];
      if (!kpChanges[slot]) kpChanges[slot] = {};
      kpChanges[slot][prop] = value ?? null;
    }
  }

  if (Object.keys(colValues).length === 0 && Object.keys(kpChanges).length === 0) {
    const err = new Error('No valid fields to update.');
    err.statusCode = 400;
    throw err;
  }

  let updatedRow;
  if (Object.keys(colValues).length > 0) {
    const rows = await db.update(customers)
      .set(colValues)
      .where(eq(customers.id, id))
      .returning();
    updatedRow = rows[0];
  } else {
    const rows = await db.select().from(customers).where(eq(customers.id, id));
    updatedRow = rows[0];
  }

  if (!updatedRow) {
    const err = new Error('Customer not found.');
    err.statusCode = 404;
    throw err;
  }

  if (Object.keys(kpChanges).length > 0) {
    const existing = await db.select().from(keyPeople)
      .where(and(eq(keyPeople.customerId, id), isNull(keyPeople.deletedAt)))
      .orderBy(asc(keyPeople.createdAt)).limit(2);

    for (const [slotStr, changes] of Object.entries(kpChanges)) {
      const slot = Number(slotStr);
      const row  = existing[slot];

      if (changes.name === null || changes.name === '') {
        if (row) {
          await db.update(keyPeople)
            .set({ deletedAt: new Date() })
            .where(eq(keyPeople.id, row.id));
        }
      } else if (row) {
        await db.update(keyPeople)
          .set({
            name:          changes.name ?? row.name,
            importantDate: 'importantDate' in changes ? changes.importantDate : row.importantDate,
          })
          .where(eq(keyPeople.id, row.id));
      } else if (changes.name) {
        await db.insert(keyPeople).values({
          customerId:    id,
          name:          changes.name,
          importantDate: changes.importantDate ?? null,
        });
      }
    }
  }

  const kps = await db.select().from(keyPeople)
    .where(and(eq(keyPeople.customerId, id), isNull(keyPeople.deletedAt)))
    .orderBy(asc(keyPeople.createdAt)).limit(2);

  return _pgCustomerToResponse(updatedRow, kps);
}

export async function listOrders(customerId) {
  const [appRows, legacyRows] = await Promise.all([
    db.select({
      id:          orders.id,
      orderDate:   orders.orderDate,
      customerRequest: orders.customerRequest,
      priceOverride:   orders.priceOverride,
      status:      orders.status,
    }).from(orders)
      .where(and(eq(orders.customerId, customerId), isNull(orders.deletedAt))),
    db.select({
      id:          legacyOrders.id,
      orderDate:   legacyOrders.orderDate,
      description: legacyOrders.description,
      amount:      legacyOrders.amount,
    }).from(legacyOrders)
      .where(eq(legacyOrders.customerId, customerId)),
  ]);

  const normalizedApp = appRows.map(r => ({
    id:          r.id,
    source:      'app',
    date:        r.orderDate || null,
    description: r.customerRequest || '',
    amount:      Number(r.priceOverride || 0),
    status:      r.status || null,
    link:        `/orders/${r.id}`,
    lines:       null,
    raw:         r,
  }));

  const normalizedLegacy = legacyRows.map(r => ({
    id:          r.id,
    source:      'legacy',
    date:        r.orderDate || null,
    description: r.description || '',
    amount:      Number(r.amount || 0),
    status:      null,
    link:        null,
    lines:       null,
    raw:         r,
  }));

  return [...normalizedApp, ...normalizedLegacy].sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.localeCompare(a.date);
  });
}
