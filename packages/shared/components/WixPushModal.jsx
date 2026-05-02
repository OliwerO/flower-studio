import { useEffect, useRef, useState } from 'react';
import client from '../api/client.js';

// Owner-facing progress modal for Wix push.
//
// Decoupled from the request lifecycle on purpose — POST /products/push
// returns a jobId immediately and the actual Wix work happens server-side
// for ~10–30s. The modal polls /products/push/status/:jobId and renders
// each owner-friendly Russian log entry as the backend produces it. Pre-
// async, the UI was sitting on a single 80s HTTP request which the Vercel
// edge proxy aborted, so the toast lied about failure on every push.
//
// Props:
//   open         boolean        — when true, kick off a push and show modal
//   onClose      () => void     — close handler. Disabled while a job runs.
//   onComplete   (stats) => void — optional; fires once after status flips
//                                  to done/partial/failed. Use it to reload
//                                  whatever view the host page renders.

const POLL_INTERVAL_MS = 1500;

const STATUS_LABEL = {
  running: 'Идёт синхронизация...',
  done:    'Готово',
  partial: 'Готово с предупреждениями',
  failed:  'Ошибка',
};

const STATUS_COLOR = {
  running: 'text-ios-blue',
  done:    'text-emerald-600 dark:text-emerald-400',
  partial: 'text-amber-600 dark:text-amber-400',
  failed:  'text-rose-600 dark:text-rose-400',
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

export default function WixPushModal({ open, onClose, onComplete }) {
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const completedRef = useRef(false);
  const jobIdRef = useRef(null);

  // Auto-scroll log to bottom on each new entry.
  const logEndRef = useRef(null);
  useEffect(() => {
    if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [job?.log?.length]);

  // Start the job once when the modal opens, then poll until it finishes.
  useEffect(() => {
    if (!open) return undefined;

    let cancelled = false;
    let timer = null;

    setJob(null);
    setError(null);
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
        setError(err.response?.data?.error || err.message || 'Не удалось запустить синхронизацию.');
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
          if (onComplete) {
            try { onComplete(data.result); } catch { /* host can't break our cleanup */ }
          }
        }
      } catch (err) {
        if (cancelled) return;
        setError(err.response?.data?.error || err.message || 'Ошибка опроса состояния.');
        // Keep retrying — transient network blips shouldn't kill the modal.
        timer = setTimeout(poll, POLL_INTERVAL_MS * 2);
      }
    }

    start();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [open, onComplete]);

  // Lock body scroll while modal is open
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const status = job?.status || (error ? 'failed' : 'running');
  const isRunning = status === 'running';
  const safeOnClose = isRunning ? undefined : onClose;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={safeOnClose}
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
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-ios-separator dark:border-dark-separator">
            <div>
              <h2
                id="wix-push-modal-title"
                className="text-lg font-semibold text-ios-label dark:text-dark-label"
              >
                Синхронизация с Wix
              </h2>
              <p className={`text-sm font-medium ${STATUS_COLOR[status] || ''}`}>
                {STATUS_LABEL[status] || status}
              </p>
            </div>
            <button
              type="button"
              onClick={safeOnClose}
              disabled={isRunning}
              className="px-3 h-9 rounded-lg text-sm font-medium
                         text-ios-tertiary dark:text-dark-tertiary
                         hover:bg-ios-fill dark:hover:bg-dark-fill
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isRunning ? 'Подождите...' : 'Закрыть'}
            </button>
          </div>

          {/* Log */}
          <div className="flex-1 overflow-y-auto px-5 py-3">
            {error && !job && (
              <div className="text-rose-600 dark:text-rose-400 text-sm">{error}</div>
            )}
            {job?.log?.length === 0 && isRunning && (
              <div className="text-ios-tertiary dark:text-dark-tertiary text-sm">
                Запускаем...
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

          {/* Footer summary (only after completion) */}
          {!isRunning && job?.result && (
            <div className="px-5 py-3 border-t border-ios-separator dark:border-dark-separator bg-ios-fill/30 dark:bg-dark-fill/30">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ios-secondary dark:text-dark-secondary">
                <span>Цены: <strong className="text-ios-label dark:text-dark-label">{job.result.pricesSynced ?? 0}</strong></span>
                <span>Остатки: <strong className="text-ios-label dark:text-dark-label">{job.result.stockSynced ?? 0}</strong></span>
                <span>Категории: <strong className="text-ios-label dark:text-dark-label">{job.result.categoriesSynced ?? 0}</strong></span>
                <span>Описания: <strong className="text-ios-label dark:text-dark-label">{job.result.descriptionsSynced ?? 0}</strong></span>
                <span>Переводы: <strong className="text-ios-label dark:text-dark-label">{job.result.translationsSynced ?? 0}</strong></span>
              </div>
              {job.result.errors?.length > 0 && (
                <div className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                  {job.result.errors.length} предупреждени{job.result.errors.length === 1 ? 'е' : 'й'} — см. детали в журнале выше.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
