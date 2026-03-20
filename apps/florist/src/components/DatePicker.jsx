import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';

// English month and day names
const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];
const DAYS = ['Mo','Tu','We','Th','Fr','Sa','Su'];

// Helpers - pure functions (small SOPs that convert between formats)
function toDateParts(yyyy_mm_dd) {
  const [y, m, d] = (yyyy_mm_dd || '').split('-').map(Number);
  return y ? { year: y, month: m, day: d } : null;
}

function pad(n) { return String(n).padStart(2, '0'); }

function formatDisplay(yyyy_mm_dd) {
  const p = toDateParts(yyyy_mm_dd);
  if (!p) return null;
  return p.day + ' ' + MONTHS[p.month - 1] + ' ' + p.year;
}

// Returns day-of-week index (0 = Monday, 6 = Sunday)
function mondayIndex(date) {
  return (date.getDay() + 6) % 7;
}

// Build calendar grid cells for a given year/month
function buildCalendar(year, month) {
  const firstDay = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const startOffset = mondayIndex(firstDay);

  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  return cells;
}

/**
 * DatePicker - custom iOS-style calendar dropdown.
 *
 * Uses a portal to render the calendar at the body level,
 * preventing clipping by parent overflow:hidden containers.
 */
export default function DatePicker({ value, onChange, placeholder = 'Select date' }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const calRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  // Which month the calendar currently shows
  const initial = toDateParts(value);
  const now = new Date();
  const [viewYear, setViewYear] = useState(initial?.year ?? now.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial?.month ?? (now.getMonth() + 1));

  // When value changes externally, snap calendar view to that month
  useEffect(() => {
    const p = toDateParts(value);
    if (p) { setViewYear(p.year); setViewMonth(p.month); }
  }, [value]);

  // Position the calendar dropdown relative to the trigger button
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const calHeight = 320; // approximate calendar height
    const calWidth = 288; // w-72 = 18rem = 288px
    const spaceBelow = window.innerHeight - rect.bottom;
    const openAbove = spaceBelow < calHeight && rect.top > calHeight;

    setPos({
      top: openAbove ? rect.top - calHeight - 8 : rect.bottom + 8,
      left: Math.max(8, Math.min(rect.right - calWidth, window.innerWidth - calWidth - 8)),
    });
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    updatePosition();
    function handleClick(e) {
      if (triggerRef.current?.contains(e.target)) return;
      if (calRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('touchstart', handleClick);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('touchstart', handleClick);
    };
  }, [open, updatePosition]);

  const cells = useMemo(() => buildCalendar(viewYear, viewMonth), [viewYear, viewMonth]);

  const todayStr = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());

  function prevMonth() {
    if (viewMonth === 1) { setViewMonth(12); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 12) { setViewMonth(1); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  function selectDay(day) {
    const dateStr = viewYear + '-' + pad(viewMonth) + '-' + pad(day);
    onChange(dateStr);
    setOpen(false);
  }

  return (
    <div className="relative" ref={triggerRef}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-end gap-2 text-base bg-transparent outline-none text-right"
      >
        <span className={value ? 'text-ios-label' : 'text-ios-tertiary/50'}>
          {value ? formatDisplay(value) : placeholder}
        </span>
        <svg className="w-4 h-4 text-ios-tertiary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
        </svg>
      </button>

      {/* Calendar dropdown — rendered via portal to avoid overflow clipping */}
      {open && createPortal(
        <div
          ref={calRef}
          className="fixed z-[9999] w-72 bg-white rounded-2xl p-3 shadow-lg border border-gray-200"
          style={{ top: pos.top, left: pos.left }}
        >
          {/* Month/Year header with navigation arrows */}
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={prevMonth}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-ios-secondary transition-colors hover:bg-gray-200 active-scale"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </button>

            <span className="text-sm font-semibold text-ios-label">
              {MONTHS[viewMonth - 1]} {viewYear}
            </span>

            <button
              type="button"
              onClick={nextMonth}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-ios-secondary transition-colors hover:bg-gray-200 active-scale"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </div>

          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 mb-1">
            {DAYS.map(d => (
              <div key={d} className="text-center text-xs font-medium text-ios-tertiary py-1">
                {d}
              </div>
            ))}
          </div>

          {/* Day cells grid */}
          <div className="grid grid-cols-7">
            {cells.map((day, i) => {
              if (day === null) return <div key={'blank-' + i} />;

              const dateStr = viewYear + '-' + pad(viewMonth) + '-' + pad(day);
              const isSelected = dateStr === value;
              const isToday = dateStr === todayStr;

              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => selectDay(day)}
                  className={[
                    'w-9 h-9 mx-auto flex items-center justify-center rounded-full text-sm transition-colors',
                    isSelected
                      ? 'bg-brand-600 text-white font-semibold shadow-sm'
                      : isToday
                        ? 'bg-brand-100 text-brand-700 font-medium'
                        : 'text-ios-label hover:bg-gray-100 active:bg-gray-200',
                  ].join(' ')}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
