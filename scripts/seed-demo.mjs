#!/usr/bin/env node
// Seed demo data via the backend API.
// Usage: node scripts/seed-demo.mjs
//
// Creates: 1 customer, ~10 stock items, stock purchases, 8 orders
// covering all statuses, sources, payment states, delivery + pickup.

const API = 'https://flower-studio-backend-production.up.railway.app/api';
const PIN = '1507'; // owner PIN

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Auth-PIN': PIN,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

// Helper: date string relative to today
function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

async function main() {
  console.log('=== Seeding demo data ===\n');

  // ── 1. Create customer ──────────────────────────────────
  console.log('Creating customer...');
  const customer = await api('POST', '/customers', {
    Name: 'Oliwer Owczarek',
    Nickname: 'Oliwer',
    Phone: '+48 500 123 456',
    Email: 'oliwer@demo.com',
    Language: 'PL',
    Source: 'In-store',
  });
  const custId = customer.id;
  console.log(`  ✓ Customer: ${custId}\n`);

  // ── 2. Create stock items ───────────────────────────────
  console.log('Creating stock items...');
  const stockDefs = [
    { displayName: 'Roses Red',       category: 'Roses',       quantity: 45, costPrice: 8,   sellPrice: 18,  supplier: 'Stojek' },
    { displayName: 'Roses White',     category: 'Roses',       quantity: 20, costPrice: 9,   sellPrice: 20,  supplier: 'Stojek' },
    { displayName: 'Tulips Pink',     category: 'Tulips',      quantity: 30, costPrice: 5,   sellPrice: 12,  supplier: '4f' },
    { displayName: 'Tulips White',    category: 'Tulips',      quantity: 0,  costPrice: 5,   sellPrice: 12,  supplier: '4f' },
    { displayName: 'Peonies',         category: 'Seasonal',    quantity: 8,  costPrice: 15,  sellPrice: 35,  supplier: 'Stefan' },
    { displayName: 'Eucalyptus',      category: 'Greenery',    quantity: 3,  costPrice: 4,   sellPrice: 8,   supplier: 'Mateusz' },
    { displayName: 'Gypsophila',      category: 'Greenery',    quantity: 15, costPrice: 6,   sellPrice: 14,  supplier: 'Mateusz' },
    { displayName: 'Wrapping Paper',  category: 'Accessories', quantity: 50, costPrice: 2,   sellPrice: 5,   supplier: 'Other' },
    { displayName: 'Ribbon Satin',    category: 'Accessories', quantity: 25, costPrice: 1.5, sellPrice: 3,   supplier: 'Other' },
    { displayName: 'Chrysanthemums',  category: 'Seasonal',    quantity: 12, costPrice: 7,   sellPrice: 16,  supplier: 'Stefan' },
  ];

  const stock = {};
  for (const s of stockDefs) {
    const created = await api('POST', '/stock', s);
    stock[s.displayName] = { id: created.id, ...s };
    console.log(`  ✓ ${s.displayName} (qty: ${s.quantity})`);
  }
  console.log();

  // ── 3. Stock purchases (history) ────────────────────────
  console.log('Creating stock purchases...');
  const purchases = [
    { stockItemId: stock['Roses Red'].id,    supplierName: 'Stojek',  quantityPurchased: 50, pricePerUnit: 8,  sellPricePerUnit: 18 },
    { stockItemId: stock['Tulips Pink'].id,  supplierName: '4f',      quantityPurchased: 40, pricePerUnit: 5,  sellPricePerUnit: 12 },
    { stockItemId: stock['Peonies'].id,      supplierName: 'Stefan',  quantityPurchased: 15, pricePerUnit: 15, sellPricePerUnit: 35 },
    { stockItemId: stock['Eucalyptus'].id,   supplierName: 'Mateusz', quantityPurchased: 20, pricePerUnit: 4,  sellPricePerUnit: 8,  notes: 'Fresh batch, good quality' },
  ];

  for (const p of purchases) {
    await api('POST', '/stock-purchases', p);
    console.log(`  ✓ Purchase: ${p.supplierName} — ${p.quantityPurchased} units`);
  }
  console.log();

  // ── 4. Create orders (various statuses/sources) ────────
  console.log('Creating orders...');

  const orders = [
    // Order 1: Delivered, Paid, Instagram, Delivery
    {
      customer: custId,
      source: 'Instagram',
      deliveryType: 'Delivery',
      paymentStatus: 'Paid',
      paymentMethod: 'Card',
      customerRequest: 'Big red bouquet for anniversary',
      requiredBy: dateOffset(-2),
      notes: 'Доставить до 14:00 пожалуйста',
      orderLines: [
        { stockItemId: stock['Roses Red'].id, flowerName: 'Roses Red', quantity: 11, costPricePerUnit: 8, sellPricePerUnit: 18 },
        { stockItemId: stock['Eucalyptus'].id, flowerName: 'Eucalyptus', quantity: 3, costPricePerUnit: 4, sellPricePerUnit: 8 },
        { stockItemId: stock['Wrapping Paper'].id, flowerName: 'Wrapping Paper', quantity: 1, costPricePerUnit: 2, sellPricePerUnit: 5 },
      ],
      delivery: {
        address: 'ul. Szewska 22, 31-009 Kraków',
        recipientName: 'Anna Kowalska',
        recipientPhone: '+48 601 222 333',
        date: dateOffset(-2),
        time: '12:00-14:00',
        cardText: 'Happy Anniversary! With love, Oliwer',
        fee: 35,
      },
    },
    // Order 2: Delivered, Paid, WhatsApp, Pickup
    {
      customer: custId,
      source: 'WhatsApp',
      deliveryType: 'Pickup',
      paymentStatus: 'Paid',
      paymentMethod: 'Cash',
      customerRequest: 'Small tulip bunch for mom',
      requiredBy: dateOffset(-1),
      orderLines: [
        { stockItemId: stock['Tulips Pink'].id, flowerName: 'Tulips Pink', quantity: 7, costPricePerUnit: 5, sellPricePerUnit: 12 },
        { stockItemId: stock['Ribbon Satin'].id, flowerName: 'Ribbon Satin', quantity: 1, costPricePerUnit: 1.5, sellPricePerUnit: 3 },
      ],
    },
    // Order 3: New, Unpaid, In-store, Delivery — TODAY
    {
      customer: custId,
      source: 'In-store',
      deliveryType: 'Delivery',
      paymentStatus: 'Unpaid',
      customerRequest: 'Mixed seasonal bouquet',
      requiredBy: dateOffset(0),
      orderLines: [
        { stockItemId: stock['Peonies'].id, flowerName: 'Peonies', quantity: 3, costPricePerUnit: 15, sellPricePerUnit: 35 },
        { stockItemId: stock['Gypsophila'].id, flowerName: 'Gypsophila', quantity: 2, costPricePerUnit: 6, sellPricePerUnit: 14 },
        { stockItemId: stock['Roses White'].id, flowerName: 'Roses White', quantity: 5, costPricePerUnit: 9, sellPricePerUnit: 20 },
      ],
      delivery: {
        address: 'ul. Karmelicka 45, 31-128 Kraków',
        recipientName: 'Maria Nowak',
        recipientPhone: '+48 602 333 444',
        date: dateOffset(0),
        time: '16:00-18:00',
        cardText: 'Wszystkiego najlepszego!',
        fee: 35,
      },
    },
    // Order 4: Ready, Unpaid, Telegram, Pickup — TODAY
    {
      customer: custId,
      source: 'Telegram',
      deliveryType: 'Pickup',
      paymentStatus: 'Unpaid',
      customerRequest: 'Chrysanthemum arrangement',
      requiredBy: dateOffset(0),
      orderLines: [
        { stockItemId: stock['Chrysanthemums'].id, flowerName: 'Chrysanthemums', quantity: 5, costPricePerUnit: 7, sellPricePerUnit: 16 },
        { stockItemId: stock['Gypsophila'].id, flowerName: 'Gypsophila', quantity: 2, costPricePerUnit: 6, sellPricePerUnit: 14 },
      ],
    },
    // Order 5: New, Unpaid, Instagram, Delivery — TOMORROW
    {
      customer: custId,
      source: 'Instagram',
      deliveryType: 'Delivery',
      paymentStatus: 'Unpaid',
      customerRequest: 'Surprise birthday bouquet — roses and peonies',
      requiredBy: dateOffset(1),
      notes: 'Именинница любит розовый',
      orderLines: [
        { stockItemId: stock['Roses Red'].id, flowerName: 'Roses Red', quantity: 7, costPricePerUnit: 8, sellPricePerUnit: 18 },
        { stockItemId: stock['Peonies'].id, flowerName: 'Peonies', quantity: 3, costPricePerUnit: 15, sellPricePerUnit: 35 },
        { stockItemId: stock['Wrapping Paper'].id, flowerName: 'Wrapping Paper', quantity: 1, costPricePerUnit: 2, sellPricePerUnit: 5 },
      ],
      delivery: {
        address: 'ul. Długa 7/3, 31-147 Kraków',
        recipientName: 'Katarzyna Wiśniewska',
        recipientPhone: '+48 603 444 555',
        date: dateOffset(1),
        time: '10:00-12:00',
        cardText: 'Happy Birthday Kasia! 🎂',
        fee: 35,
      },
    },
    // Order 6: Cancelled, Paid (refund scenario), WhatsApp, Delivery
    {
      customer: custId,
      source: 'WhatsApp',
      deliveryType: 'Delivery',
      paymentStatus: 'Paid',
      paymentMethod: 'Revolut',
      customerRequest: 'Large white arrangement — cancelled by customer',
      requiredBy: dateOffset(-3),
      orderLines: [
        { stockItemId: stock['Roses White'].id, flowerName: 'Roses White', quantity: 3, costPricePerUnit: 9, sellPricePerUnit: 20 },
      ],
      delivery: {
        address: 'ul. Grodzka 12, 31-006 Kraków',
        recipientName: 'Oliwer Owczarek',
        recipientPhone: '+48 500 123 456',
        date: dateOffset(-3),
        time: '14:00-16:00',
        fee: 35,
      },
    },
    // Order 7: New, Unpaid, Other source, Pickup — older (unpaid aging)
    {
      customer: custId,
      source: 'Other',
      deliveryType: 'Pickup',
      paymentStatus: 'Unpaid',
      customerRequest: 'Simple eucalyptus bundle',
      requiredBy: dateOffset(-10),
      orderLines: [
        { stockItemId: stock['Eucalyptus'].id, flowerName: 'Eucalyptus', quantity: 5, costPricePerUnit: 4, sellPricePerUnit: 8 },
      ],
    },
    // Order 8: New, Unpaid, In-store, Delivery — TODAY (second delivery)
    {
      customer: custId,
      source: 'In-store',
      deliveryType: 'Delivery',
      paymentStatus: 'Unpaid',
      customerRequest: 'Peony + roses premium box',
      requiredBy: dateOffset(0),
      priceOverride: 350,
      orderLines: [
        { stockItemId: stock['Roses Red'].id, flowerName: 'Roses Red', quantity: 9, costPricePerUnit: 8, sellPricePerUnit: 18 },
        { stockItemId: stock['Peonies'].id, flowerName: 'Peonies', quantity: 2, costPricePerUnit: 15, sellPricePerUnit: 35 },
        { stockItemId: stock['Ribbon Satin'].id, flowerName: 'Ribbon Satin', quantity: 1, costPricePerUnit: 1.5, sellPricePerUnit: 3 },
      ],
      delivery: {
        address: 'Rynek Główny 1, 31-042 Kraków',
        recipientName: 'Jan Kowalski',
        recipientPhone: '+48 604 555 666',
        date: dateOffset(0),
        time: '14:00-16:00',
        cardText: 'Z pozdrowieniami od Oliwera',
        fee: 50,
      },
    },
  ];

  const createdOrders = [];
  for (const o of orders) {
    try {
      const result = await api('POST', '/orders', o);
      createdOrders.push(result);
      const orderId = result.order?.['Order ID'] || result.order?.id;
      console.log(`  ✓ Order ${orderId} — ${o.source}, ${o.deliveryType}, ${o.paymentStatus}`);
    } catch (err) {
      console.error(`  ✗ Failed: ${err.message}`);
    }
  }
  console.log();

  // ── 5. Update statuses (orders arrive as "New", move some forward) ──
  console.log('Updating order statuses...');

  // Order 1: New → Delivered (skip intermediate for demo)
  if (createdOrders[0]) {
    await api('PATCH', `/orders/${createdOrders[0].order.id}`, { status: 'Delivered' });
    console.log('  ✓ Order 1 → Delivered');
  }

  // Order 2: New → Picked Up
  if (createdOrders[1]) {
    await api('PATCH', `/orders/${createdOrders[1].order.id}`, { status: 'Picked Up' });
    console.log('  ✓ Order 2 → Picked Up');
  }

  // Order 3 stays New (today, pending)

  // Order 4: New → Ready
  if (createdOrders[3]) {
    await api('PATCH', `/orders/${createdOrders[3].order.id}`, { status: 'Ready' });
    console.log('  ✓ Order 4 → Ready');
  }

  // Order 5 stays New (tomorrow)

  // Order 6: New → Cancelled
  if (createdOrders[5]) {
    await api('PATCH', `/orders/${createdOrders[5].order.id}`, { status: 'Cancelled' });
    console.log('  ✓ Order 6 → Cancelled');
  }

  // Order 7 stays New (old unpaid — aging)
  // Order 8 stays New (today, delivery)

  console.log('\n=== Demo data seeded successfully! ===');
  console.log('\nWhat to show in the demo:');
  console.log('  📋 Today tab — revenue, orders, pending deliveries, unpaid aging, stock alerts');
  console.log('  📦 Orders tab — 8 orders across all statuses and sources');
  console.log('  🌸 Stock tab — 10 items (Tulips White out of stock, Eucalyptus low)');
  console.log('  👤 Customers tab — search "Oliwer"');
  console.log('  📊 Analytics tab — revenue, margins, channel breakdown');
  console.log('  🛒 Products tab — Wix product catalog');
  console.log('  ⚙️  Settings tab — config, categories, delivery zones');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
