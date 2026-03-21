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

export function parseCats(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return val.split(',').map(s => s.trim()).filter(Boolean);
}
