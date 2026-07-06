// Post-validation failures in queryRecordsHandler must log the FULL spec to
// the backend service log. Rationale (2026-07-06): PG-side Railway logs mix
// app queries with ad-hoc read-only client queries (claude_ro sessions), so a
// bare error message there is unattributable — an engine bug is only
// diagnosable if the backend log carries the failing spec itself.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the db so a validated spec still explodes at execution time —
// simulating the "spec passed validateSpec but the generated SQL failed"
// class of engine bug.
vi.mock('../db/index.js', () => ({
  db: {
    select: () => { throw new Error('operator does not exist: text = uuid'); },
  },
}));

const { queryRecordsHandler } = await import('../services/assistantTools/dataQueryPack.js');

describe('queryRecordsHandler post-validation error logging', () => {
  let errSpy;
  beforeEach(() => { errSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { errSpy.mockRestore(); });

  it('returns { error } and logs the failing spec verbatim', async () => {
    const spec = { entity: 'orders', limit: 5 };
    const result = await queryRecordsHandler(spec);

    // Clean tool-error shape — never a throw/500 to the caller.
    expect(result).toEqual({ error: 'operator does not exist: text = uuid' });

    // The backend log line carries the spec JSON for attribution.
    const call = errSpy.mock.calls.find(args =>
      String(args[0]).includes('post-validation failure'));
    expect(call).toBeTruthy();
    expect(call.join(' ')).toContain(JSON.stringify(spec));
  });

  it('does NOT log validation rejections (they return early, model-readable)', async () => {
    const result = await queryRecordsHandler({ entity: 'nope' });
    expect(result.error).toBeTruthy();
    const call = errSpy.mock.calls.find(args =>
      String(args[0]).includes('post-validation failure'));
    expect(call).toBeUndefined();
  });
});
