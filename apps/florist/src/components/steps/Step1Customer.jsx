// Step1Customer — search-first. Selecting or creating a customer auto-advances the wizard.

import { useState, useEffect, useRef } from 'react';
import client from '../../api/client.js';
import t from '../../translations.js';

export default function Step1Customer({ customerId, customerName, onSelect, onChange }) {
  const [query, setQuery]           = useState('');
  const [results, setResults]       = useState([]);
  const [searching, setSearching]   = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ Name: '', Phone: '', Nickname: '', Email: '', Link: '', Language: '', 'Home address': '', 'Sex / Business': '', 'Communication method': '' });
  const [showExtra, setShowExtra] = useState(false);
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

  // Select a customer and immediately advance to the next step
  function selectCustomer(c) {
    const patch = {
      customerId: c.id,
      customerName: c['Name'] || c['Nickname'] || c['Phone'],
      customerCommMethod: c['Communication method'] || '',
    };
    onSelect(patch);  // onSelect updates form AND advances step
  }

  const [nameError, setNameError] = useState('');

  async function saveNewCustomer() {
    if (!newCustomer.Name.trim()) {
      setNameError(t.customerName + ' is required');
      return;
    }
    setNameError('');
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
            <span className="text-ios-tertiary text-lg">🔍</span>
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
                      className="text-ios-tertiary text-sm">✕</button>
            )}
          </div>
        </div>
      </div>

      {/* Create new — always visible as a default action */}
      {!showCreate && (
        <button
          onClick={() => setShowCreate(true)}
          className="ios-card px-4 py-3.5 flex items-center gap-3 w-full active:bg-ios-fill active-scale"
        >
          <div className="w-8 h-8 rounded-full bg-ios-green flex items-center justify-center shrink-0">
            <span className="text-white text-lg font-semibold leading-none">+</span>
          </div>
          <span className="text-ios-label font-medium">{t.createNew}</span>
        </button>
      )}

      {/* Search results */}
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
                {/* Avatar initial */}
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
                <span className="text-ios-tertiary text-lg">›</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {showCreate && (
        <div>
          <p className="ios-label">{t.createNew}</p>
          <div className="ios-card overflow-hidden divide-y divide-ios-separator/40">
            {[
              { key: 'Name',     label: t.customerName,     type: 'text',  placeholder: 'Anna Kowalska', required: true },
              { key: 'Phone',    label: t.customerPhone,    type: 'tel',   placeholder: '+48 000 000 000' },
              { key: 'Nickname', label: t.nickname || 'Nickname', type: 'text',  placeholder: 'Anya' },
              { key: 'Link',     label: 'Instagram',        type: 'text',  placeholder: '@handle' },
              { key: 'Email',    label: t.customerEmail,    type: 'email', placeholder: 'anna@email.com' },
            ].map(({ key, label, type, placeholder, required }) => (
              <div key={key} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-ios-tertiary w-24 shrink-0">
                    {label}{required && <span className="text-red-500"> *</span>}
                  </span>
                  <input
                    type={type}
                    value={newCustomer[key]}
                    onChange={e => {
                      setNewCustomer(p => ({ ...p, [key]: e.target.value }));
                      if (key === 'Name') setNameError('');
                    }}
                    placeholder={placeholder}
                    className={`flex-1 text-base bg-transparent outline-none text-ios-label placeholder-ios-tertiary/50 ${
                      key === 'Name' && nameError ? 'text-red-600' : ''
                    }`}
                  />
                </div>
                {key === 'Name' && nameError && (
                  <p className="text-red-500 text-xs mt-1 ml-[108px]">{nameError}</p>
                )}
              </div>
            ))}
          </div>

          {/* Optional extra fields — expandable */}
          {!showExtra && (
            <button
              onClick={() => setShowExtra(true)}
              className="mt-2 text-sm text-brand-600 font-medium px-1 active:underline"
            >
              + {t.moreFields || 'More fields'}
            </button>
          )}

          {showExtra && (
            <div className="ios-card overflow-hidden divide-y divide-ios-separator/40 mt-2">
              {/* Language — pill selector */}
              <div className="px-4 py-3">
                <span className="text-sm text-ios-tertiary">{t.language || 'Language'}</span>
                <div className="flex flex-wrap gap-2 mt-2">
                  {['RU', 'UK', 'PL', 'EN', 'TR'].map(lang => (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => setNewCustomer(p => ({ ...p, Language: p.Language === lang ? '' : lang }))}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                        newCustomer.Language === lang
                          ? 'bg-brand-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-700 text-ios-secondary dark:text-gray-300'
                      }`}
                    >
                      {lang}
                    </button>
                  ))}
                </div>
              </div>

              {/* Home address */}
              <div className="flex items-center px-4 py-3 gap-3">
                <span className="text-sm text-ios-tertiary w-24 shrink-0">{t.homeAddress || 'Address'}</span>
                <input
                  type="text"
                  value={newCustomer['Home address']}
                  onChange={e => setNewCustomer(p => ({ ...p, 'Home address': e.target.value }))}
                  placeholder="ul. Florianska 10, Krakow"
                  className="flex-1 text-base bg-transparent outline-none text-ios-label placeholder-ios-tertiary/50"
                />
              </div>

              {/* Sex / Business — pill selector */}
              <div className="px-4 py-3">
                <span className="text-sm text-ios-tertiary">{t.sex || 'Type'}</span>
                <div className="flex flex-wrap gap-2 mt-2">
                  {[{ v: 'Female', l: t.female || 'Female' }, { v: 'Male', l: t.male || 'Male' }, { v: 'Business', l: t.business || 'Business' }].map(({ v, l }) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setNewCustomer(p => ({ ...p, 'Sex / Business': p['Sex / Business'] === v ? '' : v }))}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                        newCustomer['Sex / Business'] === v
                          ? 'bg-brand-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-700 text-ios-secondary dark:text-gray-300'
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {/* Communication method — pill selector */}
              <div className="px-4 py-3">
                <span className="text-sm text-ios-tertiary">{t.communicationMethod}</span>
                <div className="flex flex-wrap gap-2 mt-2">
                  {['Instagram', 'WhatsApp', 'Telegram', 'Wix', 'Flowwow', 'In-store'].map(method => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setNewCustomer(p => ({ ...p, 'Communication method': p['Communication method'] === method ? '' : method }))}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                        newCustomer['Communication method'] === method
                          ? 'bg-brand-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-700 text-ios-secondary dark:text-gray-300'
                      }`}
                    >
                      {method}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-3 mt-3">
            <button
              onClick={() => setShowCreate(false)}
              className="flex-1 h-12 rounded-2xl bg-ios-fill2 text-ios-secondary font-medium active-scale"
            >
              {t.cancel}
            </button>
            <button
              onClick={saveNewCustomer}
              disabled={!newCustomer.Name.trim() || saving}
              className="flex-1 h-12 rounded-2xl bg-brand-600 text-white font-semibold
                         disabled:opacity-30 active:bg-brand-700 shadow-sm active-scale"
            >
              {saving ? '...' : t.saveCustomer}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
