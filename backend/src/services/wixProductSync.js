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

// Thrown when a Wix Stores endpoint returns 404 PRODUCT_NOT_FOUND.
// The push loop dedupes these by product ID so the owner sees one
// actionable warning instead of N identical errors per variant.
class WixProductNotFoundError extends Error {
  constructor(productId) {
    super(`Wix product ${productId} not found`);
    this.name = 'WixProductNotFoundError';
    this.productId = productId;
  }
}

function isProductNotFound(status, text) {
  return status === 404 && text.includes('PRODUCT_NOT_FOUND');
}

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
    if (isProductNotFound(res.status, text)) throw new WixProductNotFoundError(productId);
    throw new Error(`Wix price update failed for ${productId}/${variantId}: ${text}`);
  }
}

/**
 * Update a variant's availability on Wix.
 *
 * Two modes:
 *   - tracked (`{ quantity: N }`): pushes `trackQuantity=true` and the real count.
 *     Wix enforces the cap in cart/checkout and decrements on each sale.
 *   - untracked (`{ active: true|false }`): pushes `trackQuantity=false`,
 *     toggling inStock without a real count — the legacy "available / sold out"
 *     switch for variants that don't yet have a Quantity value.
 *
 * Callers pick the mode per row: use `quantity` when the Airtable row has
 * a numeric `Quantity`, otherwise fall back to `active`.
 */
