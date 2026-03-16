// ────────────────────────────────────────────────────────────
// Wix Velo — Multilingual Category Display
// ────────────────────────────────────────────────────────────
//
// WHERE TO PUT THIS:
//   Wix Editor → Dev Mode → Public & Backend → masterPage.js
//   (runs on every page, so the seasonal category name is always correct)
//
// WHAT IT DOES:
//   1. Fetches category data from your backend's public API
//   2. Detects the visitor's current language
//   3. Updates category text elements with the correct translation
//
// PREREQUISITES:
//   - Enable Wix Multilingual in your Wix dashboard
//   - Create text elements on your category pages with these IDs:
//     #seasonalCategoryTitle   — the category heading
//     #seasonalCategoryDesc    — the category description
//   - These can be on a dynamic category page or a static section
//
// ────────────────────────────────────────────────────────────

import { fetch } from 'wix-fetch';
import wixWindowFrontend from 'wix-window-frontend';

const API_BASE = 'https://flower-studio-backend-production.up.railway.app';

// Map Wix language codes to our translation keys
// Wix uses 'en', 'pl', 'ru', 'uk' — same as ours
function getCurrentLang() {
  try {
    return wixWindowFrontend.multilingual.currentLanguage || 'pl';
  } catch {
    return 'pl'; // default to Polish if multilingual not enabled
  }
}

/**
 * Fetch category data from the Blossom backend.
 * Cached for the page session — no extra API calls on navigation.
 */
let _categoryCache = null;

async function getCategories() {
  if (_categoryCache) return _categoryCache;

  try {
    const res = await fetch(`${API_BASE}/api/public/categories`, {
      method: 'GET',
    });
    if (res.ok) {
      _categoryCache = await res.json();
    }
  } catch (err) {
    console.error('Failed to fetch categories:', err);
  }

  return _categoryCache;
}

/**
 * Get the translated title for the active seasonal category.
 * Falls back: translation → original name → 'Seasonal'
 */
export async function getSeasonalTitle() {
  const data = await getCategories();
  if (!data?.seasonal?.name) return 'Seasonal';

  const lang = getCurrentLang();
  const translated = data.seasonal.translations?.[lang]?.title;
  if (translated) return translated;

  // Fallback: PL translation → original name
  return data.seasonal.translations?.pl?.title || data.seasonal.name;
}

/**
 * Get the translated description for the active seasonal category.
 */
export async function getSeasonalDescription() {
  const data = await getCategories();
  if (!data?.seasonal) return '';

  const lang = getCurrentLang();
  const translated = data.seasonal.translations?.[lang]?.description;
  if (translated) return translated;

  // Fallback: PL translation → base description
  return data.seasonal.translations?.pl?.description || data.seasonal.description || '';
}

/**
 * Get full category info (for building nav menus or repeaters).
 */
export async function getAllCategories() {
  const data = await getCategories();
  if (!data) return { permanent: [], seasonal: null, auto: [] };

  const lang = getCurrentLang();

  return {
    permanent: data.permanent || [],
    seasonal: data.seasonal ? {
      name: data.seasonal.translations?.[lang]?.title
        || data.seasonal.translations?.pl?.title
        || data.seasonal.name,
      slug: data.seasonal.slug,
      description: data.seasonal.translations?.[lang]?.description
        || data.seasonal.translations?.pl?.description
        || data.seasonal.description || '',
    } : null,
    auto: data.auto || [],
  };
}


// ────────────────────────────────────────────────────────────
// USAGE EXAMPLE — put this in your page code (e.g., Category page)
// ────────────────────────────────────────────────────────────
//
// import { getSeasonalTitle, getSeasonalDescription } from 'public/categories.js';
//
// $w.onReady(async function () {
//   const title = await getSeasonalTitle();
//   const desc = await getSeasonalDescription();
//
//   $w('#seasonalCategoryTitle').text = title;
//   $w('#seasonalCategoryDesc').text = desc;
// });
//
// ────────────────────────────────────────────────────────────
// NAV MENU EXAMPLE — update the seasonal nav item text
// ────────────────────────────────────────────────────────────
//
// Put in masterPage.js to update nav on every page:
//
// import { getSeasonalTitle } from 'public/categories.js';
//
// $w.onReady(async function () {
//   const title = await getSeasonalTitle();
//   // If your nav menu has a repeater or text element for seasonal:
//   $w('#seasonalNavLabel').text = title;
// });
