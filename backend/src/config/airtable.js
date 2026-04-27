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
  STOCK_ORDERS:      process.env.AIRTABLE_STOCK_ORDERS_TABLE,
  STOCK_ORDER_LINES: process.env.AIRTABLE_STOCK_ORDER_LINES_TABLE,
  PRODUCT_CONFIG:  process.env.AIRTABLE_PRODUCT_CONFIG_TABLE,
  SYNC_LOG:        process.env.AIRTABLE_SYNC_LOG_TABLE,
  APP_CONFIG:      process.env.AIRTABLE_APP_CONFIG_TABLE,
  FLORIST_HOURS:   process.env.AIRTABLE_FLORIST_HOURS_TABLE,
  PREMADE_BOUQUETS:      process.env.AIRTABLE_PREMADE_BOUQUETS_TABLE,
  PREMADE_BOUQUET_LINES: process.env.AIRTABLE_PREMADE_BOUQUET_LINES_TABLE,
  STOCK_LEDGER:    process.env.AIRTABLE_STOCK_LEDGER_TABLE,
};

export default base;
