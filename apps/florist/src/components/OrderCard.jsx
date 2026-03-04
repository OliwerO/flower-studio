import t from '../translations.js';

const STATUS_STYLES = {
  'New':          { dot: 'bg-ios-blue',   label: 'bg-blue-50 text-blue-600' },
  'In Progress':  { dot: 'bg-ios-orange', label: 'bg-orange-50 text-orange-600' },
  'Ready':        { dot: 'bg-ios-green',  label: 'bg-green-50 text-green-700' },
  'Delivered':    { dot: 'bg-ios-tertiary', label: 'bg-gray-100 text-gray-500' },
  'Cancelled':    { dot: 'bg-ios-red',    label: 'bg-red-50 text-red-500' },
};

export default function OrderCard({ order, onClick }) {
  const status     = order['Status'] || 'New';
  const styles     = STATUS_STYLES[status] || STATUS_STYLES['New'];
  const isDelivery = order['Delivery Type'] === 'Delivery';
  const request    = order['Customer Request'] || '';
  const price      = order['Price Override'] || order['Sell Total'] || '';
  const isPaid     = order['Payment Status'] === 'Paid';

  return (
    <div onClick={onClick} className="bg-white rounded-2xl shadow-sm px-4 py-4 active:bg-ios-fill transition-colors cursor-pointer">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Status */}
          <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${styles.label}`}>
            {status}
          </span>
          {/* Type */}
          <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
            isDelivery ? 'bg-purple-50 text-purple-600' : 'bg-teal-50 text-teal-700'
          }`}>
            {isDelivery ? t.delivery : t.pickup}
          </span>
          {/* Payment */}
          <span className={`text-xs px-2.5 py-0.5 rounded-full ${
            isPaid ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-500'
          }`}>
            {isPaid ? t.paid : t.unpaid}
          </span>
        </div>
        {price > 0 && (
          <span className="text-base font-bold text-brand-600 shrink-0">{price} zł</span>
        )}
      </div>

      <p className="font-semibold text-ios-label">{order['Customer Name'] || '—'}</p>
      {request && (
        <p className="text-sm text-ios-tertiary mt-0.5 line-clamp-1">{request}</p>
      )}
      {order['Order Date'] && (
        <p className="text-xs text-ios-tertiary mt-1.5">{order['Order Date']}</p>
      )}
    </div>
  );
}
