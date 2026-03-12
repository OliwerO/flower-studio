import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';

import Step1Customer from '../components/steps/Step1Customer.jsx';
import Step2Bouquet  from '../components/steps/Step2Bouquet.jsx';
import Step3Details  from '../components/steps/Step3Details.jsx';
import Step4Review   from '../components/steps/Step4Review.jsx';

const emptyForm = {
  customerId: '', customerName: '',
  customerRequest: '', orderLines: [], priceOverride: '',
  source: 'In-store', deliveryType: 'Pickup',
  requiredBy: '', recipientName: '', recipientPhone: '',
  deliveryAddress: '', deliveryDate: '', deliveryTime: '',
  cardText: '', notes: '',
  paymentStatus: 'Unpaid', paymentMethod: '', deliveryFee: 35,
};

export default function NewOrderPage() {
  const STEPS = [t.step1, t.step2, t.step3, t.step4];
  const navigate              = useNavigate();
  const location              = useLocation();
  const { showToast }         = useToast();
  const [step, setStep]       = useState(0);
  const [form, setForm]       = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [stock, setStock]     = useState([]);
  const [stockError, setStockError] = useState(false);
  const [importWarnings, setImportWarnings] = useState([]);

  useEffect(() => {
    client.get('/stock?includeEmpty=true')
      .then(r => { setStock(r.data); setStockError(false); })
      .catch(err => {
        console.error('Failed to load stock:', err);
        setStockError(true);
        showToast(t.stockLoadError || 'Failed to load stock data', 'error');
      });
  }, []);

  // Protect against accidental navigation (browser back/refresh) when form has data.
  // Like a "save your work?" prompt when closing an unsaved document.
  useEffect(() => {
    const hasData = form.customerId || form.orderLines.length > 0 || form.customerRequest;
    if (!hasData) return;
    const handler = (e) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [form.customerId, form.orderLines.length, form.customerRequest]);

  // Apply import draft if navigated from TextImportModal
  useEffect(() => {
    const draft = location.state?.importDraft;
    if (!draft) return;

    // Clear navigation state so refreshing doesn't re-apply
    window.history.replaceState({}, '');

    const patch = {};
    if (draft.customerRequest) patch.customerRequest = draft.customerRequest;
    if (draft.source) patch.source = draft.source;
    if (draft.paymentStatus) patch.paymentStatus = draft.paymentStatus;
    if (draft.notes) patch.notes = draft.notes;
    if (draft.deliveryFee != null) patch.deliveryFee = draft.deliveryFee;
    if (draft.totalPrice) patch.priceOverride = String(draft.totalPrice);

    // Delivery fields
    if (draft.delivery?.address) {
      patch.deliveryType = 'Delivery';
      patch.deliveryAddress = draft.delivery.address;
    }
    if (draft.delivery?.recipientName) patch.recipientName = draft.delivery.recipientName;
    if (draft.delivery?.recipientPhone) patch.recipientPhone = draft.delivery.recipientPhone;
    if (draft.delivery?.date) patch.deliveryDate = draft.delivery.date;
    if (draft.delivery?.time) patch.deliveryTime = draft.delivery.time;
    if (draft.delivery?.cardText) patch.cardText = draft.delivery.cardText;

    // Order lines from AI matching
    if (draft.orderLines?.length > 0) {
      patch.orderLines = draft.orderLines.map(l => ({
        stockItemId:      l.stockItemId || null,
        flowerName:       l.flowerName || '',
        quantity:         l.quantity || 1,
        costPricePerUnit: l.costPricePerUnit || 0,
        sellPricePerUnit: l.sellPricePerUnit || 0,
        confidence:       l.confidence || 'none',
      }));
    }

    // Customer — if AI found a match, pre-select them
    if (draft.customer?.suggestedMatchId) {
      patch.customerId = draft.customer.suggestedMatchId;
      patch.customerName = draft.customer.suggestedMatchName || draft.customer.name || '';
      // Skip Step 1 (customer) and go to Step 2 (bouquet)
      setStep(1);
    } else if (draft.customer?.name || draft.customer?.phone) {
      // Pre-fill customer creation form — stays on Step 1
      patch.customerName = draft.customer.name || '';
    }

    setForm(prev => ({ ...prev, ...patch }));

    // Show warnings
    if (draft.warnings?.length > 0) {
      setImportWarnings(draft.warnings);
    }
  }, [location.state]);

  function updateForm(patch) {
    setForm(prev => ({ ...prev, ...patch }));
  }

  function updateLines(updaterFn) {
    setForm(prev => ({ ...prev, orderLines: updaterFn(prev.orderLines) }));
  }

  // Called by Step1Customer after a customer is selected or created → auto-advance
  function handleCustomerSelected(patch) {
    updateForm(patch);
    setStep(1);
  }

  // Validate before advancing to the next step
  function validateStep(currentStep) {
    if (currentStep === 1 && form.orderLines.length === 0) {
      showToast(t.bouquetRequired, 'error');
      return false;
    }
    if (currentStep === 2 && form.deliveryType === 'Delivery' && !form.deliveryAddress.trim()) {
      showToast(t.deliveryAddressRequired || 'Delivery address is required', 'error');
      return false;
    }
    return true;
  }

  function handleNext() {
    if (!validateStep(step)) return;
    setStep(step + 1);
  }

  async function handleSubmit() {
    // Final validation before API call
    if (!form.customerId) { showToast(t.customerRequired, 'error'); return; }
    if (form.orderLines.length === 0) { showToast(t.bouquetRequired, 'error'); return; }
    if (form.deliveryType === 'Delivery' && !form.deliveryAddress.trim()) {
      showToast(t.deliveryAddressRequired || 'Delivery address is required', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const body = {
        customer:        form.customerId,
        customerRequest: form.customerRequest,
        source:          form.source,
        deliveryType:    form.deliveryType,
        requiredBy:      form.requiredBy || null,
        notes:           form.notes,
        paymentStatus:   form.paymentStatus,
        paymentMethod:   form.paymentMethod,
        priceOverride:   form.priceOverride ? Number(form.priceOverride) : null,
        orderLines:      form.orderLines,
      };
      // Card text + date/time apply to both delivery and pickup
      body.cardText = form.cardText || '';
      body.requiredBy = form.deliveryDate || null;
      body.deliveryTime = form.deliveryTime || '';

      if (form.deliveryType === 'Delivery') {
        body.delivery = {
          address: form.deliveryAddress, recipientName: form.recipientName,
          recipientPhone: form.recipientPhone, date: form.deliveryDate,
          time: form.deliveryTime, cardText: form.cardText, fee: form.deliveryFee,
        };
      }
      await client.post('/orders', body);
      // Check if any non-deferred ordered items exceed available stock
      const negativeItems = form.orderLines.filter(l => {
        if (l.stockDeferred) return false; // deferred lines don't pull from inventory
        const si = stock.find(s => s.id === l.stockItemId);
        if (!si) return false;
        const available = Number(si['Current Quantity']) || 0;
        return l.quantity > available;
      });
      if (negativeItems.length > 0) {
        showToast(t.negativeStockWarning, 'warning');
      } else {
        showToast(t.orderSubmitted, 'success');
      }
      navigate('/orders');
    } catch (err) {
      const detail = err.response?.data?.error || err.message || t.submitError;
      console.error('Submit failed:', err.response?.data || err);
      showToast(detail, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  // Totals computed here (authoritative state) and passed as props — prevents stale-closure bugs
  const costTotal   = form.orderLines.reduce((s, l) => s + Number(l.costPricePerUnit) * Number(l.quantity), 0);
  const sellTotal   = form.orderLines.reduce((s, l) => s + Number(l.sellPricePerUnit) * Number(l.quantity), 0);
  const deliveryFee = form.deliveryType === 'Delivery' ? (Number(form.deliveryFee) || 0) : 0;
  const orderTotal  = (form.priceOverride ? Number(form.priceOverride) : sellTotal) + deliveryFee;

  return (
    <div className="min-h-screen">
      {/* Navigation bar */}
      <header className="glass-nav px-4 pt-3 pb-2 sticky top-0 z-10">
        <div className="flex items-center justify-between max-w-2xl mx-auto mb-3">
          <button
            onClick={() => step === 0 ? navigate('/orders') : setStep(step - 1)}
            className="text-brand-600 font-medium text-base flex items-center gap-1 py-1 active-scale"
          >
            ‹ {step === 0 ? t.cancel : t.back}
          </button>
          <h1 className="text-base font-semibold text-ios-label">{t.newOrderTitle}</h1>
          <span key={step} className="text-sm font-semibold text-brand-600 w-16 text-right">{step + 1} / {STEPS.length}</span>
        </div>

        {/* Segmented progress */}
        <div className="flex gap-1.5 max-w-2xl mx-auto">
          {STEPS.map((label, i) => (
            <div key={i} className="flex-1">
              <div className={`h-1 rounded-full transition-all duration-300 ${
                i < step ? 'bg-brand-400' : i === step ? 'bg-brand-600' : 'bg-ios-fill2'
              }`} />
            </div>
          ))}
        </div>
        <div className="flex max-w-2xl mx-auto mt-1">
          {STEPS.map((label, i) => (
            <button
              key={i}
              onClick={() => { if (i < step) setStep(i); }}
              className={`flex-1 text-center py-0.5 ${i < step ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <span className={`text-[11px] font-medium ${i === step ? 'text-brand-600' : i < step ? 'text-ios-secondary' : 'text-ios-tertiary'}`}>
                {label}
              </span>
            </button>
          ))}
        </div>
      </header>

      {/* Stock load error banner */}
      {stockError && (
        <div className="max-w-2xl mx-auto px-4 mt-2">
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center justify-between">
            <span className="text-red-700 text-sm font-medium">
              {t.stockLoadError || 'Failed to load stock. Bouquet builder may not work.'}
            </span>
            <button
              onClick={() => {
                client.get('/stock')
                  .then(r => { setStock(r.data); setStockError(false); })
                  .catch(() => showToast(t.stockLoadError || 'Still unable to load stock', 'error'));
              }}
              className="text-red-600 text-sm font-semibold ml-3 shrink-0"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Import warnings banner */}
      {importWarnings.length > 0 && (
        <div className="max-w-2xl mx-auto px-4 mt-2">
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-amber-800 text-xs font-semibold uppercase tracking-wide">{t.intake.warningsTitle}</span>
              <button onClick={() => setImportWarnings([])} className="text-amber-600 text-xs font-medium">✕</button>
            </div>
            {importWarnings.map((w, i) => (
              <p key={i} className="text-amber-700 text-sm">{w}</p>
            ))}
          </div>
        </div>
      )}

      {/* Step content */}
      <main className="max-w-2xl mx-auto px-4 py-5 pb-36">
        {step === 0 && (
          <Step1Customer
            customerId={form.customerId}
            customerName={form.customerName}
            onSelect={handleCustomerSelected}
            onChange={updateForm}
          />
        )}
        {step === 1 && (
          <Step2Bouquet
            customerRequest={form.customerRequest}
            orderLines={form.orderLines}
            priceOverride={form.priceOverride}
            stock={stock}
            onStockRefresh={() => client.get('/stock').then(r => { setStock(r.data); setStockError(false); }).catch(() => { setStockError(true); showToast(t.stockLoadError, 'error'); })}
            onChange={updateForm}
            onLinesChange={updateLines}
            requiredBy={form.deliveryDate || form.requiredBy}
          />
        )}
        {step === 2 && <Step3Details form={form} onChange={updateForm} />}
        {step === 3 && (
          <Step4Review
            form={form}
            orderTotal={orderTotal}
            deliveryFee={deliveryFee}
            onEdit={setStep} onSubmit={handleSubmit} submitting={submitting}
          />
        )}
      </main>

      {/* Next button — steps 1 and 2 only (step 0 auto-advances, step 3 has its own submit) */}
      {step >= 1 && step < 3 && (
        <div className="fixed bottom-0 left-0 right-0 glass-bar px-4 py-4 pb-6">
          <div className="max-w-2xl mx-auto">
            <button
              onClick={handleNext}
              disabled={(step === 1 && form.orderLines.length === 0) || (step === 1 && stockError)}
              className="w-full h-14 rounded-2xl bg-brand-600 text-white text-base font-semibold
                         disabled:opacity-30 active:bg-brand-700 transition-colors shadow-lg active-scale"
            >
              {t.next} →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
