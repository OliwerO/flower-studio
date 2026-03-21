import t from '../../translations.js';

export default function AvailableTodayBanner({ products, onFilter }) {
  if (products.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 mb-4 flex items-center gap-3">
        <span className="text-lg">📦</span>
        <span className="text-sm text-gray-500">{t.prodAvailTodayNone}</span>
      </div>
    );
  }

  return (
    <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">⚡</span>
          <span className="text-sm font-medium text-green-800">
            {t.prodAvailTodayBanner}: {products.length}
          </span>
        </div>
        <button onClick={onFilter} className="text-xs font-medium px-3 py-1 rounded-full text-green-700 bg-green-100 hover:bg-green-200">
          {t.prodFilterToday}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {products.map(g => {
          const prices = g.variants
            .filter(v => v['Active'] && Number(v['Lead Time Days'] ?? 1) === 0)
            .map(v => Number(v['Price'] || 0))
            .filter(p => p > 0);
          const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
          return (
            <div key={g.wixProductId} className="flex items-center gap-1.5 bg-white rounded-lg px-2 py-1 border border-green-100">
              {g.imageUrl && <img src={g.imageUrl} alt="" className="w-5 h-5 rounded object-cover" />}
              <span className="text-xs font-medium text-gray-700">{g.name}</span>
              {minPrice > 0 && <span className="text-xs text-gray-400">{t.fromPrice} {minPrice} zł</span>}
            </div>
          );
        })}
      </div>
      <p className="text-xs mt-1.5 text-green-600">{t.prodAvailTodayHint}</p>
    </div>
  );
}
