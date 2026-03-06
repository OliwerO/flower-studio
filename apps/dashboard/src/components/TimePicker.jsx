import { useState, useRef, useEffect, useCallback } from 'react';

export default function TimePicker({ value = '', onChange, placeholder = 'Select time' }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const hourColRef = useRef(null);
  const minColRef = useRef(null);

  const [selectedHour, selectedMinute] = value
    ? value.split(':').map(Number)
    : [null, null];

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
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
    onChange(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }, [selectedHour, selectedMinute, onChange]);

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = [0, 15, 30, 45];

  const displayValue = value
    ? `${String(selectedHour).padStart(2, '0')}:${String(selectedMinute).padStart(2, '0')}`
    : '';

  return (
    <div ref={containerRef} className="relative">
      <button type="button" onClick={() => setOpen(prev => !prev)}
        className="w-full flex items-center justify-end gap-2 text-base bg-transparent outline-none text-right">
        <span className={displayValue ? 'text-ios-label' : 'text-ios-tertiary/50'}>
          {displayValue || placeholder}
        </span>
        <svg className="w-4 h-4 text-ios-tertiary shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-2 left-0 right-0 bg-white/95 backdrop-blur-xl rounded-2xl p-2 shadow-lg border border-white/60">
          <div className="flex gap-2 mb-1">
            <div className="flex-1 text-center text-xs font-medium text-ios-tertiary uppercase tracking-wide py-1">Hour</div>
            <div className="flex-1 text-center text-xs font-medium text-ios-tertiary uppercase tracking-wide py-1">Min</div>
          </div>
          <div className="flex gap-2">
            <div ref={hourColRef} className="flex-1 max-h-52 overflow-y-auto rounded-xl bg-white/40 scrollbar-thin">
              {hours.map(h => (
                <button key={h} type="button" data-selected={h === selectedHour}
                  onClick={() => handleSelect('hour', h)}
                  className={`w-full py-2 px-3 text-center text-[15px] font-medium rounded-lg transition-all duration-150 ${
                    h === selectedHour ? 'bg-brand-600 text-white shadow-sm' : 'text-ios-label hover:bg-white/60 active:bg-white/80'
                  }`}>
                  {String(h).padStart(2, '0')}
                </button>
              ))}
            </div>
            <div ref={minColRef} className="flex-1 max-h-52 overflow-y-auto rounded-xl bg-white/40 scrollbar-thin">
              {minutes.map(m => (
                <button key={m} type="button" data-selected={m === selectedMinute}
                  onClick={() => handleSelect('minute', m)}
                  className={`w-full py-2 px-3 text-center text-[15px] font-medium rounded-lg transition-all duration-150 ${
                    m === selectedMinute ? 'bg-brand-600 text-white shadow-sm' : 'text-ios-label hover:bg-white/60 active:bg-white/80'
                  }`}>
                  {String(m).padStart(2, '0')}
                </button>
              ))}
            </div>
          </div>
          <button type="button" onClick={() => setOpen(false)}
            className="w-full mt-2 py-2 rounded-xl text-brand-600 font-semibold text-[15px] bg-brand-50/60 hover:bg-brand-100/60 transition-colors duration-150">
            Done
          </button>
        </div>
      )}
    </div>
  );
}
