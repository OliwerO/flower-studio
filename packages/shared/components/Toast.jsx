// Toast — notification popup. Position varies per app:
// florist: bottom-24, delivery: bottom-6, dashboard: bottom-8
// Receives toast + dismiss as props to avoid context identity issues
// when used across workspace packages.

export default function Toast({ toast, dismiss, position = 'bottom-8' }) {
  if (!toast) return null;

  const isError = toast.type === 'error';
  // 'warning' (amber) is for "it worked, but something still needs your
  // attention" — e.g. Pull kept a local price the storefront has not taken
  // yet (#428). Green would read as "all done" and red as "it failed";
  // neither is true. Any other/absent type still renders green, so existing
  // showToast(msg) / showToast(msg, 'success') calls are unaffected.
  const isWarning = toast.type === 'warning';

  const tone  = isError ? 'bg-ios-red' : isWarning ? 'bg-ios-orange' : 'bg-ios-green';
  const glyph = isError || isWarning ? '!' : '✓';

  return (
    <div
      className={`fixed ${position} left-1/2 -translate-x-1/2 z-50
                  flex items-center gap-3 px-5 py-3.5 rounded-[20px] shadow-lg
                  max-w-sm w-[90vw] text-white
                  ${tone}`}
      role="alert"
    >
      <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-white/20">
        <span className="text-sm font-bold">{glyph}</span>
      </div>
      <p className="flex-1 text-sm font-medium">{toast.message}</p>
      <button onClick={dismiss} className="text-white/70 text-lg px-1">✕</button>
    </div>
  );
}
