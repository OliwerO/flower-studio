import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api/client.js';
import t from '../translations.js';

const PRIORITY_LABELS = ['priority:high', 'priority:medium', 'priority:low'];

const PRIORITY_CFG = {
  'priority:high':   { text: () => t.issuesPriorityHigh,   cls: 'bg-red-100 text-red-700 border-red-200' },
  'priority:medium': { text: () => t.issuesPriorityMedium, cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  'priority:low':    { text: () => t.issuesPriorityLow,    cls: 'bg-blue-100 text-blue-700 border-blue-200' },
};

function priorityFromLabels(labels) {
  for (const l of labels) {
    if (PRIORITY_LABELS.includes(l.name)) return l.name;
  }
  return null;
}

function labelColor(hexColor) {
  if (!hexColor) return { bg: '#e5e7eb', text: '#374151' };
  const r = parseInt(hexColor.slice(0, 2), 16);
  const g = parseInt(hexColor.slice(2, 4), 16);
  const b = parseInt(hexColor.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return { bg: `#${hexColor}`, text: lum > 0.55 ? '#374151' : '#ffffff' };
}

function LabelChip({ label, onRemove }) {
  const { bg, text } = labelColor(label.color);
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ backgroundColor: bg, color: text }}
    >
      {label.name}
      {onRemove && (
        <button
          onClick={() => onRemove(label)}
          className="hover:opacity-70 leading-none"
          style={{ color: text }}
        >×</button>
      )}
    </span>
  );
}

function PriorityBadge({ priority }) {
  const cfg = PRIORITY_CFG[priority];
  if (!cfg) return null;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.cls}`}>
      {cfg.text()}
    </span>
  );
}

function StatusBadge({ state }) {
  const isOpen = state === 'open';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
      isOpen ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'
    }`}>
      {isOpen ? t.issuesStatusBadgeOpen : t.issuesStatusBadgeClosed}
    </span>
  );
}

