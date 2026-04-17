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
// masterPage.js runs on every language version of the site, so updating
// element text here translates the menu items for EN / PL / RU / UK in
// one place. Use placeholder text elements (e.g. #seasonalMenuText,
// #availableTodayMenuText) inside your header menu and let Velo fill
// them with the translated label.
//
// import {
//   getSeasonalMenuLabel,
//   getAvailableTodayMenuLabel,
//   isAvailableTodayActive,
// } from 'public/blossomCategories.js';
//
// $w.onReady(async function () {
//   // Seasonal
//   try {
//     const menuLabel = await getSeasonalMenuLabel();
//     $w('#seasonalMenuText').text = menuLabel;
//   } catch (e) { console.error('Seasonal menu update failed:', e); }
//
//   // Available Today — show in ALL languages when products qualify,
//   // hide when the backend reports productCount === 0 (e.g. no lead-time-0
//   // items left after the cutoff).
//   try {
//     const [label, active] = await Promise.all([
//       getAvailableTodayMenuLabel(),
//       isAvailableTodayActive(),
//     ]);
//     $w('#availableTodayMenuText').text = label;
//     if (active) {
//       $w('#availableTodayMenu').expand();
//       $w('#availableTodayMenu').show();
//     } else {
//       $w('#availableTodayMenu').collapse();
//       $w('#availableTodayMenu').hide();
//     }
//   } catch (e) { console.error('Available Today menu update failed:', e); }
// });
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
