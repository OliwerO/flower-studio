import { useState } from 'react';
import AskBlossomPanel from './AskBlossomPanel.jsx';

// Floating chat launcher for the owner. A bottom-right FAB opens the assistant:
// a bottom sheet on phones, a right-side drawer on desktop (responsive via `sm:`).
// Shared by the dashboard + florist apps; replaces the old top tab / nav entry.
// `fabClassName` lets a host nudge the button (e.g. above the florist bottom nav).

// "Blossom bubble" — the flower-AI assistant mark: a chat bubble (currentColor,
// so it inherits the button's white) with a small brand-tint bloom inside, saying
// "assistant" + "flowers" at once. Two-tone (white bubble + brand-200 petals) reads
// on both the flat pink and the gradient FAB, and on the brand-600 panel header.
function BlossomMark({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6.2 3.4h11.6a2.9 2.9 0 0 1 2.9 2.9v6.6a2.9 2.9 0 0 1-2.9 2.9h-6l-4.5 3.6a.7.7 0 0 1-1.14-.55v-3.05H6.2A2.9 2.9 0 0 1 3.3 12.9V6.3A2.9 2.9 0 0 1 6.2 3.4z"
      />
      <g transform="translate(0 -1.7)">
        <circle cx="12" cy="9.45" r="2" fill="#fbcfe8" />
        <circle cx="14.42" cy="11.21" r="2" fill="#fbcfe8" />
        <circle cx="13.5" cy="13.06" r="2" fill="#fbcfe8" />
        <circle cx="10.5" cy="13.06" r="2" fill="#fbcfe8" />
        <circle cx="9.58" cy="11.21" r="2" fill="#fbcfe8" />
        <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      </g>
    </svg>
  );
}

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
          className={`fixed z-40 ${fabClassName} w-14 h-14 rounded-full bg-gradient-to-br from-brand-400 via-brand-600 to-brand-700 text-white shadow-xl flex items-center justify-center hover:from-brand-500 hover:to-brand-800 active:scale-95 transition`}
        >
          <BlossomMark size={24} />
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
              <BlossomMark size={18} />
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
