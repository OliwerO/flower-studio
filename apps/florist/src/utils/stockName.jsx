// Renders a stock Display Name, extracting date batch suffixes like "(14.Mar.)"
// into a styled tag/badge instead of plain text.

const DATE_BATCH_RE = /^(.+?)\s*\((\d{1,2}\.\w{3,4}\.?)\)$/;

export function renderStockName(displayName) {
  if (!displayName) return '';
  const match = displayName.match(DATE_BATCH_RE);
  if (!match) return displayName;
  const [, baseName, dateLabel] = match;
  return (
    <>
      {baseName}
      <span className="ml-1.5 inline-flex items-center text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-md align-middle">
        {dateLabel}
      </span>
    </>
  );
}
