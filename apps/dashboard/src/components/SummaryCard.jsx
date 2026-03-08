// SummaryCard — a KPI tile showing one metric with a label.
// Like a gauge on a dashboard: one number, one context line.
// Uses solid white card (matching florist app's card style) for readability.

const COLORS = {
  brand: 'text-brand-600',
  green: 'text-emerald-600',
  blue:  'text-sky-600',
  red:   'text-rose-600',
  orange:'text-ios-orange',
};

export default function SummaryCard({ label, value, detail, color = 'brand', onClick }) {
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-2xl shadow-sm px-4 py-4 ${
        onClick ? 'cursor-pointer hover:shadow-md transition-all active-scale' : ''
      }`}
    >
      <p className="text-xs text-ios-tertiary font-medium uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${COLORS[color] || COLORS.brand}`}>{value}</p>
      {detail && <p className="text-xs text-ios-tertiary mt-1">{detail}</p>}
    </div>
  );
}
