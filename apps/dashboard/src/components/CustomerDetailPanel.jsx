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
      {/* Contact info grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <EditableField label={t.name} value={cust.Name} field="Name" onSave={patchField} />
        <EditableField label={t.nickname} value={cust.Nickname} field="Nickname" onSave={patchField} />
        <EditableField label={t.phone} value={cust.Phone} field="Phone" onSave={patchField} />
        <EditableField label={t.email} value={cust.Email} field="Email" onSave={patchField} />
        <EditableField label={t.instagram} value={cust.Link} field="Link" onSave={patchField} />
        <div>
          <p className="text-xs text-ios-tertiary mb-1">{t.segment}</p>
          <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${
            cust.Segment === 'DO NOT CONTACT' ? 'bg-ios-red/15 text-ios-red' :
            cust.Segment === 'Constant' ? 'bg-ios-green/15 text-ios-green' :
            'bg-gray-100 text-gray-600'
          }`}>
            {cust.Segment || '—'}
          </span>
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
                      {(o['Final Price'] || o['Sell Total'] || 0).toFixed(0)} {t.zl}
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
