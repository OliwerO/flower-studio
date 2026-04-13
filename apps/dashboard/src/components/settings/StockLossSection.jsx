import { useState, useEffect } from 'react';
import t from '../../translations.js';
import client from '../../api/client.js';
import { Section } from './SettingsPrimitives.jsx';

const REASONS = ['Wilted', 'Damaged', 'Overstock', 'Other'];
const reasonLabels = {
  Wilted: t.reasonWilted,
  Damaged: t.reasonDamaged,
  Overstock: t.reasonOverstock,
  Other: t.reasonOther,
};

export default function StockLossSection() {
  const [stock, setStock] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ stockItemId: '', quantity: '', reason: '', notes: '' });
  const [toast, setToast] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ quantity: '', reason: '', notes: '', date: '' });
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  useEffect(() => {
    client.get('/stock?active=true').then(r => setStock(r.data)).catch(() => {});
    client.get('/stock-loss').then(r => setEntries(r.data)).catch(() => {});
  }, []);

  function showMsg(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 2000);
  }

  async function refreshEntries() {
    const { data } = await client.get('/stock-loss');
    setEntries(data);
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.quantity || !form.reason) return;
    setLoading(true);
    try {
      await client.post('/stock-loss', {
        stockItemId: form.stockItemId || undefined,
        quantity: Number(form.quantity),
        reason: form.reason,
        notes: form.notes,
      });
      setForm({ stockItemId: '', quantity: '', reason: '', notes: '' });
      showMsg(t.stockWrittenOff);
      await refreshEntries();
    } catch {
      showMsg(t.error);
    }
    setLoading(false);
  }

  function startEdit(entry) {
    setEditingId(entry.id);
    setEditForm({
      quantity: String(entry.Quantity || ''),
      reason: entry.Reason || '',
      notes: entry.Notes || '',
      date: entry.Date || '',
    });
  }

  async function handleEdit(id) {
    if (!editForm.quantity) return;
    setLoading(true);
    try {
      await client.patch(`/stock-loss/${id}`, {
        quantity: Number(editForm.quantity),
        reason: editForm.reason,
        notes: editForm.notes,
        date: editForm.date,
      });
      setEditingId(null);
      showMsg(t.entryUpdated);
      await refreshEntries();
    } catch {
      showMsg(t.error);
    }
    setLoading(false);
  }

  async function handleDelete(id) {
    setLoading(true);
    try {
      await client.delete(`/stock-loss/${id}`);
      setDeleteConfirm(null);
      showMsg(t.entryDeleted);
      await refreshEntries();
    } catch {
      showMsg(t.error);
    }
    setLoading(false);
  }

  return (
    <Section title={t.wasteLog}>
      <form onSubmit={submit} className="flex flex-wrap gap-2 mb-3">
        <select value={form.stockItemId} onChange={e => setForm({ ...form, stockItemId: e.target.value })} className="text-sm px-2 py-1.5 border rounded-lg">
          <option value="">{t.stockName}...</option>
          {stock.map(s => <option key={s.id} value={s.id}>{s['Display Name'] || s['Purchase Name']}</option>)}
        </select>
        <input type="number" min="1" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} placeholder={t.quantity} className="w-20 text-sm px-2 py-1.5 border rounded-lg" />
        <select value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} className="text-sm px-2 py-1.5 border rounded-lg">
          <option value="">{t.reason}...</option>
          {REASONS.map(r => <option key={r} value={r}>{reasonLabels[r] || r}</option>)}
        </select>
        <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder={t.notes} className="flex-1 min-w-[100px] text-sm px-2 py-1.5 border rounded-lg" />
        <button type="submit" disabled={loading} className="text-sm bg-orange-500 text-white px-3 py-1.5 rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50">{t.writeOff}</button>
        {toast && <span className="text-xs text-green-600 self-center">{toast}</span>}
      </form>

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white rounded-2xl p-5 shadow-xl max-w-xs" onClick={e => e.stopPropagation()}>
            <p className="text-sm mb-3">{t.confirmDeleteWaste}</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteConfirm(null)} className="text-sm px-3 py-1.5 rounded-lg border hover:bg-gray-50 transition-colors">{t.cancel}</button>
              <button onClick={() => handleDelete(deleteConfirm)} disabled={loading} className="text-sm px-3 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50">{t.deleteEntry || 'Delete'}</button>
            </div>
          </div>
        </div>
      )}

      {entries.length > 0 && (
        <div className="max-h-48 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 border-b">
                <th className="text-left py-1">{t.date}</th>
                <th className="text-left py-1">{t.stockName}</th>
                <th className="text-right py-1">{t.quantity}</th>
                <th className="text-left py-1">{t.reason}</th>
                <th className="text-left py-1">{t.notes}</th>
                <th className="text-right py-1"></th>
              </tr>
            </thead>
            <tbody>
              {entries.slice(0, 30).map(e => (
                editingId === e.id ? (
                  <tr key={e.id} className="border-b border-gray-50 bg-blue-50/50">
                    <td className="py-1"><input type="date" value={editForm.date} onChange={ev => setEditForm({ ...editForm, date: ev.target.value })} className="text-xs px-1 py-0.5 border rounded w-28" /></td>
                    <td className="py-1 text-ios-tertiary">{e.flowerName || e['Stock Item Name'] || '—'}</td>
                    <td className="py-1 text-right"><input type="number" min="1" value={editForm.quantity} onChange={ev => setEditForm({ ...editForm, quantity: ev.target.value })} className="text-xs px-1 py-0.5 border rounded w-14 text-right" /></td>
                    <td className="py-1">
                      <select value={editForm.reason} onChange={ev => setEditForm({ ...editForm, reason: ev.target.value })} className="text-xs px-1 py-0.5 border rounded">
                        {REASONS.map(r => <option key={r} value={r}>{reasonLabels[r] || r}</option>)}
                      </select>
                    </td>
                    <td className="py-1"><input value={editForm.notes} onChange={ev => setEditForm({ ...editForm, notes: ev.target.value })} className="text-xs px-1 py-0.5 border rounded w-full" /></td>
                    <td className="py-1 text-right whitespace-nowrap">
                      <button onClick={() => handleEdit(e.id)} disabled={loading} className="text-xs text-green-600 hover:underline mr-1">✓</button>
                      <button onClick={() => setEditingId(null)} className="text-xs text-gray-400 hover:underline">✕</button>
                    </td>
                  </tr>
                ) : (
                  <tr key={e.id} className="border-b border-gray-50">
                    <td className="py-1">{e.Date}</td>
                    <td className="py-1">{e.flowerName || e['Stock Item Name'] || '—'}</td>
                    <td className="py-1 text-right">{e.Quantity}</td>
                    <td className="py-1">{reasonLabels[e.Reason] || e.Reason}</td>
                    <td className="py-1 text-ios-tertiary truncate max-w-[120px]">{e.Notes || ''}</td>
                    <td className="py-1 text-right whitespace-nowrap">
                      <button onClick={() => startEdit(e)} className="text-xs text-blue-500 hover:underline mr-1">{t.editEntry || '✎'}</button>
                      <button onClick={() => setDeleteConfirm(e.id)} className="text-xs text-red-400 hover:underline">{t.deleteEntry || '✕'}</button>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
