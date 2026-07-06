// Category: SAFE — read-only log sweep; files GitHub issues for new error signatures
//
// Daily watchdog over two Railway log streams:
//
//   1. PRIMARY — the `flower-studio-backend` service. This is app-side
//      Node/Express code, and every error path in this codebase logs via
//      `console.error('[TAG] description:', err)` (see backend/src/index.js
//      `[FATAL] Uncaught exception:` / `[FATAL] Unhandled promise rejection:`,
//      and dozens of `[XXX] ... failed:` / `[XXX] ... error:` call sites
//      across routes/services). A real app bug shows up here.
//
//   2. SECONDARY — the `Postgres` service, filtered to CONSTRAINT
//      VIOLATIONS ONLY (`violates unique constraint`, `violates not-null
//      constraint`, `violates foreign key constraint`). These indicate a
//      real write-path bug regardless of which client issued the query.
//
//      IMPORTANT ATTRIBUTION CAVEAT: the Postgres service log also
//      captures every ad-hoc read-only query run by Claude sessions
//      against the `claude_ro` role while diagnosing production issues
//      (per CLAUDE.md's "Postgres issues" guidance). Generic errors like
//      `column "x" does not exist`, `operator does not exist: ...`, and
//      `function ... does not exist` are almost always typos in those
//      throwaway exploration queries, NOT app bugs — the app's own SQL is
//      static and already passed CI/tests, so it doesn't hit "column does
//      not exist" in production. We deliberately EXCLUDE those classes
//      from the Postgres sweep to avoid filing issues about our own
//      debugging queries. Only genuine data-integrity violations
//      (constraint errors) are swept from the Postgres stream.
//
// Extracted lines are normalized into a stable "signature" (timestamps,
// PIDs, `at character N` offsets, and variable quoted literal values
// stripped out — object names like `column "sell_price"` are kept), then
// diffed against the known-signature ledger
// (backend/scripts/prod-error-signatures.json). One GitHub issue is filed
// per genuinely NEW signature; re-runs are idempotent because the ledger
// is appended to after filing.
//
// Never touches prod data: it only reads `railway logs` output (or
// `--input` files for tests) and calls `gh issue create`.
//
// Usage:
//   node backend/scripts/prod-error-sweep.js                        # live sweep, files issues
//   node backend/scripts/prod-error-sweep.js --dry-run               # report only, no issues filed, ledger untouched
//   node backend/scripts/prod-error-sweep.js --input-backend f.log --input-postgres g.log   # file-driven, for tests
//   node backend/scripts/prod-error-sweep.js --tail 2000              # override --tail count passed to `railway logs`

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SIGNATURES_PATH = path.join(__dirname, 'prod-error-signatures.json');

export const BACKEND_SERVICE = 'flower-studio-backend';
export const POSTGRES_SERVICE = 'Postgres';

// ── Backend stream (app-side) ──
// Every error path in this codebase logs via console.error with a
// bracket tag ([FATAL], [WEBHOOK], [STOCK-ORDER], etc.) or, less often,
// a bare "... failed"/"... error" message (see backend/src/routes/stock.js
// `stock usage: loss log fetch failed`). We treat any line containing
// "error" or "failed" (case-insensitive) as a candidate, then apply the
// ignore list below.
const BACKEND_ERROR_PATTERN = /\berror\b|\bfailed\b|\[FATAL\]/i;

// ── Postgres stream (constraint violations only) ──
// See the attribution caveat above: we ONLY sweep genuine data-integrity
// violations from Postgres logs, never generic "does not exist" errors,
// because those are overwhelmingly ad-hoc claude_ro exploration queries.
const POSTGRES_CONSTRAINT_PATTERN =
  /violates (unique constraint|not-null constraint|foreign key constraint|check constraint)/i;

// Lines that look like errors but are routine noise — never surfaced.
const IGNORE_PATTERNS = [
  /SSL error: unexpected eof while reading/i,
  /could not receive data from client: Connection reset by peer/i,
];