function formatRelativeDate(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return t.issuesDateToday;
  if (days === 1) return t.issuesDateYesterday;
  if (days < 7) return `${days} ${t.issuesDateDaysAgo}`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} ${t.issuesDateWeeksAgo}`;
  return new Date(iso).toLocaleDateString();
}

function IssueListItem({ issue, selected, onClick }) {
  const priority = priorityFromLabels(issue.labels || []);
  const nonPriorityLabels = (issue.labels || []).filter(l => !PRIORITY_LABELS.includes(l.name));
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
        selected ? 'bg-brand-50 border-l-2 border-l-brand-500' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs text-gray-400 font-mono shrink-0 mt-0.5">#{issue.number}</span>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium leading-snug truncate ${selected ? 'text-brand-700' : 'text-gray-800'}`}>
            {issue.title}
          </p>
          <div className="flex items-center flex-wrap gap-1 mt-1">
            {priority && <PriorityBadge priority={priority} />}
            {nonPriorityLabels.slice(0, 2).map(l => (
              <LabelChip key={l.id} label={l} />
            ))}
            {nonPriorityLabels.length > 2 && (
              <span className="text-xs text-gray-400">+{nonPriorityLabels.length - 2}</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
            <span>{formatRelativeDate(issue.created_at)}</span>
            {issue.comments > 0 && (
              <span>· {issue.comments} {t.issuesCommentCount}</span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

function IssueDetail({ issue, allLabels, onIssueUpdated, showToast }) {
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [posting, setPosting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [showLabelPicker, setShowLabelPicker] = useState(false);
  const [labelSearch, setLabelSearch] = useState('');
  const labelPickerRef = useRef(null);

  useEffect(() => {
    setComments([]);
    setCommentText('');
    setShowLabelPicker(false);
    if (!issue) return;
    loadComments();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue?.number]);

  useEffect(() => {
    function handleClick(e) {
      if (labelPickerRef.current && !labelPickerRef.current.contains(e.target)) {
        setShowLabelPicker(false);
      }
    }
    if (showLabelPicker) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showLabelPicker]);

  async function loadComments() {
    setCommentsLoading(true);
    try {
      const res = await api.get(`/issues/${issue.number}/comments`);
      setComments(res.data || []);
    } catch (err) {
      console.error('[ISSUES] load comments error:', err);
    } finally {
      setCommentsLoading(false);
    }
  }

  async function postComment() {
    if (!commentText.trim()) return;
    setPosting(true);
    try {
      const res = await api.post(`/issues/${issue.number}/comments`, { body: commentText.trim() });
      setComments(prev => [...prev, res.data]);
      setCommentText('');
      showToast(t.issuesCommentPosted, 'success');
    } catch (err) {
      showToast(err.response?.data?.error || t.issuesCommentFailed, 'error');
    } finally {
      setPosting(false);
    }
  }

  async function toggleState() {
    setToggling(true);
    const newState = issue.state === 'open' ? 'closed' : 'open';
    try {
      const res = await api.patch(`/issues/${issue.number}`, { state: newState });
      onIssueUpdated(res.data);
      showToast(newState === 'closed' ? t.issuesIssueClosed : t.issuesIssueReopened, 'success');
    } catch (err) {
      showToast(err.response?.data?.error || t.issuesUpdateFailed, 'error');
    } finally {
      setToggling(false);
    }
  }

  async function setPriority(priorityLabel) {
    const currentLabels = (issue.labels || []).map(l => l.name);
    const withoutPriority = currentLabels.filter(n => !PRIORITY_LABELS.includes(n));
    const newLabels = priorityLabel ? [...withoutPriority, priorityLabel] : withoutPriority;
    try {
      const res = await api.patch(`/issues/${issue.number}`, { labels: newLabels });
      onIssueUpdated(res.data);
    } catch (err) {
      showToast(err.response?.data?.error || t.issuesUpdateFailed, 'error');
    }
  }

  async function addLabel(label) {
    const currentLabels = (issue.labels || []).map(l => l.name);
    if (currentLabels.includes(label.name)) return;
    const newLabels = [...currentLabels, label.name];
    try {
      const res = await api.patch(`/issues/${issue.number}`, { labels: newLabels });
      onIssueUpdated(res.data);
      setShowLabelPicker(false);
    } catch (err) {
      showToast(err.response?.data?.error || t.issuesUpdateFailed, 'error');
    }
  }

  async function removeLabel(label) {
    const newLabels = (issue.labels || []).map(l => l.name).filter(n => n !== label.name);
    try {
      const res = await api.patch(`/issues/${issue.number}`, { labels: newLabels });
      onIssueUpdated(res.data);
    } catch (err) {
      showToast(err.response?.data?.error || t.issuesUpdateFailed, 'error');
    }
  }

  const priority = priorityFromLabels(issue.labels || []);
  const nonPriorityLabels = (issue.labels || []).filter(l => !PRIORITY_LABELS.includes(l.name));
  const currentLabelNames = new Set((issue.labels || []).map(l => l.name));
  const availableLabels = (allLabels || []).filter(l => !currentLabelNames.has(l.name));
  const filteredAvailable = labelSearch
    ? availableLabels.filter(l => l.name.toLowerCase().includes(labelSearch.toLowerCase()))
    : availableLabels;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 flex-shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono text-gray-400">#{issue.number}</span>
              <StatusBadge state={issue.state} />
            </div>
            <h2 className="text-base font-semibold text-gray-900 leading-snug">{issue.title}</h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={issue.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-brand-600 hover:underline"
            >
              {t.issuesViewOnGitHub} ↗
            </a>
            <button
              onClick={toggleState}
              disabled={toggling}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                issue.state === 'open'
                  ? 'bg-red-50 text-red-700 hover:bg-red-100'
                  : 'bg-green-50 text-green-700 hover:bg-green-100'
              } disabled:opacity-50`}
            >
              {toggling
                ? (issue.state === 'open' ? t.issuesClosing : t.issuesReopening)
                : (issue.state === 'open' ? t.issuesCloseIssue : t.issuesReopenIssue)}
            </button>
          </div>
        </div>

        {/* Priority + Labels row */}
        <div className="mt-3 flex items-start gap-4 flex-wrap">
          {/* Priority selector */}
          <div>
            <p className="text-xs text-gray-400 mb-1">{t.issuesPriorityLabel}</p>
            <div className="flex items-center gap-1 flex-wrap">
              <button
                onClick={() => setPriority(null)}
                className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${
                  !priority ? 'bg-gray-800 text-white border-gray-800' : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
                }`}
              >
                {t.issuesPriorityNone}
              </button>
              {PRIORITY_LABELS.map(pl => {
                const cfg = PRIORITY_CFG[pl];
                const active = priority === pl;
                return (
                  <button
                    key={pl}
                    onClick={() => setPriority(active ? null : pl)}
                    className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${
                      active ? cfg.cls : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    {cfg.text()}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Labels */}
          <div className="relative" ref={labelPickerRef}>
            <p className="text-xs text-gray-400 mb-1">{t.issuesLabels}</p>
            <div className="flex items-center gap-1 flex-wrap">
              {nonPriorityLabels.map(l => (
                <LabelChip key={l.id} label={l} onRemove={removeLabel} />
              ))}
              <button
                onClick={() => { setShowLabelPicker(v => !v); setLabelSearch(''); }}
                className="px-2 py-0.5 rounded-full text-xs border border-dashed border-gray-300 text-gray-400 hover:border-gray-400 hover:text-gray-600 transition-colors"
              >
                {t.issuesLabelAdd}
              </button>
            </div>

            {showLabelPicker && (
              <div className="absolute top-full left-0 mt-1 w-52 bg-white border border-gray-200 rounded-xl shadow-lg z-20 overflow-hidden">
                <div className="p-2 border-b border-gray-100">
                  <input
                    autoFocus
                    type="text"
                    value={labelSearch}
                    onChange={e => setLabelSearch(e.target.value)}
                    placeholder={t.search}
                    className="w-full text-xs px-2 py-1 border border-gray-200 rounded-lg outline-none focus:border-brand-400"
                  />
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {filteredAvailable.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-gray-400">{t.noResults}</p>
                  ) : filteredAvailable.map(l => (
                    <button
                      key={l.id}
                      onClick={() => addLabel(l)}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <span
                        className="w-3 h-3 rounded-full inline-block shrink-0"
                        style={{ backgroundColor: `#${l.color}` }}
                      />
                      <span className="text-xs text-gray-700">{l.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Issue body */}
      {issue.body && (
        <div className="px-6 py-4 border-b border-gray-100 flex-shrink-0 max-h-48 overflow-y-auto">
          <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
            {issue.body}
          </pre>
        </div>
      )}

      {/* Comments */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
          {t.issuesComments}
        </h3>

        {commentsLoading ? (
          <div className="flex justify-center py-8">
            <div className="w-5 h-5 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
          </div>
        ) : comments.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">{t.issuesNoComments}</p>
        ) : (
          <div className="space-y-4">
            {comments.map(c => (
              <div key={c.id} className="flex gap-3">
                <img
                  src={c.user?.avatar_url}
                  alt={c.user?.login}
                  className="w-7 h-7 rounded-full shrink-0 bg-gray-200"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-gray-700">{c.user?.login}</span>
                    <span className="text-xs text-gray-400">{formatRelativeDate(c.created_at)}</span>
                  </div>
                  <div className="bg-gray-50 rounded-xl px-3 py-2">
                    <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
                      {c.body}
                    </pre>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add comment */}
      <div className="px-6 py-4 border-t border-gray-200 flex-shrink-0">
        <textarea
          value={commentText}
          onChange={e => setCommentText(e.target.value)}
          placeholder={t.issuesAddComment}
          rows={3}
          className="w-full text-sm px-3 py-2 border border-gray-200 rounded-xl outline-none focus:border-brand-400 resize-none"
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) postComment();
          }}
        />
        <div className="flex justify-end mt-2">
          <button
            onClick={postComment}
            disabled={posting || !commentText.trim()}
            className="px-4 py-1.5 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 transition-colors disabled:opacity-40"
          >
            {posting ? t.issuesPosting : t.issuesPostComment}
          </button>
        </div>
      </div>
    </div>
  );
}

function NewIssueForm({ allLabels, onCreated, onCancel, showToast }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [selectedLabels, setSelectedLabels] = useState([]);
  const [creating, setCreating] = useState(false);
  const [labelSearch, setLabelSearch] = useState('');
  const [showLabelPicker, setShowLabelPicker] = useState(false);
  const labelPickerRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (labelPickerRef.current && !labelPickerRef.current.contains(e.target)) {
        setShowLabelPicker(false);
      }
    }
    if (showLabelPicker) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showLabelPicker]);

  async function handleCreate() {
    if (!title.trim()) return;
    setCreating(true);
    try {
      const res = await api.post('/issues', {
        title: title.trim(),
        body: body.trim(),
        labels: selectedLabels.map(l => l.name),
      });
      showToast(t.issuesCreated, 'success');
      onCreated(res.data);
    } catch (err) {
      showToast(err.response?.data?.error || t.issuesCreateFailed, 'error');
    } finally {
      setCreating(false);
    }
  }

  function toggleLabel(label) {
    setSelectedLabels(prev =>
      prev.find(l => l.name === label.name)
        ? prev.filter(l => l.name !== label.name)
        : [...prev, label]
    );
  }

  const selectedNames = new Set(selectedLabels.map(l => l.name));
  const filteredLabels = (allLabels || []).filter(l =>
    !labelSearch || l.name.toLowerCase().includes(labelSearch.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
        <h2 className="text-base font-semibold text-gray-900">{t.issuesCreateTitle}</h2>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        <div>
          <input
            autoFocus
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={t.issuesCreateTitlePlaceholder}
            className="w-full text-sm font-medium px-3 py-2 border border-gray-200 rounded-xl outline-none focus:border-brand-400"
          />
        </div>

        <div>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder={t.issuesCreateBodyPlaceholder}
            rows={8}
            className="w-full text-sm px-3 py-2 border border-gray-200 rounded-xl outline-none focus:border-brand-400 resize-none"
          />
        </div>

        {/* Labels picker */}
        <div className="relative" ref={labelPickerRef}>
          <p className="text-xs text-gray-400 mb-2">{t.issuesCreateLabelsHint}</p>
          <div className="flex items-center gap-1 flex-wrap">
            {selectedLabels.map(l => (
              <LabelChip key={l.name} label={l} onRemove={() => toggleLabel(l)} />
            ))}
            <button
              onClick={() => { setShowLabelPicker(v => !v); setLabelSearch(''); }}
              className="px-2 py-0.5 rounded-full text-xs border border-dashed border-gray-300 text-gray-400 hover:border-gray-400 hover:text-gray-600 transition-colors"
            >
              {t.issuesLabelAdd}
            </button>
          </div>

          {showLabelPicker && (
            <div className="absolute top-full left-0 mt-1 w-52 bg-white border border-gray-200 rounded-xl shadow-lg z-20 overflow-hidden">
              <div className="p-2 border-b border-gray-100">
                <input
                  autoFocus
                  type="text"
                  value={labelSearch}
                  onChange={e => setLabelSearch(e.target.value)}
                  placeholder={t.search}
                  className="w-full text-xs px-2 py-1 border border-gray-200 rounded-lg outline-none focus:border-brand-400"
                />
              </div>
              <div className="max-h-48 overflow-y-auto">
                {filteredLabels.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-gray-400">{t.noResults}</p>
                ) : filteredLabels.map(l => (
                  <button
                    key={l.id}
                    onClick={() => toggleLabel(l)}
                    className={`w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center gap-2 ${
                      selectedNames.has(l.name) ? 'bg-brand-50' : ''
                    }`}
                  >
                    <span
                      className="w-3 h-3 rounded-full inline-block shrink-0"
                      style={{ backgroundColor: `#${l.color}` }}
                    />
                    <span className="text-xs text-gray-700 flex-1">{l.name}</span>
                    {selectedNames.has(l.name) && <span className="text-brand-600 text-xs">✓</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-3 flex-shrink-0">
        <button
          onClick={onCancel}
          className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-800 transition-colors"
        >
          {t.cancel}
        </button>
        <button
          onClick={handleCreate}
          disabled={creating || !title.trim()}
          className="px-4 py-1.5 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 transition-colors disabled:opacity-40"
        >
          {creating ? t.issuesCreating : t.issuesCreateSubmit}
        </button>
      </div>
    </div>
  );
}

export default function IssuesTab() {
  const [issues, setIssues] = useState([]);
  const [allLabels, setAllLabels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stateFilter, setStateFilter] = useState('open');
  const [labelFilter, setLabelFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selectedIssue, setSelectedIssue] = useState(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);

  function showToast(msg, type = 'success') {
    setToastMsg({ msg, type });
    setTimeout(() => setToastMsg(null), 3000);
  }

  const loadIssues = useCallback(async (state = stateFilter, label = labelFilter) => {
    setLoading(true);
    setError(null);
    try {
      const params = { state };
      if (label) params.labels = label;
      const res = await api.get('/issues', { params });
      setIssues(res.data || []);
    } catch (err) {
      setError(err.response?.data?.error || t.issuesError);
    } finally {
      setLoading(false);
    }
  }, [stateFilter, labelFilter]);

  useEffect(() => {
    loadIssues(stateFilter, labelFilter);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateFilter, labelFilter]);

  useEffect(() => {
    api.get('/issues/labels').then(res => setAllLabels(res.data || [])).catch(() => {});
  }, []);

  const filteredIssues = search
    ? issues.filter(i =>
        i.title.toLowerCase().includes(search.toLowerCase()) ||
        String(i.number).includes(search)
      )
    : issues;

  function handleIssueUpdated(updatedIssue) {
    setIssues(prev => prev.map(i => i.number === updatedIssue.number ? updatedIssue : i));
    if (selectedIssue?.number === updatedIssue.number) {
      setSelectedIssue(updatedIssue);
    }
    // If we're in 'open' filter and the issue was closed, or vice versa, refresh
    if (
      (stateFilter === 'open' && updatedIssue.state === 'closed') ||
      (stateFilter === 'closed' && updatedIssue.state === 'open')
    ) {
      setIssues(prev => prev.filter(i => i.number !== updatedIssue.number));
      setSelectedIssue(null);
    }
  }

  function handleNewIssueCreated(issue) {
    setShowNewForm(false);
    if (stateFilter === 'open' || stateFilter === 'all') {
      setIssues(prev => [issue, ...prev]);
      setSelectedIssue(issue);
    } else {
      setStateFilter('open');
    }
  }

  const uniqueNonPriorityLabels = [...new Set(
    allLabels.filter(l => !PRIORITY_LABELS.includes(l.name)).map(l => l.name)
  )];

  return (
    <div className="flex flex-col h-full" style={{ minHeight: 'calc(100vh - 80px)' }}>
      {/* Toast */}
      {toastMsg && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium shadow-lg ${
          toastMsg.type === 'error' ? 'bg-red-600 text-white' : 'bg-gray-900 text-white'
        }`}>
          {toastMsg.msg}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h1 className="text-lg font-bold text-gray-900">{t.issuesTitle}</h1>
        <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
          {['open', 'closed', 'all'].map(s => (
            <button
              key={s}
              onClick={() => { setStateFilter(s); setSelectedIssue(null); }}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                stateFilter === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {s === 'open' ? t.issuesOpen : s === 'closed' ? t.issuesClosed : t.issuesAll}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t.issuesSearch}
          className="flex-1 min-w-36 text-sm px-3 py-1.5 border border-gray-200 rounded-lg outline-none focus:border-brand-400"
        />
        <select
          value={labelFilter}
          onChange={e => { setLabelFilter(e.target.value); setSelectedIssue(null); }}
          className="text-sm px-3 py-1.5 border border-gray-200 rounded-lg outline-none focus:border-brand-400 bg-white"
        >
          <option value="">{t.issuesFilterAll}</option>
          {PRIORITY_LABELS.map(pl => (
            <option key={pl} value={pl}>{PRIORITY_CFG[pl].text()}</option>
          ))}
          {uniqueNonPriorityLabels.map(l => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <button
          onClick={() => { setShowNewForm(true); setSelectedIssue(null); }}
          className="px-4 py-1.5 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 transition-colors"
        >
          + {t.issuesNewIssue}
        </button>
      </div>

      {/* Main two-column layout */}
      <div className="flex flex-1 gap-4 min-h-0">
        {/* Left: issue list */}
        <div className="w-80 shrink-0 bg-white rounded-2xl border border-gray-200 overflow-hidden flex flex-col">
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="w-6 h-6 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="p-6 text-center">
              <p className="text-sm text-red-600 mb-3">{error}</p>
              <button
                onClick={() => loadIssues()}
                className="text-sm text-brand-600 hover:underline"
              >
                {t.refresh}
              </button>
            </div>
          ) : filteredIssues.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-sm text-gray-400">{t.issuesNoResults}</p>
            </div>
          ) : (
            <div className="overflow-y-auto flex-1">
              {filteredIssues.map(issue => (
                <IssueListItem
                  key={issue.number}
                  issue={issue}
                  selected={selectedIssue?.number === issue.number}
                  onClick={() => { setSelectedIssue(issue); setShowNewForm(false); }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right: detail / new form / empty state */}
        <div className="flex-1 bg-white rounded-2xl border border-gray-200 overflow-hidden flex flex-col min-w-0">
          {showNewForm ? (
            <NewIssueForm
              allLabels={allLabels}
              onCreated={handleNewIssueCreated}
              onCancel={() => setShowNewForm(false)}
              showToast={showToast}
            />
          ) : selectedIssue ? (
            <IssueDetail
              key={selectedIssue.number}
              issue={selectedIssue}
              allLabels={allLabels}
              onIssueUpdated={handleIssueUpdated}
              showToast={showToast}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-gray-400">
              {t.issuesSelectToView}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
