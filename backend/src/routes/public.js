// Public routes — unauthenticated endpoints for the Wix storefront.
// Think of this as the showroom: visitors browse freely, no badge needed.
// Data is served from Airtable via a 60-second in-memory cache to stay
// well within Airtable's 5 req/sec limit even under traffic spikes.

import { Router } from 'express';
import * as db from '../services/airtable.js';
import { TABLES } from '../config/airtable.js';
import { getConfig, getActiveSeasonalCategory } from './settings.js';

const router = Router();

// ── In-memory cache (60s TTL) ──────────────────────────────
// Like a buffer stock shelf near the shipping dock — pre-picked items
// ready to go, restocked every 60 seconds from the main warehouse.
const cache = {};
const CACHE_TTL = 60_000; // ms

function cached(key, fetcher) {
  return async (_req, res, next) => {
    try {
      const now = Date.now();
      if (cache[key] && now - cache[key].ts < CACHE_TTL) {
        return res.json(cache[key].data);
      }
      const data = await fetcher();
      cache[key] = { data, ts: now };
      res.json(data);
    } catch (err) {
      next(err);
    }
  };
}

// ── GET /api/public/products ───────────────────────────────
// Returns all active products grouped for storefront display.
// Wix Velo calls this to populate category repeaters.
router.get('/products', cached('products', async () => {
  const rows = await db.list(TABLES.PRODUCT_CONFIG, {
    filterByFormula: '{Active} = TRUE()',
    fields: [
      'Product Name', 'Variant Name', 'Sort Order',
      'Wix Product ID', 'Wix Variant ID',
      'Category', 'Lead Time Days', 'Price', 'Image URL',
      'Key Flower', 'Min Stems', 'Product Type',
      'Available From', 'Available To', 'Visible in Wix',
    ],
  });

  // Also fetch stock quantities for inStock check
  const stockRows = await db.list(TABLES.STOCK, {
    filterByFormula: '{Active} = TRUE()',
    fields: ['Display Name', 'Current Quantity'],
  });
  const stockMap = Object.fromEntries(
    stockRows.map(s => [s['Display Name'], Number(s['Current Quantity'] || 0)])
  );

  // Group rows by Wix Product ID → product with variants
  const productMap = new Map();
  for (const row of rows) {
    const pid = row['Wix Product ID'];
    if (!pid) continue;

    // Check seasonal availability window
    if (!isWithinDateWindow(row['Available From'], row['Available To'])) continue;

    if (!productMap.has(pid)) {
      productMap.set(pid, {
        wixProductId: pid,
        name: row['Product Name'] || '',
        imageUrl: row['Image URL'] || '',
        category: [],
        productType: row['Product Type'] || 'mix',
        variants: [],
      });
    }

    const product = productMap.get(pid);

    // Merge categories from all variants (multi-select field)
    const cats = parseCategoryField(row['Category']);
    for (const c of cats) {
      if (!product.category.includes(c)) product.category.push(c);
    }

    // Determine stock status for this variant
    const keyFlowerName = Array.isArray(row['Key Flower'])
      ? null // linked record IDs — we'd need a lookup; for now use Min Stems
      : row['Key Flower'];
    const stockQty = keyFlowerName ? (stockMap[keyFlowerName] || 0) : Infinity;
    const minStems = Number(row['Min Stems'] || 0);
    const variantInStock = minStems > 0 ? stockQty >= minStems : stockQty > 0;

    product.variants.push({
      wixVariantId: row['Wix Variant ID'] || '',
      name: row['Variant Name'] || '',
      price: Number(row['Price'] || 0),
      leadTimeDays: Number(row['Lead Time Days'] ?? 1),
      sortOrder: Number(row['Sort Order'] || 0),
      inStock: variantInStock,
      visibleInWix: row['Visible in Wix'] !== false,
    });
  }

  // Build final product array with computed fields
  const seasonal = getActiveSeasonalCategory();
  const products = [];

  for (const product of productMap.values()) {
    // Sort variants by sort order
    product.variants.sort((a, b) => a.sortOrder - b.sortOrder);

    const activePrices = product.variants.filter(v => v.price > 0);
    const minPrice = activePrices.length > 0
      ? Math.min(...activePrices.map(v => v.price))
      : 0;

    const availableToday = product.variants.some(v => v.leadTimeDays === 0 && v.inStock);
    const inStock = product.variants.some(v => v.inStock);

    products.push({
      wixProductId: product.wixProductId,
      name: product.name,
      imageUrl: product.imageUrl,
      category: product.category,
      productType: product.productType,
      inStock,
      minPrice,
      availableToday,
      variants: product.variants,
    });
  }

  // Collect all categories that have at least one active product
  const activeCats = [...new Set(products.flatMap(p => p.category))];

  return {
    categories: activeCats,
    seasonalCategory: seasonal,
    products,
    updatedAt: new Date().toISOString(),
  };
}));

// ── GET /api/public/stock-availability ─────────────────────
// Lightweight stock check — Wix Velo uses this for real-time badge updates.
router.get('/stock-availability', cached('stock', async () => {
  const rows = await db.list(TABLES.STOCK, {
    filterByFormula: '{Active} = TRUE()',
    fields: ['Display Name', 'Current Quantity'],
  });

  return {
    items: rows.map(r => ({
      displayName: r['Display Name'] || '',
      quantity: Number(r['Current Quantity'] || 0),
      available: Number(r['Current Quantity'] || 0) > 0,
    })),
    updatedAt: new Date().toISOString(),
  };
}));

// ── GET /api/public/delivery-pricing ───────────────────────
// Zone-based delivery fees — consumed by Wix Shipping Rates SPI.
router.get('/delivery-pricing', (_req, res) => {
  res.json({
    zones: getConfig('deliveryZones') || [],
    freeDeliveryThreshold: getConfig('freeDeliveryThreshold') || 0,
    expressSurcharge: getConfig('expressSurcharge') || 0,
    timeSlots: getConfig('deliveryTimeSlots') || [],
    currency: 'PLN',
  });
});

// ── GET /api/public/categories ─────────────────────────────
// Category structure for Wix nav — permanent + active seasonal + auto.
router.get('/categories', (_req, res) => {
  const sc = getConfig('storefrontCategories') || {};
  const seasonal = getActiveSeasonalCategory();

  const permanent = sc.permanent || [];
  const auto = ['Available Today'];
  const all = [...permanent, ...(seasonal ? [seasonal.name] : []), ...auto];

  res.json({
    permanent,
    seasonal: seasonal || { active: null, slug: null },
    auto,
    all,
  });
});

// ── Helpers ────────────────────────────────────────────────

/** Parse Airtable multi-select Category field (comes as array or comma-string) */
function parseCategoryField(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

/** Check if today falls within an optional date window (MM-DD strings or full dates) */
function isWithinDateWindow(from, to) {
  if (!from && !to) return true; // no window = always available
  const now = new Date();
  const mmdd = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  // Support both MM-DD and full ISO date formats
  const fromMD = from ? from.slice(-5) : '01-01';
  const toMD = to ? to.slice(-5) : '12-31';

  return mmdd >= fromMD && mmdd <= toMD;
}

export default router;
