// NewOrderTab — order creation wizard adapted from the florist app.
// Renders as tab content (not a separate page). After submit, navigates to Orders tab.

import { useState, useEffect } from 'react';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';

import Step1Customer from './steps/Step1Customer.jsx';
import Step2Bouquet  from './steps/Step2Bouquet.jsx';
import Step3Details  from './steps/Step3Details.jsx';
import Step4Review   from './steps/Step4Review.jsx';

const emptyForm = {
  customerId: '', customerName: '',
  customerRequest: '', orderLines: [], priceOverride: '',
  source: 'In-store', deliveryType: 'Pickup',
  recipientName: '', recipientPhone: '',
  deliveryAddress: '', deliveryDate: '', deliveryTime: '',
  cardText: '', notes: '',
  paymentStatus: 'Unpaid', paymentMethod: '', deliveryFee: 35,
};

export default function NewOrderTab({ onNavigate }) {
  const STEPS = [t.step1, t.step2, t.step3, t.step4];
  const { showToast }         = useToast();
  const [step, setStep]       = useState(0);
  const [form, setForm]       = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [stock, setStock]     = useState([]);

  useEffect(() => {
    client.get('/stock?includeEmpty=true').then(r => setStock(r.data)).catch(console.error);
  }, []);

  function updateForm(patch) {
    setForm(prev => ({ ...prev, ...patch }));
  }

  function updateLines(updaterFn) {
    setForm(prev => ({ ...prev, orderLines: updaterFn(prev.orderLines) }));
  }

  function handleCustomerSelected(patch) {
    updateForm(patch);
    setStep(1);
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const body = {
        customer:        form.customerId,
        customerRequest: form.customerRequest,
        source:          form.source,
        deliveryType:    form.deliveryType,
        requiredBy:      form.deliveryDate || null,
        deliveryTime:    form.deliveryTime || '',
        cardText:        form.cardText || '',
        notes:           form.notes,
        paymentStatus:   form.paymentStatus,
        paymentMethod:   form.paymentMethod,
        priceOverride:   form.priceOverride ? Number(form.priceOverride) : null,
        orderLines:      form.orderLines,
      };
      if (form.deliveryType === 'Delivery') {
        body.delivery = {
          address: form.deliveryAddress, recipientName: form.recipientName,
          recipientPhone: form.recipientPhone, date: form.deliveryDate || null,
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
      // Navigate to orders tab to see the new order
      onNavigate?.({ tab: 'orders' });
    } catch (err) {
      const detail = err.response?.data?.error || err.message || t.submitError;
      console.error('Submit failed:', err.response?.data || err);
      showToast(detail, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const costTotal   = form.orderLines.reduce((s, l) => s + Number(l.costPricePerUnit) * Number(l.quantity), 0);
  const sellTotal   = form.orderLines.reduce((s, l) => s + Number(l.sellPricePerUnit) * Number(l.quantity), 0);
  const deliveryFee = form.deliveryType === 'Delivery' ? (Number(form.deliveryFee) || 0) : 0;
  const orderTotal  = (form.priceOverride ? Number(form.priceOverride) : sellTotal) + deliveryFee;

  return (
    <div>
      {/* Progress bar + step labels */}
      <div className="glass-card px-4 py-3 mb-6">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => step > 0 && setStep(step - 1)}
            disabled={step === 0}
            className="text-brand-600 font-medium text-sm disabled:opacity-30"
          >
            &#8249; {t.back}
          </button>
          <h2 className="text-base font-semibold text-ios-label">{t.newOrderTitle}</h2>
          <span className="text-sm font-semibold text-brand-600 w-16 text-right">{step + 1} / {STEPS.length}</span>
        </div>

        <div className="flex gap-1.5">
          {STEPS.map((label, i) => (
            <div key={i} className="flex-1">
              <div className={`h-1 rounded-full transition-all duration-300 ${
                i < step ? 'bg-brand-400' : i === step ? 'bg-brand-600' : 'bg-ios-fill2'
              }`} />
            </div>
          ))}
        </div>
        <div className="flex mt-1">
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
      </div>

      {/* Step content */}
      <div className="max-w-2xl mx-auto">
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
            onStockRefresh={() => client.get('/stock').then(r => setStock(r.data))}
            onChange={updateForm}
            onLinesChange={updateLines}
            requiredBy={form.deliveryDate}
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
      </div>

      {/* Next button — steps 1 and 2 only */}
      {step >= 1 && step < 3 && (
        <div className="max-w-2xl mx-auto mt-6">
          <button
            onClick={() => setStep(step + 1)}
            disabled={step === 1 && form.orderLines.length === 0}
            className="w-full h-14 rounded-2xl bg-brand-600 text-white text-base font-semibold
                       disabled:opacity-30 active:bg-brand-700 transition-colors shadow-lg"
          >
            {t.next} &#8594;
          </button>
        </div>
      )}
    </div>
  );
}
