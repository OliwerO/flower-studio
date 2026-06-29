// backend/src/services/assistantTools/index.js
import { queryOrdersHandler, breakdownOrdersHandler } from './ordersPack.js';

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
];

export const TOOL_HANDLERS = Object.fromEntries(TOOLS.map(t => [t.name, t.handler]));
export const TOOL_DEFS = TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
