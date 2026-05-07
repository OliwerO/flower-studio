import { useState, useRef, useCallback } from 'react';
import client from '../api/client.js';

/*
 * FeedbackModal — drives the full AI-assisted Report conversation.
 *
 * Props:
 *   t            — translations object from the calling app
 *   reporterRole — 'owner' | 'florist' | 'driver'
 *   reporterName — display name of the logged-in user
 *   appArea      — string identifying which app ('florist' | 'dashboard' | 'delivery')
 *   onClose      — called when modal should be dismissed
 *
 * Inline SVG icons are used intentionally. lucide-react is not a dependency of
 * packages/shared (delivery app doesn't ship it), so we inline the three shapes
 * we need rather than require every consuming app to add the dep.
 */

// ── Inline SVG primitives ──────────────────────────────────────────────────────
const SvgBase = ({ children, size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2" strokeLinecap="round"
       strokeLinejoin="round" className={className}>
    {children}
  </svg>
);

const IconX = ({ size, className }) => (
  <SvgBase size={size} className={className}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </SvgBase>
);

const IconFlag = ({ size, className }) => (
  <SvgBase size={size} className={className}>
    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
    <line x1="4" y1="22" x2="4" y2="15" />
  </SvgBase>
);

const IconSpinner = ({ size, className }) => (
  <SvgBase size={size} className={className}>
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </SvgBase>
);

const IconCheckCircle = ({ size, className }) => (
  <SvgBase size={size} className={className}>
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </SvgBase>
);

const IconImagePlus = ({ size, className }) => (
  <SvgBase size={size} className={className}>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
    <line x1="16" y1="5" x2="16" y2="11" />
    <line x1="13" y1="8" x2="19" y2="8" />
  </SvgBase>
);
// ──────────────────────────────────────────────────────────────────────────────

export default function FeedbackModal({ t, reporterRole, reporterName, appArea, onClose }) {
  const [phase, setPhase] = useState('input'); // input | asking | preview | done | error
  const [text, setText]   = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer]     = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [summary, setSummary]   = useState('');
  const [issueUrl, setIssueUrl] = useState('');
  const [loading, setLoading]   = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const fileRef = useRef();

  async function handleStart() {
    if (!text.trim()) return;
    setLoading(true);
    try {
      const { data } = await client.post('/feedback/start', {
        text: text.trim(),
        appArea,
        reporterRole,
        reporterName,
      });
      setSessionId(data.sessionId);
      if (data.done) {
        await loadPreview(data.sessionId);
      } else {
        setQuestion(data.question);
        setPhase('asking');
      }
    } catch (err) {
      console.error('[FeedbackModal] start error', err);
      setPhase('error');
    } finally {
      setLoading(false);
    }
  }

  async function handleContinue() {
    if (!answer.trim()) return;
    setLoading(true);
    try {
      const { data } = await client.post('/feedback/continue', {
        sessionId,
        message: answer.trim(),
      });
      setAnswer('');
      if (data.done) {
        await loadPreview(sessionId);
      } else {
        setQuestion(data.question);
      }
    } catch (err) {
      console.error('[FeedbackModal] continue error', err);
      setPhase('error');
    } finally {
      setLoading(false);
    }
  }

  async function loadPreview(sid) {
    try {
      const { data } = await client.post('/feedback/preview', { sessionId: sid });
      setSummary(data.summary);
      setPhase('preview');
    } catch (err) {
      console.error('[FeedbackModal] preview error', err);
      setPhase('error');
    }
  }

  async function handlePublish() {
    setLoading(true);
    try {
      const form = new FormData();
      form.append('sessionId', sessionId);
      if (imageFile) form.append('image', imageFile, imageFile.name);

      await client.post('/feedback/publish', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPhase('done');
    } catch (err) {
      console.error('[FeedbackModal] publish error', err);
      setPhase('error');
    } finally {
      setLoading(false);
    }
  }

  // Clipboard paste — picks up images pasted anywhere in the modal
  const handlePaste = useCallback((e) => {
    const item = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith('image/'));
    if (item) {
      const file = item.getAsFile();
      if (file) setImageFile(file);
    }
  }, []);

  const inputCls = `w-full rounded-2xl border border-gray-100 dark:border-gray-700 p-3 text-sm
                    bg-gray-50 dark:bg-dark-elevated text-ios-label dark:text-dark-label
                    focus:outline-none focus:ring-2 focus:ring-brand-400 resize-none`;
  const btnPrimary = `w-full bg-brand-600 active:bg-brand-700 disabled:opacity-40 text-white
                      font-semibold rounded-2xl py-3 text-sm flex items-center justify-center gap-2`;
  const btnSecondary = `flex-1 bg-gray-100 dark:bg-dark-elevated active:bg-gray-200
                        dark:active:bg-dark-card text-ios-label dark:text-dark-label
                        font-semibold rounded-2xl py-3 text-sm`;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onPaste={handlePaste}>
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg bg-white dark:bg-dark-card
                      rounded-t-3xl shadow-2xl animate-slide-up safe-area-bottom">
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-ios-separator dark:bg-dark-separator" />
        </div>

        <div className="px-5 pb-6 pt-2">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <IconFlag size={18} className="text-brand-600" />
              <h2 className="font-semibold text-ios-label dark:text-dark-label">{t.reportTitle}</h2>
            </div>
            <button onClick={onClose}
              className="w-8 h-8 rounded-full bg-gray-100 dark:bg-dark-elevated
                         flex items-center justify-center text-ios-tertiary dark:text-dark-tertiary
                         active:bg-gray-200">
              <IconX size={16} />
            </button>
          </div>

          {/* Phase: input */}
          {phase === 'input' && (
            <div className="space-y-3">
              <textarea className={inputCls} rows={4}
                placeholder={t.reportPlaceholder} value={text}
                onChange={e => setText(e.target.value)} autoFocus />
              <button
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1.5 text-xs text-ios-secondary dark:text-dark-secondary
                           bg-gray-100 dark:bg-dark-elevated rounded-xl px-3 py-2 active:opacity-70"
              >
                <IconImagePlus size={14} />
                {imageFile ? `📎 ${imageFile.name.slice(0, 25)}` : t.reportAddScreenshot}
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={e => setImageFile(e.target.files[0] || null)} />
              <button onClick={handleStart} disabled={loading || !text.trim()} className={btnPrimary}>
                {loading && <IconSpinner size={16} className="animate-spin" />}
                {loading ? t.reportThinking : t.reportSend}
              </button>
            </div>
          )}

          {/* Phase: asking */}
          {phase === 'asking' && (
            <div className="space-y-3">
              <div className="bg-brand-50 dark:bg-brand-900/20 rounded-2xl p-3">
                <p className="text-sm text-ios-label dark:text-dark-label">{question}</p>
              </div>
              <textarea className={inputCls} rows={3}
                placeholder={t.reportPlaceholder} value={answer}
                onChange={e => setAnswer(e.target.value)} autoFocus />
              <button onClick={handleContinue} disabled={loading || !answer.trim()} className={btnPrimary}>
                {loading && <IconSpinner size={16} className="animate-spin" />}
                {loading ? t.reportThinking : t.reportSend}
              </button>
            </div>
          )}

          {/* Phase: preview */}
          {phase === 'preview' && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-ios-tertiary dark:text-dark-tertiary uppercase tracking-wider">
                {t.reportPreviewTitle}
              </p>
              <div className="bg-gray-50 dark:bg-dark-elevated rounded-2xl p-4">
                <p className="text-sm text-ios-label dark:text-dark-label leading-relaxed">{summary}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setPhase('input'); setAnswer(''); }} className={btnSecondary}>
                  {t.reportCorrect}
                </button>
                <button onClick={handlePublish} disabled={loading}
                  className="flex-1 bg-brand-600 active:bg-brand-700 disabled:opacity-40 text-white
                             font-semibold rounded-2xl py-3 text-sm flex items-center justify-center gap-2">
                  {loading && <IconSpinner size={16} className="animate-spin" />}
                  {loading ? t.reportThinking : t.reportConfirm}
                </button>
              </div>
            </div>
          )}

          {/* Phase: done */}
          {phase === 'done' && (
            <div className="space-y-4 text-center py-3">
              <IconCheckCircle size={44} className="text-green-500 mx-auto" />
              <p className="text-sm font-medium text-ios-label dark:text-dark-label">{t.reportSuccess}</p>
              <button onClick={onClose} className={btnPrimary}>OK</button>
            </div>
          )}

          {/* Phase: error */}
          {phase === 'error' && (
            <div className="space-y-3">
              <p className="text-sm text-red-500 dark:text-red-400">{t.reportError}</p>
              <button
                onClick={() => { setPhase('input'); setSessionId(null); setQuestion(''); setAnswer(''); setSummary(''); setIssueUrl(''); }}
                className={btnSecondary + ' w-full'}>
                {t.reportRetry}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
