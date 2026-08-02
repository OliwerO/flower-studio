// Every string the shared BouquetFlowerForm can render must exist in BOTH host
// apps' translations, in BOTH languages.
//
// This is text-level rather than import-level on purpose: the two apps' EN and
// RU blocks live in one file and are not separately importable from here. Crude,
// but it is the only thing that catches this class — `newVarietyConfirm` and
// `newVarietyCreate` have been falling back to their English literals inside
// `PoLineForm` in shipped UI precisely because nothing checked, and the two
// wizards render the English literal `'Flower name'` in the Russian interface
// for the same reason.
//
// A key nested under `po:` does NOT count, and the earlier version of this test
// said it did. `BouquetFlowerForm`'s cascade is `t[key] ?? t.po?.[key]`, but the
// florist `t` is a Proxy that returns the KEY ITSELF when a translation is
// missing — never undefined — so the `??` never reaches the nested block. The
// badge rendered the literal string `varietyNone` in shipped UI. Hence: the key
// must exist at TOP level (two-space indent), once per language block.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { BOUQUET_FLOWER_FORM_KEYS } from '../components/BouquetFlowerForm.jsx';

const here = dirname(fileURLToPath(import.meta.url));
const APPS = {
  florist:   resolve(here, '../../../apps/florist/src/translations.js'),
  dashboard: resolve(here, '../../../apps/dashboard/src/translations.js'),
};

describe.each(Object.entries(APPS))('%s translations', (app, path) => {
  const source = readFileSync(path, 'utf8');

  it.each(BOUQUET_FLOWER_FORM_KEYS)('defines %s in both languages', (key) => {
    // Exactly two spaces of indent = a top-level key in one of the two language
    // objects. Deeper indent is a nested block the component never reads.
    const hits = source.match(new RegExp(`^  ${key}:`, 'gm')) || [];
    expect(hits.length, `${app} defines top-level "${key}" ${hits.length}× (need ≥2: en + ru)`)
      .toBeGreaterThanOrEqual(2);
  });
});
