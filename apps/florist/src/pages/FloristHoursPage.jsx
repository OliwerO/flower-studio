// FloristHoursPage — dual-purpose page for tracking florist work hours.
// Florists see a simple logging form (like clocking in/out at a time station).
// Owner sees a monthly summary dashboard (like a payroll report).
// Data stored via /api/florist-hours endpoints.

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import useConfigLists from '../hooks/useConfigLists.js';
import client from '../api/client.js';
import t from '../translations.js';

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Calculate total hours from time windows: [{ from: "10:30", to: "15:30" }, ...]
function calcTotalHours(windows) {
  let total = 0;
  for (const w of windows) {
    if (!w.from || !w.to) continue;
    const [fh, fm] = w.from.split(':').map(Number);
    const [th, tm] = w.to.split(':').map(Number);
    const diff = (th * 60 + tm) - (fh * 60 + fm);
    if (diff > 0) total += diff / 60;
  }
  return Math.round(total * 100) / 100;
}

// Format time windows as readable string: "10:30-15:30, 16:30-18:30"
function windowsToString(windows) {
  return windows.filter(w => w.from && w.to).map(w => `${w.from}-${w.to}`).join(', ');
}

// ── Florist view: hour logging form + personal history ──
function FloristHoursForm() {
  const { showToast } = useToast();
  const lists = useConfigLists();
  const names = lists.floristNames || ['Anya', 'Daria'];
  const rates = lists.floristRates || {};

  const [name, setName] = useState('');
  const [date, setDate] = useState(todayISO());
  const [windows, setWindows] = useState([{ from: '', to: '' }]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [entries, setEntries] = useState([]);
  const [loadingEntries, setLoadingEntries] = useState(false);

  const totalHours = calcTotalHours(windows);
  const hasValidWindow = windows.some(w => w.from && w.to);

  function updateWindow(idx, field, value) {
    setWindows(prev => prev.map((w, i) => i === idx ? { ...w, [field]: value } : w));
  }

  function addWindow() {
    setWindows(prev => [...prev, { from: '', to: '' }]);
  }

  function removeWindow(idx) {
    setWindows(prev => prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx));
  }

  const fetchEntries = useCallback(async () => {
    if (!name) return;
    setLoadingEntries(true);
    try {
      const month = date.slice(0, 7);
      const res = await client.get('/florist-hours', { params: { month, name } });
      setEntries(res.data);
    } catch {
      // non-critical
    } finally {
      setLoadingEntries(false);
    }
  }, [name, date]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name || !hasValidWindow || totalHours <= 0) return;
    setSubmitting(true);
    try {
      await client.post('/florist-hours', {
        name,
        date,
        hours: totalHours,
        hourlyRate: rates[name] || 0,
        notes: [windowsToString(windows), notes].filter(Boolean).join(' | '),
      });
      showToast(t.success, 'success');
      setWindows([{ from: '', to: '' }]);
      setNotes('');
      fetchEntries();
    } catch {
      showToast(t.error, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Log form */}
      <form onSubmit={handleSubmit} className="bg-white dark:bg-dark-elevated rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 space-y-4">
        <h2 className="text-sm font-bold text-ios-label dark:text-dark-label uppercase tracking-wide">{t.logHours}</h2>

        {/* Name dropdown */}
        <div>
          <label className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-1 block">{t.selectName}</label>
          <select
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-elevated"
          >
            <option value="">{t.selectName}...</option>
            {names.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>

        {/* Date — use text display to avoid native date picker overflow */}
        <div>
          <label className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-1 block">{t.labelDate}</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm appearance-none"
            style={{ WebkitAppearance: 'none' }}
          />
        </div>

        {/* Time windows — from/to pairs */}
        <div>
          <label className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-2 block">
            {t.workingHours || 'Working hours'}
          </label>
          <div className="space-y-2">
            {windows.map((w, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="time"
                  value={w.from}
                  onChange={e => updateWindow(idx, 'from', e.target.value)}
                  className="flex-1 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm"
                />
                <span className="text-ios-tertiary text-sm">→</span>
                <input
                  type="time"
                  value={w.to}
                  onChange={e => updateWindow(idx, 'to', e.target.value)}
                  className="flex-1 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm"
                />
                {windows.length > 1 && (
                  <button type="button" onClick={() => removeWindow(idx)}
                    className="text-red-400 text-sm px-1 active-scale">✕</button>
                )}
              </div>
            ))}
            <button type="button" onClick={addWindow}
              className="w-full py-2 text-sm text-brand-600 font-medium bg-brand-50 rounded-xl active:bg-brand-100 active-scale"
            >+ {t.addWindow || 'Add time window'}</button>
          </div>
          {/* Auto-calculated total */}
          {totalHours > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-ios-tertiary">{t.totalHours}:</span>
              <span className="text-sm font-bold text-brand-600">{totalHours}h</span>
            </div>
          )}
        </div>

        {/* Notes */}
        <div>
          <label className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-1 block">{t.notes}</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            placeholder={t.optional || 'Optional'}
            className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm resize-none"
          />
        </div>

        <button
          type="submit"
          disabled={!name || !hasValidWindow || totalHours <= 0 || submitting}
          className="w-full bg-brand-600 text-white font-semibold py-3 rounded-xl active-scale disabled:opacity-50"
        >
          {submitting ? t.saving : t.logHours}
        </button>
      </form>

      {/* Personal entries this month */}
      {name && (
        <div>
          <h3 className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-2 px-1">
            {t.monthlySummary} - {name}
          </h3>
          {loadingEntries ? (
            <div className="flex justify-center py-6">
              <div className="w-6 h-6 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
            </div>
          ) : entries.length === 0 ? (
            <p className="text-sm text-ios-tertiary text-center py-4">{t.noEntries}</p>
          ) : (
            <div className="bg-white dark:bg-dark-elevated rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
              {entries.map(entry => (
                <div key={entry.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-ios-label dark:text-dark-label">{entry.Date}</p>
                    {entry.Notes && <p className="text-xs text-ios-tertiary mt-0.5">{entry.Notes}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-brand-600">{entry.Hours}h</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Owner view: monthly summary + full list with edit/delete ──
function OwnerHoursSummary() {
  const { showToast } = useToast();
  const [month, setMonth] = useState(currentMonth());
  const [summary, setSummary] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [sumRes, listRes] = await Promise.all([
        client.get('/florist-hours/summary', { params: { month } }),
        client.get('/florist-hours', { params: { month } }),
      ]);
      // Summary API returns { month, florists: [...], totalRecords }
      setSummary(sumRes.data.florists || []);
      setEntries(listRes.data);
    } catch {
      showToast(t.error, 'error');
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function startEdit(entry) {
    setEditingId(entry.id);
    setEditData({ Hours: entry.Hours, Notes: entry.Notes || '' });
  }

  async function saveEdit(id) {
    try {
      await client.patch(`/florist-hours/${id}`, editData);
      showToast(t.updated, 'success');
      setEditingId(null);
      fetchData();
    } catch {
      showToast(t.updateError, 'error');
    }
  }

  async function deleteEntry(id) {
    try {
      await client.delete(`/florist-hours/${id}`);
      showToast(t.success, 'success');
      fetchData();
    } catch {
      showToast(t.error, 'error');
    }
  }

  return (
    <div className="space-y-5">
      {/* Month picker */}
      <div className="bg-white dark:bg-dark-elevated rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 px-4 py-3 overflow-visible">
        <label className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-1 block">{t.monthlySummary}</label>
        <input
          type="month"
          value={month}
          onChange={e => setMonth(e.target.value)}
          className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-8 h-8 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Per-florist summary cards */}
          {summary && summary.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {summary.map(s => (
                <div key={s.name} className="bg-white dark:bg-dark-elevated rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
                  <h3 className="text-base font-bold text-ios-label dark:text-dark-label mb-2">{s.name}</h3>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <p className="text-xs text-ios-tertiary">{t.totalHours}</p>
                      <p className="font-semibold text-brand-600">{s.totalHours}h</p>
                    </div>
                    <div>
                      <p className="text-xs text-ios-tertiary">{t.totalDays}</p>
                      <p className="font-semibold">{s.days}</p>
                    </div>
                    <div>
                      <p className="text-xs text-ios-tertiary">{t.totalPay}</p>
                      <p className="font-semibold text-green-600">{s.totalPay ? `${Math.round(s.totalPay)} zł` : '—'}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ios-tertiary text-center py-6">{t.noEntries}</p>
          )}

          {/* Full entry list with edit/delete */}
          {entries.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-2 px-1">
                {t.details}
              </h3>
              <div className="bg-white dark:bg-dark-elevated rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
                {entries.map(entry => (
                  <div key={entry.id} className="px-4 py-3">
                    {editingId === entry.id ? (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <input
                            type="number"
                            step="0.5"
                            value={editData.Hours}
                            onChange={e => setEditData(d => ({ ...d, Hours: Number(e.target.value) }))}
                            className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                            placeholder="Hours"
                          />
                          <input
                            value={editData.Notes}
                            onChange={e => setEditData(d => ({ ...d, Notes: e.target.value }))}
                            className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                            placeholder="Notes"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => saveEdit(entry.id)} className="text-xs font-semibold text-brand-600 active-scale">{t.save}</button>
                          <button onClick={() => setEditingId(null)} className="text-xs text-ios-tertiary active-scale">{t.cancel}</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-ios-label dark:text-dark-label">
                            {entry.Name} — {entry.Date}
                          </p>
                          {entry.Notes && <p className="text-xs text-ios-tertiary mt-0.5">{entry.Notes}</p>}
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <p className="text-sm font-semibold text-brand-600">{entry.Hours}h</p>
                          </div>
                          <button onClick={() => startEdit(entry)} className="text-xs text-brand-600 active-scale">{t.edit}</button>
                          <button onClick={() => deleteEntry(entry.id)} className="text-xs text-red-500 active-scale">✕</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function FloristHoursPage() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const isOwner = role === 'owner';

  return (
    <div className="min-h-screen dark:bg-dark-bg dark:text-dark-label">
      <header className="glass-nav px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <h1 className="text-lg font-bold text-ios-label dark:text-dark-label">{t.floristHours}</h1>
          <button
            onClick={() => navigate('/orders')}
            className="text-brand-600 text-sm font-medium active-scale"
          >
            {t.back}
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4 pb-24">
        {isOwner ? <OwnerHoursSummary /> : <FloristHoursForm />}
      </main>
    </div>
  );
}
