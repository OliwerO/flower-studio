// Async-job wrapper around runPush().
//
// Why this exists: runPush() takes 30–80s to talk to Wix, but the request
// path the UI sees is `browser → Vercel rewrite → Railway → backend`, and
// the Vercel edge proxy aborts long-running rewrites before the backend
// finishes. The UI was reporting "sync failed" toasts on successful
// backend runs (the deactivation HAD landed on Wix; the owner just never
// saw confirmation). This module decouples UI feedback from request
// duration: POST /products/push starts a job and returns a jobId; the
// frontend polls GET /products/push/status/:id until the job completes
// and renders an owner-friendly progress log along the way.
//
// Single-flight by design — a second push while one is running returns
// the existing jobId. Wix can't honor two concurrent pushes against the
// same site cleanly (they'd race on category membership and inventory
// state); funneling through one job avoids that and matches what the
// owner expects when she clicks twice in a row.

import { randomUUID } from 'crypto';
import { runPush } from './wixProductSync.js';

const JOB_TTL_MS = 60 * 60 * 1000;   // keep finished jobs queryable for 1h
const MAX_LOG_ENTRIES = 500;          // cap per-job log to avoid runaway memory

const jobs = new Map();
let activeJobId = null;

function pruneStale() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (job.status !== 'running' && job.finishedAt && job.finishedAt < cutoff) {
      jobs.delete(id);
    }
  }
}

/**
 * Start a push job (or return the in-flight one if a push is already running).
 * Resolves immediately with the jobId — the actual Wix work runs in the
 * background; poll {@link getJob} for status.
 */
export function startPushJob() {
  pruneStale();

  if (activeJobId) {
    const existing = jobs.get(activeJobId);
    if (existing && existing.status === 'running') {
      return { jobId: activeJobId, alreadyRunning: true };
    }
  }

  const jobId = randomUUID();
  const job = {
    id: jobId,
    status: 'running',
    startedAt: Date.now(),
    finishedAt: null,
    log: [],
    result: null,
    error: null,
  };
  jobs.set(jobId, job);
  activeJobId = jobId;

  const onProgress = (entry) => {
    if (job.log.length >= MAX_LOG_ENTRIES) return;
    job.log.push({ at: Date.now(), ...entry });
  };

  // Fire-and-forget. The promise's resolution is captured into job state;
  // the route handlers read job state, not this promise.
  runPush(onProgress)
    .then(stats => {
      job.status = stats.errors?.length ? 'partial' : 'done';
      job.finishedAt = Date.now();
      job.result = stats;
    })
    .catch(err => {
      job.status = 'failed';
      job.finishedAt = Date.now();
      job.error = err?.message || String(err);
      job.log.push({ at: Date.now(), kind: 'item', level: 'error', message: `Критическая ошибка: ${job.error}` });
    })
    .finally(() => {
      if (activeJobId === jobId) activeJobId = null;
    });

  return { jobId, alreadyRunning: false };
}

/**
 * @returns {object|null} Job state snapshot, or null if no job with that id.
 */
export function getJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    log: job.log,
    result: job.result,
    error: job.error,
  };
}

// Test-only — reset state between integration test runs.
export function _resetForTests() {
  jobs.clear();
  activeJobId = null;
}
