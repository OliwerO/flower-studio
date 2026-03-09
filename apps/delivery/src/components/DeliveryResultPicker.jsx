// DeliveryResultPicker — modal shown when a driver marks a delivery as done.
// Instead of a simple "confirm?", the driver reports the outcome.
// Like a quality inspection gate at the end of the line: what was the result?

import t from '../translations.js';

// SYNC: values must match VALID_DELIVERY_RESULTS in backend/src/routes/deliveries.js
// Only non-success options — "Success" is handled by the regular "Mark Delivered" button.
const PROBLEMS = [
  { value: 'Not Home',      icon: '🏠', color: 'bg-amber-500' },
  { value: 'Wrong Address', icon: '📍', color: 'bg-orange-500' },
  { value: 'Refused',       icon: '✕', color: 'bg-red-500' },
  { value: 'Incomplete',    icon: '⚠', color: 'bg-yellow-500' },
];

export default function DeliveryResultPicker({ onSelect, onCancel }) {
  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onCancel} />

      {/* Modal */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl shadow-2xl
                      animate-slide-up px-5 pb-8 pt-4">
        <div className="flex justify-center pb-3">
          <div className="w-10 h-1 rounded-full bg-ios-separator" />
        </div>

        <h3 className="text-base font-bold text-ios-label text-center mb-4">
          {t.deliveryProblem}
        </h3>

        <div className="space-y-2">
          {PROBLEMS.map(r => (
            <button
              key={r.value}
              onClick={() => onSelect(r.value)}
              className={`w-full h-12 rounded-2xl text-white text-sm font-semibold
                         flex items-center justify-center gap-2 active:opacity-80 active-scale
                         shadow-md ${r.color}`}
            >
              {r.icon} {t[`result_${r.value.replace(/\s/g, '_').toLowerCase()}`] || r.value}
            </button>
          ))}
        </div>

        <button
          onClick={onCancel}
          className="w-full mt-3 h-10 rounded-2xl bg-gray-100 text-ios-secondary text-sm font-medium
                     active:bg-gray-200 active-scale"
        >
          {t.cancel}
        </button>
      </div>
    </>
  );
}
