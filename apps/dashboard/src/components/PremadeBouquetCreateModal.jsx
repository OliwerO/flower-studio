// PremadeBouquetCreateModal — inline modal on the dashboard for composing a
// premade bouquet without a customer. Reuses Step2Bouquet for the flower picker.
//
// The dashboard is a single-page tab UI with no router, so we use a modal
// rather than a dedicated page. Open from PremadeBouquetList.

import { useState, useEffect } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';

import Step2Bouquet from './steps/Step2Bouquet.jsx';

const emptyForm = {
  name: '',
  notes: '',
  customerRequest: '',
  orderLines: [],
  priceOverride: '',
};

export default function PremadeBouquetCreateModal({ onClose, onCreated }) {
  const { showToast } = useToast();
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [stock, setStock] = useState([]);

  useEffect(() => {
    client.get('/stock?includeEmpty=true&includeInactive=true').then(r => setStock(r.data)).catch(console.error);
  }, []);

  function updateForm(patch) {
    setForm(prev => ({ ...prev, ...patch }));
  }
  function updateLines(updaterFn) {
    setForm(prev => ({ ...prev, orderLines: updaterFn(prev.orderLines) }));
  }

  async function handleSave() {
    if (!form.name.trim()) {
      showToast(t.premadeBouquetNameRequired, 'error');
      return;
    }
    if (form.orderLines.length === 0) {
      showToast(t.premadeBouquetLinesRequired, 'error');
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        name: form.name.trim(),
        notes: form.notes || '',
        priceOverride: form.priceOverride ? Number(form.priceOverride) : null,
        lines: form.orderLines.map(l => ({
          stockItemId: l.stockItemId || null,
          flowerName: l.flowerName,
          quantity: l.quantity,
          costPricePerUnit: l.costPricePerUnit || 0,
          sellPricePerUnit: l.sellPricePerUnit || 0,
        })),
      };
      const res = await client.post('/premade-bouquets', body);
      showToast(t.premadeSaved, 'success');
      onCreated?.(res.data);
      onClose();
    } catch (err) {
      const detail = err.response?.data?.error || err.message || t.premadeSaveError;
      console.error('Failed to save premade bouquet:', err);
      showToast(detail, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ios-label">{t.premadeBouquetTitle}</h2>
          <button
            onClick={onClose}
            className="text-ios-tertiary hover:text-ios-label text-xl leading-none"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div>
            <p className="ios-label">{t.premadeBouquetName} *</p>
            <div className="ios-card flex items-center px-4">
              <input
                type="text"
                value={form.name}
                onChange={e => updateForm({ name: e.target.value })}
                placeholder={t.premadeBouquetNameHint}
                className="flex-1 py-3 text-base text-ios-label bg-transparent outline-none placeholder-ios-tertiary/50"
                autoFocus
              />
            </div>
          </div>

          <div>
            <p className="ios-label">{t.premadeBouquetNotes}</p>
            <div className="ios-card px-4 py-3">
              <textarea
                value={form.notes}
                onChange={e => updateForm({ notes: e.target.value })}
                placeholder={t.premadeBouquetNotesHint}
                rows={2}
                className="w-full text-sm text-ios-label bg-transparent outline-none resize-none placeholder-ios-tertiary/50"
              />
            </div>
          </div>

          <Step2Bouquet
            customerRequest={form.customerRequest}
            orderLines={form.orderLines}
            priceOverride={form.priceOverride}
            stock={stock}
            /* Physical compose flow — no pending-PO stems allowed. */
            onlyPhysicallyAvailable
            onStockRefresh={() => client.get('/stock?includeEmpty=true&includeInactive=true').then(r => setStock(r.data))}
            onChange={updateForm}
            onLinesChange={updateLines}
            requiredBy={null}
          />
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-xl bg-gray-100 text-ios-secondary text-sm font-medium disabled:opacity-30"
          >
            {t.cancel}
          </button>
          <button
            onClick={handleSave}
            disabled={submitting || !form.name.trim() || form.orderLines.length === 0}
            className="px-6 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold disabled:opacity-30 active:bg-brand-700"
          >
            {submitting ? t.loading : t.savePremadeBouquet}
          </button>
        </div>
      </div>
    </div>
  );
}
