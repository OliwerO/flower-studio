// KanbanBoard — visual flow board showing today's orders as cards in status columns.
// Like a production line where work moves left to right through stages:
// New → Ready → Out for Delivery → Done (Delivered + Picked Up).
// Uses the same card style as the florist app: solid white cards inside soft frames.

import t from '../translations.js';

export default function KanbanBoard({ orders, onOrderClick }) {
  const COLUMNS = [
    { key: 'New', label: t.statusNew, statuses: ['New'], border: 'border-indigo-200/80', dot: 'bg-indigo-400' },
    { key: 'Ready', label: t.statusReady, statuses: ['Ready'], border: 'border-amber-200/80', dot: 'bg-amber-400' },
    { key: 'Out for Delivery', label: t.statusOutForDel, statuses: ['Out for Delivery'], border: 'border-sky-200/80', dot: 'bg-sky-400' },
    { key: 'Done', label: t.statusDone, statuses: ['Delivered', 'Picked Up'], border: 'border-emerald-200/80', dot: 'bg-emerald-400' },
  ];
  const columns = COLUMNS.map(col => ({
    ...col,
    orders: (orders || []).filter(o => col.statuses.includes(o.Status)),
  }));

  return (
    <div className="grid grid-cols-4 gap-3">
      {columns.map(col => (
        <div key={col.key} className={`rounded-2xl border ${col.border} bg-white/25 overflow-hidden`}>
          {/* Column header */}
          <div className="bg-white/40 text-xs font-semibold text-ios-secondary uppercase tracking-wider px-3 py-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${col.dot}`} />
              <span>{col.label}</span>
            </div>
            <span className="text-ios-tertiary text-[11px] font-bold">
              {col.orders.length}
            </span>
          </div>

          {/* Column body */}
          <div className="p-2 space-y-2 min-h-[120px]">
            {col.orders.length === 0 && (
              <div className="text-center text-ios-tertiary/40 text-xs py-8">—</div>
            )}
            {col.orders.map(order => (
              <KanbanCard
                key={order.id}
                order={order}
                onClick={() => onOrderClick?.(order)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function KanbanCard({ order, onClick }) {
  const isDelivery = order['Delivery Type'] === 'Delivery';
  const isPaid = order['Payment Status'] === 'Paid';
  const price = order['Final Price'] || order['Price Override'] || order['Sell Total'] || 0;

  // Bouquet summary: "3× Rose Red, 2× Tulip Pink"
  const bouquet = order['Bouquet Summary'] || order['Customer Request'] || '—';

  // Delivery info
  const address = order['Delivery Address'] || '';
  const timeSlot = order['Delivery Time'] || '';
  const driver = order['Assigned Driver'] || '';

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-xl shadow-sm px-3 py-2.5 cursor-pointer
                 hover:shadow-md transition-all active-scale"
    >
      {/* Customer name + price */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-ios-label truncate">
          {order['Customer Name'] || '—'}
        </span>
        <span className="text-[11px] font-medium text-ios-secondary">
          {price > 0 ? `${price.toFixed(0)} ${t.zl}` : ''}
        </span>
      </div>

      {/* Bouquet composition */}
      <div className="text-[11px] text-ios-tertiary truncate mt-0.5">
        {bouquet}
      </div>

      {/* Delivery details row */}
      <div className="flex items-center gap-1.5 mt-1 text-[10px] text-ios-secondary">
        <span>{isDelivery ? '🚗' : '🏪'}</span>
        {timeSlot && <span>{timeSlot}</span>}
        {isDelivery && address && (
          <span className="truncate max-w-[120px]">{address}</span>
        )}
      </div>

      {/* Driver + payment badges */}
      <div className="flex items-center justify-between mt-1">
        <div className="flex items-center gap-1.5">
          {driver && (
            <span className="text-[10px] text-ios-tertiary">{driver}</span>
          )}
        </div>
        {!isPaid && (
          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-600">
            {t.unpaid}
          </span>
        )}
      </div>

      {/* Picked Up / Delivered sub-label for Done column */}
      {(order.Status === 'Picked Up' || order.Status === 'Delivered') && (
        <div className={`text-[10px] mt-0.5 font-medium ${
          order.Status === 'Picked Up' ? 'text-teal-600' : 'text-emerald-600'
        }`}>
          {order.Status === 'Picked Up' ? `🏪 ${t.statusPickedUp}` : `✓ ${t.statusDelivered}`}
        </div>
      )}
    </div>
  );
}
