// PremadeBouquetCreatePage — compose a premade bouquet without a customer.
//
// Reuses Step2Bouquet (the flower picker + cart + totals) because that's exactly
// what we need: pick flowers, snapshot prices, allow custom flowers. Above the
// picker we add a Name field (required) and an optional Notes field; below,
// the Save button posts to /api/premade-bouquets.
//
// On save the user is returned to the orders list with the premade filter
// pre-selected so the new bouquet is immediately visible.

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';

import Step2Bouquet from '../components/steps/Step2Bouquet.jsx';

const emptyForm = {
  name: '',
  notes: '',
  customerRequest: '',
  orderLines: [],
  priceOverride: '',
};

export default function PremadeBouquetCreatePage() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const isOwner = role === 'owner';
  const { showToast } = useToast();
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [stock, setStock] = useState([]);
  const [stockError, setStockError] = useState(false);

  useEffect(() => {
    client.get('/stock?includeEmpty=true')
      .then(r => { setStock(r.data); setStockError(false); })
      .catch(err => {
        console.error('Failed to load stock:', err);
        setStockError(true);
        showToast(t.stockLoadError || 'Failed to load stock data', 'error');
      });
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
      await client.post('/premade-bouquets', body);
      showToast(t.premadeSaved, 'success');
      setForm(emptyForm);
      navigate('/orders');
    } catch (err) {
      const detail = err.response?.data?.error || err.message || t.premadeSaveError;
      console.error('Failed to save premade bouquet:', err);
      showToast(detail, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const canSave =
    !submitting &&
    !stockError &&
    form.name.trim().length > 0 &&
    form.orderLines.length > 0;

  return (
    <div className="min-h-screen">
      {/* Nav */}
      <header className="glass-nav px-4 pt-3 pb-2 sticky top-0 z-10">
        <div className="flex items-center justify-between max-w-2xl mx-auto mb-1">
          <button
            onClick={() => navigate('/orders')}
            className="text-brand-600 font-medium text-base flex items-center gap-1 py-1 active-scale"
          >
            ‹ {t.cancel}
          </button>
          <h1 className="text-base font-semibold text-ios-label">{t.premadeBouquetTitle}</h1>
          <span className="w-16" />
        </div>
      </header>

      {stockError && (
        <div className="max-w-2xl mx-auto px-4 mt-2">
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <span className="text-red-700 text-sm font-medium">
              {t.stockLoadError || 'Failed to load stock.'}
            </span>
          </div>
        </div>
      )}

      <main className="max-w-2xl mx-auto px-4 py-5 pb-36 flex flex-col gap-4">
        {/* Name field — required */}
        <div>
          <p className="ios-label">{t.premadeBouquetName} *</p>
          <div className="ios-card flex items-center px-4">
            <input
              type="text"
              value={form.name}
              onChange={e => updateForm({ name: e.target.value })}
              placeholder={t.premadeBouquetNameHint}
              className="flex-1 py-3.5 text-base text-ios-label bg-transparent outline-none placeholder-ios-tertiary/50"
              autoFocus
            />
          </div>
        </div>

        {/* Notes field — optional */}
        <div>
          <p className="ios-label">{t.premadeBouquetNotes}</p>
          <div className="ios-card px-4 py-3">
            <textarea
              value={form.notes}
              onChange={e => updateForm({ notes: e.target.value })}
              placeholder={t.premadeBouquetNotesHint}
              rows={2}
              className="w-full text-base text-ios-label bg-transparent outline-none resize-none placeholder-ios-tertiary/50"
            />
          </div>
        </div>

        {/* Flower picker + cart — reuses Step 2 of the order wizard.
            Custom request and requiredBy don't apply here — we pass empty values. */}
        <Step2Bouquet
          customerRequest={form.customerRequest}
          orderLines={form.orderLines}
          priceOverride={form.priceOverride}
          stock={stock}
          isOwner={isOwner}
          /* Premade compose flow: only stems that physically exist today are
             eligible. Avoids adding flowers that are still in a pending PO. */
          onlyPhysicallyAvailable
          onStockRefresh={() => client
            .get('/stock?includeEmpty=true')
            .then(r => { setStock(r.data); setStockError(false); })
            .catch(() => { setStockError(true); showToast(t.stockLoadError, 'error'); })}
          onChange={updateForm}
          onLinesChange={updateLines}
          requiredBy={null}
        />
      </main>

      {/* Save button — bottom bar */}
      <div className="fixed bottom-16 left-0 right-0 glass-bar px-4 py-4 pb-6 z-20">
        <div className="max-w-2xl mx-auto">
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="w-full h-14 rounded-2xl bg-brand-600 text-white text-base font-semibold
                       disabled:opacity-30 active:bg-brand-700 transition-colors shadow-lg active-scale"
          >
            {submitting ? t.loading : t.savePremadeBouquet}
          </button>
        </div>
      </div>
    </div>
  );
}
