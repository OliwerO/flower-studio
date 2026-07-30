/**
 * PoLineIdentity — read-only identity block for a LINKED Purchase Order line (#594).
 *
 * A PO line carries three identities that must never drift apart: the free-text
 * Flower Name, the Variety 4-tuple, and the Stock Item link. Different consumers
 * trust different ones — Pending Arrivals and the receive follow the LINK, while
 * the evaluation screen shows the NAME. In #558 they diverged silently: a line
 * named "Hydrangea White" was bound to the Hydrangea Blue card, and 10 White
 * stems were received into stock as Blue.
 *
 * #593 made identity immutable once a line is linked (changing the flower is a
 * REPLACE — remove the line, add a new one). This component is the matching UI:
 * it renders the identity read-only, and — crucially — surfaces the Variety the
 * receive will ACTUALLY resolve to, so a name/link divergence is visible before
 * the driver ever shops instead of after the stems are on the shelf.
 *
 * Rendered by BOTH PO editors (dashboard StockOrderPanel, florist
 * PurchaseOrderPage) so the two cannot drift — root CLAUDE.md parity rule.
 *
 * Props: line, stock (loaded stock list, to resolve the link), t.
 * Translation keys: receivesInto, changeFlowerHint.
 */
import { varietyDisplayName } from '../utils/varietyKey.js';

// Read a Variety 4-tuple off either wire shape (PascalCase from pgToResponse,
// snake_case from the Y-model grouped payload).
function readVariety(row) {
  if (!row) return null;
  const v = {
    type_name: row.Type ?? row.type_name ?? null,
    colour:    row.Colour ?? row.colour ?? null,
    size_cm:   row.Size ?? row.size_cm ?? null,
    cultivar:  row.Cultivar ?? row.cultivar ?? null,
  };
  return v.type_name || v.colour || v.size_cm || v.cultivar ? v : null;
}

export default function PoLineIdentity({ line, stock = [], t = {} }) {
  const linkedId = Array.isArray(line?.['Stock Item']) ? line['Stock Item'][0] : null;
  const card = linkedId
    ? (stock || []).find((s) => s.id === linkedId || s._pgId === linkedId) ?? null
    : null;

  const name = line?.['Flower Name'] || '';

  // The receive resolves through the LINK, so the card's Variety is the truth
  // to display. Fall back to the line's own attrs for legacy attr-less cards.
  const variety = readVariety(card) ?? readVariety(line);
  const target = variety ? varietyDisplayName(variety) : (card?.['Display Name'] || '');

  // Compare loosely — a name that merely differs in case/spacing is not a
  // divergence worth alarming about; a different flower is.
  const squash = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const mismatch = !!target && !!name && squash(target) !== squash(name);

  return (
    <div data-testid="po-line-identity" className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span
          data-testid="po-line-identity-name"
          className="text-sm font-semibold text-gray-900 break-words"
        >
          {name || '—'}
        </span>
        {mismatch && (
          <span
            data-testid="po-line-identity-mismatch"
            title={t.identityMismatchHint ?? undefined}
            className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 whitespace-nowrap"
          >
            ⚠
          </span>
        )}
      </div>

      {target && (
        <div
          data-testid="po-line-receives-into"
          className={`mt-0.5 text-[11px] ${mismatch ? 'text-amber-700 font-medium' : 'text-gray-500'}`}
        >
          {t.receivesInto ?? 'receives into'}: <span className="tabular-nums">{target}</span>
        </div>
      )}

      <div data-testid="po-line-change-hint" className="mt-0.5 text-[10px] text-gray-400">
        {t.changeFlowerHint ?? 'To change the flower, remove this line and add a new one'}
      </div>
    </div>
  );
}
