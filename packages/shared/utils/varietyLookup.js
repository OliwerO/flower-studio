// varietyLookup — pure Stock-Item lookup helpers shared by useOrderEditing
// and createBouquetDemand. Split out of useOrderEditing.js so createBouquetDemand
// (a plain util) can depend on it without a hook↔util circular import (the hook
// itself delegates to createBouquetDemand for creating/deepening a demand).
import parseBatchName from './parseBatchName.js';

// Returns all Stock Items whose base variety name matches baseName (case-insensitive).
// Includes both dated Batches ("Rose (06.May.)") and undated Demand Entries ("Rose").
export function findAllMatchingVariety(stockItems, baseName) {
  const needle = (baseName || '').trim().toLowerCase();
  if (!needle) return [];
  return stockItems.filter(s => {
    const { name } = parseBatchName(s['Display Name'] || '');
    return name.trim().toLowerCase() === needle;
  });
}
