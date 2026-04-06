// Renders a stock Display Name with a date batch tag.
// If the name contains a date suffix like "(14.Mar.)", it extracts that.
// Otherwise, if lastRestocked is provided, it formats and shows that date as a tag.

const DATE_BATCH_RE = /^(.+?)\s*\((\d{1,2}\.\w{3,4}\.?)\)$/;

export function renderStockName(displayName, lastRestocked) {
  if (!displayName) return '';
  const match = displayName.match(DATE_BATCH_RE);
  const baseName = match ? match[1] : displayName;

  // Determine date label: from name suffix or from lastRestocked field
  let dateLabel = match ? match[2] : null;
  let daysAgo = null;
  if (!dateLabel && lastRestocked) {
    const d = new Date(lastRestocked);
    if (!isNaN(d)) {
      dateLabel = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
      daysAgo = Math.floor((Date.now() - d.getTime()) / 86400000);
    }
  } else if (lastRestocked) {
    const d = new Date(lastRestocked);
    if (!isNaN(d)) daysAgo = Math.floor((Date.now() - d.getTime()) / 86400000);
  }

  if (!dateLabel) return baseName;

  const tagColor = daysAgo != null && daysAgo > 14
    ? 'bg-red-50 text-red-600 border-red-200'
    : daysAgo != null && daysAgo > 7
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600';

  return (
    <>
      {baseName}
      <span className={`ml-1.5 inline-flex items-center text-[10px] font-medium border px-1.5 py-0.5 rounded-md align-middle ${tagColor}`}>
        {dateLabel}
      </span>
    </>
  );
}

export function parseBatchName(displayName) {
  if (!displayName) return { name: '', batch: null };
  const match = displayName.match(DATE_BATCH_RE);
  if (!match) return { name: displayName, batch: null };
  return { name: match[1], batch: match[2] };
}
