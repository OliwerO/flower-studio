import { useState, useEffect, useCallback } from 'react';
import t from '../../translations.js';
import client from '../../api/client.js';
import { Section } from './SettingsPrimitives.jsx';

export default function MarketingSpendSection({ sources }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ month: new Date().toISOString().slice(0, 7), channel: '', amount: '' });
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await client.get('/marketing-spend');
      setEntries(data);
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function submit(e) {
    e.preventDefault();
    if (!form.channel || !form.amount) return;
    try {
      await client.post('/marketing-spend', {
        month: form.month + '-01',
        channel: form.channel,
        amount: Number(form.amount),
      });
      setForm(f => ({ ...f, channel: '', amount: '' }));
      setToast(t.save + '!');
      setTimeout(() => setToast(''), 2000);
      load();
    } catch (err) {
      setToast(t.error);
      setTimeout(() => setToast(''), 2000);
    }
  }

  return (
    <Section title={t.marketingSpend}>
      <form onSubmit={submit} className="flex flex-wrap gap-2 mb-3">
        <input type="month" value={form.month} onChange={e => setForm({ ...form, month: e.target.value })} className="text-sm px-2 py-1.5 border rounded-lg" />
        <select value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value })} className="text-sm px-2 py-1.5 border rounded-lg">
          <option value="">{t.source}...</option>
          {sources.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input type="number" step="0.01" min="0" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder={`${t.price} (zł)`} className="w-24 text-sm px-2 py-1.5 border rounded-lg" />
        <button type="submit" className="text-sm bg-brand-600 text-white px-3 py-1.5 rounded-lg hover:bg-brand-700 transition-colors">{t.save}</button>
        {toast && <span className="text-xs text-green-600 self-center">{toast}</span>}
      </form>

      {loading ? (
        <p className="text-xs text-gray-400">{t.loading}</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-gray-400">{t.noResults}</p>
      ) : (
        <div className="max-h-48 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 border-b">
                <th className="text-left py-1">{t.date}</th>
                <th className="text-left py-1">{t.source}</th>
                <th className="text-right py-1">{t.price}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id} className="border-b border-gray-50">
                  <td className="py-1">{e.Month?.slice(0, 7)}</td>
                  <td className="py-1">{e.Channel}</td>
                  <td className="py-1 text-right">{e.Amount?.toFixed(0)} zł</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
