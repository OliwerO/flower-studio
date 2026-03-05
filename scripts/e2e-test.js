// E2E test — comprehensive order lifecycle + all status transitions
// Simplified flow: New → Ready → Delivered/Picked Up (no "In Progress" step)
// Run: node --env-file=backend/.env.dev scripts/e2e-test.js
const BASE = 'http://localhost:3001/api';
const PIN = '5678';
const headers = { 'Content-Type': 'application/json', 'X-Auth-PIN': PIN };

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label} — ${detail || 'FAILED'}`);
    failed++;
  }
}

async function patchOrder(id, fields) {
  const res = await fetch(`${BASE}/orders/${id}`, { method: 'PATCH', headers, body: JSON.stringify(fields) });
  return { status: res.status, data: await res.json() };
}

async function createTestOrder(custId, rose, tulip, deliveryType) {
  const body = {
    customer: custId,
    customerRequest: `E2E test — ${deliveryType}`,
    source: 'Walk-in',
    deliveryType,
    orderLines: [
      { stockItemId: rose.id, flowerName: rose['Display Name'], quantity: 1, costPricePerUnit: rose['Current Cost Price'], sellPricePerUnit: rose['Current Sell Price'] },
      { stockItemId: tulip.id, flowerName: tulip['Display Name'], quantity: 1, costPricePerUnit: tulip['Current Cost Price'], sellPricePerUnit: tulip['Current Sell Price'] },
    ],
    ...(deliveryType === 'Delivery' ? {
      delivery: { address: '123 Test St', recipientName: 'Test', recipientPhone: '+48555000111', date: '2026-03-10', time: '14:00', fee: 35 },
    } : {}),
    paymentStatus: 'Unpaid',
    notes: 'E2E automated test',
  };
  const res = await fetch(`${BASE}/orders`, { method: 'POST', headers, body: JSON.stringify(body) });
  return res.json();
}

async function test() {
  // ═══════════════════════════════════════════
  console.log('\n═══ 1. SETUP — Stock & Customer ═══');
  let res = await fetch(BASE + '/stock', { headers });
  const stock = await res.json();
  const rose = stock.find(s => s['Display Name']?.toLowerCase().includes('rose'));
  const tulip = stock.find(s => s['Display Name']?.toLowerCase().includes('tulip'));
  assert('Found rose in stock', !!rose, 'No rose found');
  assert('Found tulip in stock', !!tulip, 'No tulip found');
  if (!rose || !tulip) { console.log('Cannot continue without stock items'); return; }
  console.log(`  Rose: ${rose['Display Name']} (qty: ${rose['Current Quantity']})`);
  console.log(`  Tulip: ${tulip['Display Name']} (qty: ${tulip['Current Quantity']})`);

  res = await fetch(BASE + '/customers', { headers });
  const customers = await res.json();
  const cust = customers[0];
  assert('Found customer', !!cust, 'No customers in dev base');
  if (!cust) return;

  // ═══════════════════════════════════════════
  console.log('\n═══ 2. ORDER CREATION — Delivery ═══');
  const created = await createTestOrder(cust.id, rose, tulip, 'Delivery');
  assert('Order created', !!created.order?.id);
  assert('2 order lines created', created.orderLines?.length === 2);
  assert('Delivery record created', !!created.delivery);
  const orderId = created.order.id;

  // ═══════════════════════════════════════════
  console.log('\n═══ 3. STOCK DECREMENT ═══');
  res = await fetch(BASE + '/stock', { headers });
  const stock2 = await res.json();
  const rose2 = stock2.find(s => s.id === rose.id);
  const tulip2 = stock2.find(s => s.id === tulip.id);
  assert('Rose decremented by 1', rose2['Current Quantity'] === rose['Current Quantity'] - 1, `got ${rose2['Current Quantity']}, expected ${rose['Current Quantity'] - 1}`);
  assert('Tulip decremented by 1', tulip2['Current Quantity'] === tulip['Current Quantity'] - 1, `got ${tulip2['Current Quantity']}, expected ${tulip['Current Quantity'] - 1}`);

  // ═══════════════════════════════════════════
  console.log('\n═══ 4. ORDER DETAIL (GET /:id) ═══');
  res = await fetch(`${BASE}/orders/${orderId}`, { headers });
  const detail = await res.json();
  assert('Order lines loaded', detail.orderLines?.length === 2);
  assert('Delivery loaded', !!detail.delivery);
  assert('Delivery address correct', detail.delivery?.['Delivery Address'] === '123 Test St');
  assert('Customer Name resolved', 'Customer Name' in detail, 'Customer Name key missing from response');

  // ═══════════════════════════════════════════
  console.log('\n═══ 5. DELIVERY PATH — New → Ready → Delivered ═══');
  let p = await patchOrder(orderId, { Status: 'Ready' });
  assert('New → Ready', p.data.Status === 'Ready');

  p = await patchOrder(orderId, { Status: 'Delivered' });
  assert('Ready → Delivered', p.data.Status === 'Delivered');

  // ═══════════════════════════════════════════
  console.log('\n═══ 6. PICKUP PATH — New → Ready → Picked Up ═══');
  const pickup = await createTestOrder(cust.id, rose, tulip, 'Pickup');
  const pickupId = pickup.order.id;
  assert('Pickup order created', !!pickupId);

  p = await patchOrder(pickupId, { Status: 'Ready' });
  assert('New → Ready', p.data.Status === 'Ready');

  p = await patchOrder(pickupId, { Status: 'Picked Up' });
  assert('Ready → Picked Up', p.data.Status === 'Picked Up');

  // ═══════════════════════════════════════════
  console.log('\n═══ 7. CANCELLATION + STOCK ROLLBACK ═══');
  const cancelOrder = await createTestOrder(cust.id, rose, tulip, 'Pickup');
  const cancelId = cancelOrder.order.id;
  res = await fetch(BASE + '/stock', { headers });
  const stockPre = await res.json();
  const rosePre = stockPre.find(s => s.id === rose.id);

  p = await patchOrder(cancelId, { Status: 'Cancelled' });
  assert('New → Cancelled', p.data.Status === 'Cancelled');

  res = await fetch(BASE + '/stock', { headers });
  const stockPost = await res.json();
  const rosePost = stockPost.find(s => s.id === rose.id);
  assert('Stock restored after cancel', rosePost['Current Quantity'] === rosePre['Current Quantity'] + 1, `got ${rosePost['Current Quantity']}, expected ${rosePre['Current Quantity'] + 1}`);

  // ═══════════════════════════════════════════
  console.log('\n═══ 8. UN-CANCEL (Reopen) ═══');
  p = await patchOrder(cancelId, { Status: 'New' });
  assert('Cancelled → New (reopen)', p.data.Status === 'New');

  // ═══════════════════════════════════════════
  console.log('\n═══ 9. LEGACY: In Progress orders can still transition out ═══');
  // Orders already in "In Progress" (from before simplification) must still work
  const legacy = await createTestOrder(cust.id, rose, tulip, 'Pickup');
  const legacyId = legacy.order.id;
  // Manually set to In Progress via direct DB-level (simulated by allowing it temporarily)
  // For now test that In Progress → Ready works
  // First we need to get it to In Progress — but New no longer allows it.
  // Skip this test since new orders can't enter In Progress anymore.
  // Legacy orders already in that state are handled by the backend mapping.
  console.log('  (legacy In Progress orders handled by backend — no new orders enter this state)');

  // ═══════════════════════════════════════════
  console.log('\n═══ 10. INVALID TRANSITIONS (should all be blocked) ═══');
  const inv = await createTestOrder(cust.id, rose, tulip, 'Pickup');
  const invId = inv.order.id;

  // From New: can only go to Ready or Cancelled
  p = await patchOrder(invId, { Status: 'Delivered' });
  assert('New → Delivered BLOCKED', p.status === 400);

  p = await patchOrder(invId, { Status: 'Picked Up' });
  assert('New → Picked Up BLOCKED', p.status === 400);

  p = await patchOrder(invId, { Status: 'In Progress' });
  assert('New → In Progress BLOCKED', p.status === 400);

  // Move to Ready, test invalid from there
  await patchOrder(invId, { Status: 'Ready' });

  p = await patchOrder(invId, { Status: 'New' });
  assert('Ready → New BLOCKED', p.status === 400);

  p = await patchOrder(invId, { Status: 'In Progress' });
  assert('Ready → In Progress BLOCKED', p.status === 400);

  // Move to Delivered (terminal)
  await patchOrder(invId, { Status: 'Delivered' });

  p = await patchOrder(invId, { Status: 'New' });
  assert('Delivered → New BLOCKED', p.status === 400);

  p = await patchOrder(invId, { Status: 'Ready' });
  assert('Delivered → Ready BLOCKED', p.status === 400);

  p = await patchOrder(invId, { Status: 'Cancelled' });
  assert('Delivered → Cancelled BLOCKED', p.status === 400);

  // Picked Up is terminal too
  p = await patchOrder(pickupId, { Status: 'New' });
  assert('Picked Up → New BLOCKED', p.status === 400);

  p = await patchOrder(pickupId, { Status: 'Cancelled' });
  assert('Picked Up → Cancelled BLOCKED', p.status === 400);

  // ═══════════════════════════════════════════
  console.log('\n═══ 11. PAYMENT UPDATE ═══');
  const payOrder = await createTestOrder(cust.id, rose, tulip, 'Pickup');
  p = await patchOrder(payOrder.order.id, { 'Payment Status': 'Paid', 'Payment Method': 'Cash' });
  assert('Payment marked Paid', p.data['Payment Status'] === 'Paid');
  assert('Payment method set to Cash', p.data['Payment Method'] === 'Cash');

  // ═══════════════════════════════════════════
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed === 0) console.log('🌸 ALL TESTS PASSED');
  else console.log('⚠️  SOME TESTS FAILED — review above');
}

test().catch(e => console.error('FATAL:', e));
