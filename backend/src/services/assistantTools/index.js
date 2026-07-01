// backend/src/services/assistantTools/index.js
import { queryOrdersHandler, breakdownOrdersHandler } from './ordersPack.js';
import { financialSummaryHandler } from './financePack.js';
import { queryRecordsHandler, ordersNeedingShortStockHandler } from './dataQueryPack.js';
import { stockStatusHandler, stockWriteoffsHandler } from './stockPack.js';
import { customerInsightsHandler, customerLookupHandler } from './customersPack.js';
import { deliveryStatusHandler } from './deliveriesPack.js';
import { poStatusHandler, purchaseSpendHandler } from './purchasingPack.js';
import { hoursSummaryHandler } from './hoursPack.js';
import { topProductsHandler, channelEfficiencyHandler, comparePeriodsHandler } from './financeInsightsPack.js';
import { salesTrendsHandler } from './trendsPack.js';
import { supplierScorecardHandler } from './supplierPack.js';
import { marketingSpendHandler } from './marketingPack.js';
import { stockVelocityHandler } from './velocityPack.js';
import { lapsedCustomersHandler, upcomingOccasionsHandler } from './crmPack.js';
import { searchTextHandler } from './freeTextPack.js';
import { purchaseDetailHandler } from './purchaseDetailPack.js';
import { listValuesHandler } from './discoveryPack.js';
import { openOrdersViewHandler } from './ordersViewPack.js';

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
    description: "Write-offs (stems lost to waste/damage) in a date range: total quantity, the MONEY value lost (totalLostValue, in zł — quantity × each batch's cost), a breakdown by reason (wilted/broken/damaged/etc.), and a breakdown by flower (most-wasted first; each entry has both quantity AND lostValue in zł). Use for 'how much did I write off', 'how much waste this month', 'why did I lose stems', 'which flowers were wasted most', 'what flower do I waste the most', AND money questions: 'how much money did I lose to waste', 'what did waste cost me by flower', 'which flower wasted the most money', 'value lost to wilting'. `unvaluedQuantity` = stems with no linked stock/cost, excluded from the money totals. Pass `reason` to look at only one reason (e.g. only wilted or only broken). Dates YYYY-MM-DD.",
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date YYYY-MM-DD (inclusive).' },
        to: { type: 'string', description: 'End date YYYY-MM-DD (inclusive).' },
        reason: { type: 'string', description: 'Optional. Only count write-offs with this reason (case-insensitive exact match), e.g. "wilted" or "broken".' },
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
  {
    name: 'top_products',
    description: 'Best-selling products/flowers in a date range with revenue, quantity, and trend vs the previous equal-length period. Use for "best sellers", "top products", "what\'s selling", "what\'s declining". Dates YYYY-MM-DD.',
    input_schema: {
      type: 'object',
      properties: {
        from:  { type: 'string', description: 'Start date YYYY-MM-DD (inclusive).' },
        to:    { type: 'string', description: 'End date YYYY-MM-DD (inclusive).' },
        limit: { type: 'number', description: 'Max products to return (default 10).' },
      },
      required: ['from', 'to'],
    },
    handler: topProductsHandler,
  },
  {
    name: 'channel_efficiency',
    description: 'Per-Order-Source PROFITABILITY: order count, average order value, and margin% per channel (In-store/Instagram/WhatsApp/Telegram/Wix/Flowwow/Other). Use for "which channel is most profitable", "is Instagram worth it after cost". For raw revenue per source use financial_summary; for ad spend use marketing_spend.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date YYYY-MM-DD.' },
        to:   { type: 'string', description: 'End date YYYY-MM-DD.' },
      },
      required: ['from', 'to'],
    },
    handler: channelEfficiencyHandler,
  },
  {
    name: 'compare_periods',
    description: 'Compare two date ranges head-to-head: revenue, order count, avg order value, flower margin% with delta + % change. Use for "is May better than April", "this month vs last month", "vs last year".',
    input_schema: {
      type: 'object',
      properties: {
        from1:  { type: 'string', description: 'Start of first period YYYY-MM-DD.' },
        to1:    { type: 'string', description: 'End of first period YYYY-MM-DD.' },
        from2:  { type: 'string', description: 'Start of second period YYYY-MM-DD.' },
        to2:    { type: 'string', description: 'End of second period YYYY-MM-DD.' },
        label1: { type: 'string', description: 'Human label for period 1 (optional, e.g. "April").' },
        label2: { type: 'string', description: 'Human label for period 2 (optional, e.g. "May").' },
      },
      required: ['from1', 'to1', 'from2', 'to2'],
    },
    handler: comparePeriodsHandler,
  },
  {
    name: 'sales_trends',
    description: 'Trends & rhythm for a date range: month-by-month revenue (seasonality), busiest day of week (orders + avg revenue), completion/cancellation funnel, and payment-method analysis incl. outstanding unpaid amounts. Use for "busiest day", "how\'s the month trending", "how many orders cancel", "who owes me money / outstanding by payment method", planning peak days.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date YYYY-MM-DD.' },
        to:   { type: 'string', description: 'End date YYYY-MM-DD.' },
      },
      required: ['from', 'to'],
    },
    handler: salesTrendsHandler,
  },
  {
    name: 'supplier_scorecard',
    description: 'Per-supplier scorecard for a date range: total spend, purchase count, avg price/unit, and WASTE quantity/cost/percent. Use for "which supplier wastes most / has best quality", "where do I spend most on flowers". Dates YYYY-MM-DD.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date YYYY-MM-DD.' },
        to:   { type: 'string', description: 'End date YYYY-MM-DD.' },
      },
      required: ['from', 'to'],
    },
    handler: supplierScorecardHandler,
  },
  {
    name: 'marketing_spend',
    description: 'Advertising/marketing spend by channel over a MONTH range (dates are YYYY-MM, e.g. 2026-05). Total + per-channel. Use for "how much did I spend on Instagram ads", "marketing spend this quarter". Channel is free text and does NOT map 1:1 to Order Source, so do not claim a precise ROAS — combine with financial_summary/channel_efficiency and note the caveat.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start month YYYY-MM (inclusive, optional).' },
        to:   { type: 'string', description: 'End month YYYY-MM (inclusive, optional).' },
      },
    },
    handler: marketingSpendHandler,
  },
  {
    name: 'stock_velocity',
    description: 'Fastest/slowest-moving stock over a lookback window (default 30 days): quantity sold, average daily usage, current quantity, and days of supply. Use for "what\'s moving fastest", "what\'s been sitting / slow movers", "what do I need to reorder soon". Only flowers linked to a stock item are tracked. sort=fastest|slowest.',
    input_schema: {
      type: 'object',
      properties: {
        days:   { type: 'number', description: 'Lookback window in days (default 30, max 90).' },
        sort:   { type: 'string', enum: ['fastest', 'slowest'], description: 'Sort order: fastest (default) or slowest.' },
        limit:  { type: 'number', description: 'Max items to return (default 20, max 50).' },
        search: { type: 'string', description: 'Case-insensitive substring to filter by stock item name.' },
      },
    },
    handler: stockVelocityHandler,
  },
  {
    name: 'lapsed_customers',
    description: 'Customers who have not ordered in the last N days (default 60), with last order date, days since, lifetime orders + spend, and segment. Use for "who hasn\'t ordered recently", "who should I send a discount / win-back". Never-ordered customers are excluded.',
    input_schema: {
      type: 'object',
      properties: {
        sinceDays: { type: 'number', description: 'Days of inactivity threshold (default 60).' },
        limit:     { type: 'number', description: 'Max customers to return (default 25, max 100).' },
      },
    },
    handler: lapsedCustomersHandler,
  },
  {
    name: 'upcoming_occasions',
    description: 'Key people (a customer\'s important contacts) with a birthday/anniversary or other important date coming up within N days (default 14). Use for "whose birthday is this week", "upcoming anniversaries", outreach reminders. Returns the person, the occasion label, the date, days until, and the customer to contact.',
    input_schema: {
      type: 'object',
      properties: {
        withinDays: { type: 'number', description: 'Look-ahead window in days (default 14).' },
      },
    },
    handler: upcomingOccasionsHandler,
  },
  {
    name: 'search_text',
    description:
      'Search the free-text the owner/florists typed on records — card messages, ' +
      'customer requests, and florist notes. Use for "find the order that mentions X", ' +
      '"which orders talk about a wedding", "any order where the customer asked for blue hydrangeas", ' +
      '"find all notes about late delivery". Returns matching snippets + the record to open; ' +
      'it does not invent text that is not in a snippet. ' +
      'scope="orders" (default "all") to restrict to orders.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Word or phrase to search for (case-insensitive substring match).',
        },
        scope: {
          type: 'string',
          enum: ['orders', 'customers', 'all'],
          description: "Which records to search. 'orders' (default) searches order free-text fields. 'customers' has no text fields yet. 'all' covers both.",
        },
        limit: {
          type: 'number',
          description: `Max order rows to inspect (default ${15}, max ${50}).`,
        },
      },
      required: ['query'],
    },
    handler: searchTextHandler,
  },
  {
    name: 'query_records',
    description:
      'Flexible cross-entity lookup the fixed tools cannot express: filter, join, group, and aggregate ' +
      'orders, customers, order_lines, stock, purchases, writeoffs, deliveries, and marketing by any ' +
      'allow-listed field. ' +
      'PREFER the dedicated tools (query_orders, financial_summary, stock_status, customer_lookup, etc.) ' +
      'for their intended cases — use query_records ONLY when no dedicated tool fits the question. ' +
      'You compose a structured declarative spec; you NEVER write SQL. ' +
      'Cancelled orders are excluded unless includeCancelled=true. ' +
      'Allowed entities: orders, customers, order_lines, stock, purchases (supplier flower purchases), ' +
      'writeoffs (waste log), deliveries (driver assignments/status), marketing (ad spend by month/channel). ' +
      'Allowed ops: eq, ne, lt, lte, gt, gte, in, like, isNull, isNotNull. ' +
      'Allowed aggregate fns: count, sum, avg, min, max.',
    input_schema: {
      type: 'object',
      properties: {
        entity: {
          type: 'string',
          enum: ['orders', 'customers', 'order_lines', 'stock', 'purchases', 'writeoffs', 'deliveries', 'marketing'],
          description: 'Primary table to query.',
        },
        filters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string', description: 'Allow-listed field name on the entity (or a joined entity).' },
              op:    { type: 'string', description: 'Operator: eq|ne|lt|lte|gt|gte|in|like|isNull|isNotNull.' },
              value: { description: 'Value for the comparison (omit for isNull/isNotNull; array for in).' },
            },
            required: ['field', 'op'],
          },
          description: 'Array of filter conditions (ANDed together).',
        },
        join: {
          type: 'array',
          items: { type: 'string' },
          description: 'Allow-listed join names to include. orders joins: customer, lines, delivery. customers joins: orders. order_lines joins: stock. purchases joins: stock. writeoffs joins: stock. deliveries joins: order.',
        },
        groupBy: {
          type: 'array',
          items: { type: 'string' },
          description: 'Field names to group by.',
        },
        aggregate: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              fn:    { type: 'string', description: 'count|sum|avg|min|max' },
              field: { type: 'string', description: 'Field to aggregate (omit for count(*)).' },
              as:    { type: 'string', description: 'Alias for the result column.' },
            },
            required: ['fn', 'as'],
          },
        },
        sort: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              dir:   { type: 'string', enum: ['asc', 'desc'] },
            },
            required: ['field'],
          },
        },
        limit: {
          type: 'number',
          description: 'Max rows to return (hard cap is 200).',
        },
        includeCancelled: {
          type: 'boolean',
          description: 'When true, include Cancelled orders (default: excluded).',
        },
      },
      required: ['entity'],
    },
    handler: queryRecordsHandler,
  },
  {
    name: 'orders_needing_short_stock',
    description:
      'Open (non-terminal, non-cancelled) orders whose bouquet uses a flower currently in shortfall ' +
      '(stock.currentQuantity < 0). The canonical "connect the dots" query: which open orders am I at risk ' +
      'of not fulfilling because I\'m short on a flower? Returns each order\'s id, requiredBy, status, and ' +
      'the short flower name(s). Use for "which orders are at risk", "what can\'t I fulfill today".',
    input_schema: { type: 'object', properties: {} },
    handler: ordersNeedingShortStockHandler,
  },
  {
    name: 'purchase_detail',
    description:
      'Individual flower purchases (PO receipt lines), not just per-supplier totals. Use for "what did I pay ' +
      '<supplier>", "on which days did we buy from <supplier>", "what flowers did we buy from <supplier>" — ' +
      'anything that needs the underlying transactions, not just financial_summary/purchase_spend\'s aggregate. ' +
      'Filter by supplier and/or flower name (both case-insensitive contains); date range is YYYY-MM-DD. ' +
      'Returns totals plus a by-date and by-flower breakdown (always over the FULL match) and a capped list of ' +
      'individual transactions.',
    input_schema: {
      type: 'object',
      properties: {
        supplier: { type: 'string', description: 'Filter to purchases whose Supplier contains this text (case-insensitive).' },
        flower: { type: 'string', description: 'Filter to purchases whose linked stock item display name contains this text (case-insensitive).' },
        from: { type: 'string', description: 'Start purchase date YYYY-MM-DD (inclusive).' },
        to: { type: 'string', description: 'End purchase date YYYY-MM-DD (inclusive).' },
        limit: { type: 'number', description: 'Max transactions to list (default/hard cap 200). Totals/byDate/byFlower are never capped.' },
      },
    },
    handler: purchaseDetailHandler,
  },
  {
    name: 'list_values',
    description:
      'Discover the real distinct stored values (with counts) for a known dimension field. ' +
      'Call this FIRST whenever the owner names an entity/value you cannot confidently resolve ' +
      '(a supplier, payment method, order source, write-off reason, or driver name) — never guess ' +
      'spelling or which entity a name belongs to (e.g. "Stefan" could be a driver, not a customer; ' +
      '"Stripe" only matches if it is a real stored Payment Method string). Returns the actual values ' +
      'so you can filter/query correctly instead of returning 0 results or misrouting.',
    input_schema: {
      type: 'object',
      properties: {
        field: {
          type: 'string',
          enum: ['suppliers', 'paymentMethods', 'sources', 'lossReasons', 'drivers'],
          description:
            'suppliers: stock_purchases.supplier. paymentMethods/sources: orders.payment_method/orders.source. ' +
            'lossReasons: stock_loss_log.reason. drivers: deliveries.assigned_driver.',
        },
      },
      required: ['field'],
    },
    handler: listValuesHandler,
  },
  {
    name: 'open_orders_view',
    description: "Signal the UI to open the Orders screen pre-filtered. Does not return order data — the caller renders an 'Open in Orders' action from this tool's output. Use this after answering a question about orders when the owner would plausibly want to see the underlying list.",
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        source: { type: 'string' },
        deliveryType: { type: 'string' },
        paymentStatus: { type: 'string' },
        paymentMethod: { type: 'string' },
        excludeCancelled: { type: 'boolean' },
        orderDateFrom: { type: 'string', description: 'YYYY-MM-DD' },
        orderDateTo: { type: 'string', description: 'YYYY-MM-DD' },
        requiredByFrom: { type: 'string', description: 'YYYY-MM-DD' },
        requiredByTo: { type: 'string', description: 'YYYY-MM-DD' },
        orderIdQuery: { type: 'string' },
        customerQuery: { type: 'string' },
        bouquetQuery: { type: 'string' },
        priceMin: { type: 'number' },
        priceMax: { type: 'number' },
        label: { type: 'string', description: "Short Russian phrase describing what's filtered, shown on the button, e.g. 'Заказы без оплаты за июнь'" },
      },
      additionalProperties: false,
    },
    handler: openOrdersViewHandler,
  },
];

export const TOOL_HANDLERS = Object.fromEntries(TOOLS.map(t => [t.name, t.handler]));
export const TOOL_DEFS = TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
