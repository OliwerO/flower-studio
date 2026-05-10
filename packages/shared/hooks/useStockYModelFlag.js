// useStockYModelFlag — reads the STOCK_Y_MODEL feature flag from /settings.
//
// Uses cachedGet so the value is fetched at most once per 30s; all callers in
// the same session share the in-flight deduplication built into cachedGet.
// Returns false until the server response arrives (safe conservative default —
// the legacy picker stays visible until the flag is confirmed on).

import { useState, useEffect } from 'react';
import { cachedGet } from '../api/client.js';

const SETTINGS_TTL_MS = 30_000; // 30 s — flag changes rarely

/**
 * Returns true when the backend has STOCK_Y_MODEL enabled, false otherwise.
 * Suspends the decision at `false` while the fetch is in-flight so the flag-off
 * path (legacy BatchPickerModal) is always the safe default.
 *
 * @returns {boolean}
 */
export default function useStockYModelFlag() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    cachedGet('/settings', {}, { ttlMs: SETTINGS_TTL_MS })
      .then(res => {
        if (!cancelled) setEnabled(Boolean(res.data?.stockYModelEnabled));
      })
      .catch(() => { /* conservative default: false */ });
    return () => { cancelled = true; };
  }, []);

  return enabled;
}
