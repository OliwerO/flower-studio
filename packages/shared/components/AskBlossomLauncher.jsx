import { useState } from 'react';
import AskBlossomPanel from './AskBlossomPanel.jsx';

// Floating chat launcher for the owner. A bottom-right FAB opens the assistant:
// a bottom sheet on phones, a right-side drawer on desktop (responsive via `sm:`).
// Shared by the dashboard + florist apps; replaces the old top tab / nav entry.
// `fabClassName` lets a host nudge the button (e.g. above the florist bottom nav).
const SPARKLE = "M12 2l1.8 4.9L19 8.7l-4.2 2.6L13.5 16 12 11.6 10.5 16 9.2 11.3 5 8.7l5.2-1.8L12 2z";

export default function AskBlossomLauncher({
  t,
  fabClassName = 'bottom-6 right-6',
  reporterRole,
  reporterName,
  appArea,
}) {
  const [open, setOpen] = useState(false);
  const [maximized, setMaximized] = useState(false);
  return (
    <>
      <style>{`
        @keyframes alb-up{from{transform:translateY(100%)}to{transform:translateY(0)}}
        @keyframes alb-right{from{transform:translateX(100%)}to{transform:translateX(0)}}
        @keyframes alb-fade{from{opacity:0}to{opacity:1}}
      `}</style>

      {!open && (
        <button
          aria-label={t.tabAssistant}
          onClick={() => setOpen(true)}
          className={`fixed z-40 ${fabClassName} w-14 h-14 rounded-full bg-brand-600 text-white shadow-xl flex items-center justify-center hover:bg-brand-700 active:scale-95 transition`}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={SPARKLE} /></svg>
        </button>
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30 animate-[alb-fade_0.18s_ease-out]" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label={t.tabAssistant}
            className={`fixed z-50 bg-white shadow-2xl flex flex-col overflow-hidden
                       transition-[top,width] duration-200 ease-out
                       animate-[alb-up_0.22s_ease-out] sm:animate-[alb-right_0.22s_ease-out]
                       ${maximized
                         ? 'inset-0 rounded-none sm:w-full sm:max-w-none'
                         : 'inset-x-0 bottom-0 top-[12%] rounded-t-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:top-0 sm:w-[440px] sm:max-w-[92vw] sm:rounded-none'}`}
          >
            <div className="flex items-center gap-2 px-3 py-2 border-b bg-brand-600 text-white shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={SPARKLE} /></svg>
              <span className="font-semibold text-sm flex-1">Ask Blossom</span>
              <button
                aria-label={maximized ? 'Restore' : 'Maximize'}
                onClick={() => setMaximized(m => !m)}
                className="w-7 h-7 rounded hover:bg-white/20 flex items-center justify-center"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {maximized
                    ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
                    : <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />}
                </svg>
              </button>
              <button aria-label="Close" onClick={() => setOpen(false)} className="w-7 h-7 rounded hover:bg-white/20 leading-none text-lg">✕</button>
            </div>
            <div className="flex-1 min-h-0">
              <AskBlossomPanel
                t={t}
                reporterRole={reporterRole}
                reporterName={reporterName}
                appArea={appArea}
              />
            </div>
          </div>
        </>
      )}
    </>
  );
}
