/**
 * End-to-end API test suite for Flower Studio — Blocks 0–8.
 *
 * Runs sequential HTTP calls against the backend to verify every major feature.
 * Think of it as an acceptance-test checklist: each test is one quality gate
 * on the production line, and the final summary is the shift-end report.
 *
 * Usage:
 *   Local:  node --env-file=backend/.env.dev scripts/test-all.mjs
 *   Prod:   BASE_URL=https://flower-studio-backend-production.up.railway.app PIN=1507 node scripts/test-all.mjs
 */

const BASE = process.env.BASE_URL || 'https://flower-studio-backend-production.up.railway.app';
const PIN = process.env.PIN || '1507';

// ── Helpers ────────────────────────────────────────────────────

async function api(method, path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Auth-PIN': PIN },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, ok: res.ok };
}

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, testName, detail) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${testName}`);
  } else {
    failed++;
    const msg = detail ? `${testName} — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : testName;
    failures.push(msg);
    console.error(`  ✗ ${msg}`);
  }
}

function section(name) {
  console.log(`\n━━━ ${name} ━━━`);
}

// ── Cleanup tracker ────────────────────────────────────────────
// Every test record we create gets tracked here for deletion at the end.
const cleanup = {
  orders: [],     // Airtable record IDs
  customers: [],
  stock: [],
  deliveries: [],
};

async function cleanupAll() {
  section('CLEANUP');
  let deleted = 0;
  let errors = 0;

  // Delete orders (this also orphans order lines, but Airtable handles that)
  for (const id of cleanup.orders) {
    const r = await api('DELETE', `/orders/${id}`).catch(() => null);
    // Orders route may not have DELETE — fall through silently
    if (r?.ok) deleted++;
    else errors++;
  }

  // Delete customers
  for (const id of cleanup.customers) {
    const r = await api('DELETE', `/customers/${id}`).catch(() => null);
    if (r?.ok) deleted++;
    else errors++;
  }

  // Delete stock items
  for (const id of cleanup.stock) {
    const r = await api('DELETE', `/stock/${id}`).catch(() => null);
    if (r?.ok) deleted++;
    else errors++;
  }

  // Note: deliveries are auto-linked to orders — deleting orders may cascade.
  // We still try to clean up standalone ones.
  for (const id of cleanup.deliveries) {
    const r = await api('DELETE', `/deliveries/${id}`).catch(() => null);
    if (r?.ok) deleted++;
    else errors++;
  }

  console.log(`  Cleanup: ${deleted} deleted, ${errors} could not delete (may lack DELETE endpoint — OK)`);
}

// ── Test runner ────────────────────────────────────────────────

