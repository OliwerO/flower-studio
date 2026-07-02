import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import client from '../api/client.js';
import FeedbackModal from './FeedbackModal.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';

// Handoff button label follows the app language (Explorer v2 #497): the signal
// tool returns `label` (Russian) + `labelEn` (English); prefer the current
// language, then either label, then the generic translated fallback.
function pickHandoffLabel(output, lang, tFallback) {
  const primary = lang === 'en' ? output?.labelEn : output?.label;
  return primary || output?.label || output?.labelEn || tFallback;
}

export default function AskBlossomPanel({ t, reporterRole, reporterName, appArea, onOpenOrders, onOpenExplorer }) {
  const { lang } = useLanguage();
  const [messages, setMessages] = useState([]); // { role: 'user'|'assistant', text }
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false); // mobile: history slide-over drawer
  const [showReport, setShowReport] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView?.({ behavior: 'smooth' }); }, [messages, loading]);
  useEffect(() => { refreshList(); }, []);

  async function refreshList() {
    try {
      const { data } = await client.get('/assistant/conversations');
      setConversations(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('[AskBlossom] failed to load history:', err);
    }
  }

  function newChat() {
    setMessages([]);
    setSessionId(null);
    setInput('');
    setConfirmDeleteId(null);
    setEditingId(null);
    setHistoryOpen(false);
  }

  async function loadConversation(id) {
    try {
      const { data } = await client.get(`/assistant/conversations/${id}`);
      setMessages(data.messages || []);
      setSessionId(data.id);
      setConfirmDeleteId(null);
      setEditingId(null);
      setHistoryOpen(false);
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', text: err.response?.data?.error || t.assistantError }]);
    }
  }

  async function send(overrideText) {
    const text = (overrideText !== undefined ? overrideText : input).trim();
    if (!text || loading) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text }]);
    setLoading(true);
    try {
      const { data } = await client.post('/assistant/message', { sessionId, message: text });
      setSessionId(data.sessionId);
      setMessages((m) => [...m, { role: 'assistant', text: data.answer, toolResults: data.toolResults }]);
      refreshList();
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', text: err.response?.data?.error || t.assistantError }]);
    } finally {
      setLoading(false);
    }
  }

  function startRename(c) {
    setEditingId(c.id);
    setEditTitle(c.title || '');
  }

  async function saveRename(id) {
    const title = editTitle.trim();
    setEditingId(null);
    if (!title) return;
    try {
      await client.patch(`/assistant/conversations/${id}`, { title });
      refreshList();
    } catch (err) {
      console.error('[AskBlossom] rename failed:', err);
    }
  }

  async function doDelete(id) {
    setConfirmDeleteId(null);
    try {
      await client.delete(`/assistant/conversations/${id}`);
      if (id === sessionId) newChat();
      refreshList();
    } catch (err) {
      console.error('[AskBlossom] delete failed:', err);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  return (
    <div className="relative flex h-full gap-0 sm:gap-3 overflow-hidden">
      {/* History: a static side column on desktop; a slide-over drawer on phones
          (where a permanent column would squeeze the chat into a cramped half). */}
      <aside
        className={`flex flex-col bg-white border-r shrink-0
                    absolute inset-y-0 left-0 z-30 w-64 shadow-xl transition-transform duration-200
                    ${historyOpen ? 'translate-x-0' : '-translate-x-full'}
                    sm:relative sm:inset-auto sm:z-auto sm:w-48 sm:shadow-none sm:translate-x-0`}
      >
        <button
          className="m-2 bg-brand-600 text-white rounded-lg px-3 py-2 text-sm"
          onClick={newChat}
        >
          {t.assistantNewChat}
        </button>
        <div className="flex-1 overflow-y-auto px-1 pb-2 space-y-1">
          {conversations.length === 0 && <p className="text-secondary text-xs text-center mt-4">{t.assistantNoHistory}</p>}
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`group rounded-lg px-2 py-1.5 text-sm cursor-pointer flex items-center gap-1 ${c.id === sessionId ? 'bg-brand-100' : 'hover:bg-gray-100'}`}
            >
              {editingId === c.id ? (
                <input
                  className="flex-1 border rounded px-1 py-0.5 text-sm min-w-0"
                  value={editTitle}
                  autoFocus
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={() => saveRename(c.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveRename(c.id); if (e.key === 'Escape') setEditingId(null); }}
                />
              ) : (
                <button className="flex-1 text-left truncate min-w-0" onClick={() => loadConversation(c.id)}>
                  {c.title || t.assistantUntitled}
                </button>
              )}
              {editingId !== c.id && confirmDeleteId !== c.id && (
                <span className="hidden group-hover:flex items-center gap-1 shrink-0">
                  <button aria-label={t.assistantRename} className="text-secondary text-xs px-0.5" onClick={() => startRename(c)}>✎</button>
                  <button aria-label={t.assistantDelete} className="text-secondary text-xs px-0.5" onClick={() => setConfirmDeleteId(c.id)}>✕</button>
                </span>
              )}
              {confirmDeleteId === c.id && (
                <button className="text-red-600 text-xs shrink-0" onClick={() => doDelete(c.id)}>{t.assistantDeleteConfirm}</button>
              )}
            </div>
          ))}
        </div>
      </aside>

      {/* Mobile-only backdrop behind the open history drawer */}
      {historyOpen && (
        <div className="sm:hidden absolute inset-0 z-20 bg-black/20" onClick={() => setHistoryOpen(false)} />
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile-only toolbar: open history drawer + quick new chat (desktop has the side column) */}
        <div className="sm:hidden flex items-center gap-2 px-2 py-1.5 border-b">
          <button
            className="flex items-center gap-1.5 text-sm text-gray-700 px-2 py-1 rounded-lg hover:bg-gray-100"
            onClick={() => setHistoryOpen(true)}
            aria-label={t.assistantHistory}
          >
            <span className="text-lg leading-none">☰</span>
            <span>{t.assistantHistory}</span>
          </button>
          <button
            className="ml-auto text-sm font-medium text-brand-600 px-2 py-1 rounded-lg hover:bg-brand-50"
            onClick={newChat}
          >
            {t.assistantNewChat}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-3 p-2">
          {messages.length === 0 && (
            <div className="mt-8 flex flex-col items-center gap-3">
              <p className="text-secondary text-center">{t.assistantEmpty}</p>
              {(t.assistantStarters || []).length > 0 && (
                <div className="flex flex-wrap justify-center gap-2 max-w-xl px-2">
                  {(t.assistantStarters || []).map((q, i) => (
                    <button
                      key={i}
                      className="rounded-full border border-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-40"
                      onClick={() => send(q)}
                      disabled={loading}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {messages.map((m, i) => {
            const openOrdersResult = m.toolResults?.find((r) => r.name === 'open_orders_view');
            const openExplorerResult = m.toolResults?.find((r) => r.name === 'open_explorer_view');
            return (
              <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
                <div className={`inline-block rounded-lg px-3 py-2 max-w-[85%] ${m.role === 'user' ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-900'}`}>
                  {m.role === 'assistant'
                    ? <div className="prose prose-sm max-w-none prose-table:my-2 prose-th:px-2 prose-td:px-2"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown></div>
                    : m.text}
                </div>
                {openOrdersResult && onOpenOrders && (
                  <div className="mt-1">
                    <button
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 border border-brand-600 bg-brand-50 rounded-lg px-3 py-1.5 hover:bg-brand-100 transition-colors"
                      onClick={() => onOpenOrders(openOrdersResult.output.filter)}
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M14 5h5v5" />
                        <path d="M19 5l-7 7" />
                        <path d="M19 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
                      </svg>
                      {pickHandoffLabel(openOrdersResult.output, lang, t.openInOrders || 'Open in Orders')}
                    </button>
                  </div>
                )}
                {openExplorerResult && onOpenExplorer && openExplorerResult.output?.spec && (
                  <div className="mt-1">
                    <button
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 border border-brand-600 bg-brand-50 rounded-lg px-3 py-1.5 hover:bg-brand-100 transition-colors"
                      onClick={() => onOpenExplorer(openExplorerResult.output.spec)}
                    >
                      {/* grid / table icon — distinct from the "open in orders" arrow */}
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <path d="M3 9h18M3 15h18M9 3v18" />
                      </svg>
                      {pickHandoffLabel(openExplorerResult.output, lang, t.openInExplorer || 'Open in Explorer')}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {loading && <div className="text-left"><div className="inline-block rounded-lg px-3 py-2 bg-gray-100 text-gray-500">{t.assistantThinking}</div></div>}
          <div ref={endRef} />
        </div>
        <div className="flex gap-2 p-2 border-t">
          <input
            className="flex-1 border rounded-lg px-3 py-2"
            placeholder={t.assistantPlaceholder}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={loading}
          />
          <button className="bg-brand-600 text-white rounded-lg px-4 py-2 disabled:opacity-50" onClick={() => send()} disabled={loading}>
            {t.assistantSend}
          </button>
        </div>
        {reporterRole && (
          <div className="px-2 pb-2 flex justify-start">
            <button
              onClick={() => setShowReport(true)}
              className="flex items-center gap-1.5 text-sm font-medium text-brand-600 border border-brand-600 bg-brand-50 rounded-lg px-3 py-1.5 hover:bg-brand-100 transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                <line x1="4" y1="22" x2="4" y2="15" />
              </svg>
              {t.assistantReport || 'Сообщить о проблеме'}
            </button>
          </div>
        )}
      </div>

      {showReport && (
        <FeedbackModal
          t={t}
          reporterRole={reporterRole}
          reporterName={reporterName}
          appArea={appArea}
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
}
