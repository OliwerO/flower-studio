// Wix ↔ Airtable bidirectional sync job.
// Think of this as a supply chain synchronization process:
// 1. Pull: check the supplier's catalog (Wix) for new/changed products
// 2. Push: send our warehouse data (prices, stock) back to the supplier's system
//
// Wix owns: product names, images, variant names
// Airtable owns: prices, lead times, stock, categories, active status

import * as db from './airtable.js';
import { TABLES } from '../config/airtable.js';
import { sendAlert } from './telegram.js';
import { getActiveSeasonalCategory, getConfig, updateConfig } from '../routes/settings.js';

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
 * Uses the batch variants endpoint — variant ID goes in the body, not the URL.
 */
async function updateWixVariantPrice(productId, variantId, price) {
  const res = await fetch(
    `${WIX_API_URL}/stores/v1/products/${productId}/variants`,
    {
      method: 'PATCH',
      headers: wixHeaders(),
      body: JSON.stringify({
        variants: [{
          id: variantId,
          variant: {
            priceData: { price },
          },
        }],
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Wix price update failed for ${productId}/${variantId}: ${text}`);
  }
}

/**
 * Update Wix inventory for a product variant.
 * Uses the Wix Inventory API to push stock quantities.
 */
/**
 * Update a variant's availability on Wix using untracked inventory.
 * trackQuantity=false means we just toggle inStock on/off — no real
 * inventory counting. Like a simple "available / sold out" switch.
 */
async function updateWixInventory(productId, variantId, quantity) {
  const inStock = quantity > 0;

  // Wix Inventory v2 endpoint — update by product ID
  const res = await fetch(
    `${WIX_API_URL}/stores/v2/inventoryItems/product/${productId}`,
    {
      method: 'PATCH',
      headers: wixHeaders(),
      body: JSON.stringify({
        inventoryItem: {
          trackQuantity: false,
          variants: [{
            variantId,
            inStock,
          }],
        },
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Wix inventory update failed for ${productId}/${variantId}: ${text}`);
  }
}

/**
 * Update Wix product visibility (hide/show).
 */
// Reserved for future use — hides/shows a product on Wix storefront.
// eslint-disable-next-line no-unused-vars
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

/**
 * Update Wix product content (name, description).
 * Only sends fields that are provided — won't overwrite with empty values.
 */
async function updateWixProductContent(productId, { name, description }) {
  const product = {};
  if (name) product.name = name;
  if (description !== undefined) product.description = description;
  if (Object.keys(product).length === 0) return;

  const res = await fetch(
    `${WIX_API_URL}/stores/v1/products/${productId}`,
    {
      method: 'PATCH',
      headers: wixHeaders(),
      body: JSON.stringify({ product }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Wix product content update failed for ${productId}: ${text}`);
  }
}

// ── Wix Category API helpers ──────────────────────────────
// Category management — like reassigning products between
// different aisles (departments) in a retail store.

/**
 * Fetch all Wix Store collections (categories).
 * Returns array of { id, name, slug }.
 */
async function fetchWixCategories() {
  const res = await fetch(`${WIX_API_URL}/stores/v1/collections/query`, {
    method: 'POST',
    headers: wixHeaders(),
    body: JSON.stringify({ query: { paging: { limit: 100 } } }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Wix categories fetch failed ${res.status}: ${text}`);
  }

  const data = await res.json();
  return (data.collections || []).map(c => ({
    id: c.id,
    name: c.name,
    slug: c.slug || '',
    description: c.description || '',
  }));
}

/**
 * Update a Wix collection's name and description.
 */
async function updateWixCategory(id, { name, description }) {
  const updates = {};
  if (name) updates.name = name;
  if (description !== undefined) updates.description = description;

  const res = await fetch(`${WIX_API_URL}/stores/v1/collections/${id}`, {
    method: 'PATCH',
    headers: wixHeaders(),
    body: JSON.stringify({ collection: updates }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Wix category update failed for ${id}: ${text}`);
  }
}

/**
 * Assign products to a Wix collection.
 * Adds products first, then removes ones that shouldn't be there.
 * Order matters — add before remove to avoid emptying the category
 * if the add API call fails.
 */
async function setWixCategoryProducts(collectionId, productIds) {
  // Step 1: Add products to collection (Wix deduplicates)
  if (productIds.length > 0) {
    // Wix API accepts max ~100 product IDs per call
    for (let i = 0; i < productIds.length; i += 100) {
      const batch = productIds.slice(i, i + 100);
      const res = await fetch(
        `${WIX_API_URL}/stores/v1/collections/${collectionId}/productIds`,
        {
          method: 'POST',
          headers: wixHeaders(),
          body: JSON.stringify({ productIds: batch }),
        }
      );

      if (!res.ok) {
        const text = await res.text();
        console.error(`[SYNC] Add to collection failed: ${text}`);
        // Don't proceed to remove if add failed — protect existing state
        throw new Error(`Wix category product assignment failed: ${text}`);
      }
    }
  }

  // Step 2: Remove products that shouldn't be in this collection
  try {
    const existing = await fetch(`${WIX_API_URL}/stores/v1/products/query`, {
      method: 'POST',
      headers: wixHeaders(),
      body: JSON.stringify({
        query: {
          filter: JSON.stringify({ collections: { $hasSome: [collectionId] } }),
          paging: { limit: 100 },
        },
      }),
    });

    if (existing.ok) {
      const data = await existing.json();
      const existingIds = (data.products || []).map(p => p.id);
      const toRemove = existingIds.filter(id => !productIds.includes(id));
      for (const pid of toRemove) {
        await fetch(`${WIX_API_URL}/stores/v1/collections/${collectionId}/productIds/${pid}`, {
          method: 'DELETE',
          headers: wixHeaders(),
        });
      }
    }
  } catch (err) {
    console.warn(`[SYNC] Could not clean old category products: ${err.message}`);
  }
}

// ── Sync jobs ──────────────────────────────────────────────

/**
 * Shared helper: fetch Wix products + build category name map.
 */
async function fetchWixData() {
  const wixProducts = await fetchAllWixProducts();

  const wixCategoryIdToName = {};
  let wixCategories = [];
  try {
    wixCategories = await fetchWixCategories();
    const sc = getConfig('storefrontCategories') || {};
    const ourNames = [...(sc.permanent || []).map(p => typeof p === 'string' ? p : p.name), ...(sc.seasonal || []).map(s => s.name)];
    for (const wc of wixCategories) {
      const match = ourNames.find(n =>
        n.toLowerCase().replace(/[^a-z0-9]+/g, '-') === wc.slug
        || n.toLowerCase() === wc.name.toLowerCase()
      );
      if (match) wixCategoryIdToName[wc.id] = match;
    }
  } catch (err) {
    console.warn('[SYNC] Could not fetch Wix categories:', err.message);
  }

  return { wixProducts, wixCategories, wixCategoryIdToName };
}

/** Write a sync log entry to Airtable + alert on failure. */
async function logSync(direction, stats) {
  try {
    await db.create(TABLES.SYNC_LOG, {
      'Timestamp': new Date().toISOString(),
      'Status': stats.errors.length > 0 ? 'failed' : `success (${direction})`,
      'New Products': stats.new || 0,
      'Updated': stats.updated || 0,
      'Deactivated': stats.deactivated || 0,
      'Price Syncs': stats.pricesSynced || 0,
      'Stock Syncs': stats.stockSynced || 0,
      'Error Message': stats.errors.join('\n') || '',
    });
  } catch (err) {
    console.error('[SYNC] Failed to write sync log:', err.message);
  }

  if (stats.errors.length > 0) {
    const errorSummary = stats.errors.slice(0, 5).join('\n');
    await sendAlert(
      `SYNC ${direction.toUpperCase()} FAILED\n\n`
      + `Errors: ${stats.errors.length}\n\n${errorSummary}`
      + (stats.errors.length > 5 ? `\n...and ${stats.errors.length - 5} more` : '')
    );
  }
}

/**
 * Pull from Wix → Airtable.
 * Imports products, visibility, categories, prices from the Wix storefront.
 */
export async function runPull() {
  const stats = { new: 0, updated: 0, deactivated: 0, errors: [] };

  try {
    console.log('[PULL] Fetching products from Wix...');
    const { wixProducts, wixCategories, wixCategoryIdToName } = await fetchWixData();
    console.log(`[PULL] Found ${wixProducts.length} products in Wix`);

    // Load existing Product Config rows
    const existingRows = await db.list(TABLES.PRODUCT_CONFIG, {
      fields: [
        'Product Name', 'Variant Name', 'Wix Product ID', 'Wix Variant ID',
        'Image URL', 'Price', 'Active', 'Visible in Wix', 'Category', 'Description',
      ],
    });

    const existingMap = new Map();
    for (const row of existingRows) {
      const key = `${row['Wix Product ID']}::${row['Wix Variant ID']}`;
      existingMap.set(key, row);
    }

    const seenKeys = new Set();

    for (const product of wixProducts) {
      const productId = product.id;
      const productName = product.name || '';
      const productDescription = stripHtml(product.description || '');
      const imageUrl = product.media?.mainMedia?.image?.url || '';
      const variants = product.variants || [];
      if (productName.includes('Mix of the day') || productName.includes('mix of the day')) {
        console.log(`[PULL] "${productName}": ${variants.length} variants, ids: ${variants.map(v => v.id).join(', ')}`);
        if (variants[0]) console.log(`[PULL]   variant[0] keys:`, Object.keys(variants[0]).join(', '));
      }
      if (variants.length === 0) continue;

      const productType = detectProductType(variants);
      const wixVisible = product.visible !== false;

      const importedCategories = (product.collectionIds || [])
        .map(id => wixCategoryIdToName[id])
        .filter(Boolean);

      for (let i = 0; i < variants.length; i++) {
        const variant = variants[i];
        const variantId = variant.id;
        const variantName = Object.values(variant.choices || {}).join(' / ') || `Variant ${i + 1}`;
        const variantPrice = variant.variant?.priceData?.price
          || variant.variant?.priceData?.discountedPrice || 0;

        const key = `${productId}::${variantId}`;
        seenKeys.add(key);
        const existing = existingMap.get(key);

        if (!existing) {
          try {
            const newRow = {
              'Product Name': productName,
              'Variant Name': variantName,
              'Sort Order': i + 1,
              'Wix Product ID': productId,
              'Wix Variant ID': variantId,
              'Image URL': imageUrl,
              'Price': Number(variantPrice) || 0,
              'Lead Time Days': 1,
              'Active': wixVisible,
              'Visible in Wix': wixVisible,
              'Product Type': productType,
              'Min Stems': productType === 'mono' ? parseMinStems(variantName) : 0,
            };
            if (productDescription) newRow['Description'] = productDescription;
            if (importedCategories.length > 0) newRow['Category'] = importedCategories;
            await db.create(TABLES.PRODUCT_CONFIG, newRow);
            stats.new++;
          } catch (err) {
            stats.errors.push(`Create ${productName}/${variantName}: ${err.message}`);
          }
        } else {
          const updates = {};
          if (existing['Product Name'] !== productName) updates['Product Name'] = productName;
          if (existing['Image URL'] !== imageUrl) updates['Image URL'] = imageUrl;
          if (existing['Active'] !== wixVisible) updates['Active'] = wixVisible;
          if (existing['Visible in Wix'] !== wixVisible) updates['Visible in Wix'] = wixVisible;
          const existingCats = parseCategoryField(existing['Category']);
          if (existingCats.length === 0 && importedCategories.length > 0) {
            updates['Category'] = importedCategories;
          }
          if (!existing['Description'] && productDescription) {
            updates['Description'] = productDescription;
          }
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

    // Backfill seasonal descriptions from Wix
    try {
      const sc = { ...(getConfig('storefrontCategories') || {}) };
      const catMap = {};
      for (const c of wixCategories) catMap[c.slug] = c.id;
      sc.wixCategoryMap = catMap;

      const wixSeasonalCat = wixCategories.find(c => c.slug === 'seasonal');
      if (wixSeasonalCat) {
        const seasonal = getActiveSeasonalCategory();
        if (seasonal) {
          const idx = (sc.seasonal || []).findIndex(s => s.slug === seasonal.slug);
          if (idx >= 0) {
            const entry = sc.seasonal[idx];
            if (!entry.description && wixSeasonalCat.description) {
              entry.description = wixSeasonalCat.description;
            }
            if (!entry.translations) entry.translations = {};
            if (!entry.translations.pl) entry.translations.pl = {};
            if (!entry.translations.pl.title && wixSeasonalCat.name) {
              entry.translations.pl.title = wixSeasonalCat.name;
            }
            if (!entry.translations.pl.description && wixSeasonalCat.description) {
              entry.translations.pl.description = wixSeasonalCat.description;
            }
          }
        }
      }
      updateConfig('storefrontCategories', sc);
    } catch (err) {
      console.warn('[PULL] Category backfill error:', err.message);
    }

    console.log('[PULL] Complete:', JSON.stringify(stats));
  } catch (err) {
    stats.errors.push(`Fatal: ${err.message}`);
    console.error('[PULL] Fatal error:', err);
  }

  await logSync('pull', stats);
  return stats;
}

/**
 * Push from Airtable → Wix.
 * Pushes prices, visibility, stock, and category assignments to Wix.
 */
export async function runPush() {
  const stats = { pricesSynced: 0, stockSynced: 0, categoriesSynced: 0, errors: [] };

  try {
    console.log('[PUSH] Fetching current Wix state for comparison...');
    const { wixProducts, wixCategories } = await fetchWixData();

    // ── Prices ──────────────────────────────────────────
    const configRows = await db.list(TABLES.PRODUCT_CONFIG, {
      filterByFormula: '{Active} = TRUE()',
      fields: ['Wix Product ID', 'Wix Variant ID', 'Price', 'Visible in Wix'],
    });

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
      if (wixPrice !== undefined && Math.abs(airtablePrice - wixPrice) > 0.01) {
        try {
          await updateWixVariantPrice(row['Wix Product ID'], row['Wix Variant ID'], airtablePrice);
          stats.pricesSynced++;
        } catch (err) {
          stats.errors.push(`Price ${key}: ${err.message}`);
        }
      }
    }

    // ── Availability (inventory-based) ─────────────────
    // Active checkbox controls per-variant availability on Wix:
    // Active = true → inventory 999 (available to buy)
    // Active = false/undefined → inventory 0 (out of stock on Wix)
    // We don't track real inventory in Wix — just available/not-available.
    const allVariantRows = await db.list(TABLES.PRODUCT_CONFIG, {
      fields: ['Wix Product ID', 'Wix Variant ID', 'Active'],
    });

    for (const row of allVariantRows) {
      const pid = row['Wix Product ID'];
      const vid = row['Wix Variant ID'];
      if (!pid || !vid) continue;
      const shouldBeAvailable = row['Active'] === true;
      const targetQty = shouldBeAvailable ? 999 : 0;
      try {
        await updateWixInventory(pid, vid, targetQty);
        stats.stockSynced++;
      } catch (err) {
        stats.errors.push(`Availability ${pid}/${vid}: ${err.message}`);
      }
    }

    // ── Categories ──────────────────────────────────────
    try {
      const catMap = {};
      for (const c of wixCategories) catMap[c.slug] = c.id;

      const allConfigRows = await db.list(TABLES.PRODUCT_CONFIG, {
        filterByFormula: '{Active} = TRUE()',
        fields: ['Wix Product ID', 'Category', 'Lead Time Days', 'Key Flower', 'Min Stems'],
      });

      const sc = getConfig('storefrontCategories') || {};

      // Permanent categories
      for (const catEntry of (sc.permanent || [])) {
        const catName = typeof catEntry === 'string' ? catEntry : catEntry.name;
        const slug = catName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const wixCatId = catMap[slug];
        if (!wixCatId) continue;
        const productIds = [...new Set(
          allConfigRows.filter(r => parseCategoryField(r['Category']).includes(catName))
            .map(r => r['Wix Product ID']).filter(Boolean)
        )];
        if (productIds.length === 0) continue;
        try {
          await setWixCategoryProducts(wixCatId, productIds);
          stats.categoriesSynced++;
        } catch (err) {
          stats.errors.push(`Category ${catName}: ${err.message}`);
        }
      }

      // Seasonal category
      const seasonal = getActiveSeasonalCategory();
      const seasonalWixId = catMap['seasonal'];
      console.log(`[PUSH] Seasonal: active=${seasonal?.name}, wixId=${seasonalWixId}`);
      if (seasonal && seasonalWixId) {
        const seasonalProductIds = [...new Set(
          allConfigRows.filter(r => parseCategoryField(r['Category']).includes(seasonal.name))
            .map(r => r['Wix Product ID']).filter(Boolean)
        )];
        console.log(`[PUSH] Seasonal "${seasonal.name}": ${seasonalProductIds.length} products`);
        try {
          if (seasonalProductIds.length > 0) {
            await setWixCategoryProducts(seasonalWixId, seasonalProductIds);
          }
          // Push EN translation as primary (Wix site is English)
          const enTitle = seasonal.translations?.en?.title;
          const enDesc = seasonal.translations?.en?.description;
          console.log(`[PUSH] Seasonal title=${enTitle}, desc=${enDesc?.slice(0, 50)}...`);
          if (enTitle || enDesc) {
            await updateWixCategory(seasonalWixId, {
              name: enTitle || seasonal.name,
              description: enDesc || '',
            });
          }
          stats.categoriesSynced++;
        } catch (err) {
          stats.errors.push(`Seasonal: ${err.message}`);
        }
      }

      // Available Today — populate with qualifying products (lead time 0 + stock).
      // Owner manually controls when to deactivate — no automatic cutoff.
      const availTodayId = catMap['available-today'];
      console.log(`[PUSH] Available Today: wixCatId=${availTodayId}`);
      if (availTodayId) {
        const stockCheck = await db.list(TABLES.STOCK, {
          filterByFormula: '{Active} = TRUE()',
          fields: ['Display Name', 'Current Quantity'],
        });
        const stockLookup = Object.fromEntries(
          stockCheck.map(s => [s['Display Name'], Number(s['Current Quantity'] || 0)])
        );
        const stockByRecId = Object.fromEntries(
          stockCheck.map(s => [s.id, Number(s['Current Quantity'] || 0)])
        );
        // Must have "Available Today" in Category field + lead time 0 + stock
        const availCandidates = allConfigRows.filter(r => {
          const cats = parseCategoryField(r['Category']);
          return cats.includes('Available Today') && Number(r['Lead Time Days'] ?? 1) === 0;
        });
        console.log(`[PUSH] Available Today candidates (category + lt=0): ${availCandidates.length}`);
        const availProductIds = [...new Set(
          availCandidates.filter(r => {
            const kf = r['Key Flower'];
            if (!kf || (Array.isArray(kf) && kf.length === 0)) return true;
            let qty = 0;
            if (Array.isArray(kf) && kf.length > 0) qty = stockByRecId[kf[0]] || 0;
            else if (typeof kf === 'string') qty = stockLookup[kf] || 0;
            const minStems = Number(r['Min Stems'] || 0);
            return minStems > 0 ? qty >= minStems : qty > 0;
          }).map(r => r['Wix Product ID']).filter(Boolean)
        )];
        console.log(`[PUSH] Available Today products (after stock check): ${availProductIds.length}`);
        try {
          await setWixCategoryProducts(availTodayId, availProductIds);
          stats.categoriesSynced++;
        } catch (err) {
          stats.errors.push(`Available Today: ${err.message}`);
        }
      }
    } catch (err) {
      stats.errors.push(`Category phase: ${err.message}`);
    }

    // ── Product Descriptions ────────────────────────────
    // Push EN name + description from Translations field to Wix.
    // Like updating product labels on the showroom shelf.
    try {
      const descRows = await db.list(TABLES.PRODUCT_CONFIG, {
        filterByFormula: '{Active} = TRUE()',
        fields: ['Wix Product ID', 'Description', 'Translations'],
      });

      // Group by product — one description per Wix product
      const descByProduct = new Map();
      for (const row of descRows) {
        const pid = row['Wix Product ID'];
        if (!pid || descByProduct.has(pid)) continue;
        const rawTrans = row['Translations'];
        let translations = {};
        if (rawTrans && typeof rawTrans === 'string') {
          try { translations = JSON.parse(rawTrans); } catch { /* skip */ }
        } else if (rawTrans && typeof rawTrans === 'object') {
          translations = rawTrans;
        }
        const enTitle = translations?.en?.title;
        const enDesc = translations?.en?.description || row['Description'] || '';
        if (enTitle || enDesc) {
          descByProduct.set(pid, { name: enTitle, description: textToHtml(enDesc) });
        }
      }

      let descSynced = 0;
      for (const [productId, content] of descByProduct) {
        try {
          await updateWixProductContent(productId, content);
          descSynced++;
        } catch (err) {
          stats.errors.push(`Description ${productId}: ${err.message}`);
        }
      }
      if (descSynced > 0) console.log(`[PUSH] Descriptions synced: ${descSynced}`);
    } catch (err) {
      stats.errors.push(`Description phase: ${err.message}`);
    }

    console.log('[PUSH] Complete:', JSON.stringify(stats));
  } catch (err) {
    stats.errors.push(`Fatal: ${err.message}`);
    console.error('[PUSH] Fatal error:', err);
  }

  await logSync('push', stats);
  return stats;
}

/** Legacy: run full bidirectional sync (pull then push). */
export async function runSync() {
  const pullStats = await runPull();
  const pushStats = await runPush();
  return {
    ...pullStats,
    ...pushStats,
    errors: [...pullStats.errors, ...pushStats.errors],
  };
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

/** Parse Airtable multi-select Category field (array or comma-string) */
function parseCategoryField(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

/** Strip HTML tags → plain text. Converts <p>, <br> to newlines. */
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Plain text → HTML paragraphs for Wix. */
function textToHtml(text) {
  if (!text) return '';
  return text.split(/\n\n+/).map(p =>
    '<p>' + p.replace(/\n/g, '<br>') + '</p>'
  ).join('');
}
