// Renders a stock Display Name with a date batch tag.
// If the name contains a date suffix like "(14.Mar.)", it extracts that.
// Otherwise, if lastRestocked is provided, it formats and shows that date as a tag.

const DATE_BATCH_RE = /^(.+?)\s*\((\d{1,2}\.\w{3,4}\.?)\)$/;
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatDateTag(d) {
  return `${d.getDate()}.${MONTHS[d.getMonth()]}.`;
}

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
      dateLabel = formatDateTag(d);
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
      : 'bg-gray-100 text-gray-500 border-gray-200';

  return (
    <>
      {baseName}
      <span className={`ml-1.5 inline-flex items-center text-[10px] font-medium border px-1.5 py-0.5 rounded-md align-middle ${tagColor}`}>
        {dateLabel}
      </span>
    </>
  );
}

/**
 * Returns just the base stock name without the date tag.
 */
export function stockBaseName(displayName) {
  if (!displayName) return '';
  const match = displayName.match(DATE_BATCH_RE);
  return match ? match[1] : displayName;
}

/**
 * Returns just the date tag JSX (or null if no date available).
 */
export function renderDateTag(displayName, lastRestocked) {
  if (!displayName) return null;
  const match = displayName.match(DATE_BATCH_RE);

  let dateLabel = match ? match[2] : null;
  let daysAgo = null;
  if (!dateLabel && lastRestocked) {
    const d = new Date(lastRestocked);
    if (!isNaN(d)) {
      dateLabel = formatDateTag(d);
      daysAgo = Math.floor((Date.now() - d.getTime()) / 86400000);
    }
  } else if (lastRestocked) {
    const d = new Date(lastRestocked);
    if (!isNaN(d)) daysAgo = Math.floor((Date.now() - d.getTime()) / 86400000);
  }

  if (!dateLabel) return null;

  const tagColor = daysAgo != null && daysAgo > 14
    ? 'bg-red-50 text-red-600 border-red-200'
    : daysAgo != null && daysAgo > 7
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-gray-100 text-gray-500 border-gray-200';

  return (
    <span className={`inline-flex items-center text-[10px] font-medium border px-1.5 py-0.5 rounded-md ${tagColor}`}>
      {dateLabel}
    </span>
  );
}
