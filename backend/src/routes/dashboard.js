import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import * as orderRepo from '../repos/orderRepo.js';
import * as customerRepo from '../repos/customerRepo.js';
import * as stockRepo from '../repos/stockRepo.js';
import { TABLES } from '../config/airtable.js';
import { db as pgDb } from '../db/index.js';
import { orderLines as orderLinesTable, orders as ordersTable } from '../db/schema.js';
import { and, or, eq, isNull, inArray, gte, lte, asc } from 'drizzle-orm';
import { ORDER_STATUS, PAYMENT_STATUS, DELIVERY_STATUS } from '../constants/statuses.js';

const router = Router();
router.use(authorize('dashboard'));

// GET /api/dashboard — day-to-day operational summary for today
router.get('/', async (req, res, next) => {
  try {
    // Accept optional ?date= param, default to today
    const today = (req.query.date || new Date().toISOString().split('T')[0]).slice(0, 10);

    const tomorrow = new Date(new Date(today).getTime() + 86400000).toISOString().split('T')[0];

    const [orders, ordersDueToday, fulfillToday, tomorrowOrders, deliveries, lowStock, unpaidOrders, negativeStockItems, customersWithDates] = await Promise.all([
      // Today's orders by Order Date (for revenue + status breakdown)
      orderRepo.list({ pg: { forDate: today }, sort: [{ field: 'Order Date', direction: 'desc' }] }).catch(() => []),
      // Orders due today by Required By (count only — we only need .length)
      orderRepo.list({ pg: { requiredByFrom: today, requiredByTo: today, excludeStatuses: [ORDER_STATUS.CANCELLED] } }).catch(() => []),
      // Full data for fulfill-today orders
      orderRepo.list({ pg: { requiredByFrom: today, requiredByTo: today, excludeStatuses: [ORDER_STATUS.CANCELLED] }, sort: [{ field: 'Required By', direction: 'asc' }] }).catch(() => []),
      // Tomorrow's orders for planning view
      orderRepo.list({ pg: { requiredByFrom: tomorrow, requiredByTo: tomorrow, excludeStatuses: [ORDER_STATUS.CANCELLED] } }).catch(() => []),
      // Today's pending deliveries (filter to non-Delivered below)
      orderRepo.listDeliveries({ pg: { date: today } }).then(rows => rows.filter(d => d.Status !== DELIVERY_STATUS.DELIVERED)).catch(() => []),
      // Stock items below reorder threshold
      stockRepo.list({ pg: { active: true, includeEmpty: true } }).then(rows => rows.filter(r => {
        const t = Number(r['Reorder Threshold'] || 0);
        return t > 0 && Number(r['Current Quantity'] || 0) < t;
      })).catch(() => []),
      // Unpaid/partial non-cancelled orders
      orderRepo.list({ pg: { excludeStatuses: [ORDER_STATUS.CANCELLED] } })
        .then(rows => rows.filter(o =>
          o['Payment Status'] === PAYMENT_STATUS.UNPAID || o['Payment Status'] === PAYMENT_STATUS.PARTIAL
        )).catch(() => []),
      // Active stock items with negative quantity
      stockRepo.list({ pg: { active: true, includeEmpty: true } }).then(rows => rows.filter(r => Number(r['Current Quantity'] || 0) < 0)).catch(() => []),
      // Customers with key person reminder dates
      customerRepo.listWithKeyPeopleHavingDates().catch(() => []),
    ]);

    // Enrich orders with customer names + computed prices
    // (same bulk-fetch pattern as orders route)
    const uniqueCustomerIds = [...new Set(orders.flatMap(o => o.Customer || []))];
    const allLineIds = orders.flatMap(o => o['Order Lines'] || []);

    const [allCustomers, allLines] = await Promise.all([
      uniqueCustomerIds.length > 0
        ? db.list(TABLES.CUSTOMERS, {
            filterByFormula: `OR(${uniqueCustomerIds.map(id => `RECORD_ID() = "${id}"`).join(',')})`,
            fields: ['Name', 'Nickname'],
          }).catch(() => [])
        : [],
      allLineIds.length > 0
        ? db.list(TABLES.ORDER_LINES, {
            filterByFormula: `OR(${allLineIds.map(id => `RECORD_ID() = "${id}"`).join(',')})`,
            fields: ['Order', 'Sell Price Per Unit', 'Quantity'],
            maxRecords: 1000,
          }).catch(() => [])
        : [],
    ]);

    const customerMap = {};
    for (const c of allCustomers) customerMap[c.id] = c;

    // Sum order line sell totals by order ID
    const totalByOrder = {};
    for (const line of allLines) {
      const oid = line.Order?.[0];
      if (oid) {
        totalByOrder[oid] = (totalByOrder[oid] || 0)
          + Number(line['Sell Price Per Unit'] || 0) * Number(line['Quantity'] || 0);
      }
    }

    for (const order of orders) {
      const custId = order.Customer?.[0];
      order['Customer Name'] = customerMap[custId]?.Name || customerMap[custId]?.Nickname || '';

      // Compute effective price (Final Price is an Airtable formula that may not return)
      if (!order['Price Override'] && totalByOrder[order.id] !== undefined) {
        order['Sell Total'] = totalByOrder[order.id];
      }
      const deliveryFee = Number(order['Delivery Fee'] || 0);
      // Price Override replaces flower total only; delivery fee always added on top
      order['Effective Price'] = order['Final Price']
        ?? ((order['Price Override'] || order['Sell Total'] || 0) + deliveryFee);
    }

    // Enrich fulfillToday orders with customer names + effective prices
    // (reuse the same customerMap + totalByOrder if they overlap, fetch missing)
    const fulfillCustIds = [...new Set(fulfillToday.flatMap(o => o.Customer || []).filter(id => !customerMap[id]))];
    const fulfillLineIds = fulfillToday.flatMap(o => o['Order Lines'] || []).filter(id => !allLineIds.includes(id));

    const [extraFulfillCusts, extraFulfillLines] = await Promise.all([
      fulfillCustIds.length > 0
        ? db.list(TABLES.CUSTOMERS, {
            filterByFormula: `OR(${fulfillCustIds.map(id => `RECORD_ID() = "${id}"`).join(',')})`,
            fields: ['Name', 'Nickname'],
          }).catch(() => [])
        : [],
      fulfillLineIds.length > 0
        ? db.list(TABLES.ORDER_LINES, {
            filterByFormula: `OR(${fulfillLineIds.map(id => `RECORD_ID() = "${id}"`).join(',')})`,
            fields: ['Order', 'Sell Price Per Unit', 'Quantity', 'Flower Name'],
            maxRecords: 1000,
          }).catch(() => [])
        : [],
    ]);
    for (const c of extraFulfillCusts) customerMap[c.id] = c;
    for (const line of extraFulfillLines) {
      const oid = line.Order?.[0];
      if (oid) {
        totalByOrder[oid] = (totalByOrder[oid] || 0)
          + Number(line['Sell Price Per Unit'] || 0) * Number(line['Quantity'] || 0);
      }
    }

    for (const order of fulfillToday) {
      const custId = order.Customer?.[0];
      order['Customer Name'] = customerMap[custId]?.Name || customerMap[custId]?.Nickname || '';
      if (!order['Price Override'] && totalByOrder[order.id] !== undefined) {
        order['Sell Total'] = totalByOrder[order.id];
      }
      const deliveryFee = Number(order['Delivery Fee'] || 0);
      order['Effective Price'] = order['Final Price']
        ?? ((order['Price Override'] || order['Sell Total'] || 0) + deliveryFee);
    }

    // Enrich tomorrowOrders with customer names + order line summaries
    const tmrwCustIds = [...new Set(tomorrowOrders.flatMap(o => o.Customer || []).filter(id => !customerMap[id]))];
    const tmrwLineIds = tomorrowOrders.flatMap(o => o['Order Lines'] || []);

    const [extraTmrwCusts, tmrwLines] = await Promise.all([
      tmrwCustIds.length > 0
        ? db.list(TABLES.CUSTOMERS, {
            filterByFormula: `OR(${tmrwCustIds.map(id => `RECORD_ID() = "${id}"`).join(',')})`,
            fields: ['Name', 'Nickname'],
          }).catch(() => [])
        : [],
      tmrwLineIds.length > 0
        ? db.list(TABLES.ORDER_LINES, {
            filterByFormula: `OR(${tmrwLineIds.slice(0, 200).map(id => `RECORD_ID() = "${id}"`).join(',')})`,
            fields: ['Order', 'Flower Name', 'Quantity'],
            maxRecords: 500,
          }).catch(() => [])
        : [],
    ]);
    for (const c of extraTmrwCusts) customerMap[c.id] = c;

    // Build line summaries per order for tomorrow
    const tmrwLineSummary = {};
    for (const line of tmrwLines) {
      const oid = line.Order?.[0];
      if (!oid) continue;
      if (!tmrwLineSummary[oid]) tmrwLineSummary[oid] = { items: [], count: 0 };
      tmrwLineSummary[oid].items.push(`${line['Flower Name'] || '?'} ×${line.Quantity || 1}`);
      tmrwLineSummary[oid].count++;
    }

    for (const order of tomorrowOrders) {
      const custId = order.Customer?.[0];
      order['Customer Name'] = customerMap[custId]?.Name || customerMap[custId]?.Nickname || '';
      const summary = tmrwLineSummary[order.id];
      order['Line Summary'] = summary ? summary.items.join(', ') : '';
      order['Line Count'] = summary ? summary.count : 0;
    }

    // Order count by status
    const statusCounts = orders.reduce((acc, o) => {
      acc[o.Status] = (acc[o.Status] || 0) + 1;
      return acc;
    }, {});

    // Today's revenue from paid + partial orders (matching analytics.js filter)
    const todayRevenue = orders
      .filter((o) => o['Payment Status'] !== PAYMENT_STATUS.UNPAID)
      .reduce((sum, o) => sum + (o['Effective Price'] || 0), 0);

    // Unassigned = no driver AND method is 'Driver' (Florist/Taxi don't need a driver), not yet delivered
    const unassignedDeliveries = deliveries.filter(d =>
      !d['Assigned Driver'] &&
      (d['Delivery Method'] || 'Driver') === 'Driver' &&
      d.Status !== DELIVERY_STATUS.DELIVERED
    );

    // Bulk-fetch order lines for unpaid orders to calculate accurate sell totals.
    // Can't rely on 'Sell Price Total' rollup — it may be stale after price edits.
    const unpaidLineIds = unpaidOrders.flatMap(o => o['Order Lines'] || []);
    const unpaidLines = unpaidLineIds.length > 0
      ? await db.list(TABLES.ORDER_LINES, {
          filterByFormula: `OR(${unpaidLineIds.slice(0, 200).map(id => `RECORD_ID() = "${id}"`).join(',')})`,
          fields: ['Order', 'Sell Price Per Unit', 'Quantity'],
          maxRecords: 1000,
        }).catch(() => [])
      : [];
    const unpaidTotalByOrder = {};
    for (const line of unpaidLines) {
      const oid = line.Order?.[0];
      if (oid) {
        unpaidTotalByOrder[oid] = (unpaidTotalByOrder[oid] || 0)
          + Number(line['Sell Price Per Unit'] || 0) * Number(line['Quantity'] || 0);
      }
    }

    // Unpaid orders aging: group by how old they are relative to today
    const todayMs = new Date(today).getTime();
    const DAY_MS = 86400000;
    const unpaidAging = {
      today:  { count: 0, total: 0 },
      week:   { count: 0, total: 0 },
      month:  { count: 0, total: 0 },
      older:  { count: 0, total: 0 },
      grandTotal: { count: 0, total: 0 },
    };
    for (const o of unpaidOrders) {
      const orderDateMs = o['Order Date'] ? new Date(o['Order Date']).getTime() : todayMs;
      const daysOld = Math.floor((todayMs - orderDateMs) / DAY_MS);
      const sellTotal = unpaidTotalByOrder[o.id] || 0;
      const delFee = Number(o['Delivery Fee'] || 0);
      const effectivePrice = o['Final Price'] ?? ((o['Price Override'] || sellTotal) + delFee);
      const amt = Number(effectivePrice) || 0;

      let bucket;
      if (daysOld === 0) bucket = 'today';
      else if (daysOld <= 7) bucket = 'week';
      else if (daysOld <= 30) bucket = 'month';
      else bucket = 'older';

      unpaidAging[bucket].count++;
      unpaidAging[bucket].total += amt;
      unpaidAging.grandTotal.count++;
      unpaidAging.grandTotal.total += amt;
    }

    // Key date reminders: customers with Key Person 1 or 2 dates within next 7 days
    // Dates are anniversaries/birthdays — match month+day regardless of year
    const nowDate = new Date(today);
    const keyDateReminders = [];
    for (const c of customersWithDates) {
      const checks = [
        { personName: c['Key person 1 (Name + Contact details)'], date: c['Key person 1 (important DATE)'] },
        { personName: c['Key person 2 (Name + Contact details)'], date: c['Key person 2 (important DATE)'] },
      ];
      for (const { personName, date } of checks) {
        if (!date) continue;
        // Normalize to this year or next year — find nearest future occurrence
        const d = new Date(date);
        if (isNaN(d.getTime())) continue;
        let candidate = new Date(nowDate.getFullYear(), d.getMonth(), d.getDate());
        if (candidate < nowDate) candidate = new Date(nowDate.getFullYear() + 1, d.getMonth(), d.getDate());
        const daysUntil = Math.round((candidate.getTime() - nowDate.getTime()) / DAY_MS);
        if (daysUntil <= 7) {
          keyDateReminders.push({
            customerId: c.id,
            customerName: c.Name || c.Nickname || '—',
            keyPersonName: personName || '—',
            date: candidate.toISOString().split('T')[0],
            daysUntil,
          });
        }
      }
    }
    keyDateReminders.sort((a, b) => a.daysUntil - b.daysUntil);

    // Enrich pending deliveries with customer name (who ordered)
    // by following the chain: Delivery → Order → Customer.
    // We already have orders loaded, so we only need the link hop.
    const orderIdSet = new Set(orders.map(o => o.id));
    const orderMapForDeliveries = {};
    for (const o of orders) orderMapForDeliveries[o.id] = o;

    // Some pending deliveries may link to orders from other dates — fetch those too
    const missingOrderIds = deliveries
      .flatMap(d => d['Linked Order'] || [])
      .filter(id => !orderIdSet.has(id));

    if (missingOrderIds.length > 0) {
      const extraOrders = await db.list(TABLES.ORDERS, {
        filterByFormula: `OR(${missingOrderIds.map(id => `RECORD_ID() = "${id}"`).join(',')})`,
        fields: ['Customer'],
      });
      const extraCustIds = [...new Set(extraOrders.flatMap(o => o.Customer || []))];
      const extraCusts = extraCustIds.length > 0
        ? await db.list(TABLES.CUSTOMERS, {
            filterByFormula: `OR(${extraCustIds.map(id => `RECORD_ID() = "${id}"`).join(',')})`,
            fields: ['Name', 'Nickname'],
          })
        : [];
      for (const c of extraCusts) customerMap[c.id] = c;
      for (const o of extraOrders) orderMapForDeliveries[o.id] = o;
    }

    for (const d of deliveries) {
      const orderId = d['Linked Order']?.[0];
      const order = orderMapForDeliveries[orderId];
      const custId = order?.Customer?.[0];
      const cust = customerMap[custId];
      if (cust) {
        d['Customer Name'] = cust.Name || cust.Nickname || '';
      }
    }

    // Include deferred order lines as additional demand in "Flowers Needed".
    // Deferred lines have Stock Deferred = true — they signal "need to buy" without deducting stock.
    const deferredLines = await db.list(TABLES.ORDER_LINES, {
      filterByFormula: `AND({Stock Deferred} = TRUE())`,
      fields: ['Stock Item', 'Flower Name', 'Quantity', 'Order'],
      maxRecords: 500,
    }).catch(() => []);

    // Aggregate deferred demand by stock item: stockId → { name, qty, neededBy }
    const deferredDemand = {};
    if (deferredLines.length > 0) {
      // Fetch parent orders to get Required By dates and exclude cancelled orders
      const deferredOrderIds = [...new Set(deferredLines.flatMap(l => l.Order || []))];
      const deferredOrders = deferredOrderIds.length > 0
        ? await db.list(TABLES.ORDERS, {
            filterByFormula: `AND(OR(${deferredOrderIds.slice(0, 50).map(id => `RECORD_ID() = "${id}"`).join(',')}), {Status} != '${ORDER_STATUS.CANCELLED}')`,
            fields: ['Required By'],
          }).catch(() => [])
        : [];
      const deferredOrderMap = {};
      for (const o of deferredOrders) deferredOrderMap[o.id] = o;

      for (const line of deferredLines) {
        const stockId = line['Stock Item']?.[0];
        if (!stockId) continue;
        const orderId = line.Order?.[0];
        const parentOrder = deferredOrderMap[orderId];
        if (!parentOrder) continue; // order cancelled or not found
        const reqBy = parentOrder['Required By'] || null;

        if (!deferredDemand[stockId]) {
          deferredDemand[stockId] = { name: line['Flower Name'] || '?', qty: 0, neededBy: null };
        }
        deferredDemand[stockId].qty += Number(line.Quantity || 0);
        if (reqBy && (!deferredDemand[stockId].neededBy || reqBy < deferredDemand[stockId].neededBy)) {
          deferredDemand[stockId].neededBy = reqBy;
        }
      }
    }

    // Compute needed-by dates for negative stock items
    // For each negative item, find linked order lines → parent order → earliest Required By date
    let negativeStock = [];
    if (negativeStockItems.length > 0) {
      // Collect all order line IDs from negative stock items
      const negLineIds = negativeStockItems.flatMap(s => s['Order Lines'] || []);
      const negLines = negLineIds.length > 0
        ? await db.list(TABLES.ORDER_LINES, {
            filterByFormula: `OR(${negLineIds.slice(0, 100).map(id => `RECORD_ID() = "${id}"`).join(',')})`,
            fields: ['Order'],
            maxRecords: 200,
          }).catch(() => [])
        : [];

      // Get unique parent order IDs
      const parentOrderIds = [...new Set(negLines.flatMap(l => l.Order || []))];
      const parentOrders = parentOrderIds.length > 0
        ? await db.list(TABLES.ORDERS, {
            filterByFormula: `AND(OR(${parentOrderIds.slice(0, 50).map(id => `RECORD_ID() = "${id}"`).join(',')}), {Status} != '${ORDER_STATUS.CANCELLED}')`,
            fields: ['Required By', 'Order Lines'],
          }).catch(() => [])
        : [];

      // Build map: stockId → earliest neededBy
      const neededByMap = {};
      for (const order of parentOrders) {
        const reqBy = order['Required By'];
        if (!reqBy) continue;
        const orderLineIds = new Set(order['Order Lines'] || []);
        for (const si of negativeStockItems) {
          const siLineIds = si['Order Lines'] || [];
          if (siLineIds.some(lid => orderLineIds.has(lid))) {
            if (!neededByMap[si.id] || reqBy < neededByMap[si.id]) {
              neededByMap[si.id] = reqBy;
            }
          }
        }
      }

      // Group negative stock by Purchase Name (flower type) so batches merge into one demand line.
      // Like aggregating material demand across warehouse bins in MRP.
      const groupMap = new Map();
      for (const s of negativeStockItems) {
        const groupKey = s['Purchase Name'] || s['Display Name'];
        if (!groupMap.has(groupKey)) {
          groupMap.set(groupKey, {
            id: s.id,          // primary batch ID (for PO linking)
            batchIds: [],      // all batch IDs in this group
            name: groupKey,    // clean flower type name (no date suffix)
            qty: 0,
            neededBy: null,
            supplier: s.Supplier || null,
          });
        }
        const group = groupMap.get(groupKey);
        group.qty += s['Current Quantity'];
        group.batchIds.push(s.id);
        const nb = neededByMap[s.id];
        if (nb && (!group.neededBy || nb < group.neededBy)) group.neededBy = nb;
        if (!group.supplier && s.Supplier) group.supplier = s.Supplier;
      }
      negativeStock = [...groupMap.values()];
      negativeStock.sort((a, b) => {
        if (a.neededBy && b.neededBy) return a.neededBy.localeCompare(b.neededBy);
        if (a.neededBy) return -1;
        return 1;
      });
    }

    // Merge deferred demand into negativeStock list.
    // Match by batch ID (deferred items reference specific stock records within a group).
    for (const [stockId, demand] of Object.entries(deferredDemand)) {
      const existing = negativeStock.find(s => s.id === stockId || s.batchIds?.includes(stockId));
      if (existing) {
        existing.deferredQty = (existing.deferredQty || 0) + demand.qty;
        if (demand.neededBy && (!existing.neededBy || demand.neededBy < existing.neededBy)) {
          existing.neededBy = demand.neededBy;
        }
      } else {
        negativeStock.push({
          id: stockId,
          batchIds: [stockId],
          name: demand.name,
          qty: 0,  // not negative in stock, but has deferred demand
          deferredQty: demand.qty,
          neededBy: demand.neededBy,
          supplier: null,
        });
      }
    }
    // Re-sort after merging deferred items
    negativeStock.sort((a, b) => {
      if (a.neededBy && b.neededBy) return a.neededBy.localeCompare(b.neededBy);
      if (a.neededBy) return -1;
      return 1;
    });

    res.json({
      date: today,
      orderCount: orders.length,
      ordersDueToday: ordersDueToday.length,
      statusCounts,
      todayRevenue,
      pendingDeliveries: deliveries,
      unassignedDeliveries,
      unpaidAging,
      keyDateReminders,
      lowStockAlerts: lowStock,
      negativeStock,
      recentOrders: orders.slice(0, 10),
      fulfillToday,
      tomorrowOrders,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
