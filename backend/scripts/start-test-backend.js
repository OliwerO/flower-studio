// start-test-backend.js — one-command harness boot.
//
//   node backend/scripts/start-test-backend.js
//
// Sets the env vars that flip every relevant subsystem into test mode:
//   - TEST_BACKEND=mock-airtable     → services/airtable.js loads the mock
//   - DATABASE_URL=pglite:memory     → db/index.js boots pglite + applies migrations
//   - STOCK_BACKEND=postgres         → stockRepo writes to PG (cutover path exercised)
//   - ORDER_BACKEND=postgres         → orderRepo writes to PG when implemented
//   - AIRTABLE_*                     → dummy values (the mock ignores them, but
//                                       config/airtable.js is imported lazily
//                                       through the shim only in real mode, so
//                                       these are mostly for safety)
//   - AIRTABLE_*_TABLE               → the table ids the JSON fixture is keyed by
//   - PIN_OWNER / PIN_FLORIST / PIN_DRIVER_TIMUR / PIN_DRIVER_NIKITA → known test PINs
//
// Refuses to boot when NODE_ENV=production (stacked with the same guard
// inside airtable.js + db/index.js — three layers).
//
// Why this lives in backend/scripts/ and not at repo root: it's a backend
// concern (it spawns the backend), and it's easier to discover next to
// backfill-stock.js / simulate-stock.js. Playwright's `webServer` config
// invokes it via `node backend/scripts/start-test-backend.js`.

if (process.env.NODE_ENV === 'production') {
  console.error('[FATAL] Refusing to start test backend under NODE_ENV=production.');
  process.exit(1);
}

// ── Force-set the test env vars BEFORE importing anything that reads them. ──
//
// Order matters: services/airtable.js, db/index.js, and middleware/auth.js
// all sample process.env at module load. We set the vars first, then
// dynamically import the entry point so the imports see the test values.

const TEST_ENV = {
  NODE_ENV:                          process.env.NODE_ENV || 'test',
  TEST_BACKEND:                      'mock-airtable',
  DATABASE_URL:                      'pglite:memory',
  STOCK_BACKEND:                     'postgres',
  ORDER_BACKEND:                     'airtable', // orderRepo is still skeleton; flip when impl lands

  // PINs — known across specs, not secrets.
  PIN_OWNER:                         '1111',
  PIN_FLORIST:                       '2222',
  PIN_DRIVER_TIMUR:                  '3333',
  PIN_DRIVER_NIKITA:                 '4444',

  // Airtable identity — the mock doesn't call the real API, but
  // config/airtable.js still constructs `new Airtable({apiKey})` defensively
  // when the shim's NODE_ENV-prod check passes — which it doesn't here, so
  // these are belt-and-braces.
  AIRTABLE_API_KEY:                  'test-mock-key',
  AIRTABLE_BASE_ID:                  'appMockBase',

  // Table ids — must match the keys in airtable-test-base.json.
  AIRTABLE_CUSTOMERS_TABLE:          'tblMockCustomers',
  AIRTABLE_ORDERS_TABLE:             'tblMockOrders',
  AIRTABLE_ORDER_LINES_TABLE:        'tblMockOrderLines',
  AIRTABLE_STOCK_TABLE:              'tblMockStock',
  AIRTABLE_DELIVERIES_TABLE:         'tblMockDeliveries',
  AIRTABLE_STOCK_PURCHASES_TABLE:    'tblMockStockPurchases',
  AIRTABLE_STOCK_ORDERS_TABLE:       'tblMockStockOrders',
  AIRTABLE_STOCK_ORDER_LINES_TABLE:  'tblMockStockOrderLines',
  AIRTABLE_PRODUCT_CONFIG_TABLE:     'tblMockProductConfig',
  AIRTABLE_SYNC_LOG_TABLE:           'tblMockSyncLog',
  AIRTABLE_APP_CONFIG_TABLE:         'tblMockAppConfig',
  AIRTABLE_FLORIST_HOURS_TABLE:      'tblMockFloristHours',
  AIRTABLE_WEBHOOK_LOG_TABLE:        'tblMockWebhookLog',
  AIRTABLE_MARKETING_SPEND_TABLE:    'tblMockMarketingSpend',
  AIRTABLE_STOCK_LOSS_LOG_TABLE:     'tblMockStockLossLog',
  AIRTABLE_LEGACY_ORDERS_TABLE:      'tblMockLegacyOrders',
  AIRTABLE_PREMADE_BOUQUETS_TABLE:   'tblMockPremadeBouquets',
  AIRTABLE_PREMADE_BOUQUET_LINES_TABLE: 'tblMockPremadeBouquetLines',

  // Port — 3002 to avoid collision with a real local backend on 3001.
  PORT:                              process.env.PORT || '3002',

  // Anthropic / Telegram / Wix — the routes that touch these will fail
  // gracefully (404 / 500) when invoked, which is fine for the harness:
  // E2E specs don't go through the AI text-import flow or post real
  // Telegram messages. Set fake keys so any client init succeeds.
  ANTHROPIC_API_KEY:                 'test-mock-anthropic',
  TELEGRAM_BOT_TOKEN:                'test-mock-telegram',
  WIX_WEBHOOK_SECRET:                'test-mock-wix-secret',
};

