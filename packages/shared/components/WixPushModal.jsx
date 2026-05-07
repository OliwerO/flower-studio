import { useEffect, useRef, useState } from 'react';
import client from '../api/client.js';

// Inline SVG icons. Avoids pulling lucide-react into the shared package,
// which would require every consuming app (delivery doesn't ship lucide)
// to add it as a dep. This component is loaded by florist + dashboard, but
// shared's index.js re-export means the module graph reaches all apps.
const SvgBase = ({ children, className }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    {children}
  </svg>
);
const IconCheck = ({ className }) => (
  <SvgBase className={className}>
    <circle cx="12" cy="12" r="10" />
    <path d="M9 12l2 2 4-4" />
  </SvgBase>
);
const IconWarn = ({ className }) => (
  <SvgBase className={className}>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </SvgBase>
);
const IconError = ({ className }) => (
  <SvgBase className={className}>
    <circle cx="12" cy="12" r="10" />
    <line x1="15" y1="9" x2="9" y2="15" />
    <line x1="9" y1="9" x2="15" y2="15" />
  </SvgBase>
);
const IconSpin = ({ className }) => (
  <SvgBase className={className}>
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </SvgBase>
);
const IconX = ({ className }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const IconChevronUp = ({ className }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <polyline points="18 15 12 9 6 15" />
  </svg>
);

// Owner-facing progress UI for Wix push.
//
// Decoupled from the request lifecycle on purpose — POST /products/push
// returns a jobId immediately and the actual Wix work happens server-side
// for ~10–30s. The component polls /products/push/status/:jobId and renders
// progress.
//
// UX: a small non-blocking floating pill is shown while the job runs (and
// after it finishes until the user dismisses). Tapping the pill expands a
// detailed log sheet for owners who want to see exactly what happened. The
// pill stays out of the way during normal use — most pushes succeed silently
// and the toast on completion is enough.
//
// Props:
//   open         boolean        — when true, kick off a push and show pill
//   onClose      () => void     — close handler. Disabled while a job runs.
//   onComplete   (stats) => void — fires once after status flips to terminal

const POLL_INTERVAL_MS = 1500;

const STATUS_LABEL = {
  running: 'Syncing…',
  done:    'Done',
  partial: 'Done with warnings',
  failed:  'Failed',
};

const LEVEL_DOT = {
  info:  'bg-ios-blue',
  warn:  'bg-amber-500',
  error: 'bg-rose-500',
};

function formatTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function StatusIcon({ status }) {
  if (status === 'done')    return <IconCheck className="text-emerald-500" />;
  if (status === 'partial') return <IconWarn className="text-amber-500" />;
  if (status === 'failed')  return <IconError className="text-rose-500" />;
  return <IconSpin className="text-ios-blue animate-spin" />;
}

export default function WixPushModal({ open, onClose, onComplete }) {
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const completedRef = useRef(false);
  const jobIdRef = useRef(null);
  // Keep a stable ref to onComplete so the polling effect never needs it in
  // its dependency array. Without this, any parent re-render that recreates
  // the onComplete function (e.g. after setPushing(false)) causes the effect
  // to restart — starting a new push job immediately after the previous one
  // finishes, creating an infinite loop.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; });

  // Auto-scroll log to bottom on each new entry.
  const logEndRef = useRef(null);
  useEffect(() => {
    if (expanded && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [job?.log?.length, expanded]);

  // Start the job once when the component opens, then poll until it finishes.
  useEffect(() => {
    if (!open) return undefined;

    let cancelled = false;
    let timer = null;

    setJob(null);
    setError(null);
    setExpanded(false);
    completedRef.current = false;
    jobIdRef.current = null;

    async function start() {
      try {
        const { data } = await client.post('/products/push');
        if (cancelled) return;
        jobIdRef.current = data.jobId;
        poll();
      } catch (err) {
        if (cancelled) return;
        setError(err.response?.data?.error || err.message || 'Failed to start sync.');
      }
    }

    async function poll() {
      const id = jobIdRef.current;
      if (!id || cancelled) return;
      try {
        const { data } = await client.get(`/products/push/status/${id}`);
        if (cancelled) return;
        setJob(data);
        if (data.status === 'running') {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        } else if (!completedRef.current) {
          completedRef.current = true;
          if (onCompleteRef.current) {
            try { onCompleteRef.current(data.result); } catch { /* host can't break our cleanup */ }
          }
        }
      } catch (err) {
        if (cancelled) return;
        setError(err.response?.data?.error || err.message || 'Error polling status.');
        timer = setTimeout(poll, POLL_INTERVAL_MS * 2);
      }
    }

    start();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [open]); // onComplete intentionally omitted — accessed via onCompleteRef

  // Lock body scroll only while the detail sheet is expanded — the pill is
  // non-blocking and shouldn't trap the page.
  useEffect(() => {
    if (!open || !expanded) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open, expanded]);

  if (!open) return null;

  const status = job?.status || (error ? 'failed' : 'running');
  const isRunning = status === 'running';
  const canDismiss = !isRunning;

  // Compact pill summary line: counts when finished, generic status while running.
  let pillLine = STATUS_LABEL[status] || status;
  if (!isRunning && job?.result) {
    const r = job.result;
    const total = (r.pricesSynced || 0) + (r.stockSynced || 0)
                + (r.categoriesSynced || 0) + (r.descriptionsSynced || 0)
                + (r.translationsSynced || 0);
    pillLine = `${STATUS_LABEL[status]} · ${total} changes`;
  } else if (error) {
    pillLine = error;
  }

  return (
    <>
      {/* Floating pill — bottom-right on desktop, bottom-center on mobile. */}
      <div
        className="fixed z-40 bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-sm
                   pointer-events-none safe-area-bottom"
      >
        <div
          className="pointer-events-auto bg-white dark:bg-dark-card border border-ios-separator
                     dark:border-dark-separator rounded-2xl shadow-lg flex items-center gap-2 pl-3 pr-1 py-2"
        >
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="flex items-center gap-2 flex-1 min-w-0 text-left active-scale"
            aria-label="Open sync log"
          >
            <StatusIcon status={status} />
            <span className="flex-1 min-w-0 text-sm text-ios-label dark:text-dark-label truncate">
              {pillLine}
            </span>
            <IconChevronUp className="text-ios-tertiary shrink-0" />
          </button>
          {canDismiss && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-8 h-8 rounded-full flex items-center justify-center text-ios-tertiary
                         hover:bg-ios-fill dark:hover:bg-dark-fill"
            >
              <IconX />
            </button>
          )}
        </div>
      </div>

      {/* Expanded detail sheet — opens on tap. */}
      {expanded && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40"
            onClick={() => setExpanded(false)}
          />
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6 pointer-events-none"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wix-push-modal-title"
          >
            <div
              className="bg-white dark:bg-dark-card rounded-t-3xl sm:rounded-2xl shadow-2xl
                         w-full sm:max-w-2xl max-h-[90vh] sm:max-h-[80vh] flex flex-col
                         pointer-events-auto safe-area-bottom"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-ios-separator dark:border-dark-separator">
                <div className="flex items-center gap-2">
                  <StatusIcon status={status} />
                  <div>
                    <h2
                      id="wix-push-modal-title"
                      className="text-lg font-semibold text-ios-label dark:text-dark-label"
                    >
                      Wix sync
                    </h2>
                    <p className="text-sm text-ios-tertiary dark:text-dark-tertiary">
                      {STATUS_LABEL[status] || status}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  className="px-3 h-9 rounded-lg text-sm font-medium
                             text-ios-tertiary dark:text-dark-tertiary
                             hover:bg-ios-fill dark:hover:bg-dark-fill"
                >
                  Collapse
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-3">
                {error && !job && (
                  <div className="text-rose-600 dark:text-rose-400 text-sm">{error}</div>
                )}
                {job?.log?.length === 0 && isRunning && (
                  <div className="text-ios-tertiary dark:text-dark-tertiary text-sm">
                    Starting…
                  </div>
                )}
                <ul className="space-y-1.5">
                  {(job?.log || []).map((entry, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span
                        className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                          entry.kind === 'phase' ? 'bg-ios-tertiary dark:bg-dark-tertiary'
                          : entry.kind === 'done' ? 'bg-emerald-500'
                          : LEVEL_DOT[entry.level] || LEVEL_DOT.info
                        }`}
                      />
                      <span className="text-ios-tertiary dark:text-dark-tertiary tabular-nums w-16 flex-shrink-0">
                        {formatTime(entry.at)}
                      </span>
                      <span
                        className={
                          entry.level === 'error' ? 'text-rose-600 dark:text-rose-400'
                          : entry.level === 'warn' ? 'text-amber-700 dark:text-amber-400'
                          : entry.kind === 'phase' ? 'font-medium text-ios-label dark:text-dark-label'
                          : entry.kind === 'done' ? 'font-semibold text-emerald-700 dark:text-emerald-400'
                          : 'text-ios-secondary dark:text-dark-secondary'
                        }
                      >
                        {entry.message}
                      </span>
                    </li>
                  ))}
                </ul>
                <div ref={logEndRef} />
              </div>

              {!isRunning && job?.result && (
                <div className="px-5 py-3 border-t border-ios-separator dark:border-dark-separator bg-ios-fill/30 dark:bg-dark-fill/30">
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ios-secondary dark:text-dark-secondary">
                    <span>Prices: <strong className="text-ios-label dark:text-dark-label">{job.result.pricesSynced ?? 0}</strong></span>
                    <span>Stock: <strong className="text-ios-label dark:text-dark-label">{job.result.stockSynced ?? 0}</strong></span>
                    <span>Categories: <strong className="text-ios-label dark:text-dark-label">{job.result.categoriesSynced ?? 0}</strong></span>
                    <span>Descriptions: <strong className="text-ios-label dark:text-dark-label">{job.result.descriptionsSynced ?? 0}</strong></span>
                    <span>Translations: <strong className="text-ios-label dark:text-dark-label">{job.result.translationsSynced ?? 0}</strong></span>
                  </div>
                  {job.result.errors?.length > 0 && (
                    <div className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                      {job.result.errors.length} warning{job.result.errors.length === 1 ? '' : 's'} — see log above for details.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
