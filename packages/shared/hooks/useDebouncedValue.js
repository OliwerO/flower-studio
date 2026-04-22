import { useEffect, useState } from 'react';

// Pure scheduler — testable without React. One live timer at a time;
// scheduling again cancels the previous one so only the last value
// emitted within a quiet period survives. The hook below thin-wraps
// this with useState + useEffect.
export function createDebounceScheduler(delayMs) {
  let timerId = null;
  return {
    schedule(value, emit) {
      if (timerId != null) clearTimeout(timerId);
      timerId = setTimeout(() => {
        timerId = null;
        emit(value);
      }, delayMs);
    },
    cancel() {
      if (timerId != null) {
        clearTimeout(timerId);
        timerId = null;
      }
    },
  };
}

// Returns a value that lags behind the input by `delayMs`. Typical use:
// debounce a search input so filter/sort code doesn't re-run on every
// keystroke. 300ms is a good default for text inputs.
export default function useDebouncedValue(value, delayMs = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
