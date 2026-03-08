// Pills — reusable pill-button select, adapted from florist app.
// Like a set of physical toggle switches on a control panel: one active at a time.

export default function Pills({ options, value, onChange, disabled }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => !disabled && onChange(o.value)}
          disabled={disabled}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            value === o.value
              ? (o.activeClass || 'bg-brand-600 text-white shadow-sm')
              : 'bg-gray-100 text-ios-secondary border border-gray-200 hover:bg-gray-200'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
