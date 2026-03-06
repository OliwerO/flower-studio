#!/usr/bin/env node
/**
 * Seed test orders — creates 5 realistic orders via the API
 * to populate all 3 apps with consistent data for cross-app testing.
 *
 * Usage: node scripts/seed-test-orders.js
 *
 * Prerequisites: backend must be running on localhost:3001
 */

const API = 'http://localhost:3001/api';
const PIN = '1234'; // owner PIN

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(method, path, body) {
  await sleep(300); // rate limit buffer — Airtable allows 5 req/sec
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Auth-PIN': PIN },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function main() {
  console.log('=== Seed Test Orders ===\n');

  // 1. Fetch stock items to get real IDs
  console.log('Fetching stock items...');
  const stock = await api('GET', '/stock');
  console.log(`  Found ${stock.length} stock items`);

  // Build a lookup by display name (case-insensitive)
  const stockByName = {};
  for (const s of stock) {
    stockByName[(s['Display Name'] || '').toLowerCase()] = s;
  }

  function findStock(partialName) {
    const key = partialName.toLowerCase();
    // Exact match first
    if (stockByName[key]) return stockByName[key];
    // Partial match
    const found = stock.find(s => (s['Display Name'] || '').toLowerCase().includes(key));
    if (found) return found;
    console.warn(`  ⚠ Stock item not found: "${partialName}"`);
    return null;
  }

  // 2. Fetch or create test customers
  console.log('\nChecking/creating test customers...');
  const customers = {};

  async function ensureCustomer(name, phone, nickname) {
    // Search first
    const results = await api('GET', `/customers?search=${encodeURIComponent(name)}`);
    const existing = results.find(c => c.Name === name);
    if (existing) {
      console.log(`  ✓ Found existing customer: ${name} (${existing.id})`);
      customers[name] = existing;
      return existing;
    }
    // Create
    const created = await api('POST', '/customers', { Name: name, Phone: phone, Nickname: nickname });
    console.log(`  + Created customer: ${name} (${created.id})`);
    customers[name] = created;
    return created;
  }

  await ensureCustomer('Anna Kowalska', '+48 501 111 111', '@anna_flowers');
  await ensureCustomer('Marta Nowak', '+48 502 222 222', '@marta_n');
  await ensureCustomer('Katya Ivanova', '+48 503 333 333', '@katya_iv');
  await ensureCustomer('Piotr Wisniewski', '+48 504 444 444', '@piotr_w');
  await ensureCustomer('Julia Mazur', '+48 505 555 555', '@julia_mazur');

  // 3. Create test orders
  console.log('\nCreating test orders...\n');

  // Helper to build order lines from stock
  function makeLines(items) {
    return items
      .map(([name, qty]) => {
        const s = findStock(name);
        if (!s) return null;
        return {
          stockItemId: s.id,
          flowerName: s['Display Name'],
          quantity: qty,
          costPricePerUnit: Number(s['Current Cost Price']) || 0,
          sellPricePerUnit: Number(s['Current Sell Price']) || 0,
        };
      })
      .filter(Boolean);
  }

  // ORDER 1: Pickup, Paid, New — Anna Kowalska
  try {
    const lines1 = makeLines([['rose', 15], ['eucalyptus', 5]]);
    if (lines1.length > 0) {
      const r = await api('POST', '/orders', {
        customer: customers['Anna Kowalska'].id,
        customerRequest: '15 pink roses + 5 eucalyptus, birthday bouquet',
        source: 'Instagram',
        deliveryType: 'Pickup',
        orderLines: lines1,
        notes: 'Friend birthday, wants soft pink tones',
        paymentStatus: 'Paid',
        paymentMethod: 'Cash',
        priceOverride: null,
      });
      console.log(`  ✓ Order 1 created: Pickup/Paid/New — Anna Kowalska (${r.order.id})`);
    } else {
      console.log('  ⚠ Order 1 skipped: no matching stock items');
    }
  } catch (e) { console.error(`  ✗ Order 1 failed:`, e.message); }

  // ORDER 2: Delivery, Paid, New (will be moved to Ready) — Marta Nowak
  try {
    const lines2 = makeLines([['rose', 25]]);
    if (lines2.length > 0) {
      const r = await api('POST', '/orders', {
        customer: customers['Marta Nowak'].id,
        customerRequest: '25 red roses, anniversary',
        source: 'WhatsApp',
        deliveryType: 'Delivery',
        orderLines: lines2,
        notes: 'Anniversary gift, must be exactly 25 stems',
        paymentStatus: 'Paid',
        paymentMethod: 'Mbank',
        priceOverride: 200,
        delivery: {
          address: 'ul. Florianska 15, Krakow',
          recipientName: 'Tomasz Nowak',
          recipientPhone: '+48 506 777 777',
          date: new Date().toISOString().split('T')[0],
          time: '17:00',
          cardText: 'Happy anniversary my love!',
          driver: 'Timur',
          fee: 40,
        },
      });
      console.log(`  ✓ Order 2 created: Delivery/Paid/New — Marta Nowak (${r.order.id})`);

      // Move to Ready status
      await api('PATCH', `/orders/${r.order.id}`, { Status: 'Ready' });
      console.log(`    → Status updated to Ready`);
    } else {
      console.log('  ⚠ Order 2 skipped: no matching stock items');
    }
  } catch (e) { console.error(`  ✗ Order 2 failed:`, e.message); }

  // ORDER 3: Delivery, Unpaid, New — Katya Ivanova (price override, no specific flowers)
  try {
    const r = await api('POST', '/orders', {
      customer: customers['Katya Ivanova'].id,
      customerRequest: 'Florist choice 300 zl, bright colors, birthday',
      source: 'Telegram',
      deliveryType: 'Delivery',
      orderLines: [],  // florist choice - will compose later
      notes: 'Client said bright and cheerful, no white flowers',
      paymentStatus: 'Unpaid',
      paymentMethod: '',
      priceOverride: 300,
      delivery: {
        address: 'ul. Grodzka 5, Krakow',
        recipientName: 'Olga Petrova',
        recipientPhone: '+48 507 888 888',
        date: new Date().toISOString().split('T')[0],
        time: '14:00',
        cardText: 'Happy birthday Olga!',
        fee: 35,
      },
    });
    console.log(`  ✓ Order 3 created: Delivery/Unpaid/New — Katya Ivanova (${r.order.id})`);
  } catch (e) { console.error(`  ✗ Order 3 failed:`, e.message); }

  // ORDER 4: Pickup, Paid, Ready — Piotr Wisniewski (test "Mark Picked Up")
  try {
    const lines4 = makeLines([['tulip', 10]]);
    if (lines4.length > 0) {
      const r = await api('POST', '/orders', {
        customer: customers['Piotr Wisniewski'].id,
        customerRequest: '10 tulips, simple and elegant',
        source: 'In-store',
        deliveryType: 'Pickup',
        orderLines: lines4,
        notes: '',
        paymentStatus: 'Paid',
        paymentMethod: 'Card',
        priceOverride: null,
      });
      console.log(`  ✓ Order 4 created: Pickup/Paid/New — Piotr Wisniewski (${r.order.id})`);

      // Move to Ready
      await api('PATCH', `/orders/${r.order.id}`, { Status: 'Ready' });
      console.log(`    → Status updated to Ready (test "Mark Picked Up")`);
    } else {
      console.log('  ⚠ Order 4 skipped: no matching stock items');
    }
  } catch (e) { console.error(`  ✗ Order 4 failed:`, e.message); }

  // ORDER 5: Delivery, Paid, Out for Delivery — Julia Mazur (test driver flow)
  try {
    const lines5 = makeLines([['peony', 20], ['ranunculus', 10]]);
    // Fallback: if peony/ranunculus not found, use any available stock
    let finalLines = lines5;
    if (finalLines.length === 0) {
      const available = stock.filter(s => (s['Current Quantity'] || 0) > 0).slice(0, 2);
      finalLines = available.map(s => ({
        stockItemId: s.id,
        flowerName: s['Display Name'],
        quantity: Math.min(10, s['Current Quantity'] || 10),
        costPricePerUnit: Number(s['Current Cost Price']) || 0,
        sellPricePerUnit: Number(s['Current Sell Price']) || 0,
      }));
    }

    if (finalLines.length > 0) {
      const r = await api('POST', '/orders', {
        customer: customers['Julia Mazur'].id,
        customerRequest: 'Luxury peony bouquet with ranunculus',
        source: 'Flowwow',
        deliveryType: 'Delivery',
        orderLines: finalLines,
        notes: 'VIP client, call 15 min before delivery',
        paymentStatus: 'Paid',
        paymentMethod: 'Revolut',
        priceOverride: null,
        delivery: {
          address: 'ul. Szewska 22, Krakow',
          recipientName: 'Julia Mazur',
          recipientPhone: '+48 505 555 555',
          date: new Date().toISOString().split('T')[0],
          time: '12:00',
          cardText: '',
          driver: 'Nikita',
          fee: 45,
        },
      });
      console.log(`  ✓ Order 5 created: Delivery/Paid/New — Julia Mazur (${r.order.id})`);

      // Move to Ready, then Out for Delivery (via delivery status)
      await api('PATCH', `/orders/${r.order.id}`, { Status: 'Ready' });
      console.log(`    → Status updated to Ready`);

      // Find the delivery record and update it
      const deliveries = await api('GET', '/deliveries');
      const del = deliveries.find(d => d['Linked Order']?.[0] === r.order.id);
      if (del) {
        await api('PATCH', `/deliveries/${del.id}`, { Status: 'Out for Delivery' });
        console.log(`    → Delivery marked "Out for Delivery", driver: Nikita`);
      }
    } else {
      console.log('  ⚠ Order 5 skipped: no stock items available');
    }
  } catch (e) { console.error(`  ✗ Order 5 failed:`, e.message); }

  console.log('\n=== Seeding Complete ===');
  console.log('\nTest matrix:');
  console.log('  Order 1: Pickup/Paid/New     — Anna Kowalska   → test basic order visibility');
  console.log('  Order 2: Delivery/Paid/Ready  — Marta Nowak    → test delivery in delivery app');
  console.log('  Order 3: Delivery/Unpaid/New  — Katya Ivanova  → test unpaid flow, price override');
  console.log('  Order 4: Pickup/Paid/Ready    — Piotr W.       → test "Mark Picked Up" button');
  console.log('  Order 5: Delivery/Paid/OFD    — Julia Mazur    → test driver flow, "Mark Delivered"');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
