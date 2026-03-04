// E2E test — creates order, checks stock, transitions, cancels, verifies rollback
const BASE = 'http://localhost:3001/api';
const PIN = '5678';
const headers = { 'Content-Type': 'application/json', 'X-Auth-PIN': PIN };

async function test() {
  // 1. Get stock items
  console.log('=== 1. Fetching stock ===');
  let res = await fetch(BASE + '/stock', { headers });
  const stock = await res.json();
  const rose = stock.find(s => s['Display Name'] && s['Display Name'].toLowerCase().includes('rose'));
  const tulip = stock.find(s => s['Display Name'] && s['Display Name'].toLowerCase().includes('tulip'));
  if (!rose || !tulip) { console.log('No rose/tulip found'); return; }
  console.log('Rose:', rose['Display Name'], 'qty:', rose['Current Quantity']);
  console.log('Tulip:', tulip['Display Name'], 'qty:', tulip['Current Quantity']);

  // 2. Get a customer
  res = await fetch(BASE + '/customers', { headers });
  const customers = await res.json();
  const cust = customers[0];
  console.log('Customer:', cust.Name || cust.Nickname);

  // 3. Create order with delivery
  console.log('\n=== 2. Creating order ===');
  const orderBody = {
    customer: cust.id,
    customerRequest: 'E2E test bouquet',
    source: 'Walk-in',
    deliveryType: 'Delivery',
    orderLines: [
      { stockItemId: rose.id, flowerName: rose['Display Name'], quantity: 2, costPricePerUnit: rose['Current Cost Price'], sellPricePerUnit: rose['Current Sell Price'] },
      { stockItemId: tulip.id, flowerName: tulip['Display Name'], quantity: 3, costPricePerUnit: tulip['Current Cost Price'], sellPricePerUnit: tulip['Current Sell Price'] },
    ],
    delivery: { address: '123 Test St', recipientName: 'Test Recipient', recipientPhone: '+48555000111', date: '2026-03-10', time: '14:00', fee: 35 },
    paymentStatus: 'Unpaid',
    notes: 'E2E automated test',
  };
  res = await fetch(BASE + '/orders', { method: 'POST', headers, body: JSON.stringify(orderBody) });
  const created = await res.json();
  console.log('Order ID:', created.order?.id);
  console.log('Lines created:', created.orderLines?.length);
  console.log('Delivery created:', !!created.delivery);

  // 4. Check stock decremented
  console.log('\n=== 3. Checking stock after order ===');
  res = await fetch(BASE + '/stock', { headers });
  const stock2 = await res.json();
  const rose2 = stock2.find(s => s.id === rose.id);
  const tulip2 = stock2.find(s => s.id === tulip.id);
  console.log('Rose qty:', rose['Current Quantity'], '->', rose2['Current Quantity'], rose2['Current Quantity'] === rose['Current Quantity'] - 2 ? 'OK' : 'FAIL');
  console.log('Tulip qty:', tulip['Current Quantity'], '->', tulip2['Current Quantity'], tulip2['Current Quantity'] === tulip['Current Quantity'] - 3 ? 'OK' : 'FAIL');

  // 5. Get order detail (check delivery is linked)
  console.log('\n=== 4. Checking order detail ===');
  res = await fetch(BASE + '/orders/' + created.order.id, { headers });
  const detail = await res.json();
  console.log('Order Lines loaded:', detail.orderLines?.length);
  console.log('Delivery loaded:', !!detail.delivery);
  console.log('Delivery address:', detail.delivery?.['Delivery Address']);

  // 6. Transition: New -> In Progress -> Cancelled (test stock rollback)
  console.log('\n=== 5. Status transitions ===');
  res = await fetch(BASE + '/orders/' + created.order.id, { method: 'PATCH', headers, body: JSON.stringify({ Status: 'In Progress' }) });
  let patched = await res.json();
  console.log('New -> In Progress:', patched.Status);

  res = await fetch(BASE + '/orders/' + created.order.id, { method: 'PATCH', headers, body: JSON.stringify({ Status: 'Cancelled' }) });
  patched = await res.json();
  console.log('In Progress -> Cancelled:', patched.Status);

  // 7. Check stock restored
  console.log('\n=== 6. Checking stock after cancel ===');
  res = await fetch(BASE + '/stock', { headers });
  const stock3 = await res.json();
  const rose3 = stock3.find(s => s.id === rose.id);
  const tulip3 = stock3.find(s => s.id === tulip.id);
  console.log('Rose qty:', rose2['Current Quantity'], '->', rose3['Current Quantity'], rose3['Current Quantity'] === rose['Current Quantity'] ? 'RESTORED OK' : 'FAIL (expected ' + rose['Current Quantity'] + ')');
  console.log('Tulip qty:', tulip2['Current Quantity'], '->', tulip3['Current Quantity'], tulip3['Current Quantity'] === tulip['Current Quantity'] ? 'RESTORED OK' : 'FAIL (expected ' + tulip['Current Quantity'] + ')');

  // 8. Test invalid transition
  console.log('\n=== 7. Invalid transition test ===');
  res = await fetch(BASE + '/orders/' + created.order.id, { method: 'PATCH', headers, body: JSON.stringify({ Status: 'Ready' }) });
  const invalid = await res.json();
  console.log('Cancelled -> Ready:', res.status === 400 ? 'BLOCKED OK' : 'FAIL', invalid.error || '');

  console.log('\n=== ALL TESTS COMPLETE ===');
}
test().catch(e => console.error('FATAL:', e));
