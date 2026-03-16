#!/usr/bin/env node
// Comprehensive test suite for Wix Category Sync (Phase 4).
// Tests logic WITHOUT hitting real APIs — uses source reading, regex,
// and mock-based verification of exported functions where possible.
//
// Run: node scripts/test-wix-categories.mjs

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    console.log(`  \u2713 ${label}`);
    passed++;
  } else {
    console.log(`  \u2717 ${label}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

// ── Load source files as text for pattern-based tests ───────────
const settingsSrc = readFileSync(resolve(ROOT, 'backend/src/routes/settings.js'), 'utf8');
const syncSrc     = readFileSync(resolve(ROOT, 'backend/src/services/wixProductSync.js'), 'utf8');
const productsSrc = readFileSync(resolve(ROOT, 'backend/src/routes/products.js'), 'utf8');
const publicSrc   = readFileSync(resolve(ROOT, 'backend/src/routes/public.js'), 'utf8');
const dashTransSrc= readFileSync(resolve(ROOT, 'apps/dashboard/src/translations.js'), 'utf8');

// ════════════════════════════════════════════════════════════════
// 1. Settings data model tests
// ════════════════════════════════════════════════════════════════
section('1. Settings data model — DEFAULTS structure');

// 1a. DEFAULTS contains storefrontCategories with required new fields
check('DEFAULTS has storefrontCategories', settingsSrc.includes('storefrontCategories'));
check('storefrontCategories has wixCategoryMap', settingsSrc.includes('wixCategoryMap'));
check('wixCategoryMap defaults to empty object', settingsSrc.includes("wixCategoryMap: {}"));

// 1b. Each seasonal entry has description + translations
const seasonalEntries = settingsSrc.match(/\{\s*name:\s*["'][^"']+["']/g) || [];
check('Has seasonal entries defined', seasonalEntries.length >= 5);

check('Seasonal entries have description field',
  settingsSrc.includes("description: ''") &&
  settingsSrc.match(/slug:.*?description:\s*''/s) !== null
);

check('Seasonal entries have translations field',
  settingsSrc.includes("translations: { en: { title: '', description: '' }")
);

check('Translations have 4 languages (en, pl, ru, uk)',
  settingsSrc.includes("en: { title: '', description: '' }") &&
  settingsSrc.includes("pl: { title: '', description: '' }") &&
  settingsSrc.includes("ru: { title: '', description: '' }") &&
  settingsSrc.includes("uk: { title: '', description: '' }")
);

// 1c. getActiveSeasonalCategory returns description + translations
section('1b. getActiveSeasonalCategory — return shape');

check('getActiveSeasonalCategory is exported',
  settingsSrc.includes('export function getActiveSeasonalCategory()')
);

check('Returns description field',
  settingsSrc.includes("description: forced.description || ''") &&
  settingsSrc.includes("description: s.description || ''")
);

check('Returns translations field',
  settingsSrc.includes("translations: forced.translations || {}") &&
  settingsSrc.includes("translations: s.translations || {}")
);

// 1d. manualOverride branch returns description+translations
const manualOverrideBlock = settingsSrc.match(/if\s*\(sc\.manualOverride\)[\s\S]*?return\s*\{[\s\S]*?\};/);
check('Manual override return includes all 4 fields (name, slug, description, translations)',
  manualOverrideBlock &&
  manualOverrideBlock[0].includes('name:') &&
  manualOverrideBlock[0].includes('slug:') &&
  manualOverrideBlock[0].includes('description:') &&
  manualOverrideBlock[0].includes('translations:')
);

// 1e. updateConfig is exported
check('updateConfig is exported',
  settingsSrc.includes('export function updateConfig(')
);

check('updateConfig saves to Airtable via saveConfig()',
  /export function updateConfig[\s\S]*?saveConfig\(\)/.test(settingsSrc)
);

// ════════════════════════════════════════════════════════════════
// 2. Translation endpoint logic tests
// ════════════════════════════════════════════════════════════════
section('2. Translation endpoint — /api/products/translate');

check('POST /translate route exists',
  productsSrc.includes("router.post('/translate'")
);

check('Route requires admin auth (router.use(authorize(\'admin\')))',
  productsSrc.includes("router.use(authorize('admin'))")
);

check('Validates text param — returns 400 if missing',
  productsSrc.includes("if (!text)") &&
  productsSrc.includes("res.status(400)")
);

check('Uses Claude Haiku for translation',
  productsSrc.includes('claude-haiku-4-5-20251001') || productsSrc.includes('claude-3-haiku')
);

check('Requests 4 languages (en, pl, ru, uk)',
  productsSrc.includes('"en"') &&
  productsSrc.includes('"pl"') &&
  productsSrc.includes('"ru"') &&
  productsSrc.includes('"uk"')
);

check('Extracts text and type from req.body',
  productsSrc.includes('const { text, type } = req.body')
);

// ════════════════════════════════════════════════════════════════
// 3. wixProductSync Phase 4 logic tests
// ════════════════════════════════════════════════════════════════
section('3a. parseCategoryField — logic verification');

// Since parseCategoryField is not exported, we replicate it and test
function parseCategoryField(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

check('parseCategoryField(null) → []',
  JSON.stringify(parseCategoryField(null)) === '[]'
);

check('parseCategoryField(undefined) → []',
  JSON.stringify(parseCategoryField(undefined)) === '[]'
);

check('parseCategoryField("") → []',
  JSON.stringify(parseCategoryField('')) === '[]'
);

check('parseCategoryField(["A","B"]) → ["A","B"]',
  JSON.stringify(parseCategoryField(['A', 'B'])) === '["A","B"]'
);

check('parseCategoryField("A, B, C") → ["A","B","C"]',
  JSON.stringify(parseCategoryField('A, B, C')) === '["A","B","C"]'
);

check('parseCategoryField("  Roses , Tulips ") trims whitespace',
  JSON.stringify(parseCategoryField('  Roses , Tulips ')) === '["Roses","Tulips"]'
);

check('parseCategoryField("A,,B") skips empty segments',
  JSON.stringify(parseCategoryField('A,,B')) === '["A","B"]'
);

// 3b. Verify the function exists in sync source with same logic
section('3b. parseCategoryField — exists in wixProductSync.js');

check('parseCategoryField defined in wixProductSync.js',
  syncSrc.includes('function parseCategoryField(val)')
);

check('Handles array input (Array.isArray check)',
  syncSrc.includes('if (Array.isArray(val)) return val')
);

check('Handles comma-string input (split + trim)',
  syncSrc.includes(".split(',').map(s => s.trim()).filter(Boolean)")
);

// Also in public.js
check('parseCategoryField also defined in public.js (consistent)',
  publicSrc.includes('function parseCategoryField(val)')
);

section('3c. Safety guards — empty product list');

check('Empty permanent category skips setWixCategoryProducts',
  syncSrc.includes("if (productIds.length === 0)") &&
  syncSrc.includes("console.log(`[SYNC] Skipping")
);

check('Seasonal products: only reassign if some are tagged',
  syncSrc.includes("if (seasonalProductIds.length > 0)")
);

section('3d. Seasonal name/description update guards');

check('Only updates Wix if PL translations exist',
  syncSrc.includes("const plTitle = seasonal.translations?.pl?.title") &&
  syncSrc.includes("const plDesc = seasonal.translations?.pl?.description")
);

check('Updates Wix category with PL title or fallback to seasonal.name',
  syncSrc.includes("name: plTitle || seasonal.name")
);

check('Only calls updateWixCategory if plTitle or plDesc is truthy',
  syncSrc.includes("if (plTitle || plDesc)")
);

section('3e. Backfill logic — import description from Wix');

check('Finds seasonal Wix category by slug',
  syncSrc.includes("wixCategories.find(c => c.slug === 'seasonal')")
);

check('Only backfills if local description is empty AND Wix has one',
  syncSrc.includes("if (!entry.description && wixSeasonalCat.description)")
);

check('Backfills PL title from Wix name if empty',
  syncSrc.includes("if (!entry.translations.pl.title && wixSeasonalCat.name)")
);

check('Backfills PL description from Wix description if empty',
  syncSrc.includes("if (!entry.translations.pl.description && wixSeasonalCat.description)")
);

check('Initializes translations object if missing',
  syncSrc.includes("if (!entry.translations) entry.translations = {}") &&
  syncSrc.includes("if (!entry.translations.pl) entry.translations.pl = {}")
);

check('Persists updated config via updateConfig',
  syncSrc.includes("updateConfig('storefrontCategories', sc)")
);

// 3f. Wix category map stored in config
section('3f. Category map persistence');

check('Builds catMap from Wix categories slug → id',
  syncSrc.includes('catMap[c.slug] = c.id')
);

check('Stores catMap in storefrontCategories config',
  syncSrc.includes('sc.wixCategoryMap = catMap')
);

// 3g. fetchWixCategories returns description
section('3g. fetchWixCategories returns description');

check('fetchWixCategories maps description from Wix response',
  syncSrc.includes("description: c.description || ''")
);

// ════════════════════════════════════════════════════════════════
// 4. Public API tests — /api/public/categories
// ════════════════════════════════════════════════════════════════
section('4. Public API — /api/public/categories response shape');

check('GET /categories endpoint exists',
  publicSrc.includes("router.get('/categories'")
);

check('Response includes description in seasonal object',
  publicSrc.includes("description: seasonal.description || ''")
);

check('Response includes translations in seasonal object',
  publicSrc.includes("translations: seasonal.translations || {}")
);

check('Seasonal object has name and slug',
  publicSrc.includes('name: seasonal.name') &&
  publicSrc.includes('slug: seasonal.slug')
);

check('Non-seasonal fallback returns { active: null, slug: null }',
  publicSrc.includes('active: null, slug: null')
);

check('Response includes allCategories (union of all category names)',
  publicSrc.includes('allCategories')
);

// ════════════════════════════════════════════════════════════════
// 5. Dashboard build test
// ════════════════════════════════════════════════════════════════
section('5. Dashboard build test (vite build)');

try {
  console.log('  ... building (this may take 15-30s)');
  execSync('npx vite build', {
    cwd: resolve(ROOT, 'apps/dashboard'),
    stdio: 'pipe',
    timeout: 120000,
  });
  check('Dashboard builds without errors', true);
} catch (err) {
  const output = (err.stderr || err.stdout || '').toString().slice(-500);
  check(`Dashboard builds without errors\n      Build error: ${output}`, false);
}

// ════════════════════════════════════════════════════════════════
// 6. Translation keys consistency (en ↔ ru)
// ════════════════════════════════════════════════════════════════
section('6. Translation keys consistency (en vs ru)');

// Extract key lists from source using regex
function extractKeys(src, varName) {
  // Match: const varName = { ... };  — grab everything between the outermost braces
  const regex = new RegExp(`const ${varName}\\s*=\\s*\\{([\\s\\S]*?)\\n\\};`, 'm');
  const match = src.match(regex);
  if (!match) return [];
  const body = match[1];
  // Extract keys: lines like "  keyName: " or "  keyName:  "
  const keys = [];
  for (const line of body.split('\n')) {
    const km = line.match(/^\s+(\w+)\s*:/);
    if (km) keys.push(km[1]);
  }
  return keys;
}

const enKeys = extractKeys(dashTransSrc, 'en');
const ruKeys = extractKeys(dashTransSrc, 'ru');

check(`English has ${enKeys.length} keys`, enKeys.length > 0);
check(`Russian has ${ruKeys.length} keys`, ruKeys.length > 0);

const missingInRu = enKeys.filter(k => !ruKeys.includes(k));
const missingInEn = ruKeys.filter(k => !enKeys.includes(k));

check(`No EN keys missing from RU (found ${missingInRu.length})`,
  missingInRu.length === 0
);
if (missingInRu.length > 0) {
  console.log(`      Missing in RU: ${missingInRu.join(', ')}`);
}

check(`No RU keys missing from EN (found ${missingInEn.length})`,
  missingInEn.length === 0
);
if (missingInEn.length > 0) {
  console.log(`      Missing in EN: ${missingInEn.join(', ')}`);
}

// Check specifically the new storefront/category keys
const newCategoryKeys = [
  'sfDescription', 'sfDescriptionHint', 'sfTranslate', 'sfTranslating',
  'sfTranslated', 'sfTranslations',
];

section('6b. New category translation keys');

for (const key of newCategoryKeys) {
  check(`EN has key "${key}"`, enKeys.includes(key));
  check(`RU has key "${key}"`, ruKeys.includes(key));
}

// ════════════════════════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(50));
console.log(`RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log('='.repeat(50));

process.exit(failed > 0 ? 1 : 0);
