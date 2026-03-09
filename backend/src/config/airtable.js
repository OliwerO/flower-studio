import Airtable from 'airtable';

// Airtable client — equivalent to a warehouse management system login.
// All table references are built here from env vars so routes never hardcode IDs.
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

export const TABLES = {
  CUSTOMERS:       process.env.AIRTABLE_CUSTOMERS_TABLE,
  ORDERS:          process.env.AIRTABLE_ORDERS_TABLE,
  ORDER_LINES:     process.env.AIRTABLE_ORDER_LINES_TABLE,
  STOCK:           process.env.AIRTABLE_STOCK_TABLE,
  DELIVERIES:      process.env.AIRTABLE_DELIVERIES_TABLE,
  STOCK_PURCHASES: process.env.AIRTABLE_STOCK_PURCHASES_TABLE,
  LEGACY_ORDERS:   process.env.AIRTABLE_LEGACY_ORDERS_TABLE,
  WEBHOOK_LOG:     process.env.AIRTABLE_WEBHOOK_LOG_TABLE,
  MARKETING_SPEND: process.env.AIRTABLE_MARKETING_SPEND_TABLE,
  STOCK_LOSS_LOG:  process.env.AIRTABLE_STOCK_LOSS_LOG_TABLE,
};

export default base;
