// lab/scripts/start-lab-backend.js — boot the backend against Docker PG.
//
// Mirrors backend/scripts/start-test-backend.js but points DATABASE_URL at
// the Docker container instead of pglite. Uses port 3003 to avoid clashing
// with the real local backend (3001) and the pglite harness (3002).
//
// Refuses to boot under NODE_ENV=production. The lab DSN talks to a local
// container, so the worst-case blast radius is wiping the local lab DB —
// not prod — but the production guard stays as belt-and-braces.

if (process.env.NODE_ENV === 'production') {
  console.error('[FATAL] Refusing to start lab backend under NODE_ENV=production.');
  process.exit(1);
}

const LAB_ENV = {
  NODE_ENV:                          process.env.NODE_ENV || 'test',
  DATABASE_URL:                      'postgres://lab:lab@localhost:5433/lab',
  PGSSL_DISABLE:                     'true',
  STOCK_BACKEND:                     'postgres',
  ORDER_BACKEND:                     'postgres',
  TEST_BACKEND:                      'mock-airtable',
  PORT:                              process.env.PORT || '3003',

  PIN_OWNER:                         '1111',
  PIN_FLORIST:                       '2222',
  PIN_DRIVER_TIMUR:                  '3333',
  PIN_DRIVER_NIKITA:                 '4444',

  // Airtable identity — mock backend ignores values, but config/airtable.js
  // initialises the SDK defensively. Mirror start-test-backend.js exactly.
  AIRTABLE_API_KEY:                  'lab-mock-key',
  AIRTABLE_BASE_ID:                  'appLabBase',
  AIRTABLE_CUSTOMERS_TABLE:          'tblLabCustomers',
  AIRTABLE_ORDERS_TABLE:             'tblLabOrders',
  AIRTABLE_ORDER_LINES_TABLE:        'tblLabOrderLines',
  AIRTABLE_STOCK_TABLE:              'tblLabStock',
  AIRTABLE_DELIVERIES_TABLE:         'tblLabDeliveries',
  AIRTABLE_STOCK_PURCHASES_TABLE:    'tblLabStockPurchases',
  AIRTABLE_STOCK_ORDERS_TABLE:       'tblLabStockOrders',
  AIRTABLE_STOCK_ORDER_LINES_TABLE:  'tblLabStockOrderLines',
  AIRTABLE_PRODUCT_CONFIG_TABLE:     'tblLabProductConfig',
  AIRTABLE_SYNC_LOG_TABLE:           'tblLabSyncLog',
  AIRTABLE_APP_CONFIG_TABLE:         'tblLabAppConfig',
  AIRTABLE_FLORIST_HOURS_TABLE:      'tblLabFloristHours',
  AIRTABLE_WEBHOOK_LOG_TABLE:        'tblLabWebhookLog',
  AIRTABLE_MARKETING_SPEND_TABLE:    'tblLabMarketingSpend',
  AIRTABLE_STOCK_LOSS_LOG_TABLE:     'tblLabStockLossLog',
  AIRTABLE_LEGACY_ORDERS_TABLE:      'tblLabLegacyOrders',
  AIRTABLE_PREMADE_BOUQUETS_TABLE:   'tblLabPremadeBouquets',
  AIRTABLE_PREMADE_BOUQUET_LINES_TABLE: 'tblLabPremadeBouquetLines',

  // Third-party stubs — same pattern as start-test-backend.js.
  ANTHROPIC_API_KEY:                 'lab-mock-anthropic',
  TELEGRAM_BOT_TOKEN:                'lab-mock-telegram',
  WIX_WEBHOOK_SECRET:                'lab-mock-wix-secret',
  WIX_API_KEY:                       'lab-mock-wix-api-key',
  WIX_SITE_ID:                       'lab-mock-wix-site-id',
};

for (const [k, v] of Object.entries(LAB_ENV)) {
  if (process.env[k] === undefined) process.env[k] = v;
}

console.log('[LAB] Booting backend against', process.env.DATABASE_URL, 'on :' + process.env.PORT);

await import('../../backend/src/index.js');
