// ADR-0008 one-time seed mapper. Builds the product_config updates that import
// current Wix names into flower-studio ownership. Pure — unit-tested without I/O.

const SECONDARY = ['pl', 'ru', 'uk'];

export function buildSeedUpdatesForProduct(wixProduct, localeTranslations = {}) {
  const name = wixProduct?.name || '';
  const translations = { en: { title: name } };
  if (wixProduct?.description) translations.en.description = wixProduct.description;
  for (const locale of SECONDARY) {
    const t = localeTranslations[locale];
    if (!t) continue;
    const entry = {};
    if (t.title) entry.title = t.title;
    if (t.description) entry.description = t.description;
    if (Object.keys(entry).length) translations[locale] = entry;
  }
  return { 'Product Name': name, 'Translations': translations };
}
