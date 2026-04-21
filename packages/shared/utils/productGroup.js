// Groups PRODUCT_CONFIG variant rows into bouquet-level groups.
// One Wix product (e.g. "Rose Bouquet") → N Airtable rows (S/M/L/XL/XXL variants).
// Grouping lets the UI show the bouquet as a single card with an aggregate active count.

export function groupByProduct(rows) {
  const map = new Map();
  for (const row of rows) {
    const pid = row['Wix Product ID'] || row.id;
    if (!map.has(pid)) {
      map.set(pid, {
        wixProductId: pid,
        name: row['Product Name'] || 'Unknown',
        imageUrl: row['Image URL'] || '',
        variants: [],
      });
    }
    map.get(pid).variants.push(row);
  }
  return Array.from(map.values());
}

// Airtable returns categories either as array (multi-select) or CSV string
// depending on field configuration. Normalize both to a string[].
export function parseCats(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return String(val).split(',').map(s => s.trim()).filter(Boolean);
}

export function activeCount(group) {
  return group.variants.filter(v => v['Active']).length;
}

export function allActive(group) {
  return group.variants.length > 0 && group.variants.every(v => v['Active']);
}

export function anyActive(group) {
  return group.variants.some(v => v['Active']);
}

// Price range across all variants — returns [min, max] or null if no prices.
export function priceRange(group) {
  const prices = group.variants
    .map(v => Number(v['Price']))
    .filter(p => Number.isFinite(p) && p > 0);
  if (prices.length === 0) return null;
  return [Math.min(...prices), Math.max(...prices)];
}

// Merged, deduped category list across all variants of a bouquet.
export function groupCategories(group) {
  const set = new Set();
  for (const v of group.variants) {
    for (const c of parseCats(v['Category'])) set.add(c);
  }
  return Array.from(set);
}
