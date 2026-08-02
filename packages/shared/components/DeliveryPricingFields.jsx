import { useEffect, useRef } from 'react';
import useDebouncedValue from '../hooks/useDebouncedValue.js';

/**
 * Delivery Cost / Delivery Fee / Delivery Margin entry — the single place
 * this UI logic lives (issue #618 / ADR-0019). Mounted by both order wizards
 * and both order-detail panels; see CLAUDE.md's PoLineForm/BouquetFlowerForm
 * precedent for why this is one component instead of four divergent ones.
 *
 * Pure controlled component: reports every change via onChange(patch), never
 * persists anything itself. The host decides whether that patch lands in
 * local wizard state (submitted later) or fires an immediate PATCH — exactly
 * like Step3Details' own onChange already works.
 *
 * @param {string}   address         Current delivery address — triggers a debounced quote lookup.
 * @param {'Driver'|'Taxi'|'Florist'} deliveryMethod
 * @param {{fee: number|null, cost: number|null}} value
 * @param {function} onChange        (patch) => void
 * @param {object}   apiClient       axios-like: { post }
 * @param {object}   t               Translations.
 */
export default function DeliveryPricingFields({
  address,
  deliveryMethod = 'Driver',
  value,
  onChange,
  apiClient,
  t = {},
}) {
  const debouncedAddress = useDebouncedValue(address, 500);
  const lastQuoted = useRef(null);

  useEffect(() => {
    if (deliveryMethod === 'Florist') {
      // Reset so a later switch BACK to a non-Florist method is never mistaken
      // for "already quoted this combination" — without this, Driver -> Florist
      // -> Driver (same address) would skip the re-fetch and leave cost stuck
      // at the Florist-branch's 0.
      lastQuoted.current = null;
      onChange({ cost: 0, distanceKm: null, band: null });
      return;
    }
    if (!debouncedAddress) return;

    const requestKey = `${debouncedAddress}::${deliveryMethod}`;
    if (lastQuoted.current === requestKey) return;
    lastQuoted.current = requestKey;

    let cancelled = false;
    apiClient.post('/delivery-pricing/quote', { address: debouncedAddress, deliveryMethod })
      .then(res => {
        if (cancelled) return;
        onChange({ cost: res.data.cost, distanceKm: res.data.distanceKm, band: res.data.band });
      })
      .catch(() => { /* non-blocking by design — Owner fills cost in by hand */ });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedAddress, deliveryMethod]);

  const fee = value?.fee ?? null;
  const cost = value?.cost ?? null;
  const margin = Number(fee || 0) - Number(cost || 0);
  const belowCost = fee != null && cost != null && margin < 0;

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center gap-2">
        <span className="text-xs text-ios-tertiary">{t.deliveryCost}</span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            data-testid="delivery-cost-input"
            value={cost ?? ''}
            placeholder="—"
            onChange={e => {
              const v = e.target.value === '' ? null : Number(e.target.value);
              onChange({ cost: v, distanceKm: null, band: null });
            }}
            className="w-20 text-sm text-right text-ios-label bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 outline-none"
          />
          <span className="text-xs text-ios-tertiary">{t.zl}</span>
        </div>
      </div>

      <div className="flex justify-between items-center gap-2">
        <span className="text-xs text-ios-tertiary">{t.deliveryFee}</span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            data-testid="delivery-fee-input"
            value={fee ?? ''}
            placeholder="0"
            onChange={e => onChange({ fee: e.target.value === '' ? null : Number(e.target.value) })}
            className="w-20 text-sm text-right text-ios-label bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 outline-none"
          />
          <span className="text-xs text-ios-tertiary">{t.zl}</span>
        </div>
      </div>

      <div className="flex justify-between items-center gap-2">
        <span className="text-xs text-ios-tertiary">{t.deliveryMargin}</span>
        <span
          data-testid="delivery-margin"
          className={`text-sm font-medium ${margin >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}
        >
          {margin.toFixed(0)} {t.zl}
        </span>
      </div>

      {belowCost && (
        <p data-testid="delivery-fee-below-cost-warning" className="text-xs text-rose-600">
          {t.feeBelowCostWarning}
        </p>
      )}
    </div>
  );
}