// Object-noun keywords that precede a Postgres identifier we want to KEEP
// in the signature (e.g. column "sell_price", constraint "foo_idx").
// Quoted substrings NOT preceded by one of these are treated as variable
// literal values and collapsed to a placeholder.
const OBJECT_KEYWORDS =
  /\b(column|relation|constraint|table|function|operator|role|schema|type|index|sequence|database|extension|trigger|view|policy)\s+$/i;

/**
 * Extract app-side error lines from the backend service log blob.
 * @param {string} rawLog
 * @returns {string[]}
 */
export function extractBackendErrorLines(rawLog) {
  if (!rawLog) return [];
  return rawLog
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => BACKEND_ERROR_PATTERN.test(l))
    .filter((l) => !IGNORE_PATTERNS.some((re) => re.test(l)));
}

/**
 * Extract constraint-violation lines from the Postgres service log blob.
 * Deliberately excludes generic "does not exist" errors — see header.
 * @param {string} rawLog
 * @returns {string[]}
 */
export function extractPostgresConstraintLines(rawLog) {
  if (!rawLog) return [];
  return rawLog
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => /ERROR/i.test(l))
    .filter((l) => !IGNORE_PATTERNS.some((re) => re.test(l)))
    .filter((l) => POSTGRES_CONSTRAINT_PATTERN.test(l));
}

/**
 * Backward/general-purpose helper: extract lines matching /ERROR/i from a
 * raw log blob, excluding noise. Used internally by
 * extractPostgresConstraintLines; also exported for tests that want the
 * unfiltered ERROR-line extraction step in isolation.
 * @param {string} rawLog
 * @returns {string[]}
 */
export function extractErrorLines(rawLog) {
  if (!rawLog) return [];
  return rawLog
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => /ERROR/i.test(l))
    .filter((l) => !IGNORE_PATTERNS.some((re) => re.test(l)));
}

/**
 * Normalize a raw log line to a stable signature: strip timestamps, PIDs,
 * "at character N" offsets, and variable quoted literal values — while
 * keeping the error class + quoted object names (column/relation/constraint/...).
 * @param {string} line
 * @returns {string}
 */
export function normalizeSignature(line) {
  let s = line;

  // Strip leading Postgres-style timestamp: "2026-07-06 14:15:34.353 UTC "
  s = s.replace(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?\s*(UTC)?\s*/i, '');

  // Strip leading generic bracketed ISO timestamp, e.g. "[2026-07-06T14:15:34.353Z]"
  s = s.replace(/^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z?\]\s*/i, '');

  // Strip PID markers like "[97131]" (Postgres log_line_prefix).
  s = s.replace(/\[\d+\]\s*/g, '');

  // Strip "at character N" offsets (with or without trailing punctuation).
  s = s.replace(/\s*at character \d+/gi, '');

  // Collapse quoted literal values that are NOT object names into a placeholder.
  s = s.replace(/(\S+\s+)?(["'])((?:\\.|(?!\2).)*)\2/g, (match, before, quote, _inner) => {
    if (before && OBJECT_KEYWORDS.test(before)) {
      // Keep object names verbatim (e.g. column "sell_price").
      return match;
    }
    return `${before || ''}${quote}?${quote}`;
  });

  // Collapse repeated whitespace.
  s = s.replace(/\s+/g, ' ').trim();

  return s;
}

/**
 * Group raw error lines by their normalized signature.
 * @param {string[]} lines
 * @param {string} [source] optional tag recorded on each group (e.g. "backend" / "postgres")
 * @returns {Map<string, { signature: string, lines: string[], count: number, source?: string }>}
 */
export function groupBySignature(lines, source) {
  const groups = new Map();
  for (const line of lines) {
    const signature = normalizeSignature(line);
    if (!groups.has(signature)) {
      groups.set(signature, { signature, lines: [], count: 0, source });
    }
    const g = groups.get(signature);
    g.lines.push(line);
    g.count += 1;
  }
  return groups;
}

/**
 * Merge multiple signature-group maps (e.g. backend + postgres) into one.
 * @param {Array<Map<string, {signature: string, lines: string[], count: number, source?: string}>>} groupMaps
 * @returns {Map<string, {signature: string, lines: string[], count: number, source?: string}>}
 */
