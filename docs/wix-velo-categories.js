// ────────────────────────────────────────────────────────────
// Wix Velo — Multilingual Seasonal Category + Nav Menu
// ────────────────────────────────────────────────────────────
//
// FILE 1: public/blossomCategories.js
//   Wix Editor → Dev Mode → Public & Backend → blossomCategories.js
//
// FILE 2: masterPage.js (usage example at bottom)
//   Wix Editor → Dev Mode → Site → masterPage.js
//
// WHAT IT DOES:
//   1. Fetches category data from the Blossom backend
//   2. Detects the visitor's language
//   3. Returns translated category name (CAPS for nav) + description
//   4. masterPage.js updates the nav menu text on every page load
//
// ────────────────────────────────────────────────────────────

import { fetch } from 'wix-fetch';
import wixWindowFrontend from 'wix-window-frontend';

const API_BASE = 'https://flower-studio-backend-production.up.railway.app';

function getCurrentLang() {
  try {
    return wixWindowFrontend.multilingual.currentLanguage || 'en';
  } catch {
    return 'en';
  }
}

let _cache = null;

async function getCategories() {
  if (_cache) return _cache;
  try {
    const res = await fetch(`${API_BASE}/api/public/categories`, { method: 'GET' });
    if (res.ok) _cache = await res.json();
  } catch (err) {
    console.error('[Blossom] Failed to fetch categories:', err);
  }
  return _cache;
}

/**
 * Get the seasonal category name for the NAV MENU — always CAPS.
 * e.g., "SPRING", "WIOSNA", "ВЕСНА" depending on visitor language.
 */
export async function getSeasonalMenuLabel() {
  const data = await getCategories();
  if (!data?.seasonal?.name) return 'SEASONAL';
  const lang = getCurrentLang();
  const title = data.seasonal.translations?.[lang]?.title
    || data.seasonal.translations?.en?.title
    || data.seasonal.name;
  return title.toUpperCase();
}

/**
 * Get the seasonal category title (normal case, for page headings).
 */
export async function getSeasonalTitle() {
  const data = await getCategories();
  if (!data?.seasonal?.name) return 'Seasonal';
  const lang = getCurrentLang();
  return data.seasonal.translations?.[lang]?.title
    || data.seasonal.translations?.en?.title
    || data.seasonal.name;
}

/**
 * Get the seasonal category description (translated).
 */
export async function getSeasonalDescription() {
  const data = await getCategories();
  if (!data?.seasonal) return '';
  const lang = getCurrentLang();
  return data.seasonal.translations?.[lang]?.description
    || data.seasonal.translations?.en?.description
    || data.seasonal.description || '';
}

/**
 * Get all translations for the seasonal category.
 * Returns { en: { title, description }, pl: {...}, ru: {...}, uk: {...} }
 */
export async function getSeasonalTranslations() {
  const data = await getCategories();
  return data?.seasonal?.translations || {};
}

/**
 * Get full category structure with translations applied.
 */
export async function getAllCategories() {
  const data = await getCategories();
  if (!data) return { permanent: [], seasonal: null, auto: [] };
  const lang = getCurrentLang();
  return {
    permanent: data.permanent || [],
    seasonal: data.seasonal ? {
      name: data.seasonal.translations?.[lang]?.title || data.seasonal.name,
      menuLabel: (data.seasonal.translations?.[lang]?.title || data.seasonal.name).toUpperCase(),
      slug: data.seasonal.slug,
      description: data.seasonal.translations?.[lang]?.description || data.seasonal.description || '',
      translations: data.seasonal.translations || {},
    } : null,
    auto: data.auto || [],
  };
}


// ────────────────────────────────────────────────────────────
// MASTER PAGE CODE — paste this into masterPage.js
// ────────────────────────────────────────────────────────────
//
// import { getSeasonalMenuLabel, getSeasonalTitle, getSeasonalDescription }
//   from 'public/blossomCategories.js';
//
// $w.onReady(async function () {
//   // Update the seasonal nav menu item text (CAPS)
//   // Replace #seasonalMenuText with your actual element ID
//   try {
//     const menuLabel = await getSeasonalMenuLabel();
//     $w('#seasonalMenuText').text = menuLabel;
//   } catch (e) { console.error('Menu update failed:', e); }
// });
//
// ────────────────────────────────────────────────────────────
// CATEGORY PAGE CODE — paste into the seasonal category page
// ────────────────────────────────────────────────────────────
//
// import { getSeasonalTitle, getSeasonalDescription }
//   from 'public/blossomCategories.js';
//
// $w.onReady(async function () {
//   const [title, desc] = await Promise.all([
//     getSeasonalTitle(),
//     getSeasonalDescription(),
//   ]);
//   $w('#categoryTitle').text = title;
//   $w('#categoryDescription').text = desc;
// });
