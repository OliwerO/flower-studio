import { useRef, useEffect } from 'react';

// Pure state-machine factory — testable without React.
// Returns an object of event handlers plus a dispose fn to clear pending timers.
//
// `onLongPress`  - fired once when the press exceeds `delay` ms without moving
// `delay`        - press duration in ms (default 500)
// `moveTolerance`- max finger/mouse drift in px before cancelling (default 10)

export function createLongPressHandlers(onLongPress, { delay = 500, moveTolerance = 10 } = {}) {
  let timer = null;
  let startPos = null;

  function clear() {
    if (timer) { clearTimeout(timer); timer = null; }
    startPos = null;
  }

  function start(e) {
    const point = e.touches ? e.touches[0] : e;
    startPos = { x: point.clientX, y: point.clientY };
    timer = setTimeout(() => { onLongPress(e); }, delay);
  }

  function move(e) {
    if (!startPos) return;
    const point = e.touches ? e.touches[0] : e;
    const dx = point.clientX - startPos.x;
    const dy = point.clientY - startPos.y;
    if (Math.hypot(dx, dy) > moveTolerance) clear();
  }

  return {
    onTouchStart: start,
    onTouchMove: move,
    onTouchEnd: clear,
    onTouchCancel: clear,
    onMouseDown: start,
    onMouseMove: move,
    onMouseUp: clear,
    onMouseLeave: clear,
    dispose: clear,
  };
}

// React hook wrapper — stores one factory per mount so timers survive across
// re-renders and are cleared on unmount. onLongPress is read via ref so stale
// closures don't bite if the caller recreates the callback every render.

export default function useLongPress(onLongPress, opts) {
  const cbRef = useRef(onLongPress);
  useEffect(() => { cbRef.current = onLongPress; }, [onLongPress]);

  const handlersRef = useRef(null);
  if (!handlersRef.current) {
    handlersRef.current = createLongPressHandlers((e) => cbRef.current(e), opts);
  }

  useEffect(() => () => { handlersRef.current?.dispose(); }, []);

  const { dispose, ...handlers } = handlersRef.current;
  return handlers;
}
