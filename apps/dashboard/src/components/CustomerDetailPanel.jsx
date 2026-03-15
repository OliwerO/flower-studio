// CustomerDetailPanel — full customer profile with editable fields and order history.

import { useState, useEffect } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';

export default function CustomerDetailPanel({ customerId, onUpdate }) {
  const [cust, setCust]       = useState(null);
  const [orders, setOrders]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [custRes, ordersRes] = await Promise.all([
          client.get(`/customers/${customerId}`),
          client.get('/orders', { params: {} }),
        ]);
        setCust(custRes.data);
        // Filter orders that belong to this customer
        const custOrders = ordersRes.data.filter(o =>
          o.Customer?.[0] === customerId
        );
        setOrders(custOrders);
      } catch {
        showToast(t.error, 'error');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [customerId, showToast]);

  async function patchField(field, value) {
    setSaving(true);
    try {
      await client.patch(`/customers/${customerId}`, { [field]: value });
      showToast(t.customerUpdated);
      setCust(prev => ({ ...prev, [field]: value }));
    } catch {
      showToast(t.error, 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="px-4 py-6 flex justify-center">
        <div className="w-6 h-6 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!cust) return null;

  return (
    <div className="border-t border-white/40 px-4 py-4 bg-white/20 space-y-4">
      {/* Lifetime summary — computed from order history */}
      {orders.length > 0 && (() => {
        const totalSpend = orders.reduce((sum, o) => sum + (o['Effective Price'] || o['Price Override'] || o['Final Price'] || 0), 0);
        const avgOrderValue = Math.round(totalSpend / orders.length);

        // Avg days between orders
        const sortedDates = orders.map(o => new Date(o['Order Date'])).filter(d => !isNaN(d)).sort((a, b) => a - b);
        let avgDaysBetween = 0;
        if (sortedDates.length > 1) {
          const gaps = [];
          for (let i = 1; i < sortedDates.length; i++) {
            gaps.push((sortedDates[i] - sortedDates[i-1]) / 86400000);
          }
          avgDaysBetween = Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length);
        }

        // Preferred source
        const sourceCounts = {};
        for (const o of orders) {
          const src = o.Source || 'Unknown';
          sourceCounts[src] = (sourceCounts[src] || 0) + 1;
        }
        const preferredSource = Object.entries(sourceCounts).sort(([,a],[,b]) => b - a)[0]?.[0] || '\u2014';

        const firstDate = sortedDates[0]?.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });

        return (
          <div className="grid grid-cols-4 gap-3 mb-4">
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <div className="text-lg font-bold text-brand-700">{orders.length}</div>
              <div className="text-xs text-ios-tertiary">{t.orderCount}</div>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <div className="text-lg font-bold text-brand-700">{avgOrderValue} {t.zl}</div>
              <div className="text-xs text-ios-tertiary">{t.avgOrderVal}</div>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <div className="text-lg font-bold text-brand-700">{avgDaysBetween > 0 ? `${avgDaysBetween}d` : '\u2014'}</div>
              <div className="text-xs text-ios-tertiary">{t.avgTimeBetween}</div>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <div className="text-lg font-bold text-brand-700">{preferredSource}</div>
              <div className="text-xs text-ios-tertiary">{t.preferredChannel}</div>
            </div>
          </div>
        );
      })()}

      {/* Prominent contact info — quick access for calling/messaging */}
      <div className="bg-white/40 rounded-xl px-4 py-3 flex flex-wrap items-center gap-4">
        {cust.Phone && (
          <a href={`tel:${cust.Phone.replace(/\s/g, '')}`} className="flex items-center gap-1.5 text-sm text-ios-blue font-medium active:underline">
            <span>&#128241;</span> {cust.Phone}
          </a>
        )}
        {cust.Email && (
          <a href={`mailto:${cust.Email}`} className="flex items-center gap-1.5 text-sm text-ios-blue font-medium active:underline">
            <span>&#9993;</span> {cust.Email}
          </a>
        )}
        {cust.Link && (
          <a href={cust.Link.startsWith('http') ? cust.Link : `https://instagram.com/${cust.Link.replace(/^@/, '')}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm text-ios-blue font-medium active:underline">
            <span>&#127760;</span> {cust.Link}
          </a>
        )}
      </div>

      {/* Contact info grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <EditableField label={t.name} value={cust.Name} field="Name" onSave={patchField} />
        <EditableField label={t.nickname} value={cust.Nickname} field="Nickname" onSave={patchField} />
        <EditableField label={t.phone} value={cust.Phone} field="Phone" onSave={patchField} />
        <EditableField label={t.email} value={cust.Email} field="Email" onSave={patchField} />
        <EditableField label={t.instagram} value={cust.Link} field="Link" onSave={patchField} />
        <div>
          <p className="text-xs text-ios-tertiary mb-1">{t.segment}</p>
          <select
            value={cust.Segment || ''}
            onChange={e => patchField('Segment', e.target.value || null)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border-0 outline-none cursor-pointer ${
              cust.Segment === 'DO NOT CONTACT' ? 'bg-ios-red/15 text-ios-red' :
              cust.Segment === 'Constant' ? 'bg-ios-green/15 text-ios-green' :
              cust.Segment === 'New' ? 'bg-ios-blue/15 text-ios-blue' :
              cust.Segment === 'Rare' ? 'bg-ios-orange/15 text-ios-orange' :
              'bg-gray-100 text-gray-600'
            }`}
          >
            <option value="">—</option>
            <option value="New">New</option>
            <option value="Constant">Constant</option>
            <option value="Rare">Rare</option>
            <option value="DO NOT CONTACT">DO NOT CONTACT</option>
          </select>
          {/* Show auto-computed segment when no manual segment is set */}
          {!cust.Segment && cust.computedSegment && (
            <p className="text-[10px] text-ios-tertiary mt-1">Auto: {cust.computedSegment}</p>
          )}
        </div>
      </div>

      {/* Key persons */}
      {(cust['Key person 1'] || cust['Key person 2']) && (
        <div className="grid grid-cols-2 gap-3">
          {cust['Key person 1'] && (
            <div className="bg-white/30 rounded-xl px-3 py-2">
              <p className="text-xs text-ios-tertiary">{t.keyPerson} 1</p>
              <p className="text-sm text-ios-label">{cust['Key person 1']}</p>
              {cust['Key person 1 (important DATE)'] && (
                <p className="text-xs text-brand-600 mt-1">
                  {t.importantDate}: {cust['Key person 1 (important DATE)']}
                </p>
              )}
            </div>
          )}
          {cust['Key person 2'] && (
            <div className="bg-white/30 rounded-xl px-3 py-2">
              <p className="text-xs text-ios-tertiary">{t.keyPerson} 2</p>
              <p className="text-sm text-ios-label">{cust['Key person 2']}</p>
              {cust['Key person 2 (important DATE)'] && (
                <p className="text-xs text-brand-600 mt-1">
                  {t.importantDate}: {cust['Key person 2 (important DATE)']}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Preferences */}
      <EditableField
        label={t.preferences}
        value={cust['Notes / Preferences']}
        field="Notes / Preferences"
        onSave={patchField}
        multiline
      />

      {/* Flowers ordered — aggregated from all order bouquet summaries */}
      {orders.length > 0 && (() => {
        // Parse "5x Roses, 3x Tulips" from Bouquet Summary across all orders
        const flowerMap = {};
        for (const o of orders) {
          const summary = o['Bouquet Summary'] || '';
          if (!summary) continue;
          for (const part of summary.split(',')) {
            const match = part.trim().match(/^(\d+)\s*[x×]\s*(.+)$/i);
            if (match) {
              const qty = parseInt(match[1], 10);
              const name = match[2].trim();
              flowerMap[name] = (flowerMap[name] || 0) + qty;
            }
          }
        }
        const flowerList = Object.entries(flowerMap)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 15);

        if (flowerList.length === 0) return null;
        return (
          <div>
            <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-2">
              {t.flowersOrdered || 'Flowers ordered'}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {flowerList.map(([name, qty]) => (
                <span key={name} className="text-xs bg-brand-50 text-brand-700 px-2.5 py-1 rounded-full font-medium">
                  {qty}x {name}
                </span>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Order history */}
      <div>
        <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-2">
          {t.orderHistory} ({orders.length})
        </p>
        {orders.length === 0 ? (
          <p className="text-sm text-ios-tertiary">{t.noResults}</p>
        ) : (
          <div className="bg-white/40 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-ios-tertiary border-b border-white/40">
                  <th className="text-left px-3 py-2 font-medium">{t.date}</th>
                  <th className="text-left px-3 py-2 font-medium">{t.request}</th>
                  <th className="text-left px-3 py-2 font-medium">{t.status}</th>
                  <th className="text-right px-3 py-2 font-medium">{t.price}</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.id} className="border-b border-white/20">
                    <td className="px-3 py-2 text-ios-tertiary">{o['Order Date']}</td>
                    <td className="px-3 py-2 truncate max-w-[200px]">{o['Customer Request'] || '—'}</td>
                    <td className="px-3 py-2">
                      <span className="text-xs">{o.Status}</span>
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      {(o['Final Price'] || o['Price Override'] || o['Sell Price Total'] || 0).toFixed(0)} {t.zl}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// Inline editable field — click to edit, blur to save
function EditableField({ label, value, field, onSave, multiline }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value || '');

  function commit() {
    setEditing(false);
    if (draft !== (value || '')) onSave(field, draft);
  }

  return (
    <div>
      <p className="text-xs text-ios-tertiary mb-1">{label}</p>
      {!editing ? (
        <span
          onClick={() => setEditing(true)}
          className={`text-sm cursor-pointer hover:bg-white/40 rounded px-1 -mx-1 block ${
            value ? 'text-ios-label' : 'text-ios-tertiary'
          }`}
        >
          {value || '—'}
        </span>
      ) : multiline ? (
        <textarea
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          rows={2}
          className="field-input w-full resize-none"
        />
      ) : (
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => e.key === 'Enter' && commit()}
          className="field-input w-full"
        />
      )}
    </div>
  );
}
