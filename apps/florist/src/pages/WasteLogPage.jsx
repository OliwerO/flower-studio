import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import {
  IconButton,
  EmptyState,
  FilterBar,
  Sheet,
  LOSS_REASONS,
  reasonLabel,
  useToast,
} from '@flower-studio/shared';
import client from '../api/client.js';
import t from '../translations.js';
import WasteSummary from '../components/waste/WasteSummary.jsx';
import WasteEntryRow from '../components/waste/WasteEntryRow.jsx';
import WasteAddSheet from '../components/waste/WasteAddSheet.jsx';

// Reference point for relative dates so "today" / "yesterday" labels work
// whether the user is in CEST or UTC.
function todayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];
}
function periodStart(period) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (period === 'week') d.setDate(d.getDate() - 7);
  else if (period === 'month') d.setMonth(d.getMonth() - 1);
  else if (period === 'all') return '1970-01-01';
  return d.toISOString().split('T')[0];
}

// Groups entries by their Date field, producing sticky-header-friendly sections.
function groupByDate(entries, t) {
  const today = todayISO();
  const yd = new Date(); yd.setDate(yd.getDate() - 1);
  const yesterday = yd.toISOString().split('T')[0];

  const groups = new Map();
  for (const e of entries) {
    const date = e.Date || today;
    let label;
    if (date === today) label = t.wasteDayToday;
    else if (date === yesterday) label = t.wasteDayYesterday;
    else label = new Date(date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    if (!groups.has(date)) groups.set(date, { date, label, items: [] });
    groups.get(date).items.push(e);
  }
  // Most-recent first — GET already sorted descending by Date, but Map insertion order
  // isn't guaranteed if entries arrive out of order.
  return Array.from(groups.values()).sort((a, b) => b.date.localeCompare(a.date));
}

export default function WasteLogPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [entries, setEntries]         = useState([]);
  const [stock, setStock]             = useState([]);
  const [period, setPeriod]           = useState('week');
  const [selectedReasons, setReasons] = useState([]);
  const [addOpen, setAddOpen]         = useState(false);
  const [editingEntry, setEditing]    = useState(null);
  const [actionEntry, setActionEntry] = useState(null);
  const [loading, setLoading]         = useState(true);

  // Undo buffer — when an entry is "deleted," it stays in deletedBuffer for 4 s.
  // The server call only fires if the undo window expires. Uses a ref so we can
  // read the latest state inside setTimeout without stale closures.
  const undoTimerRef = useRef(null);
  const [pendingDelete, setPendingDelete] = useState(null); // entry object

  async function loadAll() {
    setLoading(true);
    try {
      const [lossRes, stockRes] = await Promise.all([
        client.get('/stock-loss'),
        client.get('/stock?active=true'),
      ]);
      setEntries(lossRes.data || []);
      setStock(stockRes.data || []);
    } catch {
      showToast(t.wasteLoadError, 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  // Filter — period is date-range; reasons are multi-select chips.
  const filtered = useMemo(() => {
    const from = periodStart(period);
    return entries.filter(e => {
      if ((e.Date || '') < from) return false;
      if (selectedReasons.length > 0 && !selectedReasons.includes(e.Reason)) return false;
      return true;
    });
  }, [entries, period, selectedReasons]);

  const grouped = useMemo(() => groupByDate(filtered, t), [filtered]);

  const periodLabels = {
    today: t.wastePeriodToday,
    week:  t.wastePeriodWeek,
    month: t.wastePeriodMonth,
    all:   t.wastePeriodAll,
  };

  async function handleSave(form) {
    try {
      if (editingEntry) {
        const { data } = await client.patch(`/stock-loss/${editingEntry.id}`, form);
        setEntries(prev => prev.map(e => e.id === editingEntry.id ? { ...e, ...data, flowerName: e.flowerName, costPrice: e.costPrice } : e));
        setEditing(null);
        showToast(t.entryUpdated || t.wasteSave, 'success');
      } else {
        const { data } = await client.post('/stock-loss', form);
        setEntries(prev => [data, ...prev]);
        showToast(t.stockWrittenOff || t.wasteSave, 'success');
      }
      // Refresh stock counts because backend adjusted them
      client.get('/stock?active=true').then(r => setStock(r.data || [])).catch(() => {});
    } catch {
      showToast(t.wasteSaveError, 'error');
    }
  }

  function scheduleDelete(entry) {
    // Optimistic: remove immediately, queue actual DELETE for 4 s later.
    setEntries(prev => prev.filter(e => e.id !== entry.id));
    setPendingDelete(entry);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(async () => {
      try {
        await client.delete(`/stock-loss/${entry.id}`);
        client.get('/stock?active=true').then(r => setStock(r.data || [])).catch(() => {});
      } catch {
        // If the server rejects, restore the entry so the user isn't misled.
        setEntries(prev => [entry, ...prev]);
        showToast(t.wasteSaveError, 'error');
      }
      setPendingDelete(null);
    }, 4000);
    showToast(t.wasteDeleted, 'success');
  }

  function undoDelete() {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    if (pendingDelete) {
      setEntries(prev => [pendingDelete, ...prev].sort((a, b) => (b.Date || '').localeCompare(a.Date || '')));
      setPendingDelete(null);
    }
  }

  return (
    <div className="min-h-screen bg-ios-bg dark:bg-dark-bg pb-28">
      {/* Sticky header */}
      <header className="sticky top-0 z-20 glass-nav safe-area-top px-2 py-2 flex items-center gap-2">
        <IconButton onClick={() => navigate(-1)} ariaLabel="Back">
          <ArrowLeft size={22} />
        </IconButton>
        <h1 className="text-base font-semibold text-ios-label dark:text-dark-label flex-1">
          {t.wasteLogTitle}
        </h1>
        <IconButton onClick={() => { setEditing(null); setAddOpen(true); }} ariaLabel={t.wasteAddTitle} variant="tinted">
          <Plus size={22} />
        </IconButton>
      </header>

      <div className="container-mobile py-3">
        <WasteSummary entries={filtered} periodLabel={periodLabels[period]} />

        <FilterBar
          className="mb-2"
          chips={[
            { value: 'today', label: t.wastePeriodToday },
            { value: 'week',  label: t.wastePeriodWeek },
            { value: 'month', label: t.wastePeriodMonth },
            { value: 'all',   label: t.wastePeriodAll },
          ]}
          value={period}
          onChange={setPeriod}
        />

        <FilterBar
          chips={LOSS_REASONS.map(r => ({ value: r, label: reasonLabel(t, r) }))}
          value={selectedReasons}
          onChange={setReasons}
          multi
        />

        {loading && (
          <div className="py-10 text-center text-sm text-ios-tertiary">…</div>
        )}

        {!loading && grouped.length === 0 && (
          <EmptyState
            icon={<Trash2 size={40} />}
            title={t.wasteLogEmpty}
            description={t.wasteLogEmptyHint}
          />
        )}

        {!loading && grouped.map(group => (
          <div key={group.date} className="mt-3">
            <div className="sticky top-14 z-10 bg-ios-bg/95 dark:bg-dark-bg/95 backdrop-blur px-1 py-1">
              <span className="text-[11px] uppercase tracking-wide font-semibold text-ios-tertiary dark:text-dark-tertiary">
                {group.label}
              </span>
            </div>
            <div className="rounded-2xl overflow-hidden bg-white dark:bg-dark-card border border-gray-100 dark:border-dark-separator">
              {group.items.map(entry => (
                <WasteEntryRow
                  key={entry.id}
                  entry={entry}
                  onLongPress={setActionEntry}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Floating undo bar while a delete is pending. Matches Material/iOS
          "snackbar" convention — non-blocking, one clear action. */}
      {pendingDelete && (
        <div className="fixed bottom-20 left-3 right-3 z-30 bg-black/85 text-white rounded-2xl shadow-lg
                        flex items-center justify-between px-4 py-3 safe-area-bottom">
          <span className="text-sm">{t.wasteDeleted}</span>
          <button
            onClick={undoDelete}
            className="text-sm font-semibold text-brand-300 active-scale"
          >
            {t.wasteUndo}
          </button>
        </div>
      )}

      {/* Add/Edit sheet */}
      <WasteAddSheet
        open={addOpen || Boolean(editingEntry)}
        entry={editingEntry}
        onClose={() => { setAddOpen(false); setEditing(null); }}
        onSave={handleSave}
        stock={stock}
      />

      {/* Action sheet for long-press on a row */}
      <Sheet
        open={Boolean(actionEntry)}
        onClose={() => setActionEntry(null)}
        t={t}
      >
        {actionEntry && (
          <div className="space-y-2 pb-2">
            <p className="text-sm text-ios-tertiary">
              {actionEntry.flowerName} · {actionEntry.Quantity} {t.stems} · {reasonLabel(t, actionEntry.Reason)}
            </p>
            <button
              onClick={() => { setEditing(actionEntry); setActionEntry(null); }}
              className="w-full h-12 rounded-2xl bg-gray-100 dark:bg-dark-elevated text-ios-label dark:text-dark-label
                         text-sm font-semibold active-scale"
            >
              {t.wasteEdit}
            </button>
            <button
              onClick={() => { scheduleDelete(actionEntry); setActionEntry(null); }}
              className="w-full h-12 rounded-2xl bg-red-50 dark:bg-red-900/20 text-ios-red
                         text-sm font-semibold active-scale"
            >
              {t.wasteDelete}
            </button>
            <button
              onClick={() => setActionEntry(null)}
              className="w-full h-12 rounded-2xl text-ios-tertiary text-sm font-medium"
            >
              {t.cancel}
            </button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
