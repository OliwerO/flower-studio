import { TRACE_WINDOWS } from '../utils/traceWindow.js';

/**
 * TraceWindowPills — segmented control that scopes a stock trace to a recent
 * window (#4b). Shared by VarietyTracePanel + BatchTracePanel so both trace
 * surfaces offer the same "2 нед / 1 мес / Все" scale options.
 *
 * Props: windowKey (active), onChange(key), t.
 */
export default function TraceWindowPills({ windowKey, onChange, t = {} }) {
  const labelFor = (key) =>
    ({
      '2w': t.window2w ?? '2 wk',
      '1m': t.window1m ?? '1 mo',
      all: t.windowAll ?? 'All',
    }[key] ?? key);

  return (
    <div
      data-testid="trace-window-pills"
      className="inline-flex items-center rounded-full bg-gray-100 p-0.5"
    >
      {TRACE_WINDOWS.map((w) => {
        const active = w.key === windowKey;
        return (
          <button
            key={w.key}
            type="button"
            data-testid={`trace-window-${w.key}`}
            aria-pressed={active}
            onClick={(e) => { e.stopPropagation(); onChange(w.key); }}
            className={`text-[11px] font-medium px-2 py-0.5 rounded-full transition-colors ${
              active ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {labelFor(w.key)}
          </button>
        );
      })}
    </div>
  );
}
