import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import client from '../api/client.js';

export default function AskBlossomPanel({ t }) {
  const [messages, setMessages] = useState([]); // { role: 'user'|'assistant', text }
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView?.({ behavior: 'smooth' }); }, [messages, loading]);

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
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', text: err.response?.data?.error || t.assistantError }]);
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  return (
    <div className="flex flex-col h-full max-h-[70vh]">
      <div className="flex-1 overflow-y-auto space-y-3 p-2">
        {messages.length === 0 && <p className="text-secondary text-center mt-8">{t.assistantEmpty}</p>}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <div className={`inline-block rounded-lg px-3 py-2 max-w-[85%] ${m.role === 'user' ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-900'}`}>
              {m.role === 'assistant'
                ? <div className="prose prose-sm max-w-none"><ReactMarkdown>{m.text}</ReactMarkdown></div>
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
  );
}
