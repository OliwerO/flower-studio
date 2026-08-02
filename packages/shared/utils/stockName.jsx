// Renders a stock Display Name with a date batch tag.
// If the name contains a date suffix like "(14.Mar.)", it extracts that.
// Otherwise, if lastRestocked is provided, it formats and shows that date as a tag.
//
// Splitting is delegated to `parseBatchName`, which reads BOTH tag forms — the
// short `(14.Mar.)` and the ISO `(2026-07-23)` the Y-model writes, normalising
// the latter to the short badge. This file used to carry its own short-only
// regex, so an ISO-tagged row rendered `(2026-07-23)` as part of the flower's
// NAME instead of as a delivery badge.

import parseBatchName from './parseBatchName.js';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatDateTag(d) {
  return `${d.getDate()}.${MONTHS[d.getMonth()]}.`;
}

export function renderStockName(displayName, lastRestocked) {
  if (!displayName) return '';
  const { name: baseName, batch } = parseBatchName(displayName);

  // Determine date label: from name suffix or from lastRestocked field
  let dateLabel = batch;
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
  return parseBatchName(displayName).name;
}

/**
 * Returns just the date tag JSX (or null if no date available).
 */
export function renderDateTag(displayName, lastRestocked) {
  if (!displayName) return null;
  let dateLabel = parseBatchName(displayName).batch;
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
