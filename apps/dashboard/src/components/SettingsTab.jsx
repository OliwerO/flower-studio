// SettingsTab — centralized configuration panel for the owner.
// Like a factory parameter control room: all operational knobs in one place
// instead of scattered across different machines (Airtable, env vars, code).

import { useState, useEffect, useCallback } from 'react';
import t from '../translations.js';
import client from '../api/client.js';

// ── Reusable inline-edit row ──
function ConfigRow({ label, value, type = 'text', onSave, hint }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => { setDraft(value); }, [value]);

  function save() {
    onSave(type === 'number' ? Number(draft) : draft);
    setEditing(false);
  }

  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
      <div>
        <span className="text-sm font-medium text-gray-700">{label}</span>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
      {editing ? (
        <div className="flex items-center gap-2">
          <input
            type={type}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            className="w-24 px-2 py-1 text-sm border rounded-lg text-right"
            autoFocus
            onKeyDown={e => e.key === 'Enter' && save()}
          />
          <button onClick={save} className="text-xs text-white bg-brand-600 px-2 py-1 rounded-lg">OK</button>
          <button onClick={() => { setEditing(false); setDraft(value); }} className="text-xs text-gray-400">✕</button>
        </div>
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="text-sm text-brand-600 font-medium hover:bg-brand-50 px-3 py-1 rounded-lg transition-colors"
        >
          {type === 'number' ? value : value}
        </button>
      )}
    </div>
  );
}

