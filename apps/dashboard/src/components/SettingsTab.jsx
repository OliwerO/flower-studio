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
// Includes fuzzy-match duplicate detection — like a quality gate that catches
// near-duplicate part numbers before they enter the parts catalog.
function ListEditor({ label, items, onSave, hint }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(items);
  const [newItem, setNewItem] = useState('');
  const [warning, setWarning] = useState(null); // { type: 'exact' | 'similar', match: string }

  useEffect(() => { setDraft(items); }, [items]);

  // Find exact or close matches among existing items
  function findDuplicate(val) {
    const trimmed = val.trim().toLowerCase();
    if (!trimmed) return null;
    for (const existing of draft) {
      const ex = existing.toLowerCase();
      if (ex === trimmed) return { type: 'exact', match: existing };
      // Close match: one starts with the other, or differ only by whitespace/casing
      if (ex.startsWith(trimmed) || trimmed.startsWith(ex)) {
        return { type: 'similar', match: existing };
      }
    }
    return null;
  }

  function addItem(force = false) {
    const trimmed = newItem.trim();
    if (!trimmed) return;

    if (!force) {
      const dup = findDuplicate(trimmed);
      if (dup) {
        if (dup.type === 'exact') {
          setWarning({ type: 'exact', match: dup.match });
          return;
        }
        // Similar match — ask for confirmation
        setWarning({ type: 'similar', match: dup.match });
        return;
      }
    }

    setDraft([...draft, trimmed]);
    setNewItem('');
    setWarning(null);
  }

  function removeItem(i) {
    setDraft(draft.filter((_, idx) => idx !== i));
  }

  function save() {
    onSave(draft);
    setEditing(false);
    setWarning(null);
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
            <button onClick={() => { setEditing(false); setDraft(items); setWarning(null); }} className="text-xs text-gray-400">✕</button>
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
        <>
          <div className="flex gap-1.5 mt-2">
            <input
              value={newItem}
              onChange={e => { setNewItem(e.target.value); setWarning(null); }}
              onKeyDown={e => e.key === 'Enter' && addItem()}
              placeholder={t.addItem + '...'}
              className="flex-1 text-sm px-2 py-1 border rounded-lg"
            />
            <button onClick={() => addItem()} className="text-xs bg-gray-200 px-2 py-1 rounded-lg">+</button>
          </div>
          {warning?.type === 'exact' && (
            <p className="text-xs text-red-500 mt-1">{t.alreadyExists}: "{warning.match}"</p>
          )}
          {warning?.type === 'similar' && (
            <div className="flex items-center gap-2 mt-1">
              <p className="text-xs text-amber-600">{t.similarTo}: "{warning.match}". {t.addAnyway}</p>
              <button onClick={() => addItem(true)} className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">{t.confirm}</button>
              <button onClick={() => setWarning(null)} className="text-xs text-gray-400">✕</button>
            </div>
          )}
        </>
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


// ── Storefront Categories Manager ──
function StorefrontCategoriesSection({ config: cfg, onUpdate }) {
  const sc = cfg.storefrontCategories || {};
  const [editingSeasonal, setEditingSeasonal] = useState(null); // index or 'new'
  const [draft, setDraft] = useState({ name: '', slug: '', from: '', to: '', description: '', translations: {} });
  const [translating, setTranslating] = useState(false);
  const [transLang, setTransLang] = useState('en'); // active preview tab

  function startEdit(i) {
    if (i === 'new') {
      setDraft({ name: '', slug: '', from: '', to: '', description: '', translations: {} });
    } else {
      // Convert internal MM-DD to display DD-MM for editing
      const entry = sc.seasonal[i];
      setDraft({ ...entry, from: toDisplay(entry.from), to: toDisplay(entry.to) });
    }
    setEditingSeasonal(i);
  }

  async function translateDraft() {
    if (!draft.name && !draft.description) return;
    setTranslating(true);
    try {
      const trans = { ...(draft.translations || {}) };
      // Translate title
      if (draft.name) {
        const titleRes = await client.post('/products/translate', { text: draft.name, type: 'title' });
        for (const lang of ['en', 'pl', 'ru', 'uk']) {
          trans[lang] = { ...(trans[lang] || {}), title: titleRes.data[lang] || '' };
        }
      }
      // Translate description
      if (draft.description) {
        const descRes = await client.post('/products/translate', { text: draft.description, type: 'description' });
        for (const lang of ['en', 'pl', 'ru', 'uk']) {
          trans[lang] = { ...(trans[lang] || {}), description: descRes.data[lang] || '' };
        }
      }
      setDraft(d => ({ ...d, translations: trans }));
    } catch (err) {
      console.error('Translation failed:', err);
    }
    setTranslating(false);
  }

  // Internal storage: MM-DD (for correct string comparison).
  // Display format: DD-MM (European, what the user expects).
  function toInternal(ddmm) {
    if (!ddmm) return ddmm;
    const clean = ddmm.replace(/\./g, '-');
    const parts = clean.split('-');
    if (parts.length !== 2) return clean;
    const [a, b] = parts.map(p => p.trim().padStart(2, '0'));
    // If first part > 12, it's DD-MM → swap to MM-DD
    if (Number(a) > 12) return `${b}-${a}`;
    // Ambiguous (both ≤ 12): assume user entered DD-MM → swap
    return `${b}-${a}`;
  }
  function toDisplay(mmdd) {
    if (!mmdd) return '';
    const parts = mmdd.split('-');
    if (parts.length !== 2) return mmdd;
    return `${parts[1]}-${parts[0]}`; // MM-DD → DD-MM
  }

  function saveSeasonal() {
    if (!draft.name || !draft.from || !draft.to) return;
    const slug = draft.slug || draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const entry = {
      ...draft,
      slug,
      from: toInternal(draft.from),
      to: toInternal(draft.to),
    };
    const updated = [...(sc.seasonal || [])];
    if (editingSeasonal === 'new') {
      updated.push(entry);
    } else {
      updated[editingSeasonal] = entry;
    }
    // Sort by start date so categories display chronologically
    updated.sort((a, b) => a.from.localeCompare(b.from));
    onUpdate({ storefrontCategories: { ...sc, seasonal: updated } });
    setEditingSeasonal(null);
  }

  function removeSeasonal(i) {
    const updated = sc.seasonal.filter((_, idx) => idx !== i);
    onUpdate({ storefrontCategories: { ...sc, seasonal: updated } });
  }

  // Determine which seasonal is currently active
  const now = new Date();
  const mmdd = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  return (
    <Section title={t.sfCategories}>
      {/* Permanent categories */}
      <ListEditor
        label={t.sfPermanent}
        items={sc.permanent || []}
        hint={t.sfPermanentHint}
        onSave={v => onUpdate({ storefrontCategories: { ...sc, permanent: v } })}
      />

      {/* Seasonal categories */}
      <div className="py-3 border-b border-gray-100">
        <div className="flex items-center justify-between mb-2">
          <div>
            <span className="text-sm font-medium text-gray-700">{t.sfSeasonal}</span>
            <p className="text-xs text-gray-400 mt-0.5">{t.sfSeasonalHint}</p>
          </div>
          <button
            onClick={() => startEdit('new')}
            className="text-xs text-brand-600 font-medium hover:bg-brand-50 px-2 py-1 rounded-lg"
          >+ {t.addItem}</button>
        </div>

        <div className="space-y-1.5">
          {(sc.seasonal || []).map((s, i) => {
            const isActive = sc.manualOverride === s.slug
              || (sc.autoSchedule && !sc.manualOverride && mmdd >= s.from && mmdd <= s.to);
            return (
              <div key={i} className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm ${
                isActive ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border border-gray-100'
              }`}>
                <span className="flex-1 font-medium text-gray-700">{s.name}</span>
                {s.description && <span className="text-xs text-gray-400 truncate max-w-[120px]" title={s.description}>{s.description}</span>}
                <span className="text-xs text-gray-400">{toDisplay(s.from)} → {toDisplay(s.to)}</span>
                {s.translations?.pl?.title && <span className="text-xs text-blue-500 font-medium">{t.sfTranslated}</span>}
                {isActive && <span className="text-xs text-green-600 font-medium">{t.sfLive}</span>}
                <button onClick={() => startEdit(i)} className="text-xs text-brand-600">{t.edit}</button>
                <button onClick={() => removeSeasonal(i)} className="text-xs text-red-400 hover:text-red-600">✕</button>
              </div>
            );
          })}
        </div>

        {/* Edit/Add seasonal form */}
        {editingSeasonal !== null && (
          <div className="mt-2 p-3 bg-white border border-gray-200 rounded-xl space-y-2">
            <div className="flex gap-2">
              <input
                value={draft.name}
                onChange={e => setDraft({ ...draft, name: e.target.value })}
                placeholder={t.sfCategoryName}
                className="flex-1 text-sm px-2 py-1 border rounded-lg"
              />
            </div>
            <div className="flex gap-2 items-center">
              <label className="text-xs text-gray-500">{t.sfFrom}:</label>
              <input
                value={draft.from}
                onChange={e => setDraft({ ...draft, from: e.target.value })}
                placeholder="DD-MM"
                className="w-20 text-sm px-2 py-1 border rounded-lg"
              />
              <label className="text-xs text-gray-500">{t.sfTo}:</label>
              <input
                value={draft.to}
                onChange={e => setDraft({ ...draft, to: e.target.value })}
                placeholder="DD-MM"
                className="w-20 text-sm px-2 py-1 border rounded-lg"
              />
            </div>
            {/* Description textarea */}
            <textarea
              value={draft.description || ''}
              onChange={e => setDraft({ ...draft, description: e.target.value })}
              placeholder={t.sfDescriptionHint}
              rows={2}
              className="w-full text-sm px-2 py-1 border rounded-lg resize-none"
            />
            {/* Translate button */}
            <div className="flex items-center gap-2">
              <button
                onClick={translateDraft}
                disabled={translating || (!draft.name && !draft.description)}
                className="text-xs text-white bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 px-3 py-1 rounded-lg"
              >
                {translating ? t.sfTranslating : t.sfTranslate}
              </button>
              <button onClick={saveSeasonal} className="text-xs text-white bg-brand-600 px-3 py-1 rounded-lg">{t.save}</button>
              <button onClick={() => setEditingSeasonal(null)} className="text-xs text-gray-400">✕</button>
            </div>
            {/* Translation preview tabs */}
            {draft.translations && Object.keys(draft.translations).length > 0 && (
              <div className="border border-gray-100 rounded-lg overflow-hidden">
                <div className="flex border-b border-gray-100">
                  {['en', 'pl', 'ru', 'uk'].map(lang => (
                    <button
                      key={lang}
                      onClick={() => setTransLang(lang)}
                      className={`flex-1 text-xs py-1.5 font-medium ${
                        transLang === lang ? 'bg-brand-50 text-brand-700 border-b-2 border-brand-600' : 'text-gray-400'
                      }`}
                    >{lang.toUpperCase()}</button>
                  ))}
                </div>
                <div className="p-2 space-y-1">
                  <input
                    value={draft.translations[transLang]?.title || ''}
                    onChange={e => setDraft(d => ({
                      ...d,
                      translations: {
                        ...d.translations,
                        [transLang]: { ...(d.translations[transLang] || {}), title: e.target.value },
                      },
                    }))}
                    placeholder="Title"
                    className="w-full text-xs px-2 py-1 border rounded"
                  />
                  <textarea
                    value={draft.translations[transLang]?.description || ''}
                    onChange={e => setDraft(d => ({
                      ...d,
                      translations: {
                        ...d.translations,
                        [transLang]: { ...(d.translations[transLang] || {}), description: e.target.value },
                      },
                    }))}
                    placeholder="Description"
                    rows={2}
                    className="w-full text-xs px-2 py-1 border rounded resize-none"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Auto-schedule toggle */}
      <div className="flex items-center justify-between py-3 border-b border-gray-100">
        <div>
          <span className="text-sm font-medium text-gray-700">{t.sfAutoSchedule}</span>
          <p className="text-xs text-gray-400 mt-0.5">{t.sfAutoScheduleHint}</p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={sc.autoSchedule !== false}
            onChange={e => onUpdate({ storefrontCategories: { ...sc, autoSchedule: e.target.checked } })}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-gray-200 peer-checked:bg-brand-600 rounded-full transition-colors
                          after:content-[''] after:absolute after:top-[2px] after:left-[2px]
                          after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all
                          peer-checked:after:translate-x-full" />
        </label>
      </div>

      {/* Manual override */}
      <div className="flex items-center justify-between py-3">
        <div>
          <span className="text-sm font-medium text-gray-700">{t.sfManualOverride}</span>
          <p className="text-xs text-gray-400 mt-0.5">{t.sfManualOverrideHint}</p>
        </div>
        <select
          value={sc.manualOverride || ''}
          onChange={e => onUpdate({ storefrontCategories: { ...sc, manualOverride: e.target.value || null } })}
          className="text-sm border border-gray-200 rounded-lg px-2 py-1"
        >
          <option value="">{t.sfNone}</option>
          {(sc.seasonal || []).map(s => (
            <option key={s.slug} value={s.slug}>{s.name}</option>
          ))}
        </select>
      </div>
    </Section>
  );
}

// ── Delivery Zones Manager ──
function DeliveryZonesSection({ config: cfg, onUpdate }) {
  const zones = cfg.deliveryZones || [];
  const [editingZone, setEditingZone] = useState(null); // index or 'new'
  const [draft, setDraft] = useState({ name: '', fee: 0, postcodes: '' });

  function startEdit(i) {
    if (i === 'new') {
      setDraft({ name: '', fee: 0, postcodes: '' });
    } else {
      const z = zones[i];
      setDraft({ name: z.name, fee: z.fee, postcodes: (z.postcodes || []).join(', ') });
    }
    setEditingZone(i);
  }

  function saveZone() {
    if (!draft.name) return;
    const entry = {
      id: editingZone === 'new' ? (zones.length > 0 ? Math.max(...zones.map(z => z.id)) + 1 : 1) : zones[editingZone].id,
      name: draft.name,
      fee: Number(draft.fee) || 0,
      postcodes: draft.postcodes.split(',').map(s => s.trim()).filter(Boolean),
    };
    const updated = [...zones];
    if (editingZone === 'new') {
      updated.push(entry);
    } else {
      updated[editingZone] = entry;
    }
    onUpdate({ deliveryZones: updated });
    setEditingZone(null);
  }

  function removeZone(i) {
    onUpdate({ deliveryZones: zones.filter((_, idx) => idx !== i) });
  }

  return (
    <Section title={t.dzTitle}>
      {/* Zone list */}
      <div className="space-y-1.5 mb-3">
        {zones.map((z, i) => (
          <div key={z.id} className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-xl text-sm border border-gray-100">
            <span className="flex-1 font-medium text-gray-700">{z.name}</span>
            <span className="text-xs text-gray-500">{z.fee} zl</span>
            <span className="text-xs text-gray-400">{(z.postcodes || []).join(', ') || t.dzAnyPostcode}</span>
            <button onClick={() => startEdit(i)} className="text-xs text-brand-600">{t.edit}</button>
            <button onClick={() => removeZone(i)} className="text-xs text-red-400 hover:text-red-600">✕</button>
          </div>
        ))}
      </div>

      <button
        onClick={() => startEdit('new')}
        className="text-xs text-brand-600 font-medium hover:bg-brand-50 px-2 py-1 rounded-lg mb-3"
      >+ {t.dzAddZone}</button>

      {/* Edit/Add zone form */}
      {editingZone !== null && (
        <div className="p-3 bg-white border border-gray-200 rounded-xl space-y-2 mb-3">
          <div className="flex gap-2">
            <input
              value={draft.name}
              onChange={e => setDraft({ ...draft, name: e.target.value })}
              placeholder={t.dzZoneName}
              className="flex-1 text-sm px-2 py-1 border rounded-lg"
            />
            <input
              type="number"
              value={draft.fee}
              onChange={e => setDraft({ ...draft, fee: e.target.value })}
              placeholder={t.dzFee}
              className="w-20 text-sm px-2 py-1 border rounded-lg"
              min="0"
            />
          </div>
          <div className="flex gap-2 items-center">
            <input
              value={draft.postcodes}
              onChange={e => setDraft({ ...draft, postcodes: e.target.value })}
              placeholder={t.dzPostcodes}
              className="flex-1 text-sm px-2 py-1 border rounded-lg"
            />
            <button onClick={saveZone} className="text-xs text-white bg-brand-600 px-3 py-1 rounded-lg">{t.save}</button>
            <button onClick={() => setEditingZone(null)} className="text-xs text-gray-400">✕</button>
          </div>
        </div>
      )}

      {/* Global delivery settings */}
      <ConfigRow
        label={t.dzFreeThreshold}
        value={cfg.freeDeliveryThreshold || 0}
        type="number"
        hint={t.dzFreeThresholdHint}
        onSave={v => onUpdate({ freeDeliveryThreshold: v })}
      />
      <ConfigRow
        label={t.dzExpressSurcharge}
        value={cfg.expressSurcharge || 0}
        type="number"
        hint={t.dzExpressSurchargeHint}
        onSave={v => onUpdate({ expressSurcharge: v })}
      />

      {/* Time slots */}
      <ListEditor
        label={t.dzTimeSlots}
        items={cfg.deliveryTimeSlots || []}
        hint={t.dzTimeSlotsHint}
        onSave={v => onUpdate({ deliveryTimeSlots: [...v].sort() })}
      />
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

      {/* Storefront Categories */}
      <StorefrontCategoriesSection config={config} onUpdate={updateConfig} />

      {/* Delivery Zones */}
      <DeliveryZonesSection config={config} onUpdate={updateConfig} />

      {/* Marketing Spend */}
      <MarketingSpendSection sources={config.orderSources} />

      {/* Stock Loss */}
      <StockLossSection />
    </div>
  );
}
