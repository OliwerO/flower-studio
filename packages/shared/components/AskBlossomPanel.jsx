import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import client from '../api/client.js';

export default function AskBlossomPanel({ t }) {
  const [messages, setMessages] = useState([]); // { role: 'user'|'assistant', text }
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
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
  }

  async function loadConversation(id) {
    try {
      const { data } = await client.get(`/assistant/conversations/${id}`);
      setMessages(data.messages || []);
      setSessionId(data.id);
      setConfirmDeleteId(null);
      setEditingId(null);
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', text: err.response?.data?.error || t.assistantError }]);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text }]);
    setLoading(true);
    try {
      const { data } = await client.post('/assistant/message', { sessionId, message: text });
      setSessionId(data.sessionId);
      setMessages((m) => [...m, { role: 'assistant', text: data.answer }]);
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
    <div className="flex h-full gap-3">
      <aside className="w-48 shrink-0 border-r flex flex-col">
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

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 overflow-y-auto space-y-3 p-2">
          {messages.length === 0 && <p className="text-secondary text-center mt-8">{t.assistantEmpty}</p>}
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
              <div className={`inline-block rounded-lg px-3 py-2 max-w-[85%] ${m.role === 'user' ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-900'}`}>
                {m.role === 'assistant'
                  ? <div className="prose prose-sm max-w-none prose-table:my-2 prose-th:px-2 prose-td:px-2"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown></div>
                  : m.text}
              </div>
            </div>
          ))}
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
          <button className="bg-brand-600 text-white rounded-lg px-4 py-2 disabled:opacity-50" onClick={send} disabled={loading}>
            {t.assistantSend}
          </button>
        </div>
      </div>
    </div>
  );
}
