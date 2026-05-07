// Wix ↔ Airtable bidirectional sync job.
// Think of this as a supply chain synchronization process:
// 1. Pull: check the supplier's catalog (Wix) for new/changed products
// 2. Push: send our warehouse data (prices, stock) back to the supplier's system
//
// Wix owns: product names, images, variant names
// Airtable owns: prices, lead times, stock, categories, active status

import PQueue from 'p-queue';
import * as stockRepo from '../repos/stockRepo.js';
import * as syncLogRepo from '../repos/syncLogRepo.js';
import * as productConfigRepo from '../repos/productConfigRepo.js';
import { sendAlert, notifyWixSyncError } from './telegram.js';
import { getActiveSeasonalCategory, getConfig, updateConfig } from '../routes/settings.js';

// Concurrency for parallel Wix API calls inside runPush. Wix Stores REST
// API tolerates ~600 req/min for paid sites; 8 in flight keeps us well
// under that while cutting total push time from ~80s to ~10–20s. The old
// fully-sequential version was pushing the request past Vercel's edge
// proxy timeout (~30s) and the UI was reporting failure on a successful
// backend run — see backend/src/services/wixPushJob.js for the async
// job wrapper that decoupled UI from request duration.
const PUSH_CONCURRENCY = 8;

// No-op default so internal callers (e.g. legacy runSync) don't need to
// pass anything. The job wrapper supplies a real handler that records
// owner-facing log entries for the progress modal.
const NO_PROGRESS = () => {};

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
 * Update a simple (no-variants) Wix product's price at the product level.
 *
 * Wix represents products in two shapes:
 *   1. Products WITH managed variants (e.g. Small / Medium / Large) — each
 *      variant has a real UUID and its own `priceData`. Use the batch
 *      variants endpoint via `updateWixVariantPrice` above.
 *   2. Products WITHOUT managed variants (simple single-SKU products) —
 *      Wix exposes a synthetic "default variant" with ID
 *      00000000-0000-0000-0000-000000000000 on READ, but the price lives
 *      on the product itself. Attempting `PATCH /products/{id}/variants`
 *      with that zero-UUID returns "requirement failed: Product variants
 *      must be managed".
 *
 * This helper is the product-level endpoint for shape #2 — same URL
 * pattern as `updateWixProductContent`, just with a `priceData` payload
 * instead of name/description.
 */