// ── Editable list (suppliers, categories, etc.) ──
function ListEditor({ label, items, onSave, hint }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(items);
  const [newItem, setNewItem] = useState('');

  useEffect(() => { setDraft(items); }, [items]);

  function addItem() {
    if (newItem.trim() && !draft.includes(newItem.trim())) {
      setDraft([...draft, newItem.trim()]);
      setNewItem('');
    }
  }

  function removeItem(i) {
    setDraft(draft.filter((_, idx) => idx !== i));
  }

  function save() {
    onSave(draft);
    setEditing(false);
  }

  return (
    <div className="py-3 border-b border-gray-100 last:border-0">
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="text-sm font-medium text-gray-700">{label}</span>
          {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
        </div>
        {!editing ? (
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-brand-600 font-medium hover:bg-brand-50 px-2 py-1 rounded-lg"
          >{t.edit}</button>
        ) : (
          <div className="flex gap-1">
            <button onClick={save} className="text-xs text-white bg-brand-600 px-2 py-1 rounded-lg">{t.save}</button>
            <button onClick={() => { setEditing(false); setDraft(items); }} className="text-xs text-gray-400">✕</button>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(editing ? draft : items).map((item, i) => (
          <span key={i} className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 text-xs px-2.5 py-1 rounded-full">
            {item}
            {editing && (
              <button onClick={() => removeItem(i)} className="text-gray-400 hover:text-red-500 ml-0.5">✕</button>
            )}
          </span>
        ))}
      </div>
      {editing && (
        <div className="flex gap-1.5 mt-2">
          <input
            value={newItem}
            onChange={e => setNewItem(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addItem()}
            placeholder={t.addItem + '...'}
            className="flex-1 text-sm px-2 py-1 border rounded-lg"
          />
          <button onClick={addItem} className="text-xs bg-gray-200 px-2 py-1 rounded-lg">+</button>
        </div>
      )}
    </div>
  );
}

// ── Section wrapper ──
function Section({ title, children }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm px-5 py-4 mb-4">
      <h3 className="text-base font-semibold text-gray-800 mb-2">{title}</h3>
      {children}
    </div>
  );
}

// ── Marketing Spend Form ──
function MarketingSpendSection({ sources }) {
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
        <input
          type="month"
          value={form.month}
          onChange={e => setForm({ ...form, month: e.target.value })}
          className="text-sm px-2 py-1.5 border rounded-lg"
        />
        <select
          value={form.channel}
          onChange={e => setForm({ ...form, channel: e.target.value })}
          className="text-sm px-2 py-1.5 border rounded-lg"
        >
          <option value="">{t.source}...</option>
          {sources.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          type="number"
          step="0.01"
          min="0"
          value={form.amount}
          onChange={e => setForm({ ...form, amount: e.target.value })}
          placeholder={`${t.price} (zł)`}
          className="w-24 text-sm px-2 py-1.5 border rounded-lg"
        />
        <button
          type="submit"
          className="text-sm bg-brand-600 text-white px-3 py-1.5 rounded-lg hover:bg-brand-700 transition-colors"
        >{t.save}</button>
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

// ── Stock Loss Form ──
function StockLossSection() {
  const [stock, setStock] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ stockItemId: '', quantity: '', reason: '', notes: '' });
  const [toast, setToast] = useState('');

  const REASONS = ['Wilted', 'Damaged', 'Overstock', 'Other'];
  const reasonLabels = {
    Wilted: t.reasonWilted,
    Damaged: t.reasonDamaged,
    Overstock: t.reasonOverstock,
    Other: t.reasonOther,
  };

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
        <select
          value={form.stockItemId}
          onChange={e => setForm({ ...form, stockItemId: e.target.value })}
          className="text-sm px-2 py-1.5 border rounded-lg"
        >
          <option value="">{t.stockName}...</option>
          {stock.map(s => (
            <option key={s.id} value={s.id}>{s['Display Name'] || s['Purchase Name']}</option>
          ))}
        </select>
        <input
          type="number"
          min="1"
          value={form.quantity}
          onChange={e => setForm({ ...form, quantity: e.target.value })}
          placeholder={t.quantity}
          className="w-20 text-sm px-2 py-1.5 border rounded-lg"
        />
        <select
          value={form.reason}
          onChange={e => setForm({ ...form, reason: e.target.value })}
          className="text-sm px-2 py-1.5 border rounded-lg"
        >
          <option value="">{t.reason}...</option>
          {REASONS.map(r => <option key={r} value={r}>{reasonLabels[r] || r}</option>)}
        </select>
        <input
          value={form.notes}
          onChange={e => setForm({ ...form, notes: e.target.value })}
          placeholder={t.notes}
          className="flex-1 min-w-[100px] text-sm px-2 py-1.5 border rounded-lg"
        />
        <button
          type="submit"
          disabled={loading}
          className="text-sm bg-orange-500 text-white px-3 py-1.5 rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50"
        >{t.writeOff}</button>
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


// ── Main SettingsTab ──
export default function SettingsTab() {
  const [config, setConfig] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [backupName, setBackupName] = useState('');
  const [pinDrivers, setPinDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');

  useEffect(() => {
    client.get('/settings')
      .then(r => {
        setConfig(r.data.config);
        setDrivers(r.data.drivers || []);
        setPinDrivers(r.data.pinDrivers || []);
        setBackupName(r.data.backupDriverName || '');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function updateConfig(updates) {
    try {
      const { data } = await client.put('/settings/config', updates);
      setConfig(data.config);
      setToast(t.updated);
      setTimeout(() => setToast(''), 2000);
    } catch {
      setToast(t.error);
      setTimeout(() => setToast(''), 2000);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-8 h-8 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!config) {
    return <p className="text-center text-gray-400 py-8">{t.error}</p>;
  }

  return (
    <div className="space-y-4">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-green-600 text-white text-sm px-4 py-2 rounded-xl shadow-lg animate-fade-in">
          {toast}
        </div>
      )}

      {/* Operational Parameters */}
      <Section title={t.settingsOperational}>
        <ConfigRow
          label={t.defaultDeliveryFee}
          value={config.defaultDeliveryFee}
          type="number"
          hint={t.settingsDeliveryFeeHint}
          onSave={v => updateConfig({ defaultDeliveryFee: v })}
        />
        <ConfigRow
          label={t.settingsTargetMarkup}
          value={config.targetMarkup}
          type="number"
          hint={t.settingsMarkupHint}
          onSave={v => updateConfig({ targetMarkup: v })}
        />
        <ConfigRow
          label={t.settingsDriverCost}
          value={config.driverCostPerDelivery}
          type="number"
          hint={t.settingsDriverCostHint}
          onSave={v => updateConfig({ driverCostPerDelivery: v })}
        />
      </Section>

      {/* Drivers */}
      <Section title={t.settingsDrivers}>
        <p className="text-xs text-gray-400 mb-2">{t.settingsDriversHint}</p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {drivers.map(name => (
            <span key={name} className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 text-xs px-2.5 py-1 rounded-full">
              {name}
            </span>
          ))}
        </div>

        {/* Backup driver name override — daily setting */}
        {pinDrivers.includes('Backup') && (
          <div className="flex items-center gap-2 py-3 border-t border-gray-100">
            <div className="flex-1">
              <span className="text-sm font-medium text-gray-700">{t.backupDriverToday}</span>
              <p className="text-xs text-gray-400 mt-0.5">{t.backupDriverHint}</p>
            </div>
            <input
              value={backupName}
              onChange={e => setBackupName(e.target.value)}
              placeholder="Backup"
              className="w-32 text-sm px-2 py-1.5 border rounded-lg"
              onKeyDown={async e => {
                if (e.key === 'Enter') {
                  await client.put('/settings/backup-driver', { name: backupName || null });
                  setToast(t.updated);
                  setTimeout(() => setToast(''), 2000);
                  // Refresh drivers list to reflect name change
                  const { data } = await client.get('/settings');
                  setDrivers(data.drivers || []);
                }
              }}
            />
            <button
              onClick={async () => {
                await client.put('/settings/backup-driver', { name: backupName || null });
                setToast(t.updated);
                setTimeout(() => setToast(''), 2000);
                const { data } = await client.get('/settings');
                setDrivers(data.drivers || []);
              }}
              className="text-xs text-white bg-brand-600 px-2 py-1.5 rounded-lg"
            >OK</button>
          </div>
        )}

        <ListEditor
          label={t.settingsExtraDrivers}
          items={config.extraDrivers || []}
          hint={t.settingsExtraDriversHint}
          onSave={v => updateConfig({ extraDrivers: v })}
        />
      </Section>

      {/* Lists */}
      <Section title={t.settingsLists}>
        <ListEditor
          label={t.supplier}
          items={config.suppliers}
          onSave={v => updateConfig({ suppliers: v })}
        />
        <ListEditor
          label={t.category}
          items={config.stockCategories}
          onSave={v => updateConfig({ stockCategories: v })}
        />
        <ListEditor
          label={t.paymentMethod}
          items={config.paymentMethods}
          onSave={v => updateConfig({ paymentMethods: v })}
        />
        <ListEditor
          label={t.source}
          items={config.orderSources}
          onSave={v => updateConfig({ orderSources: v })}
        />
      </Section>

      {/* Marketing Spend */}
      <MarketingSpendSection sources={config.orderSources} />

      {/* Stock Loss */}
      <StockLossSection />
    </div>
  );
}
