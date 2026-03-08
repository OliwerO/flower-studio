import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * TimePicker — iOS-style time selector with hour + minute columns.
 * Replaces native <input type="time"> to avoid locale issues (German UI).
 *
 * Props:
 *   value       — "HH:MM" string (e.g. "14:30") or empty string
 *   onChange    — callback receiving "HH:MM" string
 *   placeholder — optional placeholder text (default: "Select time")
 */
export default function TimePicker({ value = '', onChange, placeholder = 'Select time' }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const hourColRef = useRef(null);
  const minColRef = useRef(null);

  // Parse current value into hour/minute
  const [selectedHour, selectedMinute] = value
    ? value.split(':').map(Number)
    : [null, null];

  // Close picker when clicking outside
  useEffect(() => {
    if (!open) return;

    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [open]);

  // Scroll selected values into view when the picker opens
  useEffect(() => {
    if (!open) return;

    // Small delay to ensure the dropdown has rendered
    const timer = setTimeout(() => {
      if (selectedHour !== null && hourColRef.current) {
        const el = hourColRef.current.querySelector('[data-selected="true"]');
        if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' });
      }
      if (selectedMinute !== null && minColRef.current) {
        const el = minColRef.current.querySelector('[data-selected="true"]');
        if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' });
      }
    }, 30);

    return () => clearTimeout(timer);
  }, [open, selectedHour, selectedMinute]);

  const handleSelect = useCallback((type, num) => {
    let h = selectedHour ?? 12;
    let m = selectedMinute ?? 0;

    if (type === 'hour') h = num;
    if (type === 'minute') m = num;

    const hh = String(h).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    onChange(`${hh}:${mm}`);
  }, [selectedHour, selectedMinute, onChange]);

  // Generate hours 00-23 and minutes in 15-min intervals
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = [0, 15, 30, 45];

  // Format display value
  const displayValue = value
    ? `${String(selectedHour).padStart(2, '0')}:${String(selectedMinute).padStart(2, '0')}`
    : '';

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger — styled to match DatePicker and TextInput rows */}
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="w-full flex items-center justify-end gap-2 text-base bg-transparent outline-none text-right"
      >
        <span className={displayValue ? 'text-ios-label' : 'text-ios-tertiary/50'}>
          {displayValue || placeholder}
        </span>
        <svg className="w-4 h-4 text-ios-tertiary shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
      </button>

      {/* Dropdown picker */}
      {open && (
        <div
          className="
            absolute z-50 mt-2 left-0 right-0
            bg-white rounded-2xl p-2
            shadow-lg border border-gray-200
            animate-in fade-in
          "
          style={{ animationDuration: '150ms' }}
        >
          {/* Column headers */}
          <div className="flex gap-2 mb-1">
            <div className="flex-1 text-center text-xs font-medium text-ios-tertiary uppercase tracking-wide py-1">
              Hour
            </div>
            <div className="flex-1 text-center text-xs font-medium text-ios-tertiary uppercase tracking-wide py-1">
              Min
            </div>
          </div>

          <div className="flex gap-2">
            {/* Hours column */}
            <div
              ref={hourColRef}
              className="flex-1 max-h-52 overflow-y-auto rounded-xl bg-gray-50 scrollbar-thin"
            >
              {hours.map(h => {
                const isSelected = h === selectedHour;
                return (
                  <button
                    key={h}
                    type="button"
                    data-selected={isSelected}
                    onClick={() => handleSelect('hour', h)}
                    className={`
                      w-full py-2 px-3 text-center text-[15px] font-medium
                      rounded-lg transition-all duration-150
                      ${isSelected
                        ? 'bg-brand-600 text-white shadow-sm'
                        : 'text-ios-label hover:bg-gray-100 active:bg-gray-200'
                      }
                    `}
                  >
                    {String(h).padStart(2, '0')}
                  </button>
                );
              })}
            </div>

            {/* Minutes column */}
            <div
              ref={minColRef}
              className="flex-1 max-h-52 overflow-y-auto rounded-xl bg-gray-50 scrollbar-thin"
            >
              {minutes.map(m => {
                const isSelected = m === selectedMinute;
                return (
                  <button
                    key={m}
                    type="button"
                    data-selected={isSelected}
                    onClick={() => handleSelect('minute', m)}
                    className={`
                      w-full py-2 px-3 text-center text-[15px] font-medium
                      rounded-lg transition-all duration-150
                      ${isSelected
                        ? 'bg-brand-600 text-white shadow-sm'
                        : 'text-ios-label hover:bg-gray-100 active:bg-gray-200'
                      }
                    `}
                  >
                    {String(m).padStart(2, '0')}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Done button to explicitly close */}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="
              w-full mt-2 py-2 rounded-xl
              text-brand-600 font-semibold text-[15px]
              bg-brand-50/60 hover:bg-brand-100/60
              transition-colors duration-150
              active:scale-[0.98]
            "
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}
