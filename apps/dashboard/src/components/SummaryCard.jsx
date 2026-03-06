// SummaryCard — a KPI tile showing one metric with a label.
// Like a gauge on a dashboard: one number, one context line.
// Clickable cards act as navigation shortcuts to relevant tabs.

const COLORS = {
  brand: 'text-brand-600',
  green: 'text-ios-green',
  blue:  'text-ios-blue',
  red:   'text-ios-red',
  orange:'text-ios-orange',
};

export default function SummaryCard({ label, value, detail, color = 'brand', onClick }) {
  return (
    <div
      onClick={onClick}
      className={`glass-card px-4 py-4 ${
        onClick ? 'cursor-pointer hover:scale-[1.02] hover:shadow-md transition-all active:scale-[0.98]' : ''
      }`}
    >
      <p className="text-xs text-ios-tertiary font-medium uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${COLORS[color] || COLORS.brand}`}>{value}</p>
      {detail && <p className="text-xs text-ios-tertiary mt-1">{detail}</p>}
    </div>
  );
}
