// HelpPanel — right-edge slide-in panel for the dashboard app.
// Desktop variant: 400px wide, full height, slides from right.

import { useState } from 'react';
import guide from '../guideContent.js';

export default function HelpPanel({ onClose }) {
  const [openIdx, setOpenIdx] = useState(null);

  function toggle(key) {
    setOpenIdx(prev => (prev === key ? null : key));
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      <div className="relative w-[400px] max-w-full h-full bg-white shadow-2xl animate-slide-right overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-bold text-ios-label">{guide.guideTitle}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-ios-tertiary text-sm
                       hover:bg-gray-200 transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {guide.sections.map((section, si) => (
            <div key={si}>
              <p className="text-xs font-semibold text-ios-tertiary uppercase tracking-wide mb-2">
                {section.title}
              </p>
              <div className="bg-gray-50 rounded-2xl overflow-hidden divide-y divide-gray-100">
                {section.items.map((item, ii) => {
                  const key = `${si}-${ii}`;
                  const isOpen = openIdx === key;
                  return (
                    <div key={key}>
                      <button
                        onClick={() => toggle(key)}
                        className="w-full flex items-center justify-between px-4 py-3 text-left
                                   hover:bg-gray-100 transition-colors"
                      >
                        <span className="text-sm font-medium text-ios-label pr-3">{item.q}</span>
                        <span className={`text-ios-tertiary text-xs shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>
                          ▾
                        </span>
                      </button>
                      {isOpen && (
                        <div className="px-4 pb-3">
                          <p className="text-sm text-ios-secondary leading-relaxed">{item.a}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
