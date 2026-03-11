// Wix ↔ Airtable bidirectional sync job.
// Think of this as a supply chain synchronization process:
// 1. Pull: check the supplier's catalog (Wix) for new/changed products
// 2. Push: send our warehouse data (prices, stock) back to the supplier's system
//
// Wix owns: product names, images, variant names
// Airtable owns: prices, lead times, stock, categories, active status

import * as db from './airtable.js';
import { TABLES } from '../config/airtable.js';

const WIX_API_URL = 'https://www.wixapis.com';

// ── Wix API helpers ────────────────────────────────────────

function wixHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': process.env.WIX_API_KEY,
    'wix-site-id': process.env.WIX_SITE_ID,
  };
}

/**
 * Fetch all products from Wix Store (handles pagination).
 * Like requesting a full inventory list from a supplier.
 */
async function fetchAllWixProducts() {
  const products = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const res = await fetch(`${WIX_API_URL}/stores/v1/products/query`, {
      method: 'POST',
      headers: wixHeaders(),
      body: JSON.stringify({
        query: { paging: { limit, offset } },
        includeVariants: true,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Wix API error ${res.status}: ${text}`);
    }

    const data = await res.json();
    const batch = data.products || [];
    products.push(...batch);

    if (batch.length < limit) break;
    offset += limit;
  }

  return products;
}

/**
 * Update a Wix product variant's price.
 */
async function updateWixVariantPrice(productId, variantId, price) {
  const res = await fetch(
    `${WIX_API_URL}/stores/v1/products/${productId}/variants/${variantId}`,
    {
      method: 'PATCH',
      headers: wixHeaders(),
      body: JSON.stringify({
        variant: {
          variant: {
            priceData: { price },
          },
        },
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Wix price update failed for ${productId}/${variantId}: ${text}`);
  }
}

/**
 * Update Wix product visibility (hide/show).
 */
async function updateWixProductVisibility(productId, visible) {
  const res = await fetch(
    `${WIX_API_URL}/stores/v1/products/${productId}`,
    {
      method: 'PATCH',
      headers: wixHeaders(),
      body: JSON.stringify({
        product: { visible },
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Wix visibility update failed for ${productId}: ${text}`);
  }
}

// ── Main sync job ──────────────────────────────────────────

/**
 * Run a full bidirectional sync between Wix and Airtable.
 *
 * Phase 1 (Wix → Airtable): Pull new/changed products from Wix
 * Phase 2 (Airtable → Wix): Push prices and stock to Wix
 *
 * Returns a summary object for logging/display.
 */
export async function runSync() {
  const stats = {
    new: 0,
    updated: 0,
    deactivated: 0,
    pricesSynced: 0,
    stockSynced: 0,
    errors: [],
  };

  try {
    // ── Phase 1: Wix → Airtable (pull) ──────────────────
    console.log('[SYNC] Fetching products from Wix...');
    const wixProducts = await fetchAllWixProducts();
    console.log(`[SYNC] Found ${wixProducts.length} products in Wix`);

    // Load existing Product Config rows from Airtable
    const existingRows = await db.list(TABLES.PRODUCT_CONFIG, {
      fields: [
        'Product Name', 'Variant Name', 'Wix Product ID', 'Wix Variant ID',
        'Image URL', 'Price', 'Active', 'Visible in Wix',
      ],
    });

    // Index existing rows by "productId::variantId" for fast lookup
    const existingMap = new Map();
    for (const row of existingRows) {
      const key = `${row['Wix Product ID']}::${row['Wix Variant ID']}`;
      existingMap.set(key, row);
    }

    // Track which Wix IDs we see (for deactivation check)
    const seenKeys = new Set();

    for (const product of wixProducts) {
      const productId = product.id;
      const productName = product.name || '';
      const imageUrl = product.media?.mainMedia?.image?.url || '';

      // Skip extras (products without variants or with specific collections)
      const variants = product.variants || [];
      if (variants.length === 0) continue;

      // Detect product type from variant naming pattern
      const productType = detectProductType(variants);

      for (let i = 0; i < variants.length; i++) {
        const variant = variants[i];
        const variantId = variant.id;
        // Variant name: join all choice values (e.g., "S", "M", "51")
        const variantName = Object.values(variant.choices || {}).join(' / ') || `Variant ${i + 1}`;
        const variantPrice = variant.variant?.priceData?.price
          || variant.variant?.priceData?.discountedPrice
          || 0;

        const key = `${productId}::${variantId}`;
        seenKeys.add(key);

        const existing = existingMap.get(key);

        if (!existing) {
          // New variant — create with safe defaults (Active=false, LT=1)
          try {
            await db.create(TABLES.PRODUCT_CONFIG, {
              'Product Name': productName,
              'Variant Name': variantName,
              'Sort Order': i + 1,
              'Wix Product ID': productId,
              'Wix Variant ID': variantId,
              'Image URL': imageUrl,
              'Price': Number(variantPrice) || 0,
              'Lead Time Days': 1,
              'Active': false,
              'Visible in Wix': product.visible !== false,
              'Product Type': productType,
              'Min Stems': productType === 'mono' ? parseMinStems(variantName) : 0,
            });
            stats.new++;
          } catch (err) {
            stats.errors.push(`Create ${productName}/${variantName}: ${err.message}`);
          }
        } else {
          // Existing variant — update Wix-owned fields if changed
          const updates = {};
          if (existing['Product Name'] !== productName) updates['Product Name'] = productName;
          if (existing['Image URL'] !== imageUrl) updates['Image URL'] = imageUrl;

          if (Object.keys(updates).length > 0) {
            try {
              await db.update(TABLES.PRODUCT_CONFIG, existing.id, updates);
              stats.updated++;
            } catch (err) {
              stats.errors.push(`Update ${productName}/${variantName}: ${err.message}`);
            }
          }
        }
      }
    }

    // Deactivate rows whose Wix product/variant no longer exists
    for (const row of existingRows) {
      const key = `${row['Wix Product ID']}::${row['Wix Variant ID']}`;
      if (!seenKeys.has(key) && row['Active']) {
        try {
          await db.update(TABLES.PRODUCT_CONFIG, row.id, { 'Active': false });
          stats.deactivated++;
        } catch (err) {
          stats.errors.push(`Deactivate ${row['Product Name']}: ${err.message}`);
        }
      }
    }

    // ── Phase 2: Airtable → Wix (push prices) ──────────
    // Re-fetch to get latest prices (including any just-created rows)
    const configRows = await db.list(TABLES.PRODUCT_CONFIG, {
      filterByFormula: '{Active} = TRUE()',
      fields: [
        'Wix Product ID', 'Wix Variant ID', 'Price', 'Visible in Wix',
      ],
    });

    // Build a map of Wix variant prices for comparison
    const wixPriceMap = new Map();
    for (const product of wixProducts) {
      for (const variant of (product.variants || [])) {
        const price = variant.variant?.priceData?.price || 0;
        wixPriceMap.set(`${product.id}::${variant.id}`, Number(price));
      }
    }

    for (const row of configRows) {
      const key = `${row['Wix Product ID']}::${row['Wix Variant ID']}`;
      const airtablePrice = Number(row['Price'] || 0);
      const wixPrice = wixPriceMap.get(key);

      // Push price to Wix if it differs
      if (wixPrice !== undefined && Math.abs(airtablePrice - wixPrice) > 0.01) {
        try {
          await updateWixVariantPrice(
            row['Wix Product ID'], row['Wix Variant ID'], airtablePrice
          );
          stats.pricesSynced++;
        } catch (err) {
          stats.errors.push(`Price sync ${key}: ${err.message}`);
        }
      }
    }

    console.log('[SYNC] Complete:', JSON.stringify(stats));
  } catch (err) {
    stats.errors.push(`Fatal: ${err.message}`);
    console.error('[SYNC] Fatal error:', err);
  }

  // Log to Sync Log table
  try {
    await db.create(TABLES.SYNC_LOG, {
      'Timestamp': new Date().toISOString(),
      'Status': stats.errors.length > 0 ? 'failed' : 'success',
      'New Products': stats.new,
      'Updated': stats.updated,
      'Deactivated': stats.deactivated,
      'Price Syncs': stats.pricesSynced,
      'Stock Syncs': stats.stockSynced,
      'Error Message': stats.errors.join('\n') || '',
    });
  } catch (err) {
    console.error('[SYNC] Failed to write sync log:', err.message);
  }

  return stats;
}

// ── Helpers ────────────────────────────────────────────────

/**
 * Detect if a product is mono (stem-count variants) or mix (size variants).
 * Mono: all variant names are pure numbers (11, 25, 51, 101)
 * Mix: variant names are size labels (S, M, L, XL, XS, XXL)
 */
function detectProductType(variants) {
  const names = variants.map(v =>
    Object.values(v.choices || {}).join('').trim()
  );
  const allNumeric = names.every(n => /^\d+$/.test(n));
  return allNumeric ? 'mono' : 'mix';
}

/**
 * Parse stem count from a variant name like "51" or "101".
 * Returns 0 if not a number.
 */
function parseMinStems(name) {
  const n = parseInt(name, 10);
  return isNaN(n) ? 0 : n;
}
