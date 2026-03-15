// Step1Customer — search-first. Selecting or creating a customer auto-advances the wizard.

import { useState, useEffect, useRef } from 'react';
import client from '../../api/client.js';
import t from '../../translations.js';

export default function Step1Customer({ customerId, customerName, onSelect, onChange }) {
  const [query, setQuery]           = useState('');
  const [results, setResults]       = useState([]);
  const [searching, setSearching]   = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ Name: '', Phone: '', Nickname: '', Email: '' });
  const [saving, setSaving]         = useState(false);
  const debounceRef                 = useRef(null);

  useEffect(() => {
    if (query.length < 2) { setResults([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await client.get('/customers', { params: { search: query } });
        setResults(res.data);
      } catch { /* ignore */ }
      finally { setSearching(false); }
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  function selectCustomer(c) {
    const patch = {
      customerId: c.id,
      customerName: c['Name'] || c['Nickname'] || c['Phone'],
      customerCommMethod: c['Communication method'] || '',
    };
    onSelect(patch);
  }

  async function saveNewCustomer() {
    if (!newCustomer.Name && !newCustomer.Phone) return;
    setSaving(true);
    try {
      const res = await client.post('/customers', newCustomer);
      selectCustomer(res.data);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Search */}
      <div>
        <p className="ios-label">{t.searchCustomer}</p>
        <div className="ios-card overflow-hidden">
          <div className="flex items-center px-4 gap-3">
            <span className="text-ios-tertiary text-lg">&#128269;</span>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="flex-1 py-3.5 text-base bg-transparent outline-none placeholder-ios-tertiary"
              autoFocus
            />
            {query.length > 0 && (
              <button onClick={() => { setQuery(''); setResults([]); }}
                      className="text-ios-tertiary text-sm">&#10005;</button>
            )}
          </div>
        </div>
      </div>

      {searching && (
        <p className="text-ios-tertiary text-sm text-center py-4">{t.loading}</p>
      )}

      {results.length > 0 && (
        <div>
          <p className="ios-label">Results</p>
          <div className="ios-card overflow-hidden divide-y divide-ios-separator/40">
            {results.map(c => (
              <button
                key={c.id}
                onClick={() => selectCustomer(c)}
                className="w-full text-left px-4 py-3.5 flex items-center gap-3 active:bg-ios-fill"
              >
                <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center shrink-0">
                  <span className="text-brand-600 font-semibold text-base">
                    {(c['Name'] || c['Nickname'] || '?')[0].toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-ios-label">{c['Name']}</div>
                  <div className="text-sm text-ios-tertiary truncate">
                    {[c['Phone'], c['Nickname']].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <span className="text-ios-tertiary text-lg">&#8250;</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!showCreate && (
        <button
          onClick={() => setShowCreate(true)}
          className="ios-card px-4 py-3.5 flex items-center gap-3 w-full active:bg-ios-fill"
        >
          <div className="w-8 h-8 rounded-full bg-ios-green flex items-center justify-center shrink-0">
            <span className="text-white text-lg font-semibold leading-none">+</span>
          </div>
          <span className="text-ios-label font-medium">{t.createNew}</span>
        </button>
      )}

      {showCreate && (
        <div>
          <p className="ios-label">{t.createNew}</p>
          <div className="ios-card overflow-hidden divide-y divide-ios-separator/40">
            {[
              { key: 'Name',     label: t.customerName,     type: 'text',  placeholder: 'Anna Kowalska' },
              { key: 'Phone',    label: t.customerPhone,    type: 'tel',   placeholder: '+48 000 000 000' },
              { key: 'Nickname', label: t.customerNickname, type: 'text',  placeholder: '@instagram' },
              { key: 'Email',    label: t.customerEmail,    type: 'email', placeholder: 'anna@email.com' },
            ].map(({ key, label, type, placeholder }) => (
              <div key={key} className="flex items-center px-4 py-3 gap-3">
                <span className="text-sm text-ios-tertiary w-24 shrink-0">{label}</span>
                <input
                  type={type}
                  value={newCustomer[key]}
                  onChange={e => setNewCustomer(p => ({ ...p, [key]: e.target.value }))}
                  placeholder={placeholder}
                  className="flex-1 text-base bg-transparent outline-none text-ios-label placeholder-ios-tertiary/50"
                />
              </div>
            ))}
          </div>

          <div className="flex gap-3 mt-3">
            <button
              onClick={() => setShowCreate(false)}
              className="flex-1 h-12 rounded-2xl bg-ios-fill2 text-ios-secondary font-medium"
            >
              {t.cancel}
            </button>
            <button
              onClick={saveNewCustomer}
              disabled={(!newCustomer.Name && !newCustomer.Phone) || saving}
              className="flex-1 h-12 rounded-2xl bg-brand-600 text-white font-semibold
                         disabled:opacity-30 active:bg-brand-700 shadow-sm"
            >
              {saving ? '...' : t.saveCustomer}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
