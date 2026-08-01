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
// A key nested under `po:` (the florist app's Stock Order block) still counts —
// the component's `tx` cascade reads `t[key] ?? t.po?.[key]`.

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
    // `key:` at the start of a line (any indent) — the object-literal shape both
    // files use. Two occurrences = the EN block and the RU block.
    const hits = source.match(new RegExp(`^\\s*${key}:`, 'gm')) || [];
    expect(hits.length, `${app} defines "${key}" ${hits.length}× (need ≥2: en + ru)`)
      .toBeGreaterThanOrEqual(2);
  });
});
