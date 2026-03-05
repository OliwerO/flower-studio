// Creates demo orders covering all status/payment/delivery variations
// Run: node --env-file=backend/.env.dev scripts/create-demo-orders.js
const BASE = 'http://localhost:3001/api';
const PIN = '5678';
const headers = { 'Content-Type': 'application/json', 'X-Auth-PIN': PIN };

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  return res.json();
}

async function patch(id, fields) {
  await fetch(`${BASE}/orders/${id}`, { method: 'PATCH', headers, body: JSON.stringify(fields) });
}

async function run() {
  // Fetch stock & customers
  let res = await fetch(`${BASE}/stock`, { headers });
  const stock = await res.json();
  res = await fetch(`${BASE}/customers`, { headers });
  const customers = await res.json();

  const named = customers.filter(c => c.Name);
  const anna = named.find(c => c.Name.includes('Anna'));
  const kasia = named.find(c => c.Name.includes('Katarzyna'));
  const maria = named.find(c => c.Name.includes('Maria'));

  const s = (name) => stock.find(i => i['Display Name']?.toLowerCase().includes(name.toLowerCase()));
  const line = (item, qty) => ({
    stockItemId: item.id,
    flowerName: item['Display Name'],
    quantity: qty,
    costPricePerUnit: item['Current Cost Price'],
    sellPricePerUnit: item['Current Sell Price'],
  });

  const orders = [
    // ── NEW STATUS ──────────────────────────────────
    {
      label: '1. NEW — Delivery, Unpaid, Instagram',
      customer: anna.id,
      customerRequest: 'Birthday bouquet for my mom, she loves pink!',
      source: 'Instagram',
      deliveryType: 'Delivery',
      orderLines: [line(s('Pink roses'), 10), line(s('Eucalyptus'), 5), line(s('Kraft paper'), 1)],
      delivery: { address: 'ul. Kwiatowa 15, Warszawa', recipientName: 'Janina Kowalska', recipientPhone: '+48 600 111 222', date: '2026-03-07', time: '10:00-12:00', fee: 35 },
      paymentStatus: 'Unpaid',
      notes: 'Call 30 min before delivery',
    },
    {
      label: '2. NEW — Pickup, Unpaid, Walk-in',
      customer: maria.id,
      customerRequest: 'Simple white bouquet for office reception',
      source: 'Walk-in',
      deliveryType: 'Pickup',
      orderLines: [line(s('White roses'), 7), line(s('Ruscus'), 3)],
      paymentStatus: 'Unpaid',
    },
    {
      label: '3. NEW — Delivery, Paid (Transfer), Phone, with price override',
      customer: kasia.id,
      customerRequest: 'Luxury peony arrangement — surprise anniversary gift',
      source: 'Phone',
      deliveryType: 'Delivery',
      orderLines: [line(s('Peonies'), 12), line(s('Ranunculus'), 5), line(s('Eucalyptus'), 4), line(s('Ribbon'), 1)],
      delivery: { address: 'ul. Mokotowska 42/8, Warszawa', recipientName: 'Piotr Wiśniewski', recipientPhone: '+48 601 333 444', date: '2026-03-06', time: '18:00-19:00', cardText: 'Wszystkiego najlepszego kochanie! ❤️', fee: 35 },
      paymentStatus: 'Paid',
      paymentMethod: 'Transfer',
      priceOverride: 250,
      notes: 'Premium wrapping, gold ribbon',
    },

    // ── IN PROGRESS STATUS ──────────────────────────
    {
      label: '4. IN PROGRESS — Delivery, Unpaid, Instagram',
      customer: anna.id,
      customerRequest: 'Colorful spring mix — tulips & freesia',
      source: 'Instagram',
      deliveryType: 'Delivery',
      orderLines: [line(s('Pink tulips'), 5), line(s('Yellow tulips'), 5), line(s('Freesia'), 4), line(s('Fern'), 3)],
      delivery: { address: 'ul. Nowy Świat 22, Warszawa', recipientName: 'Ewa Kowalska', recipientPhone: '+48 602 555 666', date: '2026-03-05', time: '14:00-16:00', fee: 35 },
      paymentStatus: 'Unpaid',
      targetStatus: 'In Progress',
    },
    {
      label: '5. IN PROGRESS — Pickup, Paid (Cash), Walk-in',
      customer: maria.id,
      customerRequest: 'Red roses, classic dozen',
      source: 'Walk-in',
      deliveryType: 'Pickup',
      orderLines: [line(s('Red roses'), 12), line(s('Kraft paper'), 1)],
      paymentStatus: 'Paid',
      paymentMethod: 'Cash',
      targetStatus: 'In Progress',
    },

    // ── READY STATUS ────────────────────────────────
    {
      label: '6. READY — Delivery, Unpaid, Phone',
      customer: kasia.id,
      customerRequest: 'Pastel bouquet for baby shower',
      source: 'Phone',
      deliveryType: 'Delivery',
      orderLines: [line(s('White roses'), 5), line(s('Pink roses'), 5), line(s('White tulips'), 5), line(s('Eucalyptus'), 3)],
      delivery: { address: 'ul. Puławska 108, Warszawa', recipientName: 'Agnieszka Zielińska', recipientPhone: '+48 603 777 888', date: '2026-03-05', time: '11:00-13:00', cardText: 'Gratulacje! 🎀', fee: 35 },
      paymentStatus: 'Unpaid',
      targetStatus: 'Ready',
    },
    {
      label: '7. READY — Pickup, Paid (Card), Walk-in',
      customer: anna.id,
      customerRequest: 'Just yellow roses please, nothing fancy',
      source: 'Walk-in',
      deliveryType: 'Pickup',
      orderLines: [line(s('Yellow roses'), 8)],
      paymentStatus: 'Paid',
      paymentMethod: 'Card',
      targetStatus: 'Ready',
    },

    // ── DELIVERED STATUS ────────────────────────────
    {
      label: '8. DELIVERED — Delivery, Paid (Transfer), Instagram',
      customer: maria.id,
      customerRequest: 'Valentine surprise — red & pink',
      source: 'Instagram',
      deliveryType: 'Delivery',
      orderLines: [line(s('Red roses'), 6), line(s('Pink roses'), 6), line(s('Ranunculus'), 3), line(s('Ribbon'), 1)],
      delivery: { address: 'ul. Marszałkowska 55, Warszawa', recipientName: 'Tomasz Nowak', recipientPhone: '+48 604 999 000', date: '2026-03-05', time: '09:00-10:00', cardText: 'Kocham Cię 💕', fee: 40 },
      paymentStatus: 'Paid',
      paymentMethod: 'Transfer',
      targetStatus: 'Delivered',
    },

    // ── PICKED UP STATUS ────────────────────────────
    {
      label: '9. PICKED UP — Pickup, Paid (Cash), Phone',
      customer: kasia.id,
      customerRequest: 'Purple tulips for grandma, she collects them',
      source: 'Phone',
      deliveryType: 'Pickup',
      orderLines: [line(s('Purple tulips'), 15), line(s('Fern'), 5)],
      paymentStatus: 'Paid',
      paymentMethod: 'Cash',
      targetStatus: 'Picked Up',
    },
    {
      label: '10. PICKED UP — Pickup, Paid (Card), Walk-in, price override',
      customer: anna.id,
      customerRequest: 'Mixed seasonal — florist choice',
      source: 'Walk-in',
      deliveryType: 'Pickup',
      orderLines: [line(s('Freesia'), 3), line(s('Ranunculus'), 3), line(s('Peonies'), 2), line(s('Eucalyptus'), 2)],
      paymentStatus: 'Paid',
      paymentMethod: 'Card',
      priceOverride: 85,
      targetStatus: 'Picked Up',
    },

    // ── CANCELLED STATUS ────────────────────────────
    {
      label: '11. CANCELLED — Delivery, Unpaid, Instagram (customer changed mind)',
      customer: maria.id,
      customerRequest: 'Big arrangement for wedding table',
      source: 'Instagram',
      deliveryType: 'Delivery',
      orderLines: [line(s('White roses'), 3), line(s('Peonies'), 3)],
      delivery: { address: 'Hotel Marriott, Al. Jerozolimskie 65, Warszawa', recipientName: 'Wedding Coordinator', recipientPhone: '+48 605 111 333', date: '2026-03-10', time: '08:00-09:00', fee: 50 },
      paymentStatus: 'Unpaid',
      notes: 'Customer cancelled — wrong date',
      targetStatus: 'Cancelled',
    },
    {
      label: '12. CANCELLED — Pickup, Paid (Transfer), Phone (refund pending)',
      customer: kasia.id,
      customerRequest: 'Ranunculus only, 20 stems',
      source: 'Phone',
      deliveryType: 'Pickup',
      orderLines: [line(s('Ranunculus'), 3)],
      paymentStatus: 'Paid',
      paymentMethod: 'Transfer',
      notes: 'Refund pending — transferred 140 zł',
      targetStatus: 'Cancelled',
    },
  ];

  console.log(`Creating ${orders.length} demo orders...\n`);

  for (const o of orders) {
    const { label, targetStatus, ...body } = o;
    process.stdout.write(`${label}... `);

    const created = await post('/orders', body);
    if (!created.order?.id) {
      console.log('FAILED', JSON.stringify(created).slice(0, 200));
      continue;
    }

    // Transition to target status step by step
    const id = created.order.id;
    if (targetStatus === 'In Progress') {
      await patch(id, { Status: 'In Progress' });
    } else if (targetStatus === 'Ready') {
      await patch(id, { Status: 'In Progress' });
      await patch(id, { Status: 'Ready' });
    } else if (targetStatus === 'Delivered') {
      await patch(id, { Status: 'In Progress' });
      await patch(id, { Status: 'Ready' });
      await patch(id, { Status: 'Delivered' });
    } else if (targetStatus === 'Picked Up') {
      await patch(id, { Status: 'In Progress' });
      await patch(id, { Status: 'Ready' });
      await patch(id, { Status: 'Picked Up' });
    } else if (targetStatus === 'Cancelled') {
      await patch(id, { Status: 'In Progress' });
      await patch(id, { Status: 'Cancelled' });
    }

    console.log('✓');
  }

  console.log('\n🌸 All demo orders created! Open the app and set date to today.');
}

run().catch(e => console.error('FATAL:', e));
