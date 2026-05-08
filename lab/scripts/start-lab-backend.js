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

  // Inherit the Wix fetch interceptor from the existing harness — same code
  // path, same fake responses. Lets tests exercise the Wix-bound flows
  // without real credentials.
  HARNESS_MOCK_WIX:                  '1',
};

for (const [k, v] of Object.entries(LAB_ENV)) {
  if (process.env[k] === undefined) process.env[k] = v;
}

console.log('[LAB] Booting backend against', process.env.DATABASE_URL, 'on :' + process.env.PORT);

// ── Wix Media + Stores fetch interceptor (HARNESS_MOCK_WIX=1) ──
//
// The bouquet image upload flow goes through Wix Media (generate-upload-url
// → PUT bytes → poll for ready) and Wix Stores (clear + attach product
// media). The lab has no real Wix credentials — without an interceptor
// the routes 502 trying to reach https://www.wixapis.com.
//
// We wrap globalThis.fetch so the BACKEND's outgoing calls to Wix get
// faked. Lab tests run in a separate process, so their requests to
// http://localhost:3003 aren't affected (they go through the OS networking
// stack, not this shim). Anything not addressed to wixapis.com or our
// synthetic upload-URL hostname falls through to the real fetch.
//
// Endpoints faked:
//   POST /site-media/v1/files/generate-upload-url            → returns harness-fake URL
//   PUT  http://harness-fake/upload/<uuid>                   → returns { file: { ..., operationStatus: 'READY' } }
//   GET  /site-media/v1/files/get-file-by-id?fileId=<id>     → returns { file: { ..., operationStatus: 'READY' } }
//   POST /site-media/v1/bulk/files/delete                    → no-op success
//   POST /stores/v1/products/<id>/media/delete               → no-op success (RemoveProductMedia)
//   POST /stores/v1/products/<id>/media                      → no-op success
//   POST /stores/v1/products/query                           → empty result
if (process.env.HARNESS_MOCK_WIX === '1') {
  const realFetch = globalThis.fetch;
  let uuidCounter = 0;
  const nextUuid = () => `harness-${Date.now()}-${++uuidCounter}`;
  const HARNESS_FAKE_HOST = 'http://harness-fake';

  function jsonResp(body, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method || (input && input.method) || 'GET').toUpperCase();

    // Wix Media — generate upload URL
    if (url.endsWith('/site-media/v1/files/generate-upload-url') && method === 'POST') {
      const id = nextUuid();
      return jsonResp({ uploadUrl: `${HARNESS_FAKE_HOST}/upload/${id}` });
    }

    // Wix Media — PUT to signed upload URL.
    // Real Wix returns the file descriptor with `operationStatus: 'READY'`
    // once processing is done. The route short-circuits `pollForReady` when
    // the PUT response already advertises READY — keep both `operationStatus`
    // and the legacy `state` so any older code path still sees a healthy file.
    if (url.startsWith(`${HARNESS_FAKE_HOST}/upload/`) && method === 'PUT') {
      const id = url.split('/').pop();
      return jsonResp({
        file: {
          id: `fake-${id}`,
          url: `${HARNESS_FAKE_HOST}/static/${id}.jpg`,
          operationStatus: 'READY',
          state: 'OK',
        },
      });
    }

    // Wix Media — GET file descriptor by id (poll for ready).
    // Real endpoint: GET /site-media/v1/files/get-file-by-id?fileId=<urlencoded>
    if (url.includes('/site-media/v1/files/get-file-by-id') && method === 'GET') {
      const qIdx = url.indexOf('?');
      const params = new URLSearchParams(qIdx >= 0 ? url.slice(qIdx + 1) : '');
      const fileId = params.get('fileId') || 'unknown';
      return jsonResp({
        file: {
          id: fileId,
          url: `${HARNESS_FAKE_HOST}/static/${fileId}.jpg`,
          operationStatus: 'READY',
          state: 'OK',
        },
      });
    }

    // Wix Media — bulk delete
    if (url.endsWith('/site-media/v1/bulk/files/delete') && method === 'POST') {
      return jsonResp({ results: [] });
    }

    // Wix Stores — remove media from a product.
    // Real endpoint: POST /stores/v1/products/<id>/media/delete with
    // { mediaIds: [] } (empty list = remove all). Response is empty.
    if (/\/stores\/v1\/products\/[^/]+\/media\/delete$/.test(url) && method === 'POST') {
      return jsonResp({});
    }

    // Wix Stores — attach media to a product
    if (/\/stores\/v1\/products\/[^/]+\/media$/.test(url) && method === 'POST') {
      return jsonResp({ product: {} });
    }

    // Wix Stores — product query (used by sync flows; lab ignores)
    if (url.endsWith('/stores/v1/products/query') && method === 'POST') {
      return jsonResp({ products: [], totalResults: 0 });
    }

    // Anything else → real fetch (so /api/test/reset auto-seed below
    // and any non-Wix outbound call still works).
    return realFetch(input, init);
  };

  console.log('\x1b[33m  HARNESS_MOCK_WIX=1 → Wix Media + Stores fetch interceptor active\x1b[0m');
}

await import('../../backend/src/index.js');
