// TopProductsWidget — shows best-selling flowers this period.
// Like a product velocity report: which items move fastest?

import t from '../translations.js';

export default function TopProductsWidget({ products }) {
  if (!products || products.length === 0) return null;

  const maxRevenue = Math.max(...products.map(p => p.revenue || 0), 1);

  return (
    <div className="glass-card px-4 py-4">
      <h3 className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-3">
        {t.bestSellers}
      </h3>
      <div className="space-y-2">
        {products.slice(0, 10).map((p, i) => (
          <div key={p.name} className="flex items-center gap-3">
            <span className="text-xs text-ios-tertiary w-5 text-right font-medium">
              {i + 1}
            </span>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-ios-label">{p.name}</span>
                <span className="text-xs text-ios-tertiary">
                  {p.totalQty} {t.stemsSold} · {p.count} {t.timesOrdered}
                </span>
              </div>
              {/* Revenue bar */}
              <div className="h-1.5 rounded-full bg-brand-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-brand-500"
                  style={{ width: `${(p.revenue / maxRevenue) * 100}%` }}
                />
              </div>
            </div>
            <span className="text-sm font-semibold text-ios-label w-16 text-right">
              {(p.revenue || 0).toFixed(0)} {t.zl}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
