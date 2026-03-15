// fmtDate — converts YYYY-MM-DD to DD.MM.YYYY (European format).
// Like relabeling a part number from ISO coding to the local factory convention.

export default function fmtDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return dateStr || '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}
