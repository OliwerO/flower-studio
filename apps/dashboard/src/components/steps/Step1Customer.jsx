// Step1Customer — search-first. After selecting a customer an optional Key Person
// field is shown. The step advances only when the user clicks Continue.

import { useState, useEffect, useRef } from 'react';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import t from '../../translations.js';

export default function Step1Customer({ customerId, customerName, onSelect, onChange }) {
  const { showToast } = useToast();
  const [query, setQuery]           = useState('');
  const [results, setResults]       = useState([]);
  const [searching, setSearching]   = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ Name: '', Phone: '', Nickname: '', Email: '', Link: '', Language: '', 'Home address': '', 'Sex / Business': '', 'Communication method': '' });
  const [showExtra, setShowExtra] = useState(false);
  const [saving, setSaving]         = useState(false);
  const debounceRef                 = useRef(null);

  // Key Person state — loaded after customer is selected
  const [chosenCustomer, setChosenCustomer] = useState(null);
  const [kpQuery, setKpQuery]     = useState('');
  const [kpResults, setKpResults] = useState([]);
  const [kpId, setKpId]           = useState(null);
  const [kpName, setKpName]       = useState('');
  const [kpPhone, setKpPhone]     = useState('');
  const [kpAddress, setKpAddress] = useState('');
  const [kpCreating, setKpCreating] = useState(false);
  const kpDebounceRef               = useRef(null);

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

  useEffect(() => {
    if (!chosenCustomer) { setKpResults([]); return; }
    clearTimeout(kpDebounceRef.current);
    kpDebounceRef.current = setTimeout(async () => {
      try {
        const res = await client.get(`/customers/${chosenCustomer.id}/key-people`);
        setKpResults(res.data);
      } catch { /* ignore */ }
    }, 200);
    return () => clearTimeout(kpDebounceRef.current);
  }, [chosenCustomer?.id]);

  function selectCustomer(c) {
    setChosenCustomer(c);
    setKpQuery('');
    setKpId(null);
    setKpName('');
    setKpPhone('');
    setKpAddress('');
    setQuery('');
    setResults([]);
    setShowCreate(false);
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

  async function handleContinue() {
    if (!chosenCustomer) return;
    let resolvedKpId    = kpId;
    let resolvedPhone   = kpPhone;
    let resolvedAddress = kpAddress;
    if (!resolvedKpId && kpName.trim()) {
      setKpCreating(true);
      try {
        const reqBody = { name: kpName.trim() };
        if (kpPhone.trim())   reqBody.phone   = kpPhone.trim();
        if (kpAddress.trim()) reqBody.address = kpAddress.trim();
        const res = await client.post(`/customers/${chosenCustomer.id}/key-people`, reqBody);
        resolvedKpId    = res.data.id;
        resolvedPhone   = res.data.phone   || '';
        resolvedAddress = res.data.address || '';
      } catch (err) {
        console.error('Failed to create key person:', err);
        showToast(err.response?.data?.error || t.error, 'error');
      }
      finally { setKpCreating(false); }
    }
    onSelect({
      customerId:         chosenCustomer.id,
      customerName:       chosenCustomer['Name'] || chosenCustomer['Nickname'] || chosenCustomer['Phone'],
      customerCommMethod: chosenCustomer['Communication method'] || '',
      keyPersonId:        resolvedKpId || null,
      keyPersonName:      resolvedKpId ? (kpName || '') : '',
      keyPersonPhone:     resolvedKpId ? (resolvedPhone   || '') : '',
      keyPersonAddress:   resolvedKpId ? (resolvedAddress || '') : '',
      ...(resolvedKpId ? {
        recipientName:   kpName || '',
        recipientPhone:  resolvedPhone   || '',
        deliveryAddress: resolvedAddress || '',
      } : {}),
    });
  }

  const kpFiltered = kpResults.filter(p =>
    !kpQuery || p.name.toLowerCase().includes(kpQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-5">

    {/* Phase 1 — customer search + create */}
    {!chosenCustomer && (
      <>
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
              {/* Link / Instagram */}
              <div className="flex items-center px-4 py-3 gap-3">
                <span className="text-sm text-ios-tertiary w-24 shrink-0">{t.instagram}</span>
                <input
                  type="text"
                  value={newCustomer.Link}
                  onChange={e => setNewCustomer(p => ({ ...p, Link: e.target.value }))}
                  placeholder="instagram.com/handle"
                  className="flex-1 text-base bg-transparent outline-none text-ios-label placeholder-ios-tertiary/50"
                />
              </div>

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
                          : 'bg-gray-100 text-ios-secondary'
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
                          : 'bg-gray-100 text-ios-secondary'
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
                          : 'bg-gray-100 text-ios-secondary'
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
      </>
    )}

    {/* Phase 2 — key person + continue */}
    {chosenCustomer && (
      <>
        {/* Selected customer chip */}
        <div className="ios-card px-4 py-3.5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center shrink-0">
            <span className="text-brand-600 font-semibold text-base">
              {(chosenCustomer['Name'] || chosenCustomer['Nickname'] || '?')[0].toUpperCase()}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-ios-label">{chosenCustomer['Name']}</div>
            <div className="text-sm text-ios-tertiary truncate">
              {[chosenCustomer['Phone'], chosenCustomer['Nickname']].filter(Boolean).join(' · ')}
            </div>
          </div>
          <button
            onClick={() => setChosenCustomer(null)}
            className="text-xs text-brand-600 font-medium shrink-0"
          >
            {t.change || 'Change'}
          </button>
        </div>

        {/* Key Person — optional */}
        <div>
          <p className="ios-label">{t.keyPersonForOrder}</p>
          <div className="ios-card overflow-hidden">
            <div className="flex items-center px-4 gap-3">
              <input
                type="text"
                value={kpName}
                onChange={e => {
                  setKpName(e.target.value);
                  if (kpId) { setKpPhone(''); setKpAddress(''); }
                  setKpId(null);
                  setKpQuery(e.target.value);
                }}
                placeholder={t.keyPersonOrderPlaceholder}
                className="flex-1 py-3.5 text-base bg-transparent outline-none text-ios-label placeholder-ios-tertiary"
                autoFocus
              />
              {kpName && (
                <button
                  onClick={() => { setKpName(''); setKpId(null); setKpQuery(''); setKpPhone(''); setKpAddress(''); }}
                  className="text-ios-tertiary text-sm"
                >&#10005;</button>
              )}
            </div>
            {kpFiltered.length > 0 && (
              <div className="divide-y divide-ios-separator/40 border-t border-ios-separator/40">
                {kpFiltered.map(p => (
                  <button
                    key={p.id}
                    onClick={() => { setKpId(p.id); setKpName(p.name); setKpQuery(''); setKpPhone(p.phone || ''); setKpAddress(p.address || ''); }}
                    className={`w-full text-left px-4 py-3 flex items-center gap-2 active:bg-ios-fill ${kpId === p.id ? 'bg-brand-50' : ''}`}
                  >
                    <div className="flex-1 min-w-0">
                      <span className="block text-ios-label text-sm truncate">{p.name}</span>
                      {(p.phone || p.address) && (
                        <span className="block text-xs text-ios-tertiary truncate">
                          {[p.phone, p.address].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </div>
                    {kpId === p.id && <span className="text-brand-600 text-xs">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="text-xs text-ios-tertiary mt-1 px-1">
            {t.keyPerson} — {t.optional || 'optional'}
          </p>
        </div>

        {/* New recipient — phone/address, shown only while creating a new key person */}
        {!kpId && kpName.trim() && (
          <div>
            <p className="ios-label">{t.addRecipient}</p>
            <div className="ios-card overflow-hidden divide-y divide-ios-separator/40">
              <div className="flex items-center px-4 py-3 gap-3">
                <span className="text-sm text-ios-tertiary w-24 shrink-0">{t.recipientPhone}</span>
                <input
                  type="tel"
                  value={kpPhone}
                  onChange={e => setKpPhone(e.target.value)}
                  placeholder="+48 000 000 000"
                  className="flex-1 text-base bg-transparent outline-none text-ios-label placeholder-ios-tertiary/50"
                />
              </div>
              <div className="flex items-center px-4 py-3 gap-3">
                <span className="text-sm text-ios-tertiary w-24 shrink-0">{t.recipientAddress}</span>
                <input
                  type="text"
                  value={kpAddress}
                  onChange={e => setKpAddress(e.target.value)}
                  placeholder="ul. Kwiatowa 1, Krakow"
                  className="flex-1 text-base bg-transparent outline-none text-ios-label placeholder-ios-tertiary/50"
                />
              </div>
            </div>
          </div>
        )}

        {/* Continue */}
        <button
          onClick={handleContinue}
          disabled={kpCreating}
          className="h-12 rounded-2xl bg-brand-600 text-white font-semibold
                     disabled:opacity-30 active:bg-brand-700 shadow-sm"
        >
          {kpCreating ? '...' : t.next}
        </button>
      </>
    )}

    </div>
  );
}