async function updateWixProductPrice(productId, price) {
  const res = await fetch(
    `${WIX_API_URL}/stores/v1/products/${productId}`,
    {
      method: 'PATCH',
      headers: wixHeaders(),
      body: JSON.stringify({
        product: {
          priceData: { price },
        },
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    if (isProductNotFound(res.status, text)) throw new WixProductNotFoundError(productId);
    throw new Error(`Wix product price update failed for ${productId}: ${text}`);
  }
}

/**
 * Update ALL variants of a Wix product in a single PATCH.
 *
 * Why batched: Wix's `trackQuantity` flag is stored at the product level,
 * not per variant. Iterating variants and PATCHing one at a time flips
 * the product's trackQuantity on every call — the last PATCH wins and
 * earlier tracked quantities get silently discarded. Pushing all variants
 * together in one call with a single, consistent `trackQuantity` avoids
 * the flip-flop.
 *
 * Product-level tracking rule: if ANY variant of this product has a
 * numeric Airtable Quantity, the whole product goes into tracked mode.
 *   - tracked + active + numeric Quantity → push that quantity as cap
 *   - tracked + active + no Quantity      → push 9999 (effectively unlimited)
 *   - tracked + inactive                  → push quantity 0 (sold out)
 *   - untracked + active                  → push inStock: true (legacy)
 *   - untracked + inactive                → push inStock: false (legacy)
 *
 * @param productId Wix product ID
 * @param variantStates Array of { variantId, active, quantity? } — one per variant
 */
async function updateWixInventory(productId, variantStates) {
  const anyTracked = variantStates.some(v =>
    v.active === true && typeof v.quantity === 'number' && v.quantity >= 0
  );

  const variants = variantStates.map(v => {
    if (anyTracked) {
      if (v.active !== true) return { variantId: v.variantId, quantity: 0 };
      const q = typeof v.quantity === 'number' && v.quantity >= 0 ? v.quantity : 9999;
      return { variantId: v.variantId, quantity: q };
    }
    return { variantId: v.variantId, inStock: v.active === true };
  });

  const body = {
    inventoryItem: {
      trackQuantity: anyTracked,
      variants,
    },
  };

  // Retry up to 2 times on 5xx responses (Wix infrastructure proxy errors
  // like "upstream connect error or disconnect/reset before headers" are
  // transient — one failure per product is enough to miss an inventory
  // update, but they tend to resolve on the next attempt within seconds).
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(
      `${WIX_API_URL}/stores/v2/inventoryItems/product/${productId}`,
      { method: 'PATCH', headers: wixHeaders(), body: JSON.stringify(body) }
    );
    if (res.ok) return;
    const text = await res.text();
    if (isProductNotFound(res.status, text)) throw new WixProductNotFoundError(productId);
    if (res.status >= 500 && attempt < MAX_ATTEMPTS) {
      await new Promise(r => setTimeout(r, 1000 * attempt));
      continue;
    }
    throw new Error(`Wix inventory update failed for ${productId}: ${text}`);
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

// Schema identifying Wix Stores Products in the Wix Multilingual Translation
// Content API. Discovered by querying an existing product's translation
// content. Field keys: "product-name" and "product-description".
const STORES_PRODUCT_SCHEMA_ID = 'b8f0a427-14d8-47b5-870e-21645dd3a507';

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
 * Push PL/RU/UK translations to Wix Multilingual for a Stores product.
 * The product's EN name + description live directly on the Stores product
 * (see updateWixProductContent). Without PL/RU/UK records in the
 * Multilingual Translation Content API, non-primary-language sites fall
 * back to the EN text — which is why the PL storefront was showing
 * English product descriptions even though translations existed in the
 * Florist dashboard.
 *
 * Mirrors pushCollectionTranslations: query existing content, split into
 * create-or-update, skip locales whose translation is blank so we don't
 * clobber anything the owner edited directly in the Wix Translation
 * Manager.
 */
async function pushProductTranslations(entityId, translations) {
  if (!entityId || !translations) return;

  const targetFields = {};
  for (const locale of SECONDARY_LOCALES) {
    const t = translations[locale];
    if (!t) continue;
    const fields = {};
    if (t.title) fields['product-name'] = { textValue: t.title, published: true, updatedBy: 'USER' };
    if (t.description) fields['product-description'] = { textValue: textToHtml(t.description), published: true, updatedBy: 'USER' };
    if (Object.keys(fields).length > 0) targetFields[locale] = fields;
  }
  if (Object.keys(targetFields).length === 0) return;

  const qRes = await fetch(`${WIX_API_URL}/translation-content/v1/contents/query`, {
    method: 'POST',
    headers: wixHeaders(),
    body: JSON.stringify({ query: { filter: { entityId }, cursorPaging: { limit: 50 } } }),
  });
  if (!qRes.ok) {
    throw new Error(`Product translation query failed for ${entityId}: ${await qRes.text()}`);
  }
  const existingByLocale = ((await qRes.json()).contents || []).reduce((m, c) => {
    m[c.locale] = c.id;
    return m;
  }, {});

  const toCreate = [];
  const toUpdate = [];
  for (const [locale, fields] of Object.entries(targetFields)) {
    if (existingByLocale[locale]) {
      toUpdate.push({ content: { id: existingByLocale[locale], schemaId: STORES_PRODUCT_SCHEMA_ID, fields } });
    } else {
      toCreate.push({ schemaId: STORES_PRODUCT_SCHEMA_ID, entityId, locale, fields });
    }
  }

  if (toCreate.length > 0) {
    const cRes = await fetch(`${WIX_API_URL}/translation-content/v1/bulk/contents/create`, {
      method: 'POST',
      headers: wixHeaders(),
      body: JSON.stringify({ contents: toCreate, returnEntity: false }),
    });
    if (!cRes.ok) {
      throw new Error(`Product translation bulk create failed for ${entityId}: ${await cRes.text()}`);
    }
  }

  if (toUpdate.length > 0) {
    const uRes = await fetch(`${WIX_API_URL}/translation-content/v1/bulk/contents/update`, {
      method: 'POST',
      headers: wixHeaders(),
      body: JSON.stringify({ contents: toUpdate, returnEntity: false }),
    });
    if (!uRes.ok) {
      throw new Error(`Product translation bulk update failed for ${entityId}: ${await uRes.text()}`);
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
  // Set of Airtable category names that successfully mapped to a Wix
  // collection this pull. Used by runPull to decide which categories on an
  // existing row are Wix-tracked (safe to remove if Wix says so) vs
  // Airtable-only (preserved — could be user-private labels or collections
  // we don't currently track in config).
  const mappedNames = new Set();
  let wixCategories = [];
  try {
    wixCategories = await fetchWixCategories();
    const sc = getConfig('storefrontCategories') || {};
    // Include auto categories (e.g. "Available Today") so Pull can
    // reconcile their membership back from Wix. Previously only permanent
    // and seasonal were mapped, which meant a product removed from Wix's
    // Available Today collection kept its stale Airtable flag forever.
    const ourNames = [
      ...(sc.permanent || []).map(p => typeof p === 'string' ? p : p.name),
      ...(sc.seasonal || []).map(s => s.name),
      ...(sc.auto || []).map(a => a.name),
    ];
    for (const wc of wixCategories) {
      const match = ourNames.find(n =>
        n.toLowerCase().replace(/[^a-z0-9]+/g, '-') === wc.slug
        || n.toLowerCase() === wc.name.toLowerCase()
      );
      if (match) {
        wixCategoryIdToName[wc.id] = match;
        mappedNames.add(match);
      }
    }
  } catch (err) {
    console.warn('[SYNC] Could not fetch Wix categories:', err.message);
  }

  return { wixProducts, wixCategories, wixCategoryIdToName, mappedNames };
}

/** Write a sync log entry to Postgres + alert on failure. */
async function logSync(direction, stats) {
  const errorMessage = stats.errors.join('\n') || '';
  const hasErrors = stats.errors.length > 0;
  const hasSuccess = stats.pricesSynced || stats.stockSynced || stats.new || stats.updated;
  const status = hasErrors
    ? (hasSuccess ? `partial (${direction})` : `failed (${direction})`)
    : `success (${direction})`;

  try {
    await syncLogRepo.logSync({
      status,
      newProducts:  stats.new || 0,
      updated:      stats.updated || 0,
      deactivated:  stats.deactivated || 0,
      priceSyncs:   stats.pricesSynced || 0,
      stockSyncs:   stats.stockSynced || 0,
      errorMessage,
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
    const { wixProducts, wixCategories, wixCategoryIdToName, mappedNames } = await fetchWixData();
    console.log(`[PULL] Found ${wixProducts.length} products in Wix`);

    // Load existing Product Config rows
    const existingRows = await productConfigRepo.list();

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
            await productConfigRepo.upsert(newRow);
            stats.new++;
          } catch (err) {
            stats.errors.push(`Create ${productName}/${variantName}: ${err.message}`);
          }
        } else {
          const updates = {};
          if (existing['Product Name'] !== productName) updates['Product Name'] = productName;
          if (existing['Image URL'] !== imageUrl) updates['Image URL'] = imageUrl;
          // Price: Pull mirrors Wix → Airtable. Owner edits prices in
          // Wix admin OR in the dashboard/florist app — never directly
          // in Airtable. So Pull is allowed to overwrite Airtable price
          // with the latest Wix price. The 2026-04-22 lockout (commit
          // a44450f) only mattered for the legacy `runSync` (pull-then-
          // push) flow, which the UI no longer uses — Pull and Push are
          // separate buttons and the owner picks the direction.
          const wixPriceNum = Number(variantPrice) || 0;
          const airtablePriceNum = Number(existing['Price'] || 0);
          if (Math.abs(airtablePriceNum - wixPriceNum) > 0.01) {
            updates['Price'] = wixPriceNum;
          }
          // Active follows Wix "Show in online store". The earlier policy
          // treated Active as Airtable-owned, but in practice that caused
          // drift: a product re-listed on Wix stayed inactive in Airtable
          // forever (seen with "Mix of the day 1 - L/S": live on the
          // storefront, shown as 0/1 active in the florist app). Wix is
          // authoritative for whether a product is being sold; local
          // deactivation should happen via Push (Airtable→Wix), not by
          // editing Airtable directly and hoping Pull won't overwrite.
          if (existing['Active'] !== wixVisible) updates['Active'] = wixVisible;
          if (existing['Visible in Wix'] !== wixVisible) updates['Visible in Wix'] = wixVisible;
          // Category reconciliation: Wix is authoritative for any category
          // that maps to a tracked Wix collection (mappedNames). Airtable-
          // only categories are preserved — they could be user-private
          // labels, or mapped entries we failed to match this pull because
          // the Wix category fetch partially failed. Previous policy was
          // "fill only when empty", which let stale Wix-driven flags like
          // "Available Today" linger in Airtable forever after a product
          // was removed from the collection on Wix.
          const existingCats = parseCategoryField(existing['Category']);
          const preservedCats = existingCats.filter(c => !mappedNames.has(c));
          const reconciledCats = [...new Set([...preservedCats, ...importedCategories])];
          const existingSorted = [...existingCats].sort().join('|');
          const reconciledSorted = [...reconciledCats].sort().join('|');
          if (existingSorted !== reconciledSorted) {
            updates['Category'] = reconciledCats;
          }
          // Description: Pull mirrors Wix → Airtable. Owner edits in Wix
          // or in the dashboard, never in Airtable directly, so always
          // reconcile when the values differ. The previous "fill only when
          // empty" policy left stale Airtable descriptions in place after
          // Wix-side edits.
          if (productDescription && existing['Description'] !== productDescription) {
            updates['Description'] = productDescription;
          }
          if (Object.keys(updates).length > 0) {
            try {
              await productConfigRepo.upsert({ ...updates, wixProductId: productId, wixVariantId: variantId });
              stats.updated++;
            } catch (err) {
              stats.errors.push(`Update ${productName}/${variantName}: ${err.message}`);
            }
          }
        }
      }
    }

    // Reconcile rows whose Wix product/variant no longer exists.
    //
    // Two cases, two behaviors:
    //
    //  1. The Wix PRODUCT is still alive but this specific variant ID is
    //     gone. That happens when the owner removes a variant option in
    //     the Wix Editor (e.g., drops the "Bouquet: 1/2/3/4/5" option and
    //     goes back to a single default variant). The old Airtable row is
    //     orphaned — its Product Name becomes misleading as the product
    //     gets renamed, and it clutters the dashboard as a ghost group.
    //     → Delete the row.
    //
    //  2. The whole Wix PRODUCT is gone (deleted from the store). We don't
    //     delete the Airtable row because the owner may want to review
    //     history before removing it, and downstream references (order
    //     lines, sync log) might still point to it.
    //     → Deactivate only (legacy behavior).
    const wixProductIds = new Set(wixProducts.map(p => p.id));

    for (const row of existingRows) {
      const key = `${row['Wix Product ID']}::${row['Wix Variant ID']}`;
      if (seenKeys.has(key)) continue;

      const productStillAlive = wixProductIds.has(row['Wix Product ID']);

      if (productStillAlive) {
        try {
          await productConfigRepo.softDelete(row.id);
          stats.deleted = (stats.deleted || 0) + 1;
        } catch (err) {
          stats.errors.push(`Delete orphaned variant ${row['Product Name']}/${row['Variant Name']}: ${err.message}`);
        }
      } else if (row['Active']) {
        try {
          await productConfigRepo.deactivate(row.id);
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
  // Ping the owner on Telegram if the sync collected any errors — the
  // frontend toast is only seen when she's looking at the app; a sync
  // run can also be triggered by automation without anyone watching.
  if (stats.errors.length > 0) {
    await notifyWixSyncError({ direction: 'pull', errors: stats.errors });
  }
  return stats;
}

/**
 * Push from Airtable → Wix.
 *
 * Phases (each runs sequentially relative to the next, but Wix API calls
 * inside a phase fan out with PUSH_CONCURRENCY workers):
 *   1. Prices              — variant or product-level price PATCH per row
 *   2. Inventory           — one batched PATCH per product
 *   3. Categories          — permanent / seasonal / Available Today
 *   4. Descriptions + i18n — EN content + PL/RU/UK translation content
 *
 * @param onProgress  Optional callback receiving owner-friendly log entries
 *                    `{ kind, message, level? }`. The /products/push job
 *                    wrapper records these for the in-app progress modal;
 *                    direct callers (e.g. the legacy `runSync`) can omit it.
 */
export async function runPush(onProgress = NO_PROGRESS) {
  const stats = { pricesSynced: 0, stockSynced: 0, categoriesSynced: 0, descriptionsSynced: 0, translationsSynced: 0, errors: [] };
  const log = (kind, message, level = 'info') => {
    try { onProgress({ kind, message, level }); } catch { /* never fail push because of a progress hook */ }
  };

  try {
    log('phase', 'Получаем данные из Wix...');
    const { wixProducts, wixCategories } = await fetchWixData();
    const wixProductNameById = new Map();
    for (const p of wixProducts) wixProductNameById.set(p.id, p.name || p.id);
    log('phase', `Загружено товаров из Wix: ${wixProducts.length}`);

    // ── Prices ──────────────────────────────────────────
    log('phase', 'Сравниваем цены...');
    const configRows = await productConfigRepo.list({ activeOnly: true });

    const wixPriceMap = new Map();
    for (const product of wixProducts) {
      for (const variant of (product.variants || [])) {
        const price = variant.variant?.priceData?.price || 0;
        wixPriceMap.set(`${product.id}::${variant.id}`, Number(price));
      }
    }

    // Zero-UUID = Wix's default-variant placeholder for products without
    // managed variants. Those need the product-level price endpoint, not
    // the variant batch endpoint (see `updateWixProductPrice` above).
    const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

    const priceJobs = [];
    for (const row of configRows) {
      const pid = row['Wix Product ID'];
      const vid = row['Wix Variant ID'];
      if (!pid || !vid) continue;
      const key = `${pid}::${vid}`;
      const airtablePrice = Number(row['Price'] || 0);
      const wixPrice = wixPriceMap.get(key);
      if (wixPrice === undefined || Math.abs(airtablePrice - wixPrice) <= 0.01) continue;
      priceJobs.push({ pid, vid, key, airtablePrice, wixPrice, variantName: row['Variant Name'] });
    }
    log('summary', `Цены к обновлению: ${priceJobs.length}`);

    if (priceJobs.length > 0) {
      const queue = new PQueue({ concurrency: PUSH_CONCURRENCY });
      await Promise.all(priceJobs.map(job => queue.add(async () => {
        const productName = wixProductNameById.get(job.pid) || job.pid;
        const variantSuffix = job.variantName && job.vid !== ZERO_UUID ? ` / ${job.variantName}` : '';
        try {
          if (job.vid === ZERO_UUID) {
            await updateWixProductPrice(job.pid, job.airtablePrice);
          } else {
            await updateWixVariantPrice(job.pid, job.vid, job.airtablePrice);
          }
          stats.pricesSynced++;
          log('item', `Цена · ${productName}${variantSuffix}: ${job.wixPrice}zł → ${job.airtablePrice}zł`);
        } catch (err) {
          stats.errors.push(`Price ${job.key}: ${err.message}`);
          log('item', `Ошибка цены · ${productName}${variantSuffix}: ${err.message}`, 'error');
        }
      })));
    }

    // ── Availability (inventory-based) ─────────────────
    // Per product (batched across all its variants — see updateWixInventory
    // for why batching matters):
    //   Any variant has a numeric Quantity → whole product tracked.
    //     active + Quantity=N → cap N; active + no Quantity → cap 9999;
    //     inactive → cap 0.
    //   No variant has Quantity → whole product untracked, legacy inStock
    //     toggle per variant driven by Active.
    log('phase', 'Обновляем остатки...');
    const allVariantRows = await productConfigRepo.list();

    const byProduct = new Map();
    for (const row of allVariantRows) {
      const pid = row['Wix Product ID'];
      const vid = row['Wix Variant ID'];
      if (!pid || !vid) continue;
      if (!byProduct.has(pid)) byProduct.set(pid, []);
      const rawQty = row['Quantity'];
      // null means "untracked" from PG — treat same as undefined/NaN, not 0.
      const qty = rawQty == null ? NaN : (typeof rawQty === 'number' ? rawQty : Number(rawQty));
      byProduct.get(pid).push({
        variantId: vid,
        active: row['Active'] === true,
        quantity: Number.isFinite(qty) && qty >= 0 ? qty : undefined,
      });
    }

    const staleInventoryIds = new Set();
    {
      const queue = new PQueue({ concurrency: PUSH_CONCURRENCY });
      await Promise.all([...byProduct.entries()].map(([pid, variantStates]) => queue.add(async () => {
        try {
          await updateWixInventory(pid, variantStates);
          stats.stockSynced += variantStates.length;
        } catch (err) {
          if (err instanceof WixProductNotFoundError) {
            staleInventoryIds.add(pid);
            return;
          }
          stats.errors.push(`Availability ${pid}: ${err.message}`);
          const productName = wixProductNameById.get(pid) || pid;
          log('item', `Ошибка остатков · ${productName}: ${err.message}`, 'error');
        }
      })));
    }
    log('summary', `Остатки: обновлено ${stats.stockSynced} вариант(ов) по ${byProduct.size} товарам`);

    if (staleInventoryIds.size > 0) {
      const ids = [...staleInventoryIds].join(', ');
      stats.errors.push(
        `${staleInventoryIds.size} Wix product${staleInventoryIds.size === 1 ? '' : 's'} referenced by PRODUCT_CONFIG no longer exist in Wix: ${ids}. ` +
        `Clear the Wix Product ID on those Airtable rows (or delete the rows) to stop this warning.`
      );
      log('item', `Внимание: ${staleInventoryIds.size} товар(ов) удалены в Wix — очистите их из конфигурации.`, 'warn');
    }

    // ── Categories ──────────────────────────────────────
    log('phase', 'Обновляем категории...');
    try {
      const catMap = {};
      for (const c of wixCategories) catMap[c.slug] = c.id;

      const allConfigRows = await productConfigRepo.list({ activeOnly: true });

      const sc = getConfig('storefrontCategories') || {};
      const catTasks = [];

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
        catTasks.push(async () => {
          try {
            await setWixCategoryProducts(wixCatId, productIds);
            stats.categoriesSynced++;
            log('item', `Категория «${catName}»: ${productIds.length} товаров`);
          } catch (err) {
            stats.errors.push(`Category ${catName}: ${err.message}`);
            log('item', `Ошибка категории «${catName}»: ${err.message}`, 'error');
          }
        });
      }

      // Seasonal category
      const seasonal = getActiveSeasonalCategory();
      const seasonalWixId = catMap['seasonal'];
      if (seasonal && seasonalWixId) {
        const seasonalProductIds = [...new Set(
          allConfigRows.filter(r => parseCategoryField(r['Category']).includes(seasonal.name))
            .map(r => r['Wix Product ID']).filter(Boolean)
        )];
        catTasks.push(async () => {
          try {
            await setWixCategoryProducts(seasonalWixId, seasonalProductIds);
            const enTitle = seasonal.translations?.en?.title;
            const enDesc = seasonal.translations?.en?.description;
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
            log('item', `Сезонные («${seasonal.name}»): ${seasonalProductIds.length} товаров`);
          } catch (err) {
            stats.errors.push(`Seasonal: ${err.message}`);
            log('item', `Ошибка сезонной категории: ${err.message}`, 'error');
          }
        });
      }

      // Available Today — populate with qualifying products (lead time 0 + stock).
      const availTodayId = catMap['available-today'];
      if (availTodayId) {
        const availEntry = (sc.auto || []).find(a => a && a.slug === 'available-today');
        const stockCheck = await stockRepo.list({
          filterByFormula: '{Active} = TRUE()',
          fields: ['Display Name', 'Current Quantity'],
          pg: { active: true, includeEmpty: true },
        });
        const stockLookup = Object.fromEntries(
          stockCheck.map(s => [s['Display Name'], Number(s['Current Quantity'] || 0)])
        );
        const stockByRecId = Object.fromEntries(
          stockCheck.map(s => [s.id, Number(s['Current Quantity'] || 0)])
        );
        const availCandidates = allConfigRows.filter(r => {
          const cats = parseCategoryField(r['Category']);
          return cats.includes('Available Today') && Number(r['Lead Time Days'] ?? 1) === 0;
        });
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
        catTasks.push(async () => {
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
          try {
            await setWixCategoryProducts(availTodayId, availProductIds);
            stats.categoriesSynced++;
            log('item', `Доступно сегодня: ${availProductIds.length} товаров`);
          } catch (err) {
            stats.errors.push(`Available Today: ${err.message}`);
            log('item', `Ошибка категории «Доступно сегодня»: ${err.message}`, 'error');
          }
        });
      }

      const catQueue = new PQueue({ concurrency: 4 });
      await Promise.all(catTasks.map(t => catQueue.add(t)));
    } catch (err) {
      stats.errors.push(`Category phase: ${err.message}`);
      log('item', `Ошибка фазы категорий: ${err.message}`, 'error');
    }

    // ── Product Descriptions ────────────────────────────
    // EN lives directly on the Wix product (name + description fields);
    // PL/RU/UK live in the Wix Multilingual Translation Content API.
    log('phase', 'Обновляем описания и переводы...');
    try {
      const descRows = await productConfigRepo.list({ activeOnly: true });

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
          descByProduct.set(pid, {
            name: enTitle,
            description: textToHtml(enDesc),
            translations,
          });
        }
      }

      const staleDescIds = new Set();
      const descQueue = new PQueue({ concurrency: PUSH_CONCURRENCY });
      await Promise.all([...descByProduct.entries()].map(([productId, content]) => descQueue.add(async () => {
        try {
          await updateWixProductContent(productId, { name: content.name, description: content.description });
          stats.descriptionsSynced++;
        } catch (err) {
          if (err instanceof WixProductNotFoundError) {
            staleDescIds.add(productId);
            return;
          }
          stats.errors.push(`Description ${productId}: ${err.message}`);
        }
        try {
          await pushProductTranslations(productId, content.translations);
          if (content.translations && Object.keys(content.translations).some(l => l !== 'en' && content.translations[l])) {
            stats.translationsSynced++;
          }
        } catch (err) {
          stats.errors.push(`Product translations ${productId}: ${err.message}`);
        }
      })));

      if (staleDescIds.size > 0) {
        log('item', `Описания: пропущено ${staleDescIds.size} удалённых товаров`, 'warn');
      }
      log('summary', `Описания: ${stats.descriptionsSynced} · Переводы: ${stats.translationsSynced}`);
    } catch (err) {
      stats.errors.push(`Description phase: ${err.message}`);
      log('item', `Ошибка фазы описаний: ${err.message}`, 'error');
    }

    log('done', `Готово · цены: ${stats.pricesSynced} · остатки: ${stats.stockSynced} · категории: ${stats.categoriesSynced} · описания: ${stats.descriptionsSynced}`);
    console.log('[PUSH] Complete:', JSON.stringify(stats));
  } catch (err) {
    stats.errors.push(`Fatal: ${err.message}`);
    console.error('[PUSH] Fatal error:', err);
    log('item', `Критическая ошибка: ${err.message}`, 'error');
  }

  await logSync('push', stats);
  if (stats.errors.length > 0) {
    await notifyWixSyncError({ direction: 'push', errors: stats.errors });
  }
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

/**
 * Removes ALL media from a Wix product. Used before attachMediaToProduct
 * to enforce single-image-per-product semantic (see plan Q2=A).
 *
 * Wix Stores Catalog v1: POST /products/:id/media/delete with an empty
 * mediaIds array removes every media item attached to the product.
 */
export async function clearProductMedia(productId) {
  const res = await fetch(
    `${WIX_API_URL}/stores/v1/products/${productId}/media/delete`,
    {
      method: 'POST',
      headers: wixHeaders(),
      body: JSON.stringify({ mediaIds: [] }),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Wix clearProductMedia ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Adds a single media item to a Wix product by URL.
 * The URL must point to a file already in the site's Media Manager
 * (use wixMediaClient.uploadFile to put it there first).
 */
export async function attachMediaToProduct(productId, mediaUrl) {
  const res = await fetch(
    `${WIX_API_URL}/stores/v1/products/${productId}/media`,
    {
      method: 'POST',
      headers: wixHeaders(),
      body: JSON.stringify({ media: [{ url: mediaUrl }] }),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Wix attachMediaToProduct ${res.status}: ${text}`);
  }
  return res.json();
}
