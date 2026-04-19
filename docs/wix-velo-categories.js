// ────────────────────────────────────────────────────────────
// Wix Velo — Multilingual Category Translations
// ────────────────────────────────────────────────────────────
//
// FILE 1: public/blossomCategories.js
//   Wix Editor → Dev Mode → Public & Backend → blossomCategories.js
//
// FILE 2: masterPage.js (usage example at bottom)
//   Wix Editor → Dev Mode → Site → masterPage.js
//
// FILE 3: Category Page code (usage example at bottom)
//   Wix Editor → Dev Mode → Page Code → Category Page
//
// WHAT IT DOES:
//   1. Fetches category data from the Blossom backend (all categories)
//   2. Detects the visitor's language
//   3. Returns translated name + description for any category by slug
//   4. masterPage.js updates the seasonal nav menu text
//   5. Category Page code matches URL slug → shows translated title/desc
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

// ── Helper: apply language to a category object ──
function applyLang(cat, lang) {
  if (!cat) return null;
  const t = cat.translations || {};
  return {
    name: (t[lang] && t[lang].title) || (t.en && t.en.title) || cat.name,
    menuLabel: ((t[lang] && t[lang].title) || (t.en && t.en.title) || cat.name).toUpperCase(),
    description: (t[lang] && t[lang].description) || (t.en && t.en.description) || cat.description || '',
    slug: cat.slug,
  };
}

/**
 * Look up ANY category by its URL slug and return translated name + description.
 * Works for permanent, seasonal, and auto categories.
 * @param {string} slug  e.g. 'all-bouquets', 'spring', 'available-today'
 */
export async function getCategoryBySlug(slug) {
  const data = await getCategories();
  if (!data?.categoryMap || !slug) return null;
  const cat = data.categoryMap[slug.toLowerCase()];
  if (!cat) return null;
  return applyLang(cat, getCurrentLang());
}

/**
 * Get the seasonal category name for the NAV MENU — always CAPS.
 * e.g., "SPRING", "WIOSNA", "ВЕСНА" depending on visitor language.
 */
export async function getSeasonalMenuLabel() {
  const data = await getCategories();
  if (!data?.seasonal?.name) return 'SEASONAL';
  const result = applyLang(data.seasonal, getCurrentLang());
  return result.menuLabel;
}

/**
 * Get the seasonal category title (normal case, for page headings).
 */
export async function getSeasonalTitle() {
  const data = await getCategories();
  if (!data?.seasonal?.name) return 'Seasonal';
  const result = applyLang(data.seasonal, getCurrentLang());
  return result.name;
}

/**
 * Get the seasonal category description (translated).
 */
export async function getSeasonalDescription() {
  const data = await getCategories();
  if (!data?.seasonal) return '';
  const result = applyLang(data.seasonal, getCurrentLang());
  return result.description;
}

// ── Available Today helpers ──────────────────────────────────
// Mirror of the seasonal helpers so masterPage.js can render the
// "Available Today" nav item in every language (not just English).
// Visibility is driven by `productCount` returned by the backend —
// show only when there's at least one qualifying product.

function findAuto(data, slug) {
  if (!data) return null;
  if (data.categoryMap && data.categoryMap[slug]) return data.categoryMap[slug];
  return (data.auto || []).find(a => a && a.slug === slug) || null;
}

/**
 * True when the "Available Today" category has qualifying products.
 * `productCount` is set server-side in /api/public/categories.
 * Returns false if the backend is unreachable (safer to hide than to
 * show a category that leads to an empty page).
 */
export async function isAvailableTodayActive() {
  const data = await getCategories();
  const cat = findAuto(data, 'available-today');
  if (!cat) return false;
  return typeof cat.productCount === 'number' && cat.productCount > 0;
}

/**
 * Get the "Available Today" category name for the NAV MENU — always CAPS.
 * e.g., "AVAILABLE TODAY", "DOSTĘPNE DZIŚ", "ДОСТУПНО СЕГОДНЯ", "ДОСТУПНО СЬОГОДНІ".
 */
export async function getAvailableTodayMenuLabel() {
  const data = await getCategories();
  const cat = findAuto(data, 'available-today');
  if (!cat) return 'AVAILABLE TODAY';
  return applyLang(cat, getCurrentLang()).menuLabel;
}

/** Get the "Available Today" category title (normal case, for page headings). */
export async function getAvailableTodayTitle() {
  const data = await getCategories();
  const cat = findAuto(data, 'available-today');
  if (!cat) return 'Available Today';
  return applyLang(cat, getCurrentLang()).name;
}

/** Get the "Available Today" category description (translated). */
export async function getAvailableTodayDescription() {
  const data = await getCategories();
  const cat = findAuto(data, 'available-today');
  if (!cat) return '';
  return applyLang(cat, getCurrentLang()).description;
}

/**
 * Get full category structure with translations applied for current language.
 */
export async function getAllCategories() {
  const data = await getCategories();
  if (!data) return { permanent: [], seasonal: null, auto: [] };
  const lang = getCurrentLang();

  return {
    permanent: (data.permanent || []).map(name => {
      const cat = data.categoryMap?.[name.toLowerCase().replace(/[^a-z0-9]+/g, '-')];
      return cat ? applyLang(cat, lang) : { name, menuLabel: name.toUpperCase(), slug: '', description: '' };
    }),
    seasonal: data.seasonal?.slug ? applyLang(data.seasonal, lang) : null,
    auto: (data.auto || []).map(name => {
      const cat = data.categoryMap?.[name.toLowerCase().replace(/[^a-z0-9]+/g, '-')];
      return cat ? applyLang(cat, lang) : { name, menuLabel: name.toUpperCase(), slug: '', description: '' };
    }),
  };
}