async function run() {
  console.log(`\nFlower Studio API Tests — ${BASE}`);
  console.log(`PIN: ${PIN.slice(0, 2)}** | ${new Date().toISOString()}\n`);

  // ── Pre-flight: create a test customer to use throughout ──
  section('SETUP');
  const custRes = await api('POST', '/customers', {
    Name: '_TEST_E2E_Customer',
    Nickname: 'E2E',
    Phone: '+48000000000',
    Language: 'EN',
  });
  assert(custRes.ok, 'Create test customer', custRes.data);
  const testCustomerId = custRes.data?.id;
  if (testCustomerId) cleanup.customers.push(testCustomerId);

  if (!testCustomerId) {
    console.error('\n  FATAL: Cannot create test customer — aborting.\n');
    process.exit(1);
  }

  // ════════════════════════════════════════════════════════════
  // BLOCK 0 — Bug Fixes
  // ════════════════════════════════════════════════════════════
  section('BLOCK 0 — Bug Fixes');

  // 1. Delivery Time on pickup order
  const pickupRes = await api('POST', '/orders', {
    customer: testCustomerId,
    customerRequest: 'E2E pickup with time',
    source: 'In-store',
    deliveryType: 'Pickup',
    deliveryTime: '10:00-12:00',
    orderLines: [],
  });
  assert(pickupRes.ok, '0.1 Create pickup order with deliveryTime', pickupRes.data?.error);
  const pickupOrderId = pickupRes.data?.order?.id;
  if (pickupOrderId) cleanup.orders.push(pickupOrderId);

  if (pickupOrderId) {
    const getPickup = await api('GET', `/orders/${pickupOrderId}`);
    assert(
      getPickup.data?.['Delivery Time'] === '10:00-12:00',
      '0.1 Delivery Time persisted on pickup order',
      `got: ${getPickup.data?.['Delivery Time']}`,
    );
  }

  // 2. Settings lists dynamic
  const listsRes = await api('GET', '/settings/lists');
  assert(listsRes.ok, '0.2 GET /settings/lists returns 200');
  assert(Array.isArray(listsRes.data?.suppliers), '0.2 lists.suppliers is array');
  assert(Array.isArray(listsRes.data?.categories), '0.2 lists.categories is array');
  assert(Array.isArray(listsRes.data?.paymentMethods), '0.2 lists.paymentMethods is array');
  assert(Array.isArray(listsRes.data?.orderSources), '0.2 lists.orderSources is array');

  // 3. Unpaid calculation
  const dashRes = await api('GET', '/dashboard');
  assert(dashRes.ok, '0.3 GET /dashboard returns 200');
  assert(dashRes.data?.unpaidAging != null, '0.3 unpaidAging exists');
  assert(dashRes.data?.unpaidAging?.grandTotal != null, '0.3 unpaidAging.grandTotal exists');

  // 4. Convert pickup to delivery
  if (pickupOrderId) {
    const convertRes = await api('POST', `/orders/${pickupOrderId}/convert-to-delivery`, {
      address: 'ul. Testowa 1, Krakow',
    });
    assert(convertRes.status === 201, '0.4 Convert to delivery returns 201', convertRes.data?.error);
    if (convertRes.data?.id) cleanup.deliveries.push(convertRes.data.id);
  }

  // 5. Source filter
  const sourceFilterRes = await api('GET', '/orders?source=In-store');
  assert(sourceFilterRes.ok, '0.5 GET /orders?source=In-store returns 200');

  // ════════════════════════════════════════════════════════════
  // BLOCK 1 — Order ID
  // ════════════════════════════════════════════════════════════
  section('BLOCK 1 — Order ID');

  // 6. App Order ID generated
  const orderRes = await api('POST', '/orders', {
    customer: testCustomerId,
    customerRequest: 'E2E order ID test',
    source: 'Instagram',
    communicationMethod: 'WhatsApp',
    deliveryType: 'Pickup',
    orderLines: [],
  });
  assert(orderRes.ok, '1.6 Create order for ID test', orderRes.data?.error);
  const order1Id = orderRes.data?.order?.id;
  if (order1Id) cleanup.orders.push(order1Id);

  const appOrderId = orderRes.data?.order?.['App Order ID'];
  assert(
    appOrderId && /^\d{6}-\d{3}$/.test(appOrderId),
    '1.6 App Order ID matches YYYYMM-NNN',
    `got: ${appOrderId}`,
  );

  // 7. Communication method written to customer
  if (order1Id) {
    // Give Airtable a moment for the async customer update
    await new Promise(r => setTimeout(r, 2000));
    const custCheck = await api('GET', `/customers/${testCustomerId}`);
    assert(
      custCheck.data?.['Communication method'] === 'WhatsApp',
      '1.7 Communication method written to customer',
      `got: ${custCheck.data?.['Communication method']}`,
    );
  }

  // 8. Order Source on customer
  if (order1Id) {
    const custCheck2 = await api('GET', `/customers/${testCustomerId}`);
    assert(
      custCheck2.data?.['Order Source'] === 'Instagram',
      '1.8 Order Source written to customer',
      `got: ${custCheck2.data?.['Order Source']}`,
    );
  }

  // ════════════════════════════════════════════════════════════
  // BLOCK 2 — Payments
  // ════════════════════════════════════════════════════════════
  section('BLOCK 2 — Payments');

  // 9. Partial payment fields
  const payOrderRes = await api('POST', '/orders', {
    customer: testCustomerId,
    customerRequest: 'E2E payment test',
    source: 'In-store',
    deliveryType: 'Pickup',
    orderLines: [],
  });
  const payOrderId = payOrderRes.data?.order?.id;
  if (payOrderId) cleanup.orders.push(payOrderId);

  if (payOrderId) {
    const patchPay1 = await api('PATCH', `/orders/${payOrderId}`, {
      'Payment Status': 'Partial',
      'Payment 1 Amount': 100,
      'Payment 1 Method': 'Cash',
    });
    assert(patchPay1.ok, '2.9 PATCH partial payment fields', patchPay1.data?.error);

    const getPayOrder = await api('GET', `/orders/${payOrderId}`);
    assert(getPayOrder.data?.['Payment Status'] === 'Partial', '2.9 Payment Status = Partial', `got: ${getPayOrder.data?.['Payment Status']}`);
    assert(getPayOrder.data?.['Payment 1 Amount'] === 100, '2.9 Payment 1 Amount = 100', `got: ${getPayOrder.data?.['Payment 1 Amount']}`);
    assert(getPayOrder.data?.['Payment 1 Method'] === 'Cash', '2.9 Payment 1 Method = Cash', `got: ${getPayOrder.data?.['Payment 1 Method']}`);

    // 10. Payment 2
    const patchPay2 = await api('PATCH', `/orders/${payOrderId}`, {
      'Payment 2 Amount': 50,
      'Payment 2 Method': 'Card',
      'Payment Status': 'Paid',
    });
    assert(patchPay2.ok, '2.10 PATCH payment 2 fields', patchPay2.data?.error);

    const getPayOrder2 = await api('GET', `/orders/${payOrderId}`);
    assert(getPayOrder2.data?.['Payment 2 Amount'] === 50, '2.10 Payment 2 Amount = 50', `got: ${getPayOrder2.data?.['Payment 2 Amount']}`);
    assert(getPayOrder2.data?.['Payment 2 Method'] === 'Card', '2.10 Payment 2 Method = Card', `got: ${getPayOrder2.data?.['Payment 2 Method']}`);
    assert(getPayOrder2.data?.['Payment Status'] === 'Paid', '2.10 Payment Status = Paid', `got: ${getPayOrder2.data?.['Payment Status']}`);
  }

  // ════════════════════════════════════════════════════════════
  // BLOCK 3 — Drivers & Delivery
  // ════════════════════════════════════════════════════════════
  section('BLOCK 3 — Drivers & Delivery');

  // 11 & 12. Delivery method + driver payout on create
  const delivOrderRes = await api('POST', '/orders', {
    customer: testCustomerId,
    customerRequest: 'E2E delivery test',
    source: 'In-store',
    deliveryType: 'Delivery',
    delivery: {
      address: 'ul. Floriańska 10, Kraków',
      recipientName: 'Test Recipient',
      recipientPhone: '+48111222333',
      date: '2026-03-20',
      time: '14:00-16:00',
    },
    orderLines: [],
  });
  assert(delivOrderRes.ok, '3.11 Create delivery order', delivOrderRes.data?.error);
  const delivOrderId = delivOrderRes.data?.order?.id;
  const deliveryId = delivOrderRes.data?.delivery?.id;
  if (delivOrderId) cleanup.orders.push(delivOrderId);
  if (deliveryId) cleanup.deliveries.push(deliveryId);

  assert(
    delivOrderRes.data?.delivery?.['Delivery Method'] === 'Driver',
    '3.11 Delivery Method = Driver',
    `got: ${delivOrderRes.data?.delivery?.['Delivery Method']}`,
  );

  assert(
    delivOrderRes.data?.delivery?.['Driver Payout'] > 0,
    '3.12 Driver Payout > 0 (auto-filled)',
    `got: ${delivOrderRes.data?.delivery?.['Driver Payout']}`,
  );

  // 13. Patch delivery method to Taxi
  if (deliveryId) {
    const patchDeliv = await api('PATCH', `/deliveries/${deliveryId}`, {
      'Delivery Method': 'Taxi',
      'Taxi Cost': 25,
    });
    assert(patchDeliv.ok, '3.13 PATCH delivery to Taxi + Taxi Cost', patchDeliv.data?.error);
  }

  // 14. Driver names from settings
  const settingsRes = await api('GET', '/settings');
  assert(settingsRes.ok, '3.14 GET /settings returns 200');
  assert(
    Array.isArray(settingsRes.data?.drivers) && settingsRes.data.drivers.length > 0,
    '3.14 drivers array exists and is non-empty',
    `got: ${JSON.stringify(settingsRes.data?.drivers)}`,
  );

  // 15. Settings defaults
  assert(
    settingsRes.data?.config?.driverCostPerDelivery === 35,
    '3.15 driverCostPerDelivery = 35',
    `got: ${settingsRes.data?.config?.driverCostPerDelivery}`,
  );
  assert(
    settingsRes.data?.config?.driverCostPerPORun === 45,
    '3.15 driverCostPerPORun = 45',
    `got: ${settingsRes.data?.config?.driverCostPerPORun}`,
  );

  // ════════════════════════════════════════════════════════════
  // BLOCK 4 — Today Tab
  // ════════════════════════════════════════════════════════════
  section('BLOCK 4 — Today Tab');

  // Reuse the dashboard response from Block 0 test
  assert(Array.isArray(dashRes.data?.fulfillToday), '4.16 fulfillToday is array');
  assert(Array.isArray(dashRes.data?.tomorrowOrders), '4.17 tomorrowOrders is array');

  // ════════════════════════════════════════════════════════════
  // BLOCK 5 — Florist UX (settings verification only)
  // ════════════════════════════════════════════════════════════
  section('BLOCK 5 — Florist UX (settings)');

  assert(
    settingsRes.data?.config?.targetMarkup != null,
    '5.18 targetMarkup exists in config',
    `got: ${settingsRes.data?.config?.targetMarkup}`,
  );

  assert(
    Array.isArray(settingsRes.data?.config?.deliveryTimeSlots),
    '5.19 deliveryTimeSlots array exists in config',
  );

  // ════════════════════════════════════════════════════════════
  // BLOCK 6 — CRM
  // ════════════════════════════════════════════════════════════
  section('BLOCK 6 — CRM');

  // 20. Customer create with expanded fields
  const crmCustRes = await api('POST', '/customers', {
    Name: '_TEST_CRM_Customer',
    Language: 'PL',
    'Home address': 'ul. Test 1',
    'Sex / Business': 'Female',
    'Communication method': 'Telegram',
  });
  assert(crmCustRes.status === 201, '6.20 Create customer with expanded CRM fields', crmCustRes.data?.error);
  const crmCustId = crmCustRes.data?.id;
  if (crmCustId) cleanup.customers.push(crmCustId);

  // 21. Patch communication method
  if (crmCustId) {
    const patchComm = await api('PATCH', `/customers/${crmCustId}`, {
      'Communication method': 'Instagram',
    });
    assert(patchComm.ok, '6.21 PATCH communication method to Instagram', patchComm.data?.error);
  }

  // 22. Patch order source
  if (crmCustId) {
    const patchSrc = await api('PATCH', `/customers/${crmCustId}`, {
      'Order Source': 'WhatsApp',
    });
    assert(patchSrc.ok, '6.22 PATCH Order Source to WhatsApp', patchSrc.data?.error);
  }

  // 23. Customer insights
  const insightsRes = await api('GET', '/customers/insights');
  assert(insightsRes.ok, '6.23 GET /customers/insights returns 200');
  assert(insightsRes.data?.segments != null, '6.23 insights.segments exists');
  assert(insightsRes.data?.churnRisk != null, '6.23 insights.churnRisk exists');
  assert(insightsRes.data?.topCustomers != null, '6.23 insights.topCustomers exists');

  // ════════════════════════════════════════════════════════════
  // BLOCK 7 — Stock
  // ════════════════════════════════════════════════════════════
  section('BLOCK 7 — Stock');

  // 24. Farmer field on stock
  const stockRes = await api('POST', '/stock', {
    displayName: '_TEST_E2E_Tulip',
    farmer: 'Jan',
    quantity: 10,
    costPrice: 5,
    category: 'Tulips',
  });
  assert(stockRes.status === 201, '7.24 Create stock item with farmer', stockRes.data?.error);
  const stockItemId = stockRes.data?.id;
  if (stockItemId) cleanup.stock.push(stockItemId);

  if (stockItemId) {
    const patchFarmer = await api('PATCH', `/stock/${stockItemId}`, {
      Farmer: 'Jan Updated',
    });
    assert(patchFarmer.ok, '7.24 PATCH Farmer field on stock', patchFarmer.data?.error);
  }

  // 25. Write-off with Arrived Broken reason
  if (stockItemId) {
    const writeOff1 = await api('POST', `/stock/${stockItemId}/write-off`, {
      quantity: 2,
      reason: 'Arrived Broken',
    });
    assert(writeOff1.ok, '7.25 Write-off with "Arrived Broken" succeeds', writeOff1.data?.error);

    // Verify quantity decreased
    if (writeOff1.ok) {
      const stockCheck = await api('GET', `/stock?includeEmpty=true`);
      const item = stockCheck.data?.find?.(s => s.id === stockItemId);
      assert(
        item?.['Current Quantity'] === 8,
        '7.25 Stock quantity decreased by 2 (10 → 8)',
        `got: ${item?.['Current Quantity']}`,
      );
    }
  }

  // 26. Write-off Wilted with Days Survived
  if (stockItemId) {
    // First set Last Restocked so Days Survived can be calculated
    const patchRestock = await api('PATCH', `/stock/${stockItemId}`, {
      'Last Restocked': '2026-03-10',
    });
    // Note: 'Last Restocked' may not be in STOCK_PATCH_ALLOWED — check if it worked
    if (!patchRestock.ok) {
      console.log('    (Note: Last Restocked not patchable — Days Survived will be null)');
    }

    const writeOff2 = await api('POST', `/stock/${stockItemId}/write-off`, {
      quantity: 1,
      reason: 'Wilted',
    });
    assert(writeOff2.ok, '7.26 Write-off with "Wilted" succeeds', writeOff2.data?.error);
  }

  // ════════════════════════════════════════════════════════════
  // BLOCK 8 — Analytics
  // ════════════════════════════════════════════════════════════
  section('BLOCK 8 — Analytics');

  // 27. Analytics endpoint
  const analyticsRes = await api('GET', '/analytics?from=2026-01-01&to=2026-12-31');
  assert(analyticsRes.ok, '8.27 GET /analytics returns 200', analyticsRes.data?.error);
  assert(analyticsRes.data?.orders?.bySource != null, '8.27 bySource exists');
  assert(analyticsRes.data?.orders?.revenueBySource != null, '8.27 revenueBySource exists');
  assert(analyticsRes.data?.revenue != null, '8.27 revenue object exists');
  assert(analyticsRes.data?.costs != null, '8.27 costs object exists');
  assert(analyticsRes.data?.orders?.topProducts != null, '8.27 topProducts exists');
  assert(analyticsRes.data?.monthly != null, '8.27 monthly breakdown exists');
  assert(analyticsRes.data?.weeklyRhythm != null, '8.27 weeklyRhythm exists');
  assert(analyticsRes.data?.orders?.funnel != null, '8.27 completion funnel exists');
  assert(analyticsRes.data?.paymentAnalysis != null, '8.27 paymentAnalysis exists');
  assert(analyticsRes.data?.supplierScorecard != null, '8.27 supplierScorecard exists');

  // ── Bonus: Stock Loss endpoint ──
  section('BONUS — Stock Loss');

  const lossRes = await api('GET', '/stock-loss?from=2026-01-01&to=2026-12-31');
  assert(lossRes.ok, 'B.1 GET /stock-loss returns 200');
  assert(Array.isArray(lossRes.data), 'B.1 stock-loss returns array');

  // ═══════════════════════════════════════════════════════════
  // CLEANUP
  // ═══════════════════════════════════════════════════════════
  await cleanupAll();

  // ═══════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(50));
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\n  Failed tests:');
    for (const f of failures) console.log(`    • ${f}`);
  }
  console.log('═'.repeat(50) + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
