import { Sheet } from '@flower-studio/shared';
import DatePicker from './DatePicker.jsx';
import t from '../translations.js';

// Mobile filter drawer for the order list. Edits the shared order-filter
// object live (keepOpen) and closes on Apply / backdrop tap. Mirrors the
// dashboard OrdersTab per-column filters in a single stacked sheet.
export default function OrderFilterDrawer({ open, onClose, filter, onApply, onReset }) {
  // Each control fires onApply immediately so the list updates in real time.
  const set = (key, value) => onApply({ ...filter, [key]: value }, { keepOpen: true });
  return (
    <Sheet open={open} onClose={onClose} title={t.filters} t={t}>
      <div className="px-4 pb-4 space-y-3">
        <input className="field-input w-full" placeholder={t.customer}
          value={filter.customerQuery} onChange={e => set('customerQuery', e.target.value)} />
        <input className="field-input w-full" placeholder={t.bouquetComposition || 'Букет'}
          value={filter.bouquetQuery} onChange={e => set('bouquetQuery', e.target.value)} />
        {/* Delivery type segmented control */}
        <div className="flex gap-1.5">
          {['', 'Delivery', 'Pickup'].map(v => (
            <button key={v || 'all'} onClick={() => set('deliveryType', v)}
              className={`px-3 h-8 rounded-full text-xs font-medium ${filter.deliveryType === v ? 'bg-brand-600 text-white' : 'bg-gray-100 text-ios-secondary'}`}>
              {v === '' ? t.all : v === 'Delivery' ? t.deliveryType : t.pickup}
            </button>
          ))}
        </div>
        {/* Fulfilment date range */}
        <div className="flex items-center gap-1.5">
          <DatePicker value={filter.requiredByFrom} onChange={v => set('requiredByFrom', v)} placeholder={t.dateFrom} />
          <span className="text-xs text-ios-tertiary">—</span>
          <DatePicker value={filter.requiredByTo} onChange={v => set('requiredByTo', v)} placeholder={t.dateTo} />
        </div>
        {/* Price range */}
        <div className="flex items-center gap-1.5">
          <input type="number" className="field-input w-24" placeholder={t.filterMin}
            value={filter.priceMin ?? ''} onChange={e => set('priceMin', Number(e.target.value) || null)} />
          <span className="text-xs text-ios-tertiary">—</span>
          <input type="number" className="field-input w-24" placeholder={t.filterMax}
            value={filter.priceMax ?? ''} onChange={e => set('priceMax', Number(e.target.value) || null)} />
        </div>
        <div className="flex gap-2 pt-2">
          <button onClick={onReset} className="flex-1 h-10 rounded-xl bg-gray-100 text-ios-secondary text-sm font-medium">{t.resetFilters || t.clearAll}</button>
          <button onClick={onClose} className="flex-1 h-10 rounded-xl bg-brand-600 text-white text-sm font-medium">{t.apply || 'OK'}</button>
        </div>
      </div>
    </Sheet>
  );
}
