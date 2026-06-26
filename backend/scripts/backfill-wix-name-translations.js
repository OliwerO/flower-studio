// DESTRUCTIVE: writes prod product_config. ADR-0008 one-time seed — imports
// current Wix names (EN Stores name + PL/RU/UK Multilingual product-name) into
// product_config.translations so flower-studio owns Product names going forward.
//
// Run once, with Owner approval, from backend/ with prod creds in env:
//   railway run --service flower-studio-backend node scripts/backfill-wix-name-translations.js
//
// Idempotent: re-running re-seeds the same values (safe). It seeds ALL variant
// rows of each Wix product so the per-variant Translations stay consistent.

import { fetchAllWixProducts, fetchProductTranslations } from '../src/services/wixProductSync.js';
import * as productConfigRepo from '../src/repos/productConfigRepo.js';
import { buildSeedUpdatesForProduct } from '../src/services/wixNameSeed.js';

if (!process.env.WIX_API_KEY || !process.env.WIX_SITE_ID) {
  console.error('[seed] WIX_API_KEY / WIX_SITE_ID not set. Aborting.');
  process.exit(1);
}

const products = await fetchAllWixProducts();
console.log(`[seed] ${products.length} Wix products`);
const rows = await productConfigRepo.list();
let seeded = 0;
for (const p of products) {
  let locales = {};
  try { locales = await fetchProductTranslations(p.id); }
  catch (e) { console.warn(`[seed] translations read failed for ${p.name}: ${e.message}`); }
  const updates = buildSeedUpdatesForProduct(p, locales);
  const variantRows = rows.filter(r => r['Wix Product ID'] === p.id);
  for (const r of variantRows) {
    await productConfigRepo.update(r.id, updates);
    seeded++;
  }
  console.log(`[seed] ${p.name}: ${variantRows.length} rows`);
}
console.log(`[seed] done — ${seeded} variant rows seeded`);
process.exit(0);
