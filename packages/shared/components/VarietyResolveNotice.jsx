import { useEffect, useMemo } from 'react';
import { resolveVariety, normaliseSize } from '../utils/varietyIdentity.js';
import { varietyDisplayName } from '../utils/varietyKey.js';

/**
 * VarietyResolveNotice — "is this a flower you already have?", for the two
 * receive forms (#604).
 *
 * Receiving a delivery is the screen used most often and under the most time
 * pressure, and its entire identity check used to be "the name is not empty":
 * Type was optional and silently fell back to whatever was typed as the name,
 * so `Pink Peonies` produced a flower whose Type is literally `Pink Peonies`.
 * That is #562 reproduced exactly — prod carries five such cards.
 *
 * The server-side door (#603) stops the duplicate being *stored*. This is the
 * screen's half of the same rule, and it matters because the confirmed-create
 * path sends `newVariety: true`, which deliberately bypasses that door:
 *
 *   - **linked** — the 4-tuple resolves to a flower she has (a dated delivery
 *     counts; prompting "create new?" while she holds the stems is a lie that
 *     trains her to click through). Name it, and let her save.
 *   - **new** — nothing matches. Say exactly what would be created and require
 *     an explicit confirm; changing the identity withdraws it again.
 *   - **none** — no Type yet. Nothing can be decided; the host disables save.
 *
 * Deliberate sibling of the badge vocabulary in `BouquetFlowerForm`, so the
 * three states read the same wherever a flower can be created.
 *
 * Props:
 *   form              { typeName, colour, sizeCm, cultivar }
 *   stockItems        loaded stock (the catalogue to resolve against)
 *   confirmed         host-owned "she confirmed a new Variety" flag
 *   onConfirmedChange (next: boolean) => void
 *   onResolve         optional ({state, match, resolvedName}) => void — the
 *                     host posts `resolvedName` and sends `newVariety` only
 *                     when state === 'new' AND confirmed
 *   t                 translations
 */
export default function VarietyResolveNotice({
  form = {},
  stockItems = [],
  confirmed = false,
  onConfirmedChange,
  onResolve,
  t = {},
}) {
  const tx = (key, fallback) => t[key] ?? fallback;

  const attrs = useMemo(() => ({
    typeName: form.typeName ?? '',
    colour:   form.colour ?? '',
    sizeCm:   form.sizeCm ?? '',
    cultivar: form.cultivar ?? '',
  }), [form.typeName, form.colour, form.sizeCm, form.cultivar]);

  const hasType = String(attrs.typeName).trim() !== '';
  const resolution = useMemo(
    () => resolveVariety(stockItems, attrs),
    [stockItems, attrs],
  );

  const state = !hasType ? 'none'
    : (resolution.match || resolution.reason === 'dated-only') ? 'linked'
      : 'new';

  // The name is always DERIVED — a matched card keeps its own, otherwise it is
  // composed from the classification. A name and a 4-tuple that disagree is
  // the #558 divergence class.
  const resolvedName = resolution.match
    ? (resolution.match['Display Name'] || '')
    : varietyDisplayName({
        type_name: attrs.typeName,
        colour:    attrs.colour,
        size_cm:   normaliseSize(attrs.sizeCm),
        cultivar:  attrs.cultivar,
      });

  useEffect(() => {
    onResolve?.({ state, match: resolution.match ?? null, resolvedName });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, resolution.match, resolvedName]);

  // A confirmation belongs to one identity. Editing any attribute after
  // confirming must put the question back, or she creates a flower she never
  // actually looked at.
  useEffect(() => {
    if (confirmed && state !== 'new') onConfirmedChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  useEffect(() => {
    if (confirmed) onConfirmedChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attrs]);

  const badge = state === 'linked'
    ? { text: tx('varietyLinked', 'from stock'), cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
    : state === 'new'
      ? { text: tx('newVariety', 'New variety'), cls: 'bg-amber-50 text-amber-700 border-amber-200' }
      : { text: tx('varietyNone', 'not chosen'), cls: 'bg-gray-100 text-gray-500 border-gray-200' };

  // With nothing loaded, EVERY flower reads as new — a failed /stock fetch must
  // not become a licence to bypass the server's duplicate guard.
  const mayConfirm = state === 'new' && !confirmed && stockItems.length > 0;

  return (
    <div className="space-y-1.5" data-testid="variety-resolve-notice">
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded-full border ${badge.cls}`}
          data-testid="vrn-badge"
        >
          {badge.text}
        </span>
        {state !== 'none' && resolvedName && (
          <span className="text-sm text-gray-700" data-testid="vrn-resolved">{resolvedName}</span>
        )}
      </div>

      {state === 'none' && (
        <p className="text-xs text-gray-500" data-testid="vrn-hint">
          {tx('varietyTypeRequired', 'Choose a type')}
        </p>
      )}

      {mayConfirm && (
        <div
          className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 space-y-1.5"
          data-testid="vrn-prompt"
        >
          <p className="text-xs text-amber-800">
            {tx('newVarietyConfirm', 'No such flower yet. Create it?')}
            {resolvedName ? ` — ${resolvedName}` : ''}
          </p>
          <button
            type="button"
            className="text-xs font-medium px-2 py-1 rounded-md bg-amber-600 text-white"
            data-testid="vrn-confirm"
            onClick={() => onConfirmedChange?.(true)}
          >
            {tx('newVarietyCreate', 'Create new')}
          </button>
        </div>
      )}

      {state === 'new' && confirmed && (
        <p className="text-xs text-amber-700" data-testid="vrn-confirmed">
          {tx('newVarietyCreate', 'Create new')} · {resolvedName}
        </p>
      )}
    </div>
  );
}
