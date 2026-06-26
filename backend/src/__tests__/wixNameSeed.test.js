import { describe, it, expect } from 'vitest';
import { buildSeedUpdatesForProduct } from '../services/wixNameSeed.js';

describe('buildSeedUpdatesForProduct', () => {
  it('uses Wix Stores name as canonical en.title and folds in locale translations', () => {
    const out = buildSeedUpdatesForProduct(
      { name: 'Mix of the Day 1 - XL', description: 'Daily mix' },
      { pl: { title: 'Bukiet dnia 3 - M' }, ru: { title: 'Микс дня 3 - M' } },
    );
    expect(out['Product Name']).toBe('Mix of the Day 1 - XL');
    expect(out['Translations'].en.title).toBe('Mix of the Day 1 - XL');
    expect(out['Translations'].en.description).toBe('Daily mix');
    // stale locale names are seeded verbatim so the owner sees + fixes them
    expect(out['Translations'].pl.title).toBe('Bukiet dnia 3 - M');
    expect(out['Translations'].ru.title).toBe('Микс дня 3 - M');
  });

  it('omits en.description when the Stores product has none', () => {
    const out = buildSeedUpdatesForProduct({ name: 'Pink Peonies' }, {});
    expect(out['Translations'].en).toEqual({ title: 'Pink Peonies' });
    expect(out['Translations'].pl).toBeUndefined();
  });
});
