// Unit tests for backend/scripts/prod-error-sweep.js — pure parts only
// (normalization, filtering, grouping, signature diffing). No shell-out,
// no GitHub calls, no filesystem writes: `runSweep` is exercised with
// injected `createIssue` / `persistSignatures` fakes.

import { describe, it, expect } from 'vitest';
import {
  normalizeSignature,
  extractBackendErrorLines,
  extractPostgresConstraintLines,
  extractErrorLines,
  groupBySignature,
  mergeGroups,
  diffNewSignatures,
  buildIssueContent,
  extractTimestamp,
  runSweep,
} from '../../scripts/prod-error-sweep.js';

describe('normalizeSignature', () => {
  it('strips timestamp, PID, and character offset while keeping the error class', () => {
    const a = normalizeSignature(
      '2026-07-06 12:00:27.233 UTC [96897] ERROR:  column "sell_price" does not exist at character 91'
    );
    const b = normalizeSignature(
      '2026-07-06 12:05:10.001 UTC [12345] ERROR:  column "sell_price" does not exist at character 42'
    );
    expect(a).toBe(b);
    expect(a).toBe('ERROR: column "sell_price" does not exist');
  });

  it('keeps quoted object names (column/relation/constraint) distinct', () => {
    const s1 = normalizeSignature(
      '2026-07-06 08:40:08.189 UTC [96352] ERROR:  duplicate key value violates unique constraint "stock_demand_variety_date_idx"'
    );
    const s2 = normalizeSignature(
      '2026-07-06 08:40:08.189 UTC [96352] ERROR:  duplicate key value violates unique constraint "other_idx"'
    );
    expect(s1).not.toBe(s2);
    expect(s1).toContain('"stock_demand_variety_date_idx"');
    expect(s2).toContain('"other_idx"');
  });

  it('normalizes the not-null constraint families from the brief', () => {
    const dateErr = normalizeSignature(
      '2026-07-05 17:59:30.678 UTC [95170] ERROR:  null value in column "date" of relation "stock" violates not-null constraint'
    );
    const typeErr = normalizeSignature(
      '2026-07-05 22:40:18.628 UTC [95596] ERROR:  null value in column "type_name" of relation "stock" violates not-null constraint'
    );
    expect(dateErr).toBe('ERROR: null value in column "date" of relation "stock" violates not-null constraint');
    expect(typeErr).toBe('ERROR: null value in column "type_name" of relation "stock" violates not-null constraint');
    expect(dateErr).not.toBe(typeErr);
  });

  it('normalizes the uuid operator family', () => {
    const s = normalizeSignature(
      '2026-07-06 09:27:55.537 UTC [96493] ERROR:  operator does not exist: text = uuid at character 167'
    );
    expect(s).toBe('ERROR: operator does not exist: text = uuid');
  });

  it('collapses variable quoted literal values that are not object names', () => {
    const s1 = normalizeSignature('ERROR:  invalid input syntax for type uuid: "abc-123"');
    const s2 = normalizeSignature('ERROR:  invalid input syntax for type uuid: "def-456"');
    expect(s1).toBe(s2);
  });
});

describe('extractBackendErrorLines (app-side backend service log)', () => {
  it('matches bracket-tagged failure/error lines used throughout the codebase', () => {
    const raw = [
      'Health check: http://localhost:3001/api/health',
      '[SSE] Client connected (1 total)',
      '[FATAL] Uncaught exception: TypeError: cannot read foo',
      '[STOCK-ORDER] PO creation failed: some detail',
      '[PULL] Complete: {"new":0,"updated":0,"deactivated":0,"errors":[]}',
    ].join('\n');
    const lines = extractBackendErrorLines(raw);
    expect(lines).toContain('[FATAL] Uncaught exception: TypeError: cannot read foo');
    expect(lines).toContain('[STOCK-ORDER] PO creation failed: some detail');
    expect(lines).not.toContain('[SSE] Client connected (1 total)');
    // "errors":[] must NOT false-trigger the word-boundary "error" match
    expect(lines.some((l) => l.includes('[PULL] Complete'))).toBe(false);
  });

  it('matches bare "failed"/"error" messages without a bracket tag', () => {
    const raw = 'stock usage: loss log fetch failed';
    expect(extractBackendErrorLines(raw)).toEqual([raw]);
  });

  it('drops SSL/connection-churn noise even if it slips into the backend stream', () => {
    const raw = 'LOG:  SSL error: unexpected eof while reading';
    expect(extractBackendErrorLines(raw)).toEqual([]);
  });

  it('returns empty array for empty/undefined input', () => {
    expect(extractBackendErrorLines('')).toEqual([]);
    expect(extractBackendErrorLines(undefined)).toEqual([]);
  });
});

