// TextImportModal — paste customer messages or Flowwow email text,
// AI parses it into a structured draft that pre-fills the order form.
// Like a receiving inspection station: raw material comes in, gets
// identified, tagged, and routed to the right workstation.

import { useState } from 'react';
import client from '../api/client.js';
import t from '../translations.js';

export default function TextImportModal({ onClose, onParsed }) {
  const [text, setText]       = useState('');
  const [type, setType]       = useState('general');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  async function handleParse() {
    if (!text.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await client.post('/intake/parse', { text: text.trim(), type });
      onParsed(res.data);
      onClose();
    } catch (err) {
      const msg = err.response?.data?.error || err.message || t.intake.parseError;
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Modal — slides up from bottom, like iOS sheet */}
      <div
        className="relative w-full max-w-lg bg-white rounded-t-3xl shadow-2xl px-5 pt-4 pb-8 max-h-[85vh] flex flex-col animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        {/* Handle bar */}
        <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-ios-label">{t.intake.title}</h2>
          <button onClick={onClose} className="text-ios-tertiary text-2xl leading-none px-1">×</button>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setType('general')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
              type === 'general'
                ? 'bg-brand-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-ios-secondary dark:text-gray-300'
            }`}
          >
            {t.intake.modeGeneral}
          </button>
          <button
            onClick={() => setType('flowwow')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
              type === 'flowwow'
                ? 'bg-brand-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-ios-secondary dark:text-gray-300'
            }`}
          >
            Flowwow
          </button>
        </div>

        {/* Hint */}
        <p className="text-xs text-ios-tertiary mb-2">
          {type === 'flowwow' ? t.intake.hintFlowwow : t.intake.hintGeneral}
        </p>

        {/* Textarea */}
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={type === 'flowwow' ? t.intake.placeholderFlowwow : t.intake.placeholderGeneral}
          rows={8}
          className="flex-1 w-full bg-gray-50 rounded-2xl px-4 py-3 text-base text-ios-label
                     outline-none resize-none placeholder-ios-tertiary/50 border border-gray-200
                     focus:border-brand-300 focus:ring-2 focus:ring-brand-100 transition-all"
          autoFocus
        />

        {/* Error */}
        {error && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Parse button */}
        <button
          onClick={handleParse}
          disabled={!text.trim() || loading}
          className="mt-4 w-full h-14 rounded-2xl bg-brand-600 text-white text-base font-semibold
                     disabled:opacity-30 active:bg-brand-700 transition-colors shadow-lg active-scale
                     flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              {t.intake.parsing}
            </>
          ) : (
            t.intake.parseButton
          )}
        </button>
      </div>
    </div>
  );
}
