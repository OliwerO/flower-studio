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

  useEffect(() => {
    client.get('/stock?active=true').then(r => setStock(r.data)).catch(() => {});
    client.get('/stock-loss').then(r => setEntries(r.data)).catch(() => {});
  }, []);

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
      setToast(t.stockWrittenOff);
      setTimeout(() => setToast(''), 2000);
      const { data } = await client.get('/stock-loss');
      setEntries(data);
    } catch {
      setToast(t.error);
      setTimeout(() => setToast(''), 2000);
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

      {entries.length > 0 && (
        <div className="max-h-48 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 border-b">
                <th className="text-left py-1">{t.date}</th>
                <th className="text-left py-1">{t.stockName}</th>
                <th className="text-right py-1">{t.quantity}</th>
                <th className="text-left py-1">{t.reason}</th>
              </tr>
            </thead>
            <tbody>
              {entries.slice(0, 20).map(e => (
                <tr key={e.id} className="border-b border-gray-50">
                  <td className="py-1">{e.Date}</td>
                  <td className="py-1">{e['Stock Item Name'] || '—'}</td>
                  <td className="py-1 text-right">{e.Quantity}</td>
                  <td className="py-1">{reasonLabels[e.Reason] || e.Reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
