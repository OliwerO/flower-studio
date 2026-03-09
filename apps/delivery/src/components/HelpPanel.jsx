// HelpPanel — bottom-sheet FAQ accordion for the delivery app.

import { useState } from 'react';
import guide from '../guideContent.js';

export default function HelpPanel({ onClose }) {
  const [openIdx, setOpenIdx] = useState(null);

  function toggle(key) {
    setOpenIdx(prev => (prev === key ? null : key));
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative bg-white rounded-t-3xl max-h-[85vh] overflow-y-auto animate-slide-up">
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-gray-300 rounded-full" />
        </div>

        <div className="flex items-center justify-between px-5 pb-3">
          <h2 className="text-lg font-bold text-ios-label">{guide.guideTitle}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-ios-tertiary text-sm"
          >
            ✕
          </button>
        </div>

        <div className="px-5 pb-8 space-y-5">
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
                        className="w-full flex items-center justify-between px-4 py-3 text-left active:bg-gray-100"
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