// ────────────────────────────────────────────────────────────
// MASTER PAGE CODE — paste this into masterPage.js
// ────────────────────────────────────────────────────────────
// The Blossom site header uses a horizontal menu (`#horizontalMenu1`)
// whose items are configured in the Wix Editor. masterPage.js runs on
// every language version and mutates the menu's `menuItems` array to
// rename the Seasonal + Available Today labels, and to add / remove
// the Available Today entry based on `productCount` from the backend.
//
// IMPORTANT — owner action required for non-English languages:
//   The horizontal menu's items are translated per-language in the Wix
//   Editor. In each language (Polish, Russian, Ukrainian), open the
//   header menu and add an "Available Today" menu item whose link is
//   `/category/available-today` (the label is irrelevant — Velo
//   overwrites it). Velo can rename, reorder, and remove existing menu
//   items, but it cannot synthesize an item that isn't configured in
//   the Editor menu for that language.
//
// import { getCategories } from 'backend/products.jsw';
// import wixWindowFrontend from 'wix-window-frontend';
//
// $w.onReady(async function () {
//   try {
//     var categories = await getCategories();
//     var seasonal = categories.seasonal;
//     var lang = 'en';
//     try { lang = wixWindowFrontend.multilingual.currentLanguage || 'en'; } catch (e) {}
//
//     // Seasonal label (rename SEASONAL / SPRING / WIOSNA / ВЕСНА → current translation).
//     var seasonalLabel = null;
//     if (seasonal && seasonal.name) {
//       var st = seasonal.translations || {};
//       var stitle = (st[lang] && st[lang].title) || (st.en && st.en.title) || seasonal.name;
//       seasonalLabel = stitle.toUpperCase();
//       try { $w('#button7').label = seasonalLabel; } catch (e) {}  // homepage seasonal button
//     }
//
//     // Available Today: translated label + visibility driven by productCount.
//     var availToday = (categories.auto || []).find(function (a) { return a && a.slug === 'available-today'; });
//     var showAvailToday = availToday && availToday.productCount > 0;
//     var atT = availToday ? (availToday.translations || {}) : {};
//     var atTitle = (atT[lang] && atT[lang].title) || (atT.en && atT.en.title) || 'Available Today';
//
//     var menu = $w('#horizontalMenu1');
//     if (menu && menu.menuItems) {
//       // 1. Rename seasonal menu item.
//       var updated = menu.menuItems.map(function (item) {
//         var upper = (item.label || '').toUpperCase();
//         if (seasonalLabel && (upper === 'SEASONAL' || upper === 'WIOSNA' || upper === 'SPRING' || upper === 'ВЕСНА')) {
//           return Object.assign({}, item, { label: seasonalLabel });
//         }
//         return item;
//       });
//
//       // 2. Pull Available Today out; rename + reorder to first, or drop it entirely.
//       var atItem = null;
//       var rest = [];
//       for (var i = 0; i < updated.length; i++) {
//         if ((updated[i].link || '').indexOf('available-today') !== -1) atItem = updated[i];
//         else rest.push(updated[i]);
//       }
//       if (showAvailToday && atItem) {
//         updated = [Object.assign({}, atItem, { label: atTitle.toUpperCase() })].concat(rest);
//       } else {
//         updated = rest;  // productCount=0 OR item not configured in this language's menu
//       }
//       menu.menuItems = updated;
//     }
//   } catch (err) { console.error('[masterPage]', err.message); }
// });
//
// Note: the getAvailableTodayMenuLabel() / getAvailableTodayTitle() /
// getAvailableTodayDescription() / isAvailableTodayActive() helpers above
// are useful when Available Today is bound to a standalone text or
// container element (e.g. a category page heading). The deployed
// masterPage.js does not use them — it inlines the translation lookup
// against the horizontal menu's items directly.
//
// ────────────────────────────────────────────────────────────
// CATEGORY PAGE CODE — works for ALL category pages
// ────────────────────────────────────────────────────────────
//
// import { getCategoryBySlug } from 'public/blossomCategories.js';
// import wixLocationFrontend from 'wix-location-frontend';
//
// $w.onReady(async function () {
//   try {
//     var path = wixLocationFrontend.path || [];
//     var slug = (path[path.length - 1] || '').toLowerCase();
//
//     var cat = await getCategoryBySlug(slug);
//     if (!cat) {
//       $w('#text25').collapse();
//       $w('#Section1RegularSubtitle1').collapse();
//       return;
//     }
//
//     function applyText() {
//       $w('#text25').text = cat.name;
//       $w('#Section1RegularSubtitle1').text = cat.description;
//       $w('#text25').expand(); $w('#text25').show();
//       $w('#Section1RegularSubtitle1').expand(); $w('#Section1RegularSubtitle1').show();
//       try { $w('#Section1Regular').expand(); $w('#Section1Regular').show(); } catch(e) {}
//     }
//     applyText();
//     setTimeout(applyText, 500);
//     setTimeout(applyText, 1500);
//
//     console.log('[CategoryPage] slug=' + slug + ' title=' + cat.name);
//   } catch (err) {
//     console.error('[CategoryPage]', err.message);
//   }
// });
