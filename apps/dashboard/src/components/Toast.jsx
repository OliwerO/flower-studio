import { useToast } from '../context/ToastContext.jsx';

export default function Toast() {
  const { toast, dismiss } = useToast();
  if (!toast) return null;

  const isError = toast.type === 'error';

  return (
    <div
      className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-50
                  flex items-center gap-3 px-5 py-3.5 rounded-[20px] shadow-lg
                  max-w-sm w-[90vw] text-white
                  ${isError ? 'bg-ios-red' : 'bg-ios-green'}`}
      role="alert"
    >
      <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-white/20">
        <span className="text-sm font-bold">{isError ? '!' : '✓'}</span>
      </div>
      <p className="flex-1 text-sm font-medium">{toast.message}</p>
      <button onClick={dismiss} className="text-white/70 text-lg px-1">✕</button>
    </div>
  );
}
