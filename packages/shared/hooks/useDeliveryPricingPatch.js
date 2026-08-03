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

  const normalised = normalise(storedValue);
  const [pending, setPending] = useState(normalised);
  const [prevStored, setPrevStored] = useState(normalised);
  const committedRef = useRef(normalised);

  // "Adjust state during render" (React's documented pattern for storing
  // information from previous renders) instead of syncing via useEffect.
  // Why this matters here specifically: OrderDetailPanel fetches `order`
  // async, so `storedValue` starts all-null and only becomes real once the
  // fetch resolves. An effect-based resync runs one render/commit AFTER
  // that change — but DeliveryPricingFields mounts for the FIRST time on
  // THAT SAME render (its `isDelivery && o.delivery` gate just turned
  // true), and it seeds its own mount-time quote-guard from `value` via a
  // useRef initializer, which only ever runs once. If this hook's `value`
  // is still the stale all-null `pending` on that render (because the
  // resync effect hasn't run yet — effects always run after render), the
  // child permanently seeds wrong, its quote effect fires, and a fabricated
  // cost silently overwrites the real stored value once the debounce
  // settles. Comparing storedValue against `prevStored` inline in the
  // render body and calling setState synchronously lets React abort this
  // render and restart it with corrected state BEFORE committing anything
  // or running any child's first render — so DeliveryPricingFields never
  // observes a stale value in the first place. A useLayoutEffect would NOT
  // fix this: layout effects still run strictly after render.
  const changed =
    normalised.fee !== prevStored.fee ||
    normalised.cost !== prevStored.cost ||
    normalised.distanceKm !== prevStored.distanceKm ||
    JSON.stringify(normalised.band) !== JSON.stringify(prevStored.band);

  if (changed) {
    setPending(normalised);
    setPrevStored(normalised);
    committedRef.current = normalised;
  }

  const debounced = useDebouncedValue(pending, delayMs);

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
