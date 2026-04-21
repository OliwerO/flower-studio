// Phone helpers shared across florist / delivery / dashboard apps.
// All three apps want consistent tel: link handling and null-safe
// formatting — centralise it so a formatting tweak touches one file,
// not four.

export function cleanPhone(raw) {
  if (!raw) return '';
  return String(raw).replace(/\s+/g, '');
}

export function telHref(raw) {
  const p = cleanPhone(raw);
  return p ? `tel:${p}` : null;
}