export function mergeGroups(groupMaps) {
  const merged = new Map();
  for (const groups of groupMaps) {
    for (const g of groups.values()) {
      if (!merged.has(g.signature)) {
        merged.set(g.signature, { signature: g.signature, lines: [], count: 0, source: g.source });
      }
      const m = merged.get(g.signature);
      m.lines.push(...g.lines);
      m.count += g.count;
    }
  }
  return merged;
}

/**
 * Extract a leading timestamp from a raw log line, if present.
 * @param {string} line
 * @returns {string|null}
 */
export function extractTimestamp(line) {
  const m = line.match(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?/);
  return m ? m[0] : null;
}

/**
 * Load the known-signature ledger from disk. Returns an empty set if the
 * file is missing (first run).
 * @param {string} [filePath]
 * @returns {Set<string>}
 */
export function loadKnownSignatures(filePath = SIGNATURES_PATH) {
  if (!existsSync(filePath)) return new Set();
  const raw = readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed) ? parsed : parsed.signatures || [];
  return new Set(list);
}

/**
 * Diff grouped signatures against the known ledger, returning only the
 * groups whose signature is NOT already known.
 * @param {Map<string, {signature: string}>} groups
 * @param {Set<string>} known
 * @returns {Array<{signature: string, lines: string[], count: number}>}
 */
export function diffNewSignatures(groups, known) {
  return Array.from(groups.values()).filter((g) => !known.has(g.signature));
}

/**
 * Persist an updated known-signature ledger to disk (sorted, deduped).
 * @param {Iterable<string>} signatures
 * @param {string} [filePath]
 */
export function saveKnownSignatures(signatures, filePath = SIGNATURES_PATH) {
  const sorted = Array.from(new Set(signatures)).sort();
  writeFileSync(filePath, JSON.stringify({ signatures: sorted }, null, 2) + '\n');
}

/**
 * Build the GitHub issue title + body for a new signature group.
 * @param {{signature: string, lines: string[], count: number, source?: string}} group
 * @returns {{ title: string, body: string }}
 */
export function buildIssueContent(group) {
  const title = `prod-error: ${group.signature}`;
  const timestamps = group.lines.map(extractTimestamp).filter(Boolean);
  const first = timestamps[0] || 'unknown';
  const last = timestamps[timestamps.length - 1] || 'unknown';
  const sampleLines = group.lines.slice(0, 10).join('\n');

  const body = [
    `**Signature:** \`${group.signature}\``,
    group.source ? `**Source:** ${group.source}` : null,
    '',
    `**Occurrences in this sweep:** ${group.count}`,
    `**First seen:** ${first}`,
    `**Last seen:** ${last}`,
    '',
    '**Raw sample lines:**',
    '```',
    sampleLines,
    '```',
    '',
    '_Filed automatically by `backend/scripts/prod-error-sweep.js` (SAFE, read-only log sweep)._',
  ]
    .filter((l) => l !== null)
    .join('\n');

  return { title, body };
}

/**
 * Pull raw logs for a given Railway service (or read from a file when
 * inputFile is supplied — used by tests so nothing ever shells out).
 * @param {{ service: string, inputFile?: string, tail?: number }} opts
 * @returns {string}
 */
export function fetchLogs({ service, inputFile, tail = 1000 } = {}) {
  if (inputFile) {
    if (!existsSync(inputFile)) return '';
    return readFileSync(inputFile, 'utf8');
  }
  return execFileSync('railway', ['logs', '-s', service, '--tail', String(tail)], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 50,
  });
}

/**
 * File a single GitHub issue for a new-signature group via `gh issue create`.
 * @param {{ title: string, body: string }} content
 */
export function fileGithubIssue({ title, body }) {
  execFileSync(
    'gh',
    ['issue', 'create', '--label', 'needs-triage', '--title', title, '--body', body],
    { encoding: 'utf8' }
  );
}

