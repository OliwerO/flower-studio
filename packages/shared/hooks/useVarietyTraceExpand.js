// packages/shared/hooks/useVarietyTraceExpand.js
import { useCallback, useState } from 'react';

const EMPTY = { events: [], unaccountedStems: 0, drift: 0, loading: false, loaded: false };

/**
 * useVarietyTraceExpand — expand state for date-grouped stock cards.
 *
 * Opens ONE row at a time (by row id) and lazy-fetches that row's Variety
 * usage trace once per Variety key (cached). Reused by ShortfallSummary and
 * PendingArrivalsPanel so the open/fetch/cache machinery lives in one place.
 *
 * @param fetchVarietyUsage async (key) => { events, unaccountedStems }
 */
export function useVarietyTraceExpand(fetchVarietyUsage) {
  const [openId, setOpenId] = useState(null);
  const [cache, setCache] = useState(() => new Map()); // varietyKey → trace state

  const getTrace = useCallback(
    (key) => cache.get(key) ?? EMPTY,
    [cache],
  );

  const isOpen = useCallback((id) => openId === id, [openId]);

  const toggle = useCallback(
    (id, key) => {
      if (openId === id) {
        setOpenId(null);
        return;
      }
      setOpenId(id);
      // Lazy-fetch this Variety's trace once.
      setCache((prev) => {
        if (prev.has(key)) return prev; // cache hit — no refetch
        const next = new Map(prev);
        next.set(key, { events: [], unaccountedStems: 0, drift: 0, loading: true, loaded: false });
        return next;
      });
      if (!cache.has(key) && fetchVarietyUsage) {
        Promise.resolve(fetchVarietyUsage(key))
          .then((data) =>
            setCache((prev) =>
              new Map(prev).set(key, {
                events: data?.events ?? [],
                unaccountedStems: data?.unaccountedStems ?? 0,
                drift: data?.drift ?? 0,
                loading: false,
                loaded: true,
              }),
            ),
          )
          .catch(() =>
            setCache((prev) =>
              new Map(prev).set(key, { events: [], unaccountedStems: 0, drift: 0, loading: false, loaded: true }),
            ),
          );
      }
    },
    [openId, cache, fetchVarietyUsage],
  );

  return { openId, isOpen, toggle, getTrace };
}

export default useVarietyTraceExpand;
