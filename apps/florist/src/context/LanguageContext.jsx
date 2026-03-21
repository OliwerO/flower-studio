import { LanguageProvider as SharedProvider, useLanguage, LangToggle as SharedLangToggle } from '@flower-studio/shared';
import { setLanguage } from '../translations.js';
import { setGuideLanguage } from '../guideContent.js';

export { useLanguage };

export function LanguageProvider({ children }) {
  return (
    <SharedProvider setLanguage={setLanguage} setGuideLanguage={setGuideLanguage}>
      {children}
    </SharedProvider>
  );
}

export function LangToggle() {
  return (
    <SharedLangToggle
      className="text-xs font-bold px-2 py-1 rounded-lg bg-gray-100 text-ios-secondary hover:bg-gray-200 active-scale uppercase tracking-wide"
    />
  );
}
