// No translation key may be declared twice inside one language block.
//
// JS object literals keep the LAST declaration silently, so a duplicated key is
// not an error — it is a value that quietly overrides another, with no warning
// from the bundler, the linter, or any test. That is how the florist app shipped
// `stems: 'стеблей'` overriding the `stems: 'шт.'` that the batch-picker block
// declared for itself, while the dashboard declared 'шт.' in both places and
// looked fine (#615). The two apps rendered different units for the same key and
// the Cross-App Parity rule could not see it.
//
// This is the complement of `bouquetFlowerFormKeys.test.js`, which asserts a key
// exists at least once per language block. Together: exactly once per block.
//
// Text-level rather than import-level for the same reason that test gives — the
// EN and RU blocks live in one file and are not separately importable from here.
//
// ── The baseline ──
// Fixing #615 surfaced 33 further duplicated keys that predate it, most with
// DIVERGING values (dashboard `reasonDamaged` is 'Сломаны при доставке'
// overridden by 'Повреждённые' — two different loss reasons; florist `sex` is
// 'Тип' overridden by 'Пол / Бизнес'). Choosing between them changes
// owner-facing Russian UI text, so they are not resolved here. They are listed
// below so this guard can ship now and fail on anything NEW, and the list is
// meant to shrink to empty — see the burn-down issue.
//
// To clear an entry: delete the losing declaration, then delete the key here.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const APPS = {
  florist:   resolve(here, '../../../apps/florist/src/translations.js'),
  dashboard: resolve(here, '../../../apps/dashboard/src/translations.js'),
  delivery:  resolve(here, '../../../apps/delivery/src/translations.js'),
};

// Known pre-existing duplicates, by app. Same key set in both language blocks.
// NOT a licence to add more — every entry here is a latent #615.
const BASELINE = {
  florist: [
    'today', 'outOfStock', 'communicationMethod', 'deliveryDate',
    'customer', 'details', 'returnToStock', 'showAll', 'sex',
  ],
  dashboard: [
    'showAll', 'customer', 'orderCancelled', 'supplier', 'returnToStock',
    'editBouquet', 'reasonWilted', 'reasonDamaged', 'arrivedBroken',
    'thisMonth', 'totalSpend', 'today', 'tomorrow', 'variety', 'available',
    'totalStems', 'deliveryDate', 'filterMin', 'filterMax', 'resetFilters',
    'neededBy', 'swapComplete',
  ],
  delivery: ['callRecipient'],
};

/**
 * Split the source into its language blocks and collect the top-level keys of
 * each. Two-space indent = top level within a block; anything deeper is a nested
 * object, where a repeated key is legitimate.
 */
function topLevelKeysByBlock(source) {
  const starts = [...source.matchAll(/^const ([a-z]{2,3}) = \{$/gm)]
    .map(m => ({ lang: m[1], index: m.index }));

  return starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index : source.length;
    const body = source.slice(start.index, end);
    const keys = [...body.matchAll(/^ {2}([A-Za-z_$][\w$]*):/gm)].map(m => m[1]);
    return { lang: start.lang, keys };
  });
}

describe.each(Object.entries(APPS))('%s translations', (app, path) => {
  const blocks = topLevelKeysByBlock(readFileSync(path, 'utf8'));
  const baseline = new Set(BASELINE[app] || []);

  it('declares at least two language blocks', () => {
    expect(blocks.length, `${app}: found ${blocks.length} language block(s)`)
      .toBeGreaterThanOrEqual(2);
  });

  it.each(blocks.map(b => [b.lang, b.keys]))('has no NEW duplicate key in the %s block', (lang, keys) => {
    const counts = new Map();
    for (const k of keys) counts.set(k, (counts.get(k) || 0) + 1);

    const fresh = [...counts.entries()]
      .filter(([k, n]) => n > 1 && !baseline.has(k))
      .map(([k, n]) => `${k} (×${n})`);

    expect(fresh, `${app}.${lang} declares these keys more than once — the later one silently wins, ` +
      `and nothing else will tell you: ${fresh.join(', ')}`).toEqual([]);
  });

  // Keeps the baseline honest: an entry that is no longer duplicated must be
  // removed, so the list can only shrink and never quietly hides a fixed key.
  it.each(blocks.map(b => [b.lang, b.keys]))('has no stale baseline entry for the %s block', (lang, keys) => {
    const counts = new Map();
    for (const k of keys) counts.set(k, (counts.get(k) || 0) + 1);

    const stale = [...baseline].filter(k => (counts.get(k) || 0) <= 1);

    expect(stale, `${app}.${lang}: these keys are no longer duplicated — remove them from BASELINE: ${stale.join(', ')}`)
      .toEqual([]);
  });
});