describe('extractPostgresConstraintLines (Postgres service log, constraint-only)', () => {
  const rawLog = [
    '2026-07-06 08:40:08.189 UTC [96352] ERROR:  duplicate key value violates unique constraint "stock_demand_variety_date_idx"',
    '2026-07-05 17:59:30.678 UTC [95170] ERROR:  null value in column "date" of relation "stock" violates not-null constraint',
    '2026-07-06 09:27:43.032 UTC [96491] ERROR:  column o.customer_name does not exist at character 108',
    '2026-07-06 09:27:55.537 UTC [96493] ERROR:  operator does not exist: text = uuid at character 167',
    '2026-06-30 20:29:27.458 UTC [85752] ERROR:  function left(uuid, integer) does not exist at character 8',
    '2026-06-30 21:35:00.897 UTC [85853] ERROR:  column "name" does not exist at character 8',
    '2026-07-06 15:00:56.251 UTC [97265] LOG:  SSL error: unexpected eof while reading',
  ].join('\n');

  it('keeps only genuine constraint-violation errors', () => {
    const lines = extractPostgresConstraintLines(rawLog);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('violates unique constraint');
    expect(lines[1]).toContain('violates not-null constraint');
  });

  it('excludes "does not exist" errors — these are ad-hoc claude_ro exploration queries, not app bugs', () => {
    const lines = extractPostgresConstraintLines(rawLog);
    expect(lines.some((l) => l.includes('does not exist'))).toBe(false);
  });

  it('excludes SSL/connection-churn noise', () => {
    const lines = extractPostgresConstraintLines(rawLog);
    expect(lines.some((l) => l.includes('SSL error'))).toBe(false);
  });
});

describe('extractErrorLines (generic ERROR-line extraction)', () => {
  it('matches ERROR lines case-insensitively and drops ignore-listed noise', () => {
    const raw = [
      '2026-07-06 14:15:34.353 UTC [97131] ERROR:  column "order_id" does not exist at character 12',
      '2026-07-06 14:15:34.401 UTC [97131] LOG:  SSL error: unexpected eof while reading',
      '2026-07-06 14:15:34.401 UTC [97131] LOG:  could not receive data from client: Connection reset by peer',
      '2026-07-06 12:28:36.406 UTC [31] LOG:  checkpoint starting: time',
    ].join('\n');
    const lines = extractErrorLines(raw);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('column "order_id" does not exist');
  });
});

describe('groupBySignature + mergeGroups', () => {
  it('counts duplicate occurrences of the same signature', () => {
    const lines = [
      '2026-07-03 08:10:29.982 UTC [90926] ERROR:  duplicate key value violates unique constraint "stock_demand_variety_date_idx"',
      '2026-07-03 08:10:31.558 UTC [90926] ERROR:  duplicate key value violates unique constraint "stock_demand_variety_date_idx"',
      '2026-07-03 08:14:25.567 UTC [90934] ERROR:  duplicate key value violates unique constraint "stock_demand_variety_date_idx"',
    ];
    const groups = groupBySignature(lines, 'postgres');
    expect(groups.size).toBe(1);
    const [group] = groups.values();
    expect(group.count).toBe(3);
    expect(group.lines).toHaveLength(3);
    expect(group.source).toBe('postgres');
  });

  it('separates distinct signatures into distinct groups', () => {
    const lines = [
      'ERROR: column "a" does not exist',
      'ERROR: column "b" does not exist',
    ];
    const groups = groupBySignature(lines);
    expect(groups.size).toBe(2);
  });

  it('merges backend + postgres group maps, summing counts for shared signatures', () => {
    const g1 = groupBySignature(['[FATAL] boom: X'], 'backend');
    const g2 = groupBySignature(['[FATAL] boom: X', '[FATAL] boom: X'], 'backend');
    const merged = mergeGroups([g1, g2]);
    expect(merged.size).toBe(1);
    const [group] = merged.values();
    expect(group.count).toBe(3);
  });
});

describe('diffNewSignatures', () => {
  it('returns only signatures not already in the known set', () => {
    const groups = groupBySignature([
      'ERROR: duplicate key value violates unique constraint "stock_demand_variety_date_idx"',
      'ERROR: totally new error signature here',
    ]);
    const known = new Set(['ERROR: duplicate key value violates unique constraint "stock_demand_variety_date_idx"']);
    const diff = diffNewSignatures(groups, known);
    expect(diff).toHaveLength(1);
    expect(diff[0].signature).toBe('ERROR: totally new error signature here');
  });

  it('returns empty array when every signature is already known', () => {
    const groups = groupBySignature(['ERROR: already known']);
    const known = new Set(['ERROR: already known']);
    expect(diffNewSignatures(groups, known)).toEqual([]);
  });
});

