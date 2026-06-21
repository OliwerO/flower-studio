// Null-safe date comparators for rows shaped { date: string|null }.
// Undated rows (legacy/orig Stock Items, dateless DEs) sort LAST so dated
// rows keep chronological order — never dereference null.localeCompare.
export function byDateAsc(a, b) {
  if (!a.date && !b.date) return 0;
  if (!a.date) return 1;
  if (!b.date) return -1;
  return a.date.localeCompare(b.date);
}
export function byDateDesc(a, b) {
  if (!a.date && !b.date) return 0;
  if (!a.date) return 1;
  if (!b.date) return -1;
  return b.date.localeCompare(a.date);
}
