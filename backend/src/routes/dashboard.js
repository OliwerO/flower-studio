import { Router } from 'express';
import { authorize } from '../middleware/auth.js';
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';
import { sanitizeFormulaValue } from '../utils/sanitize.js';

const router = Router();
router.use(authorize('dashboard'));

// GET /api/dashboard — day-to-day operational summary for today
router.get('/', async (req, res, next) => {
  try {
    // Accept optional ?date= param, default to today
    const today = sanitizeFormulaValue(req.query.date || new Date().toISOString().split('T')[0]);

    const [orders, deliveries, lowStock, unpaidOrders, negativeStockItems, customersWithDates] = await Promise.all([
      // Today's orders
      db.list(TABLES.ORDERS, {
        filterByFormula: `DATESTR({Order Date}) = '${today}'`,
        sort: [{ field: 'Order Date', direction: 'desc' }],
      }),
      // Today's pending deliveries (all statuses — we filter below)
      db.list(TABLES.DELIVERIES, {
        filterByFormula: `AND(DATESTR({Delivery Date}) = '${today}', {Status} != 'Delivered')`,
      }),
      // Stock items below reorder threshold
      db.list(TABLES.STOCK, {
        filterByFormula: `AND({Active} = TRUE(), {Current Quantity} < {Reorder Threshold})`,
        sort: [{ field: 'Current Quantity', direction: 'asc' }],
      }),
      // All unpaid/partial non-cancelled orders for aging calculation
      // Don't restrict fields — 'Final Price' is a formula field that may not exist in all bases
      db.list(TABLES.ORDERS, {
        filterByFormula: `AND(OR({Payment Status} = 'Unpaid', {Payment Status} = 'Partial'), {Status} != 'Cancelled')`,
      }),
      // Active stock items with negative quantity
      db.list(TABLES.STOCK, {
        filterByFormula: `AND({Active} = TRUE(), {Current Quantity} < 0)`,
        fields: ['Display Name', 'Current Quantity', 'Supplier', 'Order Lines'],
      }).catch(() => []),
      // Customers with key person dates set for upcoming reminders
      // Wrapped in catch — these fields may not exist in all Airtable bases
      db.list(TABLES.CUSTOMERS, {
        filterByFormula: `OR({Key person 1 (important DATE)} != '', {Key person 2 (important DATE)} != '')`,
        fields: ['Name', 'Nickname', 'Key person 1 (Name + Contact details)', 'Key person 1 (important DATE)', 'Key person 2 (Name + Contact details)', 'Key person 2 (important DATE)'],
      }).catch(() => []),
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
          })
        : [],
      allLineIds.length > 0
        ? db.list(TABLES.ORDER_LINES, {
            filterByFormula: `OR(${allLineIds.map(id => `RECORD_ID() = "${id}"`).join(',')})`,
            fields: ['Order', 'Sell Price Per Unit', 'Quantity'],
            maxRecords: 1000,
          })
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
      if (!order['Price Override'] && totalByOrder[order.id] != null) {
        order['Sell Total'] = totalByOrder[order.id];
      }
      const deliveryFee = Number(order['Delivery Fee'] || 0);
      order['Effective Price'] = order['Final Price']
        ?? order['Price Override']
        ?? ((order['Sell Total'] || 0) + deliveryFee);
    }

    // Order count by status
    const statusCounts = orders.reduce((acc, o) => {
      acc[o.Status] = (acc[o.Status] || 0) + 1;
      return acc;
    }, {});

    // Today's revenue from paid + partial orders (matching analytics.js filter)
    const todayRevenue = orders
      .filter((o) => o['Payment Status'] !== 'Unpaid')
      .reduce((sum, o) => sum + (o['Effective Price'] || 0), 0);

    // Unassigned deliveries: pending deliveries with no driver assigned
    const unassignedDeliveries = deliveries.filter(d => !d['Assigned Driver'] && d.Status !== 'Delivered');

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
      const sellTotal = Number(o['Sell Price Total'] || 0);
      const delFee = Number(o['Delivery Fee'] || 0);
      const effectivePrice = o['Final Price'] ?? o['Price Override'] ?? (sellTotal + delFee);
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
            filterByFormula: `AND(OR(${deferredOrderIds.slice(0, 50).map(id => `RECORD_ID() = "${id}"`).join(',')}), {Status} != 'Cancelled')`,
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
            filterByFormula: `AND(OR(${parentOrderIds.slice(0, 50).map(id => `RECORD_ID() = "${id}"`).join(',')}), {Status} != 'Cancelled')`,
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

      negativeStock = negativeStockItems.map(s => ({
        id: s.id,
        name: s['Display Name'],
        qty: s['Current Quantity'],
        neededBy: neededByMap[s.id] || null,
        supplier: s.Supplier || null,
      }));
      negativeStock.sort((a, b) => {
        if (a.neededBy && b.neededBy) return a.neededBy.localeCompare(b.neededBy);
        if (a.neededBy) return -1;
        return 1;
      });
    }

    // Merge deferred demand into negativeStock list.
    // Items already negative get their deferred qty added; new deferred-only items are appended.
    for (const [stockId, demand] of Object.entries(deferredDemand)) {
      const existing = negativeStock.find(s => s.id === stockId);
      if (existing) {
        existing.deferredQty = demand.qty;
        if (demand.neededBy && (!existing.neededBy || demand.neededBy < existing.neededBy)) {
          existing.neededBy = demand.neededBy;
        }
      } else {
        negativeStock.push({
          id: stockId,
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
      statusCounts,
      todayRevenue,
      pendingDeliveries: deliveries,
      unassignedDeliveries,
      unpaidAging,
      keyDateReminders,
      lowStockAlerts: lowStock,
      negativeStock,
      recentOrders: orders.slice(0, 10),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
