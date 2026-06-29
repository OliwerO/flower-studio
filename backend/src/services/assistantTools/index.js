// backend/src/services/assistantTools/index.js
import { queryOrdersHandler, breakdownOrdersHandler } from './ordersPack.js';
import { financialSummaryHandler } from './financePack.js';
import { stockStatusHandler, stockWriteoffsHandler } from './stockPack.js';
import { customerInsightsHandler, customerLookupHandler } from './customersPack.js';
import { deliveryStatusHandler } from './deliveriesPack.js';
import { poStatusHandler, purchaseSpendHandler } from './purchasingPack.js';
import { hoursSummaryHandler } from './hoursPack.js';

// Each pack pushes { name, description, input_schema, handler }. Adding a domain = add a file + import + push here.
export const TOOLS = [
  {
    name: 'query_orders',
    description: 'Count and list orders in a date range with optional filters. Aggregate count is over the FULL match; the orders list may be capped (see truncated/shown). Use for "how many orders", "show me orders". Dates are YYYY-MM-DD.',
    input_schema: {
      type: 'object',
      properties: {
        dateField: { type: 'string', enum: ['order', 'delivery'], description: "Filter by order placement date ('order') or required-by/delivery date ('delivery'). Default 'order'." },
        from: { type: 'string', description: 'Start date YYYY-MM-DD (inclusive).' },
        to: { type: 'string', description: 'End date YYYY-MM-DD (inclusive).' },
        status: { type: 'string', description: 'Exact order status, e.g. New, Ready, Delivered, Picked Up, Cancelled. Cancelled orders are excluded unless this is set.' },
        deliveryType: { type: 'string', enum: ['Delivery', 'Pickup'] },
        source: { type: 'string', description: 'Order Source: In-store, Instagram, WhatsApp, Telegram, Wix, Flowwow, Other.' },
        paymentStatus: { type: 'string', enum: ['Unpaid', 'Partial', 'Paid'] },
        paymentMethod: { type: 'string', enum: ['Cash', 'Card', 'Transfer'] },
        customerId: { type: 'string' },
      },
    },
    handler: queryOrdersHandler,
  },
  {
    name: 'breakdown_orders',
    description: 'Group orders in a date range by one dimension and return counts per group. Use for "how does it break down by delivery/pickup/source/status/payment". Cancelled orders are excluded. For revenue breakdowns use financial_summary instead.',
    input_schema: {
      type: 'object',
      properties: {
        dimension: { type: 'string', enum: ['deliveryType', 'source', 'status', 'paymentStatus', 'paymentMethod'] },
        dateField: { type: 'string', enum: ['order', 'delivery'] },
        from: { type: 'string', description: 'YYYY-MM-DD' },
        to: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['dimension'],
    },
    handler: breakdownOrdersHandler,
  },
  {
    name: 'financial_summary',
    description: 'Revenue and money figures for a date range: total revenue, flower vs delivery revenue, average order value, revenue per Order Source, flower margin %. Use for any "how much revenue/money/margin" question and for revenue (not count) breakdowns. Dates YYYY-MM-DD.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'YYYY-MM-DD' },
        to: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['from', 'to'],
    },
    handler: financialSummaryHandler,
  },
  {
    name: 'stock_status',
    description: "Current stock levels by item. Each item reports its available quantity (Current Quantity — already net of committed demand) and whether it is in shortfall (quantity < 0, meaning more stems are owed to orders than are on hand — buy more). shortfallOnly=true returns ONLY items in shortfall. search filters by item name. Use for 'what's running low', 'what's negative', 'how many <flower> do I have', 'what do I need to order'.",
    input_schema: {
      type: 'object',
      properties: {
        shortfallOnly: { type: 'boolean', description: 'When true, return only items with negative quantity (shortfall).' },
        search: { type: 'string', description: 'Filter to stock items whose display name matches this text.' },
        limit: { type: 'number', description: 'Max items to list (the counts are always over the full match).' },
      },
    },
    handler: stockStatusHandler,
  },
  {
    name: 'stock_writeoffs',
    description: "Write-offs (stems lost to waste/damage) in a date range: total quantity + a breakdown by reason. Use for 'how much did I write off', 'how much waste this month', 'why did I lose stems'. Dates YYYY-MM-DD.",
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date YYYY-MM-DD (inclusive).' },
        to: { type: 'string', description: 'End date YYYY-MM-DD (inclusive).' },
      },
    },
    handler: stockWriteoffsHandler,
  },
  {
    name: 'customer_insights',
    description: "Customer analytics for a date range: new vs returning customer counts, segment distribution, and the top spenders (by paid revenue). Use for 'how many new customers', 'returning vs new', 'who are my best/top customers', 'customer segments'. Dates YYYY-MM-DD.",
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'YYYY-MM-DD' },
        to: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['from', 'to'],
    },
    handler: customerInsightsHandler,
  },
  {
    name: 'customer_lookup',
    description: "Look up specific customers by name, nickname, phone, or contact detail (substring, case-insensitive). Returns each match with their segment, lifetime order count, total spend, last order date, and key people (with important dates). Use for 'tell me about <name>', 'how much has <name> spent', 'when did <name> last order', 'what's <name>'s birthday'.",
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Full or partial customer name to search for.' },
        limit: { type: 'number', description: 'Max matches to return (default 10).' },
      },
      required: ['name'],
    },
    handler: customerLookupHandler,
  },
  {
    name: 'delivery_status',
    description: 'Operational delivery view from the deliveries table: counts by status (Pending / Out for Delivery / Delivered / Cancelled) and by driver over an optional date range, plus a sample list. Use for "how many deliveries", "deliveries by driver", delivery completion. NOT for delivery-vs-pickup revenue (use financial_summary).',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date YYYY-MM-DD (optional)' },
        to: { type: 'string', description: 'End date YYYY-MM-DD (optional)' },
        status: { type: 'string', description: 'Filter to one delivery status (optional)' },
        driver: { type: 'string', description: 'Filter to one driver name (optional)' },
        limit: { type: 'number', description: 'Max sample rows (optional, capped at 25)' },
      },
    },
    handler: deliveryStatusHandler,
  },
  {
    name: 'po_status',
    description: 'Purchase-order workflow status: counts of POs by status (Draft / Sent / Shopping / Reviewing / Evaluating / Complete), open vs complete totals, and a sample list. Use for "how many open purchase orders", PO pipeline questions.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter to one PO status (optional)' },
        limit: { type: 'number', description: 'Max sample rows (optional, capped at 25)' },
      },
    },
    handler: poStatusHandler,
  },
  {
    name: 'purchase_spend',
    description: 'Actual flower purchase spend over a date range (recorded supplier purchases): total in złoty and a by-supplier breakdown. Use for "how much did I spend on flowers in May", supplier spend.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date YYYY-MM-DD' },
        to: { type: 'string', description: 'End date YYYY-MM-DD' },
      },
      required: ['from', 'to'],
    },
    handler: purchaseSpendHandler,
  },
  {
    name: 'hours_summary',
    description: "Florist hours, pay rates + payroll. Returns each florist's configured hourly pay rate(s) — a flat number or a per-Rate-Type map (Standard / Wedding / Holidays), e.g. Sasha may earn more for weddings — plus hours, earnings (złoty), and delivery counts per florist and grand totals. Florists with configured rates but no logged hours are still listed (rates only). Use for \"what are the florist pay rates\", \"what is Sasha's rate\", \"how many hours did each florist work\", payroll / labor-cost questions. Omit from/to for current rates / all-time; pass them to scope hours + earnings to a period.",
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date YYYY-MM-DD (optional — omit for current rates / all-time)' },
        to: { type: 'string', description: 'End date YYYY-MM-DD (optional — omit for current rates / all-time)' },
        name: { type: 'string', description: 'Filter to one florist name (optional)' },
      },
    },
    handler: hoursSummaryHandler,
  },
];

export const TOOL_HANDLERS = Object.fromEntries(TOOLS.map(t => [t.name, t.handler]));
export const TOOL_DEFS = TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