async function updateWixInventory(productId, variantId, opts) {
  const tracked = opts && typeof opts.quantity === 'number' && opts.quantity >= 0;
  const body = tracked
    ? {
      inventoryItem: {
        trackQuantity: true,
        variants: [{ variantId, quantity: opts.quantity }],
      },
    }
    : {
      inventoryItem: {
        trackQuantity: false,
        variants: [{ variantId, inStock: opts && opts.active === true }],
      },
    };

  const res = await fetch(
    `${WIX_API_URL}/stores/v2/inventoryItems/product/${productId}`,
    { method: 'PATCH', headers: wixHeaders(), body: JSON.stringify(body) }
  );

  if (!res.ok) {
    const text = await res.text();
    if (isProductNotFound(res.status, text)) throw new WixProductNotFoundError(productId);
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
    if (isProductNotFound(res.status, text)) throw new WixProductNotFoundError(productId);
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

// Schema identifying Wix Stores Collections in the Wix Multilingual Translation
// Content API. Discovered by querying an existing collection's translation
// content. Field keys: "collection-name" and "category-description".
const STORES_COLLECTION_SCHEMA_ID = '5b35dfe1-da21-4071-aab5-2cec870459c0';
const SECONDARY_LOCALES = ['pl', 'ru', 'uk'];

/**
 * Push PL/RU/UK translations to Wix Multilingual for a Stores collection.
 * Wix hides untranslated store collections from non-primary language menus,
 * so without this the category's menu link never renders on the PL/RU/UK
 * sites. EN is the primary locale and lives directly on the Stores
 * collection — updated via updateWixCategory().
 *
 * Flow: query → create missing locales, update existing locales.
 * Skips any locale whose Airtable config has blank title + description,
 * so we don't overwrite translations the owner added via Wix Translation
 * Manager.
 */
async function pushCollectionTranslations(entityId, translations) {
  if (!entityId || !translations) return;

  const targetFields = {};
  for (const locale of SECONDARY_LOCALES) {
    const t = translations[locale];
    if (!t) continue;
    const fields = {};
    if (t.title) fields['collection-name'] = { textValue: t.title, published: true, updatedBy: 'USER' };
    if (t.description) fields['category-description'] = { textValue: t.description, published: true, updatedBy: 'USER' };
    if (Object.keys(fields).length > 0) targetFields[locale] = fields;
  }
  if (Object.keys(targetFields).length === 0) return;

  const qRes = await fetch(`${WIX_API_URL}/translation-content/v1/contents/query`, {
    method: 'POST',
    headers: wixHeaders(),
    body: JSON.stringify({ query: { filter: { entityId }, cursorPaging: { limit: 50 } } }),
  });
  if (!qRes.ok) {
    throw new Error(`Translation query failed for ${entityId}: ${await qRes.text()}`);
  }
  const existingByLocale = ((await qRes.json()).contents || []).reduce((m, c) => {
    m[c.locale] = c.id;
    return m;
  }, {});

  const toCreate = [];
  const toUpdate = [];
  for (const [locale, fields] of Object.entries(targetFields)) {
    if (existingByLocale[locale]) {
      toUpdate.push({ content: { id: existingByLocale[locale], schemaId: STORES_COLLECTION_SCHEMA_ID, fields } });
    } else {
      toCreate.push({ schemaId: STORES_COLLECTION_SCHEMA_ID, entityId, locale, fields });
    }
  }

  if (toCreate.length > 0) {
    const cRes = await fetch(`${WIX_API_URL}/translation-content/v1/bulk/contents/create`, {
      method: 'POST',
      headers: wixHeaders(),
      body: JSON.stringify({ contents: toCreate, returnEntity: false }),
    });
    if (!cRes.ok) {
      throw new Error(`Translation bulk create failed for ${entityId}: ${await cRes.text()}`);
    }
  }

  if (toUpdate.length > 0) {
    const uRes = await fetch(`${WIX_API_URL}/translation-content/v1/bulk/contents/update`, {
      method: 'POST',
      headers: wixHeaders(),
      body: JSON.stringify({ contents: toUpdate, returnEntity: false }),
    });
    if (!uRes.ok) {
      throw new Error(`Translation bulk update failed for ${entityId}: ${await uRes.text()}`);
    }
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

  // Step 2: Remove products that shouldn't be in this collection.
  // Uses POST /productIds/delete (batch removal) — NOT per-product DELETE.
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
      if (toRemove.length > 0) {
        for (let i = 0; i < toRemove.length; i += 100) {
          const batch = toRemove.slice(i, i + 100);
          const removeRes = await fetch(
            `${WIX_API_URL}/stores/v1/collections/${collectionId}/productIds/delete`,
            {
              method: 'POST',
              headers: wixHeaders(),
              body: JSON.stringify({ productIds: batch }),
            }
          );
          if (!removeRes.ok) {
            const text = await removeRes.text();
            console.error(`[SYNC] Remove from collection ${collectionId} failed: ${text}`);
          }
        }
        console.log(`[SYNC] Removed ${toRemove.length} stale products from collection ${collectionId}`);
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
      'Status': stats.errors.length > 0
        ? (stats.pricesSynced || stats.stockSynced || stats.new || stats.updated
          ? `partial (${direction})` : `failed (${direction})`)
        : `success (${direction})`,
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
          // Active is Airtable-owned — never overwrite from Wix pull.
          // Only sync Visible in Wix (what Wix reports) for informational purposes.
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
    // Per variant:
    //   Active=false               → out of stock on Wix (untracked).
    //   Active=true + no Quantity  → in stock (untracked, unlimited).
    //   Active=true + Quantity=N   → tracked inventory with cap N; Wix
    //                                enforces the cap in cart/checkout
    //                                and decrements on each sale.
    // The Airtable Quantity column is optional during rollout — rows
    // without it keep the old untracked "available / sold out" behavior.
    const allVariantRows = await db.list(TABLES.PRODUCT_CONFIG, {
      fields: ['Wix Product ID', 'Wix Variant ID', 'Active', 'Quantity'],
    });

    // Track stale Wix product IDs across this phase — one aggregated
    // warning at the end beats N identical 404 errors per variant.
    const staleInventoryIds = new Map(); // productId -> variant row count

    for (const row of allVariantRows) {
      const pid = row['Wix Product ID'];
      const vid = row['Wix Variant ID'];
      const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
      if (!pid || !vid || vid === ZERO_UUID) continue;
      const active = row['Active'] === true;
      const rawQty = row['Quantity'];
      const qty = typeof rawQty === 'number' ? rawQty : Number(rawQty);
      const hasQuantity = Number.isFinite(qty) && qty >= 0;

      // Active + Quantity → tracked; Active without Quantity → untracked in-stock;
      // Inactive → untracked out-of-stock (regardless of Quantity).
      const opts = active
        ? (hasQuantity ? { quantity: qty } : { active: true })
        : { active: false };

      try {
        await updateWixInventory(pid, vid, opts);
        stats.stockSynced++;
      } catch (err) {
        if (err instanceof WixProductNotFoundError) {
          staleInventoryIds.set(pid, (staleInventoryIds.get(pid) || 0) + 1);
          continue;
        }
        stats.errors.push(`Availability ${pid}/${vid}: ${err.message}`);
      }
    }

    if (staleInventoryIds.size > 0) {
      const detail = [...staleInventoryIds].map(([pid, n]) => `${pid} (${n} variant${n === 1 ? '' : 's'})`).join(', ');
      stats.errors.push(
        `${staleInventoryIds.size} Wix product${staleInventoryIds.size === 1 ? '' : 's'} referenced by PRODUCT_CONFIG no longer exist in Wix: ${detail}. ` +
        `Clear the Wix Product ID on those Airtable rows (or delete the rows) to stop this warning.`
      );
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
          await setWixCategoryProducts(seasonalWixId, seasonalProductIds);
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
          try {
            await pushCollectionTranslations(seasonalWixId, seasonal.translations);
          } catch (err) {
            stats.errors.push(`Seasonal translations: ${err.message}`);
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
        // Keep the Wix collection's own name/description in sync with the
        // owner-configured EN translation. Mirrors the seasonal path above —
        // without this, the Wix-native collection label stays whatever the
        // owner typed when creating the collection, which meant Wix only
        // rendered the nav item in the primary (English) language.
        const availEntry = (sc.auto || []).find(a => a && a.slug === 'available-today');
        try {
          const enTitle = availEntry?.translations?.en?.title;
          const enDesc = availEntry?.translations?.en?.description;
          if (enTitle || enDesc) {
            await updateWixCategory(availTodayId, {
              name: enTitle || availEntry?.name || 'Available Today',
              description: enDesc || '',
            });
          }
        } catch (err) {
          stats.errors.push(`Available Today category name: ${err.message}`);
        }
        try {
          await pushCollectionTranslations(availTodayId, availEntry?.translations);
        } catch (err) {
          stats.errors.push(`Available Today translations: ${err.message}`);
        }

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
      const staleDescIds = new Set();
      for (const [productId, content] of descByProduct) {
        try {
          await updateWixProductContent(productId, content);
          descSynced++;
        } catch (err) {
          if (err instanceof WixProductNotFoundError) {
            staleDescIds.add(productId);
            continue;
          }
          stats.errors.push(`Description ${productId}: ${err.message}`);
        }
      }
      if (descSynced > 0) console.log(`[PUSH] Descriptions synced: ${descSynced}`);
      if (staleDescIds.size > 0) {
        console.warn(`[PUSH] Skipped description update for ${staleDescIds.size} deleted Wix product(s) — see inventory warning for IDs`);
      }
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
