// useExplorerQuery — data hook for the Explorer grid (ADR-0010).
//
// Loads the data-driven schema descriptor once (GET /explorer/schema, cached)
// and runs validated specs on demand (POST /explorer/query). Both endpoints are
// owner-only; the whole Dashboard is already owner-gated, so no extra guard
// here. A monotonic request id drops stale responses so a slow earlier query
// can't overwrite a newer result.

import { useState, useEffect, useCallback, useRef } from 'react';
import client, { cachedGet } from '../api/client.js';

const SCHEMA_TTL_MS = 60_000; // the allow-list changes only on deploy

export default function useExplorerQuery() {
  const [schema, setSchema] = useState(null);
  const [schemaLoading, setSchemaLoading] = useState(true);
  const [schemaError, setSchemaError] = useState(null);

  const [result, setResult] = useState({ rows: [], matchedCount: 0, truncated: false, spec: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setSchemaLoading(true);
    cachedGet('/explorer/schema', {}, { ttlMs: SCHEMA_TTL_MS })
      .then((res) => {
        if (cancelled) return;
        setSchema(res.data);
        setSchemaError(null);
      })
      .catch((err) => {
        if (!cancelled) setSchemaError(err.response?.data?.error || 'Failed to load Explorer schema');
      })
      .finally(() => {
        if (!cancelled) setSchemaLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const run = useCallback(async (spec) => {
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const { data } = await client.post('/explorer/query', spec);
      if (myReq !== reqIdRef.current) return; // a newer query superseded this one
      const rows = data.rows || [];
      setResult({
        rows,
        // aggregate/groupBy results carry no matchedCount — fall back to row count
        matchedCount: typeof data.matchedCount === 'number' ? data.matchedCount : rows.length,
        truncated: !!data.truncated,
        spec: data.spec || spec,
      });
    } catch (err) {
      if (myReq !== reqIdRef.current) return;
      setError(err.response?.data?.error || 'Query failed');
      setResult({ rows: [], matchedCount: 0, truncated: false, spec });
    } finally {
      if (myReq === reqIdRef.current) setLoading(false);
    }
  }, []);

  return {
    schema,
    schemaLoading,
    schemaError,
    rows: result.rows,
    matchedCount: result.matchedCount,
    truncated: result.truncated,
    lastSpec: result.spec,
    loading,
    error,
    run,
  };
}
