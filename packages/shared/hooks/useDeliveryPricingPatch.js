import { useState, useEffect, useRef } from 'react';
import useDebouncedValue from './useDebouncedValue.js';

/**
 * Bridges DeliveryPricingFields' per-keystroke onChange to a host's
 * persist-on-settle convention — matching the InlineEdit/onBlur pattern
 * every delivery-fee editor in this codebase already uses. Prevents the
 * class of bug a phase review found in this feature: wiring onChange
 * straight to an immediate PATCH turns typing a fee into a PATCH per
 * keystroke, an audit row per keystroke, and (combined with
 * DeliveryPricingFields' own mount-time quote) an unsolicited overwrite
 * the moment a panel opens.
 *
 * Buffers edits locally (instant display, no network), debounces, and only
 * calls onCommit with a WIRE-shaped patch once the buffered value has
 * actually settled and differs from what was last committed.
 *
 * @param {{fee: number|null, cost: number|null, distanceKm?: number|null, band?: object|null}} storedValue
 *   The delivery's current wire-format pricing state (e.g. from `o.delivery`).
 * @param {function} onCommit  (wireFields: object) => void
 * @param {number} [delayMs=800]
 * @returns {{ value: {fee: number|null, cost: number|null}, onChange: (patch) => void }}
 *   Pass `value`/`onChange` straight through to `DeliveryPricingFields`.
 */
export default function useDeliveryPricingPatch(storedValue, onCommit, delayMs = 800) {
  const normalise = (v) => ({
    fee: v.fee ?? null,
    cost: v.cost ?? null,
    distanceKm: v.distanceKm ?? null,
    band: v.band ?? null,
  });

  const [pending, setPending] = useState(() => normalise(storedValue));
  const committedRef = useRef(pending);
  const debounced = useDebouncedValue(pending, delayMs);

  // Re-sync the local buffer when the host's stored value changes from
  // elsewhere (a fresh fetch after some other edit) — never from our own commits.
  //
  // `band` is compared by JSON.stringify, not raw reference: a caller that
  // builds the storedValue object inline (e.g. `{ ..., band: o.delivery?.[...] }`
  // constructed fresh on every render) gets a NEW `band` object reference
  // each render even when its content is unchanged. Depending on that
  // reference directly means this effect never stabilizes — it re-fires
  // every render, calls setPending with a new object, which triggers
  // another render, forever. Content comparison is what "changed
  // externally" actually means here.
  useEffect(() => {
    const next = normalise(storedValue);
    setPending(next);
    committedRef.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedValue.fee, storedValue.cost, storedValue.distanceKm, JSON.stringify(storedValue.band)]);

  useEffect(() => {
    const prev = committedRef.current;
    const wireFields = {};
    if (debounced.fee !== prev.fee) wireFields['Delivery Fee'] = debounced.fee;
    if (debounced.cost !== prev.cost) wireFields['Driver Payout'] = debounced.cost;
    if (debounced.distanceKm !== prev.distanceKm) wireFields['Distance (km)'] = debounced.distanceKm;
    if (JSON.stringify(debounced.band) !== JSON.stringify(prev.band)) wireFields['Distance Band'] = debounced.band;

    if (Object.keys(wireFields).length === 0) return;

    committedRef.current = debounced;
    onCommit(wireFields);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  function onChange(patch) {
    setPending(prev => ({ ...prev, ...patch }));
  }

  return { value: { fee: pending.fee, cost: pending.cost }, onChange };
}
