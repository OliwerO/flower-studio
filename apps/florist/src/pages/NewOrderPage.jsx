import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import t from '../translations.js';

import Step1Customer from '../components/steps/Step1Customer.jsx';
import Step2Bouquet  from '../components/steps/Step2Bouquet.jsx';
import Step3Details  from '../components/steps/Step3Details.jsx';
import Step4Review   from '../components/steps/Step4Review.jsx';

const STEPS = [t.step1, t.step2, t.step3, t.step4];

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
  const navigate              = useNavigate();
  const { showToast }         = useToast();
  const [step, setStep]       = useState(0);
  const [form, setForm]       = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [stock, setStock]     = useState([]);

  useEffect(() => {
    client.get('/stock').then(r => setStock(r.data)).catch(console.error);
  }, []);

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

  async function handleSubmit() {
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
      if (form.deliveryType === 'Delivery') {
        body.delivery = {
          address: form.deliveryAddress, recipientName: form.recipientName,
          recipientPhone: form.recipientPhone, date: form.deliveryDate,
          time: form.deliveryTime, cardText: form.cardText, fee: form.deliveryFee,
        };
      }
      await client.post('/orders', body);
      showToast(t.orderSubmitted, 'success');
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
            onStockRefresh={() => client.get('/stock').then(r => setStock(r.data))}
            onChange={updateForm}
            onLinesChange={updateLines}
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
              onClick={() => setStep(step + 1)}
              disabled={step === 1 && form.orderLines.length === 0}
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