for (const [k, v] of Object.entries(TEST_ENV)) {
  if (process.env[k] === undefined) process.env[k] = v;
}

// Loud banner so the operator can never miss what's running.
console.log('\x1b[36m' + '═'.repeat(70) + '\x1b[0m');
console.log('\x1b[36m  Flower Studio — TEST HARNESS BACKEND\x1b[0m');
console.log('\x1b[36m  Mock Airtable + pglite. NOT touching production.\x1b[0m');
console.log('\x1b[36m' + '═'.repeat(70) + '\x1b[0m');
console.log(`  Port:           ${process.env.PORT}`);
console.log(`  TEST_BACKEND:   ${process.env.TEST_BACKEND}`);
console.log(`  DATABASE_URL:   ${process.env.DATABASE_URL}`);
console.log(`  STOCK_BACKEND:  ${process.env.STOCK_BACKEND}`);
console.log(`  ORDER_BACKEND:  ${process.env.ORDER_BACKEND}`);
console.log('\x1b[36m' + '─'.repeat(70) + '\x1b[0m');
console.log('  PINs:');
console.log(`    Owner:        ${process.env.PIN_OWNER}`);
console.log(`    Florist:      ${process.env.PIN_FLORIST}`);
console.log(`    Driver Timur: ${process.env.PIN_DRIVER_TIMUR}`);
console.log(`    Driver Nikita:${process.env.PIN_DRIVER_NIKITA}`);
console.log('\x1b[36m' + '─'.repeat(70) + '\x1b[0m');
console.log('  Frontends should hit:');
console.log(`    VITE_API_PROXY_TARGET=http://localhost:${process.env.PORT}`);
console.log('  Test endpoints (no PIN required):');
console.log(`    POST http://localhost:${process.env.PORT}/api/test/reset`);
console.log(`    GET  http://localhost:${process.env.PORT}/api/test/state`);
console.log(`    GET  http://localhost:${process.env.PORT}/api/test/audit`);
console.log('\x1b[36m' + '═'.repeat(70) + '\x1b[0m');

// ── Now import the entry point. The dynamic import + already-set env vars
//    means index.js sees test values when it samples process.env. ──
await import('../src/index.js');

// ── Auto-seed: hit the test/reset endpoint once the server is listening
//    so the first frontend request sees stock rows in PG (the cutover
//    path's "list" returns empty until backfill runs). The fetch waits
//    a beat for the listen() call to bind the port. ──

const port = process.env.PORT;
let attempts = 0;
const maxAttempts = 20;

while (attempts < maxAttempts) {
  try {
    const res = await fetch(`http://localhost:${port}/api/test/reset`, { method: 'POST' });
    if (res.ok) {
      const body = await res.json();
      console.log(`\x1b[32m[TEST] Auto-seeded — PG stock: ${body.seeded?.stock ?? 0} rows. Ready.\x1b[0m`);
      break;
    }
  } catch {
    // Server not ready yet — retry.
  }
  attempts++;
  await new Promise(r => setTimeout(r, 100));
}
if (attempts >= maxAttempts) {
  console.warn('[TEST] Auto-seed failed after 2s. Specs should call POST /api/test/reset manually.');
}