/**
 * Core sweep logic — pure aside from the injected IO functions, so tests
 * can drive it without shelling out or hitting GitHub.
 * @param {object} opts
 * @param {string} opts.backendLog raw log text from the backend service
 * @param {string} opts.postgresLog raw log text from the Postgres service
 * @param {Set<string>} opts.known
 * @param {boolean} opts.dryRun
 * @param {(content: {title: string, body: string}) => void} [opts.createIssue]
 * @param {(signatures: Iterable<string>) => void} [opts.persistSignatures]
 * @returns {{ newSignatures: Array<{signature: string, count: number}>, totalErrorLines: number }}
 */
export function runSweep({
  backendLog = '',
  postgresLog = '',
  known,
  dryRun,
  createIssue = fileGithubIssue,
  persistSignatures = saveKnownSignatures,
}) {
  const backendLines = extractBackendErrorLines(backendLog);
  const postgresLines = extractPostgresConstraintLines(postgresLog);

  const backendGroups = groupBySignature(backendLines, 'backend');
  const postgresGroups = groupBySignature(postgresLines, 'postgres');
  const groups = mergeGroups([backendGroups, postgresGroups]);

  const newGroups = diffNewSignatures(groups, known);

  for (const group of newGroups) {
    const content = buildIssueContent(group);
    console.log(`[prod-error-sweep] NEW signature (${group.count}x, ${group.source}): ${group.signature}`);
    if (!dryRun) {
      createIssue(content);
      known.add(group.signature);
    }
  }

  const totalErrorLines = backendLines.length + postgresLines.length;

  if (!dryRun && newGroups.length > 0) {
    persistSignatures(known);
  }

  if (newGroups.length === 0) {
    console.log(
      `[prod-error-sweep] 0 new signatures (${groups.size} known families seen, ${totalErrorLines} error lines total — ${backendLines.length} backend, ${postgresLines.length} postgres).`
    );
  } else if (dryRun) {
    console.log(`[prod-error-sweep] DRY RUN — would file ${newGroups.length} new issue(s). Ledger not written.`);
  } else {
    console.log(`[prod-error-sweep] Filed ${newGroups.length} new issue(s). Ledger updated.`);
  }

  return {
    newSignatures: newGroups.map((g) => ({ signature: g.signature, count: g.count })),
    totalErrorLines,
  };
}

function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  const backendInputIdx = argv.indexOf('--input-backend');
  const backendInputFile = backendInputIdx !== -1 ? argv[backendInputIdx + 1] : undefined;
  const postgresInputIdx = argv.indexOf('--input-postgres');
  const postgresInputFile = postgresInputIdx !== -1 ? argv[postgresInputIdx + 1] : undefined;
  // Legacy single --input flag: treat as the backend stream only.
  const legacyInputIdx = argv.indexOf('--input');
  const legacyInputFile = legacyInputIdx !== -1 ? argv[legacyInputIdx + 1] : undefined;
  const tailIdx = argv.indexOf('--tail');
  const tail = tailIdx !== -1 ? Number(argv[tailIdx + 1]) : 1000;
  return {
    dryRun,
    backendInputFile: backendInputFile || legacyInputFile,
    postgresInputFile,
    tail,
  };
}

async function main() {
  const { dryRun, backendInputFile, postgresInputFile, tail } = parseArgs(process.argv.slice(2));

  let backendLog, postgresLog;
  try {
    backendLog = fetchLogs({ service: BACKEND_SERVICE, inputFile: backendInputFile, tail });
    postgresLog = fetchLogs({ service: POSTGRES_SERVICE, inputFile: postgresInputFile, tail });
  } catch (err) {
    console.error('[prod-error-sweep] FAILED to fetch logs:', err.message);
    process.exitCode = 1;
    return;
  }

  const known = loadKnownSignatures();
  runSweep({ backendLog, postgresLog, known, dryRun });
}

// Only run the CLI side-effects when executed directly, not on import (tests).
const isCli = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isCli) {
  main().catch((err) => {
    console.error('[prod-error-sweep] FAILED:', err.message);
    process.exitCode = 1;
  });
}
