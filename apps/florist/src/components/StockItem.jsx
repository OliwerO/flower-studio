import t from '../translations.js';

export default function StockItem({ item, onAdjust }) {
  const qty       = item['Current Quantity'] || 0;
  const threshold = item['Low Stock Threshold'] || 5;
  const isLow     = qty > 0 && qty <= threshold;
  const isOut     = qty <= 0;

  const dotColor = isOut ? 'bg-ios-red' : isLow ? 'bg-ios-orange' : 'bg-ios-green';
  const qtyColor = isOut ? 'text-ios-red' : isLow ? 'text-ios-orange' : 'text-ios-label';

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ios-label truncate">{item['Display Name']}</p>
        <p className="text-xs text-ios-tertiary">
          {item['Current Cost Price'] || 0} zł cost · {item['Current Sell Price'] || 0} zł sell
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          onPointerDown={() => onAdjust(-1)}
          className="w-8 h-8 rounded-full bg-ios-fill2 text-ios-secondary text-xl font-bold
                     flex items-center justify-center active:bg-ios-separator active-scale"
        >
          −
        </button>
        <span className={`w-8 text-center font-bold text-sm ${qtyColor}`}>{qty}</span>
        <button
          onPointerDown={() => onAdjust(+1)}
          className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 text-xl font-bold
                     flex items-center justify-center active:bg-brand-200 active-scale"
        >
          +
        </button>
      </div>
    </div>
  );
}