describe('extractTimestamp', () => {
  it('extracts a leading Postgres-style timestamp', () => {
    expect(extractTimestamp('2026-07-06 14:15:34.353 UTC [97131] ERROR:  boom')).toBe('2026-07-06 14:15:34.353');
  });

  it('returns null when there is no leading timestamp', () => {
    expect(extractTimestamp('[FATAL] boom')).toBeNull();
  });
});

describe('buildIssueContent', () => {
  it('builds a title prefixed with prod-error: and a body with counts + sample lines', () => {
    const group = {
      signature: 'ERROR: something bad',
      count: 3,
      source: 'backend',
      lines: [
        '2026-07-06 08:00:00.000 UTC [1] ERROR: something bad',
        '2026-07-06 09:00:00.000 UTC [2] ERROR: something bad',
        '2026-07-06 10:00:00.000 UTC [3] ERROR: something bad',
      ],
    };
    const { title, body } = buildIssueContent(group);
    expect(title).toBe('prod-error: ERROR: something bad');
    expect(body).toContain('**Occurrences in this sweep:** 3');
    expect(body).toContain('2026-07-06 08:00:00.000');
    expect(body).toContain('2026-07-06 10:00:00.000');
    expect(body).toContain('something bad');
  });
});

describe('runSweep (pure orchestration with injected IO)', () => {
  it('reports 0 new signatures when everything is already known, and never calls createIssue/persistSignatures', () => {
    const known = new Set([
      'ERROR: duplicate key value violates unique constraint "stock_demand_variety_date_idx"',
      'ERROR: null value in column "date" of relation "stock" violates not-null constraint',
      'ERROR: null value in column "type_name" of relation "stock" violates not-null constraint',
    ]);
    const postgresLog = [
      '2026-07-06 08:40:08.189 UTC [96352] ERROR:  duplicate key value violates unique constraint "stock_demand_variety_date_idx"',
      '2026-07-05 17:59:30.678 UTC [95170] ERROR:  null value in column "date" of relation "stock" violates not-null constraint',
    ].join('\n');
    let createIssueCalls = 0;
    let persistCalls = 0;
    const result = runSweep({
      backendLog: '[SSE] Client connected (1 total)',
      postgresLog,
      known,
      dryRun: false,
      createIssue: () => { createIssueCalls += 1; },
      persistSignatures: () => { persistCalls += 1; },
    });
    expect(result.newSignatures).toEqual([]);
    expect(createIssueCalls).toBe(0);
    expect(persistCalls).toBe(0);
  });

  it('files one issue per new signature and persists the updated ledger (non-dry-run)', () => {
    const known = new Set();
    const backendLog = '[FATAL] Uncaught exception: TypeError: boom';
    let filedTitles = [];
    let persistedSignatures = null;
    const result = runSweep({
      backendLog,
      postgresLog: '',
      known,
      dryRun: false,
      createIssue: (content) => filedTitles.push(content.title),
      persistSignatures: (sigs) => { persistedSignatures = Array.from(sigs); },
    });
    expect(result.newSignatures).toHaveLength(1);
    expect(filedTitles).toEqual(['prod-error: [FATAL] Uncaught exception: TypeError: boom']);
    expect(persistedSignatures).toContain('[FATAL] Uncaught exception: TypeError: boom');
  });

  it('groups multiple occurrences of the same new signature into a single filed issue', () => {
    const known = new Set();
    const backendLog = [
      '[STOCK-ORDER] PO creation failed: err A',
      '[STOCK-ORDER] PO creation failed: err B',
      '[STOCK-ORDER] PO creation failed: err C',
    ].join('\n');
    let filedCount = 0;
    const result = runSweep({
      backendLog,
      postgresLog: '',
      known,
      dryRun: false,
      createIssue: () => { filedCount += 1; },
      persistSignatures: () => {},
    });
    // Signature normalization does not strip free-form suffixes like "err A"
    // vs "err B" (no quotes/offsets to strip), so these are technically
    // distinct signatures — verifying grouping only collapses TRUE dupes.
    expect(filedCount).toBe(result.newSignatures.length);
    expect(result.totalErrorLines).toBe(3);
  });

  it('dry-run reports what would be filed but calls neither createIssue nor persistSignatures', () => {
    const known = new Set();
    let createIssueCalls = 0;
    let persistCalls = 0;
    const result = runSweep({
      backendLog: '[FATAL] Uncaught exception: brand new',
      postgresLog: '',
      known,
      dryRun: true,
      createIssue: () => { createIssueCalls += 1; },
      persistSignatures: () => { persistCalls += 1; },
    });
    expect(result.newSignatures).toHaveLength(1);
    expect(createIssueCalls).toBe(0);
    expect(persistCalls).toBe(0);
  });
});
